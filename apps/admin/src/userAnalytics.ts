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
  calculatedAt: string
}
