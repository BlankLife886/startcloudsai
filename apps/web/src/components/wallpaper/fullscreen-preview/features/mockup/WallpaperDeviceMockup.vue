<script setup>
import { loadCanvasSafeImageFromSrc } from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { normalizeDesktopMockupConfig } from './useDesktopMockupSettings'

// 设备外壳组件保持纯展示，方便后续替换成更多桌面/手机样机。
const MOCKUP_VARIANTS = {
  desktop: 'desktop',
  iphone: 'phone-iphone',
  android: 'phone-android',
}

const props = defineProps({
  variant: { type: String, required: true },
  src: { type: String, default: '' },
  alt: { type: String, default: 'Device wallpaper preview' },
  crossorigin: { default: null },
  filterCss: { type: String, default: '' },
  desktopConfig: { type: Object, default: () => ({}) },
  screenLoading: { type: Boolean, default: false },
})

const emit = defineEmits(['image-loaded', 'image-error'])

const desktopFolders = [
  { label: '壁纸', icon: 'bi-folder-fill' },
  { label: '收藏', icon: 'bi-folder-fill' },
  { label: '下载', icon: 'bi-folder-fill' },
]

const desktopClock = ref(new Date())
const desktopImagePosition = ref({ x: 50, y: 50 })
const phoneImagePosition = ref({ x: 50, y: 50 })
const isImageDragging = ref(false)
const holdoverSrc = ref('')
const companionSrc = ref('')
const screenImageReady = ref(false)
let imageDragStart = null
let desktopClockTimer = null

const isDesktop = computed(() => props.variant === MOCKUP_VARIANTS.desktop)
const isPhone = computed(
  () => props.variant === MOCKUP_VARIANTS.iphone || props.variant === MOCKUP_VARIANTS.android,
)
const isIphone = computed(() => props.variant === MOCKUP_VARIANTS.iphone)
const isAndroid = computed(() => props.variant === MOCKUP_VARIANTS.android)
const normalizedDesktopConfig = computed(() => normalizeDesktopMockupConfig(props.desktopConfig))
const desktopPlatform = computed(() => normalizedDesktopConfig.value.platform)

const showScreenLoading = computed(() => {
  // 切图时保留上一张清晰壁纸，只在首屏无内容时展示 loading 层。
  if (holdoverSrc.value) return false
  return props.screenLoading || (!!props.src && !screenImageReady.value)
})
const isScreenLoadingIdle = computed(() => props.screenLoading && !props.src)

const frameClass = computed(() => ({
  'device-frame--desktop': isDesktop.value,
  'device-frame--desktop-macos': isDesktop.value && desktopPlatform.value === 'macos',
  'device-frame--desktop-windows': isDesktop.value && desktopPlatform.value === 'windows',
  'device-frame--phone': isPhone.value,
  'device-frame--iphone': isIphone.value,
  'device-frame--android': isAndroid.value,
}))

const screenClass = computed(() => ({
  'device-screen--desktop': isDesktop.value,
  'device-screen--phone': isPhone.value,
  'device-screen--iphone': isIphone.value,
  'device-screen--android': isAndroid.value,
}))

const deviceLabel = computed(() => {
  switch (props.variant) {
    case MOCKUP_VARIANTS.desktop:
      return 'Desktop'
    case 'phone-iphone':
      return 'iPhone'
    case 'phone-android':
      return 'Android'
    default:
      return 'Mockup'
  }
})

const desktopDateText = computed(() =>
  desktopClock.value.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }),
)

const desktopTimeText = computed(() =>
  desktopClock.value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
)

const deviceImageStyle = computed(() => {
  if (isDesktop.value) {
    return {
      objectPosition: `${desktopImagePosition.value.x}% ${desktopImagePosition.value.y}%`,
    }
  }
  if (isPhone.value) {
    return {
      objectPosition: `${phoneImagePosition.value.x}% ${phoneImagePosition.value.y}%`,
    }
  }
  return {}
})

const mockupImageStyle = computed(() => {
  const style = { ...deviceImageStyle.value }
  if (screenImageReady.value && props.filterCss) {
    style.filter = props.filterCss
  }
  return style
})

