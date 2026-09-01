export interface UserProfileMetrics {
  lifecycle: string
  riskLevel: string
  valueTier: string
  primaryWorkspace: string
  lastActivityAt?: string | null
  lastSuccessAt?: string | null
  activeDays7: number
  activeDays30: number
  lifetimeSuccessfulRuns: number
  successfulRuns30: number
  failedRuns30: number
  canceledRuns30: number
  successfulUnits30: number
  successRateBps30: number
  averageDurationMs30: number
  p95DurationMs30: number
  featureDiversity30: number
  revenueCents30: number
  upstreamCostCents30: number
  grossProfitCents30: number
  assetCount: number
  canvasProjectCount: number
  submissionCount: number
  activeApiKeyCount: number
  tags: string[]
  tagReasons: Record<string, string>
  ruleVersion: number
  calculatedAt: string
}

export interface UserProfileBreakdown {
  key: string
  label: string
  runs: number
  succeeded: number
  failed: number
  successfulUnits: number
}

export interface UserProfileFailure {
  code: string
  message: string
  count: number
}

export interface UserProfileDailyPoint {
  date: string
  succeeded: number
  failed: number
  revenueCents: number
  upstreamCostCents: number
  grossProfitCents: number
}

export interface UserBehaviorFunnelFeature {
  feature: string
  opens: number
  submissions: number
  succeeded: number
  failed: number
  canceled: number
}

export interface UserBehaviorFunnel {
  days: number
  trackingSince?: string | null
  opens: number
  submissions: number
  succeeded: number
  failed: number
  canceled: number
  referenceUploadsStarted: number
  referenceUploadsCompleted: number
  referenceUploadsFailed: number
  formStarts: number
  formAbandons: number
  promptTemplatesUsed: number
  submitRateBps: number
  successRateBps: number
  features: UserBehaviorFunnelFeature[]
}

export interface UserProfileHistoryItem {
  lifecycle: string
  riskLevel: string
  valueTier: string
  primaryWorkspace: string
  activeDays30: number
  successfulRuns30: number
  failedRuns30: number
  successRateBps30: number
  revenueCents30: number
  grossProfitCents30: number
  tags: string[]
  calculatedAt: string
}

export interface UserProfileDetail {
  metrics: UserProfileMetrics
  workspaces: UserProfileBreakdown[]
  models: UserProfileBreakdown[]
  failures: UserProfileFailure[]
  dailyTrend: UserProfileDailyPoint[]
  funnel: UserBehaviorFunnel
  history: UserProfileHistoryItem[]
}

export const lifecycleLabels: Record<string, string> = {
  new: '新用户',
  activated: '已激活',
  active: '活跃',
  dormant: '沉默',
  churn_risk: '流失风险',
  returned: '已回流',
}

export const workspaceLabels: Record<string, string> = {
  assistant: 'AI 助手',
  canvas: '无限画布',
  ecommerce: 'AI 电商',
  t2i: '图片创作',
  text_to_image: '图片创作',
  coloring: '线稿上色',
  ui_design: 'UI 设计',
  model_sheet: '角色设定',
  game_art: '游戏美术',
  background_remove: '背景移除',
  media_tool: '图片工具',
  media_tools: '图片工具',
  design_workshop: '设计工坊',
  assets: '素材库',
  history: '历史记录',
  prompt_library: '提示词库',
  other: '其他功能',
}

export const profileTagLabels: Record<string, string> = {
  high_value: '高价值',
  power_user: '深度用户',
  canvas_power_user: '画布深度用户',
  frequent_failure: '高频失败',
  api_user: 'API 用户',
  loss_making: '当前亏损',
  churn_risk: '流失风险',
}

export function formatProfileMoney(cents: number | null | undefined) {
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`
}

export function formatDurationMs(ms: number | null | undefined) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
