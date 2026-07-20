import { buildAccountSettingsStats } from '@/features/pricing/pricingAccountSettings'

export function resolvePlanLabel(current) {
  if (!current?.plan?.name && !current?.planName) return '未订阅'
  const name = current.plan?.name || current.planName || ''
  const status = String(current.status || current.subscriptionStatus || '').toLowerCase()
  if (status && !['active', 'trialing', 'paid'].includes(status)) {
    return `${name} (${status})`
  }
  return name || '已订阅'
}

export function buildProfileHubStats(summary = {}, planCurrent = null) {
  const apiKeys = Array.isArray(summary.apiKeys) ? summary.apiKeys : []
  const activeKeyCount = apiKeys.filter((key) => key?.status !== 'revoked' && key?.revokedAt == null)
    .length
  const monthCalls = Number(summary.usage?.month?.count ?? summary.usage?.month?.units ?? 0)

  return buildAccountSettingsStats({
    planLabel: resolvePlanLabel(planCurrent),
    planUnsubscribed: !planCurrent?.plan?.name && !planCurrent?.planName,
    planHint: planCurrent?.plan?.billingCycle ? '套餐生效中' : '在价格页管理订阅',
    activeKeyCount,
    monthCallCount: monthCalls,
    usageHint: '本月创作调用',
  }).filter((item) => item.id !== 'balance')
}

/** 概览「继续创作」快捷入口 — 对齐全站核心能力 */
export function buildProfileContinueCards(input = {}) {
  return [
    {
      id: 'favorites',
      label: '整理收藏',
      desc: input.favoritesCount ? `${input.favoritesCount} 张灵感` : '建立你的灵感库',
      icon: 'bi-heart',
      tab: 'collections',
      tone: 'accent',
    },
    {
      id: 'coloring',
      label: '插画染色',
      desc: '线稿上色与作品回顾',
      icon: 'bi-brush-fill',
      to: { name: 'ai-illustration-coloring' },
      tone: 'warm',
    },
    {
      id: 'wallpaper',
      label: '文生图',
      desc: '文生图工作台',
      icon: 'bi-stars',
      to: { name: 'text-to-image' },
      tone: 'violet',
    },
    {
      id: 'share',
      label: '社区 Share',
      desc: '浏览与发布作品',
      icon: 'bi-share',
      to: { name: 'share' },
      tone: 'soft',
    },
  ]
}

export function buildProfileLibraryGlance(input = {}) {
  return [
    {
      id: 'favorites',
      label: '收藏',
      value: input.favoritesCount ?? 0,
      hint: '张壁纸',
      tab: 'collections',
      icon: 'bi-heart',
    },
    {
      id: 'collections',
      label: '收藏夹',
      value: input.collectionsCount ?? 0,
      hint: '个主题',
      tab: 'collections',
      icon: 'bi-folder',
    },
    {
      id: 'history',
      label: '浏览',
      value: input.historyCount ?? 0,
      hint: '次足迹',
      tab: 'activity',
      icon: 'bi-clock-history',
    },
    {
      id: 'downloads',
      label: '下载',
      value: input.downloadCount ?? 0,
      hint: '次保存',
      tab: 'downloads',
      icon: 'bi-download',
    },
  ]
}

/** 概览底部轻量服务链（一行） */
export function buildProfileServiceLinks(input = {}) {
  return [
    {
      id: 'pricing',
      label: '钱包与套餐',
      icon: 'bi-wallet2',
      to: { name: 'pricing' },
    },
    {
      id: 'settings',
      label: '应用设置',
      icon: 'bi-sliders',
      to: { name: 'settings' },
    },
    {
      id: 'downloads',
      label: '下载管理',
      icon: 'bi-download',
      to: { name: 'downloads' },
      hidden: input.downloadsEnabled === false,
    },
    {
      id: 'search',
      label: '浏览壁纸',
      icon: 'bi-search-heart',
      to: { name: 'search' },
    },
  ].filter((item) => !item.hidden)
}
