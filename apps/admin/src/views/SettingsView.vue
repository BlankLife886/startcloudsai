<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Coin, Connection, MagicStick, Operation } from '@element-plus/icons-vue'
import { request } from '@/request'
import { fenToYuanNumber, TASK_TYPES, taskTypeLabel, yuanToFen } from '@/utils'

interface AdminSettings {
  taskPrices?: Record<string, number>
  userMaxRunningTasks?: number
  registrationEnabled?: boolean
  signupBonusCents?: number
  taskModels?: Record<string, string>
  c2aBaseUrl?: string
  /** 只回传掩码（****xxxx）；提交掩码或空 = 不修改 */
  c2aApiKey?: string
  c2aTimeoutSecs?: number
}

const loading = ref(false)
const saving = ref(false)

const priceTypes = ref<string[]>([...TASK_TYPES])

const form = reactive({
  taskPricesYuan: {} as Record<string, number>,
  userMaxRunningTasks: 3,
  registrationEnabled: true,
  signupBonusYuan: 0,
  taskModelDefault: '',
  taskModelOverrides: {} as Record<string, string>,
  c2aBaseUrl: '',
  c2aApiKey: '',
  c2aTimeoutSecs: 0,
})

/** 服务端返回的 Key 掩码（空串 = 后台未配置，走环境变量） */
const c2aKeyMask = ref('')

function hydrate(settings: AdminSettings) {
  const prices = settings.taskPrices ?? {}
  priceTypes.value = [...new Set([...TASK_TYPES, ...Object.keys(prices)])]
  const pricesYuan: Record<string, number> = {}
  for (const type of priceTypes.value) pricesYuan[type] = fenToYuanNumber(prices[type])
  form.taskPricesYuan = pricesYuan
  form.userMaxRunningTasks = settings.userMaxRunningTasks ?? 3
  form.registrationEnabled = settings.registrationEnabled ?? true
  form.signupBonusYuan = fenToYuanNumber(settings.signupBonusCents)
  const models = settings.taskModels ?? {}
  form.taskModelDefault = models.default ?? ''
  const overrides: Record<string, string> = {}
  for (const type of TASK_TYPES) overrides[type] = models[type] ?? ''
  form.taskModelOverrides = overrides
  form.c2aBaseUrl = settings.c2aBaseUrl ?? ''
  form.c2aTimeoutSecs = settings.c2aTimeoutSecs ?? 0
  c2aKeyMask.value = settings.c2aApiKey ?? ''
  form.c2aApiKey = ''
}

async function load() {
  loading.value = true
  try {
    hydrate(await request<AdminSettings>('/api/admin/settings'))
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save() {
  if (!form.taskModelDefault.trim()) {
    ElMessage.warning('请填写默认任务模型')
    return
  }
  const baseUrl = form.c2aBaseUrl.trim()
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    ElMessage.warning('chatgpt2api 地址须以 http:// 或 https:// 开头')
    return
  }
  const taskPrices: Record<string, number> = {}
  for (const type of priceTypes.value) taskPrices[type] = yuanToFen(form.taskPricesYuan[type])
  const taskModels: Record<string, string> = { default: form.taskModelDefault.trim() }
  for (const type of TASK_TYPES) {
    const model = form.taskModelOverrides[type]?.trim()
    if (model) taskModels[type] = model
  }
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      taskPrices,
      userMaxRunningTasks: form.userMaxRunningTasks,
      registrationEnabled: form.registrationEnabled,
      signupBonusCents: yuanToFen(form.signupBonusYuan),
      taskModels,
      c2aBaseUrl: baseUrl,
      c2aTimeoutSecs: form.c2aTimeoutSecs,
    }
    const newKey = form.c2aApiKey.trim()
    if (newKey) body.c2aApiKey = newKey
    hydrate(await request<AdminSettings>('/api/admin/settings', { method: 'PUT', body }))
    ElMessage.success('设置已保存')
  } finally {
    saving.value = false
  }
}

// 测试 chatgpt2api 连通（带表单当前值，可保存前先验证）
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

