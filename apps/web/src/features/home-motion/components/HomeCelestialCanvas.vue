<script setup>
/**
 * 首页 WebGL 星幕画布（固定视口层）。
 * three.js 场景按需动态加载（独立 chunk），页面不可见 / 标签页隐藏时暂停渲染。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const canvasRef = ref(null)
const isReady = ref(false)

let sceneHandle = null
let resizeObserver = null
let visibilityObserver = null
let inViewport = true
let destroyed = false

function shouldSkipWebgl() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function syncRunning() {
  if (!sceneHandle) return
  if (inViewport && document.visibilityState === 'visible') sceneHandle.start()
  else sceneHandle.stop()
}

function handleVisibilityChange() {
  syncRunning()
}

onMounted(async () => {
  const canvas = canvasRef.value
  if (!canvas || shouldSkipWebgl()) return

  let createCelestialScene
  try {
    ;({ createCelestialScene } = await import('../scene/celestialScene'))
  } catch {
    return
  }
  if (destroyed || !canvasRef.value) return

  try {
    sceneHandle = createCelestialScene(canvas)
  } catch {
    sceneHandle = null
    return
  }

  const rect = canvas.parentElement?.getBoundingClientRect()
  sceneHandle.resize(rect?.width || window.innerWidth, rect?.height || window.innerHeight)

  resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box?.width && box?.height) sceneHandle?.resize(box.width, box.height)
  })
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

  visibilityObserver = new IntersectionObserver(
    (entries) => {
      inViewport = Boolean(entries[0]?.isIntersecting)
      syncRunning()
    },
    { threshold: 0 },
  )
  visibilityObserver.observe(canvas)

  document.addEventListener('visibilitychange', handleVisibilityChange)

  sceneHandle.start()
  isReady.value = true
})

onBeforeUnmount(() => {
  destroyed = true
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  resizeObserver?.disconnect()
  visibilityObserver?.disconnect()
  resizeObserver = null
  visibilityObserver = null
  sceneHandle?.dispose()
  sceneHandle = null
})

defineExpose({
  setPointer(x, y) {
    sceneHandle?.setPointer(x, y)
  },
  setScroll(progress) {
    sceneHandle?.setScroll(progress)
  },
  setWarp(value) {
    sceneHandle?.setWarp(value)
  },
})
</script>

<template>
  <div class="home-celestial" aria-hidden="true">
    <canvas ref="canvasRef" class="home-celestial__canvas" :class="{ 'is-ready': isReady }" />
  </div>
</template>

<style scoped>
.home-celestial {
  pointer-events: none;
  position: fixed;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  contain: strict;
}
.home-celestial__canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 1.6s ease 0.1s;
}
.home-celestial__canvas.is-ready {
  opacity: 1;
}
</style>
