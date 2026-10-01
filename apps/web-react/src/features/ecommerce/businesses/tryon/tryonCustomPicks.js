// 用户自己的模特/场景（上传、裁剪、“设为模特”得到的图），供选择弹窗的“最近”复用。
// 只存服务端文件 key，图片本身仍由 /api/v1/files 按登录身份鉴权读取。

export const TRYON_CUSTOM_LIMIT = 12;

function storageKey(role) {
  return `starclouds.tryon.custom.${role}.v1`;
}

export function tryonFileUrlFromKey(key) {
  const value = String(key || "").trim();
  if (!value) return "";
  return `/api/v1/files/${value.split("/").map(encodeURIComponent).join("/")}`;
}

export function readTryonCustomPicks(role) {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(role)) || "[]");
    return Array.isArray(list)
      ? list.filter((item) => item && item.key && item.id).slice(0, TRYON_CUSTOM_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function write(role, list) {
  try {
    localStorage.setItem(storageKey(role), JSON.stringify(list));
  } catch {
    /* 只是便利功能，存储不可用时忽略 */
  }
}

// 来自任务结果的 key 以 tasks/ 开头，其余视为用户上传
export function tryonCustomSourceLabel(key) {
  return String(key || "").startsWith("tasks/") ? "试衣结果" : "我上传的";
}

export function rememberTryonCustomPick(role, key) {
  const value = String(key || "").trim();
  if (!value) return readTryonCustomPicks(role);
  const id = `custom:${value}`;
  const next = [
    { id, key: value, at: Date.now() },
    ...readTryonCustomPicks(role).filter((item) => item.id !== id),
  ].slice(0, TRYON_CUSTOM_LIMIT);
  write(role, next);
  return next;
}

export function forgetTryonCustomPick(role, id) {
  const next = readTryonCustomPicks(role).filter((item) => item.id !== id);
  write(role, next);
  return next;
}