function handleScreenImageLoad(event) {
  screenImageReady.value = true
  holdoverSrc.value = ''
  if (props.src) {
    companionSrc.value = props.src
  }
  emit('image-loaded', event)
}

const desktopFrameStyle = computed(() => {
  if (!isDesktop.value) return {}
  const config = normalizedDesktopConfig.value
  const frameWidth = config.aspectRatio >= 1.7 ? 1080 : config.aspectRatio >= 1.5 ? 980 : 880

  return {
    '--desktop-screen-aspect': `${config.width} / ${config.height}`,
    '--desktop-frame-width': `${frameWidth}px`,
  }
})

const frameStyle = computed(() => desktopFrameStyle.value)

function clampImagePosition(value) {
  return Math.min(100, Math.max(0, value))
}

function stopImageDrag() {
  isImageDragging.value = false
  imageDragStart = null
  window.removeEventListener('pointermove', moveImageDrag)
  window.removeEventListener('pointerup', stopImageDrag)
  window.removeEventListener('pointercancel', stopImageDrag)
}

function moveImageDrag(event) {
  if (!imageDragStart) return
  const deltaX = event.clientX - imageDragStart.x
  const deltaY = event.clientY - imageDragStart.y
  const moveScale = 100
  const nextPosition = {
    x: clampImagePosition(imageDragStart.position.x - (deltaX / imageDragStart.width) * moveScale),
    y: clampImagePosition(imageDragStart.position.y - (deltaY / imageDragStart.height) * moveScale),
  }
  if (imageDragStart.target === 'phone') {
    phoneImagePosition.value = nextPosition
  } else {
    desktopImagePosition.value = nextPosition
  }
}

function startImageDrag(event) {
  if ((!isDesktop.value && !isPhone.value) || event.button > 0) return
  const rect = event.currentTarget?.getBoundingClientRect()
  if (!rect?.width || !rect?.height) return

  event.preventDefault()
  const target = isPhone.value ? 'phone' : 'desktop'
  isImageDragging.value = true
  imageDragStart = {
    target,
    x: event.clientX,
    y: event.clientY,
    width: rect.width,
    height: rect.height,
    position:
      target === 'phone' ? { ...phoneImagePosition.value } : { ...desktopImagePosition.value },
  }
  window.addEventListener('pointermove', moveImageDrag)
  window.addEventListener('pointerup', stopImageDrag)
  window.addEventListener('pointercancel', stopImageDrag)
}

function drawCoverImage(ctx, img, x, y, width, height, position = { x: 50, y: 50 }) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = Math.max(
    0,
    Math.min(img.naturalWidth - sourceWidth, (img.naturalWidth - sourceWidth) * (position.x / 100)),
  )
  const sourceY = Math.max(
    0,
    Math.min(
      img.naturalHeight - sourceHeight,
      (img.naturalHeight - sourceHeight) * (position.y / 100),
    ),
  )
  ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

async function exportDesktopWallpaperImage(img) {
  const config = normalizedDesktopConfig.value
  const canvas = document.createElement('canvas')
  canvas.width = config.exportWidth
  canvas.height = config.exportHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // 样机模式只是辅助用户调整取景，下载时只导出屏幕内的纯壁纸画面。
  ctx.filter = props.filterCss || 'none'
  drawCoverImage(ctx, img, 0, 0, canvas.width, canvas.height, desktopImagePosition.value)
  ctx.filter = 'none'
  return canvas.toDataURL('image/jpeg', 0.95)
}

async function exportPhoneWallpaperImage(img) {
  const canvas = document.createElement('canvas')
  canvas.width = isAndroid.value ? 1080 : 1290
  canvas.height = isAndroid.value ? 2400 : 2796
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // 手机样机同样导出屏幕比例下的壁纸本体，不把刘海/边框画进文件。
  ctx.filter = props.filterCss || 'none'
  drawCoverImage(ctx, img, 0, 0, canvas.width, canvas.height, phoneImagePosition.value)
  ctx.filter = 'none'
  return canvas.toDataURL('image/jpeg', 0.95)
}

