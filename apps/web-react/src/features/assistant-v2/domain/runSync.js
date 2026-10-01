// 运行同步器：v2 里唯一负责“盯任务”的地方。
//
// - 每个 queued/running 的任务只被跟踪一次（按 runId 去重）。
// - running 时同时开 SSE（打字机）和轮询（权威状态）；queued 时只轮询。
// - 轮询从不放弃：长时间运行只会把间隔拉长，不会把任务“丢”掉。
// - 网络错误按指数退避重试；4xx（任务不存在、无权限）才停止。
// - 页面重新可见或网络恢复时立即补一次。

import { TERMINAL_RUN_STATUSES } from './v2State.js'

const FAST_POLL_MS = 1500
const SLOW_POLL_MS = 8000
const SLOW_AFTER_MS = 5 * 60 * 1000
const MAX_BACKOFF_MS = 20000

export function pollDelay(elapsedMs, failures = 0) {
  if (failures > 0) return Math.min(MAX_BACKOFF_MS, FAST_POLL_MS * 2 ** Math.min(failures, 4))
  return elapsedMs >= SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS
}

export function createRunSync({ api, dispatch, now = () => Date.now(), timers = globalThis }) {
  // runId -> { run, conversationId, assistantMessageId, stream, timer, failures, startedAt, stopped }
  const tracked = new Map()

  function dispatchSnapshot(data) {
    if (!data?.run) return
    dispatch({ type: 'run/updated', run: data.run, assistantMessage: data.assistantMessage, userMessage: data.userMessage })
  }

  function closeStream(entry) {
    try {
      entry.stream?.close()
    } catch {
      // A closed EventSource is fine.
    }
    entry.stream = null
  }

  function openStream(entry) {
    if (entry.stream || entry.run.status !== 'running' || typeof api.openStream !== 'function') return
    entry.stream = api.openStream(entry.run.id, (event) => {
      if (entry.stopped) return
      dispatch({
        type: 'run/streamed',
        conversationId: entry.conversationId,
        assistantMessageId: entry.assistantMessageId,
        event,
      })
      if (event?.done && TERMINAL_RUN_STATUSES.has(event.status)) {
        // The stream saw the end first; fetch the persisted final state now
        // instead of waiting for the next poll tick.
        schedule(entry, 0)
      }
    })
  }

  function finish(entry) {
    entry.stopped = true
    closeStream(entry)
    timers.clearTimeout(entry.timer)
    tracked.delete(entry.run.id)
  }

  async function poll(entry) {
    if (entry.stopped) return
    try {
      const data = await api.getRun(entry.run.id)
      if (entry.stopped) return
      entry.failures = 0
      if (data?.run) entry.run = data.run
      dispatchSnapshot(data)
      if (TERMINAL_RUN_STATUSES.has(entry.run.status)) {
        finish(entry)
        return
      }
      openStream(entry)
    } catch (error) {
      if (entry.stopped) return
      const status = Number(error?.status || 0)
      if (status >= 400 && status < 500) {
        finish(entry)
        dispatch({ type: 'runs/lost', runId: entry.run.id, conversationId: entry.conversationId, error })
        return
      }
      entry.failures += 1
    }
    schedule(entry)
  }

  function schedule(entry, delay) {
    if (entry.stopped) return
    timers.clearTimeout(entry.timer)
    const wait = delay ?? pollDelay(now() - entry.startedAt, entry.failures)
    entry.timer = timers.setTimeout(() => { void poll(entry) }, wait)
  }

  function track(run) {
    if (!run?.id || TERMINAL_RUN_STATUSES.has(run.status)) return
    const existing = tracked.get(run.id)
    if (existing) {
      existing.run = { ...existing.run, ...run }
      openStream(existing)
      return
    }
    const entry = {
      run,
      conversationId: run.conversationId,
      assistantMessageId: run.assistantMessageId,
      stream: null,
      timer: 0,
      failures: 0,
      startedAt: now(),
      stopped: false,
    }
    tracked.set(run.id, entry)
    openStream(entry)
    schedule(entry)
  }

  function untrack(runId) {
    const entry = tracked.get(runId)
    if (entry) finish(entry)
  }

  // refreshAll polls every tracked run immediately (tab visible again,
  // network back online).
  function refreshAll() {
    for (const entry of tracked.values()) schedule(entry, 0)
  }

  function dispose() {
    for (const entry of [...tracked.values()]) finish(entry)
  }

  return {
    track,
    untrack,
    refreshAll,
    dispose,
    isTracking: (runId) => tracked.has(runId),
    size: () => tracked.size,
  }
}
