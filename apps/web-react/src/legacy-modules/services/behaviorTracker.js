import { apiPost } from './apiClient.js'

const FLUSH_INTERVAL_MS = 10_000
const FEATURE_OPEN_DEDUPE_MS = 30_000
const MAX_QUEUE_SIZE = 50
const ALLOWED_EVENTS = new Set([
  'feature_open',
  'reference_upload_started',
  'reference_upload_completed',
  'reference_upload_failed',
  'form_started',
  'form_abandoned',
  'template_open',
  'template_used',
])
const ALLOWED_FEATURES = new Set([
  'home',
  'text_to_image',
  'assistant',
  'canvas',
  'ecommerce',
  'coloring',
  'design_workshop',
  'model_sheet',
  'game_art',
  'background_remove',
  'media_tools',
  'assets',
  'history',
  'prompt_library',
  'other',
])
const ALLOWED_METADATA = new Set(['entryPoint', 'uploadKind', 'itemCount', 'source', 'errorType', 'batch'])

let enabled = false
let queue = []
let flushTimer = 0
let flushing = false
let lastFlushAt = 0
const recentFeatureOpens = new Map()

function eventID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function safeMetadata(input) {
  const output = {}
  for (const [key, value] of Object.entries(input && typeof input === 'object' ? input : {})) {
    if (!ALLOWED_METADATA.has(key)) continue
    if (typeof value === 'boolean') output[key] = value
    else if (Number.isInteger(value) && value >= 0 && value <= 1000) output[key] = value
    else if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,64}$/.test(value.trim())) output[key] = value.trim()
  }
  return output
}

export function behaviorFeatureFromPath(pathname = '') {
  const path = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path.startsWith('/text-to-image')) return 'text_to_image'
  if (path.startsWith('/assistant')) return 'assistant'
  if (path.startsWith('/canvas')) return 'canvas'
  if (path.startsWith('/ecommerce')) return 'ecommerce'
  if (path.startsWith('/ai-illustration-coloring')) return 'coloring'
  if (path.startsWith('/design-workshop')) return 'design_workshop'
  if (path.startsWith('/model-sheet')) return 'model_sheet'
  if (path.startsWith('/game-art')) return 'game_art'
  if (path.startsWith('/tools/background-remove')) return 'background_remove'
  if (path === '/tools' || path.startsWith('/tools/')) return 'media_tools'
  if (path.startsWith('/materials') || path.startsWith('/assets')) return 'assets'
  if (path.startsWith('/history')) return 'history'
  if (path.startsWith('/prompts')) return 'prompt_library'
  return 'other'
}

export function currentBehaviorFeature() {
  return behaviorFeatureFromPath(typeof window === 'undefined' ? '' : window.location.pathname)
}

function scheduleFlush() {
  if (!enabled || !queue.length || flushTimer || flushing) return
  const elapsed = Date.now() - lastFlushAt
  const delay = Math.max(0, FLUSH_INTERVAL_MS - elapsed)
  flushTimer = globalThis.setTimeout(() => {
    flushTimer = 0
    void flushBehaviorEvents()
  }, delay)
}

export function setBehaviorTrackingEnabled(value) {
  enabled = value === true
  if (enabled) {
    if (!lastFlushAt) lastFlushAt = Date.now()
    scheduleFlush()
    return
  }
  queue = []
  recentFeatureOpens.clear()
  if (flushTimer) globalThis.clearTimeout(flushTimer)
  flushTimer = 0
}

export function trackBehaviorEvent(eventName, feature = currentBehaviorFeature(), metadata = {}) {
  if (!enabled || !ALLOWED_EVENTS.has(eventName)) return false
  const normalizedFeature = ALLOWED_FEATURES.has(feature) ? feature : 'other'
  if (eventName === 'feature_open') {
    const now = Date.now()
    const previous = recentFeatureOpens.get(normalizedFeature) || 0
    if (now - previous < FEATURE_OPEN_DEDUPE_MS) return false
    recentFeatureOpens.set(normalizedFeature, now)
  }
  queue.push({
    clientEventId: eventID(),
    eventName,
    feature: normalizedFeature,
    metadata: safeMetadata(metadata),
  })
  if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE)
  scheduleFlush()
  return true
}

export async function flushBehaviorEvents() {
  if (!enabled || flushing || !queue.length) return 0
  const elapsed = Date.now() - lastFlushAt
  if (elapsed < FLUSH_INTERVAL_MS) {
    scheduleFlush()
    return 0
  }
  flushing = true
  lastFlushAt = Date.now()
  const events = queue.splice(0, MAX_QUEUE_SIZE)
  try {
    const result = await apiPost('/me/behavior-events', { events }, { fallbackMessage: '行为记录失败' })
    return Number(result?.accepted || 0)
  } catch {
    return 0
  } finally {
    flushing = false
    scheduleFlush()
  }
}

export async function trackReferenceUpload(operation, { feature = currentBehaviorFeature(), metadata = {} } = {}) {
  trackBehaviorEvent('reference_upload_started', feature, metadata)
  try {
    const result = await operation()
    trackBehaviorEvent('reference_upload_completed', feature, metadata)
    return result
  } catch (error) {
    const errorType = String(error?.code || error?.name || 'upload_failed')
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 64) || 'upload_failed'
    trackBehaviorEvent('reference_upload_failed', feature, { ...metadata, errorType })
    throw error
  }
}

export function behaviorTrackerSnapshot() {
  return { enabled, queued: queue.length, flushing, lastFlushAt }
}
