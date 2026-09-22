"""Shared single-document pipeline: read -> OCR -> extract -> validate ->
direction guess -> duplicate check -> optionally persist to review_queue.

One code path for "what happens to an uploaded document" regardless of how it
got here — the synchronous /extract endpoint and the async bulk-upload
consumer (app/bulk.py) both call `process_document`.
"""

from __future__ import annotations

from . import config, extract as extract_mod, match, ocr_engine, routing, validation
from .hasura import HasuraError, fetch_company_settings, find_existing_by_number, insert_review_queue


def read_document(raw: bytes, content_type: str | None) -> tuple[dict, str | None]:
    """Ingest -> route pages -> OCR the scanned ones -> combine.
    Returns (combine_pages result, engine_error_or_None)."""
    if routing.is_pdf(raw, content_type):
        routed = routing.route_pages(raw, config.MAX_PAGES)
        ocr_results, engine_err = _ocr_pdf_pages(raw, routed)
    else:  # image upload — no text layer to check, always OCR
        routed = [{"page_num": 0, "method": "ocr", "direct_text": None}]
        page, engine_err = _ocr_image_bytes(raw)
        ocr_results = {0: page} if page else {}
    return extract_mod.combine_pages(routed, ocr_results), engine_err


async def process_document(
    raw: bytes,
    filename: str | None,
    content_type: str | None,
    company_id: str,
    *,
    always_queue: bool = False,
) -> dict:
    """Run the full pipeline on one document.

    `always_queue=True` (bulk uploads — nobody's watching to click "create")
    persists to review_queue whether or not the extraction is valid, so every
    bulk file lands somewhere a human can act on it. The interactive /extract
    endpoint keeps the default `always_queue=False` — a valid result there is
    handed back to the browser for the user to review and commit directly.
    """
    combined, engine_err = read_document(raw, content_type)

    if not combined["full_text"]:
        result = {
            "extracted_fields": {},
            "source_map": combined["source_map"],
            "full_text": "",
            "possible_duplicate": None,
            "direction": "payable",
            "counterparty_name": None,
            "direction_detected": False,
            "valid": False,
            "issues": [engine_err or "no text could be read from this document"],
            "review_queue_id": None,
        }
        if always_queue:
            result["review_queue_id"] = await _try_queue(result, filename, company_id)
        return result

    extracted = extract_mod.extract(combined["full_text"], combined["source_map"])
    valid, issues = validation.validate(extracted)

    # payable vs receivable: does our company (Admin -> Company Settings) show
    # up as the buyer or the vendor on this document? Falls back to "payable"
    # (today's only behaviour) when nothing is configured or neither side matches.
    direction = "payable"
    counterparty_name = extracted.get("vendor_name") or extracted.get("buyer_name")
    direction_detected = False
    try:
        company = await fetch_company_settings(company_id)
        guess = match.infer_direction(extracted.get("vendor_name"), extracted.get("buyer_name"), company)
        if guess["direction"]:
            direction, counterparty_name, direction_detected = guess["direction"], guess["counterparty_name"], True
    except HasuraError:
        pass

    # already-in-the-system check — a committed invoice with the same number
    possible_duplicate = None
    try:
        matches = await find_existing_by_number(extracted.get("invoice_number") or "", company_id)
        if matches:
            possible_duplicate = matches[0]
            issues = [
                f"already in the system: invoice {possible_duplicate['invoice_number']}"
                f" ({possible_duplicate['id'][:8]}) — a duplicate cannot be committed",
                *issues,
            ]
            valid = False
    except HasuraError:
        pass

    result = {
        "extracted_fields": extracted,
        "source_map": combined["source_map"],
        "full_text": combined["full_text"],
        "possible_duplicate": possible_duplicate,
        "direction": direction,
        "counterparty_name": counterparty_name,
        "direction_detected": direction_detected,
        "valid": valid,
        "issues": issues,
        "review_queue_id": None,
    }

    if not valid or always_queue:
        result["review_queue_id"] = await _try_queue(result, filename, company_id)

    return result


async def _try_queue(result: dict, filename: str | None, company_id: str) -> str | None:
    try:
        return await insert_review_queue(
            {
                "extracted_fields": result.get("extracted_fields", {}),
                "source_map": result.get("source_map", []),
                "full_text": result.get("full_text", ""),
                "filename": filename,
                "direction": result.get("direction"),
                "counterparty_name": result.get("counterparty_name"),
            },
            result.get("issues", []),
            company_id,
        )
    except HasuraError:
        return None


# ---- OCR helpers: rasterise -> preprocess -> engine --------------------------

def _ocr_pdf_pages(pdf_bytes: bytes, routed: list[dict]) -> tuple[dict[int, dict], str | None]:
    need = [p["page_num"] for p in routed if p["method"] == "ocr"]
    if not need:
        return {}, None
    try:
        import cv2
        import fitz
        import numpy as np

        from .preprocess import preprocess
    except Exception as exc:  # opencv / pymupdf missing
        return {}, f"OCR dependencies unavailable: {exc}"

    results: dict[int, dict] = {}
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for i in need:
            png = doc[i].get_pixmap(dpi=config.OCR_RENDER_DPI).tobytes("png")
            img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
            results[i] = ocr_engine.ocr_image(preprocess(img))
        doc.close()
        return results, None
    except ocr_engine.OcrUnavailable as exc:
        return {}, str(exc)
    except Exception as exc:
        return {}, f"OCR failed: {exc}"


def _ocr_image_bytes(raw: bytes) -> tuple[dict | None, str | None]:
    try:
        import cv2
        import numpy as np

        from .preprocess import preprocess
    except Exception as exc:
        return None, f"OCR dependencies unavailable: {exc}"
    try:
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None, "could not decode the uploaded image"
        return ocr_engine.ocr_image(preprocess(img)), None
    except ocr_engine.OcrUnavailable as exc:
        return None, str(exc)
    except Exception as exc:
        return None, f"OCR failed: {exc}"
