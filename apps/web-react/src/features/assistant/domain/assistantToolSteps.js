// Agent 执行步骤：把服务端推送的工具生命周期事件合并成一条有序、可回溯的时间线。
// 事件是离散的（不像正文那样累计全文），所以按 requestId 幂等合并，乱序与重复都安全。

const TOOL_LABELS = {
  web_search: '联网搜索',
  task_status: '任务状态诊断',
  files_list: '查看附件列表',
  files_search: '检索附件',
  files_read: '阅读附件',
  files_create: '生成文件',
  media_action: '图片处理',
  image_search: '图片素材搜索',
  webpage_capture: '网页截图',
  send_to_workspace: '发送到工作区',
  reference_rebuild: '参考图复刻',
  product_import: '商品链接导入',
  delivery_export: '导出交付包',
  site_operator: '站内操作',
  propose_image_action: '整理图片方案',
}

const TOOL_ICONS = {
  web_search: 'bi-globe2',
  task_status: 'bi-activity',
  files_list: 'bi-folder2-open',
  files_search: 'bi-file-earmark-text',
  files_read: 'bi-book',
  files_create: 'bi-file-earmark-plus',
  media_action: 'bi-magic',
  image_search: 'bi-images',
  webpage_capture: 'bi-window-fullscreen',
  send_to_workspace: 'bi-box-arrow-up-right',
  reference_rebuild: 'bi-layers',
  product_import: 'bi-bag-plus',
  delivery_export: 'bi-file-earmark-zip',
  site_operator: 'bi-compass',
  propose_image_action: 'bi-sliders',
}

// 摘要优先读这些字段：覆盖现有工具 schema，未知工具回落到第一个短字符串。
const SUMMARY_KEYS = [
  'query',
  'question',
  'instruction',
  'operation',
  'prompt',
  'url',
  'targetUrl',
  'keyword',
  'name',
  'fileName',
  'taskId',
  'task_id',
]

const TERMINAL_STATUSES = new Set(['completed', 'failed'])
const MAX_STEPS = 32
const MAX_SUMMARY_RUNES = 72

export function assistantToolLabel(name) {
  const key = String(name || '').trim()
  return TOOL_LABELS[key] || key || '工具调用'
}

export function assistantToolIcon(name) {
  return TOOL_ICONS[String(name || '').trim()] || 'bi-tools'
}

function parseToolArguments(raw) {
  if (raw && typeof raw === 'object') return raw
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    // 流式工具参数可能在推送时还不是完整 JSON，摘要留空即可。
    return null
  }
}

function clampSummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const runes = [...text]
  return runes.length > MAX_SUMMARY_RUNES ? `${runes.slice(0, MAX_SUMMARY_RUNES).join('')}…` : text
}

function summarizeProposalArguments(args) {
  const items = Array.isArray(args.items) ? args.items : []
  const first = items[0] && typeof items[0] === 'object' ? items[0] : null
  const title = typeof first?.title === 'string' ? first.title.trim() : ''
  const itemPrompt = typeof first?.prompt === 'string' ? first.prompt.trim() : ''
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (items.length > 1 && title) return clampSummary(`${title} 等 ${items.length} 张`)
  return clampSummary(title || itemPrompt || prompt)
}

/** 从工具参数中提取一句可读摘要，用于时间线上不展开也能看懂这一步做了什么。 */
export function summarizeAssistantToolArguments(raw, name = '') {
  const args = parseToolArguments(raw)
  if (!args) return ''
  if (String(name || '').trim() === 'propose_image_action') {
    return summarizeProposalArguments(args)
  }
  for (const key of SUMMARY_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return clampSummary(value)
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.trim()) return clampSummary(value)
  }
  return ''
}

function looksLikeJsonPayload(value) {
  if (value && typeof value === 'object') return true
  const text = String(value || '').trim()
  return text.startsWith('{') || text.startsWith('[')
}

// 展开给用户看的只有失败原因或已经写成人话的结果。原始工具参数是给模型的协议，
// 尤其是 propose_image_action 那份 JSON，下面的方案卡已经展示过了。
export function assistantToolStepDetail(step = {}) {
  const error = String(step.error || '').trim()
  if (error) return error
  const result = step.result
  if (result == null || result === '') return ''
  if (typeof result === 'string') {
    const text = result.trim()
    if (!text || looksLikeJsonPayload(text)) return ''
    return text
  }
  return ''
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  return status === 'completed' || status === 'failed' ? status : 'running'
}

