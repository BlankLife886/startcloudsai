export function uniqueTaskOutputs(task = {}) {
  if (!Array.isArray(task?.outputs)) return []
  return Array.from(new Set(task.outputs.map((item) => String(item || '').trim()).filter(Boolean)))
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
