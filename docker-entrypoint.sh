#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
SETTINGS_DB_PATH="${MONITOR_SETTINGS_DB_PATH:-${DATA_DIR}/provider-settings.sqlite}"
SQLITE_SEED_PATH="${MONITOR_SQLITE_SEED_PATH:-}"
SQLITE_IMPORT_MODE="${MONITOR_SQLITE_IMPORT_MODE:-if-missing}"

import_sqlite_seed() {
  if [ -z "${SQLITE_SEED_PATH}" ] || [ ! -f "${SQLITE_SEED_PATH}" ]; then
    return
  fi

  case "${SQLITE_IMPORT_MODE}" in
    skip)
      return
      ;;
    if-missing)
      if [ -f "${SETTINGS_DB_PATH}" ]; then
        return
      fi
      ;;
    overwrite)
      ;;
    *)
      echo "WARN: unsupported MONITOR_SQLITE_IMPORT_MODE=${SQLITE_IMPORT_MODE}, fallback to if-missing" >&2
      if [ -f "${SETTINGS_DB_PATH}" ]; then
        return
      fi
      ;;
  esac

  target_dir="$(dirname "${SETTINGS_DB_PATH}")"
  mkdir -p "${target_dir}"
  cp "${SQLITE_SEED_PATH}" "${SETTINGS_DB_PATH}"

  if [ -f "${SQLITE_SEED_PATH}-wal" ]; then
    cp "${SQLITE_SEED_PATH}-wal" "${SETTINGS_DB_PATH}-wal"
  fi

  if [ -f "${SQLITE_SEED_PATH}-shm" ]; then
    cp "${SQLITE_SEED_PATH}-shm" "${SETTINGS_DB_PATH}-shm"
  fi

  echo "Imported SQLite seed into ${SETTINGS_DB_PATH}"
}

mkdir -p "${DATA_DIR}"
mkdir -p "$(dirname "${SETTINGS_DB_PATH}")"
import_sqlite_seed

if [ "$(id -u)" -eq 0 ]; then
  chown -R 1001:1001 "${DATA_DIR}" 2>/dev/null || {
    echo "WARN: ${DATA_DIR} cannot be chowned. Make sure it is writable by uid 1001." >&2
  }
  exec su -s /bin/sh nextjs -c "exec node server.js"
fi

exec node server.js
