const GENERATING_STATUSES = new Set(['running', 'waiting_provider'])

export function taskTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function isTaskGenerating(taskOrStatus) {
  const status =
    typeof taskOrStatus === 'string' ? taskOrStatus : String(taskOrStatus?.status || '')
  return GENERATING_STATUSES.has(status.trim().toLowerCase())
}

export function serverTaskStartedAt(job = {}) {
  if (!isTaskGenerating(job) && String(job?.status || '').trim().toLowerCase() === 'queued') {
    return 0
  }
  return taskTimestamp(job?.startedAt)
}

export function taskGenerationElapsedMs(task, now = Date.now()) {
  if (!task || String(task.status || '').trim().toLowerCase() === 'queued') return 0
  const startedAt = taskTimestamp(task.startedAt || task.started_at)
  if (!startedAt) return 0

  const finishedAt = taskTimestamp(task.finishedAt || task.finished_at)
  if (finishedAt) return Math.max(0, finishedAt - startedAt)
  if (!isTaskGenerating(task)) {
    const explicitDuration = Number(task.durationMs || task.duration_ms || 0)
    return explicitDuration > 0 ? explicitDuration : 0
  }
  return Math.max(0, Number(now || 0) - startedAt)
}
