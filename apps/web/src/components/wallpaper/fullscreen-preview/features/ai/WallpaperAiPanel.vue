<script setup>
import { computed } from 'vue'
import AiActionSection from '@/components/wallpaper/fullscreen-preview/features/ai/AiActionSection.vue'
import AiHistorySection from '@/components/wallpaper/fullscreen-preview/features/ai/AiHistorySection.vue'
import AiModelTaskSection from '@/components/wallpaper/fullscreen-preview/features/ai/AiModelTaskSection.vue'
import AiRecipeSection from '@/components/wallpaper/fullscreen-preview/features/ai/AiRecipeSection.vue'
import {
  normalizeAiImageProcessingConfig,
} from '@/components/wallpaper/fullscreen-preview/constants/ai'

const props = defineProps({
  show: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  retryable: { type: Boolean, default: false },
  statusText: { type: String, default: '' },
  modelOptions: { type: Array, default: () => [] },
  selectedModel: { type: String, default: '' },
  outputSize: { type: String, default: '' },
  customPrompt: { type: String, default: '' },
  recipeName: { type: String, default: '' },
  recipes: { type: Array, default: () => [] },
  history: { type: Array, default: () => [] },
  undoCount: { type: Number, default: 0 },
  isAuthenticated: { type: Boolean, default: false },
  runtimeLimits: { type: Object, default: () => ({}) },
  imageProcessingConfig: { type: Object, default: () => normalizeAiImageProcessingConfig() },
})

const emit = defineEmits([
  'close',
  'generate',
  'apply-download',
  'undo',
  'reset',
  'retry',
  'save-recipe',
  'apply-recipe',
  'remove-recipe',
  'apply-history',
  'download-history',
  'update:selectedModel',
  'update:outputSize',
  'update:customPrompt',
  'update:recipeName',
])

function useModelProxy(propName, eventName) {
  return computed({
    get: () => props[propName],
    set: (value) => emit(eventName, value),
  })
}

const selectedModelValue = useModelProxy('selectedModel', 'update:selectedModel')
const outputSizeValue = useModelProxy('outputSize', 'update:outputSize')
const customPromptValue = useModelProxy('customPrompt', 'update:customPrompt')
const recipeNameValue = useModelProxy('recipeName', 'update:recipeName')

const panelConfig = computed(() => normalizeAiImageProcessingConfig(props.imageProcessingConfig))
</script>

<template>
  <div v-if="show" class="ai-panel">
    <div class="ai-panel-head">
      <div class="ai-panel-title">
        <span v-if="panelConfig.panelKicker" class="ai-panel-kicker">
          {{ panelConfig.panelKicker }}
        </span>
        <h5 v-if="panelConfig.panelTitle">{{ panelConfig.panelTitle }}</h5>
      </div>
      <button type="button" class="ai-close-btn" @click="emit('close')">
        <i class="bi bi-x"></i>
      </button>
    </div>

    <AiModelTaskSection
      :loading="loading"
      :model-options="modelOptions"
      :image-processing-config="panelConfig"
      v-model:selected-model="selectedModelValue"
      v-model:output-size="outputSizeValue"
      v-model:custom-prompt="customPromptValue"
    />

    <AiRecipeSection
      :loading="loading"
      v-model:recipe-name="recipeNameValue"
      :recipes="recipes"
      @save-recipe="emit('save-recipe')"
      @apply-recipe="emit('apply-recipe', $event)"
      @remove-recipe="emit('remove-recipe', $event)"
    />

    <AiActionSection
      :loading="loading"
      :error="error"
      :retryable="retryable"
      :status-text="statusText"
      :is-authenticated="isAuthenticated"
      :undo-count="undoCount"
      @generate="emit('generate')"
      @apply-download="emit('apply-download')"
      @undo="emit('undo')"
      @reset="emit('reset')"
      @retry="emit('retry')"
    />

    <AiHistorySection
      :history="history"
      @apply-history="emit('apply-history', $event)"
      @download-history="emit('download-history', $event)"
    />
  </div>
</template>

<style scoped>
.ai-panel {
  position: absolute;
  right: 20px;
  top: 72px;
  bottom: 72px;
  width: min(360px, calc(100vw - 40px));
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(16, 18, 18, 0.78);
  backdrop-filter: blur(10px);
  z-index: 86;
  display: grid;
  gap: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ai-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  color: #fff;
}

.ai-panel-title {
  display: grid;
  gap: 2px;
}

.ai-panel-kicker {
  color: rgba(152, 228, 175, 0.9);
  font-size: 0.66rem;
  font-weight: 800;
}

.ai-panel-head h5 {
  margin: 0;
  font-size: 1rem;
  letter-spacing: 0;
}

.ai-close-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

</style>
