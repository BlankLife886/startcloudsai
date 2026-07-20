import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const SS_PENDING = 'walleven_search_pending_pool'
const SS_HIDDEN = 'walleven_search_hidden_ids'

function readSessionJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : fallback
  } catch {
    return fallback
  }
}

function newChipId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sanitizeTag(s) {
  return String(s).replace(/\s+/g, '-').trim()
}

/** 将结构化 chips 拼成 Wallhaven `q` 后缀（与主搜索框合并） */
export function buildQuerySuffixFromChips(chips) {
  const parts = []
  for (const c of chips || []) {
    const v = String(c.value || '').trim()
    if (!v) continue
    switch (c.type) {
      case 'must':
        parts.push(`+${sanitizeTag(v)}`)
        break
      case 'exclude':
        parts.push(`-${sanitizeTag(v)}`)
        break
      case 'author':
        parts.push(`@${v.replace(/^@+/, '')}`)
        break
      case 'like':
        parts.push(`like:${v.replace(/^like:/i, '').trim()}`)
        break
      case 'ftype': {
        const ext = v.replace(/^\.?/, '').toLowerCase()
        const norm = ext === 'jpeg' ? 'jpg' : ext
        if (['jpg', 'png', 'webp'].includes(norm)) {
          parts.push(`type:${norm}`)
        }
        break
      }
      case 'keyword':
        parts.push(v)
        break
      default:
        break
    }
  }
  return parts.join(' ').trim()
}

export function mergeBaseQueryWithChips(baseQuery, chips) {
  const suffix = buildQuerySuffixFromChips(chips)
  const b = String(baseQuery || '').trim()
  if (!suffix) return b
  if (!b) return suffix
  return `${b} ${suffix}`
}

export const useSearchWorkbenchStore = defineStore('searchWorkbench', () => {
  /** 多选模式：卡片点击切换选中 */
  const selectionMode = ref(false)
  const selectedIds = ref([])

  const compareItems = ref([])
  const compareDrawerOpen = ref(false)

  /** 高级 q 片段：must / exclude / author / like / ftype / keyword */
  const queryChips = ref([])

  /** 本标签页会话：待定池（离开搜索页再回来仍可恢复） */
  const pendingPool = ref(readSessionJson(SS_PENDING, []))
  /** 仅本地列表隐藏（不请求 API） */
  const hiddenIds = ref(readSessionJson(SS_HIDDEN, []))

  watch(
    pendingPool,
    (v) => {
      try {
        sessionStorage.setItem(SS_PENDING, JSON.stringify((v || []).slice(0, 200)))
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  )

  watch(
    hiddenIds,
    (v) => {
      try {
        sessionStorage.setItem(SS_HIDDEN, JSON.stringify(v || []))
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  )

  const selectedCount = computed(() => selectedIds.value.length)
  const pendingCount = computed(() => pendingPool.value.length)

  function composeQuery(baseQuery) {
    return mergeBaseQueryWithChips(baseQuery, queryChips.value)
  }

  function toggleSelectionMode() {
    selectionMode.value = !selectionMode.value
    if (!selectionMode.value) {
      selectedIds.value = []
    }
  }

  function toggleSelectId(id) {
    const sid = String(id)
    const i = selectedIds.value.indexOf(sid)
    if (i >= 0) {
      selectedIds.value = selectedIds.value.filter((x) => x !== sid)
    } else {
      selectedIds.value = [...selectedIds.value, sid]
    }
  }

  function clearSelection() {
    selectedIds.value = []
  }

  /** 将当前列表中的 id 全部并入多选（用于「全选本页」） */
  function selectAllIds(ids) {
    const set = new Set(selectedIds.value.map(String))
    for (const id of ids || []) {
      if (id != null && id !== '') set.add(String(id))
    }
    selectedIds.value = [...set]
  }

  /** 从多选中移除一批 id（用于「取消全选本页」等） */
  function deselectIds(ids) {
    const drop = new Set((ids || []).map((x) => String(x)))
    selectedIds.value = selectedIds.value.filter((id) => !drop.has(String(id)))
  }

  function isSelected(id) {
    return selectedIds.value.includes(String(id))
  }

  function addChip(type, value) {
    const v = String(value || '').trim()
    if (!v) return
    queryChips.value = [...queryChips.value, { id: newChipId(), type, value: v }]
  }

  function removeChip(chipId) {
    queryChips.value = queryChips.value.filter((c) => c.id !== chipId)
  }

  function clearChips() {
    queryChips.value = []
  }

  /** 对比抽屉最多 4 张，满则挤掉最早一张 */
  function addToCompare(wp) {
    if (!wp?.id) return
    const id = String(wp.id)
    if (compareItems.value.some((x) => String(x.id) === id)) {
      compareDrawerOpen.value = true
      return
    }
    const next = [...compareItems.value, wp]
    if (next.length > 4) {
      compareItems.value = next.slice(-4)
    } else {
      compareItems.value = next
    }
    compareDrawerOpen.value = true
  }

  function removeFromCompare(id) {
    const sid = String(id)
    compareItems.value = compareItems.value.filter((x) => String(x.id) !== sid)
  }

  function clearCompare() {
    compareItems.value = []
  }

  function openCompareDrawer() {
    compareDrawerOpen.value = true
  }

  function closeCompareDrawer() {
    compareDrawerOpen.value = false
  }

  function addPending(wp) {
    if (!wp?.id) return
    const id = String(wp.id)
    const entry = {
      id,
      thumbnail: wp.thumbnail || '',
      path: wp.path || '',
      resolution: wp.resolution || '',
    }
    const rest = pendingPool.value.filter((x) => String(x.id) !== id)
    pendingPool.value = [entry, ...rest].slice(0, 200)
  }

  function addPendingMany(list) {
    if (!Array.isArray(list)) return
    for (const w of list) {
      addPending(w)
    }
  }

  function removePending(id) {
    const sid = String(id)
    pendingPool.value = pendingPool.value.filter((x) => String(x.id) !== sid)
  }

  function clearPending() {
    pendingPool.value = []
  }

  function hideIds(ids) {
    const set = new Set(hiddenIds.value.map(String))
    for (const raw of ids || []) {
      set.add(String(raw))
    }
    hiddenIds.value = [...set]
  }

  function unhideId(id) {
    const sid = String(id)
    hiddenIds.value = hiddenIds.value.filter((x) => String(x) !== sid)
  }

  function clearHidden() {
    hiddenIds.value = []
  }

  function isHiddenId(id) {
    return hiddenIds.value.includes(String(id))
  }

  return {
    selectionMode,
    selectedIds,
    selectedCount,
    compareItems,
    compareDrawerOpen,
    queryChips,
    pendingPool,
    pendingCount,
    hiddenIds,
    composeQuery,
    toggleSelectionMode,
    toggleSelectId,
    clearSelection,
    selectAllIds,
    deselectIds,
    isSelected,
    addChip,
    removeChip,
    clearChips,
    addToCompare,
    removeFromCompare,
    clearCompare,
    openCompareDrawer,
    closeCompareDrawer,
    addPending,
    addPendingMany,
    removePending,
    clearPending,
    hideIds,
    unhideId,
    clearHidden,
    isHiddenId,
  }
})
