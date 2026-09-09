// 全局通知（toast）store：只管数据与去重/上限策略。
// 展示、倒计时、悬停暂停由 NotificationContainer / ToastNotification 负责，
// 避免 service 与组件双计时器互相打架。
//
// 页面接入方式（全站统一，不要自建 toast）：
//   import notificationService from '@/services/notification'
//   notificationService.success('已保存')
//   notificationService.error('保存失败', { action: { label: '重试', handler: retry } })
//   notificationService.warning('参考图已达上限')
//   notificationService.failure('提交失败')

const notifications = []
const listeners = new Set()

let notificationId = 0

const POSITIONS = [
  'top-center',
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'bottom-center',
]

const TYPES = ['success', 'error', 'warning', 'info']

const defaultOptions = {
  duration: 3500,
  closable: true,
  position: 'top-center',
  dedupe: true,
  dedupeWindow: 8000,
  maxPerPosition: 3,
}

const typeDuration = {
  success: 3200,
  info: 3500,
  warning: 4200,
  error: 5200,
}

function normalizeType(type) {
  if (type === 'failure') return 'error'
  return TYPES.includes(type) ? type : 'info'
}

function snapshot() {
  return notifications.map((item) => ({ ...item }))
}

function emit() {
  const next = snapshot()
  listeners.forEach((listener) => listener(next))
}

function subscribe(listener) {
  listeners.add(listener)
  listener(snapshot())
  return () => listeners.delete(listener)
}

/**
 * 添加通知
 * @param {Object} options
 * @param {string} options.message  正文（必填）
 * @param {string} [options.title]  可选标题（加粗首行）
 * @param {string} [options.type]   error | failure | warning | info | success
 * @param {number} [options.duration] 毫秒；0 表示不自动关闭
 * @param {boolean} [options.closable]
 * @param {string} [options.position] top/bottom-left/center/right
 * @param {{label: string, handler: Function}} [options.action] 内联操作按钮（如“重试”）
 * @param {boolean} [options.dedupe] 相同内容在 dedupeWindow 内合并并重置倒计时
 * @returns {number} 通知ID
 */
function addNotification(options) {
  const type = normalizeType(options.type)
  const merged = { ...defaultOptions, ...options, type }
  if (options.duration === undefined && typeDuration[type]) {
    merged.duration = typeDuration[type]
  }
  if (!POSITIONS.includes(merged.position)) merged.position = 'top-center'

  const dedupeKey =
    merged.dedupeKey ||
    `${merged.type}|${merged.position}|${String(merged.title || '').trim()}|${String(merged.message || '').trim()}`

  if (merged.dedupe) {
    const now = Date.now()
    const exists = notifications.find((item) => item.dedupeKey === dedupeKey)
    if (exists && now - (exists.timestamp || 0) < merged.dedupeWindow) {
      exists.timestamp = now
      exists.revision = (exists.revision || 0) + 1
      emit()
      return exists.id
    }
  }

  const id = ++notificationId
  const notification = {
    ...merged,
    id,
    dedupeKey,
    revision: 0,
    timestamp: Date.now(),
  }

  const samePosition = notifications.filter((item) => item.position === notification.position)
  const maxPerPosition = Number.isFinite(merged.maxPerPosition) ? merged.maxPerPosition : 3
  while (samePosition.length >= maxPerPosition) {
    const oldest = samePosition.shift()
    if (!oldest) break
    const index = notifications.findIndex((item) => item.id === oldest.id)
    if (index !== -1) notifications.splice(index, 1)
  }

  notifications.push(notification)
  emit()
  return id
}

function removeNotification(id) {
  const index = notifications.findIndex((notification) => notification.id === id)
  if (index !== -1) {
    notifications.splice(index, 1)
    emit()
  }
}

function clearNotifications() {
  if (!notifications.length) return
  notifications.splice(0, notifications.length)
  emit()
}

function error(message, options = {}) {
  return addNotification({ message, type: 'error', ...options })
}

function warning(message, options = {}) {
  return addNotification({ message, type: 'warning', ...options })
}

function info(message, options = {}) {
  return addNotification({ message, type: 'info', ...options })
}

function success(message, options = {}) {
  return addNotification({ message, type: 'success', ...options })
}

export default {
  notifications,
  subscribe,
  addNotification,
  removeNotification,
  clearNotifications,
  error,
  failure: error,
  warning,
  info,
  success,
}
