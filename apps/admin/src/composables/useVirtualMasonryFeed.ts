import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch, type Ref } from 'vue'

export type MasonryAspect = number | string | null | undefined

export interface MasonryFeedItem {
  key?: string | number
  id?: string | number
  index?: number
  aspect?: MasonryAspect
  item?: unknown
  [key: string]: unknown
}

export interface MasonryLayoutPosition<T extends MasonryFeedItem = MasonryFeedItem> extends MasonryFeedItem {
  item: T extends { item: infer U } ? U : T
  index: number
  key: string
  top: number
  left: number
  width: number
  height: number
  mediaHeight: number
}

function numericAspect(value: MasonryAspect, fallback = 3 / 4) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  const parts = String(value || '')
    .split(/[/:]/)
    .map((part) => Number(part.trim()))
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0)) {
    return parts[0] / parts[1]
  }
  return fallback
}

export function buildVirtualMasonryLayout<T extends MasonryFeedItem>(
  items: T[],
  containerWidth: number,
  {
    gap = 14,
    minColumnWidth = 220,
    maxColumns = 4,
    bodyHeight = 178,
    /** 封面相对卡片左右内边距（单侧），用于按真实图片宽度算高度，避免 contain 上下留白 */
    mediaInset = 0,
    fallbackAspect = 3 / 4,
    getAspect = (entry: T) => entry?.aspect,
  }: {
    gap?: number
    minColumnWidth?: number
    maxColumns?: number
    bodyHeight?: number
    mediaInset?: number
    fallbackAspect?: number
    getAspect?: (entry: T) => MasonryAspect
  } = {},
) {
  const width = Math.max(0, Number(containerWidth) || 0)
  if (!width) return { columns: 1, columnWidth: 0, height: 0, positions: [] as MasonryLayoutPosition<T>[] }

  const columns = Math.max(
    1,
    Math.min(maxColumns, Math.floor((width + gap) / (minColumnWidth + gap)) || 1),
  )
  const columnWidth = (width - gap * (columns - 1)) / columns
  const inset = Math.max(0, Number(mediaInset) || 0)
  const heights = Array.from({ length: columns }, () => 0)
  const positions = (Array.isArray(items) ? items : []).map((item, index) => {
    let column = 0
    for (let candidate = 1; candidate < columns; candidate += 1) {
      if (heights[candidate]! < heights[column]!) column = candidate
    }

    const aspect = Math.min(5, Math.max(0.2, numericAspect(getAspect(item), fallbackAspect)))
    const mediaWidth = Math.max(1, columnWidth - 2 - inset * 2)
    const mediaHeight = Math.round(mediaWidth / aspect)
    const height = mediaHeight + bodyHeight + 2
    const position = {
      ...item,
      item: (item?.item ?? item) as MasonryLayoutPosition<T>['item'],
      index: Number.isInteger(item?.index) ? (item.index as number) : index,
      key: String(item?.key || item?.id || index),
      top: heights[column]!,
      left: column * (columnWidth + gap),
      width: columnWidth,
      height,
      mediaHeight,
    } satisfies MasonryLayoutPosition<T>
    heights[column]! += height + gap
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
 * 与用户端提示词页同款：最短列瀑布流 + 像素高度占位 + 视口虚拟化。
 * scrollParent 用于管理端内部滚动容器（非 window）。
 */
export function useVirtualMasonryFeed<T extends MasonryFeedItem>(options: {
  items: Ref<T[]> | (() => T[])
  gap?: number
  minColumnWidth?: number
  maxColumns?: number
  bodyHeight?: number
  mediaInset?: number
  overscan?: number
  fallbackAspect?: number
  getAspect?: (entry: T) => MasonryAspect
  scrollParent?: Ref<HTMLElement | null | undefined>
}) {
  const {
    items,
    gap = 14,
    minColumnWidth = 220,
    maxColumns = 4,
    bodyHeight = 178,
    mediaInset = 0,
    overscan = 900,
    fallbackAspect = 3 / 4,
    getAspect,
    scrollParent,
  } = options

  const containerRef = ref<HTMLElement | null>(null)
  const containerWidth = ref(0)
  const viewportStart = ref(0)
  const viewportEnd = ref(0)
  const measuredAspects = ref<Record<string, number>>({})
  let resizeObserver: ResizeObserver | null = null
  let observedRoot: HTMLElement | null = null
  let frame = 0
  let aspectFrame = 0
  let pendingAspects: Record<string, number> = {}

  const rows = computed(() => {
    const value = typeof items === 'function' ? items() : unref(items)
    return Array.isArray(value) ? value : []
  })

  const layout = computed(() =>
    buildVirtualMasonryLayout(rows.value, containerWidth.value, {
      gap,
      minColumnWidth,
      maxColumns,
      bodyHeight,
      mediaInset,
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

    const scroller = scrollParent ? unref(scrollParent) : null
    if (scroller) {
      const parentRect = scroller.getBoundingClientRect()
      viewportStart.value = parentRect.top - rect.top
      viewportEnd.value = parentRect.bottom - rect.top
      return
    }

    viewportStart.value = -rect.top
    viewportEnd.value = viewportStart.value + window.innerHeight
  }

  function scheduleViewportMeasure() {
    if (frame || typeof window === 'undefined') return
    frame = window.requestAnimationFrame(measureViewport)
  }

  function rememberAspect(key: string, aspect: MasonryAspect) {
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

  function measureFromEvent(key: string, event: Event) {
    const image = event?.target as HTMLImageElement | null
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

  watch(
    () => (scrollParent ? unref(scrollParent) : null),
    (el, prev) => {
      if (prev) prev.removeEventListener('scroll', scheduleViewportMeasure)
      if (el) el.addEventListener('scroll', scheduleViewportMeasure, { passive: true })
      nextTick(scheduleViewportMeasure)
    },
    { immediate: true },
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
