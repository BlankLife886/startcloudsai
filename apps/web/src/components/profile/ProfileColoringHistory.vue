<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteServerAiJob, listServerAiJobs } from '@/services/aiWallpaper'
import { submitShareItem } from '@/services/shareGallery'
import notificationService from '@/services/notification'
import { buildApiUrl } from '@/services/apiBase'
import { writeColoringDraft } from '@/services/aiIllustrationColoringState'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'

const router = useRouter()
const HISTORY_PAGE_SIZE = 24
const loading = ref(false)
const error = ref('')
const jobs = ref([])
const currentPage = ref(1)
const pageSize = ref(HISTORY_PAGE_SIZE)
const nextCursor = ref('')
const hasNextPage = ref(false)
const pageCursors = ref([''])
const historySummary = ref({ total: 0, completed: 0, submitted: 0 })
const submittingShareId = ref('')
const deletingId = ref('')
const publishOpen = ref(false)
const publishTarget = ref(null)
const activeCategory = ref('all')
const previewIndex = ref(-1)
const previewMode = ref('result')
const previewFitMode = ref('contain')
const previewShell = ref(null)
const previewFullscreen = ref(false)

const failedStatuses = new Set(['failed', 'cancelled', 'canceled'])
let previousBodyOverflow = ''
let previewScrollLocked = false
let mqttRefreshTimer = null

const categoryDefinitions = [
  { id: 'all', label: '全部', icon: 'bi-grid' },
  { id: 'portrait', label: '人物', icon: 'bi-person' },
  { id: 'landscape', label: '风景', icon: 'bi-mountains' },
  { id: 'animal', label: '动物', icon: 'bi-hearts' },
  { id: 'anime', label: '动漫', icon: 'bi-stars' },
  { id: 'product', label: '电商/模型', icon: 'bi-box' },
  { id: 'space', label: '空间', icon: 'bi-grid-1x2' },
  { id: 'lighting', label: '光影', icon: 'bi-brightness-high' },
  { id: 'other', label: '其他', icon: 'bi-palette2' },
]

const usableJobs = computed(() =>
  jobs.value
    .filter((job) => !failedStatuses.has(String(job.status || '').toLowerCase()))
    .sort(
      (a, b) =>
        Date.parse(b.createdAt || b.updatedAt || 0) - Date.parse(a.createdAt || a.updatedAt || 0),
    ),
)

const enrichedJobs = computed(() =>
  usableJobs.value.map((job, index) => ({
    ...job,
    _index: index,
    _category: inferCategory(job),
    _sourceUrl: sourceUrl(job),
    _resultUrl: resultUrl(job),
    _styleLabel: styleLabel(job),
    _statusLabel: statusLabel(job.status),
    _statusTone: statusTone(job.status),
    _shareStatusLabel: shareStatusLabel(job),
    _shareStatusTone: shareStatusTone(job),
    _shareStatusIcon: shareStatusIcon(job),
    _dateLabel: formatDate(job.createdAt || job.updatedAt),
  })),
)

const categoryCounts = computed(() => {
  const counts = Object.fromEntries(categoryDefinitions.map((item) => [item.id, 0]))
  counts.all = historySummary.value.total
  enrichedJobs.value.forEach((job) => {
    counts[job._category] = Number(counts[job._category] || 0) + 1
  })
  return counts
})
const visibleCategoryDefinitions = computed(() =>
  categoryDefinitions.filter(
    (item) => item.id === 'all' || Number(categoryCounts.value[item.id] || 0) > 0,
  ),
)

const filteredJobs = computed(() =>
  activeCategory.value === 'all'
    ? enrichedJobs.value
    : enrichedJobs.value.filter((job) => job._category === activeCategory.value),
)
const visibleJobs = computed(() => filteredJobs.value)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(historySummary.value.total / Math.max(1, pageSize.value))),
)
const previewJob = computed(() => filteredJobs.value[previewIndex.value] || null)
const previewImageUrl = computed(() =>
  previewMode.value === 'source' ? previewJob.value?._sourceUrl : previewJob.value?._resultUrl,
)
const previewCounter = computed(() =>
  previewJob.value ? `${previewIndex.value + 1} / ${filteredJobs.value.length}` : '',
)
const completedCount = computed(() => historySummary.value.completed)
const shareSubmittedCount = computed(() => historySummary.value.submitted)

function toMediaUrl(value = '') {
  const url = String(value || '').trim()
  if (!url) return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (url.startsWith('/api/')) return buildApiUrl(url.replace(/^\/api/, '') || '/')
  if (url.startsWith('/')) return buildApiUrl(url)
  return url
}

function sourceUrl(job) {
  const input = job?.input || job?.params || {}
  return toMediaUrl(job?.sourceMediaUrl || input.sourceUrl || input.sourcePreview)
}

function resultUrl(job) {
  return toMediaUrl(job?.resultMediaUrl || job?.outputs?.[0])
}

function styleLabel(job) {
  const input = job?.input || job?.params || {}
  return String(input.title || job?.title || input.styleLabel || input.styleId || '插画染色')
}

function statusLabel(status = '') {
  const value = String(status || '').toLowerCase()
  if (value === 'completed' || value === 'done') return '已完成'
  if (value === 'running') return '生成中'
  if (value === 'queued') return '排队中'
  if (value === 'waiting_provider') return '同步结果'
  return value || '处理中'
}

function statusTone(status = '') {
  const value = String(status || '').toLowerCase()
  if (value === 'completed' || value === 'done') return 'success'
  if (value === 'running' || value === 'waiting_provider') return 'working'
  if (value === 'queued') return 'queued'
  return 'neutral'
}

function normalizedShareStatus(job) {
  const status = String(job?.shareSubmissionStatus || '')
    .trim()
    .toLowerCase()
  return status || (job?.shareSubmitted ? 'pending' : '')
}

