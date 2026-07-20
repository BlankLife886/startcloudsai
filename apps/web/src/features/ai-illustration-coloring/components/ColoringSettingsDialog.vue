<script setup>
import { computed, onUnmounted, reactive, watch } from 'vue'
import {
  COLORING_BATCH_COUNT_OPTIONS,
  COLORING_COMPRESS_KB_OPTIONS,
  COLORING_FORMAT_OPTIONS,
  COLORING_OUTPUT_ORIENTATION_OPTIONS,
  COLORING_OUTPUT_SIZE_OPTIONS,
  normalizeColoringSettings,
} from '@/services/aiIllustrationColoringState'

const props = defineProps({
  show: { type: Boolean, default: false },
  settings: { type: Object, default: () => ({}) },
  models: { type: Array, default: () => [] },
  sourceWidth: { type: Number, default: 0 },
  sourceHeight: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'save'])

const draft = reactive(normalizeColoringSettings())

watch(
  () => [props.show, props.settings],
  () => {
    if (!props.show) return
    Object.assign(draft, normalizeColoringSettings(props.settings))
  },
  { immediate: true, deep: true },
)

const modelOptions = computed(() =>
  (Array.isArray(props.models) ? props.models : [])
    .map((item) => ({
      id: String(item?.publicModelKey || item?.id || '').trim(),
      label: String(item?.label || item?.publicModelKey || item?.id || '').trim(),
      creditCost: Number(item?.creditCost || 0),
    }))
    .filter((item) => item.id),
)

const outputHint = computed(
  () => COLORING_OUTPUT_SIZE_OPTIONS.find((item) => item.id === draft.outputSize)?.hint || '',
)

const isLandscapeSource = computed(
  () => Number(props.sourceWidth || 0) > Number(props.sourceHeight || 0),
)

watch(
  isLandscapeSource,
  (isLandscape) => {
    if (isLandscape && draft.outputOrientation === 'portrait') {
      draft.outputOrientation = 'source'
    }
  },
  { immediate: true },
)

const outputOrientationOptions = computed(() =>
  COLORING_OUTPUT_ORIENTATION_OPTIONS.map((item) => ({
    ...item,
    disabled: item.id === 'portrait' && isLandscapeSource.value,
  })),
)

const orientationHint = computed(() => {
  if (isLandscapeSource.value) return '横图线稿会保持横向输出，避免压缩主体或生成不自然的竖向补画。'
  if (draft.outputOrientation === 'landscape')
    return '会向左右延展画布；主体保留，新增区域由模型补全。'
  if (draft.outputOrientation === 'portrait') return '按竖向画布出图，适合人物、海报与移动端展示。'
  return '保持输入线稿的原始方向和构图比例。'
})

const uploadHint = computed(() => {
  if (!draft.enableCompress) {
    return '关闭后直接上传原文件，不转格式、不降低质量、不缩小尺寸。'
  }
  if (draft.inputFormat === 'image/png') {
    return '开启压缩时 PNG 几乎压不小，会自动改用 JPEG/WebP，避免文件变大。开启压缩可能让出图变糊，清晰度优先时请保持关闭。'
  }
  if (draft.inputFormat === 'original') {
    return '超过上限时优先尝试在原格式内处理，必要时再使用更小的有损格式。开启压缩可能让出图变糊，清晰度优先时请保持关闭。'
  }
  return '超过上限时会先降质量再缩小尺寸，保证处理后不比原图更大。开启压缩可能让出图变糊，清晰度优先时请保持关闭。'
})

function save() {
  const payload = normalizeColoringSettings(draft)
  if (!payload.publicModelKey && modelOptions.value.length) {
    payload.publicModelKey = modelOptions.value[0].id
  }
  emit('save', payload)
}

