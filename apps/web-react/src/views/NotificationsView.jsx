import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  clearNotifications,
  listNotifications,
  markNotificationsRead,
} from "@react/legacy-modules/services/meApi.js";
import { TASK_UPDATE_EVENT } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { translateClientText } from "@react/legacy-modules/i18n/clientTranslations.js";
import "@react/legacy-styles/generated/views/NotificationsView.css";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import {
  displayNotification,
  displayNotificationBody,
} from "../utils/notificationDisplay.js";

const UPDATED_EVENT = "starclouds:notifications-updated";
const POLL_MS = 20_000;

function locale() {
  return localStorage.getItem("starclouds-locale") || "zh-CN";
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(date) {
  const today = new Date();
  const start = (value) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const difference = Math.round((start(today) - start(date)) / 86_400_000);
  if (difference === 0) return "今天";
  if (difference === 1) return "昨天";
  if (difference > 1 && difference < 7) return `${difference} 天前`;
  if (date.getFullYear() === today.getFullYear())
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatClock(value) {
  const date = parseDate(value);
  return date
    ? date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
}

function kindMeta(item) {
  const kind = String(item?.kind || "").toLowerCase();
  const title = String(item?.title || "");
  if (kind === "trial_access")
    return { icon: "bi-patch-check", label: "试用", tone: "success" };
  if (kind.includes("redeem") || title.includes("兑换"))
    return { icon: "bi-ticket-perforated", label: "兑换", tone: "gold" };
  if (
    kind.includes("wallet") ||
    ["入账", "积分", "充值"].some((text) => title.includes(text))
  )
    return { icon: "bi-wallet2", label: "账户", tone: "wallet" };
  if (
    kind.includes("task") ||
    ["任务", "生成"].some((text) => title.includes(text))
  )
    return { icon: "bi-stars", label: "任务", tone: "task" };
  if (
    kind.includes("gallery") ||
    ["投稿", "审核"].some((text) => title.includes(text))
  )
    return { icon: "bi-send-check", label: "审核", tone: "review" };
  if (kind.includes("system") || title.includes("公告"))
    return { icon: "bi-megaphone", label: "公告", tone: "announce" };
  return { icon: "bi-bell", label: "通知", tone: "default" };
}

function itemHref(item) {
  const kind = String(item?.kind || "").toLowerCase();
  if (kind === "trial_access") return null;
  if (kind.includes("task")) return "/history";
  if (kind.includes("wallet") || kind.includes("redeem")) return "/wallet";
  if (kind.includes("gallery")) return "/submissions";
  if (kind.includes("system")) return "/updates";
  return null;
}

function itemScope(item) {
  const kind = String(item?.kind || "").toLowerCase();
  if (kind === "trial_access") return "trial";
  if (kind.includes("task")) return "task";
  if (kind.includes("wallet") || kind.includes("redeem")) return "wallet";
  if (kind.includes("gallery")) return "review";
  if (kind.includes("system")) return "announce";
  return "other";
}

const SCOPE_FILTERS = [
  ["all", "全部"],
  ["unread", "未读"],
  ["task", "任务"],
  ["wallet", "账户"],
  ["trial", "试用"],
  ["review", "审核"],
  ["announce", "公告"],
];

function readableBody(body) {
  return displayNotificationBody(localizedText(body));
}

function extractAmount(body) {
  const text = readableBody(body);
  const match =
    text.match(/([\d,]+)\s*(?:分|积分|credits)/i) ||
    text.match(/(?:Added|added|Redeemed|—)\s*([\d,]+)/);
  return match?.[1] || "";
}

function amountUnit(body) {
  const text = readableBody(body);
  if (/credits/i.test(text)) return "credits";
  if (/积分/.test(text) || /分/.test(text)) return "积分";
  return extractAmount(body) ? (locale() === "en" ? "credits" : "积分") : "";
}

function emphasizeParts(body) {
  const text = readableBody(body);
  if (!text) return [];
  const expression = /([\d,]+)\s*(分|积分|credits)/gi;
  const parts = [];
  let last = 0;
  let match;
  while ((match = expression.exec(text))) {
    if (match.index > last)
      parts.push({ text: text.slice(last, match.index), highlight: false });
    parts.push({ text: match[0], highlight: true });
    last = match.index + match[0].length;
  }
  if (last < text.length)
    parts.push({ text: text.slice(last), highlight: false });
  return parts.length ? parts : [{ text, highlight: false }];
}

function publishNotifications(unreadCount, detail = {}) {
  window.dispatchEvent(
    new CustomEvent(UPDATED_EVENT, { detail: { unreadCount, ...detail } }),
  );
}

export function NotificationsView() {
  const isDark = useIsDark();
  const location = useLocation();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef(null);
  const itemsRef = useRef([]);
  const realtimeTimerRef = useRef(0);
  const sentinelRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [unread, setUnread] = useState(0);
  const [scope, setScope] = useState("all");

  const applyItems = (next) => {
    itemsRef.current = next;
    setItems(next);
  };
  const applyCursor = (next) => {
    cursorRef.current = next;
    setCursor(next);
  };
  const applyUnread = (value, detail = {}) => {
    const next = Math.max(0, Number(value) || 0);
    setUnread(next);
    publishNotifications(next, {
      ...detail,
      previewItems: Array.isArray(detail.previewItems)
        ? detail.previewItems
        : itemsRef.current.slice(0, 8),
    });
  };

  const loadList = useCallback(async ({ append = false } = {}) => {
    if (append) {
      if (loadingMoreRef.current || !cursorRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError("");
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await listNotifications({
        limit: 20,
        cursor: append ? cursorRef.current || "" : "",
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      if (append) {
        const seen = new Set(itemsRef.current.map((item) => String(item.id)));
        applyItems([
          ...itemsRef.current,
          ...result.items.filter((item) => !seen.has(String(item.id))),
        ]);
      } else applyItems(result.items);
      applyCursor(result.nextCursor || null);
      setLoaded(true);
      applyUnread(result.unread, { source: "list" });
    } catch (loadError) {
      if (loadError?.name !== "AbortError" && mountedRef.current) {
        const message = loadError?.message || "通知读取失败";
        setError(message);
        if (!append) notificationService.error(message);
      }
    } finally {
      if (controllerRef.current === controller) {
        loadingRef.current = false;
        loadingMoreRef.current = false;
        if (mountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadingRef.current = false;
    loadList();
    const onUpdated = (event) => {
      if (
        event?.detail?.source !== "preview" ||
        !Array.isArray(event.detail.previewItems)
      )
        return;
      const merged = new Map(
        itemsRef.current.map((item) => [String(item.id), item]),
      );
      event.detail.previewItems.forEach((item) =>
        merged.set(String(item.id), item),
      );
      applyItems(
        [...merged.values()].sort(
          (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
        ),
      );
      if (Number.isFinite(Number(event.detail.unreadCount)))
        setUnread(Math.max(0, Number(event.detail.unreadCount)));
    };
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        !loadingMoreRef.current &&
        itemsRef.current.length <= 20
      )
        loadList();
    };
    const onTaskUpdate = (event) => {
      if (
        !event?.detail?.task ||
        !["succeeded", "failed", "canceled"].includes(event.detail.task.status)
      )
        return;
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
      realtimeTimerRef.current = window.setTimeout(refresh, 160);
    };
    window.addEventListener(UPDATED_EVENT, onUpdated);
    window.addEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const pollTimer = window.setInterval(refresh, POLL_MS);
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      window.removeEventListener(UPDATED_EVENT, onUpdated);
      window.removeEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(pollTimer);
      if (realtimeTimerRef.current)
        window.clearTimeout(realtimeTimerRef.current);
    };
  }, [loadList]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return undefined;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.some((entry) => entry.isIntersecting) &&
        loadList({ append: true }),
      { rootMargin: "160px 0px", threshold: 0 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, items.length, loadList]);

  const scopeCounts = useMemo(() => {
    const counts = {
      all: items.length,
      unread: 0,
      task: 0,
      wallet: 0,
      trial: 0,
      review: 0,
      announce: 0,
      other: 0,
    };
    items.forEach((item) => {
      if (!item.readAt) counts.unread += 1;
      counts[itemScope(item)] += 1;
    });
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    if (scope === "all") return items;
    if (scope === "unread") return items.filter((item) => !item.readAt);
    return items.filter((item) => itemScope(item) === scope);
  }, [items, scope]);

  const dayGroups = useMemo(() => {
    const groups = [];
    const map = new Map();
    visibleItems.forEach((item) => {
      const date = parseDate(item.createdAt);
      const key = date ? dayKey(date) : "unknown";
      if (!map.has(key)) {
        const group = {
          key,
          label: date ? dayLabel(date) : "更早",
          sublabel: date
            ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
                date.getDay()
              ]
            : "",
          items: [],
        };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key).items.push(item);
    });
    return groups;
  }, [visibleItems]);

  const markAllRead = async () => {
    if (marking || unread <= 0) return;
    setMarking(true);
    try {
      await markNotificationsRead();
      applyItems(
        itemsRef.current.map((item) => ({
          ...item,
          readAt: item.readAt || new Date().toISOString(),
        })),
      );
      applyUnread(0, { source: "mark-all" });
      notificationService.success("已全部标记为已读");
    } catch (markError) {
      notificationService.error(markError?.message || "操作失败");
    } finally {
      if (mountedRef.current) setMarking(false);
    }
  };

  const clearAll = async () => {
    if (clearing || !items.length) return;
    setClearing(true);
    try {
      await clearNotifications();
      applyItems([]);
      applyCursor(null);
      applyUnread(0, { source: "clear-all" });
      setClearOpen(false);
      notificationService.success("通知已清空");
    } catch (clearError) {
      notificationService.error(clearError?.message || "清空失败");
    } finally {
      if (mountedRef.current) setClearing(false);
    }
  };

  const markItemRead = async (item) => {
    if (!item?.id || item.readAt) return;
    await markNotificationsRead([item.id]).catch(() => null);
    applyItems(
      itemsRef.current.map((entry) =>
        entry.id === item.id
          ? { ...entry, readAt: new Date().toISOString() }
          : entry,
      ),
    );
    applyUnread(Math.max(0, unread - 1), { source: "mark-items" });
  };

  const openTrialAccess = async (item) => {
    await markItemRead(item);
    const query = new URLSearchParams(location.search);
    query.set("trial", "apply");
    navigate(`${location.pathname}?${query.toString()}${location.hash}`);
  };

  const openItem = (item) => {
    if (String(item?.kind || "").toLowerCase() === "trial_access") {
      void openTrialAccess(item);
      return;
    }
    void markItemRead(item);
    const href = itemHref(item);
    if (href) navigate(href);
  };

  const badge = unread > 99 ? "99+" : String(unread);
  const empty = loaded && !loading && !items.length;
  const emptyUnread = loaded && !loading && items.length > 0 && !visibleItems.length;

  return (
    <div className={`nt-page ${isDark ? "is-dark" : "is-light"}`}>
      <div className="nt-atmosphere" aria-hidden="true">
        <span className="nt-atmosphere__orb nt-atmosphere__orb--a" />
        <span className="nt-atmosphere__orb nt-atmosphere__orb--b" />
      </div>
      <div className="nt-shell">
        <header className="nt-hero">
          <div className="nt-hero__copy">
            <span className="nt-hero__eyebrow">Inbox</span>
            <h1>通知{unread > 0 && <em>{badge}</em>}</h1>
            <p>账号、任务与审核消息集中在这里。</p>
          </div>
          <div className="nt-hero__side">
            <div className="nt-hero__actions">
              <button
                type="button"
                className={`nt-btn${unread > 0 ? " is-primary" : ""}`}
                disabled={marking || unread <= 0}
                onClick={markAllRead}
              >
                全部已读
              </button>
              <button
                type="button"
                className="nt-btn"
                disabled={loading || !items.length || clearing}
                onClick={() => setClearOpen(true)}
              >
                清空
              </button>
              <button
                type="button"
                className="nt-btn"
                disabled={loading}
                onClick={() => loadList()}
              >
                <i className={`bi bi-arrow-repeat${loading ? " spin" : ""}`} />
                刷新
              </button>
            </div>
          </div>
          <div className="nt-hero__filters" role="tablist" aria-label="通知筛选">
            {SCOPE_FILTERS.filter(
              ([id]) => id === "all" || id === "unread" || scopeCounts[id] > 0,
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`nt-filter${scope === id ? " is-active" : ""}`}
                aria-selected={scope === id}
                onClick={() => setScope(id)}
              >
                {label}
                <em>{id === "unread" ? badge : scopeCounts[id]}</em>
              </button>
            ))}
          </div>
        </header>
        <section className="nt-board" aria-live="polite">
          {loading && !items.length ? (
            <div className="nt-skel" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="nt-skel__row" />
              ))}
            </div>
          ) : error && !items.length ? (
            <div className="nt-empty is-error">
              <strong>通知读取失败</strong>
              <p>{error}</p>
              <button
                type="button"
                className="nt-btn"
                onClick={() => loadList()}
              >
                重试
              </button>
            </div>
          ) : dayGroups.length ? (
            <div className="nt-list">
              {dayGroups.map((group) => (
                <section key={group.key} className="nt-day">
                  <header className="nt-day__head">
                    <strong>{group.label}</strong>
                    {group.sublabel && <small>{group.sublabel}</small>}
                    <span>{group.items.length}</span>
                  </header>
                  <ol className="nt-day__items">
                    {group.items.map((item) => {
                      const { title, body } = displayNotification(item);
                      const kind = kindMeta(item);
                      const href = itemHref(item);
                      return (
                      <li
                        key={item.id}
                        className={`nt-item is-${kind.tone}${!item.readAt ? " is-unread" : ""}${href || String(item.kind).toLowerCase() === "trial_access" ? " is-openable" : ""}`}
                        role={href || String(item.kind).toLowerCase() === "trial_access" ? "button" : undefined}
                        tabIndex={href || String(item.kind).toLowerCase() === "trial_access" ? 0 : undefined}
                        onClick={() => openItem(item)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          openItem(item);
                        }}
                      >
                        <span className="nt-item__icon" data-tone={kind.tone}>
                          <i className={`bi ${kind.icon}`} />
                        </span>
                        <div className="nt-item__body" data-no-translate>
                          <div className="nt-item__title-row">
                            <span className="nt-item__kind">{kind.label}</span>
                            <strong>{localizedText(title)}</strong>
                          </div>
                          {body && (
                            <p>
                              {emphasizeParts(body).map((part, index) =>
                                part.highlight ? (
                                  <b key={index} className="nt-hl">
                                    {part.text}
                                  </b>
                                ) : (
                                  <span key={index}>{part.text}</span>
                                ),
                              )}
                            </p>
                          )}
                          <div className="nt-item__aside">
                            <time>{formatClock(item.createdAt)}</time>
                            <div className="nt-item__meta">
                              {extractAmount(item.body) && (
                                <span className="nt-item__amount">
                                  {extractAmount(item.body)}{" "}
                                  <small>{amountUnit(item.body)}</small>
                                </span>
                              )}
                              {!item.readAt && (
                                <span
                                  className="nt-item__dot"
                                  aria-label="未读"
                                />
                              )}
                              {String(item.kind).toLowerCase() ===
                                "trial_access" && (
                                <button
                                  type="button"
                                  className="nt-item__action"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openTrialAccess(item);
                                  }}
                                >
                                  查看体验资格 <i className="bi bi-arrow-right" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              <div
                ref={sentinelRef}
                className="nt-sentinel"
                aria-hidden="true"
              />
              {loadingMore ? (
                <div className="nt-footer-status">加载中…</div>
              ) : cursor ? (
                <div className="nt-footer-status">
                  <button
                    type="button"
                    className="nt-btn nt-more"
                    onClick={() => loadList({ append: true })}
                  >
                    加载更多
                  </button>
                </div>
              ) : items.length ? (
                <div className="nt-footer-status is-end">已加载全部通知</div>
              ) : null}
            </div>
          ) : emptyUnread ? (
            <div className="nt-empty">
              <i className="bi bi-check2-circle" />
              <strong>{scope === "unread" ? "暂无未读" : "暂无此类通知"}</strong>
              <p>
                {scope === "unread"
                  ? "当前消息都已读完，可切回全部查看历史通知。"
                  : "这一类暂时没有消息，可切回全部继续查看。"}
              </p>
            </div>
          ) : empty ? (
            <div className="nt-empty">
              <i className="bi bi-bell" />
              <strong>暂无通知</strong>
              <p>任务进度、审核结果与账号消息会显示在这里。</p>
            </div>
          ) : null}
        </section>
      </div>
      <ConfirmDialog
        open={clearOpen}
        busy={clearing}
        heading="清空全部通知？"
        description="个人通知会删除，全站公告只对你隐藏。之后的新消息仍会进来。"
        confirmLabel="确认清空"
        busyLabel="清空中…"
        light={!isDark}
        onClose={() => !clearing && setClearOpen(false)}
        onConfirm={clearAll}
      />
    </div>
  );
}
