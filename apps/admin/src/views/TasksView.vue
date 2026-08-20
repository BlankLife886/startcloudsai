<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Document, Picture, Refresh, Search, WarningFilled } from '@element-plus/icons-vue'
import AdminDialog from '@/components/AdminDialog.vue'
import TaskRuntimeSettingsDialog from '@/components/settings/TaskRuntimeSettingsDialog.vue'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import {
  adminFileUrl,
  formatPoints,
  formatShortTime,
  formatTime,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  taskTypeLabel,
} from '@/utils'

interface AdminTask {
  id: string
  type: string
  status: string
  prompt: string
  params: Record<string, unknown> | null
  count: number
  inputKeys?: string[]
  outputKeys?: string[]
  outputUrls?: string[]
  displayUrls?: string[]
  originalUrls?: string[]
  costCents: number
  errorCode: string | null
  errorMessage: string | null
  userId?: string
  userEmail?: string
  user?: { id: string; email: string }
  source?: 'task' | 'assistant' | 'infinite_canvas'
  serviceProvider?: 'c2a' | 'sub2api' | 'crun' | 'local'
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  deletedAt?: string | null
  deletionActor?: 'user' | 'admin' | 'system' | null
  deletedOutputCount?: number
}

interface TaskSummary {
  total: number
  queued: number
  running: number
  succeeded: number
  failed: number
  canceled: number
  today: number
}

interface TaskPage extends Page<AdminTask> {
  summary?: TaskSummary
}

const filters = reactive({ type: '', status: '', user: '', errorCode: '' })
const summary = ref<TaskSummary>({
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  today: 0,
})
const lastUpdatedAt = ref<Date | null>(null)
const autoRefresh = ref(true)

const {
  items,
  loading,
  error,
  total,
  page,
  hasPrev,
  hasNext,
  reset,
  next,
  prev,
  refresh,
  retry,
} = usePagedList<AdminTask>(
  async (cursor) => {
    const page = await request<TaskPage>('/api/v1/admin/tasks', {
      query: {
        type: filters.type,
        status: filters.status,
        user: filters.user,
        errorCode: filters.errorCode,
        limit: 20,
        cursor,
      },
    })
    if (page.summary) summary.value = page.summary
    lastUpdatedAt.value = new Date()
    return page
  },
  () => ({
    type: filters.type,
    status: filters.status,
    user: filters.user,
    errorCode: filters.errorCode,
  }),
)

const statusTabs = computed(() => [
  {
    value: '',
    label: '全部',
    count: summary.value.total,
    tone: 'all' as const,
  },
  {
    value: 'queued',
    label: '等待中',
    count: summary.value.queued,
    tone: 'queued' as const,
  },
  {
    value: 'running',
    label: '运行中',
    count: summary.value.running,
    tone: 'running' as const,
  },
  {
    value: 'succeeded',
    label: '已成功',
    count: summary.value.succeeded,
    tone: 'succeeded' as const,
  },
  {
    value: 'failed',
    label: '已失败',
    count: summary.value.failed,
    tone: 'failed' as const,
  },
  {
    value: 'canceled',
    label: '已取消',
    count: summary.value.canceled,
    tone: 'canceled' as const,
  },
])

const activeFilterCount = computed(
  () =>
    [filters.type, filters.user.trim(), filters.errorCode.trim()].filter(Boolean)
      .length,
)

const lastUpdatedLabel = computed(() =>
  lastUpdatedAt.value
    ? lastUpdatedAt.value.toLocaleTimeString('zh-CN', { hour12: false })
    : '尚未刷新',
)

let refreshTimer: number | null = null

function stopAutoRefresh() {
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
  refreshTimer = null
}

function startAutoRefresh() {
  stopAutoRefresh()
  if (!autoRefresh.value) return
  refreshTimer = window.setInterval(() => {
    if (!loading.value && document.visibilityState === 'visible') void refresh()
  }, 15_000)
}

watch(autoRefresh, startAutoRefresh)

onMounted(() => {
  void reset()
  startAutoRefresh()
})

onBeforeUnmount(stopAutoRefresh)

function setStatusTab(status: string) {
  if (filters.status === status) return
  filters.status = status
  void reset()
}

function clearFilters() {
  filters.type = ''
  filters.status = ''
  filters.user = ''
  filters.errorCode = ''
  void reset()
}

function refreshNow() {
  if (!loading.value) void refresh()
}

function taskPrompt(task: AdminTask) {
  return (
    task.prompt?.trim() ||
    (task.source === 'assistant'
      ? 'AI 助手任务'
      : task.source === 'infinite_canvas'
        ? '无限画布任务'
        : '未填写提示词')
  )
}

/** 列表展示：任务内容最多 4 字 */
function taskPromptBrief(task: AdminTask) {
  const text = taskPrompt(task)
  return text.length > 4 ? `${text.slice(0, 4)}…` : text
}

function taskMediaUrls(task: AdminTask) {
  const outputs = (task.outputUrls ?? []).filter(Boolean)
  if (outputs.length) return outputs
  return (task.inputKeys ?? []).filter(Boolean).map(adminFileUrl)
}

/** 点开大图用展示图（服务端压缩大图），没有再退回原图/小图 */
function taskPreviewUrls(task: AdminTask) {
  const display = (task.displayUrls ?? []).filter(Boolean)
  if (display.length) return display
  const originals = (task.originalUrls ?? []).filter(Boolean)
  if (originals.length) return originals
  return taskMediaUrls(task)
}

