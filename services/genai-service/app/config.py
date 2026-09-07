import os

HASURA_ENDPOINT = (
    os.getenv("HASURA_ENDPOINT")
    or os.getenv("HASURA_GRAPHQL_ENDPOINT")
    or "http://localhost:8088/v1/graphql"
)
# genai-service authenticates as genai_readonly ONLY — never the admin secret.
GENAI_ROLE = "genai_readonly"
GENAI_USER_ID = "genai-service"

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY", "").strip()
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01").strip()

# No key -> deterministic non-LLM answers so the stack is demoable without creds.
OFFLINE = not (AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY and AZURE_OPENAI_DEPLOYMENT)
