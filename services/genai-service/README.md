# genai-service

LLM summaries / explanations **and hybrid RAG** over the invoice data.
Authenticates to Hasura as `genai_readonly` (self-minted JWT, never the admin secret) and
only through the whitelist in `app/whitelist.py` / the tracked `match_invoice_embeddings`
function. `/embed` and `/embed/backfill` instead self-mint a `genai_writer` JWT to read
full invoice context and write `invoice_embeddings`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/summarize` | `{question}` | `{summary, invoice_ids, row_count, query}` — structured (text→GraphQL) only |
| POST | `/query` | `{question}` | `{answer, route, invoice_ids, structured, semantic}` — **hybrid** router |
| POST | `/embed` | Hasura event payload, or `{invoice_id}` | `{status, invoice_id, ...}` — (re)builds the invoice's embedding row |
| POST | `/explain-duplicate` | `{invoice_id}` | `{explanation, confidence_score, method, matched_invoice_id}` |
| POST | `/extract-ocr` | multipart PDF | `{status, source, fields}` — PDF **text layer** only; scans go to `services/ocr-service` |
| GET | `/health` | — | `{status, llm}` |

## Hybrid RAG (`/query`)

Aggregation / filter questions ("total exposure to vendor X", "how many overdue") have
**exact** answers in Postgres — they take the text→GraphQL path, never vector search.
Vector search is only for genuinely semantic questions ("similar to this one", "invoices
that mention a penalty").

- **Router** (`app/rag.classify_question`): keyword heuristics first
  (`total`/`how many`/`overdue` → structured; `similar to`/`mention` → semantic; both →
  `both`). Ambiguous → one LLM classification call, **biased to `structured`** (a wrong
  structured query is easy to catch; a wrong semantic guess presented as fact is not).
  Offline → always `structured`.
- **Structured** path: the existing whitelisted text→GraphQL flow, as `genai_readonly`.
- **Semantic** path: embed the question (CPU, `all-MiniLM-L6-v2`, 384-dim), call
  `match_invoice_embeddings(query, k)` — a tracked Postgres/pgvector function, run as
  `genai_readonly` — for cosine top-k.
- **Synthesis**: one LLM call merges both result sets (structured totals win on conflict).
  Offline → a template.
- Embeddings unavailable (model not loaded) → semantic path is skipped, not a 500.

## Indexing (`/embed`)

Hasura event trigger `invoice_embed` fires on `invoices` INSERT/UPDATE → `POST /embed`
(async, doesn't block the write). It builds **one chunk per invoice** (structured text via
`app/chunking.py` — not fixed-size splitting), embeds it, and upserts `invoice_embeddings`
via `upsert_invoice_embedding()` with the admin secret. Storage is **pgvector on the
existing Postgres** — no separate vector database.

## Offline (no LLM configured)

Keyword router + templates for `/summarize` and `/query`; `/extract-ocr` uses regex. The
embedding model still runs (it's CPU / local), so semantic search works offline too.

## Config

| Var | Default |
|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` |
| `HASURA_GRAPHQL_JWT_SECRET` | (required — to mint the genai_readonly / genai_writer tokens) |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` (must be 384-dim) |
| `EMBEDDING_DIM` | `384` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | any OpenAI-compatible endpoint (Groq, OpenAI, Ollama…); unset → offline |
| `AZURE_OPENAI_ENDPOINT` / `_KEY` / `_DEPLOYMENT` / `_API_VERSION` | alternative to `LLM_*` |

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .          # pulls torch (CPU) + sentence-transformers
python tests/test_query_builder.py && python tests/test_ocr.py \
  && python tests/test_chunking.py && python tests/test_rag_router.py
uvicorn app.main:app --port 8093
curl -s localhost:8093/query -d '{"question":"which invoices are overdue?"}' -H 'content-type: application/json'
```
In the stack: host port **8093**, container 8003. First Docker build downloads the
embedding model (~90 MB) and CPU torch — the image is large.
