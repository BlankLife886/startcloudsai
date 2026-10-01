import { apiGet } from '@react/legacy-modules/services/apiClient.js'
import {
  cancelAssistantRun,
  createAssistantConversation,
  createAssistantRun,
  deleteAssistantConversation,
  fetchAssistantConfig,
  getAssistantConversation,
  getAssistantRun,
  listActiveAssistantRuns,
  openAssistantRunStream,
  patchAssistantConversation,
} from '../../assistant/services/assistantApi.js'

// The sidebar only needs titles and a one-line preview, so ask for a single
// message per conversation instead of a page of full message payloads.
export async function listConversations({ signal } = {}) {
  const data = await apiGet('/assistant/conversations', {
    query: { messageLimit: 1 },
    signal,
    fallbackMessage: '对话记录加载失败',
  })
  return Array.isArray(data?.conversations) ? data.conversations : []
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export const v2Api = {
  fetchConfig: fetchAssistantConfig,
  listConversations,
  createConversation: (signal) => createAssistantConversation('新对话', { signal }),
  getConversation: (id, options) => getAssistantConversation(id, options),
  renameConversation: (id, title) => patchAssistantConversation(id, { title }),
  deleteConversation: (id, cancelActive) => deleteAssistantConversation(id, { cancelActive }),
  listActiveRuns: (signal) => listActiveAssistantRuns({ workspace: 'assistant', signal }),
  getRun: (id) => getAssistantRun(id),
  cancelRun: (id, acknowledgeUpstream = false) => cancelAssistantRun(id, { acknowledgeUpstream }),
  openStream: (id, onEvent) => openAssistantRunStream(id, { onEvent }),
  createRun: ({ conversationId, prompt, userMessageId, assistantMessageId, model, reasoningEffort }) => createAssistantRun({
    conversationId,
    prompt,
    userMessageContent: prompt,
    mode: 'agent',
    engine: 'v2',
    timezone: browserTimezone(),
    idempotencyKey: assistantMessageId,
    clientUserMessageId: userMessageId,
    clientAssistantMessageId: assistantMessageId,
    model,
    reasoningEffort,
    queue: true,
  }),
}