async function exportMockupImage() {
  if (!props.src) return ''
  const img = await loadCanvasSafeImageFromSrc(props.src)
  if (!img) return ''
  if (isDesktop.value) return await exportDesktopWallpaperImage(img)
  if (isPhone.value) return await exportPhoneWallpaperImage(img)
  return ''
}

watch(
  () => props.src,
  (nextSrc, prevSrc) => {
    if (prevSrc && prevSrc !== nextSrc && screenImageReady.value) {
      holdoverSrc.value = prevSrc
      // 左右样机与主屏同步，切图过渡期间继续展示上一张。
    } else if (nextSrc) {
      companionSrc.value = nextSrc
    }
    screenImageReady.value = false
    desktopImagePosition.value = { x: 50, y: 50 }
    phoneImagePosition.value = { x: 50, y: 50 }
    if (isImageDragging.value) stopImageDrag()
  },
  { immediate: true },
)

onMounted(() => {
  desktopClockTimer = window.setInterval(() => {
    desktopClock.value = new Date()
  }, 30000)
})

onBeforeUnmount(() => {
  if (desktopClockTimer) {
    window.clearInterval(desktopClockTimer)
    desktopClockTimer = null
  }
  if (isImageDragging.value) stopImageDrag()
})

defineExpose({
  exportMockupImage,
})
</script>

