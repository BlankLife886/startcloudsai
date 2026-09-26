function finite(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function area(bounds) {
  return Math.max(0, finite(bounds?.width)) * Math.max(0, finite(bounds?.height))
}

function intersectionArea(a, b) {
  const left = Math.max(finite(a?.x), finite(b?.x))
  const top = Math.max(finite(a?.y), finite(b?.y))
  const right = Math.min(finite(a?.x) + finite(a?.width), finite(b?.x) + finite(b?.width))
  const bottom = Math.min(finite(a?.y) + finite(a?.height), finite(b?.y) + finite(b?.height))
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function intersectionOverUnion(a, b) {
  const intersection = intersectionArea(a, b)
  return intersection / Math.max(1, area(a) + area(b) - intersection)
}

function containmentRatio(container, child) {
  return intersectionArea(container, child) / Math.max(1, area(child))
}

function semanticKey(node) {
  return String(node?.text || node?.name || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function duplicatePriority(node) {
  const typePriority = {
    image: 8,
    icon: 7,
    button: 6,
    input: 6,
    text: 5,
    divider: 4,
    rectangle: 3,
    frame: 2,
  }
  return finite(node?.confidence, 0.8) * 10 + (typePriority[node?.type] || 0)
}

function areNearDuplicates(a, b) {
  if (intersectionOverUnion(a, b) < 0.9) return false
  if (a.type === b.type) return true
  const aKey = semanticKey(a)
  const bKey = semanticKey(b)
  return Boolean(aKey && bKey && aKey === bKey)
}

function correctNodeType(node, viewport) {
  const corrected = { ...node }
  const frameWidth = Math.max(1, finite(viewport?.width, 1))
  const aspectRatio = finite(node?.width) / Math.max(1, finite(node?.height, 1))
  const name = String(node?.name || '')
  if (node?.type === 'button' && finite(node.width) > frameWidth * 0.45 && aspectRatio > 8) {
    corrected.type = 'frame'
    corrected.category = 'layout'
    return corrected
  }
  if (
    node?.type === 'button' &&
    /(?:语言|时区).*(?:选择|下拉)|(?:选择框|下拉框)/u.test(name) &&
    finite(node.width) > 100
  ) {
    corrected.type = 'input'
    corrected.category = 'component'
  }
  return corrected
}

export function stabilizeAnalysisNodes(nodes, viewport) {
  const accepted = []
  for (const source of Array.isArray(nodes) ? nodes : []) {
    const node = correctNodeType(source, viewport)
    if (!node?.id || area(node) < 1 || finite(node.confidence, 0.8) < 0.35) continue
    const duplicateIndex = accepted.findIndex((candidate) => areNearDuplicates(candidate, node))
    if (duplicateIndex < 0) {
      accepted.push({ ...node })
      continue
    }
    if (duplicatePriority(node) > duplicatePriority(accepted[duplicateIndex])) {
      accepted[duplicateIndex] = { ...node }
    }
  }

  const byId = new Map(accepted.map((node) => [node.id, node]))
  const frames = accepted.filter((node) => node.type === 'frame')
  for (const node of accepted) {
    const currentParent = byId.get(node.parentId)
    const validParent =
      currentParent &&
      currentParent.id !== node.id &&
      area(currentParent) > area(node) &&
      containmentRatio(currentParent, node) >= 0.86
    if (validParent) continue
    const replacement = frames
      .filter(
        (candidate) =>
          candidate.id !== node.id &&
          area(candidate) > area(node) * 1.05 &&
          containmentRatio(candidate, node) >= 0.92,
      )
      .sort((a, b) => area(a) - area(b))[0]
    node.parentId = replacement?.id || ''
  }
  return accepted
}

function assetBounds(asset, viewport) {
  const region = asset?.region
  if (!region) return null
  const width = Math.max(1, finite(viewport?.width, 1))
  const height = Math.max(1, finite(viewport?.height, 1))
  return {
    x: finite(region.x) * width,
    y: finite(region.y) * height,
    width: Math.max(1, finite(region.width) * width),
    height: Math.max(1, finite(region.height) * height),
  }
}

function centerDistance(a, b) {
  return Math.hypot(
    finite(a.x) + finite(a.width) / 2 - (finite(b.x) + finite(b.width) / 2),
    finite(a.y) + finite(a.height) / 2 - (finite(b.y) + finite(b.height) / 2),
  )
}

export function spatialAssetAffinity(asset, node, viewport) {
  const target = assetBounds(asset, viewport)
  if (!target || !node) return 0
  const overlap = intersectionArea(target, node) / Math.max(1, Math.min(area(target), area(node)))
  const distance = centerDistance(target, node)
  const reach = Math.max(24, Math.hypot(target.width, target.height) * 1.5)
  const proximity = Math.max(0, 1 - distance / reach)
  if (overlap <= 0 && proximity <= 0) return 0
  const ratio = area(node) / Math.max(1, area(target))
  const sizeFit = Math.max(0, 1 - Math.abs(Math.log(Math.max(0.01, ratio))) / Math.log(8))
  return Math.min(1, overlap * 0.55 + proximity * 0.3 + sizeFit * 0.15)
}
