<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  colors: { type: Array, default: () => ['#6ff7d2', '#5fb8ff', '#ff6b78', '#ffd45f', '#f7f7f2'] },
  count: { type: Number, default: 5 },
  speed: { type: Number, default: 0.28 },
})

const canvasRef = ref(null)
let cleanup = null

function motionDisabled() {
  return document.documentElement.classList.contains('settings-no-animations') || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function setupCanvas() {
  const canvas = canvasRef.value
  const container = canvas?.parentElement
  if (!canvas || !container) return
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return

  let width = 1
  let height = 1
  let frame = 0
  let visible = false
  let pageVisible = !document.hidden
  let elapsed = 0
  let previous = performance.now()
  let lastDraw = 0
  const reduced = motionDisabled()
  const strandCount = Math.max(3, Math.min(8, Math.round(props.count)))
  const frameInterval = 1000 / 36

  function resize() {
    width = Math.max(1, container.clientWidth)
    height = Math.max(1, container.clientHeight)
    const mobile = window.matchMedia('(max-width: 760px)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.3)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(reduced ? 0 : elapsed)
  }

  function draw(time) {
    context.clearRect(0, 0, width, height)
    context.save()
    context.globalCompositeOperation = 'lighter'
    const centerY = height * 0.515
    const step = Math.max(4, width / 150)

    for (let strand = 0; strand < strandCount; strand += 1) {
      const color = props.colors[strand % props.colors.length] || '#ffffff'
      const phase = strand * 1.19
      const frequency = 0.006 + strand * 0.0007
      const amplitude = height * (0.052 + strand * 0.0055)
      const offset = (strand - (strandCount - 1) / 2) * 14
      const tracePath = () => {
        context.beginPath()
        for (let x = -step; x <= width + step; x += step) {
          const envelope = Math.sin(Math.min(1, Math.max(0, x / width)) * Math.PI)
          const wave = Math.sin(x * frequency + time * props.speed * (1.6 + strand * 0.16) + phase) * 0.66 + Math.sin(x * frequency * 1.8 - time * props.speed * 1.15 + phase * 0.7) * 0.34
          const y = centerY + offset + wave * amplitude * envelope
          if (x <= 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
      }
      tracePath()
      context.strokeStyle = color
      context.globalAlpha = 0.09
      context.lineWidth = 10
      context.shadowBlur = 16
      context.shadowColor = color
      context.stroke()
      tracePath()
      context.globalAlpha = 0.66
      context.lineWidth = 1.15
      context.shadowBlur = 5
      context.stroke()
    }
    context.restore()
  }

  function tick(now) {
    frame = 0
    if (!visible || !pageVisible || reduced) return
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000))
    previous = now
    elapsed += delta
    if (now - lastDraw >= frameInterval) {
      draw(elapsed)
      lastDraw = now
    }
    frame = requestAnimationFrame(tick)
  }

  function start() {
    if (frame || reduced || !visible || !pageVisible) return
    previous = performance.now()
    frame = requestAnimationFrame(tick)
  }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0 }
  function onVisibilityChange() { pageVisible = !document.hidden; if (pageVisible) start(); else stop() }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    if (visible) start()
    else stop()
  }, { rootMargin: '140px 0px', threshold: 0 })
  intersectionObserver.observe(container)
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
  resize()

  cleanup = () => {
    stop()
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

onMounted(setupCanvas)
onBeforeUnmount(() => cleanup?.())
</script>

<template><div class="strands-band" aria-hidden="true"><canvas ref="canvasRef"></canvas></div></template>

<style scoped>
.strands-band,
.strands-band canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
</style>
