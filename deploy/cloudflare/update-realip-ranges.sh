#!/bin/sh
set -eu

TARGET=${1:-/www/wwwroot/startcloudsai/deploy/cloudflare/cloudflare-realip.conf}
TMP="${TARGET}.tmp.$$"
V4="${TMP}.v4"
V6="${TMP}.v6"

cleanup() {
  rm -f "$TMP" "$V4" "$V6"
}
trap cleanup EXIT HUP INT TERM

curl -fsS https://www.cloudflare.com/ips-v4 > "$V4"
curl -fsS https://www.cloudflare.com/ips-v6 > "$V6"

if [ ! -s "$V4" ] || [ ! -s "$V6" ] ||
   grep -Evq '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$' "$V4" ||
   grep -Evq '^[0-9a-fA-F:]+/[0-9]{1,3}$' "$V6"; then
  echo "Cloudflare IP range response is invalid; existing config was not changed" >&2
  exit 1
fi

{
  echo '# Cloudflare published IP ranges.'
  echo '# Source: https://www.cloudflare.com/ips/'
  echo "# Updated: $(date -u +%F)"
  echo
  sed 's/^/set_real_ip_from /; s/$/;/' "$V4"
  echo
  sed 's/^/set_real_ip_from /; s/$/;/' "$V6"
  echo
  echo 'real_ip_header CF-Connecting-IP;'
  echo 'real_ip_recursive on;'
} > "$TMP"

chmod 0644 "$TMP"
mv "$TMP" "$TARGET"
trap - EXIT HUP INT TERM
rm -f "$V4" "$V6"

echo "Updated $TARGET"
