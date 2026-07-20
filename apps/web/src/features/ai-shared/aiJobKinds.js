/** Studio 云端任务 kind 隔离：壁纸 / 插画染色 / 其他功能互不串历史 */

const COLORING_KINDS = new Set(['illustration-coloring'])
const WALLPAPER_KINDS = new Set([
  // 兼容改名前已经创建的文生图任务；其它工作台均使用各自的专属前缀。
  'image-generation',
  'image-edit',
  'video-generation',
  'video-edit',
  'wallpaper-image-generation',
  'wallpaper-image-edit',
  'wallpaper-image-mask-edit',
  'wallpaper-image-upscale',
  'wallpaper-video-generation',
  'wallpaper-video-edit',
])
export function normalizeAiJobKind(kind = '') {
  return String(kind || '').trim().toLowerCase()
}

export function isIllustrationColoringJobKind(kind = '') {
  const value = normalizeAiJobKind(kind)
  return COLORING_KINDS.has(value)
}

export function isWallpaperStudioJobKind(kind = '') {
  const value = normalizeAiJobKind(kind)
  if (!value) return false
  return WALLPAPER_KINDS.has(value)
}

/** 识别误同步进壁纸历史的插画染色任务（含旧本地脏数据） */
export function looksLikeIllustrationColoringTask(task = {}) {
  if (!task || typeof task !== 'object') return false
  if (isIllustrationColoringJobKind(task.kind)) return true
  if (isWallpaperStudioJobKind(task.kind)) return false
  const id = String(task.id || '')
  if (id.startsWith('coloring-')) return true
  const prompt = String(task.prompt || '')
  if (/color this line art/i.test(prompt)) return true
  if (task.styleId && /watercolor|anime|storybook|dreamy/i.test(String(task.styleId))) return true
  return false
}
