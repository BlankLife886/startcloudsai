import { useEffect, useState } from "react";

// iOS Safari 弹出键盘时不缩小布局视口，固定在底部的输入栏会被键盘挡住；
// 用 visualViewport 算出被遮挡的高度，让输入栏跟着键盘上移。
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hidden = window.innerHeight - viewport.height - viewport.offsetTop;
        setInset(hidden > 80 ? Math.round(hidden) : 0);
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
