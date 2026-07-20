import axios from 'axios'
import { randomWallhavenSeed } from '@/utils/wallhaven'
import { recordWallhavenSearchWindowHit } from '@/utils/wallhavenBudget'
import notificationService from './notification'
import { attachClientLogHeaders } from './clientLogHeaders'
import { webDebugLog } from './debugLog'
import { getApiData, getApiErrorMessage, isApiSuccess } from './apiResponse'
import storageService from './storage'
import { getAuthToken } from './auth'
import { API_BASE_URL, buildApiUrl } from './apiBase'

// 不再使用模拟API
const USE_MOCK_API = false
export { API_BASE_URL, buildApiUrl }

/**
 * 纯 Wallhaven Worker 无 GET /user/*；跳过后直接用 Wallhaven 搜索与合集数据回退。
 */
function skipLegacyUserListApi() {
  const off =
    import.meta.env.VITE_SKIP_LEGACY_USER_API === '0' ||
    import.meta.env.VITE_SKIP_LEGACY_USER_API === 'false'
  if (off) return false
  const on =
    import.meta.env.VITE_SKIP_LEGACY_USER_API === '1' ||
    import.meta.env.VITE_SKIP_LEGACY_USER_API === 'true'
  if (on) return true
  const envBase = String(import.meta.env.VITE_API_BASE_URL || '').toLowerCase()
  if (envBase.includes('workers.dev') || envBase.includes('wallhaven-proxy')) return true
  // 构建产物里 VITE_API_BASE_URL 可能为 /api：用当前页 origin 拼出绝对地址再判断（同源指向 Worker 反代时有效）
  try {
    if (typeof window !== 'undefined') {
      const b = API_BASE_URL
      const abs = b.startsWith('http')
        ? b
        : new URL(b.startsWith('/') ? b : `/${b}`, window.location.origin).href
      const low = abs.toLowerCase()
      if (low.includes('workers.dev') || low.includes('wallhaven-proxy')) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function skipAiCapabilityApi() {
  const off =
    import.meta.env.VITE_SKIP_AI_CAPABILITY_API === '0' ||
    import.meta.env.VITE_SKIP_AI_CAPABILITY_API === 'false'
  if (off) return false
  const on =
    import.meta.env.VITE_SKIP_AI_CAPABILITY_API === '1' ||
    import.meta.env.VITE_SKIP_AI_CAPABILITY_API === 'true'
  if (on) return true
  const envBase = String(import.meta.env.VITE_API_BASE_URL || '').toLowerCase()
  if (envBase.includes('workers.dev') || envBase.includes('wallhaven-proxy')) return true
  try {
    if (typeof window !== 'undefined') {
      const b = API_BASE_URL
      const abs = b.startsWith('http')
        ? b
        : new URL(b.startsWith('/') ? b : `/${b}`, window.location.origin).href
      const low = abs.toLowerCase()
      if (low.includes('workers.dev') || low.includes('wallhaven-proxy')) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

// 创建axios实例
const HTTP_CLIENT_TIMEOUT_MS = 180000

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: HTTP_CLIENT_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  // 重试配置
  retry: 0, // 最大重试次数
  retryDelay: 1000, // 重试间隔时间（毫秒）
})

const rawApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: HTTP_CLIENT_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    attachClientLogHeaders(config)

    // 确保每个请求都有重试配置
    config.retry = config.retry ?? api.defaults.retry ?? 0
    config.retryDelay = config.retryDelay ?? api.defaults.retryDelay ?? 1000

    return config
  },
  (error) => {
    // 对请求错误做些什么
    return Promise.reject(error)
  },
)

rawApi.interceptors.request.use((config) => {
  attachClientLogHeaders(config)
  const token = getAuthToken()
  if (token) {
    config.headers = {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    }
  }
  return config
})

function readApiDataField(payload, key) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {}
  return data[key]
}

function readOnlineMode(payload) {
  return readApiDataField(payload, 'online_mode') === true
}

function createApiProtocolError(response, fallbackMessage) {
  const error = new Error(getApiErrorMessage(response?.data, fallbackMessage))
  error.response = response
  return error
}

function normalizeApiServiceData(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { success: true, ...payload }
  }
  return payload
}

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    if (!isApiSuccess(response.data, response.status)) {
      throw createApiProtocolError(response, `请求失败(${response.status})`)
    }
    return normalizeApiServiceData(getApiData(response.data))
  },
  (error) => {
    // 获取请求配置
    const config = error.config || {}

    // 如果没有重试配置，或者已经重试完毕，则处理错误
    if (!config || !config.retry || config._retryCount >= config.retry) {
      // 对响应错误做点什么
      console.error('API请求错误:', error)

      // 获取错误信息
      let errorMessage = '请求失败，请稍后再试'

      if (error.response) {
        // 服务器返回了错误状态码
        const status = error.response.status

        switch (status) {
          case 400:
            errorMessage = '请求参数错误'
            break
          case 401:
            errorMessage = '未授权，请登录'
            break
          case 403:
            errorMessage = '拒绝访问'
            break
          case 404:
            errorMessage = '请求的资源不存在'
            break
          case 500:
            errorMessage = '服务器内部错误'
            break
          default:
            errorMessage = `请求失败(${status})`
        }

        errorMessage = getApiErrorMessage(error.response.data, errorMessage)
      } else if (error.request) {
        // 请求已发送但没有收到响应
        errorMessage = '服务器无响应，请检查网络连接'
      }

      // 将错误信息添加到error对象中
      error.message = errorMessage

      // 线上 Worker 等对「已知不支持」的接口已返回说明，页面会自行展示，不再弹全局 Toast 避免重复
      const skipToast = config.suppressGlobalError === true || readOnlineMode(error.response?.data)

      if (!skipToast) {
        notificationService.error(errorMessage, {
          duration: 5000,
          position: 'top-right',
        })
      }

      return Promise.reject(error)
    }

    // 如果是网络错误或超时错误，进行重试
    if (
      error.message.includes('Network Error') ||
      error.message.includes('timeout') ||
      !error.response
    ) {
      // 设置重试计数
      config._retryCount = config._retryCount || 0
      config._retryCount += 1

      // 创建新的Promise用于延迟重试
      const retryDelay = config.retryDelay || 1000

      webDebugLog('api', `请求失败，正在进行第 ${config._retryCount} 次重试...`)

      // 仅在重试开始时轻量提示一次，避免网络抖动时刷屏
      if (config._retryCount === 1) {
        notificationService.info('请求失败，正在自动重试...', {
          duration: 1800,
          position: 'top-right',
          dedupeKey: 'api:auto-retry',
          dedupeWindow: 12000,
        })
      }

      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(api(config))
        }, retryDelay)
      })
    }

    return Promise.reject(error)
  },
)

