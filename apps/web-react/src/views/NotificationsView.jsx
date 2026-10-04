import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import {
  clearNotifications,
  dismissNotification,
  listNotifications,
  markNotificationsRead,
} from "@react/legacy-modules/services/meApi.js";
import { TASK_UPDATE_EVENT } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { translateClientText } from "@react/legacy-modules/i18n/clientTranslations.js";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import { useLiveAnnouncements } from "../features/announcements/useLiveAnnouncements.js";
import { useReadAnnouncements } from "../features/announcements/announcementRead.js";
import {
  displayNotification,
  displayNotificationBody,
  isAnnouncementNotification,
  notificationHref,
  notificationKind,
} from "../utils/notificationDisplay.js";
import "../features/inbox/inbox.css";
import "./NotificationsView.css";

const UPDATED_EVENT = "starclouds:notifications-updated";
const PAGE_SIZE = 20;
const POLL_MS = 20_000;
const PAGE_ORIGIN = "notifications-page";

const SCOPES = [
  ["all", "全部", "bi-inbox"],
  ["unread", "未读", "bi-circle"],
  ["task", "任务", "bi-stars"],
  ["wallet", "账户与订单", "bi-wallet2"],
  ["trial", "试用", "bi-patch-check"],
  ["review", "审核", "bi-send-check"],
  ["other", "其他", "bi-three-dots"],
];

function locale() {
  try {
    return localStorage.getItem("starclouds-locale") || "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function localizedText(value) {
  return translateClientText(String(value || ""), locale());
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(date) {
  const start = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const today = new Date();
  const difference = Math.round((start(today) - start(date)) / 86_400_000);
  if (difference === 0) return "今天";
  if (difference === 1) return "昨天";
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatClock(value) {
  const date = parseDate(value);
  return date
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";
}

function emphasizeParts(body) {
  const text = displayNotificationBody(localizedText(body));
  if (!text) return [];
  const expression = /([\d,]+)\s*(分|积分|credits)/gi;
  const parts = [];
  let last = 0;
  let match;
  while ((match = expression.exec(text))) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), highlight: false });
    parts.push({ text: match[0], highlight: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), highlight: false });
  return parts;
}

function inboxItemsOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item?.id && !isAnnouncementNotification(item));
}

function byNewest(left, right) {
  return (parseDate(right.createdAt)?.getTime() || 0) - (parseDate(left.createdAt)?.getTime() || 0);
}

function publish(unreadCount, items, source) {
  window.dispatchEvent(
    new CustomEvent(UPDATED_EVENT, {
      detail: { unreadCount, source, origin: PAGE_ORIGIN, previewItems: items.slice(0, 8) },
    }),
  );
}

export function NotificationsView() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  // 旧链接 /notifications?tab=announce 迁到独立的公告页
  if (query.get("tab") === "announce") {
    const id = query.get("id");
    return <Navigate replace to={`/announcements${id ? `?id=${encodeURIComponent(id)}` : ""}`} />;
  }
  return <NotificationInbox />;
}

