import { getActiveAnnouncements } from './metaApi'

export async function fetchRuntimeAnnouncements() {
  const items = await getActiveAnnouncements().catch(() => [])
  return items.map((item) => {
    const config = item?.config && typeof item.config === 'object' ? item.config : {}
    return {
      ...config,
      ...item,
      content: item?.content ?? item?.body ?? '',
      placement: item?.placement ?? config.placement ?? 'modal',
      layout: item?.layout ?? config.layout ?? 'text_only',
      assets: Array.isArray(item?.assets)
        ? item.assets
        : Array.isArray(config.assets)
          ? config.assets
          : [],
      decorImageUrl: item?.decorImageUrl ?? config.decorImageUrl ?? '',
      ctaText: item?.ctaText ?? config.ctaText ?? '',
      ctaUrl: item?.ctaUrl ?? config.ctaUrl ?? '',
      closeText: item?.closeText ?? config.closeText ?? '我知道了',
      allowClose: item?.allowClose ?? config.allowClose ?? true,
      frequency: item?.frequency ?? config.frequency ?? 'session_once',
      version: Number(item?.version ?? config.version ?? 1),
      dismissHours: Number(item?.dismissHours ?? config.dismissHours ?? 24),
      carouselEnabled: item?.carouselEnabled ?? config.carouselEnabled ?? false,
      carouselIntervalMs: Number(item?.carouselIntervalMs ?? config.carouselIntervalMs ?? 4500),
    }
  })
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