const searchInFlight = new Map()
let searchQueue = Promise.resolve()
const detailInFlight = new Map()

function stableSearchKey(params = {}) {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .reduce((result, key) => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          result[key] = params[key]
        }
        return result
      }, {}),
  )
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data))
}

const WALLHAVEN_IMAGE_HOSTS = new Set(['th.wallhaven.cc', 'w.wallhaven.cc'])
const IMAGE_PROXY_CACHE_VERSION = '2'

export function proxyWallhavenImageUrl(url) {
  if (!url || typeof url !== 'string') return url
  if (url.startsWith('/api/image-proxy')) return url

  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsed = new URL(url, baseUrl)
    if (parsed.protocol === 'https:' && WALLHAVEN_IMAGE_HOSTS.has(parsed.hostname)) {
      const proxyUrl = new URL(buildApiUrl('/image-proxy'), baseUrl)
      proxyUrl.searchParams.set('url', parsed.href)
      proxyUrl.searchParams.set('v', IMAGE_PROXY_CACHE_VERSION)
      return proxyUrl.href
    }
  } catch (error) {
    return url
  }

  return url
}

function proxyWallhavenThumbs(thumbs = {}) {
  return Object.keys(thumbs).reduce((result, key) => {
    result[key] = proxyWallhavenImageUrl(thumbs[key])
    return result
  }, {})
}

function readLocalWallhavenApiKey() {
  try {
    if (!getAuthToken()) return ''
    const s = storageService.get('settings', {}) || {}
    const key = String(s.wallhaven_api_key || '').trim()
    if (!key || key === '********') return ''
    return key
  } catch {
    return ''
  }
}

function hasWallhavenApiKeyAccess(settings = null) {
  try {
    if (!getAuthToken()) return false
    const s = settings || storageService.get('settings', {}) || {}
    const key = String(s.wallhaven_api_key || '').trim()
    return Boolean((key && key !== '********') || s.wallhaven_api_key_configured === true)
  } catch {
    return false
  }
}

