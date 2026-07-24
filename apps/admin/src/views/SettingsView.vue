<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ChatDotRound,
  Check,
  Coin,
  Connection,
  MagicStick,
  Operation,
} from '@element-plus/icons-vue'
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
  sub2apiBaseUrl?: string
  /** 只回传掩码（****xxxx）；提交掩码或空 = 不修改 */
  sub2apiApiKey?: string
  sub2apiChatModel?: string
  sub2apiChatModels?: Record<string, string>
  sub2apiImageModel?: string
  sub2apiTimeoutSecs?: number
}

interface ModelMapping {
  label: string
  model: string
}

const loading = ref(false)
const saving = ref(false)
const savedSignature = ref('')
const activeSection = ref<'models' | 'business'>('models')

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
  sub2apiBaseUrl: '',
  sub2apiApiKey: '',
  sub2apiChatModel: '',
  sub2apiChatModels: [] as ModelMapping[],
  sub2apiImageModel: '',
  sub2apiTimeoutSecs: 0,
})

/** 服务端返回的 Key 掩码（空串 = 后台未配置，走环境变量） */
const c2aKeyMask = ref('')
const sub2apiKeyMask = ref('')
const clearSub2apiKey = ref(false)

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
    sub2apiBaseUrl: form.sub2apiBaseUrl,
    sub2apiApiKey: form.sub2apiApiKey,
    clearSub2apiKey: clearSub2apiKey.value,
    sub2apiChatModel: form.sub2apiChatModel,
    sub2apiChatModels: form.sub2apiChatModels.map(({ label, model }) => [label, model]),
    sub2apiImageModel: form.sub2apiImageModel,
    sub2apiTimeoutSecs: form.sub2apiTimeoutSecs,
  })
}

const isDirty = computed(
  () =>
    !loading.value && savedSignature.value !== '' && settingsSignature() !== savedSignature.value,
)
const modelOverrideCount = computed(
  () => TASK_TYPES.filter((type) => Boolean(form.taskModelOverrides[type]?.trim())).length,
)
const upstreamSource = computed(() => (form.c2aBaseUrl.trim() ? '后台覆盖地址' : '服务器环境变量'))
const timeoutLabel = computed(() => `${form.c2aTimeoutSecs > 0 ? form.c2aTimeoutSecs : 180} 秒`)
const sub2apiSource = computed(() => (form.sub2apiBaseUrl.trim() ? '后台配置' : '服务器环境变量'))
const sub2apiTimeoutLabel = computed(
  () => `${form.sub2apiTimeoutSecs > 0 ? form.sub2apiTimeoutSecs : 300} 秒`,
)
const c2aModels = ref<string[]>([])
const c2aModelTotal = ref(0)
const c2aModelsTruncated = ref(false)
const sub2apiModels = ref<string[]>([])
const sub2apiModelTotal = ref(0)
const sub2apiModelsTruncated = ref(false)

