import { assistantToolIcon, assistantToolLabel } from './assistantToolSteps.js'

// 服务端的调试记录（agent_start / model_wait / tool_start ...）是写给开发看的。
// 这里把它翻译成用户看得懂的一步一句话，并算出每一步自己花了多久。

const SLOW_STEP_MS = 3000
const MINOR_STEP_MS = 1000

function toolNameIn(detail, prefix) {
  const text = String(detail || '').trim()
  return text.startsWith(prefix) ? text.slice(prefix.length).trim().split(/\s/)[0] : ''
}

function friendlyTools(names) {
  return names.map((name) => assistantToolLabel(name.trim())).filter(Boolean).join('、')
}

function describe(step, detail) {
  const text = String(detail || '').trim()
  switch (step) {
    case 'agent_start':
      return { text: '开始处理你的请求', icon: 'bi-play-circle' }
    case 'intent_model':
      return { text: '判断你想聊天还是出图', icon: 'bi-signpost-split', minor: true }
    case 'intent_done': {
      const intent = text.replace(/^判定\s*/, '').split(/[（(\s]/)[0]
      if (/image|draw|generate|edit/i.test(intent)) return { text: '确定这次要出图', icon: 'bi-image' }
      if (/chat|answer|qa/i.test(intent)) return { text: '确定这次是问答', icon: 'bi-chat-dots' }
      return { text: '理解了你的需求', icon: 'bi-lightbulb' }
    }
    case 'model_wait':
      return { text: '等待 AI 思考下一步', icon: 'bi-hourglass-split', minor: true }
    case 'model_token':
      return /思考/.test(text)
        ? { text: 'AI 开始思考', icon: 'bi-stars' }
        : { text: 'AI 开始回答', icon: 'bi-chat-text' }
    case 'model_answer':
      return { text: '直接作答，不需要用工具', icon: 'bi-chat-text' }
    case 'model_tool': {
      const name = toolNameIn(text, '模型要调用')
      return { text: `决定使用「${assistantToolLabel(name)}」`, icon: assistantToolIcon(name), minor: true }
    }
    case 'tool_start': {
      if (text === '正在更新待办') return { text: '更新执行计划', icon: 'bi-list-check' }
      if (text.startsWith('并行执行')) {
        return { text: `同时进行：${friendlyTools(text.replace('并行执行', '').split('、'))}`, icon: 'bi-layers' }
      }
      const name = toolNameIn(text, '正在执行')
      return { text: assistantToolLabel(name), icon: assistantToolIcon(name) }
    }
    case 'tool_done': {
      if (text === '待办已更新') return null
      if (text.startsWith('并行工具完成')) return null
      if (text.includes('复用上次结果')) {
        const name = text.split(/\s/)[0]
        return { text: `「${assistantToolLabel(name)}」沿用了上次的结果`, icon: 'bi-arrow-repeat' }
      }
      if (text.includes('失败')) {
        const name = text.split(/\s/)[0]
        return { text: `「${assistantToolLabel(name)}」没有成功`, icon: 'bi-exclamation-triangle', tone: 'error' }
      }
      return null
    }
    case 'synthesis_wait':
      return { text: '汇总结果，组织回答', icon: 'bi-journal-text' }
    case 'model_error':
      return { text: 'AI 服务暂时出错', icon: 'bi-exclamation-triangle', tone: 'error' }
    default:
      return text ? { text, icon: 'bi-dot' } : null
  }
}

function elapsedOf(item, origin) {
  if (item && Number.isFinite(Number(item.elapsedMs))) return Math.max(0, Number(item.elapsedMs))
  return Math.max(0, (Number(item?.at ?? item?.atMs) || 0) - origin)
}

/**
 * 把调试记录变成用户可读的步骤：[{ key, text, icon, tone, durationMs, slow }]。
 * durationMs 是这一步到下一步之间的时间；最后一步在仍在进行时用 nowMs 计算。
 */
export function humanizeAssistantTrace(items, { startedAt, pending = false, nowMs = Date.now() } = {}) {
  const rows = Array.isArray(items) ? items : []
  const origin = Number(startedAt) || Number(rows[0]?.at ?? rows[0]?.atMs) || 0
  const steps = []
  rows.forEach((item, index) => {
    const described = describe(String(item?.step || ''), item?.detail)
    if (!described) return
    const at = elapsedOf(item, origin)
    const previous = steps[steps.length - 1]
    if (previous && previous.text === described.text) return
    steps.push({ key: `${item?.step}-${index}`, tone: '', ...described, at })
  })
  return steps
    .map((step, index) => {
      const next = steps[index + 1]
      const end = next ? next.at : pending ? Math.max(step.at, nowMs - origin) : null
      const durationMs = end === null ? 0 : Math.max(0, end - step.at)
      return { ...step, durationMs, slow: durationMs >= SLOW_STEP_MS, running: !next && pending }
    })
    // 一闪而过的过渡步骤（等模型、决定用工具）不值得占一行。
    .filter((step) => !step.minor || step.running || step.durationMs >= MINOR_STEP_MS)
}
