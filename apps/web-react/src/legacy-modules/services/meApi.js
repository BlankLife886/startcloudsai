/**
 * 个人中心相关 API（/api/v1/me/*）。
 */
import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient'

/** 修改资料：{ username?, avatarUrl?, bio?, location?, websiteUrl?, requireCostConfirm? } */
export async function updateProfile(payload = {}) {
  return apiPatch('/me/profile', payload, { fallbackMessage: '资料保存失败' })
}

/** 数据总览：钱包 / 任务、素材、投稿统计 / 未读通知 / 最近任务。 */
export async function getOverview({ signal } = {}) {
  return apiGet('/me/overview', { signal, fallbackMessage: '总览读取失败' })
}

/** 钱包总额，以及 normal/trial 两个独立积分余额与冻结额。 */
export async function getWallet({ signal } = {}) {
  return apiGet('/me/wallet', { signal, fallbackMessage: '钱包读取失败' })
}

/**
 * 兑换码入账：返回 grantCents 和完整钱包快照。
 * 错误码：code_invalid / code_redeemed / code_expired / code_disabled / rate_limited。
 */
export async function redeemWalletCode(code) {
  return apiPost(
    '/me/wallet/redemptions',
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
  const data = await apiGet('/me/wallet/entries', {
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
    unread: Number(data?.unread || 0),
  }
}

/** 标记已读；不传 ids 则全部已读。 */
export async function markNotificationsRead(ids = null) {
  return apiPatch('/me/notifications', Array.isArray(ids) && ids.length ? { ids } : {}, {
    fallbackMessage: '标记已读失败',
  })
}

/** 清空当前用户可见通知（个人记录删除，全站公告仅对自己隐藏）。 */
export async function clearNotifications() {
  return apiDelete('/me/notifications', { fallbackMessage: '清空通知失败' })
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
export async function listUserAssets({ limit = 24, cursor = '', groupId = 'all', signal } = {}) {
  const data = await apiGet('/me/assets', {
    query: { limit, cursor, groupId },
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

export async function updateUserAsset(id, payload) {
  return apiPatch(`/me/assets/${encodeURIComponent(id)}`, payload, {
    fallbackMessage: '素材更新失败',
  })
}

export async function deleteUserAsset(id) {
  return apiDelete(`/me/assets/${encodeURIComponent(id)}`, { fallbackMessage: '素材删除失败' })
}

export async function listUserAssetGroups({ signal } = {}) {
  const data = await apiGet('/me/asset-groups', {
    signal,
    fallbackMessage: '分组读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    ungroupedCount: Number(data?.ungroupedCount || 0),
    totalAssetCount: Number(data?.totalAssetCount || 0),
  }
}

export async function createUserAssetGroup(payload) {
  return apiPost('/me/asset-groups', payload, { fallbackMessage: '分组创建失败' })
}

export async function updateUserAssetGroup(id, payload) {
  return apiPatch(`/me/asset-groups/${encodeURIComponent(id)}`, payload, {
    fallbackMessage: '分组更新失败',
  })
}

export async function deleteUserAssetGroup(id) {
  return apiDelete(`/me/asset-groups/${encodeURIComponent(id)}`, {
    fallbackMessage: '分组删除失败',
  })
}
