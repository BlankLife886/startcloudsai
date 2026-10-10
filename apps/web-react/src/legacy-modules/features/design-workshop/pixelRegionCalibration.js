function finite(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] || 0
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function normalizeBounds(image, bounds) {
  const imageWidth = Math.max(1, Math.round(finite(image?.width, 1)))
  const imageHeight = Math.max(1, Math.round(finite(image?.height, 1)))
  return {
    imageWidth,
    imageHeight,
    original: {
      x: clamp(Math.round(finite(bounds?.x)), 0, imageWidth - 1),
      y: clamp(Math.round(finite(bounds?.y)), 0, imageHeight - 1),
      width: Math.max(1, Math.round(finite(bounds?.width, 1))),
      height: Math.max(1, Math.round(finite(bounds?.height, 1))),
    },
  }
}

function pixelDistance(data, first, second) {
  return Math.hypot(
    data[first] - data[second],
    data[first + 1] - data[second + 1],
    data[first + 2] - data[second + 2],
  )
}

function strongestEdge(start, end, expected, scoreAt) {
  let best = null
  for (let position = start; position <= end; position += 1) {
    const rawScore = scoreAt(position)
    const distancePenalty = 1 - Math.min(0.22, Math.abs(position - expected) / 200)
    const score = rawScore * distancePenalty
    if (!best || score > best.score) best = { position, score, rawScore }
  }
  return best
}

// Outlined inputs and cards often differ from the page background by only a few RGB levels.
// Searching for four long edges is more reliable than foreground segmentation in that case.
export function calibrateOutlinedRegion(image, bounds) {
  const data = image?.data
  const { imageWidth, imageHeight, original } = normalizeBounds(image, bounds)
  if (!data || data.length < imageWidth * imageHeight * 4) return null

  const xPadding = Math.round(clamp(original.width * 0.22, 10, 56))
  const yPadding = Math.round(clamp(original.height * 0.65, 6, 28))
  const centerY = original.y + original.height / 2
  const centerX = original.x + original.width / 2
  const horizontalInset = Math.round(clamp(original.width * 0.08, 4, 24))
  const horizontalStart = clamp(original.x + horizontalInset, 1, imageWidth - 2)
  const horizontalEnd = clamp(
    original.x + original.width - horizontalInset,
    horizontalStart + 1,
    imageWidth - 2,
  )
  const horizontalScore = (y) => {
    if (y <= 0 || y >= imageHeight) return 0
    let sum = 0
    let active = 0
    let count = 0
    for (let x = horizontalStart; x <= horizontalEnd; x += 2) {
      const current = (y * imageWidth + x) * 4
      const previous = ((y - 1) * imageWidth + x) * 4
      const distance = pixelDistance(data, current, previous)
      sum += Math.min(distance, 64)
      if (distance >= 3) active += 1
      count += 1
    }
    return count ? sum / count + (active / count) * 8 : 0
  }
  const topEdge = strongestEdge(
    clamp(original.y - yPadding, 1, imageHeight - 2),
    clamp(Math.floor(centerY - original.height * 0.18), 1, imageHeight - 2),
    original.y,
    horizontalScore,
  )
  const bottomEdge = strongestEdge(
    clamp(Math.ceil(centerY + original.height * 0.18), 1, imageHeight - 2),
    clamp(original.y + original.height + yPadding, 1, imageHeight - 2),
    original.y + original.height,
    horizontalScore,
  )
  if (!topEdge || !bottomEdge || bottomEdge.position <= topEdge.position) return null

  const verticalStart = clamp(topEdge.position + 2, 1, imageHeight - 2)
  const verticalEnd = clamp(bottomEdge.position - 2, verticalStart + 1, imageHeight - 2)
  const verticalScore = (x) => {
    if (x <= 0 || x >= imageWidth) return 0
    let sum = 0
    let active = 0
    let count = 0
    for (let y = verticalStart; y <= verticalEnd; y += 1) {
      const current = (y * imageWidth + x) * 4
      const previous = (y * imageWidth + x - 1) * 4
      const distance = pixelDistance(data, current, previous)
      sum += Math.min(distance, 64)
      if (distance >= 3) active += 1
      count += 1
    }
    return count ? sum / count + (active / count) * 8 : 0
  }
  const leftEdge = strongestEdge(
    clamp(original.x - xPadding, 1, imageWidth - 2),
    clamp(Math.floor(centerX - original.width * 0.22), 1, imageWidth - 2),
    original.x,
    verticalScore,
  )
  const rightEdge = strongestEdge(
    clamp(Math.ceil(centerX + original.width * 0.22), 1, imageWidth - 2),
    clamp(original.x + original.width + xPadding, 1, imageWidth - 2),
    original.x + original.width,
    verticalScore,
  )
  if (!leftEdge || !rightEdge || rightEdge.position <= leftEdge.position) return null

  const candidate = {
    x: leftEdge.position,
    y: topEdge.position,
    width: rightEdge.position - leftEdge.position,
    height: bottomEdge.position - topEdge.position,
  }
  const widthRatio = candidate.width / original.width
  const heightRatio = candidate.height / original.height
  const edgeFloor = Math.min(
    topEdge.rawScore,
    bottomEdge.rawScore,
    leftEdge.rawScore,
    rightEdge.rawScore,
  )
  if (
    widthRatio < 0.62 ||
    widthRatio > 1.45 ||
    heightRatio < 0.58 ||
    heightRatio > 1.5 ||
    edgeFloor < 2.2
  ) {
    return null
  }
  return candidate
}

