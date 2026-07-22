/** 金额与展示工具：后端一律整数「分」，界面一律「元」 */

/** 分 → 元字符串（两位小数），空值显示 - */
export function fenToYuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '-'
  return (cents / 100).toFixed(2)
}

/** 分 → 元数值（表单回填用） */
export function fenToYuanNumber(cents: number | null | undefined): number {
  return (cents ?? 0) / 100
}

/** 元 → 分（四舍五入避免浮点误差） */
export function yuanToFen(yuan: number | null | undefined): number {
  return Math.round((yuan ?? 0) * 100)
}

/** UTC ISO8601 → 本地时间展示 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function shortId(id: string | null | undefined): string {
  if (!id) return '-'
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/** 任务类型 */
export const TASK_TYPES = ['t2i', 'coloring', 'ui_design', 'model_sheet', 'game_art', 'puzzle'] as const

export const TASK_TYPE_LABELS: Record<string, string> = {
  t2i: '文生图',
  coloring: '插画染色',
  ui_design: 'UI设计稿',
  model_sheet: '超高清模型图',
  game_art: '游戏设计',
  puzzle: 'AI拼图',
}

export function taskTypeLabel(type: string): string {
  return TASK_TYPE_LABELS[type] ?? type
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '成功',
  failed: '失败',
  canceled: '已取消',
}

export const TASK_STATUS_TAG: Record<string, 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
  queued: 'info',
  running: 'primary',
  succeeded: 'success',
  failed: 'danger',
  canceled: 'warning',
}

/** 账本 kind → 中文（契约未穷举，未知 kind 原样展示） */
export const LEDGER_KIND_LABELS: Record<string, string> = {
  admin_adjust: '人工调整',
  order_grant: '充值入账',
  grant: '入账',
  signup_bonus: '注册赠送',
  task_spend: '任务消耗',
  spend: '消耗',
  task_refund: '任务退款',
  refund: '退款',
}

export function ledgerKindLabel(kind: string): string {
  return LEDGER_KIND_LABELS[kind] ?? kind
}

export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  removed: '已下架',
}

export const SUBMISSION_STATUS_TAG: Record<string, 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  removed: 'info',
}
