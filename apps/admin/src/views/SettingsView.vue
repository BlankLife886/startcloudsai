<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Coin, Connection, MagicStick, Operation } from '@element-plus/icons-vue'
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
const savedSignature = ref('')

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

function settingsSignature() {
  return JSON.stringify({
    prices: priceTypes.value.map((type) => [type, form.taskPricesYuan[type] ?? 0]),
    userMaxRunningTasks: form.userMaxRunningTasks,
    registrationEnabled: form.registrationEnabled,
    signupBonusYuan: form.signupBonusYuan,
    taskModelDefault: form.taskModelDefault,
    taskModelOverrides: TASK_TYPES.map((type) => [type, form.taskModelOverrides[type] ?? '']),
    c2aBaseUrl: form.c2aBaseUrl,
    c2aApiKey: form.c2aApiKey,
    c2aTimeoutSecs: form.c2aTimeoutSecs,
  })
}

const isDirty = computed(() => !loading.value && savedSignature.value !== '' && settingsSignature() !== savedSignature.value)
const modelOverrideCount = computed(() =>
  TASK_TYPES.filter((type) => Boolean(form.taskModelOverrides[type]?.trim())).length,
)
const upstreamSource = computed(() => (form.c2aBaseUrl.trim() ? '后台覆盖地址' : '服务器环境变量'))
const timeoutLabel = computed(() => `${form.c2aTimeoutSecs > 0 ? form.c2aTimeoutSecs : 180} 秒`)

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
  savedSignature.value = settingsSignature()
}

async function load() {
  loading.value = true
  try {
    const settings = await request<AdminSettings>('/api/admin/settings')
    hydrate(settings)
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
  <div v-loading="loading" class="settings-page">
    <header class="settings-header">
      <div class="settings-header__copy">
        <span>CONTROL PLANE</span>
        <h1>系统设置</h1>
        <p>管理图片生成链路、模型路由、运营策略与任务计费</p>
      </div>
      <div class="settings-header__actions">
        <div class="save-state" :class="{ 'is-dirty': isDirty }" aria-live="polite">
          <span />
          {{ isDirty ? '有未保存变更' : '配置已同步' }}
        </div>
        <el-button type="primary" size="large" :icon="Check" :loading="saving" :disabled="!isDirty" @click="save">
          保存更改
        </el-button>
      </div>
    </header>

    <section class="settings-overview" aria-label="当前核心配置">
      <article class="overview-item is-upstream">
        <span class="overview-item__icon"><el-icon><Connection /></el-icon></span>
        <div>
          <small>生成上游</small>
          <strong>{{ upstreamSource }}</strong>
          <em :class="testResult ? (testResult.ok ? 'is-success' : 'is-danger') : ''">
            {{ testResult?.message || '尚未测试连通性' }}
          </em>
        </div>
      </article>
      <article class="overview-item">
        <span class="overview-item__icon is-model"><el-icon><MagicStick /></el-icon></span>
        <div>
          <small>默认模型</small>
          <strong :title="form.taskModelDefault || '未配置'">{{ form.taskModelDefault || '未配置' }}</strong>
          <em>{{ modelOverrideCount }} 个类型独立覆盖</em>
        </div>
      </article>
      <article class="overview-item">
        <span class="overview-item__icon is-operation"><el-icon><Operation /></el-icon></span>
        <div>
          <small>用户策略</small>
          <strong>{{ form.registrationEnabled ? '开放注册' : '暂停注册' }}</strong>
          <em>每用户最多 {{ form.userMaxRunningTasks }} 个并发任务</em>
        </div>
      </article>
      <article class="overview-item">
        <span class="overview-item__icon is-price"><el-icon><Coin /></el-icon></span>
        <div>
          <small>任务计费</small>
          <strong>{{ priceTypes.length }} 个任务类型</strong>
          <em>注册赠送 {{ yuanToFen(form.signupBonusYuan) }} 分</em>
        </div>
      </article>
    </section>

    <div class="settings-grid">
      <!-- 任务单价 -->
      <PageCard class="settings-card is-pricing">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-warning"><el-icon :size="16"><Coin /></el-icon></span>
            <div>
              <div class="page-card__title">任务计费</div>
              <div class="page-card__subtitle">用户每生成一张图片时扣除的金额</div>
            </div>
          </div>
        </template>
        <template #actions><span class="section-count">人民币</span></template>
        <div class="price-grid">
          <div v-for="type in priceTypes" :key="type" class="price-cell">
            <div class="price-cell__label">{{ taskTypeLabel(type) }}</div>
            <el-input-number
              v-model="form.taskPricesYuan[type]"
              :min="0"
              :max="100000"
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
      <PageCard class="settings-card is-models">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-accent"><el-icon :size="16"><MagicStick /></el-icon></span>
            <div>
              <div class="page-card__title">任务模型</div>
              <div class="page-card__subtitle">默认模型兜底，可按类型单独覆盖</div>
            </div>
          </div>
        </template>
        <template #actions>
          <span class="section-count">{{ modelOverrideCount }} / {{ TASK_TYPES.length }} 已覆盖</span>
        </template>
        <div class="model-default priority-field">
          <span class="model-default__label">默认任务模型 <em>*</em></span>
          <small>所有未单独指定模型的任务均使用此值</small>
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
      <PageCard class="settings-card is-operations">
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
          <div class="setting-row is-highlighted">
            <div class="setting-row__copy">
              <div class="setting-row__label">用户注册</div>
              <div class="setting-row__desc">
                {{ form.registrationEnabled ? '当前允许新用户创建账号' : '当前已暂停新用户注册' }}
              </div>
            </div>
            <el-switch v-model="form.registrationEnabled" inline-prompt active-text="开" inactive-text="关" />
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
              :max="100000"
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
      <PageCard class="settings-card is-upstream">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-info"><el-icon :size="16"><Connection /></el-icon></span>
            <div>
              <div class="page-card__title">图片生成上游</div>
              <div class="page-card__subtitle">核心生成链路，修改后新任务立即使用</div>
            </div>
          </div>
        </template>
        <template #actions>
          <span class="config-badge">{{ upstreamSource }}</span>
          <el-button :loading="testing" @click="testC2a">测试连通</el-button>
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
              <div class="setting-row__desc">当前有效等待时间：{{ timeoutLabel }}</div>
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
.settings-page {
  display: grid;
  max-width: 1440px;
  gap: 14px;
  padding: 24px 28px 36px;
}

.settings-header {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 70px;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(14px);
}

.settings-header__copy {
  display: grid;
  min-width: 0;
  gap: 2px;

  > span {
    color: var(--accent-ink);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.08em;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    color: var(--ink);
    font-size: 21px;
    line-height: 1.25;
  }

  p {
    color: var(--ink-3);
    font-size: 12px;
  }
}

.settings-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.save-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font-size: 12px;

  span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-soft);
  }

  &.is-dirty {
    color: var(--warning);

    span {
      background: var(--warning);
      box-shadow: 0 0 0 3px var(--warning-soft);
    }
  }
}