function mapWallhavenSearchParams(params = {}) {
  const resMulti = String(params.resolutions ?? '').trim()
  const resOne = String(params.resolution ?? '').trim()
  const mapped = {
    ...params,
    q: params.q ?? params.query ?? '',
    colors: params.colors ?? params.color ?? '',
  }

  delete mapped.query
  delete mapped.resolution
  delete mapped.resolutions
  delete mapped.color
  delete mapped.force
  delete mapped._force

  // 与 wallhaven.cc 一致：多值用 resolutions（精确列表），单选「最低分辨率」用 atleast
  if (resMulti) {
    mapped.resolutions = resMulti
  } else if (resOne) {
    mapped.atleast = resOne
  }

  // Wallhaven API v1 列表每页最多 24 条
  const perPage = Number(mapped.per_page ?? mapped.items_per_page)
  if (Number.isFinite(perPage) && perPage > 0) {
    mapped.per_page = Math.min(24, Math.max(1, Math.round(perPage)))
  } else {
    delete mapped.per_page
  }
  delete mapped.items_per_page

  return Object.keys(mapped).reduce((result, key) => {
    if (mapped[key] !== undefined && mapped[key] !== null && mapped[key] !== '') {
      result[key] = mapped[key]
    }
    return result
  }, {})
}

function normalizeWallhavenImage(item = {}) {
  const rawThumbs = item.thumbs || {}
  const thumbs = proxyWallhavenThumbs(rawThumbs)
  const rawThumbnail =
    rawThumbs.small || rawThumbs.large || rawThumbs.original || item.thumbnail || ''
  return {
    ...item,
    url: item.path || item.url || '',
    path: item.path || '',
    image_url: item.path || '',
    detail_url: item.url || '',
    thumbnail: proxyWallhavenImageUrl(rawThumbnail),
    thumbs,
    raw_thumbnail: rawThumbnail,
    raw_thumbs: rawThumbs,
    upload_time: item.created_at || item.upload_time || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    uploader: item.uploader?.username || item.uploader || '',
  }
}

function normalizeWallhavenSearchResponse(raw, status) {
  if (status === 429) {
    const cooldown = normalizeWallhavenCooldown(raw?.cooldown)
    return {
      success: false,
      images: [],
      meta: {},
      error: raw?.error || 'Wallhaven 上游限流，请稍后再试',
      raw: typeof raw === 'string' ? { body: raw } : raw,
      wallhaven_status: 429,
      cooldown,
    }
  }

  if (status === 401) {
    return {
      success: false,
      images: [],
      meta: {},
      error: '未授权：请检查设置中的 Wallhaven API Key，或关闭 NSFW 后重试',
      raw: typeof raw === 'string' ? { body: raw } : raw,
      wallhaven_status: 401,
    }
  }

  if (status >= 200 && status < 300 && raw && Array.isArray(raw.data)) {
    return {
      success: true,
      images: raw.data.map(normalizeWallhavenImage),
      meta: raw.meta || {},
      raw,
      wallhaven_status: status,
    }
  }

  const fallbackMsg =
    raw && typeof raw === 'object' && (raw.error || raw.message)
      ? String(raw.error || raw.message)
      : `Wallhaven 请求异常（HTTP ${status}）`

  return {
    success: false,
    images: [],
    meta: raw?.meta || {},
    error: fallbackMsg,
    raw,
    wallhaven_status: status,
  }
}

function normalizeWallhavenCooldown(value) {
  if (!value || typeof value !== 'object') return null
  const remainingSeconds = Number(value.remainingSeconds || 0)
  const until = String(value.until || '').trim()
  const parsedUntil = Date.parse(until)
  const computedRemaining = Number.isFinite(parsedUntil)
    ? Math.max(0, Math.ceil((parsedUntil - Date.now()) / 1000))
    : 0
  return {
    active: value.active !== false,
    remainingSeconds: Math.max(0, Math.ceil(remainingSeconds || computedRemaining)),
    until,
    reason: String(value.reason || ''),
  }
}

