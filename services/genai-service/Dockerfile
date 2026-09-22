# Build from the repo root:  docker build -f services/genai-service/Dockerfile .
FROM python:3.11-slim

WORKDIR /svc
COPY packages/shared-types ./packages/shared-types
COPY services/genai-service ./service

# CPU-only torch first, so sentence-transformers doesn't pull the ~2 GB CUDA build.
RUN pip install --no-cache-dir --default-timeout=180 --retries 5 torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir ./packages/shared-types ./service

# Bake the embedding model into the image (offline-capable, no first-request stall).
# See bake_embedding_model.py: a build environment with no route to huggingface.co
# shouldn't fail the whole image, or hang for ~10 minutes retrying each file.
ENV EMBEDDING_MODEL=all-MiniLM-L6-v2
RUN python service/bake_embedding_model.py

EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
