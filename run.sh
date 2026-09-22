#!/usr/bin/env bash
# Bring up the whole app: backend stack (Postgres + Hasura + all services) via
# docker compose, then the Next.js frontend wired to that backend.
#
# NOTE: this does NOT rebuild Docker images. After `git pull`, if any Dockerfile
# or service code changed, run ./setup.sh first (it runs `docker compose build`).
set -euo pipefail
cd "$(dirname "$0")"

[ -f infra/.env ] || cp infra/.env.example infra/.env

echo "==> If you just pulled changes, run ./setup.sh first to rebuild images."
echo "==> Starting backend (first run builds images; ml-service trains a model, ~3 min)"
docker compose -f infra/docker-compose.yml up -d --wait

if [ ! -f apps/web/.env.local ]; then
  cp apps/web/.env.example apps/web/.env.local
  # point the frontend at the real backend instead of the in-browser mock
  sed -i.bak 's/^NEXT_PUBLIC_BACKEND=.*/NEXT_PUBLIC_BACKEND=hasura/' apps/web/.env.local
  grep -q '^NEXT_PUBLIC_BACKEND=' apps/web/.env.local || echo 'NEXT_PUBLIC_BACKEND=hasura' >> apps/web/.env.local
  rm -f apps/web/.env.local.bak
fi

cd apps/web
[ -d node_modules ] || npm install
npm run codegen

echo "==> Backend: Hasura http://localhost:8088 | Frontend: http://localhost:3000"
exec npm run dev
