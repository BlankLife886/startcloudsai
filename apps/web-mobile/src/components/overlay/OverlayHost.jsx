import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DotLoading } from "antd-mobile";
import { CheckOutline, CloseOutline } from "antd-mobile-icons";
import { closeActionSheet, getOverlays, settleDialog, subscribeOverlays } from "./overlayStore.js";
import { usePresence } from "./usePresence.js";
import "./overlay.css";

function useOverlays() {
  return useSyncExternalStore(subscribeOverlays, getOverlays);
}

// 关闭动画期间仍要显示上一次的内容，visible 只控制进出场。
function useLatest(value) {
  const [latest, setLatest] = useState(value);
  useEffect(() => {
    if (value) setLatest(value);
  }, [value]);
  return value || latest;
}

function ActionSheetView({ sheet }) {
  const current = useLatest(sheet);
  const { mounted, shown } = usePresence(Boolean(sheet?.visible));
  if (!mounted || !current) return null;
  const run = (action) => {
    if (action.disabled) return;
    closeActionSheet();
    // 等菜单开始收起再执行，避免和接下来弹出的确认框/提示抢同一帧。
    window.setTimeout(() => action.onClick?.(), 60);
  };
  return createPortal(
    <div className={`m-ov${shown ? " is-shown" : ""}`}>
      <div className="m-ov-mask" onClick={closeActionSheet} />
      <section className="m-as" role="menu">
        <div className="m-as-group">
          {current.actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className={`m-as-item${action.danger ? " is-danger" : ""}`}
              disabled={action.disabled}
              onClick={() => run(action)}
            >
              {action.text}
            </button>
          ))}
        </div>
        <button type="button" className="m-as-item m-as-cancel" onClick={closeActionSheet}>{current.cancelText}</button>
      </section>
    </div>,
    document.body,
  );
}

function DialogView({ dialog }) {
  const current = useLatest(dialog);
  const { mounted, shown } = usePresence(Boolean(dialog?.visible));
  if (!mounted || !current) return null;
  return createPortal(
    <div className={`m-ov m-ov-center${shown ? " is-shown" : ""}`}>
      <div className="m-ov-mask" onClick={() => settleDialog(false)} />
      <section className="m-dialog" role="alertdialog" aria-modal="true">
        <div className="m-dialog-body">
          {current.title && <strong className="m-dialog-title">{current.title}</strong>}
          {current.content && <div className="m-dialog-content">{current.content}</div>}
        </div>
        <footer className="m-dialog-actions">
          <button type="button" onClick={() => settleDialog(false)}>{current.cancelText}</button>
          <button type="button" className={current.danger ? "is-danger" : "is-primary"} onClick={() => settleDialog(true)}>
            {current.confirmText}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const TOAST_ICONS = {
  success: <CheckOutline />,
  fail: <CloseOutline />,
  loading: <DotLoading color="white" />,
};

function ToastView({ toast }) {
  const current = useLatest(toast);
  const { mounted, shown } = usePresence(Boolean(toast?.visible), { lock: false });
  if (!mounted || !current) return null;
  return createPortal(
    <div className={`m-toast${shown ? " is-shown" : ""}${current.icon ? " has-icon" : ""}`} role="status" aria-live="polite">
      {current.icon && <span className="m-toast-icon">{TOAST_ICONS[current.icon]}</span>}
      <span>{current.content}</span>
    </div>,
    document.body,
  );
}

/** 挂在应用根部，渲染命令式弹层。 */
export function OverlayHost() {
  const { actionSheet, dialog, toast } = useOverlays();
  return (
    <>
      <ActionSheetView sheet={actionSheet} />
      <DialogView dialog={dialog} />
      <ToastView toast={toast} />
    </>
  );
}