function taskDuration(task: AdminTask) {
  if (!task.startedAt) return '未开始'
  const start = new Date(task.startedAt).getTime()
  const end = task.finishedAt ? new Date(task.finishedAt).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '-'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

function taskRowClass({ row }: { row: AdminTask }) {
  return `task-row is-${row.status}`
}

async function copyTaskId(id: string) {
  await navigator.clipboard.writeText(id)
  ElMessage.success('任务 ID 已复制')
}

async function copyTaskPrompt(task: AdminTask) {
  await navigator.clipboard.writeText(taskPrompt(task))
  ElMessage.success('任务内容已复制')
}

function taskUser(task: AdminTask): string {
  return task.userEmail ?? task.user?.email ?? task.userId ?? '-'
}

function taskSourceLabel(task: AdminTask) {
  const source = String(task.params?._source || task.params?.source || '')
  const kind = String(task.params?._kind || task.params?.kind || '')
  if (
    task.source === 'infinite_canvas' ||
    source === 'react_canvas' ||
    kind.startsWith('canvas-')
  ) return '无限画布'
  return task.source === 'assistant' ? 'AI 助手' : '图片任务'
}

function taskOperationName(task: AdminTask) {
  if (
    task.source === 'infinite_canvas' ||
    String(task.params?._source || '') === 'react_canvas' ||
    String(task.params?._kind || '').startsWith('canvas-')
  ) return '无限画布任务'
  if (task.source === 'assistant') return 'AI 助手任务'
  return '任务'
}

const serviceProviderMeta = {
  c2a: { name: 'C2A', detail: 'gpt.xkyh.cc.cd/v1' },
  sub2api: { name: 'Sub2API', detail: 'OpenAI 兼容服务' },
  crun: { name: 'CRUN', detail: 'api.crun.ai' },
  local: { name: '本地处理', detail: '浏览器 Canvas' },
} as const

function taskServiceProvider(task: AdminTask): keyof typeof serviceProviderMeta {
  if (task.serviceProvider && task.serviceProvider in serviceProviderMeta) {
    return task.serviceProvider
  }
  if (task.type === 'puzzle') return 'local'
  if (task.source === 'assistant' || task.source === 'infinite_canvas') return 'sub2api'
  const provider = String(task.params?._serviceProvider || '')
  return provider === 'sub2api' || provider === 'crun' ? provider : 'c2a'
}

function taskServiceProviderMeta(task: AdminTask) {
  const params = task.params || {}
  const providerNames = [
    params._providerDisplayName,
    params._chatProviderDisplayName,
    params._imageProviderDisplayName,
  ]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
  const modelNames = [
    params._modelDisplayName,
    params._chatModelDisplayName,
    params._imageModelDisplayName,
  ]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
  if (providerNames.length) {
    return {
      name: providerNames.join(' / '),
      detail:
        modelNames.join(' / ') ||
        serviceProviderMeta[taskServiceProvider(task)].detail,
    }
  }
  return serviceProviderMeta[taskServiceProvider(task)]
}

function taskOutputCount(task: AdminTask) {
  return task.outputUrls?.length || task.outputKeys?.length || 0
}

function taskDeletedOutputCount(task: AdminTask) {
  return Math.max(0, Number(task.deletedOutputCount) || 0)
}

function isUserDeletedTask(task: AdminTask) {
  return task.deletionActor === 'user' && Boolean(task.deletedAt)
}

function taskInputCount(task: AdminTask) {
  return task.inputKeys?.length || 0
}

function taskCount(task: AdminTask): number | string {
  if (task.source !== 'assistant' && task.source !== 'infinite_canvas') return task.count
  const resolvedMode = String(task.params?.resolvedMode || task.params?.mode || '')
  return resolvedMode === 'image' ? task.count : '-'
}

/** 未交付张数：请求 − 产出；排队/运行中尚未定论 */
function taskFailedCount(task: AdminTask): number | string {
  if (task.status === 'queued' || task.status === 'running') return '—'
  const requested = taskCount(task)
  if (typeof requested !== 'number') {
    return task.status === 'failed' ? 1 : 0
  }
  const delivered = taskOutputCount(task) + taskDeletedOutputCount(task)
  return Math.max(0, requested - delivered)
}

// 详情抽屉
const detailVisible = ref(false)
const detail = ref<AdminTask | null>(null)
const paramsDialogVisible = ref(false)

/** 常见请求参数 → 中文标签 */
const PARAM_LABELS: Record<string, string> = {
  aspectRatio: '宽高比',
  requestedAspectRatio: '请求宽高比',
  autoAspectRatioCandidates: '自动宽高比候选',
  resolution: '分辨率',
  size: '尺寸',
  quality: '质量',
  outputFormat: '输出格式',
  format: '格式',
  moderation: '审核级别',
  moderationLevel: '审核级别',
  transparentBackground: '透明背景',
  mode: '模式',
  resolvedMode: '解析模式',
  publicModelKey: '模型 Key',
  model: '模型',
  seed: '种子',
  steps: '步数',
  guidance: '引导强度',
  strength: '强度',
  count: '张数',
  _serviceProvider: '服务商',
  _providerDisplayName: '服务商名称',
  _modelDisplayName: '模型名称',
  _chatProviderDisplayName: '对话服务商',
  _chatModelDisplayName: '对话模型',
  _imageProviderDisplayName: '生图服务商',
  _imageModelDisplayName: '生图模型',
  _modelConfigId: '模型配置 ID',
  _providerConfigId: '服务商配置 ID',
  _providerRouteId: '路由 ID',
  _providerRouteKey: '路由 Key',
  _modelTool: '模型工具',
  _modelFastMode: '快速模式',
  _modelResolutions: '可用分辨率',
  _modelAspectRatios: '可用宽高比',
  _modelAspectRatiosByResolution: '分辨率宽高比',
  _modelQualities: '可用质量',
  _modelTransparentBackground: '支持透明背景',
  _modelOutputFormats: '可用输出格式',
  _modelModerationLevels: '可用审核级别',
  _modelMaxReferenceImages: '最大参考图数',
  _unitPriceCents: '单价（积分）',
}

const PARAM_ORDER = [
  'aspectRatio',
  'requestedAspectRatio',
  'resolution',
  'size',
  'quality',
  'outputFormat',
  'format',
  'moderation',
  'moderationLevel',
  'transparentBackground',
  'mode',
  'resolvedMode',
  'publicModelKey',
  'model',
  'seed',
  'steps',
  'guidance',
  'strength',
  'count',
  'autoAspectRatioCandidates',
]

function formatParamValue(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (key === '_unitPriceCents' && typeof value === 'number') {
    return formatPoints(value)
  }
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return value.map(String).join('、')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function paramLabel(key: string) {
  return PARAM_LABELS[key] || key
}

function sortParamKeys(keys: string[]) {
  const rank = new Map(PARAM_ORDER.map((key, index) => [key, index]))
  return [...keys].sort((a, b) => {
    const ai = rank.get(a) ?? 1000
    const bi = rank.get(b) ?? 1000
    if (ai !== bi) return ai - bi
    return a.localeCompare(b)
  })
}

const detailParamGroups = computed(() => {
  const params = detail.value?.params
  if (!params) return { request: [], system: [] }

  const request: { key: string; label: string; value: string }[] = []
  const system: { key: string; label: string; value: string }[] = []

  for (const key of sortParamKeys(Object.keys(params))) {
    const row = {
      key,
      label: paramLabel(key),
      value: formatParamValue(key, params[key]),
    }
    if (key.startsWith('_')) system.push(row)
    else request.push(row)
  }
  return { request, system }
})

const hasDetailParams = computed(
  () => detailParamGroups.value.request.length + detailParamGroups.value.system.length > 0,
)

const detailParamsJson = computed(() => {
  const params = detail.value?.params
  if (!params || !Object.keys(params).length) return ''
  return JSON.stringify(params, null, 2)
})

const detailInputUrls = computed(() => (detail.value?.inputKeys ?? []).map(adminFileUrl))
const detailOutputUrls = computed(() => detail.value?.outputUrls ?? [])
const detailMediaMode = ref<'output' | 'input'>('output')
const detailMediaUrls = computed(() =>
  detailMediaMode.value === 'output' ? detailOutputUrls.value : detailInputUrls.value,
)
// 详情里点开大图：产物用展示图（压缩大图），输入图沿用原地址
const detailPreviewUrls = computed(() =>
  detailMediaMode.value === 'output' && detail.value
    ? taskPreviewUrls(detail.value)
    : detailMediaUrls.value,
)

function setDetailMediaMode(mode: 'output' | 'input') {
  detailMediaMode.value = mode
}

function openDetail(task: AdminTask) {
  detail.value = task
  detailMediaMode.value = task.outputUrls?.length ? 'output' : 'input'
  paramsDialogVisible.value = false
  detailVisible.value = true
  void loadTimeline(task.id)
}

// ---------- 执行耗时时间线 ----------

interface TimelineEvent {
  id: number
  stage: string
  status: string
  message: string
  durationMs: number | null
  meta: Record<string, unknown>
  createdAt: string
}

const timelineLoading = ref(false)
const timelineError = ref('')
const timelineEvents = ref<TimelineEvent[]>([])

/** 阶段 → 白话名称与解释（给非技术同学看的） */
const TIMELINE_STAGE_META: Record<string, { label: string; hint: string }> = {
  queued: { label: '排队等待', hint: '任务创建后在队列里等待空闲处理线程接单，排队久说明当时任务多或并发额度满了' },
  input_prepare: { label: '准备参考图', hint: '把参考图从云存储取出并编码，准备发给 AI 服务' },
  submitted: { label: '提交生成请求', hint: '把生成请求发送给上游 AI 服务商，之后进入等待生成阶段' },
  upstream_generate: { label: 'AI 生成', hint: '上游 AI 服务实际画图的时间，快慢取决于上游服务的负载，平台无法加速' },
  result_download: { label: '取回图片', hint: '把生成好的图片从上游服务器下载回本平台，受跨国网络带宽影响，图越大越慢' },
  image_persist: { label: '保存图片', hint: '生成小图和展示图（后台「图片处理」可配格式与质量），与原图一起存入云存储' },
  retry: { label: '自动重试', hint: '上游临时报错（如账号池忙）时，系统按「系统设置→调度与重试」里的退避时间自动重试' },
  upstream_error: { label: '上游报错', hint: '上游服务商返回了错误信息，若还有重试机会会自动重试' },
  succeeded: { label: '任务完成', hint: '从创建到完成的总耗时（含排队），图片已保存、费用已结算' },
  failed: { label: '任务失败', hint: '任务终止，冻结的积分已退回用户' },
}

function timelineStageLabel(stage: string) {
  return TIMELINE_STAGE_META[stage]?.label ?? stage
}

function timelineStageHint(stage: string) {
  return TIMELINE_STAGE_META[stage]?.hint ?? ''
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms} 毫秒`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)} 秒`
  const mins = Math.floor(secs / 60)
  const rest = Math.round(secs % 60)
  return `${mins} 分 ${rest} 秒`
}

// succeeded/failed 记录的是“从创建到结束”的总耗时，不和单阶段比较条形长度。
const TIMELINE_TOTAL_STAGES = new Set(['succeeded', 'failed'])

const timelineMaxMs = computed(() => {
  let max = 0
  for (const event of timelineEvents.value) {
    if (TIMELINE_TOTAL_STAGES.has(event.stage)) continue
    if (event.durationMs != null && event.durationMs > max) max = event.durationMs
  }
  return max
})

function timelineBarWidth(event: TimelineEvent): string {
  if (TIMELINE_TOTAL_STAGES.has(event.stage)) return ''
  if (event.durationMs == null || event.durationMs <= 0 || timelineMaxMs.value <= 0) return ''
  const pct = Math.max(2, Math.round((event.durationMs / timelineMaxMs.value) * 100))
  return `${pct}%`
}

async function loadTimeline(taskId: string) {
  timelineLoading.value = true
  timelineError.value = ''
  timelineEvents.value = []
  try {
    const data = await request<{ items: TimelineEvent[] }>(
      `/api/v1/admin/tasks/${taskId}/timeline`,
    )
    timelineEvents.value = data.items ?? []
  } catch (error) {
    timelineError.value = error instanceof Error ? error.message : '耗时记录加载失败'
  } finally {
    timelineLoading.value = false
  }
}

function openParamsDialog() {
  if (!hasDetailParams.value) return
  paramsDialogVisible.value = true
}

const acting = ref(false)
const purging = ref(false)
const purgeDialogVisible = ref(false)

const finishedCount = computed(() => {
  if (filters.status === 'queued' || filters.status === 'running') return 0
  if (filters.status === 'succeeded') return summary.value.succeeded
  if (filters.status === 'failed') return summary.value.failed
  if (filters.status === 'canceled') return summary.value.canceled
  return summary.value.succeeded + summary.value.failed + summary.value.canceled
})

const canPurge = computed(
  () =>
    finishedCount.value > 0 &&
    filters.status !== 'queued' &&
    filters.status !== 'running',
)

const purgeScope = computed(() => {
  if (filters.status === 'succeeded') return '已成功'
  if (filters.status === 'failed') return '已失败'
  if (filters.status === 'canceled') return '已取消'
  return '已结束（成功 / 失败 / 取消）'
})

function openPurgeDialog() {
  if (!canPurge.value) return
  purgeDialogVisible.value = true
}

async function confirmPurge() {
  if (purging.value || !canPurge.value) return
  purging.value = true
  try {
    const result = await request<{ deleted: number; skipped: number }>('/api/v1/admin/tasks', {
      method: 'DELETE',
      query: {
        type: filters.type,
        status: filters.status,
        user: filters.user,
        errorCode: filters.errorCode,
      },
    })
    purgeDialogVisible.value = false
    ElMessage.success(`已从管理端清空 ${result.deleted} 条任务记录，用户历史仍保留`)
    await reset()
  } finally {
    purging.value = false
  }
}

async function requeue(task: AdminTask) {
  await ElMessageBox.confirm(
    `确认将失败任务 ${task.id} 重新入队？不会重复向用户扣费。`,
    '重新入队',
    {
      type: 'warning',
      confirmButtonText: '重新入队',
      cancelButtonText: '取消',
    },
  )
  acting.value = true
  try {
    await request(`/api/v1/admin/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: 'queued' },
    })
    ElMessage.success('已重新入队')
    detailVisible.value = false
    refresh()
  } finally {
    acting.value = false
  }
}

async function cancel(task: AdminTask) {
  const taskName = taskOperationName(task)
  await ElMessageBox.confirm(
    `确认取消排队中的${taskName} ${task.id}？取消后将解冻退还该任务费用。`,
    '取消任务',
    {
      type: 'warning',
      confirmButtonText: '取消任务',
      cancelButtonText: '返回',
    },
  )
  acting.value = true
  try {
    await request(`/api/v1/admin/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: 'canceled' },
    })
    ElMessage.success(`${taskName}已取消并解冻费用`)
    detailVisible.value = false
    refresh()
  } finally {
    acting.value = false
  }
}

