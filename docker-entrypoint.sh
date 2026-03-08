#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"

mkdir -p "${DATA_DIR}"

if [ "$(id -u)" -eq 0 ]; then
  chown -R 1001:1001 "${DATA_DIR}" 2>/dev/null || {
    echo "WARN: ${DATA_DIR} cannot be chowned. Make sure it is writable by uid 1001." >&2
  }
  exec su -s /bin/sh nextjs -c "exec node server.js"
fi

exec node server.js
