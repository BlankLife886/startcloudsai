/**
 * 系统设置的改动清单、危险操作识别与数值矛盾检查。
 * 输入均为 SettingsView 的 settingsSignature() 快照（同一组字段）。
 */

export type SettingsSnapshot = Record<string, unknown>

type SectionId =
  | 'payment'
  | 'image-ai'
  | 'account'
  | 'image-processing'
  | 'growth'
  | 'concurrency'
  | 'logging'
  | 'retry'

interface FieldMeta {
  label: string
  section: SectionId
  unit?: string
  /** 值为密钥：清单里只说明「已修改」，不显示明文 */
  secret?: boolean
}

const FIELDS: Record<string, FieldMeta> = {
  lanjingPayEnabled: { label: '蓝鲸支付', section: 'payment' },
  lanjingPayBaseUrl: { label: '支付接口地址', section: 'payment' },
  lanjingPaySecret: { label: '支付通讯密钥', section: 'payment', secret: true },
  lanjingPayNotifyUrl: { label: '支付异步回调', section: 'payment' },
  lanjingPayTimeoutSecs: { label: '支付请求超时', section: 'payment', unit: '秒' },
  lanjingPayAlipayEnabled: { label: '支付宝', section: 'payment' },
  lanjingPayWechatEnabled: { label: '微信支付', section: 'payment' },

  adminImageAnalysisProviderId: { label: '图片分析服务商', section: 'image-ai' },
  adminImageAnalysisModelId: { label: '图片理解模型', section: 'image-ai' },
  adminImageAnalysisReasoningEffort: { label: '图片分析推理强度', section: 'image-ai' },

  registrationEnabled: { label: '开放注册', section: 'account' },
  signupBonusPoints: { label: '注册赠送', section: 'account', unit: '积分' },

  growthFailureBonusEnabled: { label: '失败额外补偿', section: 'growth' },
  growthFailureBonusPoints: { label: '单次失败补偿', section: 'growth', unit: '积分' },
  growthFailureBonusDailyLimit: { label: '每日补偿次数', section: 'growth', unit: '次' },
  growthUsageRewardsEnabled: { label: '用量计划奖励', section: 'growth' },
  growthUsageMilestones: { label: '用量计划档位', section: 'growth' },
  suggestionRewardMaxPoints: { label: '建议采纳上限', section: 'growth', unit: '积分' },

  globalMaxConcurrentTasks: { label: '全站图片并发', section: 'concurrency', unit: '张' },
  userMaxConcurrentTasks: { label: '个人基础图片并发', section: 'concurrency', unit: '张' },
  canvasBatchMaxCount: { label: '画布批量生成上限', section: 'concurrency', unit: '个' },
  canvasProjectMaxCount: { label: '每用户画布项目数（基础）', section: 'concurrency', unit: '个' },
  canvasProjectMaxKb: { label: '单个画布项目大小上限', section: 'concurrency', unit: 'KB' },
  globalMaxConcurrentChats: { label: '全站对话并发', section: 'concurrency', unit: '次' },
  userMaxConcurrentChats: { label: '个人对话并发', section: 'concurrency', unit: '次' },
  globalMaxActiveTasks: { label: '全站待处理容量', section: 'concurrency' },
  globalMaxActiveImages: { label: '全站图片容量', section: 'concurrency' },
  userMaxRunningTasks: { label: '单用户待处理任务', section: 'concurrency' },
  userMaxRunningImages: { label: '单用户图片容量', section: 'concurrency' },
  t2iPromptMaxChars: { label: '文生图提示词字数', section: 'concurrency', unit: '字' },
  assistantMessageMaxChars: { label: 'AI 助手消息字数', section: 'concurrency', unit: '字' },
  studioHubPromptMaxChars: { label: '创作台描述字数', section: 'concurrency', unit: '字' },

  imageVariantFormat: { label: '压缩格式', section: 'image-processing' },
  imageDisplayLossless: { label: '展示图无损压缩', section: 'image-processing' },
  imageDisplayQuality: { label: '展示图质量', section: 'image-processing' },
  imageDisplayMaxEdge: { label: '展示图最长边', section: 'image-processing', unit: 'px' },
  imageThumbMaxEdge: { label: '缩略图最长边', section: 'image-processing', unit: 'px' },
  imageFetchConcurrency: { label: '图片下载并发', section: 'image-processing' },

  platformLoggingEnabled: { label: '平台日志', section: 'logging' },
  platformLogSecurityEnabled: { label: '安全日志', section: 'logging' },
  platformLogOperationsEnabled: { label: '运维日志', section: 'logging' },
  platformLogUserEnabled: { label: '用户日志', section: 'logging' },
  platformLogRetentionDays: { label: '日志保留', section: 'logging', unit: '天' },
  platformLogMaxMb: { label: '日志容量上限', section: 'logging', unit: 'MB' },
  auditLogRetentionDays: { label: '操作审计保留', section: 'logging', unit: '天' },

  taskFailureRetryCount: { label: '任务失败重试', section: 'retry', unit: '次' },
  taskRetryFirstDelaySecs: { label: '首次重试等待', section: 'retry', unit: '秒' },
  taskRetryBackoffSecs: { label: '后续重试间隔', section: 'retry', unit: '秒' },
  crossProviderSameModelBalancingEnabled: { label: '同名模型跨服务商泄压', section: 'retry' },
}

