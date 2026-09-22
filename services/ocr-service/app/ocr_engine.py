"""PaddleOCR wrapper — CPU only, loaded once, reused.

Prefers PP-StructureV3 (layout-aware) when its `paddlex` pipeline extras are
installed; otherwise falls back to plain `PaddleOCR`, which is enough here —
downstream concatenates every page to one text blob and lets the LLM/regex
pull the fields, so document structure analysis buys nothing.

paddleocr's constructor signature and `.predict()` output shape have shifted
across versions. This module is the ONLY place that touches paddle's shapes:
if the installed version differs, adjust `_texts_and_scores` (and the kwargs
tried in `_load`). `OcrUnavailable` -> callers degrade to "couldn't read this
page", never a 500.
"""

from __future__ import annotations

import threading

from . import config


class OcrUnavailable(RuntimeError):
    pass


_engine = None
_lock = threading.Lock()

# (class name, constructor kwargs to try in order). PP-StructureV3 first.
# `enable_mkldnn=False` is deliberate: paddlepaddle 3.x's OneDNN CPU executor
# throws `ConvertPirAttribute2RuntimeAttribute not support` on the PP-OCRv6 det
# model. Disabling MKLDNN routes around it (slower, but correct).
_MKL = {"enable_mkldnn": False}
# Skip the heavyweight doc-preprocessor sub-pipeline (orientation classify +
# UVDoc unwarping + textline orientation). Invoices don't need it; it wants a
# 3-channel image, and it OOMs a small container. det + rec is all we use.
_LEAN = {
    "use_doc_orientation_classify": False,
    "use_doc_unwarping": False,
    "use_textline_orientation": False,
}
_MODELS = {}
if config.OCR_DET_MODEL:
    _MODELS["text_detection_model_name"] = config.OCR_DET_MODEL
if config.OCR_REC_MODEL:
    _MODELS["text_recognition_model_name"] = config.OCR_REC_MODEL

_CANDIDATES = (
    ("PPStructureV3", ({"device": "cpu", **_MKL}, dict(_MKL), {})),
    ("PaddleOCR", (
        {**_MKL, **_LEAN, **_MODELS},
        {"lang": "en", **_MKL, **_LEAN},
        {"lang": "en", **_MKL},
        {"lang": "en"},
        {},
    )),
)


def _load():
    errs: list[str] = []
    for clsname, kwargs_list in _CANDIDATES:
        try:
            import paddleocr

            cls = getattr(paddleocr, clsname)
        except Exception as exc:  # not importable / class absent in this version
            errs.append(f"{clsname}: {exc}")
            continue
        for kwargs in kwargs_list:
            try:
                return cls(**kwargs)
            except TypeError:
                continue  # unknown kwarg for this version — next combo
            except Exception as exc:  # e.g. PP-StructureV3 missing paddlex extras
                errs.append(f"{clsname}({kwargs}): {exc}")
                break  # this class won't init — try the next class
    raise OcrUnavailable("no PaddleOCR engine could be initialised — " + " | ".join(errs))


def _get_engine():
    global _engine
    if _engine is not None:
        return _engine
    with _lock:
        if _engine is None:
            _engine = _load()
    return _engine


def ocr_image(image) -> dict:
    """np.ndarray -> {'text': str, 'avg_confidence': float in 0..1}."""
    raw = _run(_get_engine(), image)
    pairs = _texts_and_scores(raw)
    text = "\n".join(t for t, _ in pairs if t).strip()
    scores = [s for _, s in pairs if s is not None]
    return {
        "text": text,
        "avg_confidence": round(sum(scores) / len(scores), 4) if scores else 0.0,
    }


def _run(engine, image):
    if hasattr(engine, "predict"):
        return engine.predict(image)
    return engine(image)  # legacy PPStructure is callable


def _texts_and_scores(raw) -> list[tuple[str, float | None]]:
    """Flatten whatever paddle returned into (text, score) pairs.

    Handles the three shapes seen in the wild:
      * PP-OCRv4 / PP-StructureV3 result objects with a `.json`/dict carrying
        `rec_texts` + `rec_scores`
      * legacy PPStructure blocks: [{'type', 'res': [{'text', 'confidence'}]}]
      * plain OCR lines: [[box, (text, score)], ...]
    """
    out: list[tuple[str, float | None]] = []
    items = list(raw) if isinstance(raw, (list, tuple)) else [raw]
    for it in items:
        try:
            d = it if isinstance(it, dict) else getattr(it, "json", None)
            # paddleocr 3.x nests the payload under "res"
            if isinstance(d, dict) and isinstance(d.get("res"), dict):
                d = d["res"]

            if isinstance(d, dict) and "rec_texts" in d:
                texts = d.get("rec_texts") or []
                scores = d.get("rec_scores") or []
                for i, t in enumerate(texts):
                    out.append((str(t), _f(scores[i]) if i < len(scores) else None))
                continue

            # legacy PPStructure block: {"res": [{"text","confidence"}, ...]}
            if isinstance(it, dict) and isinstance(it.get("res"), list):
                for r in it["res"]:
                    if isinstance(r, dict) and "text" in r:
                        out.append((str(r["text"]), _f(r.get("confidence"))))
                continue

            # plain OCR line: [box, (text, score)]
            if isinstance(it, (list, tuple)) and len(it) >= 2 and isinstance(it[1], (list, tuple)) and it[1]:
                out.append((str(it[1][0]), _f(it[1][1]) if len(it[1]) > 1 else None))
        except Exception:
            continue  # skip an unrecognised item rather than fail the page
    return out


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
