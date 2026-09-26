function normalizeSize(value) {
  const match = String(value || '').match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return ''
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? `${width}x${height}` : ''
}

export function firstOutputSize(...values) {
  for (const value of values) {
    const normalized = normalizeSize(value)
    if (normalized) return normalized
  }
  return ''
}

export function resolveTaskOutputSizeFields(job = {}, existingTask = {}) {
  const input = job?.input || job?.params || {}
  const params = job?.params || {}
  const existingActual = firstOutputSize(existingTask?.actualOutputSize)
  const actualOutputSize = firstOutputSize(
    existingActual,
    input.actualOutputSize,
    params.actualOutputSize,
  )
  const originalOutputSize = firstOutputSize(
    existingTask?.originalOutputSize,
    input.originalOutputSize,
    params.originalOutputSize,
  )
  const upstreamOutputSize = firstOutputSize(
    input.upstreamOutputSize,
    params.upstreamOutputSize,
    existingTask?.upstreamOutputSize,
    // Before the explicit field existed, outputSize represented the provider
    // result. Do not use it after a local result has been recorded.
    existingActual ? originalOutputSize : existingTask?.outputSize,
    input.outputSize,
    input.size,
    params.outputSize,
    params.size,
  )
  const upscaleTargetSize = firstOutputSize(
    existingTask?.upscaleTargetSize,
    input.upscaleTargetSize,
    params.upscaleTargetSize,
    actualOutputSize,
  )
  return {
    upstreamOutputSize,
    upscaleTargetSize,
    originalOutputSize,
    actualOutputSize,
    // Keep outputSize for older consumers, but make it mean the file the user
    // can currently open/download whenever a local result exists.
    outputSize: actualOutputSize || upstreamOutputSize,
  }
}

export function formatOutputSize(value, separator = '×') {
  const normalized = normalizeSize(value)
  return normalized ? normalized.replace('x', separator) : ''
}
