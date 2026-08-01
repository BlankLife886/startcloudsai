/** 创作台 / 历史页共用的任务封面 URL 解析 */

export function taskOriginalUrl(task) {
  return (
    firstUrl(task?.originalUrls) ||
    firstUrl(task?.outputUrls) ||
    firstOutputField(task?.outputs, 'url') ||
    firstOutputField(task?.outputs, 'originalUrl') ||
    ''
  )
}

export function taskThumbnailUrl(task) {
  // 后端用空 thumbnailKeys 表示暂时没有缩略图
  if (Array.isArray(task?.thumbnailKeys) && task.thumbnailKeys.length === 0) {
    return ''
  }
  return (
    firstUrl(task?.thumbnailUrls) ||
    firstUrl(task?.outputUrls) ||
    firstOutputField(task?.outputs, 'thumbnailUrl') ||
    firstOutputField(task?.outputs, 'url') ||
    ''
  )
}

/** 列表封面：优先缩略图，没有再退回原图 */
export function taskCoverUrl(task, { preferOriginal = false } = {}) {
  if (preferOriginal) {
    return taskOriginalUrl(task) || taskThumbnailUrl(task)
  }
  return taskThumbnailUrl(task) || taskOriginalUrl(task)
}

function firstUrl(list) {
  if (!Array.isArray(list)) return ''
  for (const item of list) {
    const value = String(item || '').trim()
    if (value) return value
  }
  return ''
}

function firstOutputField(outputs, field) {
  if (!Array.isArray(outputs)) return ''
  for (const item of outputs) {
    if (!item || typeof item !== 'object') continue
    const value = String(item[field] || '').trim()
    if (value) return value
  }
  return ''
}
