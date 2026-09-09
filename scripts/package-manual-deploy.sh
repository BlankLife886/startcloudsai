#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=normal -- . ':(exclude)apps/mobile')" ]]; then
  echo "Website release has uncommitted changes; commit them before packaging." >&2
  exit 1
fi

commit="$(git rev-parse --short=12 HEAD)"
output_dir="${1:-$repo_root/.artifacts/deploy}"
archive_name="startcloudsai-$commit.tar.gz"
archive="$output_dir/$archive_name"

mkdir -p "$output_dir"
# Website release only. Flutter is released separately; uncommitted mobile work
# must never be swept into a website deployment. No working-tree data is copied.
full_commit="$(git rev-parse HEAD)"
git archive --format=tar --prefix=startcloudsai/ \
  --add-virtual-file="startcloudsai/RELEASE_COMMIT:$full_commit" \
  HEAD -- . ':(exclude)apps/mobile' | gzip -n -9 > "$archive"

if command -v shasum >/dev/null 2>&1; then
  (cd "$output_dir" && shasum -a 256 "$archive_name" > "$archive_name.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$output_dir" && sha256sum "$archive_name" > "$archive_name.sha256")
else
  echo "Neither shasum nor sha256sum is available; checksum was not generated." >&2
fi

echo "$archive"
