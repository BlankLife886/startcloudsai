export function markAssistantMessageLocal(message = {}) {
  return { ...message, localOnly: true }
}

export function mergePersistedAssistantMessage(message = {}, persisted) {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return message
  return { ...message, ...persisted, localOnly: false }
}

export function resolveAssistantRetryIdentity(userMessage = {}, assistantMessage = {}) {
  const userMessageId = String(userMessage?.id || '').trim()
  const assistantMessageId = String(assistantMessage?.id || '').trim()
  return {
    sourceUserMessageId: userMessage?.localOnly === true ? '' : userMessageId,
    retryAssistantMessageId: assistantMessage?.localOnly === true ? assistantMessageId : '',
  }
}
