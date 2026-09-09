const STORAGE_KEY = 'history-local-edit-handoff-v1'

export function stashLocalEditHandoff({ task, sourceUrl } = {}) {
  const payload = {
    task: task && typeof task === 'object' ? task : null,
    sourceUrl: String(sourceUrl || '').trim(),
    createdAt: Date.now(),
  }
  if (!payload.task || !payload.sourceUrl) throw new Error('局部编辑原图不可用')
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function consumeLocalEditHandoff() {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw)
    if (!payload?.task || !payload?.sourceUrl) return null
    if (Date.now() - Number(payload.createdAt || 0) > 10 * 60 * 1000) return null
    return payload
  } catch {
    return null
  }
}
