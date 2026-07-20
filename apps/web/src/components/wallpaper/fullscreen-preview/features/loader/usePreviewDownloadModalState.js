import { ref, unref } from 'vue'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'

// loader 里的下载弹窗状态独立出来，避免图片加载逻辑继续混下载 DOM 桥接细节。
export function usePreviewDownloadModalState({
  activeArtStyle,
  activeFilter,
  artStyleIntensity,
  artStyleParams,
  downloadsStore,
  filterIntensity,
  filterParams,
  getProcessedImageData,
  hasMeaningfulFilterAdjustment,
  notificationService,
  currentProcessedImageData,
  rotation,
  selectedPresetId,
  settingsStore,
  wallpaperRef,
}) {
  const showDownloadModal = ref(false)
  const pendingProcessedImageData = ref(null)

  function getCurrentProcessedImageData() {
    return String(unref(currentProcessedImageData) || '').trim()
  }

  function buildFilterInfo() {
    return {
      activeFilter: activeFilter.value,
      activeArtStyle: activeArtStyle?.value || 'none',
      rotation: rotation.value,
      filterIntensity: filterIntensity.value,
      artStyleIntensity: artStyleIntensity?.value ?? 60,
      artStyleParams: JSON.parse(JSON.stringify(artStyleParams || {})),
      filterParams: { ...filterParams },
      selectedPresetId: selectedPresetId?.value ?? null,
    }
  }

  function getProcessedFilename(wallpaper) {
    const tag =
      selectedPresetId?.value ||
      (activeArtStyle?.value && activeArtStyle.value !== 'none' ? activeArtStyle.value : null) ||
      (activeFilter.value !== 'none' ? activeFilter.value : 'edited')
    return `${wallpaper.id}_${tag}.jpg`
  }

  async function resolveDownloadProcessedImageData() {
    const currentProcessedData = getCurrentProcessedImageData()
    const needsCanvasRender = hasMeaningfulFilterAdjustment()

    if (currentProcessedData) {
      if (!needsCanvasRender) return currentProcessedData
      const renderedCurrentPreview = await getProcessedImageData({ sourceUrl: currentProcessedData })
      return renderedCurrentPreview || currentProcessedData
    }

    if (!needsCanvasRender) return null
    return await getProcessedImageData()
  }

  async function openDownloadModal({ processedImageData: providedProcessedImageData = '' } = {}) {
    pendingProcessedImageData.value = providedProcessedImageData || null
    if (!pendingProcessedImageData.value) {
      const processedImageData = await resolveDownloadProcessedImageData()

      if (processedImageData) {
        pendingProcessedImageData.value = processedImageData
        showDownloadModal.value = true
        return { processedImageData }
      }
      if (hasMeaningfulFilterAdjustment() || getCurrentProcessedImageData()) {
        notificationService.warning('处理图生成失败，本次将回退为原图下载', {
          duration: 2600,
          position: 'top-right',
        })
      }
    }

    showDownloadModal.value = true
    return { processedImageData: pendingProcessedImageData.value || '' }
  }

  function closeDownloadModal() {
    showDownloadModal.value = false
    pendingProcessedImageData.value = null
  }

  async function handleDownloadSubmit(options) {
    const wallpaper = wallpaperRef.value
    if (!wallpaper) return

    const suppressNotifications = options.suppressNotifications === true
    delete options.suppressNotifications

    try {
      const processedImageData =
        options.processedImageData || pendingProcessedImageData.value || null

      if (processedImageData) {
        options.processedImageData = processedImageData
        options.useProcessedImage = true
        options.filterInfo = buildFilterInfo()

        if (!options.customFilename) {
          options.customFilename = getProcessedFilename(wallpaper)
        }
      }

      const result = await downloadWallpapersUnified(wallpaper, {
        ...options,
        skipConfirmation: true,
        notify: !suppressNotifications,
      })

      pendingProcessedImageData.value = null
      return result.taskIds?.[0] || (result.count > 0 ? 'direct-download' : null)
    } catch (err) {
      console.error('下载失败:', err)
      if (!suppressNotifications) {
        notificationService.error(`下载失败: ${err.message || '未知错误'}`, {
          duration: 5000,
          position: 'top-right',
        })
      }
      return null
    }
  }

  async function downloadDirectly() {
    const wallpaper = wallpaperRef.value
    if (!wallpaper) return

    try {
      const saveDir = settingsStore.getSetting('save_dir', '~/Downloads/星空云绘')
      const saveMode = settingsStore.getSetting('save_mode', 'default')
      const processedImageData = await resolveDownloadProcessedImageData()
      const useProcessedImage = Boolean(processedImageData)

      const result = await downloadWallpapersUnified(wallpaper, {
        save_dir: saveDir,
        save_mode: saveMode,
        timeout: settingsStore.getSetting('timeout', 30),
        download_launch_delay_ms: settingsStore.getSetting('download_launch_delay_ms', 900),
        processedImageData: processedImageData || undefined,
        useProcessedImage,
        filterInfo: useProcessedImage ? buildFilterInfo() : undefined,
        customFilename: useProcessedImage ? getProcessedFilename(wallpaper) : undefined,
        suppressNotifications: true,
        skipConfirmation: true,
        notify: false,
      })

      const downloadId = result.taskIds?.[0] || (result.count > 0 ? 'direct-download' : null)
      if (!downloadId) {
        throw new Error('添加下载任务失败')
      }
      return downloadId
    } catch (err) {
      console.error('直接下载失败:', err)
      return null
    }
  }

  function resetDownloadModalState() {
    showDownloadModal.value = false
    pendingProcessedImageData.value = null
  }

  return {
    closeDownloadModal,
    downloadDirectly,
    handleDownloadSubmit,
    openDownloadModal,
    pendingProcessedImageData,
    resetDownloadModalState,
    showDownloadModal,
  }
}
