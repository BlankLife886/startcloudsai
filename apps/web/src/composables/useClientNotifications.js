import { computed, ref } from 'vue'
import { getOverview, listNotifications, markNotificationsRead } from '@/services/meApi'
import { useAuthStore } from '@/stores/auth'

export const NOTIFICATIONS_UPDATED_EVENT = 'starclouds:notifications-updated'

const unreadCount = ref(0)
const previewItems = ref([])
const previewLoading = ref(false)
const unreadFetchedAt = ref(0)
let inflightUnread = null
let inflightPreview = null

function emitUpdated(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(NOTIFICATIONS_UPDATED_EVENT, {
      detail: {
        unreadCount: unreadCount.value,
        previewItems: previewItems.value,
        ...detail,
      },
    }),
  )
}

export function applyUnreadCount(count) {
  unreadCount.value = Math.max(0, Number(count) || 0)
  unreadFetchedAt.value = Date.now()
  emitUpdated({ source: 'apply' })
  return unreadCount.value
}

export function applyPreviewItems(items = []) {
  previewItems.value = Array.isArray(items) ? items : []
  emitUpdated({ source: 'preview' })
  return previewItems.value
}

export function useClientNotifications() {
  const authStore = useAuthStore()

  const hasUnread = computed(() => unreadCount.value > 0)
  const badgeLabel = computed(() => {
    const n = unreadCount.value
    if (n <= 0) return ''
    return n > 99 ? '99+' : String(n)
  })

  async function refreshUnreadCount() {
    if (!authStore.isAuthenticated) {
      unreadCount.value = 0
      previewItems.value = []
      emitUpdated({ source: 'logout' })
      return 0
    }
    if (inflightUnread) return inflightUnread

    const request = getOverview()
      .then((overview) => applyUnreadCount(overview?.unreadNotifications))
      .catch(() => unreadCount.value)
      .finally(() => {
        if (inflightUnread === request) inflightUnread = null
      })

    inflightUnread = request
    return request
  }

  async function refreshPreview({ limit = 8 } = {}) {
    if (!authStore.isAuthenticated) {
      previewItems.value = []
      return []
    }
    if (inflightPreview) return inflightPreview

    previewLoading.value = true
    const request = listNotifications({ limit })
      .then(({ items, unread }) => {
        applyPreviewItems(items)
        if (Number.isFinite(Number(unread))) applyUnreadCount(unread)
        return items
      })
      .catch(() => previewItems.value)
      .finally(() => {
        previewLoading.value = false
        if (inflightPreview === request) inflightPreview = null
      })

    inflightPreview = request
    return request
  }

  async function markAllRead() {
    await markNotificationsRead()
    previewItems.value = previewItems.value.map((item) => ({
      ...item,
      readAt: item.readAt || new Date().toISOString(),
    }))
    applyUnreadCount(0)
  }

  async function markItemsRead(ids = []) {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : []
    if (!list.length) return markAllRead()
    await markNotificationsRead(list)
    const idSet = new Set(list.map(String))
    let marked = 0
    previewItems.value = previewItems.value.map((item) => {
      if (!idSet.has(String(item.id)) || item.readAt) return item
      marked += 1
      return { ...item, readAt: new Date().toISOString() }
    })
    if (marked) applyUnreadCount(Math.max(0, unreadCount.value - marked))
  }

  return {
    unreadCount,
    hasUnread,
    badgeLabel,
    previewItems,
    previewLoading,
    unreadFetchedAt,
    refreshUnreadCount,
    refreshPreview,
    markAllRead,
    markItemsRead,
    applyUnreadCount,
    applyPreviewItems,
  }
}