function close() {
  emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

watch(
  () => props.show,
  (show) => {
    if (show) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="show" class="coloring-settings-layer" @click.self="close">
    <section
      class="coloring-settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coloring-settings-title"
    >
      <header>
        <div>
          <strong id="coloring-settings-title">染色设置</strong>
          <small>上传、输出与模型 — 影响下次提交</small>
        </div>
        <button type="button" class="coloring-settings-close" aria-label="关闭" @click="close">
          <i class="bi bi-x-lg"></i>
        </button>
      </header>

      <div class="coloring-settings-body">
        <section class="coloring-settings-section">
          <h3><i class="bi bi-cloud-arrow-up"></i> 上传</h3>
          <label class="coloring-settings-switch">
            <input v-model="draft.enableCompress" type="checkbox" />
            <span>上传前压缩图片</span>
          </label>

          <div class="coloring-settings-field" :class="{ disabled: !draft.enableCompress }">
            <span>压缩上限</span>
            <div class="coloring-settings-chips">
              <button
                v-for="kb in COLORING_COMPRESS_KB_OPTIONS"
                :key="kb"
                type="button"
                :class="{ active: draft.compressMaxKb === kb }"
                :disabled="!draft.enableCompress"
                @click="draft.compressMaxKb = kb"
              >
                {{ kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB` }}
              </button>
            </div>
          </div>

          <div class="coloring-settings-field" :class="{ disabled: !draft.enableCompress }">
            <span>压缩后格式</span>
            <div class="coloring-settings-chips">
              <button
                v-for="item in COLORING_FORMAT_OPTIONS"
                :key="item.id"
                type="button"
                :class="{ active: draft.inputFormat === item.id }"
                :disabled="!draft.enableCompress"
                @click="draft.inputFormat = item.id"
              >
                {{ item.label }}
              </button>
            </div>
            <small>{{ uploadHint }}</small>
          </div>
        </section>

        <section class="coloring-settings-section">
          <h3><i class="bi bi-aspect-ratio"></i> 输出</h3>
          <div class="coloring-settings-field">
            <span>输出方向</span>
            <div class="coloring-settings-chips coloring-settings-chips--orientation">
              <button
                v-for="item in outputOrientationOptions"
                :key="item.id"
                type="button"
                :class="{ active: draft.outputOrientation === item.id }"
                :disabled="item.disabled"
                @click="draft.outputOrientation = item.id"
              >
                {{ item.label }}
              </button>
            </div>
            <small>{{ orientationHint }}</small>
          </div>
          <div class="coloring-settings-field">
            <span>输出尺寸</span>
            <div class="coloring-settings-chips">
              <button
                v-for="item in COLORING_OUTPUT_SIZE_OPTIONS"
                :key="item.id"
                type="button"
                :class="{ active: draft.outputSize === item.id }"
                @click="draft.outputSize = item.id"
              >
                {{ item.label }}
              </button>
            </div>
            <small>{{ outputHint }}</small>
          </div>

          <div class="coloring-settings-field">
            <span>一次生成</span>
            <div class="coloring-settings-chips">
              <button
                v-for="count in COLORING_BATCH_COUNT_OPTIONS"
                :key="count"
                type="button"
                :class="{ active: draft.generationCount === count }"
                @click="draft.generationCount = count"
              >
                {{ count }} 张
              </button>
            </div>
            <small
              >同一线稿和风格并发生成多个结果，最多 5 张；完成后可打开批次选择每张清晰结果。</small
            >
          </div>
        </section>

        <section class="coloring-settings-section">
          <h3><i class="bi bi-trash3"></i> 历史记录</h3>
          <label class="coloring-settings-switch">
            <input v-model="draft.confirmBeforeDelete" type="checkbox" />
            <span>删除历史前需要确认</span>
          </label>
          <small>默认关闭。开启后，删除单次或批量染色记录前会显示确认窗口。</small>
        </section>

        <section v-if="modelOptions.length" class="coloring-settings-section">
          <h3><i class="bi bi-cpu"></i> 模型</h3>
          <div class="coloring-settings-field">
            <div class="coloring-settings-models">
              <button
                v-for="model in modelOptions"
                :key="model.id"
                type="button"
                :class="{
                  active:
                    draft.publicModelKey === model.id ||
                    (!draft.publicModelKey && model === modelOptions[0]),
                }"
                @click="draft.publicModelKey = model.id"
              >
                <strong>{{ model.label }}</strong>
                <small v-if="model.creditCost > 0">{{ model.creditCost }} 积分 / 次</small>
                <small v-else>按平台计费</small>
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer>
        <button type="button" class="coloring-settings-secondary" @click="close">取消</button>
        <button type="button" class="coloring-settings-primary" @click="save">保存设置</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.coloring-settings-layer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(6, 4, 10, 0.72);
  backdrop-filter: blur(8px);
  animation: settings-fade-in 0.22s ease;
}

.coloring-settings-panel {
  width: min(100%, 520px);
  max-height: min(88svh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  background: #141019;
  color: #fff;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  animation: settings-rise 0.28s var(--coloring-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.coloring-settings-panel header,
.coloring-settings-panel footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
}

.coloring-settings-panel header {
  position: sticky;
  top: 0;
  z-index: 2;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(20, 16, 25, 0.96);
  backdrop-filter: blur(10px);
}

.coloring-settings-panel footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  justify-content: flex-end;
  background: rgba(20, 16, 25, 0.96);
  backdrop-filter: blur(10px);
}

.coloring-settings-panel header strong {
  display: block;
  font-size: 1rem;
}

.coloring-settings-panel header small {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.72rem;
}

.coloring-settings-close {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.coloring-settings-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 18px 16px;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  display: grid;
  gap: 14px;
}

.coloring-settings-section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.coloring-settings-section h3 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
}

.coloring-settings-section h3 i {
  color: #f9a8d4;
}

.coloring-settings-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
}

.coloring-settings-field {
  display: grid;
  gap: 8px;
}

.coloring-settings-field.disabled {
  opacity: 0.45;
}

.coloring-settings-field > span {
  font-size: 0.78rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.72);
}

.coloring-settings-field > small {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.7rem;
  line-height: 1.45;
}

.coloring-settings-chips,
.coloring-settings-models {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.coloring-settings-chips button,
.coloring-settings-models button {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  font-size: 0.74rem;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.coloring-settings-models button {
  border-radius: 12px;
  min-width: 140px;
  padding: 10px 12px;
  text-align: left;
  display: grid;
  gap: 2px;
}

.coloring-settings-models button strong {
  font-size: 0.8rem;
}

.coloring-settings-models button small {
  color: rgba(255, 255, 255, 0.45);
}

.coloring-settings-chips button.active,
.coloring-settings-models button.active {
  border-color: rgba(236, 72, 153, 0.5);
  background: rgba(236, 72, 153, 0.14);
  color: #fbcfe8;
}

.coloring-settings-secondary,
.coloring-settings-primary {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 11px;
  font-size: 0.82rem;
  cursor: pointer;
}

.coloring-settings-secondary {
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.04);
}

.coloring-settings-primary {
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
}

@keyframes settings-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes settings-rise {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
