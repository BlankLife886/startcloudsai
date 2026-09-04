# Mobile 1.0 Release Checklist

## Repository complete

- [x] Production bundle identifiers use `com.starcloudisai.app`.
- [x] Version is `1.0.0+1`.
- [x] Store-distributed UI does not expose external payment or redemption.
- [x] Account deletion, data export, device sessions and community safety are implemented.
- [x] Users can inspect and clear local image caches and unsent drafts without deleting cloud account data.
- [x] App switcher snapshots hide user conversations, creations and account details while the app is backgrounded.
- [x] Idempotent reads recover once from transient network and gateway failures; mutating requests are never retried automatically.
- [x] Third-party open-source licenses are available in-app from the About screen and generated from the shipped runtime registry.
- [x] Primary navigation provides native haptic selection feedback and respects the system Reduce Motion preference.
- [x] Startup announcements can target iOS/Android versions and enforce a non-dismissible minimum-supported-version update gate.
- [x] iOS and Android register the `starcloudsai://app/<path>` deep-link scheme and invalid routes recover to the app home screen.
- [x] iOS privacy manifest and runtime permission descriptions are present.
- [x] Release iOS metadata declares standard-only encryption and excludes debug local-network access.
- [x] Branded iOS icons, Android adaptive icons and launch visuals are present.
- [x] Chinese store copy, review notes and data-safety source are present.
- [x] Public privacy, terms and support routes exist in the web client.

## Requires release credentials or deployment access

- [ ] Deploy the current server and database migrations to production.
- [ ] Deploy the current web client so `/privacy`, `/terms` and `/support` render publicly.
- [ ] Configure Apple Distribution signing and create a signed IPA.
- [ ] Configure the Android upload keystore and create a signed AAB.
- [ ] Create store records and complete age rating, privacy/data-safety and content declarations.
- [ ] Publish HTTPS Universal Links / App Links association files after the Apple Team ID and Android release-certificate SHA-256 fingerprint are available.
- [ ] Upload phone screenshots and the final store icon.
- [ ] Keep production services available and verify reviewer login during review.
