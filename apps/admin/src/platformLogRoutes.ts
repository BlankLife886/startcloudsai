// 接口路由 → 中文名称。日志里的路由是 gin 模板（如 /api/v1/tasks/:id）。
// 先查精确名称（可按"方法 路径"区分），查不到时按"模块 · 动作"推断，保证所有接口都有可读名称。
// 服务端新增常用接口时在 exact 里补一行即可。

const exact: Record<string, string> = {
  // 开放 API（开发者）
  'POST /v1/images/generations': '开放 API · 图片生成',
  'POST /v1/images/edits': '开放 API · 图片编辑',
  'POST /v1/responses': '开放 API · 对话生成',
  'GET /v1/responses': '开放 API · 对话（WebSocket）',
  '/v1/models': '开放 API · 模型列表',
  '/v1/models/:model': '开放 API · 模型详情',
  'POST /api/open/v1/tasks': '开放 API · 提交任务',
  '/api/open/v1/tasks/:id': '开放 API · 查询任务',
  '/api/open/v1/tasks/quote': '开放 API · 任务报价',
  '/api/open/v1/uploads': '开放 API · 上传文件',
  '/api/open/v1/files/*key': '开放 API · 下载文件',
  '/api/open/v1/models': '开放 API · 模型列表',
  '/api/open/v1/usage': '开放 API · 用量查询',
  // 登录与认证
  '/api/v1/auth/email-verification-codes': '登录 · 发送邮箱验证码',
  'POST /api/v1/auth/session': '登录 · 验证码登录',
  'GET /api/v1/auth/session': '登录 · 当前会话',
  'DELETE /api/v1/auth/session': '登录 · 退出登录',
  '/api/v1/auth/providers': '登录 · 登录方式',
  'POST /api/v1/admin/auth/session': '后台 · 管理员登录',
  'GET /api/v1/admin/auth/session': '后台 · 管理员会话',
  'DELETE /api/v1/admin/auth/session': '后台 · 管理员退出',
  '/oauth/authorize': 'OAuth · 授权',
  '/oauth/token': 'OAuth · 获取令牌',
  '/oauth/register': 'OAuth · 注册应用',
  '/.well-known/oauth-authorization-server': 'OAuth · 服务发现',
  // 创作任务
  'GET /api/v1/tasks': '创作任务 · 历史列表',
  'POST /api/v1/tasks': '创作任务 · 提交生成',
  'GET /api/v1/tasks/:id': '创作任务 · 任务详情',
  'PATCH /api/v1/tasks/:id': '创作任务 · 修改任务',
  'DELETE /api/v1/tasks/:id': '创作任务 · 删除任务',
  '/api/v1/tasks/:id/events': '创作任务 · 进度推送',
  '/api/v1/tasks/quote': '创作任务 · 价格预估',
  '/api/v1/tasks/cancel-group': '创作任务 · 批量取消',
  '/api/v1/tasks/by-idempotency': '创作任务 · 按请求号查询',
  '/api/v1/tasks/:id/outputs/:index': '创作任务 · 删除单张结果',
  '/api/v1/me/tasks/events': '创作任务 · 实时推送',
  '/api/v1/uploads': '上传 · 上传图片',
  '/api/v1/files/*key': '文件 · 读取图片',
  '/internal/c2a/image-task-events': '内部 · 上游任务回调',
  // AI 助手
  'POST /api/v1/assistant/runs': 'AI 助手 · 发送消息',
  'GET /api/v1/assistant/runs': 'AI 助手 · 执行列表',
  'GET /api/v1/assistant/runs/:id': 'AI 助手 · 执行详情',
  'PATCH /api/v1/assistant/runs/:id': 'AI 助手 · 取消执行',
  '/api/v1/assistant/runs/:id/events': 'AI 助手 · 回复推送',
  '/api/v1/assistant/runs/:id/tool-claims': 'AI 助手 · 领取画布工具',
  '/api/v1/assistant/runs/:id/tool-results': 'AI 助手 · 回传工具结果',
  '/api/v1/assistant/runs/:id/trace': 'AI 助手 · 执行追踪',
  '/api/v1/assistant/config': 'AI 助手 · 配置',
  // 社区、提示词与内容
  'GET /api/v1/gallery/submissions': '社区 · 作品列表',
  'POST /api/v1/gallery/submissions': '社区 · 投稿',
  '/api/v1/gallery/submissions/:id/reports': '社区 · 举报作品',
  '/api/v1/gallery/categories': '社区 · 分类',
  'GET /api/v1/prompts': '提示词库 · 列表',
  '/api/v1/prompts/categories': '提示词库 · 分类',
  '/api/v1/prompts/:id/engagements': '提示词库 · 点赞收藏',
  '/api/v1/home-banners': '首页 · 轮播图',
  '/api/v1/announcements': '公告 · 列表',
  '/api/v1/announcements/events': '公告 · 实时推送',
  '/api/v1/changelog': '更新记录 · 列表',
  '/api/v1/changelog/latest': '更新记录 · 最新版本',
  '/api/v1/runtime-config': '系统 · 前端运行配置',
  '/api/v1/health': '系统 · 健康检查',
  // 钱包、订单与支付
  'GET /api/v1/orders': '订单 · 我的订单',
  'POST /api/v1/orders': '订单 · 创建订单',
  '/api/v1/orders/:id': '订单 · 订单详情',
  '/api/v1/orders/:id/close': '订单 · 关闭订单',
  '/api/v1/payments/lanjing/notify': '支付 · 蓝鲸支付回调',
  '/api/v1/plans': '套餐 · 列表',
  '/api/v1/pricing': '套餐 · 价格',
  '/api/v1/me/wallet': '钱包 · 余额',
  '/api/v1/me/wallet/entries': '钱包 · 账本明细',
  '/api/v1/me/wallet/summary': '钱包 · 账单汇总',
  '/api/v1/me/wallet/export': '钱包 · 导出账单',
  '/api/v1/me/wallet/redemptions': '钱包 · 兑换码充值',
  '/api/v1/me/overview': '个人中心 · 概览',
  '/api/v1/me/profile': '个人中心 · 修改资料',
}

