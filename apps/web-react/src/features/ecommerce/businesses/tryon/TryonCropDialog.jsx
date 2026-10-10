import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../../../i18n/index.js";

const MIN_SIZE = 0.08;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// 在图片上拖出一个框，只保留框内人物；rect 用 0-1 的相对坐标回传
export function TryonCropDialog({ src, title = "裁剪模特", onCancel, onConfirm }) {
  const { t } = useLocale();
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [rect, setRect] = useState({ x: 0, y: 0, w: 1, h: 1 });

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function pointFromEvent(event) {
    const box = stageRef.current.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width, 0, 1),
      y: clamp((event.clientY - box.top) / box.height, 0, 1),
    };
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const inside =
      point.x > rect.x &&
      point.x < rect.x + rect.w &&
      point.y > rect.y &&
      point.y < rect.y + rect.h &&
      (rect.w < 1 || rect.h < 1);
    dragRef.current = inside
      ? { kind: "move", start: point, origin: rect }
      : { kind: "draw", start: point };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);
    if (drag.kind === "move") {
      const { origin } = drag;
      setRect({
        ...origin,
        x: clamp(origin.x + point.x - drag.start.x, 0, 1 - origin.w),
        y: clamp(origin.y + point.y - drag.start.y, 0, 1 - origin.h),
      });
      return;
    }
    setRect(normalizeRect(drag.start, point));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === "draw" && (rect.w < MIN_SIZE || rect.h < MIN_SIZE)) {
      setRect({ x: 0, y: 0, w: 1, h: 1 });
    }
  }

  const full = rect.w >= 0.999 && rect.h >= 0.999;

  return createPortal(
    <div className="tryon-crop" role="dialog" aria-modal="true" aria-label={t(title)}>
      <button
        type="button"
        className="tryon-crop__scrim"
        aria-label={t("取消裁剪")}
        onClick={onCancel}
      />
      <section className="tryon-crop__panel">
        <header className="tryon-crop__head">
          <strong>{t(title)}</strong>
          <small>{t("在图上拖出人物区域，框内可拖动调整位置")}</small>
        </header>
        <div className="tryon-crop__canvas">
          <div
            ref={stageRef}
            className="tryon-crop__stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img src={src} alt="" draggable={false} />
            {!full ? (
              <span
                className="tryon-crop__box"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              />
            ) : null}
          </div>
        </div>
        <footer className="tryon-crop__foot">
          <button
            type="button"
            className="tryon-crop__ghost"
            disabled={full}
            onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}
          >
            {t("重置")}
          </button>
          <span />
          <button type="button" className="tryon-crop__ghost" onClick={onCancel}>
            {t("取消")}
          </button>
          <button
            type="button"
            className="tryon-crop__primary"
            disabled={full}
            onClick={() => onConfirm?.(rect)}
          >
            {t("使用裁剪")}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
