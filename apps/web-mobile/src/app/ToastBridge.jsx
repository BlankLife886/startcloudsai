import { useEffect, useRef } from "react";
import { Toast } from "@mobile/components/overlay/index.js";
import notificationService from "@react/legacy-modules/services/notification.js";

const ICONS = { success: "success", error: "fail" };

// 共享业务层通过 notificationService 发提示；手机端统一转成居中的轻提示。
export function ToastBridge() {
  const shown = useRef(new Set());
  useEffect(() => notificationService.subscribe((items) => {
    items.forEach((item) => {
      if (shown.current.has(item.id)) return;
      shown.current.add(item.id);
      Toast.show({ content: item.message || item.title, icon: ICONS[item.type], duration: 2200 });
      notificationService.removeNotification(item.id);
    });
  }), []);
  return null;
}
