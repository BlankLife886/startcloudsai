/** 壁纸 AI 积分：模型级优先，回退到功能级 creditCost（Admin「功能配置 → 积分消耗」） */
export function resolveWallpaperCreditCost(modelCreditCost, featureCreditCost = 0) {
  const model = Math.max(0, Math.floor(Number(modelCreditCost || 0)))
  if (model > 0) return model
  return Math.max(0, Math.floor(Number(featureCreditCost || 0)))
}

export function readFeatureCreditCost(featureConfig = {}) {
  return Math.max(0, Math.floor(Number(featureConfig?.creditCost || 0)))
}

export function resolvePublicModelCreditCost(publicModel, featureConfig = {}) {
  if (!publicModel || typeof publicModel !== 'object') {
    return readFeatureCreditCost(featureConfig)
  }
  return resolveWallpaperCreditCost(publicModel.creditCost, readFeatureCreditCost(featureConfig))
}

export function findFeaturePublicModel(publicModels, modelId) {
  const id = String(modelId || '').trim()
  if (!id || !Array.isArray(publicModels)) return null
  return (
    publicModels.find((item) => String(item?.id || item?.publicModelKey || '') === id) || null
  )
}
