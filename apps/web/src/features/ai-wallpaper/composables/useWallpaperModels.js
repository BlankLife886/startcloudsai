import { filterRuntimeAiProviderModels } from '@/config/aiModels'
import {
  getAiFeatureConfig,
  getAiFeatureEnabledModelIds,
  resolveAiFeatureRuntimeConfig,
} from '@/config/aiFeatureSettings'
import { resolvePublicModelCreditCost } from '@/features/ai-shared/resolveWallpaperCreditCost'
import { aiCapabilityApi } from '@/services/api'
import {
  AI_WALLPAPER_CAPABILITY_KIT_KEY,
  syncAiWallpaperState,
} from '@/services/aiWallpaperState'
import notificationService from '@/services/notification'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { computed, ref, watch } from 'vue'
import {
  WALLPAPER_DEFAULT_MCP_OPTIONS,
  WALLPAPER_SKILL_OPTIONS,
} from './wallpaperStudioConstants.js'
import {
  normalizeCustomWallpaperSkills,
  normalizeCustomWallpaperSkill,
} from '../skills/wallpaperSkills.js'

export function useWallpaperModels(deps = {}) {
  const {
    settingsStore,
    runtimeConfigStore,
    outputType = ref('image'),
    privacyMode = ref(settingsStore?.getSetting?.('ai_enable_privacy_mode', true) ?? true),
    executionMode = ref('server'),
    syncState = syncAiWallpaperState,
    capabilityApi = aiCapabilityApi,
    notify = notificationService,
  } = deps

  const CAPABILITY_KIT_KEY = deps.capabilityKitKey || AI_WALLPAPER_CAPABILITY_KIT_KEY
  const wallpaperAiFeature = getAiFeatureConfig('wallpaper')
  const runtimeModelCatalog = computed(() => runtimeConfigStore.getAiModelCatalog())
  const initialWallpaperAiConfig = resolveAiFeatureRuntimeConfig(settingsStore, 'wallpaper', {
    runtimeModelCatalog: runtimeModelCatalog.value,
  })

  const studioProvider = deps.studioProvider || ref(initialWallpaperAiConfig.provider || 'gptsapi')
  const studioGatewayBaseUrl =
    deps.studioGatewayBaseUrl || ref(initialWallpaperAiConfig.baseUrl || 'https://api.gptsapi.net')
  const imageModel = deps.imageModel || ref(initialWallpaperAiConfig.model || 'gpt-image-2-plus')
  const videoModel = deps.videoModel || ref('seedance-1-0-pro-250528')
  const selectedPublicModel = deps.selectedPublicModel || ref('')
  const selectedSkillIds = deps.selectedSkillIds || ref(['preserve-4k-upscale'])
  const customSkills = deps.customSkills || ref([])
  const selectedMcpIds = deps.selectedMcpIds || ref([])
  const customMcpName = deps.customMcpName || ref('')
  const customMcpEndpoint = deps.customMcpEndpoint || ref('')
  const mcpTestState = deps.mcpTestState || ref({})
  const mcpOptions = deps.mcpOptions || ref([...WALLPAPER_DEFAULT_MCP_OPTIONS])

  let saveConfigTimer = null

  const wallpaperRuntimeConfig = computed(
    () => runtimeConfigStore.getFeaturePayload('ai.wallpaperGeneration') || {},
  )
  const allowedRuntimeProviderIds = computed(() =>
    normalizeStringList(wallpaperRuntimeConfig.value.allowedProviders),
  )
  const allowedRuntimeModelIds = computed(() =>
    normalizeStringList(wallpaperRuntimeConfig.value.allowedModels),
  )
  const publicModelOptions = computed(() =>
    normalizePublicModels(wallpaperRuntimeConfig.value.publicModels),
  )
  const superResolutionFeatureEnabled = computed(
    () => wallpaperRuntimeConfig.value.superResolutionEnabled !== false,
  )
  const imagePublicModelOptions = computed(() => {
    const all = publicModelOptions.value
    const textCapable = all.filter((model) =>
      model.capabilities.some((item) => {
        const key = String(item || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
        return (
          key.includes('texttoimage') ||
          key.includes('imagegenerate') ||
          key.includes('imagegeneration')
        )
      }),
    )
    // 文生图优先展示支持 textToImage 的模型；没有标注时回退全量，避免空列表
    return textCapable.length ? textCapable : all
  })
  const videoPublicModelOptions = computed(() =>
    publicModelOptions.value.filter((model) =>
      model.capabilities.some((item) => ['image.toVideo', 'text.toVideo'].includes(item)),
    ),
  )
  const activePublicModelOptions = computed(() =>
    outputType.value === 'video' ? videoPublicModelOptions.value : imagePublicModelOptions.value,
  )
  const canUseAiWallpaper = computed(() =>
    runtimeConfigStore.canUse('ai.wallpaperGeneration'),
  )
  const providerOptions = computed(() => {
    const providers = Array.isArray(runtimeModelCatalog.value?.providers)
      ? runtimeModelCatalog.value.providers
      : []
    const normalized = providers
      .map((provider) => ({
        id: String(provider?.id || '').trim(),
        label: String(provider?.label || provider?.id || '').trim(),
        baseURL: String(provider?.baseURL || provider?.baseUrl || ''),
        note: String(provider?.note || ''),
      }))
      .filter((provider) => provider.id)
    if (!allowedRuntimeProviderIds.value.length) return normalized
    return normalized.filter((provider) => allowedRuntimeProviderIds.value.includes(provider.id))
  })
  const selectedProviderConfig = computed(
    () =>
      providerOptions.value.find((provider) => provider.id === studioProvider.value) ||
      providerOptions.value[0],
  )
  const enabledWallpaperModelIds = computed(() =>
    resolveRuntimeAllowedModelIds(studioProvider.value),
  )
  const imageModelOptions = computed(() => {
    const ids = enabledWallpaperModelIds.value
    const imageToImageModels = filterRuntimeAiProviderModels(
      studioProvider.value,
      'imageToImage',
      ids,
      runtimeModelCatalog.value,
    )
    return imageToImageModels.length
      ? imageToImageModels
      : filterRuntimeAiProviderModels(
          studioProvider.value,
          'textToImage',
          ids,
          runtimeModelCatalog.value,
        )
  })
  const videoModelOptions = computed(() =>
    filterRuntimeAiProviderModels(
      studioProvider.value,
      'imageToVideo',
      enabledWallpaperModelIds.value,
      runtimeModelCatalog.value,
    ),
  )
  const imageDispatchModel = computed(() =>
    imagePublicModelOptions.value.some((model) => model.id === selectedPublicModel.value)
      ? selectedPublicModel.value
      : '',
  )
  const videoDispatchModel = computed(() =>
    videoPublicModelOptions.value.some((model) => model.id === selectedPublicModel.value)
      ? selectedPublicModel.value
      : '',
  )
  const currentModel = computed(() =>
    outputType.value === 'image' ? imageDispatchModel.value : videoDispatchModel.value,
  )
  const currentPublicModel = computed(
    () => activePublicModelOptions.value.find((model) => model.id === currentModel.value) || null,
  )
  const skillOptions = computed(() => [...WALLPAPER_SKILL_OPTIONS, ...customSkills.value])
  const selectedSkills = computed(() =>
    skillOptions.value.filter((skill) => selectedSkillIds.value.includes(skill.id)),
  )
  const selectedMcpServers = computed(() =>
    mcpOptions.value.filter((server) => selectedMcpIds.value.includes(server.id)),
  )

  function normalizeStringList(value) {
    return Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean)
      : []
  }

  function normalizePublicModels(value) {
    if (!Array.isArray(value)) return []
    const featureConfig = wallpaperRuntimeConfig.value || {}
    return value
      .map((item) => {
        const id = String(item?.id || item?.publicModelKey || '').trim()
        if (!id) return null
        return {
          id,
          label: String(item?.label || id),
          description: String(item?.description || ''),
          capabilities: normalizeStringList(item?.capabilities),
          billingMode: String(item?.billingMode || 'request'),
          userPriceUsd: Number(item?.userPriceUsd || 0),
          creditCost: resolvePublicModelCreditCost(item, featureConfig),
        }
      })
      .filter(Boolean)
  }

  function formatPublicModelCost(model) {
    if (!model) return '按实际消耗计费'
    const credits = Number(model.creditCost || 0)
    const usd = Number(model.userPriceUsd || 0)
    if (credits > 0 && usd > 0) return `${credits} 积分 / $${usd.toFixed(4)}`
    if (credits > 0) return `${credits} 积分`
    if (usd > 0) return `$${usd.toFixed(4)}`
    return '按实际消耗计费'
  }

  function resolveRuntimeAllowedModelIds(providerId) {
    if (
      allowedRuntimeProviderIds.value.length &&
      !allowedRuntimeProviderIds.value.includes(providerId)
    ) {
      return []
    }

    if (allowedRuntimeModelIds.value.length) {
      return allowedRuntimeModelIds.value
    }

    return getAiFeatureEnabledModelIds(settingsStore.settings, wallpaperAiFeature, providerId)
  }

  function ensureRuntimeProviderAndModels() {
    const providers = providerOptions.value
    if (!providers.length) return
    const preferredProvider = studioProvider.value
    if (!providers.some((provider) => provider.id === preferredProvider)) {
      studioProvider.value = providers[0].id
    } else {
      studioProvider.value = preferredProvider
    }

    const provider = selectedProviderConfig.value
    if (provider?.baseURL) studioGatewayBaseUrl.value = provider.baseURL

    if (!imageModelOptions.value.some((model) => model.id === imageModel.value)) {
      imageModel.value = imageModelOptions.value[0]?.id || ''
    }

    if (!videoModelOptions.value.some((model) => model.id === videoModel.value)) {
      videoModel.value = videoModelOptions.value[0]?.id || ''
    }
  }

  function applyProviderDefault() {
    const provider = selectedProviderConfig.value
    if (provider?.baseURL) studioGatewayBaseUrl.value = provider.baseURL
  }

  function saveStudioConfig() {
    if (saveConfigTimer && typeof window !== 'undefined') window.clearTimeout(saveConfigTimer)
    executionMode.value = 'server'
    settingsStore.setSetting('ai_wallpaper_execution_mode', 'server')
    settingsStore.setSetting('ai_enable_privacy_mode', privacyMode.value)
    persistCapabilityKit()
    if (typeof window === 'undefined') return
    saveConfigTimer = window.setTimeout(() => {
      notify.success('AI 配置已保存')
      saveConfigTimer = null
    }, 180)
  }

  function persistCapabilityKit() {
    const kit = {
      skills: skillOptions.value,
      mcpServers: mcpOptions.value,
      selectedSkillIds: selectedSkillIds.value,
      selectedMcpIds: selectedMcpIds.value,
      customSkills: customSkills.value,
      customMcpOptions: mcpOptions.value.filter((server) => server.custom),
    }
    setScopedLocalItem(CAPABILITY_KIT_KEY, JSON.stringify(kit))
    void syncState()
    return kit
  }

  function loadCapabilityKit() {
    try {
      const kit = JSON.parse(getScopedLocalItem(CAPABILITY_KIT_KEY) || '{}')
      const customMcpOptions = Array.isArray(kit.customMcpOptions) ? kit.customMcpOptions : []
      customSkills.value = normalizeCustomWallpaperSkills(kit.customSkills)
      mcpOptions.value = [...WALLPAPER_DEFAULT_MCP_OPTIONS, ...customMcpOptions]
      if (Array.isArray(kit.selectedSkillIds)) selectedSkillIds.value = kit.selectedSkillIds
      if (Array.isArray(kit.selectedMcpIds)) selectedMcpIds.value = kit.selectedMcpIds
    } catch {
      mcpOptions.value = [...WALLPAPER_DEFAULT_MCP_OPTIONS]
    }
  }

  function applyCapabilityKit(kit) {
    if (!kit || typeof kit !== 'object') return
    const customMcpOptions = Array.isArray(kit.customMcpOptions)
      ? kit.customMcpOptions
      : Array.isArray(kit.mcpServers)
        ? kit.mcpServers.filter((server) => server.custom)
        : []
    customSkills.value = normalizeCustomWallpaperSkills(kit.customSkills)
    mcpOptions.value = [...WALLPAPER_DEFAULT_MCP_OPTIONS, ...customMcpOptions]
    if (Array.isArray(kit.selectedSkillIds)) selectedSkillIds.value = kit.selectedSkillIds
    if (Array.isArray(kit.selectedMcpIds)) selectedMcpIds.value = kit.selectedMcpIds
  }

  async function syncCapabilityKitFromServer() {
    try {
      const response = await capabilityApi.getCapabilities()
      if (response.success && response.capabilityKit && response.storage !== 'browser-local') {
        applyCapabilityKit(response.capabilityKit)
        persistCapabilityKit()
      }
    } catch {
      /* 远端能力接口不可用时沿用本地能力配置 */
    }
  }

  async function saveCapabilityKitToServer() {
    const kit = persistCapabilityKit()
    try {
      await capabilityApi.updateCapabilities(kit)
    } catch {
      /* 远端能力接口不可用时仍保留本地配置 */
    }
  }

  function toggleSkill(skillId) {
    selectedSkillIds.value = selectedSkillIds.value.includes(skillId)
      ? selectedSkillIds.value.filter((id) => id !== skillId)
      : [...selectedSkillIds.value, skillId]
    saveCapabilityKitToServer()
  }

  function addCustomSkill({ name = '', prompt = '', description = '' } = {}) {
    const normalizedName = String(name || '').trim()
    const normalizedPrompt = String(prompt || '').trim()
    if (!normalizedName || !normalizedPrompt) {
      notify.warning('请填写 Skill 名称和指令')
      return null
    }
    const idBase = normalizedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-skill'
    let id = `custom-${idBase}`
    let suffix = 2
    const existingIds = new Set([...WALLPAPER_SKILL_OPTIONS, ...customSkills.value].map((item) => item.id))
    while (existingIds.has(id)) id = `custom-${idBase}-${suffix++}`
    const skill = normalizeCustomWallpaperSkill({
      id,
      name: normalizedName,
      prompt: normalizedPrompt,
      description,
    })
    if (!skill) return null
    customSkills.value = [...customSkills.value, skill].slice(-20)
    selectedSkillIds.value = [...new Set([...selectedSkillIds.value, skill.id])]
    saveCapabilityKitToServer()
    return skill
  }

  function removeCustomSkill(skillId) {
    const id = String(skillId || '').trim()
    if (!customSkills.value.some((skill) => skill.id === id)) return
    customSkills.value = customSkills.value.filter((skill) => skill.id !== id)
    selectedSkillIds.value = selectedSkillIds.value.filter((selectedId) => selectedId !== id)
    saveCapabilityKitToServer()
  }

  function toggleMcpServer(serverId) {
    selectedMcpIds.value = selectedMcpIds.value.includes(serverId)
      ? selectedMcpIds.value.filter((id) => id !== serverId)
      : [...selectedMcpIds.value, serverId]
    saveCapabilityKitToServer()
  }

  function addCustomMcpServer() {
    const name = customMcpName.value.trim()
    const endpoint = customMcpEndpoint.value.trim()
    if (!name || !endpoint) {
      notify.warning('请填写 MCP 名称和地址')
      return
    }
    const id = `custom-${Date.now()}`
    mcpOptions.value = [
      ...mcpOptions.value,
      {
        id,
        name,
        endpoint,
        icon: 'bi-plug',
        description: '自定义 MCP 服务',
        custom: true,
      },
    ]
    selectedMcpIds.value = [...selectedMcpIds.value, id]
    customMcpName.value = ''
    customMcpEndpoint.value = ''
    saveCapabilityKitToServer()
  }

  function removeCustomMcpServer(serverId) {
    mcpOptions.value = mcpOptions.value.filter((server) => server.id !== serverId)
    selectedMcpIds.value = selectedMcpIds.value.filter((id) => id !== serverId)
    saveCapabilityKitToServer()
  }

  async function testMcpServer(server) {
    if (!server) return
    if (selectedProviderConfig.value?.id === 'gptproto') {
      mcpTestState.value = {
        ...mcpTestState.value,
        [server.id]: { status: 'idle', message: '当前线上部署未启用 MCP 测试' },
      }
      return
    }
    mcpTestState.value = {
      ...mcpTestState.value,
      [server.id]: { status: 'testing', message: '测试中' },
    }
    try {
      const response = await capabilityApi.testMcp(server)
      mcpTestState.value = {
        ...mcpTestState.value,
        [server.id]: {
          status: response.success ? 'ok' : 'failed',
          message: response.message || response.error || '测试完成',
        },
      }
      if (response.success) notify.success(response.message || 'MCP 可用')
    } catch (error) {
      mcpTestState.value = {
        ...mcpTestState.value,
        [server.id]: { status: 'failed', message: error?.message || '测试失败' },
      }
    }
  }

  function resolveJobDisplayModel(job) {
    const gatewayModelId = String(job?.gatewayModelId || '').trim()
    const model = publicModelOptions.value.find((item) => item.id === gatewayModelId)
    if (model) return model.label
    if (gatewayModelId && !gatewayModelId.includes(':')) return gatewayModelId
    return String(job?.model || '').trim() || '未知模型'
  }

  function clearModelTimers() {
    if (saveConfigTimer && typeof window !== 'undefined') window.clearTimeout(saveConfigTimer)
    saveConfigTimer = null
  }

  watch(
    imageModelOptions,
    (models) => {
      if (models.length && !models.some((model) => model.id === imageModel.value)) {
        imageModel.value = models[0].id
      }
    },
    { immediate: true },
  )

  watch(
    videoModelOptions,
    (models) => {
      if (models.length && !models.some((model) => model.id === videoModel.value)) {
        videoModel.value = models[0].id
      }
    },
    { immediate: true },
  )

  watch(
    [activePublicModelOptions, outputType],
    ([models]) => {
      if (!models.some((model) => model.id === selectedPublicModel.value)) {
        // 自动选中第一个可用模型（新后端只有「标准模型」占位）
        selectedPublicModel.value = models[0]?.id || ''
      }
    },
    { immediate: true },
  )

  watch(
    [allowedRuntimeProviderIds, allowedRuntimeModelIds],
    () => ensureRuntimeProviderAndModels(),
    { immediate: true },
  )

  return {
    runtimeModelCatalog,
    aiOptimizeRuntimeConfig: wallpaperRuntimeConfig,
    allowedRuntimeProviderIds,
    allowedRuntimeModelIds,
    publicModelOptions,
    imagePublicModelOptions,
    videoPublicModelOptions,
    activePublicModelOptions,
    selectedPublicModel,
    canUseAiWallpaper,
    superResolutionFeatureEnabled,
    providerOptions,
    selectedProviderConfig,
    studioProvider,
    studioGatewayBaseUrl,
    imageModel,
    videoModel,
    imageModelOptions,
    videoModelOptions,
    imageDispatchModel,
    videoDispatchModel,
    currentModel,
    currentPublicModel,
    skillOptions,
    customSkills,
    mcpOptions,
    selectedSkills,
    selectedMcpServers,
    selectedSkillIds,
    selectedMcpIds,
    customMcpName,
    customMcpEndpoint,
    mcpTestState,
    normalizeStringList,
    normalizePublicModels,
    formatPublicModelCost,
    resolveRuntimeAllowedModelIds,
    ensureRuntimeProviderAndModels,
    applyProviderDefault,
    saveStudioConfig,
    persistCapabilityKit,
    loadCapabilityKit,
    applyCapabilityKit,
    syncCapabilityKitFromServer,
    saveCapabilityKitToServer,
    toggleSkill,
    addCustomSkill,
    removeCustomSkill,
    toggleMcpServer,
    addCustomMcpServer,
    removeCustomMcpServer,
    testMcpServer,
    resolveJobDisplayModel,
    clearModelTimers,
  }
}
