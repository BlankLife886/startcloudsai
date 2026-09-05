import { apiGet, apiPost } from './apiClient'

export async function getTrialAccessCampaign({ signal } = {}) {
  const data = await apiGet('/trial-access-campaign', {
    signal,
    fallbackMessage: '体验活动读取失败',
  })
  return data?.campaign || null
}

export async function getTrialAccessApplication({ signal } = {}) {
  const data = await apiGet('/me/trial-access-application', {
    signal,
    fallbackMessage: '体验资格申请读取失败',
  })
  return data?.application || null
}

export async function submitTrialAccessApplication({ occupation, reason }) {
  return apiPost(
    '/me/trial-access-applications',
    {
      occupation: String(occupation || '').trim(),
      reason: String(reason || '').trim(),
    },
    { fallbackMessage: '体验资格申请提交失败' },
  )
}

export async function claimTrialAccessReward() {
  return apiPost('/me/trial-access-application/reward', undefined, {
    fallbackMessage: '体验积分领取失败',
  })
}