function uniqueModels(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

const c2aModelOptions = computed(() =>
  uniqueModels([
    ...c2aModels.value,
    form.taskModelDefault,
    ...Object.values(form.taskModelOverrides),
  ]),
)

function looksLikeImageModel(model: string) {
  return /image|dall[-_. ]?e|picture|flux|midjourney/i.test(model)
}

const sub2apiChatCandidates = computed(() => {
  const filtered = sub2apiModels.value.filter((model) => !looksLikeImageModel(model))
  return uniqueModels([
    ...filtered,
    form.sub2apiChatModel,
    ...form.sub2apiChatModels.map((item) => item.model),
  ])
})
const sub2apiImageCandidates = computed(() => {
  const suggested = sub2apiModels.value.filter(looksLikeImageModel)
  return uniqueModels([...suggested, form.sub2apiImageModel, ...sub2apiModels.value])
})
const selectedAssistantModelIds = computed<string[]>({
  get: () => form.sub2apiChatModels.map((item) => item.model),
  set: (models) => {
    const existing = new Map(form.sub2apiChatModels.map((item) => [item.model, item]))
    form.sub2apiChatModels = uniqueModels(models).map((model) => ({
      model,
      label: existing.get(model)?.label || model,
    }))
  },
})

function syncDiscoveredChatModels() {
  const models = sub2apiChatCandidates.value.slice(0, 40)
  selectedAssistantModelIds.value = models
  ElMessage.success(`已同步 ${models.length} 个对话模型，可继续修改显示名称`)
}

function setDefaultTaskModel(model: string) {
  form.taskModelDefault = model
  ElMessage.success(`默认任务模型已选择 ${model}`)
}

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
  form.sub2apiBaseUrl = settings.sub2apiBaseUrl ?? ''
  form.sub2apiChatModel = settings.sub2apiChatModel ?? ''
  form.sub2apiChatModels = Object.entries(settings.sub2apiChatModels ?? {}).map(
    ([label, model]) => ({ label, model }),
  )
  form.sub2apiImageModel = settings.sub2apiImageModel ?? ''
  form.sub2apiTimeoutSecs = settings.sub2apiTimeoutSecs ?? 0
  sub2apiKeyMask.value = settings.sub2apiApiKey ?? ''
  form.sub2apiApiKey = ''
  clearSub2apiKey.value = false
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

onMounted(async () => {
  await load()
  void testC2a()
  void testSub2api()
})

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
  const sub2apiBaseUrl = form.sub2apiBaseUrl.trim()
  if (sub2apiBaseUrl && !/^https?:\/\//.test(sub2apiBaseUrl)) {
    ElMessage.warning('Sub2API 地址须以 http:// 或 https:// 开头')
    return
  }
  const taskPrices: Record<string, number> = {}
  for (const type of priceTypes.value) taskPrices[type] = yuanToFen(form.taskPricesYuan[type])
  const taskModels: Record<string, string> = {
    default: form.taskModelDefault.trim(),
  }
  const sub2apiChatModels: Record<string, string> = {}
  for (const [index, item] of form.sub2apiChatModels.entries()) {
    const label = item.label.trim()
    const model = item.model.trim()
    if (!label || !model) {
      ElMessage.warning(`第 ${index + 1} 个可选对话模型缺少显示名称或模型 ID`)
      return
    }
    if (sub2apiChatModels[label] && sub2apiChatModels[label] !== model) {
      ElMessage.warning(`显示名称“${label}”重复，请修改后再保存`)
      return
    }
    sub2apiChatModels[label] = model
  }
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
      sub2apiBaseUrl,
      sub2apiChatModel: form.sub2apiChatModel.trim(),
      sub2apiChatModels,
      sub2apiImageModel: form.sub2apiImageModel.trim(),
      sub2apiTimeoutSecs: form.sub2apiTimeoutSecs,
    }
    const newKey = form.c2aApiKey.trim()
    if (newKey) body.c2aApiKey = newKey
    const newSub2apiKey = form.sub2apiApiKey.trim()
    if (newSub2apiKey) body.sub2apiApiKey = newSub2apiKey
    else if (clearSub2apiKey.value) body.sub2apiApiKey = ''
    hydrate(
      await request<AdminSettings>('/api/admin/settings', {
        method: 'PUT',
        body,
      }),
    )
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
    const data = await request<{ models?: string[]; modelCount?: number; truncated?: boolean }>(
      '/api/admin/settings/test-c2a',
      { method: 'POST', body, silent: true },
    )
    const count = data.modelCount ?? data.models?.length
    c2aModels.value = uniqueModels(data.models ?? [])
    c2aModelTotal.value = count ?? c2aModels.value.length
    c2aModelsTruncated.value = data.truncated === true
    testResult.value = {
      ok: true,
      message: count !== undefined ? `连通正常，可用模型 ${count} 个` : '连通正常',
    }
  } catch (err) {
    c2aModels.value = []
    c2aModelTotal.value = 0
    testResult.value = {
      ok: false,
      message: `连通失败：${err instanceof Error ? err.message : '未知错误'}`,
    }
  } finally {
    testing.value = false
  }
}

const testingSub2api = ref(false)
const sub2apiTestResult = ref<{ ok: boolean; message: string } | null>(null)

