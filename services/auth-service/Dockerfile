# Build from the repo root:  docker build -f services/auth-service/Dockerfile .
FROM python:3.11-slim

WORKDIR /svc
COPY packages/shared-types ./packages/shared-types
COPY services/auth-service ./service
RUN pip install --no-cache-dir ./packages/shared-types ./service

EXPOSE 8005
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
