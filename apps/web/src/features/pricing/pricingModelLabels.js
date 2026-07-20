function normalizeExternalModelId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 160)
}

function shortUniqueModelSuffix(value) {
  const normalized = normalizeExternalModelId(value)
  const parts = normalized.split('-').filter(Boolean)
  return (parts[parts.length - 1] || normalized).slice(0, 12)
}

function appendUniqueModelSuffix(value, suffixValue) {
  const suffix = shortUniqueModelSuffix(suffixValue)
  const base = normalizeExternalModelId(value)
  if (!base) return suffix
  if (!suffix || base.endsWith(`-${suffix}`)) return base
  return `${base.slice(0, Math.max(1, 159 - suffix.length))}-${suffix}`.slice(0, 160)
}

function readModelLabel(model = {}) {
  const metadata =
    model?.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
      ? model.metadata
      : {}
  return String(model.label || model.name || metadata.label || metadata.name || '').trim()
}

function readPublicModelKey(model = {}) {
  return String(model.publicModelKey || model.id || '').trim()
}

function readPublicModelApiId(model = {}) {
  const metadata =
    model?.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
      ? model.metadata
      : {}
  return String(
    model.apiModelId ||
      model.externalModelId ||
      model.modelId ||
      metadata.apiModelId ||
      metadata.externalModelId ||
      readPublicModelKey(model),
  ).trim()
}

function stripUniqueModelSuffix(value = '') {
  const normalized = normalizeExternalModelId(value)
  if (!normalized) return ''
  const parts = normalized.split('-').filter(Boolean)
  const last = parts[parts.length - 1] || ''
  if (/^[a-f0-9]{8,12}$/.test(last)) {
    return parts.slice(0, -1).join('-')
  }
  return normalized
}

function formatModelKeyForDisplay(value = '') {
  const normalized = stripUniqueModelSuffix(value) || normalizeExternalModelId(value)
  if (!normalized) return ''

  const withoutPrefix = normalized.replace(/^walleven-/, '')
  const gptMatch = withoutPrefix.match(/^gpt-(\d+)-(\d+)$/)
  if (gptMatch) return `GPT-${gptMatch[1]}.${gptMatch[2]}`

  return withoutPrefix
    .split(/[-_./]+/)
    .filter(Boolean)
    .map((part, index) => {
      if (part === 'gpt') return 'GPT'
      if (/^\d+$/.test(part) && index > 0) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function registerLookupAlias(map, alias, label) {
  const normalized = String(alias || '').trim()
  if (!normalized || !label) return
  map.set(normalized, label)
  map.set(normalized.toLowerCase(), label)
}

export function buildPublicModelLabelLookup(publicModels = []) {
  const map = new Map()

  publicModels.forEach((model) => {
    const publicModelKey = readPublicModelKey(model)
    if (!publicModelKey) return

    const label = readModelLabel(model) || formatModelKeyForDisplay(publicModelKey) || publicModelKey
    const apiId = readPublicModelApiId(model)
    const aliases = new Set([
      publicModelKey,
      apiId,
      appendUniqueModelSuffix(apiId, publicModelKey),
      stripUniqueModelSuffix(apiId),
      stripUniqueModelSuffix(publicModelKey),
      ...(Array.isArray(model.providerKeys) ? model.providerKeys : []),
      ...(Array.isArray(model.upstreamModelIds) ? model.upstreamModelIds : []),
    ])

    aliases.forEach((alias) => registerLookupAlias(map, alias, label))
  })

  return map
}

export function resolveUsageModelLabel(input = {}, lookup = new Map()) {
  const resourceKey = String(input.resourceKey || input.metadata?.model || '').trim()
  const existingLabel = String(input.modelLabel || '').trim()
  if (existingLabel && existingLabel !== resourceKey) return existingLabel

  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const candidates = [
    resourceKey,
    metadata.publicModelKey,
    metadata.model,
    metadata.providerModel,
    input.providerKey,
    input.resourceType,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    const direct = lookup.get(candidate) || lookup.get(candidate.toLowerCase())
    if (direct) return direct

    const stripped = stripUniqueModelSuffix(candidate)
    const strippedLabel = lookup.get(stripped) || lookup.get(stripped.toLowerCase())
    if (strippedLabel) return strippedLabel
  }

  const primary = candidates[0] || ''
  if (primary) {
    return formatModelKeyForDisplay(primary) || primary
  }
  return 'AI 调用'
}
