import { useSyncExternalStore } from "react";
import { getActiveAnnouncements, openAnnouncementEvents } from "../../legacy-modules/services/metaApi.js";
import { isAnnouncementActive, nextAnnouncementBoundary } from "./announcementPolicy.js";

const FALLBACK_POLL_MS = 30_000;
const CLOSED_RECONNECT_MS = 5_000;
const listeners = new Set();
let sourceItems = [];
let sourceSignature = "";
let receivedSnapshot = false;
let state = { items: [], loading: true, error: "" };
let stopUpdates = null;
let refreshCurrent = null;

function publish(patch) {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

function publishActiveItems() {
  const items = sourceItems.filter((item) => isAnnouncementActive(item));
  if (items.length !== state.items.length || items.some((item, index) => item !== state.items[index])) {
    publish({ items });
  }
}

function applySnapshot(items) {
  if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || !item.id)) {
    throw new Error("公告响应格式不正确");
  }
  const signature = JSON.stringify(items);
  receivedSnapshot = true;
  if (signature !== sourceSignature) {
    sourceItems = items;
    sourceSignature = signature;
  }
  publishActiveItems();
  if (state.loading || state.error) publish({ loading: false, error: "" });
}

function startUpdates() {
  let active = true;
  let source = null;
  let request = null;
  let requestController = null;
  let refreshQueued = false;
  let snapshotRevision = 0;
  let fallbackTimer = 0;
  let reconnectTimer = 0;
  let boundaryTimer = 0;

  const canConnect = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const stopFallback = () => {
    window.clearInterval(fallbackTimer);
    fallbackTimer = 0;
  };
  const scheduleBoundary = () => {
    window.clearTimeout(boundaryTimer);
    const now = Date.now();
    const boundary = nextAnnouncementBoundary(sourceItems, now);
    boundaryTimer = boundary == null ? 0 : window.setTimeout(() => {
      if (!active) return;
      publishActiveItems();
      scheduleBoundary();
    }, Math.min(2_147_483_647, Math.max(1, boundary - now + 1)));
  };
  const apply = (items) => {
    applySnapshot(items);
    scheduleBoundary();
  };
  const refresh = () => {
    if (!active || !canConnect()) return Promise.resolve();
    if (request) {
      refreshQueued = true;
      return request;
    }
    const revision = snapshotRevision;
    const controller = new AbortController();
    requestController = controller;
    publish({ loading: true });
    request = getActiveAnnouncements({ signal: controller.signal })
      .then((items) => {
        if (active && !controller.signal.aborted && revision === snapshotRevision) apply(items);
      })
      .catch((error) => {
        if (!active || controller.signal.aborted || revision !== snapshotRevision) return;
        publishActiveItems();
        if (!receivedSnapshot) publish({ loading: false, error: error?.message || "公告读取失败" });
      })
      .finally(() => {
        request = null;
        if (requestController === controller) requestController = null;
        if (active && state.loading) publish({ loading: false });
        if (active && refreshQueued) {
          refreshQueued = false;
          void refresh();
        }
      });
    return request;
  };
  const startFallback = () => {
    if (!active || fallbackTimer || !canConnect()) return;
    fallbackTimer = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
  };
  const closeSource = () => {
    if (source) {
      source.onopen = null;
      source.onerror = null;
      source.close();
      source = null;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  };
  const connect = () => {
    if (!active || !canConnect() || (source && source.readyState !== 2)) return;
    closeSource();
    startFallback();
    const connection = openAnnouncementEvents({
      onSnapshot(items) {
        if (!active || source !== connection) return;
        try {
          apply(items);
          snapshotRevision += 1;
          stopFallback();
          window.clearTimeout(reconnectTimer);
          reconnectTimer = 0;
        } catch {
          startFallback();
        }
      },
      onOpen() {
        if (!active || source !== connection) return;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = 0;
      },
      onError() {
        if (!active) return;
        const alreadyPolling = Boolean(fallbackTimer);
        startFallback();
        if (!alreadyPolling) void refresh();
        if ((!source || source.readyState === 2) && !reconnectTimer && canConnect()) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = 0;
            connect();
          }, CLOSED_RECONNECT_MS);
        }
      },
    });
    source = connection;
  };
  const resume = () => {
    if (!active || !canConnect()) return;
    publishActiveItems();
    scheduleBoundary();
    connect();
    void refresh();
  };
  const suspend = () => {
    closeSource();
    stopFallback();
  };
  const visibilityChanged = () => document.visibilityState === "hidden" ? suspend() : resume();

  refreshCurrent = refresh;
  publishActiveItems();
  scheduleBoundary();
  void refresh();
  connect();
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("offline", suspend);
  document.addEventListener("visibilitychange", visibilityChanged);

  return () => {
    active = false;
    requestController?.abort();
    refreshQueued = false;
    refreshCurrent = null;
    closeSource();
    stopFallback();
    window.clearTimeout(boundaryTimer);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("offline", suspend);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}

function subscribe(listener) {
  listeners.add(listener);
  if (!stopUpdates) stopUpdates = startUpdates();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && stopUpdates) {
      stopUpdates();
      stopUpdates = null;
    }
  };
}

const getSnapshot = () => state;

export function refreshAnnouncements() {
  return refreshCurrent?.() || Promise.resolve();
}

export function useLiveAnnouncements() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, refresh: refreshAnnouncements };
}