async function testSub2api() {
  testingSub2api.value = true
  sub2apiTestResult.value = null
  try {
    const body: Record<string, string> = {}
    if (form.sub2apiBaseUrl.trim()) body.baseUrl = form.sub2apiBaseUrl.trim()
    if (form.sub2apiApiKey.trim()) body.apiKey = form.sub2apiApiKey.trim()
    if (form.sub2apiChatModel.trim()) body.chatModel = form.sub2apiChatModel.trim()
    if (form.sub2apiImageModel.trim()) body.imageModel = form.sub2apiImageModel.trim()
    const data = await request<{ models?: string[]; modelCount?: number; truncated?: boolean }>(
      '/api/admin/settings/test-sub2api',
      { method: 'POST', body, silent: true },
    )
    const count = data.modelCount ?? data.models?.length
    sub2apiModels.value = uniqueModels(data.models ?? [])
    sub2apiModelTotal.value = count ?? sub2apiModels.value.length
    sub2apiModelsTruncated.value = data.truncated === true
    sub2apiTestResult.value = {
      ok: true,
      message: count !== undefined ? `连通正常，可用模型 ${count} 个` : '连通正常',
    }
  } catch (err) {
    sub2apiModels.value = []
    sub2apiModelTotal.value = 0
    sub2apiTestResult.value = {
      ok: false,
      message: `连通失败：${err instanceof Error ? err.message : '未知错误'}`,
    }
  } finally {
    testingSub2api.value = false
  }
}

function onSub2apiKeyInput() {
  if (form.sub2apiApiKey.trim()) clearSub2apiKey.value = false
}

function clearSavedSub2apiKey() {
  form.sub2apiApiKey = ''
  clearSub2apiKey.value = true
  sub2apiTestResult.value = null
}
</script>

