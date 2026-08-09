<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { DESIGN_DEVICE_OPTIONS } from '@/features/design-workshop/designDevices'
import { collectDescendants, collectOutputUrls } from '@/features/design-workshop/versionTree'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'

const DRAWER_WIDTH_KEY = 'ui-design-version-drawer-width-v1'
const DEFAULT_DRAWER_WIDTH = 520
const MIN_DRAWER_WIDTH = 360
const MAX_DRAWER_WIDTH = 860

const props = defineProps({
  open: { type: Boolean, default: false },
  forest: { type: Array, default: () => [] },
  focusMajorId: { type: String, default: '' },
  activeOutput: { type: String, default: '' },
  activeNodeId: { type: String, default: '' },
  isLight: { type: Boolean, default: false },
  deleting: { type: Boolean, default: false },
  historyHasMore: { type: Boolean, default: false },
  historyLoading: { type: Boolean, default: false },
})

const emit = defineEmits([
  'close',
  'select-node',
  'iterate-node',
  'analyze-node',
  'delete-nodes',
  'load-more',
])

const selectedIds = ref([])
const expandedMajorIds = ref([])
const bodyRef = ref(null)
const sentinelRef = ref(null)
const drawerWidth = ref(readStoredDrawerWidth())
const resizing = ref(false)
let loadObserver = null
let resizeSession = null

function maxDrawerWidth() {
  if (typeof window === 'undefined') return MAX_DRAWER_WIDTH
  return Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, window.innerWidth - 48))
}

function clampDrawerWidth(value) {
  const width = Math.round(Number(value) || DEFAULT_DRAWER_WIDTH)
  return Math.min(maxDrawerWidth(), Math.max(MIN_DRAWER_WIDTH, width))
}

function readStoredDrawerWidth() {
  try {
    const raw = Number(getScopedLocalItem(DRAWER_WIDTH_KEY) || '')
    if (Number.isFinite(raw) && raw > 0) return clampDrawerWidth(raw)
  } catch {
    // ignore damaged storage
  }
  return DEFAULT_DRAWER_WIDTH
}

function persistDrawerWidth(width) {
  const next = clampDrawerWidth(width)
  drawerWidth.value = next
  setScopedLocalItem(DRAWER_WIDTH_KEY, String(next))
}

const drawerStyle = computed(() => ({
  width: `${drawerWidth.value}px`,
  maxWidth: '100vw',
}))

function beginResize(event) {
  if (event.button != null && event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const startWidth = drawerWidth.value
  resizeSession = { startX, startWidth, pointerId: event.pointerId }
  resizing.value = true
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', endResize)
  window.addEventListener('pointercancel', endResize)
}

function onResizeMove(event) {
  if (!resizeSession) return
  // 抽屉贴右：向左拖增大宽度。
  const delta = resizeSession.startX - event.clientX
  drawerWidth.value = clampDrawerWidth(resizeSession.startWidth + delta)
}

function endResize() {
  if (!resizeSession) return
  persistDrawerWidth(drawerWidth.value)
  resizeSession = null
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', endResize)
  window.removeEventListener('pointercancel', endResize)
}

function onViewportResize() {
  drawerWidth.value = clampDrawerWidth(drawerWidth.value)
}

watch(
  () => [props.open, props.focusMajorId, props.forest.map((item) => item.id).join('|')].join('::'),
  () => {
    if (!props.open) return
    drawerWidth.value = clampDrawerWidth(drawerWidth.value)
    const majors = props.forest.map((item) => item.id)
    const focus =
      props.focusMajorId && majors.includes(props.focusMajorId)
        ? props.focusMajorId
        : majors[0] || ''
    expandedMajorIds.value = focus ? [focus] : []
    selectedIds.value = []
  },
)

watch(
  () => props.open,
  (open) => {
    if (typeof window === 'undefined') return
    if (open) window.addEventListener('resize', onViewportResize, { passive: true })
    else {
      window.removeEventListener('resize', onViewportResize)
      endResize()
    }
  },
)

function setupLoadObserver() {
  loadObserver?.disconnect()
  loadObserver = null
  if (!props.open || !props.historyHasMore) return
  const root = bodyRef.value
  const target = sentinelRef.value
  if (!root || !target || typeof IntersectionObserver === 'undefined') return
  loadObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (!props.historyHasMore || props.historyLoading) return
      emit('load-more')
    },
    { root, rootMargin: '280px 0px', threshold: 0.01 },
  )
  loadObserver.observe(target)
}

