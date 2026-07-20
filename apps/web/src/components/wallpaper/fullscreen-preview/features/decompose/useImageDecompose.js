import { computed, ref } from 'vue'

// 图片分解业务集中在这里：按网格切图、选择分块并批量下载。
export function useImageDecompose({
  previewDisplayUrl,
  loadImageFromSrc,
  notificationService,
  getFilenamePrefix = () => 'wallpaper',
}) {
  const showDecomposePanel = ref(false)
  const decomposedTiles = ref([])
  const transitionTiles = ref([])
  const decomposeGridSize = ref(3)
  const isDecomposeSwitching = ref(false)
  const sourceOrientation = ref('landscape')
  const sourceAspectRatio = ref('16 / 9')

  const selectedTileCount = computed(
    () => decomposedTiles.value.filter((item) => item.selected).length,
  )
  const decomposeTileCount = computed(() => decomposeGridSize.value * decomposeGridSize.value)
  const decomposeLayoutMode = computed(() => sourceOrientation.value)

  function closeDecomposePanel() {
    showDecomposePanel.value = false
  }

  function resetDecompose() {
    showDecomposePanel.value = false
    decomposedTiles.value = []
    transitionTiles.value = []
    isDecomposeSwitching.value = false
  }

  async function buildDecomposedTiles(size) {
    const img = await loadImageFromSrc(previewDisplayUrl.value)
    if (!img) {
      notificationService.error('分解失败：图片加载异常')
      return null
    }
    sourceOrientation.value = img.naturalWidth >= img.naturalHeight ? 'landscape' : 'portrait'
    sourceAspectRatio.value = `${img.naturalWidth} / ${img.naturalHeight}`
    const cols = Number(size) || 3
    const rows = cols
    const tileW = Math.floor(img.naturalWidth / cols)
    const tileH = Math.floor(img.naturalHeight / rows)
    const nextTiles = []
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const sx = col * tileW
        const sy = row * tileH
        const sw = col === cols - 1 ? img.naturalWidth - sx : tileW
        const sh = row === rows - 1 ? img.naturalHeight - sy : tileH
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
        let dataUrl = ''
        try {
          dataUrl = canvas.toDataURL('image/jpeg', 0.95)
        } catch {
          notificationService.error('分解失败：跨域图片无法导出，请开启代理后重试')
          return null
        }
        nextTiles.push({
          id: `r${row + 1}c${col + 1}`,
          row: row + 1,
          col: col + 1,
          index: row * cols + col + 1,
          dataUrl,
          selected: true,
          aspectRatio: `${sw} / ${sh}`,
        })
      }
    }
    return nextTiles
  }

  async function decomposeImage({ silent = false } = {}) {
    const nextTiles = await buildDecomposedTiles(decomposeGridSize.value)
    if (!nextTiles) return false
    decomposedTiles.value = nextTiles
    transitionTiles.value = []
    showDecomposePanel.value = true
    if (!silent) {
      notificationService.success(
        `已按 ${decomposeGridSize.value}x${decomposeGridSize.value} 分解为 ${nextTiles.length} 块，请确认后下载`,
      )
    }
    return true
  }

  async function setDecomposeGridSize(size) {
    const next = Number(size)
    if (![2, 3, 4].includes(next)) return
    if (decomposeGridSize.value === next) return
    const nextTiles = await buildDecomposedTiles(next)
    if (nextTiles) {
      transitionTiles.value = nextTiles
      isDecomposeSwitching.value = true
      showDecomposePanel.value = true
      window.setTimeout(() => {
        decomposeGridSize.value = next
        decomposedTiles.value = nextTiles
        transitionTiles.value = []
        isDecomposeSwitching.value = false
      }, 180)
    }
  }

  function toggleDecomposedTile(id) {
    const target = decomposedTiles.value.find((item) => item.id === id)
    if (!target) return
    target.selected = !target.selected
  }

  function setAllTilesSelected(selected) {
    decomposedTiles.value.forEach((item) => {
      item.selected = selected
    })
  }

  function downloadDecomposedTiles({ selectedOnly = false } = {}) {
    const list = selectedOnly
      ? decomposedTiles.value.filter((item) => item.selected)
      : decomposedTiles.value
    if (!list.length) {
      notificationService.warning('请至少选择一张分解图片')
      return
    }
    const prefix = getFilenamePrefix()
    for (const tile of list) {
      const link = document.createElement('a')
      link.href = tile.dataUrl
      link.download = `${prefix}_tile_${tile.id}.jpg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    notificationService.success(`已开始下载 ${list.length} 张分解图片`)
  }

  return {
    closeDecomposePanel,
    decomposedTiles,
    transitionTiles,
    decomposeGridSize,
    decomposeImage,
    decomposeTileCount,
    downloadDecomposedTiles,
    isDecomposeSwitching,
    decomposeLayoutMode,
    sourceAspectRatio,
    resetDecompose,
    selectedTileCount,
    setDecomposeGridSize,
    setAllTilesSelected,
    showDecomposePanel,
    toggleDecomposedTile,
  }
}
