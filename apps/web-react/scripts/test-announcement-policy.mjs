import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementDismissRecord,
  announcementIdentity,
  isAnnouncementActive,
  nextAnnouncementBoundary,
  shouldShowAnnouncement,
} from '../src/features/announcements/announcementPolicy.js';

const now = Date.parse('2026-09-09T12:00:00Z');
const announcement = { id: 'notice', version: 2, frequency: 'once_per_version' };

test('announcement frequencies keep their existing dismissal rules', () => {
  const dismissed = announcementDismissRecord(announcement, now);
  assert.equal(shouldShowAnnouncement(announcement, { dismissed, now }), false);
  assert.equal(shouldShowAnnouncement({ ...announcement, version: 3 }, { dismissed, now }), true);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'session_once' }, { seenInSession: true, now }), false);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'session_once' }, { now }), true);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'every_open' }, { dismissed, now }), true);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'daily' }, { dismissed, now }), false);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'daily' }, { dismissed, now: now + 86_400_000 }), true);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'dismiss_hours', dismissHours: 2 }, { dismissed, now: now + 7_199_999 }), false);
  assert.equal(shouldShowAnnouncement({ ...announcement, frequency: 'dismiss_hours', dismissHours: 2 }, { dismissed, now: now + 7_200_000 }), true);
});

test('only a new push identity bypasses an earlier dismissal', () => {
  for (const frequency of ['every_open', 'session_once', 'once_per_version', 'daily', 'dismiss_hours']) {
    const previous = { ...announcement, frequency, pushId: 'push-one' };
    const dismissed = announcementDismissRecord(previous, now);
    const next = { ...previous, pushId: 'push-two' };
    assert.notEqual(announcementIdentity(previous), announcementIdentity(next));
    assert.equal(shouldShowAnnouncement(next, { dismissed, seenInSession: true, now }), true, frequency);
    assert.equal(shouldShowAnnouncement(next, { dismissed: announcementDismissRecord(next, now), dismissedInPage: true, seenInSession: true, now }), false, frequency);
  }
});

test('ordinary edits and repeated snapshots never reopen a notice dismissed in this page', () => {
  const item = { ...announcement, pushId: 'same-push', frequency: 'every_open' };
  const dismissed = announcementDismissRecord(item, now);
  const edited = { ...item, version: 99, title: '更新后的内容', pushedAt: new Date(now).toISOString() };
  assert.equal(announcementIdentity(item), announcementIdentity(edited));
  assert.equal(shouldShowAnnouncement(edited, { dismissed, dismissedInPage: true, now }), false);
});

test('a previously dismissed push is not forced again after a later push was dismissed', () => {
  const old = { ...announcement, frequency: 'session_once', pushId: 'push-one' };
  const dismissed = announcementDismissRecord({ ...old, pushId: 'push-two' }, now);
  assert.equal(shouldShowAnnouncement(old, { dismissed, hasDismissedPush: true, seenInSession: true, now }), false);
  assert.equal(shouldShowAnnouncement({ ...old, pushId: 'push-three' }, { dismissed, seenInSession: true, now }), true);
});

test('legacy dismissals remain effective until an explicit first push', () => {
  const dismissed = { version: 2, dismissedAt: now, day: '2026-09-09' };
  assert.equal(shouldShowAnnouncement(announcement, { dismissed, now }), false);
  assert.equal(shouldShowAnnouncement({ ...announcement, pushId: 'first-push' }, { dismissed, now }), true);
  assert.equal(announcementDismissRecord(announcement, now).pushId, '');
});

test('expiry and deactivation also apply to manually pushed notices', () => {
  const item = { ...announcement, pushId: 'latest' };
  assert.equal(shouldShowAnnouncement({ ...item, active: false }, { now }), false);
  assert.equal(shouldShowAnnouncement({ ...item, endsAt: new Date(now).toISOString() }, { now }), false);
  assert.equal(isAnnouncementActive({ ...item, startsAt: new Date(now + 1).toISOString() }, now), false);
  assert.equal(isAnnouncementActive({ ...item, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 1).toISOString() }, now), true);
});

test('the next local time boundary is the earliest upcoming start or expiry', () => {
  assert.equal(nextAnnouncementBoundary([
    { startsAt: new Date(now + 2000).toISOString() },
    { endsAt: new Date(now + 1000).toISOString() },
    { endsAt: new Date(now - 1000).toISOString() },
  ], now), now + 1000);
  assert.equal(nextAnnouncementBoundary([{ endsAt: 'invalid' }], now), null);
});
