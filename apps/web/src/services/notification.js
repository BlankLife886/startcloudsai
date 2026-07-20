import { reactive } from 'vue'

// 通知队列
const notifications = reactive([])

// 通知ID计数器
let notificationId = 0

// 默认配置
const defaultOptions = {
  duration: 3500,
  closable: true,
  position: 'top-right',
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

/**
 * 添加通知
 * @param {Object} options 通知选项
 * @param {string} options.message 通知消息
 * @param {string} options.type 通知类型 (error, warning, info, success)
 * @param {number} options.duration 显示时间（毫秒），0表示不自动关闭
 * @param {boolean} options.closable 是否可关闭
 * @param {string} options.position 位置 (top-right, top-left, bottom-right, bottom-left, top-center, bottom-center)
 * @returns {number} 通知ID
 */
function addNotification(options) {
  const merged = {
    ...defaultOptions,
    ...options,
  }

  if (options.duration === undefined && typeDuration[merged.type]) {
    merged.duration = typeDuration[merged.type]
  }

  const dedupeKey =
    merged.dedupeKey ||
    `${merged.type || 'info'}|${merged.position || 'top-right'}|${String(merged.message || '').trim()}`

  if (merged.dedupe) {
    const now = Date.now()
    const exists = notifications.find((item) => item.dedupeKey === dedupeKey)
    if (exists && now - (exists.timestamp || 0) < merged.dedupeWindow) {
      exists.timestamp = now
      return exists.id
    }
  }

  const id = ++notificationId
  const notification = {
    id,
    ...merged,
    dedupeKey,
    timestamp: Date.now(),
  }

  const samePosition = notifications.filter((item) => item.position === notification.position)
  const maxPerPosition = Number.isFinite(merged.maxPerPosition) ? merged.maxPerPosition : 2
  while (samePosition.length >= maxPerPosition) {
    const oldest = samePosition.shift()
    if (!oldest) break
    removeNotification(oldest.id)
  }

  notifications.push(notification)

  // 如果设置了自动关闭，则设置定时器
  if (notification.duration > 0) {
    setTimeout(() => {
      removeNotification(id)
    }, notification.duration)
  }

  return id
}

/**
 * 移除通知
 * @param {number} id 通知ID
 */
function removeNotification(id) {
  const index = notifications.findIndex((notification) => notification.id === id)
  if (index !== -1) {
    notifications.splice(index, 1)
  }
}

/**
 * 清空所有通知
 */
function clearNotifications() {
  notifications.splice(0, notifications.length)
}

/**
 * 显示错误通知
 * @param {string} message 错误消息
 * @param {Object} options 其他选项
 * @returns {number} 通知ID
 */
function error(message, options = {}) {
  return addNotification({
    message,
    type: 'error',
    ...options,
  })
}

/**
 * 显示警告通知
 * @param {string} message 警告消息
 * @param {Object} options 其他选项
 * @returns {number} 通知ID
 */
function warning(message, options = {}) {
  return addNotification({
    message,
    type: 'warning',
    ...options,
  })
}

/**
 * 显示信息通知
 * @param {string} message 信息消息
 * @param {Object} options 其他选项
 * @returns {number} 通知ID
 */
function info(message, options = {}) {
  return addNotification({
    message,
    type: 'info',
    ...options,
  })
}

/**
 * 显示成功通知
 * @param {string} message 成功消息
 * @param {Object} options 其他选项
 * @returns {number} 通知ID
 */
function success(message, options = {}) {
  return addNotification({
    message,
    type: 'success',
    ...options,
  })
}

export default {
  notifications,
  addNotification,
  removeNotification,
  clearNotifications,
  error,
  warning,
  info,
  success,
}
