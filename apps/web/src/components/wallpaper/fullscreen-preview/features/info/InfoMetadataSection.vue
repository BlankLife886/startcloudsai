<script setup>
import { computed } from 'vue'
import { tagTone } from '@/utils/tagTone'

const props = defineProps({
  mergedInfo: { type: Object, default: () => ({}) },
  formattedResolution: { type: String, default: '未知分辨率' },
  formattedFileSize: { type: String, default: '未知大小' },
})

const emit = defineEmits(['tag-click', 'copy'])

const UNKNOWN = new Set(['未知', '未知分辨率', '未知大小'])

function isKnown(value) {
  const text = String(value ?? '').trim()
  return text && !UNKNOWN.has(text)
}

function formatCount(value) {
  if (value == null || value === '') return ''
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)
  if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')} 万`
  return num.toLocaleString('zh-CN')
}

const uploaderName = computed(() => {
  const uploader = props.mergedInfo?.uploader
  if (!uploader) return ''
  if (typeof uploader === 'string') return uploader
  return uploader.username || uploader.name || uploader.id || ''
})

const ratioText = computed(() => {
  if (props.mergedInfo?.ratio) return String(props.mergedInfo.ratio)
  const w = Number(props.mergedInfo?.dimension_x || props.mergedInfo?.width || 0)
  const h = Number(props.mergedInfo?.dimension_y || props.mergedInfo?.height || 0)
  if (!w || !h) return ''
  return `${w}:${h}`
})

const fileTypeText = computed(() => {
  if (props.mergedInfo?.file_type) return String(props.mergedInfo.file_type).toUpperCase()
  const path = String(props.mergedInfo?.path || '')
  const ext = path.split('.').pop()
  if (!ext || ext === path) return ''
  return ext.toUpperCase()
})

const purityText = computed(() => {
  const value = String(props.mergedInfo?.purity || '').toLowerCase()
  if (!value) return ''
  if (value === 'sfw') return 'SFW'
  if (value === 'sketchy') return 'Sketchy'
  if (value === 'nsfw') return 'NSFW'
  return value
})

const dateText = computed(() => {
  const value = props.mergedInfo?.date_added || props.mergedInfo?.created_at
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
})

const tags = computed(() => {
  const list = props.mergedInfo?.tags
  return Array.isArray(list) ? list : []
})

const colors = computed(() => {
  const list = props.mergedInfo?.colors
  return Array.isArray(list) ? list : []
})

const resolutionLine = computed(() => {
  const parts = []
  if (isKnown(props.formattedResolution)) parts.push(props.formattedResolution)
  if (isKnown(ratioText.value)) parts.push(ratioText.value)
  if (isKnown(props.formattedFileSize)) parts.push(props.formattedFileSize)
  if (isKnown(fileTypeText.value)) parts.push(fileTypeText.value)
  return parts.join(' · ')
})

function buildCard(label, value, { copyable = false, wide = false } = {}) {
  if (!isKnown(value)) return null
  return { label, value: String(value), copyable, wide }
}

const cards = computed(() => {
  const list = []
  if (resolutionLine.value) {
    list.push({ label: '分辨率', value: resolutionLine.value, copyable: true, wide: true })
  }
  const category = buildCard('分类', props.mergedInfo?.category)
  const purity = buildCard('纯净度', purityText.value)
  const views = buildCard('浏览', formatCount(props.mergedInfo?.views))
  const favorites = buildCard('收藏', formatCount(props.mergedInfo?.favorites))
  const uploader = buildCard('上传者', uploaderName.value, { copyable: true })
  const date = buildCard('上传', dateText.value)
  const source = buildCard('来源', props.mergedInfo?.source || 'Wallhaven', { wide: true })
  ;[category, purity, views, favorites, uploader, date, source].forEach((card) => {
    if (card) list.push(card)
  })
  return list
})

function parseTagText(tag) {
  return typeof tag === 'object' ? String(tag?.name || '').trim() : String(tag || '').trim()
}

function handleTagClick(tag) {
  const keyword = parseTagText(tag)
  if (!keyword) return
  emit('tag-click', keyword)
}

function handleCopy(card) {
  if (!card?.copyable) return
  emit('copy', card.value, card.label)
}

function tagClass(tag) {
  return tagTone(tag)
}
</script>

<template>
  <section class="info-metadata-section">
    <div class="info-card-grid">
      <component
        :is="card.copyable ? 'button' : 'div'"
        v-for="card in cards"
        :key="card.label"
        type="button"
        class="info-card"
        :class="{
          'info-card--wide': card.wide,
          'info-card--clickable': card.copyable,
        }"
        :title="card.copyable ? `复制${card.label}` : undefined"
        @click="card.copyable ? handleCopy(card) : undefined"
      >
        <span class="info-card-label">{{ card.label }}</span>
        <span class="info-card-value">{{ card.value }}</span>
      </component>

      <div v-if="colors.length > 0" class="info-card info-card--wide">
        <span class="info-card-label">颜色</span>
        <div class="color-palette">
          <button
            v-for="(color, index) in colors"
            :key="index"
            type="button"
            class="color-box"
            :style="{ backgroundColor: color }"
            :title="`复制 ${color}`"
            @click="emit('copy', color, '颜色')"
          ></button>
        </div>
      </div>

      <div v-if="tags.length > 0" class="info-card info-card--wide info-card--tags">
        <span class="info-card-label">标签</span>
        <div class="tags-list">
          <button
            v-for="tag in tags"
            :key="typeof tag === 'object' ? tag.id || tag.name : tag"
            type="button"
            class="preview-info-tag preview-info-tag-clickable"
            :class="tagClass(tag)"
            @click="handleTagClick(tag)"
          >
            {{ typeof tag === 'object' ? tag.name : tag }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.info-metadata-section {
  display: block;
}

.info-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.info-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 54px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
  font: inherit;
  color: inherit;
  width: 100%;
}

.info-card--wide {
  grid-column: 1 / -1;
}

.info-card--clickable {
  cursor: pointer;
}

.info-card--clickable:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.info-card-label {
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.68rem;
  line-height: 1.3;
}

.info-card-value {
  color: rgba(255, 255, 255, 0.92);
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.4;
  word-break: break-word;
}

.info-card--clickable .info-card-value:hover {
  text-decoration: underline;
}

.info-card--tags {
  min-height: 0;
}

.color-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 2px;
}

.color-box {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  cursor: pointer;
}

.color-box:hover {
  border-color: rgba(255, 255, 255, 0.45);
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 108px;
  overflow-y: auto;
  padding-top: 2px;
}
</style>