function shareStatusLabel(job) {
  const status = normalizedShareStatus(job)
  if (status === 'approved') return '已发布'
  if (status === 'pending') return '审核中'
  if (status === 'rejected') return '未通过'
  return job?.shareSubmitted ? '已投稿' : ''
}

function shareStatusTone(job) {
  const status = normalizedShareStatus(job)
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'rejected'
  return 'pending'
}

function shareStatusIcon(job) {
  const status = normalizedShareStatus(job)
  if (status === 'approved') return 'bi-patch-check'
  if (status === 'rejected') return 'bi-x-circle'
  return 'bi-hourglass-split'
}

function shareStatusNotice(job) {
  const status = normalizedShareStatus(job)
  if (status === 'approved') return '该作品已经发布，无需重复提交'
  if (status === 'rejected') return '该作品审核未通过，请联系管理员处理后再提交'
  return '该作品已经提交，正在审核中'
}

function formatDate(value = '') {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function inferCategory(job) {
  const input = job?.input || job?.params || {}
  const text = [input.styleId, input.styleLabel, input.customPrompt, job.gatewayModelId, job.model]
    .map((item) => String(item || '').toLowerCase())
    .join(' ')
  if (/portrait|person|skin|fashion|outfit|glamour|人物|穿搭|写真/.test(text)) return 'portrait'
  if (/landscape|mountain|scenery|风景|山水|自然/.test(text)) return 'landscape'
  if (/animal|fur|pet|动物|宠物|毛色/.test(text)) return 'animal'
  if (/anime|comic|manga|动漫|二次元|赛璐璐/.test(text)) return 'anime'
  if (/product|ecommerce|model|render|模型|电商|商品|3d/.test(text)) return 'product'
  if (/interior|space|architecture|room|场景|空间|建筑|室内/.test(text)) return 'space'
  if (/lighting|neon|cinematic|光影|霓虹|未来|科技/.test(text)) return 'lighting'
  return 'other'
}

async function loadHistory({ cursor = '', page = 1, resetCursors = false } = {}) {
  loading.value = true
  error.value = ''
  try {
    const data = await listServerAiJobs(HISTORY_PAGE_SIZE, {
      kind: 'illustration-coloring',
      cursor,
      excludeFailed: true,
    })
    jobs.value = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : []
    const pagination = data?.pagination || {}
    const summary = data?.summary || {}
    currentPage.value = Math.max(1, Number(page) || 1)
    pageSize.value = Math.max(1, Number(pagination.pageSize) || HISTORY_PAGE_SIZE)
    nextCursor.value = String(pagination.nextCursor || '')
    hasNextPage.value = Boolean(pagination.hasMore && nextCursor.value)
    historySummary.value = {
      total: Math.max(0, Number(summary.total ?? pagination.total) || 0),
      completed: Math.max(0, Number(summary.completed) || 0),
      submitted: Math.max(0, Number(summary.submitted) || 0),
    }
    if (resetCursors) pageCursors.value = ['']
    pageCursors.value[currentPage.value - 1] = String(cursor || '')
  } catch (err) {
    error.value = err?.message || '染色历史读取失败'
  } finally {
    loading.value = false
  }
}

function refreshHistory() {
  return loadHistory({
    cursor: pageCursors.value[currentPage.value - 1] || '',
    page: currentPage.value,
  })
}

function goToNextPage() {
  if (loading.value || !hasNextPage.value || !nextCursor.value) return
  const page = currentPage.value + 1
  pageCursors.value[page - 1] = nextCursor.value
  void loadHistory({ cursor: nextCursor.value, page })
}

function goToPreviousPage() {
  if (loading.value || currentPage.value <= 1) return
  const page = currentPage.value - 1
  void loadHistory({ cursor: pageCursors.value[page - 1] || '', page })
}

function openPublish(job) {
  if (!job?._resultUrl) {
    notificationService.warning('请等待图片生成完成后再提交 Share')
    return
  }
  if (job.shareSubmitted) {
    notificationService.info(shareStatusNotice(job))
    return
  }
  publishTarget.value = job
  publishOpen.value = true
}

async function submitToShare(job, publishOptions = {}) {
  if (!job?._resultUrl) {
    notificationService.warning('请等待图片生成完成后再提交 Share')
    return
  }
  submittingShareId.value = job.id
  try {
    const response = await submitShareItem({
      jobId: job.id,
      title: job._styleLabel,
      styleLabel: job._styleLabel,
      category: 'illustration',
      tags: [job._styleLabel, 'AI 染色'].filter(Boolean),
      ...publishOptions,
    })
    const shareSubmissionStatus = String(response?.item?.status || 'pending').toLowerCase()
    jobs.value = jobs.value.map((item) =>
      item.id === job.id ? { ...item, shareSubmitted: true, shareSubmissionStatus } : item,
    )
    notificationService.success(
      shareSubmissionStatus === 'approved' ? '该作品已经发布' : '已提交共享审核',
    )
    historySummary.value.submitted += 1
    publishOpen.value = false
    publishTarget.value = null
  } catch (err) {
    notificationService.error(err?.message || '提交共享审核失败')
  } finally {
    submittingShareId.value = ''
  }
}

async function removeJob(job) {
  if (!job?.id || deletingId.value) return
  const confirmed = window.confirm('确定从云端存储库删除这条染色历史和图片文件吗？此操作不可恢复。')
  if (!confirmed) return
  deletingId.value = job.id
  try {
    await deleteServerAiJob(job.id)
    closePreview()
    notificationService.success('已从存储库删除图片和历史记录')
    if (jobs.value.length === 1 && currentPage.value > 1) goToPreviousPage()
    else await refreshHistory()
  } catch (err) {
    notificationService.error(err?.message || '删除失败')
  } finally {
    deletingId.value = ''
  }
}

function openPreview(job, mode = 'result') {
  const index = filteredJobs.value.findIndex((item) => item.id === job.id)
  if (index < 0) return
  previewIndex.value = index
  previewMode.value = mode === 'source' ? 'source' : 'result'
  lockPreviewScroll()
}

function setCategory(categoryId) {
  activeCategory.value = categoryId
}

function closePreview() {
  previewIndex.value = -1
  if (document.fullscreenElement === previewShell.value) {
    void document.exitFullscreen?.()
  }
  unlockPreviewScroll()
}

function stepPreview(delta) {
  if (!filteredJobs.value.length) return
  const total = filteredJobs.value.length
  previewIndex.value = (previewIndex.value + delta + total) % total
  if (previewMode.value === 'result' && !previewJob.value?._resultUrl) previewMode.value = 'source'
}

function lockPreviewScroll() {
  if (previewScrollLocked) return
  previousBodyOverflow = document.body.style.overflow || ''
  previewScrollLocked = true
  document.body.style.overflow = 'hidden'
}

function unlockPreviewScroll() {
  if (!previewScrollLocked) return
  document.body.style.overflow = previousBodyOverflow
  previousBodyOverflow = ''
  previewScrollLocked = false
}

function togglePreviewFitMode() {
  previewFitMode.value = previewFitMode.value === 'contain' ? 'cover' : 'contain'
}

async function togglePreviewFullscreen() {
  const el = previewShell.value
  if (!el) return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.()
    } else {
      await el.requestFullscreen?.()
    }
  } catch {
    previewFullscreen.value = Boolean(document.fullscreenElement)
  }
}

