import { useRef } from "react";
import { DialogMotion } from "./motion/DialogMotion.jsx";
import "./LogoutDialog.css";

export function LogoutDialog({
  open,
  busy = false,
  isDark = false,
  onClose,
  onConfirm,
}) {
  const cancelRef = useRef(null);
  return (
    <DialogMotion
      open={open}
      layerClassName={`logout-dialog-layer${isDark ? " is-dark" : ""}`}
      panelClassName="logout-dialog"
      role="alertdialog"
      ariaLabelledby="logout-dialog-title"
      ariaDescribedby="logout-dialog-description"
      initialFocusRef={cancelRef}
      closeDisabled={busy}
      onClose={onClose}
    >
      <button
        type="button"
        className="logout-dialog__close"
        aria-label="关闭"
        disabled={busy}
        onClick={onClose}
      >
        <i className="bi bi-x-lg" aria-hidden="true" />
      </button>
      <div className="logout-dialog__body" data-dialog-motion-item>
        <div className="logout-dialog__icon" aria-hidden="true">
          <i className="bi bi-box-arrow-right" />
        </div>
        <p className="logout-dialog__eyebrow">账号</p>
        <h2 id="logout-dialog-title">退出当前账号？</h2>
        <p id="logout-dialog-description">
          退出后需要重新登录才能继续查看个人资料和创作记录。
        </p>
      </div>
      <footer className="logout-dialog__actions" data-dialog-motion-item>
        <button
          ref={cancelRef}
          type="button"
          className="is-cancel"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className="is-confirm"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && (
            <i className="bi bi-arrow-repeat spin" aria-hidden="true" />
          )}
          {busy ? "正在退出…" : "确认退出"}
        </button>
      </footer>
    </DialogMotion>
  );
}
