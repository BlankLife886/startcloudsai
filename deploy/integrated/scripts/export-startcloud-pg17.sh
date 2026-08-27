#!/bin/sh
set -eu

SOURCE_COMPOSE_FILE=${SOURCE_COMPOSE_FILE:-docker-compose.yml}
SOURCE_ENV_FILE=${SOURCE_ENV_FILE:-.env}
SOURCE_DB_USER=${SOURCE_DB_USER:-starclouds}
SOURCE_DB_NAME=${SOURCE_DB_NAME:-starclouds}
BACKUP_DIR=${BACKUP_DIR:-.artifacts/database-migration}

mkdir -p "$BACKUP_DIR"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
dump_path="$BACKUP_DIR/startcloud-pg17-$timestamp.dump"
checksum_path="$dump_path.sha256"

docker compose --env-file "$SOURCE_ENV_FILE" -f "$SOURCE_COMPOSE_FILE" \
  exec -T postgres pg_dump \
  --username "$SOURCE_DB_USER" \
  --dbname "$SOURCE_DB_NAME" \
  --format custom \
  --no-owner \
  --no-privileges >"$dump_path"

test -s "$dump_path"
sha256sum "$dump_path" >"$checksum_path"
printf 'Created %s\n' "$dump_path"
printf 'Created %s\n' "$checksum_path"
