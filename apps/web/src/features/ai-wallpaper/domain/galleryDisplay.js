function uniqueUrls(items = []) {
  if (!Array.isArray(items)) return []
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)))
}

export function uniqueTaskOutputs(task = {}) {
  const originals = uniqueUrls(task?.originalOutputs)
  return originals.length ? originals : uniqueUrls(task?.outputs)
}

export function uniqueTaskThumbnailOutputs(task = {}) {
  if (task?.hasDedicatedThumbnails === false) return []
  const thumbnails = uniqueUrls(task?.thumbnailOutputs)
  return thumbnails
}

export function normalizeVisibleDisplayPositions(items = []) {
  const displayGroups = new Map()
  items.forEach((item) => {
    const batchId = String(item?.task?.batchId || '').trim()
    const taskId = String(item?.task?.id || item?.task?.serverJobId || '').trim()
    if (!taskId || !['image', 'pending'].includes(String(item?.kind || ''))) return
    const groupKey = batchId ? `batch:${batchId}` : `task:${taskId}`
    const group = displayGroups.get(groupKey) || []
    group.push(item)
    displayGroups.set(groupKey, group)
  })
  displayGroups.forEach((group) => {
    const ordered = [...group].sort(
      (left, right) =>
        Number(left?.task?.batchIndex || 0) - Number(right?.task?.batchIndex || 0) ||
        Number(left?.index || 0) - Number(right?.index || 0),
    )
    ordered.forEach((item, displayIndex) => {
      item.batchIndex = displayIndex
      item.total = ordered.length
    })
  })
  return items
}
