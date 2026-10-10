// 图片编辑器里的下拉菜单（缩放、更多、标注的图形和颜色）共用的交互：
// 打开 / 关闭都有过渡动画，点菜单外面关闭，方向键在菜单项之间移动。
import { useCallback, useEffect, useRef, useState } from "react";

export const MENU_EXIT_MS = 120;

// 关闭时先播放退出动画再卸载：mounted 控制是否渲染，closing 控制退出动画的样式。
export function usePresence(open, duration = MENU_EXIT_MS) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, mounted, open]);
  return { mounted, closing };
}

// 菜单开着时，在这些区域（一个 ref 或一组 ref）外按下鼠标或手指就关闭。
export function useOutsideClose(open, refs, close) {
  useEffect(() => {
    if (!open) return undefined;
    const list = Array.isArray(refs) ? refs : [refs];
    const onPointerDown = (event) => {
      if (list.some((ref) => ref.current?.contains(event.target))) return;
      if (list.some((ref) => ref.current)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // refs 是 ref 对象，本身不变，只按开关重新挂监听。
  }, [close, open]);
}

const ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled), label[role="menuitem"]';

// 方向键 / Home / End 在菜单项之间移动焦点。
export function menuKeyDown(event) {
  const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll(ITEM_SELECTOR));
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = items.indexOf(document.activeElement);
  const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
  const next = event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
      : index < 0 ? 0
        : (index + (forward ? 1 : -1) + items.length) % items.length;
  items[next].focus();
}

// 一个菜单的完整状态：open 是想要的状态，presence 负责动画，wrapRef 包住按钮和菜单；
// 菜单要渲染在别处（比如工具条会裁掉弹出层）时把它挂在 popRef 上。
// 用键盘打开时把焦点放到选中项（没有就第一项）上。
export function useStudioMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const keyboardRef = useRef(false);
  const presence = usePresence(open);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, [wrapRef, popRef], close);
  const toggle = useCallback((event) => {
    // 键盘触发的 click 没有坐标（detail 为 0）。
    keyboardRef.current = event?.detail === 0;
    setOpen((current) => !current);
  }, []);
  useEffect(() => {
    if (!open || !keyboardRef.current) return;
    const menu = popRef.current || wrapRef.current?.querySelector('[role="menu"]');
    const target = menu?.querySelector('[aria-checked="true"]') || menu?.querySelector(ITEM_SELECTOR);
    target?.focus();
  }, [open, presence.mounted]);
  return { open, setOpen, close, toggle, wrapRef, popRef, ...presence };
}
