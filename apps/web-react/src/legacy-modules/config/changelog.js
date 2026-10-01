/**
 * 更新说明页的标签元数据。条目由后台「内容管理 → 更新说明」发版，与公告分开。
 */
export const CHANGELOG_TAG_META = {
  feature: { label: '新功能', className: 'is-feature' },
  experience: { label: '体验', className: 'is-experience' },
}

export const CHANGELOG_TAG_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'feature', label: '新功能' },
  { id: 'experience', label: '体验' },
]

export function normalizeChangelogTag(tag) {
  if (tag === 'feature') return tag
  return 'experience'
}

export function getChangelogTagMeta(tag) {
  return CHANGELOG_TAG_META[normalizeChangelogTag(tag)] || CHANGELOG_TAG_META.experience
}
