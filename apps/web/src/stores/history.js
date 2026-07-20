import notificationService from '@/services/notification'
import {
  appendCloudHistoryEventQuietly,
  deleteCloudHistoryQuietly,
  fetchClientStateQuietly,
  getCloudSyncConflictStrategy,
  isCloudSyncEnabled,
  scheduleClientStatePushQuietly,
  shouldApplyRemoteClientState,
} from '@/services/clientState'
import storageService from '@/services/storage'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useRuntimeConfigStore } from './runtimeConfig'

export const useHistoryStore = defineStore('history', () => {
  // 状态
  const history = ref([])
  const isLoading = ref(false)
  const error = ref(null)
  const isLoadingMore = ref(false)
  const historyTotal = ref(0)
  const historyHasMore = ref(false)
  const historyNextCursor = ref('')
  const maxHistoryItems = ref(500) // 增加最大历史记录数量
  const currentSession = ref(generateSessionId()) // 当前会话ID
  const statistics = ref({
    mostViewed: [], // 最常浏览的壁纸
    viewsByCategory: {}, // 按分类统计浏览次数
    viewsByTime: {}, // 按时间段统计浏览次数
    totalViewDuration: 0, // 总浏览时长（秒）
    lastUpdated: null, // 统计数据最后更新时间
  })
  let initPromise = null
  let hasInitialized = false

  // 计算属性
  const historyCount = computed(() => Math.max(history.value.length, historyTotal.value))
  const isInHistory = computed(() => (id) => history.value.some((item) => item.id === id))

  function syncHistoryState() {
    if (isLoading.value) {
      return Promise.resolve({
        success: false,
        skipped: true,
        reason: 'history hydrating',
      })
    }
    if (historyHasMore.value) {
      return Promise.resolve({
        success: false,
        skipped: true,
        reason: 'history pages are not fully loaded',
      })
    }

    return scheduleClientStatePushQuietly('history', () => ({
      history: history.value,
      statistics: statistics.value,
      currentSession: currentSession.value,
      maxHistoryItems: maxHistoryItems.value,
    }))
  }

  // 按日期分组的历史记录
  const groupedHistory = computed(() => {
    const groups = {}

    history.value.forEach((item) => {
      const date = new Date(item.viewed_at || new Date())
      const dateStr = date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

      if (!groups[dateStr]) {
        groups[dateStr] = []
      }

      groups[dateStr].push(item)
    })

    // 转换为数组格式，方便在模板中使用
    return Object.entries(groups)
      .map(([date, items]) => ({
        date,
        items,
        timestamp: new Date(items[0].viewed_at).getTime(), // 用于排序
      }))
      .sort((a, b) => b.timestamp - a.timestamp) // 按日期降序排序
  })

  function mergeHistoryLists(remoteHistory = [], localHistory = []) {
    const historyMap = new Map()
    ;[...remoteHistory, ...localHistory].forEach((item) => {
      if (!item?.id) return
      const existing = historyMap.get(item.id) || {}
      historyMap.set(item.id, {
        ...existing,
        ...item,
        view_count: Math.max(Number(existing.view_count || 0), Number(item.view_count || 0)),
      })
    })

    return Array.from(historyMap.values())
      .sort((a, b) => Date.parse(b.viewed_at || 0) - Date.parse(a.viewed_at || 0))
  }

  function compactHistoryEntry(item) {
    if (!item || typeof item !== 'object') return item
    return {
      id: item.id,
      url: item.url,
      path: item.path,
      resolution: item.resolution,
      category: item.category,
      purity: item.purity,
      tags: item.tags,
      thumbnail: item.thumbnail,
      thumbs: item.thumbs,
      viewed_at: item.viewed_at,
      first_viewed_at: item.first_viewed_at,
      view_count: item.view_count,
      view_duration: item.view_duration,
      session_id: item.session_id,
      source: item.source,
      search_query: item.search_query,
    }
  }

  function buildHistoryStoragePayload(items = history.value) {
    return items.map(compactHistoryEntry)
  }

  function persistHistory() {
    const payload = buildHistoryStoragePayload()
    return storageService.set('history', payload, {
      onQuotaExceeded: () => {
        const nextLength = Math.max(80, Math.floor(history.value.length * 0.7))
        return buildHistoryStoragePayload(history.value.slice(0, nextLength))
      },
    })
  }

  function applyHistoryPayload(remotePayload = {}, strategy = 'remote') {
    const remoteHistory = Array.isArray(remotePayload.history) ? remotePayload.history : []
    const remoteStatistics =
      remotePayload.statistics && typeof remotePayload.statistics === 'object'
        ? remotePayload.statistics
        : null

    if (strategy === 'merge') {
      history.value = mergeHistoryLists(remoteHistory, history.value)
    } else if (strategy === 'remote') {
      history.value = remoteHistory
    }

    const pagination = remotePayload.pagination || {}
    historyTotal.value = Math.max(history.value.length, Number(pagination.total || remoteHistory.length))
    historyHasMore.value = pagination.hasMore === true
    historyNextCursor.value = String(pagination.nextCursor || '')

    storageService.set('history', buildHistoryStoragePayload(), { silent: true })

    if (remotePayload.currentSession && strategy === 'remote') {
      currentSession.value = remotePayload.currentSession
    }

    if (
      remotePayload.maxHistoryItems &&
      Number.isFinite(Number(remotePayload.maxHistoryItems)) &&
      strategy === 'remote'
    ) {
      maxHistoryItems.value = Number(remotePayload.maxHistoryItems)
    }

    if (remoteStatistics && strategy === 'remote') {
      statistics.value = remoteStatistics
      storageService.set('history_statistics', statistics.value)
      return false
    }

    return true
  }

  // 初始化历史记录
  async function initHistory(options = {}) {
    if (hasInitialized && !options.forceRemote) return true
    if (initPromise) return initPromise

    initPromise = loadHistory(options)
    try {
      const result = await initPromise
      hasInitialized = true
      return result
    } finally {
      initPromise = null
    }
  }

  async function reloadHistory(options = {}) {
    hasInitialized = false
    return initHistory(options)
  }

  async function mergeCloudHistory() {
    const remoteState = await fetchClientStateQuietly('history')
    const remotePayload = remoteState?.payload || {}
    const strategy = getCloudSyncConflictStrategy()
    if (strategy === 'remote' || strategy === 'merge') {
      applyHistoryPayload(remotePayload, strategy)
    }
    updateStatistics({ syncRemote: false })
    hasInitialized = true
    return syncHistoryState()
  }

  async function loadHistory(options = {}) {
    try {
      isLoading.value = true
      error.value = null

      // 从本地存储加载历史记录
      const storedHistory = storageService.get('history', [])
      history.value = Array.isArray(storedHistory) ? storedHistory : []
      if (!Array.isArray(storedHistory)) {
        persistHistory()
      }

      // 从本地存储加载统计数据
      const storedStatistics = storageService.get('history_statistics', null)
      if (storedStatistics && typeof storedStatistics === 'object') {
        statistics.value = storedStatistics
      } else {
        // 如果没有统计数据，则生成
        updateStatistics({ syncRemote: false })
      }

      // 重置会话ID
      resetSessionId()

      const remoteState = await fetchClientStateQuietly('history', { pageSize: 40 })
      if (remoteState?.payload) {
        const strategy = options.conflictStrategy || getCloudSyncConflictStrategy()
        const shouldApplyRemote =
          strategy === 'merge' ||
          (strategy !== 'local' &&
            (options.forceRemote || shouldApplyRemoteClientState('history', remoteState.updatedAt)))

        if (shouldApplyRemote) {
          const shouldRebuildStatistics = applyHistoryPayload(
            remoteState.payload,
            strategy === 'merge' ? 'merge' : 'remote',
          )
          if (shouldRebuildStatistics) {
            updateStatistics({ syncRemote: false })
          }
        } else if (strategy === 'local') {
          void syncHistoryState()
        }
      } else if (isCloudSyncEnabled()) {
        void syncHistoryState()
      }

      isLoading.value = false
      return true
    } catch (err) {
      console.error('初始化历史记录失败:', err)
      error.value = '加载历史记录失败'
      isLoading.value = false

      // 显示错误通知
      notificationService.error('加载历史记录失败', {
        duration: 5000,
        position: 'top-right',
      })

      throw err
    }
  }

  async function loadMoreHistory() {
    if (isLoadingMore.value || !historyHasMore.value || !historyNextCursor.value) return false
    isLoadingMore.value = true
    try {
      const remoteState = await fetchClientStateQuietly('history', {
        pageSize: 40,
        cursor: historyNextCursor.value,
      })
      const payload = remoteState?.payload || {}
      const incoming = Array.isArray(payload.history) ? payload.history : []
      history.value = mergeHistoryLists(history.value, incoming)
      const pagination = payload.pagination || {}
      historyTotal.value = Math.max(history.value.length, Number(pagination.total || 0))
      historyHasMore.value = pagination.hasMore === true
      historyNextCursor.value = String(pagination.nextCursor || '')
      persistHistory()
      updateStatistics({ syncRemote: false })
      return incoming.length > 0
    } finally {
      isLoadingMore.value = false
    }
  }

  // 添加历史记录
  function addHistory(wallpaper, options = {}) {
    try {
      const runtimeConfigStore = useRuntimeConfigStore()
      if (!runtimeConfigStore.canUse('history')) {
        return false
      }

      // 获取当前路由和来源信息
      const source = options.source || '未知来源'
      const referrer = options.referrer || ''
      const searchQuery = options.searchQuery || ''
      const viewDuration = options.viewDuration || 0

      // 如果已经在历史记录中，先获取旧记录的信息，然后移除
      let previousViewCount = 0
      let firstViewedAt = new Date().toISOString()
      const alreadyTracked = isInHistory.value(wallpaper.id)

      if (alreadyTracked) {
        const existingItem = history.value.find((item) => item.id === wallpaper.id)
        if (existingItem) {
          previousViewCount = existingItem.view_count || 0
          firstViewedAt = existingItem.first_viewed_at || existingItem.viewed_at
        }
        history.value = history.value.filter((item) => item.id !== wallpaper.id)
      }

      // 添加更详细的历史记录数据
      const historyData = {
        ...wallpaper,
        viewed_at: new Date().toISOString(),
        first_viewed_at: firstViewedAt,
        view_count: previousViewCount + 1,
        view_duration: viewDuration,
        session_id: currentSession.value,
        source: source,
        referrer: referrer,
        search_query: searchQuery,
        device: {
          screen_width: window.screen.width,
          screen_height: window.screen.height,
          user_agent: navigator.userAgent,
        },
      }

      // 添加到历史记录列表的开头
      history.value.unshift(historyData)
      historyTotal.value = Math.max(
        history.value.length,
        historyTotal.value + (alreadyTracked ? 0 : 1),
      )

      // 限制历史记录数量
      if (!isCloudSyncEnabled() && history.value.length > maxHistoryItems.value) {
        history.value = history.value.slice(0, maxHistoryItems.value)
      }

      // 保存到本地存储
      if (!persistHistory()) {
        throw new Error('history persist failed')
      }

      // 更新统计数据
      updateStatistics({ syncRemote: false })
      void appendCloudHistoryEventQuietly(compactHistoryEntry(historyData))

      return true
    } catch (err) {
      console.error('添加历史记录失败:', err)
      error.value = '添加历史记录失败'

      // 显示错误通知
      notificationService.error('浏览记录未能保存到本地，可能是浏览器存储空间已满', {
        duration: 5000,
        position: 'top-right',
      })

      return false
    }
  }

  // 移除历史记录
  function removeHistory(id) {
    try {
      // 从历史记录列表中移除
      history.value = history.value.filter((item) => item.id !== id)
      historyTotal.value = Math.max(history.value.length, historyTotal.value - 1)

      // 保存到本地存储
      persistHistory()

      // 显示成功通知
      notificationService.info('已从历史记录中移除', {
        duration: 3000,
        position: 'top-right',
      })

      updateStatistics({ syncRemote: false })
      void deleteCloudHistoryQuietly(id)

      return true
    } catch (err) {
      console.error('移除历史记录失败:', err)
      error.value = '移除历史记录失败'

      // 显示错误通知
      notificationService.error('移除历史记录失败', {
        duration: 5000,
        position: 'top-right',
      })

      return false
    }
  }

  // 清空历史记录
  function clearHistory() {
    try {
      // 清空历史记录列表
      history.value = []
      historyTotal.value = 0
      historyHasMore.value = false
      historyNextCursor.value = ''

      // 保存到本地存储
      persistHistory()

      updateStatistics({ syncRemote: false })
      void deleteCloudHistoryQuietly()

      // 显示成功通知
      notificationService.success('已清空所有历史记录', {
        duration: 3000,
        position: 'top-right',
      })

      return true
    } catch (err) {
      console.error('清空历史记录失败:', err)
      error.value = '清空历史记录失败'

      // 显示错误通知
      notificationService.error('清空历史记录失败', {
        duration: 5000,
        position: 'top-right',
      })

      return false
    }
  }

  // 获取最近历史记录
  function getRecentHistory(limit = 8) {
    return history.value.slice(0, limit)
  }

  // 导出历史记录
  function exportHistory() {
    try {
      const result = storageService.exportData('history', 'wallhaven_pepe_history')

      if (result) {
        // 显示成功通知
        notificationService.success('历史记录导出成功', {
          duration: 3000,
          position: 'top-right',
        })
      } else {
        // 显示错误通知
        notificationService.error('历史记录导出失败', {
          duration: 5000,
          position: 'top-right',
        })
      }

      return result
    } catch (err) {
      console.error('导出历史记录失败:', err)

      // 显示错误通知
      notificationService.error('导出历史记录失败', {
        duration: 5000,
        position: 'top-right',
      })

      return false
    }
  }

  // 导入历史记录
  async function importHistory(file) {
    try {
      isLoading.value = true

      const result = await storageService.importData(file, 'history')

      if (result) {
        const importedHistory = storageService.get('history', [])
        history.value = Array.isArray(importedHistory) ? importedHistory : []
        if (!Array.isArray(importedHistory)) {
          persistHistory()
        }
        resetSessionId()
        updateStatistics({ syncRemote: false })
        hasInitialized = true
        void syncHistoryState()

        // 显示成功通知
        notificationService.success('历史记录导入成功', {
          duration: 3000,
          position: 'top-right',
        })
      } else {
        // 显示错误通知
        notificationService.error('历史记录导入失败', {
          duration: 5000,
          position: 'top-right',
        })
      }

      isLoading.value = false
      return result
    } catch (err) {
      console.error('导入历史记录失败:', err)
      isLoading.value = false

      // 显示错误通知
      notificationService.error('导入历史记录失败', {
        duration: 5000,
        position: 'top-right',
      })

      return false
    }
  }

  // 生成会话ID
  function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
  }

  // 更新统计数据
  function updateStatistics(options = {}) {
    try {
      const syncRemote = options.syncRemote === true
      // 创建壁纸ID到浏览次数的映射
      const viewCounts = {}
      const categoryViews = {}
      const timeViews = {}
      let totalDuration = 0

      // 创建ID到壁纸的映射，用于获取最新的壁纸信息
      const wallpaperMap = new Map()

      // 首先遍历历史记录，为每个ID找到最新的壁纸信息
      history.value.forEach((item) => {
        if (!item.id) return

        // 如果这个ID还没有记录，或者这个记录比已有的更新，则更新记录
        if (
          !wallpaperMap.has(item.id) ||
          new Date(item.viewed_at) > new Date(wallpaperMap.get(item.id).viewed_at)
        ) {
          wallpaperMap.set(item.id, item)
        }
      })

      // 然后再次遍历历史记录，统计各项数据
      history.value.forEach((item) => {
        if (!item.id) return

        // 统计浏览次数 - 使用实际的view_count属性或增加计数
        if (item.view_count && item.view_count > 1) {
          // 如果项目有view_count属性，使用它
          viewCounts[item.id] = Math.max(viewCounts[item.id] || 0, item.view_count)
        } else {
          // 否则增加计数
          viewCounts[item.id] = (viewCounts[item.id] || 0) + 1
        }

        // 统计分类浏览次数
        if (item.category) {
          categoryViews[item.category] = (categoryViews[item.category] || 0) + 1
        }

        // 统计时间段浏览次数
        if (item.viewed_at) {
          const hour = new Date(item.viewed_at).getHours()
          const timeSlot = Math.floor(hour / 4) // 将24小时分为6个时间段
          timeViews[timeSlot] = (timeViews[timeSlot] || 0) + 1
        }

        // 累计浏览时长
        if (item.view_duration) {
          totalDuration += item.view_duration
        }
      })

      // 转换为排序后的数组
      const mostViewed = Object.entries(viewCounts)
        .map(([id, count]) => {
          // 使用之前创建的映射获取最新的壁纸信息
          const wallpaper = wallpaperMap.get(id)
          return {
            id,
            count,
            thumbnail: wallpaper ? wallpaper.thumbnail : null,
            resolution: wallpaper ? wallpaper.resolution : null,
          }
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10) // 只保留前10个

      // 更新统计数据
      statistics.value = {
        mostViewed,
        viewsByCategory: categoryViews,
        viewsByTime: timeViews,
        totalViewDuration: totalDuration,
        lastUpdated: new Date().toISOString(),
      }

      // 保存统计数据到本地存储
      storageService.set('history_statistics', statistics.value)
      if (syncRemote) {
        void syncHistoryState()
      }
    } catch (err) {
      console.error('更新统计数据失败:', err)
    }
  }

  // 获取浏览统计数据
  function getStatistics() {
    return statistics.value
  }

  // 获取当前会话ID
  function getSessionId() {
    return currentSession.value
  }

  // 重置会话ID
  function resetSessionId() {
    currentSession.value = generateSessionId()
  }

  // 获取按来源分组的历史记录
  function getHistoryBySource() {
    const sources = {}

    history.value.forEach((item) => {
      if (item.source) {
        if (!sources[item.source]) {
          sources[item.source] = []
        }
        sources[item.source].push(item)
      }
    })

    return sources
  }

  // 获取按会话分组的历史记录
  function getHistoryBySession() {
    const sessions = {}

    history.value.forEach((item) => {
      if (item.session_id) {
        if (!sessions[item.session_id]) {
          sessions[item.session_id] = []
        }
        sessions[item.session_id].push(item)
      }
    })

    return sessions
  }

  // 获取特定日期的历史记录
  function getHistoryByDate(date) {
    const targetDate = new Date(date)
    targetDate.setHours(0, 0, 0, 0)

    const nextDate = new Date(targetDate)
    nextDate.setDate(nextDate.getDate() + 1)

    return history.value.filter((item) => {
      const itemDate = new Date(item.viewed_at)
      return itemDate >= targetDate && itemDate < nextDate
    })
  }

  // 获取历史记录日历数据（每天的浏览次数）
  function getHistoryCalendar() {
    const calendar = {}

    history.value.forEach((item) => {
      if (item.viewed_at) {
        const date = new Date(item.viewed_at).toISOString().split('T')[0]
        calendar[date] = (calendar[date] || 0) + 1
      }
    })

    return calendar
  }

  return {
    history,
    isLoading,
    isLoadingMore,
    error,
    historyCount,
    historyHasMore,
    isInHistory,
    groupedHistory,
    maxHistoryItems,
    statistics,
    currentSession,
    initHistory,
    reloadHistory,
    mergeCloudHistory,
    loadMoreHistory,
    syncHistoryState,
    addHistory,
    removeHistory,
    clearHistory,
    getRecentHistory,
    exportHistory,
    importHistory,
    updateStatistics,
    getStatistics,
    getSessionId,
    resetSessionId,
    getHistoryBySource,
    getHistoryBySession,
    getHistoryByDate,
    getHistoryCalendar,
  }
})
