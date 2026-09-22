import os

HASURA_ENDPOINT = (
    os.getenv("HASURA_ENDPOINT")
    or os.getenv("HASURA_GRAPHQL_ENDPOINT")
    or "http://localhost:8088/v1/graphql"
)

# /explain-duplicate's only call to another Python service (not Hasura) —
# duplicate_flags now lives privately in ml-service's own ml_db, see
# services/ml-service/app/db.py.
ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8092")
INTERNAL_SERVICE_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")
# genai-service authenticates as genai_readonly for reads and genai_writer
# for /embed + /embed/backfill (see hasura/metadata's genai_writer role) —
# both self-minted JWTs, never the admin secret.
GENAI_ROLE = "genai_readonly"
GENAI_WRITER_ROLE = "genai_writer"
GENAI_USER_ID = "genai-service"

# RAG: CPU sentence-transformers model for invoice embeddings.
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2").strip()
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))  # must match vector(N) in the migration

# LLM — any OpenAI-compatible endpoint (Groq free tier, OpenAI, Ollama, LM Studio, together.ai…).
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "").strip()   # e.g. https://api.groq.com/openai/v1
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b").strip()

# Azure OpenAI still works if its vars are set and LLM_* are not.
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY", "").strip()
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01").strip()

# No LLM configured -> deterministic keyword/regex answers so the stack is demoable.
OFFLINE = not (
    (LLM_BASE_URL and LLM_API_KEY)
    or (AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY and AZURE_OPENAI_DEPLOYMENT)
)
# Model name passed to chat.completions.
MODEL = LLM_MODEL if LLM_BASE_URL else AZURE_OPENAI_DEPLOYMENT
