#!/bin/sh
# Runs only on first container init (empty data dir), same as POSTGRES_DB.
# genai-service gets its own database (invoice_embeddings) — private, never a
# Hasura source, mirroring auth-service's isolation (not ocr-service's, which
# is a separate DB reached *through* Hasura). See services/genai-service/app/db.py.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
	CREATE DATABASE genai_db;
SQL
