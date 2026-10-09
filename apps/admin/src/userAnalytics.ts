export interface DistributionItem {
  key: string
  count: number
}

export interface RetentionCohort {
  week: string
  users: number
  day1Base: number
  day1: number
  day7Base: number
  day7: number
  day30Base: number
  day30: number
}

export interface DailyPoint {
  date: string
  newUsers: number
  activeUsers: number
  submittingUsers: number
  successfulUsers: number
  images?: number
  failedTasks?: number
  totalUsers?: number
  revenueCents?: number
  upstreamCostCents?: number
}

/** 近 30 天任务在北京时间 星期 × 小时 的分布；weekday 1=周一 … 7=周日，只含有任务的格子 */
export interface TaskSlot {
  weekday: number
  hour: number
  tasks: number
  users: number
}

export interface FeatureFunnel {
  feature: string
  opens: number
  visitors: number
  submissions: number
  submittingUsers: number
  succeeded: number
  successfulUsers: number
}

export interface AnalyticsComparison {
  newUsersPrev30: number
  activeUsers7: number
  activeUsersPrev7: number
  succeededRuns30: number
  failedRuns30: number
  payingUsers30: number
  revenueCents30: number
  grossProfitCents30: number
}

export interface ValueTierEconomics {
  tier: string
  users: number
  revenueCents: number
  upstreamCostCents: number
  grossProfitCents: number
}

export interface WatchUser {
  id: string
  email: string
  username: string
  lifecycle: string
  riskLevel: string
  valueTier: string
  primaryWorkspace: string
  tags: string[]
  tagReasons: Record<string, string>
  successfulRuns30: number
  failedRuns30: number
  successRateBps30: number
  revenueCents30: number
  grossProfitCents30: number
  lastActivityAt: string | null
}

export interface UserAnalyticsData {
  summary: {
    totalUsers: number
    profilesReady: number
    newUsers30: number
    activeUsers7: number
    activeUsers30: number
    atRiskUsers: number
    highValueUsers: number
    returnedUsers: number
    frequentFailures: number
  }
  distributions: {
    lifecycle: DistributionItem[]
    risk: DistributionItem[]
    value: DistributionItem[]
  }
  dailyTrend: DailyPoint[]
  taskHeatmap?: TaskSlot[]
  retention: RetentionCohort[]
  funnel: {
    trackingSince?: string | null
    features: FeatureFunnel[]
  }
  comparison?: AnalyticsComparison
  tags?: DistributionItem[]
  valueTiers?: ValueTierEconomics[]
  watchlist?: { risk: WatchUser[]; highValue: WatchUser[]; churn: WatchUser[] }
  calculatedAt: string
}