watch(
  () => [props.open, props.historyHasMore, props.historyLoading, props.forest.length],
  async () => {
    await nextTick()
    setupLoadObserver()
    if (props.open && props.historyHasMore && !props.historyLoading) {
      emit('load-more')
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  loadObserver?.disconnect()
  loadObserver = null
  if (typeof window !== 'undefined') window.removeEventListener('resize', onViewportResize)
  endResize()
})

const selectedNodes = computed(() => {
  const ids = new Set(selectedIds.value)
  const nodes = []
  const walk = (list) => {
    for (const node of list || []) {
      if (ids.has(node.id)) nodes.push(node)
      walk(node.children)
    }
  }
  walk(props.forest)
  return nodes
})

const selectedCount = computed(() => selectedNodes.value.length)

const selectedImageCount = computed(() =>
  collectOutputUrls(selectedNodes.value.flatMap((node) => collectDescendants(node))).length,
)

const forestStats = computed(() => {
  let versions = 0
  let images = 0
  let analyzed = 0
  for (const major of props.forest || []) {
    const nodes = collectDescendants(major)
    versions += nodes.length
    for (const node of nodes) {
      images += carrierEntries(node).length
      if (node.analyzed) analyzed += 1
    }
  }
  return {
    majors: props.forest?.length || 0,
    versions,
    images,
    analyzed,
  }
})

function deviceMeta(deviceId) {
  return (
    DESIGN_DEVICE_OPTIONS.find((item) => item.id === deviceId) || {
      id: deviceId,
      label: deviceId,
      icon: 'bi-display',
    }
  )
}

function carrierEntries(node) {
  const order = new Map(DESIGN_DEVICE_OPTIONS.map((item, index) => [item.id, index]))
  return Object.entries(node?.carriers || {})
    .filter(([, url]) => url)
    .sort(
      ([a], [b]) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
}

function majorDevices(major) {
  const seen = new Set()
  const devices = []
  for (const node of collectDescendants(major)) {
    for (const [deviceId] of carrierEntries(node)) {
      if (seen.has(deviceId)) continue
      seen.add(deviceId)
      devices.push(deviceId)
    }
  }
  return devices
}

function majorContainsActive(major) {
  return collectDescendants(major).some(
    (node) =>
      node.id === props.activeNodeId ||
      Object.values(node.carriers || {}).includes(props.activeOutput),
  )
}

function isNodeActive(node) {
  return (
    node.id === props.activeNodeId ||
    Object.values(node.carriers || {}).includes(props.activeOutput)
  )
}

function isExpanded(id) {
  return expandedMajorIds.value.includes(id)
}

function toggleMajor(id) {
  if (isExpanded(id)) {
    expandedMajorIds.value = expandedMajorIds.value.filter((item) => item !== id)
    return
  }
  expandedMajorIds.value = [...expandedMajorIds.value, id]
}

function expandAll() {
  expandedMajorIds.value = props.forest.map((item) => item.id)
}

function collapseAll() {
  expandedMajorIds.value = props.focusMajorId ? [props.focusMajorId] : props.forest[0] ? [props.forest[0].id] : []
}

function toggleSelected(nodeId) {
  if (selectedIds.value.includes(nodeId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== nodeId)
    return
  }
  selectedIds.value = [...selectedIds.value, nodeId]
}

function clearSelection() {
  selectedIds.value = []
}

function selectAllInMajor(major) {
  const ids = collectDescendants(major).map((node) => node.id)
  const allSelected = ids.every((id) => selectedIds.value.includes(id))
  if (allSelected) {
    const drop = new Set(ids)
    selectedIds.value = selectedIds.value.filter((id) => !drop.has(id))
    return
  }
  selectedIds.value = [...new Set([...selectedIds.value, ...ids])]
}

function majorSelectionState(major) {
  const ids = collectDescendants(major).map((node) => node.id)
  if (!ids.length) return 'none'
  const selected = ids.filter((id) => selectedIds.value.includes(id)).length
  if (!selected) return 'none'
  if (selected === ids.length) return 'all'
  return 'partial'
}

function confirmDelete() {
  if (!selectedNodes.value.length || props.deleting) return
  const urls = collectOutputUrls(
    selectedNodes.value.flatMap((node) => collectDescendants(node)),
  )
  const labels = selectedNodes.value.map((node) => node.label).join('、')
  const ok = window.confirm(
    `确认删除 ${selectedNodes.value.length} 个版本（${labels}）及其子版本？共 ${urls.length} 张图。`,
  )
  if (!ok) return
  emit('delete-nodes', selectedNodes.value)
}

function openNode(node, deviceId = '') {
  emit('select-node', node, deviceId)
}

function openCarrier(node, deviceId, event) {
  event?.stopPropagation?.()
  openNode(node, deviceId)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dvd-scrim"
      :class="{ 'is-light': isLight }"
      @mousedown.self="emit('close')"
    >
      <aside
        class="dvd-drawer"
        :class="{ 'is-resizing': resizing }"
        :style="drawerStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dvd-title"
      >
        <div
          class="dvd-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整版本抽屉宽度"
          :aria-valuenow="drawerWidth"
          :aria-valuemin="MIN_DRAWER_WIDTH"
          :aria-valuemax="MAX_DRAWER_WIDTH"
          tabindex="0"
          @pointerdown="beginResize"
          @keydown.left.prevent="persistDrawerWidth(drawerWidth + 24)"
          @keydown.right.prevent="persistDrawerWidth(drawerWidth - 24)"
        >
          <i aria-hidden="true"></i>
        </div>
        <header class="dvd-header">
          <div class="dvd-heading">
            <small>VERSION HISTORY</small>
            <div class="dvd-title-row">
              <strong id="dvd-title">设计版本</strong>
              <span v-if="forestStats.majors" class="dvd-stats">
                {{ forestStats.majors }} 组 · {{ forestStats.versions }} 版 ·
                {{ forestStats.images }} 图
              </span>
            </div>
          </div>
          <button type="button" class="dvd-icon-btn" aria-label="关闭版本抽屉" @click="emit('close')">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="dvd-legend" aria-hidden="true">
          <span><b>V14</b>大版本</span>
          <span><b>V14.1</b>迭代</span>
          <span><i class="bi bi-phone"></i>多端</span>
          <span><i class="bi bi-bounding-box-circles"></i>元素分析</span>
        </div>

        <div class="dvd-toolbar">
          <div class="dvd-toolbar-left">
            <strong>{{ selectedCount ? `已选 ${selectedCount}` : '管理版本' }}</strong>
            <small v-if="selectedCount">含 {{ selectedImageCount }} 张图</small>
            <small v-else>点预览打开画布，可勾选后批量删除</small>
          </div>
          <div class="dvd-toolbar-actions">
            <button
              v-if="selectedCount"
              type="button"
              class="dvd-text-btn"
              @click="clearSelection()"
            >
              取消选择
            </button>
            <button
              type="button"
              class="dvd-text-btn"
              :disabled="!forest.length"
              @click="expandedMajorIds.length > 1 ? collapseAll() : expandAll()"
            >
              {{ expandedMajorIds.length > 1 ? '收起' : '展开全部' }}
            </button>
            <button
              type="button"
              class="dvd-danger-btn"
              :disabled="!selectedCount || deleting"
              @click="confirmDelete()"
            >
              <i class="bi bi-trash3" aria-hidden="true"></i>
              {{ deleting ? '删除中…' : '删除' }}
            </button>
          </div>
        </div>

        <div ref="bodyRef" class="dvd-body">
          <section
            v-for="major in forest"
            :key="major.id"
            class="dvd-major"
            :class="{
              'is-open': isExpanded(major.id),
              'is-focus': focusMajorId ? focusMajorId === major.id : major.id === forest[0]?.id,
              'is-current': majorContainsActive(major),
            }"
          >
            <div class="dvd-major-bar">
              <button
                type="button"
                class="dvd-major-main"
                :aria-expanded="isExpanded(major.id)"
                @click="toggleMajor(major.id)"
              >
                <span class="dvd-major-thumb">
                  <AuthenticatedImage
                    v-if="major.cover"
                    :src="major.cover"
                    alt=""
                    :max-dimension="280"
                  />
                  <i v-else class="bi bi-image" aria-hidden="true"></i>
                </span>
                <span class="dvd-major-copy">
                  <span class="dvd-major-title">
                    <strong data-no-translate>{{ major.label }}</strong>
                    <em v-if="majorContainsActive(major)">当前</em>
                    <em v-if="major.id === forest[0]?.id" class="is-latest">最新</em>
                  </span>
                  <span class="dvd-major-sub">
                    {{ 1 + major.descendantCount }} 个版本
                    <i aria-hidden="true">·</i>
                    {{ majorDevices(major).length }} 端齐套
                    <i aria-hidden="true">·</i>
                    {{ major.analyzedInTree ? '含元素分析' : '尚未分析' }}
                  </span>
                  <span class="dvd-device-chips">
                    <span
                      v-for="deviceId in majorDevices(major)"
                      :key="`${major.id}-${deviceId}`"
                      :title="deviceMeta(deviceId).label"
                    >
                      <i class="bi" :class="deviceMeta(deviceId).icon" aria-hidden="true"></i>
                      {{ deviceMeta(deviceId).label.replace('端', '') }}
                    </span>
                  </span>
                </span>
                <i
                  class="bi dvd-chevron"
                  :class="isExpanded(major.id) ? 'bi-chevron-up' : 'bi-chevron-down'"
                  aria-hidden="true"
                ></i>
              </button>
              <button
                type="button"
                class="dvd-select-all"
                :class="`is-${majorSelectionState(major)}`"
                :title="
                  majorSelectionState(major) === 'all' ? '取消全选此大版本' : '全选此大版本'
                "
                @click="selectAllInMajor(major)"
              >
                {{ majorSelectionState(major) === 'all' ? '取消' : '全选' }}
              </button>
            </div>

            <ul v-if="isExpanded(major.id)" class="dvd-tree">
              <li
                v-for="node in collectDescendants(major)"
                :key="node.id"
                class="dvd-node"
                :class="{
                  'is-active': isNodeActive(node),
                  'is-selected': selectedIds.includes(node.id),
                  'is-child': node.depth > 1,
                }"
                :style="{ '--dvd-depth': Math.max(0, node.depth - 1) }"
              >
                <label class="dvd-check" :title="selectedIds.includes(node.id) ? '取消选择' : '选择'">
                  <input
                    type="checkbox"
                    :checked="selectedIds.includes(node.id)"
                    @change="toggleSelected(node.id)"
                  />
                </label>

                <article class="dvd-card">
                  <button
                    type="button"
                    class="dvd-card-main"
                    @click="openNode(node)"
                  >
                    <span class="dvd-thumb-stack">
                      <span
                        v-for="([deviceId, url], index) in carrierEntries(node).slice(0, 3)"
                        :key="`${node.id}-thumb-${deviceId}`"
                        class="dvd-thumb"
                        :style="{ zIndex: 3 - index }"
                      >
                        <AuthenticatedImage :src="url" alt="" :max-dimension="220" />
                      </span>
                      <span
                        v-if="!carrierEntries(node).length"
                        class="dvd-thumb is-empty"
                      >
                        <i class="bi bi-image" aria-hidden="true"></i>
                      </span>
                      <em v-if="carrierEntries(node).length > 3">
                        +{{ carrierEntries(node).length - 3 }}
                      </em>
                    </span>

                    <span class="dvd-meta">
                      <span class="dvd-meta-title">
                        <strong data-no-translate>{{ node.label }}</strong>
                        <em v-if="isNodeActive(node)">画布中</em>
                        <em
                          v-if="String(node.id || '').includes('tile-refine')"
                          class="is-tile-refine"
                          >四宫格精修</em
                        >
                        <em
                          v-else-if="node.depth > 1 && !isNodeActive(node)"
                          class="is-iter"
                          >迭代</em
                        >
                      </span>
                      <small>
                        {{
                          node.analyzed
                            ? '已完成元素分析，可继续编辑'
                            : '尚未分析元素'
                        }}
                      </small>
                    </span>
                  </button>

                  <div class="dvd-carriers" role="group" :aria-label="`${node.label} 多端预览`">
                    <button
                      v-for="[deviceId, url] in carrierEntries(node)"
                      :key="`${node.id}-carrier-${deviceId}`"
                      type="button"
                      class="dvd-carrier"
                      :class="{ 'is-on': activeOutput === url }"
                      :title="`打开${deviceMeta(deviceId).label}`"
                      @click="openCarrier(node, deviceId, $event)"
                    >
                      <AuthenticatedImage :src="url" alt="" :max-dimension="180" />
                      <span>
                        <i class="bi" :class="deviceMeta(deviceId).icon" aria-hidden="true"></i>
                        {{ deviceMeta(deviceId).label }}
                      </span>
                    </button>
                  </div>

                  <div class="dvd-actions">
                    <button
                      type="button"
                      class="dvd-action"
                      :disabled="!node.canIterate"
                      :title="node.canIterate ? '基于此版本迭代' : '已达最终迭代深度'"
                      @click="emit('iterate-node', node)"
                    >
                      <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
                      迭代
                    </button>
                    <button
                      type="button"
                      class="dvd-action is-accent"
                      :title="node.analyzed ? '查看元素分析' : '分析此版本元素'"
                      @click="emit('analyze-node', node)"
                    >
                      <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
                      {{ node.analyzed ? '查看分析' : '分析元素' }}
                    </button>
                  </div>
                </article>
              </li>
            </ul>
          </section>

          <div v-if="!forest.length && !historyLoading" class="dvd-empty">
            <i class="bi bi-layers" aria-hidden="true"></i>
            <strong>还没有设计版本</strong>
            <small>生成第一稿后，这里会按大版本整理电脑 / 手机等多端结果，并支持迭代与分析。</small>
          </div>

          <div
            v-if="historyHasMore || historyLoading"
            ref="sentinelRef"
            class="dvd-sentinel"
          >
            <i
              v-if="historyLoading"
              class="bi bi-arrow-repeat spin"
              aria-hidden="true"
            ></i>
            <span>{{ historyLoading ? '正在加载更多历史…' : '下拉继续加载历史' }}</span>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.dvd-scrim {
  position: fixed;
  inset: 0;
  z-index: 3100;
  display: flex;
  justify-content: flex-end;
  background: rgba(8, 8, 14, 0.48);
  backdrop-filter: blur(6px);
}

.dvd-drawer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 520px;
  height: 100%;
  background: #12121a;
  color: #eceaf8;
  box-shadow: -24px 0 64px rgba(0, 0, 0, 0.42);
  animation: dvd-slide-in 0.22s ease-out both;
}

