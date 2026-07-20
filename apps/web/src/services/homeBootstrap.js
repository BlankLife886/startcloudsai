import { buildApiUrl } from './api'
import { getApiData, getApiErrorMessage, isApiSuccess } from './apiResponse'
import { getClientId } from './clientIdentity'
import { clientLogHeaders } from './clientLogHeaders'

const HOME_BOOTSTRAP_TTL_MS = 60 * 1000

let homeBootstrapInFlight = null
let homeBootstrapCache = null
let homeBootstrapCachedAt = 0

export async function fetchHomeBootstrap(options = {}) {
  const force = options.force === true
  const signal = options.signal
  const now = Date.now()

  if (!force && homeBootstrapCache && now - homeBootstrapCachedAt < HOME_BOOTSTRAP_TTL_MS) {
    return homeBootstrapCache
  }

  if (!force && !signal && homeBootstrapInFlight) {
    return homeBootstrapInFlight
  }

  const url = new URL(buildApiUrl('/client/bootstrap/home'), window.location.origin)
  url.searchParams.set('client_id', getClientId())

  const requestPromise = fetch(url.toString(), {
    credentials: 'include',
    signal,
    headers: clientLogHeaders({
      'Content-Type': 'application/json',
    }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !isApiSuccess(data, response.status)) {
        throw new Error(getApiErrorMessage(data, `首页启动配置读取失败(${response.status})`))
      }
      homeBootstrapCache = normalizeHomeBootstrap(getApiData(data))
      homeBootstrapCachedAt = Date.now()
      return homeBootstrapCache
    })

  if (signal) {
    return requestPromise
  }

  homeBootstrapInFlight = requestPromise.finally(() => {
    homeBootstrapInFlight = null
  })

  return homeBootstrapInFlight
}

function normalizeHomeBootstrap(payload) {
  const record = payload && typeof payload === 'object' ? payload : {}
  const config = record.config && typeof record.config === 'object' ? record.config : {}
  return {
    ...record,
    config,
    searches: Array.isArray(record.searches) ? record.searches : [],
    announcements: Array.isArray(record.announcements) ? record.announcements : [],
  }
}
