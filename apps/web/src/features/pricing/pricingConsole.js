export const PRICING_BRAND = {
  brandName: '星空云绘 · StarCloudIsAI',
  sidebarTitle: '开发者控制台',
  sidebarSubtitle: 'API · 计费 · 用量',
  balanceLabel: '可用余额',
  rechargeLabel: '充值',
}

export const PRICING_DEFAULT_SECTION = 'overview'

export const PRICING_NAV_ITEMS = [
  { id: 'overview', label: '概览', shortLabel: '概览', icon: 'bi-speedometer2' },
  { id: 'wallet', label: '钱包', shortLabel: '钱包', icon: 'bi-wallet2' },
  { id: 'plans', label: '套餐', shortLabel: '套餐', icon: 'bi-layers' },
  { id: 'usage', label: '用量', shortLabel: '用量', icon: 'bi-bar-chart-line' },
  { id: 'keys', label: '充值密钥', shortLabel: '密钥', icon: 'bi-key-fill' },
  { id: 'models', label: '模型价格', shortLabel: '模型', icon: 'bi-cpu' },
  { id: 'docs', label: '接入文档', shortLabel: '文档', icon: 'bi-code-slash' },
  { id: 'referrals', label: '推荐奖励', shortLabel: '推荐', icon: 'bi-gift' },
  { id: 'settings', label: '个人设置', shortLabel: '设置', icon: 'bi-gear' },
]

export const PRICING_NAV_GROUPS = [
  { id: 'home', label: '工作台', items: ['overview'] },
  { id: 'billing', label: '计费中心', items: ['wallet', 'plans', 'usage'] },
  { id: 'api', label: 'API 接入', items: ['keys', 'models', 'docs'] },
  { id: 'mine', label: '我的', items: ['referrals'] },
]

export const PRICING_SECTIONS = {
  overview: {
    enabled: true,
    title: '概览',
    subtitle: '调用趋势、用量洞察与公告动态。',
  },
  models: {
    enabled: true,
    title: '模型价格',
    subtitle: '公开模型目录、计费方式与用户侧价格。',
  },
  keys: {
    enabled: true,
    title: '充值密钥',
    subtitle: '按量调用的 API 密钥，可设置限额与模型权限。订阅密钥请在「套餐」页管理。',
  },
  docs: {
    enabled: true,
    title: '接入文档',
    subtitle: 'OpenAI / Anthropic 兼容接入：Base URL、鉴权、端点说明与 SDK 示例。',
  },
  usage: {
    enabled: true,
    title: '用量',
    subtitle: '24h token 汇总、调用日志与每次请求的输入/缓存/输出明细。',
  },
  wallet: {
    enabled: true,
    title: '钱包',
    subtitle: '选择充值档位，右侧确认到账明细与支付。',
  },
  referrals: {
    enabled: true,
    title: '推荐奖励',
    subtitle: '分享邀请链接，好友注册并完成首笔订单后获得美元奖励。',
  },
  settings: {
    enabled: true,
    title: '个人设置',
    subtitle: '账号资料、API 接入信息与账号安全设置。',
  },
  plans: {
    enabled: true,
    title: '套餐订阅',
    subtitle: '当前套餐、选购方案与订单记录分 Tab 查看。',
  },
}

export function getPricingNavItem(id = '') {
  const normalized = String(id || '').trim()
  return PRICING_NAV_ITEMS.find((item) => item.id === normalized) || { id: '', label: '', icon: 'bi-circle' }
}

export function getPricingSection(id = '') {
  const normalized = String(id || '').trim()
  return PRICING_SECTIONS[normalized] || { enabled: true, title: '', subtitle: '' }
}

export function createDefaultPricingSettings() {
  return {
    apiKeys: {
      defaultLabel: 'StarCloudIsAI Key',
      defaultPrefix: 'sk',
      defaultScopes: ['ai.chat', 'ai.responses', 'ai.images', 'ai.embeddings'],
      scopeOptions: [
        { value: 'ai.chat', label: '对话补全', hint: '/chat/completions、/v1/messages' },
        { value: 'ai.responses', label: 'Responses', hint: '/responses' },
        { value: 'ai.images', label: '图像生成', hint: '/images/*' },
        { value: 'ai.embeddings', label: '向量嵌入', hint: '/embeddings' },
        { value: 'ai.audio', label: '语音', hint: '/audio/*' },
      ],
      defaultDailyLimitUnits: 0,
      defaultMonthlyLimitUnits: 0,
      defaultDailyLimitUsd: 0,
      defaultMonthlyLimitUsd: 0,
    },
    wallet: {
      rechargeAmounts: [10, 25, 50, 100, 250],
      defaultAmount: 25,
      rechargeUrl: '',
      creditsPerUsd: 100,
    },
    referrals: {
      enabled: true,
      rewardPercent: 5,
      rewardCredits: 0,
      creditsPerUsd: 0,
      minOrderCents: 0,
      invitePath: '/auth/register',
      description: '分享邀请链接，让新用户通过你的链接注册。',
    },
    support: {
      title: '需要帮助？',
      description: '账号、充值、套餐与人工协助请在本页处理。API 接入、鉴权与代码示例请看「接入文档」。',
      email: '',
      docsUrl: '',
      statusUrl: '',
      telegramUrl: '',
    },
  }
}

export function mergePricingSettings(...sources) {
  return sources.reduce((result, source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return result
    }
    Object.entries(source).forEach(([key, value]) => {
      const current = result[key]
      if (
        current &&
        typeof current === 'object' &&
        !Array.isArray(current) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        result[key] = mergePricingSettings(current, value)
        return
      }
      result[key] = value
    })
    return result
  }, structuredCloneSafe(createDefaultPricingSettings()))
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}
