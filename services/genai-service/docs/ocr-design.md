# OCR redesign — digital + scanned invoices

> **Superseded.** The full pipeline was built as a separate CPU service —
> `services/ocr-service/` (PaddleOCR PP-StructureV3, no GPU, no paid API) — see
> its README. This document is kept for the design rationale (page-level
> routing, preprocessing, confidence capping, the review queue), which carried
> over; the engine choice below (vLLM / Tesseract tiers) did not.

**Status:** design (not yet implemented)
**Owner:** genai-service
**Decision:** a **self-hosted OCR vision model** (`baidu/Unlimited-OCR` served by vLLM's
OpenAI-compatible server) is the primary engine for scanned input. **Tesseract** is the CPU
fallback when that service is unreachable / no GPU. Azure OpenAI vision stays supported as an
alternative primary for anyone who doesn't want to run a GPU. Digital PDFs never touch an
engine — they use the embedded text layer.

Engine order (`OCR_ENGINE=auto`): **text layer → OCR VLM → Azure vision → Tesseract → unsupported.**

---

## 1. Goal

`POST /extract-ocr` must return structured invoice fields for **both**:

- **digital PDFs** — text is embedded in the file (works today via `pypdf`)
- **scanned PDFs / image uploads** — text is pixels only (today: dead-ends at `pending_review`)

…without changing the field contract the frontend `/upload` PDF tab already consumes.

## 2. Where we are today

| File | Role |
|---|---|
| `app/ocr.py` | `pdf_text()` (pypdf text layer), `regex_fields()` (offline), `shape_llm_fields()`, `empty_fields()`, `FIELDS` |
| `app/llm.py` | `extract_invoice_fields(text)` — Azure OpenAI `invoice_fields` tool call |
| `app/main.py` | `/extract-ocr`: `pdf_text` → if empty return `pending_review` skeleton; else LLM or regex |
| `pyproject.toml` | `pypdf>=5.1`, `openai>=1.40` |

The gap is exactly one stage: **there is no pixels → text step.** Everything downstream of
"we have text" (LLM/regex field extraction, `{value, confidence}` shaping) already works and
is source-agnostic.

## 3. Principle — one source-agnostic funnel

Digital vs scanned differ *only* in how text is obtained. Add one branch at the front; share
everything after it. The response contract and the field-extraction code stay put.

```
POST /extract-ocr  (PDF or image bytes)
        │
        ▼  classify_input()
   ┌────────────────────────────────────────────────┐
   │ PDF, text layer ≥ ~20 chars/page               │ ──► TEXT path ─────────────┐
   │ PDF, no text layer   │   image upload (png/jpg)│ ──► IMAGE path             │
   └────────────────────────────────────────────────┘                           │
        │ IMAGE path                                                            │
        ▼  rasterize PDF pages → PNG @ OCR_RENDER_DPI     [raw images pass thru] │
        ▼  preprocess: grayscale  (+ deskew/threshold — P1 knob)                │
        ▼  recognize()  — first available engine wins                          │
        │    1. OCR VLM  (Unlimited-OCR via vLLM, self-hosted, GPU)  → page text │
        │    2. Azure OpenAI vision  (if AZURE_OPENAI_* set)         → page text │
        │    3. Tesseract  (CPU, if on PATH)         → page text (+ per-word conf)│
        ▼                                                                       │
   ───────────────  common field-extraction stage  ◄───────────────────────────┘
        │   text ──► llm.extract_invoice_fields(text)     ──► {value, confidence}
        │        └► ocr.regex_fields(text)                ──► {value, confidence}
        ▼   normalise: dates→ISO, money→float, vendor fuzzy-match vs Hasura vendors
        ▼   gate: min(field confidences) < OCR_MIN_FIELD_CONFIDENCE → status=needs_review
        ▼
   { status, source, pages, fields, warnings, filename, size_bytes }
```

## 4. Stage detail

### 4.1 `classify_input(raw, content_type, filename) -> "text" | "image" | "unsupported"`

- `application/pdf` (or `%PDF` magic): open with PyMuPDF, sum `page.get_text()` length.
  `≥ 20 * page_count` chars → `"text"`; else `"image"`.
- `image/png|jpeg|webp|tiff`: `"image"`.
- encrypted PDF / unknown mime → `"unsupported"` (HTTP 200, `status: "unsupported"`).

