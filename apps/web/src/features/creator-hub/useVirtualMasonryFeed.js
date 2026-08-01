import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

function numericAspect(value, fallback = 3 / 4) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  const parts = String(value || '')
    .split(/[/:]/)
    .map((part) => Number(part.trim()))
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0)) {
    return parts[0] / parts[1]
  }
  return fallback
}

export function buildVirtualMasonryLayout(
  items,
  containerWidth,
  {
    gap = 14,
    minColumnWidth = 220,
    maxColumns = 4,
    bodyHeight = 178,
    fallbackAspect = 3 / 4,
    getAspect = (entry) => entry?.aspect,
  } = {},
) {
  const width = Math.max(0, Number(containerWidth) || 0)
  if (!width) return { columns: 1, columnWidth: 0, height: 0, positions: [] }

  const columns = Math.max(
    1,
    Math.min(maxColumns, Math.floor((width + gap) / (minColumnWidth + gap)) || 1),
  )
  const columnWidth = (width - gap * (columns - 1)) / columns
  const heights = Array.from({ length: columns }, () => 0)
  const positions = (Array.isArray(items) ? items : []).map((item, index) => {
    let column = 0
    for (let candidate = 1; candidate < columns; candidate += 1) {
      if (heights[candidate] < heights[column]) column = candidate
    }

    const aspect = Math.min(5, Math.max(0.2, numericAspect(getAspect(item), fallbackAspect)))
    const mediaHeight = Math.round(Math.max(1, columnWidth - 2) / aspect)
    const height = mediaHeight + bodyHeight + 2
    const position = {
      ...item,
      item: item?.item ?? item,
      index: Number.isInteger(item?.index) ? item.index : index,
      key: String(item?.key || item?.id || index),
      top: heights[column],
      left: column * (columnWidth + gap),
      width: columnWidth,
      height,
      mediaHeight,
    }
    heights[column] += height + gap
    return position
  })

  return {
    columns,
    columnWidth,
    height: Math.max(0, ...heights) - (positions.length ? gap : 0),
    positions,
  }
}

/**
 * Window-scrolling masonry with viewport virtualization. Card dimensions are
 * deterministic, so scrolling never requires measuring every card in the DOM.
 */
export function useVirtualMasonryFeed({
  items,
  gap = 14,
  minColumnWidth = 220,
  maxColumns = 4,
  bodyHeight = 178,
  overscan = 900,
  fallbackAspect = 3 / 4,
  getAspect,
} = {}) {
  const containerRef = ref(null)
  const containerWidth = ref(0)
  const viewportStart = ref(0)
  const viewportEnd = ref(0)
  const measuredAspects = ref({})
  let resizeObserver = null
  let observedRoot = null
  let frame = 0
  let aspectFrame = 0
  let pendingAspects = {}

  const rows = computed(() => {
    const value = typeof items === 'function' ? items() : items?.value
    return Array.isArray(value) ? value : []
  })

  const layout = computed(() =>
    buildVirtualMasonryLayout(rows.value, containerWidth.value, {
      gap,
      minColumnWidth,
      maxColumns,
      bodyHeight,
      fallbackAspect,
      getAspect: (entry) =>
        measuredAspects.value[String(entry?.key || entry?.id || '')] || getAspect?.(entry),
    }),
  )

  const visibleItems = computed(() => {
    const start = viewportStart.value - overscan
    const end = viewportEnd.value + overscan
    return layout.value.positions.filter(
      (entry) => entry.top + entry.height >= start && entry.top <= end,
    )
  })

  function measureViewport() {
    frame = 0
    const root = containerRef.value
    if (!root || typeof window === 'undefined') return
    if (resizeObserver && observedRoot !== root) {
      if (observedRoot) resizeObserver.unobserve(observedRoot)
      resizeObserver.observe(root)
      observedRoot = root
    }
    const rect = root.getBoundingClientRect()
    if (rect.width > 0 && Math.abs(containerWidth.value - rect.width) > 0.5) {
      containerWidth.value = rect.width
    }
    viewportStart.value = -rect.top
    viewportEnd.value = viewportStart.value + window.innerHeight
  }

  function scheduleViewportMeasure() {
    if (frame || typeof window === 'undefined') return
    frame = window.requestAnimationFrame(measureViewport)
  }

  function rememberAspect(key, aspect) {
    const normalized = numericAspect(aspect, 0)
    if (!key || normalized <= 0 || measuredAspects.value[key] === normalized) return
    pendingAspects[key] = normalized
    if (typeof window === 'undefined') {
      measuredAspects.value = { ...measuredAspects.value, ...pendingAspects }
      pendingAspects = {}
      return
    }
    if (aspectFrame) return
    aspectFrame = window.requestAnimationFrame(() => {
      aspectFrame = 0
      measuredAspects.value = { ...measuredAspects.value, ...pendingAspects }
      pendingAspects = {}
      scheduleViewportMeasure()
    })
  }

  function measureFromEvent(key, event) {
    const image = event?.target
    const width = Number(image?.naturalWidth || 0)
    const height = Number(image?.naturalHeight || 0)
    if (width > 0 && height > 0) rememberAspect(key, width / height)
  }

  onMounted(() => {
    window.addEventListener('scroll', scheduleViewportMeasure, { passive: true })
    window.addEventListener('resize', scheduleViewportMeasure, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleViewportMeasure)
    }
    nextTick(measureViewport)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', scheduleViewportMeasure)
    window.removeEventListener('resize', scheduleViewportMeasure)
    resizeObserver?.disconnect()
    observedRoot = null
    if (frame) window.cancelAnimationFrame(frame)
    if (aspectFrame) window.cancelAnimationFrame(aspectFrame)
  })

  watch(
    () => rows.value.length,
    () => nextTick(scheduleViewportMeasure),
  )

  return {
    containerRef,
    columnCount: computed(() => layout.value.columns),
    totalHeight: computed(() => layout.value.height),
    visibleItems,
    measuredAspects,
    rememberAspect,
    measureFromEvent,
    scheduleViewportMeasure,
  }
}