async function forceFail(task: AdminTask) {
  const taskName = taskOperationName(task)
  await ElMessageBox.confirm(
    `确认将运行中的${taskName} ${task.id} 强制置为失败？将解冻并退还该任务冻结的费用（errorCode=admin_force_failed）。仅用于卡死任务，若任务仍在正常执行请勿操作。`,
    '强制失败',
    {
      type: 'error',
      confirmButtonText: '强制失败',
      confirmButtonClass: 'el-button--danger',
      cancelButtonText: '取消',
    },
  )
  acting.value = true
  try {
    await request(`/api/v1/admin/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status: 'failed' },
    })
    ElMessage.success('已强制失败并解冻退款')
    detailVisible.value = false
    refresh()
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="tasks-page">
    <PageCard
      title="任务监控"
      :subtitle="`队列与执行状态 · 今日新增 ${summary.today} · 更新于 ${lastUpdatedLabel}`"
    >
      <template #actions>
        <div class="refresh-actions">
          <TaskRuntimeSettingsDialog />
          <span class="refresh-dot" :class="{ 'is-live': autoRefresh }" />
          <el-switch
            v-model="autoRefresh"
            inline-prompt
            active-text="自动"
            inactive-text="手动"
          />
          <el-button
            type="danger"
            plain
            :icon="Delete"
            :loading="purging"
            :disabled="!canPurge || loading"
            @click="openPurgeDialog"
          >
            清空记录
          </el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refreshNow">刷新</el-button>
        </div>
      </template>

      <div class="tasks-toolbar">
        <div class="status-tabs" role="tablist" aria-label="任务状态">
          <button
            v-for="tab in statusTabs"
            :key="tab.value || 'all'"
            type="button"
            role="tab"
            class="status-tab"
            :class="[
              { 'is-active': filters.status === tab.value },
              `is-${tab.tone}`,
            ]"
            :aria-selected="filters.status === tab.value"
            @click="setStatusTab(tab.value)"
          >
            {{ tab.label }}
            <em class="tnum">{{ tab.count }}</em>
          </button>
        </div>

        <div class="tasks-toolbar__actions">
          <el-input
            v-model="filters.user"
            class="tasks-search"
            placeholder="用户邮箱 / ID"
            clearable
            :prefix-icon="Search"
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-select
            v-model="filters.type"
            class="tasks-type"
            placeholder="任务类型"
            clearable
            @change="reset"
          >
            <el-option
              v-for="(label, value) in TASK_TYPE_LABELS"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
          <el-input
            v-model="filters.errorCode"
            class="tasks-error"
            placeholder="错误码"
            clearable
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button @click="reset">查询</el-button>
          <el-button text :disabled="!activeFilterCount && !filters.status" @click="clearFilters">
            重置
          </el-button>
        </div>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="tasks-list-shell"
        fill
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        @prev="prev"
        @next="next"
      >
        <div class="tasks-table-shell">
          <el-table
            v-loading="loading"
            class="tasks-table"
            :data="items"
            height="100%"
            size="small"
            :row-class-name="taskRowClass"
            @row-click="(row: AdminTask) => openDetail(row)"
          >
            <template #empty>
              <el-empty description="没有符合条件的任务" :image-size="60">
                <div class="empty-sub">调整筛选条件后重新查询</div>
              </el-empty>
            </template>

            <el-table-column label="预览" width="72" align="left" header-align="left">
              <template #default="{ row }">
                <el-image
                  v-if="taskMediaUrls(row as AdminTask).length"
                  :src="taskMediaUrls(row as AdminTask)[0]"
                  :preview-src-list="taskPreviewUrls(row as AdminTask)"
                  fit="cover"
                  class="task-thumb"
                  preview-teleported
                  hide-on-click-modal
                  @click.stop
                >
                  <template #error>
                    <div class="media-ph media-ph--sm" title="图片加载失败">
                      <el-icon><Picture /></el-icon>
                    </div>
                  </template>
                </el-image>
                <div
                  v-else
                  class="media-ph media-ph--sm is-empty"
                  :class="{ 'is-user-deleted': isUserDeletedTask(row as AdminTask) }"
                  :title="isUserDeletedTask(row as AdminTask) ? '产物已被用户删除' : '暂无预览'"
                >
                  <el-icon>
                    <Delete v-if="isUserDeletedTask(row as AdminTask)" />
                    <Picture v-else />
                  </el-icon>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="状态" width="96" align="left" header-align="left">
              <template #default="{ row }">
                <div class="task-status-cell">
                  <span class="kind-text" :class="`is-status-${row.status}`">
                    {{ TASK_STATUS_LABELS[row.status] ?? row.status }}
                  </span>
                  <small v-if="isUserDeletedTask(row as AdminTask)" class="deletion-mark">用户已删除</small>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="耗时" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="metric metric-time tnum">{{ taskDuration(row as AdminTask) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="积分" width="88" align="left" header-align="left">
              <template #default="{ row }">
                <span class="metric metric-cost tnum">{{ formatPoints(row.costCents) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="数量" min-width="250" align="left" header-align="left">
              <template #default="{ row }">
                <div
                  class="qty-cell"
                  :title="`请求 ${taskCount(row as AdminTask)} · 现有产出 ${taskOutputCount(row as AdminTask)} · 用户删除 ${taskDeletedOutputCount(row as AdminTask)} · 失败 ${taskFailedCount(row as AdminTask)} · 参考图 ${taskInputCount(row as AdminTask)}`"
                >
                  <span class="qty-chip">
                    <small>请求</small>
                    <em class="metric-request tnum">{{ taskCount(row as AdminTask) }}</em>
                  </span>
                  <span class="qty-chip">
                    <small>产出</small>
                    <em class="metric-result tnum">{{ taskOutputCount(row as AdminTask) }}</em>
                  </span>
                  <span v-if="taskDeletedOutputCount(row as AdminTask)" class="qty-chip is-deleted">
                    <small>已删</small>
                    <em class="tnum">{{ taskDeletedOutputCount(row as AdminTask) }}</em>
                  </span>
                  <span class="qty-chip">
                    <small>失败</small>
                    <em
                      class="metric-fail tnum"
                      :class="{ 'is-zero': taskFailedCount(row as AdminTask) === 0 }"
                    >{{ taskFailedCount(row as AdminTask) }}</em>
                  </span>
                  <span class="qty-chip" :class="{ 'is-ref': taskInputCount(row as AdminTask) > 0 }">
                    <small>参考图</small>
                    <em class="tnum">{{ taskInputCount(row as AdminTask) }}</em>
                  </span>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="任务类型" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-num">{{ taskTypeLabel(row.type, row.params) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="服务商" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="provider-text">{{ taskServiceProviderMeta(row as AdminTask).name }}</span>
              </template>
            </el-table-column>

            <el-table-column
              label="模型 / 端点"
              min-width="160"
              align="left"
              header-align="left"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <span class="cell-muted">{{ taskServiceProviderMeta(row as AdminTask).detail }}</span>
              </template>
            </el-table-column>

            <el-table-column label="任务内容" width="96" align="left" header-align="left">
              <template #default="{ row }">
                <button
                  type="button"
                  class="task-prompt-btn cell-text"
                  :title="`点击复制：${taskPrompt(row as AdminTask)}`"
                  @click.stop="copyTaskPrompt(row as AdminTask)"
                >
                  {{ taskPromptBrief(row as AdminTask) }}
                </button>
              </template>
            </el-table-column>

            <el-table-column
              label="用户邮箱"
              min-width="170"
              align="left"
              header-align="left"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <span class="cell-text">{{ taskUser(row as AdminTask) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="创建" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum" :title="formatTime(row.createdAt)">
                  {{ formatShortTime(row.createdAt) }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="开始" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum">
                  {{ row.startedAt ? formatShortTime(row.startedAt) : '—' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="结束" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum">
                  {{ row.finishedAt ? formatShortTime(row.finishedAt) : '—' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="错误码" width="120" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.errorCode" class="cell-fail">{{ row.errorCode }}</span>
                <span v-else class="cell-muted">—</span>
              </template>
            </el-table-column>

            <el-table-column
              label="异常消息"
              min-width="180"
              align="left"
              header-align="left"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <span v-if="row.errorMessage" class="cell-muted">{{ row.errorMessage }}</span>
                <span v-else class="cell-muted">—</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </AdminListShell>
    </PageCard>

    <el-drawer
      v-model="detailVisible"
      size="min(640px, 96vw)"
      append-to-body
      destroy-on-close
      class="task-detail-drawer"
    >
      <template #header>
        <div v-if="detail" class="drawer-header">
          <div class="drawer-heading">
            <span class="drawer-status" :class="`is-${detail.status}`">
              {{ TASK_STATUS_LABELS[detail.status] ?? detail.status }}
            </span>
            <strong>{{ taskTypeLabel(detail.type, detail.params) }}</strong>
            <small>{{ taskServiceProviderMeta(detail).name }} · {{ taskServiceProviderMeta(detail).detail }}</small>
          </div>
        </div>
      </template>

      <div v-if="detail" class="drawer-body">
        <div class="drawer-toolbar">
          <div class="drawer-toolbar__user">
            <span class="drawer-toolbar__value">{{ taskUser(detail) }}</span>
            <button type="button" class="drawer-id-chip" @click="copyTaskId(detail.id)">
              <span class="mono">{{ detail.id }}</span>
              <el-icon><CopyDocument /></el-icon>
            </button>
          </div>
          <div class="drawer-toolbar__actions">
            <el-button
              v-if="detail.status === 'failed'"
              size="small"
              type="warning"
              :loading="acting"
              @click="requeue(detail)"
            >
              重新入队
            </el-button>
            <el-button
              v-if="detail.status === 'queued'"
              size="small"
              type="warning"
              :loading="acting"
              @click="cancel(detail)"
            >
              取消任务
            </el-button>
            <el-button
              v-if="detail.status === 'running'"
              size="small"
              type="danger"
              :loading="acting"
              @click="forceFail(detail)"
            >
              强制失败
            </el-button>
          </div>
        </div>

        <div class="drawer-stats">
          <span class="stat-item">
            <small>产出/请求</small>
            <em class="tnum">
              <b class="metric-result">{{ taskOutputCount(detail) }}</b>
              <i>/</i>
              <b class="metric-request">{{ taskCount(detail) }}</b>
            </em>
          </span>
          <span class="stat-item">
            <small>失败</small>
            <em
              class="metric-fail tnum"
              :class="{ 'is-zero': taskFailedCount(detail) === 0 }"
            >{{ taskFailedCount(detail) }}</em>
          </span>
          <span class="stat-item" :class="{ 'is-ref': taskInputCount(detail) > 0 }">
            <small>参考图</small>
            <em class="tnum">{{ taskInputCount(detail) }}</em>
          </span>
          <span class="stat-item">
            <small>耗时</small>
            <em class="metric-time tnum">{{ taskDuration(detail) }}</em>
          </span>
          <span class="stat-item">
            <small>积分</small>
            <em class="metric-cost tnum">{{ formatPoints(detail.costCents) }}</em>
          </span>
        </div>

        <el-alert
          v-if="isUserDeletedTask(detail)"
          class="drawer-alert"
          type="warning"
          :closable="false"
          show-icon
          title="产物已被用户删除"
          :description="`用户于 ${formatTime(detail.deletedAt)} 删除了此任务及其 ${taskDeletedOutputCount(detail)} 个产物。任务成功状态和计费记录保留用于审计。`"
        />

        <el-alert
          v-if="detail.errorCode || detail.errorMessage"
          class="drawer-alert"
          type="error"
          :closable="false"
          show-icon
          :title="detail.errorCode || '任务异常'"
          :description="detail.errorMessage || ''"
        />

        <section class="detail-section">
          <header class="detail-section__title">
            <div class="detail-media-tabs">
              <button
                v-if="detailOutputUrls.length"
                type="button"
                :class="{ 'is-active': detailMediaMode === 'output' }"
                @click="setDetailMediaMode('output')"
              >
                产出图 <em>{{ detailOutputUrls.length }}</em>
              </button>
              <button
                v-if="detailInputUrls.length"
                type="button"
                :class="{ 'is-active': detailMediaMode === 'input' }"
                @click="setDetailMediaMode('input')"
              >
                参考图 <em>{{ detailInputUrls.length }}</em>
              </button>
              <span v-if="!detailOutputUrls.length && !detailInputUrls.length" class="cell-muted">
                暂无图片
              </span>
            </div>
            <small v-if="detailMediaUrls.length" class="detail-section__hint">点击查看大图</small>
          </header>
          <div v-if="detailMediaUrls.length" class="media-grid">
            <el-image
              v-for="(url, index) in detailMediaUrls"
              :key="`${detailMediaMode}-${url}-${index}`"
              :src="url"
              :preview-src-list="detailPreviewUrls"
              :initial-index="index"
              fit="cover"
              class="media-grid__item"
              preview-teleported
              hide-on-click-modal
            >
              <template #error>
                <div class="media-ph media-ph--sm">
                  <el-icon><Picture /></el-icon>
                </div>
              </template>
            </el-image>
          </div>
          <div v-else class="media-grid-empty">
            {{ isUserDeletedTask(detail) ? '产物已被用户删除' : detail.status === 'failed' ? '任务失败，无产出图' : '对话任务或仍在生成中' }}
          </div>
        </section>

        <section class="detail-section">
          <header class="detail-section__title">任务信息</header>
          <dl class="info-rows info-rows--flat">
            <div class="info-row">
              <dt>类型</dt>
              <dd>{{ taskTypeLabel(detail.type, detail.params) }}</dd>
            </div>
            <div class="info-row">
              <dt>来源</dt>
              <dd>{{ taskSourceLabel(detail) }}</dd>
            </div>
            <div class="info-row">
              <dt>服务商</dt>
              <dd>{{ taskServiceProviderMeta(detail).name }}</dd>
            </div>
            <div class="info-row">
              <dt>模型</dt>
              <dd>{{ taskServiceProviderMeta(detail).detail }}</dd>
            </div>
            <div class="info-row">
              <dt>创建</dt>
              <dd>{{ formatTime(detail.createdAt) }}</dd>
            </div>
            <div class="info-row">
              <dt>开始</dt>
              <dd>{{ formatTime(detail.startedAt) }}</dd>
            </div>
            <div class="info-row">
              <dt>结束</dt>
              <dd>{{ formatTime(detail.finishedAt) }}</dd>
            </div>
            <div v-if="detail.deletedAt" class="info-row">
              <dt>删除</dt>
              <dd>用户删除 · {{ formatTime(detail.deletedAt) }}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-section">
          <header class="detail-section__title">
            执行耗时
            <small class="detail-section__hint">任务每一步花了多久（灰色小字是白话解释）</small>
          </header>
          <div v-if="timelineLoading" class="timeline-empty">加载中…</div>
          <div v-else-if="timelineError" class="timeline-empty">{{ timelineError }}</div>
          <div v-else-if="!timelineEvents.length" class="timeline-empty">
            暂无耗时记录（仅在时间线功能上线后执行的任务会记录）
          </div>
          <ol v-else class="timeline">
            <li
              v-for="event in timelineEvents"
              :key="event.id"
              class="timeline-item"
              :class="`is-${event.status}`"
            >
              <div class="timeline-item__head">
                <span class="timeline-dot" />
                <strong>{{ timelineStageLabel(event.stage) }}</strong>
                <span v-if="event.durationMs != null" class="timeline-duration tnum">
                  {{ formatDurationMs(event.durationMs) }}
                </span>
                <time class="timeline-time">{{ formatShortTime(event.createdAt) }}</time>
              </div>
              <div v-if="timelineBarWidth(event)" class="timeline-bar">
                <i :style="{ width: timelineBarWidth(event) }" />
              </div>
              <p class="timeline-message">{{ event.message }}</p>
              <p v-if="timelineStageHint(event.stage)" class="timeline-hint">
                {{ timelineStageHint(event.stage) }}
              </p>
            </li>
          </ol>
        </section>

        <section class="detail-section">
          <header class="detail-section__title">
            任务内容
            <button type="button" class="icon-btn" title="复制" @click="copyTaskPrompt(detail)">
              <el-icon><CopyDocument /></el-icon>
            </button>
          </header>
          <pre class="detail-pre">{{ detail.prompt || '—' }}</pre>
        </section>

        <section v-if="hasDetailParams" class="detail-section">
          <header class="detail-section__title">
            请求参数
            <button type="button" class="params-open-link" @click="openParamsDialog">
              结构化查看
            </button>
          </header>
          <pre class="detail-pre mono detail-pre--compact">{{ detailParamsJson }}</pre>
        </section>
      </div>
    </el-drawer>

    <AdminDialog
      v-model="paramsDialogVisible"
      title="请求参数"
      subtitle="结构化查看任务入参与系统元数据"
      :icon="Document"
      width="680px"
      footer-hint="只读查看，不会修改任务"
      confirm-text="关闭"
      :show-cancel="false"
      @confirm="paramsDialogVisible = false"
    >
      <template v-if="detail" #meta>
        <span class="admin-dialog__chip">{{ taskTypeLabel(detail.type, detail.params) }}</span>
        <code class="admin-dialog__chip is-mono" :title="detail.id">{{ detail.id }}</code>
      </template>

      <div v-if="detail" class="task-params-panel">
        <div class="task-params-panel__summary">
          <div class="task-params-panel__summary-main">
            <strong>{{ detailParamGroups.request.length }} 项用户参数</strong>
            <small v-if="detailParamGroups.system.length">
              另含 {{ detailParamGroups.system.length }} 项系统元数据
            </small>
            <small v-else>无系统元数据</small>
          </div>
          <span class="task-params-panel__pill">只读</span>
        </div>

        <section class="task-params-panel__section">
          <div class="task-params-panel__label">
            <span>用户参数</span>
            <em>{{ detailParamGroups.request.length }}</em>
          </div>
          <div v-if="detailParamGroups.request.length" class="task-params-panel__table">
            <div
              v-for="row in detailParamGroups.request"
              :key="row.key"
              class="task-params-panel__row"
            >
              <div class="task-params-panel__key">
                <strong v-if="row.label !== row.key">{{ row.label }}</strong>
                <code>{{ row.key }}</code>
              </div>
              <div class="task-params-panel__value tnum">{{ row.value }}</div>
            </div>
          </div>
          <p v-else class="task-params-panel__empty">无用户侧参数</p>
        </section>

        <section v-if="detailParamGroups.system.length" class="task-params-panel__section">
          <div class="task-params-panel__label">
            <span>系统元数据</span>
            <em>{{ detailParamGroups.system.length }}</em>
          </div>
          <div class="task-params-panel__table">
            <div
              v-for="row in detailParamGroups.system"
              :key="row.key"
              class="task-params-panel__row"
            >
              <div class="task-params-panel__key">
                <strong v-if="row.label !== row.key">{{ row.label }}</strong>
                <code>{{ row.key }}</code>
              </div>
              <div class="task-params-panel__value tnum">{{ row.value }}</div>
            </div>
          </div>
        </section>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="purgeDialogVisible"
      title="清空任务记录"
      panel-class="task-purge-dialog"
      width="460px"
      confirm-text="清空记录"
      confirm-type="danger"
      :confirm-loading="purging"
      :close-on-click-modal="false"
      @confirm="confirmPurge"
    >
      <div class="task-purge-dialog__body">
        <span class="task-purge-dialog__icon" aria-hidden="true">
          <el-icon :size="16"><WarningFilled /></el-icon>
        </span>
        <p>
          将按当前筛选从管理端列表移除{{ purgeScope }}的已结束任务，预计
          <strong class="tnum">{{ finishedCount }}</strong>
          条。用户历史、生成结果、钱包账本、画廊投稿和审核记录都会保留。排队中和运行中的任务不会被清空。
        </p>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
.tasks-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.tasks-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.tasks-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.refresh-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.refresh-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-3);
}

.refresh-dot.is-live {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent);
}

.tasks-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}

.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.status-tab em {
  font-style: normal;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}

.status-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}

.status-tab.is-active em {
  color: color-mix(in srgb, var(--surface) 78%, transparent);
}

.status-tab.is-failed:not(.is-active) em {
  color: var(--danger);
}

html.dark .status-tab.is-active {
  background: var(--surface-3);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

html.dark .status-tab.is-active em {
  color: var(--ink-3);
}

.tasks-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tasks-search {
  width: 200px;
}

.tasks-type {
  width: 140px;
}

.tasks-error {
  width: 120px;
}

.tasks-list-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.tasks-list-shell :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}

.tasks-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.tasks-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.tasks-table :deep(.el-table__header-wrapper th.el-table__cell),
.tasks-table :deep(.el-table__body td.el-table__cell),
.tasks-table :deep(.el-table .cell) {
  text-align: left !important;
}

.tasks-table :deep(.el-table .cell) {
  display: block;
  padding-left: 12px;
  padding-right: 12px;
}

.tasks-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 48px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.tasks-table :deep(.el-table__body .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.tasks-table :deep(.el-table__row td.el-table__cell) {
  height: 64px;
}

.tasks-table :deep(.el-table__row) {
  cursor: pointer;
}

.tasks-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.tasks-table :deep(.el-table__body tr.el-table__row:last-child td.el-table__cell) {
  border-bottom-color: transparent;
}

.tasks-table :deep(.task-row.is-failed > td.el-table__cell) {
  background: color-mix(in srgb, var(--danger) 5%, var(--surface));
}

.tasks-table :deep(.task-row.is-running > td.el-table__cell) {
  background: color-mix(in srgb, var(--info) 5%, var(--surface));
}

.task-thumb {
  display: block;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.task-thumb :deep(.el-image__wrapper),
.task-thumb :deep(.el-image__inner),
.task-thumb :deep(.el-image__error) {
  width: 100%;
  height: 100%;
}

.media-ph {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  color: var(--ink-3);
  background:
    radial-gradient(120% 90% at 20% 15%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 55%),
    linear-gradient(145deg, var(--surface-2), color-mix(in srgb, var(--surface-3) 70%, var(--surface)));
}

.media-ph--sm {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 16px;
}

.media-ph--sm.is-empty {
  opacity: 0.72;
}

.media-ph--sm.is-user-deleted {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, var(--surface-2));
  opacity: 1;
}

.task-prompt-btn {
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  color: var(--ink-2);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  cursor: pointer;
}

.task-prompt-btn:hover {
  color: var(--accent-ink);
  text-decoration: underline;
}

.icon-btn {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
}

.icon-btn:hover {
  color: var(--ink);
  background: var(--surface-2);
}

.task-kind,
.task-error {
  display: grid;
  min-width: 0;
  gap: 2px;
  line-height: 1.3;
}

.task-kind strong {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 700;
}

.task-kind small,
.task-error small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric {
  font-size: 15px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.metric-time {
  color: var(--info);
}

.metric-cost {
  color: var(--warning);
}

.qty-cell {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  min-width: 0;
  align-items: baseline;
}

.qty-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  white-space: nowrap;
  line-height: 1.2;
}

.qty-chip small {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.qty-chip em {
  font-size: 15px;
  font-style: normal;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.metric-request {
  color: var(--ink);
}

.metric-result {
  color: var(--success);
}

.metric-fail {
  color: var(--danger);
}

.metric-fail.is-zero {
  color: var(--ink-3);
  font-weight: 650;
}

.qty-chip.is-ref small,
.qty-chip.is-ref em {
  color: var(--info);
}

.qty-chip.is-deleted small,
.qty-chip.is-deleted em {
  color: var(--warning);
}

.provider-text {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 400;
}

.kind-text {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.kind-text.is-status-succeeded {
  color: var(--success);
}

.kind-text.is-status-failed {
  color: var(--danger);
}

.kind-text.is-status-running,
.kind-text.is-status-queued {
  color: var(--info);
}

.kind-text.is-status-canceled {
  color: var(--warning);
}

.task-status-cell {
  display: grid;
  gap: 2px;
}

.deletion-mark {
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.cell-text {
  color: var(--ink-2);
  font-size: 12px;
}

.cell-num {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.cell-fail {
  color: var(--danger);
  font-size: 12px;
}

.drawer-id {
  user-select: all;
  word-break: break-all;
}

.empty-sub {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 12px;
}

.drawer-header {
  min-width: 0;
  padding-right: 8px;
}

.drawer-heading {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.drawer-status {
  justify-self: start;
  color: var(--success);
  font-size: 11px;
  font-weight: 650;
}

.drawer-status.is-failed {
  color: var(--danger);
}

.drawer-status.is-running,
.drawer-status.is-queued {
  color: var(--info);
}

.drawer-status.is-canceled {
  color: var(--warning);
}

.drawer-heading strong {
  color: var(--el-text-color-primary);
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.drawer-heading small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 24px;
}

.drawer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.drawer-toolbar__user {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.drawer-toolbar__value {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-id-chip {
  display: inline-flex;
  max-width: min(100%, 260px);
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--ink-3);
  font-size: 11px;
  background: var(--surface-2);
  cursor: pointer;
}

.drawer-id-chip .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-id-chip:hover {
  color: var(--ink);
}

.drawer-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.drawer-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.stat-item {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 0 8px;
  border-right: 1px solid var(--border);
}

.stat-item:last-child {
  border-right: 0;
}

.stat-item small {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.stat-item em {
  font-size: 14px;
  font-style: normal;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.stat-item em i {
  margin: 0 1px;
  color: var(--ink-3);
  font-style: normal;
  font-weight: 500;
}

.stat-item em b {
  font-weight: inherit;
}

.stat-item.is-ref em {
  color: var(--info);
}

.drawer-alert {
  margin: 0;
}

.info-rows {
  display: grid;
  gap: 6px;
  margin: 0;
}

.info-rows--flat {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.params-open-link {
  margin-left: auto;
  padding: 0;
  border: 0;
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 650;
  background: transparent;
  cursor: pointer;
}

.params-open-link:hover {
  text-decoration: underline;
}

.params-empty {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
}

.info-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
}

.info-row dt {
  margin: 0;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.info-row dd {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  word-break: break-word;
}

.detail-section {
  min-width: 0;
}

.detail-section__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-weight: 700;
}

.detail-section__hint {
  margin-left: auto;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 500;
}

.detail-pre {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-pre--compact {
  max-height: 120px;
  font-size: 11px;
}

.detail-media-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.detail-media-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.detail-media-tabs button em {
  font-style: normal;
  color: var(--ink-3);
}

.detail-media-tabs button.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.media-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.media-grid__item {
  width: 72px;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  cursor: zoom-in;
}

.media-grid__item :deep(.el-image__wrapper),
.media-grid__item :deep(.el-image__error),
.media-grid__item :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
}

.media-grid__item :deep(.media-ph--sm) {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
}

.media-grid-empty {
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--ink-3);
  font-size: 12px;
  background: var(--surface-2);
}



@media (max-width: 960px) {
  .tasks-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .tasks-toolbar__actions {
    width: 100%;
  }

  .tasks-search,
  .tasks-type,
  .tasks-error {
    flex: 1;
    width: auto;
    min-width: 120px;
  }
}
</style>

<style>
.task-detail-drawer.el-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
}

.task-detail-drawer .el-drawer__header {
  margin-bottom: 0;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border);
}

.task-detail-drawer .el-drawer__close-btn {
  margin-left: 12px;
}

.task-detail-drawer .el-drawer__body {
  flex: 1;
  min-height: 0;
  padding: 16px 22px 0;
  overflow: auto;
  overscroll-behavior: contain;
}

/* 参数弹窗内容（外壳见 AdminDialog；teleport 后需非 scoped） */
.task-params-panel {
  display: grid;
  gap: 16px;
  padding-bottom: 8px;
}

.task-params-panel__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
}

.task-params-panel__summary-main {
  min-width: 0;
}

.task-params-panel__summary-main strong,
.task-params-panel__summary-main small {
  display: block;
}

.task-params-panel__summary-main strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.task-params-panel__summary-main small {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 12px;
}

.task-params-panel__pill {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 700;
}

.task-params-panel__section {
  display: grid;
  gap: 8px;
}

.task-params-panel__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.task-params-panel__label span {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.task-params-panel__label em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
}

.task-params-panel__table {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.task-params-panel__row {
  display: grid;
  grid-template-columns: minmax(180px, 34%) minmax(0, 1fr);
  gap: 12px 16px;
  align-items: start;
  padding: 12px 14px;
}

.task-params-panel__row + .task-params-panel__row {
  border-top: 1px solid var(--border);
}

.task-params-panel__row:nth-child(even) {
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
}

.task-params-panel__key {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.task-params-panel__key strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
  word-break: break-word;
}

.task-params-panel__key code {
  overflow-wrap: anywhere;
  color: var(--ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-all;
}

.task-params-panel__value {
  min-width: 0;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-params-panel__empty {
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  text-align: center;
}


</style>

<style>
.task-purge-dialog.el-dialog {
  overflow: hidden;
}

.task-purge-dialog .el-dialog__header {
  padding: 20px 56px 6px 22px;
}

.task-purge-dialog .el-dialog__body {
  padding: 8px 22px 6px;
}

.task-purge-dialog .el-dialog__footer {
  padding: 14px 22px 20px;
}

.task-purge-dialog .admin-dialog__copy strong {
  font-size: 17px;
}

.task-purge-dialog__body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.task-purge-dialog__icon {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  margin-top: 2px;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: var(--warning);
  box-shadow: 0 4px 10px color-mix(in srgb, var(--warning) 28%, transparent);
}

.task-purge-dialog__icon .el-icon {
  font-size: 12px;
}

.task-purge-dialog__body p {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.7;
}

.task-purge-dialog__body strong {
  color: var(--ink);
  font-weight: 740;
}

.task-purge-dialog .admin-dialog__btn {
  min-width: 88px;
  height: 36px;
  padding: 0 18px;
  border-radius: var(--radius-pill);
}

.task-purge-dialog .admin-dialog__btn--ok {
  min-width: 104px;
  font-weight: 700;
}

.task-purge-dialog .el-button--danger {
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-active-text-color: #fff;
  color: #fff !important;
}

/* ---------- 执行耗时时间线 ---------- */

.timeline-empty {
  padding: 14px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px dashed var(--border);
  color: var(--ink-3);
  font-size: 12.5px;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.timeline-item {
  position: relative;
  padding: 10px 12px 12px 26px;
  border-left: 2px solid var(--border);
  margin-left: 7px;
}

.timeline-item:last-child {
  border-left-color: transparent;
}

.timeline-dot {
  position: absolute;
  left: -7px;
  top: 14px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--surface);
  border: 3px solid var(--ink-3);
}

.timeline-item.is-success .timeline-dot {
  border-color: #22a06b;
}

.timeline-item.is-warning .timeline-dot {
  border-color: #e8a23a;
}

.timeline-item.is-error .timeline-dot {
  border-color: #e5574f;
}

.timeline-item__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.timeline-item__head strong {
  font-size: 13.5px;
  color: var(--ink);
  font-weight: 700;
}

.timeline-item.is-error .timeline-item__head strong {
  color: #e5574f;
}

.timeline-item.is-warning .timeline-item__head strong {
  color: #b97a1a;
}

.timeline-item.is-success .timeline-item__head strong {
  color: #1d8a5c;
}

.timeline-duration {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-2);
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.timeline-time {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-3);
}

.timeline-bar {
  margin-top: 7px;
  height: 6px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}

.timeline-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6d8dff, #4a6cf7);
}

.timeline-item.is-warning .timeline-bar i {
  background: linear-gradient(90deg, #f5c26b, #e8a23a);
}

.timeline-item.is-error .timeline-bar i {
  background: linear-gradient(90deg, #f08a84, #e5574f);
}

.timeline-item.is-success .timeline-bar i {
  background: linear-gradient(90deg, #4fc48f, #22a06b);
}

.timeline-message {
  margin: 7px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-2);
}

.timeline-hint {
  margin: 3px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-3);
}
</style>
