<script setup>
import { computed } from 'vue'

const props = defineProps({
  activeFilter: { type: String, default: 'none' },
  filterParams: { type: Object, required: true },
  filterIntensity: { type: Number, default: 100 },
})

const emit = defineEmits(['filter-change', 'filter-intensity-change'])

const showIntensitySlider = computed(() => ['sepia', 'blur', 'invert'].includes(props.activeFilter))

const lutStyleOptions = [
  { value: 'none', label: '无' },
  { value: 'clean', label: '纯净' },
  { value: 'film_gold', label: '金色胶片' },
  { value: 'kodak_portra', label: '柯达人像' },
  { value: 'fuji_classic', label: '富士经典' },
  { value: 'fuji_vivid', label: '富士鲜艳' },
  { value: 'film_matte', label: '哑光胶片' },
  { value: 'cinestill', label: '电影胶片' },
  { value: 'cinema', label: '电影' },
  { value: 'blockbuster', label: '商业大片' },
  { value: 'noir', label: '黑白电影' },
  { value: 'dream', label: '梦幻' },
  { value: 'korean_cream', label: '韩系奶油' },
  { value: 'japan_clear', label: '日系清透' },
  { value: 'sakura', label: '樱花粉' },
  { value: 'xiaohongshu_oat', label: '米白燕麦' },
  { value: 'nature', label: '自然' },
  { value: 'desert_warm', label: '沙漠暖调' },
  { value: 'arctic_clean', label: '雪境冷白' },
  { value: 'night', label: '夜景' },
  { value: 'neon', label: '霓虹' },
  { value: 'hongkong_neon', label: '港风霓虹' },
  { value: 'urban_steel', label: '都市钢蓝' },
  { value: 'cyber', label: '赛博' },
  { value: 'hologram', label: '全息' },
]

const cameraProfileOptions = [
  { value: 'none', label: '无' },
  { value: 'canon_portrait', label: 'Canon 人像' },
  { value: 'nikon_landscape', label: 'Nikon 风景' },
  { value: 'sony_clean', label: 'Sony 清晰' },
  { value: 'leica_classic', label: 'Leica 经典' },
  { value: 'hasselblad_natural', label: '哈苏自然' },
  { value: 'ricoh_gr', label: 'Ricoh GR' },
  { value: 'iphone_vivid', label: 'iPhone 鲜明' },
]

const adjustGroups = [
  {
    title: '基础',
    items: [
      { key: 'brightness', label: '亮度', min: 0, max: 200, step: 1, unit: '%' },
      { key: 'contrast', label: '对比度', min: 0, max: 200, step: 1, unit: '%' },
    ],
  },
  {
    title: '光影',
    items: [
      { key: 'saturation', label: '饱和度', min: 0, max: 200, step: 1, unit: '%' },
      { key: 'blur', label: '模糊', min: 0, max: 20, step: 0.5, unit: 'px' },
      { key: 'exposure', label: '曝光', min: -100, max: 100, step: 1 },
      { key: 'highlights', label: '高光', min: -100, max: 100, step: 1 },
      { key: 'shadows', label: '阴影', min: -100, max: 100, step: 1 },
      { key: 'blackPoint', label: '黑位', min: -100, max: 100, step: 1 },
    ],
  },
  {
    title: '色彩',
    items: [
      { key: 'grayscale', label: '灰度', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'sepia', label: '褐调', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'invert', label: '反相', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'temperature', label: '色温', min: -100, max: 100, step: 1 },
      { key: 'vibrance', label: '自然饱和', min: -100, max: 100, step: 1 },
      { key: 'shadowCool', label: '冷影', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'highlightWarm', label: '暖光', min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  {
    title: '胶片与 LUT',
    items: [
      { key: 'fade', label: '褪色', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'vignette', label: '暗角', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'grain', label: '颗粒', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'curveStrength', label: '曲线', min: -100, max: 100, step: 1 },
      {
        key: 'lutStyle',
        label: 'LUT 风格',
        type: 'select',
        options: lutStyleOptions,
      },
      { key: 'lutIntensity', label: 'LUT 强度', min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  {
    title: '细节与人像',
    items: [
      { key: 'clarity', label: '清晰度', min: -100, max: 100, step: 1 },
      { key: 'skinSmooth', label: '肤色柔化', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'skinWarmth', label: '肤色暖度', min: -100, max: 100, step: 1 },
      { key: 'skinProtect', label: '肤色保护', min: 0, max: 100, step: 1, unit: '%' },
      {
        key: 'cameraProfile',
        label: '相机色彩',
        type: 'select',
        options: cameraProfileOptions,
      },
      { key: 'profileIntensity', label: '相机强度', min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
]

function formatValue(item) {
  if (item.type === 'select') {
    const current = props.filterParams[item.key]
    return item.options.find((option) => option.value === current)?.label || '无'
  }
  const value = props.filterParams[item.key]
  if (item.unit === '%') return `${value}%`
  if (item.unit === 'px') return `${value}px`
  return value
}
</script>

<template>
  <div class="filter-tab-panel">
    <section v-if="showIntensitySlider" class="filter-group-card">
      <div class="filter-group-head">当前预设强度</div>
      <div class="filter-slider">
        <div class="filter-slider-label">
          <span>强度</span>
          <span class="filter-slider-value">{{ filterIntensity }}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="200"
          :value="filterIntensity"
          @input="emit('filter-intensity-change', Number($event.target.value))"
        />
      </div>
    </section>

    <section v-for="group in adjustGroups" :key="group.title" class="filter-group-card">
      <div class="filter-group-head">{{ group.title }}</div>

      <div v-for="item in group.items" :key="item.key" class="filter-slider">
        <div class="filter-slider-label">
          <span>{{ item.label }}</span>
          <span class="filter-slider-value">{{ formatValue(item) }}</span>
        </div>

        <select
          v-if="item.type === 'select'"
          v-model="filterParams[item.key]"
          class="filter-select"
          @change="emit('filter-change')"
        >
          <option v-for="option in item.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <input
          v-else
          type="range"
          :min="item.min"
          :max="item.max"
          :step="item.step"
          v-model.number="filterParams[item.key]"
          @change="emit('filter-change')"
        />
      </div>
    </section>
  </div>
</template>
