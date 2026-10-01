#!/bin/sh
set -eu

if [ "${ALLOW_CHATGPT2API_SQLITE_MIGRATION:-}" != "yes" ]; then
  printf '%s\n' 'Set ALLOW_CHATGPT2API_SQLITE_MIGRATION=yes after confirming the PostgreSQL target is empty.' >&2
  exit 1
fi
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  printf 'Usage: ALLOW_CHATGPT2API_SQLITE_MIGRATION=yes %s <chatgpt2api.db>\n' "$0" >&2
  exit 1
fi

source_db=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
integrated_dir=$(dirname "$script_dir")
compose_file="$integrated_dir/docker-compose.yml"
env_file=${INTEGRATED_ENV_FILE:-"$integrated_dir/.env.integrated"}

docker compose --env-file "$env_file" -f "$compose_file" up -d postgres
docker compose --env-file "$env_file" -f "$compose_file" run --rm --no-deps \
  -v "$source_db:/migration/source.db:ro" \
  chatgpt2api \
  uv run python -m scripts.migrate_sqlite_to_postgres \
  --source-sqlite /migration/source.db \
  --confirm-empty-target
