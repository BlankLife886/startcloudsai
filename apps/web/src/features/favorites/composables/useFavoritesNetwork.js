import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  doesFavoriteMatchFacet,
  getFacetKey,
  getFacetMeta,
  getFavoriteFacets,
} from '@/features/favorites/utils/favoriteFacets'

const FACET_CAP = 8
const FACET_RADIUS = 34
const FACET_PRIORITY = { tag: 0, category: 1, resolution: 2, purity: 3 }

function pickPrimaryFacet(item, facets) {
  const matches = facets.filter((facet) => doesFavoriteMatchFacet(item, facet))
  if (!matches.length) return null
  return [...matches].sort((a, b) => {
    const pa = FACET_PRIORITY[a.type] ?? 9
    const pb = FACET_PRIORITY[b.type] ?? 9
    if (pa !== pb) return pa - pb
    return (b.count || 0) - (a.count || 0)
  })[0]
}

function polar(angle, radius) {
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
  }
}

function shortenSegment(x1, y1, x2, y2, trimStart = 0, trimEnd = 0) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: x1 + ux * trimStart,
    y1: y1 + uy * trimStart,
    x2: x2 - ux * trimEnd,
    y2: y2 - uy * trimEnd,
  }
}

/**
 * 关系网：左侧维度辐射图 + 右侧关联壁纸格
 * sourceFavorites 不含维度筛选，避免点维度后整图坍缩、图片变少
 */
export function useFavoritesNetwork({ sourceFavorites, lockedFacetKey }) {
  const networkCanvasRef = ref(null)
  const hoverFacetKey = ref(null)
  const networkReady = ref(false)
  let pointerFrame = 0
  let pendingPointer = { x: 0, y: 0 }

  const focusFacetKey = computed(() => {
    return hoverFacetKey.value || lockedFacetKey?.value || null
  })

  const networkFacets = computed(() => {
    const counter = new Map()

    ;(sourceFavorites?.value || []).forEach((item) => {
      getFavoriteFacets(item).forEach((facet) => {
        const key = getFacetKey(facet)
        const current = counter.get(key)
        if (current) {
          current.count += 1
          return
        }
        counter.set(key, { ...facet, key, count: 1 })
      })
    })

    return Array.from(counter.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, FACET_CAP)
  })

  const networkTagNodes = computed(() => {
    const facets = networkFacets.value
    const total = Math.max(facets.length, 1)
    return facets.map((facet, index) => {
      const angle = -Math.PI / 2 + (index / total) * Math.PI * 2
      const meta = getFacetMeta(facet.type)
      const point = polar(angle, FACET_RADIUS)
      return {
        ...facet,
        typeLabel: meta.label,
        icon: meta.icon,
        angle,
        index,
        x: point.x,
        y: point.y,
      }
    })
  })

  const networkSpokes = computed(() => {
    return networkTagNodes.value.map((facet) => {
      const segment = shortenSegment(50, 50, facet.x, facet.y, 6, 5)
      return {
        id: `spoke-${facet.key}`,
        facetKey: facet.key,
        ...segment,
      }
    })
  })

  const networkPanelItems = computed(() => {
    const facets = networkFacets.value
    const items = sourceFavorites?.value || []
    const focusKey = focusFacetKey.value

    let list = items
    let mode = 'all'
    let focusFacet = null

    if (focusKey) {
      focusFacet = facets.find((item) => item.key === focusKey) || null
      if (focusFacet) {
        const meta = getFacetMeta(focusFacet.type)
        focusFacet = {
          ...focusFacet,
          typeLabel: meta.label,
          icon: meta.icon,
        }
        list = items.filter((item) => doesFavoriteMatchFacet(item, focusFacet))
        mode = 'focus'
      }
    }

    const visible = list.map((item, index) => {
      const primary = pickPrimaryFacet(item, facets)
      return {
        item,
        index,
        facetKey: primary ? getFacetKey(primary) : null,
        key: `${item?.id || 'item'}-${index}`,
      }
    })

    return {
      mode,
      focusFacet,
      items: visible,
      total: list.length,
      hidden: 0,
    }
  })

  const networkMeta = computed(() => ({
    totalItems: sourceFavorites.value.length,
    facetCount: networkFacets.value.length,
    panelTotal: networkPanelItems.value.total,
    panelVisible: networkPanelItems.value.items.length,
    panelHidden: networkPanelItems.value.hidden,
    panelMode: networkPanelItems.value.mode,
    focusLabel: networkPanelItems.value.focusFacet
      ? `${networkPanelItems.value.focusFacet.typeLabel} · ${networkPanelItems.value.focusFacet.label}`
      : '全部收藏',
  }))

  const networkWallpaperNodes = computed(() => networkPanelItems.value.items)
  const networkEdges = computed(() => networkSpokes.value)

  function setHoverFacet(key) {
    hoverFacetKey.value = key || null
  }

  function clearHoverFacet() {
    hoverFacetKey.value = null
  }

  function handleNetworkPointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    pendingPointer = {
      x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2)),
      y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2)),
    }

    if (pointerFrame) return
    pointerFrame = window.requestAnimationFrame(() => {
      const canvas = networkCanvasRef.value
      if (canvas) {
        canvas.style.setProperty('--net-shift-x', `${pendingPointer.x * 5}px`)
        canvas.style.setProperty('--net-shift-y', `${pendingPointer.y * 4}px`)
        canvas.classList.add('is-interacting')
      }
      pointerFrame = 0
    })
  }

  function resetNetworkPointer() {
    pendingPointer = { x: 0, y: 0 }
    if (pointerFrame) {
      window.cancelAnimationFrame(pointerFrame)
      pointerFrame = 0
    }
    const canvas = networkCanvasRef.value
    if (!canvas) return
    canvas.style.setProperty('--net-shift-x', '0px')
    canvas.style.setProperty('--net-shift-y', '0px')
    canvas.classList.remove('is-interacting')
  }

  function markNetworkReady() {
    networkReady.value = false
    requestAnimationFrame(() => {
      networkReady.value = true
    })
  }

  watch(
    () => sourceFavorites?.value?.length ?? 0,
    () => {
      markNetworkReady()
    },
  )

  onBeforeUnmount(() => {
    if (pointerFrame) window.cancelAnimationFrame(pointerFrame)
  })

  return {
    networkCanvasRef,
    networkTagNodes,
    networkWallpaperNodes,
    networkEdges,
    networkPanelItems,
    networkMeta,
    hoverFacetKey,
    focusFacetKey,
    networkReady,
    setHoverFacet,
    clearHoverFacet,
    handleNetworkPointerMove,
    resetNetworkPointer,
    markNetworkReady,
  }
}
