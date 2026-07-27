function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function tagCategory(rawTag) {
  if (!rawTag || typeof rawTag !== 'object') return ''
  return normalizeCategory(rawTag.category)
}

export function tagTone(rawTag) {
  const category = tagCategory(rawTag)
  if (!category) return 'tag-other'
  if (category === 'general') return 'tag-general'
  if (category === 'anime') return 'tag-anime'
  if (category === 'people') return 'tag-people'
  if (category === 'photography') return 'tag-photography'
  if (category === 'artists' || category === 'art & design' || category === 'art')
    return 'tag-artists'
  if (category === 'digital') return 'tag-digital'
  if (category === 'clothing') return 'tag-clothing'
  if (category === 'colors' || category === 'color') return 'tag-colors'
  if (category === 'vehicles' || category === 'vehicle') return 'tag-vehicles'
  if (category === 'animals' || category === 'animal') return 'tag-animals'
  return 'tag-other'
}

export function tagCategoryLabel(rawTag) {
  const category = tagCategory(rawTag)
  if (!category) return ''
  return category
}
