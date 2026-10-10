// 平台日志事件代码 → 中文名称与说明。事件代码来自服务端：
//   任务时间线 task.<阶段>（worker/timeline.go）、AI 助手 assistant.*（worker/assistant.go）、
//   接口请求 operations.* / security.* / user.*（httpapi/platform_logging.go）。
// 未收录的代码原样显示，服务端新增事件时在这里补充即可。
type EventInfo = { label: string; hint: string }

const events: Record<string, EventInfo> = {
  'task.queued': { label: '任务排队', hint: '任务已创建，等待 Worker 领取' },
  'task.running': { label: '任务开始执行', hint: 'Worker 已领取任务' },
  'task.input_prepare': { label: '准备输入', hint: '整理提示词与参考图' },
  'task.submitted': { label: '已提交上游', hint: '请求已发给模型服务商' },
  'task.upstream_generate': { label: '上游生成中', hint: '模型服务商正在生成' },
  'task.upstream_generating': { label: '上游生成中', hint: '模型服务商正在生成' },
  'task.upstream_pending': { label: '等待上游结果', hint: '异步任务，等待服务商回调或轮询' },
  'task.upstream_error': { label: '上游返回错误', hint: '模型服务商接口报错，任务会按策略重试或失败' },
  'task.upstream_unreachable': { label: '上游无法连接', hint: '连不上模型服务商，检查线路或网络' },
  'task.upstream_submission_uncertain': { label: '上游提交结果不明', hint: '提交请求没有明确响应，系统会核实避免重复扣费' },
  'task.upstream_attempts_exhausted': { label: '重试次数用尽', hint: '所有重试都失败，任务将标记失败' },
  'task.retry': { label: '任务重试', hint: '上一次尝试失败，正在重新执行' },
  'task.result_download': { label: '取回结果', hint: '从服务商下载生成结果' },
  'task.image_persist': { label: '保存图片', hint: '把结果写入对象存储' },
  'task.succeeded': { label: '任务成功', hint: '' },
  'task.failed': { label: '任务失败', hint: '查看失败原因与上游错误码' },
  'task.canceled': { label: '任务取消', hint: '' },
  'assistant.started': { label: 'AI 助手开始执行', hint: '' },
  'assistant.succeeded': { label: 'AI 助手完成', hint: '' },
  'assistant.failed': { label: 'AI 助手执行失败', hint: '查看失败原因与所用线路' },
  'assistant.canceled': { label: 'AI 助手已取消', hint: '' },
  'assistant.route_requeued': { label: 'AI 助手切换线路重试', hint: '当前线路失败，改用其他线路' },
  'assistant.routes_exhausted': { label: 'AI 助手线路耗尽', hint: '所有可用线路都失败，检查模型配置' },
  'operations.request_failed': { label: '接口请求失败', hint: '接口返回 5xx 服务器错误' },
  'operations.slow_request': { label: '接口响应慢', hint: '单次请求超过 2 秒' },
  'operations.admin_action': { label: '管理员操作', hint: '后台写操作' },
  'operations.internal_callback': { label: '内部回调', hint: '服务商或内部服务的回调请求' },
  'security.authentication_failed': { label: '登录失败', hint: '验证码或凭据错误，频繁出现可能是暴力尝试' },
  'security.authentication_succeeded': { label: '登录成功', hint: '' },
  'security.access_denied': { label: '访问被拒绝', hint: '无权限或未登录访问受保护接口' },
  'security.rate_limited': { label: '触发限流', hint: '请求过于频繁，已被临时拦截' },
  'security.logout': { label: '退出登录', hint: '' },
  'security.test': { label: '安全日志测试', hint: '后台发出的测试事件' },
  'user.action': { label: '用户操作', hint: '用户创建、修改或删除数据' },
}

export function eventLabel(code: string) {
  return events[code]?.label || code
}

export function eventHint(code: string) {
  return events[code]?.hint || ''
}
