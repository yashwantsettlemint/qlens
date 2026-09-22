"""Private Postgres connection for invoice_embeddings — genai-service's own
`genai_db` database, never Hasura. Mirrors services/auth-service/app/db.py's
isolation pattern (a restricted LOGIN role, direct psycopg, no admin secret),
but async: genai-service's FastAPI routes are all `async def`, so a blocking
psycopg.connect() here would stall the event loop for every other
concurrent request.

Falls back to PG_DATABASE_URL if GENAI_PG_DATABASE_URL isn't set, for any
deployment that hasn't picked up the migration yet.
"""

from __future__ import annotations

import os

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv("GENAI_PG_DATABASE_URL") or os.getenv("PG_DATABASE_URL", "")


class EmbeddingStoreError(RuntimeError):
    pass


async def get_conn() -> psycopg.AsyncConnection:
    if not DATABASE_URL:
        raise RuntimeError("GENAI_PG_DATABASE_URL (or PG_DATABASE_URL) is not set")
    return await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


async def match_embeddings(vec_literal: str, company_id: str, k: int = 5) -> list[dict]:
    try:
        async with await get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT invoice_id, chunk_text, similarity, chunk_index "
                    "FROM match_invoice_embeddings(%s, %s, %s)",
                    (vec_literal, k, company_id),
                )
                return await cur.fetchall()
    except psycopg.Error as exc:
        raise EmbeddingStoreError(str(exc)) from exc


async def replace_embeddings(invoice_id: str, chunks: list[tuple[str, str]], company_id: str) -> None:
    """Replaces every embedding row for this invoice with `chunks`
    (chunk_text, vec_literal pairs, in order) — always a clean delete + fresh
    insert rather than incremental upsert, so a re-embed that produces fewer
    chunks than last time doesn't leave stale rows behind."""
    try:
        async with await get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM invoice_embeddings WHERE invoice_id = %s", (invoice_id,))
                for i, (chunk_text, vec_literal) in enumerate(chunks):
                    await cur.execute(
                        "SELECT upsert_invoice_embedding(%s, %s, %s, %s, %s)",
                        (invoice_id, i, chunk_text, vec_literal, company_id),
                    )
    except psycopg.Error as exc:
        raise EmbeddingStoreError(str(exc)) from exc
