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
