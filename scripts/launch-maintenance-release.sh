#!/usr/bin/env bash
# Upload this script alongside the source archive and checksum, then run with bash.
set -Eeuo pipefail
umask 077
release_id="${1:-}"
[[ "$release_id" =~ ^[0-9a-f]{12}$ ]] || { echo "Usage: bash $0 <12-character-release-id>" >&2; exit 2; }
upload="/www/wwwroot"
archive="$upload/startcloudsai-$release_id.tar.gz"
checksum="$archive.sha256"
root="$upload/releases/$release_id"
release="$root/startcloudsai"
test -s "$archive"
test -s "$checksum"
cd "$upload"
sha256sum -c "$(basename "$checksum")"
# Refuse path traversal and an accidentally selected archive of another project.
tar -tzf "$archive" | awk '
  $0 !~ /^startcloudsai\// || $0 ~ /(^|\/)\.\.(\/|$)/ {bad=1}
  END {exit bad ? 1 : 0}'
if [[ -e "$root" ]]; then
  test -f "$release/RELEASE_COMMIT" || { echo "Incomplete release directory: $root; preserve it for diagnosis." >&2; exit 1; }
else
  mkdir -p "$root"
  tar -xzf "$archive" -C "$root"
fi
[[ "$(head -c 12 "$release/RELEASE_COMMIT")" == "$release_id" ]] || { echo "Archive release identity mismatch" >&2; exit 1; }
mkdir -p /www/backup/startcloudsai
log_file="$(mktemp "/www/backup/startcloudsai/deploy-$release_id-XXXXXX.log")"
nohup bash "$release/deploy/integrated/scripts/deploy-maintenance-update.sh" "$release_id" \
  >"$log_file" 2>&1 </dev/null &
deploy_pid=$!
echo "Deployment running in background: PID=$deploy_pid"
echo "LOG=$log_file"
echo "View progress: tail -n 80 -f '$log_file'"
echo "Closing the terminal or Ctrl+C while viewing the log does not stop deployment."
