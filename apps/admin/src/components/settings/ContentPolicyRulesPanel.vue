<script setup lang="ts">
/**
 * 系统设置 · 内容违规：识别关键词、违规扣费开关、每日免扣次数，以及“试一试”。
 * 规则走独立接口、独立保存，不进系统设置的统一保存。
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/request'

export interface ContentPolicyRules {
  enabled: boolean
  dailyFreeCount: number
  policyPhrases: string[]
  refusalPhrases: string[]
  sensitiveWords: string[]
}
interface Segment { text: string; hit: boolean }

const emit = defineEmits<{
  /** 已保存的规则（读取或保存后），供导航显示摘要 */
  saved: [value: ContentPolicyRules]
  'update:dirty': [value: boolean]
}>()

const rules = reactive({ enabled: true, dailyFreeCount: 0, policyPhrases: '', refusalPhrases: '', sensitiveWords: '' })
const savedRules = ref<ContentPolicyRules | null>(null)
const ruleDefaults = ref<ContentPolicyRules | null>(null)
const rulesLoading = ref(false)
const rulesSaving = ref(false)
const rulesError = ref('')
const lines = (text: string) => {
  const seen = new Set<string>()
  return text.split(/[\n,，]/).map((item) => item.trim()).filter((item) => {
    const key = item.toLowerCase()
    if (!item || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
const joinLines = (items: string[]) => items.join('\n')
function setDraft(value: ContentPolicyRules) {
  rules.enabled = value.enabled
  rules.dailyFreeCount = value.dailyFreeCount
  rules.policyPhrases = joinLines(value.policyPhrases)
  rules.refusalPhrases = joinLines(value.refusalPhrases)
  rules.sensitiveWords = joinLines(value.sensitiveWords)
}
const draftRules = computed<ContentPolicyRules>(() => ({
  enabled: rules.enabled,
  dailyFreeCount: Number(rules.dailyFreeCount) || 0,
  policyPhrases: lines(rules.policyPhrases),
  refusalPhrases: lines(rules.refusalPhrases),
  sensitiveWords: lines(rules.sensitiveWords),
}))
const rulesDirty = computed(() => Boolean(savedRules.value) && JSON.stringify(draftRules.value) !== JSON.stringify(savedRules.value))
watch(rulesDirty, (value) => emit('update:dirty', value))
const keywordCount = (value: ContentPolicyRules | null) => (value ? value.policyPhrases.length + value.refusalPhrases.length + value.sensitiveWords.length : 0)
const freeExample = computed(() => {
  const n = draftRules.value.dailyFreeCount
  if (!draftRules.value.enabled) return '扣费已关闭：所有违规都照常退回积分，只做记录。'
  if (n === 0) return '每天第 1 次违规就扣费。'
  return `例：同一用户今天第 ${n === 1 ? '1' : `1–${n}`} 次违规照常退回，第 ${n + 1} 次起扣费；次日重新计数。`
})
const rulesProblem = computed(() => {
  const draft = draftRules.value
  if (!draft.policyPhrases.length && (!draft.refusalPhrases.length || !draft.sensitiveWords.length)) {
    return '至少要有一个违规说法，或同时填写拒绝说法和敏感词，否则什么都识别不出来。'
  }
  return ''
})

function markSaved(value: ContentPolicyRules) {
  setDraft(value)
  savedRules.value = draftRules.value
  emit('saved', savedRules.value)
}
async function loadRules() {
  rulesLoading.value = true
  rulesError.value = ''
  try {
    const result = await request<{ config: ContentPolicyRules; defaults: ContentPolicyRules }>('/api/v1/admin/content-policy/config', { silent: true })
    markSaved(result.config)
    ruleDefaults.value = result.defaults
  } catch (caught) {
    rulesError.value = caught instanceof Error ? caught.message : '规则读取失败'
  } finally {
    rulesLoading.value = false
  }
}
async function saveRules() {
  rulesSaving.value = true
  try {
    const result = await request<{ config: ContentPolicyRules }>('/api/v1/admin/content-policy/config', { method: 'PUT', body: draftRules.value })
    markSaved(result.config)
    ElMessage.success('规则已保存，之后的失败按新规则判断')
  } finally {
    rulesSaving.value = false
  }
}
function revertRules() {
  if (savedRules.value) setDraft(savedRules.value)
}
async function restoreDefaults() {
  if (!ruleDefaults.value) return
  try {
    await ElMessageBox.confirm('把三组关键词恢复为系统默认值？扣费开关和每日免扣次数不变。点“保存规则”后才会生效。', '恢复默认关键词', { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' })
  } catch {
    return
  }
  setDraft({ ...ruleDefaults.value, enabled: rules.enabled, dailyFreeCount: rules.dailyFreeCount })
}

// 把命中的关键词标出来；规则形如“不能帮助 + 裸露”时两个词都标。
const ruleTerms = (rule: string) => rule.split(' + ').map((term) => term.trim()).filter(Boolean)
function highlight(text: string, terms: string[]): Segment[] {
  const lower = text.toLowerCase()
  const needles = terms.map((term) => term.toLowerCase()).filter(Boolean)
  const segments: Segment[] = []
  let cursor = 0
  while (cursor < text.length) {
    let at = -1
    let length = 0
    for (const needle of needles) {
      const found = lower.indexOf(needle, cursor)
      if (found !== -1 && (at === -1 || found < at)) {
        at = found
        length = needle.length
      }
    }
    if (at === -1) {
      segments.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false })
    segments.push({ text: text.slice(at, at + length), hit: true })
    cursor = at + length
  }
  return segments
}

const testMessage = ref('')
const testing = ref(false)
const testResult = ref<{ violation: boolean; rule: string; message: string } | null>(null)
// 规则或文字变了，旧结果就不再可信。
watch([testMessage, draftRules], () => { testResult.value = null })
async function runTest() {
  const message = testMessage.value
  if (!message.trim() || testing.value) return
  testing.value = true
  try {
    const result = await request<{ violation: boolean; rule: string }>('/api/v1/admin/content-policy/test', { method: 'POST', body: { message, config: draftRules.value } })
    testResult.value = { ...result, message }
  } finally {
    testing.value = false
  }
}
function onTestKeydown(event: Event | KeyboardEvent) {
  if (event instanceof KeyboardEvent && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void runTest()
  }
}

/** 放弃未保存的修改（离开前确认后调用） */
async function discard() {
  revertRules()
  await nextTick()
}
/** 从违规记录“用这段返回调规则”跳过来时，直接填入并识别 */
async function testWith(message: string) {
  testMessage.value = message
  await firstLoad
  await runTest()
}
defineExpose({ discard, testWith, revert: revertRules, save: saveRules, reload: loadRules, isDirty: rulesDirty, saving: rulesSaving, problem: rulesProblem })

let firstLoad: Promise<void> = Promise.resolve()
onMounted(() => { firstLoad = loadRules() })
</script>

<template>
  <div v-loading="rulesLoading" class="cp-rules">
    <div class="cp-main">
      <el-alert v-if="rulesError" :title="`规则读取失败：${rulesError}`" type="error" :closable="false" />

      <div class="cp-card">
        <header class="cp-card__head">
          <strong>违规扣费</strong>
          <small v-if="savedRules">当前生效：{{ savedRules.enabled ? `扣费开启 · 每人每天免扣 ${savedRules.dailyFreeCount} 次` : '扣费关闭' }} · 共 {{ keywordCount(savedRules) }} 个关键词</small>
        </header>
        <div class="cp-rows">
          <div class="cp-row">
            <span><strong>违规扣费</strong><small>关闭后仍会识别和记录违规，但所有违规都照常退回积分</small></span>
            <el-switch v-model="rules.enabled" />
          </div>
          <div class="cp-row">
            <span><strong>每人每天免扣次数</strong><small>{{ freeExample }}</small></span>
            <el-input-number v-model="rules.dailyFreeCount" :min="0" :max="1000" :step="1" :precision="0" :disabled="!rules.enabled" />
          </div>
        </div>
      </div>

      <div class="cp-card">
        <header class="cp-card__head">
          <strong>识别关键词</strong>
          <small>每行一个，不区分大小写，重复项自动去掉</small>
          <el-button class="cp-card__aside" text size="small" :disabled="!ruleDefaults" @click="restoreDefaults">恢复默认关键词</el-button>
        </header>
        <div class="cp-words">
          <div class="cp-word">
            <span><strong>违规说法</strong><em class="tnum">{{ draftRules.policyPhrases.length }}</em></span>
            <small>上游安全过滤的固定说法，出现任意一个就算违规</small>
            <el-input v-model="rules.policyPhrases" type="textarea" resize="none" :rows="9" placeholder="例如：防护限制" />
          </div>
          <div class="cp-word">
            <span><strong>拒绝说法</strong><em class="tnum">{{ draftRules.refusalPhrases.length }}</em></span>
            <small>模型直接拒绝的说法，需和敏感词同时出现</small>
            <el-input v-model="rules.refusalPhrases" type="textarea" resize="none" :rows="9" placeholder="例如：不能帮助" />
          </div>
          <div class="cp-word">
            <span><strong>敏感词</strong><em class="tnum">{{ draftRules.sensitiveWords.length }}</em></span>
            <small>单独的拒绝说法不算违规，模型也会拒绝正常请求</small>
            <el-input v-model="rules.sensitiveWords" type="textarea" resize="none" :rows="9" placeholder="例如：裸露" />
          </div>
        </div>
        <el-alert v-if="rulesProblem" :title="rulesProblem" type="warning" :closable="false" show-icon />
      </div>
    </div>

    <aside class="cp-card cp-test">
      <header class="cp-card__head"><strong>试一试</strong></header>
      <small class="cp-test__tip">粘贴一段上游返回的失败文字，按左边正在编辑的规则（未保存也可以）判断是否算违规。</small>
      <el-input v-model="testMessage" type="textarea" resize="none" :rows="6" placeholder="例如：非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。" @keydown="onTestKeydown" />
      <div class="cp-test-actions">
        <el-button type="primary" :loading="testing" :disabled="!testMessage.trim()" @click="runTest">识别</el-button>
        <span class="muted">⌘/Ctrl + Enter</span>
      </div>
      <div v-if="testResult" class="cp-test-result" :class="testResult.violation ? 'is-hit' : 'is-miss'">
        <strong>{{ testResult.violation ? '算违规' : '不算违规' }}</strong>
        <span v-if="testResult.violation">命中规则：<span class="cp-rule">{{ testResult.rule }}</span></span>
        <span v-else>按普通失败处理，积分照常退回</span>
        <p v-if="testResult.violation" class="cp-marked"><template v-for="(segment, index) in highlight(testResult.message, ruleTerms(testResult.rule))" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></p>
      </div>
    </aside>

  </div>
</template>

<style scoped>
.cp-rules { display: grid; flex: 1 0 auto; grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: minmax(0, 1fr); gap: 14px; align-items: stretch; min-width: 0; min-height: 560px; }
.cp-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
/* 关键词卡片吃掉剩余高度，三个输入框一直撑到底部 */
.cp-main > .cp-card:last-child { flex: 1 1 auto; }

/* 与系统设置其他分组一致的卡片 */
.cp-card { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 18px 22px; border-radius: 18px; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 10px 26px -16px rgb(0 0 0 / 0.2); }
.cp-card__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: -4px; }
.cp-card__head strong { color: var(--ink); font-size: 15px; font-weight: 700; }
.cp-card__head small { color: var(--ink-3); font-size: 12px; }
.cp-card__aside { margin-left: auto; }

.cp-rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); column-gap: 32px; }
.cp-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 20px; min-height: 60px; padding: 10px 0; }
.cp-row > span { display: grid; gap: 3px; min-width: 0; }
.cp-row strong { color: var(--ink); font-size: 14px; font-weight: 600; }
.cp-row small { color: var(--ink-3); font-size: 12px; line-height: 1.45; }
.cp-row :deep(.el-input-number) { width: 150px; }

.cp-words { display: grid; flex: 1 1 auto; min-height: 220px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 16px; }
.cp-word { display: flex; flex-direction: column; gap: 4px; min-width: 0; min-height: 0; }
.cp-word > span { display: flex; align-items: center; gap: 6px; }
.cp-word strong { color: var(--ink); font-size: 14px; font-weight: 600; }
.cp-word em { padding: 0 7px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); font-size: 11px; font-style: normal; font-weight: 650; line-height: 18px; }
.cp-word > small { margin-bottom: 4px; color: var(--ink-3); font-size: 12px; line-height: 1.45; }
.cp-word :deep(.el-textarea) { flex: 1 1 auto; min-height: 180px; }
.cp-word :deep(.el-textarea__inner) { height: 100%; border-radius: 12px; line-height: 1.7; }

.cp-test { gap: 12px; }
.cp-test :deep(.el-textarea) { flex: 0 1 auto; }
.cp-test-result { flex: none; }
.cp-test__tip { color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.cp-test :deep(.el-textarea__inner) { border-radius: 12px; }
.cp-test-actions { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.cp-test-result { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
.cp-test-result.is-hit { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.cp-test-result.is-hit > strong { color: var(--danger); }
.cp-test-result.is-miss { background: color-mix(in srgb, var(--success) 12%, transparent); }
.cp-test-result.is-miss > strong { color: var(--success); }
.cp-test-result span { color: var(--ink-2); font-size: 12px; }
.cp-rule { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.cp-marked { margin: 4px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.muted { color: var(--ink-3); }
mark { padding: 0 2px; border-radius: 3px; background: color-mix(in srgb, #f5c400 45%, transparent); color: inherit; }

@media (max-width: 1280px) {
  .cp-rules { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 900px) {
}
</style>