const modules: Array<[string, string]> = [
  // 更长的前缀放前面，优先匹配
  ['/api/v1/admin/agent-quality', '后台 · Agent 质量'], ['/api/v1/admin/announcements', '后台 · 公告'],
  ['/api/v1/admin/audit-logs', '后台 · 操作审计'], ['/api/v1/admin/badge-counts', '后台 · 菜单角标'],
  ['/api/v1/admin/canvas-workflow-templates', '后台 · 画布模板'], ['/api/v1/admin/changelog', '后台 · 更新记录'],
  ['/api/v1/admin/ecommerce', '后台 · 电商素材'], ['/api/v1/admin/feedback', '后台 · 用户反馈'],
  ['/api/v1/admin/files', '后台 · 文件'], ['/api/v1/admin/gallery', '后台 · 社区管理'],
  ['/api/v1/admin/growth', '后台 · 好友拼团'], ['/api/v1/admin/home-banners', '后台 · 首页轮播'],
  ['/api/v1/admin/image-skills', '后台 · 技能库'], ['/api/v1/admin/model-config', '后台 · 模型配置'],
  ['/api/v1/admin/orders', '后台 · 订单'], ['/api/v1/admin/payment-reconciliations', '后台 · 支付对账'],
  ['/api/v1/admin/plan', '后台 · 套餐'], ['/api/v1/admin/platform-logs', '后台 · 运行日志'],
  ['/api/v1/admin/profitability', '后台 · 成本利润'], ['/api/v1/admin/prompt', '后台 · 提示词库'],
  ['/api/v1/admin/providers', '后台 · 服务商'], ['/api/v1/admin/redemption', '后台 · 兑换码'],
  ['/api/v1/admin/referral', '后台 · 邀请返利'], ['/api/v1/admin/security', '后台 · 安全中心'],
  ['/api/v1/admin/settings', '后台 · 系统设置'], ['/api/v1/admin/statistics', '后台 · 数据看板'],
  ['/api/v1/admin/subscription-changes', '后台 · 订阅变更'], ['/api/v1/admin/system', '后台 · 系统指标'],
  ['/api/v1/admin/tasks', '后台 · 任务与调度'], ['/api/v1/admin/trial', '后台 · 体验活动'],
  ['/api/v1/admin/user-analytics', '后台 · 用户分析'], ['/api/v1/admin/users', '后台 · 用户管理'],
  ['/api/v1/admin/wallet', '后台 · 账本'], ['/api/v1/admin', '后台'],
  ['/api/v1/me/api-keys', '开发者 · API Key'], ['/api/v1/me/api-models', '开发者 · 可用模型'],
  ['/api/v1/me/webhook', '开发者 · Webhook'], ['/api/v1/me/assets', '素材库'],
  ['/api/v1/me/asset-groups', '素材库 · 分组'], ['/api/v1/me/image-skills', '我的技能'],
  ['/api/v1/me/notifications', '消息通知'], ['/api/v1/me/subscription', '我的订阅'],
  ['/api/v1/me/sessions', '登录设备'], ['/api/v1/me/checkin', '每日签到'], ['/api/v1/me/growth', '好友拼团'],
  ['/api/v1/me/feedback', '意见反馈'], ['/api/v1/me/gallery', '我的投稿'], ['/api/v1/me/trial-access', '体验活动'],
  ['/api/v1/me/referrals', '邀请返利'], ['/api/v1/me/behavior-events', '行为统计'],
  ['/api/v1/me/data-export', '个人数据导出'], ['/api/v1/me/account', '账号注销'], ['/api/v1/me/blocked-users', '屏蔽用户'],
  ['/api/v1/me', '个人中心'],
  ['/api/v1/assistant', 'AI 助手'], ['/api/v1/canvas-projects', '无限画布'], ['/api/v1/canvas-workflow-templates', '画布模板'],
  ['/api/v1/commerce', 'AI 电商'], ['/api/v1/gallery', '社区'], ['/api/v1/prompts', '提示词库'],
  ['/api/v1/referral-attribution', '邀请归因'], ['/api/v1/trial-access-campaign', '体验活动'],
  ['/api/v1/tasks', '创作任务'], ['/api/v1/orders', '订单'], ['/api/open/v1', '开放 API'], ['/v1', '开放 API'],
]

