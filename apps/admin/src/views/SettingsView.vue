<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { request } from '@/request'
import { fenToYuanNumber, TASK_TYPES, taskTypeLabel, yuanToFen } from '@/utils'

/**
 * /api/admin/settings 契约未给出具体字段名，按以下形状假定（见 README 契约疑问）。
 */
interface AdminSettings {
  taskPrices?: Record<string, number>
  userMaxRunningTasks?: number
  registrationEnabled?: boolean
  signupBonusCents?: number
  /** 任务模型：default 兜底 + 按类型可选覆盖（v2 增补） */
  taskModels?: Record<string, string>
  /** chatgpt2api 上游（空 = 使用服务器环境变量默认值） */
  c2aBaseUrl?: string
  /** 只回传掩码（****xxxx）；提交掩码或空 = 不修改 */
  c2aApiKey?: string
  c2aTimeoutSecs?: number
}

const loading = ref(false)
const saving = ref(false)

/** 展示的任务类型：已知 6 类 + 服务端返回的额外类型 */
const priceTypes = ref<string[]>([...TASK_TYPES])

const form = reactive({
  taskPricesYuan: {} as Record<string, number>,
  userMaxRunningTasks: 3,
  registrationEnabled: true,
  signupBonusYuan: 0,
  taskModelDefault: '',
  /** 各类型模型覆盖，空串 = 使用 default */
  taskModelOverrides: {} as Record<string, string>,
  c2aBaseUrl: '',
  c2aApiKey: '',
  c2aTimeoutSecs: 0,
})

/** 服务端返回的 Key 掩码（空串表示后台未配置过，走环境变量） */
const c2aKeyMask = ref('')

async function load() {
  loading.value = true
  try {
    const settings = await request<AdminSettings>('/api/admin/settings')
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
  const taskPrices: Record<string, number> = {}
  for (const type of priceTypes.value) taskPrices[type] = yuanToFen(form.taskPricesYuan[type])
  // 留空的类型不写入 taskModels，运行时回落到 default
  const taskModels: Record<string, string> = { default: form.taskModelDefault.trim() }
  for (const type of TASK_TYPES) {
    const model = form.taskModelOverrides[type]?.trim()
    if (model) taskModels[type] = model
  }
  const baseUrl = form.c2aBaseUrl.trim()
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    ElMessage.warning('chatgpt2api 地址须以 http:// 或 https:// 开头')
    return
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
    // 只有输入了新 Key 才提交；留空 = 不修改
    const newKey = form.c2aApiKey.trim()
    if (newKey) body.c2aApiKey = newKey
    const settings = await request<AdminSettings>('/api/admin/settings', {
      method: 'PUT',
      body,
    })
    c2aKeyMask.value = settings.c2aApiKey ?? ''
    form.c2aApiKey = ''
    ElMessage.success('设置已保存')
  } finally {
    saving.value = false
  }
}

// 测试 chatgpt2api 连通
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

async function testC2a() {
  testing.value = true
  testResult.value = null
  try {
    // 带上表单当前值：可以在保存前先验证新配置
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
    <div class="settings-stack">
      <PageCard title="任务单价（元 / 张）" subtitle="按任务类型计费，保存后立即生效">
        <el-form label-width="140px">
          <el-form-item v-for="type in priceTypes" :key="type" :label="taskTypeLabel(type)">
            <el-input-number
              v-model="form.taskPricesYuan[type]"
              :min="0"
              :precision="2"
              :step="0.1"
              style="width: 160px"
            />
            <span class="text-muted" style="margin-left: 8px">
              = {{ yuanToFen(form.taskPricesYuan[type]) }} 分
            </span>
          </el-form-item>
        </el-form>
      </PageCard>

      <PageCard title="任务模型" subtitle="默认模型兜底，可按类型单独覆盖">
        <el-form label-width="140px">
          <el-form-item label="默认模型" required>
            <el-input
              v-model="form.taskModelDefault"
              placeholder="如 gpt-image-2"
              style="width: 260px"
            />
            <span class="text-muted" style="margin-left: 8px">未单独配置的类型使用此模型</span>
          </el-form-item>
          <el-form-item v-for="type in TASK_TYPES" :key="type" :label="taskTypeLabel(type)">
            <el-input
              v-model="form.taskModelOverrides[type]"
              :placeholder="`留空 = 用默认（${form.taskModelDefault || '未设置'}）`"
              clearable
              style="width: 260px"
            />
          </el-form-item>
        </el-form>
      </PageCard>

      <PageCard title="运营配置" subtitle="注册开关、赠送金额与并发限制">
        <el-form label-width="140px">
          <el-form-item label="用户并发上限">
            <el-input-number v-model="form.userMaxRunningTasks" :min="1" :step="1" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">单用户同时运行任务数</span>
          </el-form-item>
          <el-form-item label="开放注册">
            <el-switch v-model="form.registrationEnabled" />
          </el-form-item>
          <el-form-item label="注册赠送（元）">
            <el-input-number v-model="form.signupBonusYuan" :min="0" :precision="2" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">
              = {{ yuanToFen(form.signupBonusYuan) }} 分
            </span>
          </el-form-item>
        </el-form>
        <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
      </PageCard>

      <PageCard title="chatgpt2api 服务" subtitle="图片生成上游配置，保存后新任务立即使用新配置，无需重启">
        <el-form label-width="140px">
          <el-form-item label="服务地址">
            <el-input
              v-model="form.c2aBaseUrl"
              placeholder="如 http://your-server:3000（留空 = 使用服务器环境变量）"
              clearable
              style="width: 380px"
            />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input
              v-model="form.c2aApiKey"
              type="password"
              show-password
              :placeholder="c2aKeyMask ? `已配置（${c2aKeyMask}），输入新值可替换` : '留空 = 使用服务器环境变量'"
              style="width: 380px"
            />
          </el-form-item>
          <el-form-item label="请求超时（秒）">
            <el-input-number v-model="form.c2aTimeoutSecs" :min="0" :max="600" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">0 = 使用默认（180 秒）</span>
          </el-form-item>
        </el-form>
        <div class="c2a-actions">
          <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
          <el-button :loading="testing" @click="testC2a">测试连通</el-button>
          <span class="text-muted">测试会使用上方表单当前填写的值（未填则用已保存配置）</span>
        </div>
        <el-alert
          v-if="testResult"
          :type="testResult.ok ? 'success' : 'error'"
          :title="testResult.message"
          :closable="false"
          style="margin-top: 12px"
        />
      </PageCard>
    </div>
  </div>
</template>

<style scoped>
.settings-stack {
  display: grid;
  gap: 16px;
  max-width: 680px;
}

.c2a-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
