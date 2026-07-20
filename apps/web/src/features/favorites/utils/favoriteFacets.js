const FACET_META = {
  category: {
    label: '分类',
    icon: 'bi-grid',
    values: {
      general: '常规',
      anime: '动漫',
      people: '人物',
      100: '常规',
      '010': '动漫',
      '001': '人物',
    },
  },
  purity: {
    label: '纯净度',
    icon: 'bi-shield-check',
    values: {
      sfw: '安全',
      sketchy: '轻微敏感',
      nsfw: '敏感',
      100: '安全',
      '010': '轻微敏感',
      '001': '敏感',
    },
  },
  resolution: {
    label: '分辨率',
    icon: 'bi-aspect-ratio',
    values: {},
  },
  tag: {
    label: '标签',
    icon: 'bi-tag',
    values: {},
  },
}

function normalizeFacetValue(value) {
  return String(value || '').trim()
}

function getTagName(tag) {
  if (typeof tag === 'string') return normalizeFacetValue(tag)
  return normalizeFacetValue(tag?.name || tag?.alias || tag?.id)
}

export function getFacetDisplayValue(type, value) {
  const normalized = normalizeFacetValue(value)
  return FACET_META[type]?.values?.[normalized.toLowerCase()] || normalized
}

export function getFacetMeta(type) {
  return FACET_META[type] || { label: '维度', icon: 'bi-circle', values: {} }
}

export function getFavoriteFacets(item) {
  const facets = []

  const category = normalizeFacetValue(item?.category)
  if (category) {
    facets.push({
      type: 'category',
      value: category,
      label: getFacetDisplayValue('category', category),
    })
  }

  const purity = normalizeFacetValue(item?.purity)
  if (purity) {
    facets.push({
      type: 'purity',
      value: purity,
      label: getFacetDisplayValue('purity', purity),
    })
  }

  const resolution = normalizeFacetValue(item?.resolution)
  if (resolution) {
    facets.push({
      type: 'resolution',
      value: resolution,
      label: resolution,
    })
  }

  if (Array.isArray(item?.tags)) {
    item.tags
      .map(getTagName)
      .filter(Boolean)
      .slice(0, 5)
      .forEach((tag) => {
        facets.push({
          type: 'tag',
          value: tag,
          label: tag,
        })
      })
  }

  const seen = new Set()
  return facets.filter((facet) => {
    const key = getFacetKey(facet)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getFacetKey(facet) {
  return `${facet?.type || ''}:${normalizeFacetValue(facet?.value).toLowerCase()}`
}

export function doesFavoriteMatchFacet(item, facet) {
  if (!facet?.type) return true
  const wanted = normalizeFacetValue(facet.value).toLowerCase()
  if (!wanted) return true

  if (facet.type === 'tag') {
    return (
      Array.isArray(item?.tags) && item.tags.some((tag) => getTagName(tag).toLowerCase() === wanted)
    )
  }

  return normalizeFacetValue(item?.[facet.type]).toLowerCase() === wanted
}
