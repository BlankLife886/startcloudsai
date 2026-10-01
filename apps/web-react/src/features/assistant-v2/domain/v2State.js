// AI 助手 v2 的状态模型。所有变更都走这里的纯函数，组件和同步器只负责调用，
// 这样“任务在跑 / 排队 / 已结束”只有一个事实来源，不会再出现多处状态对不上。

import { mergeAssistantStreamText } from '../../assistant/domain/assistantStreamMerge.js'
import { mergeAssistantToolSteps, normalizeAssistantToolSteps } from '../../assistant/domain/assistantToolSteps.js'

export const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled'])
export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running'])

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const initialState = {
  conversations: [],
  activeId: '',
  // conversationId -> { messages: [], hasMore: false, loaded: false }
  threads: {},
  // runId -> run (only queued/running runs live here)
  runs: {},
}

function metadataOf(raw = {}) {
  return raw && typeof raw.metadata === 'object' && raw.metadata ? raw.metadata : {}
}

// normalizeMessage maps the server's message dict to the shape the UI uses.
export function normalizeMessage(raw = {}) {
  const metadata = metadataOf(raw)
  const status = String(raw.status || metadata.status || 'complete')
  return {
    id: String(raw.id || ''),
    role: raw.role === 'user' ? 'user' : raw.role === 'system' ? 'system' : 'assistant',
    kind: String(raw.kind || 'chat'),
    content: typeof raw.content === 'string' ? raw.content : '',
    reasoning: typeof (raw.reasoning ?? metadata.reasoning) === 'string' ? (raw.reasoning ?? metadata.reasoning) : '',
    status,
    stage: String(raw.statusStage || metadata.statusStage || ''),
    pending: raw.pending === true || metadata.pending === true || status === 'queued' || status === 'running',
    error: String(raw.error || metadata.error || ''),
    runId: String(raw.runId || metadata.runId || ''),
    toolSteps: normalizeAssistantToolSteps(raw.toolSteps || metadata.toolSteps || []),
    dataViews: Array.isArray(raw.dataViews || metadata.dataViews) ? (raw.dataViews || metadata.dataViews) : [],
    engine: String(raw.engine || metadata.engine || ''),
    createdAt: String(raw.createdAt || ''),
    local: raw.local === true,
  }
}

export function normalizeConversation(raw = {}) {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || '新对话'),
    updatedAt: String(raw.updatedAt || raw.createdAt || ''),
    preview: previewOf(raw.messages),
  }
}

function previewOf(messages) {
  if (!Array.isArray(messages) || !messages.length) return ''
  const last = messages[messages.length - 1]
  return String(last?.content || '').replace(/\s+/g, ' ').slice(0, 60)
}

function updateThread(state, conversationId, updater) {
  const thread = state.threads[conversationId] || { messages: [], hasMore: false, loaded: false }
  return { ...state, threads: { ...state.threads, [conversationId]: updater(thread) } }
}

function patchMessage(thread, messageId, patcher) {
  let changed = false
  const messages = thread.messages.map((message) => {
    if (message.id !== messageId) return message
    changed = true
    return patcher(message)
  })
  return changed ? { ...thread, messages } : thread
}

