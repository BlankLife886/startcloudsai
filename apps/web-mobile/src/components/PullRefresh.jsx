import { useEffect, useRef, useState } from "react";
import { DotLoading } from "antd-mobile";
import "./pull-refresh.css";

const THRESHOLD = 64;
const MAX_PULL = 110;

/**
 * 轻量下拉刷新。只挂 passive 触摸监听，不阻止原生滚动（antd-mobile 的实现会在每次滑动时
 * 同步拦截触摸事件，手机上滚动明显卡顿）；仅在页面已滚到顶部且手指向下拉时才生效。
 */
export function PullRefresh({ onRefresh, children }) {
  const rootRef = useRef(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const state = useRef({ startY: 0, active: false, pull: 0, refreshing: false });
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onStart = (event) => {
      if (state.current.refreshing || window.scrollY > 0) return;
      state.current.startY = event.touches[0].clientY;
      state.current.active = true;
    };
    const onMove = (event) => {
      if (!state.current.active) return;
      const delta = event.touches[0].clientY - state.current.startY;
      if (delta <= 0 || window.scrollY > 0) {
        if (state.current.pull) setPull((state.current.pull = 0));
        return;
      }
      // 阻尼：越往下拉越费劲
      const next = Math.min(MAX_PULL, delta * 0.45);
      state.current.pull = next;
      setPull(next);
    };
    const onEnd = async () => {
      if (!state.current.active) return;
      state.current.active = false;
      if (state.current.pull < THRESHOLD) {
        setPull((state.current.pull = 0));
        return;
      }
      state.current.refreshing = true;
      setRefreshing(true);
      setPull((state.current.pull = 48));
      navigator.vibrate?.(10);
      try {
        await refreshRef.current?.();
      } finally {
        state.current.refreshing = false;
        setRefreshing(false);
        setPull((state.current.pull = 0));
      }
    };
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: true });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const dragging = pull > 0 && !refreshing && state.current.active;
  const label = refreshing ? "" : pull >= THRESHOLD ? "松开刷新" : "下拉刷新";
  return (
    <div ref={rootRef} className="m-pull">
      <div
        className={`m-pull-indicator${dragging ? " is-dragging" : ""}`}
        style={{ transform: `translateY(${pull - 48}px)`, opacity: pull ? Math.min(1, pull / THRESHOLD) : 0 }}
        aria-hidden={!pull}
      >
        {refreshing ? <DotLoading color="primary" /> : <span>{label}</span>}
      </div>
      <div
        className={`m-pull-content${dragging ? " is-dragging" : ""}`}
        style={pull ? { transform: `translateY(${pull}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
