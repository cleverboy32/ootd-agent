#!/usr/bin/env bash
# Ensure local Postgres port is forwarded via SSH Host server_db (LocalForward).
set -euo pipefail

HOST="${DB_SSH_HOST:-server_db}"
LOCAL_PORT="${DB_TUNNEL_PORT:-5432}"

port_open() {
  nc -z 127.0.0.1 "$LOCAL_PORT" >/dev/null 2>&1
}

if port_open; then
  echo "[db:tunnel] 127.0.0.1:${LOCAL_PORT} already open"
  exit 0
fi

echo "[db:tunnel] starting ssh -f -N ${HOST}"
if ! ssh -f -N -o ExitOnForwardFailure=yes "$HOST"; then
  echo "[db:tunnel] ssh failed — check: ssh ${HOST}" >&2
  exit 1
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if port_open; then
    echo "[db:tunnel] ready on 127.0.0.1:${LOCAL_PORT}"
    exit 0
  fi
  sleep 0.3
done

echo "[db:tunnel] port ${LOCAL_PORT} did not open after ssh" >&2
exit 1
