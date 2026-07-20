export function createEmptyReferralSummary() {
  return {
    inviteCode: '',
    totalReferrals: 0,
    rewardedReferrals: 0,
    rewardCredits: 0,
    referrals: [],
    config: null,
  }
}

export function resolveReferralProgramConfig(referralSummary = {}, pricingReferrals = {}) {
  const apiConfig = referralSummary?.config && typeof referralSummary.config === 'object'
    ? referralSummary.config
    : {}
  const pricing = pricingReferrals && typeof pricingReferrals === 'object' ? pricingReferrals : {}
  const enabled =
    apiConfig.enabled !== undefined
      ? apiConfig.enabled !== false
      : pricing.enabled !== false
  return {
    enabled,
    rewardPercent: Number(apiConfig.rewardPercent ?? pricing.rewardPercent ?? 0),
    rewardCredits: Number(apiConfig.rewardCredits ?? pricing.rewardCredits ?? 0),
    creditsPerUsd: Number(apiConfig.creditsPerUsd ?? pricing.creditsPerUsd ?? 0),
    minOrderCents: Number(apiConfig.minOrderCents ?? pricing.minOrderCents ?? 0),
    invitePath: String(pricing.invitePath || '/auth/register').trim() || '/auth/register',
    description: String(pricing.description || '').trim(),
  }
}

export function buildReferralInviteUrl(origin = '', invitePath = '/auth/register', inviteCode = '') {
  const path = String(invitePath || '/auth/register').trim() || '/auth/register'
  const base = String(origin || '').trim() || (typeof window !== 'undefined' ? window.location.origin : '')
  const url = path.startsWith('http') ? new URL(path) : new URL(path, base || 'http://localhost')
  const code = String(inviteCode || '').trim()
  if (code) {
    url.searchParams.set('ref', code)
    url.searchParams.set('referrerId', code)
  }
  return url.toString()
}

import { formatUsd } from './pricingMoney.js'

/** reward_credits 字段存的是美分，展示为美元 */
export function formatReferralRewardUsd(cents = 0) {
  return formatUsd(Math.max(0, Number(cents || 0)) / 100)
}

export function buildReferralStatsCards(input = {}) {
  const totalReferrals = Number(input.totalReferrals || 0)
  const rewardedReferrals = Number(input.rewardedReferrals || 0)
  const rewardCredits = Number(input.rewardCredits || 0)
  const pendingCount = Number(input.pendingCount || 0)

  return [
    {
      id: 'total',
      label: '邀请用户',
      value: String(totalReferrals),
      hint: '成功注册绑定',
      tone: 'blue',
      icon: 'bi-people',
      animateValue: totalReferrals,
      animateFormat: 'integer',
      animateDelay: 0,
    },
    {
      id: 'rewarded',
      label: '已奖励',
      value: String(rewardedReferrals),
      hint: '完成付费结算',
      tone: 'green',
      icon: 'bi-gift',
      animateValue: rewardedReferrals,
      animateFormat: 'integer',
      animateDelay: 70,
    },
    {
      id: 'reward-usd',
      label: '累计奖励',
      value: formatReferralRewardUsd(rewardCredits),
      hint: '已到账金额',
      tone: 'amber',
      icon: 'bi-wallet2',
      animateValue: Math.max(0, rewardCredits) / 100,
      animateFormat: 'usd',
      animateDelay: 140,
    },
    {
      id: 'pending',
      label: '待奖励',
      value: String(pendingCount),
      hint: '等待好友首单',
      tone: 'cyan',
      icon: 'bi-hourglass-split',
      animateValue: pendingCount,
      animateFormat: 'integer',
      animateDelay: 210,
    },
  ]
}

export function buildReferralRewardSummary(config = {}) {
  const lines = []
  if (Number(config.rewardCredits || 0) > 0) {
    lines.push({
      id: 'fixed',
      icon: 'bi-coin',
      label: '固定奖励',
      value: `${formatReferralRewardUsd(config.rewardCredits)} / 单`,
      hint: '好友首笔符合条件的订单结算后发放至美元钱包',
    })
  }
  if (Number(config.rewardPercent || 0) > 0) {
    lines.push({
      id: 'percent',
      icon: 'bi-percent',
      label: '比例奖励',
      value: `${config.rewardPercent}% × 订单金额`,
      hint: '按好友订单金额比例发放至你的钱包',
    })
  }
  if (Number(config.minOrderCents || 0) > 0) {
    lines.push({
      id: 'minimum',
      icon: 'bi-receipt',
      label: '最低订单',
      value: formatUsd(Number(config.minOrderCents) / 100),
      hint: '低于此金额的订单不计入奖励',
    })
  }
  if (!lines.length) {
    lines.push({
      id: 'default',
      icon: 'bi-gift',
      label: '奖励规则',
      value: '管理员配置中',
      hint: '请联系管理员在后台设置推荐奖励参数',
    })
  }
  return lines
}

export function buildReferralSteps(config = {}) {
  const minOrder =
    Number(config.minOrderCents || 0) > 0
      ? `满 ${formatUsd(Number(config.minOrderCents) / 100)} 的订单`
      : '首笔充值或套餐订单'
  return [
    {
      title: '分享邀请链接',
      body: '复制你的专属链接，发给朋友或在社群发布。',
    },
    {
      title: '好友完成注册',
      body: '好友通过链接注册后，会自动绑定到你的推荐关系。',
    },
    {
      title: '好友完成付费',
      body: `当好友完成${minOrder}，系统会自动结算奖励。`,
    },
    {
      title: '到账',
      body: '奖励进入你的美元钱包，可在「钱包」页查看余额与流水。',
    },
  ]
}

export function referralRecordView(item = {}) {
  if (String(item.rewardStatus || '') === 'rewarded') {
    return { label: '已奖励', tone: 'success' }
  }
  if (String(item.status || '') === 'registered') {
    return { label: '已注册', tone: 'muted' }
  }
  return { label: '待奖励', tone: 'warn' }
}

export function maskReferralUserId(userId = '') {
  const text = String(userId || '').trim()
  if (!text) return '-'
  if (text.length <= 12) return text
  return `${text.slice(0, 8)}…${text.slice(-4)}`
}

export function formatReferralOrderHint(item = {}) {
  const orderId = String(item.rewardOrderId || '').trim()
  if (orderId) return orderId
  return '等待首笔符合条件的订单'
}
