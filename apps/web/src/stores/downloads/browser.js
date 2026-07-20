import { proxyWallhavenImageUrl } from '@/services/api'
import { buildDownloadFilename, buildImageProxyDownloadUrl, getCandidateImageUrls } from './helpers'

function getClampedNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.round(Math.min(max, Math.max(min, number)))
}

function getTaskTimeoutMs(downloadTask) {
  const timeoutSeconds = getClampedNumber(downloadTask?.options?.timeout, 30, 10, 300)
  return timeoutSeconds * 1000
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function triggerBrowserDownloadUrl(downloadUrl, filename) {
  window.setTimeout(() => {
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, 0)
}

function triggerBrowserBlobSave(blob, filename) {
  window.setTimeout(() => {
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
  }, 0)
}

export function createBrowserDownloadActions({
  DOWNLOAD_STATUS,
  notificationService,
  syncActiveDownloads,
  saveDownloads,
  schedulePendingDownloads,
  launchDelayMs,
}) {
  async function probeBrowserDownloadTarget(sourceUrl, downloadTask) {
    const proxiedUrl = proxyWallhavenImageUrl(sourceUrl)

    try {
      const response = await fetchWithTimeout(
        proxiedUrl,
        {
          method: 'HEAD',
          cache: 'no-store',
        },
        getTaskTimeoutMs(downloadTask),
      )

      if (!response.ok) {
        const error = new Error(`图片请求失败(${response.status})`)
        error.hardFail = response.status >= 400 && response.status < 500
        throw error
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType && !contentType.startsWith('image/')) {
        const error = new Error('返回内容不是图片')
        error.hardFail = true
        throw error
      }

      const totalBytes = Number(response.headers.get('content-length') || 0)
      if (totalBytes > 0) {
        downloadTask.totalBytes = totalBytes
      }

      return {
        sourceUrl,
        contentType,
        contentLength: totalBytes,
        skippedProbe: false,
      }
    } catch (error) {
      if (error?.hardFail) throw error

      return {
        sourceUrl,
        contentType: '',
        contentLength: 0,
        skippedProbe: true,
        probeError: error?.message || 'HEAD 探测失败',
      }
    }
  }

  async function saveDataUrlWithBrowser(downloadTask, sourceUrl) {
    const response = await fetchWithTimeout(sourceUrl, {}, getTaskTimeoutMs(downloadTask))
    const blob = await response.blob()
    const filename = buildDownloadFilename(downloadTask, blob.type, sourceUrl)

    return {
      filename,
      savePath: '浏览器默认下载目录',
      totalBytes: blob.size,
      downloadedBytes: blob.size,
      triggerDownload: () => triggerBrowserBlobSave(blob, filename),
    }
  }

  async function handOffImageToBrowser(downloadTask, sourceUrl) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('当前环境不支持浏览器下载')
    }

    if (!sourceUrl) {
      throw new Error('缺少可下载的图片地址')
    }

    if (sourceUrl.startsWith('data:')) {
      return saveDataUrlWithBrowser(downloadTask, sourceUrl)
    }

    const target = await probeBrowserDownloadTarget(sourceUrl, downloadTask)
    if (target.skippedProbe) {
      console.warn('跳过 HEAD 探测，直接触发浏览器下载:', {
        wallpaperId: downloadTask.wallpaperId,
        sourceUrl: target.sourceUrl,
        reason: target.probeError || 'HEAD not supported',
      })
    }

    const filename = buildDownloadFilename(downloadTask, target.contentType, target.sourceUrl)
    const downloadUrl = buildImageProxyDownloadUrl(target.sourceUrl, filename)

    return {
      filename,
      savePath: '浏览器下载管理器',
      totalBytes: target.contentLength,
      downloadedBytes: 0,
      triggerDownload: () => triggerBrowserDownloadUrl(downloadUrl, filename),
    }
  }

  async function saveImageWithBrowser(downloadTask, sourceUrl) {
    const handoff = await handOffImageToBrowser(downloadTask, sourceUrl)

    downloadTask.filename = handoff.filename
    downloadTask.savePath = handoff.savePath
    downloadTask.totalBytes = handoff.totalBytes || downloadTask.totalBytes || 0
    downloadTask.downloadedBytes = handoff.downloadedBytes || 0
    downloadTask.status = DOWNLOAD_STATUS.COMPLETED
    downloadTask.completed_at = new Date().toISOString()
    downloadTask.progress = 100
    downloadTask.error = null

    syncActiveDownloads()
    saveDownloads()

    if (!downloadTask.options?.suppressNotifications) {
      notificationService.success(`壁纸 ${downloadTask.wallpaperId} 已交给浏览器下载管理器`, {
        duration: 5000,
        position: 'bottom-right',
      })
    }

    const nextLaunchDelayMs = getClampedNumber(
      downloadTask?.options?.download_launch_delay_ms,
      launchDelayMs,
      300,
      5000,
    )
    schedulePendingDownloads(nextLaunchDelayMs)
    handoff.triggerDownload?.()
    return true
  }

  async function downloadWithBrowser(downloadTask, primaryImageUrl) {
    // 处理后图像必须优先下载，不能被原图候选地址抢先命中。
    if (primaryImageUrl && downloadTask.options.useProcessedImage) {
      return await saveImageWithBrowser(downloadTask, primaryImageUrl)
    }

    const candidates = getCandidateImageUrls(
      downloadTask.wallpaperId,
      downloadTask.wallpaperData,
      primaryImageUrl || downloadTask.url,
    )

    let lastError = null
    for (const sourceUrl of candidates) {
      try {
        return await saveImageWithBrowser(downloadTask, sourceUrl)
      } catch (err) {
        lastError = err
        console.warn('浏览器下载候选地址失败:', sourceUrl, err)
      }
    }

    throw lastError || new Error('没有可用的下载地址')
  }

  return {
    downloadWithBrowser,
  }
}