function NotificationInbox() {
  const isDark = useIsDark();
  const navigate = useNavigate();
  const { isEntryVisible } = usePageControls();
  const { items: liveAnnouncements } = useLiveAnnouncements();
  const { isRead: isAnnouncementRead } = useReadAnnouncements();
  const unreadAnnouncements = liveAnnouncements.filter((item) => !isAnnouncementRead(item)).length;

  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("all");
  const [marking, setMarking] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [busyIds, setBusyIds] = useState(() => new Set());

  const itemsRef = useRef([]);
  const unreadRef = useRef(0);
  const cursorRef = useRef(null);
  const generationRef = useRef(0);
  const latestControllerRef = useRef(null);
  const moreControllerRef = useRef(null);
  const sentinelRef = useRef(null);

  const commit = useCallback((nextItems, nextUnread, source) => {
    itemsRef.current = nextItems;
    unreadRef.current = Math.max(0, Number(nextUnread) || 0);
    setItems(nextItems);
    setUnread(unreadRef.current);
    if (source) publish(unreadRef.current, nextItems, source);
  }, []);

  const applyCursor = (next) => {
    cursorRef.current = next || null;
    setCursor(cursorRef.current);
  };

  // 拉第一页。已经翻过页时只把新消息合并到顶部，不丢掉已加载的旧消息，
  // 这样轮询、聚焦和实时推送在任何滚动深度下都能看到新通知。
  const loadLatest = useCallback(async ({ reset = false, silent = false } = {}) => {
    latestControllerRef.current?.abort();
    const controller = new AbortController();
    latestControllerRef.current = controller;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await listNotifications({ limit: PAGE_SIZE, signal: controller.signal });
      if (controller.signal.aborted) return;
      const page = inboxItemsOf(result.items);
      const current = itemsRef.current;
      if (reset || current.length <= PAGE_SIZE || !cursorRef.current) {
        generationRef.current += 1;
        moreControllerRef.current?.abort();
        applyCursor(result.nextCursor);
        commit(page, result.unread, "list");
      } else {
        const merged = new Map(current.map((item) => [String(item.id), item]));
        page.forEach((item) => merged.set(String(item.id), item));
        commit([...merged.values()].sort(byNewest), result.unread, "list");
      }
      setLoaded(true);
      setError("");
    } catch (loadError) {
      if (controller.signal.aborted || loadError?.name === "AbortError") return;
      if (!silent) setError(loadError?.message || "通知读取失败");
    } finally {
      if (latestControllerRef.current === controller) {
        latestControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [commit]);

  const loadMore = useCallback(async () => {
    if (moreControllerRef.current || !cursorRef.current) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    setLoadingMore(true);
    try {
      const result = await listNotifications({
        limit: PAGE_SIZE,
        cursor: cursorRef.current,
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation !== generationRef.current) return;
      const seen = new Set(itemsRef.current.map((item) => String(item.id)));
      const next = [...itemsRef.current, ...inboxItemsOf(result.items).filter((item) => !seen.has(String(item.id)))];
      applyCursor(result.nextCursor);
      commit(next, result.unread);
    } catch (loadError) {
      if (!controller.signal.aborted && loadError?.name !== "AbortError") {
        notificationService.error(loadError?.message || "加载更多失败");
      }
    } finally {
      if (moreControllerRef.current === controller) {
        moreControllerRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [commit]);

  useEffect(() => {
    void loadLatest({ reset: true });
    let realtimeTimer = 0;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadLatest({ silent: true });
    };
    const refreshSoon = () => {
      window.clearTimeout(realtimeTimer);
      realtimeTimer = window.setTimeout(refresh, 160);
    };
    const onUpdated = (event) => {
      const detail = event?.detail || {};
      if (detail.origin === PAGE_ORIGIN) return;
      if (detail.source === "mark-all") {
        const readAt = new Date().toISOString();
        commit(itemsRef.current.map((item) => ({ ...item, readAt: item.readAt || readAt })), 0);
        return;
      }
      if (detail.source === "clear-all") {
        applyCursor(null);
        commit([], 0);
        return;
      }
      if (Array.isArray(detail.previewItems)) {
        const merged = new Map(itemsRef.current.map((item) => [String(item.id), item]));
        inboxItemsOf(detail.previewItems).forEach((item) => merged.set(String(item.id), item));
        commit([...merged.values()].sort(byNewest), detail.unreadCount ?? unreadRef.current);
        return;
      }
      // 实时推送只带未读数：数量变了就拉一次最新列表
      const next = Number(detail.unreadCount);
      if (Number.isFinite(next) && next !== unreadRef.current) refreshSoon();
    };
    const onTaskUpdate = (event) => {
      if (["succeeded", "failed", "canceled"].includes(event?.detail?.task?.status)) refreshSoon();
    };
    window.addEventListener(UPDATED_EVENT, onUpdated);
    window.addEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const pollTimer = window.setInterval(refresh, POLL_MS);
    return () => {
      latestControllerRef.current?.abort();
      moreControllerRef.current?.abort();
      window.removeEventListener(UPDATED_EVENT, onUpdated);
      window.removeEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(pollTimer);
      window.clearTimeout(realtimeTimer);
    };
  }, [commit, loadLatest]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && void loadMore(),
      { rootMargin: "200px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, items.length, loadMore]);

  const scopeCounts = useMemo(() => {
    const counts = Object.fromEntries(SCOPES.map(([id]) => [id, 0]));
    counts.all = items.length;
    items.forEach((item) => {
      if (!item.readAt) counts.unread += 1;
      counts[notificationKind(item).scope] += 1;
    });
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    if (scope === "all") return items;
    if (scope === "unread") return items.filter((item) => !item.readAt);
    return items.filter((item) => notificationKind(item).scope === scope);
  }, [items, scope]);

  const dayGroups = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach((item) => {
      const date = parseDate(item.createdAt);
      const key = date ? dayKey(date) : "unknown";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: date ? dayLabel(date) : "更早",
          weekday: date ? WEEKDAYS[date.getDay()] : "",
          items: [],
        });
      }
      groups.get(key).items.push(item);
    });
    return [...groups.values()];
  }, [visibleItems]);

  const setBusy = (id, busy) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const markRead = async (item) => {
    if (!item?.id || item.readAt) return true;
    try {
      await markNotificationsRead([item.id]);
    } catch (markError) {
      notificationService.error(markError?.message || "标记已读失败");
      return false;
    }
    const readAt = new Date().toISOString();
    const wasUnread = itemsRef.current.some((entry) => entry.id === item.id && !entry.readAt);
    commit(
      itemsRef.current.map((entry) => (entry.id === item.id ? { ...entry, readAt } : entry)),
      unreadRef.current - (wasUnread ? 1 : 0),
      "mark-items",
    );
    return true;
  };

  const markAllRead = async () => {
    if (marking || unread <= 0) return;
    setMarking(true);
    try {
      await markNotificationsRead();
      const readAt = new Date().toISOString();
      commit(itemsRef.current.map((item) => ({ ...item, readAt: item.readAt || readAt })), 0, "mark-all");
    } catch (markError) {
      notificationService.error(markError?.message || "操作失败");
    } finally {
      setMarking(false);
    }
  };

  const removeItem = async (item) => {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    try {
      await dismissNotification(item.id);
      commit(
        itemsRef.current.filter((entry) => entry.id !== item.id),
        unreadRef.current - (item.readAt ? 0 : 1),
        "mark-items",
      );
    } catch (removeError) {
      notificationService.error(removeError?.message || "删除失败");
    } finally {
      setBusy(item.id, false);
    }
  };

  const clearAll = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearNotifications();
      generationRef.current += 1;
      moreControllerRef.current?.abort();
      applyCursor(null);
      commit([], 0, "clear-all");
      setClearOpen(false);
      setScope("all");
      notificationService.success("通知已清空");
    } catch (clearError) {
      notificationService.error(clearError?.message || "清空失败");
    } finally {
      setClearing(false);
    }
  };

  const hrefOf = (item) => {
    const href = notificationHref(item);
    return href && isEntryVisible(href) ? href : null;
  };

  const openItem = (item) => {
    const kind = String(item?.kind || "").toLowerCase();
    void markRead(item);
    if (kind === "trial_access") {
      navigate("/notifications?trial=apply");
      return;
    }
    const href = hrefOf(item);
    if (href) navigate(href);
  };

  const badge = unread > 99 ? "99+" : String(unread);
  const showScopes = SCOPES.filter(([id]) => id === "all" || id === "unread" || scopeCounts[id] > 0);

  return (
    <div className={`nt-page ${isDark ? "is-dark" : "is-light"}`}>
      <div className="nt-shell">
        <header className="nt-head">
          <div className="nt-head__copy">
            <span className="nt-head__eyebrow">
              <i className="bi bi-bell" /> 消息中心
            </span>
            <h1>
              通知
              {unread > 0 ? <em>{badge}</em> : null}
            </h1>
            <p>任务结果、账户变动、审核进度等与你有关的消息。</p>
          </div>
          <div className="nt-head__actions">
            <button
              type="button"
              className={`nt-btn${unread > 0 ? " is-primary" : ""}`}
              disabled={marking || unread <= 0}
              onClick={markAllRead}
            >
              <i className="bi bi-check2-all" /> 全部已读
            </button>
            <button
              type="button"
              className="nt-btn"
              disabled={loading || !items.length || clearing}
              onClick={() => setClearOpen(true)}
            >
              <i className="bi bi-trash3" /> 清空
            </button>
            <button
              type="button"
              className="nt-btn is-icon"
              aria-label="刷新"
              title="刷新"
              disabled={loading}
              onClick={() => loadLatest({ reset: true })}
            >
              <i className={`bi bi-arrow-repeat${loading ? " spin" : ""}`} />
            </button>
          </div>
        </header>

        <div className="nt-layout">
          <aside className="nt-side">
            <nav className="nt-scopes" aria-label="通知筛选">
              {showScopes.map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  className={`nt-scope${scope === id ? " is-active" : ""}`}
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                >
                  <i className={`bi ${icon}`} aria-hidden="true" />
                  <span>{label}</span>
                  <em>{id === "unread" ? badge : scopeCounts[id]}</em>
                </button>
              ))}
            </nav>
            <Link className="nt-announce-link" to="/announcements">
              <span className="nt-announce-link__icon">
                <i className="bi bi-megaphone" />
              </span>
              <span className="nt-announce-link__copy">
                <strong>平台公告</strong>
                <small>{unreadAnnouncements > 0 ? `${unreadAnnouncements} 条新公告` : "活动、上新与维护"}</small>
              </span>
              {unreadAnnouncements > 0 ? <i className="nt-announce-link__dot" aria-hidden="true" /> : null}
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </Link>
          </aside>

          <section className="nt-board" aria-live="polite">
            {loading && !loaded ? (
              <div className="nt-skel" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="nt-skel__row" />
                ))}
              </div>
            ) : error && !items.length ? (
              <div className="nt-empty is-error">
                <i className="bi bi-wifi-off" />
                <strong>通知读取失败</strong>
                <p>{error}</p>
                <button type="button" className="nt-btn" onClick={() => loadLatest({ reset: true })}>
                  重试
                </button>
              </div>
            ) : !items.length ? (
              <div className="nt-empty">
                <i className="bi bi-bell" />
                <strong>暂无通知</strong>
                <p>任务完成、积分到账、投稿审核等消息会出现在这里。</p>
              </div>
            ) : !visibleItems.length ? (
              <div className="nt-empty">
                <i className="bi bi-check2-circle" />
                <strong>{scope === "unread" ? "没有未读消息" : "这一类暂时没有消息"}</strong>
                <p>{scope === "unread" ? "消息都看完了。" : "切回「全部」可以查看其他通知。"}</p>
                <button type="button" className="nt-btn" onClick={() => setScope("all")}>
                  查看全部
                </button>
              </div>
            ) : (
              <div className="nt-list">
                {dayGroups.map((group) => (
                  <section key={group.key} className="nt-day">
                    <header className="nt-day__head">
                      <strong>{group.label}</strong>
                      {group.weekday ? <small>{group.weekday}</small> : null}
                    </header>
                    <ol className="nt-day__items">
                      {group.items.map((item) => {
                        const { title, body } = displayNotification(item);
                        const kind = notificationKind(item);
                        const isTrial = String(item.kind || "").toLowerCase() === "trial_access";
                        const openable = isTrial || Boolean(hrefOf(item));
                        const busy = busyIds.has(item.id);
                        return (
                          <li
                            key={item.id}
                            className={`nt-item is-${kind.tone}${item.readAt ? "" : " is-unread"}${openable ? " is-openable" : ""}`}
                          >
                            <button type="button" className="nt-item__main" onClick={() => openItem(item)}>
                              <span className="nt-item__icon" data-tone={kind.tone}>
                                <i className={`bi ${kind.icon}`} />
                              </span>
                              <span className="nt-item__body" data-no-translate>
                                <span className="nt-item__top">
                                  <span className="nt-item__kind">{kind.label}</span>
                                  <time dateTime={item.createdAt}>{formatClock(item.createdAt)}</time>
                                  {!item.readAt ? <i className="nt-item__dot" aria-label="未读" /> : null}
                                </span>
                                <strong className="nt-item__title">{localizedText(title)}</strong>
                                {body ? (
                                  <span className="nt-item__text">
                                    {emphasizeParts(body).map((part, index) =>
                                      part.highlight ? (
                                        <b key={index} className="nt-hl">{part.text}</b>
                                      ) : (
                                        <span key={index}>{part.text}</span>
                                      ),
                                    )}
                                  </span>
                                ) : null}
                                {isTrial ? (
                                  <span className="nt-item__cta">
                                    查看体验资格 <i className="bi bi-arrow-right" />
                                  </span>
                                ) : null}
                              </span>
                              {openable ? <i className="bi bi-chevron-right nt-item__go" aria-hidden="true" /> : null}
                            </button>
                            <span className="nt-item__actions">
                              {!item.readAt ? (
                                <button
                                  type="button"
                                  className="nt-item__action"
                                  aria-label="标为已读"
                                  title="标为已读"
                                  onClick={() => void markRead(item)}
                                >
                                  <i className="bi bi-check2" />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="nt-item__action is-danger"
                                aria-label="删除"
                                title="删除"
                                disabled={busy}
                                onClick={() => void removeItem(item)}
                              >
                                <i className={`bi ${busy ? "bi-arrow-repeat spin" : "bi-x-lg"}`} />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
                <div ref={sentinelRef} className="nt-sentinel" aria-hidden="true" />
                {loadingMore ? (
                  <div className="nt-footer">加载中…</div>
                ) : cursor ? (
                  <div className="nt-footer">
                    <button type="button" className="nt-btn" onClick={() => void loadMore()}>
                      加载更多
                    </button>
                  </div>
                ) : (
                  <div className="nt-footer is-end">没有更早的通知了</div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={clearOpen}
        busy={clearing}
        heading="清空全部通知？"
        description="所有通知都会被删除，之后的新消息仍会正常收到。"
        confirmLabel="确认清空"
        busyLabel="清空中…"
        light={!isDark}
        onClose={() => !clearing && setClearOpen(false)}
        onConfirm={clearAll}
      />
    </div>
  );
}