### 4.2 Rasterize (IMAGE path, PDFs only) — **PyMuPDF**

```python
import fitz  # PyMuPDF

def rasterize(raw: bytes, dpi: int, max_pages: int) -> list[bytes]:
    doc = fitz.open(stream=raw, filetype="pdf")
    out, zoom = [], dpi / 72
    for page in doc[:max_pages]:
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
        out.append(pix.tobytes("png"))
    return out
```

PyMuPDF is one pip wheel, no system deps — it also replaces `pypdf` for text extraction, so
we drop a dependency rather than add two. Raw image uploads skip this step.

### 4.3 Preprocess

P0: grayscale (done in `get_pixmap` above; Pillow `convert("L")` for raw images) and a 300-DPI
render target. **That's it for P0.**

P1 knob (add only if scan accuracy is poor — like a calibration dial, a real scan needs tuning
a minimal model can't predict): deskew (Hough/`deskew` lib or OpenCV), adaptive threshold,
denoise, contrast stretch. Keep each behind `OCR_PREPROCESS=basic|full`.

### 4.4 Recognize — `recognize(images) -> (text, source, page_confidences)`

Every engine returns **page text**; the shared field-extraction stage (§4.5) then runs on it.
The OCR VLM and Azure paths *could* also emit structured fields directly, but "return the page
text, then extract" keeps one code path and doesn't assume the model is tool-call trained
(most OCR VLMs are not — they transcribe to text/markdown).

Order under `OCR_ENGINE=auto`, first available wins:

**1. OCR VLM — `baidu/Unlimited-OCR` via vLLM (primary).** Self-hosted, OpenAI-compatible, so
it reuses the `openai` SDK — no new Python dependency. Selected when `OCR_VLM_BASE_URL` is set.
Send up to `OCR_MAX_PAGES` page PNGs and ask for a plain transcription. `source = "ocr-vlm"`.
Per-page confidence: flat 0.75 (the model gives no token logprobs we surface); real
per-field confidence still comes from the extraction stage / cross-checks.

```python
from openai import OpenAI  # plain client, not AzureOpenAI

client = OpenAI(base_url=config.OCR_VLM_BASE_URL, api_key=config.OCR_VLM_API_KEY or "EMPTY")
resp = client.chat.completions.create(
    model=config.OCR_VLM_MODEL,            # "baidu/Unlimited-OCR"
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "Transcribe every invoice page to Markdown. Text only, no commentary."},
        *[{"type": "image_url",
           "image_url": {"url": f"data:image/png;base64,{b64(p)}"}} for p in images],
    ]}],
    temperature=0,
)
text = resp.choices[0].message.content
```

**2. Azure OpenAI vision (alternative primary).** Same call shape against `AzureOpenAI`; used
when `OCR_VLM_BASE_URL` is unset but `AZURE_OPENAI_*` is. `source = "vision-llm"`.

**3. Tesseract (CPU fallback).** OCR each page, join with `\f`; feeds `regex_fields(text)`.
`source = "tesseract"`. Per-field confidence from `pytesseract.image_to_data` word
confidences aggregated over the matched span (P1; P0 = flat 0.5).

```python
import pytesseract
from PIL import Image
text = pytesseract.image_to_string(Image.open(io.BytesIO(png)), lang="eng")
```

**4. None available →** `status: "unsupported"`,
`warnings: ["no OCR engine: set OCR_VLM_BASE_URL or AZURE_OPENAI_*, or install tesseract"]`.

`OCR_ENGINE=vlm|vision|tesseract|text-only` forces a single path (tests, benchmarking).

The vLLM call is a normal async HTTP request. Blocking C calls (`get_pixmap`,
`image_to_string`) run via `fastapi.concurrency.run_in_threadpool` so the event loop isn't
stalled.

### 4.5 Field extraction — **unchanged**

Once `recognize()` yields text (from *any* engine — VLM, Azure vision, Tesseract, or the PDF
text layer), call `llm.extract_invoice_fields(text)` (Azure, if configured) or
`ocr.regex_fields(text)` (offline) exactly as today. One extraction path for every source.

### 4.6 Normalise + validate (P1)

- dates → `YYYY-MM-DD` (dateutil-style parse of common in/uk formats)
- `amount` / `tax_amount` → float via existing `_coerce`
- `vendor_name` → fuzzy-match against `vendors` from Hasura as `genai_readonly`
  (`rapidfuzz`, ≥ 85 → attach `vendor_id`), reusing the ml-service pattern
- cross-check: `due_date ≥ invoice_date`; `amount > 0` → else a `warnings[]` entry

### 4.7 Respond

```jsonc
{
  "status": "extracted" | "needs_review" | "unsupported",
  "source": "pdf-text" | "ocr-vlm" | "vision-llm" | "tesseract",
  "pages": 2,
  "fields": { "invoice_number": {"value": "TATA/26-27/1042", "confidence": 0.82}, ... },
  "warnings": ["page 3 skipped (OCR_MAX_PAGES=2)", "low confidence: due_date"],
  "filename": "acme-aug.pdf",
  "size_bytes": 214511
}
```

- `pending_review` is renamed **`needs_review`** and now means "OCR ran, but a field is
  missing or below `OCR_MIN_FIELD_CONFIDENCE`" — a real result, not a dead end.
- `fields` keys and the `{value, confidence}` shape are **unchanged** → the frontend keeps working.
- Frontend follow-up (small, P1): treat `needs_review` like today's `pending_review`;
  optionally render `warnings[]` and highlight fields with `confidence < 0.45`.

## 5. Dependencies & Docker

### 5.1 genai-service

`pyproject.toml`:

```
+  "pymupdf>=1.24",      # PDF text + rasterize (also replaces pypdf)
+  "pillow>=10.4",       # raw-image handling, preprocessing
+  "pytesseract>=0.3.13" # CPU fallback only
-  "pypdf>=5.1"
```

The OCR VLM path adds **no** dependency — it goes through the existing `openai` SDK against a
different `base_url`.

`Dockerfile` (genai-service) — for the Tesseract fallback:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
```

≈ +15 MB. If you never want the CPU fallback (GPU always available), skip this line and
`pytesseract` — engine order just ends at Azure vision → `unsupported`.

### 5.2 The OCR model server (`vllm-ocr`) — separate GPU container

`baidu/Unlimited-OCR` runs in its own container, **not** in the genai-service image. It needs
an NVIDIA GPU. Add to `infra/docker-compose.yml` behind an opt-in profile so `docker compose
up` on a GPU-less machine is unaffected:

```yaml
  vllm-ocr:
    image: vllm/vllm-openai:unlimited-ocr          # :unlimited-ocr-cu129 on Hopper (H100/H200)
    profiles: ["gpu-ocr"]
    command: >
      baidu/Unlimited-OCR
      --trust-remote-code
      --logits_processors vllm.model_executor.models.unlimited_ocr:NGramPerReqLogitsProcessor
      --no-enable-prefix-caching
      --mm-processor-cache-gb 0
    ipc: host
    ports: ["8000:8000"]                            # OpenAI API at /v1
    environment:
      HF_TOKEN: ${HF_TOKEN:-}                       # if the model repo is gated
    volumes:
      - hfcache:/root/.cache/huggingface            # don't re-download the weights each start
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\""]
      interval: 15s
      timeout: 5s
      retries: 20                                   # first start pulls + loads weights — slow

  genai-service:
    # ...existing...
    environment:
      OCR_VLM_BASE_URL: http://vllm-ocr:8000/v1
      OCR_VLM_MODEL: baidu/Unlimited-OCR

