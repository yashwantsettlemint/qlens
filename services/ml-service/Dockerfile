# Build from the repo root:  docker build -f services/ml-service/Dockerfile .
FROM python:3.11-slim

WORKDIR /svc
COPY packages/shared-types ./packages/shared-types
COPY services/ml-service ./service
RUN pip install --no-cache-dir ./packages/shared-types ./service

# Train a model at build time so /score uses XGBoost, not the heuristic, out of the box.
WORKDIR /svc/service
RUN python -m ml.generate_synthetic_training_data --rows 3000 && python -m ml.train

EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
