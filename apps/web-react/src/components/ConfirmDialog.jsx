import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "@legacy/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue?react-style";

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
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);
  if (!open) return null;
  return createPortal(
    <div
      className={`delete-confirm__backdrop${light ? " is-light" : ""}`}
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose?.()
      }
    >
      <section
        className="delete-confirm__dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-description"
      >
        <div className={`delete-confirm__icon is-${tone}`} aria-hidden="true">
          <i className={`bi ${icon}`} />
        </div>
        <div className="delete-confirm__copy">
          <h2 id="delete-confirm-title">{heading}</h2>
          <p id="delete-confirm-description">
            {description || "删除后将无法恢复"}
          </p>
        </div>
        <footer className="delete-confirm__actions">
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
      </section>
    </div>,
    document.body,
  );
}
