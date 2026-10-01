#!/usr/bin/env bash
# Starts the three backend services. Secrets (JWT_SECRET, MONGODB_URI, ...) come
# from the Space's settings; the internal wiring is fixed here.
set -euo pipefail

export STORAGE_API_URL=http://127.0.0.1:3001/
export SEARCH_API_URL=http://127.0.0.1:8000

(cd apkh-storage && PORT=3001 exec node server.js) &
(cd apkh-search && exec /opt/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000) &
(cd apkh-api && PORT=7860 exec node dist/main) &

# Exit as soon as any service dies so the Space restarts the whole container
wait -n
exit 1
