import { useSyncExternalStore } from "react";
import { announcementIdentity } from "./announcementPolicy.js";

// 公告已读状态只存在本机：按 id + pushId 记，后台重新推送后会重新变成未读。
const STORAGE_KEY = "starclouds-announcement-read";
const CHANGE_EVENT = "starclouds:announcements-read";
const MAX_IDS = 300;

let cachedRaw = null;
let cachedSet = new Set();

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function getSnapshot() {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const list = JSON.parse(raw || "[]");
      cachedSet = new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
      cachedSet = new Set();
    }
  }
  return cachedSet;
}

function subscribe(listener) {
  const onStorage = (event) => {
    if (!event.key || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function markAnnouncementsRead(items) {
  const keys = (Array.isArray(items) ? items : [items])
    .filter((item) => item?.id)
    .map(announcementIdentity);
  if (!keys.length) return;
  const current = getSnapshot();
  if (keys.every((key) => current.has(key))) return;
  const next = [...current].filter((key) => !keys.includes(key)).concat(keys).slice(-MAX_IDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useReadAnnouncements() {
  const readKeys = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    isRead: (item) => readKeys.has(announcementIdentity(item)),
    markRead: markAnnouncementsRead,
  };
}
