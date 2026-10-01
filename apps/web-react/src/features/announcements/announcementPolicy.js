export const ANNOUNCEMENT_STORAGE_PREFIX = "starclouds-announcement:";

export function announcementIdentity(item) {
  return `${String(item?.id || "")}:${String(item?.pushId || "").trim()}`;
}

export function isAnnouncementActive(item, now = Date.now()) {
  if (!item?.id || item.active === false) return false;
  const startsAt = Date.parse(item.startsAt || "");
  const endsAt = Date.parse(item.endsAt || "");
  return (!Number.isFinite(startsAt) || startsAt <= now)
    && (!Number.isFinite(endsAt) || endsAt > now);
}

export function shouldShowAnnouncement(item, { dismissedInPage = false, seenInSession = false, dismissed = null, hasDismissedPush = false, now = Date.now() } = {}) {
  if (!isAnnouncementActive(item, now) || dismissedInPage) return false;
  const pushId = String(item.pushId || "").trim();
  if (pushId && !hasDismissedPush && pushId !== String(dismissed?.pushId || "")) return true;
  const frequency = item.frequency || "session_once";
  if (frequency === "every_open") return true;
  if (frequency === "session_once") return !seenInSession;
  if (!dismissed) return true;
  if (frequency === "once_per_version") return Number(dismissed.version) !== (Number(item.version) || 1);
  if (frequency === "daily") return dismissed.day !== new Date(now).toISOString().slice(0, 10);
  if (frequency === "dismiss_hours") {
    const hours = Math.max(1, Number(item.dismissHours) || 24);
    return now - Number(dismissed.dismissedAt || 0) >= hours * 3600 * 1000;
  }
  return !seenInSession;
}

export function announcementDismissRecord(item, now = Date.now()) {
  return {
    version: Number(item.version) || 1,
    day: new Date(now).toISOString().slice(0, 10),
    dismissedAt: now,
    pushId: String(item.pushId || "").trim(),
  };
}

export function nextAnnouncementBoundary(items, now = Date.now()) {
  let next = Infinity;
  for (const item of items) {
    for (const value of [item?.startsAt, item?.endsAt]) {
      const time = Date.parse(value || "");
      if (Number.isFinite(time) && time > now) next = Math.min(next, time);
    }
  }
  return Number.isFinite(next) ? next : null;
}