export const SECTION_LABELS: Record<SectionId, string> = {
  payment: '支付',
  'image-ai': 'AI 模型',
  account: '注册与用户画像',
  growth: '增长激励',
  concurrency: '图片与对话并发',
  'image-processing': '图片处理',
  logging: '运行日志',
  retry: '调度与重试',
}

/** 调低到原值一半以下视为大幅下调（仅对容量类字段） */
const CAPACITY_FIELDS = new Set([
  'globalMaxConcurrentTasks',
  'userMaxConcurrentTasks',
  'globalMaxConcurrentChats',
  'userMaxConcurrentChats',
  'globalMaxActiveTasks',
  'globalMaxActiveImages',
  'userMaxRunningTasks',
  'userMaxRunningImages',
])

/** 关闭后会立即影响前台或用户的开关，附带影响说明 */
const DANGEROUS_OFF: Record<string, string> = {
  registrationEnabled: '前台注册入口立即关闭，新用户无法注册',
  lanjingPayEnabled: '价格页立即停止收款，用户无法充值和订阅',
  lanjingPayAlipayEnabled: '用户无法再用支付宝付款',
  lanjingPayWechatEnabled: '用户无法再用微信付款',
  platformLoggingEnabled: '停止写入平台日志，排查问题时将缺少记录',
  growthUsageRewardsEnabled: '本月未达标的用户将不再获得用量奖励',
}

export interface SettingsChange {
  key: string
  label: string
  section: string
  from: string
  to: string
  /** 危险操作的影响说明；非危险为空 */
  danger?: string
}

function formatValue(key: string, value: unknown, meta: FieldMeta): string {
  if (meta.secret) return value ? '已设置' : '未设置'
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  if (key === 'growthUsageMilestones' && Array.isArray(value)) return `${value.length} 个档位`
  if (value === '' || value === null || value === undefined) return '未设置'
  if (typeof value === 'number') return `${value.toLocaleString('zh-CN')}${meta.unit ? ` ${meta.unit}` : ''}`
  return String(value)
}

