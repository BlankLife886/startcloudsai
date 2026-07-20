import axios from 'axios'
import notificationService from '@/services/notification'
import { API_BASE_URL } from './apiBase'
import { getApiData, getApiErrorMessage, isApiSuccess } from './apiResponse'
import { getAuthSession, getAuthToken, getCsrfToken } from './auth'
import { clientLogHeaders } from './clientLogHeaders'
import { getClientId } from './clientIdentity'
import {
  getClientStateLabel,
  prepareClientStatePayload,
} from './clientStatePayload'
import storageService from './storage'

const SYNC_META_KEY = 'client_state_sync_meta'
const CLOUD_SYNC_ENABLED_KEY = 'cloud_sync_enabled'
const CLOUD_SYNC_ACCOUNT_PREFS_KEY = 'cloud_sync_account_prefs'
const CLOUD_SYNC_CONFLICT_STRATEGY_KEY = 'cloud_sync_conflict_strategy'
const CLOUD_SYNC_CONFLICT_STRATEGY_PREFS_KEY = 'cloud_sync_conflict_strategy_prefs'
const DEFAULT_TIMEOUT_MS = 12000
const DEFAULT_PUSH_DEBOUNCE_MS = 650
const MAX_CLIENT_STATE_CONCURRENCY = 2
const DEFAULT_CONFLICT_STRATEGY = 'merge'
const VALID_CONFLICT_STRATEGIES = new Set(['merge', 'local', 'remote'])
const SYNC_NOTICE_COOLDOWN_MS = 5 * 60 * 1000
const pendingPushes = new Map()
const lastSyncedFingerprints = new Map()
const clientStateRequestQueue = []
let activeClientStateRequests = 0
let lastSyncNoticeAt = 0
const USER_STATE_PATHS = {
  settings: '/user/settings',
  favorites: '/user/favorites',
  history: '/user/history',
  downloads: '/user/data-states/downloads',
  authors: '/user/data-states/authors',
  tags: '/user/data-states/tags',
  aiWallpaper: '/user/data-states/aiWallpaper',
}

const clientStateApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
})

function drainClientStateRequestQueue() {
  while (
    activeClientStateRequests < MAX_CLIENT_STATE_CONCURRENCY &&
    clientStateRequestQueue.length
  ) {
    const entry = clientStateRequestQueue.shift()
    activeClientStateRequests += 1
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        activeClientStateRequests -= 1
        drainClientStateRequestQueue()
      })
  }
}

function withClientStateRequestSlot(task) {
  return new Promise((resolve, reject) => {
    clientStateRequestQueue.push({ task, resolve, reject })
    drainClientStateRequestQueue()
  })
}

export { getClientId }

function getCloudSyncAccountKey() {
  const session = getAuthSession()
  const userId = session?.user?.id
  if (!userId) return ''
  return `user:${userId}`
}

function getCloudSyncPrefs() {
  const prefs = storageService.get(CLOUD_SYNC_ACCOUNT_PREFS_KEY, {})
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {}
}

export function isCloudSyncEnabled() {
  const accountKey = getCloudSyncAccountKey()
  if (!accountKey) return false

  return getCloudSyncPrefs()[accountKey] === true
}

export function setCloudSyncEnabled(enabled) {
  const accountKey = getCloudSyncAccountKey()
  if (!accountKey) {
    storageService.set(CLOUD_SYNC_ENABLED_KEY, false)
    return false
  }

  const prefs = getCloudSyncPrefs()
  prefs[accountKey] = enabled === true
  storageService.set(CLOUD_SYNC_ACCOUNT_PREFS_KEY, prefs)
  storageService.set(CLOUD_SYNC_ENABLED_KEY, enabled === true)
  return true
}

function normalizeConflictStrategy(strategy) {
  const value = String(strategy || '').trim()
  return VALID_CONFLICT_STRATEGIES.has(value) ? value : DEFAULT_CONFLICT_STRATEGY
}

function getConflictStrategyPrefs() {
  const prefs = storageService.get(CLOUD_SYNC_CONFLICT_STRATEGY_PREFS_KEY, {})
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {}
}

export function getCloudSyncConflictStrategy() {
  const accountKey = getCloudSyncAccountKey()
  if (!accountKey) {
    return normalizeConflictStrategy(
      storageService.get(CLOUD_SYNC_CONFLICT_STRATEGY_KEY, DEFAULT_CONFLICT_STRATEGY),
    )
  }

  return normalizeConflictStrategy(getConflictStrategyPrefs()[accountKey])
}

