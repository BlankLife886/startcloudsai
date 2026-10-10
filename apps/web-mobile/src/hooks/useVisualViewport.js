import { useEffect, useState } from "react";

function read() {
  const viewport = window.visualViewport;
  return {
    height: Math.round(viewport?.height || window.innerHeight),
    top: Math.round(viewport?.offsetTop || 0),
  };
}

/**
 * 可见区域（键盘以上那一块）的高度和偏移。整页聊天这类“铺满屏幕、底部有输入框”的页面用它定位：
 * iOS 弹键盘时不缩小布局视口、还会把可见区域往下平移，只用 bottom: 0 定位的输入框会被键盘挡住。
 */
export function useVisualViewport(enabled = true) {
  const [box, setBox] = useState(read);
  useEffect(() => {
    if (!enabled) return undefined;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setBox((current) => {
          const next = read();
          return next.height === current.height && next.top === current.top ? current : next;
        });
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  return box;
}
