<script setup>
import notificationService from '@/services/notification'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { useSettingsStore } from '@/stores/settings'
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  wallpaper: {
    type: Object,
    default: null,
  },
  isMultiple: {
    type: Boolean,
    default: false,
  },
  wallpaperIds: {
    type: Array,
    default: () => [],
  },
  processedImageData: {
    type: String,
    default: '',
  },
  customFilename: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close', 'download'])

const settingsStore = useSettingsStore()

const downloadConfig = ref({
  save_mode: 'default',
  custom_folder: '',
  save_metadata: false,
  timeout: 30,
  download_launch_delay_ms: 900,
  useProcessedImage: false,
})

const title = computed(() => {
  if (props.isMultiple) {
    return `下载 ${props.wallpaperIds.length} 张壁纸`
  }

  if (props.wallpaper) {
    return `下载壁纸 ${props.wallpaper.id}`
  }

  return '下载壁纸'
})

const showCustomFolder = computed(() => downloadConfig.value.save_mode === 'custom')
const hasProcessedImage = computed(() => Boolean(props.processedImageData))

function closeModal() {
  emit('close')
}

function startDownload() {
  setScopedLocalItem('current_save_mode', downloadConfig.value.save_mode)
  setScopedLocalItem('current_custom_folder', downloadConfig.value.custom_folder)

  notificationService.info('正在准备下载...', {
    duration: 2000,
    position: 'top-right',
  })

  const shouldUseProcessedImage =
    downloadConfig.value.useProcessedImage && Boolean(props.processedImageData)

  const downloadOptions = {
    ...downloadConfig.value,
    useProcessedImage: shouldUseProcessedImage,
    wallpaper: props.wallpaper,
    wallpaperIds: props.wallpaperIds,
    isMultiple: props.isMultiple,
  }

  if (shouldUseProcessedImage) {
    downloadOptions.processedImageData = props.processedImageData
    if (props.customFilename) {
      downloadOptions.customFilename = props.customFilename
    }
  } else {
    delete downloadOptions.processedImageData
    delete downloadOptions.customFilename
  }

  emit('download', downloadOptions)
  closeModal()
}

function hydrateSettings() {
  const savedSaveMode = getScopedLocalItem('current_save_mode')
  const savedCustomFolder = getScopedLocalItem('current_custom_folder')

  downloadConfig.value = {
    save_mode: savedSaveMode || settingsStore.getSetting('save_mode', 'default'),
    custom_folder: savedCustomFolder || settingsStore.getSetting('custom_folder', ''),
    save_metadata: settingsStore.getSetting('save_metadata', false),
    timeout: settingsStore.getSetting('timeout', 30),
    download_launch_delay_ms: settingsStore.getSetting('download_launch_delay_ms', 900),
    useProcessedImage: hasProcessedImage.value,
  }
}

onMounted(() => {
  hydrateSettings()
})

watch(
  () => props.show,
  (visible) => {
    if (!visible) return

    hydrateSettings()
  },
)

