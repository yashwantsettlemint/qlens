#!/bin/sh
# Runs only on first container init (empty data dir), same as POSTGRES_DB.
# ocr-service gets its own database (review_queue) — see hasura/metadata/databases/databases.yaml.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
	CREATE DATABASE ocr_db;
SQL
