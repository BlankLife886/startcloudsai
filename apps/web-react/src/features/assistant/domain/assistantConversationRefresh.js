// 切回对话或页面重新可见时，用服务端的最新消息刷新当前对话。
// 服务端对它返回的消息是权威的；但本页刚发出、服务端还没落库的消息要保留，
// 正在流式输出的消息不能被落后的快照截短，已经加载的更早消息也不能丢。

import { mergeAssistantMessageSnapshot } from './assistantStreamMerge.js'

// A refresh that started before a send can return after it; anything newer
// than the snapshot cannot have been deleted by it.
const RECENT_MS = 5 * 60 * 1000

function timeOf(message) {
  const value = Date.parse(message?.createdAt || '')
  return Number.isFinite(value) ? value : 0
}

function keepUnknown(message, newestServerTime, now) {
  if (message?.localOnly === true || message?.pending === true) return true
  const created = timeOf(message)
  if (!created) return false
  return newestServerTime ? created > newestServerTime : now - created < RECENT_MS
}

export function mergeServerMessages(current = [], server = [], { now = Date.now() } = {}) {
  const incoming = Array.isArray(server) ? server.filter((message) => message?.id) : []
  if (!incoming.length) {
    // An empty page means the conversation is empty on the server, except for
    // turns sent so recently that the snapshot predates them.
    return current.filter((message) => keepUnknown(message, 0, now))
  }
  const local = new Map(current.map((message) => [message.id, message]))
  const known = new Set(incoming.map((message) => message.id))
  const newestServerTime = Math.max(0, ...incoming.map(timeOf))

  // Messages older than the server page were loaded with "load earlier";
  // keep them in front.
  const firstServerIndex = current.findIndex((message) => message.id === incoming[0].id)
  const older = firstServerIndex > 0 ? current.slice(0, firstServerIndex) : []

  const merged = incoming.map((message) => {
    const existing = local.get(message.id)
    if (!existing) return message
    const serverPending = message.pending === true
    // A finished server copy is authoritative; a still-running one may lag
    // behind what this tab has already streamed.
    return mergeAssistantMessageSnapshot(existing, message, { authoritative: !serverPending })
  })

  const pendingLocal = current.filter((message) => !known.has(message.id)
    && !older.includes(message)
    && keepUnknown(message, newestServerTime, now))

  return [...older, ...merged, ...pendingLocal]
}
