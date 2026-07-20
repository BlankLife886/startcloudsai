<script setup>
import '@/components/wallpaper/fullscreen-preview/features/info/info-tags.css'
import InfoMetadataSection from '@/components/wallpaper/fullscreen-preview/features/info/InfoMetadataSection.vue'
import InfoUserContentSection from '@/components/wallpaper/fullscreen-preview/features/info/InfoUserContentSection.vue'
import notificationService from '@/services/notification'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  showInfo: { type: Boolean, default: false },
  showControls: { type: Boolean, default: true },
  wallpaper: { type: Object, default: null },
  imageInfo: { type: Object, default: null },
  formattedResolution: { type: String, default: '未知分辨率' },
  formattedFileSize: { type: String, default: '未知大小' },
})

const emit = defineEmits(['close', 'tag-click'])

const userTagsText = ref('')
const savedUserTagsText = ref('')

const mergedInfo = computed(() => ({ ...(props.wallpaper || {}), ...(props.imageInfo || {}) }))

const wallpaperId = computed(() => String(mergedInfo.value?.id || props.wallpaper?.id || ''))

const headerSummary = computed(() => {
  const parts = []
  if (props.formattedResolution && props.formattedResolution !== '未知分辨率') {
    parts.push(props.formattedResolution)
  }
  if (props.formattedFileSize && props.formattedFileSize !== '未知大小') {
    parts.push(props.formattedFileSize)
  }
  return parts.join(' · ')
})

const isUserTagsDirty = computed(() => userTagsText.value !== savedUserTagsText.value)

async function copyText(text, label = '内容') {
  const value = String(text || '').trim()
  if (!value) return
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      notificationService.success(`已复制${label}`, { duration: 1200, position: 'top-right' })
      return
    }
  } catch {
    // 忽略剪贴板异常。
  }
  notificationService.info(`${label}：${value}`, { duration: 1400, position: 'top-right' })
}

async function handleTagClick(keyword, source = '标签') {
  const text = String(keyword || '').trim()
  if (!text) return
  emit('tag-click', text)
  await copyText(text, source)
}

function loadUserContent() {
  const id = wallpaperId.value
  if (!id) {
    userTagsText.value = ''
    savedUserTagsText.value = ''
    return
  }
  try {
    const raw = getScopedLocalItem('wallpaper_user_notes_v1')
    const data = raw ? JSON.parse(raw) : {}
    const tags = Array.isArray(data?.[id]?.tags) ? data[id].tags.join(', ') : ''
    userTagsText.value = tags
    savedUserTagsText.value = tags
  } catch {
    userTagsText.value = ''
    savedUserTagsText.value = ''
  }
}

function saveUserContent() {
  const id = wallpaperId.value
  if (!id) return
  const tagsArray = userTagsText.value
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
  try {
    const raw = getScopedLocalItem('wallpaper_user_notes_v1')
    const data = raw ? JSON.parse(raw) : {}
    data[id] = {
      tags: tagsArray,
      updatedAt: new Date().toISOString(),
    }
    setScopedLocalItem('wallpaper_user_notes_v1', JSON.stringify(data))
    savedUserTagsText.value = userTagsText.value
    notificationService.success('已保存', { duration: 1200, position: 'top-right' })
  } catch {
    notificationService.warning('保存失败', { duration: 1400, position: 'top-right' })
  }
}

watch(wallpaperId, loadUserContent, { immediate: true })
</script>

<template>
  <div v-if="showInfo" class="preview-info-panel" :class="{ 'controls-visible': showControls }">
    <div class="info-header">
      <div class="info-header-titles">
        <h5>壁纸信息</h5>
        <button
          v-if="wallpaperId"
          type="button"
          class="info-id-btn"
          title="点击复制 ID"
          @click="copyText(wallpaperId, 'ID')"
        >
          {{ wallpaperId }}
        </button>
        <span v-if="headerSummary" class="info-summary">{{ headerSummary }}</span>
      </div>
      <button class="info-close-btn" type="button" aria-label="关闭" @click="emit('close')">
        <i class="bi bi-x"></i>
      </button>
    </div>

    <div class="info-content">
      <InfoMetadataSection
        :merged-info="mergedInfo"
        :formatted-resolution="formattedResolution"
        :formatted-file-size="formattedFileSize"
        @tag-click="handleTagClick($event, '系统标签')"
        @copy="copyText"
      />

      <InfoUserContentSection
        v-model:user-tags-text="userTagsText"
        :dirty="isUserTagsDirty"
        @save="saveUserContent"
        @tag-click="handleTagClick($event, '用户标签')"
      />
    </div>
  </div>
</template>

<style scoped>
.preview-info-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 340px;
  max-height: calc(100% - 40px);
  display: flex;
  flex-direction: column;
  z-index: 90;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  color: #fff;
  transform: translateX(-10px);
  opacity: 0;
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.preview-info-panel.controls-visible {
  opacity: 1;
  transform: translateX(0);
}

.info-header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.info-header-titles {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.info-header-titles h5 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.info-id-btn {
  padding: 0;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.72rem;
  line-height: 1.35;
  text-align: left;
  word-break: break-all;
  cursor: pointer;
}

.info-id-btn:hover {
  color: rgba(255, 255, 255, 0.78);
  text-decoration: underline;
}

.info-summary {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.62);
  line-height: 1.35;
}

.info-close-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.info-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.info-content {
  flex: 1;
  min-height: 0;
  padding: 10px 14px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (max-width: 768px) {
  .preview-info-panel {
    top: 10px;
    left: 10px;
    width: min(320px, calc(100vw - 20px));
    max-height: calc(100% - 20px);
  }
}
</style>