.settings-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.overview-item {
  display: grid;
  min-width: 0;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 13px 14px;

  & + & {
    border-left: 1px solid var(--border);
  }

  > div {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  small,
  strong,
  em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--ink-3);
    font-size: 10px;
  }

  strong {
    color: var(--ink);
    font-size: 13px;
    font-weight: 650;
  }

  em {
    color: var(--ink-3);
    font-size: 10px;
    font-style: normal;
  }

  em.is-success {
    color: var(--success);
  }

  em.is-danger {
    color: var(--danger);
  }
}

.overview-item__icon,
.card-head__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--info);
  background: var(--info-soft);
}

.overview-item__icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;

  &.is-model {
    color: var(--accent-ink);
    background: var(--accent-soft);
  }

  &.is-operation {
    color: var(--success);
    background: var(--success-soft);
  }

  &.is-price {
    color: var(--warning);
    background: var(--warning-soft);
  }
}

.settings-grid {
  display: grid;
  grid-template-areas:
    'upstream upstream'
    'models operations'
    'pricing pricing';
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.8fr);
  gap: 14px;
  align-items: start;
}

.settings-card {
  min-width: 0;
  border-radius: 8px;

  &.is-upstream {
    grid-area: upstream;
    border-top: 3px solid var(--info);
  }

  &.is-models {
    grid-area: models;
  }

  &.is-operations {
    grid-area: operations;
  }

  &.is-pricing {
    grid-area: pricing;
  }
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-head__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
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
  font-weight: 650;
}

.page-card__subtitle {
  color: var(--ink-3);
  font-size: 12px;
  margin-top: 1px;
}

.section-count,
.config-badge {
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
  background: var(--surface-3);
}

.config-badge {
  color: var(--info);
  background: var(--info-soft);
}

.is-upstream .setting-rows {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.52fr);
  gap: 12px 18px;
}

.is-upstream .setting-row {
  padding: 0;
  border: 0;
}

.is-upstream .setting-row:first-child {
  grid-column: 1 / -1;
}

.price-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.price-cell {
  display: grid;
  min-width: 0;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  transition: border-color 0.15s ease;
}

.price-cell:hover {
  border-color: var(--border-strong);
}

.price-cell__label {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price-cell__input {
  width: 100%;
}

.price-cell__hint,
.priority-field small {
  color: var(--ink-3);
  font-size: 10px;
}

.model-default {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.priority-field {
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 7px;
  background: var(--accent-soft);
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

.setting-row.is-highlighted {
  margin-bottom: 2px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--success) 22%, var(--border));
  border-radius: 7px;
  background: var(--success-soft);
}

.setting-row.is-highlighted + .setting-row {
  border-top: 0;
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

@media (max-width: 1180px) {
  .settings-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-item:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--border);
  }

  .overview-item:nth-child(4) {
    border-top: 1px solid var(--border);
  }

  .settings-grid {
    grid-template-areas:
      'upstream'
      'models'
      'operations'
      'pricing';
    grid-template-columns: 1fr;
  }

  .price-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .settings-page {
    padding: 12px;
  }

  .settings-header {
    position: static;
    align-items: flex-start;
  }

  .settings-header__copy p,
  .save-state {
    display: none;
  }

  .settings-overview {
    grid-template-columns: 1fr;
  }

  .overview-item + .overview-item {
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .is-upstream .setting-rows,
  .model-grid {
    grid-template-columns: 1fr;
  }

  .is-upstream .setting-row:first-child {
    grid-column: auto;
  }

  .price-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
