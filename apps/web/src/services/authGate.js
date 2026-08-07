import { reactive } from 'vue'

export const authGateState = reactive({
  open: false,
  target: '/',
  pageTitle: '此页面',
})

function normalizeTarget(value) {
  const target = String(value || '').trim()
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/profile'
  if (target === '/auth' || target.startsWith('/auth?') || target.startsWith('/auth/')) {
    return '/profile'
  }
  return target
}

export function requestAuthentication({ target, pageTitle } = {}) {
  authGateState.target = normalizeTarget(target)
  authGateState.pageTitle = String(pageTitle || '').trim() || '此页面'
  authGateState.open = true
}

export function dismissAuthenticationRequest() {
  authGateState.open = false
}
