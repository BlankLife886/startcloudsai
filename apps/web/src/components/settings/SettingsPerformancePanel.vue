<script setup>
import { computed, watch } from 'vue'

const props = defineProps({
  formData: {
    type: Object,
    required: true,
  },
  storageUsage: {
    type: Object,
    required: true,
  },
  performanceTools: {
    type: Array,
    default: () => [],
  },
  activeDropdown: {
    type: String,
    default: null,
  },
  qualityCapSelect: {
    type: Object,
    required: true,
  },
  getSettingsSelectLabel: {
    type: Function,
    required: true,
  },
})

const emit = defineEmits(['clear-cache', 'toggle-dropdown', 'set-select'])

const QUALITY_ORDER = ['tiny', 'medium', 'high', 'original']
const LOW_DATA_QUALITY_CAP = 'medium'

const loadingTools = computed(() =>
  props.performanceTools.filter((tool) => tool.key !== 'clear_cache_on_exit'),
)

const lowDataMode = computed(() => Boolean(props.formData.performance_low_data_mode))
const lazyLoading = computed(() => Boolean(props.formData.enable_lazy_loading))
const clearOnExit = computed(() => Boolean(props.formData.clear_cache_on_exit))
const cacheEnabled = computed(() => Boolean(props.formData.fullscreen_preview_blob_cache_enabled))

const loadModeLabel = computed(() => {
  if (lowDataMode.value) return '省流优先'
  if (lazyLoading.value) return '均衡显示'
  return '即时加载'
})

const storageMeterPercent = computed(() =>
  Math.min((Number(props.storageUsage?.total || 0) / 1024) * 100, 100),
)

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function clampPreviewCacheSettings(formData) {
  formData.fullscreen_preview_blob_cache_max_items = clampNumber(
    formData.fullscreen_preview_blob_cache_max_items,
    10,
    1,
    100,
  )
  formData.fullscreen_preview_blob_cache_max_mb = clampNumber(
    formData.fullscreen_preview_blob_cache_max_mb,
    80,
    1,
    4096,
  )
}

function setQuality(value) {
  if (lowDataMode.value && QUALITY_ORDER.indexOf(value) > QUALITY_ORDER.indexOf(LOW_DATA_QUALITY_CAP)) {
    return
  }
  emit('set-select', props.qualityCapSelect.model, value)
}

function toggleClearOnExit() {
  props.formData.clear_cache_on_exit = !props.formData.clear_cache_on_exit
}

watch(
  () => [
    props.formData.fullscreen_preview_blob_cache_max_items,
    props.formData.fullscreen_preview_blob_cache_max_mb,
  ],
  () => clampPreviewCacheSettings(props.formData),
)

watch(
  () => props.formData.performance_low_data_mode,
  (enabled) => {
    if (!enabled) return
    const current = props.formData.performance_preview_quality_cap
    if (QUALITY_ORDER.indexOf(current) > QUALITY_ORDER.indexOf(LOW_DATA_QUALITY_CAP)) {
      props.formData.performance_preview_quality_cap = LOW_DATA_QUALITY_CAP
    }
  },
)
</script>

<template>
  <section class="settings-panel settings-console__section">
    <div class="settings-console__stack">
      <div class="compact-settings-panel perf-panel">
        <div class="compact-panel-head">
          <strong>图片加载</strong>
          <span>控制卡片图片的加载压力 · {{ loadModeLabel }}</span>
        </div>

        <div class="perf-row">
          <div class="perf-row__tools" role="group" aria-label="加载开关">
            <label v-for="tool in loadingTools" :key="tool.key" class="tool-chip">
              <input v-model="formData[tool.key]" type="checkbox" />
              <span :title="tool.tooltip">
                <i class="bi" :class="tool.icon"></i> {{ tool.label }}
              </span>
            </label>
          </div>
        </div>

        <div class="perf-quality" role="radiogroup" :aria-label="qualityCapSelect.label">
          <span class="perf-quality__label">{{ qualityCapSelect.label }}</span>
          <div class="perf-quality__options">
            <label
              v-for="option in qualityCapSelect.options"
              :key="option.value"
              class="perf-quality__option"
              :class="{
                'is-active': formData[qualityCapSelect.model] === option.value,
                'is-disabled':
                  lowDataMode &&
                  QUALITY_ORDER.indexOf(option.value) > QUALITY_ORDER.indexOf(LOW_DATA_QUALITY_CAP),
              }"
            >
              <input
                type="radio"
                :name="qualityCapSelect.model"
                :value="option.value"
                :checked="formData[qualityCapSelect.model] === option.value"
                :disabled="
                  lowDataMode &&
                  QUALITY_ORDER.indexOf(option.value) > QUALITY_ORDER.indexOf(LOW_DATA_QUALITY_CAP)
                "
                @change="setQuality(option.value)"
              />
              <span>{{ option.label }}</span>
            </label>
          </div>
          <small v-if="lowDataMode" class="perf-quality__hint">低流量开启时最高中等</small>
        </div>
      </div>

      <div class="compact-settings-panel perf-panel">
        <div class="compact-panel-head">
          <strong>站点存储</strong>
          <button
            type="button"
            class="toolbar-visibility-button danger-soft"
            title="清理站点临时缓存与缓存数据库"
            @click="$emit('clear-cache')"
          >
            <i class="bi bi-trash3" aria-hidden="true"></i>
            <span>清理存储</span>
          </button>
        </div>

        <div class="perf-storage-line">
          <div class="perf-storage-line__usage">
            <strong>{{ storageUsage.total }} KB</strong>
            <div class="perf-storage-line__track" aria-hidden="true">
              <i :style="{ width: `${storageMeterPercent}%` }"></i>
            </div>
            <span>按 1 MB 估算</span>
          </div>
          <button
            type="button"
            class="perf-strategy"
            :class="{ 'is-active': clearOnExit }"
            :title="clearOnExit ? '点击改为手动清理' : '点击改为离开页面时清理临时缓存'"
            @click="toggleClearOnExit"
          >
            {{ clearOnExit ? '退出清理' : '手动清理' }}
          </button>
        </div>

        <div class="perf-cache-row">
          <div class="perf-cache-row__copy">
            <strong>全屏原图缓存</strong>
            <span>只缓存打开过的原图，重复预览时本地复用</span>
          </div>
          <label class="preview-cache-switch" :title="cacheEnabled ? '关闭原图缓存' : '开启原图缓存'">
            <input v-model="formData.fullscreen_preview_blob_cache_enabled" type="checkbox" />
            <span aria-hidden="true"></span>
          </label>
        </div>

        <div class="perf-cache-fields" :class="{ 'is-disabled': !cacheEnabled }">
          <label class="perf-num">
            <span>最多张数</span>
            <input
              v-model.number="formData.fullscreen_preview_blob_cache_max_items"
              type="number"
              min="1"
              max="100"
              step="1"
              :disabled="!cacheEnabled"
            />
            <em>张</em>
          </label>
          <label class="perf-num">
            <span>最大容量</span>
            <input
              v-model.number="formData.fullscreen_preview_blob_cache_max_mb"
              type="number"
              min="1"
              max="4096"
              step="1"
              :disabled="!cacheEnabled"
            />
            <em>MB</em>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