function normalizeWallhavenDetailResponse(raw, status) {
  if (status >= 200 && status < 300 && raw?.success && raw.image) {
    return {
      ...raw,
      image: normalizeWallhavenImage(raw.image),
      wallhaven_status: raw.wallhaven_status ?? status,
    }
  }

  if (status >= 200 && status < 300 && raw?.data) {
    return {
      success: true,
      image: normalizeWallhavenImage(raw.data),
      raw,
      wallhaven_status: status,
    }
  }

  return {
    success: false,
    image: null,
    error: raw?.error || raw?.message || `Wallhaven HTTP ${status}`,
    raw,
    wallhaven_status: status,
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function enqueueSearchRequest(task) {
  const queued = searchQueue.catch(() => {}).then(task)
  searchQueue = queued.then(
    () => delay(250),
    () => delay(250),
  )
  return queued
}

function requestSearch(params = {}, options = {}) {
  const force = params.force === true || params._force === true
  const signal = options.signal
  const mappedParams = mapWallhavenSearchParams(params)
  const key = stableSearchKey(mappedParams)
  const shouldUseSharedInFlight = !signal

  if (shouldUseSharedInFlight && searchInFlight.has(key)) {
    return searchInFlight.get(key).then(cloneData)
  }

  const requestPromise = enqueueSearchRequest(async () => {
    try {
      const apiKey = readLocalWallhavenApiKey()
      if (apiKey && !mappedParams.apikey) {
        mappedParams.apikey = apiKey
      }

      // 滑动窗口计数：与 UI 预算器一致（每次实际发起列表搜索）
      recordWallhavenSearchWindowHit()

      const response = await rawApi.get('/search', {
        params: mappedParams,
        signal,
      })
      const normalized = normalizeWallhavenSearchResponse(response.data, response.status)
      return normalized
    } catch (error) {
      if (
        axios.isCancel?.(error) ||
        error.code === 'ERR_CANCELED' ||
        error.name === 'CanceledError'
      ) {
        return {
          success: false,
          images: [],
          meta: {},
          error: '',
          aborted: true,
          raw: null,
          wallhaven_status: 0,
        }
      }

      const normalized = {
        success: false,
        images: [],
        meta: {},
        error: error.message || 'Wallhaven 请求失败',
        raw: {
          error: error.message || 'Wallhaven 请求失败',
          code: error.code || '',
        },
        wallhaven_status: 0,
      }

      return normalized
    }
  }).finally(() => {
    if (shouldUseSharedInFlight) searchInFlight.delete(key)
  })

  if (shouldUseSharedInFlight) searchInFlight.set(key, requestPromise)
  return requestPromise.then(cloneData)
}

function requestWallpaperDetails(id) {
  const key = String(id || '').trim()
  if (!key) {
    return Promise.resolve({ success: false, error: '缺少壁纸 ID' })
  }

  if (detailInFlight.has(key)) {
    return detailInFlight.get(key).then(cloneData)
  }

  const params = {}
  const apiKey = readLocalWallhavenApiKey()
  if (apiKey) {
    params.apikey = apiKey
  }

  const requestPromise = rawApi
    .get(`/image/${encodeURIComponent(key)}`, {
      params,
    })
    .then((response) => normalizeWallhavenDetailResponse(response.data, response.status))
    .finally(() => {
      detailInFlight.delete(key)
    })

  detailInFlight.set(key, requestPromise)
  return requestPromise.then(cloneData)
}

// 使用真实API
export const wallpaperApi = {
  // 搜索壁纸（可选 AbortSignal 取消在途请求）
  search(params, options = {}) {
    return requestSearch(params, options).then((response) => {
      if (response.images && response.images.length > 0) {
        const firstImage = response.images[0]
      }

      return response
    })
  },

  // 获取壁纸详情
  getWallpaper(id) {
    return requestWallpaperDetails(id)
  },

  // 获取壁纸详情（别名，与WallpaperCard组件兼容）
  getWallpaperDetails(id) {
    return requestWallpaperDetails(id)
  },

  // 获取壁纸图片
  getImage(id) {
    return requestWallpaperDetails(id)
  },

  // 获取热门壁纸
  getTopWallpapers(params) {
    return requestSearch({
      ...params,
      sorting: 'toplist',
      order: 'desc',
    })
  },

  // 获取最新壁纸
  getLatestWallpapers(params) {
    return requestSearch({
      ...params,
      sorting: 'date_added',
      order: 'desc',
    })
  },

  // 获取随机壁纸
  getRandomWallpaper() {
    return requestSearch({
      sorting: 'random',
      seed: randomWallhavenSeed(),
    })
  },
}

/** 与搜索页一致的浏览默认值（Wallhaven 官方：上传用 search 的 q=@username） */
function readWallhavenBrowseDefaults() {
  try {
    const s = storageService.get('settings', {}) || {}
    const showNsfw = !!s.show_nsfw
    const hasKey = hasWallhavenApiKeyAccess(s)
    return {
      categories: '111',
      // 无密钥时与默认搜索一致，避免 401
      purity: showNsfw && hasKey ? '111' : '100',
    }
  } catch {
    return { categories: '111', purity: '100' }
  }
}

/** Wallhaven 搜索语法：@username 表示该用户上传 */
function buildUserUploadsQuery(username) {
  const raw = String(username || '').trim()
  if (!raw) return ''
  return raw.startsWith('@') ? raw : `@${raw}`
}

/** GET /collections/:user — 仅元数据列表，不能走 normalizeWallhavenSearchResponse（data 非壁纸） */
function normalizeWallhavenCollectionsIndex(raw, status) {
  if (status === 401) {
    return {
      success: false,
      collections: [],
      error: '未授权：查看他人收藏夹需公开可见；查看私有内容请使用 API Key',
      wallhaven_status: 401,
    }
  }
  if (status >= 200 && status < 300 && raw && Array.isArray(raw.data)) {
    const collections = raw.data.map((c) => ({
      id: c.id,
      name: c.label || `Collection ${c.id}`,
      count: Number(c.count) || 0,
      public: c.public,
      views: c.views,
      preview_images: [],
    }))
    return { success: true, collections, wallhaven_status: status }
  }
  return {
    success: false,
    collections: [],
    error: raw?.error || raw?.message || `Wallhaven HTTP ${status}`,
    wallhaven_status: status,
  }
}

/**
 * 无本地 /user 接口时：用 Wallhaven 公开 API 拼出用户页所需数据
 * @see https://wallhaven.cc/help/api — q 参数 @username；GET /collections/USERNAME
 */
async function loadWallhavenUserProfileFallback(username) {
  const enc = encodeURIComponent(username)
  const browse = readWallhavenBrowseDefaults()

  const [uploadRes, colRes] = await Promise.all([
    wallpaperApi.search({
      q: buildUserUploadsQuery(username),
      page: 1,
      sorting: 'date_added',
      order: 'desc',
      categories: browse.categories,
      purity: browse.purity,
      items_per_page: 24,
    }),
    rawApi.get(`/collections/${enc}`),
  ])

  const colNorm = normalizeWallhavenCollectionsIndex(colRes.data, colRes.status)
  const collections = colNorm.collections || []
  const favoritesWallpaperCount = collections.reduce((sum, c) => sum + (c.count || 0), 0)

  return {
    success: true,
    username,
    avatar_url: `https://ui-avatars.com/api/?size=128&background=2d3748&color=fff&name=${enc}`,
    group: 'User',
    bio: '以下数据来自 Wallhaven 公开 API：「上传」对应搜索语法 @用户名；「收藏」为公开收藏夹内容。',
    uploads: uploadRes.success ? Number(uploadRes.meta?.total ?? uploadRes.images?.length ?? 0) : 0,
    favorites: favoritesWallpaperCount,
    views: 0,
    collections,
    user_collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      count: c.count,
      preview_images: c.preview_images || [],
    })),
    /** Worker 模式下部分用户操作仅保存在浏览器本地 */
    wallhaven_mode: true,
  }
}

