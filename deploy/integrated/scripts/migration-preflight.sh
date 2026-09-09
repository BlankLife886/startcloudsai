#!/bin/sh
set -eu

ROLE=${ROLE:-${1:-}}
case "$ROLE" in
  source|target) ;;
  *)
    printf '%s\n' 'Usage: ROLE=source|target [COMPOSE_FILE=...] [ENV_FILE=...] sh migration-preflight.sh' >&2
    exit 2
    ;;
esac

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
ENV_FILE=${ENV_FILE:-.env}
OUTPUT_DIR=${OUTPUT_DIR:-.artifacts/production-migration}
POSTGRES_SERVICE=${POSTGRES_SERVICE:-postgres}
SERVER_SERVICE=${SERVER_SERVICE:-server}
C2A_SERVICE=${C2A_SERVICE:-chatgpt2api}

if [ ! -f "$COMPOSE_FILE" ]; then
  printf 'Compose file not found: %s\n' "$COMPOSE_FILE" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  printf 'Environment file not found: %s\n' "$ENV_FILE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
report="$OUTPUT_DIR/${ROLE}-preflight-$timestamp.txt"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

section() {
  printf '\n=== %s ===\n' "$1"
}

container_id() {
  compose ps -q "$1" 2>/dev/null || true
}

mount_summary() {
  id=$1
  [ -n "$id" ] || return 0
  docker inspect --format '{{range .Mounts}}{{println .Type "|" .Name "|" .Source "->" .Destination}}{{end}}' "$id"
}

env_value() {
  id=$1
  key=$2
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$id" 2>/dev/null |
    awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}'
}

env_fingerprint() {
  id=$1
  key=$2
  value=$(env_value "$id" "$key")
  if [ -n "$value" ]; then
    printf '%s' "$value" | sha256sum | awk -v key="$key" '{print key "_SHA256=" $1}'
  else
    printf '%s\n' "${key}_SHA256=not-set"
  fi
}

# Keep the report free of passwords and access keys. File descriptor 3 lets us
# print the completed report to the terminal without duplicating command logic.
exec 3>&1
exec >"$report" 2>&1

section "migration role"
printf 'role=%s\n' "$ROLE"
printf 'captured_at_utc=%s\n' "$timestamp"
printf 'compose_file=%s\n' "$COMPOSE_FILE"
printf 'env_file=%s\n' "$ENV_FILE"

section "host"
uname -a
date -u
df -h /
if command -v free >/dev/null 2>&1; then
  free -h
fi
docker version --format 'docker_server={{.Server.Version}}'
docker compose version

section "compose services"
compose config --services
compose ps -a

postgres_id=$(container_id "$POSTGRES_SERVICE")
if [ -z "$postgres_id" ]; then
  printf 'ERROR: PostgreSQL service %s is not running.\n' "$POSTGRES_SERVICE"
  exit 1
fi

section "postgres container and mounts"
docker inspect --format 'name={{.Name}} image={{.Config.Image}} status={{.State.Status}} started={{.State.StartedAt}}' "$postgres_id"
mount_summary "$postgres_id"

section "startcloud database"
compose exec -T "$POSTGRES_SERVICE" sh -euc '
  db_user=${STARCLOUD_DB_USER:-${POSTGRES_USER:-starclouds}}
  db_name=${STARCLOUD_DB_NAME:-${POSTGRES_DB:-starclouds}}
  printf "database=%s user=%s\n" "$db_name" "$db_user"
  psql --username "$db_user" --dbname "$db_name" --no-psqlrc --set ON_ERROR_STOP=1 <<'"'"'SQL'"'"'
SELECT current_setting('"'"'server_version'"'"') AS postgres_version;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT '"'"'SELECT max(version_id) AS goose_version FROM goose_db_version WHERE is_applied'"'"'
WHERE to_regclass('"'"'public.goose_db_version'"'"') IS NOT NULL \gexec
SELECT format('"'"'SELECT %L AS table_name, count(*) AS row_count FROM %I'"'"', table_name, table_name)
FROM (VALUES
  ('"'"'users'"'"'), ('"'"'wallets'"'"'), ('"'"'wallet_ledger'"'"'), ('"'"'tasks'"'"'),
  ('"'"'assistant_conversations'"'"'), ('"'"'assistant_messages'"'"'), ('"'"'assistant_runs'"'"'),
  ('"'"'canvas_projects'"'"'), ('"'"'user_assets'"'"'), ('"'"'user_upload_objects'"'"'),
  ('"'"'usage_profit_ledger'"'"'), ('"'"'admin_accounts'"'"'), ('"'"'app_settings'"'"')
) AS wanted(table_name)
WHERE to_regclass('"'"'public.'"'"' || table_name) IS NOT NULL
ORDER BY table_name \gexec
SELECT '"'"'SELECT status, count(*) FROM tasks GROUP BY status ORDER BY status'"'"'
WHERE to_regclass('"'"'public.tasks'"'"') IS NOT NULL \gexec
SELECT '"'"'SELECT status, count(*) FROM assistant_runs GROUP BY status ORDER BY status'"'"'
WHERE to_regclass('"'"'public.assistant_runs'"'"') IS NOT NULL \gexec
SELECT '"'"'SELECT count(*) AS pending_object_cleanup_jobs FROM object_cleanup_jobs'"'"'
WHERE to_regclass('"'"'public.object_cleanup_jobs'"'"') IS NOT NULL \gexec
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC, relname
LIMIT 30;
SQL
  pg_dump --username "$db_user" --dbname "$db_name" --schema-only --no-owner --no-privileges |
    sed -E '"'"'s/^\\(un)?restrict .*/\\\1restrict TOKEN/'"'"' |
    sha256sum | awk '"'"'{print "schema_sha256=" $1}'"'"'
