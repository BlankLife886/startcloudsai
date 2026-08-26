export interface TrialFeature {
  key: string
  label: string
  route: string
  taskTypes: string[]
  runtimeKey?: string
  icon?: string
}

export interface TrialCampaign {
  id: string
  title: string
  featureKeys: string[]
  features: TrialFeature[]
  accessMode: 'credit_only' | 'restricted'
  capacity: number
  displayOffset: number
  actualApplied: number
  displayApplied: number
  remaining: number
  status: 'draft' | 'active' | 'closed'
  enabled: boolean
  createdAt: string
  updatedAt: string
  activatedAt?: string | null
  closedAt?: string | null
  expiresAt: string
  remainingSeconds: number
  expired: boolean
}

export interface GrowthMilestone {
  units: number
  rewardCents: number
}

export interface AdminSettings {
  registrationEnabled?: boolean
  signupBonusCents?: number
  growthGroupEnabled?: boolean
  growthGroupCampaignKey?: string
  growthGroupTargetMembers?: number
  growthGroupRewardCents?: number
  growthGroupDurationHours?: number
  growthFailureBonusEnabled?: boolean
  growthFailureBonusCents?: number
  growthFailureBonusDailyLimit?: number
  growthUsageRewardsEnabled?: boolean
  growthUsageMilestones?: GrowthMilestone[]
  suggestionRewardMaxCents?: number
  checkinEnabled?: boolean
  checkinCampaignTitle?: string
  checkinRewards?: number[]
  userMaxRunningTasks?: number
  userMaxRunningImages?: number
  userMaxConcurrentTasks?: number
  globalMaxConcurrentTasks?: number
  globalMaxActiveTasks?: number
  globalMaxActiveImages?: number
  taskFailureRetryCount?: number
  taskRetryFirstDelaySecs?: number
  taskRetryBackoffSecs?: number
  crossProviderSameModelBalancingEnabled?: boolean
  adminImageAnalysisProviderId?: string
  adminImageAnalysisModelId?: string
  adminImageAnalysisReasoningEffort?: string
  workerConcurrencyCeiling?: number
  effectiveGlobalConcurrency?: number
  imageVariantFormat?: 'webp' | 'png'
  imageDisplayLossless?: boolean
  imageDisplayQuality?: number
  imageDisplayMaxEdge?: number
	imageThumbMaxEdge?: number
  imageFetchConcurrency?: number
  lanjingPayEnabled?: boolean
  lanjingPayBaseUrl?: string
  lanjingPaySecret?: string
  lanjingPayNotifyUrl?: string
  lanjingPayTimeoutSecs?: number
  lanjingPayAlipayEnabled?: boolean
  lanjingPayWechatEnabled?: boolean
}