// mergeServerThread replaces a thread with the server copy while keeping
// optimistic local messages that the server does not know yet, and never
// letting a stale snapshot shorten text that is still streaming.
function mergeServerThread(thread, serverMessages, hasMore) {
  const incoming = serverMessages.map(normalizeMessage)
  const known = new Set(incoming.map((message) => message.id))
  const current = new Map(thread.messages.map((message) => [message.id, message]))
  const merged = incoming.map((message) => {
    const local = current.get(message.id)
    if (!local || !message.pending) return message
    return {
      ...message,
      content: mergeAssistantStreamText(local.content, message.content),
      reasoning: mergeAssistantStreamText(local.reasoning, message.reasoning),
      toolSteps: local.toolSteps.length >= message.toolSteps.length ? local.toolSteps : message.toolSteps,
    }
  })
  // Messages this tab created stay until the server copy includes them: a
  // load that was in flight while the turn was being created can return a
  // snapshot taken before the turn existed.
  const localOnly = thread.messages.filter((message) => message.optimistic && !known.has(message.id))
  return { messages: [...merged, ...localOnly], hasMore: Boolean(hasMore), loaded: true }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'conversations/loaded':
      return { ...state, conversations: action.conversations.map(normalizeConversation) }
    case 'conversations/added': {
      const conversation = normalizeConversation(action.conversation)
      return {
        ...state,
        conversations: [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)],
      }
    }
    case 'conversations/removed': {
      const threads = { ...state.threads }
      delete threads[action.id]
      return {
        ...state,
        conversations: state.conversations.filter((item) => item.id !== action.id),
        threads,
        activeId: state.activeId === action.id ? '' : state.activeId,
      }
    }
    case 'conversations/renamed':
      return {
        ...state,
        conversations: state.conversations.map((item) => (item.id === action.id ? { ...item, title: action.title } : item)),
      }
    case 'conversations/activated':
      return { ...state, activeId: action.id }
    case 'thread/loaded':
      return updateThread(state, action.conversationId, (thread) => mergeServerThread(thread, action.messages, action.hasMore))
    case 'thread/prepended':
      return updateThread(state, action.conversationId, (thread) => {
        const known = new Set(thread.messages.map((message) => message.id))
        const older = action.messages.map(normalizeMessage).filter((message) => !known.has(message.id))
        return { ...thread, messages: [...older, ...thread.messages], hasMore: Boolean(action.hasMore) }
      })
    case 'turn/started': {
      const now = new Date().toISOString()
      const next = updateThread(state, action.conversationId, (thread) => ({
        ...thread,
        loaded: true,
        messages: [
          ...thread.messages,
          { ...normalizeMessage({ id: action.userMessageId, role: 'user', content: action.prompt, createdAt: now }), local: true, optimistic: true },
          {
            ...normalizeMessage({ id: action.assistantMessageId, role: 'assistant', kind: 'agent', status: 'queued', createdAt: now }),
            pending: true,
            stage: 'sending',
            local: true,
            optimistic: true,
          },
        ],
      }))
      return {
        ...next,
        conversations: next.conversations.map((item) => (item.id === action.conversationId
          ? { ...item, updatedAt: now, preview: action.prompt.slice(0, 60), title: action.title || item.title }
          : item)),
      }
    }
    case 'turn/rejected':
      // The run was never created: remove the optimistic pair so the user can
      // resend; the caller restores the draft.
      return updateThread(state, action.conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => message.id !== action.userMessageId && message.id !== action.assistantMessageId),
      }))
    case 'run/updated': {
      const run = action.run
      if (!run?.id) return state
      const runs = { ...state.runs }
      if (ACTIVE_RUN_STATUSES.has(run.status)) runs[run.id] = run
      else delete runs[run.id]
      let next = { ...state, runs }
      if (action.assistantMessage || action.userMessage) {
        next = updateThread(next, run.conversationId, (thread) => {
          let updated = thread
          for (const raw of [action.userMessage, action.assistantMessage]) {
            if (!raw?.id) continue
            const incoming = normalizeMessage(raw)
            const exists = updated.messages.some((message) => message.id === incoming.id)
            if (!exists) continue
            updated = patchMessage(updated, incoming.id, (message) => {
              const terminal = TERMINAL_RUN_STATUSES.has(run.status)
              return {
                ...message,
                ...incoming,
                local: false,
                content: mergeAssistantStreamText(message.content, incoming.content, { authoritative: terminal }),
                reasoning: mergeAssistantStreamText(message.reasoning, incoming.reasoning, { authoritative: terminal }),
                toolSteps: terminal || incoming.toolSteps.length > message.toolSteps.length ? incoming.toolSteps : message.toolSteps,
                pending: terminal ? false : incoming.pending || message.pending,
                stage: terminal ? incoming.stage || (run.status === 'canceled' ? 'stopped' : '') : run.stage || incoming.stage || message.stage,
                error: run.status === 'failed' ? String(run.errorMessage || incoming.error || '生成失败') : incoming.error,
              }
            })
          }
          return updated
        })
      }
      return next
    }
    case 'run/streamed':
      return updateThread(state, action.conversationId, (thread) => patchMessage(thread, action.assistantMessageId, (message) => {
        if (!message.pending) return message
        const event = action.event || {}
        const terminal = Boolean(event.done) && TERMINAL_RUN_STATUSES.has(event.status)
        return {
          ...message,
          content: mergeAssistantStreamText(message.content, event.content, { authoritative: terminal }),
          reasoning: mergeAssistantStreamText(message.reasoning, event.reasoning, { authoritative: terminal }),
          stage: event.stage || message.stage,
          toolSteps: event.tool ? mergeAssistantToolSteps(message.toolSteps, event.tool) : message.toolSteps,
        }
      }))
    case 'run/stopped': {
      const runs = { ...state.runs }
      delete runs[action.runId]
      return updateThread({ ...state, runs }, action.conversationId, (thread) => patchMessage(thread, action.assistantMessageId, (message) => ({
        ...message,
        pending: false,
        stage: 'stopped',
        content: message.content || '已停止生成',
      })))
    }
    case 'runs/lost': {
      // The server no longer recognises the run (deleted conversation,
      // signed out): stop showing it as in progress.
      const lost = state.runs[action.runId]
      const runs = { ...state.runs }
      delete runs[action.runId]
      const next = { ...state, runs }
      if (!lost?.assistantMessageId) return next
      return updateThread(next, action.conversationId, (thread) => patchMessage(thread, lost.assistantMessageId, (message) => ({
        ...message,
        pending: false,
        error: message.error || '任务状态无法读取，请刷新后查看',
      })))
    }
    case 'runs/reconciled': {
      // The server's active-run list is authoritative: anything not in it is
      // no longer running, even if this tab missed the terminal event.
      const runs = {}
      for (const run of action.runs) if (ACTIVE_RUN_STATUSES.has(run.status)) runs[run.id] = run
      return { ...state, runs }
    }
    default:
      return state
  }
}

export function activeRunFor(state, conversationId) {
  return Object.values(state.runs).find((run) => run.conversationId === conversationId && run.status === 'running') || null
}

export function queuedRunsFor(state, conversationId) {
  return Object.values(state.runs)
    .filter((run) => run.conversationId === conversationId && run.status === 'queued')
    .sort((left, right) => Number(left.queuePosition || 0) - Number(right.queuePosition || 0))
}

export function conversationHasWork(state, conversationId) {
  return Object.values(state.runs).some((run) => run.conversationId === conversationId)
}

export function titleFromPrompt(prompt) {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim()
  if (!text) return '新对话'
  return [...text].slice(0, 24).join('')
}