volumes:
  hfcache:
```

Run with: `docker compose --profile gpu-ocr up -d`. Without the profile, `vllm-ocr` doesn't
start and genai-service falls through to Azure vision → Tesseract.

> **Host requirement:** an NVIDIA GPU + drivers + NVIDIA Container Toolkit. On Windows this
> means Docker Desktop on the WSL2 backend with an NVIDIA card and CUDA-on-WSL. No NVIDIA GPU
> → this container can't run locally; it's a deploy-target concern, and dev falls back to
> Azure vision or Tesseract.

## 6. Config (new env vars)

| Var | Default | Meaning |
|---|---|---|
| `OCR_ENGINE` | `auto` | `auto` \| `vlm` \| `vision` \| `tesseract` \| `text-only` |
| `OCR_VLM_BASE_URL` | *(unset)* | e.g. `http://vllm-ocr:8000/v1` — enables the OCR VLM path |
| `OCR_VLM_MODEL` | `baidu/Unlimited-OCR` | model name passed to the vLLM server |
| `OCR_VLM_API_KEY` | `EMPTY` | vLLM ignores it unless started with `--api-key` |
| `OCR_MAX_PAGES` | `5` | pages rasterised / sent to an engine |
| `OCR_RENDER_DPI` | `300` | PDF→PNG render density |
| `OCR_MIN_FIELD_CONFIDENCE` | `0.45` | any field below → `status: needs_review` |
| `OCR_PREPROCESS` | `basic` | `basic` \| `full` (P1 deskew/threshold) |

