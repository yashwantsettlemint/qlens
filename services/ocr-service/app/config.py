import os

HASURA_ENDPOINT = (
    os.getenv("HASURA_ENDPOINT")
    or os.getenv("HASURA_GRAPHQL_ENDPOINT")
    or "http://localhost:8088/v1/graphql"
)
HASURA_ADMIN_SECRET = (
    os.getenv("HASURA_ADMIN_SECRET")
    or os.getenv("HASURA_GRAPHQL_ADMIN_SECRET")
    or "devsecret"
)

# --- LLM field extraction (optional; regex fallback when unset) ---
# LLM — any OpenAI-compatible endpoint (Groq, OpenAI, Ollama, …) or Azure OpenAI.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "").strip()   # e.g. https://api.groq.com/openai/v1
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b").strip()

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY", "").strip()
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01").strip()

OFFLINE = not (
    (LLM_BASE_URL and LLM_API_KEY)
    or (AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY and AZURE_OPENAI_DEPLOYMENT)
)
MODEL = LLM_MODEL if LLM_BASE_URL else AZURE_OPENAI_DEPLOYMENT

# --- page-level source detection ---
MIN_TEXT_CHARS = int(os.getenv("OCR_MIN_TEXT_CHARS", "50"))

# --- PaddleOCR models. Mobile by default: ~10x smaller and ~1.2 GB peak RSS vs
#     the medium/server models which OOM a small container. Bump for hard scans. ---
OCR_DET_MODEL = os.getenv("OCR_DET_MODEL", "PP-OCRv5_mobile_det").strip()
OCR_REC_MODEL = os.getenv("OCR_REC_MODEL", "PP-OCRv5_mobile_rec").strip()

# --- preprocessing (calibration knobs — a self-hosted engine needs tuning a
#     minimal model can't predict; adjust per your scan quality) ---
OCR_RENDER_DPI = int(os.getenv("OCR_RENDER_DPI", "200"))
OCR_UPSCALE = float(os.getenv("OCR_UPSCALE", "1.0"))
OCR_MAX_DESKEW_DEG = float(os.getenv("OCR_MAX_DESKEW_DEG", "15"))

# --- validation thresholds ---
CONF_FINANCIAL = float(os.getenv("OCR_CONF_FINANCIAL", "0.92"))
CONF_OTHER = float(os.getenv("OCR_CONF_OTHER", "0.80"))
ARITHMETIC_TOLERANCE = float(os.getenv("OCR_ARITHMETIC_TOLERANCE", "0.01"))

MAX_PAGES = int(os.getenv("OCR_MAX_PAGES", "10"))
