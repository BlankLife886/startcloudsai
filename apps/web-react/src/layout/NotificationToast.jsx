import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { displayNotification, notificationKind } from "../utils/notificationDisplay.js";
import "./NotificationToast.css";

const VISIBLE_MS = 6000;

/** 新通知到达时右上角弹出的提示卡片；悬停时暂停自动收起。 */
export function NotificationToast({ alert, isDark = false, onOpen, onClose }) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => {
    if (!alert || hovered) return undefined;
    timerRef.current = window.setTimeout(onClose, VISIBLE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [alert, hovered, onClose]);

  if (!alert || typeof document === "undefined") return null;
  const { item, count } = alert;
  const { title, body } = displayNotification(item);
  const kind = notificationKind(item);

  return createPortal(
    <div
      key={alert.key}
      className={`notify-toast${isDark ? " is-dark" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button type="button" className="notify-toast__main" onClick={() => onOpen(item)}>
        <span className={`notify-toast__icon is-${kind.tone}`} aria-hidden="true">
          <i className={`bi ${kind.icon}`} />
        </span>
        <span className="notify-toast__copy">
          <small>{count > 1 ? `${count} 条新通知` : `新通知 · ${kind.label}`}</small>
          <strong>{title}</strong>
          {body ? <p>{body}</p> : null}
        </span>
      </button>
      <button type="button" className="notify-toast__close" aria-label="关闭提醒" onClick={onClose}>
        <i className="bi bi-x-lg" aria-hidden="true" />
      </button>
      {!hovered ? <i className="notify-toast__timer" style={{ animationDuration: `${VISIBLE_MS}ms` }} /> : null}
    </div>,
    document.body,
  );
}