`auto`: text layer → TEXT path; else `OCR_VLM_BASE_URL` set → OCR VLM; else `AZURE_OPENAI_*`
set → Azure vision; else `tesseract` on PATH → Tesseract; else `unsupported`.

## 7. Tests (`tests/test_ocr.py` additions)

- **offline engine**: Pillow draws known text ("Invoice Number: ACME/1 … Total 120000") to an
  in-memory PNG → `tesseract_text(png)` contains the strings. `@skip` if `tesseract` not on PATH.
- **classify_input**: text PDF → `"text"`; 1-page image-only PDF → `"image"`; PNG bytes → `"image"`.
- **VLM / vision path**: monkeypatch the `openai` client to return a canned Markdown
  transcription → assert it flows into `extract_invoice_fields` / `regex_fields` and yields the
  expected `fields`. No GPU / network in tests.
- keep all current text-layer / regex / `shape_llm_fields` / `empty_fields` tests.

## 8. Phased plan

| Phase | Scope | Effort |
|---|---|---|
| **P0** | PyMuPDF swap (text + rasterize) · IMAGE path on empty text layer · `recognize()` with the 4-tier order (OCR VLM / Azure vision / Tesseract) · `OCR_VLM_*` config + `openai` client switch · contract `needs_review`/`source`/`pages`/`warnings` · threadpool · Dockerfile Tesseract line · P0 tests | ~½–1 day |
| **infra** | `vllm-ocr` compose service behind the `gpu-ocr` profile · `hfcache` volume · point `genai-service` at `OCR_VLM_BASE_URL`. **Prereq: a GPU host.** | ~½ day + model-load time |
| **P1** | deskew/threshold (`OCR_PREPROCESS=full`) · real per-field confidence from `image_to_data` · vendor fuzzy-match · frontend `needs_review` + low-confidence highlighting | ~1 day |
| **P2** | per-word `bbox` in response + "review & correct" overlay in `/upload` · line-item / table extraction · extra `tesseract-ocr-<lang>` packs | later |

Code (P0) works without a GPU — it just falls through to Azure vision or Tesseract until the
`vllm-ocr` container is stood up.

## 9. Risks / open items

- **GPU requirement for the OCR VLM.** `vllm/vllm-openai:unlimited-ocr` needs an NVIDIA GPU
  (VRAM sized to the model — check the model card; plan for ≥ 24 GB) + NVIDIA Container
  Toolkit. On Windows: Docker Desktop / WSL2 with an NVIDIA card. **No GPU on this dev box →
  run the container on a deploy target and set `OCR_VLM_BASE_URL` to it, or dev on Azure
  vision / Tesseract.** The genai-service code degrades cleanly either way.
- **vLLM cold start.** First boot pulls the image (multi-GB) and loads weights — minutes.
  The `hfcache` volume avoids re-download; the healthcheck has a long retry budget.
- **`--trust-remote-code`.** The container executes Python from the model repo. Acceptable for
  a self-hosted service you control; pin the image tag.
- **Model output shape.** Assumed: image(s) → transcribed text/Markdown, then our extractor.
  If `Unlimited-OCR` reliably emits structured JSON, add a JSON-mode prompt and parse straight
  to `fields` (skip the extractor) — a follow-up, not P0.
- **Cost/latency on multi-page** — bounded by `OCR_MAX_PAGES` and a first-page-only option.
- **Tesseract accuracy on poor scans** — P0 ships basic preprocessing only; `OCR_PREPROCESS=full`
  is the escape hatch. Don't gold-plate preprocessing before seeing real failures.
- **Encrypted / password PDFs** — out of scope; return `unsupported`.
- **Handwriting** — the OCR VLM / Azure vision handle some; Tesseract won't. Not a target.
