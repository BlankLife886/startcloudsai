<script setup>
import DownloadItem from '@/components/download/DownloadItem.vue'
import DownloadVirtualList from '@/features/downloads/components/DownloadVirtualList.vue'
import { useDownloadsPageMotion } from '@/features/downloads/composables/useDownloadsPageMotion'
import { warmDownloadThumbs } from '@/features/downloads/composables/useDownloadThumbCache'
import '@/features/downloads/styles/downloads-view.css'
import notificationService from '@/services/notification'
import {
  cancelWallpaperZipPackaging,
  initZipDownloadRecords,
  refreshCloudZipDownloadRecords,
  removeZipDownloadRecord,
  retryZipDownloadRecord,
  wallpaperDownloadUi,
  zipDownloadRecords,
} from '@/services/wallpaperDownload'
import { useDownloadsStore } from '@/stores/downloads'
import { useSettingsStore } from '@/stores/settings'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const downloadsStore = useDownloadsStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const pageRoot = ref(null)
const activeTab = ref('all')
const searchQuery = ref('')
const feedScrollRef = ref(null)
const pageReady = ref(false)
let realtimeReloadTimer = null

const ZIP_ACTIVE_STATUSES = new Set(['preparing', 'downloading'])
const ZIP_FAILED_STATUSES = new Set(['failed', 'cancelled', 'expired'])

const tabIcons = {
  all: 'bi-layers',
  active: 'bi-lightning-charge',
  completed: 'bi-check2-circle',
  failed: 'bi-exclamation-triangle',
}

const allDownloadRecords = computed(() => [
  ...zipDownloadRecords.map((record) => ({
    ...record,
    recordType: 'zip',
  })),
  ...downloadsStore.downloads.map((record) => ({
    ...record,
    recordType: 'wallpaper',
  })),
])

const filteredDownloads = computed(() => {
  let result = [...allDownloadRecords.value]

  if (activeTab.value !== 'all') {
    result = result.filter((download) => {
      if (download.recordType === 'zip') {
        if (activeTab.value === 'active') return ZIP_ACTIVE_STATUSES.has(download.status)
        if (activeTab.value === 'completed') return download.status === 'completed'
        if (activeTab.value === 'failed') return ZIP_FAILED_STATUSES.has(download.status)
        return true
      }

      switch (activeTab.value) {
        case 'active':
          return (
            download.status === downloadsStore.DOWNLOAD_STATUS.DOWNLOADING ||
            download.status === downloadsStore.DOWNLOAD_STATUS.PENDING
          )
        case 'completed':
          return download.status === downloadsStore.DOWNLOAD_STATUS.COMPLETED
        case 'failed':
          return (
            download.status === downloadsStore.DOWNLOAD_STATUS.FAILED ||
            download.status === downloadsStore.DOWNLOAD_STATUS.CANCELED ||
            download.status === downloadsStore.DOWNLOAD_STATUS.PAUSED
          )
        default:
          return true
      }
    })
  }

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter((download) => {
      if (download.recordType === 'zip') {
        return (
          String(download.filename || '')
            .toLowerCase()
            .includes(query) || String(download.count || '').includes(query)
        )
      }

      return (
        String(download.wallpaperId || '')
          .toLowerCase()
          .includes(query) ||
        (download.wallpaperData?.resolution &&
          download.wallpaperData.resolution.toLowerCase().includes(query))
      )
    })
  }

  result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return result
})

const downloadCounts = computed(() => {
  const records = allDownloadRecords.value
  const isActive = (record) =>
    record.recordType === 'zip'
      ? ZIP_ACTIVE_STATUSES.has(record.status)
      : record.status === downloadsStore.DOWNLOAD_STATUS.DOWNLOADING ||
        record.status === downloadsStore.DOWNLOAD_STATUS.PENDING
  const isCompleted = (record) =>
    record.recordType === 'zip'
      ? record.status === 'completed'
      : record.status === downloadsStore.DOWNLOAD_STATUS.COMPLETED
  const isFailed = (record) =>
    record.recordType === 'zip'
      ? ZIP_FAILED_STATUSES.has(record.status)
      : record.status === downloadsStore.DOWNLOAD_STATUS.FAILED ||
        record.status === downloadsStore.DOWNLOAD_STATUS.CANCELED ||
        record.status === downloadsStore.DOWNLOAD_STATUS.PAUSED

  return {
    all: records.length,
    active: records.filter(isActive).length,
    completed: records.filter(isCompleted).length,
    failed: records.filter(isFailed).length,
  }
})

