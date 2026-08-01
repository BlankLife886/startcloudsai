<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  /** 受控选中项；传入后由外部驱动 */
  selectedIndex: { type: Number, default: undefined },
  /** 连续位置（可小数），用于滚动 scrub 同步；优先于 selectedIndex */
  position: { type: Number, default: undefined },
  /** 外部驱动时直接贴合，不做平滑，避免滚动拖泥带水 */
  followExternal: { type: Boolean, default: false },
  defaultSelected: { type: Number, default: 0 },
  textColor: { type: String, default: '#8a9188' },
  activeColor: { type: String, default: '#141815' },
  side: { type: String, default: 'left' },
  fontSize: { type: Number, default: 2.1 },
  spacing: { type: Number, default: 1.45 },
  curve: { type: Number, default: 1 },
  tilt: { type: Number, default: 6 },
  blur: { type: Number, default: 1.6 },
  fade: { type: Number, default: 0.22 },
  minOpacity: { type: Number, default: 0.08 },
  smoothing: { type: Number, default: 200 },
  inset: { type: Number, default: 48 },
  loop: { type: Boolean, default: false },
  draggable: { type: Boolean, default: true },
  /** 是否拦截 wheel；pin 滚动模式应关闭 */
  captureWheel: { type: Boolean, default: true },
  soundUrl: { type: String, default: '' },
  soundVolume: { type: Number, default: 0.5 },
})

const emit = defineEmits(['change', 'update:selectedIndex'])

const rootRef = ref(null)
const itemRefs = ref([])
const internalIndex = ref(
  props.selectedIndex == null ? props.defaultSelected : props.selectedIndex,
)
const isDragging = ref(false)

const remPx =
  typeof window !== 'undefined'
    ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    : 16
const rowH = computed(() => Math.max(props.fontSize * props.spacing * remPx, 1))

let pos = internalIndex.value
let target = internalIndex.value
let raf = null
let last = 0
let wheelTimer = null
let drag = null
let dragMoved = false
let audio = null
let audioUrl = ''
let lastTick = 0
let removeWheelListener = null
let suppressEmit = false

function setItemRef(el, index) {
  itemRefs.value[index] = el || null
}

function detachWheel() {
  removeWheelListener?.()
  removeWheelListener = null
}

function attachWheel() {
  detachWheel()
  const el = rootRef.value
  if (!el || !props.captureWheel) return
  const onWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY
    const step = Math.max(-1, Math.min(1, delta / rowH.value))
    applyTarget(target + step, false)
    if (wheelTimer) clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => applyTarget(target, true), 140)
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  removeWheelListener = () => {
    el.removeEventListener('wheel', onWheel)
    if (wheelTimer) clearTimeout(wheelTimer)
  }
}

