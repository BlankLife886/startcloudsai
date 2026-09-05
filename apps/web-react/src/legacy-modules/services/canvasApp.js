const CANVAS_ROUTE_PATTERN = /^\/(?:$|canvas(?:\/[^/?#]+)?|config)\/?$/

export function normalizeCanvasRoutePath(value, fallback = '/canvas') {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return fallback
  try {
    const parsed = new URL(raw, 'https://canvas.starclouds.local')
    if (parsed.origin !== 'https://canvas.starclouds.local') return fallback
    if (!CANVAS_ROUTE_PATTERN.test(parsed.pathname)) return fallback
    parsed.searchParams.delete('theme')
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
