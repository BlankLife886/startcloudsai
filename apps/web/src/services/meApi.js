/**
 * 个人中心相关 API（/api/me/*）。
 */
import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient'

/** 修改资料：{ username?, avatarUrl?, bio?, location?, websiteUrl?, password?: {old,new} } */
export async function updateProfile(payload = {}) {
  return apiPatch('/me/profile', payload, { fallbackMessage: '资料保存失败' })
}

/** 数据总览：钱包 / 任务统计 / 未读通知 / 最近任务。 */
export async function getOverview({ signal } = {}) {
  return apiGet('/me/overview', { signal, fallbackMessage: '总览读取失败' })
}

/** 钱包：{ balanceCents, frozenCents } */
export async function getWallet({ signal } = {}) {
  return apiGet('/me/wallet', { signal, fallbackMessage: '钱包读取失败' })
}

/**
 * 兑换码入账：POST /api/me/wallet/redeem → { grantCents, balanceCents }。
 * 错误码：code_invalid / code_redeemed / code_expired / code_disabled / rate_limited。
 */
export async function redeemWalletCode(code) {
  return apiPost(
    '/me/wallet/redeem',
    {
      code: String(code || '')
        .trim()
        .toUpperCase(),
    },
    { fallbackMessage: '兑换失败' },
  )
}

/** 钱包账本（cursor 分页）。 */
export async function listWalletLedger({ limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/me/wallet/ledger', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '账本读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/** 通知列表（含全站公告合并，cursor 分页）。 */
export async function listNotifications({ limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/me/notifications', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '通知读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/** 标记已读；不传 ids 则全部已读。 */
export async function markNotificationsRead(ids = null) {
  return apiPost('/me/notifications/read', Array.isArray(ids) && ids.length ? { ids } : {}, {
    fallbackMessage: '标记已读失败',
  })
}

/** 我的画廊投稿及审核状态。 */
export async function listMyGallerySubmissions({ limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/me/gallery/submissions', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '投稿读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/** 撤回/删除投稿。 */
export async function deleteMyGallerySubmission(id) {
  return apiDelete(`/me/gallery/submissions/${encodeURIComponent(id)}`, {
    fallbackMessage: '投稿删除失败',
  })
}

/** 用户自有素材库（原图仅在预览时读取，列表使用 thumbnailUrl）。 */
export async function listUserAssets({ limit = 24, cursor = '', signal } = {}) {
  const data = await apiGet('/me/assets', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '素材库读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

export async function createUserAsset(payload) {
  return apiPost('/me/assets', payload, { fallbackMessage: '素材保存失败' })
}

export async function deleteUserAsset(id) {
  return apiDelete(`/me/assets/${encodeURIComponent(id)}`, { fallbackMessage: '素材删除失败' })
}
