import { useRef, useState } from "react";
import "./tabbar.css";

/**
 * App 同款悬浮底栏：深色胶囊，选中项下面有一块会滑动的浅色胶囊。
 * 和 App 一样支持按住后左右滑动挑选，松手才切换。
 */
export function TabBar({ tabs, activeIndex, onSelect }) {
  const trackRef = useRef(null);
  const gesture = useRef(null);
  const [preview, setPreview] = useState(-1);
  const shown = preview >= 0 ? preview : activeIndex;

  const indexAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const slot = rect.width / tabs.length;
    return Math.max(0, Math.min(tabs.length - 1, Math.floor((clientX - rect.left) / slot)));
  };

  const onPointerDown = (event) => {
    gesture.current = { x: event.clientX, index: indexAt(event.clientX), scrubbing: false };
  };

  const onPointerMove = (event) => {
    const state = gesture.current;
    if (!state) return;
    if (!state.scrubbing && Math.abs(event.clientX - state.x) < 8) return;
    if (!state.scrubbing) {
      state.scrubbing = true;
      trackRef.current.setPointerCapture?.(event.pointerId);
    }
    const index = indexAt(event.clientX);
    if (index !== state.index) {
      state.index = index;
      navigator.vibrate?.(6);
    }
    setPreview(index);
  };

  const finish = (event) => {
    const state = gesture.current;
    gesture.current = null;
    if (!state) return;
    setPreview(-1);
    if (event.type === "pointercancel") return;
    onSelect(state.scrubbing ? state.index : indexAt(event.clientX));
  };

  return (
    <nav className="m-tabbar" aria-label="主导航">
      <div
        ref={trackRef}
        className={`m-tabbar-track${preview >= 0 ? " is-scrubbing" : ""}`}
        style={{ "--m-tab-count": tabs.length, "--m-tab-index": shown }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <span className="m-tabbar-pill" aria-hidden="true" />
        {tabs.map((tab, index) => {
          const on = index === shown;
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              type="button"
              className={`m-tabbar-item${on ? " is-on" : ""}${tab.featured ? " is-featured" : ""}`}
              aria-current={index === activeIndex ? "page" : undefined}
              aria-label={tab.title}
              // 选择交给外层的 pointer 处理；这里只保留键盘可达。
              onClick={(event) => { if (event.detail === 0) onSelect(index); }}
            >
              <span className="m-tabbar-icon">
                {tab.featured ? <span className="m-tabbar-ai"><Icon size={23} /></span> : <Icon filled={on} size={24} />}
              </span>
              <span className="m-tabbar-label">{tab.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
