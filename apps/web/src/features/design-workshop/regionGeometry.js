function finite(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeViewport(viewport, fallback = { width: 1, height: 1 }) {
  return {
    width: Math.max(1, finite(viewport?.width, fallback.width)),
    height: Math.max(1, finite(viewport?.height, fallback.height)),
  }
}

export function fitAnalysisViewport(
  sourceViewport,
  { maxDimension = 1920, minDimension = 320, background = '#ffffff' } = {},
) {
  const source = normalizeViewport(sourceViewport)
  const scale = Math.min(
    Math.max(1, maxDimension) / Math.max(source.width, source.height),
    Math.max(1, minDimension / source.width, minDimension / source.height),
  )
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
    background,
  }
}

export function referenceNeedsRasterization(sourceViewport, analysisViewport) {
  const source = normalizeViewport(sourceViewport)
  const analysis = normalizeViewport(analysisViewport)
  return (
    Math.round(source.width) !== Math.round(analysis.width) ||
    Math.round(source.height) !== Math.round(analysis.height)
  )
}

export function clampBounds(bounds, viewport, { integer = false, minSize = 1 } = {}) {
  const frame = normalizeViewport(viewport)
  const round = integer ? Math.round : (value) => value
  const x = Math.min(frame.width - minSize, Math.max(0, finite(bounds?.x)))
  const y = Math.min(frame.height - minSize, Math.max(0, finite(bounds?.y)))
  const width = Math.min(frame.width - x, Math.max(minSize, finite(bounds?.width, minSize)))
  const height = Math.min(frame.height - y, Math.max(minSize, finite(bounds?.height, minSize)))
  const normalized = {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  }
  if (!integer) return normalized
  normalized.width = Math.max(1, Math.min(normalized.width, Math.round(frame.width) - normalized.x))
  normalized.height = Math.max(
    1,
    Math.min(normalized.height, Math.round(frame.height) - normalized.y),
  )
  return normalized
}

export function projectBounds(bounds, fromViewport, toViewport, { integer = false } = {}) {
  const from = normalizeViewport(fromViewport)
  const to = normalizeViewport(toViewport)
  return clampBounds(
    {
      x: finite(bounds?.x) * (to.width / from.width),
      y: finite(bounds?.y) * (to.height / from.height),
      width: finite(bounds?.width, 1) * (to.width / from.width),
      height: finite(bounds?.height, 1) * (to.height / from.height),
    },
    to,
    { integer },
  )
}

export function naturalBoundsForNode(node, analysisViewport, sourceViewport) {
  if (node?.naturalBounds) {
    return clampBounds(node.naturalBounds, sourceViewport, { integer: true })
  }
  return projectBounds(node, analysisViewport, sourceViewport, { integer: true })
}

export function attachNaturalBounds(nodes, analysisViewport, sourceViewport) {
  return nodes.map((node) => ({
    ...node,
    naturalBounds: naturalBoundsForNode(node, analysisViewport, sourceViewport),
    coordinateSpace: 'source-pixels',
    selectionConfirmed: Boolean(node.selectionConfirmed),
    manuallyAdjusted: Boolean(node.manuallyAdjusted),
  }))
}