function editJob(job = previewJob.value) {
  if (!job) return
  const source = job._resultUrl || job._sourceUrl
  writeColoringDraft({
    styleId: 'custom',
    customPrompt: '',
    sourceRemoteUrl: source,
    sourcePreview: source,
    sourceName: `${job._styleLabel || '染色历史'} · 二次编辑`,
    resultUrl: '',
    activeHistoryId: '',
    compareMode: 'result',
    referenceImageUrls: job._sourceUrl && job._sourceUrl !== source ? [job._sourceUrl] : [],
    referenceThumbUrls: [],
  })
  router.push({ name: 'ai-illustration-coloring', query: { edit: job.id } })
}

function openColoring() {
  router.push({ name: 'ai-illustration-coloring' })
}

function onKeydown(event) {
  if (!previewJob.value) return
  if (event.key === 'Escape') closePreview()
  else if (event.key === 'ArrowLeft') stepPreview(-1)
  else if (event.key === 'ArrowRight') stepPreview(1)
  else if (event.key.toLowerCase() === 'f') void togglePreviewFullscreen()
  else if (event.key.toLowerCase() === 'v') togglePreviewFitMode()
}

function onFullscreenChange() {
  previewFullscreen.value = document.fullscreenElement === previewShell.value
}

function onMqttJobUpdated(event) {
  const payload = event?.detail?.payload || {}
  const kind = String(payload.kind || payload.job?.kind || '').toLowerCase()
  if (kind && !kind.includes('illustration') && !kind.includes('color')) return
  if (mqttRefreshTimer) window.clearTimeout(mqttRefreshTimer)
  mqttRefreshTimer = window.setTimeout(() => {
    mqttRefreshTimer = null
    void refreshHistory()
  }, 220)
}

onMounted(() => {
  void loadHistory({ resetCursors: true })
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('walleven:ai_job-updated', onMqttJobUpdated)
  window.addEventListener('walleven:share-updated', onMqttJobUpdated)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('walleven:ai_job-updated', onMqttJobUpdated)
  window.removeEventListener('walleven:share-updated', onMqttJobUpdated)
  if (mqttRefreshTimer) window.clearTimeout(mqttRefreshTimer)
  unlockPreviewScroll()
})
</script>

