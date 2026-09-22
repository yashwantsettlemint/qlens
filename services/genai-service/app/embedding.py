"""all-MiniLM-L6-v2 sentence embeddings, CPU only.

The model is loaded lazily so that importing this module (tests, the query
router, other endpoints) never pulls in torch or triggers a model download.
`EmbeddingUnavailable` is raised when the model can't be loaded — callers treat
that as "skip the semantic path", never a 500.
"""

from __future__ import annotations

import threading

from . import config


class EmbeddingUnavailable(RuntimeError):
    pass


_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ModuleNotFoundError as exc:  # dep not installed (e.g. slim test env)
                raise EmbeddingUnavailable("sentence-transformers is not installed") from exc
            try:
                _model = SentenceTransformer(config.EMBEDDING_MODEL)
            except Exception as exc:  # not downloaded / offline / corrupt cache
                raise EmbeddingUnavailable(
                    f"could not load embedding model {config.EMBEDDING_MODEL!r}: {exc}"
                ) from exc
    return _model


def embed(text: str) -> list[float]:
    vec = _get_model().encode(text or "", normalize_embeddings=True)
    out = [float(x) for x in vec]
    if len(out) != config.EMBEDDING_DIM:
        raise EmbeddingUnavailable(
            f"model returned dim {len(out)}, expected {config.EMBEDDING_DIM} "
            f"(migration uses vector({config.EMBEDDING_DIM}))"
        )
    return out


def vector_literal(vec: list[float]) -> str:
    """pgvector text literal: '[0.1,0.2,...]'. The Hasura functions take text and
    cast internally, so the wire never carries a `vector` type."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"