const tailActions: Record<string, string> = {
  events: '实时推送', export: '导出', cancel: '取消', retry: '重试', restore: '恢复', permanent: '彻底删除',
  batch: '批量操作', rotate: '轮换密钥', refund: '退款', 'refund-preview': '退款预览', close: '关闭',
  draft: '保存草稿', feedback: '评价', block: '屏蔽', reports: '举报', timeline: '时间线', position: '位置',
  order: '排序', analyze: '分析', image: '图片', trace: '追踪', resolve: '处理', revoke: '解除', run: '执行',
  cover: '封面', tests: '连通测试', discoveries: '发现模型', 'eval-runs': '运行评测', 'eval-cases': '评测用例',
  unfreeze: '解冻', adjust: '调整', grants: '发放记录', versions: '版本', publish: '发布', reorder: '排序', sync: '同步',
}

// 实际请求路径（审计日志保存的是真实 URL）里的 UUID、数字、长十六进制段替换成参数占位，便于按模板匹配。
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{24,})$/i

export function routeTemplate(path: string) {
  return path.split('/').map(segment => ID_SEGMENT.test(segment) ? ':id' : segment).join('/')
}

// 路由模板里的参数名（:id、:runId、:taskId…）统一成 :id，精确名称表只需按 :id 书写。
const normalizeParams = (path: string) => path.replace(/\/:[^/]+/g, '/:id')
const exactByNormalized = new Map(Object.entries(exact).map(([key, label]) => {
  const space = key.indexOf(' ')
  const normalized = space > 0 && !key.startsWith('/') ? `${key.slice(0, space)} ${normalizeParams(key.slice(space + 1))}` : normalizeParams(key)
  return [normalized, label]
}))

function actionFor(route: string, method: string) {
  const parts = route.split('/').filter(Boolean)
  const last = parts[parts.length - 1] || ''
  if (tailActions[last]) return tailActions[last]
  const byId = last.startsWith(':') || last.startsWith('*')
  switch (method.toUpperCase()) {
    case 'GET': return byId ? '详情' : '查询'
    case 'POST': return '提交'
    case 'PUT':
    case 'PATCH': return '修改'
    case 'DELETE': return '删除'
    default: return ''
  }
}

/** 返回接口的中文名称；method 缺省时只按路径匹配。未知路由返回空字符串。 */
export function routeLabel(route?: string | null, method?: string | null) {
  const path = normalizeParams(routeTemplate(String(route || '').split('?')[0].trim()))
  if (!path) return ''
  const verb = String(method || '').toUpperCase()
  const known = (verb && exactByNormalized.get(`${verb} ${path}`)) || exactByNormalized.get(path)
  if (known) return known
  // 没有请求方法时（如最慢接口排行按路径汇总），合并该路径各方法的名称，例如"社区 · 作品列表 / 投稿"。
  if (!verb) {
    const labels = [...exactByNormalized].filter(([key]) => key.endsWith(` ${path}`)).map(([, label]) => label)
    if (labels.length === 1) return labels[0]
    if (labels.length > 1) {
      const [head] = labels[0].split(' · ')
      const actions = [...new Set(labels.map(label => label.split(' · ').slice(1).join(' · ')))]
      return labels.every(label => label.startsWith(`${head} · `)) ? `${head} · ${actions.join(' / ')}` : labels.join(' / ')
    }
  }
  const module = modules.find(([prefix]) => path.startsWith(prefix))
  if (!module) return ''
  const action = verb ? actionFor(path, verb) : ''
  return action ? `${module[1]} · ${action}` : module[1]
}
