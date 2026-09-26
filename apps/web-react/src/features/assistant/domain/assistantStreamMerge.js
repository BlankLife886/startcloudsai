const TERMINAL_STREAM_STATUSES = new Set(['succeeded', 'failed', 'canceled'])
const MAX_DEBUG_TRACE = 48

function normalizeDebugSpan(incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return null
  const step = String(incoming.step || '').trim()
  if (!step) return null
  return {
    step,
    detail: String(incoming.detail || '').trim(),
    at: Number(incoming.atMs || incoming.at) || Date.now(),
    elapsedMs: Math.max(0, Number(incoming.elapsedMs) || 0),
  }
}

export function mergeAssistantDebugTrace(current, incoming) {
  if (Array.isArray(incoming)) {
    const mapped = incoming.map(normalizeDebugSpan).filter(Boolean)
    if (!mapped.length) return Array.isArray(current) ? current : []
    return mapped.length > MAX_DEBUG_TRACE ? mapped.slice(-MAX_DEBUG_TRACE) : mapped
  }
  const span = normalizeDebugSpan(incoming)
  if (!span) return Array.isArray(current) ? current : []
  const next = Array.isArray(current) ? current.slice() : []
  const last = next[next.length - 1]
  if (last && last.step === span.step && last.detail === span.detail && last.elapsedMs === span.elapsedMs) {
    return next
  }
  next.push(span)
  return next.length > MAX_DEBUG_TRACE ? next.slice(-MAX_DEBUG_TRACE) : next
}

export function mergeAssistantStreamText(currentValue, incomingValue, { authoritative = false } = {}) {
  const current = typeof currentValue === 'string' ? currentValue : ''
  if (typeof incomingValue !== 'string' || incomingValue.length === 0) return current
  if (authoritative || incomingValue.length > current.length) return incomingValue
  return current
}

export function mergeAssistantMessageSnapshot(message = {}, snapshot, { authoritative = false } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return message
  return {
    ...message,
    ...snapshot,
    content: mergeAssistantStreamText(message.content, snapshot.content, { authoritative }),
    reasoning: mergeAssistantStreamText(message.reasoning, snapshot.reasoning, { authoritative }),
    debugTrace: Array.isArray(message.debugTrace) && message.debugTrace.length
      ? message.debugTrace
      : snapshot.debugTrace,
  }
}

export function assistantStreamEventIsTerminal(event) {
  const status = String(event?.status || '').trim().toLowerCase()
  return Boolean(event?.done) && TERMINAL_STREAM_STATUSES.has(status)
}