<template>
  <div class="device-frame" :class="frameClass" :style="frameStyle">
    <div v-if="isDesktop" class="device-top-dot"></div>

    <div
      v-if="isPhone && companionSrc"
      class="phone-companion phone-companion--left"
      aria-hidden="true"
    >
      <img
        class="phone-companion-image"
        referrerpolicy="no-referrer"
        :crossorigin="crossorigin"
        :src="companionSrc"
        :alt="alt"
        :style="mockupImageStyle"
        draggable="false"
      />
      <span class="phone-companion-cutout phone-companion-cutout--hole"></span>
    </div>
    <div
      v-if="isPhone && companionSrc"
      class="phone-companion phone-companion--right"
      aria-hidden="true"
    >
      <img
        class="phone-companion-image"
        referrerpolicy="no-referrer"
        :crossorigin="crossorigin"
        :src="companionSrc"
        :alt="alt"
        :style="mockupImageStyle"
        draggable="false"
      />
      <span class="phone-companion-cutout phone-companion-cutout--pill"></span>
    </div>

    <div
      class="device-screen"
      :class="[screenClass, { 'device-screen--dragging': isImageDragging }]"
      @pointerdown="startImageDrag"
    >
      <div v-if="isDesktop" class="desktop-metal-bezel" aria-hidden="true">
        <span class="desktop-metal-shine"></span>
      </div>

      <div
        v-if="showScreenLoading"
        class="device-screen-loading"
        :class="{ 'device-screen-loading--idle': isScreenLoadingIdle }"
        aria-hidden="true"
      >
        <svg class="device-screen-mask-defs" aria-hidden="true">
          <defs>
            <filter id="mockupOrganicBlur" x="-35%" y="-35%" width="170%" height="170%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.062" />
            </filter>
            <filter id="mockupParticleGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values="0 0 0 0 0.15  0 0 0 0 0.85  0 0 0 0 1  0 0 0 0.85 0"
                result="cyanBlur"
              />
              <feMerge>
                <feMergeNode in="cyanBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <mask
              id="mockupOrganicRevealMask"
              maskUnits="objectBoundingBox"
              maskContentUnits="objectBoundingBox"
            >
              <rect width="1" height="1" fill="black" />
              <g filter="url(#mockupOrganicBlur)">
                <ellipse fill="white" cx="0.5" cy="0.5" rx="0.38" ry="0.31">
                  <animate
                    attributeName="cx"
                    values="0.16;0.84;0.22;0.78;0.16"
                    dur="8.5s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.38 0 0.62 1;0.38 0 0.62 1;0.38 0 0.62 1;0.38 0 0.62 1"
                  />
                  <animate
                    attributeName="cy"
                    values="0.22;0.76;0.7;0.24;0.22"
                    dur="8.5s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.38 0 0.62 1;0.38 0 0.62 1;0.38 0 0.62 1;0.38 0 0.62 1"
                  />
                  <animate
                    attributeName="rx"
                    values="0.32;0.44;0.36;0.46;0.32"
                    dur="10s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="ry"
                    values="0.26;0.38;0.3;0.4;0.26"
                    dur="9.5s"
                    repeatCount="indefinite"
                  />
                </ellipse>
                <ellipse fill="white" opacity="0.78" cx="0.5" cy="0.5" rx="0.24" ry="0.19">
                  <animate
                    attributeName="cx"
                    values="0.74;0.26;0.64;0.34;0.74"
                    dur="7.5s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  />
                  <animate
                    attributeName="cy"
                    values="0.66;0.3;0.36;0.74;0.66"
                    dur="7.5s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  />
                  <animate
                    attributeName="rx"
                    values="0.18;0.3;0.22;0.28;0.18"
                    dur="6.5s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="ry"
                    values="0.14;0.26;0.18;0.24;0.14"
                    dur="7s"
                    repeatCount="indefinite"
                  />
                </ellipse>
                <ellipse fill="white" opacity="0.42" cx="0.5" cy="0.5" rx="0.14" ry="0.11">
                  <animate
                    attributeName="cx"
                    values="0.42;0.58;0.48;0.52;0.42"
                    dur="6s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="cy"
                    values="0.52;0.46;0.54;0.48;0.52"
                    dur="6s"
                    repeatCount="indefinite"
                  />
                </ellipse>
              </g>
            </mask>
          </defs>
        </svg>

        <div class="device-screen-loading-bg" aria-hidden="true"></div>
        <div class="device-screen-tech-grid" aria-hidden="true"></div>
        <div class="device-screen-field device-screen-field--fog"></div>
        <div class="device-screen-field device-screen-field--focus"></div>
        <div class="device-screen-field device-screen-field--nodes" aria-hidden="true"></div>
      </div>

      <img
        v-if="holdoverSrc"
        class="device-screen-image device-screen-image--holdover is-screen-loaded"
        referrerpolicy="no-referrer"
        :crossorigin="crossorigin"
        :src="holdoverSrc"
        :alt="alt"
        :style="deviceImageStyle"
        draggable="false"
        aria-hidden="true"
      />

      <img
        v-if="src"
        class="device-screen-image"
        referrerpolicy="no-referrer"
        :crossorigin="crossorigin"
        :src="src"
        :alt="alt"
        :style="mockupImageStyle"
        :class="{ 'is-screen-loaded': screenImageReady }"
        draggable="false"
        @load="handleScreenImageLoad"
        @error="emit('image-error', $event)"
      />

      <div v-if="isDesktop" class="desktop-screen-edge" aria-hidden="true"></div>

      <div v-if="isDesktop" class="desktop-os-overlay" aria-hidden="true">
        <div class="desktop-folder-column">
          <div v-for="item in desktopFolders" :key="item.label" class="desktop-folder">
            <i class="bi" :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </div>
        </div>

        <div class="desktop-clock">
          <div class="desktop-clock-date">{{ desktopDateText }}</div>
          <div class="desktop-clock-time">{{ desktopTimeText }}</div>
        </div>
      </div>

      <div v-if="isPhone" class="phone-os-overlay" aria-hidden="true">
        <div class="phone-status-bar">
          <span>09:41</span>
          <div class="phone-status-icons">
            <i class="bi bi-reception-4"></i>
            <i class="bi bi-wifi"></i>
            <i class="bi bi-battery-full"></i>
          </div>
        </div>
        <div class="phone-home-indicator"></div>
      </div>
    </div>

    <div v-if="isDesktop" class="device-label">{{ deviceLabel }}</div>
  </div>
</template>

<style scoped>
.device-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.device-frame--desktop {
  width: min(var(--desktop-frame-width, 1080px), calc(100vw - 120px));
}

.device-frame--phone {
  width: min(386px, calc(100vw - 120px), calc((100vh - 118px) * 430 / 932));
  filter: drop-shadow(0 28px 48px rgba(0, 0, 0, 0.3));
}

