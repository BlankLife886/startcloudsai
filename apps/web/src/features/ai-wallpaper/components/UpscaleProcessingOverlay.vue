<script setup>
import { computed } from 'vue'

const props = defineProps({
  task: { type: Object, default: null },
  compact: { type: Boolean, default: false },
  fullscreen: { type: Boolean, default: false },
  cancelling: { type: Boolean, default: false },
})

defineEmits(['cancel'])

const progress = computed(() =>
  Math.max(0, Math.min(100, Number(props.task?.localUpscaleProgress || 0))),
)
const roundedProgress = computed(() => Math.round(progress.value))
const overlayStyle = computed(() => ({
  '--upscale-progress': `${progress.value * 3.6}deg`,
  '--upscale-percent': `${progress.value}%`,
}))
const target = computed(() => String(props.task?.localUpscaleTarget || '高清'))
const profile = computed(() => String(props.task?.localUpscaleProfile || '自适应纹理分析'))
const message = computed(() =>
  String(props.task?.localUpscaleMessage || `正在生成 ${target.value} 无损图片`),
)
const stageLabel = computed(() => {
  const labels = {
    prepare: '初始化画质引擎',
    download: '读取原始像素',
    decode: '解析色彩与尺寸',
    analyze: '分析纹理与噪点',
    resize: '重建目标像素',
    enhance: '增强边缘与微纹理',
    encode: '后台无损编码',
    upload: '安全保存与校验',
  }
  return labels[String(props.task?.localUpscaleStage || '')] || '画质重建处理中'
})
</script>

<template>
  <div
    class="upscale-processing"
    :class="{ 'is-compact': compact, 'is-fullscreen': fullscreen }"
    :style="overlayStyle"
    role="status"
    aria-live="polite"
  >
    <span class="upscale-processing__scan" aria-hidden="true"></span>
    <span class="upscale-processing__grid" aria-hidden="true"></span>
    <span class="upscale-processing__particles" aria-hidden="true">
      <i v-for="index in 7" :key="index"></i>
    </span>

    <div class="upscale-processing__hud">
      <div class="upscale-processing__ring" aria-hidden="true">
        <span>{{ roundedProgress }}<small>%</small></span>
      </div>
      <div class="upscale-processing__copy">
        <small>{{ target }} · {{ profile }}</small>
        <strong>{{ stageLabel }}</strong>
        <p v-if="!compact">{{ message }}</p>
        <span class="upscale-processing__bar" aria-hidden="true"><i></i></span>
      </div>
      <button
        v-if="!compact"
        type="button"
        :disabled="cancelling"
        @click.stop="$emit('cancel')"
      >
        <i class="bi" :class="cancelling ? 'bi-arrow-repeat spin' : 'bi-x-lg'"></i>
        <span>{{ cancelling ? '取消中' : '取消' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.upscale-processing {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
  color: #fff;
  pointer-events: none;
  isolation: isolate;
}

.upscale-processing::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 110%, rgba(111, 85, 255, 0.32), transparent 48%),
    linear-gradient(180deg, transparent 35%, rgba(4, 4, 10, 0.72));
}