async function fetchWallhavenUserUploadsPage(username, page = 1) {
  const browse = readWallhavenBrowseDefaults()
  return wallpaperApi.search({
    q: buildUserUploadsQuery(username),
    page,
    sorting: 'date_added',
    order: 'desc',
    categories: browse.categories,
    purity: browse.purity,
    items_per_page: 24,
  })
}

/** 某用户某公开收藏夹内壁纸列表（与 search 列表结构一致） */
async function fetchWallhavenCollectionWallpapers(username, collectionId, page = 1) {
  const enc = encodeURIComponent(username)
  const res = await rawApi.get(`/collections/${enc}/${encodeURIComponent(collectionId)}`, {
    params: { page },
  })
  return normalizeWallhavenSearchResponse(res.data, res.status)
}

/** 无 GET /user/.../favorites 时，用 collections API 拼列表 */
async function fetchWallhavenUserFavorites(username, page = 1, collectionId = null) {
  const enc = encodeURIComponent(username)
  const indexRes = await rawApi.get(`/collections/${enc}`)
  const colNorm = normalizeWallhavenCollectionsIndex(indexRes.data, indexRes.status)
  const list = colNorm.collections || []

  const cid =
    collectionId != null && collectionId !== ''
      ? collectionId
      : list[0]?.id != null
        ? list[0].id
        : null

  if (cid == null) {
    return {
      success: true,
      images: [],
      meta: { current_page: 1, last_page: 1, total: 0, per_page: 24 },
      collections: list,
    }
  }

  const wall = await fetchWallhavenCollectionWallpapers(username, cid, page)
  return {
    ...wall,
    collections: list,
  }
}

