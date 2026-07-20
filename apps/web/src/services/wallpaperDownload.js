import notificationService from '@/services/notification'
import storageService from '@/services/storage'
import { useDownloadsStore } from '@/stores/downloads'
import { useSettingsStore } from '@/stores/settings'
import {
  downloadWallpapersAsZip,
  isZipDownloadCancelled,
} from '@/services/wallpaperZipDownload'
import { reactive } from 'vue'

const ZIP_DOWNLOADS_STORAGE_KEY = 'zip_downloads'
const MAX_ZIP_DOWNLOAD_RECORDS = 50

export const wallpaperDownloadUi = reactive({
  nameDialogVisible: false,
  progressVisible: false,
  defaultName: '',
  filename: '',
  count: 0,
  progress: 0,
  statusText: '',
  resolveName: null,
  abortController: null,
  activeRecordId: '',
  cancelling: false,
  packageMode: 'local',
  allowCloud: false,
  cloudRequiredText: '',
  estimatedSizeText: '',
})

export const zipDownloadRecords = reactive([])

function nowIso() {
  return new Date().toISOString()
}

function compactZipWallpaper(wallpaper) {
  if (!wallpaper?.id) return null
  return {
    id: wallpaper.id,
    path: wallpaper.path || '',
    url: wallpaper.url || '',
    image_url: wallpaper.image_url || '',
    thumbnail: wallpaper.thumbnail || wallpaper.raw_thumbnail || '',
    raw_thumbnail: wallpaper.raw_thumbnail || '',
    resolution: wallpaper.resolution || '',
    file_size: wallpaper.file_size || wallpaper.fileSize || wallpaper.size || wallpaper.bytes || '',
    raw_thumbs: {
      original: wallpaper.raw_thumbs?.original || '',
      large: wallpaper.raw_thumbs?.large || '',
      small: wallpaper.raw_thumbs?.small || '',
    },
  }
}

function compactZipWallpapers(wallpapers = []) {
  return wallpapers.map((wallpaper) => compactZipWallpaper(wallpaper)).filter(Boolean)
}

function createZipRecord({ filename, count, wallpapers }) {
  return {
    id: `zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'zip',
    filename,
    count,
    status: 'preparing',
    packageMode: 'local',
    serverJobId: '',
    downloadUrl: '',
    progress: 0,
    successCount: 0,
    failCount: 0,
    error: '',
    wallpapers: compactZipWallpapers(wallpapers),
    created_at: nowIso(),
    started_at: nowIso(),
    completed_at: null,
  }
}

function normalizeZipRecord(record) {
  return {
    id: record?.id || `zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'zip',
    filename: sanitizeZipName(record?.filename) || 'wallpapers',
    count: Number(record?.count || 0),
    status: record?.status || 'completed',
    packageMode: 'local',
    serverJobId: '',
    downloadUrl: '',
    progress: Math.max(0, Math.min(100, Number(record?.progress || 0))),
    successCount: Number(record?.successCount || 0),
    failCount: Number(record?.failCount || 0),
    error: record?.error ? String(record.error).slice(0, 180) : '',
    wallpapers: compactZipWallpapers(record?.wallpapers || []),
    created_at: record?.created_at || nowIso(),
    started_at: record?.started_at || record?.created_at || null,
    completed_at: record?.completed_at || null,
    expiresAt: record?.expiresAt || '',
  }
}

function saveZipDownloadRecords() {
  const compact = zipDownloadRecords
    .slice(0, MAX_ZIP_DOWNLOAD_RECORDS)
    .map((record) => normalizeZipRecord(record))
  storageService.set(ZIP_DOWNLOADS_STORAGE_KEY, compact, { silent: true })
  if (zipDownloadRecords.length > compact.length) {
    zipDownloadRecords.splice(compact.length)
  }
}

export function initZipDownloadRecords() {
  const records = storageService.get(ZIP_DOWNLOADS_STORAGE_KEY, [])
  zipDownloadRecords.splice(
    0,
    zipDownloadRecords.length,
    ...records
      .filter((record) => record && typeof record === 'object')
      .map((record) => {
        const normalized = normalizeZipRecord(record)
        if (record.packageMode === 'cloud') {
          normalized.status = normalized.status === 'completed' ? 'expired' : 'cancelled'
          normalized.error = normalized.error || '云端打包已下线'
          normalized.completed_at = normalized.completed_at || nowIso()
        } else if (['preparing', 'downloading'].includes(normalized.status)) {
          normalized.status = 'cancelled'
          normalized.error = normalized.error || '页面刷新后打包已停止'
          normalized.completed_at = normalized.completed_at || nowIso()
        }
        return normalized
      }),
  )
  saveZipDownloadRecords()
}

