import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { QRCode } from "antd";
import {
	BadgeCheck,
	Check,
	ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
	LoaderCircle,
	LogIn,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  WalletCards,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import {
  closeOrder,
  formatCents,
  formatPoints,
  getOrder,
  listOrders,
} from "@react/legacy-modules/services/billingApi.js";
import { refreshWalletSnapshot } from "@react/legacy-modules/services/walletSync.js";
import "@react/legacy-styles/generated/views/OrdersView.css";

const PAGE_SIZE = 12;
const STATUS_OPTIONS = [
  ["", "全部"],
  ["pending", "待支付"],
  ["completed", "已完成"],
  ["expired", "已失效"],
  ["failed", "失败"],
];

const STATUS_META = {
  pending: { label: "待支付", tone: "pending", icon: Clock3 },
  paid: { label: "确认中", tone: "pending", icon: RefreshCw },
  completed: { label: "已完成", tone: "success", icon: BadgeCheck },
  expired: { label: "已失效", tone: "muted", icon: CircleAlert },
  failed: { label: "创建失败", tone: "danger", icon: CircleAlert },
};

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

function shortOrderID(id) {
  const value = String(id || "");
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—";
}

function paymentMethodLabel(method) {
  if (method === "wechat") return "微信支付";
  if (method === "alipay") return "支付宝";
  return "在线支付";
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
	return formatPoints(Number(order.grantCents || 0) + Number(order.bonusCents || 0));
}

function mergeOrderDetails(previous, current) {
	if (!previous) return current;
	if (!current) return previous;
	const merged = { ...previous, ...current };
	if (!current.payUrl && previous.payUrl) merged.payUrl = previous.payUrl;
	if (!current.expiresAt && previous.expiresAt) merged.expiresAt = previous.expiresAt;
	if (!current.payUrl && previous.requiresManualAmount) merged.requiresManualAmount = true;
	return merged;
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || "未知", tone: "muted", icon: CircleAlert };
  const Icon = meta.icon;
  return (
    <span className={`orders-status is-${meta.tone}`}>
      <Icon size={14} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function OrdersView() {
	const { user, loading: authLoading } = useAuth();
	const isDark = useIsDark();
	const controllerRef = useRef(null);
	const historyRef = useRef([]);
	const copiedTimerRef = useRef(0);
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState("");
	const [closing, setClosing] = useState(false);
	const [cancelConfirm, setCancelConfirm] = useState(false);
	const [copiedOrderID, setCopiedOrderID] = useState("");

  const load = useCallback(
		async (targetCursor = "", { quiet = false } = {}) => {
			if (authLoading) return;
			if (!user?.id) {
				setOrders([]);
				setNextCursor(null);
				setLoading(false);
				return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!quiet) setLoading(true);
      setError("");
      try {
        const result = await listOrders({
          status,
          cursor: targetCursor,
          limit: PAGE_SIZE,
          signal: controller.signal,
        });
        setOrders(result.items);
        setNextCursor(result.nextCursor);
      } catch (caught) {
        if (caught?.name !== "AbortError") setError(caught?.message || "订单读取失败");
      } finally {
        if (controllerRef.current === controller) setLoading(false);
      }
    },
		[authLoading, status, user?.id],
	);

  useEffect(() => {
    historyRef.current = [];
    setCursor("");
    setPage(1);
    void load("");
    return () => controllerRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!orders.some((order) => order.status === "pending" || order.status === "paid")) return undefined;
    const timer = window.setInterval(() => void load(cursor, { quiet: true }), 8000);
    return () => window.clearInterval(timer);
  }, [cursor, load, orders]);

	useEffect(() => {
		return () => window.clearTimeout(copiedTimerRef.current);
	}, []);

	useEffect(() => {
		setCancelConfirm(false);
	}, [selected?.id]);

	useEffect(() => {
		if (!selected?.id || !["pending", "paid"].includes(selected.status)) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
				const current = await getOrder(selected.id);
				if (stopped) return;
		setSelected((value) => (value?.id === current.id ? mergeOrderDetails(value, current) : value));
				if (!["pending", "paid"].includes(current.status)) {
					if (current.status === "completed") void refreshWalletSnapshot().catch(() => null);
					void load(cursor, { quiet: true });
				}
      } catch (caught) {
        if (!stopped) setDetailError(caught?.message || "订单状态确认失败");
      }
    };
    const timer = window.setInterval(poll, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [cursor, load, selected?.id, selected?.status]);

  useEffect(() => {
    if (!selected) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeydown = (event) => {
			if (event.key !== "Escape" || closing) return;
			if (cancelConfirm) setCancelConfirm(false);
			else setSelected(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeydown);
    };
	}, [cancelConfirm, closing, selected]);

  const pageStats = useMemo(
    () => ({
      pending: orders.filter((order) => ["pending", "paid"].includes(order.status)).length,
      completed: orders.filter((order) => order.status === "completed").length,
    }),
    [orders],
  );

  async function openOrder(order) {
    setSelected(order);
    setDetailError("");
    if (!["pending", "paid"].includes(order.status)) return;
    setDetailLoading(true);
    try {
		const current = await getOrder(order.id);
		setSelected((value) => mergeOrderDetails(value, current));
		if (!["pending", "paid"].includes(current.status)) {
			if (current.status === "completed" && order.status !== "completed") {
				void refreshWalletSnapshot().catch(() => null);
			}
			void load(cursor, { quiet: true });
		}
    } catch (caught) {
      setDetailError(caught?.message || "订单状态读取失败");
    } finally {
      setDetailLoading(false);
    }
  }

	async function cancelSelected() {
		if (!selected?.id || closing) return;
		setClosing(true);
    setDetailError("");
    try {
			const current = await closeOrder(selected.id);
			setSelected((value) => ({ ...value, ...current }));
			setCancelConfirm(false);
      await load(cursor, { quiet: true });
    } catch (caught) {
      setDetailError(caught?.message || "订单关闭失败");
		} finally {
			setClosing(false);
		}
	}

	async function copyOrderID(orderID) {
		try {
			await navigator.clipboard.writeText(orderID);
			setCopiedOrderID(orderID);
			window.clearTimeout(copiedTimerRef.current);
			copiedTimerRef.current = window.setTimeout(() => setCopiedOrderID(""), 1600);
		} catch {
			setError("订单号复制失败，请稍后重试");
		}
	}

  function goNext() {
    if (!nextCursor || loading) return;
    historyRef.current.push(cursor);
    setCursor(nextCursor);
    setPage((value) => value + 1);
    void load(nextCursor);
  }

	function goPrev() {
    if (!historyRef.current.length || loading) return;
    const previous = historyRef.current.pop() || "";
    setCursor(previous);
    setPage((value) => Math.max(1, value - 1));
		void load(previous);
	}

	const cancelPrompt = cancelConfirm && selected?.status === "pending" && (
		<div className="order-dialog__confirm" role="alert">
			<div>
				<strong>确认取消订单？</strong>
				<span>取消后当前支付二维码将立即失效。</span>
			</div>
			<div>
				<button type="button" disabled={closing} onClick={() => setCancelConfirm(false)}>返回支付</button>
				<button type="button" disabled={closing} onClick={() => void cancelSelected()}>
					{closing ? "取消中" : "确认取消"}
				</button>
			</div>
		</div>
	);

	return (
    <div className={`orders-page${isDark ? " is-dark" : ""}`}>
      <div className="orders-shell">
        <header className="orders-head">
          <div>
            <span className="orders-eyebrow">账户与交易</span>
            <h1>我的订单</h1>
            <p>查看套餐购买、支付状态和权益到账记录</p>
          </div>
          <div className="orders-head__actions">
            <Link className="orders-button is-secondary" to="/wallet">
              <WalletCards size={17} aria-hidden="true" />
              我的钱包
            </Link>
            <Link className="orders-button is-primary" to="/pricing">
              <ShoppingBag size={17} aria-hidden="true" />
              购买套餐
            </Link>
          </div>
        </header>

		{user && <section className="orders-toolbar" aria-label="订单筛选">
          <div className="orders-tabs" role="tablist">
            {STATUS_OPTIONS.map(([value, label]) => (
              <button
                key={value || "all"}
                type="button"
                role="tab"
                aria-selected={status === value}
                className={status === value ? "is-active" : ""}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="orders-page-meta">
            <span>本页 {orders.length} 笔</span>
            {pageStats.pending > 0 && <span className="is-pending">待处理 {pageStats.pending}</span>}
            {pageStats.completed > 0 && <span className="is-success">已完成 {pageStats.completed}</span>}
            <button type="button" title="刷新订单" onClick={() => void load(cursor)} disabled={loading}>
              <RefreshCw className={loading ? "is-spinning" : ""} size={16} aria-hidden="true" />
            </button>
          </div>
		</section>}

		{user && error && (
          <div className="orders-alert" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" onClick={() => void load(cursor)}>重试</button>
          </div>
        )}

		{authLoading ? (
			<div className="orders-loading">
				<LoaderCircle className="is-spinning" size={24} aria-hidden="true" />
				正在确认登录状态
			</div>
		) : !user ? (
			<section className="orders-auth">
				<LogIn size={28} aria-hidden="true" />
				<strong>登录后查看订单</strong>
				<span>支付状态和套餐到账记录会保存在你的账户中</span>
				<Link to="/auth?mode=login&redirect=%2Forders">登录账号</Link>
			</section>
		) : loading && !orders.length ? (
          <div className="orders-loading">
            <LoaderCircle className="is-spinning" size={24} aria-hidden="true" />
            正在读取订单
          </div>
        ) : orders.length ? (
          <section className="orders-list" aria-live="polite">
            {orders.map((order) => {
              const actualAmount = order.payAmountCents ?? order.amountCents;
              const adjusted = Number(actualAmount) !== Number(order.amountCents);
              return (
                <article className="order-row" key={order.id}>
                  <div className="order-row__identity">
                    <div className="order-row__icon"><PackageCheck size={20} aria-hidden="true" /></div>
                    <div>
                      <strong>{order.planName || "套餐订单"}</strong>
                      <button
                        type="button"
                        className="order-id"
                        title="复制订单号"
						onClick={() => void copyOrderID(order.id)}
					>
						<span>{shortOrderID(order.id)}</span>
						{copiedOrderID === order.id ? (
							<span className="order-id__feedback" role="status"><Check size={12} aria-hidden="true" />已复制</span>
						) : <Copy size={12} aria-hidden="true" />}
					</button>
                    </div>
                  </div>
                  <div className="order-row__cell">
                    <span>权益</span>
                    <strong>{orderBenefit(order)}</strong>
                  </div>
                  <div className="order-row__cell">
                    <span>实付金额</span>
                    <strong>{formatCents(actualAmount)}</strong>
                    {adjusted && <small>标价 {formatCents(order.amountCents)}</small>}
                  </div>
                  <div className="order-row__cell">
                    <span>支付方式</span>
                    <strong>{paymentMethodLabel(order.paymentMethod)}</strong>
                  </div>
                  <div className="order-row__cell">
                    <span>创建时间</span>
                    <strong>{formatDate(order.createdAt)}</strong>
                  </div>
                  <div className="order-row__state">
                    <StatusBadge status={order.status} />
                    <button type="button" onClick={() => void openOrder(order)}>
                      {order.status === "pending" ? "继续支付" : "查看详情"}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="orders-empty">
            <ShoppingBag size={28} aria-hidden="true" />
            <strong>{status ? "当前筛选没有订单" : "还没有套餐订单"}</strong>
            <Link to="/pricing">查看套餐</Link>
          </section>
        )}

		{user && <footer className="orders-pager">
          <span>第 {page} 页</span>
          <div>
            <button type="button" title="上一页" disabled={!historyRef.current.length || loading} onClick={goPrev}>
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <button type="button" title="下一页" disabled={!nextCursor || loading} onClick={goNext}>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
		</footer>}
      </div>

      {selected && (
		<div className="order-dialog" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !closing && setSelected(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="order-dialog-title">
            <header>
              <div>
                <StatusBadge status={selected.status} />
                <h2 id="order-dialog-title">{selected.planName || "订单详情"}</h2>
              </div>
				<button type="button" title="关闭" disabled={closing} onClick={() => setSelected(null)}><X size={19} aria-hidden="true" /></button>
            </header>
            {detailLoading ? (
              <div className="order-dialog__loading"><LoaderCircle className="is-spinning" size={22} /> 正在读取支付状态</div>
            ) : selected.status === "pending" && selected.payUrl ? (
              <div className="order-dialog__payment">
                <div className="order-dialog__qr"><QRCode value={String(selected.payUrl)} size={204} bordered={false} /></div>
                <div className="order-dialog__amount">
                  <span>应付金额</span>
                  <strong>{formatCents(selected.payAmountCents ?? selected.amountCents)}</strong>
                  <small>{paymentMethodLabel(selected.paymentMethod)}</small>
                  {selected.expiresAt && <small>有效期至 {formatDate(selected.expiresAt)}</small>}
                </div>
			{selected.requiresManualAmount && <p>扫码后请手动输入页面显示的应付金额，金额必须完全一致</p>}
				<div className="order-dialog__actions">
					<a href={selected.payUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />打开支付</a>
					{!cancelConfirm && <button type="button" onClick={() => setCancelConfirm(true)}>取消订单</button>}
				</div>
				{cancelPrompt}
              </div>
            ) : (
              <div className="order-dialog__detail">
                <dl>
                  <div><dt>订单号</dt><dd>{selected.id}</dd></div>
                  <div><dt>套餐权益</dt><dd>{orderBenefit(selected)}</dd></div>
                  <div><dt>订单标价</dt><dd>{formatCents(selected.amountCents)}</dd></div>
                  <div><dt>实际支付</dt><dd>{formatCents(selected.payAmountCents ?? selected.amountCents)}</dd></div>
                  <div><dt>支付方式</dt><dd>{paymentMethodLabel(selected.paymentMethod)}</dd></div>
                  <div><dt>创建时间</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                  <div><dt>完成时间</dt><dd>{formatDate(selected.completedAt)}</dd></div>
                </dl>
                {selected.status === "completed" && <Link to="/wallet">查看钱包明细</Link>}
				{selected.status === "pending" && (
					<>
						{!cancelConfirm && <button className="order-dialog__cancel" type="button" onClick={() => setCancelConfirm(true)}>取消订单</button>}
						{cancelPrompt}
					</>
				)}
              </div>
            )}
            {detailError && <div className="order-dialog__error">{detailError}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
