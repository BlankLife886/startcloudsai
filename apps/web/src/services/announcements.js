import { getActiveAnnouncements } from './metaApi'

export async function fetchRuntimeAnnouncements() {
  return getActiveAnnouncements().catch(() => [])
}

/** 新后端不统计公告曝光/点击事件，保留空实现兼容旧调用。 */
export async function recordAnnouncementEvent() {}

export function shouldShowAnnouncement(announcement) {
  if (!announcement?.id) return false
  const localKey = getAnnouncementLocalKey(announcement)
  const sessionKey = getAnnouncementSessionKey(announcement)

  if (announcement.frequency === 'session_once') {
    return sessionStorage.getItem(sessionKey) !== '1'
  }

  if (announcement.frequency === 'every_open') return true

  const dismissed = safeJsonParse(localStorage.getItem(localKey), null)
  if (!dismissed) return true

  if (announcement.frequency === 'once_per_version') {
    return Number(dismissed.version || 0) < Number(announcement.version || 1)
  }

  const dismissedAt = Number(dismissed.dismissedAt || 0)
  if (!dismissedAt) return true

  if (announcement.frequency === 'daily') {
    return new Date(dismissedAt).toDateString() !== new Date().toDateString()
  }

  if (announcement.frequency === 'dismiss_hours') {
    const hours = Number(announcement.dismissHours || 24)
    return dismissedAt + hours * 60 * 60 * 1000 <= Date.now()
  }

  return true
}

export function markAnnouncementDismissed(announcement) {
  if (!announcement?.id) return
  const payload = JSON.stringify({
    version: Number(announcement.version || 1),
    dismissedAt: Date.now(),
  })
  try {
    localStorage.setItem(getAnnouncementLocalKey(announcement), payload)
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(getAnnouncementSessionKey(announcement), '1')
  } catch {
    /* ignore */
  }
}

function getAnnouncementLocalKey(announcement) {
  return `walleven_announcement_${announcement.id}`
}

function getAnnouncementSessionKey(announcement) {
  return `walleven_announcement_session_${announcement.id}_${announcement.version || 1}`
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