<template>
  <div v-loading="loading" class="settings-page">
    <header class="settings-header">
      <div class="settings-header__copy">
        <span>CONTROL PLANE</span>
        <h1>系统设置</h1>
        <p>连接上游、读取模型、选择启用范围，再配置运营与计费</p>
      </div>
      <div class="settings-header__actions">
        <div class="save-state" :class="{ 'is-dirty': isDirty }" aria-live="polite">
          <span />
          {{ isDirty ? '有未保存变更' : '配置已同步' }}
        </div>
        <el-button
          type="primary"
          size="large"
          :icon="Check"
          :loading="saving"
          :disabled="!isDirty"
          @click="save"
        >
          保存更改
        </el-button>
      </div>
    </header>

    <nav class="settings-section-tabs" aria-label="设置分类">
      <button
        type="button"
        :class="{ 'is-active': activeSection === 'models' }"
        @click="activeSection = 'models'"
      >
        <el-icon><Connection /></el-icon>
        <span><strong>模型与接口</strong><small>Base URL、密钥、模型读取与分配</small></span>
      </button>
      <button
        type="button"
        :class="{ 'is-active': activeSection === 'business' }"
        @click="activeSection = 'business'"
      >
        <el-icon><Operation /></el-icon>
        <span><strong>运营与计费</strong><small>注册、并发、赠送金额与任务单价</small></span>
      </button>
    </nav>

    <section
      class="settings-overview"
      :class="`is-${activeSection}-section`"
      aria-label="当前核心配置"
    >
      <article v-if="activeSection === 'models'" class="overview-item is-upstream">
        <span class="overview-item__icon"
          ><el-icon><Connection /></el-icon
        ></span>
        <div>
          <small>生成上游</small>
          <strong>{{ upstreamSource }}</strong>
          <em :class="testResult ? (testResult.ok ? 'is-success' : 'is-danger') : ''">
            {{ testResult?.message || '尚未测试连通性' }}
          </em>
        </div>
      </article>
      <article v-if="activeSection === 'models'" class="overview-item">
        <span class="overview-item__icon is-model"
          ><el-icon><MagicStick /></el-icon
        ></span>
        <div>
          <small>默认模型</small>
          <strong :title="form.taskModelDefault || '未配置'">{{
            form.taskModelDefault || '未配置'
          }}</strong>
          <em>{{ c2aModelTotal ? `已读取 ${c2aModelTotal} 个模型` : `${modelOverrideCount} 个类型独立覆盖` }}</em>
        </div>
      </article>
      <article v-if="activeSection === 'models'" class="overview-item">
        <span class="overview-item__icon is-assistant"
          ><el-icon><ChatDotRound /></el-icon
        ></span>
        <div>
          <small>AI 助手模型</small>
          <strong>{{ form.sub2apiChatModel || '未配置' }}</strong>
          <em :class="sub2apiTestResult ? (sub2apiTestResult.ok ? 'is-success' : 'is-danger') : ''">
            {{ sub2apiTestResult?.message || '尚未读取模型' }}
          </em>
        </div>
      </article>
      <article v-if="activeSection === 'business'" class="overview-item">
        <span class="overview-item__icon is-operation"
          ><el-icon><Operation /></el-icon
        ></span>
        <div>
          <small>用户策略</small>
          <strong>{{ form.registrationEnabled ? '开放注册' : '暂停注册' }}</strong>
          <em>每用户最多 {{ form.userMaxRunningTasks }} 个并发任务</em>
        </div>
      </article>
      <article v-if="activeSection === 'business'" class="overview-item">
        <span class="overview-item__icon is-price"
          ><el-icon><Coin /></el-icon
        ></span>
        <div>
          <small>任务计费</small>
          <strong>{{ priceTypes.length }} 个任务类型</strong>
          <em>注册赠送 {{ yuanToFen(form.signupBonusYuan) }} 分</em>
        </div>
      </article>
    </section>

    <div class="settings-grid" :class="`is-${activeSection}-section`">
      <!-- 任务单价 -->
      <PageCard v-if="activeSection === 'business'" class="settings-card is-pricing">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-warning"
              ><el-icon :size="16"><Coin /></el-icon
            ></span>
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
            <div class="price-cell__hint tnum">
              {{ yuanToFen(form.taskPricesYuan[type]) }} 分 / 张
            </div>
          </div>
        </div>
      </PageCard>

      <!-- 任务模型 -->
      <PageCard v-if="activeSection === 'models'" class="settings-card is-models">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-accent"
              ><el-icon :size="16"><MagicStick /></el-icon
            ></span>
            <div>
              <div class="page-card__title">③ 分配图片生成模型</div>
              <div class="page-card__subtitle">从上一步读取结果中选择，不再手工猜模型 ID</div>
            </div>
          </div>
        </template>
        <template #actions>
          <span class="section-count"
            >{{ modelOverrideCount }} / {{ TASK_TYPES.length }} 已覆盖</span
          >
        </template>
        <div class="model-default priority-field">
          <span class="model-default__label">默认任务模型 <em>*</em></span>
          <small>所有未单独指定模型的任务均使用此值</small>
          <el-select
            v-model="form.taskModelDefault"
            filterable
            allow-create
            default-first-option
            placeholder="先读取模型，或直接输入模型 ID"
            style="width: 100%"
          >
            <el-option v-for="model in c2aModelOptions" :key="model" :label="model" :value="model" />
          </el-select>
        </div>
        <div class="model-grid">
          <div v-for="type in TASK_TYPES" :key="type" class="model-cell">
            <span class="model-cell__label">{{ taskTypeLabel(type) }}</span>
            <el-select
              v-model="form.taskModelOverrides[type]"
              filterable
              allow-create
              default-first-option
              :placeholder="form.taskModelDefault || 'gpt-image-2'"
              clearable
              style="width: 100%"
            >
              <el-option
                v-for="model in c2aModelOptions"
                :key="`${type}-${model}`"
                :label="model"
                :value="model"
              />
            </el-select>
          </div>
        </div>
        <div class="text-muted" style="margin-top: 10px">留空的类型自动使用默认模型</div>
      </PageCard>

      <!-- 运营配置 -->
      <PageCard v-if="activeSection === 'business'" class="settings-card is-operations">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-success"
              ><el-icon :size="16"><Operation /></el-icon
            ></span>
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
            <el-switch
              v-model="form.registrationEnabled"
              inline-prompt
              active-text="开"
              inactive-text="关"
            />
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <div class="setting-row__label">注册赠送</div>
              <div class="setting-row__desc">
                新用户注册即入账，当前 =
                {{ yuanToFen(form.signupBonusYuan) }} 分
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
      <PageCard v-if="activeSection === 'models'" class="settings-card is-upstream">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-info"
              ><el-icon :size="16"><Connection /></el-icon
            ></span>
            <div>
              <div class="page-card__title">① 连接图片生成服务</div>
              <div class="page-card__subtitle">填写 Base URL 与密钥，然后读取实际可用模型</div>
            </div>
          </div>
        </template>
        <template #actions>
          <span class="config-badge">{{ upstreamSource }}</span>
          <el-button type="primary" plain :loading="testing" @click="testC2a()">
            {{ testing ? '正在读取' : '② 读取模型' }}
          </el-button>
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
                {{
                  c2aKeyMask
                    ? `已配置（${c2aKeyMask}），输入新值可替换`
                    : '留空 = 使用服务器环境变量'
                }}
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
        <div v-if="c2aModels.length" class="model-discovery">
          <div class="model-discovery__head">
            <div>
              <strong>Base URL 返回的模型</strong>
              <span>点击模型即可同步为默认任务模型</span>
            </div>
            <em>{{ c2aModels.length }}{{ c2aModelsTruncated ? ` / ${c2aModelTotal}` : '' }} 个</em>
          </div>
          <div class="model-chip-list">
            <button
              v-for="model in c2aModels"
              :key="model"
              type="button"
              class="model-chip"
              :class="{ 'is-selected': form.taskModelDefault === model }"
              @click="setDefaultTaskModel(model)"
            >
              <span>{{ model }}</span>
              <small>{{ form.taskModelDefault === model ? '当前默认' : '设为默认' }}</small>
            </button>
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

      <!-- Sub2API 对话与生图 -->
      <PageCard v-if="activeSection === 'models'" class="settings-card is-assistant">
        <template #header>
          <div class="card-head">
            <span class="card-head__icon is-assistant"
              ><el-icon :size="16"><ChatDotRound /></el-icon
            ></span>
            <div>
              <div class="page-card__title">AI 助手 · 接口与模型</div>
              <div class="page-card__subtitle">
                用户端AI助手的 Sub2API 网关配置，保存后立即生效
              </div>
            </div>
          </div>
        </template>
        <template #actions>
          <span class="config-badge is-assistant">{{ sub2apiSource }}</span>
          <el-button type="primary" plain :loading="testingSub2api" @click="testSub2api()">
            {{ testingSub2api ? '正在读取' : '读取模型' }}
          </el-button>
        </template>
        <div class="assistant-settings-grid">
          <div class="setting-row is-stack is-url">
            <div class="setting-row__copy">
              <div class="setting-row__label">服务地址</div>
              <div class="setting-row__desc">Sub2API 根地址，留空时使用服务器环境变量</div>
            </div>
            <el-input
              v-model="form.sub2apiBaseUrl"
              placeholder="http://host.docker.internal:8080"
              clearable
            />
          </div>
          <div class="setting-row is-stack is-key">
            <div class="setting-row__copy">
              <div class="setting-row__label">API Key</div>
              <div class="setting-row__desc">
                {{
                  clearSub2apiKey
                    ? '保存后清除后台 Key，并回退到服务器环境变量'
                    : sub2apiKeyMask
                      ? `已配置（${sub2apiKeyMask}），输入新值可替换`
                      : '留空时使用服务器环境变量'
                }}
              </div>
            </div>
            <el-input
              v-model="form.sub2apiApiKey"
              type="password"
              show-password
              autocomplete="new-password"
              @input="onSub2apiKeyInput"
              :placeholder="sub2apiKeyMask ? '输入新 Key 以替换' : '粘贴 Sub2API API Key'"
            />
            <div v-if="sub2apiKeyMask && !clearSub2apiKey" class="secret-actions">
              <el-button text type="danger" @click="clearSavedSub2apiKey">清除后台 Key</el-button>
            </div>
          </div>
          <div class="setting-row is-stack">
            <div class="setting-row__copy">
              <div class="setting-row__label">对话模型</div>
              <div class="setting-row__desc">留空时使用环境变量或默认模型</div>
            </div>
            <el-select
              v-model="form.sub2apiChatModel"
              filterable
              allow-create
              default-first-option
              clearable
              placeholder="选择 Base URL 返回的对话模型"
              style="width: 100%"
            >
              <el-option
                v-for="model in sub2apiChatCandidates"
                :key="`chat-${model}`"
                :label="model"
                :value="model"
              />
            </el-select>
          </div>
          <div class="setting-row is-stack">
            <div class="setting-row__copy">
              <div class="setting-row__label">用户可选对话模型</div>
              <div class="setting-row__desc">
                勾选后仅同步这些模型给用户端 Agent；未勾选时自动使用上游模型列表
              </div>
            </div>
            <div class="model-mapping-toolbar">
              <el-select
                v-model="selectedAssistantModelIds"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择允许用户使用的模型"
                style="width: 100%"
              >
                <el-option
                  v-for="model in sub2apiChatCandidates"
                  :key="`select-${model}`"
                  :label="model"
                  :value="model"
                />
              </el-select>
              <el-button :disabled="!sub2apiChatCandidates.length" @click="syncDiscoveredChatModels">
                全部同步
              </el-button>
            </div>
            <div v-if="form.sub2apiChatModels.length" class="model-mapping-list">
              <div v-for="item in form.sub2apiChatModels" :key="item.model" class="model-mapping-row">
                <span :title="item.model">{{ item.model }}</span>
                <el-input v-model="item.label" placeholder="用户端显示名称" />
              </div>
            </div>
          </div>
          <div class="setting-row is-stack">
            <div class="setting-row__copy">
              <div class="setting-row__label">生图模型</div>
              <div class="setting-row__desc">留空时使用环境变量或默认模型</div>
            </div>
            <el-select
              v-model="form.sub2apiImageModel"
              filterable
              allow-create
              default-first-option
              clearable
              placeholder="选择 Base URL 返回的生图模型"
              style="width: 100%"
            >
              <el-option
                v-for="model in sub2apiImageCandidates"
                :key="`image-${model}`"
                :label="model"
                :value="model"
              />
            </el-select>
          </div>
          <div class="setting-row is-timeout">
            <div class="setting-row__copy">
              <div class="setting-row__label">请求超时</div>
              <div class="setting-row__desc">当前有效等待时间：{{ sub2apiTimeoutLabel }}</div>
            </div>
            <el-input-number
              v-model="form.sub2apiTimeoutSecs"
              :min="0"
              :max="600"
              :step="30"
              controls-position="right"
              style="width: 140px"
            />
          </div>
        </div>
        <div v-if="sub2apiModels.length" class="model-discovery is-assistant">
          <div class="model-discovery__head">
            <div>
              <strong>Sub2API 返回的模型</strong>
              <span>已自动用于上方下拉选择，无需手工复制模型 ID</span>
            </div>
            <em>{{ sub2apiModels.length }}{{ sub2apiModelsTruncated ? ` / ${sub2apiModelTotal}` : '' }} 个</em>
          </div>
          <div class="model-summary">
            <span>建议对话模型 {{ sub2apiChatCandidates.length }} 个</span>
            <span>可选生图模型 {{ sub2apiImageCandidates.length }} 个</span>
          </div>
        </div>
        <el-alert
          v-if="sub2apiTestResult"
          :type="sub2apiTestResult.ok ? 'success' : 'error'"
          :title="sub2apiTestResult.message"
          :closable="false"
          style="margin-top: 14px"
        />
        <div class="text-muted" style="margin-top: 10px">
          测试使用当前填写的值；空字段读取已保存配置，再回退到服务器环境变量
        </div>
      </PageCard>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: grid;
  width: 100%;
  max-width: 1600px;
  box-sizing: border-box;
  gap: 16px;
  margin: 0 auto;
  padding: 20px 24px 36px;
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

