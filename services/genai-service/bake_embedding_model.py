"""Build-time only: pre-cache the embedding model into the image, so a
container with real internet access gets offline-capable startup. A build
environment with no route to huggingface.co (checked with a cheap 5s socket
probe, not the model download itself, which retries for ~10 minutes per file
before giving up) skips this instead of paying for that retry storm — the app
already treats a missing model as "skip semantic search", never a crash.
"""

import socket

from app import config

try:
    socket.create_connection(("huggingface.co", 443), timeout=5)
except OSError:
    print("huggingface.co unreachable at build time — skipping model bake, "
          "falls back to no-semantic-search at runtime")
else:
    from sentence_transformers import SentenceTransformer

    SentenceTransformer(config.EMBEDDING_MODEL)