export function setCloudSyncConflictStrategy(strategy) {
  const normalized = normalizeConflictStrategy(strategy)
  const accountKey = getCloudSyncAccountKey()

  if (!accountKey) {
    storageService.set(CLOUD_SYNC_CONFLICT_STRATEGY_KEY, normalized)
    return normalized
  }

  const prefs = getConflictStrategyPrefs()
  prefs[accountKey] = normalized
  storageService.set(CLOUD_SYNC_CONFLICT_STRATEGY_PREFS_KEY, prefs)
  storageService.set(CLOUD_SYNC_CONFLICT_STRATEGY_KEY, normalized)
  return normalized
}

function clientStateHeaders(extraHeaders = {}) {
  const token = getAuthToken()
  const csrfToken = getCsrfToken()
  return clientLogHeaders({
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  })
}

function userStatePath(stateKey) {
  return USER_STATE_PATHS[stateKey] || ''
}

function clientStateFingerprint(payload) {
  const normalize = (value, depth = 0) => {
    if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1))
    if (!value || typeof value !== 'object') return value
    return Object.keys(value)
      .filter((key) => depth > 0 || !['updatedAt', 'updated_at'].includes(key))
      .sort()
      .reduce((result, key) => {
        result[key] = normalize(value[key], depth + 1)
        return result
      }, {})
  }
  try {
    return JSON.stringify(normalize(payload))
  } catch {
    return ''
  }
}

function normalizeClientStateResponse(response, stateKey, actionLabel) {
  if (response.status === 413) {
    throw new Error(getApiErrorMessage(response.data, `${getClientStateLabel(stateKey)}数据过大，请清理部分本地记录后重试`))
  }
  if (response.status === 501) {
    setSyncMeta(stateKey, { enabled: false, last_error: 'D1 未启用' })
    return null
  }
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !isApiSuccess(response.data, response.status)
  ) {
    throw new Error(getApiErrorMessage(response.data, `${actionLabel}(${response.status})`))
  }

  return getApiData(response.data)
}

function notifySyncIssue(stateKey, message, { trimmed = false } = {}) {
  const now = Date.now()
  if (now - lastSyncNoticeAt < SYNC_NOTICE_COOLDOWN_MS) return
  lastSyncNoticeAt = now

  const label = getClientStateLabel(stateKey)
  const text = trimmed
    ? `云同步时${label}较多，已自动精简最近记录后上传。可在设置中查看云端用量并清理旧数据。`
    : `云同步失败（${label}）：${message}`

  notificationService.warning(text, {
    duration: 9000,
    position: 'top-right',
  })
}

export function listClientStateSyncIssues() {
  const meta = getSyncMeta()
  return Object.entries(meta)
    .filter(([, value]) => value?.last_error)
    .map(([stateKey, value]) => ({
      stateKey,
      label: getClientStateLabel(stateKey),
      error: String(value.last_error || ''),
      checkedAt: value.checked_at || '',
    }))
}

function getSyncMeta() {
  return storageService.get(SYNC_META_KEY, {}) || {}
}

function setSyncMeta(stateKey, meta) {
  const allMeta = getSyncMeta()
  allMeta[stateKey] = {
    ...(allMeta[stateKey] || {}),
    ...meta,
    checked_at: new Date().toISOString(),
  }
  storageService.set(SYNC_META_KEY, allMeta)
}

export function markClientStateLocalUpdate(stateKey) {
  setSyncMeta(stateKey, {
    last_local_updated_at: new Date().toISOString(),
    last_dirty_at: '',
  })
}

function markClientStateDirty(stateKey) {
  setSyncMeta(stateKey, {
    last_dirty_at: new Date().toISOString(),
  })
}

function getEffectiveLocalUpdatedAt(meta) {
  if (!meta) return null
  const pushedAt = meta.last_local_updated_at
  const dirtyAt = meta.last_dirty_at
  if (!pushedAt && !dirtyAt) return null
  if (!pushedAt) return dirtyAt
  if (!dirtyAt) return pushedAt
  const pushedTime = Date.parse(pushedAt)
  const dirtyTime = Date.parse(dirtyAt)
  if (!Number.isFinite(pushedTime)) return dirtyAt
  if (!Number.isFinite(dirtyTime)) return pushedAt
  return dirtyTime > pushedTime ? dirtyAt : pushedAt
}

export function getClientStateSyncMeta(stateKey) {
  return getSyncMeta()[stateKey] || null
}

export function shouldApplyRemoteClientState(stateKey, remoteUpdatedAt) {
  // 远程从未写入过（空桶返回 updatedAt: ''）：任何策略下都不能用空数据覆盖本地
  if (!remoteUpdatedAt) return false

  const strategy = getCloudSyncConflictStrategy()
  if (strategy === 'remote') return true
  if (strategy === 'local') return false

  const meta = getClientStateSyncMeta(stateKey)
  const localUpdatedAt = getEffectiveLocalUpdatedAt(meta)
  if (!localUpdatedAt) return true

  const remoteTime = Date.parse(remoteUpdatedAt)
  const localTime = Date.parse(localUpdatedAt)
  if (!Number.isFinite(remoteTime) || !Number.isFinite(localTime)) return true
  return remoteTime > localTime
}

