#!/usr/bin/env bash
# Maintenance-window update. Never imports a development database or rolls back schema automatically.
set -Eeuo pipefail
umask 077

release_id="${1:-}"
[[ "$release_id" =~ ^[0-9a-f]{12}$ ]] || { echo "Usage: $0 <12-character-release-id>" >&2; exit 2; }
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
release_dir="$(cd "$script_dir/../../.." && pwd)"
deploy_root="${DEPLOY_ROOT:-/www/wwwroot}"
standard="$deploy_root/startcloudsai"
backup_root="${BACKUP_ROOT:-/www/backup/startcloudsai}"
for tool in docker curl flock readlink sha256sum install cmp mktemp sed; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 1; }
done
exec 9>"${DEPLOY_LOCK_FILE:-/var/lock/startcloudsai-app-update.lock}"
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }
current="$(readlink -f "$standard")"
[[ -d "$current" && "$current" != "$release_dir" ]] || { echo "Release must be separate from current production" >&2; exit 1; }
old_env="$current/deploy/integrated/.env.integrated"
new_env="$release_dir/deploy/integrated/.env.integrated"
test -s "$old_env"
test -s "$release_dir/deploy/integrated/docker-compose.yml"
# Shell overrides must not silently select another project or development env file.
unset COMPOSE_PROJECT_NAME COMPOSE_FILE STARCLOUD_RELEASE_TAG INTEGRATED_APP_ENV_FILE
old_dc() { docker compose --env-file "$old_env" -f "$current/deploy/integrated/docker-compose.yml" "$@"; }
new_dc() { docker compose --env-file "$new_env" -f "$release_dir/deploy/integrated/docker-compose.yml" "$@"; }
query() {
  old_dc exec -T postgres sh -ec 'psql -X -v ON_ERROR_STOP=1 -At -U "$STARCLOUD_DB_USER" -d "$STARCLOUD_DB_NAME"' "$@"
}
active_count() {
  query <<'SQL'
SELECT (SELECT count(*) FROM tasks WHERE status IN ('queued','running'))
+(SELECT count(*) FROM assistant_runs WHERE status IN ('queued','running'))
+(SELECT count(*) FROM assistant_files WHERE status IN ('queued','processing'))
+(SELECT count(*) FROM canvas_workflow_runs WHERE status='running')
+(SELECT count(*) FROM canvas_workflow_batches WHERE status IN ('queued','running'))
+(SELECT count(*) FROM task_upstream_attempts WHERE status IN ('submitting','pending'));
SQL
}
counts() {
  query <<'SQL'
SELECT (SELECT count(*) FROM users),(SELECT count(*) FROM wallets),
       (SELECT count(*) FROM orders),(SELECT count(*) FROM tasks);
SQL
}
require_idle() {
  local n
  n="$(active_count)"
  [[ "$n" == 0 ]] || { echo "Active records=$n; no migration performed" >&2; return 1; }
}
wait_api() {
  local i
  for ((i=0;i<60;i++)); do
    if new_dc exec -T server wget -qO- http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  echo "API readiness failed" >&2; return 1
}
wait_worker() {
  local i
  for ((i=0;i<40;i++)); do
    if new_dc exec -T worker /app/server check-worker; then return 0; fi
    sleep 3
  done
  echo "Image/chat consumers not ready" >&2; return 1
}

mkdir -p "$backup_root"
# Every attempt gets its own backup, including interrupted/retried deployments.
attempt="$(mktemp -d "$backup_root/maintenance-$release_id-XXXXXX")"
phase=preparation
maintenance=0
on_exit() {
  code=$?
  trap - EXIT
  if ((code != 0)); then
    printf 'FAILED phase=%s exit=%s\n' "$phase" "$code" | tee "$attempt/FAILED"
    if ((maintenance == 1)); then
      if [[ "$phase" == quiesce || "$phase" == backup ]]; then
        # New code has not started, so the original schema is still in use.
        old_dc start server worker gateway || true
        echo "Original services restart requested; verify health before retry." >&2
      else
        new_dc stop -t 60 gateway || true
        new_dc stop -t 900 worker || true
        new_dc stop -t 60 server || true
        echo "Maintenance retained. No automatic database/old-image rollback after migration." >&2
      fi
    fi
    echo "Diagnostic/backup directory: $attempt" >&2
  fi
  exit "$code"
}
trap on_exit EXIT

