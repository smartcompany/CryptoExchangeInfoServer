#!/usr/bin/env bash
# Register / restart the Exora push poller under PM2.
# - Not running → start
# - Already running → reload (restart) with updated env from .env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NAME="exora-push-poller"
CONFIG="$ROOT/ecosystem.push-poller.config.cjs"

cd "$ROOT"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found. Install: npm install -g pm2" >&2
  exit 1
fi

if [[ ! -f "$ROOT/standalone-server.js" ]]; then
  echo "standalone-server.js missing in $ROOT" >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "warning: $ROOT/.env not found — poller may skip FCM / Supabase" >&2
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "node_modules missing — running npm install …"
  npm install --no-fund --no-audit
fi

echo "PM2 startOrReload → $NAME"
pm2 startOrReload "$CONFIG" --update-env --only "$NAME"
pm2 save

echo
pm2 describe "$NAME" | head -n 40
echo
echo "Health (local): curl -sS http://127.0.0.1:\${PORT:-3010}/health"
echo "Logs:           pm2 logs $NAME"