const retryableWallpaperFailedCount = computed(
  () =>
    downloadsStore.downloads.filter(
      (d) =>
        d.status === downloadsStore.DOWNLOAD_STATUS.FAILED ||
        d.status === downloadsStore.DOWNLOAD_STATUS.CANCELED,
    ).length,
)

const tabItems = computed(() => [
  { key: 'all', label: '全部', count: downloadCounts.value.all },
  { key: 'active', label: '进行中', count: downloadCounts.value.active },
  { key: 'completed', label: '已完成', count: downloadCounts.value.completed },
  { key: 'failed', label: '失败/暂停', count: downloadCounts.value.failed },
])

const currentTabLabel = computed(
  () => tabItems.value.find((tab) => tab.key === activeTab.value)?.label || '当前',
)

const completedRate = computed(() => {
  if (!downloadCounts.value.all) return 0
  return Math.round((downloadCounts.value.completed / downloadCounts.value.all) * 100)
})

const showSkeleton = computed(
  () => downloadsStore.isLoading && allDownloadRecords.value.length === 0,
)

const emptyState = computed(() => {
  if (downloadCounts.value.all === 0) {
    return {
      icon: 'bi-cloud-arrow-down',
      title: '下载站暂时安静',
      text: '去浏览壁纸时下载图片或压缩包，这里会展示进度和状态。',
    }
  }

  if (searchQuery.value.trim()) {
    return {
      icon: 'bi-search',
      title: '没有匹配的下载记录',
      text: `当前关键词：“${searchQuery.value.trim()}”`,
    }
  }

  return {
    icon: tabIcons[activeTab.value] || 'bi-inbox',
    title: `${currentTabLabel.value}列表为空`,
    text: '换个筛选看看，或者继续添加新的下载任务。',
  }
})

function getZipStatusText(status) {
  switch (status) {
    case 'preparing':
      return '生成中'
    case 'downloading':
      return '打包中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    case 'expired':
      return '已清理'
    default:
      return '未知'
  }
}

function getZipStatusIcon(status) {
  switch (status) {
    case 'preparing':
      return 'bi-file-zip'
    case 'downloading':
      return 'bi-arrow-down-circle'
    case 'completed':
      return 'bi-check-circle'
    case 'failed':
      return 'bi-exclamation-circle'
    case 'cancelled':
      return 'bi-x-circle'
    case 'expired':
      return 'bi-archive'
    default:
      return 'bi-question-circle'
  }
}

function getZipToneClass(status) {
  if (ZIP_ACTIVE_STATUSES.has(status)) return 'is-downloading'
  if (status === 'completed') return 'is-completed'
  if (status === 'failed' || status === 'cancelled' || status === 'expired') return 'is-failed'
  return 'is-pending'
}

function canRetryZipRecord(record) {
  return (
    ['failed', 'cancelled'].includes(record.status) &&
    Array.isArray(record.wallpapers) &&
    record.wallpapers.length > 0
  )
}

