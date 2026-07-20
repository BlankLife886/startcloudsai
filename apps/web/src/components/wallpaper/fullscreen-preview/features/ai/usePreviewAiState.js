import { computed, ref, watch } from 'vue'
import { resolvePublicModelCreditCost } from '@/features/ai-shared/resolveWallpaperCreditCost'
import { filterRuntimeAiProviderModels, formatRuntimeImageModelPrice } from '@/config/aiModels'
import { getAiFeatureEnabledModelIds, getAiFeatureConfig } from '@/config/aiFeatureSettings'
import {
  normalizeAiImageProcessingConfig,
} from '@/components/wallpaper/fullscreen-preview/constants/ai'
import { normalizeAiOutputSize } from '@/components/wallpaper/fullscreen-preview/features/ai/aiAspectUtils'
import {
  AI_WALLPAPER_PREVIEW_HISTORY_KEY,
  AI_WALLPAPER_PREVIEW_RECIPES_KEY,
  syncAiWallpaperState,
} from '@/services/aiWallpaperState'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'

// AI 面板状态集中在这里：主弹窗只负责协调其它工具的开关，不再直接维护表单和历史细节。
export function usePreviewAiState({
  settingsStore,
  runtimeConfigStore = null,
  notificationService,
  undoProcessedResult,
  applyProcessedResult,
  setComparisonMode,
  onApplyHistory = null,
  getFilenamePrefix = () => 'wallpaper',
}) {
  const previewAiFeature = getAiFeatureConfig('preview')
  const getPreviewRuntimeConfig = () => runtimeConfigStore?.getFeaturePayload?.('ai.optimize') || {}
  const getRuntimeModelCatalog = () => runtimeConfigStore?.getAiModelCatalog?.() || null
  const getPreviewPublicModels = () =>
    normalizePublicModels(getPreviewRuntimeConfig().publicModels)
  const getPreviewProvider = () =>
    String(getPreviewRuntimeConfig().defaultProvider || '').trim()
  const getPreviewEnabledModelIds = () => {
    const provider = getPreviewProvider()
    const runtimeConfig = getPreviewRuntimeConfig()
    const allowedProviders = Array.isArray(runtimeConfig.allowedProviders)
      ? runtimeConfig.allowedProviders.map(String).filter(Boolean)
      : []
    if (allowedProviders.length && !allowedProviders.includes(provider)) return []
    const runtimeAllowedModels = Array.isArray(runtimeConfig.allowedModels)
      ? runtimeConfig.allowedModels.map(String).filter(Boolean)
      : []
    if (runtimeAllowedModels.length) return runtimeAllowedModels
    return getAiFeatureEnabledModelIds(settingsStore.settings, previewAiFeature, provider)
  }
  const getPreviewDefaultModel = () =>
    String(
      getPreviewRuntimeConfig().defaultPublicModel ||
        getPreviewRuntimeConfig().defaultModel ||
        '',
    ).trim()

  const aiLoading = ref(false)
  const aiError = ref('')
  const aiStatusText = ref('')
  const aiRetryable = ref(false)
  const aiSelectedModel = ref('')
  const aiHistory = ref([])
  const aiRecipeName = ref('')
  const aiRecipes = ref([])
  const aiCustomPrompt = ref('')
  const aiOutputSize = ref('')
  const aiSourceReferenceSize = ref({ width: 0, height: 0 })

  const aiImageProcessingConfig = computed(() =>
    normalizeAiImageProcessingConfig(getPreviewRuntimeConfig().imageProcessing),
  )

  const aiModelCostLabel = computed(() =>
    aiSelectedModel.value
      ? formatPreviewModelPrice(aiSelectedModel.value)
      : '未选择模型',
  )

  const aiModelOptions = computed(() => {
    const publicModels = getPreviewPublicModels()
    if (publicModels.length) return publicModels
    const enabledIds = getPreviewEnabledModelIds()
    if (!enabledIds.length) return []
    return filterRuntimeAiProviderModels(getPreviewProvider(), 'imageEdit', enabledIds, getRuntimeModelCatalog())
  })
  watch(
    aiModelOptions,
    (models) => {
      if (!models.length) {
        aiSelectedModel.value = ''
        return
      }
      if (!models.some((model) => model.id === aiSelectedModel.value)) {
        const runtimeDefaultModel = getPreviewDefaultModel()
        if (runtimeDefaultModel && models.some((model) => model.id === runtimeDefaultModel)) {
          aiSelectedModel.value = runtimeDefaultModel
          return
        }
        aiSelectedModel.value = models[0]?.id || ''
      }
    },
    { immediate: true },
  )

  watch(
    () => getPreviewDefaultModel(),
    (runtimeDefaultModel) => {
      const defaultModel = String(runtimeDefaultModel || '').trim()
      if (!defaultModel) return
      if (aiModelOptions.value.some((model) => model.id === defaultModel)) {
        aiSelectedModel.value = defaultModel
      }
    },
  )

  watch(
    aiImageProcessingConfig,
    (config) => {
      const presets = config.outputSizePresets || []
      const currentSize = normalizeAiOutputSize(aiOutputSize.value, presets)
      if (!currentSize && config.defaultOutputSize) {
        aiOutputSize.value = config.defaultOutputSize
      }
    },
    { immediate: true },
  )

  function selectConfiguredAiModel() {
    const models = aiModelOptions.value
    if (models.some((model) => model.id === aiSelectedModel.value)) {
      return
    }
    const runtimeDefaultModel = getPreviewDefaultModel()
    if (runtimeDefaultModel && models.some((model) => model.id === runtimeDefaultModel)) {
      aiSelectedModel.value = runtimeDefaultModel
      return
    }
    aiSelectedModel.value = models[0]?.id || ''
  }

  function normalizePublicModels(value) {
    if (!Array.isArray(value)) return []
    const featureConfig = getPreviewRuntimeConfig()
    return value
      .map((item) => {
        const id = String(item?.id || item?.publicModelKey || '').trim()
        if (!id) return null
        const userPriceUsd = Number(item?.userPriceUsd || 0)
        const creditCost = resolvePublicModelCreditCost(item, featureConfig)
        return {
          id,
          label: String(item?.label || id),
          description: String(item?.description || ''),
          providerKey: String(item?.providerKey || item?.metadata?.providerKey || '').trim(),
          providerLabel: String(item?.providerLabel || item?.metadata?.providerLabel || '').trim(),
          modelId: String(item?.modelId || item?.metadata?.modelId || item?.apiModelId || id).trim(),
          apiModelId: String(item?.apiModelId || item?.modelId || item?.metadata?.modelId || id).trim(),
          profileKey: String(item?.profileKey || item?.metadata?.profileKey || 'default').trim() || 'default',
          metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
          capabilities: Array.isArray(item?.capabilities)
            ? item.capabilities.map((capability) => String(capability || '').trim()).filter(Boolean)
            : [],
          adapterReady: true,
          publicModel: true,
          pricing: {
            unit: String(item?.billingMode || 'request'),
            usd: userPriceUsd,
            userPriceUsd,
            creditCost,
            display: formatPublicModelPrice({ userPriceUsd, creditCost }),
          },
        }
      })
      .filter(Boolean)
  }

  function formatPublicModelPrice(model) {
    const credits = Number(model?.creditCost || 0)
    const usd = Number(model?.userPriceUsd || 0)
    if (credits > 0 && usd > 0) return `${credits} 积分 / $${usd.toFixed(4)}`
    if (credits > 0) return `${credits} 积分`
    if (usd > 0) return `$${usd.toFixed(4)}`
    return '按实际消耗计费'
  }

  function formatPreviewModelPrice(modelId) {
    const publicModel = getPreviewPublicModels().find((model) => model.id === modelId)
    if (publicModel) return formatPublicModelPrice(publicModel.pricing)
    return formatRuntimeImageModelPrice(modelId, getPreviewProvider(), getRuntimeModelCatalog())
  }

  function resetAiSourceReferenceSize() {
    aiSourceReferenceSize.value = { width: 0, height: 0 }
  }

  function loadAiHistory() {
    try {
      const raw = getScopedLocalItem(AI_WALLPAPER_PREVIEW_HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      aiHistory.value = Array.isArray(parsed) ? parsed.slice(0, 6) : []
    } catch {
      aiHistory.value = []
    }
  }

  function saveAiHistory() {
    try {
      setScopedLocalItem(AI_WALLPAPER_PREVIEW_HISTORY_KEY, JSON.stringify(aiHistory.value.slice(0, 6)))
      void syncAiWallpaperState()
    } catch {
      // 历史记录只是体验增强，存储失败不影响主流程。
    }
  }

  function addAiHistory(url, model, outputSize = '') {
    if (!url || url.startsWith('data:image/')) return
    const item = {
      id: `${Date.now()}`,
      url,
      model,
      task: 'image-edit',
      taskLabel: aiImageProcessingConfig.value.panelTitle || 'AI',
      ratio: outputSize,
      costLabel: aiModelCostLabel.value,
      createdAt: new Date().toLocaleString(),
    }
    aiHistory.value = [item, ...aiHistory.value].slice(0, 6)
    saveAiHistory()
  }

  function undoLastAiOperation() {
    const last = undoProcessedResult()
    if (!last) {
      notificationService.info('没有可撤销的 AI 操作')
      return
    }
    notificationService.success('已撤销到上一步 AI 结果')
  }

  function loadAiRecipes() {
    try {
      const raw = getScopedLocalItem(AI_WALLPAPER_PREVIEW_RECIPES_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      aiRecipes.value = Array.isArray(parsed) ? parsed.slice(0, 20) : []
    } catch {
      aiRecipes.value = []
    }
  }

  function saveAiRecipes() {
    try {
      setScopedLocalItem(AI_WALLPAPER_PREVIEW_RECIPES_KEY, JSON.stringify(aiRecipes.value.slice(0, 20)))
      void syncAiWallpaperState()
    } catch {
      // 忽略本地存储异常
    }
  }

  function saveCurrentAiRecipe() {
    const name = aiRecipeName.value.trim()
    if (!name) {
      notificationService.warning('请输入方案名称')
      return
    }
    const item = {
      id: `${Date.now()}`,
      name,
      payload: {
        selectedModel: aiSelectedModel.value,
        outputSize: aiOutputSize.value,
        customPrompt: aiCustomPrompt.value,
      },
    }
    aiRecipes.value = [item, ...aiRecipes.value.filter((r) => r.name !== name)].slice(0, 20)
    aiRecipeName.value = ''
    saveAiRecipes()
    notificationService.success('已保存 AI 处理方案')
  }

  function applyAiRecipe(recipe) {
    const p = recipe?.payload
    if (!p) return
    const selectedModel = String(p.selectedModel || '').trim()
    if (selectedModel && aiModelOptions.value.some((model) => model.id === selectedModel)) {
      aiSelectedModel.value = selectedModel
    }
    aiOutputSize.value = String(p.outputSize || aiImageProcessingConfig.value.defaultOutputSize || '')
    aiCustomPrompt.value = String(p.customPrompt || '')
    notificationService.info(`已应用方案：${recipe.name}`)
  }

  function removeAiRecipe(id) {
    aiRecipes.value = aiRecipes.value.filter((item) => item.id !== id)
    saveAiRecipes()
  }

  function applyAiHistoryItem(item) {
    if (!item?.url) return
    if (typeof onApplyHistory === 'function') {
      onApplyHistory()
    }
    applyProcessedResult(item.url)
    setComparisonMode('side-by-side')
    notificationService.info('已恢复 AI 历史结果')
  }

  function downloadAiHistoryItem(item) {
    if (!item?.url) return
    const link = document.createElement('a')
    link.href = item.url
    link.download = `${getFilenamePrefix()}_ai_${item.task || 'result'}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return {
    aiLoading,
    aiError,
    aiStatusText,
    aiRetryable,
    aiSelectedModel,
    aiHistory,
    aiRecipeName,
    aiRecipes,
    aiCustomPrompt,
    aiOutputSize,
    aiSourceReferenceSize,
    aiModelOptions,
    aiImageProcessingConfig,
    addAiHistory,
    applyAiHistoryItem,
    applyAiRecipe,
    downloadAiHistoryItem,
    loadAiHistory,
    loadAiRecipes,
    removeAiRecipe,
    resetAiSourceReferenceSize,
    saveCurrentAiRecipe,
    selectConfiguredAiModel,
    undoLastAiOperation,
  }
}
