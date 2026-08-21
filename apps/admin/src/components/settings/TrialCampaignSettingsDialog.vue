<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Back,
  Plus,
  Setting,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminDialog from '@/components/AdminDialog.vue'
import { request } from '@/request'
import type { TrialCampaign, TrialFeature } from './types'
import './settings-dialog.css'

const emit = defineEmits<{ saved: [] }>()

const open = ref(false)
const loading = ref(false)
const saving = ref(false)
const mode = ref<'list' | 'form'>('list')
const campaigns = ref<TrialCampaign[]>([])
const features = ref<TrialFeature[]>([])
const editingId = ref('')
const defaultExpiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const form = reactive({
  title: '限量功能体验计划',
  featureKeys: ['text_to_image'] as string[],
  accessMode: 'credit_only' as 'credit_only' | 'restricted',
  capacity: 100,
  displayOffset: 0,
  expiresAt: defaultExpiry(),
})

const expiryShortcuts = [
  { text: '7 天', value: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  { text: '14 天', value: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
  { text: '30 天', value: defaultExpiry },
  { text: '90 天', value: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
]

const dialogTitle = computed(() => {
  if (mode.value === 'list') return '体验活动管理'
  return editingId.value ? '编辑体验活动' : '新建体验活动'
})

const editingCampaign = computed(() =>
  campaigns.value.find((campaign) => campaign.id === editingId.value),
)
const featureSelectionLocked = computed(() => (editingCampaign.value?.actualApplied || 0) > 0)

const statusLabel: Record<string, string> = {
  active: '启用中',
  draft: '草稿',
  closed: '已关闭',
}

async function load() {
  loading.value = true
  try {
    const data = await request<{ items: TrialCampaign[]; features: TrialFeature[] }>(
      '/api/v1/admin/trial-campaigns',
    )
    campaigns.value = Array.isArray(data.items) ? data.items : []
    features.value = Array.isArray(data.features) ? data.features : []
  } finally {
    loading.value = false
  }
}

function resetForm(item?: TrialCampaign) {
  editingId.value = item?.id || ''
  form.title = item?.title || '限量功能体验计划'
  form.featureKeys = item?.featureKeys?.length
    ? [...item.featureKeys]
    : [features.value[0]?.key || 'text_to_image']
  form.accessMode = item?.accessMode === 'restricted' ? 'restricted' : 'credit_only'
  form.capacity = item?.capacity || 100
  form.displayOffset = item?.displayOffset || 0
  const expiresAt = item?.expiresAt ? new Date(item.expiresAt) : defaultExpiry()
  form.expiresAt = Number.isNaN(expiresAt.getTime()) ? defaultExpiry() : expiresAt
  mode.value = 'form'
}

function backToList() {
  mode.value = 'list'
  editingId.value = ''
}

function validateForm() {
  if (form.title.trim().length < 2) {
    ElMessage.warning('活动标题至少需要 2 个字')
    return false
  }
  if (
    !form.featureKeys.length ||
    form.featureKeys.some((key) => !features.value.some((feature) => feature.key === key))
  ) {
    ElMessage.warning('请至少选择一个真实存在的体验功能')
    return false
  }
  const expiresAt = form.expiresAt?.getTime()
  const now = Date.now()
  if (!expiresAt || Number.isNaN(expiresAt) || expiresAt < now + 5 * 60 * 1000) {
    ElMessage.warning('活动截止时间至少需要晚于当前时间 5 分钟')
    return false
  }
  if (expiresAt > now + 365 * 24 * 60 * 60 * 1000) {
    ElMessage.warning('单期活动最长为 365 天')
    return false
  }
  return true
}

async function save() {
  if (saving.value || !validateForm()) return
  saving.value = true
  try {
    const wasEditing = Boolean(editingId.value)
    const path = editingId.value
      ? `/api/v1/admin/trial-campaigns/${editingId.value}`
      : '/api/v1/admin/trial-campaigns'
    await request(path, {
      method: editingId.value ? 'PATCH' : 'POST',
      body: {
        title: form.title.trim(),
        featureKeys: form.featureKeys,
        accessMode: form.accessMode,
        capacity: form.capacity,
        displayOffset: form.displayOffset,
        expiresAt: form.expiresAt.toISOString(),
      },
    })
    await load()
    backToList()
    emit('saved')
    ElMessage.success(wasEditing ? '活动设置已更新' : '活动已创建为草稿')
  } finally {
    saving.value = false
  }
}

async function activate(item: TrialCampaign) {
  const current = campaigns.value.find((campaign) => campaign.status === 'active')
  await ElMessageBox.confirm(
    current && current.id !== item.id
      ? `启用「${item.title}」会同时关闭「${current.title}」，是否继续？`
      : `确认启用「${item.title}」？`,
    '启用体验活动',
    { type: 'warning', confirmButtonText: '确认启用', cancelButtonText: '取消' },
  )
  await request(`/api/v1/admin/trial-campaigns/${item.id}/activation`, { method: 'POST' })
  await load()
  emit('saved')
  ElMessage.success('活动已启用，用户入口同步开放')
}

async function closeCampaign(item: TrialCampaign) {
  await ElMessageBox.confirm(
    `关闭「${item.title}」后，用户入口、申请、审核、积分领取及体验积分使用都会立即停止。`,
    '关闭体验活动',
    { type: 'warning', confirmButtonText: '确认关闭', cancelButtonText: '取消' },
  )
  await request(`/api/v1/admin/trial-campaigns/${item.id}/closure`, { method: 'POST' })
  await load()
  emit('saved')
  ElMessage.success('活动已关闭，用户入口已经停用')
}

async function remove(item: TrialCampaign) {
  await ElMessageBox.confirm(
    `确认删除草稿「${item.title}」？已有申请记录的活动不能删除。`,
    '删除体验活动',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  )
  await request(`/api/v1/admin/trial-campaigns/${item.id}`, { method: 'DELETE' })
  await load()
  emit('saved')
  ElMessage.success('活动已删除')
}

function formatDate(value?: string | null) {
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

function isExpired(item: TrialCampaign) {
  return item.expired === true || new Date(item.expiresAt).getTime() <= Date.now()
}

function formatRemaining(item: TrialCampaign) {
  const milliseconds = new Date(item.expiresAt).getTime() - Date.now()
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '已到期'
  const hours = Math.ceil(milliseconds / (60 * 60 * 1000))
  if (hours < 24) return `剩余 ${hours} 小时`
  return `剩余 ${Math.ceil(hours / 24)} 天`
}

function campaignStatus(item: TrialCampaign) {
  if (isExpired(item)) return { key: 'expired', label: '已过期' }
  return { key: item.status, label: statusLabel[item.status] || item.status }
}

function canDelete(item: TrialCampaign) {
  return item.status !== 'active' && item.actualApplied <= 0
}

function applyExpiryShortcut(fn: () => Date) {
  form.expiresAt = fn()
}
</script>

<template>
  <el-button :icon="Setting" @click="open = true">活动管理</el-button>

  <AdminDialog
    v-model="open"
    panel-class="trial-campaign-dialog"
    :title="dialogTitle"
    :icon="Setting"
    width="720px"
    nested-scroll
    :hide-footer="mode === 'list'"
    :confirm-text="editingId ? '保存' : '创建'"
    cancel-text="返回"
    :confirm-loading="saving"
    :confirm-disabled="loading || features.length === 0"
    @open="load"
    @cancel="backToList"
    @confirm="save"
    @closed="backToList"
  >
    <div v-loading="loading" class="campaign-manager">
      <template v-if="mode === 'list'">
        <div class="campaign-manager__toolbar">
          <el-button type="primary" :icon="Plus" @click="resetForm()">新建活动</el-button>
        </div>

        <div v-if="!loading && !campaigns.length" class="campaign-manager__empty">
          <strong>还没有体验活动</strong>
          <span>创建后会出现在这里</span>
        </div>

        <div v-else class="campaign-manager__list">
          <article
            v-for="row in campaigns"
            :key="row.id"
            class="campaign-card"
            :class="`is-${campaignStatus(row).key}`"
          >
            <header>
              <strong>{{ row.title }}</strong>
              <span class="campaign-card__status" :class="`is-${campaignStatus(row).key}`">
                {{ campaignStatus(row).label }}
              </span>
            </header>
            <div class="campaign-card__meta">
              <span>截止 {{ formatDate(row.expiresAt) }}</span>
              <i>·</i>
              <span>{{ formatRemaining(row) }}</span>
              <i>·</i>
              <span class="tnum">{{ row.actualApplied.toLocaleString('zh-CN') }} / {{ row.capacity.toLocaleString('zh-CN') }}</span>
            </div>
            <div v-if="row.features?.length" class="campaign-card__features">
              <span v-for="feature in row.features" :key="feature.key">{{ feature.label }}</span>
            </div>
            <footer>
              <button type="button" class="campaign-card__action" @click="resetForm(row)">编辑</button>
              <button
                v-if="row.status !== 'active'"
                type="button"
                class="campaign-card__action is-on"
                :disabled="isExpired(row)"
                @click="activate(row)"
              >
                启用
              </button>
              <button
                v-else
                type="button"
                class="campaign-card__action is-warn"
                @click="closeCampaign(row)"
              >
                关闭
              </button>
              <button
                v-if="canDelete(row)"
                type="button"
                class="campaign-card__action is-danger"
                @click="remove(row)"
              >
                删除
              </button>
            </footer>
          </article>
        </div>
      </template>

      <div v-else class="campaign-form">
        <button type="button" class="campaign-form__back" @click="backToList">
          <el-icon><Back /></el-icon>
          返回
        </button>

        <label class="campaign-form__field">
          <span>活动标题</span>
          <el-input v-model="form.title" maxlength="60" show-word-limit />
        </label>

        <label class="campaign-form__field">
          <span>体验功能</span>
          <el-select
            v-model="form.featureKeys"
            class="campaign-form__select"
            popper-class="module-settings-feature-popper"
            placeholder="选择功能"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="3"
            :multiple-limit="6"
            :disabled="featureSelectionLocked"
          >
            <el-option
              v-for="feature in features"
              :key="feature.key"
              :label="feature.label"
              :value="feature.key"
            >
              <div class="module-settings-feature-option">
                <i :class="['bi', feature.icon]" aria-hidden="true" />
                <span>
                  <strong>{{ feature.label }}</strong>
                  <small>{{ feature.route }} · {{ feature.taskTypes.join(', ') }}</small>
                </span>
              </div>
            </el-option>
          </el-select>
        </label>

        <div class="campaign-form__field">
          <span>体验方式</span>
          <div class="campaign-form__chips">
            <button
              type="button"
              class="campaign-form__chip"
              :class="{ 'is-active': form.accessMode === 'credit_only' }"
              @click="form.accessMode = 'credit_only'"
            >
              功能专属积分
            </button>
            <button
              type="button"
              class="campaign-form__chip"
              :class="{ 'is-active': form.accessMode === 'restricted' }"
              @click="form.accessMode = 'restricted'"
            >
              权限内测
            </button>
          </div>
        </div>

        <div class="campaign-form__field">
          <span>截止时间</span>
          <div class="campaign-form__chips">
            <button
              v-for="item in expiryShortcuts"
              :key="item.text"
              type="button"
              class="campaign-form__chip"
              @click="applyExpiryShortcut(item.value)"
            >
              {{ item.text }}
            </button>
          </div>
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            placeholder="选择截止时间"
            :clearable="false"
          />
        </div>

        <div class="campaign-form__row">
          <label class="campaign-form__field">
            <span>总名额</span>
            <div class="campaign-form__number">
              <el-input-number v-model="form.capacity" :min="1" :max="1000000" :precision="0" :controls="false" />
              <em>人</em>
            </div>
          </label>
          <label class="campaign-form__field">
            <span>展示调整</span>
            <div class="campaign-form__number">
              <el-input-number
                v-model="form.displayOffset"
                :min="-1000000"
                :max="1000000"
                :precision="0"
                :controls="false"
              />
              <em>人</em>
            </div>
          </label>
        </div>
      </div>
    </div>
  </AdminDialog>
</template>

<style scoped lang="scss">
.campaign-manager {
  display: grid;
  gap: 12px;
  min-height: 200px;
}

.campaign-manager__toolbar {
  display: flex;
  justify-content: flex-end;
}

.campaign-manager__list {
  display: grid;
  gap: 10px;
  align-content: start;
}

.campaign-manager__empty {
  display: grid;
  min-height: 220px;
  place-content: center;
  justify-items: center;
  gap: 6px;
  color: var(--ink-3);
  text-align: center;

  strong {
    color: var(--ink);
  }

  span {
    font-size: 12px;
  }
}

.campaign-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
}

.campaign-card__status {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;

  &.is-active {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-draft {
    background: var(--surface);
    color: var(--ink-3);
  }

  &.is-closed,
  &.is-expired {
    background: var(--danger-soft);
    color: var(--danger);
  }

  &.is-closed {
    background: var(--surface-3);
    color: var(--ink-3);
  }
}

.campaign-card__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  white-space: nowrap;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  i {
    flex: 0 0 auto;
    font-style: normal;
  }
}

.campaign-card__features {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--violet-soft);
    color: var(--violet);
    font-size: 11px;
    font-weight: 700;
  }
}

.campaign-card__action {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &.is-on {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-warn {
    background: var(--warning-soft);
    color: var(--warning);
  }

  &.is-danger {
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.campaign-form {
  display: grid;
  gap: 14px;
}

.campaign-form__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: max-content;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: var(--ink);
  }
}

.campaign-form__field {
  display: grid;
  gap: 6px;
  min-width: 0;

  > span {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }
}

.campaign-form__select {
  width: 100%;
}

.campaign-form__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.campaign-form__chip {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface-3);
  }

  &.is-active {
    background: var(--accent);
    color: var(--accent-on);
  }
}

.campaign-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.campaign-form__number {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);

  :deep(.el-input-number) {
    width: 100%;
  }

  :deep(.el-input__wrapper) {
    padding: 0;
    box-shadow: none;
    background: transparent;
  }

  em {
    flex: 0 0 auto;
    color: var(--ink-3);
    font-size: 12px;
    font-style: normal;
  }
}
</style>
