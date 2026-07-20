import { API_BASE_URL } from './apiBase'
import { cloneClientRuntimeRouteDefaults } from '@walleven/shared'
import { getApiData, getApiErrorMessage, isApiSuccess } from './apiResponse'
import { getClientId } from './clientIdentity'
import { clientLogHeaders } from './clientLogHeaders'

const DEFAULT_PRICING_CONSOLE_CONFIG = {
  enabled: false,
  brandName: '',
  sidebarTitle: '',
  sidebarSubtitle: '',
  balanceLabel: '',
  rechargeLabel: '',
  defaultSection: '',
  navItems: [],
  sections: {},
  apiKeys: {
    defaultLabel: '',
    defaultPrefix: '',
    defaultScopes: [],
    scopeOptions: [],
    defaultDailyLimitUnits: 0,
    defaultMonthlyLimitUnits: 0,
    defaultDailyLimitUsd: 0,
    defaultMonthlyLimitUsd: 0,
  },
  guides: [],
  wallet: { rechargeAmounts: [], defaultAmount: 0, rechargeUrl: '' },
  referrals: {
    enabled: false,
    rewardPercent: 0,
    rewardCredits: 0,
    creditsPerUsd: 0,
    minOrderCents: 0,
    invitePath: '',
    description: '',
  },
  support: {
    title: '',
    description: '',
    email: '',
    docsUrl: '',
    statusUrl: '',
    telegramUrl: '',
  },
}

function defaultImageGenerationFeatureConfig() {
  return {
    allowedProviders: [],
    allowedModels: [],
    superResolutionEnabled: true,
    dailyAiJobs: 20,
    maxUploadMb: 10,
    providerPayloadMaxMb: 4,
    creditCost: 0,
    requiredPlan: '',
    modelPolicies: [],
  }
}

