import { apiGet, apiPost } from './apiClient'

export function getCheckinState({ signal } = {}) {
  return apiGet('/me/checkin', { signal, fallbackMessage: '签到活动读取失败' })
}

export function claimDailyCheckin() {
  return apiPost('/me/checkin', null, { fallbackMessage: '签到失败' })
}
