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
import {
  displayNotification,
  displayNotificationBody,
  notificationHref,
  notificationKind,
} from "../utils/notificationDisplay.js";
import "../features/inbox/inbox.css";
import "./NotificationsView.css";

const UPDATED_EVENT = "starclouds:notifications-updated";
const PAGE_SIZE = 20;
const POLL_MS = 20_000;
const PAGE_ORIGIN = "notifications-page";

// 左栏固定四个筛选：任务以外的分类（账户、试用、审核等）都归到「其他」
const SCOPES = [
  ["all", "全部", "bi-inbox"],
  ["unread", "未读", "bi-circle"],
  ["task", "任务", "bi-check2-square"],
  ["other", "其他", "bi-layers"],
];

function scopeOf(item) {
  return notificationKind(item).scope === "task" ? "task" : "other";
}

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

function formatClock(value) {
  const date = parseDate(value);
  return date ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
}

// 列表不再按天分组：今天只显示时刻，更早的带上日期
function formatWhen(value) {
  const date = parseDate(value);
  if (!date) return "";
  const label = dayLabel(date);
  return label === "今天" ? formatClock(value) : `${label} ${formatClock(value)}`;
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

// 从标题判断结果：失败/取消标红，完成标绿；其他通知不加状态角标
function notificationStatus(title) {
  const text = String(title || "");
  if (/失败|已取消|未通过|驳回/.test(text)) return "failed";
  if (/已完成|已通过|已到账|成功/.test(text)) return "done";
  return "";
}

function inboxItemsOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item?.id);
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
    return <Navigate replace to={`/announcements${id ? `/${encodeURIComponent(id)}` : ""}`} />;
  }
  return <NotificationInbox />;
}