'

server_id=$(container_id "$SERVER_SERVICE")
section "startcloud server configuration fingerprints"
if [ -n "$server_id" ]; then
  docker inspect --format 'name={{.Name}} image={{.Config.Image}} status={{.State.Status}} started={{.State.StartedAt}}' "$server_id"
  env_fingerprint "$server_id" APP_SECRET
  env_fingerprint "$server_id" C2A_API_KEY
  for key in OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_PUBLIC_ENDPOINT OBJECT_STORAGE_REGION OBJECT_STORAGE_BUCKET OBJECT_STORAGE_USE_PATH_STYLE; do
    value=$(env_value "$server_id" "$key")
    printf '%s=%s\n' "$key" "${value:-not-set}"
  done
else
  printf 'WARNING: StartCloud server service %s is not running.\n' "$SERVER_SERVICE"
fi

c2a_id=$(container_id "$C2A_SERVICE")
if [ -z "$c2a_id" ]; then
  c2a_id=${C2A_CONTAINER_ID:-$(docker ps --filter name=chatgpt2api --format '{{.ID}}' | head -n 1)}
fi

section "chatgpt2api container and data"
if [ -n "$c2a_id" ]; then
  docker inspect --format 'name={{.Name}} image={{.Config.Image}} status={{.State.Status}} started={{.State.StartedAt}}' "$c2a_id"
  mount_summary "$c2a_id"
  database_url=$(env_value "$c2a_id" DATABASE_URL)
  case "$database_url" in
    postgres://*|postgresql://*) printf '%s\n' 'database_mode=postgresql' ;;
    sqlite:*|*.db) printf '%s\n' 'database_mode=sqlite' ;;
    '') printf '%s\n' 'database_mode=sqlite-or-application-default' ;;
    *) printf '%s\n' 'database_mode=unknown' ;;
  esac
  env_fingerprint "$c2a_id" CHATGPT2API_AUTH_KEY
  docker exec "$c2a_id" sh -euc '
    if [ -d /app/data ]; then
      du -sh /app/data
      printf "data_files="
      find /app/data -type f | wc -l
    else
      printf "%s\n" "WARNING: /app/data does not exist"
    fi
    if [ -f /app/data/chatgpt2api.db ]; then
      ls -ln /app/data/chatgpt2api.db
      sha256sum /app/data/chatgpt2api.db
    fi
  '
  if docker exec "$c2a_id" test -f /app/data/chatgpt2api.db; then
    docker exec -i "$c2a_id" python - <<'PY'
import sqlite3

connection = sqlite3.connect("file:/app/data/chatgpt2api.db?mode=ro", uri=True)
try:
    print("sqlite_quick_check=" + str(connection.execute("PRAGMA quick_check").fetchone()[0]))
    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    for (name,) in tables:
        escaped = name.replace('"', '""')
        count = connection.execute(f'SELECT count(*) FROM "{escaped}"').fetchone()[0]
        print(f"sqlite_table={name} rows={count}")
finally:
    connection.close()
PY
  fi

  if printf '%s' "$database_url" | grep -Eq '^postgres(ql)?://'; then
    section "chatgpt2api postgresql database"
    compose exec -T "$POSTGRES_SERVICE" sh -euc '
      if [ -z "${CHATGPT2API_DB_NAME:-}" ] || [ -z "${CHATGPT2API_DB_USER:-}" ]; then
        printf "%s\n" "WARNING: ChatGPT2API PostgreSQL is external to this Compose; inspect it separately."
        exit 0
      fi
      psql --username "$CHATGPT2API_DB_USER" --dbname "$CHATGPT2API_DB_NAME" \
        --no-psqlrc --set ON_ERROR_STOP=1 <<'"'"'SQL'"'"'
SELECT current_setting('"'"'server_version'"'"') AS postgres_version;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC, relname
LIMIT 50;
SQL
      pg_dump --username "$CHATGPT2API_DB_USER" --dbname "$CHATGPT2API_DB_NAME" \
        --schema-only --no-owner --no-privileges |
        sed -E '"'"'s/^\\(un)?restrict .*/\\\1restrict TOKEN/'"'"' |
        sha256sum | awk '"'"'{print "chatgpt2api_schema_sha256=" $1}'"'"'
    '
  fi
else
  if [ "$ROLE" = "source" ]; then
    printf '%s\n' 'not_present_on_legacy_source=true'
    printf '%s\n' 'No ChatGPT2API data will be exported from the old server.'
  else
    printf '%s\n' 'ERROR: the target ChatGPT2API container was not found.'
    exit 1
  fi
fi

section "migration cautions"
printf '%s\n' 'This report is read-only and contains no secret values.'
printf '%s\n' 'Do not migrate Redis queue data between servers.'
printf '%s\n' 'Do not start the final export until running tasks and assistant runs are zero.'
printf '%s\n' 'Keep the target ChatGPT2API PostgreSQL database and /app/data volume; the legacy source has no ChatGPT2API.'
printf '%s\n' 'Do not delete the old database or production OSS bucket after cutover.'

exec 1>&3 2>&3
cat "$report"
printf '\nSaved report: %s\n' "$report"