export function calibrateFlatRegion(image, bounds) {
  const imageWidth = Math.max(1, Math.round(finite(image?.width, 1)))
  const imageHeight = Math.max(1, Math.round(finite(image?.height, 1)))
  const data = image?.data
  if (!data || data.length < imageWidth * imageHeight * 4) return null
  const original = {
    x: clamp(Math.round(finite(bounds?.x)), 0, imageWidth - 1),
    y: clamp(Math.round(finite(bounds?.y)), 0, imageHeight - 1),
    width: Math.max(1, Math.round(finite(bounds?.width, 1))),
    height: Math.max(1, Math.round(finite(bounds?.height, 1))),
  }
  const padding = Math.round(clamp(Math.max(original.width, original.height) * 0.45, 8, 48))
  const left = clamp(original.x - padding, 0, imageWidth - 1)
  const top = clamp(original.y - padding, 0, imageHeight - 1)
  const right = clamp(original.x + original.width + padding, left + 1, imageWidth)
  const bottom = clamp(original.y + original.height + padding, top + 1, imageHeight)
  const width = right - left
  const height = bottom - top
  const channels = [[], [], []]
  for (let x = left; x < right; x += 2) {
    for (const y of [top, bottom - 1]) {
      const index = (y * imageWidth + x) * 4
      channels.forEach((values, channel) => values.push(data[index + channel]))
    }
  }
  for (let y = top; y < bottom; y += 2) {
    for (const x of [left, right - 1]) {
      const index = (y * imageWidth + x) * 4
      channels.forEach((values, channel) => values.push(data[index + channel]))
    }
  }
  const background = channels.map(median)
  const mask = new Uint8Array(width * height)
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const source = ((top + localY) * imageWidth + left + localX) * 4
      const distance = Math.hypot(
        data[source] - background[0],
        data[source + 1] - background[1],
        data[source + 2] - background[2],
      )
      if (data[source + 3] > 16 && distance >= 26) mask[localY * width + localX] = 1
    }
  }

  const visited = new Uint8Array(mask.length)
  const components = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    let cursor = 0
    let count = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    while (cursor < queue.length) {
      const index = queue[cursor]
      cursor += 1
      const x = index % width
      const y = Math.floor(index / width)
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      for (const neighbor of [index - 1, index + 1, index - width, index + width]) {
        if (neighbor < 0 || neighbor >= mask.length || visited[neighbor] || !mask[neighbor])
          continue
        const neighborX = neighbor % width
        if (Math.abs(neighborX - x) > 1) continue
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }
    if (count < Math.max(6, original.width * original.height * 0.025)) continue
    components.push({
      x: left + minX,
      y: top + minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      count,
    })
  }
  const originalCenter = {
    x: original.x + original.width / 2,
    y: original.y + original.height / 2,
  }
  const candidate = components
    .map((component) => {
      const overlap =
        intersectionArea(component, original) / Math.max(1, component.width * component.height)
      const distance = Math.hypot(
        component.x + component.width / 2 - originalCenter.x,
        component.y + component.height / 2 - originalCenter.y,
      )
      return {
        component,
        score: overlap * 2 + Math.max(0, 1 - distance / Math.max(1, padding * 2)),
      }
    })
    .sort((a, b) => b.score - a.score)[0]?.component
  if (!candidate) return null
  const widthRatio = candidate.width / original.width
  const heightRatio = candidate.height / original.height
  const centerShift = Math.hypot(
    candidate.x + candidate.width / 2 - originalCenter.x,
    candidate.y + candidate.height / 2 - originalCenter.y,
  )
  if (
    widthRatio < 0.55 ||
    widthRatio > 1.8 ||
    heightRatio < 0.55 ||
    heightRatio > 1.8 ||
    centerShift > Math.max(original.width, original.height) * 0.55
  ) {
    return null
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  }
}

