import { useEffect, useRef } from "react";

const ICONS = {
  success: "bi-check-lg",
  error: "bi-x-lg",
  warning: "bi-exclamation-lg",
  info: "bi-info-lg",
};

export function ToastNotification({ notification, onDismiss }) {
  const rootRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  const type = notification.type === "failure" ? "error" : notification.type || "info";
  const duration = Number(notification.duration) || 0;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (duration <= 0) return undefined;
    const node = rootRef.current;
    let remaining = duration;
    let startedAt = Date.now();
    let timer = window.setTimeout(() => onDismissRef.current(), remaining);

    const pause = () => {
      window.clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const resume = () => {
      startedAt = Date.now();
      timer = window.setTimeout(() => onDismissRef.current(), remaining);
    };

    node?.addEventListener("pointerenter", pause);
    node?.addEventListener("pointerleave", resume);
    return () => {
      window.clearTimeout(timer);
      node?.removeEventListener("pointerenter", pause);
      node?.removeEventListener("pointerleave", resume);
    };
  }, [duration, notification.id, notification.revision]);

  return (
    <div
      ref={rootRef}
      className={`app-toast is-${type}`}
      role={type === "error" || type === "warning" ? "alert" : "status"}
    >
      <span className="app-toast-icon" aria-hidden="true">
        <i className={`bi ${ICONS[type] || ICONS.info}`} />
      </span>
      <div className="app-toast-copy">
        {notification.title ? <strong>{notification.title}</strong> : null}
        <span>{notification.message}</span>
      </div>
      {notification.action?.label ? (
        <button
          type="button"
          className="app-toast-action"
          onClick={() => {
            notification.action.handler?.();
            onDismiss();
          }}
        >
          {notification.action.label}
        </button>
      ) : null}
      {notification.closable !== false && duration <= 0 ? (
        <button type="button" className="app-toast-close" aria-label="关闭提示" onClick={onDismiss}>
          <i className="bi bi-x" />
        </button>
      ) : null}
    </div>
  );
}
