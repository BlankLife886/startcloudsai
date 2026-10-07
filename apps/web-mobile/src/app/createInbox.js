// 其他 Tab 往创作页“投递”提示词。创作页可能已挂载（直接收到）或尚未打开（挂载时取走）。
let pending = null;
const listeners = new Set();

export function sendToCreate(payload) {
  pending = payload;
  listeners.forEach((listener) => listener(payload));
}

export function takeCreatePayload() {
  const payload = pending;
  pending = null;
  return payload;
}

export function subscribeCreateInbox(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