function calibrateForegroundUnion(
  image,
  bounds,
  {
    paddingFactor = 0.25,
    threshold = 24,
    minWidthRatio = 0.4,
    minHeightRatio = 0.4,
    minPaddingX = 4,
    minPaddingY = 3,
    maxWidthRatio = 1.85,
    maxHeightRatio = 1.85,
    centerShiftFactor = 0.6,
  } = {},
) {
  const imageWidth = Math.max(1, Math.round(finite(image?.width, 1)))
  const imageHeight = Math.max(1, Math.round(finite(image?.height, 1)))
  const data = image?.data
  if (!data || data.length < imageWidth * imageHeight * 4) return null
  const original = {
    x: clamp(Math.round(finite(bounds?.x)), 0, imageWidth - 1),
    y: clamp(Math.round(finite(bounds?.y)), 0, imageHeight - 1),
    width: Math.max(1, Math.round(finite(bounds?.width, 1))),
    height: Math.max(1, Math.round(finite(bounds?.height, 1))),
  }
  const paddingX = Math.round(clamp(original.width * paddingFactor, minPaddingX, 36))
  const paddingY = Math.round(
    clamp(original.height * Math.max(0.2, paddingFactor), minPaddingY, 28),
  )
  const left = clamp(original.x - paddingX, 0, imageWidth - 1)
  const top = clamp(original.y - paddingY, 0, imageHeight - 1)
  const right = clamp(original.x + original.width + paddingX, left + 1, imageWidth)
  const bottom = clamp(original.y + original.height + paddingY, top + 1, imageHeight)
  const channels = [[], [], []]
  for (let x = left; x < right; x += 2) {
    for (const y of [top, bottom - 1]) {
      const index = (y * imageWidth + x) * 4
      channels.forEach((values, channel) => values.push(data[index + channel]))
    }
  }
  for (let y = top; y < bottom; y += 2) {
    for (const x of [left, right - 1]) {
      const index = (y * imageWidth + x) * 4
      channels.forEach((values, channel) => values.push(data[index + channel]))
    }
  }
  const background = channels.map(median)
  let minX = right
  let minY = bottom
  let maxX = left
  let maxY = top
  let count = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * imageWidth + x) * 4
      const distance = Math.hypot(
        data[index] - background[0],
        data[index + 1] - background[1],
        data[index + 2] - background[2],
      )
      if (data[index + 3] <= 16 || distance < threshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      count += 1
    }
  }
  if (count < Math.max(4, original.width * original.height * 0.012)) return null
  const candidate = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  const widthRatio = candidate.width / original.width
  const heightRatio = candidate.height / original.height
  const centerShift = Math.hypot(
    candidate.x + candidate.width / 2 - (original.x + original.width / 2),
    candidate.y + candidate.height / 2 - (original.y + original.height / 2),
  )
  if (
    widthRatio < minWidthRatio ||
    widthRatio > maxWidthRatio ||
    heightRatio < minHeightRatio ||
    heightRatio > maxHeightRatio ||
    centerShift > Math.max(original.width, original.height) * centerShiftFactor
  ) {
    return null
  }
  return candidate
}

