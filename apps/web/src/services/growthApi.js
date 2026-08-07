import { apiGet, apiPost } from './apiClient'

export function getGrowthPrograms({ signal } = {}) {
  return apiGet('/me/growth', { signal, fallbackMessage: '创作激励数据读取失败' })
}

export function createGrowthGroup() {
  return apiPost('/me/growth/groups', {}, { fallbackMessage: '创建拼团失败' })
}

export function joinGrowthGroup(code) {
  return apiPost(
    '/me/growth/groups/join',
    {
      code: String(code || '')
        .trim()
        .toUpperCase(),
    },
    { fallbackMessage: '加入拼团失败' },
  )
}
