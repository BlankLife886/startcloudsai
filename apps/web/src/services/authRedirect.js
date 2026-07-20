export const DEFAULT_AUTH_REDIRECT = '/profile'

function fallbackRedirect(fallback = DEFAULT_AUTH_REDIRECT) {
  return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : DEFAULT_AUTH_REDIRECT
}

export function normalizeAuthRedirect(value, fallback = DEFAULT_AUTH_REDIRECT) {
  const normalizedFallback = fallbackRedirect(fallback)
  const rawValue = Array.isArray(value) ? value[0] : value
  const candidate = String(rawValue || '').trim()
  if (!candidate) return normalizedFallback

  try {
    const base = typeof window === 'undefined' ? 'http://walleven.local' : window.location.origin
    const url = new URL(candidate, base)
    if (typeof window !== 'undefined' && url.origin !== window.location.origin) {
      return normalizedFallback
    }

    if (url.pathname === '/profile' && url.searchParams.get('tab') === 'account') {
      url.searchParams.delete('tab')
    }

    const search = url.searchParams.toString()
    const path = `${url.pathname || '/'}${search ? `?${search}` : ''}${url.hash || ''}`
    if (!path || path.startsWith('/auth/') || path === '/auth') return normalizedFallback
    return path
  } catch {
    return normalizedFallback
  }
}

export function createLoginRedirectQuery(target = DEFAULT_AUTH_REDIRECT) {
  return {
    redirect: normalizeAuthRedirect(target),
  }
}

export function createAuthRedirectLocation(value, fallback = DEFAULT_AUTH_REDIRECT) {
  const normalized = normalizeAuthRedirect(value, fallback)
  const url = new URL(normalized, 'http://walleven.local')
  return {
    path: url.pathname || '/',
    query: Object.fromEntries(url.searchParams.entries()),
    hash: url.hash || '',
  }
}