function formatRecordDate(value) {
  if (!value) return '未知时间'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function setActiveTab(tab) {
  activeTab.value = tab
}

function clearSearch() {
  searchQuery.value = ''
}

function removeZipRecord(record) {
  if (ZIP_ACTIVE_STATUSES.has(record.status)) {
    notificationService.warning('正在打包的记录请先取消', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }

  if (confirm('确定要删除这个压缩包记录吗？')) {
    removeZipDownloadRecord(record.id)
  }
}

function cancelZipRecord(record) {
  if (record.id !== wallpaperDownloadUi.activeRecordId || !wallpaperDownloadUi.progressVisible) {
    notificationService.warning('这个压缩包任务已经不在运行中', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }
  cancelWallpaperZipPackaging()
}

async function retryZipRecord(record) {
  if (!canRetryZipRecord(record)) {
    notificationService.warning('这条压缩包记录缺少原始壁纸清单，不能重试', {
      duration: 3600,
      position: 'top-right',
    })
    return
  }
  await retryZipDownloadRecord(record.id)
}

function retryAllFailed() {
  if (confirm('确定要重试所有失败的下载吗？')) {
    const failedDownloads = downloadsStore.downloads.filter(
      (d) =>
        d.status === downloadsStore.DOWNLOAD_STATUS.FAILED ||
        d.status === downloadsStore.DOWNLOAD_STATUS.CANCELED,
    )

    let retryCount = 0
    failedDownloads.forEach((download) => {
      if (downloadsStore.retryDownload(download.id)) {
        retryCount++
      }
    })

    notificationService.info(`已重新添加 ${retryCount} 个下载任务`, {
      duration: 3000,
      position: 'top-right',
    })
  }
}

function openSettingsModal() {
  router.push({
    path: '/settings',
    query: { tab: 'download' },
  })
}

function browseWallpapers() {
  router.push({ path: '/search' })
}

function warmVisibleThumbs(records) {
  warmDownloadThumbs(
    records
      .filter((item) => item.recordType === 'wallpaper')
      .map((item) => item.wallpaperData?.thumbnail)
      .filter(Boolean),
    32,
  )
}

watch(
  filteredDownloads,
  (records) => {
    warmVisibleThumbs(records)
  },
  { immediate: true },
)

useDownloadsPageMotion({
  pageRef: pageRoot,
  feedRef: feedScrollRef,
  ready: pageReady,
  filterKey: computed(() => `${activeTab.value}::${searchQuery.value.trim()}`),
  loading: computed(() => downloadsStore.isLoading && allDownloadRecords.value.length === 0),
})

onBeforeMount(() => {
  // 首帧前挂上页面 class，并同步灌入本地记录，避免刷新闪骨架 / 闪样式
  document.documentElement.classList.add('downloads-gallery-page')
  settingsStore.initSettings()
  initZipDownloadRecords()
  void downloadsStore.initDownloads()
})

onMounted(async () => {
  window.addEventListener('walleven:download-updated', handleDownloadUpdated)
  await nextTick()
  pageReady.value = true
})

onBeforeUnmount(() => {
  window.clearTimeout(realtimeReloadTimer)
  window.removeEventListener('walleven:download-updated', handleDownloadUpdated)
  document.documentElement.classList.remove('downloads-gallery-page')
})

function handleDownloadUpdated() {
  window.clearTimeout(realtimeReloadTimer)
  realtimeReloadTimer = window.setTimeout(() => {
    void Promise.all([
      downloadsStore.initDownloads({ forceRemote: true }),
      refreshCloudZipDownloadRecords({ force: true }),
    ])
  }, 280)
}
</script>

<template>
  <main ref="pageRoot" class="downloads-page" :class="{ 'is-ready': pageReady }">
    <div class="downloads-atmosphere" aria-hidden="true"></div>

    <header class="downloads-toolbar" data-dl-motion>
      <div class="downloads-toolbar__title">
        <h1>下载管理</h1>
        <div class="downloads-stats" aria-label="下载统计">
          <div>
            <strong>{{ downloadCounts.all }}</strong>
            <span>总任务</span>
          </div>
          <div>
            <strong>{{ downloadCounts.active }}</strong>
            <span>进行中</span>
          </div>
          <div>
            <strong>{{ completedRate }}%</strong>
            <span>完成率</span>
          </div>
        </div>
      </div>
      <div class="downloads-toolbar__actions">
        <button type="button" class="is-ghost" @click="openSettingsModal">
          <i class="bi bi-sliders"></i>下载设置
        </button>
        <button
          type="button"
          class="is-ghost"
          :disabled="retryableWallpaperFailedCount === 0"
          @click="retryAllFailed"
        >
          <i class="bi bi-arrow-repeat"></i>重试失败
        </button>
      </div>
    </header>

    <section class="downloads-body">
      <nav class="downloads-categories" data-dl-motion aria-label="下载状态筛选">
        <button
          v-for="tab in tabItems"
          :key="tab.key"
          type="button"
          :class="{ 'is-active': activeTab === tab.key }"
          @click="setActiveTab(tab.key)"
        >
          <i class="bi" :class="tabIcons[tab.key]"></i>
          {{ tab.label }}
          <em>{{ tab.count }}</em>
        </button>
      </nav>

      <div class="downloads-main" data-dl-motion>
        <div class="downloads-feed-head">
          <div>
            <strong>{{ currentTabLabel }}</strong>
            <span>共 {{ filteredDownloads.length }} 条</span>
          </div>
          <label class="downloads-search">
            <i class="bi bi-search"></i>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索壁纸 ID、分辨率或压缩包名称"
            />
            <button v-if="searchQuery" type="button" title="清除搜索" @click="clearSearch">
              <i class="bi bi-x-lg"></i>
            </button>
          </label>
        </div>

        <div ref="feedScrollRef" class="downloads-feed-body">
          <div
            v-if="showSkeleton"
            class="downloads-skeleton"
            aria-label="加载下载列表"
            aria-busy="true"
          >
            <div v-for="index in 6" :key="`sk-${index}`" class="downloads-skeleton__row">
              <div class="downloads-skeleton__media"></div>
              <div class="downloads-skeleton__copy">
                <div class="downloads-skeleton__line is-mid"></div>
                <div class="downloads-skeleton__line is-short"></div>
                <div class="downloads-skeleton__line"></div>
              </div>
              <div class="downloads-skeleton__actions"></div>
            </div>
          </div>

          <div v-else-if="filteredDownloads.length === 0" class="downloads-empty">
            <i class="bi" :class="emptyState.icon"></i>
            <strong>{{ emptyState.title }}</strong>
            <span>{{ emptyState.text }}</span>
            <button v-if="searchQuery" type="button" @click="clearSearch">清除搜索</button>
            <button v-else-if="downloadCounts.all === 0" type="button" @click="browseWallpapers">
              去浏览壁纸
            </button>
          </div>

          <DownloadVirtualList v-else :items="filteredDownloads" :scroll-root="feedScrollRef">
            <template #default="{ item: download, index }">
              <article
                v-if="download.recordType === 'zip'"
                class="download-record download-record--zip"
                :class="getZipToneClass(download.status)"
              >
                <div class="download-record__icon" aria-hidden="true">
                  <i class="bi bi-file-earmark-zip"></i>
                </div>
                <div class="download-record__body">
                  <div class="download-record__title">
                    <strong>{{ download.filename }}.zip</strong>
                    <span class="download-record__status">
                      <i class="bi" :class="getZipStatusIcon(download.status)"></i>
                      {{ getZipStatusText(download.status) }}
                    </span>
                  </div>
                  <div class="download-record__meta">
                    <span><i class="bi bi-laptop"></i>本地打包</span>
                    <span><i class="bi bi-images"></i>{{ download.count }} 张</span>
                    <span><i class="bi bi-check2-circle"></i>成功 {{ download.successCount }}</span>
                    <span v-if="download.failCount"
                      ><i class="bi bi-exclamation-triangle"></i>失败 {{ download.failCount }}</span
                    >
                    <span
                      ><i class="bi bi-calendar3"></i
                      >{{ formatRecordDate(download.created_at) }}</span
                    >
                  </div>
                  <div v-if="download.error" class="download-record__error">
                    <i class="bi bi-exclamation-triangle"></i>{{ download.error }}
                  </div>
                </div>
                <div class="download-record__actions">
                  <button
                    v-if="ZIP_ACTIVE_STATUSES.has(download.status)"
                    type="button"
                    class="is-danger"
                    title="取消打包"
                    @click="cancelZipRecord(download)"
                  >
                    <i class="bi bi-x-lg"></i>
                  </button>
                  <button
                    v-else-if="canRetryZipRecord(download)"
                    type="button"
                    class="is-accent"
                    title="重试打包"
                    @click="retryZipRecord(download)"
                  >
                    <i class="bi bi-arrow-repeat"></i>
                  </button>
                  <button
                    type="button"
                    class="is-danger"
                    title="删除记录"
                    @click="removeZipRecord(download)"
                  >
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
                <div
                  v-if="ZIP_ACTIVE_STATUSES.has(download.status)"
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
              <DownloadItem v-else :download="download" :eager="index < 4" />
            </template>
          </DownloadVirtualList>
        </div>
      </div>
    </section>
  </main>
</template>
