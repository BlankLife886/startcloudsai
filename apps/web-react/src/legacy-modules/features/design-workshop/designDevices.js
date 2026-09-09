/** Shared device carriers for UI design workshop (multi-select generation). */

export const DESIGN_DEVICE_OPTIONS = [
  {
    id: 'web',
    label: '电脑端',
    icon: 'bi-laptop',
    ratio: '16:9',
    prompt: '桌面端网页界面（1440px 宽度、12 列栅格）',
    viewport: { width: 1440, height: 810 },
  },
  {
    id: 'phone',
    label: '手机端',
    icon: 'bi-phone',
    ratio: '9:16',
    prompt: '手机端界面（逻辑宽度 390px、竖屏单列布局）',
    viewport: { width: 390, height: 844 },
  },
  {
    id: 'tablet',
    label: '平板',
    icon: 'bi-tablet-landscape',
    ratio: '4:3',
    prompt: '平板端界面（横屏布局、支持双栏结构）',
    viewport: { width: 1024, height: 768 },
  },
  {
    id: 'miniapp',
    label: '小程序',
    icon: 'bi-app-indicator',
    ratio: '9:16',
    prompt: '微信小程序界面（逻辑宽度 390px、原生顶栏节奏）',
    viewport: { width: 390, height: 844 },
  },
  {
    id: 'tv',
    label: '智能电视',
    icon: 'bi-tv',
    ratio: '16:9',
    prompt: '智能电视 / 大屏界面（10-foot UI、焦点导航、更大字号与间距）',
    viewport: { width: 1920, height: 1080 },
  },
]

export const LEGACY_DEVICE_FALLBACK = ['web', 'phone', 'tablet', 'miniapp', 'tv', 'legacy']

export function getDesignDevice(id) {
  return DESIGN_DEVICE_OPTIONS.find((item) => item.id === id) || DESIGN_DEVICE_OPTIONS[0]
}

export function normalizeSelectedDeviceIds(value) {
  const ids = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
  const allowed = new Set(DESIGN_DEVICE_OPTIONS.map((item) => item.id))
  const next = [...new Set(ids.filter((id) => allowed.has(id)))]
  return next.length ? next : ['web']
}