function addZipDownloadRecord(record) {
  zipDownloadRecords.unshift(record)
  saveZipDownloadRecords()
  return record.id
}

function updateZipDownloadRecord(recordId, patch) {
  const record = zipDownloadRecords.find((item) => item.id === recordId)
  if (!record) return null
  Object.assign(record, patch)
  saveZipDownloadRecords()
  return record
}

export function removeZipDownloadRecord(recordId) {
  const index = zipDownloadRecords.findIndex((item) => item.id === recordId)
  if (index < 0) return false
  zipDownloadRecords.splice(index, 1)
  saveZipDownloadRecords()
  return true
}

export function clearZipDownloadRecords() {
  zipDownloadRecords.splice(0)
  saveZipDownloadRecords()
}

export async function retryZipDownloadRecord(recordId) {
  const record = zipDownloadRecords.find((item) => item.id === recordId)
  if (!record) {
    notificationService.warning('压缩包记录不存在', {
      duration: 3000,
      position: 'top-right',
    })
    return { mode: 'missing', count: 0 }
  }

  if (['preparing', 'downloading'].includes(record.status)) {
    notificationService.warning('这个压缩包正在打包中', {
      duration: 3000,
      position: 'top-right',
    })
    return { mode: 'active', count: 0 }
  }

  const wallpapers = normalizeWallpapers(record.wallpapers || [])
  if (!wallpapers.length) {
    notificationService.warning('这条压缩包记录缺少原始壁纸清单，无法重试', {
      duration: 3800,
      position: 'top-right',
    })
    return { mode: 'missing_wallpapers', count: 0 }
  }

  return await downloadWallpapersUnified(wallpapers, {
    forceZip: true,
    filename: record.filename,
    scope: record.filename,
    skipNameDialog: false,
    zipStartMessage: `正在重新打包 ${wallpapers.length} 张壁纸...`,
  })
}

export async function cancelZipDownloadRecord(recordId) {
  const record = zipDownloadRecords.find((item) => item.id === recordId)
  if (!record) return false

  if (record.id === wallpaperDownloadUi.activeRecordId) {
    cancelWallpaperZipPackaging()
    return true
  }
  updateZipDownloadRecord(recordId, {
    status: 'cancelled',
    error: '用户取消打包',
    completed_at: nowIso(),
  })
  return true
}

export async function downloadZipRecordResult(recordId) {
  updateZipDownloadRecord(recordId, {
    status: 'expired',
    error: '云端打包已下线，请重新本地打包',
    completed_at: nowIso(),
  })
  notificationService.warning('云端打包已下线，请重新本地打包', {
    duration: 3600,
    position: 'top-right',
  })
  return true
}

export async function refreshCloudZipDownloadRecords(options = {}) {
  return []
}

function normalizeWallpapers(input) {
  const list = Array.isArray(input) ? input : input ? [input] : []
  return Array.from(new Map(list.filter(Boolean).map((item) => [String(item.id || ''), item])).values()).filter(
    (item) => item?.id,
  )
}

function sanitizeZipName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

function defaultZipName(context = {}) {
  const scope = sanitizeZipName(context.scope || context.title || 'wallpapers')
  return `walleven-${scope || 'wallpapers'}-${new Date().toISOString().slice(0, 10)}`
}

function requestZipFilename({ defaultName, count, estimatedSizeText = '' }) {
  wallpaperDownloadUi.defaultName = defaultName
  wallpaperDownloadUi.filename = defaultName
  wallpaperDownloadUi.count = count
  wallpaperDownloadUi.allowCloud = false
  wallpaperDownloadUi.packageMode = 'local'
  wallpaperDownloadUi.cloudRequiredText = ''
  wallpaperDownloadUi.estimatedSizeText = estimatedSizeText
  wallpaperDownloadUi.nameDialogVisible = true

  return new Promise((resolve) => {
    wallpaperDownloadUi.resolveName = resolve
  })
}

export function confirmWallpaperZipName() {
  const resolve = wallpaperDownloadUi.resolveName
  wallpaperDownloadUi.nameDialogVisible = false
  wallpaperDownloadUi.resolveName = null
  wallpaperDownloadUi.estimatedSizeText = ''
  if (resolve) {
    resolve({
      filename: sanitizeZipName(wallpaperDownloadUi.filename) || wallpaperDownloadUi.defaultName,
      packageMode: 'local',
    })
  }
}

export function cancelWallpaperZipName() {
  const resolve = wallpaperDownloadUi.resolveName
  wallpaperDownloadUi.nameDialogVisible = false
  wallpaperDownloadUi.resolveName = null
  wallpaperDownloadUi.estimatedSizeText = ''
  if (resolve) resolve(null)
}

