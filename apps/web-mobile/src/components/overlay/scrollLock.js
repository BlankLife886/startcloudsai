// 弹层打开时锁住页面滚动。只在开/关时各改一次 body 样式，不挂任何触摸监听：
// antd-mobile 的锁滚动会在整页挂非 passive 的 touchmove，弹层里每次滑动都要先过 JS，手机上发涩。
let locks = 0;
let savedY = 0;

export function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  savedY = window.scrollY;
  const { style } = document.body;
  style.position = "fixed";
  style.top = `-${savedY}px`;
  style.left = "0";
  style.right = "0";
  style.width = "100%";
}

export function unlockScroll() {
  if (!locks) return;
  locks -= 1;
  if (locks) return;
  const { style } = document.body;
  style.position = "";
  style.top = "";
  style.left = "";
  style.right = "";
  style.width = "";
  window.scrollTo(0, savedY);
}

