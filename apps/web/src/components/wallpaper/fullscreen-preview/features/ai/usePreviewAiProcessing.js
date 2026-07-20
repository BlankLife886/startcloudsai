import { getRuntimeImageModelPricing } from '@/config/aiModels'
import { resolveAiFeatureRuntimeConfig } from '@/config/aiFeatureSettings'
import { webDebugInfo } from '@/services/debugLog'
import { submitServerImageEditJob } from '@/components/wallpaper/fullscreen-preview/api/aiPreviewApi'
import {
  normalizeAiOutputSize,
  toPositiveInt,
} from '@/components/wallpaper/fullscreen-preview/features/ai/aiAspectUtils'
import { createPreviewAiBudgetGuard } from '@/components/wallpaper/fullscreen-preview/features/ai/aiBudgetGuard'
import { useInsufficientCreditsPrompt } from '@/composables/useInsufficientCreditsPrompt'
import {
  materializeAiOutput,
  prepareAiInputSourceUrl,
} from '@/components/wallpaper/fullscreen-preview/features/ai/aiImageIO'
import { logPreviewAiInputDebug } from '@/components/wallpaper/fullscreen-preview/features/ai/aiInputDebug'
import { alignAiOutputResolution } from '@/components/wallpaper/fullscreen-preview/features/ai/aiOutputValidator'
import { createPreviewAiPromptComposer } from '@/components/wallpaper/fullscreen-preview/features/ai/aiPromptComposer'
import { isAiRetryableError } from '@/components/wallpaper/fullscreen-preview/features/ai/aiPreviewUtils'
import { pickPreviewSourceImageUrl } from '@/components/wallpaper/fullscreen-preview/features/ai/aiSourcePicker'
import { createPreviewAiTargetAspect } from '@/components/wallpaper/fullscreen-preview/features/ai/aiTargetAspect'

