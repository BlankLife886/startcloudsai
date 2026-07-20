<script setup>
import DownloadThumbnail from '@/features/downloads/components/DownloadThumbnail.vue'
import { useDownloadsStore } from '@/stores/downloads'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  download: {
    type: Object,
    required: true,
  },
  eager: {
    type: Boolean,
    default: false,
  },
})

const downloadsStore = useDownloadsStore()
const router = useRouter()

const statusText = computed(() => {
  switch (props.download.status) {
    case downloadsStore.DOWNLOAD_STATUS.PENDING:
      return '等待中'
    case downloadsStore.DOWNLOAD_STATUS.DOWNLOADING:
      return '下载中'
    case downloadsStore.DOWNLOAD_STATUS.PAUSED:
      return '已暂停'
    case downloadsStore.DOWNLOAD_STATUS.COMPLETED:
      return '已完成'
    case downloadsStore.DOWNLOAD_STATUS.FAILED:
      return '失败'
    case downloadsStore.DOWNLOAD_STATUS.CANCELED:
      return '已取消'
    default:
      return '未知'
  }
})

const statusIcon = computed(() => {
  switch (props.download.status) {
    case downloadsStore.DOWNLOAD_STATUS.PENDING:
      return 'bi-hourglass-split'
    case downloadsStore.DOWNLOAD_STATUS.DOWNLOADING:
      return 'bi-arrow-down-circle'
    case downloadsStore.DOWNLOAD_STATUS.PAUSED:
      return 'bi-pause-circle'
    case downloadsStore.DOWNLOAD_STATUS.COMPLETED:
      return 'bi-check-circle'
    case downloadsStore.DOWNLOAD_STATUS.FAILED:
      return 'bi-exclamation-circle'
    case downloadsStore.DOWNLOAD_STATUS.CANCELED:
      return 'bi-x-circle'
    default:
      return 'bi-question-circle'
  }
})

const statusToneClass = computed(() => {
  switch (props.download.status) {
    case downloadsStore.DOWNLOAD_STATUS.DOWNLOADING:
      return 'is-downloading'
    case downloadsStore.DOWNLOAD_STATUS.COMPLETED:
      return 'is-completed'
    case downloadsStore.DOWNLOAD_STATUS.FAILED:
      return 'is-failed'
    case downloadsStore.DOWNLOAD_STATUS.PAUSED:
      return 'is-paused'
    case downloadsStore.DOWNLOAD_STATUS.CANCELED:
      return 'is-canceled'
    default:
      return 'is-pending'
  }
})

const formattedDate = computed(() => {
  const date = props.download.started_at
    ? new Date(props.download.started_at)
    : new Date(props.download.created_at)

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const canResume = computed(
  () =>
    props.download.status === downloadsStore.DOWNLOAD_STATUS.PAUSED ||
    props.download.status === downloadsStore.DOWNLOAD_STATUS.FAILED,
)

const canCancel = computed(
  () =>
    props.download.status === downloadsStore.DOWNLOAD_STATUS.DOWNLOADING ||
    props.download.status === downloadsStore.DOWNLOAD_STATUS.PENDING,
)

const canRetry = computed(
  () =>
    props.download.status === downloadsStore.DOWNLOAD_STATUS.FAILED ||
    props.download.status === downloadsStore.DOWNLOAD_STATUS.CANCELED,
)

const canRemove = computed(
  () => props.download.status !== downloadsStore.DOWNLOAD_STATUS.DOWNLOADING,
)

const browserSaveLabel = computed(() => {
  const saveMode = props.download.options?.save_mode || 'default'
  const customFolder = props.download.options?.custom_folder || ''

  if (saveMode === 'resolution' && props.download.wallpaperData?.resolution) {
    return `浏览器下载 / ${props.download.wallpaperData.resolution}`
  }

  if (saveMode === 'date') {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `浏览器下载 / ${year}-${month}-${day}`
  }

  if (saveMode === 'custom' && customFolder) {
    return `浏览器下载 / ${customFolder}`
  }

  return '浏览器下载管理器'
})

const thumbnailSrc = computed(
  () => props.download.wallpaperData?.thumbnail || props.download.wallpaperData?.thumbs?.small || '',
)

const isDownloading = computed(
  () => props.download.status === downloadsStore.DOWNLOAD_STATUS.DOWNLOADING,
)

function resumeDownload() {
  if (props.download.status === downloadsStore.DOWNLOAD_STATUS.PAUSED) {
    downloadsStore.startDownload(props.download.id)
  } else if (props.download.status === downloadsStore.DOWNLOAD_STATUS.FAILED) {
    downloadsStore.retryDownload(props.download.id)
  }
}

function cancelDownload() {
  if (confirm('确定要取消此下载任务吗？')) {
    downloadsStore.cancelDownload(props.download.id)
  }
}

function retryDownload() {
  downloadsStore.retryDownload(props.download.id)
}

function removeDownload() {
  if (confirm('确定要删除此下载任务吗？')) {
    downloadsStore.removeDownload(props.download.id)
  }
}

function viewWallpaper() {
  router.push({
    name: 'wallpaper',
    params: { id: props.download.wallpaperId },
  })
}
</script>

<template>
  <article class="download-record download-record--wallpaper" :class="statusToneClass">
    <button type="button" class="download-record__media" @click="viewWallpaper">
      <DownloadThumbnail
        :src="thumbnailSrc"
        :alt="String(download.wallpaperId || '')"
        :eager="eager"
      />
      <span class="download-record__media-hint" aria-hidden="true">
        <i class="bi bi-eye"></i>
      </span>
    </button>

    <div class="download-record__body">
      <div class="download-record__title">
        <strong>{{ download.wallpaperId }}</strong>
        <span class="download-record__status">
          <i class="bi" :class="statusIcon"></i>
          {{ statusText }}
        </span>
      </div>

      <div class="download-record__meta">
        <span><i class="bi bi-browser-chrome"></i>{{ browserSaveLabel }}</span>
        <span><i class="bi bi-calendar3"></i>{{ formattedDate }}</span>
        <span v-if="download.wallpaperData?.resolution">
          <i class="bi bi-aspect-ratio"></i>{{ download.wallpaperData.resolution }}
        </span>
      </div>

      <div v-if="download.error" class="download-record__error">
        <i class="bi bi-exclamation-triangle"></i>
        {{ download.error }}
      </div>
    </div>

    <div class="download-record__actions">
      <button v-if="canResume" type="button" title="恢复下载" @click="resumeDownload">
        <i class="bi bi-play-fill"></i>
      </button>
      <button v-if="canCancel" type="button" class="is-danger" title="取消下载" @click="cancelDownload">
        <i class="bi bi-x-lg"></i>
      </button>
      <button v-if="canRetry" type="button" class="is-accent" title="重试下载" @click="retryDownload">
        <i class="bi bi-arrow-repeat"></i>
      </button>
      <button type="button" title="查看壁纸" @click="viewWallpaper">
        <i class="bi bi-eye"></i>
      </button>
      <button
        v-if="canRemove"
        type="button"
        class="is-danger"
        title="删除下载任务"
        @click="removeDownload"
      >
        <i class="bi bi-trash"></i>
      </button>
    </div>

    <div
      v-if="isDownloading"
      class="download-record__progress"
      role="progressbar"
      :aria-valuenow="download.progress"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <i :style="{ width: `${download.progress}%` }"></i>
      <em>{{ download.progress }}%</em>
    </div>
  </article>
</template>