export async function fetchClientState(stateKey, options = {}) {
  if (!isCloudSyncEnabled()) return null

  const path = userStatePath(stateKey)
  if (!path) return null

  const response = await withClientStateRequestSlot(() =>
    clientStateApi.get(path, {
      headers: clientStateHeaders(),
      params:
        stateKey === 'history'
          ? {
              pageSize: options.pageSize,
              cursor: options.cursor || undefined,
            }
          : undefined,
    }),
  )
  const data = response.status === 404
    ? null
    : normalizeClientStateResponse(response, stateKey, '同步读取失败')

  // 服务端对从未写入的空桶返回 updatedAt: ''，视同「云端无数据」，
  // 避免 remote/forceRemote 策略下把本地数据清空。
  const isEmptyRemote = Boolean(data) && !data.updatedAt

  if (!data || isEmptyRemote) {
    if (response.status === 404 || isEmptyRemote) {
      setSyncMeta(stateKey, {
        enabled: true,
        last_error: '',
        remote_updated_at: '',
        last_remote_checked_at: new Date().toISOString(),
      })
    }
    return null
  }

  setSyncMeta(stateKey, {
    enabled: true,
    last_error: '',
    remote_updated_at: data.updatedAt,
    last_remote_checked_at: new Date().toISOString(),
  })
  if (stateKey !== 'history' || data.payload?.pagination?.hasMore !== true) {
    lastSyncedFingerprints.set(stateKey, clientStateFingerprint(data.payload))
  }
  return data
}

export async function pushClientState(stateKey, payload) {
  if (!isCloudSyncEnabled()) {
    return { success: false, skipped: true, reason: '云同步未开启' }
  }

  const path = userStatePath(stateKey)
  if (!path) {
    return { success: false, skipped: true, reason: '状态类型不支持' }
  }

  let prepared = prepareClientStatePayload(stateKey, payload)
  const fingerprint = clientStateFingerprint(prepared.payload)
  if (fingerprint && lastSyncedFingerprints.get(stateKey) === fingerprint) {
    setSyncMeta(stateKey, {
      enabled: true,
      last_error: '',
      last_dirty_at: '',
      last_unchanged_at: new Date().toISOString(),
    })
    return { success: true, skipped: true, reason: 'unchanged' }
  }
  let response = await withClientStateRequestSlot(() =>
    clientStateApi.put(path, prepared.payload, {
      headers: clientStateHeaders({
        'X-Client-Label': 'browser',
      }),
    }),
  )

  if (response.status === 413) {
    prepared = prepareClientStatePayload(stateKey, payload, { minItems: 40 })
    response = await withClientStateRequestSlot(() =>
      clientStateApi.put(path, prepared.payload, {
        headers: clientStateHeaders({
          'X-Client-Label': 'browser',
        }),
      }),
    )
  }

  const data = normalizeClientStateResponse(response, stateKey, '同步保存失败')

  if (!data) {
    return { success: false, skipped: true, reason: 'D1 未启用' }
  }

  lastSyncedFingerprints.set(
    stateKey,
    clientStateFingerprint(data.payload || prepared.payload),
  )

  if (prepared.trimmed) {
    setSyncMeta(stateKey, {
      enabled: true,
      last_error: '',
      last_trimmed_at: new Date().toISOString(),
      remote_updated_at: data.updatedAt,
      last_local_updated_at: new Date().toISOString(),
      last_dirty_at: '',
      last_pushed_at: new Date().toISOString(),
    })
    notifySyncIssue(stateKey, '', { trimmed: true })
  } else {
    setSyncMeta(stateKey, {
      enabled: true,
      last_error: '',
      remote_updated_at: data.updatedAt,
      last_local_updated_at: new Date().toISOString(),
      last_dirty_at: '',
      last_pushed_at: new Date().toISOString(),
    })
  }

  return data
}

export async function pushClientStateQuietly(stateKey, payload) {
  try {
    return await pushClientState(stateKey, payload)
  } catch (error) {
    const message = error?.message || '同步失败'
    setSyncMeta(stateKey, {
      enabled: true,
      last_error: message,
    })
    notifySyncIssue(stateKey, message)
    return { success: false, error }
  }
}

function readPayload(payloadOrFactory) {
  return typeof payloadOrFactory === 'function' ? payloadOrFactory() : payloadOrFactory
}

function settleResolvers(resolvers, result) {
  resolvers.forEach(({ resolve }) => resolve(result))
}

function rejectResolvers(resolvers, error) {
  resolvers.forEach(({ reject }) => reject(error))
}