// 用户相关API
export const userApi = {
  // 获取用户信息（Worker 无 /user 时走 Wallhaven search + collections 回退）
  async getUserInfo(username, options = {}) {
    const name = String(username || '').trim()
    if (!name) return { success: false, error: '用户名为空' }
    if (options.preferWallhavenFallback === true || skipLegacyUserListApi()) {
      try {
        return await loadWallhavenUserProfileFallback(name)
      } catch (e) {
        return { success: false, error: e?.message || '加载用户资料失败' }
      }
    }
    try {
      const data = await api.get(`/user/${encodeURIComponent(name)}`)
      if (data && data.success) return data
    } catch (err) {
      const st = err.response?.status
      const online = readOnlineMode(err.response?.data)
      if (st !== 404 && st !== 501 && !online) throw err
    }
    try {
      return await loadWallhavenUserProfileFallback(name)
    } catch (e) {
      return { success: false, error: e?.message || '加载用户资料失败' }
    }
  },

  // 获取用户上传的壁纸（本地 uploads 或 Wallhaven search @user）
  async getUserUploads(username, page = 1, options = {}) {
    if (options.preferWallhavenFallback === true || skipLegacyUserListApi()) {
      return fetchWallhavenUserUploadsPage(username, page)
    }
    try {
      return await api.get(`/user/${encodeURIComponent(username)}/uploads`, { params: { page } })
    } catch (err) {
      const st = err.response?.status
      const online = readOnlineMode(err.response?.data)
      if (st !== 404 && st !== 501 && !online) throw err
      return fetchWallhavenUserUploadsPage(username, page)
    }
  },

  // 获取用户收藏相关列表（本地 favorites 或 Wallhaven collections）
  async getUserFavorites(username, page = 1, collectionId = null, options = {}) {
    if (options.preferWallhavenFallback === true || skipLegacyUserListApi()) {
      return fetchWallhavenUserFavorites(username, page, collectionId)
    }
    try {
      return await api.get(`/user/${encodeURIComponent(username)}/favorites`, {
        params: {
          page,
          collection_id: collectionId,
        },
      })
    } catch (err) {
      const st = err.response?.status
      const online = readOnlineMode(err.response?.data)
      if (st !== 404 && st !== 501 && !online) throw err
    }

    return fetchWallhavenUserFavorites(username, page, collectionId)
  },

}

export const publicConfigApi = {
  getConfig() {
    return api.get('/public/config')
  },
  getPopularSearches() {
    return api.get('/public/popular-searches')
  },
  getHomeBootstrap() {
    return api.get('/client/bootstrap/home')
  },
}

export const insightsApi = {
  getRecommendations(limit = 24) {
    return api.get('/insights/recommendations', {
      params: { limit },
      suppressGlobalError: true,
    })
  },

  getAutoTags() {
    return api.get('/insights/auto-tags', {
      suppressGlobalError: true,
    })
  },

  getPublicUser(slug) {
    return api.get(`/public/users/${encodeURIComponent(slug)}`)
  },
}

export const aiCapabilityApi = {
  getCapabilities() {
    if (skipAiCapabilityApi()) {
      return Promise.resolve({ success: false, skipped: true, capabilityKit: null })
    }
    return api.get('/ai/capabilities')
  },

  updateCapabilities(capabilityKit) {
    if (skipAiCapabilityApi()) {
      return Promise.resolve({ success: true, skipped: true, capabilityKit })
    }
    return api.post('/ai/capabilities/update', { capabilityKit })
  },

  testMcp(server) {
    if (skipAiCapabilityApi()) {
      return Promise.resolve({
        success: false,
        skipped: true,
        message: '当前部署未启用 MCP 测试接口',
      })
    }
    return api.post('/ai/mcp/test', server)
  },
}

export default {
  wallpaperApi,
  userApi,
  publicConfigApi,
  insightsApi,
  aiCapabilityApi,
}
