import { getRuntimeImageModelPricing } from '@/config/aiModels'
import { formatUsd } from '@/features/pricing/pricingMoney.js'
import { getAiProviderBudget } from '@/config/aiFeatureSettings'
import {
  findFeaturePublicModel,
  resolvePublicModelCreditCost,
  readFeatureCreditCost,
} from '@/features/ai-shared/resolveWallpaperCreditCost'
import {
  getAiUsageCostWindow,
  recordAiUsage as recordAiUsageLedger,
} from '@/services/aiUsageLedger'
import { studioFeatureLabel } from '@/features/ai-shared/studioUsage'

function resolveModelBilling(
  model,
  findPublicModel,
  getPreviewProvider,
  getRuntimeModelCatalog,
  getFeatureConfig,
) {
  const featureConfig =
    typeof getFeatureConfig === 'function' ? getFeatureConfig() || {} : {}
  const publicModel = findPublicModel(model)
  if (publicModel) {
    return {
      mode: 'credits',
      unitCost: resolvePublicModelCreditCost(publicModel, featureConfig),
    }
  }
  const featureCreditCost = readFeatureCreditCost(featureConfig)
  if (featureCreditCost > 0) {
    return { mode: 'credits', unitCost: featureCreditCost }
  }
  const pricing = getRuntimeImageModelPricing(model, getPreviewProvider(), getRuntimeModelCatalog())
  return { mode: 'usd', unitCost: Number(pricing.usd || 0) }
}

// 预览 AI 的预算与用量逻辑独立出来，避免生成流程里混入太多账本细节。
export function createPreviewAiBudgetGuard({
  settingsStore,
  confirmAiCost = null,
  getRuntimeModelCatalog = () => null,
  getRuntimePublicModels = () => [],
  getRuntimeProvider = null,
  getFeatureConfig = () => ({}),
}) {
  function getPreviewProvider() {
    if (typeof getRuntimeProvider === 'function') {
      const provider = String(getRuntimeProvider() || '').trim()
      if (provider) return provider
    }
    return ''
  }

  function getTodayAndMonthUsage(billingMode) {
    return getAiUsageCostWindow('preview', billingMode)
  }

  function findPublicModel(model) {
    const featurePublicModels = getRuntimePublicModels()
    const fromFeature = findFeaturePublicModel(featurePublicModels, model)
    if (fromFeature) return fromFeature
    const catalog = getRuntimeModelCatalog() || {}
    return findFeaturePublicModel(catalog.publicModels, model)
  }

  function getModelBilling(model) {
    return resolveModelBilling(
      model,
      findPublicModel,
      getPreviewProvider,
      getRuntimeModelCatalog,
      getFeatureConfig,
    )
  }

  function getModelUnitCost(model) {
    return getModelBilling(model).unitCost
  }

  function getCostSnapshot(model) {
    const billing = getModelBilling(model)
    const { dayCost, monthCost } = getTodayAndMonthUsage(billing.mode)
    const publicModel = findPublicModel(model)
    return {
      model,
      provider: publicModel ? 'AI 中转站' : getPreviewProvider(),
      billingMode: billing.mode,
      unitCost: billing.unitCost,
      unitCostPerUnit: billing.unitCost,
      count: 1,
      dayCost,
      monthCost,
      featureLabel: studioFeatureLabel('preview'),
    }
  }

  function ensureBudgetAvailable(model, options = {}) {
    const billing = getModelBilling(model)
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
    const unitCost = billing.unitCost
    const { dailyBudget: dailyLimit, monthlyBudget: monthlyLimit } = getAiProviderBudget(
      settingsStore,
      getPreviewProvider(),
    )
    const { dayCost, monthCost } = getTodayAndMonthUsage('usd')
    if (dailyLimit > 0 && dayCost + unitCost > dailyLimit + 1e-9) {
      throw new Error(`已触达日预算上限（${formatUsd(dailyLimit)}），请调整预算或明天再试`)
    }
    if (monthlyLimit > 0 && monthCost + unitCost > monthlyLimit + 1e-9) {
      throw new Error(`已触达月预算上限（${formatUsd(monthlyLimit)}），请调整预算后重试`)
    }
  }

  async function confirmAiCostIfNeeded(model) {
    const requireConfirm = !!settingsStore.getSetting('ai_require_cost_confirm', true)
    if (!requireConfirm) return true
    const billing = getModelBilling(model)
    const { dayCost, monthCost } = getTodayAndMonthUsage(billing.mode)
    if (typeof confirmAiCost !== 'function') return true
    return await confirmAiCost({
      model,
      provider: findPublicModel(model) ? 'AI 中转站' : getPreviewProvider(),
      billingMode: billing.mode,
      unitCost: billing.unitCost,
      dayCost,
      monthCost,
    })
  }

  function recordAiUsage(model, status = 'success') {
    const billing = getModelBilling(model)
    recordAiUsageLedger({
      settingsStore,
      featureKey: 'preview',
      provider: getPreviewProvider(),
      model,
      status,
      runtimeModelCatalog: getRuntimeModelCatalog(),
      unitCost: billing.unitCost,
      billingMode: billing.mode,
    })
  }

  return {
    confirmAiCostIfNeeded,
    ensureBudgetAvailable,
    getCostSnapshot,
    getModelUnitCost,
    recordAiUsage,
  }
}
