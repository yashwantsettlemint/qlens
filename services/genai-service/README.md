# genai-service

LLM summaries / explanations over the invoice data. Authenticates to Hasura **only** as
`genai_readonly` (self-minted JWT, never the admin secret) and **only** through the
whitelist in `app/whitelist.py` — no schema introspection, no arbitrary tables.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/summarize` | `{question}` | `{summary, invoice_ids, row_count, query}` |
| POST | `/explain-duplicate` | `{invoice_id}` | `{explanation, confidence_score, method, matched_invoice_id}` — explains the **existing** flag, never re-derives |
| POST | `/extract-ocr` | multipart PDF | stubbed `{fields: {name: {value, confidence}}, status: "pending_review"}` — `TODO` for the real provider |
| GET | `/health` | — | `{status, llm: "offline" | "azure-openai"}` |

**LLM path** (`/summarize`): the model gets one `query_invoices` tool constrained to the
four whitelisted tables; it picks table + `where` + `order_by`, we build + run the query as
`genai_readonly`, then it summarises the rows. `/explain-duplicate` passes the stored
score + matched fields and asks for a plain-language paragraph.

**Offline** (no `AZURE_OPENAI_*`): a keyword router picks the query and a template writes
the summary. Everything works, just less fluent.

## Config

| Var | Default |
|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` |
| `HASURA_GRAPHQL_JWT_SECRET` | (required — to mint the genai_readonly token) |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | unset → offline |
| `AZURE_OPENAI_API_VERSION` | `2024-06-01` |

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .
python tests/test_query_builder.py
uvicorn app.main:app --port 8093
curl -s localhost:8093/summarize -d '{"question":"which invoices are overdue?"}' -H 'content-type: application/json'
```
In the stack: host port **8093**, container 8003.
