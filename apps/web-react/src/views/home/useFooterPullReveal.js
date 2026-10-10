import { useEffect, useRef } from "react";

// 页面滚到底后继续下拉（滚轮 / 触控板 / 手指上滑），把页脚大字从屏幕底部“拉”上来。
// 大字垫在页脚文字下层，只作背景水印，不遮挡文字。
// 拉过一半松手则停留展开，否则回弹；展开时向上滚会先收起，再恢复正常滚动。
// onProgress(0..1) 在每次位置变化时回调，供粒子大字按进度聚合。
export function useFooterPullReveal(layerRef, onProgress) {
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;
    let pull = 0;
    let idle = 0;
    let frame = 0;
    let touchY = null;
    // 一次连续滚动（事件间隔 < 200ms）只有“开始时就已在底部”才算下拉，
    // 避免滑到底时带过来的惯性滚动直接把大字拉出来
    let lastWheel = 0;
    let streamFromBottom = false;

    const max = () => layer.offsetHeight || 1;
    const atBottom = () =>
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    const render = () => {
      layer.style.setProperty("--pull", `${pull}px`);
      progressRef.current?.(pull / max());
    };
    // 松手后的展开 / 回弹用逐帧补间，保证位移与粒子进度同步
    const animateTo = (target) => {
      window.cancelAnimationFrame(frame);
      const from = pull;
      const start = performance.now();
      const duration = 560;
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // 带一点回弹的缓出
        const eased = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
        pull = Math.max(0, Math.min(max(), from + (target - from) * eased));
        render();
        if (t < 1) frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    };
    const settle = () => animateTo(pull > max() * 0.5 ? max() : 0);
    const drag = (delta) => {
      window.cancelAnimationFrame(frame);
      const limit = max();
      // 往外拉时带阻力，越接近完全展开越“沉”；往回收时跟手
      const step = delta > 0 ? delta * 0.6 * (1 - (pull / limit) * 0.6) : delta;
      pull = Math.min(limit, Math.max(0, pull + step));
      render();
      window.clearTimeout(idle);
      idle = window.setTimeout(settle, 160);
    };

    const onWheel = (event) => {
      const now = event.timeStamp;
      if (now - lastWheel > 200) streamFromBottom = atBottom();
      lastWheel = now;
      if (event.deltaY > 0 && atBottom() && (streamFromBottom || pull > 0)) {
        drag(event.deltaY);
      } else if (event.deltaY < 0 && pull > 0) {
        event.preventDefault();
        drag(event.deltaY);
      }
    };
    const onTouchStart = (event) => {
      touchY = atBottom() || pull > 0 ? event.touches[0]?.clientY ?? null : null;
    };
    const onTouchMove = (event) => {
      const y = event.touches[0]?.clientY;
      if (touchY === null || y === undefined) return;
      const delta = touchY - y;
      touchY = y;
      if (delta > 0 && atBottom()) {
        drag(delta);
      } else if (delta < 0 && pull > 0) {
        event.preventDefault();
        drag(delta);
      }
    };
    const onTouchEnd = () => {
      touchY = null;
      if (pull > 0) settle();
    };
    // 通过滚动条、键盘等方式离开底部时收起
    const onScroll = () => {
      if (pull > 0 && !atBottom()) animateTo(0);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(idle);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("scroll", onScroll);
    };
  }, [layerRef]);
}