async function flushScheduledClientStatePush(stateKey) {
  const entry = pendingPushes.get(stateKey)
  if (!entry) return

  if (entry.inFlight) {
    entry.timer = setTimeout(
      () => void flushScheduledClientStatePush(stateKey),
      Math.max(50, Math.min(entry.delayMs, 250)),
    )
    return
  }

  const payloadOrFactory = entry.payloadOrFactory
  const resolvers = entry.resolvers.splice(0)
  const version = entry.version
  entry.timer = null

  try {
    entry.inFlight = pushClientStateQuietly(stateKey, readPayload(payloadOrFactory))
    const result = await entry.inFlight
    settleResolvers(resolvers, result)
  } catch (error) {
    rejectResolvers(resolvers, error)
  } finally {
    entry.inFlight = null

    if (!entry.timer && entry.version !== version) {
      entry.timer = setTimeout(() => void flushScheduledClientStatePush(stateKey), 0)
    }

    if (!entry.timer && entry.resolvers.length === 0 && !entry.inFlight) {
      pendingPushes.delete(stateKey)
    }
  }
}

export function scheduleClientStatePushQuietly(stateKey, payloadOrFactory, options = {}) {
  if (!isCloudSyncEnabled()) {
    return Promise.resolve({ success: false, skipped: true, reason: '云同步未开启' })
  }

  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Math.max(0, Number(options.delayMs))
    : DEFAULT_PUSH_DEBOUNCE_MS

  markClientStateDirty(stateKey)

  let entry = pendingPushes.get(stateKey)
  if (!entry) {
    entry = {
      timer: null,
      inFlight: null,
      payloadOrFactory: null,
      resolvers: [],
      version: 0,
      delayMs,
    }
    pendingPushes.set(stateKey, entry)
  }

  entry.payloadOrFactory = payloadOrFactory
  entry.delayMs = delayMs
  entry.version += 1

  if (entry.timer) {
    clearTimeout(entry.timer)
  }

  const promise = new Promise((resolve, reject) => {
    entry.resolvers.push({ resolve, reject })
  })

  entry.timer = setTimeout(() => void flushScheduledClientStatePush(stateKey), delayMs)
  return promise
}

function flushAllScheduledClientStatePushes() {
  for (const [stateKey, entry] of pendingPushes) {
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
      void flushScheduledClientStatePush(stateKey)
    }
  }
}

// 关页/切后台时立即冲刷防抖队列，避免 650ms 窗口内的变更永远丢失
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAllScheduledClientStatePushes()
    }
  })
  window.addEventListener('pagehide', flushAllScheduledClientStatePushes)
}

export async function fetchClientStateQuietly(stateKey, options = {}) {
  try {
    return await fetchClientState(stateKey, options)
  } catch (error) {
    setSyncMeta(stateKey, {
      enabled: true,
      last_error: error?.message || '同步失败',
    })
    return null
  }
}

export async function appendCloudHistoryEventQuietly(item) {
  if (!isCloudSyncEnabled()) return { success: false, skipped: true }
  try {
    const response = await withClientStateRequestSlot(() =>
      clientStateApi.post('/user/history', item, { headers: clientStateHeaders() }),
    )
    return normalizeClientStateResponse(response, 'history', '历史记录同步失败')
  } catch (error) {
    setSyncMeta('history', { enabled: true, last_error: error?.message || '同步失败' })
    return { success: false, error }
  }
}

export async function deleteCloudHistoryQuietly(id = '') {
  if (!isCloudSyncEnabled()) return { success: false, skipped: true }
  try {
    const suffix = id ? `/${encodeURIComponent(id)}` : ''
    const response = await withClientStateRequestSlot(() =>
      clientStateApi.delete(`/user/history${suffix}`, { headers: clientStateHeaders() }),
    )
    return normalizeClientStateResponse(response, 'history', '历史记录删除同步失败')
  } catch (error) {
    setSyncMeta('history', { enabled: true, last_error: error?.message || '同步失败' })
    return { success: false, error }
  }
}

export async function fetchClientStateSummary() {
  const response = await clientStateApi.get('/user/data-summary', {
    headers: clientStateHeaders(),
  })

  if (response.status < 200 || response.status >= 300 || !isApiSuccess(response.data, response.status)) {
    throw new Error(getApiErrorMessage(response.data, `云端摘要读取失败(${response.status})`))
  }

  return getApiData(response.data)
}

export function clearClientStateSyncMeta() {
  storageService.set(SYNC_META_KEY, {})
}

export async function clearCloudClientState() {
  const response = await clientStateApi.delete('/user/data', {
    headers: clientStateHeaders(),
  })

  if (response.status < 200 || response.status >= 300 || !isApiSuccess(response.data, response.status)) {
    throw new Error(getApiErrorMessage(response.data, `清空云端失败(${response.status})`))
  }

  return getApiData(response.data)
}