<template>
  <section class="profile-coloring-history">
    <header class="profile-coloring-history__head">
      <div class="profile-coloring-history__summary" aria-label="染色历史统计">
        <span
          ><i class="bi bi-images"></i
          ><small
            >全部作品 <strong>({{ historySummary.total }})</strong></small
          ></span
        >
        <span
          ><i class="bi bi-check2-circle"></i
          ><small
            >生成完成 <strong>({{ completedCount }})</strong></small
          ></span
        >
        <span
          ><i class="bi bi-send-check"></i
          ><small
            >已投稿 <strong>({{ shareSubmittedCount }})</strong></small
          ></span
        >
      </div>
      <div class="profile-coloring-history__actions">
        <button type="button" class="ghost" :disabled="loading" @click="refreshHistory">
          <i class="bi bi-arrow-clockwise" :class="{ spin: loading }"></i>
          刷新
        </button>
        <button type="button" class="primary" @click="openColoring">
          <i class="bi bi-plus-lg"></i>
          新建染色
        </button>
      </div>
    </header>

    <div class="profile-coloring-history__content">
      <div class="profile-coloring-history__filters" aria-label="染色历史分类">
        <button
          v-for="item in visibleCategoryDefinitions"
          :key="item.id"
          type="button"
          :class="{ active: activeCategory === item.id }"
          @click="setCategory(item.id)"
        >
          <i class="bi" :class="item.icon"></i>
          <span>{{ item.label }}</span>
          <em>{{ categoryCounts[item.id] || 0 }}</em>
        </button>
      </div>

      <p v-if="error" class="profile-coloring-history__error">{{ error }}</p>
      <div
        v-if="loading && !visibleJobs.length"
        class="profile-coloring-history__grid"
        aria-label="正在加载染色历史"
      >
        <article v-for="index in 8" :key="index" class="profile-coloring-history__card is-skeleton">
          <div></div>
          <footer><span></span><small></small></footer>
        </article>
      </div>
      <div v-else-if="!visibleJobs.length" class="profile-coloring-history__empty">
        <span><i class="bi bi-brush"></i></span><strong>这里还没有染色作品</strong
        ><small>上传一张线稿，生成结果会自动保存在这里。</small
        ><button type="button" class="primary" @click="openColoring">开始第一次染色</button>
      </div>
      <div v-else class="profile-coloring-history__grid">
        <article
          v-for="(job, jobIndex) in visibleJobs"
          :key="job.id"
          class="profile-coloring-history__card"
        >
          <div class="profile-coloring-history__pair">
            <button
              type="button"
              class="profile-coloring-history__result"
              :disabled="!job._resultUrl && !job._sourceUrl"
              @click="openPreview(job, job._resultUrl ? 'result' : 'source')"
            >
              <AuthenticatedImage
                v-if="job._resultUrl || job._sourceUrl"
                :src="job._resultUrl || job._sourceUrl"
                :alt="job._resultUrl ? '生成图' : '原线稿'"
                loading="lazy"
                decoding="async"
                :fetchpriority="jobIndex < 4 ? 'high' : 'auto'"
                root-margin="420px 0px"
                :max-dimension="1024"
              />
              <span v-else><i class="bi bi-hourglass-split"></i>{{ job._statusLabel }}</span>
              <em>{{ job._resultUrl ? '生成图' : '原线稿' }}</em>
            </button>
            <button
              v-if="job._sourceUrl && job._resultUrl"
              type="button"
              class="profile-coloring-history__source"
              title="查看原线稿"
              @click="openPreview(job, 'source')"
            >
              <AuthenticatedImage
                :src="job._sourceUrl"
                alt="原线稿"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
                root-margin="120px 0px"
                :max-dimension="320"
              />
              <em>原线稿</em>
            </button>
            <span class="profile-coloring-history__status" :class="`is-${job._statusTone}`"
              ><i
                class="bi"
                :class="job._statusTone === 'success' ? 'bi-check2' : 'bi-arrow-repeat'"
              ></i
              >{{ job._statusLabel }}</span
            >
            <span
              v-if="job.shareSubmitted"
              class="profile-coloring-history__shared"
              :class="`is-${job._shareStatusTone}`"
            >
              <i class="bi" :class="job._shareStatusIcon"></i>{{ job._shareStatusLabel }}
            </span>
          </div>

          <header class="profile-coloring-history__meta">
            <div>
              <strong>{{ job._styleLabel }}</strong
              ><small>{{ job._dateLabel }}</small>
            </div>
            <span
              ><i
                class="bi"
                :class="
                  categoryDefinitions.find((item) => item.id === job._category)?.icon ||
                  'bi-palette2'
                "
              ></i
              >{{
                categoryDefinitions.find((item) => item.id === job._category)?.label || '其他'
              }}</span
            >
          </header>

          <div class="profile-coloring-history__card-actions">
            <button type="button" class="primary" @click="editJob(job)">
              <i class="bi bi-pencil-square"></i>
              继续编辑
            </button>
            <button
              type="button"
              :disabled="!job._resultUrl || submittingShareId === job.id || job.shareSubmitted"
              @click="openPublish(job)"
            >
              <i
                class="bi"
                :class="submittingShareId === job.id ? 'bi-arrow-repeat spin' : 'bi-send-check'"
              ></i>
              {{ job.shareSubmitted ? job._shareStatusLabel : '发布' }}
            </button>
            <button
              type="button"
              class="danger"
              title="删除云端记录"
              :disabled="deletingId === job.id"
              @click="removeJob(job)"
            >
              <i
                class="bi"
                :class="deletingId === job.id ? 'bi-arrow-repeat spin' : 'bi-trash'"
              ></i>
            </button>
          </div>
        </article>
      </div>

      <nav
        v-if="historySummary.total > pageSize"
        class="profile-coloring-history__pager"
        aria-label="染色历史分页"
      >
        <button type="button" :disabled="loading || currentPage <= 1" @click="goToPreviousPage">
          <i class="bi bi-chevron-left"></i>
          上一页
        </button>
        <span>第 {{ currentPage }} / {{ totalPages }} 页 · 共 {{ historySummary.total }} 条</span>
        <button type="button" :disabled="loading || !hasNextPage" @click="goToNextPage">
          下一页
          <i class="bi bi-chevron-right"></i>
        </button>
      </nav>
    </div>

    <Teleport to="body">
      <div
        v-if="previewJob"
        ref="previewShell"
        class="profile-coloring-preview"
        role="dialog"
        aria-modal="true"
        aria-label="染色历史全屏预览"
        @click.self="closePreview"
      >
        <div class="profile-coloring-preview__surface">
          <div class="profile-coloring-preview__toolbar">
            <button
              type="button"
              title="查看原线稿"
              :class="{ active: previewMode === 'source' }"
              :disabled="!previewJob._sourceUrl"
              @click="previewMode = 'source'"
            >
              <i class="bi bi-vector-pen"></i>
            </button>
            <button
              type="button"
              title="查看生成图"
              :class="{ active: previewMode === 'result' }"
              :disabled="!previewJob._resultUrl"
              @click="previewMode = 'result'"
            >
              <i class="bi bi-image"></i>
            </button>
            <button
              type="button"
              :class="{ active: previewFitMode === 'cover' }"
              :title="previewFitMode === 'cover' ? '切换为完整显示' : '切换为铺满显示'"
              @click="togglePreviewFitMode"
            >
              <i
                class="bi"
                :class="
                  previewFitMode === 'cover' ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'
                "
              ></i>
            </button>
            <button type="button" @click="editJob()">
              <i class="bi bi-pencil-square"></i>
            </button>
            <button
              type="button"
              :disabled="
                !previewJob._resultUrl ||
                submittingShareId === previewJob.id ||
                previewJob.shareSubmitted
              "
              @click="openPublish(previewJob)"
              :title="
                previewJob.shareSubmitted ? previewJob._shareStatusLabel : '提交到 Share 审核'
              "
            >
              <i
                class="bi"
                :class="
                  submittingShareId === previewJob.id ? 'bi-arrow-repeat spin' : 'bi-send-check'
                "
              ></i>
            </button>
            <button type="button" class="danger" @click="removeJob(previewJob)">
              <i class="bi bi-trash"></i>
            </button>
            <button
              type="button"
              :class="{ active: previewFullscreen }"
              title="切换全屏"
              @click="togglePreviewFullscreen"
            >
              <i class="bi" :class="previewFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'"></i>
            </button>
            <button type="button" title="关闭预览" @click="closePreview">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>

          <button
            type="button"
            class="profile-coloring-preview__nav prev"
            title="上一张"
            @click="stepPreview(-1)"
          >
            <i class="bi bi-chevron-left"></i>
          </button>

          <div class="profile-coloring-preview__stage">
            <AuthenticatedImage
              v-if="previewImageUrl"
              :src="previewImageUrl"
              :class="`fit-${previewFitMode}`"
              alt="染色大图"
            />
            <span v-else>图片不可用</span>
          </div>

          <button
            type="button"
            class="profile-coloring-preview__nav next"
            title="下一张"
            @click="stepPreview(1)"
          >
            <i class="bi bi-chevron-right"></i>
          </button>

          <div class="profile-coloring-preview__info">
            <strong>{{ previewJob._styleLabel }}</strong>
            <span>{{ previewCounter }} · {{ previewJob._dateLabel }}</span>
            <em>{{ previewMode === 'source' ? '原线稿' : '生成图' }}</em>
          </div>
        </div>
      </div>
    </Teleport>
    <SharePublishDialog
      :open="publishOpen"
      :title="publishTarget?._styleLabel || ''"
      :style-label="publishTarget?._styleLabel || ''"
      :submitting="Boolean(publishTarget && submittingShareId === publishTarget.id)"
      @close="publishOpen = false"
      @submit="submitToShare(publishTarget, $event)"
    />
  </section>
