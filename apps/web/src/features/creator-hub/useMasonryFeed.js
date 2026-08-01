import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export function aspectScore(css) {
  const [w, h] = String(css || '')
    .split('/')
    .map((part) => Number(String(part).trim()))
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return 1 / Math.max(0.35, Math.min(w / h, 3.2))
  }
  return 1
}

export function buildBalancedMasonryColumns(items, count) {
  const columnCount = Math.max(1, Number(count || 1))
  const columns = Array.from({ length: columnCount }, () => [])
  const heights = Array.from({ length: columnCount }, () => 0)
  items.forEach((item) => {
    let target = 0
    for (let index = 1; index < heights.length; index += 1) {
      if (heights[index] < heights[target]) target = index
    }
    columns[target].push(item)
    heights[target] += Number(item.score) || 1
  })
  return columns
}

export function taskAspectCss(task, fallback = '3 / 4') {
  const raw = String(task?.aspectRatio || task?.params?.aspectRatio || '')
  const [w, h] = raw.split(':').map(Number)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w} / ${h}`

  const size = String(task?.outputSize || task?.params?.size || '')
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (match) {
    const sw = Number(match[1])
    const sh = Number(match[2])
    if (sw > 0 && sh > 0) return `${sw} / ${sh}`
  }
  return fallback
}

export function readImageAspectFromEvent(event) {
  const img =
    event?.target?.tagName === 'IMG'
      ? event.target
      : event?.target?.querySelector?.('img') || event?.currentTarget?.querySelector?.('img')
  const width = Number(img?.naturalWidth || 0)
  const height = Number(img?.naturalHeight || 0)
  if (width > 0 && height > 0) return `${width} / ${height}`
  return ''
}

/**
 * 列式瀑布流：按真实图片比例均分到最短列，并提供窗口宽度驱动的列数。
 */
export function useMasonryColumns({
  items,
  breakpoints = [
    { max: 480, cols: 1 },
    { max: 760, cols: 2 },
    { max: 1100, cols: 3 },
    { max: Infinity, cols: 4 },
  ],
  fallbackAspect = '3 / 4',
} = {}) {
  const columnCount = ref(4)
  const measuredAspects = ref({})

  function syncColumnCount() {
    const width = typeof window === 'undefined' ? 1200 : window.innerWidth
    const hit = breakpoints.find((item) => width <= item.max) || breakpoints.at(-1)
    columnCount.value = hit?.cols || 4
  }

  function rememberAspect(key, aspect) {
    const next = String(aspect || '').trim()
    if (!key || !next || measuredAspects.value[key] === next) return
    measuredAspects.value = {
      ...measuredAspects.value,
      [key]: next,
    }
  }

  function measureFromEvent(key, event) {
    const aspect = readImageAspectFromEvent(event)
    if (aspect) rememberAspect(key, aspect)
  }

  const feedItems = computed(() => {
    const rows = typeof items === 'function' ? items() : items?.value || []
    return (Array.isArray(rows) ? rows : []).map((item) => {
      const key = String(item.key || item.id || '')
      const aspect =
        measuredAspects.value[key] || item.aspect || taskAspectCss(item.task || item, fallbackAspect)
      return {
        ...item,
        key,
        aspect,
        score: aspectScore(aspect),
      }
    })
  })

  const columns = computed(() => buildBalancedMasonryColumns(feedItems.value, columnCount.value))

  onMounted(() => {
    syncColumnCount()
    window.addEventListener('resize', syncColumnCount, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', syncColumnCount)
  })

  watch(
    () => (typeof items === 'function' ? null : items?.value?.length),
    () => {
      // 列表重置时清掉过期测量，避免旧比例污染新数据
      if (!(items?.value || []).length) measuredAspects.value = {}
    },
  )

  return {
    columnCount,
    columns,
    feedItems,
    measuredAspects,
    rememberAspect,
    measureFromEvent,
    syncColumnCount,
  }
}
