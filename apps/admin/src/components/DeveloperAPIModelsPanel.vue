<script setup lang="ts">
// Developer API model catalog (docs/DEVELOPER_API_MODEL_CATALOG.md): each
// entry is a stable /v1 name pointing at a site model. Published names are
// locked; price increases on a model in service are announced and wait 7
// days; lifecycle changes (maintenance, deprecation with notice, emergency
// retirement, withdrawal) need a reason where callers are affected.
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowDown, Plus, Refresh, Setting, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/request'

interface Usage { keys: number; onlyModel: number; calls7d: number; calls30d: number; users30d: number; revenue30d: number; unrestrictedKeys: number; targetSiteCalls1h: number; targetApiCalls1h: number }
interface Target { id: string; name: string; exists: boolean; enabled?: boolean; available?: boolean; runnable?: boolean; sitePriceCents?: number }
interface APIModel {
  id: string; apiName: string; aliases: string[]; kind: 'image' | 'chat'; status: string
  priceMode: 'follow' | 'fixed'; priceCents: number | null; unitPriceCents: number | null
  maxConcurrency: number; description: string; locked: boolean; publishedAt?: string
  pendingPrice: { priceCents: number; effectiveAt: string } | null
  sunsetAt?: string | null; retiredAt?: string | null; replacement: { id: string; apiName: string } | null
  target: Target; usage: Usage
}
interface Settings { deprecationNoticeDays: number; priceIncreaseNoticeDays: number }
interface SiteModel { id: string; name: string; kind: 'image' | 'chat'; enabled: boolean; runnable: boolean; sitePriceCents: number }

const items = ref<APIModel[]>([])
const targets = ref<SiteModel[]>([])
const settings = ref<Settings>({ deprecationNoticeDays: 7, priceIncreaseNoticeDays: 7 })
const loading = ref(false)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await request<{ items: APIModel[]; targets: SiteModel[]; settings?: Settings }>('/api/v1/admin/developer-api/models', { silent: true })
    items.value = data.items
    targets.value = data.targets
    if (data.settings) settings.value = data.settings
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '读取失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const points = (value?: number | null) => Math.round(Number(value || 0)).toLocaleString('zh-CN')
const STATUS: Record<string, { label: string; type: 'success' | 'info' | 'warning' | 'danger' }> = {
  live: { label: '上线', type: 'success' },
  draft: { label: '草稿', type: 'info' },
  maintenance: { label: '维护', type: 'warning' },
  deprecated: { label: '弃用中', type: 'warning' },
  retired: { label: '已下线', type: 'danger' },
}
const kindLabel = (kind: string) => (kind === 'chat' ? '对话' : '图片')
const impact = (usage?: Usage) => usage
  ? `引用它的 Key ${usage.keys} 把（其中 ${usage.onlyModel} 把只剩它）· 另有 ${usage.unrestrictedKeys} 把不限模型的 Key · 近 7 天 ${points(usage.calls7d)} 次调用 · 近 30 天 ${usage.users30d} 个用户、实收 ${points(usage.revenue30d)} 积分`
  : ''
// Load on the target site model in the last hour: if API traffic is heavy
// next to site traffic, give the API model its own route (docs section 12.1).
const load1h = (usage?: Usage) => usage ? `指向的站内模型近 1 小时：站内 ${points(usage.targetSiteCalls1h)} 次 · API ${points(usage.targetApiCalls1h)} 次` : ''
const when = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

