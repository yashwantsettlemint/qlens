# ocr-service

CPU-only OCR + field extraction for **digital and scanned** invoices. No GPU, no
paid OCR API, no external services beyond the existing Hasura/Postgres.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/extract` | multipart `file` (PDF or image) | `{extracted_fields, source_map, full_text, valid, issues, review_queue_id}` |
| POST | `/extract-text` | multipart `file` | `{text, source_map, pages, chars, ...}` — raw text only, no field extraction / validation / review queue |
| GET | `/health` | — | `{status, ocr, llm}` |

In the stack: host port **8096**, container 8006.

## Pipeline

1. **Page-level source detection** (`app/routing.py`). For PDFs, each page is
   checked *separately*: it counts as digital only if the text layer is long
   enough **and** passes a garbled-text heuristic (some scanners embed a junk
   invisible OCR layer). Image uploads always go to OCR.
2. **Preprocess** OCR-routed pages (`app/preprocess.py`): grayscale → deskew
   (Otsu foreground, skipped if the angle estimate is unreliable) → denoise →
   adaptive threshold → 1.5× upscale. Knobs: `OCR_RENDER_DPI`, `OCR_UPSCALE`,
   `OCR_MAX_DESKEW_DEG`.
3. **OCR** with **PaddleOCR**, CPU (`app/ocr_engine.py`), loaded once at first
   use. Uses the **mobile** det/rec models (`PP-OCRv5_mobile_*`, ~1.2 GB peak
   RSS; the medium/server models OOM a small container) with the doc-orientation
   / unwarping sub-pipeline disabled and `enable_mkldnn=False` (paddlepaddle
   3.x's OneDNN CPU path crashes on PP-OCRv6). It prefers `PPStructureV3` if the
   `paddlex` pipeline extras are present, else plain `PaddleOCR` — either is
   fine, downstream concatenates to one text blob. `OcrUnavailable` → the page
   comes back as "couldn't read", never a 500.
4. **Combine + extract** (`app/extract.py`): all pages → one document with a
   `source_map` (per page: method + confidence). An LLM tool call
   (`LLM_*` / Groq, or `AZURE_OPENAI_*`) or, offline, a regex extractor fills the fields.
   **OCR-sourced field confidences are capped at the OCR page confidence** — a
   field can't be more reliable than the text it was read from.
5. **Validate** (`app/validation.py`): financial fields (amounts, dates) held to
   `OCR_CONF_FINANCIAL` (0.92), others to `OCR_CONF_OTHER` (0.80); plus a
   line-items + tax = total arithmetic check and a required-fields check.
6. `valid` → the caller (ingestion-service) commits to `invoices`.
   `not valid` → the draft is written to **`review_queue`** (admin secret) and
   `review_queue_id` is returned.

## Field contract

```jsonc
{
  "extracted_fields": {
    "vendor_name": "...", "invoice_number": "...",
    "invoice_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD",
    "amount": 0.0, "tax_amount": 0.0,
    "line_items": [{"description": "...", "quantity": 0, "unit_price": 0.0, "line_amount": 0.0}],
    "field_confidences": {"vendor_name": 0.0, "amount": 0.0, "...": 0.0}
  },
  "source_map": [{"page": 0, "method": "direct" | "ocr", "confidence": 1.0}],
  "valid": true,
  "issues": [],
  "review_queue_id": null
}
```

## Config

Reads `HASURA_ENDPOINT`, `HASURA_ADMIN_SECRET`, `LLM_*` or `AZURE_OPENAI_*` (optional), and
the `OCR_*` knobs above.

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .          # pulls paddlepaddle + paddleocr + opencv (large)
python tests/test_routing.py && python tests/test_extract.py && python tests/test_validation.py
uvicorn app.main:app --port 8096
curl -s -F file=@sample-invoice.pdf localhost:8096/extract
```

## Notes

- **paddle is version-sensitive.** Pinned to `paddleocr 3.7` + `paddlepaddle
  3.3.x` (CPU) — the combo that's verified working here. `app/ocr_engine.py` is
  the only place that touches paddle's constructor / output shape: adjust
  `_CANDIDATES` and `_texts_and_scores` there if you change versions.
  Knobs: `OCR_DET_MODEL` / `OCR_REC_MODEL` (default the mobile models),
  `OCR_RENDER_DPI` (200), `OCR_UPSCALE` (1.0).
- Without an LLM configured, field extraction is regex-only → base confidence
  0.5, so **every** invoice fails validation and lands in `review_queue`. That's
  intended: unattended regex extraction shouldn't auto-commit. With the LLM,
  base is 0.97 and a clean digital invoice auto-commits.
- The Docker image is large (~2.5 GB: paddlepaddle + paddleocr + opencv + baked
  mobile models).
- Confidence capping is conservative: caps at the *minimum* OCR page confidence
  for the whole document (no per-field page attribution).
