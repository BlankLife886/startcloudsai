const ITEM_ARRAY_KEYS = ['nodes', 'elements', 'items', 'layers', 'components']

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function findBalancedEnd(source, start) {
  const opening = source[start]
  if (opening !== '{' && opening !== '[') return -1
  const stack = [opening === '{' ? '}' : ']']
  let inString = false
  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      if (stack.at(-1) !== char) return -1
      stack.pop()
      if (!stack.length) return index
    }
  }
  return -1
}

function balancedJsonValues(source) {
  const values = []
  const seen = new Set()
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{' && source[start] !== '[') continue
    const end = findBalancedEnd(source, start)
    if (end < 0) continue
    const candidate = source.slice(start, end + 1)
    if (seen.has(candidate)) continue
    seen.add(candidate)
    try {
      values.push(JSON.parse(candidate))
    } catch {
      // A wrapper such as :::writing{...} is not JSON; later balanced values may be.
    }
  }
  return values
}

function looksLikeElement(item) {
  if (!isRecord(item)) return false
  return Boolean(
    ['x', 'y', 'width', 'height', 'bounds', 'bbox', 'boundingBox', 'box_2d'].some(
      (key) => item[key] != null,
    ),
  )
}

function collectItemCollections(value, inheritedMetadata, output, depth = 0) {
  if (depth > 8 || (!isRecord(value) && !Array.isArray(value))) return
  if (Array.isArray(value)) {
    if (value.length && value.some(looksLikeElement)) {
      output.push({ items: value, ...inheritedMetadata, partial: false })
    }
    value.forEach((entry) => collectItemCollections(entry, inheritedMetadata, output, depth + 1))
    return
  }

  const metadata = {
    coordinateSpace:
      value.coordinateSpace || value.coordinate_space || inheritedMetadata.coordinateSpace || null,
    reportedViewport: value.viewport || inheritedMetadata.reportedViewport || null,
  }
  ITEM_ARRAY_KEYS.forEach((key) => {
    const items = value[key]
    if (Array.isArray(items) && items.length) {
      output.push({ items, ...metadata, partial: false })
    }
  })
  Object.values(value).forEach((entry) => {
    if (isRecord(entry) || Array.isArray(entry)) {
      collectItemCollections(entry, metadata, output, depth + 1)
    }
  })
}

function extractArrayObjects(source, key) {
  const collections = []
  let fromIndex = 0
  while (fromIndex < source.length) {
    const keyIndex = source.indexOf(`"${key}"`, fromIndex)
    if (keyIndex < 0) break
    fromIndex = keyIndex + key.length + 2
    const colonIndex = source.indexOf(':', fromIndex)
    if (colonIndex < 0) break
    const arrayStart = source.indexOf('[', colonIndex + 1)
    if (arrayStart < 0) break
    const between = source.slice(colonIndex + 1, arrayStart)
    if (/[}\],]/.test(between)) continue

    const objects = []
    for (let index = arrayStart + 1; index < source.length; index += 1) {
      if (source[index] !== '{') continue
      const end = findBalancedEnd(source, index)
      if (end < 0) break
      try {
        objects.push(JSON.parse(source.slice(index, end + 1)))
      } catch {
        // Keep scanning after malformed children when a later child is complete.
      }
      index = end
      const tail = source.slice(index + 1).match(/^\s*([,\]])/)?.[1]
      if (tail === ']') break
    }
    if (objects.length) collections.push(objects)
  }
  return collections
}

function extractNamedObject(source, keys) {
  for (const key of keys) {
    let fromIndex = 0
    while (fromIndex < source.length) {
      const keyIndex = source.indexOf(`"${key}"`, fromIndex)
      if (keyIndex < 0) break
      fromIndex = keyIndex + key.length + 2
      const colonIndex = source.indexOf(':', fromIndex)
      const objectStart = colonIndex < 0 ? -1 : source.indexOf('{', colonIndex + 1)
      if (objectStart < 0) break
      const between = source.slice(colonIndex + 1, objectStart)
      if (/[}\],]/.test(between)) continue
      const end = findBalancedEnd(source, objectStart)
      if (end < 0) continue
      try {
        return JSON.parse(source.slice(objectStart, end + 1))
      } catch {
        // Try the next occurrence.
      }
    }
  }
  return null
}

function payloadKey(payload) {
  try {
    return JSON.stringify([
      payload.items,
      payload.coordinateSpace,
      payload.reportedViewport,
      payload.partial,
    ])
  } catch {
    return String(payload.items)
  }
}

function hasItemCollectionKey(value, depth = 0) {
  if (depth > 8 || (!isRecord(value) && !Array.isArray(value))) return false
  if (Array.isArray(value)) {
    return value.some((entry) => hasItemCollectionKey(entry, depth + 1))
  }
  if (ITEM_ARRAY_KEYS.some((key) => Object.hasOwn(value, key))) return true
  return Object.values(value).some((entry) => hasItemCollectionKey(entry, depth + 1))
}

function collectPayloads(source) {
  const parsedValues = []
  let parsedExact = false
  try {
    parsedValues.push(JSON.parse(source))
    parsedExact = true
  } catch {
    // Prefixes, suffixes, wrappers, and truncated streams are handled below.
  }
  parsedValues.push(...balancedJsonValues(source))

  const payloads = []
  parsedValues.forEach((value) =>
    collectItemCollections(value, { coordinateSpace: null, reportedViewport: null }, payloads),
  )

  const coordinateSpace = extractNamedObject(source, ['coordinateSpace', 'coordinate_space'])
  const reportedViewport = extractNamedObject(source, ['viewport'])
  ITEM_ARRAY_KEYS.forEach((key) => {
    extractArrayObjects(source, key).forEach((items) => {
      payloads.push({ items, coordinateSpace, reportedViewport, partial: true })
    })
  })

  const unique = []
  const seen = new Set()
  payloads
    .map((payload) => ({ ...payload, items: payload.items.filter(looksLikeElement) }))
    .filter((payload) => payload.items.length)
    .sort((left, right) => right.items.length - left.items.length || Number(left.partial) - Number(right.partial))
    .forEach((payload) => {
      const key = payloadKey(payload)
      if (seen.has(key)) return
      seen.add(key)
      unique.push(payload)
    })
  return {
    payloads: unique,
    parsedJson: parsedExact || parsedValues.some((value) => hasItemCollectionKey(value)),
  }
}

/**
 * Parse model output and optionally pass each viable element collection through a domain builder.
 * Complete JSON is preferred, while already closed child objects remain usable after truncation.
 */
export function parseCropElementResponse(text, buildDocument) {
  const source = String(text || '').trim()
  if (!source) {
    throw new Error('元素分析无返回内容。可重新分析，或直接填写提示做图片编辑。')
  }

  const { payloads, parsedJson } = collectPayloads(source)
  if (!payloads.length) {
    if (parsedJson) {
      throw new Error('元素分析已返回 JSON，但其中没有可用的 nodes/elements 元素列表。')
    }
    const preview = source.replace(/\s+/g, ' ').slice(0, 72)
    throw new Error(
      `元素分析响应不完整，尚未返回可恢复的元素。请重新分析。片段：${preview}`,
    )
  }
  if (typeof buildDocument !== 'function') return payloads[0]

  let lastBuildError = null
  for (const payload of payloads) {
    try {
      return buildDocument(payload)
    } catch (caught) {
      lastBuildError = caught
    }
  }
  throw lastBuildError || new Error('元素分析结果中没有可用元素。')
}