// Create / edit drawer.
const editing = ref<APIModel | null>(null)
const drawerOpen = ref(false)
const saving = ref(false)
const form = reactive({ apiName: '', aliases: [] as string[], targetModelId: '', priceMode: 'follow' as 'follow' | 'fixed', priceCents: 0, maxConcurrency: 0, description: '', reason: '' })
const targetOptions = computed(() => targets.value.filter(item => !editing.value || item.kind === editing.value.kind))
const selectedTarget = computed(() => targets.value.find(item => item.id === form.targetModelId))
function openCreate() {
  editing.value = null
  Object.assign(form, { apiName: '', aliases: [], targetModelId: '', priceMode: 'follow', priceCents: 0, maxConcurrency: 0, description: '', reason: '' })
  drawerOpen.value = true
}
function openEdit(row: APIModel) {
  editing.value = row
  Object.assign(form, { apiName: row.apiName, aliases: [...row.aliases], targetModelId: row.target.id, priceMode: row.priceMode,
    priceCents: row.priceCents ?? row.unitPriceCents ?? 0, maxConcurrency: row.maxConcurrency, description: row.description, reason: '' })
  drawerOpen.value = true
}
async function save() {
  saving.value = true
  try {
    const body = { ...form, priceCents: form.priceMode === 'fixed' ? Math.round(Number(form.priceCents)) : null }
    if (editing.value) {
      const saved = await request<APIModel>(`/api/v1/admin/developer-api/models/${editing.value.id}`, { method: 'PATCH', body })
      const announced = saved.pendingPrice && (!editing.value.pendingPrice || saved.pendingPrice.effectiveAt !== editing.value.pendingPrice.effectiveAt)
      if (announced) ElMessage.success(`已保存。涨价已预告：${when(saved.pendingPrice!.effectiveAt)} 起为 ${points(saved.pendingPrice!.priceCents)} 积分/次，已通知相关用户`)
      else ElMessage.success('已保存')
    } else {
      await request('/api/v1/admin/developer-api/models', { method: 'POST', body })
      ElMessage.success('已创建草稿，确认无误后发布')
    }
    drawerOpen.value = false
    await load()
  } catch {
    // request() already shows the server's message.
  } finally {
    saving.value = false
  }
}

