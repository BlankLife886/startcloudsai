import { computed, ref, watch } from 'vue'
import { wallpaperApi } from '@/services/api'

export function useSearchPreviewInteractions({
  route,
  displayWallpapers,
  selectedWallpapers,
  searchParams,
  workbenchStore,
  notificationService,
  applyFilters,
  onFindSimilarFromCard,
}) {
  const previewWallpaper = ref(null)
  const showPreview = ref(false)
  const previewIndex = ref(-1)

  const showBulkCollectionModal = ref(false)
  const bulkCollectionWallpapers = ref([])

  const contextMenu = ref({ show: false, x: 0, y: 0, wallpaper: null })
  const quickDetailOpen = ref(false)
  const quickDetailWallpaper = ref(null)
  const quickDetailLoading = ref(false)
  const quickDetailError = ref('')
  let quickDetailRequestId = 0

  const previewInListContext = computed(
    () => showPreview.value && previewIndex.value >= 0 && displayWallpapers.value.length > 0,
  )

  function showWallpaperPreview(wallpaper) {
    const list = displayWallpapers.value
    const index = list.findIndex((item) => String(item.id) === String(wallpaper.id))

    if (index >= 0) {
      previewIndex.value = index
      previewWallpaper.value = list[index]
    } else {
      previewIndex.value = -1
      previewWallpaper.value = wallpaper
    }

    showPreview.value = true
  }

  function onPreviewNext() {
    const list = displayWallpapers.value
    if (previewIndex.value < 0 || previewIndex.value >= list.length - 1) return
    previewIndex.value += 1
    previewWallpaper.value = list[previewIndex.value]
  }

  function onPreviewPrevious() {
    const list = displayWallpapers.value
    if (previewIndex.value <= 0) return
    previewIndex.value -= 1
    previewWallpaper.value = list[previewIndex.value]
  }

  function closePreview() {
    showPreview.value = false
    previewWallpaper.value = null
    previewIndex.value = -1
  }

  watch(displayWallpapers, (list) => {
    if (!showPreview.value || !previewWallpaper.value) return

    const index = list.findIndex(
      (wallpaper) => String(wallpaper.id) === String(previewWallpaper.value.id),
    )
    if (index < 0) {
      closePreview()
      return
    }

    previewIndex.value = index
  })

  function onSearchSpaceKeydown(event) {
    if (route.name !== 'search') return
    if (event.code !== 'Space' && event.key !== ' ') return

    const target = event.target
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.closest?.('[contenteditable="true"]'))
    ) {
      return
    }

    if (showPreview.value || !displayWallpapers.value.length) return
    event.preventDefault()
    showWallpaperPreview(displayWallpapers.value[0])
  }

  function onFilterColorFromCard(hex) {
    searchParams.value.color = String(hex).replace(/^#/, '').toLowerCase()
    applyFilters()
    notificationService.info(`已按主色筛选 #${searchParams.value.color}`, {
      duration: 3200,
      position: 'top-right',
    })
  }

  function onWallpaperContextMenu(payload) {
    if (!payload?.wallpaper) return

    contextMenu.value = {
      show: true,
      x: payload.clientX ?? 0,
      y: payload.clientY ?? 0,
      wallpaper: payload.wallpaper,
    }
  }

  function closeContextMenu() {
    contextMenu.value = { show: false, x: 0, y: 0, wallpaper: null }
  }

  async function openQuickDetail(wallpaper) {
    if (!wallpaper?.id) return

    const requestId = ++quickDetailRequestId
    quickDetailOpen.value = true
    quickDetailLoading.value = true
    quickDetailError.value = ''
    quickDetailWallpaper.value = { id: wallpaper.id }

    try {
      const response = await wallpaperApi.getWallpaperDetails(wallpaper.id)
      if (requestId !== quickDetailRequestId) return

      if (response?.success && response?.image) {
        quickDetailWallpaper.value = response.image
      } else {
        quickDetailWallpaper.value = wallpaper
        quickDetailError.value = response?.error || '获取详情失败'
      }
    } catch (error) {
      if (requestId !== quickDetailRequestId) return
      quickDetailWallpaper.value = wallpaper
      quickDetailError.value = error?.message || '获取详情失败'
    } finally {
      if (requestId === quickDetailRequestId) {
        quickDetailLoading.value = false
      }
    }
  }

  function onContextMenuAction(action) {
    const wallpaper = contextMenu.value.wallpaper
    if (!wallpaper) return

    if (action === 'preview') {
      showWallpaperPreview(wallpaper)
      return
    }

    if (action === 'detail') {
      openQuickDetail(wallpaper)
      return
    }

    if (action === 'similar') {
      onFindSimilarFromCard(wallpaper)
      return
    }

    if (action === 'pending') {
      workbenchStore.addPending(wallpaper)
      notificationService.success('已加入待定池（关闭标签页后清空）', {
        duration: 3200,
        position: 'top-right',
      })
      return
    }

    if (action === 'copy') {
      const url = `https://wallhaven.cc/w/${wallpaper.id}`
      navigator.clipboard
        .writeText(url)
        .then(() => {
          notificationService.success('已复制 Wallhaven 链接', {
            duration: 2800,
            position: 'top-right',
          })
        })
        .catch(() => {
          notificationService.warning('无法写入剪贴板', {
            duration: 3500,
            position: 'top-right',
          })
          console.warn(url)
        })
    }
  }

  function closeQuickDetail() {
    quickDetailOpen.value = false
    quickDetailWallpaper.value = null
    quickDetailLoading.value = false
    quickDetailError.value = ''
    quickDetailRequestId += 1
  }

  function onQuickDetailFilterColor(hex) {
    onFilterColorFromCard(hex)
    closeQuickDetail()
  }

  function onQuickDetailPreview() {
    if (quickDetailWallpaper.value) {
      showWallpaperPreview(quickDetailWallpaper.value)
    }
  }

  function onQuickDetailSimilar() {
    if (quickDetailWallpaper.value) {
      onFindSimilarFromCard(quickDetailWallpaper.value)
    }
  }

  function openBulkCollectionModal() {
    if (!selectedWallpapers.value.length) return

    bulkCollectionWallpapers.value = [...selectedWallpapers.value]
    showBulkCollectionModal.value = true
  }

  function closeBulkCollectionModal(success = false) {
    showBulkCollectionModal.value = false
    bulkCollectionWallpapers.value = []
    if (success) {
      workbenchStore.clearSelection()
    }
  }

  return {
    previewWallpaper,
    showPreview,
    previewIndex,
    previewInListContext,
    showBulkCollectionModal,
    bulkCollectionWallpapers,
    contextMenu,
    quickDetailOpen,
    quickDetailWallpaper,
    quickDetailLoading,
    quickDetailError,
    showWallpaperPreview,
    onPreviewNext,
    onPreviewPrevious,
    closePreview,
    onSearchSpaceKeydown,
    onFilterColorFromCard,
    onWallpaperContextMenu,
    closeContextMenu,
    onContextMenuAction,
    closeQuickDetail,
    onQuickDetailFilterColor,
    onQuickDetailPreview,
    onQuickDetailSimilar,
    openBulkCollectionModal,
    closeBulkCollectionModal,
  }
}