.device-screen {
  position: relative;
  overflow: hidden;
  background: #090909;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.device-screen-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0.72;
  transform: scale(1.035) translateZ(0);
  filter: blur(32px) saturate(1.06) brightness(1.03);
  transition:
    filter 0.88s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.78s ease-out,
    transform 0.88s cubic-bezier(0.16, 1, 0.3, 1);
}

.device-screen-image--holdover {
  z-index: 0;
}

.device-screen-image:not(.device-screen-image--holdover) {
  z-index: 1;
}

.device-screen-image.is-screen-loaded {
  opacity: 1;
  transform: scale(1) translateZ(0);
  filter: blur(0) saturate(1) brightness(1);
}

.device-screen-loading {
  --dot-gap: 7px;
  --dot-size: 1px;
  --tech-cyan: rgba(72, 228, 255, 0.95);
  --tech-violet: rgba(148, 112, 255, 0.55);
  position: absolute;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
  transition: opacity 0.5s ease;
  background: #0a0e14;
}

.device-screen-loading--idle {
  background: #080b10;
}

.device-frame--desktop .device-screen-loading {
  inset: var(--desktop-screen-inset);
  border-radius: var(--desktop-inner-radius);
}

.device-frame--phone .device-screen-loading {
  inset: 6px;
  border-radius: 32px;
}

.device-screen-loading::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background:
    radial-gradient(circle at 50% 44%, transparent 38%, rgba(0, 8, 18, 0.35) 72%, rgba(0, 0, 0, 0.62) 100%);
  mix-blend-mode: multiply;
}

.device-screen-mask-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.device-screen-loading-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 38%, rgba(30, 120, 180, 0.18) 0%, transparent 52%),
    radial-gradient(circle at 78% 72%, rgba(90, 50, 180, 0.1) 0%, transparent 38%),
    linear-gradient(180deg, #0c1119 0%, #0a0e14 48%, #070a10 100%);
}

