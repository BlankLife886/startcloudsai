const truthyValues = new Set(['1', 'true', 'yes', 'on', 'all'])

export function isWebDebugEnabled(scope = '') {
  const raw = String(import.meta.env.VITE_WEB_DEBUG || '').trim().toLowerCase()
  if (!raw) return false
  if (truthyValues.has(raw)) return true

  const scopes = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return Boolean(scope && scopes.includes(String(scope).toLowerCase()))
}

export function webDebugLog(scope, ...args) {
  if (isWebDebugEnabled(scope)) {
    console.log(...args)
  }
}

export function webDebugInfo(scope, ...args) {
  if (isWebDebugEnabled(scope)) {
    console.info(...args)
  }
}

export function webDebugWarn(scope, ...args) {
  if (isWebDebugEnabled(scope)) {
    console.warn(...args)
  }
}

export function webDebugGroup(scope, label, callback) {
  if (!isWebDebugEnabled(scope)) return

  try {
    console.groupCollapsed(label)
    callback()
  } finally {
    console.groupEnd()
  }
}