async function publish(row: APIModel) {
  try {
    await ElMessageBox.confirm(`发布后，调用方即可用「${row.apiName}」调用，名称从此锁定不能修改。`, '发布 API 模型', { confirmButtonText: '发布', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    await request(`/api/v1/admin/developer-api/models/${row.id}/publish`, { method: 'POST', body: {} })
    ElMessage.success('已发布')
    await load()
  } catch {
    // shown by request()
  }
}
async function askReason(message: string, title: string, confirm: string) {
  try {
    const result = await ElMessageBox.prompt(message, title, {
      confirmButtonText: confirm, cancelButtonText: '取消', inputPlaceholder: '原因（必填，会记入变更记录）',
      inputValidator: (value: string) => (value && value.trim() ? true : '请填写原因'), type: 'warning',
    })
    return result.value.trim()
  } catch {
    return null
  }
}
async function act(row: APIModel, action: string, body: Record<string, unknown>, done: string) {
  try {
    await request(`/api/v1/admin/developer-api/models/${row.id}/${action}`, { method: 'POST', body })
    ElMessage.success(done)
    await load()
    return true
  } catch {
    // shown by request()
    return false
  }
}
async function withdraw(row: APIModel) {
  const reason = await askReason(`撤回后调用会立即返回 404，没有预告期，只用于紧急情况。\n影响：${impact(row.usage)}`, `撤回「${row.apiName}」`, '确认撤回')
  if (reason) await act(row, 'withdraw', { reason }, '已撤回为草稿')
}
async function maintain(row: APIModel) {
  const reason = await askReason(`维护期间调用返回 503（可重试、不扣费），恢复后立即可用。\n影响：${impact(row.usage)}`, `「${row.apiName}」设为维护`, '设为维护')
  if (reason) await act(row, 'maintenance', { reason }, '已设为维护')
}
async function resume(row: APIModel) {
  await act(row, 'resume', {}, '已恢复调用')
}
async function undeprecate(row: APIModel) {
  try {
    await ElMessageBox.confirm(`取消后「${row.apiName}」恢复为正常上线，并通知相关用户下线计划已取消。`, '取消弃用', { confirmButtonText: '取消弃用', cancelButtonText: '返回' })
  } catch {
    return
  }
  await act(row, 'undeprecate', {}, '已取消弃用')
}
// Emergency retirement skips the notice period: a reason, then a second
// confirmation naming what breaks.
async function retire(row: APIModel) {
  const early = row.status !== 'deprecated' || !row.sunsetAt || Date.parse(row.sunsetAt) > Date.now()
  const reason = await askReason(`下线后调用立即返回 410${row.replacement ? `，并提示改用「${row.replacement.apiName}」` : ''}，不能撤销。${early ? '没有预告期，只用于上游停服、合规等紧急情况。' : ''}\n影响：${impact(row.usage)}`, `紧急下线「${row.apiName}」`, '下一步')
  if (!reason) return
  try {
    await ElMessageBox.confirm(`确认立即下线「${row.apiName}」？近 7 天有 ${points(row.usage.calls7d)} 次调用会开始失败。`, '再次确认', { confirmButtonText: '立即下线', cancelButtonText: '取消', type: 'error', confirmButtonClass: 'el-button--danger' })
  } catch {
    return
  }
  await act(row, 'retire', { reason }, '已下线，已通知相关用户')
}

// Deprecation: a sunset at least the notice period away, an optional
// replacement, and a reason. Users hear about it by in-app message.
const deprecating = ref<APIModel | null>(null)
const deprecateForm = reactive({ sunsetAt: new Date(), replacementId: '', reason: '' })
const earliestSunset = computed(() => Date.now() + settings.value.deprecationNoticeDays * 86400000)
const replacementOptions = computed(() => items.value.filter(item => deprecating.value && item.id !== deprecating.value.id && item.kind === deprecating.value.kind && item.status === 'live'))
function openDeprecate(row: APIModel) {
  deprecating.value = row
  const sunset = new Date(earliestSunset.value + 3600000)
  sunset.setMinutes(0, 0, 0)
  Object.assign(deprecateForm, { sunsetAt: sunset, replacementId: row.replacement?.id || '', reason: '' })
}
const deprecateSaving = ref(false)
async function submitDeprecate() {
  if (!deprecating.value) return
  if (!deprecateForm.reason.trim()) {
    ElMessage.warning('请填写原因')
    return
  }
  deprecateSaving.value = true
  const ok = await act(deprecating.value, 'deprecate', { sunsetAt: new Date(deprecateForm.sunsetAt).toISOString(), replacementId: deprecateForm.replacementId || null, reason: deprecateForm.reason }, '已弃用，已通知相关用户')
  deprecateSaving.value = false
  if (ok) deprecating.value = null
}

async function editSettings() {
  try {
    const result = await ElMessageBox.prompt('弃用后至少要等这么多天才能下线（1–365 天）。已排期的下线时间不受影响。', '弃用预告期（天）', {
      confirmButtonText: '保存', cancelButtonText: '取消', inputValue: String(settings.value.deprecationNoticeDays),
      inputValidator: (value: string) => (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365 ? true : '请填写 1–365 的整数'),
    })
    settings.value = await request<Settings>('/api/v1/admin/developer-api/model-settings', { method: 'PUT', body: { deprecationNoticeDays: Number(result.value) } })
    ElMessage.success('已保存')
  } catch {
    // cancelled, or shown by request()
  }
}

type Action = { key: string; label: string; danger?: boolean; run: (row: APIModel) => void }
const ACTIONS: Record<string, Action> = {
  maintain: { key: 'maintain', label: '设为维护', run: maintain },
  resume: { key: 'resume', label: '恢复调用', run: resume },
  deprecate: { key: 'deprecate', label: '弃用并预告下线…', run: openDeprecate },
  undeprecate: { key: 'undeprecate', label: '取消弃用', run: undeprecate },
  retire: { key: 'retire', label: '紧急下线…', danger: true, run: retire },
  withdraw: { key: 'withdraw', label: '撤回为草稿…', danger: true, run: withdraw },
}
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  live: ['maintain', 'deprecate', 'retire', 'withdraw'],
  maintenance: ['resume', 'retire', 'withdraw'],
  deprecated: ['undeprecate', 'maintain', 'retire', 'withdraw'],
}
const actionsFor = (row: APIModel) => (ACTIONS_BY_STATUS[row.status] || []).map(key => ACTIONS[key])
function runAction(row: APIModel, key: string) {
  ACTIONS[key]?.run(row)
}
</script>

<template>
  <div v-loading="loading" class="apim">
    <div class="apim-bar">
      <p>对外的模型名称发布后锁定；更换指向、调价只影响 API，不影响站内。涨价提前 {{ settings.priceIncreaseNoticeDays }} 天预告，降价立即生效；弃用至少提前 {{ settings.deprecationNoticeDays }} 天预告下线。</p>
      <el-button :icon="Setting" @click="editSettings">弃用预告期 {{ settings.deprecationNoticeDays }} 天</el-button>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建 API 模型</el-button>
    </div>
    <el-alert v-if="error" :title="`读取失败：${error}`" type="error" :closable="false" />
    <el-table :data="items" height="100%" class="apim-table" empty-text="还没有 API 模型" @row-click="(row: unknown) => openEdit(row as APIModel)">
      <el-table-column label="API 名称" min-width="160">
        <template #default="{ row }">
          <strong class="mono">{{ row.apiName }}</strong>
          <div class="muted small">{{ kindLabel(row.kind) }}<template v-if="row.aliases.length"> · 别名 {{ row.aliases.join('、') }}</template></div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="STATUS[row.status]?.type || 'info'" size="small" disable-transitions>{{ STATUS[row.status]?.label || row.status }}</el-tag>
          <div v-if="row.status === 'deprecated'" class="muted small">{{ when(row.sunsetAt) }} 下线</div>
          <div v-else-if="row.status === 'retired'" class="muted small">{{ when(row.retiredAt) }} 下线</div>
          <div v-if="row.replacement && row.status !== 'live'" class="muted small">替代：{{ row.replacement.apiName }}</div>
        </template>
      </el-table-column>
      <el-table-column label="指向站内模型" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="!row.target.exists" class="is-danger"><el-icon><WarningFilled /></el-icon> 站内模型已删除</span>
          <template v-else>
            {{ row.target.name }}
            <el-tag v-if="!row.target.runnable" type="danger" size="small" class="apim-flag" disable-transitions>不可用</el-tag>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="API 价格" width="130" align="right">
        <template #default="{ row }">
          <span class="tnum">{{ row.unitPriceCents == null ? '—' : points(row.unitPriceCents) }}</span>
          <div class="muted small">{{ row.priceMode === 'fixed' ? '固定价格' : '跟随站内价' }}</div>
          <div v-if="row.pendingPrice" class="apim-pending small">{{ when(row.pendingPrice.effectiveAt) }} 起 {{ points(row.pendingPrice.priceCents) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="并发" width="70" align="right">
        <template #default="{ row }"><span class="tnum">{{ row.maxConcurrency || '不限' }}</span></template>
      </el-table-column>
      <el-table-column label="引用 Key" width="90" align="right">
        <template #default="{ row }"><span class="tnum">{{ row.usage.keys }}</span><div v-if="row.usage.onlyModel" class="muted small">{{ row.usage.onlyModel }} 把只剩它</div></template>
      </el-table-column>
      <el-table-column label="近 30 天" width="130" align="right">
        <template #default="{ row }">
          <span class="tnum">{{ points(row.usage.calls30d) }} 次</span>
          <div class="muted small tnum">实收 {{ points(row.usage.revenue30d) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="" width="160" align="right" fixed="right">
        <template #default="{ row }">
          <span class="apim-actions" @click.stop>
            <el-button text size="small" @click="openEdit(row as APIModel)">{{ row.status === 'retired' ? '查看' : '编辑' }}</el-button>
            <el-button v-if="row.status === 'draft'" text size="small" type="primary" @click="publish(row as APIModel)">发布</el-button>
            <el-dropdown v-else-if="actionsFor(row as APIModel).length" trigger="click" @command="(key: string) => runAction(row as APIModel, key)">
              <el-button text size="small">状态<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="action in actionsFor(row as APIModel)" :key="action.key" :command="action.key" :class="{ 'apim-danger-item': action.danger }">{{ action.label }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </span>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer v-model="drawerOpen" :title="editing ? `编辑「${editing.apiName}」` : '新建 API 模型'" size="min(560px, 96vw)" append-to-body>
      <el-form label-position="top" class="apim-form" @submit.prevent>
        <el-alert v-if="editing" type="info" :closable="false" class="apim-impact">
          <template #title>{{ impact(editing.usage) }}</template>
          <div>{{ load1h(editing.usage) }}</div>
        </el-alert>
        <el-alert v-if="editing?.status === 'retired'" title="已下线的 API 模型只能查看，不能修改。" type="warning" :closable="false" class="apim-impact" />
        <el-form-item label="API 名称（调用时填的 model）">
          <el-input v-model="form.apiName" :disabled="editing?.locked" placeholder="如：gpt-image-2" />
          <small v-if="editing?.locked" class="muted">已发布，名称锁定。需要新名称请新建 API 模型。</small>
        </el-form-item>
        <el-form-item label="别名（可选，也能用来调用）">
          <el-select v-model="form.aliases" multiple filterable allow-create default-first-option placeholder="输入后回车添加" style="width: 100%" />
        </el-form-item>
        <el-form-item label="指向站内模型">
          <el-select v-model="form.targetModelId" filterable placeholder="选择站内模型" style="width: 100%">
            <el-option v-for="item in targetOptions" :key="item.id" :value="item.id" :label="`${item.name}（${kindLabel(item.kind)}）`">
              <span>{{ item.name }}</span>
              <span class="apim-option-meta">{{ kindLabel(item.kind) }} · 站内 {{ points(item.sitePriceCents) }} 积分<template v-if="!item.runnable"> · 不可用</template></span>
            </el-option>
          </el-select>
          <small v-if="selectedTarget && !selectedTarget.runnable" class="is-danger">这个站内模型已停用、维护中或线路不是 OpenAI 协议，发布后会无法调用。</small>
        </el-form-item>
        <el-form-item label="API 价格">
          <el-radio-group v-model="form.priceMode">
            <el-radio value="follow">跟随站内价（含站内折扣）</el-radio>
            <el-radio value="fixed">固定价格</el-radio>
          </el-radio-group>
          <div v-if="form.priceMode === 'fixed'" class="apim-inline">
            <el-input-number v-model="form.priceCents" :min="0" :max="1000000000" :step="1" controls-position="right" />
            <span class="muted">积分 / 次</span>
          </div>
          <small v-else-if="selectedTarget" class="muted">当前站内价 {{ points(selectedTarget.sitePriceCents) }} 积分 / 次</small>
          <small v-if="editing && editing.status !== 'draft'" class="muted">已上线的模型涨价会提前 {{ settings.priceIncreaseNoticeDays }} 天预告并站内通知用户，到期自动生效；降价立即生效。</small>
          <small v-if="editing?.pendingPrice" class="apim-pending">已预告：{{ when(editing.pendingPrice.effectiveAt) }} 起为 {{ points(editing.pendingPrice.priceCents) }} 积分/次。改回不高于现价即可取消。</small>
        </el-form-item>
        <el-form-item label="并发上限（0 为不限制）">
          <el-input-number v-model="form.maxConcurrency" :min="0" :max="10000" :step="1" controls-position="right" />
        </el-form-item>
        <el-form-item label="说明（控制台可见，可选）">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" show-word-limit />
        </el-form-item>
        <el-form-item v-if="editing" label="变更原因（更换指向且能力减少时必填）">
          <el-input v-model="form.reason" placeholder="如：切换到新服务商" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="editing?.status === 'retired'" @click="save">{{ editing ? '保存' : '创建草稿' }}</el-button>
      </template>
    </el-drawer>

    <el-dialog :model-value="Boolean(deprecating)" :title="deprecating ? `弃用「${deprecating.apiName}」` : ''" width="min(520px, 94vw)" append-to-body @close="deprecating = null">
      <el-form v-if="deprecating" label-position="top" class="apim-form" @submit.prevent>
        <el-alert :title="impact(deprecating.usage)" type="info" :closable="false" class="apim-impact" />
        <el-form-item :label="`下线时间（至少 ${settings.deprecationNoticeDays} 天后）`">
          <el-date-picker v-model="deprecateForm.sunsetAt" type="datetime" :disabled-date="(date: Date) => date.getTime() < earliestSunset - 86400000" style="width: 100%" />
          <small class="muted">弃用期间照常调用，响应带 Deprecation / Sunset 头；到时自动下线，之后调用返回 410。</small>
        </el-form-item>
        <el-form-item label="替代模型（可选）">
          <el-select v-model="deprecateForm.replacementId" clearable placeholder="不指定" style="width: 100%">
            <el-option v-for="item in replacementOptions" :key="item.id" :value="item.id" :label="item.apiName" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="deprecateForm.reason" placeholder="如：上游模型停止维护，迁移到新版" />
        </el-form-item>
        <small class="muted">确认后会给近 30 天调用过它、或 Key 指定了它的用户发送站内消息。</small>
      </el-form>
      <template #footer>
        <el-button @click="deprecating = null">取消</el-button>
        <el-button type="warning" :loading="deprecateSaving" @click="submitDeprecate">确认弃用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.apim { display: flex; flex: 1; flex-direction: column; gap: 10px; min-height: 0; }
.apim-bar { display: flex; align-items: center; gap: 8px; }
.apim-bar p { flex: 1; margin: 0; color: var(--ink-3); font-size: 12px; }
.apim-table { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-control); }
.apim-table :deep(.el-table__row) { cursor: pointer; }
.apim-flag { margin-left: 6px; }
.apim-form :deep(.el-form-item) { margin-bottom: 16px; }
.apim-impact { margin-bottom: 16px; }
.apim-inline { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 8px; }
.apim-form small { display: block; width: 100%; margin-top: 4px; line-height: 1.5; }
.apim-pending { color: var(--warning, #b86a00); }
.apim-actions { display: inline-flex; align-items: center; }
:global(.apim-danger-item) { color: var(--danger) !important; }
.apim-option-meta { float: right; margin-left: 12px; color: var(--ink-3); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.muted { color: var(--ink-3); }
.small { font-size: 11px; }
.is-danger { color: var(--danger); font-size: 12px; }
</style>
