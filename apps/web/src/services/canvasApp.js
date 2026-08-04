export const CANVAS_APP_PATH = '/canvas'
export const CANVAS_APP_BASE_PATH = '/canvas-app'
export const CANVAS_AUTH_REQUIRED_MESSAGE = 'starclouds:canvas:auth-required'
export const CANVAS_THEME_MESSAGE = 'starclouds:canvas:theme'
export const CANVAS_ROUTE_MESSAGE = 'starclouds:canvas:route'

const CANVAS_ROUTE_PATTERN = /^\/(?:$|canvas(?:\/[^/?#]+)?|image|video|prompts|assets|config)\/?$/

function trimTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

export function normalizeCanvasRoutePath(value, fallback = CANVAS_APP_PATH) {
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

function appendTheme(url, theme) {
  const parsed = new URL(url, window.location.origin)
  parsed.searchParams.set('theme', theme === 'dark' ? 'dark' : 'light')
  return parsed.origin === window.location.origin
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.href
}

export function getCanvasAppUrl(theme = 'light', routePath = CANVAS_APP_PATH) {
  const normalizedRoute = normalizeCanvasRoutePath(routePath)
  if (!import.meta.env.DEV) {
    return appendTheme(`${CANVAS_APP_BASE_PATH}${normalizedRoute}`, theme)
  }

  const configured = String(import.meta.env.VITE_CANVAS_APP_URL || '').trim()
  if (!configured) {
    const canvasOrigin = new URL(window.location.origin)
    canvasOrigin.port = '3104'
    return appendTheme(`${canvasOrigin.origin}${normalizedRoute}`, theme)
  }

  const normalized = trimTrailingSlash(configured)
  const base = normalized.endsWith(CANVAS_APP_PATH)
    ? normalized.slice(0, -CANVAS_APP_PATH.length)
    : normalized
  return appendTheme(`${base}${normalizedRoute}`, theme)
}
