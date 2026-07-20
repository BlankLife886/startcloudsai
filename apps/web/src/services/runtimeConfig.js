/**
 * 运行时配置：新后端没有对应接口，改为静态默认「全部开放」。
 * 保留原有数据形状（routes/features/blacklist 等），router guard 与
 * 各 Studio 的 canUse/getFeaturePayload 调用无需修改。
 */

/**
 * 新后端不再下发模型目录：模型由服务端按任务类型调度（默认 gpt-image-2）。
 * 这里给每个工作台提供一个「标准模型」占位，保证旧模型选择逻辑自动选中即可用。
 */
const STANDARD_PUBLIC_MODEL = {
  id: 'standard',
  label: '标准模型（服务端调度）',
  description: '由服务端按任务类型选择最优模型',
  capabilities: ['textToImage', 'imageToImage', 'image.edit'],
  billingMode: 'wallet',
  userPriceUsd: 0,
  creditCost: 0,
}

const STUDIO_FEATURE_KEYS = [
  'ai.wallpaperGeneration',
  'ai.illustrationColoring',
  'ai.uiDesign',
  'ai.ultraModelSheet',
  'ai.gameDesign',
  'ai.puzzle',
  'ai.optimize',
  'wallpaper',
]

function buildDefaultFeatures() {
  const features = {}
  for (const key of STUDIO_FEATURE_KEYS) {
    features[key] = {
      enabled: true,
      config: {
        publicModels: [STANDARD_PUBLIC_MODEL],
      },
    }
  }
  return features
}

export function getDefaultRuntimeConfig() {
  return {
    routes: {},
    features: buildDefaultFeatures(),
    pageLayout: {},
    aiModelCatalog: {
      providers: [],
      models: [],
      publicModels: [STANDARD_PUBLIC_MODEL],
      featurePublicModels: [],
      updatedAt: '',
    },
    blacklist: { blocked: false, reason: '' },
    mqtt: null,
  }
}

export function normalizeRuntimeConfig(config = {}) {
  return { ...getDefaultRuntimeConfig(), ...(config && typeof config === 'object' ? config : {}) }
}

export async function fetchRuntimeConfig() {
  return getDefaultRuntimeConfig()
}