.device-screen-tech-grid {
  position: absolute;
  inset: 0;
  opacity: 0.55;
  background-image:
    linear-gradient(rgba(56, 210, 255, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 210, 255, 0.055) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: radial-gradient(circle at 50% 50%, #000 0%, transparent 78%);
  animation: device-tech-grid-pulse 4.2s ease-in-out infinite;
}

.device-screen-field {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle, var(--tech-violet) 0.55px, transparent 0.75px),
    radial-gradient(circle, var(--tech-cyan) var(--dot-size), transparent calc(var(--dot-size) + 0.25px));
  background-size: 21px 21px, var(--dot-gap) var(--dot-gap);
  background-position: 4px 2px, 0 0;
}

.device-screen-field--fog {
  filter: blur(2.6px) saturate(1.45);
  opacity: 0.38;
  transform: scale(1.02);
  animation: device-fog-drift 5.5s ease-in-out infinite;
}

.device-screen-field--focus {
  opacity: 1;
  -webkit-mask: url(#mockupOrganicRevealMask);
  mask: url(#mockupOrganicRevealMask);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  filter:
    url(#mockupParticleGlow)
    drop-shadow(0 0 4px rgba(64, 230, 255, 0.85))
    drop-shadow(0 0 14px rgba(32, 170, 255, 0.42))
    drop-shadow(0 0 32px rgba(16, 100, 200, 0.18));
}

.device-screen-field--nodes {
  -webkit-mask: url(#mockupOrganicRevealMask);
  mask: url(#mockupOrganicRevealMask);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  background-image:
    radial-gradient(circle, rgba(120, 250, 255, 0.95) 1.2px, transparent 1.6px),
    radial-gradient(circle, rgba(180, 140, 255, 0.75) 0.9px, transparent 1.2px);
  background-size: 42px 42px, 63px 63px;
  background-position: 8px 12px, 20px 28px;
  opacity: 0.55;
  filter: blur(0.3px);
  mix-blend-mode: screen;
  animation: device-nodes-twinkle 3.6s ease-in-out infinite;
}

@keyframes device-tech-grid-pulse {
  0%,
  100% {
    opacity: 0.42;
  }

  50% {
    opacity: 0.62;
  }
}

@keyframes device-fog-drift {
  0%,
  100% {
    opacity: 0.32;
    transform: scale(1.02);
  }

  50% {
    opacity: 0.44;
    transform: scale(1.028);
  }
}

@keyframes device-nodes-twinkle {
  0%,
  100% {
    opacity: 0.42;
  }

  50% {
    opacity: 0.68;
  }
}

.device-frame--desktop .device-screen {
  --desktop-bezel-width: 8px;
  --desktop-inner-radius: 14px;
  --desktop-screen-inset: calc(var(--desktop-bezel-width) - 1px);
  width: 100%;
  aspect-ratio: var(--desktop-screen-aspect, 16 / 9);
  border-radius: 20px;
  padding: var(--desktop-bezel-width);
  cursor: grab;
  background:
    linear-gradient(
      155deg,
      rgba(255, 255, 255, 0.09) 0%,
      rgba(255, 255, 255, 0.02) 10%,
      transparent 24%
    ),
    linear-gradient(
      180deg,
      #34373c 0%,
      #2a2d32 10%,
      #212429 24%,
      #181b1f 50%,
      #121519 78%,
      #0e1013 100%
    );
  box-shadow:
    0 34px 84px rgba(0, 0, 0, 0.5),
    0 10px 28px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55);
}

.device-frame--desktop-windows .device-screen {
  --desktop-bezel-width: 6px;
  --desktop-inner-radius: 11px;
  --desktop-screen-inset: calc(var(--desktop-bezel-width) - 1px);
  border-radius: 16px;
  padding: var(--desktop-bezel-width);
  background:
    linear-gradient(
      155deg,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(255, 255, 255, 0.01) 12%,
      transparent 26%
    ),
    linear-gradient(
      180deg,
      #2f3237 0%,
      #25282d 12%,
      #1c1f23 28%,
      #15181c 58%,
      #101215 100%
    );
  box-shadow:
    0 32px 78px rgba(0, 0, 0, 0.52),
    0 8px 24px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(0, 0, 0, 0.62);
}

.desktop-metal-bezel {
  position: absolute;
  inset: 0;
  z-index: 4;
  border-radius: inherit;
  pointer-events: none;
  overflow: hidden;
  padding: var(--desktop-bezel-width);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.06) 0%,
    transparent 20%,
    transparent 80%,
    rgba(0, 0, 0, 0.12) 100%
  );
}

.desktop-metal-bezel::after {
  content: '';
  position: absolute;
  inset: calc(var(--desktop-bezel-width) - 1px);
  border-radius: calc(var(--desktop-inner-radius) + 1px);
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.05),
    inset 0 1px 3px rgba(0, 0, 0, 0.2);
}

.desktop-metal-shine {
  position: absolute;
  inset: -50% -80%;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(255, 255, 255, 0.02) 40%,
    rgba(220, 228, 240, 0.18) 50%,
    rgba(255, 255, 255, 0.02) 60%,
    transparent 70%
  );
  filter: blur(3px);
  transform: translate3d(-150%, 0, 0) skewX(-10deg);
  animation: desktop-metal-shine 9s ease-in-out infinite;
  will-change: transform, opacity;
}

@keyframes desktop-metal-shine {
  0%,
  28% {
    opacity: 0;
    transform: translate3d(-150%, 0, 0) skewX(-10deg);
  }

  38% {
    opacity: 0.55;
  }

  50% {
    opacity: 0.7;
    transform: translate3d(0%, 0, 0) skewX(-10deg);
  }

  62% {
    opacity: 0.55;
  }

  72%,
  100% {
    opacity: 0;
    transform: translate3d(150%, 0, 0) skewX(-10deg);
  }
}

.device-frame--desktop .device-screen--dragging {
  cursor: grabbing;
}

.device-frame--phone .device-screen--dragging {
  cursor: grabbing;
}

.device-frame--desktop .device-screen::before,
.device-frame--desktop .device-screen::after {
  content: none;
  display: none;
}

.device-frame--desktop .device-screen-image {
  position: absolute;
  inset: var(--desktop-screen-inset);
  width: calc(100% - var(--desktop-screen-inset) * 2);
  height: calc(100% - var(--desktop-screen-inset) * 2);
  border-radius: var(--desktop-inner-radius);
  z-index: 1;
}

.desktop-screen-edge {
  position: absolute;
  inset: var(--desktop-screen-inset);
  border-radius: var(--desktop-inner-radius);
  pointer-events: none;
  z-index: 2;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.04) 0%,
    transparent 10%,
    transparent 90%,
    rgba(0, 0, 0, 0.05) 100%
  );
  box-shadow:
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.07),
    inset 0 8px 20px rgba(0, 0, 0, 0.08),
    inset 0 -6px 16px rgba(0, 0, 0, 0.06);
}