</template>

<style scoped>
.profile-coloring-history {
  display: grid;
  gap: 18px;
}

.profile-coloring-history__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding-bottom: 2px;
}

.profile-coloring-history__title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.profile-coloring-history__mark {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border: 1px solid rgba(106, 79, 224, 0.26);
  border-radius: 0;
  display: grid;
  place-items: center;
  color: var(--pf-accent, #6a4fe0);
  background: rgba(106, 79, 224, 0.1);
}

.profile-coloring-history__head h3 {
  margin: 0 0 4px;
  font-size: 1.08rem;
}

.profile-coloring-history__head p,
.profile-coloring-history__meta small {
  margin: 0;
  color: var(--pf-muted, #79809a);
  font-size: 0.86rem;
}

.profile-coloring-history__summary {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 8px;
}

.profile-coloring-history__summary span {
  min-width: 70px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
  padding: 7px 10px;
  display: grid;
  gap: 2px;
  color: var(--pf-muted, #79809a);
  background: var(--pf-card-soft, rgba(106, 79, 224, 0.06));
  font-size: 0.68rem;
  text-align: center;
}

.profile-coloring-history__summary strong {
  color: var(--pf-accent, #6a4fe0);
  font-size: 0.96rem;
  line-height: 1;
}

.profile-coloring-history__actions,
.profile-coloring-history__card-actions,
.profile-coloring-history__filters {
  display: flex;
  gap: 8px;
}

.profile-coloring-history__filters {
  overflow-x: auto;
  padding-bottom: 2px;
}

.profile-coloring-history button,
.profile-coloring-preview button {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0;
  padding: 7px 12px;
  color: inherit;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;
}

.profile-coloring-history button:hover:not(:disabled),
.profile-coloring-preview button:hover:not(:disabled) {
  border-color: rgba(106, 79, 224, 0.25);
  background: rgba(255, 255, 255, 0.08);
}

.profile-coloring-history button:disabled,
.profile-coloring-preview button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.profile-coloring-history button.primary,
.profile-coloring-history__filters button.active,
.profile-coloring-preview button.active {
  border-color: rgba(129, 230, 217, 0.28);
  background: rgba(129, 230, 217, 0.14);
}

.profile-coloring-history button.danger,
.profile-coloring-preview button.danger {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.1);
}

.profile-coloring-history__filters button {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 0;
}

.profile-coloring-history__filters em {
  font-style: normal;
  opacity: 0.68;
}

.profile-coloring-history__error {
  margin: 0;
  color: #fca5a5;
}

.profile-coloring-history__empty {
  border: 1px dashed rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  padding: 28px;
  color: rgba(255, 255, 255, 0.62);
  text-align: center;
}

.profile-coloring-history__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}

.profile-coloring-history__card {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 14, 12, 0.62);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.2);
}

.profile-coloring-history__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.profile-coloring-history__pair button {
  position: relative;
  min-width: 0;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border-radius: 0;
  padding: 0;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%), rgba(0, 0, 0, 0.2);
  background-size: 14px 14px;
}

.profile-coloring-history__pair img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: rgba(0, 0, 0, 0.18);
}

.profile-coloring-history__pair span {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.78rem;
}

.profile-coloring-history__pair em {
  position: absolute;
  left: 8px;
  bottom: 8px;
  border-radius: 0;
  padding: 4px 9px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(0, 0, 0, 0.52);
  font-size: 0.68rem;
  font-style: normal;
}

.profile-coloring-history__card-actions button {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  font-size: 0.74rem;
}

.profile-coloring-history__card-actions button.danger {
  flex: 0 0 auto;
}

