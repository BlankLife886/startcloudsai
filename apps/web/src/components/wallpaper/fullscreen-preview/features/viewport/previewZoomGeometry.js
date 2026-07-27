export const MIN_ZOOM = 1
export const DOUBLE_CLICK_ZOOM_MAX = 3
export const MAX_ZOOM = 5
export const ZOOM_STEP_FACTOR = 1.2

export function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function getEffectiveBounds(metrics, forZoom, rotation = 0) {
  if (!metrics) return { maxOffsetX: 0, maxOffsetY: 0 }

  const isRotated = rotation % 180 !== 0
  let scaledWidth = metrics.baseDisplayWidth * forZoom
  let scaledHeight = metrics.baseDisplayHeight * forZoom

  if (isRotated) {
    ;[scaledWidth, scaledHeight] = [scaledHeight, scaledWidth]
  }

  return {
    maxOffsetX: Math.max(0, (scaledWidth - metrics.containerWidth) / 2),
    maxOffsetY: Math.max(0, (scaledHeight - metrics.containerHeight) / 2),
  }
}

export function clampOffsets(nextOffsetX, nextOffsetY, { metrics, zoom, rotation }) {
  const { maxOffsetX, maxOffsetY } = getEffectiveBounds(metrics, zoom, rotation)
  return {
    x: Math.max(Math.min(nextOffsetX, maxOffsetX), -maxOffsetX),
    y: Math.max(Math.min(nextOffsetY, maxOffsetY), -maxOffsetY),
  }
}

export function getVisibleSourceRect(metrics, forZoom, forOffsetX, forOffsetY) {
  if (!metrics) return null

  const scale = metrics.baseScale * forZoom
  if (!scale) return null

  const visibleSourceWidth = Math.min(metrics.naturalWidth, metrics.containerWidth / scale)
  const visibleSourceHeight = Math.min(metrics.naturalHeight, metrics.containerHeight / scale)
  const maxSourceLeft = Math.max(0, metrics.naturalWidth - visibleSourceWidth)
  const maxSourceTop = Math.max(0, metrics.naturalHeight - visibleSourceHeight)

  const sourceLeft = Math.max(
    0,
    Math.min(maxSourceLeft, (metrics.naturalWidth - visibleSourceWidth) / 2 - forOffsetX / scale),
  )
  const sourceTop = Math.max(
    0,
    Math.min(maxSourceTop, (metrics.naturalHeight - visibleSourceHeight) / 2 - forOffsetY / scale),
  )

  return {
    ...metrics,
    scale,
    visibleSourceWidth,
    visibleSourceHeight,
    sourceLeft,
    sourceTop,
    maxSourceLeft,
    maxSourceTop,
  }
}

export function getZoomOffsetsAroundPoint({
  previousZoom,
  nextZoom,
  offsetX,
  offsetY,
  containerRect,
  point,
}) {
  const focusX = point?.clientX ?? containerRect.left + containerRect.width / 2
  const focusY = point?.clientY ?? containerRect.top + containerRect.height / 2
  const localX = focusX - (containerRect.left + containerRect.width / 2)
  const localY = focusY - (containerRect.top + containerRect.height / 2)
  const zoomRatio = nextZoom / previousZoom

  return {
    x: offsetX * zoomRatio - localX * (zoomRatio - 1),
    y: offsetY * zoomRatio - localY * (zoomRatio - 1),
  }
}
