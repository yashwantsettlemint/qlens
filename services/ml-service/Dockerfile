# Build from the repo root:  docker build -f services/ml-service/Dockerfile .
FROM python:3.11-slim

WORKDIR /svc
COPY packages/shared-types ./packages/shared-types
COPY services/ml-service ./service
RUN pip install --no-cache-dir ./packages/shared-types ./service

# Train both models at build time so /score uses XGBoost, not the heuristic /
# rule gates, out of the box. Retrain on real data later:
#   python -m ml.train --from-hasura              (paid invoices -> delay)
#   python -m ml.train_duplicates --from-hasura   (reviewed flags -> duplicates)
WORKDIR /svc/service
RUN python -m ml.generate_synthetic_training_data --rows 3000 && python -m ml.train \
 && python -m ml.generate_synthetic_duplicate_pairs --rows 6000 && python -m ml.train_duplicates

EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
