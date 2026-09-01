#!/usr/bin/env bash

set -Eeuo pipefail

release_id="${1:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
release_dir="${RELEASE_DIR:-$(cd "$script_dir/../../.." && pwd)}"
deploy_root="${DEPLOY_ROOT:-/www/wwwroot}"
backup_root="${BACKUP_ROOT:-/www/backup/startcloudsai}"
production_link="$deploy_root/startcloudsai"
lock_file="${DEPLOY_LOCK_FILE:-/var/lock/startcloudsai-app-update.lock}"

if [[ ! "$release_id" =~ ^[0-9a-f]{12}$ ]]; then
  echo "Usage: $0 <12-character-release-id>" >&2
  exit 2
fi

for command in curl docker flock gzip readlink; do
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
release_env="$release_dir/deploy/integrated/.env.integrated"
production_compose="$production_dir/deploy/integrated/docker-compose.yml"
release_compose="$release_dir/deploy/integrated/docker-compose.yml"

if [[ "$production_dir" == "$release_dir" ]]; then
  echo "Release directory must be separate from the current production directory." >&2
  exit 1
fi
for file in "$production_env" "$release_env" "$production_compose" "$release_compose"; do
  if [[ ! -f "$file" ]]; then
    echo "Required deployment file does not exist: $file" >&2
    exit 1
  fi
done

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another StartCloud app deployment is already running." >&2
  exit 1
fi

production_dc() {
  docker compose --env-file "$production_env" -f "$production_compose" "$@"
}
release_dc() {
  docker compose --env-file "$release_env" -f "$release_compose" "$@"
}

active_work_count() {
  production_dc exec -T postgres sh -ec \
    'psql -U "$STARCLOUD_DB_USER" -d "$STARCLOUD_DB_NAME" -At' <<'SQL' | tr -d '[:space:]'
SELECT
    (SELECT count(*) FROM tasks WHERE status IN ('queued','running'))
  + (SELECT count(*) FROM assistant_runs WHERE status IN ('queued','running'))
  + (SELECT count(*) FROM canvas_workflow_runs WHERE status = 'running')
  + (SELECT count(*) FROM canvas_workflow_batches WHERE status IN ('queued','running'));
SQL
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

mkdir -p "$backup_root"
backup="$backup_root/predeploy-$release_id.sql.gz"
state="$backup_root/predeploy-$release_id.state"

declare -A old_images
for service in server web admin gateway; do
  container_id="$(production_dc ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Production service is not running: $service" >&2
    exit 1
  fi
  old_images[$service]="$(docker inspect -f '{{.Image}}' "$container_id")"
done

cat >"$state" <<EOF
RELEASE_ID=$release_id
OLD_PRODUCTION_DIR=$production_dir
RELEASE_DIR=$release_dir
OLD_SERVER_IMAGE=${old_images[server]}
OLD_WEB_IMAGE=${old_images[web]}
OLD_ADMIN_IMAGE=${old_images[admin]}
OLD_GATEWAY_IMAGE=${old_images[gateway]}
DATABASE_BACKUP=$backup
EOF
chmod 600 "$state"

rollback_required=0
rollback() {
  rollback_required=0
  echo "Deployment failed; restoring previous app images." >&2
  docker tag "${old_images[server]}" startcloudsai-integrated-server:latest
  docker tag "${old_images[web]}" startcloudsai-integrated-web:latest
  docker tag "${old_images[admin]}" startcloudsai-integrated-admin:latest
  production_dc up -d --no-deps --no-build server web admin gateway
  wait_for_url http://127.0.0.1:8080/api/v1/health
  wait_for_url http://127.0.0.1:8080/
  wait_for_url http://127.0.0.1:8080/admin/
  echo "ROLLBACK_COMPLETED" >&2
}

on_exit() {
  local code=$?
  trap - EXIT
  if ((code != 0 && rollback_required == 1)); then
    set +e
    rollback
  fi
  exit "$code"
}
trap on_exit EXIT

echo "[$release_id] Validate production and release Compose files"
production_dc config --quiet
release_dc config --quiet

active="$(active_work_count)"
echo "[$release_id] Active work before backup/build: $active"
if [[ "$active" != "0" ]]; then
  echo "Active user work exists; production was not changed." >&2
  exit 2
fi

echo "[$release_id] Back up PostgreSQL"
production_dc exec -T postgres sh -ec \
  'pg_dump --clean --if-exists -U "$STARCLOUD_DB_USER" "$STARCLOUD_DB_NAME"' | gzip >"$backup"
test -s "$backup"
gzip -t "$backup"

for service in server web admin; do
  docker tag "${old_images[$service]}" "startcloudsai-rollback-$service:$release_id"
done

echo "[$release_id] Build server, web, and admin one at a time"
release_dc build server
release_dc build web
release_dc build admin

active="$(active_work_count)"
echo "[$release_id] Active work before promotion: $active"
if [[ "$active" != "0" ]]; then
  echo "New user work appeared during build; images are built but production was not changed." >&2
  exit 2
fi

rollback_required=1

echo "[$release_id] Promote API"
release_dc up -d --no-deps --no-build server
wait_for_url http://127.0.0.1:8080/api/v1/health

echo "[$release_id] Promote user web and admin"
release_dc up -d --no-deps --no-build web admin
wait_for_url http://127.0.0.1:8080/
wait_for_url http://127.0.0.1:8080/admin/

echo "[$release_id] Recreate gateway from the release directory"
release_dc up -d --no-deps --force-recreate gateway
wait_for_url http://127.0.0.1:8080/api/v1/health

rollback_required=0

if [[ -L "$production_link" ]]; then
  ln -sfn "$release_dir" "$production_link"
else
  old_code_backup="$deploy_root/startcloudsai-backup-before-$release_id"
  if [[ -e "$old_code_backup" ]]; then
    echo "Old code backup path already exists: $old_code_backup" >&2
    exit 1
  fi
  mv "$production_link" "$old_code_backup"
  if ! ln -s "$release_dir" "$production_link"; then
    mv "$old_code_backup" "$production_link"
    exit 1
  fi
  printf 'OLD_CODE_BACKUP=%s\n' "$old_code_backup" >>"$state"
fi
test "$(readlink -f "$production_link")" = "$release_dir"

release_dc ps
release_dc logs --tail=60 server web admin gateway

touch "$backup_root/DEPLOY_SUCCESS-$release_id"
trap - EXIT

echo "DEPLOY_SUCCESS release=$release_id"
echo "Database backup: $backup"
echo "Rollback state: $state"
echo "Worker, ChatGPT2API, PostgreSQL, and Redis were not restarted."
