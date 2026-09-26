import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import notificationService from "@react/legacy-modules/services/notification.js";
import { ToastNotification } from "./ToastNotification.jsx";
import "./ToastNotification.css";

const POSITIONS = [
  "top-center",
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
  "bottom-center",
];

export function NotificationContainer() {
  const [items, setItems] = useState([]);

  useEffect(() => notificationService.subscribe(setItems), []);

  const grouped = useMemo(() => {
    const next = Object.fromEntries(POSITIONS.map((position) => [position, []]));
    for (const item of items) {
      const position = POSITIONS.includes(item.position) ? item.position : "top-center";
      next[position].push(item);
    }
    return next;
  }, [items]);

  const dismiss = useCallback((id) => {
    notificationService.removeNotification(id);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="app-toast-root" aria-live="polite">
      {POSITIONS.map((position) =>
        grouped[position].length ? (
          <div key={position} className={`app-toast-stack is-${position}`}>
            {grouped[position].map((item) => (
              <ToastNotification key={item.id} notification={item} onDismiss={() => dismiss(item.id)} />
            ))}
          </div>
        ) : null,
      )}
    </div>,
    document.body,
  );
}