async function testC2a() {
  testing.value = true
  testResult.value = null
  try {
    const body: Record<string, string> = {}
    if (form.c2aBaseUrl.trim()) body.baseUrl = form.c2aBaseUrl.trim()
    if (form.c2aApiKey.trim()) body.apiKey = form.c2aApiKey.trim()
    const data = await request<{ models?: string[]; modelCount?: number }>(
      '/api/admin/settings/test-c2a',
      { method: 'POST', body, silent: true },
    )
    const count = data.modelCount ?? data.models?.length
    testResult.value = {
      ok: true,
      message: count !== undefined ? `连通正常，可用模型 ${count} 个` : '连通正常',
    }
  } catch (err) {
    testResult.value = {
      ok: false,
      message: `连通失败：${err instanceof Error ? err.message : '未知错误'}`,
    }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-header">
      <div style="margin-right: auto">
        <div class="title">系统设置</div>
        <div class="text-muted" style="margin-top: 2px">计费、模型与上游服务配置，保存后立即生效</div>
      </div>
      <el-button type="primary" size="large" :loading="saving" @click="save">保存全部设置</el-button>
    </div>

    <div class="settings-grid">
      <!-- 任务单价 -->
      <PageCard>
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-warning"><el-icon :size="16"><Coin /></el-icon></span>
            <div>
              <div class="page-card__title">任务单价</div>
              <div class="page-card__subtitle">每张图的扣费金额（元）</div>
            </div>
          </div>
        </template>
        <div class="price-grid">
          <div v-for="type in priceTypes" :key="type" class="price-cell">
            <div class="price-cell__label">{{ taskTypeLabel(type) }}</div>
            <el-input-number
              v-model="form.taskPricesYuan[type]"
              :min="0"
              :precision="2"
              :step="0.1"
              controls-position="right"
              class="price-cell__input"
            />
            <div class="price-cell__hint tnum">{{ yuanToFen(form.taskPricesYuan[type]) }} 分 / 张</div>
          </div>
        </div>
      </PageCard>

      <!-- 任务模型 -->
      <PageCard>
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-accent"><el-icon :size="16"><MagicStick /></el-icon></span>
            <div>
              <div class="page-card__title">任务模型</div>
              <div class="page-card__subtitle">默认模型兜底，可按类型单独覆盖</div>
            </div>
          </div>
        </template>
        <div class="model-default">
          <span class="model-default__label">默认模型 <em>*</em></span>
          <el-input v-model="form.taskModelDefault" placeholder="如 gpt-image-2" />
        </div>
        <div class="model-grid">
          <div v-for="type in TASK_TYPES" :key="type" class="model-cell">
            <span class="model-cell__label">{{ taskTypeLabel(type) }}</span>
            <el-input
              v-model="form.taskModelOverrides[type]"
              :placeholder="form.taskModelDefault || 'gpt-image-2'"
              clearable
            />
          </div>
        </div>
        <div class="text-muted" style="margin-top: 10px">留空的类型自动使用默认模型</div>
      </PageCard>

      <!-- 运营配置 -->
      <PageCard>
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-success"><el-icon :size="16"><Operation /></el-icon></span>
            <div>
              <div class="page-card__title">运营配置</div>
              <div class="page-card__subtitle">注册与任务并发策略</div>
            </div>
          </div>
        </template>
        <div class="setting-rows">
          <div class="setting-row">
            <div class="setting-row__copy">
              <div class="setting-row__label">开放注册</div>
              <div class="setting-row__desc">关闭后新用户无法注册，已有用户不受影响</div>
            </div>
            <el-switch v-model="form.registrationEnabled" />
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <div class="setting-row__label">注册赠送</div>
              <div class="setting-row__desc">
                新用户注册即入账，当前 = {{ yuanToFen(form.signupBonusYuan) }} 分
              </div>
            </div>
            <el-input-number
              v-model="form.signupBonusYuan"
              :min="0"
              :precision="2"
              :step="0.5"
              controls-position="right"
              style="width: 140px"
            />
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <div class="setting-row__label">单用户并发上限</div>
              <div class="setting-row__desc">同时处于排队 / 生成中的任务数量上限</div>
            </div>
            <el-input-number
              v-model="form.userMaxRunningTasks"
              :min="1"
              :max="100"
              controls-position="right"
              style="width: 140px"
            />
          </div>
        </div>
      </PageCard>

      <!-- chatgpt2api -->
      <PageCard>
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-info"><el-icon :size="16"><Connection /></el-icon></span>
            <div>
              <div class="page-card__title">chatgpt2api 服务</div>
              <div class="page-card__subtitle">图片生成上游，修改后新任务立即使用，无需重启</div>
            </div>
          </div>
          <div class="page-card__actions">
            <el-button :loading="testing" @click="testC2a">测试连通</el-button>
          </div>
        </template>
        <div class="setting-rows">
          <div class="setting-row is-stack">
            <div class="setting-row__copy">
              <div class="setting-row__label">服务地址</div>
              <div class="setting-row__desc">留空 = 使用服务器环境变量</div>
            </div>
            <el-input v-model="form.c2aBaseUrl" placeholder="http://your-server:3000" clearable />
          </div>
          <div class="setting-row is-stack">
            <div class="setting-row__copy">
              <div class="setting-row__label">API Key</div>
              <div class="setting-row__desc">
                {{ c2aKeyMask ? `已配置（${c2aKeyMask}），输入新值可替换` : '留空 = 使用服务器环境变量' }}
              </div>
            </div>
            <el-input
              v-model="form.c2aApiKey"
              type="password"
              show-password
              :placeholder="c2aKeyMask ? '输入新 Key 以替换' : '粘贴 auth-key'"
            />
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <div class="setting-row__label">请求超时</div>
              <div class="setting-row__desc">生成图片的最长等待秒数，0 = 默认 180 秒</div>
            </div>
            <el-input-number
              v-model="form.c2aTimeoutSecs"
              :min="0"
              :max="600"
              :step="30"
              controls-position="right"
              style="width: 140px"
            />
          </div>
        </div>
        <el-alert
          v-if="testResult"
          :type="testResult.ok ? 'success' : 'error'"
          :title="testResult.message"
          :closable="false"
          style="margin-top: 14px"
        />
        <div class="text-muted" style="margin-top: 10px">
          测试使用上方表单当前填写的值（未填则用已保存配置），可在保存前先验证
        </div>
      </PageCard>
    </div>
  </div>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
  max-width: 1200px;
}

@media (max-width: 1100px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}

/* 卡片头：彩色图标块 + 标题组（对齐 StatCard 语言） */
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-head__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  flex-shrink: 0;
}

