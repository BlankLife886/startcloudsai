#!/bin/sh
set -eu

if [ "${ALLOW_DESTRUCTIVE_PG18_RESTORE:-}" != "yes" ]; then
  printf '%s\n' 'Refusing to replace the integrated StartCloud database.' >&2
  printf '%s\n' 'Set ALLOW_DESTRUCTIVE_PG18_RESTORE=yes after verifying the dump and backup.' >&2
  exit 1
fi
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  printf 'Usage: ALLOW_DESTRUCTIVE_PG18_RESTORE=yes %s <pg17.dump>\n' "$0" >&2
  exit 1
fi

dump_path=$1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
integrated_dir=$(dirname "$script_dir")
compose_file="$integrated_dir/docker-compose.yml"
env_file=${INTEGRATED_ENV_FILE:-"$integrated_dir/.env.integrated"}

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

compose stop worker server >/dev/null 2>&1 || true
compose up -d postgres
compose exec -T postgres sh -euc '
  psql --username "$POSTGRES_USER" --dbname postgres \
    --set=database_name="$STARCLOUD_DB_NAME" \
    --set=database_user="$STARCLOUD_DB_USER" <<-'"'"'SQL'"'"'
	SELECT pg_terminate_backend(pid) FROM pg_stat_activity
	WHERE datname = :'"'"'database_name'"'"' AND pid <> pg_backend_pid();
	SELECT format('"'"'DROP DATABASE IF EXISTS %I'"'"', :'"'"'database_name'"'"') \gexec
	SELECT format('"'"'CREATE DATABASE %I OWNER %I'"'"', :'"'"'database_name'"'"', :'"'"'database_user'"'"') \gexec
SQL
'

compose exec -T postgres sh -euc '
  PGPASSWORD="$STARCLOUD_DB_PASSWORD" pg_restore \
    --username "$STARCLOUD_DB_USER" \
    --dbname "$STARCLOUD_DB_NAME" \
    --no-owner --no-privileges --exit-on-error
' <"$dump_path"

compose up -d server
compose up -d worker
compose ps
