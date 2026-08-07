function uniqueSources(values) {
  return Array.from(
    new Set(
      Array.from(values || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  )
}

/**
 * Keep identity references ahead of optional style anchors when a model has a
 * small reference-image budget. The caller still controls whether the current
 * generated frame or the original identities must appear first.
 */
export function orderConsistencyReferences({
  identitySources = [],
  anchorSources = [],
  limit = 4,
  essentialIdentityCount = 1,
  strategy = 'identity-first',
} = {}) {
  const capacity = Math.max(0, Number(limit) || 0)
  if (!capacity) return []

  const identities = uniqueSources(identitySources)
  const anchors = uniqueSources(anchorSources).filter((source) => !identities.includes(source))
  const essentialCount = Math.min(
    identities.length,
    Math.max(0, Number(essentialIdentityCount) || 0),
  )
  const essential = identities.slice(0, essentialCount)
  const supplemental = identities.slice(essentialCount)
  const ordered =
    strategy === 'anchor-first'
      ? [...anchors, ...essential, ...supplemental]
      : [...essential, ...anchors, ...supplemental]

  return uniqueSources(ordered).slice(0, capacity)
}

export function hasConsistencyCapacity({
  limit = 0,
  essentialIdentityCount = 1,
  anchorRequired = false,
} = {}) {
  const required = Math.max(0, Number(essentialIdentityCount) || 0) + (anchorRequired ? 1 : 0)
  return Math.max(0, Number(limit) || 0) >= required
}

export function mapConsistencyReferenceRoles({
  roles = [],
  referenceCount = 0,
  essentialIdentityCount = 1,
  seriesAnchorApplied = false,
} = {}) {
  const mapped = Array.from(roles || [])
    .map((role) => String(role || '').trim())
    .filter(Boolean)
  if (seriesAnchorApplied) {
    const anchorIndex = Math.min(
      mapped.length,
      Math.max(0, Number(essentialIdentityCount) || 0),
    )
    mapped.splice(anchorIndex, 0, '系列视觉锚点（只继承布景、光线与版式）')
  }
  return Array.from({ length: Math.max(0, Number(referenceCount) || 0) }, (_, index) => {
    return mapped[index] || `补充身份参考 ${index + 1}`
  })
}
