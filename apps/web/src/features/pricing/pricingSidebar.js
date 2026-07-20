export const PRICING_MOBILE_NAV_IDS = [
  'overview',
  'wallet',
  'plans',
  'keys',
  'usage',
]

export const PRICING_SIDEBAR_FOOTER_LINKS = [
  { id: 'settings', label: '个人设置', icon: 'bi-gear' },
]

export function buildSidebarNavGroups(groups = [], items = []) {
  const itemMap = new Map(items.map((item) => [item.id, item]))
  return groups
    .map((group) => ({
      ...group,
      items: group.items.map((id) => itemMap.get(id)).filter(Boolean),
    }))
    .filter((group) => group.items.length)
}

export function resolveSidebarNavBadge(itemId = '', badges = {}) {
  const value = badges[itemId]
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

export function filterMobileNavItems(items = [], ids = PRICING_MOBILE_NAV_IDS) {
  const order = new Map(ids.map((id, index) => [id, index]))
  return items
    .filter((item) => order.has(item.id))
    .sort((a, b) => order.get(a.id) - order.get(b.id))
}
