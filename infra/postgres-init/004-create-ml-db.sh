#!/bin/sh
# Runs only on first container init (empty data dir), same as POSTGRES_DB.
# ml-service gets its own database for ml_drift_reports/ml_retrain_events —
# private, never a Hasura source. duplicate_flags/delay_predictions stay on
# Hasura (joined into the invoice list) — see services/ml-service/app/db.py.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
	CREATE DATABASE ml_db;
SQL