const DEFAULT_RUNTIME_CONFIG = {
  version: '',
  endpoints: {
    apiBaseUrl: '/api',
    openAiBaseUrl: '/v1',
  },
  routes: cloneClientRuntimeRouteDefaults(),
  features: {
    download: {
      enabled: true,
      config: {
        allowOriginal: true,
        allowProcessed: true,
        allowBatch: true,
      },
    },
    favorite: { enabled: true, config: { allowCollections: true } },
    history: { enabled: true, config: { allowCloudSync: true } },
    sync: { enabled: true, config: { states: ['settings', 'favorites', 'history'] } },
    userActionLog: { enabled: true, config: { source: 'admin.logListening.userAction' } },
    'ai.optimize': {
      enabled: true,
      config: {
        allowedProviders: [],
        allowedModels: [],
        defaultProvider: '',
        defaultModel: '',
        dailyAiJobs: 20,
        maxUploadMb: 10,
        providerPayloadMaxMb: 4,
        imageProcessing: {},
      },
    },
    'ai.wallpaperGeneration': {
      enabled: true,
      config: defaultImageGenerationFeatureConfig(),
    },
    'ai.imageToModel': {
      enabled: true,
      config: {
        allowedProviders: [],
        allowedModels: [],
        defaultProvider: 'gptproto',
        defaultModel: 'tripo3d-v2.5',
        maxUploadMb: 10,
        parameterRanges: {
          faceLimit: { min: 1000, max: 300000, step: 1000 },
          seed: { min: 0, max: 2147483647, step: 1 },
          textureSeed: { min: 0, max: 2147483647, step: 1 },
        },
      },
    },
    'ai.illustrationColoring': {
      enabled: true,
      config: {
        allowedProviders: [],
        allowedModels: [],
        defaultProvider: '',
        defaultModel: '',
        maxUploadMb: 10,
        providerPayloadMaxMb: 4,
        dailyAiJobs: 20,
      },
    },
    'ai.uiDesign': {
      enabled: true,
      config: defaultImageGenerationFeatureConfig(),
    },
    'ai.ultraModelSheet': {
      enabled: true,
      config: defaultImageGenerationFeatureConfig(),
    },
    'ai.gameDesign': {
      enabled: true,
      config: defaultImageGenerationFeatureConfig(),
    },
    'ai.puzzle': {
      enabled: true,
      config: defaultImageGenerationFeatureConfig(),
    },
    'ai.personalKey': { enabled: false, config: {} },
    filters: {
      enabled: true,
      config: {
        allowPresets: true,
        allowCustomPresets: true,
        allowArtStyles: true,
      },
    },
  },
  pageLayout: {
    home: {
      hero: { enabled: true },
      video: { enabled: true },
      mobile: { enabled: true },
      desktop: { enabled: true },
      latest: { enabled: true },
      random: { enabled: true },
      quickSearches: [],
    },
    search: {
      header: { enabled: true },
      toolbar: {
        enabled: true,
        categories: { enabled: true },
        purity: { enabled: true },
        resolution: { enabled: true },
        ratio: { enabled: true },
        color: { enabled: true },
        sorting: { enabled: true },
        topRange: { enabled: true },
        order: { enabled: true },
        grid: { enabled: true },
        quality: { enabled: true },
        download: { enabled: true },
        search: { enabled: true },
        reset: { enabled: true },
      },
      status: { enabled: true },
      pendingPool: { enabled: true },
      aggregates: { enabled: true },
      grid: { enabled: true },
      preview: {
        enabled: true,
        favorite: { enabled: true },
        mockup: { enabled: true },
        rotate: { enabled: true },
        fit: { enabled: true },
        info: { enabled: true },
        compare: { enabled: true },
        crop: { enabled: true },
        decompose: { enabled: true },
        filters: { enabled: true },
        ai: { enabled: true },
        download: { enabled: true },
        fullscreen: { enabled: true },
      },
      compareDrawer: { enabled: true },
      contextMenu: { enabled: true },
      quickDetail: { enabled: true },
      bottomDock: {
        enabled: true,
        summary: { enabled: true },
        colors: { enabled: true },
        selection: { enabled: true },
        exportLinks: { enabled: true },
        pending: { enabled: true },
        hideSelected: { enabled: true },
        compare: { enabled: true },
        collection: { enabled: true },
        favorite: { enabled: true },
        download: { enabled: true },
        hidden: { enabled: true },
        jump: { enabled: true },
        pager: { enabled: true },
        more: { enabled: true },
      },
    },
    settings: {
      general: { enabled: true },
      browsing: { enabled: true },
      visuals: { enabled: true },
      home: { enabled: true },
      download: { enabled: true },
      ai: { enabled: true },
      data: { enabled: true },
      performance: { enabled: true },
    },
    aiWallpaper: {
      optimize: { enabled: true },
      imageToModel: { enabled: true },
    },
    profile: {
      sync: { enabled: true },
      favorites: { enabled: true },
      history: { enabled: true },
      downloads: { enabled: true },
      aiRecords: { enabled: true },
    },
    pricing: DEFAULT_PRICING_CONSOLE_CONFIG,
    user: {
      download: { enabled: true },
    },
  },
  limits: {
    dailyAiJobs: 20,
    maxUploadMb: 10,
    providerPayloadMaxMb: 4,
  },
  aiModelCatalog: {
    providers: [],
    models: [],
    publicModels: [],
    featurePublicModels: [],
    updatedAt: '',
  },
  mqtt: {
    enabled: false,
    brokerUrl: '',
    topicPrefix: 'walleven',
    subscribeTopics: [],
    events: [],
    qos: 0,
    keepalive: 60,
    reconnectPeriod: 5000,
    clientIdPrefix: 'walleven-web',
    username: '',
    password: '',
  },
  userOverrides: {},
  blacklist: {
    blocked: false,
    reason: '',
    scope: {},
    endsAt: '',
  },
}

export function getDefaultRuntimeConfig() {
  return structuredCloneSafe(DEFAULT_RUNTIME_CONFIG)
}