function estimateWallpaperZipBytes(wallpapers) {
  return wallpapers.reduce((total, wallpaper) => total + estimateWallpaperBytes(wallpaper), 0)
}

function estimateWallpaperBytes(wallpaper) {
  const explicit = readWallpaperSizeBytes(wallpaper)
  if (explicit > 0) return explicit
  const resolution = String(wallpaper?.resolution || '').match(/(\d{3,6})\s*x\s*(\d{3,6})/i)
  if (!resolution) return 12 * 1024 * 1024
  const pixels = Number(resolution[1]) * Number(resolution[2])
  if (!Number.isFinite(pixels) || pixels <= 0) return 12 * 1024 * 1024
  if (pixels >= 7680 * 4320) return 36 * 1024 * 1024
  if (pixels >= 5120 * 2880) return 24 * 1024 * 1024
  if (pixels >= 3840 * 2160) return 14 * 1024 * 1024
  if (pixels >= 2560 * 1440) return 8 * 1024 * 1024
  return 5 * 1024 * 1024
}

function readWallpaperSizeBytes(wallpaper) {
  const candidates = [
    wallpaper?.file_size,
    wallpaper?.fileSize,
    wallpaper?.size,
    wallpaper?.bytes,
  ]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    if (typeof value !== 'string') continue
    const text = value.trim().toLowerCase()
    const number = Number(text.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(number) || number <= 0) continue
    if (text.includes('gb')) return number * 1024 * 1024 * 1024
    if (text.includes('mb') || text.includes('mib')) return number * 1024 * 1024
    if (text.includes('kb') || text.includes('kib')) return number * 1024
    return number
  }
  return 0
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))}MB`
}

function showZipProgress(count) {
  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null
  wallpaperDownloadUi.progressVisible = true
  wallpaperDownloadUi.count = count
  wallpaperDownloadUi.progress = 0
  wallpaperDownloadUi.statusText = '正在准备图片'
  wallpaperDownloadUi.abortController = abortController
  wallpaperDownloadUi.cancelling = false
  return abortController
}

function hideZipProgressSoon() {
  window.setTimeout(() => {
    wallpaperDownloadUi.progressVisible = false
    wallpaperDownloadUi.progress = 0
    wallpaperDownloadUi.statusText = ''
    wallpaperDownloadUi.abortController = null
    wallpaperDownloadUi.activeRecordId = ''
    wallpaperDownloadUi.cancelling = false
  }, 1200)
}

export function cancelWallpaperZipPackaging() {
  if (!wallpaperDownloadUi.progressVisible || wallpaperDownloadUi.cancelling) return
  wallpaperDownloadUi.cancelling = true
  wallpaperDownloadUi.statusText = '正在取消打包...'
  wallpaperDownloadUi.abortController?.abort()
  if (wallpaperDownloadUi.activeRecordId) {
    updateZipDownloadRecord(wallpaperDownloadUi.activeRecordId, {
      status: 'cancelled',
      error: '用户取消打包',
      completed_at: nowIso(),
    })
  }
}

function buildDownloadOptions(settingsStore, options = {}) {
  return {
    save_mode: settingsStore.getSetting('save_mode', 'default'),
    custom_folder: settingsStore.getSetting('custom_folder', ''),
    save_metadata: settingsStore.getSetting('save_metadata', false),
    overwrite: settingsStore.getSetting('overwrite', true),
    timeout: settingsStore.getSetting('timeout', 30),
    download_launch_delay_ms: settingsStore.getSetting('download_launch_delay_ms', 900),
    save_dir: settingsStore.getSetting('save_dir', '~/Downloads/星空云绘'),
    ...options,
  }
}

function readTopLevelDownloadOptions(config = {}) {
  const overrides = {}
  const keys = [
    'save_dir',
    'save_mode',
    'custom_folder',
    'save_metadata',
    'overwrite',
    'timeout',
    'download_launch_delay_ms',
    'processedImageData',
    'useProcessedImage',
    'filterInfo',
    'customFilename',
    'file_name',
    'custom_file_name',
    'suppressNotifications',
  ]
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      overrides[key] = config[key]
    }
  }
  return overrides
}

export async function downloadWallpapersUnified(input, config = {}) {
  const wallpapers = normalizeWallpapers(input)
  if (!wallpapers.length) {
    notificationService.warning(config.emptyMessage || '当前没有可下载的壁纸', {
      duration: 3000,
      position: config.position || 'top-right',
    })
    return { mode: 'empty', count: 0 }
  }

  const settingsStore = useSettingsStore()
  const downloadsStore = useDownloadsStore()
  const position = config.position || 'top-right'
  const topLevelDownloadOptions = readTopLevelDownloadOptions(config)
  const options = buildDownloadOptions(settingsStore, {
    ...topLevelDownloadOptions,
    ...(config.options || {}),
  })

  if (wallpapers.length === 1) {
    const taskId = await downloadsStore.addDownload(wallpapers[0], {
      ...options,
      suppressNotifications: options.suppressNotifications === true || config.suppressNotifications === true,
    }, { silent: true })
    if (taskId && config.notify !== false) {
      notificationService.success(config.singleSuccessMessage || '已交给浏览器下载', {
        duration: 3200,
        position,
      })
    }
    return { mode: 'single', count: taskId ? 1 : 0, taskIds: taskId ? [taskId] : [] }
  }

  const shouldZip =
    config.forceZip === true ||
    (config.forceZip !== false && settingsStore.getSetting('batch_download_as_zip', true) !== false)

  if (shouldZip) {
    const defaultName = sanitizeZipName(config.filename) || defaultZipName(config)
    const estimatedBytes = estimateWallpaperZipBytes(wallpapers)
    const estimatedSizeText = formatSize(estimatedBytes)
    const filename =
      config.skipNameDialog === true
        ? defaultName
        : await requestZipFilename({
            defaultName,
            count: wallpapers.length,
            estimatedSizeText,
          })

    if (!filename) {
      return { mode: 'cancelled', count: 0 }
    }
    const selectedFilename = typeof filename === 'object' ? filename.filename : filename

    if (config.notify !== false) {
      notificationService.info(config.zipStartMessage || `正在打包 ${wallpapers.length} 张壁纸...`, {
        duration: 4000,
        position,
      })
    }

    const record = createZipRecord({ filename: selectedFilename, count: wallpapers.length, wallpapers })
    addZipDownloadRecord(record)
    wallpaperDownloadUi.activeRecordId = record.id

    const abortController = showZipProgress(wallpapers.length)
    try {
      const result = await downloadWallpapersAsZip(wallpapers, {
        filename: selectedFilename,
        signal: abortController?.signal,
        onProgress: (payload) => {
          wallpaperDownloadUi.progress = payload.percent
          wallpaperDownloadUi.statusText =
            payload.percent >= 96
              ? '正在生成压缩包'
              : `正在打包 ${payload.current}/${payload.total}`
          updateZipDownloadRecord(record.id, {
            status: payload.percent >= 96 ? 'preparing' : 'downloading',
            progress: payload.percent,
          })
          config.onProgress?.(payload)
        },
        timeoutMs: config.timeoutMs,
      })
      wallpaperDownloadUi.progress = 100
      wallpaperDownloadUi.statusText = '压缩包已生成'
      updateZipDownloadRecord(record.id, {
        status: 'completed',
        progress: 100,
        successCount: result.successCount,
        failCount: result.failCount,
        completed_at: nowIso(),
      })
      hideZipProgressSoon()

      if (result.successCount > 0 && config.notify !== false) {
        const failText = result.failCount > 0 ? `，${result.failCount} 张失败` : ''
        notificationService.success(`已打包 ${result.successCount} 张壁纸${failText}`, {
          duration: 5000,
          position,
        })
      }

      return { mode: 'zip', count: result.successCount, recordId: record.id, ...result }
    } catch (error) {
      if (isZipDownloadCancelled(error) || abortController?.signal?.aborted) {
        wallpaperDownloadUi.statusText = '打包已取消'
        updateZipDownloadRecord(record.id, {
          status: 'cancelled',
          error: '用户取消打包',
          completed_at: nowIso(),
        })
        hideZipProgressSoon()
        if (config.notify !== false) {
          notificationService.info('已取消压缩包打包', {
            duration: 3200,
            position,
          })
        }
        return { mode: 'cancelled', count: 0, recordId: record.id }
      }

      wallpaperDownloadUi.statusText = '打包失败'
      updateZipDownloadRecord(record.id, {
        status: 'failed',
        error: error?.message || '压缩包生成失败',
        completed_at: nowIso(),
      })
      hideZipProgressSoon()
      notificationService.error(`压缩包生成失败：${error?.message || '未知错误'}`, {
        duration: 5000,
        position,
      })
      return { mode: 'zip_failed', count: 0, recordId: record.id, error }
    }
  }

  const taskIds = await downloadsStore.addBatchDownload(wallpapers, options, { silent: true })
  if (taskIds.length > 0 && config.notify !== false) {
    notificationService.success(`已添加 ${taskIds.length} 张壁纸到下载队列`, {
      duration: 5000,
      position,
    })
  }
  return { mode: 'batch', count: taskIds.length, taskIds }
}

export function getDefaultWallpaperZipName(context = {}) {
  return defaultZipName(context)
}