watch(hasProcessedImage, (available) => {
  downloadConfig.value.useProcessedImage = available
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="download-modal-backdrop" @click="closeModal">
      <div
        class="download-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-config-title"
        @click.stop
      >
        <div class="modal-header">
          <div>
            <p class="modal-kicker">Download Setup</p>
            <h5 id="download-config-title" class="modal-title">{{ title }}</h5>
          </div>
          <button type="button" class="btn-close" @click="closeModal" aria-label="关闭"></button>
        </div>

        <div class="modal-body">
          <section class="modal-section">
            <label class="field-label" for="save_mode">默认归类</label>
            <select id="save_mode" class="field-control" v-model="downloadConfig.save_mode">
              <option value="default">不归类</option>
              <option value="resolution">按分辨率</option>
              <option value="date">按日期</option>
              <option value="custom">自定义名称</option>
            </select>
            <p class="field-help">用于下载记录中的归类显示，实际保存位置由浏览器决定。</p>
          </section>

          <section v-if="showCustomFolder" class="modal-section">
            <label class="field-label" for="custom_folder">归类名称</label>
            <input
              id="custom_folder"
              type="text"
              class="field-control"
              v-model="downloadConfig.custom_folder"
              placeholder="例如：Pepe Picks"
            />
            <p class="field-help">只影响站内下载记录的归类提示。</p>
          </section>

          <section class="modal-section modal-number-grid">
            <label>
              <span class="field-label">任务超时 秒</span>
              <input
                v-model.number="downloadConfig.timeout"
                type="number"
                min="10"
                max="300"
                class="field-control"
              />
            </label>
            <label>
              <span class="field-label">触发间隔 ms</span>
              <input
                v-model.number="downloadConfig.download_launch_delay_ms"
                type="number"
                min="300"
                max="5000"
                step="100"
                class="field-control"
              />
            </label>
          </section>

          <section class="modal-section option-stack">
            <div class="option-row">
              <input
                id="save_metadata"
                v-model="downloadConfig.save_metadata"
                class="toggle-input"
                type="checkbox"
              />
              <div class="option-copy">
                <label class="option-title" for="save_metadata">下载记录附加信息</label>
                <p class="option-help">在站内记录中保留来源、标签和分辨率等信息。</p>
              </div>
            </div>

            <div v-if="hasProcessedImage" class="option-row">
              <input
                id="useProcessedImage"
                v-model="downloadConfig.useProcessedImage"
                class="toggle-input"
                type="checkbox"
              />
              <div class="option-copy">
                <label class="option-title" for="useProcessedImage">下载处理后的图像</label>
                <p class="option-help">
                  导出当前预览中的处理结果，包含 AI 修改、裁切、滤镜或旋转后的版本。
                </p>
              </div>
            </div>
          </section>
        </div>
        <div class="modal-footer">
          <button type="button" class="footer-button muted" @click="closeModal">取消</button>
          <button type="button" class="footer-button primary" @click="startDownload">
            开始下载
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.download-modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(3px);
  z-index: 12000;
}

.download-modal-panel {
  position: relative;
  width: min(720px, 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  background: #1f1f1f;
  color: #ffffff;
  box-shadow: 0 28px 64px rgba(0, 0, 0, 0.44);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 16px;
}

.modal-kicker {
  margin: 0 0 6px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.modal-title {
  margin: 0;
  color: #ffffff;
  font-size: clamp(1.5rem, 3vw, 2rem);
  font-weight: 800;
}

.btn-close {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  font-size: 0;
}

.btn-close::before {
  content: '×';
  font-size: 1.75rem;
  line-height: 1;
}

.btn-close:hover {
  background: rgba(var(--primary-color-rgb), 0.2);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 0 24px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.modal-section {
  padding-top: 18px;
}

.modal-number-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.modal-number-grid label {
  min-width: 0;
}

.field-label {
  display: block;
  margin-bottom: 10px;
  color: #ffffff;
  font-size: 0.96rem;
  font-weight: 780;
}

.field-control {
  width: 100%;
  min-height: 54px;
  padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: #ffffff;
  font-size: 0.98rem;
}

.field-control:focus {
  outline: none;
  border-color: rgba(var(--primary-color-rgb), 0.44);
  box-shadow: 0 0 0 3px rgba(var(--primary-color-rgb), 0.18);
}

.field-control option {
  color: #ffffff;
  background: #1f1f1f;
}

.field-help {
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.62);
  line-height: 1.55;
}

.option-stack {
  display: grid;
  gap: 14px;
  padding-bottom: 2px;
}

.option-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}

.toggle-input {
  position: relative;
  width: 52px;
  height: 30px;
  margin: 6px 0 0;
  appearance: none;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: background 0.2s ease;
}

.toggle-input::before {
  content: '';
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s ease;
}

.toggle-input:checked {
  background: #1f7aff;
}

.toggle-input:checked::before {
  transform: translateX(22px);
}

.option-copy {
  min-width: 0;
}

.option-title {
  display: block;
  margin: 0 0 6px;
  color: #ffffff;
  font-size: 0.98rem;
  font-weight: 760;
}

.option-help {
  margin: 0;
  color: rgba(255, 255, 255, 0.64);
  line-height: 1.55;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 18px 24px 22px;
}

.footer-button {
  min-width: 104px;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border: none;
  border-radius: 12px;
  color: #ffffff;
  font-size: 0.96rem;
  font-weight: 760;
}

.footer-button.muted {
  background: #7d8791;
}

.footer-button.primary {
  background: var(--primary-color);
}

@media (max-width: 640px) {
  .download-modal-backdrop {
    padding: 12px;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .modal-footer {
    flex-direction: column-reverse;
  }

  .footer-button {
    width: 100%;
  }

  .option-row {
    grid-template-columns: 1fr;
  }

  .modal-number-grid {
    grid-template-columns: 1fr;
  }

  .toggle-input {
    margin-top: 0;
  }
}
</style>
