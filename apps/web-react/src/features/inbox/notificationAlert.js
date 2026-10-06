import { useSyncExternalStore } from "react";
import {
  getNotificationPreferences as fetchNotificationPreferences,
  saveNotificationPreferences,
} from "@react/legacy-modules/services/meApi.js";
import { displayNotification, notificationKind } from "../../utils/notificationDisplay.js";

// 新通知提醒：提醒偏好（服务端同步）、桌面提醒（按设备）、跨标签页去重、合成提示音。

export const NOTIFICATION_CATEGORIES = [
  ["task", "任务", "生成完成、失败或停止"],
  ["wallet", "账户与订单", "支付、订阅、兑换与积分变动"],
  ["trial", "试用", "体验积分发放与活动变动"],
  ["review", "审核", "投稿审核与违规处理"],
  ["other", "其他", "AI 助手建议、反馈进度等"],
];

const DEFAULT_PREFS = Object.freeze({
  sound: true,
  categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(([id]) => [id, "alert"])),
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
});

function normalizePrefs(raw) {
  return {
    sound: raw?.sound !== false,
    categories: { ...DEFAULT_PREFS.categories, ...(raw?.categories || {}) },
    quietHours: { ...DEFAULT_PREFS.quietHours, ...(raw?.quietHours || {}) },
  };
}

const PREFS_EVENT = "starclouds:notify-prefs";
let prefs = normalizePrefs(null);
let prefsUserId = null;
let prefsRequest = null;

function setPrefs(next) {
  prefs = next;
  window.dispatchEvent(new Event(PREFS_EVENT));
}

function subscribePrefs(listener) {
  window.addEventListener(PREFS_EVENT, listener);
  return () => window.removeEventListener(PREFS_EVENT, listener);
}

/** 登录后拉一次当前账号的提醒偏好；换账号时重置。 */
export function loadNotificationPreferences(userId) {
  if (!userId) {
    prefsUserId = null;
    prefsRequest = null;
    setPrefs(normalizePrefs(null));
    return Promise.resolve(prefs);
  }
  if (prefsUserId === userId && prefsRequest) return prefsRequest;
  prefsUserId = userId;
  prefsRequest = fetchNotificationPreferences()
    .then((data) => {
      if (prefsUserId === userId) setPrefs(normalizePrefs(data));
      return prefs;
    })
    .catch(() => {
      prefsRequest = null;
      return prefs;
    });
  return prefsRequest;
}

export function getNotificationPreferences() {
  return prefs;
}

export function useNotificationPreferences() {
  return useSyncExternalStore(subscribePrefs, getNotificationPreferences, getNotificationPreferences);
}

let saveSeq = 0;

/** 先更新界面再保存；失败时回滚并把错误抛给调用方。只采用最新一次保存的响应，避免旧响应覆盖新改动。 */
export async function updateNotificationPreferences(patch) {
  const seq = ++saveSeq;
  const previous = prefs;
  const next = normalizePrefs({
    ...previous,
    ...patch,
    categories: { ...previous.categories, ...(patch.categories || {}) },
    quietHours: { ...previous.quietHours, ...(patch.quietHours || {}) },
  });
  setPrefs(next);
  try {
    const saved = await saveNotificationPreferences(next);
    if (seq === saveSeq) setPrefs(saved && typeof saved.sound === "boolean" ? normalizePrefs(saved) : next);
  } catch (error) {
    if (seq === saveSeq) setPrefs(previous);
    throw error;
  }
}

export function useNotificationSound() {
  return useNotificationPreferences().sound;
}

export function setNotificationSound(on) {
  if (on) void playNotificationChime();
  return updateNotificationPreferences({ sound: Boolean(on) }).catch(() => null);
}

