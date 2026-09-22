#!/usr/bin/env bash
# One-command first-time setup on a fresh machine. Checks prerequisites, creates
# the env files, builds the backend images and installs frontend deps.
# When it finishes, run ./run.sh to start everything.
set -euo pipefail
cd "$(dirname "$0")"

for cmd in docker node npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $cmd. Install it and re-run."; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 not available (need 'docker compose')."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon not running. Start Docker Desktop and re-run."; exit 1; }

[ -f infra/.env ] || { cp infra/.env.example infra/.env; echo "created infra/.env"; }
if [ ! -f apps/web/.env.local ]; then
  cp apps/web/.env.example apps/web/.env.local
  sed -i.bak 's/^NEXT_PUBLIC_BACKEND=.*/NEXT_PUBLIC_BACKEND=hasura/' apps/web/.env.local
  grep -q '^NEXT_PUBLIC_BACKEND=' apps/web/.env.local || echo 'NEXT_PUBLIC_BACKEND=hasura' >> apps/web/.env.local
  rm -f apps/web/.env.local.bak
  echo "created apps/web/.env.local"
fi

echo "==> Building backend images (ml-service trains a model at build time, ~3 min)"
docker compose -f infra/docker-compose.yml build

echo "==> Installing frontend dependencies"
cd apps/web
npm install
npm run codegen

echo
echo "Setup complete. Start the app with:  ./run.sh"
