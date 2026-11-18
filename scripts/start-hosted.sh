#!/usr/bin/env bash
set -eu

: "${APP_PASSWORD:?Set APP_PASSWORD in the service variables.}"

if [[ -z ${PUBLIC_ORIGIN:-} && -n ${RAILWAY_PUBLIC_DOMAIN:-} ]]; then
    export PUBLIC_ORIGIN="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

(
    cd backend
    exec /opt/venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
) &
backend_pid=$!

(
    cd frontend
    exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-8080}"
) &
frontend_pid=$!

cleanup() {
    kill -TERM "$backend_pid" "$frontend_pid" 2>/dev/null || true
    wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 0' INT TERM

wait -n "$backend_pid" "$frontend_pid"
exit 1