// AI 生成链路集中在这里：包含输入图选择、预算确认、服务商提交、输出转码与尺寸校验。
export function usePreviewAiProcessing({
  props,
  imageElement,
  imageInfo,
  imageUrl,
  sourceFullUrl,
  previewDisplayUrl,
  processedPreviewUrl,
  settingsStore,
  runtimeConfigStore = null,
  authStore,
  notificationService,
  loadImageFromSrc,
  applyProcessedResult,
  setComparisonMode,
  downloadDirectly,
  confirmAiCost,
  aiState,
}) {
  const {
    aiLoading,
    aiError,
    aiStatusText,
    aiRetryable,
    aiSelectedModel,
    aiOutputSize,
    aiSourceReferenceSize,
    aiImageProcessingConfig,
    addAiHistory,
  } = aiState

  const creditsPrompt = useInsufficientCreditsPrompt()

  const {
    getAiOutputTargetSize,
    getReferenceImageSize,
    getTargetAspectLabel,
    getTargetAspectParts,
    getTargetAspectRatio,
    getTargetAspectValue,
    getTargetOutputSizeValue,
  } = createPreviewAiTargetAspect({
    props,
    imageElement,
    imageInfo,
    aiOutputSize,
    aiSourceReferenceSize,
    aiImageProcessingConfig,
  })

  const { appendQualityModePrompt, composeEnhancePrompt } = createPreviewAiPromptComposer({
    aiState,
    settingsStore,
    imageProcessingConfig: aiImageProcessingConfig,
    getTargetAspectLabel,
    getOutputSize: getTargetOutputSizeValue,
  })

  function pickSourceImageUrl() {
    return pickPreviewSourceImageUrl({
      wallpaper: props.wallpaper,
      previewDisplayUrl: previewDisplayUrl.value,
      imageUrl: sourceFullUrl?.value || imageUrl.value,
    })
  }

  async function generateAiPreview() {
    if (aiLoading.value) return
    aiLoading.value = true
    aiError.value = ''
    aiRetryable.value = false
    aiStatusText.value = '准备开始 AI 处理...'
    try {
      await runtimeConfigStore?.loadRuntimeConfig?.({ force: true })
      const runtimeAiConfig = runtimeConfigStore?.getFeaturePayload?.('ai.optimize') || {}
      const budgetGuard = createPreviewAiBudgetGuard({
        settingsStore,
        confirmAiCost,
        getRuntimeModelCatalog: () => runtimeConfigStore?.getAiModelCatalog?.() || null,
        getRuntimePublicModels: () => runtimeAiConfig.publicModels || [],
        getRuntimeProvider: () => String(runtimeAiConfig.defaultProvider || '').trim(),
        getFeatureConfig: () => runtimeAiConfig,
      })
      const { confirmAiCostIfNeeded, ensureBudgetAvailable, getCostSnapshot, recordAiUsage } = budgetGuard
      await authStore.initAuth().catch(() => null)
      const runtimeProvider = String(runtimeAiConfig.defaultProvider || '').trim()
      const runtimeModel = String(runtimeAiConfig.defaultModel || '').trim()
      const selectedRuntimeModelId = String(aiSelectedModel.value || '').trim()
      const publicModel = findRuntimePublicModel(runtimeAiConfig.publicModels, selectedRuntimeModelId)
      const selectedModelId = publicModel?.modelId || publicModel?.apiModelId || selectedRuntimeModelId
      const previewConfig = resolveAiFeatureRuntimeConfig(settingsStore, 'preview', {
        provider: runtimeProvider,
        model: runtimeModel,
        runtimeConfig: { publicModels: runtimeAiConfig.publicModels, defaultPublicModel: runtimeAiConfig.defaultPublicModel },
        runtimeModelCatalog: runtimeConfigStore?.getAiModelCatalog?.() || null,
      })
      const provider = publicModel
        ? ''
        : String(previewConfig.provider || '').trim()
      const model = publicModel ? selectedRuntimeModelId : selectedRuntimeModelId
      const allowedProviders = Array.isArray(runtimeAiConfig.allowedProviders)
        ? runtimeAiConfig.allowedProviders.map(String).filter(Boolean)
        : []
      const allowedModels = Array.isArray(runtimeAiConfig.allowedModels)
        ? runtimeAiConfig.allowedModels.map(String).filter(Boolean)
        : []
      const allowedPublicModels = Array.isArray(runtimeAiConfig.allowedPublicModels)
        ? runtimeAiConfig.allowedPublicModels.map(String).filter(Boolean)
        : []
      if (!publicModel && allowedProviders.length && !allowedProviders.includes(provider)) {
        throw new Error('当前 AI 处理暂不可用，请稍后再试')
      }
      if (
        !publicModel &&
        allowedModels.length &&
        !allowedModels.includes(model) &&
        !allowedModels.includes(`${provider}:${model}`)
      ) {
        throw new Error('当前 AI 处理暂不可用，请稍后再试')
      }
      if (publicModel && allowedPublicModels.length && !allowedPublicModels.includes(selectedRuntimeModelId)) {
        throw new Error('当前 AI 处理暂不可用，请稍后再试')
      }
      if (!authStore.isAuthenticated) throw new Error('使用云端 AI 处理需要先登录账号')
      if (!publicModel && !provider) throw new Error('当前 AI 处理暂不可用，请稍后再试')
      if (!model) throw new Error('当前 AI 处理暂不可用，请稍后再试')
      const billingModelId = publicModel ? selectedRuntimeModelId : model
      const costSnapshot = budgetGuard.getCostSnapshot(billingModelId)
      if (costSnapshot.billingMode === 'credits' && costSnapshot.unitCost > 0) {
        await creditsPrompt.ensureCreditsAvailable(costSnapshot.unitCost)
      }
      budgetGuard.ensureBudgetAvailable(billingModelId, {
        getCreditAvailable: creditsPrompt.readAvailableCredits,
      })
      const passedConfirm = await confirmAiCostIfNeeded(billingModelId)
      if (!passedConfirm) return
      const sourceUrl = pickSourceImageUrl()
      if (!sourceUrl) {
        throw new Error('图生图需要可公网访问的原图 URL，请先使用网络原图再试')
      }
      const normalizedOutputSize = normalizeAiOutputSize(
        aiOutputSize.value,
        aiImageProcessingConfig?.value?.outputSizePresets || [],
      )
      if (!normalizedOutputSize) {
        throw new Error('请输入有效输出尺寸')
      }
      aiOutputSize.value = normalizedOutputSize
      const previewStartedAt = nowMs()
      const preparedSourceUrl = await prepareAiInputSourceUrl({
        sourceUrl,
        model: selectedModelId,
        loadImageFromSrc,
        maxUploadMb: runtimeAiConfig.maxUploadMb || runtimeConfigStore?.config?.limits?.maxUploadMb || 10,
        providerPayloadMaxMb:
          runtimeAiConfig.providerPayloadMaxMb ||
          runtimeConfigStore?.config?.limits?.providerPayloadMaxMb ||
          runtimeAiConfig.maxUploadMb ||
          runtimeConfigStore?.config?.limits?.maxUploadMb ||
          10,
        onStatus: (text) => {
          aiStatusText.value = text
        },
      })
      const inputReadyAt = nowMs()
      aiStatusText.value = '正在读取输入原图尺寸...'
      const sourceImage = await loadImageFromSrc(preparedSourceUrl)
      const sourceWidth = toPositiveInt(sourceImage?.naturalWidth)
      const sourceHeight = toPositiveInt(sourceImage?.naturalHeight)
      if (sourceWidth > 0 && sourceHeight > 0) {
        aiSourceReferenceSize.value = { width: sourceWidth, height: sourceHeight }
      }
      const targetSize = getAiOutputTargetSize()
      if (!targetSize.width || !targetSize.height) {
        throw new Error('请输入有效输出尺寸')
      }
      const prompt = appendQualityModePrompt(composeEnhancePrompt())
      await logPreviewAiInputDebug({
        model: selectedModelId,
        sourceUrl: preparedSourceUrl,
        baseUrl: previewConfig.baseUrl,
        prompt,
        loadImageFromSrc,
        getReferenceImageSize,
        getTargetAspectLabel,
        getTargetAspectRatio,
        getTargetAspectValue,
      })
      const backendSubmitStartedAt = nowMs()
      webDebugInfo('ai', '[AI Timing] 生成优化预览请求后端耗时', {
        clickToBackendSeconds: secondsBetween(previewStartedAt, backendSubmitStartedAt),
        inputPrepareSeconds: secondsBetween(previewStartedAt, inputReadyAt),
        endpoint: '/client/business/ai/jobs',
        usedTempInput: preparedSourceUrl !== sourceUrl,
        model: selectedModelId,
        outputSize: getTargetOutputSizeValue(),
      })
      let output = ''
      const finalModel = publicModel?.label || model
      output = await submitServerImageEditJob({
        provider,
        model,
        sourceUrl: preparedSourceUrl,
        prompt,
        pricingUsd: publicModel
          ? Number(publicModel.userPriceUsd || 0)
          : getRuntimeImageModelPricing(
              model,
              provider,
              runtimeConfigStore?.getAiModelCatalog?.() || null,
            ).usd,
        outputAspect: getTargetAspectValue(),
        outputSize: getTargetOutputSizeValue(),
        profileKey: publicModel?.profileKey || publicModel?.metadata?.profileKey || '',
        onStatus: (text) => {
          aiStatusText.value = text
        },
      })
      const normalizedOutput = await materializeAiOutput({
        rawOutput: output,
        notificationService,
        onStatus: (text) => {
          aiStatusText.value = text
        },
      })
      if (!normalizedOutput) throw new Error(`${finalModel} 未返回可用图片`)
      aiStatusText.value = '正在校验输出尺寸...'
      const finalOutput = await alignAiOutputResolution({
        outputDataUrl: normalizedOutput,
        loadImageFromSrc,
        notificationService,
        getAiOutputTargetSize,
        getTargetAspectLabel,
        getTargetAspectParts,
      })
      aiStatusText.value = 'AI 结果已生成，正在更新预览...'
      applyProcessedResult(finalOutput)
      addAiHistory(finalOutput, finalModel, getTargetOutputSizeValue())
      setComparisonMode('none')
      recordAiUsage(billingModelId, 'success')
      notificationService.success(`${aiImageProcessingConfig?.value?.panelTitle || 'AI'}结果已生成`)
    } catch (error) {
      const model = String(aiSelectedModel.value || '').trim()
      if (creditsPrompt.handleCreditError(error)) {
        aiError.value = '壁纸积分不足'
        aiRetryable.value = false
        return
      }
      aiError.value = error?.message || `${aiImageProcessingConfig?.value?.panelTitle || 'AI'}失败`
      aiRetryable.value = isAiRetryableError(aiError.value)
      notificationService.error(aiError.value)
    } finally {
      aiStatusText.value = ''
      aiLoading.value = false
    }
  }

  async function applyAiAndDownload() {
    if (aiLoading.value) return
    if (!processedPreviewUrl.value) {
      await generateAiPreview()
    }
    if (!processedPreviewUrl.value) return
    await downloadDirectly()
  }

  return {
    applyAiAndDownload,
    generateAiPreview,
    getTargetAspectValue,
    creditsDialogOpen: creditsPrompt.dialogOpen,
    requiredCredits: creditsPrompt.requiredCredits,
    availableCredits: creditsPrompt.availableCredits,
    closeCreditsDialog: creditsPrompt.closePrompt,
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function secondsBetween(startMs, endMs) {
  return Number(((Number(endMs || 0) - Number(startMs || 0)) / 1000).toFixed(3))
}

function findRuntimePublicModel(publicModels, modelId) {
  const id = String(modelId || '').trim()
  if (!id || !Array.isArray(publicModels)) return null
  return publicModels.find((item) => String(item?.id || item?.publicModelKey || '') === id) || null
}