.settings-section-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.settings-section-tabs button {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.settings-section-tabs button:hover {
  color: var(--ink-2);
  background: var(--surface-2);
}

.settings-section-tabs button.is-active {
  border-color: color-mix(in srgb, var(--accent) 26%, var(--border));
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.settings-section-tabs button > .el-icon {
  flex: 0 0 auto;
  font-size: 18px;
}

.settings-section-tabs button > span {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.settings-section-tabs strong {
  font-size: 13px;
}

.settings-section-tabs small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.settings-overview.is-models-section {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.settings-overview.is-business-section {
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

  &.is-assistant {
    color: var(--accent-ink);
    background: var(--accent-soft);
  }
}

.settings-grid {
  display: grid;
  grid-template-areas:
    'upstream upstream upstream upstream upstream assistant assistant assistant assistant assistant assistant assistant'
    'models models models models models models models models models models models models'
    'operations operations operations operations pricing pricing pricing pricing pricing pricing pricing pricing';
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.settings-grid.is-models-section {
  grid-template-areas:
    'upstream upstream upstream upstream upstream upstream upstream upstream upstream upstream upstream upstream'
    'models models models models models models models models models models models models'
    'assistant assistant assistant assistant assistant assistant assistant assistant assistant assistant assistant assistant';
}

.settings-grid.is-business-section {
  grid-template-areas:
    'operations operations operations operations pricing pricing pricing pricing pricing pricing pricing pricing';
}

.settings-card {
  min-width: 0;
  border-radius: 8px;

  &.is-upstream {
    grid-area: upstream;
    border-top: 3px solid var(--info);
  }

  &.is-assistant {
    grid-area: assistant;
    border-top: 3px solid var(--accent);
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

.card-head__icon.is-assistant {
  color: var(--accent-ink);
  background: var(--accent-soft);
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

.config-badge.is-assistant {
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.assistant-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
}

.model-discovery {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--info) 24%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--info-soft) 55%, var(--surface));
}

.model-discovery.is-assistant {
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
  background: color-mix(in srgb, var(--accent-soft) 52%, var(--surface));
}

.model-discovery__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.model-discovery__head > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.model-discovery__head strong {
  color: var(--ink);
  font-size: 13px;
}

.model-discovery__head span,
.model-discovery__head em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
}

.model-discovery__head em {
  flex: 0 0 auto;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--surface);
}

.model-chip-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  max-height: 216px;
  overflow: auto;
  padding-right: 3px;
  overscroll-behavior: contain;
}

.model-chip {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--ink-2);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.model-chip:hover,
.model-chip.is-selected {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--border));
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.model-chip span {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chip small {
  flex: 0 0 auto;
  color: inherit;
  font-size: 9px;
  opacity: 0.72;
}

.model-summary,
.model-mapping-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-summary span {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--ink-3);
  font-size: 10px;
  background: var(--surface);
}

.model-mapping-toolbar > :first-child {
  min-width: 0;
}

.model-mapping-list {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
  padding-right: 3px;
}

.model-mapping-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.85fr) minmax(160px, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
}

