import { useEffect, useState } from "react";
import { lockScroll, unlockScroll } from "./scrollLock.js";

export const ENTER_MS = 280;
export const LEAVE_MS = 220;

/**
 * 弹层进出场：visible 变 true 时先挂载（初始为隐藏态），下一帧切到显示态触发 CSS 过渡；
 * 变 false 时先切回隐藏态播放离场过渡，结束后卸载。动画全部由 CSS transform/opacity 完成。
 */
export function usePresence(visible, { lock = true } = {}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  // 挂载后先强制浏览器算一次初始样式，再切到显示态，过渡才会从隐藏态开始播放。
  // 不依赖 requestAnimationFrame：页面被限速或在后台时帧回调可能迟迟不来，弹层会卡在半路。
  useEffect(() => {
    if (!visible || !mounted || shown) return;
    void document.body.offsetHeight;
    setShown(true);
  }, [mounted, shown, visible]);

  useEffect(() => {
    if (!visible || !lock) return undefined;
    lockScroll();
    return unlockScroll;
  }, [lock, visible]);

  return { mounted, shown };
}