export async function fetchRuntimeConfig() {
  const clientId = getClientId()
  const url = new URL(`${API_BASE_URL}/client/bootstrap/config`, window.location.origin)
  url.searchParams.set('client_id', clientId)

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: clientLogHeaders({
      'Content-Type': 'application/json',
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(data, response.status)) {
    throw new Error(getApiErrorMessage(data, `运行时配置读取失败(${response.status})`))
  }
  const payload = getApiData(data)
  return normalizeRuntimeConfig(payload.config || payload.runtimeConfig || payload)
}

export function normalizeRuntimeConfig(config = {}) {
  const base = getDefaultRuntimeConfig()
  const routes = mergeToggleMap(base.routes, config.routes)
  const features = mergeToggleMap(base.features, config.features)
  const pageLayout = mergePageLayout(base.pageLayout, config.pageLayout)
  const blacklist = {
    ...base.blacklist,
    ...(config.blacklist && typeof config.blacklist === 'object' ? config.blacklist : {}),
  }

  return {
    ...base,
    ...config,
    endpoints: normalizeEndpoints(config.endpoints, base.endpoints),
    routes,
    features,
    pageLayout,
    limits:
      config.limits && typeof config.limits === 'object'
        ? { ...base.limits, ...config.limits }
        : base.limits,
    aiModelCatalog:
      config.aiModelCatalog && typeof config.aiModelCatalog === 'object'
        ? {
            providers: Array.isArray(config.aiModelCatalog.providers)
              ? config.aiModelCatalog.providers
              : [],
            models: Array.isArray(config.aiModelCatalog.models) ? config.aiModelCatalog.models : [],
            publicModels: Array.isArray(config.aiModelCatalog.publicModels)
              ? config.aiModelCatalog.publicModels
              : [],
            featurePublicModels: Array.isArray(config.aiModelCatalog.featurePublicModels)
              ? config.aiModelCatalog.featurePublicModels
              : [],
            updatedAt: String(config.aiModelCatalog.updatedAt || ''),
          }
        : base.aiModelCatalog,
    mqtt: normalizeMqttConfig(config.mqtt, base.mqtt),
    userOverrides:
      config.userOverrides && typeof config.userOverrides === 'object' ? config.userOverrides : {},
    blacklist,
  }
}

function normalizeMqttConfig(incoming = {}, fallback = {}) {
  const value = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
  const brokerUrl = String(value.brokerUrl || '').trim()
  return {
    ...fallback,
    enabled: value.enabled === true && /^wss?:\/\//i.test(brokerUrl),
    brokerUrl: /^wss?:\/\//i.test(brokerUrl) ? brokerUrl : '',
    topicPrefix: String(value.topicPrefix || fallback.topicPrefix || 'walleven'),
    subscribeTopics: Array.isArray(value.subscribeTopics)
      ? value.subscribeTopics.map((topic) => String(topic || '').trim()).filter(Boolean)
      : [],
    events: Array.isArray(value.events)
      ? value.events.map((event) => String(event || '').trim()).filter(Boolean)
      : [],
    qos: Number(value.qos) === 1 ? 1 : 0,
    keepalive: Math.min(300, Math.max(15, Number(value.keepalive || 60))),
    reconnectPeriod: Math.min(30000, Math.max(1000, Number(value.reconnectPeriod || 5000))),
    clientIdPrefix: String(value.clientIdPrefix || fallback.clientIdPrefix || 'walleven-web'),
    username: String(value.username || ''),
    password: String(value.password || ''),
  }
}

function normalizeEndpoints(incoming = {}, fallback = {}) {
  const safeIncoming =
    incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
  return {
    apiBaseUrl: normalizeEndpointUrl(safeIncoming.apiBaseUrl, fallback.apiBaseUrl || '/api'),
    openAiBaseUrl: normalizeEndpointUrl(
      safeIncoming.openAiBaseUrl,
      fallback.openAiBaseUrl || '/v1',
    ),
  }
}

function normalizeEndpointUrl(value, fallback) {
  const raw = String(value || '').trim()
  const selected = raw || fallback
  if (!selected) return fallback
  try {
    if (selected.startsWith('/')) return selected.replace(/\/+$/, '') || '/'
    return new URL(selected).toString().replace(/\/+$/, '')
  } catch {
    return fallback
  }
}

function mergePageLayout(base = {}, incoming = {}) {
  const result = { ...base }
  if (!incoming || typeof incoming !== 'object') return result
  Object.entries(incoming).forEach(([key, value]) => {
    result[key] = applyPageEnabledCascade(mergePlainObject(result[key], value))
  })
  return result
}

function applyPageEnabledCascade(pageConfig = {}) {
  if (!pageConfig || typeof pageConfig !== 'object' || Array.isArray(pageConfig)) return pageConfig
  if (pageConfig.enabled !== false) return pageConfig

  return Object.entries(pageConfig).reduce((next, [key, value]) => {
    if (key === 'enabled') {
      next[key] = false
      return next
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...value, enabled: false }
      return next
    }
    next[key] = value
    return next
  }, {})
}

function mergeToggleMap(base = {}, incoming = {}) {
  const result = { ...base }
  if (!incoming || typeof incoming !== 'object') return result
  Object.entries(incoming).forEach(([key, value]) => {
    if (value && typeof value === 'object') {
      const current = result[key] || {}
      result[key] = {
        ...current,
        ...value,
        config: mergePlainObject(current.config, value.config),
        enabled: value.enabled !== false,
      }
    } else {
      result[key] = { enabled: value !== false }
    }
  })
  return result
}

function mergePlainObject(base = {}, incoming = {}) {
  const safeBase = base && typeof base === 'object' && !Array.isArray(base) ? base : {}
  const safeIncoming =
    incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
  return { ...safeBase, ...safeIncoming }
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}
