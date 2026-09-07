# Build from the repo root:  docker build -f services/ingestion-service/Dockerfile .
FROM python:3.11-slim

WORKDIR /svc
COPY packages/shared-types ./packages/shared-types
COPY services/ingestion-service ./service
RUN pip install --no-cache-dir ./packages/shared-types ./service

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