function NotificationInbox() {
  const isDark = useIsDark();
  const navigate = useNavigate();
  const { isEntryVisible } = usePageControls();

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
  const loadLatest = useCallback(
    async ({ reset = false, silent = false } = {}) => {
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
    },
    [commit],
  );

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
        commit(
          itemsRef.current.map((item) => ({ ...item, readAt: item.readAt || readAt })),
          0,
        );
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
      counts[scopeOf(item)] += 1;
    });
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    if (scope === "all") return items;
    if (scope === "unread") return items.filter((item) => !item.readAt);
    return items.filter((item) => scopeOf(item) === scope);
  }, [items, scope]);

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
      commit(
        itemsRef.current.map((item) => ({ ...item, readAt: item.readAt || readAt })),
        0,
        "mark-all",
      );
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
  // 右栏「需要留意」：已加载通知里的失败消息
  const failedItems = useMemo(
    () => items.filter((item) => notificationStatus(displayNotification(item).title) === "failed"),
    [items],
  );
  const quickLinks = [
    ["/history", "bi-clock-history", "历史记录", "查看全部任务结果"],
    ["/wallet", "bi-wallet2", "我的钱包", "积分与消费明细"],
    ["/account", "bi-gear", "通知设置", "选择接收哪些提醒"],
  ].filter(([href]) => isEntryVisible(href));

  const scopeLabel = (SCOPES.find(([id]) => id === scope) || SCOPES[0])[1];

  return (
    <div className={`nt-page nt-page--inbox ${isDark ? "is-dark" : "is-light"}`}>
      <div className="nt-shell">
        <aside className="nt-nav">
          <h1 className="nt-nav__title">
            <span className="nt-nav__bell">
              <i className="bi bi-bell-fill" aria-hidden="true" />
              {unread > 0 ? <i className="nt-nav__ping" aria-hidden="true" /> : null}
            </span>
            通知
          </h1>
          <nav className="nt-scopes" aria-label="通知筛选">
            {SCOPES.map(([id, label, icon]) => {
              const count = id === "unread" ? unread : scopeCounts[id];
              return (
                <button
                  key={id}
                  type="button"
                  className={`nt-scope${scope === id ? " is-active" : ""}`}
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                >
                  <i className={`bi ${icon}`} aria-hidden="true" />
                  <span>{label}</span>
                  <em>{id === "unread" ? badge : count}</em>
                </button>
              );
            })}
          </nav>
          <span className="nt-nav__glow" aria-hidden="true" />
        </aside>

        <section className="nt-board" aria-live="polite">
          <header className="nt-board__head">
            <h2>
              {scope === "all" ? "全部通知" : scopeLabel}
              <small>共 {visibleItems.length} 条</small>
            </h2>
            <div className="nt-board__actions">
              <button
                type="button"
                className={`nt-action-btn${unread > 0 ? " is-primary" : ""}`}
                disabled={marking || unread <= 0}
                onClick={markAllRead}
              >
                <span>全部已读</span>
              </button>
              <button
                type="button"
                className="nt-action-btn is-danger"
                disabled={loading || !items.length || clearing}
                onClick={() => setClearOpen(true)}
              >
                <span>清空</span>
              </button>
              <button
                type="button"
                className="nt-action-btn"
                disabled={loading}
                onClick={() => loadLatest({ reset: true })}
              >
                <span>{loading ? "刷新中…" : "刷新"}</span>
              </button>
            </div>
          </header>

          {loading && !loaded ? (
            <div className="nt-skel" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="nt-skel__row">
                  <span />
                  <span>
                    <i />
                    <i />
                  </span>
                </div>
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
            <ol className="nt-list">
              {visibleItems.map((item) => {
                const { title, body } = displayNotification(item);
                const kind = notificationKind(item);
                const status = notificationStatus(title);
                const isTrial = String(item.kind || "").toLowerCase() === "trial_access";
                const openable = isTrial || Boolean(hrefOf(item));
                const busy = busyIds.has(item.id);
                return (
                  <li
                    key={item.id}
                    className={`nt-item is-${kind.tone}${item.readAt ? "" : " is-unread"}${openable ? " is-openable" : ""}`}
                  >
                    <button type="button" className="nt-item__main" onClick={() => openItem(item)}>
                      <span className="nt-item__icon" data-tone={status === "failed" ? "danger" : kind.tone}>
                        <i className={`bi ${status === "failed" && kind.tone === "task" ? "bi-x-lg" : kind.icon}`} />
                        {status ? (
                          <span className={`nt-item__status is-${status}`} aria-hidden="true">
                            <i className={`bi ${status === "failed" ? "bi-exclamation" : "bi-check"}`} />
                          </span>
                        ) : null}
                      </span>
                      <span className="nt-item__body" data-no-translate>
                        <span className="nt-item__top">
                          <strong className="nt-item__title">{localizedText(title)}</strong>
                          <span className="nt-item__kind" data-tone={kind.tone}>
                            {kind.label}
                          </span>
                          {!item.readAt ? <i className="nt-item__dot" aria-label="未读" /> : null}
                        </span>
                        {body ? (
                          <span className="nt-item__text">
                            {emphasizeParts(body).map((part, index) =>
                              part.highlight ? (
                                <b key={index} className="nt-hl">
                                  {part.text}
                                </b>
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
                      <time className="nt-item__time" dateTime={item.createdAt}>
                        {formatWhen(item.createdAt)}
                      </time>
                    </button>
                    <span className="nt-item__actions">
                      {!item.readAt ? (
                        <button type="button" className="nt-item__action" onClick={() => void markRead(item)}>
                          <span>已读</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="nt-item__action is-danger"
                        disabled={busy}
                        onClick={() => void removeItem(item)}
                      >
                        <span>{busy ? "删除中…" : "删除"}</span>
                      </button>
                    </span>
                  </li>
                );
              })}
              <li ref={sentinelRef} className="nt-sentinel" aria-hidden="true" />
              <li className={`nt-footer${!loadingMore && !cursor ? " is-end" : ""}`}>
                {loadingMore ? (
                  <>
                    <i className="bi bi-arrow-repeat spin" /> 加载中…
                  </>
                ) : cursor ? (
                  <button type="button" className="nt-btn" onClick={() => void loadMore()}>
                    加载更多
                  </button>
                ) : (
                  "没有更早的通知了"
                )}
              </li>
            </ol>
          )}
        </section>

        <aside className="nt-rail" aria-label="通知概览">
          <section className="nt-card nt-attention-card">
            <header className="nt-card__head">
              <strong>需要留意</strong>
              {failedItems.length ? <em>{failedItems.length}</em> : null}
            </header>
            {failedItems.length ? (
              <ul className="nt-attention">
                {failedItems.slice(0, 20).map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => openItem(item)}>
                      <i className="bi bi-x-circle-fill" aria-hidden="true" />
                      <span>
                        <strong>{localizedText(displayNotification(item).title)}</strong>
                        <small>
                          {dayLabel(parseDate(item.createdAt) || new Date())} {formatClock(item.createdAt)}
                        </small>
                      </span>
                      <i className="bi bi-chevron-right" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="nt-card__empty">
                <i className="bi bi-shield-check" aria-hidden="true" />
                <strong>一切正常</strong>
                <p>最近没有失败的任务</p>
              </div>
            )}
          </section>

          {quickLinks.length ? (
            <section className="nt-card nt-links">
              <header className="nt-card__head">
                <i className="bi bi-tools" aria-hidden="true" />
                <strong>快捷工具</strong>
              </header>
              <nav aria-label="快捷工具">
                {quickLinks.map(([href, icon, label, hint]) => (
                  <Link key={href} to={href} className="nt-link">
                    <i className={`bi ${icon}`} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                    <i className="bi bi-chevron-right" aria-hidden="true" />
                  </Link>
                ))}
              </nav>
            </section>
          ) : null}
        </aside>
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
