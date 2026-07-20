/**
 * 本地存储服务
 * 用于在浏览器中存储数据
 */

import notificationService from '@/services/notification'

// 存储键名前缀
const PREFIX = 'walleven_'
const ACCOUNT_SCOPE_KEY = `${PREFIX}active_account_scope`
const DEFAULT_SCOPE = 'guest'
const QUOTA_NOTICE_COOLDOWN_MS = 5 * 60 * 1000
let lastQuotaNoticeAt = 0
const GLOBAL_KEYS = new Set([
  'auth_session',
  'client_id',
  'cloud_sync_enabled',
  'cloud_sync_account_prefs',
  'cloud_sync_conflict_strategy',
  'cloud_sync_conflict_strategy_prefs',
  'local_scope_migration_v1',
])

function normalizeScope(scope = '') {
  const value = String(scope || '').trim()
  return value || DEFAULT_SCOPE
}

function getActiveScope() {
  try {
    return normalizeScope(localStorage.getItem(ACCOUNT_SCOPE_KEY) || DEFAULT_SCOPE)
  } catch {
    return DEFAULT_SCOPE
  }
}

function scopedRawKey(key, scope = getActiveScope()) {
  if (GLOBAL_KEYS.has(key)) return `${PREFIX}${key}`
  return `${PREFIX}${normalizeScope(scope)}_${key}`
}

function legacyRawKey(key) {
  return `${PREFIX}${key}`
}

function readRawJson(rawKey) {
  const serializedValue = localStorage.getItem(rawKey)
  if (serializedValue === null) return undefined
  return JSON.parse(serializedValue)
}

function writeRawJson(rawKey, value) {
  localStorage.setItem(rawKey, JSON.stringify(value))
}

function isQuotaExceededError(error) {
  if (!error) return false
  if (error.name === 'QuotaExceededError') return true
  if (error.code === 22 || error.code === 1014) return true
  return /quota|storage full|exceeded the quota/i.test(String(error.message || ''))
}

function notifyStorageQuotaWarning(key, { recovered = false } = {}) {
  const now = Date.now()
  if (now - lastQuotaNoticeAt < QUOTA_NOTICE_COOLDOWN_MS) return
  lastQuotaNoticeAt = now

  const hint = recovered
    ? '浏览器本地空间不足，已自动清理部分旧记录后继续保存。'
    : '浏览器本地存储空间已满，新的浏览/收藏记录可能无法保存。可在设置中清理历史，或导出后删除部分数据。'

  notificationService.warning(hint, {
    duration: 9000,
    position: 'top-right',
  })

  if (import.meta.env.DEV) {
    console.warn(`[storage] QuotaExceeded while saving "${key}"`, { recovered })
  }
}

function removeRawKey(rawKey) {
  localStorage.removeItem(rawKey)
}