.card-head__icon.is-accent {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.card-head__icon.is-success {
  background: var(--success-soft);
  color: var(--success);
}

.card-head__icon.is-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.card-head__icon.is-info {
  background: var(--info-soft);
  color: var(--info);
}

.page-card__title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.page-card__subtitle {
  color: var(--ink-3);
  font-size: 12px;
  margin-top: 1px;
}

/* 单价：紧凑网格 */
.price-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 560px) {
  .price-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.price-cell {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  display: grid;
  gap: 8px;
  transition: border-color 0.15s ease;
}

.price-cell:hover {
  border-color: var(--border-strong);
}

.price-cell__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-2);
}

.price-cell__input {
  width: 100%;
}

.price-cell__hint {
  color: var(--ink-3);
  font-size: 12px;
}

/* 模型配置 */
.model-default {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.model-default__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-2);
}

.model-default__label em {
  color: var(--danger);
  font-style: normal;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.model-cell {
  display: grid;
  gap: 6px;
}

.model-cell__label {
  font-size: 12px;
  color: var(--ink-3);
}

/* 设置行：左标签描述 + 右控件 */
.setting-rows {
  display: grid;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 13px 0;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border);
}

.setting-row.is-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.setting-row__copy {
  min-width: 0;
}

.setting-row__label {
  font-size: 14px;
  font-weight: 500;
}

.setting-row__desc {
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}
</style>
