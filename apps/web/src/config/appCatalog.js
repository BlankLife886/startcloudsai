/**
 * 应用空间目录 — 独立 App / 小程序产品入口（非本站网页链接）
 *
 * scope: site = 本品牌（星空云绘）的客户端；other = 其他网站/项目的产品
 * type: app | miniprogram
 * href: 商店链接、小程序路径等；为空则展示为筹备中
 * status: published | draft
 */
export const APP_CATALOG = [
  {
    id: 'site-ios',
    name: '星空云绘',
    tagline: 'iOS 客户端 · 壁纸浏览与 AI 创作',
    href: '',
    scope: 'site',
    type: 'app',
    platform: 'iOS',
    icon: 'bi-apple',
    accent: '#a78bfa',
    accentRgb: '167, 139, 250',
    featured: true,
    status: 'draft',
    sort: 10,
  },
  {
    id: 'site-android',
    name: '星空云绘',
    tagline: 'Android 客户端 · 壁纸浏览与 AI 创作',
    href: '',
    scope: 'site',
    type: 'app',
    platform: 'Android',
    icon: 'bi-android2',
    accent: '#4ade80',
    accentRgb: '74, 222, 128',
    featured: false,
    status: 'draft',
    sort: 20,
  },
  {
    id: 'site-wechat-mp',
    name: '星空云绘小程序',
    tagline: '微信小程序 · 轻量浏览与收藏',
    href: '',
    scope: 'site',
    type: 'miniprogram',
    platform: '微信',
    icon: 'bi-chat-dots-fill',
    accent: '#86efac',
    accentRgb: '134, 239, 172',
    featured: false,
    status: 'draft',
    sort: 30,
  },
]

export const APP_SCOPE_LABELS = {
  site: '本站',
  other: '其他站点',
}

export const APP_TYPE_LABELS = {
  app: 'App',
  miniprogram: '小程序',
}

export const APP_SCOPE_EMPTY = {
  site: '本站 App 与小程序筹备中，上线后将在此提供下载或打开入口。',
  other: '其他网站/项目的 App 与小程序会集中展示在这里，暂无条目。',
}

/** @deprecated */
export const APP_CATEGORY_LABELS = APP_TYPE_LABELS
