<script setup>
import { ART_STYLE_PARAM_CONFIG, ART_STYLE_PRESETS } from '@/features/filters/artStyleEngine'
import { computed, nextTick, ref } from 'vue'

const props = defineProps({
  activeArtStyle: { type: String, default: 'none' },
  artStyleIntensity: { type: Number, default: 60 },
  artStyleParams: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'apply-art-style',
  'art-style-intensity-change',
  'art-style-param-change',
])

const paramsSectionRef = ref(null)

const showArtStyleIntensity = computed(
  () => props.activeArtStyle && props.activeArtStyle !== 'none',
)
const currentStyleControls = computed(() => ART_STYLE_PARAM_CONFIG[props.activeArtStyle] || [])
const activeStyleLabel = computed(
  () => ART_STYLE_PRESETS.find((item) => item.id === props.activeArtStyle)?.label || '',
)

function styleParamValue(key, fallback = 0) {
  const styleState = props.artStyleParams?.[props.activeArtStyle] || {}
  const value = styleState[key]
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

async function selectStyle(styleId) {
  emit('apply-art-style', styleId)
  if (!styleId || styleId === 'none') return
  await nextTick()
  paramsSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
</script>

<template>
  <div class="filter-tab-panel">
    <section
      v-if="showArtStyleIntensity"
      ref="paramsSectionRef"
      class="filter-group-card filter-group-card--style-params"
    >
      <div class="filter-group-head">
        {{ activeStyleLabel ? `${activeStyleLabel} · 参数` : '风格参数' }}
      </div>

      <div class="filter-slider">
        <div class="filter-slider-label">
          <span>强度</span>
          <span class="filter-slider-value">{{ artStyleIntensity }}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          :value="artStyleIntensity"
          @input="emit('art-style-intensity-change', Number($event.target.value))"
        />
      </div>

      <div
        v-for="control in currentStyleControls"
        :key="`${activeArtStyle}-${control.key}`"
        class="filter-slider"
      >
        <div class="filter-slider-label">
          <span>{{ control.label }}</span>
          <span class="filter-slider-value">{{
            styleParamValue(control.key, control.defaultValue)
          }}</span>
        </div>
        <input
          type="range"
          :min="control.min"
          :max="control.max"
          :step="control.step || 1"
          :value="styleParamValue(control.key, control.defaultValue)"
          @input="
            emit('art-style-param-change', {
              key: control.key,
              value: Number($event.target.value),
            })
          "
        />
      </div>
    </section>

    <section class="filter-group-card">
      <div class="filter-group-head">艺术风格</div>
      <div class="filter-preset-grid">
        <button
          v-for="style in ART_STYLE_PRESETS"
          :key="style.id"
          type="button"
          class="filter-preset-btn"
          :class="{ active: activeArtStyle === style.id }"
          :title="style.description || style.label"
          @click="selectStyle(style.id)"
        >
          <span class="preset-label">{{ style.label }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
