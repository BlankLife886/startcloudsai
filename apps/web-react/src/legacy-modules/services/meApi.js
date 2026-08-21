/**
 * 个人中心相关 API（/api/v1/me/*）。
 */
import { apiDelete, apiGet, apiPatch, apiPost, buildApiPath, ApiError } from './apiClient.js'

/** 修改资料：{ username?, avatarUrl?, studioFigureUrl?, bio?, location?, websiteUrl?, requireCostConfirm? } */
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

/** 钱包账本（page 分页，兼容 cursor）。 */
export async function listWalletLedger({ limit = 20, cursor = '', page, signal } = {}) {
  const data = await apiGet('/me/wallet/entries', {
    query: { limit, cursor, page },
    signal,
    fallbackMessage: '账本读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
    total: data?.total == null || data?.total === '' ? null : Number(data.total),
    page: Number(data?.page || page || 1),
    pageSize: Number(data?.pageSize || limit),
  }
}

/** 全量账单汇总：合计消耗、入账渠道与失败退回。 */
export async function getWalletSummary({ signal } = {}) {
  const data = await apiGet('/me/wallet/summary', { signal, fallbackMessage: '账单汇总读取失败' })
  return {
    consumedCents: Number(data?.consumedCents || 0),
    consumedCount: Number(data?.consumedCount || 0),
    refundCents: Number(data?.refundCents || 0),
    refundCount: Number(data?.refundCount || 0),
    incomeCents: Number(data?.incomeCents || 0),
    incomeCount: Number(data?.incomeCount || 0),
    entryCount: Number(data?.entryCount || 0),
    items: Array.isArray(data?.items) ? data.items : [],
  }
}

/** 下载完整积分账单 CSV（含汇总与明细）。 */
export async function downloadWalletBill({ signal } = {}) {
  let response
  try {
    response = await fetch(buildApiPath('/me/wallet/export'), {
      method: 'GET',
      credentials: 'include',
      signal,
    })
  } catch (caught) {
    if (caught?.name === 'AbortError') throw caught
    throw new ApiError('网络连接失败，请检查网络后重试', { code: 'network_error', status: 0 })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ApiError(String(payload?.error || `账单导出失败（${response.status}）`), {
      code: String(payload?.code || 'request_failed'),
      status: response.status,
    })
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const matched = /filename="([^"]+)"/.exec(disposition)
  return { blob, filename: matched?.[1] || 'starclouds-wallet.csv' }
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
