<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Back,
  Delete,
  Edit,
  Plus,
  Setting,
  SwitchButton,
  VideoPlay,
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

const dialogSubtitle = computed(() =>
  mode.value === 'list'
    ? '同一时间只允许一个活动启用，历史活动与申请记录独立保留'
    : '配置真实功能、准入方式和活动名额',
)

const editingCampaign = computed(() =>
  campaigns.value.find((campaign) => campaign.id === editingId.value),
)
const featureSelectionLocked = computed(() => (editingCampaign.value?.actualApplied || 0) > 0)

const statusLabel: Record<string, string> = {
  active: '启用中',
  draft: '草稿',
  closed: '已关闭',
}

const statusType: Record<string, 'success' | 'info' | 'warning'> = {
  active: 'success',
  draft: 'info',
  closed: 'warning',
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
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
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
</script>

<template>
  <el-button :icon="Setting" @click="open = true">活动管理</el-button>

  <AdminDialog
    v-model="open"
    :title="dialogTitle"
    :subtitle="dialogSubtitle"
    :icon="Setting"
    width="960px"
    :hide-footer="mode === 'list'"
    :confirm-text="editingId ? '保存修改' : '创建活动'"
    cancel-text="返回列表"
    :confirm-loading="saving"
    :confirm-disabled="loading || features.length === 0"
    @open="load"
    @cancel="backToList"
    @confirm="save"
    @closed="backToList"
  >
    <div v-loading="loading" class="trial-campaign-manager">
      <template v-if="mode === 'list'">
        <div class="trial-campaign-manager__toolbar">
          <div>
            <strong>{{ campaigns.length }} 期活动</strong>
            <small>启用新活动时，当前活动会在同一事务内关闭</small>
          </div>
          <el-button type="primary" :icon="Plus" @click="resetForm()">新建活动</el-button>
        </div>

        <el-table :data="campaigns" height="480" size="small" table-layout="fixed">
          <template #empty>
            <el-empty description="暂无体验活动" :image-size="64" />
          </template>
          <el-table-column label="活动" min-width="210">
            <template #default="{ row }">
              <div class="trial-campaign-manager__identity">
                <strong>{{ row.title }}</strong>
                <small>截止 {{ formatDate(row.expiresAt) }} · {{ formatRemaining(row as TrialCampaign) }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="92" align="center">
            <template #default="{ row }">
              <el-tag :type="isExpired(row as TrialCampaign) ? 'danger' : statusType[row.status]" size="small" effect="light">
                {{ isExpired(row as TrialCampaign) ? '已过期' : statusLabel[row.status] || row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="体验功能" min-width="220">
            <template #default="{ row }">
              <div class="trial-campaign-manager__features">
                <el-tag
                  v-for="feature in row.features"
                  :key="feature.key"
                  size="small"
                  effect="plain"
                >{{ feature.label }}</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="名额 / 申请" width="116" align="center">
            <template #default="{ row }">
              <span class="trial-campaign-manager__number">
                {{ row.actualApplied.toLocaleString('zh-CN') }} / {{ row.capacity.toLocaleString('zh-CN') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="255" fixed="right" align="right">
            <template #default="{ row }">
              <div class="trial-campaign-manager__actions">
                <el-tooltip content="编辑活动" placement="top">
                  <el-button circle text :icon="Edit" @click="resetForm(row as TrialCampaign)" />
                </el-tooltip>
                <el-button
                  v-if="row.status !== 'active'"
                  size="small"
                  type="success"
                  plain
                  :icon="VideoPlay"
                  :disabled="isExpired(row as TrialCampaign)"
                  @click="activate(row as TrialCampaign)"
                >启用</el-button>
                <el-button
                  v-else
                  size="small"
                  type="warning"
                  plain
                  :icon="SwitchButton"
                  @click="closeCampaign(row as TrialCampaign)"
                >关闭</el-button>
                <el-tooltip
                  :content="row.actualApplied > 0 ? '已有申请记录，不能删除' : '删除活动'"
                  placement="top"
                >
                  <el-button
                    circle
                    text
                    type="danger"
                    :icon="Delete"
                    :disabled="row.status === 'active' || row.actualApplied > 0"
                    @click="remove(row as TrialCampaign)"
                  />
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <template v-else>
        <el-button text :icon="Back" class="trial-campaign-manager__back" @click="backToList">
          返回活动列表
        </el-button>
        <section class="module-settings-section">
          <div class="module-settings-grid">
            <div class="module-settings-field module-settings-field--wide module-settings-field--stack">
              <div class="module-settings-field__copy">
                <strong>活动标题</strong>
                <small>显示在用户体验资格入口和申请弹窗中</small>
              </div>
              <el-input v-model="form.title" maxlength="60" show-word-limit />
            </div>
            <div class="module-settings-field module-settings-field--wide">
              <div class="module-settings-field__copy">
                <strong>活动截止时间</strong>
                <small>到期后自动关闭入口，并停止申请、审核、积分领取和体验积分使用</small>
              </div>
              <el-date-picker
                v-model="form.expiresAt"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                placeholder="选择活动截止时间"
                :shortcuts="expiryShortcuts"
                :clearable="false"
              />
            </div>
            <div class="module-settings-field module-settings-field--wide module-settings-field--stack">
              <div class="module-settings-field__copy">
                <strong>体验功能</strong>
                <small v-if="featureSelectionLocked">已有申请记录，为保证历史授权一致，体验功能不可修改</small>
                <small v-else>审核通过后全部授权，体验积分可在所选功能中通用</small>
              </div>
              <el-select
                v-model="form.featureKeys"
                class="module-settings-feature-select"
                popper-class="module-settings-feature-popper"
                placeholder="选择一个或多个真实功能"
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
            </div>
            <div class="module-settings-field module-settings-field--wide">
              <div class="module-settings-field__copy">
                <strong>体验方式</strong>
                <small>权限内测会限制未通过用户提交所选功能任务</small>
              </div>
              <el-segmented
                v-model="form.accessMode"
                :options="[
                  { label: '功能专属积分', value: 'credit_only' },
                  { label: '权限内测', value: 'restricted' },
                ]"
              />
            </div>
            <div class="module-settings-field">
              <div class="module-settings-field__copy">
                <strong>活动总名额</strong>
                <small>达到上限后原子停止接收新申请</small>
              </div>
              <div class="module-settings-control">
                <el-input-number v-model="form.capacity" :min="1" :max="1000000" :precision="0" />
                <span>人</span>
              </div>
            </div>
            <div class="module-settings-field">
              <div class="module-settings-field__copy">
                <strong>展示人数调整</strong>
                <small>展示申请数 = 真实申请数 + 调整值</small>
              </div>
              <div class="module-settings-control">
                <el-input-number
                  v-model="form.displayOffset"
                  :min="-1000000"
                  :max="1000000"
                  :precision="0"
                />
                <span>人</span>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </AdminDialog>
</template>

<style scoped>
.trial-campaign-manager {
  min-height: 220px;
}

.trial-campaign-manager__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
}

.trial-campaign-manager__toolbar strong,
.trial-campaign-manager__toolbar small,
.trial-campaign-manager__identity strong,
.trial-campaign-manager__identity small {
  display: block;
}

.trial-campaign-manager__toolbar strong,
.trial-campaign-manager__identity strong {
  color: var(--ink);
  font-size: 13px;
}

.trial-campaign-manager__toolbar small,
.trial-campaign-manager__identity small {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: 11px;
}

.trial-campaign-manager__features {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.trial-campaign-manager__number {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.trial-campaign-manager__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.trial-campaign-manager__back {
  margin-bottom: 10px;
}
</style>