function stepKey(tool) {
  const requestId = String(tool?.requestId || '').trim()
  if (requestId) return requestId
  const name = String(tool?.name || '').trim()
  return `${name}:${String(tool?.arguments || '')}`
}

/**
 * 把一个工具事件合并进现有步骤列表，返回新数组（未变化时返回原数组）。
 * 已终结的步骤不会被迟到的 running 事件复活。
 */
export function mergeAssistantToolSteps(currentSteps, tool, { at = Date.now() } = {}) {
  const steps = Array.isArray(currentSteps) ? currentSteps : []
  const name = String(tool?.name || '').trim()
  if (!name) return steps
  const key = stepKey(tool)
  const status = normalizeStatus(tool?.status)
  const index = steps.findIndex((item) => item.key === key)
  const existing = index >= 0 ? steps[index] : null

  if (existing && TERMINAL_STATUSES.has(existing.status) && !TERMINAL_STATUSES.has(status)) {
    return steps
  }

  const startedAt = existing?.startedAt || at
  const args = typeof tool?.arguments === 'string' && tool.arguments ? tool.arguments : existing?.arguments || ''
  const next = {
    key,
    requestId: String(tool?.requestId || '').trim(),
    name,
    label: String(tool?.title || '').trim() || assistantToolLabel(name),
    icon: assistantToolIcon(name),
    execution: String(tool?.execution || existing?.execution || 'server').trim(),
    status,
    arguments: args,
    summary: summarizeAssistantToolArguments(args, name) || existing?.summary || '',
    result: tool?.result === undefined ? existing?.result : tool.result,
    error: String(tool?.error || '').trim() || (status === 'failed' ? existing?.error || '' : ''),
    startedAt,
    durationMs: TERMINAL_STATUSES.has(status)
      ? Math.max(1, (existing?.durationMs || 0) || at - startedAt)
      : existing?.durationMs || 0,
  }

  if (index >= 0) {
    const merged = steps.slice()
    merged[index] = next
    return merged
  }
  const appended = [...steps, next]
  return appended.length > MAX_STEPS ? appended.slice(appended.length - MAX_STEPS) : appended
}

/**
 * 统一成时间线可直接渲染的形状。既接受本轮流式合并出的步骤，也接受刷新后
 * 随消息元数据回来的持久化步骤，因此是幂等的。
 */
export function normalizeAssistantToolSteps(items) {
  const rows = Array.isArray(items) ? items : []
  const steps = []
  for (const item of rows) {
    const name = String(item?.name || '').trim()
    if (!name) continue
    const args = typeof item.arguments === 'string' ? item.arguments : ''
    steps.push({
      key: item.key || String(item.requestId || '').trim() || `${name}:${steps.length}`,
      requestId: String(item.requestId || ''),
      name,
      label: item.label || assistantToolLabel(name),
      icon: item.icon || assistantToolIcon(name),
      execution: String(item.execution || 'server'),
      status: normalizeStatus(item.status),
      arguments: args,
      summary: item.summary || summarizeAssistantToolArguments(args, name),
      result: item.result,
      error: String(item.error || '').trim(),
      startedAt: Number(item.startedAt) || 0,
      durationMs: Math.max(0, Number(item.durationMs) || 0),
    })
    if (steps.length >= MAX_STEPS) break
  }
  return steps
}

const PLAN_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const MAX_PLAN_STEPS = 8

/**
 * Agent 自己维护的待办清单。计划每次整份替换而不是发增量，所以这里只做校验和裁剪，
 * 不需要合并逻辑。
 */
export function normalizeAssistantPlan(items) {
  const rows = Array.isArray(items) ? items : []
  const steps = []
  for (const item of rows) {
    const title = String(item?.title || '').trim()
    if (!title) continue
    const status = String(item?.status || '').trim().toLowerCase()
    steps.push({ title, status: PLAN_STATUSES.has(status) ? status : 'pending' })
    if (steps.length >= MAX_PLAN_STEPS) break
  }
  return steps
}

/** 时间线标题用的汇总，例如「3 个步骤 · 1 个失败」。 */
export function assistantToolStepsSummary(steps) {
  const rows = Array.isArray(steps) ? steps : []
  const running = rows.filter((item) => item.status === 'running').length
  const failed = rows.filter((item) => item.status === 'failed').length
  const parts = [`${rows.length} 个步骤`]
  if (running > 0) parts.push(`${running} 个进行中`)
  if (failed > 0) parts.push(`${failed} 个失败`)
  return parts.join(' · ')
}
