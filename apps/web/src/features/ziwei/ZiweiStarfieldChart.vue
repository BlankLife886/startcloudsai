<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildStarfieldModel, buildStarfieldFlowPlan, getStarfieldRelationIndices } from './ziweiStarfieldModel'
import { ZwStarfieldCanvas } from './ziweiStarfieldCanvas'

const props = defineProps({
  chart: { type: Object, default: null },
  palaceAreas: { type: Object, default: () => ({}) },
  horoscope: { type: Object, default: null },
  horoscopeScopes: { type: Array, default: () => [] },
  includeHourly: { type: Boolean, default: false },
  activePalaceIndex: { type: Number, default: null },
  resolveTooltip: { type: Function, default: null },
})

const emit = defineEmits(['select-palace'])

const canvasEl = ref(null)
const tipRef = ref(null)
const hoverTip = ref(null)
const stageCaption = ref('天幕星宿')
const tipPos = ref({ x: 0, y: 0 })
let renderer = null
let captionRaf = 0
let lastPointer = { x: 0, y: 0 }

function placeTooltip(clientX, clientY) {
  lastPointer = { x: clientX, y: clientY }
  const pad = 14
  const maxW = 320
  let x = clientX + pad
  let y = clientY + pad
  x = Math.min(Math.max(pad, x), window.innerWidth - maxW - pad)
  tipPos.value = { x, y }

  nextTick(() => {
    const el = tipRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let nx = clientX + pad
    let ny = clientY + pad

    if (ny + rect.height > vh - pad) {
      ny = clientY - rect.height - pad
    }
    if (ny < pad) ny = pad

    if (nx + rect.width > vw - pad) {
      nx = clientX - rect.width - pad
    }
    if (nx < pad) nx = pad

    tipPos.value = { x: nx, y: ny }
  })
}

function syncCaptionLoop() {
  if (renderer) stageCaption.value = renderer.getStageCaption()
  captionRaf = requestAnimationFrame(syncCaptionLoop)
}

function hubPalaceIndex() {
  if (props.activePalaceIndex != null) return props.activePalaceIndex
  return props.chart?.palaces?.find((p) => p.name === '命宫')?.index ?? props.chart?.palaces?.[0]?.index ?? null
}

function syncChart() {
  if (!renderer || !props.chart) return
  const model = buildStarfieldModel(props.chart, {
    palaceAreas: props.palaceAreas,
    horoscope: props.horoscope,
    horoscopeScopes: props.horoscopeScopes,
    includeHourly: props.includeHourly,
  })
  const flowPlan = buildStarfieldFlowPlan(props.chart, hubPalaceIndex())
  renderer.setModel(model, flowPlan)
  syncActive()
}

function syncActive() {
  if (!renderer || !props.chart) return
  const idx = props.activePalaceIndex
  renderer.setActiveIndex(idx)
  if (idx != null) {
    renderer.setRelationIndices(getStarfieldRelationIndices(props.chart, idx))
    const flowPlan = buildStarfieldFlowPlan(props.chart, idx)
    renderer.setFlowPlan(flowPlan, { animate: true })
  }
}

function updateHover(clientX, clientY) {
  const hit = renderer?.pickHover(clientX, clientY)
  renderer?.setHoverHit(hit)
  const tip = hit && props.resolveTooltip ? props.resolveTooltip(hit) : null
  hoverTip.value = tip
  if (tip) placeTooltip(clientX, clientY)
}

watch(hoverTip, () => {
  if (hoverTip.value) placeTooltip(lastPointer.x, lastPointer.y)
})

function onPointerMove(event) {
  updateHover(event.clientX, event.clientY)
}

function onPointerLeave() {
  renderer?.setHoverHit(null)
  hoverTip.value = null
}

function onPointerDown(event) {
  const index = renderer?.pickPalace(event.clientX, event.clientY)
  if (index != null) emit('select-palace', index)
}

function playReveal() {
  renderer?.playReveal()
}

defineExpose({ playReveal })

onMounted(() => {
  if (!canvasEl.value) return
  renderer = new ZwStarfieldCanvas(canvasEl.value)
  renderer.mount()
  syncChart()
  syncCaptionLoop()
})

onBeforeUnmount(() => {
  if (captionRaf) cancelAnimationFrame(captionRaf)
  renderer?.destroy()
  renderer = null
})

watch(() => props.chart, syncChart, { deep: true })
watch(() => props.horoscope, syncChart, { deep: true })
watch(() => props.activePalaceIndex, syncActive)
</script>

<template>
  <div
    class="zw-starfield-chart"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <canvas ref="canvasEl" class="zw-starfield-chart__canvas" aria-hidden="true"></canvas>
    <p class="zw-starfield-chart__caption">{{ stageCaption }}</p>

    <Transition name="zw-starfield-tip">
      <aside
        v-if="hoverTip"
        ref="tipRef"
        class="zw-starfield-tip"
        :style="{ left: `${tipPos.x}px`, top: `${tipPos.y}px` }"
        role="tooltip"
      >
        <strong class="zw-starfield-tip__title">{{ hoverTip.title }}</strong>
        <p class="zw-starfield-tip__body">{{ hoverTip.body }}</p>
        <ul v-if="hoverTip.evidence?.length" class="zw-starfield-tip__evidence">
          <li v-for="line in hoverTip.evidence" :key="line">{{ line }}</li>
        </ul>
      </aside>
    </Transition>
  </div>
</template>

<style src="./ziwei-starfield.css"></style>