// 本地存储服务
const storageService = {
  getActiveScope,

  setActiveScope(scope) {
    try {
      localStorage.setItem(ACCOUNT_SCOPE_KEY, normalizeScope(scope))
      return true
    } catch (error) {
      console.error('切换本地账号空间失败:', error)
      return false
    }
  },

  resetActiveScope() {
    return this.setActiveScope(DEFAULT_SCOPE)
  },

  isGlobalKey(key) {
    return GLOBAL_KEYS.has(key)
  },

  getRawKey(key, scope = getActiveScope()) {
    return scopedRawKey(key, scope)
  },

  getLegacyRawKey(key) {
    return legacyRawKey(key)
  },

  migrateLegacyValue(key, scope = getActiveScope(), options = {}) {
    if (GLOBAL_KEYS.has(key)) return false

    try {
      const fromKey = legacyRawKey(key)
      const toKey = scopedRawKey(key, scope)
      if (localStorage.getItem(fromKey) === null || localStorage.getItem(toKey) !== null) {
        return false
      }

      const raw = localStorage.getItem(fromKey)
      localStorage.setItem(toKey, raw)
      if (options.removeLegacy === true) {
        localStorage.removeItem(fromKey)
      }
      return true
    } catch (error) {
      console.error('迁移旧本地存储失败:', error)
      return false
    }
  },

  migrateKeysToScope(keys = [], scope = getActiveScope(), options = {}) {
    return keys.reduce(
      (count, key) => (this.migrateLegacyValue(key, scope, options) ? count + 1 : count),
      0,
    )
  },

  copyValueToScope(key, fromScope, toScope, options = {}) {
    if (GLOBAL_KEYS.has(key)) return false

    try {
      const fromKey = scopedRawKey(key, fromScope)
      const toKey = scopedRawKey(key, toScope)
      let raw = localStorage.getItem(fromKey)
      if (raw === null && normalizeScope(fromScope) === DEFAULT_SCOPE) {
        raw = localStorage.getItem(legacyRawKey(key))
      }
      if (raw === null || (options.overwrite !== true && localStorage.getItem(toKey) !== null)) {
        return false
      }
      localStorage.setItem(toKey, raw)
      return true
    } catch (error) {
      console.error('复制本地账号数据失败:', error)
      return false
    }
  },

  copyKeysBetweenScopes(keys = [], fromScope, toScope, options = {}) {
    return keys.reduce(
      (count, key) => (this.copyValueToScope(key, fromScope, toScope, options) ? count + 1 : count),
      0,
    )
  },

  /**
   * 保存数据到本地存储
   * @param {string} key - 存储键名
   * @param {any} value - 要存储的数据
   */
  set(key, value, options = {}) {
    const rawKey = scopedRawKey(key)
    try {
      writeRawJson(rawKey, value)
      return true
    } catch (error) {
      if (isQuotaExceededError(error) && typeof options.onQuotaExceeded === 'function') {
        try {
          const retryValue = options.onQuotaExceeded(value, key)
          if (retryValue !== undefined) {
            writeRawJson(rawKey, retryValue)
            if (!options.silent) notifyStorageQuotaWarning(key, { recovered: true })
            return true
          }
        } catch (retryError) {
          if (!options.silent) {
            console.error('保存数据到本地存储失败（重试后仍失败）:', retryError)
          }
        }
      }

      if (!options.silent) {
        if (isQuotaExceededError(error)) {
          notifyStorageQuotaWarning(key, { recovered: false })
        }
        console.error('保存数据到本地存储失败:', error)
      }
      return false
    }
  },

  isQuotaExceededError,

  /**
   * 从本地存储获取数据
   * @param {string} key - 存储键名
   * @param {any} defaultValue - 默认值，如果没有找到数据则返回此值
   * @returns {any} 存储的数据或默认值
   */
  get(key, defaultValue = null) {
    try {
      const prefixedKey = scopedRawKey(key)
      let value = readRawJson(prefixedKey)
      if (value === undefined && !GLOBAL_KEYS.has(key) && getActiveScope() === DEFAULT_SCOPE) {
        value = readRawJson(legacyRawKey(key))
      }
      if (value === undefined) {
        return defaultValue
      }
      return value
    } catch (error) {
      console.error('从本地存储获取数据失败:', error)
      return defaultValue
    }
  },

  /**
   * 从本地存储删除数据
   * @param {string} key - 存储键名
   */
  remove(key) {
    try {
      removeRawKey(scopedRawKey(key))
      return true
    } catch (error) {
      console.error('从本地存储删除数据失败:', error)
      return false
    }
  },

  /**
   * 清除所有本地存储数据
   */
  clear() {
    try {
      // 只清除以PREFIX开头的项
      Object.keys(localStorage).forEach((key) => {
        if (
          key.startsWith(PREFIX) &&
          key !== ACCOUNT_SCOPE_KEY &&
          ![...GLOBAL_KEYS].some((globalKey) => key === legacyRawKey(globalKey))
        ) {
          localStorage.removeItem(key)
        }
      })
      return true
    } catch (error) {
      console.error('清除本地存储数据失败:', error)
      return false
    }
  },

  /**
   * 获取所有本地存储数据
   * @returns {Object} 所有存储的数据
   */
  getAll() {
    try {
      const data = {}
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(PREFIX)) {
          const scopePrefix = `${PREFIX}${getActiveScope()}_`
          if (!key.startsWith(scopePrefix)) return
          const actualKey = key.substring(scopePrefix.length)
          data[actualKey] = JSON.parse(localStorage.getItem(key))
        }
      })
      return data
    } catch (error) {
      console.error('获取所有本地存储数据失败:', error)
      return {}
    }
  },

  /**
   * 导出指定键的数据为JSON文件
   * @param {string} key - 存储键名
   * @param {string} fileName - 导出的文件名（不包含扩展名）
   * @returns {boolean} 是否成功导出
   */
  exportData(key, fileName = 'exported_data') {
    try {
      const data = this.get(key)
      if (!data) {
        console.error('导出数据失败: 没有找到数据')
        return false
      }

      const jsonData = JSON.stringify(data, null, 2)
      const blob = new Blob([jsonData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      return true
    } catch (error) {
      console.error('导出数据失败:', error)
      return false
    }
  },

  /**
   * 从JSON文件导入数据
   * @param {File} file - 要导入的JSON文件
   * @param {string} key - 存储键名
   * @returns {Promise<boolean>} 是否成功导入
   */
  importData(file, key) {
    return new Promise((resolve, reject) => {
      try {
        if (!file || file.type !== 'application/json') {
          console.error('导入数据失败: 文件类型不正确')
          resolve(false)
          return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target.result)
            this.set(key, data)
            resolve(true)
          } catch (error) {
            console.error('解析导入数据失败:', error)
            resolve(false)
          }
        }
        reader.onerror = () => {
          console.error('读取导入文件失败')
          resolve(false)
        }
        reader.readAsText(file)
      } catch (error) {
        console.error('导入数据失败:', error)
        resolve(false)
      }
    })
  },
}

export default storageService

/**
 * 使用存储服务的Hook
 * @returns {Object} 存储服务对象
 */
export function useStorageService() {
  return {
    /**
     * 设置存储项
     * @param {string} key - 键名
     * @param {string} value - 值
     */
    setItem(key, value) {
      return storageService.set(key, value)
    },

    /**
     * 获取存储项
     * @param {string} key - 键名
     * @returns {string|null} 存储的值或null
     */
    getItem(key) {
      return storageService.get(key)
    },

    /**
     * 移除存储项
     * @param {string} key - 键名
     */
    removeItem(key) {
      return storageService.remove(key)
    },

    /**
     * 清空所有存储
     */
    clear() {
      return storageService.clear()
    },

    /**
     * 导出数据
     * @param {string} key - 键名
     * @param {string} fileName - 文件名
     */
    exportData(key, fileName) {
      return storageService.exportData(key, fileName)
    },

    /**
     * 导入数据
     * @param {File} file - 文件
     * @param {string} key - 键名
     */
    importData(file, key) {
      return storageService.importData(file, key)
    },
  }
}