.desktop-os-overlay {
  position: absolute;
  inset: var(--desktop-screen-inset);
  border-radius: var(--desktop-inner-radius);
  overflow: hidden;
  pointer-events: none;
  z-index: 3;
}

.desktop-folder-column {
  position: absolute;
  top: clamp(12px, 2.5vw, 29px);
  left: clamp(10px, 1.5vw, 23px);
  display: grid;
  gap: clamp(7px, 1vw, 11px);
}

.desktop-folder {
  width: 34px;
  display: grid;
  justify-items: center;
  gap: 3px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.46);
}

.desktop-folder i {
  width: 24px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #75bfff;
  font-size: 1.15rem;
  filter: drop-shadow(0 5px 8px rgba(0, 0, 0, 0.24));
}

.desktop-folder span {
  max-width: 42px;
  font-size: 0.58rem;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.desktop-clock {
  position: absolute;
  top: clamp(14px, 2.3vw, 32px);
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  color: rgba(255, 255, 255, 0.96);
  text-shadow:
    0 2px 18px rgba(0, 0, 0, 0.38),
    0 1px 2px rgba(0, 0, 0, 0.28);
}

.desktop-clock-date {
  font-size: clamp(0.64rem, 0.78vw, 0.82rem);
  font-weight: 600;
}

.desktop-clock-time {
  margin-top: 1px;
  font-size: clamp(1.6rem, 3.4vw, 3rem);
  font-weight: 500;
  line-height: 0.95;
  letter-spacing: 0;
}

.device-top-dot {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, rgba(90, 98, 108, 0.85) 0%, rgba(8, 10, 14, 0.98) 68%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 0 0 4px rgba(0, 0, 0, 0.28),
    inset 0 1px 1px rgba(255, 255, 255, 0.16);
  z-index: 6;
}

.device-frame--desktop-windows .device-top-dot {
  display: none;
}

.device-frame--phone .device-screen {
  position: relative;
  width: 100%;
  aspect-ratio: 430 / 932;
  border-radius: 38px;
  padding: 6px;
  cursor: grab;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.2), transparent 18%),
    linear-gradient(180deg, #30323a 0%, #07080b 100%);
  box-shadow:
    0 28px 70px rgba(0, 0, 0, 0.42),
    inset 0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 -18px 30px rgba(0, 0, 0, 0.34);
  z-index: 2;
}

.device-frame--phone .device-screen::before {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 32px;
  background: #050607;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.05),
    inset 0 12px 30px rgba(255, 255, 255, 0.08);
  z-index: 0;
}

.device-frame--phone .device-screen::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 36px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  pointer-events: none;
  z-index: 4;
}

.device-frame--phone .device-screen-image {
  position: absolute;
  inset: 6px;
  width: calc(100% - 12px);
  height: calc(100% - 12px);
  border-radius: 32px;
  z-index: 1;
}

.device-notch {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 31%;
  height: 29px;
  border-radius: 0 0 18px 18px;
  background: #050607;
  box-shadow: 0 5px 12px rgba(0, 0, 0, 0.24);
  z-index: 5;
}

.device-camera-hole {
  position: absolute;
  top: 24px;
  right: 28px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(7, 8, 11, 0.96);
  box-shadow: inset 0 0 0 2px rgba(68, 72, 82, 0.92);
  z-index: 3;
}

.phone-os-overlay {
  position: absolute;
  inset: 6px;
  border-radius: 32px;
  overflow: hidden;
  pointer-events: none;
  z-index: 3;
}

