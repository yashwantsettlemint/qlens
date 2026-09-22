# Build from the repo root:  docker build -f services/ocr-service/Dockerfile .
FROM python:3.11-slim

WORKDIR /svc

# opencv (libgl1, libglib2.0-0) + paddle (libgomp1) runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY packages/shared-types ./packages/shared-types
COPY services/ocr-service ./service

# paddlepaddle (CPU), paddleocr, opencv, pymupdf all come from the service's deps.
RUN pip install --no-cache-dir --default-timeout=180 --retries 5 ./packages/shared-types ./service

# Keep paddle's CPU threads modest (peak RSS / noisy-neighbour) and skip the
# model-hoster connectivity probe.
ENV OMP_NUM_THREADS=2 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

# Warm the PaddleOCR (mobile) model cache into the image. `|| true` so a flaky
# download doesn't fail the build — the first request fetches it instead.
RUN python -c "from app.ocr_engine import _get_engine; _get_engine()" || true

EXPOSE 8006
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8006"]
