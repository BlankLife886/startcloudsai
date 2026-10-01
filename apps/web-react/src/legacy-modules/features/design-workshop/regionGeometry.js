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

export function containedContentBox(containerViewport, sourceViewport) {
  const container = normalizeViewport(containerViewport)
  const source = normalizeViewport(sourceViewport)
  const scale = Math.min(container.width / source.width, container.height / source.height)
  const width = source.width * scale
  const height = source.height * scale
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  }
}

export function projectContainerRegionToContent(region, containerViewport, sourceViewport) {
  const container = normalizeViewport(containerViewport)
  const content = containedContentBox(container, sourceViewport)
  const contentFrame = {
    x: content.x / container.width,
    y: content.y / container.height,
    width: content.width / container.width,
    height: content.height / container.height,
  }
  const left = Math.max(contentFrame.x, finite(region?.x))
  const top = Math.max(contentFrame.y, finite(region?.y))
  const right = Math.min(
    contentFrame.x + contentFrame.width,
    finite(region?.x) + Math.max(0, finite(region?.width)),
  )
  const bottom = Math.min(
    contentFrame.y + contentFrame.height,
    finite(region?.y) + Math.max(0, finite(region?.height)),
  )
  if (right <= left || bottom <= top) return null
  return {
    x: (left - contentFrame.x) / contentFrame.width,
    y: (top - contentFrame.y) / contentFrame.height,
    width: (right - left) / contentFrame.width,
    height: (bottom - top) / contentFrame.height,
  }
}

export function sourcePixelBoundsForRegion(region, sourceViewport) {
  const source = normalizeViewport(sourceViewport)
  const left = Math.max(0, Math.min(source.width - 1, Math.floor(finite(region?.x) * source.width)))
  const top = Math.max(
    0,
    Math.min(source.height - 1, Math.floor(finite(region?.y) * source.height)),
  )
  const right = Math.max(
    left + 1,
    Math.min(
      source.width,
      Math.ceil((finite(region?.x) + Math.max(0, finite(region?.width))) * source.width - 1e-9),
    ),
  )
  const bottom = Math.max(
    top + 1,
    Math.min(
      source.height,
      Math.ceil((finite(region?.y) + Math.max(0, finite(region?.height))) * source.height - 1e-9),
    ),
  )
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
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

function cropBoundsSource(item) {
  const nested =
    item?.bounds ||
    item?.boundingBox ||
    item?.bounding_box ||
    item?.bbox ||
    item?.box_2d ||
    item?.box2d ||
    item?.box ||
    item?.rect
  const format = String(item?.boxFormat || item?.box_format || item?.format || '').toLowerCase()
  if (Array.isArray(nested) && nested.length >= 4) {
    if (format.includes('yxyx')) {
      return { x: nested[1], y: nested[0], right: nested[3], bottom: nested[2] }
    }
    return format.includes('xyxy') || format.includes('corners')
      ? { x: nested[0], y: nested[1], right: nested[2], bottom: nested[3] }
      : { x: nested[0], y: nested[1], width: nested[2], height: nested[3] }
  }
  const value = nested && typeof nested === 'object' ? nested : item || {}
  const x = value.x ?? value.left ?? value.xmin ?? value.xMin ?? value.x_min
  const y = value.y ?? value.top ?? value.ymin ?? value.yMin ?? value.y_min
  const right = value.right ?? value.xmax ?? value.xMax ?? value.x_max
  const bottom = value.bottom ?? value.ymax ?? value.yMax ?? value.y_max
  const width = value.width ?? value.w
  const height = value.height ?? value.h
  return right != null && bottom != null ? { x, y, right, bottom } : { x, y, width, height }
}

function coordinateViewport(value, fallback) {
  const target = normalizeViewport(fallback)
  if (!value) return null
  if (typeof value === 'string') {
    const unit = value.toLowerCase()
    if (unit.includes('percent')) return { width: 100, height: 100 }
    if (unit.includes('1000')) return { width: 1000, height: 1000 }
    if (unit.includes('normalized')) return { width: 1, height: 1 }
    return null
  }
  const unit = String(value.unit || value.units || value.type || '').toLowerCase()
  if (unit.includes('percent')) return { width: 100, height: 100 }
  const width = finite(value.width ?? value.w, 0)
  const height = finite(value.height ?? value.h, 0)
  if (width > 0 && height > 0) return { width, height }
  if (unit.includes('normalized')) return { width: 1, height: 1 }
  return target
}

function coordinateNumber(value, axisSize) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized.endsWith('%')) {
      return (finite(normalized.slice(0, -1)) / 100) * axisSize
    }
    if (normalized.endsWith('px')) return finite(normalized.slice(0, -2))
  }
  return finite(value)
}

function inferredCoordinateViewport(items, fallback) {
  const values = items
    .flatMap((item) => Object.values(cropBoundsSource(item)))
    .filter((value) => !(typeof value === 'string' && value.trim().endsWith('%')))
    .map((value) => Number(value))
    .filter(Number.isFinite)
  if (values.length && values.every((value) => value >= 0 && value <= 1.5)) {
    return { width: 1, height: 1 }
  }
  return normalizeViewport(fallback)
}

export function normalizeCropElementItems(
  items,
  { viewport, coordinateSpace = null, reportedViewport = null } = {},
) {
  const target = normalizeViewport(viewport)
  const inferred = inferredCoordinateViewport(Array.isArray(items) ? items : [], target)
  const inferredNormalized = inferred.width === 1 && inferred.height === 1 ? inferred : null
  // Models occasionally declare a 1000×1000 grid but still emit 0..1 values. The values are
  // stronger evidence in that unambiguous case; honoring the contradictory metadata collapses
  // every hit target to roughly one pixel in the crop's top-left corner.
  const source =
    inferredNormalized ||
    coordinateViewport(coordinateSpace, target) ||
    coordinateViewport(reportedViewport, target) ||
    inferred
  const scaleX = target.width / source.width
  const scaleY = target.height / source.height
  return (Array.isArray(items) ? items : []).map((item) => {
    const raw = cropBoundsSource(item)
    const rawX = coordinateNumber(raw.x, source.width)
    const rawY = coordinateNumber(raw.y, source.height)
    const rawRight =
      raw.right != null
        ? coordinateNumber(raw.right, source.width)
        : rawX + Math.max(1 / scaleX, coordinateNumber(raw.width, source.width))
    const rawBottom =
      raw.bottom != null
        ? coordinateNumber(raw.bottom, source.height)
        : rawY + Math.max(1 / scaleY, coordinateNumber(raw.height, source.height))
    const projectedLeft = Math.min(rawX, rawRight) * scaleX
    const projectedTop = Math.min(rawY, rawBottom) * scaleY
    const projectedRight = Math.max(rawX, rawRight) * scaleX
    const projectedBottom = Math.max(rawY, rawBottom) * scaleY
    const x = Math.max(0, Math.min(Math.round(target.width) - 1, Math.round(projectedLeft)))
    const y = Math.max(0, Math.min(Math.round(target.height) - 1, Math.round(projectedTop)))
    const right = Math.max(x + 1, Math.min(Math.round(target.width), Math.round(projectedRight)))
    const bottom = Math.max(y + 1, Math.min(Math.round(target.height), Math.round(projectedBottom)))
    return {
      ...item,
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  })
}
