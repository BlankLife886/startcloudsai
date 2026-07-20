import { buildApiUrl } from './api'
import { clientLogHeaders } from './clientLogHeaders'
import { getClientId } from './clientIdentity'

const SESSION_ID_KEY = 'walleven_action_session_id'
const FLUSH_INTERVAL_MS = 4000
const MAX_QUEUE_SIZE = 40

let queue = []
let flushTimer = null
let trackingStarted = false
let lastTrackedPageKey = ''
let isTrackingEnabled = () => true

export function getActionSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY)
    if (!id) {
      id = `session_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
      sessionStorage.setItem(SESSION_ID_KEY, id)
    }
    return id
  } catch {
    return 'session_unavailable'
  }
}

export function trackUserAction(action) {
  if (!action || typeof window === 'undefined') return
  if (!isTrackingEnabled()) {
    dropQueuedActions()
    return
  }
  queue.push(normalizeAction(action))
  if (queue.length >= MAX_QUEUE_SIZE) {
    void flushUserActions()
    return
  }
  scheduleFlush()
}

export function trackPageView(route) {
  if (!isTrackingEnabled()) return
  const pageKey = route?.fullPath || getCurrentFallbackPagePath()
  if (!pageKey || pageKey === lastTrackedPageKey) return
  lastTrackedPageKey = pageKey

  trackUserAction({
    actionType: 'page_view',
    actionName: '访问页面',
    pagePath: pageKey,
    pageTitle: document.title,
    targetType: 'route',
    targetId: route?.name || route?.path || window.location.pathname,
    targetLabel: route?.meta?.title || document.title,
  })
}

export function initUserActionTracking(router, options = {}) {
  if (trackingStarted || typeof window === 'undefined' || typeof document === 'undefined') return
  if (typeof options.isEnabled === 'function') {
    isTrackingEnabled = () => options.isEnabled() !== false
  }
  if (!isTrackingEnabled()) {
    dropQueuedActions()
    return
  }
  trackingStarted = true

  if (router?.afterEach) {
    router.afterEach((to) => {
      trackPageView(to)
    })
  }

  trackPageView(router?.currentRoute?.value)

  document.addEventListener('click', handleDocumentClick, true)
  document.addEventListener('submit', handleDocumentSubmit, true)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('beforeunload', handlePageLifecycleFlush)
  window.addEventListener('pagehide', handlePageLifecycleFlush)
}

export async function flushUserActions(options = {}) {
  clearFlushTimer()
  if (!isTrackingEnabled()) {
    dropQueuedActions()
    return
  }
  const batch = queue.splice(0, queue.length)
  await sendActions(batch, options)
}

function normalizeAction(action) {
  return {
    clientId: getClientId(),
    sessionId: getActionSessionId(),
    pagePath: action.pagePath || `${window.location.pathname}${window.location.search}`,
    pageTitle: action.pageTitle || document.title,
    actionType: action.actionType || 'custom',
    actionName: action.actionName || '未命名操作',
    targetType: action.targetType || '',
    targetId: action.targetId || '',
    targetLabel: action.targetLabel || '',
    metadata: action.metadata || {},
  }
}

async function sendActions(actions, options = {}) {
  if (!Array.isArray(actions) || !actions.length) return
  if (!isTrackingEnabled()) return

  if (
    options.useBeacon &&
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
  ) {
    const payload = new Blob([JSON.stringify({ actions })], { type: 'application/json' })
    if (navigator.sendBeacon(buildApiUrl('/client/tracking/user-actions'), payload)) {
      return
    }
  }

  await fetch(buildApiUrl('/client/tracking/user-actions'), {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: clientLogHeaders({
      'Content-Type': 'application/json',
      'X-Page-Path': actions[0]?.pagePath || getCurrentFallbackPagePath(),
    }),
    body: JSON.stringify({ actions }),
  }).catch(() => {})
}

function getCurrentFallbackPagePath() {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}`
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = window.setTimeout(flushUserActions, FLUSH_INTERVAL_MS)
}

function clearFlushTimer() {
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
}

function dropQueuedActions() {
  queue = []
  clearFlushTimer()
}

function handleDocumentClick(event) {
  const target = getTrackedElement(event?.target)
  if (!target) return

  const label = describeElement(target)
  if (!label) return

  trackUserAction({
    actionType: 'click',
    actionName: label,
    targetType: target.tagName.toLowerCase(),
    targetId: getElementIdentifier(target),
    targetLabel: label,
  })
}

function handleDocumentSubmit(event) {
  const target = getTrackedElement(event?.target)
  if (!target || target.tagName.toLowerCase() !== 'form') return

  const label = describeElement(target) || '提交表单'
  trackUserAction({
    actionType: 'submit',
    actionName: label,
    targetType: 'form',
    targetId: getElementIdentifier(target),
    targetLabel: label,
  })
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'hidden') return
  void flushUserActions({ useBeacon: true })
}

function handlePageLifecycleFlush() {
  void flushUserActions({ useBeacon: true })
}

function getTrackedElement(target) {
  if (!target || typeof target.closest !== 'function') return null
  return target.closest(
    'button, a, [role="button"], [role="menuitem"], [role="tab"], input[type="button"], input[type="submit"], .btn, .nav-link, .dropdown-item, .page-link',
  )
}

function getElementIdentifier(el) {
  if (!el || typeof el.getAttribute !== 'function') return ''
  return (
    el.getAttribute('data-action-id') ||
    el.getAttribute('data-testid') ||
    el.getAttribute('name') ||
    el.id ||
    el.getAttribute('href') ||
    ''
  )
}

function describeElement(el) {
  if (!el) return ''

  const candidates = [
    el.getAttribute?.('data-action-label'),
    el.getAttribute?.('aria-label'),
    el.getAttribute?.('title'),
    el.getAttribute?.('alt'),
    normalizeWhitespace(el.textContent),
    el.value,
    el.getAttribute?.('href'),
    el.id,
    el.tagName?.toLowerCase(),
  ]

  const label = candidates.find((value) => typeof value === 'string' && value.trim())
  return trimText(label || '', 120)
}

function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimText(value = '', max = 120) {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1))}…`
}