.dvd-drawer.is-resizing {
  transition: none;
  user-select: none;
}

.dvd-resize {
  position: absolute;
  z-index: 5;
  top: 0;
  left: 0;
  bottom: 0;
  width: 10px;
  display: grid;
  place-items: center;
  cursor: col-resize;
  touch-action: none;
}

.dvd-resize::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease;
}

.dvd-resize > i {
  width: 3px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.dvd-resize:hover::before,
.dvd-drawer.is-resizing .dvd-resize::before,
.dvd-resize:focus-visible::before {
  background: color-mix(in srgb, #7c6cff 70%, transparent);
}

.dvd-resize:hover > i,
.dvd-drawer.is-resizing .dvd-resize > i,
.dvd-resize:focus-visible > i {
  opacity: 1;
  background: #a99cff;
}

.dvd-resize:focus-visible {
  outline: none;
}

.dvd-scrim.is-light .dvd-drawer {
  background: #f4f5f9;
  color: #221f33;
  box-shadow: -24px 0 64px rgba(48, 44, 78, 0.18);
}

.dvd-scrim.is-light .dvd-resize > i {
  background: rgba(35, 37, 52, 0.22);
}

.dvd-scrim.is-light .dvd-resize:hover > i,
.dvd-scrim.is-light .dvd-drawer.is-resizing .dvd-resize > i,
.dvd-scrim.is-light .dvd-resize:focus-visible > i {
  background: #6250e8;
}

.dvd-scrim.is-light .dvd-resize:hover::before,
.dvd-scrim.is-light .dvd-drawer.is-resizing .dvd-resize::before,
.dvd-scrim.is-light .dvd-resize:focus-visible::before {
  background: color-mix(in srgb, #6250e8 65%, transparent);
}

@keyframes dvd-slide-in {
  from {
    transform: translateX(28px);
    opacity: 0.72;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.dvd-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 10px;
}

.dvd-heading small {
  display: block;
  margin-bottom: 4px;
  color: #a99cff;
  font: 700 0.56rem/1 monospace;
  letter-spacing: 0.08em;
}

.dvd-scrim.is-light .dvd-heading small {
  color: #6250e8;
}

.dvd-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 10px;
}

.dvd-title-row strong {
  font-size: 1.12rem;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.dvd-stats {
  color: rgba(236, 234, 248, 0.52);
  font-size: 0.68rem;
}

.dvd-scrim.is-light .dvd-stats {
  color: rgba(34, 31, 51, 0.5);
}

.dvd-icon-btn {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  color: inherit;
  cursor: pointer;
}

.dvd-scrim.is-light .dvd-icon-btn {
  background: rgba(35, 37, 52, 0.07);
}

.dvd-icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.dvd-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 20px 12px;
}

.dvd-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(236, 234, 248, 0.62);
  font-size: 0.6rem;
}

.dvd-legend b {
  color: #c7beff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
}

.dvd-legend i {
  color: #a99cff;
  font-size: 0.7rem;
}

.dvd-scrim.is-light .dvd-legend > span {
  background: rgba(35, 37, 52, 0.05);
  color: rgba(34, 31, 51, 0.58);
}

.dvd-scrim.is-light .dvd-legend b,
.dvd-scrim.is-light .dvd-legend i {
  color: #6250e8;
}

.dvd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  margin: 0 12px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}

.dvd-scrim.is-light .dvd-toolbar {
  border-color: rgba(35, 37, 52, 0.08);
  background: #ffffff;
}

.dvd-toolbar-left {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.dvd-toolbar-left strong {
  font-size: 0.78rem;
  font-weight: 700;
}

.dvd-toolbar-left small {
  color: rgba(236, 234, 248, 0.5);
  font-size: 0.62rem;
}

.dvd-scrim.is-light .dvd-toolbar-left small {
  color: rgba(34, 31, 51, 0.48);
}

.dvd-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.dvd-text-btn,
.dvd-danger-btn,
.dvd-select-all,
.dvd-action {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.dvd-text-btn {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(236, 234, 248, 0.82);
  font-size: 0.68rem;
  font-weight: 600;
}

.dvd-scrim.is-light .dvd-text-btn {
  background: rgba(35, 37, 52, 0.06);
  color: rgba(34, 31, 51, 0.78);
}

.dvd-text-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.dvd-danger-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  background: rgba(240, 68, 56, 0.16);
  color: #ff9b93;
  font-size: 0.68rem;
  font-weight: 700;
}

.dvd-danger-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.dvd-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 12px 28px;
  scrollbar-width: thin;
}

.dvd-major {
  margin-bottom: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.dvd-scrim.is-light .dvd-major {
  border-color: rgba(35, 37, 52, 0.08);
  background: #ffffff;
}

.dvd-major.is-focus,
.dvd-major.is-current {
  border-color: color-mix(in srgb, #7c6cff 50%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #7c6cff 18%, transparent);
}

.dvd-major-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
  align-items: stretch;
  padding: 8px;
}

.dvd-major-main {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 18px;
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 6px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.dvd-major-main:hover {
  background: rgba(255, 255, 255, 0.04);
}

.dvd-scrim.is-light .dvd-major-main:hover {
  background: rgba(98, 80, 232, 0.05);
}

.dvd-major-thumb {
  display: grid;
  width: 72px;
  height: 54px;
  place-items: center;
  border-radius: 10px;
  background: #0d0d14;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.dvd-scrim.is-light .dvd-major-thumb {
  background: #eceef5;
}

.dvd-major-thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dvd-major-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.dvd-major-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.dvd-major-title strong {
  font-size: 0.92rem;
  font-weight: 750;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.dvd-major-title em,
.dvd-meta-title em {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, #7c6cff 22%, transparent);
  color: #d2caff;
  font: 700 0.56rem/1 sans-serif;
  font-style: normal;
}

.dvd-major-title em.is-latest,
.dvd-meta-title em.is-iter {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(236, 234, 248, 0.72);
}

.dvd-meta-title em.is-tile-refine {
  background: color-mix(in srgb, #6d5cff 34%, transparent);
  color: #efeaff;
}

.dvd-scrim.is-light .dvd-major-title em,
.dvd-scrim.is-light .dvd-meta-title em {
  background: color-mix(in srgb, #6250e8 14%, transparent);
  color: #4e3bd0;
}

.dvd-scrim.is-light .dvd-major-title em.is-latest,
.dvd-scrim.is-light .dvd-meta-title em.is-iter {
  background: rgba(35, 37, 52, 0.06);
  color: rgba(34, 31, 51, 0.58);
}

.dvd-major-sub {
  color: rgba(236, 234, 248, 0.52);
  font-size: 0.64rem;
}

.dvd-scrim.is-light .dvd-major-sub {
  color: rgba(34, 31, 51, 0.5);
}

.dvd-device-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dvd-device-chips > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(124, 108, 255, 0.12);
  color: #c7beff;
  font-size: 0.56rem;
  font-weight: 650;
}

.dvd-scrim.is-light .dvd-device-chips > span {
  background: rgba(98, 80, 232, 0.08);
  color: #5b4ad8;
}

.dvd-chevron {
  color: rgba(236, 234, 248, 0.45);
  font-size: 0.85rem;
}

.dvd-scrim.is-light .dvd-chevron {
  color: rgba(34, 31, 51, 0.4);
}

.dvd-select-all {
  align-self: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(236, 234, 248, 0.88);
  font-size: 0.68rem;
  font-weight: 700;
}

.dvd-select-all.is-all {
  background: color-mix(in srgb, #7c6cff 28%, transparent);
  color: #efeaff;
}

.dvd-scrim.is-light .dvd-select-all {
  background: rgba(35, 37, 52, 0.08);
  color: rgba(34, 31, 51, 0.82);
}

.dvd-scrim.is-light .dvd-select-all.is-all {
  background: color-mix(in srgb, #6250e8 16%, transparent);
  color: #4e3bd0;
}

.dvd-tree {
  list-style: none;
  margin: 0;
  padding: 0 10px 12px;
}

.dvd-node {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  margin-top: 8px;
  padding-left: calc(var(--dvd-depth) * 12px);
}

.dvd-node.is-child {
  position: relative;
}

.dvd-node.is-child::before {
  content: '';
  position: absolute;
  left: calc(var(--dvd-depth) * 12px - 8px);
  top: 12px;
  bottom: 12px;
  width: 2px;
  border-radius: 2px;
  background: rgba(124, 108, 255, 0.22);
}

.dvd-check {
  display: grid;
  place-items: center;
  padding-top: 18px;
  cursor: pointer;
}

.dvd-check input {
  width: 15px;
  height: 15px;
  accent-color: #7c6cff;
  cursor: pointer;
}

.dvd-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}

.dvd-scrim.is-light .dvd-card {
  border-color: rgba(35, 37, 52, 0.07);
  background: rgba(246, 247, 251, 0.95);
}

.dvd-node.is-active .dvd-card,
.dvd-node.is-selected .dvd-card {
  border-color: color-mix(in srgb, #7c6cff 55%, transparent);
  background: color-mix(in srgb, #7c6cff 12%, transparent);
}

.dvd-card-main {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.dvd-thumb-stack {
  position: relative;
  width: 84px;
  height: 58px;
}

.dvd-thumb {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #0d0d14;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.dvd-thumb:nth-child(2) {
  inset: 4px 0 0 8px;
}

.dvd-thumb:nth-child(3) {
  inset: 8px 0 0 16px;
}

.dvd-thumb.is-empty {
  position: relative;
  color: rgba(236, 234, 248, 0.35);
}

.dvd-thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dvd-thumb-stack > em {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 4;
  min-width: 22px;
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(12, 12, 18, 0.78);
  color: #fff;
  font: 700 0.56rem/1 sans-serif;
  font-style: normal;
}

.dvd-meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.dvd-meta-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.dvd-meta-title strong {
  font-size: 0.84rem;
  font-weight: 750;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.dvd-meta small {
  color: rgba(236, 234, 248, 0.52);
  font-size: 0.64rem;
  line-height: 1.35;
}

.dvd-scrim.is-light .dvd-meta small {
  color: rgba(34, 31, 51, 0.5);
}

.dvd-carriers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.dvd-carrier {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 44px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.dvd-scrim.is-light .dvd-carrier {
  border-color: rgba(35, 37, 52, 0.07);
  background: #ffffff;
}

.dvd-carrier.is-on {
  border-color: color-mix(in srgb, #7c6cff 60%, transparent);
  background: color-mix(in srgb, #7c6cff 14%, transparent);
}

.dvd-carrier :deep(.authenticated-image) {
  width: 44px;
  height: 36px;
  border-radius: 7px;
  object-fit: cover;
  background: #0d0d14;
}

.dvd-carrier > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  color: rgba(236, 234, 248, 0.78);
  font-size: 0.64rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dvd-scrim.is-light .dvd-carrier > span {
  color: rgba(34, 31, 51, 0.76);
}

.dvd-carrier i {
  color: #a99cff;
}

.dvd-scrim.is-light .dvd-carrier i {
  color: #6250e8;
}

.dvd-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.dvd-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(236, 234, 248, 0.86);
  font-size: 0.68rem;
  font-weight: 700;
}

.dvd-action.is-accent {
  background: color-mix(in srgb, #7c6cff 22%, transparent);
  color: #efeaff;
}

.dvd-action:disabled {
  opacity: 0.38;
  cursor: default;
}

.dvd-scrim.is-light .dvd-action {
  background: rgba(35, 37, 52, 0.06);
  color: rgba(34, 31, 51, 0.8);
}

.dvd-scrim.is-light .dvd-action.is-accent {
  background: color-mix(in srgb, #6250e8 14%, transparent);
  color: #4e3bd0;
}

.dvd-empty {
  display: grid;
  gap: 8px;
  place-items: center;
  padding: 56px 28px;
  text-align: center;
  color: rgba(236, 234, 248, 0.55);
}

.dvd-empty i {
  font-size: 1.6rem;
  color: #a99cff;
}

.dvd-empty strong {
  color: inherit;
  font-size: 0.92rem;
}

.dvd-empty small {
  max-width: 280px;
  font-size: 0.7rem;
  line-height: 1.5;
}

.dvd-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 8px;
  color: rgba(236, 234, 248, 0.48);
  font-size: 0.64rem;
}

.dvd-scrim.is-light .dvd-sentinel,
.dvd-scrim.is-light .dvd-empty {
  color: rgba(34, 31, 51, 0.48);
}

.spin {
  animation: dvd-spin 0.8s linear infinite;
}

@keyframes dvd-spin {
  to {
    transform: rotate(360deg);
  }
}

.dvd-major-main:focus-visible,
.dvd-select-all:focus-visible,
.dvd-card-main:focus-visible,
.dvd-carrier:focus-visible,
.dvd-action:focus-visible,
.dvd-text-btn:focus-visible,
.dvd-danger-btn:focus-visible,
.dvd-icon-btn:focus-visible {
  outline: 2px solid #7c6cff;
  outline-offset: 2px;
}

@media (max-width: 560px) {
  .dvd-drawer {
    width: 100vw !important;
  }

  .dvd-resize {
    display: none;
  }

  .dvd-carriers {
    grid-template-columns: 1fr;
  }

  .dvd-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .dvd-toolbar-actions {
    justify-content: stretch;
  }

  .dvd-toolbar-actions > * {
    flex: 1;
  }
}
</style>
