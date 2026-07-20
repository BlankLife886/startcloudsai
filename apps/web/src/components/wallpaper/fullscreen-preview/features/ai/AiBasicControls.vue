<script setup>
import { computed } from 'vue'
import {
  normalizeAiImageProcessingConfig,
} from '@/components/wallpaper/fullscreen-preview/constants/ai'
import { parseAiOutputSize } from '@/components/wallpaper/fullscreen-preview/features/ai/aiAspectUtils'

const props = defineProps({
  loading: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  selectedModel: { type: String, default: '' },
  outputSize: { type: String, default: '' },
  customPrompt: { type: String, default: '' },
  imageProcessingConfig: { type: Object, default: () => normalizeAiImageProcessingConfig() },
})

const emit = defineEmits([
  'update:selectedModel',
  'update:outputSize',
  'update:customPrompt',
])

const selectedModelMeta = computed(
  () => props.modelOptions.find((model) => model.id === props.selectedModel) || null,
)
const controlsConfig = computed(() => normalizeAiImageProcessingConfig(props.imageProcessingConfig))
const outputSizePresets = computed(() => controlsConfig.value.outputSizePresets || [])

const outputSizeMeta = computed(() => {
  const parsed = parseAiOutputSize(props.outputSize, outputSizePresets.value)
  if (!parsed.width || !parsed.height) return null
  return {
    label: parsed.label,
    aspect: reduceAspect(parsed.width, parsed.height),
  }
})

function selectPreset(value) {
  emit('update:outputSize', value)
}

function updateOutputSize(value) {
  emit('update:outputSize', String(value || '').trim())
}

function reduceAspect(width, height) {
  let x = Math.abs(Math.round(Number(width) || 0))
  let y = Math.abs(Math.round(Number(height) || 0))
  if (!x || !y) return ''
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  const divisor = x || 1
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}
</script>

<template>
  <section class="ai-control-stack">
    <div class="ai-control-block">
      <div class="ai-section-title">
        <span>模型</span>
        <small>{{ selectedModelMeta?.pricing?.display || selectedModelMeta?.providerLabel || '云端处理' }}</small>
      </div>
      <label class="ai-control-field">
        <span>处理能力</span>
        <select
          v-if="modelOptions.length"
          :value="selectedModel"
          :disabled="loading"
          @change="emit('update:selectedModel', $event.target.value)"
        >
          <option
            v-for="model in modelOptions"
            :key="model.id"
            :value="model.id"
          >
            {{ model.label || model.id }}
          </option>
        </select>
        <strong v-else>后台未分配模型</strong>
      </label>
      <p v-if="selectedModelMeta?.description" class="ai-control-hint">
        {{ selectedModelMeta.description }}
      </p>
    </div>

    <div class="ai-control-block">
      <div class="ai-section-title">
        <span>输出尺寸</span>
        <small>{{ outputSizeMeta ? `${outputSizeMeta.label} · ${outputSizeMeta.aspect}` : '请输入宽 x 高' }}</small>
      </div>
      <div
        v-if="outputSizePresets.length"
        class="ai-size-grid"
        role="group"
        aria-label="输出尺寸预设"
      >
        <button
          v-for="preset in outputSizePresets"
          :key="preset.value"
          type="button"
          class="ai-size-option"
          :class="{ active: outputSize === preset.value }"
          :disabled="loading"
          @click="selectPreset(preset.value)"
        >
          <strong>{{ preset.label }}</strong>
          <span>{{ preset.detail }}</span>
        </button>
      </div>
      <label v-if="controlsConfig.allowManualOutputSize" class="ai-control-field">
        <span>手动尺寸</span>
        <input
          :value="outputSize"
          type="text"
          :class="{ invalid: outputSize && !outputSizeMeta }"
          :placeholder="controlsConfig.manualSizePlaceholder"
          :disabled="loading"
          @input="updateOutputSize($event.target.value)"
        />
      </label>
    </div>

    <div class="ai-control-block">
      <div class="ai-section-title">
        <span>提示词</span>
        <small>可选</small>
      </div>
      <textarea
        :value="customPrompt"
        class="ai-prompt-textarea"
        rows="5"
        :placeholder="controlsConfig.promptPlaceholder"
        :disabled="loading"
        @input="emit('update:customPrompt', $event.target.value)"
      ></textarea>
    </div>
  </section>
</template>

<style scoped>
.ai-control-stack {
  display: grid;
  gap: 12px;
}

.ai-control-block {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.055);
}

.ai-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #fff;
}

.ai-section-title span {
  font-size: 0.82rem;
  font-weight: 800;
}

.ai-section-title small {
  min-width: 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.68rem;
  text-align: right;
}

.ai-control-field {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.78rem;
}

.ai-control-field select,
.ai-control-field input {
  min-width: 0;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  padding: 0 9px;
  font-size: 0.78rem;
}

.ai-control-field input.invalid {
  border-color: rgba(255, 129, 129, 0.68);
  box-shadow: 0 0 0 2px rgba(255, 129, 129, 0.12);
}

.ai-control-field strong {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.76rem;
}

.ai-control-hint {
  margin: 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.7rem;
  line-height: 1.45;
}

.ai-size-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.ai-size-option {
  min-width: 0;
  min-height: 46px;
  display: grid;
  align-content: center;
  gap: 2px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
  text-align: left;
  padding: 7px 8px;
}

.ai-size-option strong {
  font-size: 0.82rem;
  line-height: 1;
}

.ai-size-option span {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.66rem;
}

.ai-size-option.active {
  border-color: rgba(130, 220, 155, 0.72);
  background: rgba(130, 220, 155, 0.18);
  color: #fff;
}

.ai-prompt-textarea {
  width: 100%;
  min-height: 116px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  padding: 9px;
  resize: vertical;
  font-size: 0.76rem;
  line-height: 1.5;
}
</style>
