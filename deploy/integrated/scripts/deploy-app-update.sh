#!/usr/bin/env bash

set -Eeuo pipefail

expected_commit="${1:-}"
deploy_root="${DEPLOY_ROOT:-/www/wwwroot/startcloudsai}"
backup_root="${BACKUP_ROOT:-/www/backup/startcloudsai/deployments}"
lock_file="${DEPLOY_LOCK_FILE:-/var/lock/startcloudsai-app-update.lock}"

if [[ ! "$expected_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <40-character-commit>" >&2
  exit 2
fi

for command in curl docker flock git; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

cd "$deploy_root"
env_file="$deploy_root/deploy/integrated/.env.integrated"
compose_file="$deploy_root/deploy/integrated/docker-compose.yml"
if [[ ! -f "$env_file" || ! -f "$compose_file" ]]; then
  echo "Integrated deployment configuration is incomplete under $deploy_root" >&2
  exit 1
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another StartCloud app deployment is already running." >&2
  exit 1
fi

current_commit="$(git rev-parse HEAD)"
if [[ "$current_commit" != "$expected_commit" ]]; then
  echo "Source commit mismatch: current=$current_commit expected=$expected_commit" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked source files have local changes; deployment stopped." >&2
  git status --short >&2
  exit 1
fi

dc() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

active_work_count() {
  dc exec -T postgres sh -ec '
    psql -U "$STARCLOUD_DB_USER" -d "$STARCLOUD_DB_NAME" -At <<SQL
SELECT
    (SELECT count(*) FROM tasks WHERE status IN ('"'"'queued'"'"','"'"'running'"'"'))
  + (SELECT count(*) FROM assistant_runs WHERE status IN ('"'"'queued'"'"','"'"'running'"'"'))
  + (SELECT count(*) FROM canvas_workflow_runs WHERE status = '"'"'running'"'"')
  + (SELECT count(*) FROM canvas_workflow_batches WHERE status IN ('"'"'queued'"'"','"'"'running'"'"'));
SQL
  ' | tr -d '[:space:]'
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

deploy_id="$(date -u +%Y%m%dT%H%M%SZ)-${expected_commit:0:12}"
state_dir="$backup_root/$deploy_id"
mkdir -p "$state_dir"

declare -A old_images
for service in server web admin; do
  container_id="$(dc ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "Service is not running: $service" >&2
    exit 1
  fi
  old_images[$service]="$(docker inspect -f '{{.Image}}' "$container_id")"
  docker tag "${old_images[$service]}" "startcloudsai-rollback-${service}:$deploy_id"
done

cat >"$state_dir/state" <<EOF
DEPLOY_ID=$deploy_id
COMMIT=$expected_commit
OLD_SERVER_IMAGE=${old_images[server]}
OLD_WEB_IMAGE=${old_images[web]}
OLD_ADMIN_IMAGE=${old_images[admin]}
EOF

rollback_required=0
rollback() {
  local reason="$1"
  rollback_required=0
  echo "Deployment failed ($reason); restoring previous app images." >&2
  docker tag "${old_images[server]}" startcloudsai-integrated-server:latest
  docker tag "${old_images[web]}" startcloudsai-integrated-web:latest
  docker tag "${old_images[admin]}" startcloudsai-integrated-admin:latest
  dc up -d --no-deps --no-build server web admin
  wait_for_url http://127.0.0.1:8080/api/v1/health 36 5
  wait_for_url http://127.0.0.1:8080/ 36 5
  wait_for_url http://127.0.0.1:8080/admin/ 36 5
  echo "Rollback completed." >&2
}

on_exit() {
  local code=$?
  trap - EXIT
  if ((code != 0 && rollback_required == 1)); then
    set +e
    rollback "exit code $code"
  fi
  exit "$code"
}
trap on_exit EXIT

echo "[$deploy_id] Validate Compose configuration"
dc config --quiet

active="$(active_work_count)"
echo "[$deploy_id] Active work before build: $active"
if [[ "$active" != "0" ]]; then
  echo "Active user work exists; deployment stopped before build." >&2
  exit 2
fi

echo "[$deploy_id] Build server, web, and admin images"
dc build server web admin

active="$(active_work_count)"
echo "[$deploy_id] Active work before promotion: $active"
if [[ "$active" != "0" ]]; then
  echo "New user work appeared during build; images are built but production was not changed." >&2
  exit 2
fi

rollback_required=1

echo "[$deploy_id] Promote API"
dc up -d --no-deps --no-build server
wait_for_url http://127.0.0.1:8080/api/v1/health

echo "[$deploy_id] Promote user web"
dc up -d --no-deps --no-build web
wait_for_url http://127.0.0.1:8080/

echo "[$deploy_id] Promote admin web"
dc up -d --no-deps --no-build admin
wait_for_url http://127.0.0.1:8080/admin/

dc ps
dc logs --tail=60 server web admin

rollback_required=0
touch "$state_dir/DEPLOY_SUCCESS"
trap - EXIT

echo "DEPLOY_SUCCESS commit=$expected_commit deploy_id=$deploy_id"
echo "State directory: $state_dir"
echo "Worker, ChatGPT2API, PostgreSQL, and Redis were not restarted."