echo "[$release_id] Validate current configuration and preserve production environment"
old_dc config --quiet
install -m 600 "$old_env" "$new_env"
# The production app env must be the copied production file, never a relative development override.
sed -i '/^[[:space:]]*STARCLOUD_RELEASE_TAG=/d; /^[[:space:]]*INTEGRATED_APP_ENV_FILE=/d' "$new_env"
printf '\nSTARCLOUD_RELEASE_TAG=%s\nINTEGRATED_APP_ENV_FILE=.env.integrated\n' "$release_id" >>"$new_env"
new_dc config --quiet
install -m 600 "$old_env" "$attempt/env.integrated"
for service in server worker web admin gateway postgres redis chatgpt2api; do
  cid="$(old_dc ps -q "$service")"
  test -n "$cid" || { echo "Missing running service: $service" >&2; exit 1; }
  docker inspect --format '{{.Name}} {{.Image}} {{.State.StartedAt}}' "$cid" >>"$attempt/containers-before.txt"
  if [[ "$service" =~ ^(server|worker|web|admin)$ ]]; then
    old_image="$(docker inspect -f '{{.Image}}' "$cid")"
    docker tag "$old_image" "startcloudsai-rollback-$service:$(basename "$attempt")"
  fi
done
printf '%s\n' "$current" >"$attempt/old-directory"
require_idle

echo "[$release_id] Build release-tagged images while original services stay available"
for service in server worker web admin; do new_dc build "$service"; done
# Validate the exact gateway image/config before entering maintenance.
docker run --rm --network none --entrypoint nginx \
  --mount "type=bind,source=$release_dir/deploy/nginx.conf,target=/etc/nginx/conf.d/default.conf,readonly" \
  nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 -t
require_idle

echo "[$release_id] Enter maintenance and stop old writers"
phase=quiesce
maintenance=1
old_dc stop -t 60 gateway
old_dc stop -t 60 server
require_idle
old_dc stop -t 900 worker
require_idle

phase=backup
echo "[$release_id] Back up the production database (no local data import)"
counts >"$attempt/counts-before.txt"
old_dc exec -T postgres sh -ec 'pg_dump --format=custom -U "$STARCLOUD_DB_USER" "$STARCLOUD_DB_NAME"' >"$attempt/production.dump"
test -s "$attempt/production.dump"
old_dc exec -T postgres pg_restore --list <"$attempt/production.dump" >"$attempt/archive-list.txt"
test -s "$attempt/archive-list.txt"
# Read the entire archive, not only its TOC, to catch truncated data streams.
old_dc exec -T postgres pg_restore --file=/dev/null <"$attempt/production.dump"
(cd "$attempt" && sha256sum production.dump env.integrated >SHA256SUMS)
chmod 600 "$attempt"/*

phase=migrate
echo "[$release_id] Start matching API and apply migrations"
new_dc up -d --no-deps --no-build server
wait_api
counts >"$attempt/counts-after-migration.txt"
cmp "$attempt/counts-before.txt" "$attempt/counts-after-migration.txt"
# User explicitly defers public API launch; preserve all other page controls.
query <<'SQL'
INSERT INTO app_settings(key,value,updated_at)
VALUES('page_controls','{"developer_api":{"status":"removed","reason":"开放 API 正在内部测试。"}}'::jsonb,now())
ON CONFLICT(key) DO UPDATE SET value=
 (CASE WHEN jsonb_typeof(app_settings.value)='object' THEN app_settings.value ELSE '{}'::jsonb END)
 || EXCLUDED.value,updated_at=now();
SQL

phase=verify
new_dc up -d --no-deps --no-build worker web admin
wait_worker
new_dc exec -T web wget -qO- http://127.0.0.1/ >/dev/null
new_dc exec -T admin wget -qO- http://127.0.0.1/admin/ >/dev/null
# Check that the deferred API is actually gated without creating a key or task.
new_dc exec -T server sh -ec 'wget -S -O /tmp/open-api-gate http://127.0.0.1:8000/v1/models 2>/tmp/open-api-status || true; grep -q open_api_disabled /tmp/open-api-gate || grep -q "404 Not Found" /tmp/open-api-status'

echo "[$release_id] Point the stable directory to the new release"
if [[ -L "$standard" ]]; then
  link_tmp="$deploy_root/.startcloudsai-link-$release_id-$(basename "$attempt")"
  ln -s "$release_dir" "$link_tmp"
  mv -Tf "$link_tmp" "$standard"
else
  previous_code="$deploy_root/startcloudsai-backup-$(basename "$attempt")"
  mv "$standard" "$previous_code"
  printf '%s\n' "$previous_code" >"$attempt/old-directory"
  ln -s "$release_dir" "$standard"
fi
test "$(readlink -f "$standard")" = "$release_dir"

phase=reopen
new_dc up -d --no-deps --no-build --force-recreate gateway
for ((i=0;i<30;i++)); do
  if curl -fsS --max-time 5 http://127.0.0.1:8080/api/v1/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS --max-time 10 http://127.0.0.1:8080/api/v1/health
curl -fsS --max-time 10 http://127.0.0.1:8080/ >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:8080/admin/ >/dev/null
maintenance=0
phase=complete
printf 'DEPLOY_SUCCESS release=%s\n' "$release_id" | tee "$attempt/SUCCESS"
echo "Production backup: $attempt/production.dump"
echo "Public API stays disabled. PostgreSQL, Redis and ChatGPT2API were not restarted."
new_dc ps
