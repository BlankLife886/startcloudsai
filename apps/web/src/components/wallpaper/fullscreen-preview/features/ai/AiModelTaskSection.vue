<script setup>
import { computed } from 'vue'
import AiBasicControls from '@/components/wallpaper/fullscreen-preview/features/ai/AiBasicControls.vue'
import {
  normalizeAiImageProcessingConfig,
} from '@/components/wallpaper/fullscreen-preview/constants/ai'

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

function useModelProxy(propName, eventName) {
  return computed({
    get: () => props[propName],
    set: (value) => emit(eventName, value),
  })
}

const selectedModelValue = useModelProxy('selectedModel', 'update:selectedModel')
const outputSizeValue = useModelProxy('outputSize', 'update:outputSize')
const customPromptValue = useModelProxy('customPrompt', 'update:customPrompt')
</script>

<template>
  <section class="ai-settings">
    <AiBasicControls
      :loading="loading"
      :model-options="modelOptions"
      :image-processing-config="imageProcessingConfig"
      v-model:selected-model="selectedModelValue"
      v-model:output-size="outputSizeValue"
      v-model:custom-prompt="customPromptValue"
    />
  </section>
</template>

<style scoped>
.ai-settings {
  display: grid;
  gap: 10px;
}
</style>
