import { useRef } from "react";
import { DialogMotion } from "./motion/DialogMotion.jsx";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.css";

export function ConfirmDialog({
  open,
  busy = false,
  heading = "确认删除？",
  description = "",
  confirmLabel = "确认删除",
  busyLabel = "删除中…",
  icon = "bi-trash3",
  tone = "danger",
  light = false,
  onClose,
  onConfirm,
}) {
  const cancelRef = useRef(null);
  return (
    <DialogMotion
      open={open}
      layerClassName={`delete-confirm__backdrop${light ? " is-light" : ""}`}
      panelClassName="delete-confirm__dialog"
      role="alertdialog"
      ariaLabelledby="delete-confirm-title"
      ariaDescribedby="delete-confirm-description"
      initialFocusRef={cancelRef}
      closeDisabled={busy}
      onClose={onClose}
    >
        <div className={`delete-confirm__icon is-${tone}`} aria-hidden="true" data-dialog-motion-item>
          <i className={`bi ${icon}`} />
        </div>
        <div className="delete-confirm__copy" data-dialog-motion-item>
          <h2 id="delete-confirm-title">{heading}</h2>
          <p id="delete-confirm-description">
            {description || "删除后将无法恢复"}
          </p>
        </div>
        <footer className="delete-confirm__actions" data-dialog-motion-item>
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
            className={`is-confirm is-${tone}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && (
              <i className="bi bi-arrow-repeat spin" aria-hidden="true" />
            )}
            {busy ? busyLabel : confirmLabel}
          </button>
        </footer>
    </DialogMotion>
  );
}