.profile-coloring-history__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.profile-coloring-history__meta strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-coloring-history__meta small {
  max-width: 240px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-coloring-history__meta span {
  flex: 0 0 auto;
  border-radius: 0;
  padding: 4px 8px;
  color: rgba(129, 230, 217, 0.9);
  background: rgba(129, 230, 217, 0.1);
  font-size: 0.72rem;
}

.profile-coloring-history__tags {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.profile-coloring-history__tags span {
  border-radius: 0;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: rgba(255, 255, 255, 0.66);
  background: rgba(255, 255, 255, 0.055);
  font-size: 0.7rem;
}

.profile-coloring-history__pager {
  justify-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid rgba(187, 231, 216, 0.1);
  border-radius: 0;
  color: rgba(226, 241, 235, 0.62);
  background: rgba(9, 16, 14, 0.72);
}

.profile-coloring-history__pager button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.profile-coloring-history__pager span {
  min-width: 180px;
  text-align: center;
  font-size: 0.74rem;
}

.profile-coloring-preview {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.95);
  user-select: none;
}

.profile-coloring-preview__surface {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 0%, rgba(106, 79, 224, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(4, 8, 6, 0.96), rgba(0, 0, 0, 0.98));
}

.profile-coloring-preview__toolbar {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 20;
  display: flex;
  gap: 10px;
}

.profile-coloring-preview__toolbar button,
.profile-coloring-preview__nav {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  box-shadow: none;
  backdrop-filter: blur(4px);
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;
}

.profile-coloring-preview__toolbar button:hover:not(:disabled),
.profile-coloring-preview__nav:hover:not(:disabled) {
  background: rgba(25, 25, 25, 0.82);
  transform: scale(1.06);
}

.profile-coloring-preview__toolbar button:active:not(:disabled),
.profile-coloring-preview__nav:active:not(:disabled) {
  transform: scale(0.96);
}

.profile-coloring-preview__toolbar button.active {
  background: rgba(76, 175, 80, 0.78);
  box-shadow: 0 0 10px rgba(76, 175, 80, 0.35);
}

.profile-coloring-preview__toolbar button.danger {
  color: #fecaca;
  background: rgba(127, 29, 29, 0.6);
}

.profile-coloring-preview__stage {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 72px;
  box-sizing: border-box;
}

.profile-coloring-preview__stage img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: transparent;
  transform: translateZ(0);
}

.profile-coloring-preview__stage img.fit-cover {
  object-fit: cover;
}

.profile-coloring-preview__stage span {
  color: rgba(255, 255, 255, 0.62);
}

.profile-coloring-preview__nav {
  position: absolute;
  top: 50%;
  z-index: 18;
  transform: translateY(-50%);
}

.profile-coloring-preview__nav:hover:not(:disabled),
.profile-coloring-preview__nav:active:not(:disabled) {
  transform: translateY(-50%);
}

.profile-coloring-preview__nav.prev {
  left: 16px;
}

.profile-coloring-preview__nav.next {
  right: 16px;
}

.profile-coloring-preview__info {
  position: absolute;
  left: 50%;
  bottom: 20px;
  z-index: 20;
  max-width: min(720px, calc(100vw - 32px));
  min-height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 0;
  padding: 7px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.62);
  background: rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(10px);
  transform: translateX(-50%);
}

.profile-coloring-preview__info strong {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.92);
  font-size: 0.86rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-coloring-preview__info span,
.profile-coloring-preview__info em {
  flex: 0 0 auto;
  font-size: 0.74rem;
  font-style: normal;
}

.profile-coloring-preview__info em {
  border-radius: 0;
  padding: 3px 8px;
  color: var(--pf-accent, #6a4fe0);
  background: rgba(76, 175, 80, 0.18);
}

@media (max-width: 980px) {
  .profile-coloring-history__head {
    grid-template-columns: 1fr;
  }

  .profile-coloring-history__summary {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .profile-coloring-history__head {
    align-items: stretch;
    flex-direction: column;
  }

  .profile-coloring-history__actions {
    width: 100%;
  }

  .profile-coloring-history__actions button {
    flex: 1;
  }

  .profile-coloring-history__grid {
    grid-template-columns: 1fr;
  }

  .profile-coloring-history__pair {
    grid-template-columns: 1fr;
  }

  .profile-coloring-history__pair button {
    aspect-ratio: 16 / 11;
  }

  .profile-coloring-preview__toolbar {
    top: 12px;
    right: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: calc(100vw - 24px);
  }

  .profile-coloring-preview__stage {
    padding: 62px 52px 74px;
  }

  .profile-coloring-preview__info {
    bottom: 12px;
    width: calc(100vw - 24px);
    justify-content: center;
    border-radius: 16px;
  }

  .profile-coloring-preview__info strong {
    max-width: 38vw;
  }
}

/* 2026 gallery refresh: image-first cards and a compact, non-repeating toolbar. */
.profile-coloring-history {
  gap: 14px;
  --history-accent: #83eadc;
  --history-accent-strong: #a7ff9a;
  --history-panel: rgba(15, 24, 21, 0.88);
  --history-line: rgba(187, 231, 216, 0.12);
}

.profile-coloring-history__head {
  position: sticky;
  z-index: 12;
  top: 0;
  overflow: clip;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--history-line);
  border-radius: 22px;
  background: rgba(9, 16, 14, 0.86);
  background-clip: padding-box;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(18px) saturate(1.2);
}

.profile-coloring-history__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(116px, max-content));
  align-items: center;
  gap: 8px;
}

.profile-coloring-history__summary span {
  min-width: 0;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid rgba(226, 241, 235, 0.08);
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(226, 241, 235, 0.66);
  background: rgba(255, 255, 255, 0.025);
  white-space: nowrap;
}