.upscale-processing__scan {
  position: absolute;
  z-index: 1;
  left: 0;
  right: 0;
  height: 18%;
  background: linear-gradient(180deg, transparent, rgba(145, 126, 255, 0.2), transparent);
  border-bottom: 1px solid rgba(181, 169, 255, 0.78);
  box-shadow: 0 12px 30px rgba(113, 87, 255, 0.18);
  animation: upscale-scan 2.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

.upscale-processing__grid {
  position: absolute;
  inset: 0;
  opacity: 0.18;
  background-image:
    linear-gradient(rgba(158, 143, 255, 0.16) 1px, transparent 1px),
    linear-gradient(90deg, rgba(158, 143, 255, 0.16) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: linear-gradient(transparent, #000 30%, #000 70%, transparent);
  animation: upscale-grid 8s linear infinite;
}

.upscale-processing__particles i {
  position: absolute;
  bottom: 14%;
  left: calc(9% + var(--particle-index, 0) * 12%);
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #c9c0ff;
  box-shadow: 0 0 12px #8b76ff;
  animation: upscale-particle 2.8s ease-in infinite;
}

.upscale-processing__particles i:nth-child(1) { left: 11%; animation-delay: -0.4s; }
.upscale-processing__particles i:nth-child(2) { left: 24%; animation-delay: -1.8s; }
.upscale-processing__particles i:nth-child(3) { left: 39%; animation-delay: -0.9s; }
.upscale-processing__particles i:nth-child(4) { left: 53%; animation-delay: -2.3s; }
.upscale-processing__particles i:nth-child(5) { left: 67%; animation-delay: -1.2s; }
.upscale-processing__particles i:nth-child(6) { left: 81%; animation-delay: -2.6s; }
.upscale-processing__particles i:nth-child(7) { left: 91%; animation-delay: -0.1s; }

.upscale-processing__hud {
  position: absolute;
  z-index: 3;
  left: 50%;
  bottom: 22px;
  width: min(560px, calc(100% - 32px));
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 13px 14px;
  transform: translateX(-50%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 20px;
  background: rgba(10, 9, 18, 0.78);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42), inset 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  pointer-events: auto;
}

.upscale-processing__ring {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(#a998ff var(--upscale-progress), rgba(255, 255, 255, 0.1) 0);
  box-shadow: 0 0 24px rgba(127, 99, 255, 0.28);
}

.upscale-processing__ring::before {
  content: '';
  grid-area: 1 / 1;
  width: 44px;
  height: 44px;
  border-radius: inherit;
  background: #11101a;
}

.upscale-processing__ring span {
  position: relative;
  grid-area: 1 / 1;
  font: 700 0.92rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.upscale-processing__ring small {
  margin-left: 1px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.55rem;
}

.upscale-processing__copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.upscale-processing__copy > small {
  color: #bcb1ff;
  font-size: 0.7rem;
}

.upscale-processing__copy strong {
  overflow: hidden;
  font-size: 0.92rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upscale-processing__copy p {
  overflow: hidden;
  margin: 0;
  color: rgba(255, 255, 255, 0.54);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upscale-processing__bar {
  height: 3px;
  overflow: hidden;
  margin-top: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}

.upscale-processing__bar i {
  display: block;
  width: var(--upscale-percent);
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6955ff, #b3a5ff, #70d7ff);
  box-shadow: 0 0 12px rgba(126, 103, 255, 0.65);
  transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.upscale-processing__hud button {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
}

.upscale-processing__hud button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.upscale-processing.is-compact::before {
  background: linear-gradient(180deg, transparent, rgba(7, 6, 14, 0.76));
}

.upscale-processing.is-compact .upscale-processing__grid,
.upscale-processing.is-compact .upscale-processing__particles {
  display: none;
}

.upscale-processing.is-compact .upscale-processing__hud {
  bottom: 8px;
  width: calc(100% - 16px);
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  padding: 7px 8px;
  border-radius: 12px;
  pointer-events: none;
}

.upscale-processing.is-compact .upscale-processing__ring {
  width: 34px;
  height: 34px;
}

.upscale-processing.is-compact .upscale-processing__ring::before {
  width: 28px;
  height: 28px;
}

.upscale-processing.is-compact .upscale-processing__ring span {
  font-size: 0.63rem;
}

.upscale-processing.is-compact .upscale-processing__copy > small,
.upscale-processing.is-compact .upscale-processing__bar {
  display: none;
}

.upscale-processing.is-compact .upscale-processing__copy strong {
  font-size: 0.68rem;
}

.upscale-processing.is-fullscreen .upscale-processing__hud {
  bottom: calc(78px + env(safe-area-inset-bottom, 0px));
}

@keyframes upscale-scan {
  0% { transform: translateY(-120%); opacity: 0; }
  16% { opacity: 1; }
  84% { opacity: 1; }
  100% { transform: translateY(650%); opacity: 0; }
}

@keyframes upscale-grid {
  to { background-position: 34px 34px; }
}

@keyframes upscale-particle {
  0% { transform: translate3d(0, 12px, 0) scale(0.6); opacity: 0; }
  24% { opacity: 0.9; }
  100% { transform: translate3d(12px, -180px, 0) scale(1.5); opacity: 0; }
}

@media (max-width: 640px) {
  .upscale-processing__hud {
    bottom: 12px;
    gap: 9px;
    padding: 10px;
  }

  .upscale-processing__ring {
    width: 46px;
    height: 46px;
  }

  .upscale-processing__ring::before {
    width: 38px;
    height: 38px;
  }

  .upscale-processing__hud button span,
  .upscale-processing__copy p {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .upscale-processing__scan,
  .upscale-processing__grid,
  .upscale-processing__particles i {
    animation: none;
  }
}
</style>
