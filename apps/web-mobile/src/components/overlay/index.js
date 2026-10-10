// 手机站统一的弹层入口。调用方式与 antd-mobile 的 Toast / Dialog / ActionSheet 保持一致，
// 但实现换成纯 CSS 过渡 + 无触摸监听的锁滚动（见 usePresence.js / scrollLock.js）。
import { confirm, showActionSheet, toast } from "./overlayStore.js";

export { BottomSheet } from "./BottomSheet.jsx";
export { ImageViewer } from "./ImageViewer.jsx";
export { OverlayHost } from "./OverlayHost.jsx";

export const Toast = {
  show({ content, icon, duration } = {}) {
    return toast(content, { icon, duration: duration === 0 ? Infinity : duration });
  },
};

export const Dialog = {
  confirm: ({ title, content, confirmText, cancelText, danger }) => confirm({ title, content, confirmText, cancelText, danger }),
};

export const ActionSheet = {
  show: ({ actions, cancelText }) => showActionSheet({ actions, cancelText }),
};
