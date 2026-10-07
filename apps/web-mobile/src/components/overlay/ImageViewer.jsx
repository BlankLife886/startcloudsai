import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseOutline } from "antd-mobile-icons";
import { usePresence } from "./usePresence.js";
import "./overlay.css";

const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 260;

function distance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * 单张图的缩放：双指捏合、双击放大/还原、放大后单指拖动。直接改图片的 transform，
 * 不经过 React 状态，手势每一帧都不触发重渲染。缩放时通过 onZoomChange 锁住左右翻页。
 */
function ZoomableImage({ src, alt, active, onZoomChange, onTap }) {
  const imgRef = useRef(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef(null);
  const lastTap = useRef(0);
  const tapTimer = useRef(0);

  const apply = (animate) => {
    const node = imgRef.current;
    if (!node) return;
    const { scale, x, y } = view.current;
    node.style.transition = animate ? "transform 220ms ease" : "none";
    node.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  };

  const reset = (animate = true) => {
    view.current = { scale: 1, x: 0, y: 0 };
    apply(animate);
    onZoomChange(false);
  };

  useEffect(() => {
    if (!active) reset(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onTouchStart = (event) => {
    if (event.touches.length === 2) {
      gesture.current = { type: "pinch", start: distance(event.touches), scale: view.current.scale };
      onZoomChange(true);
    } else if (event.touches.length === 1 && view.current.scale > 1) {
      const touch = event.touches[0];
      gesture.current = { type: "pan", x: touch.clientX - view.current.x, y: touch.clientY - view.current.y };
    } else {
      gesture.current = { type: "tap", x: event.touches[0].clientX, y: event.touches[0].clientY, moved: false };
    }
  };

  const onTouchMove = (event) => {
    const current = gesture.current;
    if (!current) return;
    if (current.type === "pinch" && event.touches.length === 2) {
      const scale = Math.min(MAX_SCALE, Math.max(0.8, current.scale * (distance(event.touches) / current.start)));
      view.current = { ...view.current, scale };
      apply(false);
    } else if (current.type === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      view.current = { ...view.current, x: touch.clientX - current.x, y: touch.clientY - current.y };
      apply(false);
    } else if (current.type === "tap") {
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - current.x) + Math.abs(touch.clientY - current.y) > 10) current.moved = true;
    }
  };

  const onTouchEnd = (event) => {
    const current = gesture.current;
    if (!current || event.touches.length) return;
    gesture.current = null;
    if (current.type === "pinch") {
      if (view.current.scale <= 1.05) reset();
      return;
    }
    if (current.type !== "tap" || current.moved) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (view.current.scale > 1) reset();
      else {
        view.current = { scale: 2.5, x: 0, y: 0 };
        apply(true);
        onZoomChange(true);
      }
      return;
    }
    lastTap.current = now;
    // 单击关闭要等一下，确认不是双击。
    tapTimer.current = window.setTimeout(() => {
      if (view.current.scale <= 1) onTap();
    }, DOUBLE_TAP_MS);
  };

  return (
    <div className="m-iv-slide" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <img ref={imgRef} src={src} alt={alt} draggable={false} decoding="async" />
    </div>
  );
}

/** 全屏看图：左右滑动用原生 scroll-snap（滚动由浏览器合成，顺滑不掉帧），支持缩放。 */
export function ImageViewer({ images, index = 0, visible, onClose, onIndexChange, renderFooter }) {
  const { mounted, shown } = usePresence(visible);
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);

  useLayoutEffect(() => {
    if (!mounted || !visible) return;
    const track = trackRef.current;
    if (track) track.scrollLeft = index * track.clientWidth;
    setCurrent(index);
    // 只在打开时定位到点开的那张
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, visible]);

  if (!mounted) return null;

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    if (next !== current) {
      setCurrent(next);
      onIndexChange?.(next);
    }
  };

  return createPortal(
    <div className={`m-ov m-iv${shown ? " is-shown" : ""}`}>
      <div className="m-iv-bg" />
      <header className="m-iv-head">
        <button type="button" className="m-iv-close" aria-label="关闭" onClick={onClose}><CloseOutline /></button>
        {images.length > 1 && <span>{current + 1} / {images.length}</span>}
      </header>
      <div ref={trackRef} className={`m-iv-track${zoomed ? " is-zoomed" : ""}`} onScroll={onScroll}>
        {images.map((src, slide) => (
          <ZoomableImage
            key={`${slide}-${src}`}
            src={src}
            alt={`第 ${slide + 1} 张`}
            active={slide === current}
            onZoomChange={setZoomed}
            onTap={onClose}
          />
        ))}
      </div>
      {renderFooter && <footer className="m-iv-foot">{renderFooter(current)}</footer>}
    </div>,
    document.body,
  );
}
