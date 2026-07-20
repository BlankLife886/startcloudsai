import { wallpaperApi } from '@/services/api'
import {
  fetchClientStateQuietly,
  getCloudSyncConflictStrategy,
  isCloudSyncEnabled,
  scheduleClientStatePushQuietly,
  shouldApplyRemoteClientState,
} from '@/services/clientState'
import notificationService from '@/services/notification'
import storageService from '@/services/storage'
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from './settings'
import { useRuntimeConfigStore } from './runtimeConfig'
import {
  BROWSER_DOWNLOAD_LAUNCH_DELAY_MS,
  DOWNLOAD_STATUS,
  MAX_GUARDED_RETRIES,
  TERMINAL_DOWNLOAD_STATUSES,
} from './downloads/constants'
import { createBrowserDownloadActions } from './downloads/browser'
import { resolveDownloadSavePath } from './downloads/helpers'

const MAX_STORED_DOWNLOADS = 60

export const useDownloadsStore = defineStore('downloads', () => {
  // 获取设置store
  const settingsStore = useSettingsStore()

  // 状态
  const downloads = ref([])
  const isLoading = ref(false)
  const error = ref(null)
  const activeDownloads = ref(0)
  let pendingCheckTimer = null
  let beforeUnloadWarningRegistered = false
  let isCheckingPendingDownloads = false
  let confirmResolver = null

  function syncDownloadsState() {
    if (isLoading.value) {
      return Promise.resolve({
        success: false,
        skipped: true,
        reason: 'downloads hydrating',
      })
    }

    return scheduleClientStatePushQuietly('downloads', () => ({
      downloads: compactDownloadRecords(downloads.value),
      activeDownloads: activeDownloads.value,
      updatedAt: new Date().toISOString(),
    }))
  }

  function mergeDownloadLists(remoteDownloads = [], localDownloads = []) {
    const downloadMap = new Map()
    ;[...remoteDownloads, ...localDownloads].forEach((item) => {
      if (!item?.id) return
      const existing = downloadMap.get(item.id) || {}
      downloadMap.set(item.id, {
        ...existing,
        ...item,
        updated_at: item.updated_at || item.completed_at || item.started_at || item.created_at || existing.updated_at,
      })
    })
    return Array.from(downloadMap.values())
      .sort((left, right) => {
        const leftTime = Date.parse(left.updated_at || left.completed_at || left.started_at || left.created_at || 0)
        const rightTime = Date.parse(right.updated_at || right.completed_at || right.started_at || right.created_at || 0)
        return rightTime - leftTime
      })
      .slice(0, MAX_STORED_DOWNLOADS)
  }

  function applyDownloadsPayload(remotePayload = {}, strategy = 'remote') {
    const remoteDownloads = Array.isArray(remotePayload.downloads) ? remotePayload.downloads : []
    if (strategy === 'merge') {
      downloads.value = normalizeStoredDownloads(mergeDownloadLists(remoteDownloads, downloads.value))
    } else if (strategy === 'remote') {
      downloads.value = normalizeStoredDownloads(remoteDownloads)
    }
  }

  function createDownloadGuardState() {
    return {
      confirmationVisible: false,
      confirmationCount: 0,
      sessionActive: false,
      totalCount: 0,
      queuedCount: 0,
      completedCount: 0,
      failedCount: 0,
      progress: 0,
      currentTaskLabel: '',
      statusText: '',
      taskIds: [],
    }
  }

  const downloadGuard = ref(createDownloadGuardState())

  // 计算属性
  const downloadCount = computed(() => downloads.value.length)
  const pendingDownloads = computed(() =>
    downloads.value.filter((d) => d.status === DOWNLOAD_STATUS.PENDING),
  )
  const activeDownloadsList = computed(() =>
    downloads.value.filter((d) => d.status === DOWNLOAD_STATUS.DOWNLOADING),
  )
  const completedDownloads = computed(() =>
    downloads.value.filter((d) => d.status === DOWNLOAD_STATUS.COMPLETED),
  )
  const failedDownloads = computed(() =>
    downloads.value.filter((d) => d.status === DOWNLOAD_STATUS.FAILED),
  )

  const trackedLockTasks = computed(() => {
    const taskIdSet = new Set(downloadGuard.value.taskIds)
    if (!taskIdSet.size) return []
    return downloads.value.filter((download) => taskIdSet.has(download.id))
  })

  const downloadConfirmationVisible = computed(() => downloadGuard.value.confirmationVisible)
  const downloadConfirmationCount = computed(() => downloadGuard.value.confirmationCount)
  const downloadLockVisible = computed(() => downloadGuard.value.sessionActive)
  const downloadLockTotal = computed(() => downloadGuard.value.totalCount)
  const downloadLockQueued = computed(() => downloadGuard.value.queuedCount)
  const downloadLockCompleted = computed(() => downloadGuard.value.completedCount)
  const downloadLockFailed = computed(() => downloadGuard.value.failedCount)
  const downloadLockProgress = computed(() => downloadGuard.value.progress)
  const downloadLockCurrentTask = computed(() => downloadGuard.value.currentTaskLabel)
  const downloadLockStatusText = computed(() => downloadGuard.value.statusText)

  function resolveDownloadConfirmation(confirmed) {
    const resolver = confirmResolver
    confirmResolver = null

    downloadGuard.value.confirmationVisible = false
    downloadGuard.value.confirmationCount = 0

    if (resolver) resolver(confirmed)
  }

  function confirmDownloadConfirmation() {
    resolveDownloadConfirmation(true)
  }

  function cancelDownloadConfirmation() {
    resolveDownloadConfirmation(false)
  }

  async function requestDownloadConfirmation(taskCount) {
    if (downloadGuard.value.sessionActive) {
      notificationService.warning('当前下载任务尚未完成，请稍候再发起新的下载', {
        duration: 4000,
        position: 'top-right',
      })
      return false
    }

    if (downloadGuard.value.confirmationVisible) {
      return false
    }

    downloadGuard.value.confirmationVisible = true
    downloadGuard.value.confirmationCount = taskCount

    return await new Promise((resolve) => {
      confirmResolver = resolve
    })
  }

  function startDownloadLockSession(totalCount) {
    downloadGuard.value.sessionActive = true
    downloadGuard.value.totalCount = totalCount
    downloadGuard.value.queuedCount = 0
    downloadGuard.value.completedCount = 0
    downloadGuard.value.failedCount = 0
    downloadGuard.value.progress = 0
    downloadGuard.value.currentTaskLabel = ''
    downloadGuard.value.statusText = '正在创建下载任务...'
    downloadGuard.value.taskIds = []
  }

  function updateDownloadLockQueueProgress(queuedCount) {
    if (!downloadGuard.value.sessionActive) return
    downloadGuard.value.queuedCount = queuedCount
    downloadGuard.value.statusText = `正在创建下载任务 (${queuedCount}/${downloadGuard.value.totalCount})`
    if (!downloadGuard.value.taskIds.length && downloadGuard.value.totalCount > 0) {
      downloadGuard.value.progress = Math.max(
        0,
        Math.min(20, Math.round((queuedCount / downloadGuard.value.totalCount) * 20)),
      )
    }
  }

  function bindDownloadLockTasks(taskIds) {
    if (!downloadGuard.value.sessionActive) return
    downloadGuard.value.taskIds = taskIds
    downloadGuard.value.statusText = '下载任务已创建，正在下载中...'
  }

  function endDownloadLockSession(stats = null) {
    if (!downloadGuard.value.sessionActive) return

    if (stats) {
      downloadGuard.value.completedCount = stats.completedCount
      downloadGuard.value.failedCount = stats.failedCount
      downloadGuard.value.progress = 100
      downloadGuard.value.currentTaskLabel = ''
      downloadGuard.value.statusText =
        stats.failedCount > 0
          ? `下载结束：成功 ${stats.completedCount}，失败 ${stats.failedCount}`
          : `下载完成：共 ${stats.completedCount} 个任务`
    }

    setTimeout(() => {
      downloadGuard.value = createDownloadGuardState()
    }, 300)
  }

  function handleDownloadLockFailure(message) {
    notificationService.error(message, {
      duration: 5000,
      position: 'top-right',
    })
    endDownloadLockSession({
      completedCount: 0,
      failedCount: downloadGuard.value.totalCount || 1,
    })
  }

  watch(
    trackedLockTasks,
    (tasks) => {
      if (!downloadGuard.value.sessionActive || !tasks.length) return

      let completedCount = 0
      let failedCount = 0
      let progressAccumulator = 0
      let currentTask = null

      for (const task of tasks) {
        const normalizedProgress = Math.max(0, Math.min(100, Number(task.progress) || 0))
        const isTerminal = TERMINAL_DOWNLOAD_STATUSES.has(task.status)
        const effectiveProgress = isTerminal ? 100 : normalizedProgress
        progressAccumulator += effectiveProgress

        if (task.status === DOWNLOAD_STATUS.COMPLETED) completedCount += 1
        if (task.status === DOWNLOAD_STATUS.FAILED || task.status === DOWNLOAD_STATUS.CANCELED) {
          failedCount += 1
        }

        if (!currentTask && task.status === DOWNLOAD_STATUS.DOWNLOADING) {
          currentTask = task
        }
      }

      if (!currentTask) {
        currentTask = tasks.find((task) => task.status === DOWNLOAD_STATUS.PENDING) || null
      }

      const totalCount = tasks.length
      const finishedCount = completedCount + failedCount

      downloadGuard.value.completedCount = completedCount
      downloadGuard.value.failedCount = failedCount
      downloadGuard.value.progress = Math.max(
        downloadGuard.value.progress,
        Math.round(progressAccumulator / totalCount),
      )
      downloadGuard.value.currentTaskLabel = currentTask ? `壁纸 ${currentTask.wallpaperId}` : ''
      downloadGuard.value.statusText = `下载中：已结束 ${finishedCount}/${totalCount}`

      if (finishedCount >= totalCount) {
        endDownloadLockSession({
          completedCount,
          failedCount,
        })
      }
    },
    { deep: true },
  )

  function hasActiveOrPendingDownloads() {
    return downloads.value.some((download) =>
      [DOWNLOAD_STATUS.PENDING, DOWNLOAD_STATUS.DOWNLOADING].includes(download.status),
    )
  }

  function isRetriableNetworkError(message = '') {
    return /timeout|econn|connection|429|502|503|504|network|aborted|reset/i.test(
      String(message).toLowerCase(),
    )
  }

  function canAutoRetryTask(downloadTask, message = '') {
    const retryCount = Number(downloadTask.autoRetryCount || 0)
    return (
      downloadGuard.value.sessionActive &&
      retryCount < MAX_GUARDED_RETRIES &&
      isRetriableNetworkError(message)
    )
  }

  function scheduleTaskRetry(downloadTask, reason = '') {
    const nextRetryCount = Number(downloadTask.autoRetryCount || 0) + 1
    downloadTask.autoRetryCount = nextRetryCount
    downloadTask.status = DOWNLOAD_STATUS.PENDING
    downloadTask.error = `网络波动，自动重试 ${nextRetryCount}/${MAX_GUARDED_RETRIES}`
    downloadTask.progress = 0
    downloadTask.downloadedBytes = 0
    downloadTask.totalBytes = 0

    syncActiveDownloads()
    saveDownloads()

    notificationService.info(
      `壁纸 ${downloadTask.wallpaperId} 下载失败，正在自动重试（${nextRetryCount}/${MAX_GUARDED_RETRIES}）`,
      {
        duration: 3000,
        position: 'bottom-right',
      },
    )

    schedulePendingDownloads(1200 * nextRetryCount)
    console.warn('下载任务自动重试:', {
      wallpaperId: downloadTask.wallpaperId,
      retryCount: nextRetryCount,
      reason,
    })
  }

  function registerBeforeUnloadWarning() {
    if (beforeUnloadWarningRegistered || typeof window === 'undefined') return
    beforeUnloadWarningRegistered = true

    window.addEventListener('beforeunload', (event) => {
      if (!hasActiveOrPendingDownloads()) return

      event.preventDefault()
      event.returnValue = ''
    })
  }

  function schedulePendingDownloads(delayMs = 100) {
    if (pendingCheckTimer) return

    pendingCheckTimer = setTimeout(() => {
      pendingCheckTimer = null
      checkPendingDownloads()
    }, delayMs)
  }

  function syncActiveDownloads() {
    activeDownloads.value = downloads.value.filter(
      (d) => d.status === DOWNLOAD_STATUS.DOWNLOADING,
    ).length
  }

  const { downloadWithBrowser } = createBrowserDownloadActions({
    DOWNLOAD_STATUS,
    notificationService,
    syncActiveDownloads,
    saveDownloads,
    schedulePendingDownloads,
    launchDelayMs: BROWSER_DOWNLOAD_LAUNCH_DELAY_MS,
  })

  // 初始化下载管理器
  async function initDownloads(options = {}) {
    try {
      isLoading.value = true
      error.value = null
      registerBeforeUnloadWarning()

      // 从本地存储加载下载记录
      const storedDownloads = storageService.get('downloads', [])
      downloads.value = normalizeStoredDownloads(storedDownloads)

      const remoteState = await fetchClientStateQuietly('downloads')
      if (remoteState?.payload) {
        const strategy = options.conflictStrategy || getCloudSyncConflictStrategy()
        const shouldApplyRemote =
          strategy === 'merge' ||
          (strategy !== 'local' &&
            (options.forceRemote || shouldApplyRemoteClientState('downloads', remoteState.updatedAt)))

        if (shouldApplyRemote) {
          applyDownloadsPayload(remoteState.payload, strategy === 'merge' ? 'merge' : 'remote')
        } else if (strategy === 'local') {
          void syncDownloadsState()
        }
      } else if (isCloudSyncEnabled()) {
        void syncDownloadsState()
      }

      // 恢复未完成的下载
      const unfinishedDownloads = downloads.value.filter(
        (d) => d.status === DOWNLOAD_STATUS.DOWNLOADING || d.status === DOWNLOAD_STATUS.PENDING,
      )

      // 将所有未完成的下载标记为暂停
      unfinishedDownloads.forEach((download) => {
        download.status = DOWNLOAD_STATUS.PAUSED
        download.error = '下载已暂停，可以手动恢复'
      })
      syncActiveDownloads()

      // 保存更新后的下载记录
      saveDownloads({ syncRemote: false })

      isLoading.value = false
    } catch (err) {
      console.error('初始化下载管理器失败:', err)
      error.value = '加载下载记录失败'
      isLoading.value = false

      // 显示错误通知
      notificationService.error('加载下载记录失败', {
        duration: 5000,
        position: 'top-right',
      })
    }
  }

  // 保存下载记录到本地存储
  function saveDownloads(options = {}) {
    try {
      // console.log('保存下载记录到本地存储:', downloads.value.length, '条记录')

      if (downloads.value.length > MAX_STORED_DOWNLOADS) {
        downloads.value.splice(MAX_STORED_DOWNLOADS)
      }

      const savedRecords = compactAndPersistDownloads(downloads.value)
      if (savedRecords) {
        if (savedRecords.length < downloads.value.length) {
          downloads.value.splice(savedRecords.length)
        }
      } else {
        clearAllDownloadStorageScopes()
        downloads.value.splice(0)
      }

      if (options.syncRemote !== false) {
        void syncDownloadsState()
      }

      return true
    } catch (err) {
      console.error('保存下载记录失败:', err)
      error.value = '保存下载记录失败'
      return false
    }
  }

  function persistDownloads(records) {
    return storageService.set('downloads', records, { silent: true })
  }

  function compactDownloadRecords(records) {
    return records.map((download) => ({
      id: download.id,
      wallpaperId: download.wallpaperId || download.wallpaper_id || '',
      wallpaperData: compactWallpaperData(download.wallpaperData || {}),
      url: download.url || '',
      filename: download.filename || '',
      savePath: download.savePath || '',
      created_at: download.created_at || '',
      started_at: download.started_at || null,
      completed_at: download.completed_at || null,
      status: download.status,
      progress: download.progress,
      downloadedBytes: Number(download.downloadedBytes || 0),
      totalBytes: Number(download.totalBytes || 0),
      error: download.error ? String(download.error).slice(0, 160) : null,
      options: compactDownloadOptions(download.options || {}),
    }))
  }

  function compactAndPersistDownloads(records) {
    const compactDownloads = compactDownloadRecords(records)
    const candidates = [
      compactDownloads,
      compactDownloads.slice(0, 40),
      compactDownloads.slice(0, 20),
      compactDownloads.slice(0, 10),
      compactDownloads.slice(0, 5),
    ]

    for (const candidate of candidates) {
      if (persistDownloads(candidate)) {
        return candidate
      }
    }

    return null
  }

  function compactWallpaperData(wallpaperData) {
    return {
      id: wallpaperData.id || '',
      path: wallpaperData.path || '',
      url: wallpaperData.url || '',
      thumbnail: wallpaperData.thumbnail || wallpaperData.raw_thumbnail || '',
      raw_thumbnail: wallpaperData.raw_thumbnail || '',
      resolution: wallpaperData.resolution || '',
      file_size: wallpaperData.file_size || 0,
      raw_thumbs: {
        original: wallpaperData.raw_thumbs?.original || '',
        large: wallpaperData.raw_thumbs?.large || '',
        small: wallpaperData.raw_thumbs?.small || '',
      },
    }
  }

  function compactDownloadOptions(options) {
    return {
      save_dir: options.save_dir || '',
      save_mode: options.save_mode || '',
      custom_folder: options.custom_folder || '',
      timeout: options.timeout || 30,
      download_launch_delay_ms: options.download_launch_delay_ms || BROWSER_DOWNLOAD_LAUNCH_DELAY_MS,
      customFilename: options.customFilename || options.file_name || options.custom_file_name || '',
      useProcessedImage: Boolean(options.useProcessedImage),
    }
  }

  function normalizeStoredDownloads(records) {
    if (!Array.isArray(records)) return []

    return records
      .filter((record) => record && typeof record === 'object')
      .map((record) => {
        const wallpaperId = record.wallpaperId || record.wallpaper_id || record.id || ''
        const wallpaperData = compactWallpaperData(record.wallpaperData || {})
        if (!wallpaperData.id) wallpaperData.id = wallpaperId
        return {
          id: record.id || wallpaperId || uuidv4(),
          wallpaperId,
          wallpaperData,
          url: record.url || wallpaperData.path || wallpaperData.url || '',
          filename: record.filename || `${wallpaperId || 'wallpaper'}.jpg`,
          savePath: record.savePath || '',
          created_at: record.created_at || new Date().toISOString(),
          started_at: record.started_at || null,
          completed_at: record.completed_at || null,
          status: record.status || DOWNLOAD_STATUS.PENDING,
          progress: Number(record.progress || 0),
          downloadedBytes: Number(record.downloadedBytes || 0),
          totalBytes: Number(record.totalBytes || 0),
          error: record.error || null,
          options: {
            save_dir: record.options?.save_dir || '',
            save_mode: record.options?.save_mode || '',
            custom_folder: record.options?.custom_folder || '',
            timeout: record.options?.timeout || 30,
            download_launch_delay_ms:
              record.options?.download_launch_delay_ms || BROWSER_DOWNLOAD_LAUNCH_DELAY_MS,
            customFilename:
              record.options?.customFilename ||
              record.options?.file_name ||
              record.options?.custom_file_name ||
              '',
            useProcessedImage: Boolean(record.options?.useProcessedImage),
          },
        }
      })
  }

  function clearAllDownloadStorageScopes() {
    try {
      const keys = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key && key.startsWith('walleven_') && key.includes('_downloads')) {
          keys.push(key)
        }
      }
      keys.forEach((key) => localStorage.removeItem(key))
    } catch (error) {
      console.error('清理下载记录存储失败:', error)
    }
  }

  // 添加下载任务
  async function addDownload(wallpaper, options = {}, meta = {}) {
    try {
      const runtimeConfigStore = useRuntimeConfigStore()
      await runtimeConfigStore.loadRuntimeConfig()
      if (!runtimeConfigStore.canUse('download')) {
        const message = runtimeConfigStore.isBlocked
          ? runtimeConfigStore.blockReason
          : '下载功能暂未开放'
        error.value = message
        if (!meta.silent) {
          notificationService.warning(message, {
            duration: 4000,
            position: 'top-right',
          })
        }
        return null
      }

      const silent = Boolean(meta.silent)
      const normalizedOptions = { ...options }
      if (!normalizedOptions.processedImageData) {
        normalizedOptions.useProcessedImage = false
        delete normalizedOptions.processedImageData
      }
      // 确保壁纸数据完整
      let wallpaperData = { ...wallpaper }

      // 如果没有path或url属性，先获取完整的壁纸数据
      if (!wallpaperData.path && !wallpaperData.url) {
        try {
          const response = await wallpaperApi.getWallpaper(wallpaperData.id)
          if (response.success && response.image) {
            // 更新壁纸数据
            if (response.image.path) wallpaperData.path = response.image.path
            if (response.image.url) wallpaperData.url = response.image.url
            if (response.image.resolution) wallpaperData.resolution = response.image.resolution
            if (response.image.file_size) wallpaperData.file_size = response.image.file_size
          }
        } catch (error) {
          console.error('下载管理器: 获取完整壁纸数据失败:', error)
        }
      }

      // 创建下载任务
      const downloadTask = {
        id: uuidv4(),
        wallpaperId: wallpaperData.id,
        wallpaperData: wallpaperData,
        url: wallpaperData.path || '',
        filename: `${wallpaperData.id}.jpg`,
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        status: DOWNLOAD_STATUS.PENDING,
        progress: 0,
        autoRetryCount: 0,
        error: null,
        options: {
          ...normalizedOptions,
          save_dir: normalizedOptions.save_dir || settingsStore.getSetting('save_dir'),
          save_mode: normalizedOptions.save_mode || settingsStore.getSetting('save_mode'),
          custom_folder:
            normalizedOptions.custom_folder || settingsStore.getSetting('custom_folder'),
          timeout: normalizedOptions.timeout || settingsStore.getSetting('timeout', 30),
          download_launch_delay_ms:
            normalizedOptions.download_launch_delay_ms ||
            settingsStore.getSetting('download_launch_delay_ms', BROWSER_DOWNLOAD_LAUNCH_DELAY_MS),
        },
      }

      // 添加到下载队列
      downloads.value.unshift(downloadTask)

      // 保存下载记录
      saveDownloads()

      // 显示通知
      if (!silent) {
        notificationService.info(`已添加下载任务: ${wallpaper.id}`, {
          duration: 3000,
          position: 'bottom-right',
        })
      }

      schedulePendingDownloads()

      return downloadTask.id
    } catch (err) {
      console.error('添加下载任务失败:', err)
      error.value = '添加下载任务失败'

      // 显示错误通知
      notificationService.error(`添加下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'top-right',
      })

      return null
    }
  }

  // 批量添加下载任务
  async function addBatchDownload(wallpapers, options = {}, meta = {}) {
    try {
      const silent = Boolean(meta.silent)
      const taskIds = []

      // 添加每个壁纸的下载任务
      for (const wallpaper of wallpapers) {
        const taskId = await addDownload(wallpaper, options, { silent })
        if (taskId) {
          taskIds.push(taskId)
        }
        if (typeof meta.onTaskQueued === 'function') {
          meta.onTaskQueued({
            queuedCount: taskIds.length,
            totalCount: wallpapers.length,
            wallpaperId: wallpaper.id,
            taskId,
          })
        }
      }

      // 显示通知
      if (!silent) {
        notificationService.info(`已添加 ${taskIds.length} 个下载任务`, {
          duration: 3000,
          position: 'bottom-right',
        })
      }

      return taskIds
    } catch (err) {
      console.error('批量添加下载任务失败:', err)
      error.value = '批量添加下载任务失败'

      // 显示错误通知
      notificationService.error(`批量添加下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return []
    }
  }

  async function startGuardedDownload(wallpaper, options = {}) {
    const skipConfirmation = options.skipConfirmation === true
    const normalizedOptions = { ...options }
    delete normalizedOptions.skipConfirmation

    if (!skipConfirmation) {
      const confirmed = await requestDownloadConfirmation(1)
      if (!confirmed) return null
    }

    startDownloadLockSession(1)
    updateDownloadLockQueueProgress(0)

    try {
      const taskId = await addDownload(wallpaper, normalizedOptions, { silent: true })
      if (!taskId) {
        handleDownloadLockFailure('创建下载任务失败，请重试')
        return null
      }

      updateDownloadLockQueueProgress(1)
      bindDownloadLockTasks([taskId])
      return taskId
    } catch (err) {
      handleDownloadLockFailure(err.message || '创建下载任务失败')
      return null
    }
  }

  async function startGuardedBatchDownload(wallpapers, options = {}) {
    if (!Array.isArray(wallpapers) || wallpapers.length === 0) return []

    const confirmed = await requestDownloadConfirmation(wallpapers.length)
    if (!confirmed) return []

    startDownloadLockSession(wallpapers.length)

    try {
      const taskIds = await addBatchDownload(wallpapers, options, {
        silent: true,
        onTaskQueued: ({ queuedCount }) => {
          updateDownloadLockQueueProgress(queuedCount)
        },
      })

      if (!taskIds.length) {
        handleDownloadLockFailure('创建批量下载任务失败，请重试')
        return []
      }

      bindDownloadLockTasks(taskIds)
      return taskIds
    } catch (err) {
      handleDownloadLockFailure(err.message || '创建批量下载任务失败')
      return []
    }
  }

  // 开始下载任务
  async function startDownload(taskId) {
    try {
      // 查找下载任务
      const downloadTask = downloads.value.find((d) => d.id === taskId)
      if (!downloadTask) {
        throw new Error('下载任务不存在')
      }

      // 如果已经在下载中，则不做任何操作
      if (downloadTask.status === DOWNLOAD_STATUS.DOWNLOADING) {
        return true
      }

      if (
        downloadTask.status === DOWNLOAD_STATUS.CANCELED ||
        downloadTask.status === DOWNLOAD_STATUS.COMPLETED
      ) {
        return false
      }

      // 确保壁纸数据完整
      if (
        downloadTask.wallpaperData &&
        !downloadTask.wallpaperData.path &&
        !downloadTask.wallpaperData.url
      ) {
        try {
          const response = await wallpaperApi.getWallpaper(downloadTask.wallpaperId)
          if (response.success && response.image) {
            // 更新壁纸数据
            if (response.image.path) downloadTask.wallpaperData.path = response.image.path
            if (response.image.url) downloadTask.wallpaperData.url = response.image.url
            if (response.image.resolution)
              downloadTask.wallpaperData.resolution = response.image.resolution
          }
        } catch (error) {
          console.error('下载管理器: 获取完整壁纸数据失败:', error)
        }
      }

      // 更新任务状态
      downloadTask.status = DOWNLOAD_STATUS.DOWNLOADING
      downloadTask.started_at = new Date().toISOString()
      downloadTask.error = null
      downloadTask.progress = downloadTask.progress || 0

      syncActiveDownloads()

      // 保存下载记录
      saveDownloads()

      let imageUrl = null
      const processedImageData = downloadTask.options.processedImageData || null
      const useProcessedImage = Boolean(downloadTask.options.useProcessedImage && processedImageData)
      if (downloadTask.options.useProcessedImage && !processedImageData) {
        downloadTask.options.useProcessedImage = false
      }

      if (useProcessedImage && processedImageData) {
        imageUrl = processedImageData
      } else {
        if (downloadTask.wallpaperData) {
          if (downloadTask.wallpaperData.path) {
            imageUrl = downloadTask.wallpaperData.path
          } else if (downloadTask.wallpaperData.url) {
            imageUrl = downloadTask.wallpaperData.url
          } else if (downloadTask.wallpaperData.thumbnail) {
            // 尝试从缩略图URL构建完整URL
            const thumbnailUrl = downloadTask.wallpaperData.thumbnail
            if (thumbnailUrl.includes('/small/')) {
              imageUrl = thumbnailUrl.replace('/small/', '/full/')
            } else if (thumbnailUrl.includes('/th/')) {
              imageUrl = thumbnailUrl.replace('/th/', '/w/')
            } else {
              imageUrl = thumbnailUrl
            }
          }
        }

        // 如果还没有找到URL，尝试使用任务中的URL
        if (!imageUrl && downloadTask.url) {
          imageUrl = downloadTask.url
        }

        // 如果仍然没有URL，使用默认格式
        if (!imageUrl) {
          imageUrl = `https://w.wallhaven.cc/full/${downloadTask.wallpaperId.substring(0, 2)}/wallhaven-${downloadTask.wallpaperId}.jpg`
        }
      }

      return await downloadWithBrowser(downloadTask, imageUrl)
    } catch (err) {
      console.error('开始下载任务失败:', err)
      error.value = '开始下载任务失败'
      const failedTask = downloads.value.find((d) => d.id === taskId)
      if (failedTask) {
        if (canAutoRetryTask(failedTask, err.message || '')) {
          scheduleTaskRetry(failedTask, err.message || '')
          return false
        }

        failedTask.status = DOWNLOAD_STATUS.FAILED
        failedTask.error = err.message || '启动下载失败'
      }
      syncActiveDownloads()
      saveDownloads()

      // 显示错误通知
      notificationService.error(`开始下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return false
    }
  }

  // 检查等待中的下载任务
  async function checkPendingDownloads() {
    if (isCheckingPendingDownloads) return true

    isCheckingPendingDownloads = true
    try {
      const maxThreads = 1

      if (activeDownloads.value < maxThreads && pendingDownloads.value.length > 0) {
        const availableThreads = maxThreads - activeDownloads.value
        const tasksToStart = pendingDownloads.value.slice(0, availableThreads)

        for (const task of tasksToStart) {
          await startDownload(task.id)
        }
      }

      return true
    } catch (err) {
      console.error('检查等待中的下载任务失败:', err)
      error.value = '检查等待中的下载任务失败'
      return false
    } finally {
      isCheckingPendingDownloads = false
    }
  }

  // 暂停下载任务
  async function pauseDownload(taskId) {
    try {
      // 查找下载任务
      const downloadTask = downloads.value.find((d) => d.id === taskId)
      if (!downloadTask) {
        throw new Error('下载任务不存在')
      }

      // 如果不是下载中状态，则不做任何操作
      if (downloadTask.status !== DOWNLOAD_STATUS.DOWNLOADING) {
        return true
      }

      // 更新任务状态
      downloadTask.status = DOWNLOAD_STATUS.PAUSED
      downloadTask.error = '下载已暂停，可以手动恢复'

      syncActiveDownloads()

      // 保存下载记录
      saveDownloads()

      // 显示通知
      notificationService.info(`已暂停下载任务: ${downloadTask.wallpaperId}`, {
        duration: 3000,
        position: 'bottom-right',
      })

      // 检查是否有等待中的下载任务
      checkPendingDownloads()

      return true
    } catch (err) {
      console.error('暂停下载任务失败:', err)
      error.value = '暂停下载任务失败'

      // 显示错误通知
      notificationService.error(`暂停下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return false
    }
  }

  // 取消下载任务
  async function cancelDownload(taskId) {
    try {
      // 查找下载任务
      const downloadTask = downloads.value.find((d) => d.id === taskId)
      if (!downloadTask) {
        throw new Error('下载任务不存在')
      }

      // 更新任务状态
      downloadTask.status = DOWNLOAD_STATUS.CANCELED
      downloadTask.error = '下载已取消'
      syncActiveDownloads()

      // 保存下载记录
      saveDownloads()

      // 显示通知
      notificationService.info(`已取消下载任务: ${downloadTask.wallpaperId}`, {
        duration: 3000,
        position: 'bottom-right',
      })

      // 检查是否有等待中的下载任务
      checkPendingDownloads()

      return true
    } catch (err) {
      console.error('取消下载任务失败:', err)
      error.value = '取消下载任务失败'

      // 显示错误通知
      notificationService.error(`取消下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return false
    }
  }

  // 重试下载任务
  function retryDownload(taskId) {
    try {
      // 查找下载任务
      const downloadTask = downloads.value.find((d) => d.id === taskId)
      if (!downloadTask) {
        throw new Error('下载任务不存在')
      }

      // 更新任务状态
      downloadTask.status = DOWNLOAD_STATUS.PENDING
      downloadTask.error = null
      downloadTask.progress = 0
      downloadTask.downloadedBytes = 0
      downloadTask.totalBytes = 0

      // 保存下载记录
      saveDownloads()

      // 显示通知
      notificationService.info(`已重新添加下载任务: ${downloadTask.wallpaperId}`, {
        duration: 3000,
        position: 'bottom-right',
      })

      // 检查是否可以开始下载
      checkPendingDownloads()

      return true
    } catch (err) {
      console.error('重试下载任务失败:', err)
      error.value = '重试下载任务失败'

      // 显示错误通知
      notificationService.error(`重试下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return false
    }
  }

  // 删除下载任务
  function removeDownload(taskId) {
    try {
      // 查找下载任务索引
      const index = downloads.value.findIndex((d) => d.id === taskId)
      if (index === -1) {
        throw new Error('下载任务不存在')
      }

      // 获取下载任务
      const downloadTask = downloads.value[index]

      // 从下载列表中移除
      downloads.value.splice(index, 1)
      syncActiveDownloads()

      // 保存下载记录
      saveDownloads()

      // 显示通知
      notificationService.info(`已删除下载任务: ${downloadTask.wallpaperId}`, {
        duration: 3000,
        position: 'bottom-right',
      })

      // 检查是否有等待中的下载任务
      checkPendingDownloads()

      return true
    } catch (err) {
      console.error('删除下载任务失败:', err)
      error.value = '删除下载任务失败'

      // 显示错误通知
      notificationService.error(`删除下载任务失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return false
    }
  }

  // 清空下载记录
  function clearDownloads(status = null) {
    try {
      // 如果指定了状态，则只清空该状态的下载记录
      if (status) {
        // 过滤出非指定状态的下载任务
        downloads.value = downloads.value.filter((d) => d.status !== status)
      } else {
        // 清空所有非下载中的下载记录
        downloads.value = downloads.value.filter((d) => d.status === DOWNLOAD_STATUS.DOWNLOADING)
      }

      // 保存下载记录
      saveDownloads()

      // 显示通知
      notificationService.success('已清空下载记录', {
        duration: 3000,
        position: 'bottom-right',
      })

      return true
    } catch (err) {
      console.error('清空下载记录失败:', err)
      error.value = '清空下载记录失败'

      // 显示错误通知
      notificationService.error(`清空下载记录失败: ${err.message || '未知错误'}`, {
        duration: 5000,
        position: 'bottom-right',
      })

      return false
    }
  }

  return {
    downloads,
    isLoading,
    error,
    activeDownloads,
    DOWNLOAD_STATUS,
    downloadCount,
    pendingDownloads,
    activeDownloadsList,
    completedDownloads,
    failedDownloads,
    downloadConfirmationVisible,
    downloadConfirmationCount,
    downloadLockVisible,
    downloadLockTotal,
    downloadLockQueued,
    downloadLockCompleted,
    downloadLockFailed,
    downloadLockProgress,
    downloadLockCurrentTask,
    downloadLockStatusText,
    initDownloads,
    syncDownloadsState,
    addDownload,
    addBatchDownload,
    startGuardedDownload,
    startGuardedBatchDownload,
    confirmDownloadConfirmation,
    cancelDownloadConfirmation,
    startDownload,
    pauseDownload,
    cancelDownload,
    retryDownload,
    removeDownload,
    clearDownloads,
    checkPendingDownloads,
    getSavePath: (downloadTask) => resolveDownloadSavePath(downloadTask, settingsStore),
  }
})
