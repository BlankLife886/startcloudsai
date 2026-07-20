import { getRuntimeImageModelPricing } from '@/config/aiModels'
import { getAiProviderBudget } from '@/config/aiFeatureSettings'
import {
  findFeaturePublicModel,
  resolvePublicModelCreditCost,
  readFeatureCreditCost,
} from '@/features/ai-shared/resolveWallpaperCreditCost'
import { getAiUsageCostWindow } from '@/services/aiUsageLedger'
import { formatUsd } from '@/features/pricing/pricingMoney.js'
import { studioFeatureLabel } from '@/features/ai-shared/studioUsage'

function resolveModelBilling(
  modelId,
  findPublicModel,
  getProvider,
  getRuntimeModelCatalog,
  getFeatureConfig,
  count = 1,
) {
  const units = Math.max(1, count)
  const featureConfig =
    typeof getFeatureConfig === 'function' ? getFeatureConfig() || {} : {}
  const publicModel = findPublicModel(modelId)
  if (publicModel) {
    return {
      mode: 'credits',
      unitCost: resolvePublicModelCreditCost(publicModel, featureConfig) * units,
    }
  }
  const featureCreditCost = readFeatureCreditCost(featureConfig)
  if (featureCreditCost > 0) {
    return { mode: 'credits', unitCost: featureCreditCost * units }
  }
  const pricing = getRuntimeImageModelPricing(modelId, getProvider(), getRuntimeModelCatalog())
  return { mode: 'usd', unitCost: Number(pricing.usd || 0) * units }
}

/** 壁纸 Studio 预算守卫（对齐 Preview AI 的 aiBudgetGuard） */
export function createStudioBudgetGuard({
  settingsStore,
  getRuntimeModelCatalog = () => null,
  getProvider = () => 'gptsapi',
  getPublicModels = () => [],
  getFeatureConfig = () => ({}),
  featureKey = 'wallpaper',
}) {
  function findPublicModel(modelId) {
    const models = typeof getPublicModels === 'function' ? getPublicModels() : []
    return findFeaturePublicModel(models, modelId)
  }

  function getModelBilling(modelId, count = 1) {
    return resolveModelBilling(
      modelId,
      findPublicModel,
      getProvider,
      getRuntimeModelCatalog,
      getFeatureConfig,
      count,
    )
  }

  function getModelUnitCost(modelId, count = 1) {
    return getModelBilling(modelId, count).unitCost
  }

  function ensureBudgetAvailable(modelId, count = 1, options = {}) {
    const billing = getModelBilling(modelId, count)
    if (billing.mode === 'credits') {
      if (billing.unitCost <= 0) return
      const available = Number(
        options.creditAvailable ?? options.getCreditAvailable?.() ?? Number.NaN,
      )
      if (Number.isFinite(available) && available + 1e-9 < billing.unitCost) {
        const error = new Error('壁纸积分不足')
        error.code = 'INSUFFICIENT_CREDITS'
        error.required = billing.unitCost
        error.available = Math.max(0, available)
        throw error
      }
      return
    }

    const totalCost = billing.unitCost
    const { dailyBudget: dailyLimit, monthlyBudget: monthlyLimit } = getAiProviderBudget(
      settingsStore,
      getProvider(),
    )
    const { dayCost, monthCost } = getAiUsageCostWindow(featureKey, 'usd')

    if (dailyLimit > 0 && dayCost + totalCost > dailyLimit + 1e-9) {
      throw new Error(`已触达 AI 日预算上限（${formatUsd(dailyLimit)}）`)
    }
    if (monthlyLimit > 0 && monthCost + totalCost > monthlyLimit + 1e-9) {
      throw new Error(`已触达 AI 月预算上限（${formatUsd(monthlyLimit)}）`)
    }
  }

  function getCostSnapshot(modelId, count = 1) {
    const units = Math.max(1, count)
    const billing = getModelBilling(modelId, count)
    const { dayCost, monthCost } = getAiUsageCostWindow(featureKey, billing.mode)
    const publicModel = findPublicModel(modelId)
    return {
      model: modelId,
      provider: publicModel ? 'AI 中转站' : getProvider(),
      billingMode: billing.mode,
      unitCost: billing.unitCost,
      unitCostPerUnit: billing.unitCost / units,
      count: units,
      dayCost,
      monthCost,
      featureLabel: studioFeatureLabel(featureKey),
    }
  }

  async function confirmCostIfNeeded(modelId, count, confirmAiCost) {
    const requireConfirm = !!settingsStore.getSetting('ai_require_cost_confirm', true)
    if (!requireConfirm) return true
    if (typeof confirmAiCost !== 'function') return true
    return await confirmAiCost(getCostSnapshot(modelId, count))
  }

  return {
    ensureBudgetAvailable,
    getCostSnapshot,
    confirmCostIfNeeded,
    getModelUnitCost,
  }
}
