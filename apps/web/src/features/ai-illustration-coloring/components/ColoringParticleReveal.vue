<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  active: { type: Boolean, default: false },
  imageUrl: { type: String, default: '' },
  aspectRatio: { type: String, default: '1 / 1' },
})

const emit = defineEmits(['done'])

const canvasRef = ref(null)
const revealed = ref(false)
let raf = 0
let particles = []
let startAt = 0
let image = null

function stop() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function spawnParticles(width, height) {
  const count = Math.min(96, Math.max(40, Math.round((width * height) / 16000)))
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: 1.1 + Math.random() * 2.4,
    vx: (Math.random() - 0.5) * 0.28,
    vy: -0.16 - Math.random() * 0.42,
    a: 0.3 + Math.random() * 0.45,
    hue: 300 + Math.random() * 55,
  }))
}

function drawFrame(now) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  const progress = Math.min(1, (now - startAt) / 1300)

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#0f0c14'
  ctx.fillRect(0, 0, width, height)

  if (image && props.imageUrl) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, (progress - 0.2) / 0.8)
    ctx.filter = `blur(${Math.max(0, 16 - progress * 16)}px)`
    ctx.drawImage(image, 0, 0, width, height)
    ctx.restore()
  }

  particles.forEach((p) => {
    p.x += p.vx
    p.y += p.vy
    if (p.y < -8) {
      p.y = height + 8
      p.x = Math.random() * width
    }
    ctx.beginPath()
    ctx.fillStyle = `hsla(${p.hue}, 82%, 72%, ${p.a * (1 - progress * 0.86)})`
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fill()
  })

  if (progress < 1) {
    raf = requestAnimationFrame(drawFrame)
  } else {
    revealed.value = true
    stop()
    emit('done')
  }
}

async function startReveal() {
  stop()
  revealed.value = false
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.parentElement?.getBoundingClientRect()
  const width = Math.max(240, Math.round(rect?.width || 480))
  const height = Math.max(240, Math.round(rect?.height || 480))
  canvas.width = width
  canvas.height = height
  spawnParticles(width, height)
  image = null
  if (props.imageUrl) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    await new Promise((resolve) => {
      img.onload = () => {
        image = img
        resolve()
      }
      img.onerror = () => resolve()
      img.src = props.imageUrl
    })
  }
  startAt = performance.now()
  raf = requestAnimationFrame(drawFrame)
}

watch(
  () => [props.active, props.imageUrl],
  ([active]) => {
    if (active) startReveal()
    else {
      stop()
      revealed.value = false
    }
  },
  { immediate: true },
)

onBeforeUnmount(stop)
</script>

<template>
  <div class="coloring-particle-stage">
    <img
      v-if="imageUrl && revealed"
      class="coloring-particle-result"
      :src="imageUrl"
      alt="染色结果"
    />
    <canvas
      v-show="active && !revealed"
      ref="canvasRef"
      class="coloring-particle-canvas"
    ></canvas>
    <div v-if="active && !imageUrl" class="coloring-particle-waiting">
      <div class="coloring-loading-ring"></div>
      <strong>粒子画布准备中…</strong>
    </div>
  </div>
</template>

<style scoped>
.coloring-particle-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 0;
  overflow: hidden;
  background: #0f0c14;
  border: 0;
}

.coloring-particle-canvas,
.coloring-particle-result {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #040308;
}

.coloring-particle-waiting {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.72);
  text-align: center;
}

.coloring-loading-ring {
  width: 36px;
  height: 36px;
  margin: 0 auto;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: #ec4899;
  border-radius: 50%;
  animation: coloring-spin 0.9s linear infinite;
}

@keyframes coloring-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