function minutesOf(clock) {
  const [hours, minutes] = String(clock || "").split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

/** 免打扰时段内只亮红点、显示卡片，不出声也不弹桌面提醒；支持跨零点（如 22:00–08:00）。 */
export function isQuietHours(current = prefs, now = new Date()) {
  const quiet = current?.quietHours;
  if (!quiet?.enabled) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === null || end === null || start === end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** 按分类偏好筛掉「静默」的通知；静默的仍会出现在列表和红点里。 */
export function alertableNotifications(items, current = prefs) {
  return items.filter((item) => current.categories[notificationKind(item).scope] !== "silent");
}

// —— 桌面提醒：依赖浏览器授权，按设备单独开启 ——
const DESKTOP_KEY = "starclouds-notify-desktop";
const DESKTOP_EVENT = "starclouds:notify-desktop";

function desktopSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function readDesktopState() {
  if (!desktopSupported()) return "unsupported";
  let enabled = false;
  try {
    enabled = localStorage.getItem(DESKTOP_KEY) === "on";
  } catch {
    enabled = false;
  }
  return `${Notification.permission}:${enabled ? "on" : "off"}`;
}

function subscribeDesktop(listener) {
  const onStorage = (event) => {
    if (!event.key || event.key === DESKTOP_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DESKTOP_EVENT, listener);
  window.addEventListener("focus", listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DESKTOP_EVENT, listener);
    window.removeEventListener("focus", listener);
  };
}

/** { supported, permission: default|granted|denied, enabled } */
export function useDesktopNotifications() {
  const state = useSyncExternalStore(subscribeDesktop, readDesktopState, () => "unsupported");
  if (state === "unsupported") return { supported: false, permission: "denied", enabled: false };
  const [permission, enabled] = state.split(":");
  return { supported: true, permission, enabled: enabled === "on" && permission === "granted" };
}

function writeDesktop(on) {
  try {
    localStorage.setItem(DESKTOP_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(DESKTOP_EVENT));
}

/** 需要在用户点击里调用：浏览器只允许由手势触发授权弹窗。返回最终是否开启。 */
export async function setDesktopNotifications(on) {
  if (!on || !desktopSupported()) {
    writeDesktop(false);
    return false;
  }
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  writeDesktop(permission === "granted");
  return permission === "granted";
}

function desktopEnabled() {
  return readDesktopState() === "granted:on";
}

function showDesktopNotification(items, onOpen) {
  const [first] = items;
  const { title, body } = displayNotification(first);
  try {
    const notice = new Notification(items.length > 1 ? `${items.length} 条新通知` : title, {
      body: items.length > 1 ? title : body || "",
      tag: `starclouds-${first.id}`,
      icon: "/favicon.ico",
    });
    notice.onclick = () => {
      window.focus();
      onOpen?.(first);
      notice.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** 设置页「测试提醒」：按当前设置走一遍声音 / 桌面提醒。 */
export function previewNotificationAlert() {
  if (prefs.sound) void playNotificationChime();
  if (desktopEnabled()) {
    showDesktopNotification([{ id: "preview", kind: "system", title: "这是一条测试提醒", body: "新通知会以这种方式提醒你。" }]);
  }
}

// —— 跨标签页去重 ——
const ALERTED_KEY = "starclouds-notify-alerted";
const MAX_ALERTED = 60;

/**
 * 多个标签页都会收到同一条通知：谁先认领谁出声/弹桌面提醒，避免叠音。
 * localStorage 读写是同步的，同一浏览器内足够做这种轻量去重。
 */
export function claimNotificationAlert(ids) {
  const keys = ids.map(String).filter(Boolean);
  if (!keys.length) return false;
  try {
    const seen = new Set(JSON.parse(localStorage.getItem(ALERTED_KEY) || "[]"));
    const fresh = keys.filter((key) => !seen.has(key));
    if (!fresh.length) return false;
    const next = [...seen, ...fresh].slice(-MAX_ALERTED);
    localStorage.setItem(ALERTED_KEY, JSON.stringify(next));
    return true;
  } catch {
    return true;
  }
}

/**
 * 声音与桌面提醒（视觉提醒由调用方负责）。前台标签页优先认领：
 * 后台标签页晚一点再认领，这样有可见页面时用户听到提示音，
 * 全部在后台时由后台页弹出桌面提醒。
 */
export async function deliverNotificationAlert(items, { onOpen } = {}) {
  if (!items.length || isQuietHours()) return;
  const hidden = typeof document !== "undefined" && document.hidden;
  if (hidden) await new Promise((resolve) => window.setTimeout(resolve, 500));
  if (!claimNotificationAlert(items.map((item) => item.id))) return;
  if (hidden && desktopEnabled() && showDesktopNotification(items, onOpen)) return;
  if (prefs.sound) void playNotificationChime();
}

// —— 提示音 ——
let audioContext = null;

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  try {
    audioContext = new AudioCtor();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

// 浏览器要求先有用户手势才能出声：第一次点击/按键时把音频上下文解锁。
if (typeof window !== "undefined") {
  const unlock = () => {
    const context = getAudioContext();
    if (context?.state === "suspended") void context.resume().catch(() => null);
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/** 两个音的轻提示音（约 0.4 秒），音量很低；无法播放时静默跳过。 */
export async function playNotificationChime() {
  const context = getAudioContext();
  if (!context) return;
  try {
    if (context.state === "suspended") await context.resume();
  } catch {
    return;
  }
  if (context.state !== "running") return;
  const start = context.currentTime + 0.01;
  [
    [880, 0],
    [1318.5, 0.12],
  ].forEach(([frequency, offset]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const at = start + offset;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.34);
  });
}
