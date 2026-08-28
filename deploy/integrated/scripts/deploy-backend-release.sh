#!/usr/bin/env bash

set -Eeuo pipefail

release_id="${1:-}"
deploy_root="${DEPLOY_ROOT:-/www/wwwroot}"
backup_root="${BACKUP_ROOT:-/www/backup/startcloudsai}"
production_link="$deploy_root/startcloudsai"

if [[ ! "$release_id" =~ ^[0-9a-f]{12}$ ]]; then
  echo "Usage: $0 <12-character-release-id>" >&2
  exit 2
fi

archive_name="startcloudsai-$release_id.tar.gz"
archive="$deploy_root/$archive_name"
checksum="$archive.sha256"
release_root="$deploy_root/releases/$release_id"
release_dir="$release_root/startcloudsai"
candidate_compose="$release_dir/deploy/integrated/docker-compose.candidate.yml"
production_compose="$release_dir/deploy/integrated/docker-compose.yml"

for command in docker curl gzip tar sha256sum install readlink; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

if [[ ! -e "$production_link" ]]; then
  echo "Production directory does not exist: $production_link" >&2
  exit 1
fi
production_dir="$(readlink -f "$production_link")"
production_env="$production_dir/deploy/integrated/.env.integrated"
if [[ ! -f "$production_env" ]]; then
  echo "Production environment file does not exist: $production_env" >&2
  exit 1
fi
if [[ ! -f "$archive" || ! -f "$checksum" ]]; then
  echo "Upload $archive_name and $archive_name.sha256 to $deploy_root first." >&2
  exit 1
fi

production_dc() {
  docker compose --env-file "$production_env" -f "$production_dir/deploy/integrated/docker-compose.yml" "$@"
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-36}"
  local delay="${3:-5}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep "$delay"
  done
  echo "Health check failed: $url" >&2
  return 1
}

env_value() {
  local name="$1"
  awk -F= -v key="$name" '$1 == key {sub(/^[^=]*=/, ""); value=$0} END {sub(/\r$/, "", value); print value}' "$production_env"
}

cdn_base="$(env_value OBJECT_STORAGE_CDN_BASE_URL)"
cdn_key="$(env_value OBJECT_STORAGE_CDN_AUTH_KEY)"
cdn_ttl="$(env_value OBJECT_STORAGE_CDN_AUTH_TTL_SECS)"
if [[ "$cdn_base" != "https://img.starcloudisai.com" || -z "$cdn_key" || "$cdn_ttl" != "900" ]]; then
  echo "Production CDN settings are incomplete." >&2
  echo "Expected CDN base https://img.starcloudisai.com, a non-empty auth key, and TTL 900." >&2
  exit 1
fi

echo "[1/7] Verify release archive"
(
  cd "$deploy_root"
  sha256sum -c "$(basename "$checksum")"
)

if [[ -e "$release_root" ]]; then
  echo "Release directory already exists: $release_root" >&2
  echo "Remove only this incomplete release directory after confirming it is unused, then retry." >&2
  exit 1
fi
mkdir -p "$release_root"
tar -xzf "$archive" -C "$release_root"
if [[ ! -f "$candidate_compose" || ! -f "$production_compose" ]]; then
  echo "Release archive is missing integrated deployment files." >&2
  exit 1
fi

release_env="$release_dir/deploy/integrated/.env.integrated"
install -m 600 "$production_env" "$release_env"
export INTEGRATED_APP_ENV_FILE="$release_env"
export RELEASE_ID="$release_id"

candidate_dc() {
  docker compose --env-file "$release_env" -f "$candidate_compose" "$@"
}
release_dc() {
  docker compose --env-file "$release_env" -f "$production_compose" "$@"
}

echo "[2/7] Validate Compose configuration"
candidate_dc config --quiet
release_dc config --quiet

mkdir -p "$backup_root"
backup="$backup_root/predeploy-$release_id.sql.gz"
state="$backup_root/predeploy-$release_id.state"

