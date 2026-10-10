import storageService from './storage'

const GLOBAL_LOCAL_KEYS = new Set([
  'walleven_image_cache',
  'walleven_search_pending_pool',
  'walleven_search_hidden_ids',
  'walleven_search_results_cache_v1',
])

function normalizeScope(scope = '') {
  return String(scope || '').trim() || 'guest'
}

export function getScopedLocalStorageKey(key, scope = storageService.getActiveScope()) {
  if (GLOBAL_LOCAL_KEYS.has(key)) return key
  return `walleven_${normalizeScope(scope)}_local_${key}`
}

function getLegacyLocalStorageKey(key) {
  return key
}

export function getScopedLocalItem(key) {
  try {
    const scopedKey = getScopedLocalStorageKey(key)
    const scopedValue = localStorage.getItem(scopedKey)
    if (scopedValue !== null) return scopedValue
    if (storageService.getActiveScope() === 'guest') {
      return localStorage.getItem(getLegacyLocalStorageKey(key))
    }
    return null
  } catch {
    return null
  }
}

export function setScopedLocalItem(key, value) {
  try {
    localStorage.setItem(getScopedLocalStorageKey(key), value)
    return true
  } catch {
    return false
  }
}

export function removeScopedLocalItem(key) {
  try {
    localStorage.removeItem(getScopedLocalStorageKey(key))
    return true
  } catch {
    return false
  }
}

export function migrateScopedLocalStorageKeys(keys = [], scope = storageService.getActiveScope()) {
  return keys.reduce((count, key) => {
    if (GLOBAL_LOCAL_KEYS.has(key)) return count

    try {
      const legacyKey = getLegacyLocalStorageKey(key)
      const scopedKey = getScopedLocalStorageKey(key, scope)
      const raw = localStorage.getItem(legacyKey)
      if (raw === null || localStorage.getItem(scopedKey) !== null) return count
      localStorage.setItem(scopedKey, raw)
      return count + 1
    } catch {
      return count
    }
  }, 0)
}

export function copyScopedLocalStorageKeys(keys = [], fromScope, toScope, options = {}) {
  return keys.reduce((count, key) => {
    if (GLOBAL_LOCAL_KEYS.has(key)) return count

    try {
      let fromKey = getScopedLocalStorageKey(key, fromScope)
      let raw = localStorage.getItem(fromKey)
      if (raw === null && normalizeScope(fromScope) === 'guest') {
        raw = localStorage.getItem(getLegacyLocalStorageKey(key))
      }

      const toKey = getScopedLocalStorageKey(key, toScope)
      if (raw === null || (options.overwrite !== true && localStorage.getItem(toKey) !== null)) {
        return count
      }

      localStorage.setItem(toKey, raw)
      return count + 1
    } catch {
      return count
    }
  }, 0)
}