.phone-os-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.22) 0%,
      transparent 16%,
      transparent 74%,
      rgba(0, 0, 0, 0.22) 100%
    ),
    linear-gradient(115deg, rgba(255, 255, 255, 0.18), transparent 30%);
}

.phone-status-bar {
  position: absolute;
  top: 12px;
  left: 22px;
  right: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.42);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
}

.device-frame--iphone .phone-status-bar {
  padding-inline: 6px;
}

.phone-status-icons {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
}

.phone-home-indicator {
  position: absolute;
  left: 50%;
  bottom: 8px;
  width: 28%;
  height: 3px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.28);
}

.phone-companion {
  position: absolute;
  top: 50%;
  width: 82%;
  aspect-ratio: 430 / 932;
  border-radius: 34px;
  padding: 5px;
  overflow: hidden;
  pointer-events: none;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.14), transparent 22%),
    linear-gradient(180deg, #2b2e35 0%, #08090c 100%);
  box-shadow:
    0 24px 54px rgba(0, 0, 0, 0.28),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  opacity: 0.72;
  z-index: 1;
}

.phone-companion::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 32px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  pointer-events: none;
}

.phone-companion--left {
  left: -96%;
  transform: translateY(-50%) rotate(-3deg);
}

.phone-companion--right {
  right: -96%;
  transform: translateY(-50%) rotate(3deg);
}

.phone-companion-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 29px;
  filter: saturate(0.95) brightness(0.88);
}

.phone-companion-cutout {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  background: rgba(5, 6, 8, 0.96);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 4px 10px rgba(0, 0, 0, 0.24);
}

.phone-companion-cutout--hole {
  width: 13px;
  height: 13px;
  border-radius: 50%;
}

.phone-companion-cutout--pill {
  width: 48px;
  height: 14px;
  border-radius: 999px;
}

.device-label {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.device-frame--desktop .device-label {
  display: none;
}

@media (max-width: 768px) {
  .device-frame--desktop {
    width: min(100%, calc(100vw - 48px));
  }

  .device-frame--phone {
    width: min(340px, calc(100vw - 64px), calc((100vh - 112px) * 430 / 932));
  }

  .phone-companion {
    display: none;
  }

  .desktop-folder-column {
    top: 10px;
    left: 9px;
    gap: 6px;
  }

  .desktop-folder {
    width: 30px;
  }

  .desktop-folder i {
    width: 22px;
    height: 18px;
    font-size: 1.05rem;
  }

  .desktop-folder span {
    font-size: 0.54rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-metal-shine {
    animation: none !important;
    opacity: 0 !important;
  }

  .device-screen-image {
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
  }

  .device-screen-tech-grid,
  .device-screen-field--fog,
  .device-screen-field--nodes {
    animation: none !important;
  }

  .device-screen-field--focus,
  .device-screen-field--nodes {
    -webkit-mask: none !important;
    mask: none !important;
  }

  .device-screen-field--focus {
    filter: blur(1px) saturate(1.2) !important;
    opacity: 0.48 !important;
  }

  .device-screen-field--nodes {
    display: none;
  }
}

:global(html.settings-no-animations) .desktop-metal-shine {
  animation: none !important;
  opacity: 0 !important;
}

:global(html.settings-no-animations) .device-screen-image {
  transition: none !important;
  opacity: 1 !important;
  transform: none !important;
  filter: none !important;
}

:global(html.settings-no-animations) .device-screen-tech-grid,
:global(html.settings-no-animations) .device-screen-field--fog,
:global(html.settings-no-animations) .device-screen-field--nodes {
  animation: none !important;
}

:global(html.settings-no-animations) .device-screen-field--focus,
:global(html.settings-no-animations) .device-screen-field--nodes {
  -webkit-mask: none !important;
  mask: none !important;
}

:global(html.settings-no-animations) .device-screen-field--focus {
  filter: blur(1px) saturate(1.2) !important;
  opacity: 0.48 !important;
}

:global(html.settings-no-animations) .device-screen-field--nodes {
  display: none;
}
</style>