function runFrame(now) {
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  const tau = Math.max(props.smoothing, 1) / 1000
  const k = 1 - Math.exp(-dt / tau)

  let next = pos + (target - pos) * k
  const settled = Math.abs(target - next) < 0.001
  if (settled) next = target
  pos = next

  const els = itemRefs.value
  const n = props.items.length
  const mirror = props.side === 'right' ? -1 : 1
  const tiltRad = (props.tilt * Math.PI) / 180
  const R = tiltRad > 0.0005 ? rowH.value / tiltRad : 0

  for (let i = 0; i < n; i += 1) {
    const el = els[i]
    if (!el) continue
    let d = i - next
    if (props.loop && n > 1) {
      d = ((d % n) + n) % n
      if (d > n / 2) d -= n
    }
    const dist = Math.abs(d)
    let x = 0
    let y = d * rowH.value
    let rot = 0
    if (R > 0) {
      const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad))
      y = R * Math.sin(ang)
      x = -mirror * R * (1 - Math.cos(ang)) * props.curve
      rot = (mirror * ang * 180) / Math.PI
    }
    el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`
    el.style.opacity = String(Math.max(props.minOpacity, 1 - dist * props.fade))
    // 滚动跟随时关掉逐帧 blur，显著降 CPU/GPU 开销
    el.style.filter =
      !props.followExternal && props.blur > 0
        ? `blur(${(dist * props.blur).toFixed(2)}px)`
        : 'none'
    el.style.setProperty('--ow-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4))
  }

  raf = settled ? null : requestAnimationFrame(runFrame)
}

function startLoop() {
  if (raf != null) return
  last = performance.now()
  raf = requestAnimationFrame(runFrame)
}

function playTick() {
  if (!props.soundUrl) return
  const now = performance.now()
  if (now - lastTick < 70) return
  lastTick = now
  if (!audio || audioUrl !== props.soundUrl) {
    audio = new Audio(props.soundUrl)
    audio.preload = 'auto'
    audioUrl = props.soundUrl
  }
  audio.volume = Math.min(Math.max(props.soundVolume, 0), 1)
  audio.currentTime = 0
  audio.play()?.catch(() => {})
}

function layoutOnce() {
  last = performance.now()
  runFrame(last)
}

function applyTarget(value, snap, fromExternal = false) {
  let v = value
  const n = props.items.length
  if (!n) return
  if (!props.loop) v = Math.min(Math.max(v, 0), Math.max(n - 1, 0))
  if (snap) v = Math.round(v)
  target = v

  if (fromExternal && props.followExternal) {
    pos = v
    if (raf != null) {
      cancelAnimationFrame(raf)
      raf = null
    }
  }

  const idx = ((Math.round(v) % n) + n) % n
  if (idx !== internalIndex.value) {
    internalIndex.value = idx
    if (!fromExternal && !suppressEmit) {
      emit('update:selectedIndex', idx)
      emit('change', idx, props.items[idx])
      playTick()
    }
  }

  if (fromExternal && props.followExternal) {
    layoutOnce()
    return
  }
  startLoop()
}

function handlePointerDown(e) {
  if (!props.draggable) return
  drag = { y: e.clientY, start: target, id: e.pointerId }
  dragMoved = false
  isDragging.value = true
}

function handlePointerMove(e) {
  if (!drag) return
  const dy = e.clientY - drag.y
  if (!dragMoved && Math.abs(dy) > 4) {
    dragMoved = true
    rootRef.value?.setPointerCapture(drag.id)
  }
  if (dragMoved) applyTarget(drag.start - dy / rowH.value, false)
}

function handlePointerEnd() {
  if (!drag) return
  drag = null
  isDragging.value = false
  if (dragMoved) applyTarget(target, true)
}

function handleItemClick(index) {
  if (dragMoved) return
  const n = props.items.length
  const cur = target
  let d = index - (((cur % n) + n) % n)
  if (props.loop && n > 1) {
    if (d > n / 2) d -= n
    else if (d < -n / 2) d += n
  }
  applyTarget(cur + d, true)
}

function handleKeyDown(e) {
  let delta = null
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1
  if (delta == null) return
  e.preventDefault()
  applyTarget(Math.round(target) + delta, true)
}

const rootStyle = computed(() => ({
  '--ow-text-color': props.textColor,
  '--ow-active-color': props.activeColor,
  '--ow-font-size': `${props.fontSize}rem`,
  '--ow-inset': `${props.inset}px`,
}))

watch(
  () => props.position,
  (value) => {
    if (value == null || Number.isNaN(value)) return
    if (Math.abs(target - value) < 0.0005 && Math.abs(pos - value) < 0.0005) return
    suppressEmit = true
    applyTarget(value, false, true)
    suppressEmit = false
  },
)

watch(
  () => props.selectedIndex,
  (value) => {
    if (props.position != null) return
    if (value == null || Number.isNaN(value)) return
    if (value === internalIndex.value && Math.abs(target - value) < 0.001) return
    suppressEmit = true
    applyTarget(value, true, true)
    suppressEmit = false
  },
)

watch(
  () => [
    props.items,
    props.fontSize,
    props.spacing,
    props.curve,
    props.tilt,
    props.blur,
    props.fade,
    props.minOpacity,
    props.side,
    props.loop,
    props.smoothing,
  ],
  () => applyTarget(target, false, true),
  { deep: true },
)

watch(
  () => props.captureWheel,
  () => {
    attachWheel()
  },
)

onMounted(() => {
  attachWheel()
  applyTarget(internalIndex.value, true, true)
})

onUnmounted(() => {
  if (raf != null) cancelAnimationFrame(raf)
  audio?.pause()
  detachWheel()
})

defineExpose({
  goTo(index) {
    applyTarget(index, true)
  },
})
</script>

<template>
  <div
    ref="rootRef"
    class="option-wheel"
    :class="[
      side === 'right' ? 'is-right' : 'is-left',
      { 'is-dragging': isDragging },
    ]"
    role="listbox"
    tabindex="0"
    aria-label="创作工作台选项"
    :style="rootStyle"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerEnd"
    @pointercancel="handlePointerEnd"
    @keydown="handleKeyDown"
  >
    <div
      v-for="(label, index) in items"
      :key="`${label}-${index}`"
      :ref="(el) => setItemRef(el, index)"
      class="option-wheel__item"
      :class="{ 'is-active': internalIndex === index }"
      role="option"
      :aria-selected="internalIndex === index"
      @click="handleItemClick(index)"
    >
      {{ label }}
    </div>
  </div>
</template>

<style scoped>
.option-wheel {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  outline: none;
  user-select: none;
  touch-action: none;
  cursor: grab;
}

.option-wheel.is-dragging {
  cursor: grabbing;
}

.option-wheel__item {
  position: absolute;
  top: 50%;
  left: var(--ow-inset);
  transform-origin: left center;
  white-space: nowrap;
  line-height: 1;
  font-size: var(--ow-font-size);
  font-weight: 200;
  color: color-mix(in srgb, var(--ow-active-color) calc(var(--ow-p, 0) * 100%), var(--ow-text-color));
  cursor: pointer;
  will-change: transform, opacity, filter;
}

.option-wheel.is-right .option-wheel__item {
  left: auto;
  right: var(--ow-inset);
  transform-origin: right center;
}

.option-wheel__item.is-active {
  font-weight: 700;
  letter-spacing: 0.01em;
}
</style>