export function describeChanges(saved: SettingsSnapshot, current: SettingsSnapshot): SettingsChange[] {
  const changes: SettingsChange[] = []
  for (const [key, meta] of Object.entries(FIELDS)) {
    const before = saved[key]
    const after = current[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    let danger: string | undefined
    if (before === true && after === false && DANGEROUS_OFF[key]) danger = DANGEROUS_OFF[key]
    if (CAPACITY_FIELDS.has(key) && typeof before === 'number' && typeof after === 'number' && after < before / 2) {
      danger = `下调超过一半，正在排队或新提交的任务可能被拒绝或等待更久`
    }
    if (key === 'taskFailureRetryCount' && Number(before) > 0 && after === 0) {
      danger = '临时上游错误将不再自动重试，任务会直接失败'
    }
    if (meta.secret) {
      changes.push({ key, label: meta.label, section: SECTION_LABELS[meta.section], from: '', to: '已更换', danger })
      continue
    }
    changes.push({
      key,
      label: meta.label,
      section: SECTION_LABELS[meta.section],
      from: formatValue(key, before, meta),
      to: formatValue(key, after, meta),
      danger,
    })
  }
  return changes
}

/**
 * 找出被清空的数字项。el-input-number 清空后值为 null，提交时后端把 null 当作「不修改」，
 * 会造成「提示已生效但实际没改」，所以保存前必须拦下。
 */
export function findEmptyNumberFields(saved: SettingsSnapshot, current: SettingsSnapshot): { label: string; section: SectionId }[] {
  const empty: { label: string; section: SectionId }[] = []
  for (const [key, meta] of Object.entries(FIELDS)) {
    const value = current[key]
    if (typeof saved[key] === 'number' && (value === null || value === undefined || !Number.isFinite(Number(value)))) {
      empty.push({ label: meta.label, section: meta.section })
    }
  }
  const milestones = current.growthUsageMilestones
  if (Array.isArray(milestones) && milestones.some((m) => m == null || m.units == null || m.rewardCents == null)) {
    empty.push({ label: '用量计划档位', section: 'growth' })
  }
  return empty
}

export interface SettingsWarning {
  section: SectionId
  text: string
}

/** 配置之间的明显矛盾；只提示不阻止保存 */
export function findWarnings(f: SettingsSnapshot): SettingsWarning[] {
  const n = (key: string) => Number(f[key]) || 0
  const warnings: SettingsWarning[] = []
  if (n('userMaxConcurrentTasks') > n('globalMaxConcurrentTasks')) {
    warnings.push({ section: 'concurrency', text: '个人基础图片并发大于全站图片并发，个人上限实际不会生效' })
  }
  if (n('userMaxConcurrentChats') > n('globalMaxConcurrentChats')) {
    warnings.push({ section: 'concurrency', text: '个人对话并发大于全站对话并发，个人上限实际不会生效' })
  }
  if (n('userMaxRunningTasks') > n('globalMaxActiveTasks')) {
    warnings.push({ section: 'concurrency', text: '单用户待处理任务大于全站待处理容量，一个用户就可能占满全站' })
  }
  if (n('userMaxRunningImages') > n('globalMaxActiveImages')) {
    warnings.push({ section: 'concurrency', text: '单用户图片容量大于全站图片容量，一个用户就可能占满全站' })
  }
  if (n('globalMaxActiveImages') < n('globalMaxConcurrentTasks')) {
    warnings.push({ section: 'concurrency', text: '全站图片容量小于全站图片并发，并发额度用不满' })
  }
  if (n('imageThumbMaxEdge') > n('imageDisplayMaxEdge')) {
    warnings.push({ section: 'image-processing', text: '缩略图最长边大于展示图最长边，缩略图会比展示图还大' })
  }
  if (n('taskFailureRetryCount') > 0 && n('taskRetryFirstDelaySecs') > n('taskRetryBackoffSecs') * 4) {
    warnings.push({ section: 'retry', text: '首次重试等待远长于后续间隔，第一次重试会明显更慢' })
  }
  if (f.growthFailureBonusEnabled && n('growthFailureBonusDailyLimit') === 0) {
    warnings.push({ section: 'growth', text: '失败补偿已开启，但每日补偿次数为 0，实际不会发放' })
  }
  if (f.growthFailureBonusEnabled && n('growthFailureBonusPoints') === 0) {
    warnings.push({ section: 'growth', text: '失败补偿已开启，但单次补偿为 0 积分，实际不会发放' })
  }
  if (f.platformLoggingEnabled && n('platformLogRetentionDays') > 30 && n('platformLogMaxMb') <= 64) {
    warnings.push({ section: 'logging', text: '日志保留天数较长但容量上限很小，旧日志会提前被容量上限删除' })
  }
  if (f.registrationEnabled === false && n('signupBonusPoints') > 0) {
    warnings.push({ section: 'account', text: '注册已关闭，注册赠送积分暂时不会发放' })
  }
  return warnings
}