.model-mapping-row > span {
  overflow: hidden;
  color: var(--ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-settings-grid .setting-row {
  padding: 0;
  border: 0;
}

.assistant-settings-grid .is-url,
.assistant-settings-grid .is-key,
.assistant-settings-grid .is-timeout {
  grid-column: 1 / -1;
}

.secret-actions {
  display: flex;
  justify-content: flex-end;
  min-height: 24px;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
      'assistant'
      'models'
      'operations'
      'pricing';
    grid-template-columns: 1fr;
  }

  .settings-grid.is-models-section {
    grid-template-areas:
      'upstream'
      'models'
      'assistant';
  }

  .settings-grid.is-business-section {
    grid-template-areas:
      'operations'
      'pricing';
  }

  .price-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .model-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .settings-section-tabs {
    grid-template-columns: 1fr;
  }

  .overview-item + .overview-item {
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .is-upstream .setting-rows,
  .assistant-settings-grid,
  .model-grid {
    grid-template-columns: 1fr;
  }

  .is-upstream .setting-row:first-child {
    grid-column: auto;
  }

  .assistant-settings-grid .is-url,
  .assistant-settings-grid .is-key,
  .assistant-settings-grid .is-timeout {
    grid-column: auto;
  }

  .price-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .model-chip-list,
  .model-mapping-row {
    grid-template-columns: 1fr;
  }

  .model-mapping-toolbar,
  .model-summary {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
