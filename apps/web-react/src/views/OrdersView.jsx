import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import { QRCode } from "antd";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import {
  closeOrder,
  formatPoints,
  formatCents,
  getOrder,
  listOrders,
} from "@react/legacy-modules/services/billingApi.js";
import { refreshWalletSnapshot } from "@react/legacy-modules/services/walletSync.js";
import "./OrdersView.css";

const PAGE_SIZE = 12;
const STATUS_OPTIONS = [
  ["", "全部"],
  ["pending", "待支付"],
  ["uncertain", "待核实"],
  ["paid", "确认中"],
  ["completed", "已完成"],
  ["cancelled", "已取消"],
  ["expired", "已过期"],
  ["failed", "失败"],
];

const STATUS_META = {
  pending: { label: "待支付", tone: "pending" },
  uncertain: { label: "待核实", tone: "confirm" },
  paid: { label: "确认中", tone: "confirm" },
  completed: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "muted" },
  expired: { label: "已过期", tone: "muted" },
  failed: { label: "创建失败", tone: "danger" },
  processing: { label: "处理中", tone: "confirm" },
};

function formatYuan(cents) {
  return formatCents(cents);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(key) {
  if (key === "unknown") return "时间未知";
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(date);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function paymentMethodMeta(method) {
  if (method === "wechat") return { label: "微信支付", short: "微信", tone: "wechat" };
  if (method === "alipay") return { label: "支付宝", short: "支付宝", tone: "alipay" };
  return { label: "在线支付", short: "在线", tone: "online" };
}

function planKindLabel(kind) {
  return kind === "subscription" ? "订阅" : "额度包";
}

function shortOrderId(id) {
  const compact = String(id || "").replace(/-/g, "");
  if (!compact) return "—";
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

function shortPlanName(name) {
  return String(name || "套餐订单");
}

function creditAmount(order, key) {
  return Number(order[`${key}Cents`] ?? order[`${key}Points`] ?? 0);
}

function topupCredits(order) {
  const grant = creditAmount(order, "grant");
  const bonus = creditAmount(order, "bonus");
  return { grant, bonus, total: grant + bonus };
}

function subscriptionEndAt(order) {
  if (order.status !== "completed" || !order.subscriptionEndsAt) return null;
  const time = new Date(order.subscriptionEndsAt).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function isLiveOrder(order) {
  return order && ["pending", "uncertain", "paid"].includes(order.status);
}

function isPaymentExpired(order, now) {
  const remain = remainingMs(order?.expiresAt, now);
  return order?.status === "pending" && remain !== null && remain <= 0;
}

function remainingMs(expiresAt, now) {
  if (!expiresAt) return null;
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return null;
  return time - now;
}

function formatRemaining(ms, compact = false) {
  if (ms == null) return "";
  if (ms <= 0) return "已过期";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const clock = `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  return compact ? clock : `剩余 ${clock}`;
}

function remainTone(ms) {
  if (ms == null) return "";
  if (ms <= 0) return "is-over";
  if (ms <= 60 * 1000) return "is-urgent";
  return "";
}

function orderBenefit(order) {
  if (order.planKind === "subscription") {
    const dailyGrant = Number(order.dailyGrantCents || 0);
    const durationDays = Number(order.durationDays || 0);
    if (dailyGrant > 0 && durationDays > 0) {
      return `每日 ${formatPoints(dailyGrant)} · ${durationDays} 天`;
    }
    return "订阅权益";
  }
  return formatPoints(topupCredits(order).total);
}

function benefitHint(order) {
  if (order.planKind === "subscription") {
    const endsAt = order.status === "completed" ? subscriptionEndAt(order) : null;
    return endsAt ? `本次权益至 ${formatDate(endsAt)}` : null;
  }
  const bonus = topupCredits(order).bonus;
  return bonus > 0 ? `含赠送 ${formatPoints(bonus)}` : null;
}

function rowExtra(order) {
  return benefitHint(order) || orderBenefit(order) || "—";
}

function remainRatio(order, now) {
  if (!order.expiresAt) return 0;
  const end = new Date(order.expiresAt).getTime();
  const start = new Date(order.createdAt).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) return 0;
  return Math.max(0, Math.min(1, (end - now) / (end - start)));
}

function mergeOrderDetails(previous, current) {
  if (!previous) return current;
  if (!current) return previous;
  if (previous.id !== current.id) return current;
  const merged = { ...previous, ...current };
  if (isLiveOrder(current) && !current.payUrl && previous.payUrl) merged.payUrl = previous.payUrl;
  if (!isLiveOrder(current)) merged.payUrl = null;
  if (!current.expiresAt && previous.expiresAt) merged.expiresAt = previous.expiresAt;
  if (!current.payUrl && previous.requiresManualAmount) merged.requiresManualAmount = true;
  for (const key of ["planName", "planKind"]) if (current[key] == null) merged[key] = previous[key];
  merged.syncError = current.syncError || "";
  return merged;
}

function groupOrdersByDay(orders) {
  const groups = [];
  const index = new Map();
  orders.forEach((order) => {
    const key = dayKey(order.createdAt);
    if (!index.has(key)) {
      const group = { key, label: dayLabel(key), items: [] };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).items.push(order);
  });
  return groups;
}

function StatusBadge({ status, remain }) {
  const ended = status === "pending" && remain != null && remain <= 0;
  const meta = ended ? { label: "待确认", tone: "confirm" } : STATUS_META[status] || { label: status || "未知", tone: "muted" };
  const countdown = ended ? "支付已截止" : status === "pending" && remain != null ? formatRemaining(remain, true) : "";
  return (
    <span className={`orders-status is-${meta.tone} ${remainTone(remain)}`}>
      {meta.label}
      {countdown ? <i>{countdown}</i> : null}
    </span>
  );
}

function KindMark({ kind }) {
  return <em className={`order-kind is-${kind === "subscription" ? "sub" : "topup"}`}>{planKindLabel(kind)}</em>;
}

function TicketMeter({ order, now }) {
  if (order.status !== "pending" || !order.expiresAt) return null;
  const remain = remainingMs(order.expiresAt, now);
  return (
    <span className={`order-meter ${remainTone(remain)}`} aria-hidden="true">
      <i style={{ width: `${remainRatio(order, now) * 100}%` }} />
    </span>
  );
}

function CopyableValue({ value, display, copiedValue, onCopy }) {
  if (!value) return <span>—</span>;
  return (
    <button type="button" className="order-id" title={`复制 ${value}`} onClick={(event) => void onCopy(event, value)}>
      <span>{display || value}</span>
      {copiedValue === value ? (
        <span className="order-id__feedback" role="status"><Check size={12} aria-hidden="true" />已复制</span>
      ) : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}

function DetailRow({ label, children, className }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function OrderDetail({ order, copiedValue, onCopy, cancelConfirm, cancelPrompt, onAskCancel }) {
  const credits = topupCredits(order);
  const endsAt = subscriptionEndAt(order);
  const subscription = order.planKind === "subscription";
  const paid = order.payAmountCents ?? order.amountCents;
  const adjusted = Number(paid) !== Number(order.amountCents);
  const result = order.status !== "completed"
    ? null
    : subscription
      ? (order.subscriptionChangeId ? "订阅升级订单已完成，权益时间以本次订单记录为准。" : "订阅订单已完成，权益时间以本次订单记录为准。")
      : credits.bonus > 0
        ? `${formatPoints(credits.total)}已入账，含赠送 ${formatPoints(credits.bonus)}`
        : `${formatPoints(credits.total)}已入账`;

  return (
    <div className="order-sheet">
      <div className={`order-sheet__sum is-${order.status || "unknown"}`}>
        <div className="order-sheet__amount">
        <span>{["paid", "completed"].includes(order.status) ? "实付" : order.status === "pending" ? "应付" : "订单金额"}</span>
        <strong>{formatYuan(paid)}</strong>
        {adjusted ? <p>标价 {formatYuan(order.amountCents)}</p> : null}
        </div>
        {result ? <p className="order-sheet__result">{result}</p> : null}
      </div>
      <section className="order-sheet__group order-sheet__benefits" aria-label="套餐权益">
      <h3>套餐权益</h3>
      <dl>
        {subscription ? (
          <>
            <DetailRow label="每日额度" className="is-metric">
              {Number(order.dailyGrantCents || 0) > 0 ? formatPoints(order.dailyGrantCents) : null}
            </DetailRow>
            <DetailRow label="订阅天数" className="is-metric">
              {Number(order.durationDays || 0) > 0 ? `${order.durationDays} 天` : null}
            </DetailRow>
            <DetailRow label="本次权益生效">{order.subscriptionStartsAt ? formatDate(order.subscriptionStartsAt) : null}</DetailRow>
            <DetailRow label="本次权益到期">
              {endsAt ? formatDate(endsAt) : order.status === "completed" ? "历史记录未提供到期时间" : null}
            </DetailRow>
          </>
        ) : (
          <>
            <DetailRow label={order.status === "completed" ? "到账积分" : "套餐积分"} className="is-metric">{credits.total > 0 ? formatPoints(credits.total) : "—"}</DetailRow>
            <DetailRow label="其中赠送" className="is-metric">{credits.bonus > 0 ? formatPoints(credits.bonus) : "—"}</DetailRow>
          </>
        )}
      </dl>
      </section>
      <section className="order-sheet__group order-sheet__payment" aria-label="支付信息">
      <h3>支付信息</h3>
      <dl>
        <DetailRow label="订单号" className="is-reference">
          <CopyableValue value={order.id} copiedValue={copiedValue} onCopy={onCopy} />
        </DetailRow>
        <DetailRow label="支付方式">{paymentMethodMeta(order.paymentMethod).label}</DetailRow>
        <DetailRow label="渠道单号" className="is-reference">
          {order.providerOrderId
            ? <CopyableValue value={order.providerOrderId} copiedValue={copiedValue} onCopy={onCopy} />
            : "—"}
        </DetailRow>
      </dl>
      </section>
      <section className="order-sheet__group order-sheet__timeline" aria-label="时间记录">
      <h3>时间记录</h3>
      <dl>
        <DetailRow label="创建时间">{formatDate(order.createdAt)}</DetailRow>
        <DetailRow label="付款时间">{formatDate(order.paidAt)}</DetailRow>
        <DetailRow label="完成时间">{formatDate(order.completedAt)}</DetailRow>
        {order.status === "pending" && <DetailRow label="支付截止">{formatDate(order.expiresAt)}</DetailRow>}
      </dl>
      </section>
      {order.planSnapshotAvailable === false && <p className="order-dialog__state">历史订单未保存套餐快照，套餐信息仅供参考，购买金额和积分以订单记录为准。</p>}
      {order.status === "pending" && (
        <div className="order-sheet__foot">
          {order.status === "pending" && !cancelConfirm && (
            <button className="order-sheet__ghost" type="button" onClick={onAskCancel}>取消订单</button>
          )}
          {cancelPrompt}
        </div>
      )}
    </div>
  );
}

export function OrdersView() {
  const { user, loading: authLoading } = useAuth();
  const isDark = useIsDark();
  const controllerRef = useRef(null);
  const historyRef = useRef([]);
  const copiedTimerRef = useRef(0);
  const detailControllerRef = useRef(null);
  const detailVersionRef = useRef(0);
  const selectedIDRef = useRef("");
  const selectedRef = useRef(null);
  const closingRef = useRef(false);
  const cancelConfirmRef = useRef(false);
  const dialogRef = useRef(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState(null);
  const [notice, setNotice] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [closing, setClosing] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [copiedOrderID, setCopiedOrderID] = useState("");
  const [now, setNow] = useState(() => Date.now());
  selectedRef.current = selected;
  cancelConfirmRef.current = cancelConfirm;

  const dismissOrder = useCallback(() => {
    if (closingRef.current) return;
    selectedIDRef.current = "";
    detailVersionRef.current += 1;
    detailControllerRef.current?.abort();
    setSelected(null);
    setDetailLoading(false);
    setDetailRefreshing(false);
  }, []);

  const load = useCallback(
    async (targetCursor = "", { quiet = false } = {}) => {
      if (authLoading) return;
      if (!user?.id) {
        setOrders([]);
        setNextCursor(null);
        setLoading(false);
        return false;
      }
      if (quiet && controllerRef.current) return false;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!quiet) setLoading(true);
      if (!quiet) setError("");
      try {
        const result = await listOrders({
          status,
          query,
          cursor: targetCursor,
          limit: PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted || controllerRef.current !== controller) return false;
        setError("");
        setOrders(result.items);
        setNextCursor(result.nextCursor);
        setSummary(result.summary);
        return true;
      } catch (caught) {
        if (caught?.name !== "AbortError" && controllerRef.current === controller) setError(caught?.message || "订单读取失败");
        return false;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setLoading(false);
        }
      }
    },
    [authLoading, query, status, user?.id],
  );

  const refreshDetails = useCallback(async (id, { initial = false, quiet = false } = {}) => {
    if (closingRef.current || selectedIDRef.current !== id) return;
    if (quiet && detailControllerRef.current) return;
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    const version = ++detailVersionRef.current;
    detailControllerRef.current = controller;
    const previousStatus = selectedRef.current?.status;
    const currentRequest = () => !controller.signal.aborted && selectedIDRef.current === id && detailVersionRef.current === version;
    setDetailLoading(initial);
    setDetailRefreshing(true);
    try {
      const current = await getOrder(id, { signal: controller.signal });
      if (!currentRequest()) return;
      if (!current || current.id !== id) throw new Error("订单详情不匹配，请重新打开");
      setNow(Date.now());
      setSelected(value => value?.id === id ? mergeOrderDetails(value, current) : value);
      setOrders(values => values.map(value => value.id === id ? mergeOrderDetails(value, current) : value));
      setDetailError(current.syncError || "");
      if (current.status !== previousStatus) {
        if (current.status === "completed") void refreshWalletSnapshot().catch(() => null);
        void load(cursor, { quiet: true });
      }
    } catch (caught) {
      if (currentRequest() && caught?.name !== "AbortError") setDetailError(caught?.message || "订单状态读取失败");
    } finally {
      if (currentRequest()) {
        detailControllerRef.current = null;
        setDetailLoading(false);
        setDetailRefreshing(false);
      }
    }
  }, [cursor, load]);

  useEffect(() => {
    closingRef.current = false;
    setClosing(false);
    dismissOrder();
    setSummary(null);
    setNotice("");
    return () => {
      selectedIDRef.current = "";
      detailVersionRef.current += 1;
      detailControllerRef.current?.abort();
    };
  }, [dismissOrder, user?.id]);

  useEffect(() => {
    historyRef.current = [];
    setCursor("");
    setPage(1);
    setOrders([]);
    setNextCursor(null);
    void load("");
    return () => controllerRef.current?.abort();
  }, [load]);

  const hasLiveOrders = orders.some(isLiveOrder);
  useEffect(() => {
    if (!hasLiveOrders) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      if (!document.hidden) await load(cursor, { quiet: true });
      if (!stopped) timer = window.setTimeout(poll, 8000);
    };
    timer = window.setTimeout(poll, 8000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [cursor, hasLiveOrders, load]);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimerRef.current);
  }, []);

  const hasLiveCountdown = orders.some((order) => order.status === "pending" && order.expiresAt)
    || (selected?.status === "pending" && Boolean(selected?.expiresAt));

  useEffect(() => {
    if (!hasLiveCountdown) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveCountdown]);

  useEffect(() => {
    setCancelConfirm(false);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id || !isLiveOrder(selected)) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      if (!document.hidden && !closingRef.current) await refreshDetails(selected.id, { quiet: true });
      if (!stopped) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [refreshDetails, selected?.id, selected?.status]);

  useEffect(() => {
    if (!selected?.id) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    const onKeydown = (event) => {
      if (event.key === "Tab") {
        const targets = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
        const first = targets[0], last = targets.at(-1);
        if (!targets.length) { event.preventDefault(); dialogRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !targets.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !targets.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      if (event.key === "Escape" && !closingRef.current) {
        if (cancelConfirmRef.current) setCancelConfirm(false);
        else dismissOrder();
      }
    };
    dialogRef.current?.querySelector('button[title="关闭"]')?.focus();
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dismissOrder, selected?.id]);

  const pageStats = { awaiting: summary?.pending, confirming: summary?.paid, completed: summary?.completed, expired: summary?.expired };

  const dayGroups = useMemo(() => groupOrdersByDay(orders), [orders]);
  const firstPending = useMemo(
    () => orders.find((order) => order.status === "pending" && !isPaymentExpired(order, now)) || null,
    [now, orders],
  );

  function openOrder(order) {
    setNow(Date.now());
    selectedIDRef.current = order.id;
    setSelected(order);
    setDetailError("");
    void refreshDetails(order.id, { initial: true });
  }

  async function cancelSelected() {
    if (!selected?.id || closingRef.current) return;
    const id = selected.id;
    closingRef.current = true;
    detailVersionRef.current += 1;
    detailControllerRef.current?.abort();
    detailControllerRef.current = null;
    setDetailRefreshing(false);
    setClosing(true);
    setDetailError("");
    try {
      const current = await closeOrder(id);
      if (selectedIDRef.current !== id) return;
      setSelected((value) => value?.id === id ? mergeOrderDetails(value, current) : value);
      setCancelConfirm(false);
      if (current.status === "completed") void refreshWalletSnapshot().catch(() => null);
      void load(cursor, { quiet: true });
    } catch (caught) {
      if (selectedIDRef.current === id) setDetailError(caught?.message || "订单关闭失败");
    } finally {
      if (selectedIDRef.current === id) {
        closingRef.current = false;
        setClosing(false);
      }
    }
  }

  async function copyText(event, value) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedOrderID(value);
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopiedOrderID(""), 1600);
    } catch {
      setNotice("复制失败，请检查浏览器剪贴板权限");
    }
  }

  async function goNext() {
    if (!nextCursor || loading) return;
    const target = nextCursor;
    if (!await load(target)) return;
    historyRef.current.push(cursor);
    setCursor(target);
    setPage((value) => value + 1);
  }

  async function goPrev() {
    if (!historyRef.current.length || loading) return;
    const previous = historyRef.current.at(-1) || "";
    if (!await load(previous)) return;
    historyRef.current.pop();
    setCursor(previous);
    setPage((value) => Math.max(1, value - 1));
  }

  function filterSummary(nextStatus) {
    setSearch("");
    setQuery("");
    setStatus(nextStatus);
  }

  const signedIn = Boolean(user);
  const cancelPrompt = cancelConfirm && selected?.status === "pending" && (
    <div className="order-dialog__confirm" role="alert">
      <div>
        <strong>确认取消订单？</strong>
        <span>取消后当前支付二维码将立即失效。</span>
      </div>
      <div>
        <button type="button" disabled={closing} onClick={() => setCancelConfirm(false)}>再想想</button>
        <button type="button" disabled={closing} onClick={() => void cancelSelected()}>
          {closing ? "取消中" : "确认取消"}
        </button>
      </div>
    </div>
  );

  return (
    <div className={`orders-page${isDark ? " is-dark" : ""}`}>
      <div className="orders-layout">
        <aside className="orders-stage" aria-label="订单概览">
          <div className="orders-stage__card">
            <header className="orders-stage__hero">
              <img src="/pricing/my-orders.webp" alt="" width="96" height="96" decoding="async" />
              <div>
                <span>我的订单</span>
                <button type="button" className="orders-stage__count" onClick={() => filterSummary("pending")}>
                  <strong>{pageStats.awaiting ?? "—"}</strong>
                  <small>笔待支付</small>
                </button>
                <em>套餐购买与到账</em>
              </div>
            </header>

            {signedIn && firstPending ? (
              <button type="button" className="orders-spotlight" onClick={() => void openOrder(firstPending)}>
                <span>待支付订单</span>
                <strong title={firstPending.planName || "套餐订单"}>{shortPlanName(firstPending.planName)}</strong>
                <b>{formatYuan(firstPending.payAmountCents ?? firstPending.amountCents)}</b>
                <small>
                  {orderBenefit(firstPending)}
                  {firstPending.expiresAt ? ` · ${formatRemaining(remainingMs(firstPending.expiresAt, now), true)}` : ""}
                </small>
                <em>去支付</em>
              </button>
            ) : signedIn ? (
              <div className="orders-spotlight is-idle">
                <span>{summary?.pending > 0 ? "还有待处理订单" : "当前列表没有待支付订单"}</span>
                {summary?.pending > 0 ? <button type="button" className="orders-summary-action" onClick={() => filterSummary("pending")}>查看待支付订单</button> : <strong>可以继续创作</strong>}
              </div>
            ) : null}

            {signedIn ? (
              <div className="orders-stage__stats">
                <button type="button" className={status === "completed" ? "is-on" : ""} onClick={() => filterSummary(status === "completed" ? "" : "completed")}>
                  <span>完成</span>
                  <strong>{pageStats.completed ?? "—"}</strong>
                </button>
                <button type="button" className={status === "paid" ? "is-on" : ""} onClick={() => filterSummary(status === "paid" ? "" : "paid")}>
                  <span>确认中</span>
                  <strong>{pageStats.confirming ?? "—"}</strong>
                </button>
                <button type="button" className={status === "expired" ? "is-on" : ""} onClick={() => filterSummary(status === "expired" ? "" : "expired")}>
                  <span>过期</span>
                  <strong>{pageStats.expired ?? "—"}</strong>
                </button>
              </div>
            ) : null}

            <div className="orders-stage__cta">
              <Link to="/wallet">钱包</Link>
              <Link className="is-primary" to="/pricing">查看套餐</Link>
            </div>
          </div>
        </aside>

        <section className="orders-board" aria-label="订单记录">
          {signedIn ? (
            <header className="orders-board__head">
              <div>
                <h2>订单记录</h2>
                <p>{status ? `${STATUS_OPTIONS.find(([value]) => value === status)?.[1] || "筛选"}记录` : "每笔套餐购买都会记在这里"}</p>
              </div>
              <button type="button" className="orders-icon" title="刷新订单" disabled={loading} onClick={() => void load(cursor)}>
                <RefreshCw className={loading ? "is-spinning" : ""} size={16} aria-hidden="true" />
              </button>
            </header>
          ) : null}

          {signedIn ? (
            <form className="orders-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}>
              <Search size={18} aria-hidden="true" />
              <input type="search" aria-label="搜索订单" placeholder="订单号、渠道单号或套餐名称" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} />
              {query && <button type="button" title="清除搜索" aria-label="清除搜索" onClick={() => { setSearch(""); setQuery(""); }}><X size={16} /></button>}
              <button type="submit">搜索</button>
            </form>
          ) : null}

          {signedIn ? (
            <nav className="orders-tabs" aria-label="订单筛选">
              {STATUS_OPTIONS.map(([value, label]) => (
                <button
                  key={value || "all"}
                  type="button"
                  className={status === value ? "is-active" : ""}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </nav>
          ) : null}

          {notice && <div className="orders-alert" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>关闭</button></div>}
          {signedIn && summary?.uncertain > 0 && <div className="orders-alert" role="status"><CircleAlert size={16} aria-hidden="true" /><span>{summary.uncertain} 笔订单正在核实支付结果，请勿重复下单。</span><button type="button" onClick={() => filterSummary("uncertain")}>查看待核实订单</button></div>}

          {signedIn && error ? (
            <div className="orders-alert" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{error}</span>
              <button type="button" onClick={() => void load(cursor)}>重试</button>
            </div>
          ) : null}

          {authLoading ? (
            <div className="orders-loading">
              <LoaderCircle className="is-spinning" size={22} aria-hidden="true" />
              正在确认登录状态
            </div>
          ) : !user ? (
            <section className="orders-empty">
              <LogIn size={22} aria-hidden="true" />
              <strong>登录后查看订单</strong>
              <Link to="/auth?mode=login&redirect=%2Forders">登录账号</Link>
            </section>
          ) : loading && !orders.length ? (
            <div className="orders-loading">
              <LoaderCircle className="is-spinning" size={22} aria-hidden="true" />
              正在读取订单
            </div>
          ) : orders.length ? (
            <div className="orders-scroll">
              <div className="orders-table">
                <div className="orders-cols" aria-hidden="true">
                  <span>状态</span>
                  <span>方式</span>
                  <span>金额</span>
                  <span>类型</span>
                  <span>套餐</span>
                  <span>说明</span>
                  <span>订单号</span>
                  <span>创建</span>
                  <span>付款</span>
                  <span>完成</span>
                </div>
                {dayGroups.map((group) => (
                  <section className="orders-day" key={group.key}>
                    <h3>{group.label}<em>{group.items.length}</em></h3>
                    <div className="orders-list">
                      {group.items.map((order) => {
                        const actualAmount = order.payAmountCents ?? order.amountCents;
                        const remain = order.status === "pending" ? remainingMs(order.expiresAt, now) : null;
                        return (
                          <div
                            className={`orders-row is-${order.status || "unknown"}`}
                            key={order.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openOrder(order)}
                            onKeyDown={(event) => {
                              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                event.preventDefault();
                                void openOrder(order);
                              }
                            }}
                          >
                            <StatusBadge status={order.status} remain={remain} />
                            <span className="orders-row__method">{paymentMethodMeta(order.paymentMethod).short}</span>
                            <b>{formatYuan(actualAmount)}</b>
                            <span className={`orders-row__kind is-${order.planKind === "subscription" ? "sub" : "topup"}`}>
                              {planKindLabel(order.planKind)}
                            </span>
                            <strong title={order.planName || "套餐订单"}>{shortPlanName(order.planName)}</strong>
                            <small>{rowExtra(order)}</small>
                            <button
                              type="button"
                              className="orders-row__id"
                              title={order.id ? `复制 ${order.id}` : undefined}
                              disabled={!order.id}
                              onClick={(event) => void copyText(event, order.id)}
                            >
                              <span>{shortOrderId(order.id)}</span>
                              {order.id && copiedOrderID === order.id ? (
                                <em>已复制</em>
                              ) : order.id ? <Copy size={11} aria-hidden="true" /> : null}
                            </button>
                            <time className="orders-row__time" dateTime={order.createdAt || undefined}>{formatDate(order.createdAt)}</time>
                            <span className="orders-row__time">{formatDate(order.paidAt)}</span>
                            <span className="orders-row__time">{formatDate(order.completedAt)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <section className="orders-empty">
              <ShoppingBag size={22} aria-hidden="true" />
              <strong>{error ? "订单暂时无法加载" : query || status ? "当前筛选没有订单" : "还没有套餐订单"}</strong>
              <Link to="/pricing">查看套餐</Link>
            </section>
          )}

          {signedIn ? (
            <footer className="orders-pager" data-click-guard="repeat">
              <span>第 {page} 页{orders.length ? ` · ${orders.length} 条` : ""}{summary && !query && !status ? ` · 共 ${summary.total} 笔` : ""}</span>
              <div>
                <button type="button" className="orders-icon" title="上一页" disabled={!historyRef.current.length || loading} onClick={goPrev}>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button type="button" className="orders-icon" title="下一页" disabled={!nextCursor || loading} onClick={goNext}>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          ) : null}
        </section>
      </div>

      {selected && createPortal(
        <div className={`order-dialog${isDark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && dismissOrder()}>
          <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="order-dialog-title">
            <header>
              <div className="order-dialog__lead">
                <div className="order-dialog__tags">
                  <StatusBadge
                    status={selected.status}
                    remain={selected.status === "pending" ? remainingMs(selected.expiresAt, now) : null}
                  />
                  <KindMark kind={selected.planKind} />
                </div>
                <h2 id="order-dialog-title">{selected.planName || "订单详情"}</h2>
              </div>
              <div className="order-dialog__tools">
              <button type="button" title="刷新订单状态" aria-label="刷新订单状态" disabled={closing || detailRefreshing} onClick={() => void refreshDetails(selected.id)}>
                <RefreshCw size={17} className={detailRefreshing ? "is-spinning" : ""} aria-hidden="true" />
              </button>
              <button type="button" title="关闭" aria-label="关闭" disabled={closing} onClick={dismissOrder}>
                <X size={18} aria-hidden="true" />
              </button>
              </div>
            </header>
            <div className="order-dialog__body">
            {detailLoading ? (
              <div className="order-dialog__loading"><LoaderCircle className="is-spinning" size={22} /> 正在读取支付状态</div>
            ) : selected.status === "pending" && selected.payUrl && !isPaymentExpired(selected, now) && !detailError && !selected.syncError ? (
              <div className="order-dialog__payment">
                <div className="order-dialog__qr">
                  <QRCode value={String(selected.payUrl)} size={180} bordered={false} />
                  <span>打开{paymentMethodMeta(selected.paymentMethod).label}扫一扫</span>
                </div>
                <div className="order-dialog__paycopy">
                  <span>应付金额</span>
                  <strong>{formatYuan(selected.payAmountCents ?? selected.amountCents)}</strong>
                  <p>{planKindLabel(selected.planKind)} · {orderBenefit(selected)}</p>
                  <p>创建 {formatDate(selected.createdAt)}</p>
                  {selected.expiresAt ? (
                    <>
                      <small className={`orders-remain ${remainTone(remainingMs(selected.expiresAt, now))}`}>
                        {formatRemaining(remainingMs(selected.expiresAt, now))}
                        {` · ${formatDate(selected.expiresAt)} 截止`}
                      </small>
                      <TicketMeter order={selected} now={now} />
                    </>
                  ) : null}
                  {selected.requiresManualAmount ? <p className="is-warn">扫码后请手动输入页面显示的应付金额，金额必须完全一致。</p> : null}
                  <div className="order-dialog__actions">
                    <a href={selected.payUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />打开支付</a>
                    {!cancelConfirm && <button type="button" onClick={() => setCancelConfirm(true)}>取消订单</button>}
                  </div>
                  {cancelPrompt}
                </div>
              </div>
            ) : (
              <OrderDetail
                order={selected}
                copiedValue={copiedOrderID}
                onCopy={copyText}
                cancelConfirm={cancelConfirm}
                cancelPrompt={cancelPrompt}
                onAskCancel={() => setCancelConfirm(true)}
              />
            )}
            {!detailLoading && isPaymentExpired(selected, now) && <div className="order-dialog__state" role="status">支付时间已截止，二维码已停止展示。请刷新确认最终支付状态。</div>}
            {!detailLoading && selected.status === "paid" && <div className="order-dialog__state" role="status">已收到付款，正在确认积分到账，请勿重复支付。</div>}
            {!detailLoading && selected.status === "uncertain" && <div className="order-dialog__state" role="status">订单已记录，支付渠道结果正在核实。请勿重复下单；如需人工核查，请提供平台订单号和渠道交易记录。</div>}
            {!detailLoading && selected.status === "pending" && !selected.payUrl && !isPaymentExpired(selected, now) && <div className="order-dialog__state" role="status">支付链接暂不可用，请刷新订单状态。</div>}
            {["cancelled", "expired", "failed"].includes(selected.status) && <div className="order-dialog__state"><Link to="/pricing">重新选择套餐</Link></div>}
            {detailError && <div className="order-dialog__error" role="alert">{detailError}<button type="button" disabled={detailRefreshing || closing} onClick={() => void refreshDetails(selected.id)}>重试</button></div>}
            </div>
            {!detailLoading && selected.status === "completed" && <footer className="order-dialog__footer">
              {selected.planKind === "subscription" && <Link className="order-sheet__cta" to="/subscriptions">查看我的订阅</Link>}
              <Link className={selected.planKind === "subscription" ? "order-sheet__ghost" : "order-sheet__cta"} to="/wallet">查看钱包明细</Link>
            </footer>}
          </section>
        </div>, document.body
      )}
    </div>
  );
}
