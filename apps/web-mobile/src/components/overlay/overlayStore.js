// 命令式弹层（操作菜单 / 确认框 / 轻提示）的数据源，由 <OverlayHost /> 渲染。
let state = { actionSheet: null, dialog: null, toast: null };
const listeners = new Set();
let seq = 0;
let toastTimer = 0;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function subscribeOverlays(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOverlays() {
  return state;
}

/** 底部操作菜单。actions: [{ key, text, danger, disabled, onClick }] */
export function showActionSheet({ actions, cancelText = "取消" }) {
  set({ actionSheet: { id: ++seq, actions, cancelText, visible: true } });
}

export function closeActionSheet() {
  if (state.actionSheet) set({ actionSheet: { ...state.actionSheet, visible: false } });
}

/** 确认框，返回 Promise<boolean>。 */
export function confirm({ title = "", content, confirmText = "确定", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    state.dialog?.resolve(false);
    set({ dialog: { id: ++seq, title, content, confirmText, cancelText, danger, resolve, visible: true } });
  });
}

export function settleDialog(result) {
  const dialog = state.dialog;
  if (!dialog?.visible) return;
  dialog.resolve(result);
  set({ dialog: { ...dialog, visible: false } });
}

/** 居中轻提示。icon: "success" | "fail" | "loading"；loading 默认不自动消失，返回 close。 */
export function toast(content, { icon = "", duration } = {}) {
  window.clearTimeout(toastTimer);
  const id = ++seq;
  set({ toast: { id, content, icon, visible: true } });
  const close = () => {
    if (state.toast?.id === id) set({ toast: { ...state.toast, visible: false } });
  };
  const wait = duration ?? (icon === "loading" ? Infinity : 2000);
  if (Number.isFinite(wait) && wait > 0) toastTimer = window.setTimeout(close, wait);
  return { close };
}
