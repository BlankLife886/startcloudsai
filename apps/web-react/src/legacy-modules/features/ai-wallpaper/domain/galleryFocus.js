export function galleryGroupKey(item) {
  const task = item?.task
  return String(task?.batchId || task?.id || item?.key || '')
}

export function galleryFocusForItem(item) {
  if (!item?.key) return { key: '', groupKey: '', item: null }
  return {
    key: item.key,
    groupKey: galleryGroupKey(item),
    item,
  }
}

export function galleryGroupTasks(group) {
  const tasksById = new Map()
  for (const item of group?.items || []) {
    const task = item?.task
    if (task?.id) tasksById.set(String(task.id), task)
  }
  return [...tasksById.values()]
}

export function resolveGalleryFocus(items, current = {}) {
  if (!Array.isArray(items) || !items.length) return galleryFocusForItem(null)

  const key = String(current.key || '')
  const groupKey = String(current.groupKey || '')
  const exactItem = items.find((item) => item.key === key)
  if (exactItem && (!groupKey || galleryGroupKey(exactItem) === groupKey)) {
    return galleryFocusForItem(exactItem)
  }

  const pendingMatch = key.match(/^pending-(.+)-(\d+)$/)
  if (pendingMatch) {
    const completedItem = items.find((item) => item.key === `${pendingMatch[1]}-${pendingMatch[2]}`)
    if (completedItem && (!groupKey || galleryGroupKey(completedItem) === groupKey)) {
      return galleryFocusForItem(completedItem)
    }
  }

  const itemInFocusedGroup = groupKey
    ? items.find((item) => galleryGroupKey(item) === groupKey)
    : null
  if (itemInFocusedGroup) return galleryFocusForItem(itemInFocusedGroup)

  return galleryFocusForItem(
    items.find((item) => item.kind === 'image') ||
      items.find((item) => item.kind === 'pending') ||
      items[0],
  )
}