echo "[3/7] Back up PostgreSQL"
production_dc exec -T postgres sh -lc \
  'pg_dump --clean --if-exists -U "$STARCLOUD_DB_USER" "$STARCLOUD_DB_NAME"' | gzip > "$backup"
test -s "$backup"
gzip -t "$backup"

old_server_container="$(production_dc ps -q server)"
old_worker_container="$(production_dc ps -q worker)"
if [[ -z "$old_server_container" || -z "$old_worker_container" ]]; then
  echo "Production server or worker container is missing." >&2
  exit 1
fi
old_server_image="$(docker inspect -f '{{.Image}}' "$old_server_container")"
old_worker_image="$(docker inspect -f '{{.Image}}' "$old_worker_container")"
{
  printf 'RELEASE_ID=%q\n' "$release_id"
  printf 'OLD_PRODUCTION_DIR=%q\n' "$production_dir"
  printf 'OLD_SERVER_IMAGE=%q\n' "$old_server_image"
  printf 'OLD_WORKER_IMAGE=%q\n' "$old_worker_image"
  printf 'DATABASE_BACKUP=%q\n' "$backup"
} > "$state"
chmod 600 "$state"

echo "[4/7] Build and start candidate API on 8081"
candidate_dc build server
candidate_dc up -d --no-build server gateway
wait_for_url http://127.0.0.1:8081/api/v1/health
curl -fsSI --max-time 10 http://127.0.0.1:8081/ >/dev/null
curl -fsSI --max-time 10 http://127.0.0.1:8081/admin/ >/dev/null
candidate_dc ps

echo
echo "Candidate is healthy. In BaoTa, switch the site reverse proxy from 127.0.0.1:8080 to 127.0.0.1:8081 and reload Nginx."
read -r -p "Type SWITCHED_TO_8081 after the public site is healthy: " confirmation
if [[ "$confirmation" != "SWITCHED_TO_8081" ]]; then
  echo "Confirmation did not match. Candidate remains on 8081; production was not changed." >&2
  exit 1
fi

echo "[5/7] Promote candidate image to production API"
candidate_image="startcloudsai-integrated-candidate-server:$release_id"
docker image inspect "$candidate_image" >/dev/null
docker tag "$candidate_image" startcloudsai-integrated-server:latest
if ! release_dc up -d --no-build --no-deps server || ! wait_for_url http://127.0.0.1:8080/api/v1/health; then
  echo "New production API failed; restoring the previous API image." >&2
  docker tag "$old_server_image" startcloudsai-integrated-server:latest
  release_dc up -d --no-build --no-deps server
  wait_for_url http://127.0.0.1:8080/api/v1/health
  exit 1
fi

echo
echo "New 8080 API is running. Worker was deliberately left unchanged to avoid delaying user tasks."
echo "In BaoTa, switch the site reverse proxy back to 127.0.0.1:8080 and reload Nginx."
read -r -p "Type SWITCHED_TO_8080 after the public site is healthy: " confirmation
if [[ "$confirmation" != "SWITCHED_TO_8080" ]]; then
  echo "Confirmation did not match. Candidate remains available on 8081." >&2
  exit 1
fi

echo "[6/7] Verify public service and stop candidate"
wait_for_url https://starcloudisai.com/api/v1/health 12 5
candidate_dc down

echo "[7/7] Update standard source path"
if [[ -L "$production_link" ]]; then
  ln -sfn "$release_dir" "$production_link"
else
  old_code_backup="$deploy_root/startcloudsai-backup-before-$release_id"
  if [[ -e "$old_code_backup" ]]; then
    echo "Code backup path already exists: $old_code_backup" >&2
    exit 1
  fi
  mv "$production_link" "$old_code_backup"
  ln -s "$release_dir" "$production_link"
  printf 'OLD_CODE_BACKUP=%q\n' "$old_code_backup" >> "$state"
fi
test "$(readlink -f "$production_link")" = "$release_dir"

release_dc ps
echo
echo "Deployment complete: $release_id"
echo "Database backup: $backup"
echo "Rollback state: $state"
echo "Worker was not changed. Update it separately only after confirming there are no running image tasks."
echo "Do not delete the old code directory or rollback images until the observation window ends."
