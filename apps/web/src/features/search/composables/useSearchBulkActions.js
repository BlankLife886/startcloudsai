import { computed } from 'vue'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'

export function useSearchBulkActions({
  wallpapers,
  displayWallpapers,
  searchParams,
  workbenchStore,
  favoritesStore,
  notificationService,
  invalidateSearchSignature,
  applyFilters,
}) {
  const selectedWallpapers = computed(() => {
    const selectedIds = new Set(workbenchStore.selectedIds.map(String))
    return wallpapers.value.filter((wallpaper) => selectedIds.has(String(wallpaper.id)))
  })

  const allVisibleWallpapersSelected = computed(() => {
    const list = displayWallpapers.value
    if (!list.length) return false
    const selectedIds = new Set(workbenchStore.selectedIds.map(String))
    return list.every((wallpaper) => selectedIds.has(String(wallpaper.id)))
  })

  function toggleSelectAllVisible() {
    if (!displayWallpapers.value.length) return
    if (!workbenchStore.selectionMode) workbenchStore.toggleSelectionMode()

    const ids = displayWallpapers.value.map((wallpaper) => wallpaper.id)
    if (allVisibleWallpapersSelected.value) {
      workbenchStore.deselectIds(ids)
    } else {
      workbenchStore.selectAllIds(ids)
    }
  }

  function onToggleWorkbenchSelect(id) {
    workbenchStore.toggleSelectId(id)
  }

  function bulkAddSelectionToCompare() {
    const byId = new Map(wallpapers.value.map((wallpaper) => [String(wallpaper.id), wallpaper]))

    for (const selectedId of workbenchStore.selectedIds) {
      const wallpaper = byId.get(String(selectedId))
      if (wallpaper) workbenchStore.addToCompare(wallpaper)
    }

    workbenchStore.openCompareDrawer()
  }

  function bulkExportLinks() {
    const lines = selectedWallpapers.value.map(
      (wallpaper) => `https://wallhaven.cc/w/${wallpaper.id}`,
    )
    const text = lines.join('\n')
    if (!text) return

    navigator.clipboard
      .writeText(text)
      .then(() => {
        notificationService.success(`已复制 ${lines.length} 条 Wallhaven 链接`, {
          duration: 3000,
          position: 'top-right',
        })
      })
      .catch(() => {
        notificationService.warning('无法写入剪贴板，请查看控制台', {
          duration: 4000,
          position: 'top-right',
        })
        console.warn(text)
      })
  }

  function bulkAddPending() {
    workbenchStore.addPendingMany(selectedWallpapers.value)
    workbenchStore.clearSelection()
    notificationService.success('已加入待定池（关闭标签页后清空）', {
      duration: 3200,
      position: 'top-right',
    })
  }

  function bulkHideSelected() {
    workbenchStore.hideIds(selectedWallpapers.value.map((wallpaper) => wallpaper.id))
    workbenchStore.clearSelection()
    notificationService.info('已从当前列表隐藏（仅本会话，可点「恢复隐藏」）', {
      duration: 4000,
      position: 'top-right',
    })
  }

  function hideSingleWallpaper(wallpaper) {
    if (!wallpaper?.id) return
    workbenchStore.hideIds([wallpaper.id])
    workbenchStore.deselectIds([wallpaper.id])
    notificationService.info('已隐藏 1 张图片（可点「恢复隐藏」）', {
      duration: 2600,
      position: 'top-right',
    })
  }

  async function bulkDownloadSelection() {
    const list = selectedWallpapers.value
    if (!list.length) return
    await downloadWallpapersUnified(list, {
      scope: searchParams.value?.query || 'selected',
      filename: searchParams.value?.query ? `搜索-${searchParams.value.query}` : 'selected-wallpapers',
    })
  }

  function bulkFavoriteSelection() {
    const list = selectedWallpapers.value
    let added = 0

    for (const wallpaper of list) {
      if (favoritesStore.addFavorite(wallpaper)) {
        added += 1
      }
    }

    if (added > 0) {
      notificationService.success(`已加入收藏 ${added} 张`, {
        duration: 4000,
        position: 'top-right',
      })
    } else {
      notificationService.info('所选壁纸均已收藏', {
        duration: 3000,
        position: 'top-right',
      })
    }
  }

  function onFindSimilarFromCard(wallpaper) {
    if (!wallpaper?.id) return

    workbenchStore.clearChips()
    const id = String(wallpaper.id)
      .replace(/^wallhaven-/, '')
      .replace(/^like:/i, '')
      .trim()

    searchParams.value.query = `like:${id}`
    searchParams.value.page = 1
    invalidateSearchSignature()
    applyFilters()

    notificationService.info(`已切换到相似流：like:${id}`, {
      duration: 3500,
      position: 'top-right',
    })
  }

  function removePendingEntry(id) {
    workbenchStore.removePending(id)
  }

  return {
    selectedWallpapers,
    allVisibleWallpapersSelected,
    toggleSelectAllVisible,
    onToggleWorkbenchSelect,
    bulkAddSelectionToCompare,
    bulkExportLinks,
    bulkAddPending,
    bulkHideSelected,
    hideSingleWallpaper,
    bulkDownloadSelection,
    bulkFavoriteSelection,
    onFindSimilarFromCard,
    removePendingEntry,
  }
}
