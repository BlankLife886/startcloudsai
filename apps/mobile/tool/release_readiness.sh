#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

failures=0

check() {
  label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    failures=$((failures + 1))
  fi
}

check_absent() {
  label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'FAIL  %s\n' "$label"
    failures=$((failures + 1))
  else
    printf 'PASS  %s\n' "$label"
  fi
}

check "release version is 1.0.0+1" grep -q '^version: 1\.0\.0+1$' pubspec.yaml
check "external mobile commerce is disabled" grep -q '^const mobileStoreExternalCommerceEnabled = false;$' lib/features/billing/billing.dart
check "iOS marketing icon exists" test -s ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png
check "iOS privacy manifest exists" test -s ios/Runner/PrivacyInfo.xcprivacy
check "iOS privacy manifest is valid" plutil -lint ios/Runner/PrivacyInfo.xcprivacy
check_absent "iOS release excludes Flutter debug local-network access" grep -Eq 'NSBonjourServices|NSLocalNetworkUsageDescription' ios/Runner/Info.plist
check "iOS debug retains Flutter local-network access" grep -q 'NSBonjourServices' ios/Runner/Info-Debug.plist
check "Android adaptive icon exists" test -s android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
check "Android release rejects cleartext traffic" grep -q 'android:usesCleartextTraffic="false"' android/app/src/main/AndroidManifest.xml
check "App Store metadata exists" test -s store/app-store/review-notes.md
check "Google Play metadata exists" test -s store/play/zh-CN/full-description.txt

if test -f android/key.properties || {
  test -n "${ANDROID_KEYSTORE_PATH:-}" &&
  test -n "${ANDROID_KEYSTORE_PASSWORD:-}" &&
  test -n "${ANDROID_KEY_ALIAS:-}" &&
  test -n "${ANDROID_KEY_PASSWORD:-}"
}; then
  printf 'PASS  Android upload signing is configured\n'
else
  printf 'FAIL  Android upload signing is not configured\n'
  failures=$((failures + 1))
fi

for endpoint in \
  /api/v1/me/sessions \
  /api/v1/me/blocked-users \
  /api/v1/me/data-export \
  /api/v1/me/notifications/00000000-0000-0000-0000-000000000000
do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "https://starcloudisai.com$endpoint" || true)
  if test "$code" = 401 || test "$code" = 403; then
    printf 'PASS  production route %s is deployed\n' "$endpoint"
  else
    printf 'FAIL  production route %s returned %s\n' "$endpoint" "${code:-unreachable}"
    failures=$((failures + 1))
  fi
done

feedback_endpoint=/api/v1/assistant/messages/00000000-0000-0000-0000-000000000000/feedback
feedback_code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X PUT -H 'Content-Type: application/json' -d '{"rating":"positive"}' \
  "https://starcloudisai.com$feedback_endpoint" || true)
if test "$feedback_code" = 401 || test "$feedback_code" = 403; then
  printf 'PASS  production route %s is deployed\n' "$feedback_endpoint"
else
  printf 'FAIL  production route %s returned %s\n' "$feedback_endpoint" "${feedback_code:-unreachable}"
  failures=$((failures + 1))
fi

exit "$failures"