function calibrateDenseRegion(
  image,
  bounds,
  { threshold = 16, paddingFactor = 0.2, preferSquare = false } = {},
) {
  const data = image?.data
  const { imageWidth, imageHeight, original } = normalizeBounds(image, bounds)
  if (!data || data.length < imageWidth * imageHeight * 4) return null
  const paddingX = Math.round(clamp(original.width * paddingFactor, 3, 32))
  const paddingY = Math.round(clamp(original.height * paddingFactor, 3, 24))
  const left = clamp(original.x - paddingX, 0, imageWidth - 1)
  const top = clamp(original.y - paddingY, 0, imageHeight - 1)
  const right = clamp(original.x + original.width + paddingX, left + 1, imageWidth)
  const bottom = clamp(original.y + original.height + paddingY, top + 1, imageHeight)
  const width = right - left
  const height = bottom - top
  const channels = [[], [], []]
  for (let x = left; x < right; x += 2) {
    for (const y of [top, bottom - 1]) {
      const index = (y * imageWidth + x) * 4
      channels.forEach((values, channel) => values.push(data[index + channel]))
    }
  }
  for (let y = top; y < bottom; y += 2) {
    for (const x of [left, right - 1]) {
      const index = (y * imageWidth + x) * 4
      channels.forEach((values, channel) => values.push(data[index + channel]))
    }
  }
  const background = channels.map(median)
  const mask = new Uint8Array(width * height)
  const rowCounts = new Uint32Array(height)
  const columnCounts = new Uint32Array(width)
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const source = ((top + localY) * imageWidth + left + localX) * 4
      const distance = Math.hypot(
        data[source] - background[0],
        data[source + 1] - background[1],
        data[source + 2] - background[2],
      )
      if (data[source + 3] <= 16 || distance < threshold) continue
      mask[localY * width + localX] = 1
      rowCounts[localY] += 1
      columnCounts[localX] += 1
    }
  }

  function activeSegments(counts, minimum, maxGap = 2) {
    const segments = []
    let start = -1
    let lastActive = -1
    for (let index = 0; index < counts.length; index += 1) {
      if (counts[index] >= minimum) {
        if (start < 0) start = index
        lastActive = index
      } else if (start >= 0 && index - lastActive > maxGap) {
        segments.push({ start, end: lastActive })
        start = -1
        lastActive = -1
      }
    }
    if (start >= 0) segments.push({ start, end: lastActive })
    return segments
  }

  const rowMinimum = Math.max(2, Math.round(width * (preferSquare ? 0.035 : 0.02)))
  const rowSegments = activeSegments(rowCounts, rowMinimum, 3)
  if (!rowSegments.length) return null
  const originalCenterY = original.y + original.height / 2 - top
  const chosenRows = rowSegments
    .map((segment) => {
      const segmentCenter = (segment.start + segment.end) / 2
      const length = segment.end - segment.start + 1
      const centerScore = Math.max(0, 1 - Math.abs(segmentCenter - originalCenterY) / height)
      return { ...segment, score: centerScore * 2 + Math.min(1, length / original.height) }
    })
    .sort((a, b) => b.score - a.score)[0]
  const constrainedColumns = new Uint32Array(width)
  for (let localY = chosenRows.start; localY <= chosenRows.end; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      constrainedColumns[localX] += mask[localY * width + localX]
    }
  }
  const columnMinimum = Math.max(
    2,
    Math.round((chosenRows.end - chosenRows.start + 1) * (preferSquare ? 0.035 : 0.02)),
  )
  const columnSegments = activeSegments(constrainedColumns, columnMinimum, 3)
  if (!columnSegments.length) return null
  const originalCenterX = original.x + original.width / 2 - left
  const chosenColumns = columnSegments
    .map((segment) => {
      const segmentCenter = (segment.start + segment.end) / 2
      const length = segment.end - segment.start + 1
      const centerScore = Math.max(0, 1 - Math.abs(segmentCenter - originalCenterX) / width)
      return { ...segment, score: centerScore * 2 + Math.min(1, length / original.width) }
    })
    .sort((a, b) => b.score - a.score)[0]
  const candidate = {
    x: left + chosenColumns.start,
    y: top + chosenRows.start,
    width: chosenColumns.end - chosenColumns.start + 1,
    height: chosenRows.end - chosenRows.start + 1,
  }
  const widthRatio = candidate.width / original.width
  const heightRatio = candidate.height / original.height
  const aspect = candidate.width / candidate.height
  if (
    widthRatio < 0.28 ||
    widthRatio > 1.5 ||
    heightRatio < 0.28 ||
    heightRatio > 1.5 ||
    (preferSquare && (aspect < 0.55 || aspect > 1.8))
  ) {
    return null
  }
  return candidate
}

export function calibrateRegionByType(image, bounds, type) {
  if (type === 'input') {
    return calibrateOutlinedRegion(image, bounds) || calibrateFlatRegion(image, bounds)
  }
  if (['button', 'rectangle'].includes(type)) {
    return calibrateFlatRegion(image, bounds) || calibrateOutlinedRegion(image, bounds)
  }
  if (type === 'text') {
    return calibrateForegroundUnion(image, bounds, {
      paddingFactor: 0.035,
      threshold: 20,
      minWidthRatio: 0.35,
      minHeightRatio: 0.35,
    })
  }
  if (type === 'icon') {
    return calibrateForegroundUnion(image, bounds, {
      paddingFactor: 0.35,
      threshold: 14,
      minWidthRatio: 0.3,
      minHeightRatio: 0.35,
      minPaddingX: 24,
      minPaddingY: 8,
      maxWidthRatio: 4,
      maxHeightRatio: 2.4,
      centerShiftFactor: 1.2,
    })
  }
  if (type === 'image') {
    return calibrateDenseRegion(image, bounds, {
      threshold: 12,
      paddingFactor: 0.2,
      preferSquare: originalAspectIsCompact(bounds),
    })
  }
  if (type === 'divider') {
    return calibrateForegroundUnion(image, bounds, {
      paddingFactor: 0.2,
      threshold: 16,
      minWidthRatio: 0.5,
      minHeightRatio: 0.25,
    })
  }
  return null
}

function originalAspectIsCompact(bounds) {
  const width = Math.max(1, finite(bounds?.width, 1))
  const height = Math.max(1, finite(bounds?.height, 1))
  const aspect = width / height
  return aspect >= 0.55 && aspect <= 1.8
}
