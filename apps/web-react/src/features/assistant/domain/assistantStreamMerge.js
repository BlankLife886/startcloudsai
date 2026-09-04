const TERMINAL_STREAM_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

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
  }
}

export function assistantStreamEventIsTerminal(event) {
  const status = String(event?.status || '').trim().toLowerCase()
  return Boolean(event?.done) && TERMINAL_STREAM_STATUSES.has(status)
}
