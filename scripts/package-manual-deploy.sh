#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Working tree has uncommitted changes; commit them before packaging." >&2
  exit 1
fi

commit="$(git rev-parse --short=12 HEAD)"
output_dir="${1:-$repo_root/.artifacts/deploy}"
archive_name="startcloudsai-$commit.tar.gz"
archive="$output_dir/$archive_name"

mkdir -p "$output_dir"
git archive --format=tar --prefix=startcloudsai/ HEAD | gzip -9 > "$archive"

if command -v shasum >/dev/null 2>&1; then
  (cd "$output_dir" && shasum -a 256 "$archive_name" > "$archive_name.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$output_dir" && sha256sum "$archive_name" > "$archive_name.sha256")
else
  echo "Neither shasum nor sha256sum is available; checksum was not generated." >&2
fi

echo "$archive"
