import notificationService from "@react/legacy-modules/services/notification.js";

export { NotificationContainer } from "./NotificationContainer.jsx";
export { ToastNotification } from "./ToastNotification.jsx";

/** 轻量顶部提示：成功 / 失败 / 警告 / 信息。 */
export const toast = {
  success: (message, options) => notificationService.success(message, options),
  error: (message, options) => notificationService.error(message, options),
  failure: (message, options) => notificationService.error(message, options),
  warning: (message, options) => notificationService.warning(message, options),
  info: (message, options) => notificationService.info(message, options),
  dismiss: (id) => notificationService.removeNotification(id),
  clear: () => notificationService.clearNotifications(),
};
