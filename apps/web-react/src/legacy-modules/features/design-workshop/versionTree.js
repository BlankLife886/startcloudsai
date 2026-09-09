import { LEGACY_DEVICE_FALLBACK } from './designDevices.js'

export const MAX_VERSION_DEPTH = 3

export function mediaIdentity(url = '') {
  const text = String(url || '').trim()
  if (!text) return ''
  try {
    const path =
      text.startsWith('http://') || text.startsWith('https://')
        ? new URL(text).pathname
        : text.split('?')[0]
    const marker = '/api/v1/files/'
    const at = path.indexOf(marker)
    const key = at >= 0 ? path.slice(at + marker.length) : path.replace(/^\//, '')
    return decodeURIComponent(key).replace(/\/+$/, '')
  } catch {
    return text.split('?')[0]
  }
}

export function resolveParentOutputUrl(parentUrl = '', outputUrls = []) {
  const parentKey = mediaIdentity(parentUrl)
  if (!parentKey) return ''
  const exact = outputUrls.find((url) => url === parentUrl)
  if (exact) return exact
  return outputUrls.find((url) => mediaIdentity(url) === parentKey) || ''
}

/**
 * Build a version forest from creative job outputs.
 * Roots are major versions V1…Vn (newest-first to match existing history order).
 * Children are Vn.n / Vn.n.n. Same batch group = one node with multi-device carriers.
 */
export function buildVersionForest({
  outputs = [],
  outputGroups = {},
  outputGroupIndexes = {},
  outputParents = {},
  outputDevices = {},
  analysisEntries = [],
} = {}) {
  const groups = buildRawGroups({
    outputs,
    outputGroups,
    outputGroupIndexes,
    outputParents,
    outputDevices,
  })
  const byId = new Map(groups.map((group) => [group.id, group]))
  const childrenByParent = new Map()
  for (const group of groups) {
    if (!group.parentId || !byId.has(group.parentId)) continue
    const list = childrenByParent.get(group.parentId) || []
    list.push(group)
    childrenByParent.set(group.parentId, list)
  }

  const analysisByUrl = indexAnalysisByUrl(analysisEntries)
  const labels = new Map()
  const assignChildren = (parentId, parentLabel, depth, lineage = new Set()) => {
    if (lineage.has(parentId)) return
    const nextLineage = new Set(lineage).add(parentId)
    const children = [...(childrenByParent.get(parentId) || [])].reverse()
    children.forEach((child, index) => {
      const label = `${parentLabel}.${index + 1}`
      labels.set(child.id, label)
      if (depth < MAX_VERSION_DEPTH) {
        assignChildren(child.id, label, depth + 1, nextLineage)
      }
    })
  }

  // outputs 为 newest-first，根节点按出现顺序即最新在前。
  // 编号仍按时间：最旧 = V1，最新 = Vn；列表展示最新在上。
  const rootsNewestFirst = groups.filter(
    (group) => !group.parentId || !byId.has(group.parentId),
  )
  const rootsOldestFirst = [...rootsNewestFirst].reverse()
  rootsOldestFirst.forEach((group, index) => {
    const label = `V${index + 1}`
    labels.set(group.id, label)
    assignChildren(group.id, label, 1)
  })

  const nodeById = new Map()
  const makeNode = (group, depth) => {
    const label = labels.get(group.id) || 'V?'
    const carrierUrls = Object.values(group.carriers)
    const analysis = findAnalysisForCarriers(carrierUrls, analysisByUrl)
    const children = [...(childrenByParent.get(group.id) || [])]
      .reverse()
      .map((child) => makeNode(child, depth + 1))
    const descendantCount = children.reduce(
      (sum, child) => sum + 1 + child.descendantCount,
      0,
    )
    const analyzedInTree =
      Boolean(analysis) || children.some((child) => child.analyzedInTree)
    const node = {
      id: group.id,
      label,
      depth,
      canIterate: depth < MAX_VERSION_DEPTH,
      parentId: group.parentId || '',
      carriers: { ...group.carriers },
      cover: pickCover(group.carriers),
      outputs: carrierUrls,
      analysis,
      analyzed: Boolean(analysis),
      analyzedInTree,
      children,
      descendantCount,
    }
    nodeById.set(node.id, node)
    return node
  }

  const forest = rootsNewestFirst.map((root) => makeNode(root, 1))
  const metaByOutput = {}
  for (const node of nodeById.values()) {
    for (const [deviceId, url] of Object.entries(node.carriers)) {
      if (!url) continue
      metaByOutput[url] = {
        nodeId: node.id,
        version: node.label,
        label: node.label,
        deviceId,
        depth: node.depth,
        canIterate: node.canIterate,
        analyzed: node.analyzed,
      }
    }
  }

  return { forest, nodeById, metaByOutput, groups }
}

export function getVersionDepth(label = '') {
  const text = String(label || '').trim()
  if (!text) return 0
  return text.split('.').length
}

export function canIterate(nodeOrDepth) {
  if (nodeOrDepth && typeof nodeOrDepth === 'object') {
    return Number(nodeOrDepth.depth || 0) > 0 && Number(nodeOrDepth.depth) < MAX_VERSION_DEPTH
  }
  return Number(nodeOrDepth || 0) > 0 && Number(nodeOrDepth) < MAX_VERSION_DEPTH
}

export function findAnalysisForNode(node, analysisEntries = []) {
  if (!node) return null
  return findAnalysisForCarriers(
    Object.values(node.carriers || {}),
    indexAnalysisByUrl(analysisEntries),
  )
}

export function collectDescendants(node, { includeSelf = true } = {}) {
  if (!node) return []
  const list = includeSelf ? [node] : []
  for (const child of node.children || []) {
    list.push(...collectDescendants(child, { includeSelf: true }))
  }
  return list
}

export function collectOutputUrls(nodes = []) {
  const urls = []
  for (const node of nodes) {
    for (const url of Object.values(node?.carriers || {})) {
      if (url) urls.push(url)
    }
  }
  return [...new Set(urls)]
}

export function findNodeByOutput(forest, outputUrl, nodeById) {
  if (!outputUrl) return null
  if (nodeById) {
    for (const node of nodeById.values()) {
      if (Object.values(node.carriers).includes(outputUrl)) return node
    }
  }
  for (const root of forest || []) {
    const stack = [root]
    while (stack.length) {
      const node = stack.pop()
      if (Object.values(node.carriers).includes(outputUrl)) return node
      stack.push(...(node.children || []))
    }
  }
  return null
}

export function pickCarrier(node, preferredDeviceId = '') {
  if (!node?.carriers) return ''
  if (preferredDeviceId && node.carriers[preferredDeviceId]) {
    return node.carriers[preferredDeviceId]
  }
  return pickCover(node.carriers)
}

function pickCover(carriers = {}) {
  for (const id of LEGACY_DEVICE_FALLBACK) {
    if (carriers[id]) return carriers[id]
  }
  return Object.values(carriers).find(Boolean) || ''
}

function buildRawGroups({
  outputs,
  outputGroups,
  outputGroupIndexes,
  outputParents,
  outputDevices,
}) {
  const groups = []
  const byId = new Map()
  const groupIdByOutput = new Map()

  for (const output of outputs) {
    const id = outputGroups[output] || `single:${output}`
    let group = byId.get(id)
    if (!group) {
      group = { id, outputs: [], carriers: {}, parentId: '' }
      byId.set(id, group)
      groups.push(group)
    }
    group.outputs.push(output)
    groupIdByOutput.set(output, id)
  }

  for (const group of groups) {
    group.outputs.sort(
      (a, b) =>
        (Number(outputGroupIndexes[a]) || 0) - (Number(outputGroupIndexes[b]) || 0),
    )
    group.carriers = assignCarriers(group.outputs, outputDevices)
    const parentOutput = group.outputs.map((output) => outputParents[output]).find(Boolean)
    const resolvedParent =
      parentOutput && groupIdByOutput.has(parentOutput)
        ? parentOutput
        : resolveParentOutputUrl(parentOutput, [...groupIdByOutput.keys()])
    const parentId = groupIdByOutput.get(resolvedParent) || ''
    group.parentId = parentId && parentId !== group.id ? parentId : ''
  }

  return groups
}

function assignCarriers(urls, outputDevices = {}) {
  const carriers = {}
  const usedDevices = new Set()
  urls.forEach((url, index) => {
    let deviceId = String(outputDevices[url] || '').trim()
    if (!deviceId || usedDevices.has(deviceId)) {
      deviceId =
        LEGACY_DEVICE_FALLBACK.find((id) => !usedDevices.has(id)) || `legacy-${index}`
    }
    usedDevices.add(deviceId)
    carriers[deviceId] = url
  })
  return carriers
}

function indexAnalysisByUrl(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    const url = String(entry?.referenceImage || '').trim()
    if (!url || map.has(url)) continue
    map.set(url, entry)
  }
  return map
}

function findAnalysisForCarriers(urls, analysisByUrl) {
  for (const url of urls) {
    const entry = analysisByUrl.get(url)
    if (entry) return entry
  }
  return null
}