.profile-coloring-history__summary i {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: grid;
  place-items: center;
  color: var(--history-accent);
  font-size: 0.92rem;
}
.profile-coloring-history__summary small {
  overflow: hidden;
  color: inherit;
  font-size: 0.72rem;
  font-weight: 560;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-coloring-history__summary small strong {
  color: #eefbf6;
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 720;
}

.profile-coloring-history__actions {
  margin-left: auto;
}
.profile-coloring-history__actions button {
  min-height: 36px;
  padding: 0 13px;
  border-radius: 0;
  font-size: 0.76rem;
  font-weight: 650;
}
.profile-coloring-history__actions button.ghost {
  border-color: transparent;
  color: rgba(232, 244, 239, 0.68);
  background: transparent;
}
.profile-coloring-history__actions button.primary,
.profile-coloring-history__card-actions button.primary,
.profile-coloring-history__empty button.primary {
  border-color: rgba(131, 234, 220, 0.22);
  color: #06211d;
  background: linear-gradient(135deg, #a7ff9a, #73dfd2);
  box-shadow: 0 8px 20px rgba(94, 218, 200, 0.14);
}

.profile-coloring-history__actions button.primary {
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.profile-coloring-history__actions button.primary:hover:not(:disabled) {
  border-color: rgba(176, 255, 164, 0.48);
  color: #041c18;
  background: linear-gradient(135deg, #b6ffa9, #82eadc);
  box-shadow: 0 10px 24px rgba(94, 218, 200, 0.22);
  transform: translateY(-1px);
}

.profile-coloring-history__actions button.primary:active:not(:disabled) {
  box-shadow: 0 5px 14px rgba(94, 218, 200, 0.16);
  transform: translateY(0);
}

.profile-coloring-history__actions button.primary:focus-visible {
  outline: 2px solid rgba(167, 255, 154, 0.72);
  outline-offset: 2px;
}

.profile-coloring-history__filters {
  gap: 7px;
  padding: 0 2px 2px;
}

.profile-coloring-history__filters button {
  min-height: 34px;
  padding: 0 12px;
  border-color: rgba(226, 241, 235, 0.09);
  color: rgba(232, 244, 239, 0.58);
  background: rgba(255, 255, 255, 0.025);
  font-size: 0.75rem;
}

.profile-coloring-history__filters button.active {
  border-color: rgba(131, 234, 220, 0.25);
  color: #dffffa;
  background: rgba(99, 208, 193, 0.12);
  box-shadow: inset 0 0 0 1px rgba(131, 234, 220, 0.04);
}

.profile-coloring-history__filters em {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 0;
  color: rgba(238, 251, 246, 0.72);
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.62rem;
  text-align: center;
}

.profile-coloring-history__grid {
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 16px;
}

.profile-coloring-history__card {
  position: relative;
  gap: 0;
  overflow: hidden;
  padding: 0;
  border-color: var(--history-line);
  border-radius: 18px;
  background:
    radial-gradient(circle at 100% 100%, rgba(78, 208, 190, 0.07), transparent 34%),
    linear-gradient(180deg, rgba(21, 31, 28, 0.98), rgba(12, 20, 18, 0.98));
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.2);
  transition:
    transform 0.22s ease,
    border-color 0.22s ease,
    box-shadow 0.22s ease;
  contain: layout paint style;
}

.profile-coloring-history__card:hover {
  border-color: rgba(131, 234, 220, 0.24);
  box-shadow: 0 20px 42px rgba(0, 0, 0, 0.3);
  transform: translateY(-3px);
}

.profile-coloring-history__pair {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9.6;
  overflow: hidden;
  background:
    radial-gradient(circle at 20% 10%, rgba(131, 234, 220, 0.08), transparent 38%), #0d1714;
}

.profile-coloring-history__pair button.profile-coloring-history__result {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.profile-coloring-history__pair button.profile-coloring-history__source {
  position: absolute;
  z-index: 5;
  left: 12px;
  bottom: 12px;
  width: 88px;
  height: 64px;
  aspect-ratio: auto;
  border: 2px solid rgba(255, 255, 255, 0.76);
  border-radius: 0;
  background: #0a100e;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35);
}

.profile-coloring-history__pair img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-color: #0d1714;
  transition:
    transform 0.45s cubic-bezier(0.2, 0.7, 0.2, 1),
    filter 0.25s ease;
}

.profile-coloring-history__pair img.is-failed {
  background-color: #111d19;
}

.profile-coloring-history__card:hover .profile-coloring-history__result img {
  transform: scale(1.035);
}
.profile-coloring-history__source:hover img {
  filter: brightness(1.08);
}

.profile-coloring-history__pair
  span:not(.profile-coloring-history__status):not(.profile-coloring-history__shared) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.profile-coloring-history__pair em {
  left: auto;
  right: 10px;
  bottom: 9px;
  padding: 3px 7px;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(3, 7, 6, 0.55);
  font-size: 0.6rem;
  backdrop-filter: blur(8px);
}

.profile-coloring-history__source em {
  right: auto;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  white-space: nowrap;
}

.profile-coloring-history__status,
.profile-coloring-history__shared {
  position: absolute;
  z-index: 6;
  top: 12px;
  height: 28px;
  padding: 0 9px 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.84);
  background: rgba(5, 11, 9, 0.66);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18);
  font-size: 0.66rem;
  font-weight: 680;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.profile-coloring-history__status i,
.profile-coloring-history__shared i {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 0.68rem;
  line-height: 1;
}

.profile-coloring-history__status i::before,
.profile-coloring-history__shared i::before {
  display: block;
  line-height: 1;
  vertical-align: 0;
}

.profile-coloring-history__pair > .profile-coloring-history__status,
.profile-coloring-history__pair > .profile-coloring-history__shared {
  width: auto;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.profile-coloring-history__status {
  right: 12px;
}
.profile-coloring-history__status.is-success {
  border-color: rgba(115, 232, 204, 0.2);
  color: #b8f7e8;
  background: rgba(7, 33, 27, 0.78);
}
.profile-coloring-history__status.is-success i {
  color: #c8fff2;
  background: rgba(98, 218, 188, 0.16);
}
.profile-coloring-history__status.is-working i {
  animation: spin 1s linear infinite;
}
.profile-coloring-history__status.is-working {
  color: #fde68a;
}
.profile-coloring-history__status.is-queued {
  color: #bfdbfe;
}
.profile-coloring-history__shared {
  left: 12px;
  border-color: rgba(167, 255, 154, 0.22);
  color: #c3ffb9;
}
.profile-coloring-history__shared.is-pending {
  border-color: rgba(253, 230, 138, 0.22);
  color: #fde68a;
}
.profile-coloring-history__shared.is-rejected {
  border-color: rgba(252, 165, 165, 0.24);
  color: #fecaca;
}

.profile-coloring-history__meta {
  padding: 13px 14px 0;
  align-items: flex-start;
}

.profile-coloring-history__meta > div {
  min-width: 0;
}
.profile-coloring-history__meta strong {
  color: #eff8f4;
  font-size: 0.9rem;
}
.profile-coloring-history__meta small {
  margin-top: 3px;
  color: rgba(226, 241, 235, 0.42);
  font-size: 0.68rem;
}
.profile-coloring-history__meta > span {
  padding: 4px 7px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgba(221, 241, 234, 0.58);
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.63rem;
}

.profile-coloring-history__card-actions {
  gap: 7px;
  padding: 12px 14px 14px;
}

.profile-coloring-history__card-actions button {
  min-height: 34px;
  padding: 0 10px;
  border-radius: 9px;
  color: rgba(236, 247, 243, 0.72);
  background: var(--pf-card-soft, rgba(106, 79, 224, 0.06));
  font-size: 0.7rem;
}

.profile-coloring-history__card-actions button.primary {
  flex: 1.2;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.profile-coloring-history__card-actions button.primary:hover:not(:disabled) {
  border-color: rgba(176, 255, 164, 0.48);
  color: #041c18;
  background: linear-gradient(135deg, #b6ffa9, #82eadc);
  box-shadow: 0 9px 22px rgba(94, 218, 200, 0.2);
  transform: translateY(-1px);
}

.profile-coloring-history__card-actions button.primary:active:not(:disabled) {
  box-shadow: 0 4px 12px rgba(94, 218, 200, 0.14);
  transform: translateY(0);
}

.profile-coloring-history__card-actions button.primary:focus-visible {
  outline: 2px solid rgba(167, 255, 154, 0.68);
  outline-offset: 2px;
}

.profile-coloring-history__card-actions button.danger {
  width: 34px;
  flex: 0 0 34px;
  padding: 0;
  border-color: transparent;
  color: rgba(254, 202, 202, 0.64);
  background: transparent;
}

.profile-coloring-history__empty {
  min-height: 360px;
  padding: 40px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  border-color: rgba(131, 234, 220, 0.14);
  background: rgba(255, 255, 255, 0.018);
}

.profile-coloring-history__empty > span {
  width: 52px;
  height: 52px;
  margin-bottom: 6px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  color: var(--history-accent);
  background: rgba(131, 234, 220, 0.09);
  font-size: 1.25rem;
}
.profile-coloring-history__empty strong {
  color: #edf8f4;
}
.profile-coloring-history__empty small {
  color: rgba(226, 241, 235, 0.48);
}
.profile-coloring-history__empty button {
  margin-top: 12px;
}

.profile-coloring-history__card.is-skeleton {
  pointer-events: none;
}
.profile-coloring-history__card.is-skeleton > div {
  aspect-ratio: 16 / 9.6;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0.035) 24%,
    rgba(255, 255, 255, 0.075) 40%,
    rgba(255, 255, 255, 0.035) 56%
  );
  background-size: 220% 100%;
  animation: history-skeleton 1.25s linear infinite;
}
.profile-coloring-history__card.is-skeleton footer {
  padding: 14px;
  display: grid;
  gap: 8px;
}
.profile-coloring-history__card.is-skeleton footer span,
.profile-coloring-history__card.is-skeleton footer small {
  height: 10px;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.055);
}
.profile-coloring-history__card.is-skeleton footer small {
  width: 62%;
}
.profile-coloring-history__pager {
  max-width: 100%;
}

@keyframes history-skeleton {
  to {
    background-position: -220% 0;
  }
}

@media (max-width: 760px) {
  .profile-coloring-history__head {
    position: static;
    align-items: stretch;
    flex-direction: column;
  }
  .profile-coloring-history__summary {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .profile-coloring-history__summary span {
    padding-inline: 10px;
  }
  .profile-coloring-history__actions {
    width: 100%;
    margin-left: 0;
  }
  .profile-coloring-history__actions button {
    flex: 1;
  }
  .profile-coloring-history__grid {
    grid-template-columns: 1fr;
  }
  .profile-coloring-history__pair {
    display: block;
    grid-template-columns: none;
  }
  .profile-coloring-history__pair button.profile-coloring-history__result {
    aspect-ratio: auto;
  }
  .profile-coloring-history__pager {
    width: 100%;
    flex-wrap: wrap;
  }
  .profile-coloring-history__pager span {
    order: -1;
    width: 100%;
  }
}

@media (max-width: 440px) {
  .profile-coloring-history__summary span {
    min-height: 36px;
    padding-inline: 6px;
    justify-content: center;
    gap: 5px;
  }
  .profile-coloring-history__summary i {
    width: 20px;
    height: 20px;
    flex-basis: 20px;
  }
  .profile-coloring-history__summary small {
    font-size: 0.62rem;
  }
  .profile-coloring-history__pair {
    aspect-ratio: 4 / 3;
  }
}
</style>
