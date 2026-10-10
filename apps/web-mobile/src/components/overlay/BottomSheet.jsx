import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "./usePresence.js";
import "./overlay.css";

const CLOSE_DISTANCE = 90;

/**
 * 底部弹层。进出场是纯 CSS 过渡；内容区原生滚动（overscroll-behavior: contain），
 * 只有顶部把手挂触摸监听用于下拉关闭。
 */
export function BottomSheet({ visible, onClose, title, children, footer, className = "", bodyClassName = "" }) {
  const { mounted, shown } = usePresence(visible);
  const startY = useRef(null);
  const [drag, setDrag] = useState(0);

  if (!mounted) return null;

  const onTouchStart = (event) => {
    startY.current = event.touches[0].clientY;
  };
  const onTouchMove = (event) => {
    if (startY.current == null) return;
    setDrag(Math.max(0, event.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (startY.current == null) return;
    startY.current = null;
    if (drag > CLOSE_DISTANCE) onClose?.();
    setDrag(0);
  };

  return createPortal(
    <div className={`m-ov${shown ? " is-shown" : ""}`}>
      <div className="m-ov-mask" onClick={onClose} />
      <section
        className={`m-bs ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        <header
          className="m-bs-head"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <span className="m-bs-grip" aria-hidden="true" />
          {title && <strong>{title}</strong>}
        </header>
        <div className={`m-bs-content ${bodyClassName}`}>{children}</div>
        {footer && <footer className="m-bs-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
