import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { apiGet, apiPost } from "../legacy-modules/services/apiClient.js";
import {
  formatCents,
  formatPoints,
} from "../legacy-modules/services/billingApi.js";
import "./subscriptions.css";
import { SubscriptionUpgradeCheckout } from "./SubscriptionUpgradeCheckout.jsx";

const statusNames = {
  active: "已订阅",
  expired: "已到期",
  refunding: "退订处理中",
  cancelled: "已退订",
  reviewing: "审核中",
  processing: "退款处理中",
  completed: "已完成",
  rejected: "申请未通过",
  pending: "待支付",
  quoted: "待确认",
};
const scenes = {
  text_to_image: "文生图",
  ai_assistant: "AI 助手",
  ui_design: "UI 设计",
  ecommerce_design: "电商创作",
  illustration_coloring: "插画上色",
  model_sheet: "角色设定",
  game_art: "游戏美术",
  background_remove: "背景移除",
  infinite_canvas: "无限画布",
};
const date = (value) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const shortDate = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
function remaining(value, now) {
  const seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
  if (!Number.isFinite(seconds)) return "—";
  if (!seconds) return "待重置";
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function remainLabel(endsAt, now) {
  const ms = Date.parse(endsAt) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "已到期";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 1) return `剩余 ${days} 天`;
  if (days === 1) return hours ? `剩余 1 天 ${hours} 小时` : "剩余 1 天";
  if (hours >= 1) return `剩余 ${hours} 小时`;
  return "即将到期";
}
function grantKind(item) {
  if (item.kind === "initial") return "开通发放";
  if (item.kind === "upgrade") return "升级补差额";
  if (item.kind === "legacy") return "历史日发放";
  if (Date.parse(item.grantedAt) - Date.parse(item.scheduledAt) > 300000) return "补发";
  return "周期发放";
}
export function SubscriptionsView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const dark = useIsDark();
  const [searchParams, setSearchParams] = useSearchParams();
  const upgradeQuoteId = searchParams.get("upgrade");
  const openUpgradePayment = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("upgrade", id);
    setDialog(null);
    setSearchParams(next);
  };
  const closeUpgradePayment = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("upgrade");
    next.delete("target");
    setSearchParams(next, { replace: true });
    setVersion(value => value + 1);
  };
  const [snapshot, setData] = useState({ items: [], changes: [] });
  const data =
    snapshot.userId === user?.id ? snapshot : { items: [], changes: [] };
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState(searchParams.get("view") === "changes" ? "changes" : "grants");
  const [grants, setGrants] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMounted, setPickerMounted] = useState(false);
  const [pickerBox, setPickerBox] = useState(null);
  const pickerRef = useRef(null);
  const menuRef = useRef(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clientClock, setClock] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const clock = clientClock + clockOffset;
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const userRef = useRef(user?.id);
  userRef.current = user?.id;

  useEffect(() => {
    setData({ items: [], changes: [] });
    setSelected("");
    setPickerOpen(false);
    setPickerMounted(false);
    setDialog(null);
    setBusy(false);
    setDialogError("");
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    apiGet("/me/subscriptions", { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return;
        setData({ ...next, userId: user.id });
        setClockOffset(
          next.serverTime ? Date.parse(next.serverTime) - Date.now() : 0,
        );
        setSelected((id) =>
          next.items.some((item) => item.id === id)
            ? id
            : (
                next.items.find((item) =>
                  ["active", "refunding"].includes(item.status),
                ) || next.items[0]
              )?.id || "",
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user?.id, version]);
  useEffect(() => {
    if (!selected || !user?.id) return;
    const controller = new AbortController();
    setGrants({ items: [], total: 0 });
    apiGet(`/me/subscriptions/${selected}/grants`, {
      query: { page },
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setGrants(next);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [selected, page, version, user?.id]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setVersion((v) => v + 1);
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const current = data.items.find((item) => item.id === selected);
  const requestedSubscription = searchParams.get("subscription");
  const appliedLinkRef = useRef("");
  useEffect(() => {
    if (!user?.id || snapshot.userId !== user.id) return;
    const key = JSON.stringify([user.id, requestedSubscription, searchParams.get("view")]);
    if (appliedLinkRef.current === key) return;
    if (requestedSubscription && data.items.some(item => item.id === requestedSubscription)) { setSelected(requestedSubscription); setPage(1); }
    if (searchParams.get("view") === "changes") setTab("changes");
    appliedLinkRef.current = key;
  }, [requestedSubscription, snapshot.userId, snapshot.items, searchParams]);
  useEffect(() => {
    if (!pickerMounted) {
      setPickerBox(null);
      setPickerOpen(false);
      return undefined;
    }
    const place = () => {
      const trigger = pickerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const top = rect.bottom + 6;
      const maxHeight = Math.min(280, Math.max(120, window.innerHeight - top - 12));
      setPickerBox({ top, left, width, maxHeight });
    };
    place();
    const frame = window.requestAnimationFrame(() => setPickerOpen(true));
    const close = (event) => {
      if (
        pickerRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      )
        return;
      closePicker();
    };
    const onKey = (event) => {
      if (event.key === "Escape") closePicker();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerMounted]);
  const changes = data.changes.filter(
    (change) => change.subscriptionId === selected,
  );
  const cancelled = current?.status === "cancelled";
  const stopped = cancelled || current?.status === "expired";
  const nextGrantAt = current?.status === "active" && !current?.upgrading ? current.nextGrantAt : null;
  const cycleDeadline = nextGrantAt || (current?.billingVersion === 2 && current.status === "active" && !current.upgrading ? current.endsAt : null);
  const completedRefund = changes.find(change => change.kind === "refund" && change.status === "completed");
  const latestUpgrade = changes.find(change => change.kind === "upgrade" && change.status === "completed" && change.targetPlanId === current?.planId);
  const usageSplitKnown = Number.isFinite(current?.currentTermSpentPoints) && Number.isFinite(current?.priorTermSpentPoints);
  const historicalUsageOnly = usageSplitKnown && current.currentTermSpentPoints === 0 && current.priorTermSpentPoints > 0;
  const refundLabel = current?.spentPoints > 0
    ? historicalUsageOnly ? '升级前已使用积分，退款需人工处理' : '已使用积分，退款需人工处理'
    : '申请退订';
  const changing = changes.some((change) =>
    ["reviewing", "processing", "pending"].includes(change.status),
  );
  const closePicker = () => {
    setPickerOpen(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPickerMounted(false);
    }
  };

  async function openRefund() {
    const owner = user?.id;
    setBusy(true);
    setDialogError("");
    try {
      const preview = await apiGet(
        `/me/subscriptions/${current.id}/refund-preview`,
      );
      if (userRef.current === owner) setDialog({ kind: "refund", subId: current.id, reason: "", preview });
    } catch (err) {
      if (userRef.current === owner) setError(err.message);
    } finally {
      if (userRef.current === owner) setBusy(false);
    }
  }
  async function submit() {
    const owner = user?.id;
    setBusy(true);
    setDialogError("");
    try {
      await apiPost(`/me/subscriptions/${dialog.subId}/refund`, { reason: dialog.reason });
      if (userRef.current !== owner) return;
      setDialog(null);
      setTab("changes");
      setVersion((v) => v + 1);
      window.dispatchEvent(new CustomEvent("starclouds:notifications-updated", { detail: { source: "subscription-change" } }));
    } catch (err) {
      if (userRef.current === owner) setDialogError(err.message);
    } finally {
      if (userRef.current === owner) setBusy(false);
    }
  }

  const availableLabel =
    current?.availablePoints === null
      ? "历史通用余额"
      : formatPoints(current?.availablePoints, { withUnit: false });

  return (
    <main className={`subscription-center${dark ? " is-dark" : ""}`}>
      {!user ? (
        <section className="subscription-empty">
          <h1>我的订阅</h1>
          <p>登录后查看发放、适用范围和变更记录</p>
          <Link className="subscription-btn is-primary" to="/auth">登录</Link>
        </section>
      ) : loading && !data.items.length ? (
        <div className="subscription-skel" role="status" aria-label="正在读取订阅">
          <div className="subscription-skel__aside" />
          <div className="subscription-skel__panel" />
        </div>
      ) : error && !data.items.length ? (
        <section className="subscription-empty">
          <h1>我的订阅</h1>
          <p className="subscription-error" role="alert">{error}</p>
          <button type="button" className="subscription-btn" onClick={() => setVersion(v => v + 1)}>重新读取</button>
        </section>
      ) : !data.items.length ? (
        <section className="subscription-empty">
          <Coins size={36} aria-hidden="true" />
          <h1>我的订阅</h1>
          <h2>暂无订阅</h2>
          <Link className="subscription-btn is-primary" to="/pricing?plan=subscription">选择订阅方案</Link>
        </section>
      ) : current ? (
        <div className="subscription-layout">
          <aside className="subscription-aside" aria-label="订阅概览">
            <div className="subscription-aside__card">
              <div className="subscription-aside__content" tabIndex={0} role="region" aria-label="订阅详情">
              <header className="subscription-hero">
                <img src="/pricing/my-subscription-v2.webp" alt="" width="96" height="96" decoding="async" />
                <div>
                  <h1>我的订阅</h1>
                  {current.billingVersion === 2 ? <small>本期可用额度</small> : null}
                  <p className="subscription-hero__amount">
                    <strong>{availableLabel}</strong>
                    {current.availablePoints !== null ? <small>积分</small> : null}
                  </p>
                  <p className="subscription-hero__meta">
                    <span className={`subscription-status is-${current.status}`}>
                      {current.upgrading ? "升级待支付" : statusNames[current.status]}
                    </span>
                    <em>{current.planName}</em>
                  </p>
                  <small>
                    {current.status === "cancelled" ? "原有效期：" : ""}
                    {shortDate(current.startsAt)} 至 {shortDate(current.endsAt)}
                    {current.status === "active" && current.endsAt ? ` · ${remainLabel(current.endsAt, clock)}` : ""}
                  </small>
                </div>
              </header>

              {latestUpgrade?.snapshot?.sourcePlan && <div className="subscription-upgrade-origin">
                <span>升级来源：{latestUpgrade.snapshot.sourcePlan.planName}</span>
                <button type="button" onClick={() => setTab("changes")}>查看升级记录</button>
              </div>}

              <div className="subscription-spotlight">
                <span>{stopped || current.status === "refunding" || current.upgrading ? "订阅状态" : !nextGrantAt && cycleDeadline ? "本期到期" : "下一次重置"}</span>
                <p className={`subscription-countdown${stopped || current.status === "refunding" || current.upgrading ? " is-status" : ""}`}>
                  {current.upgrading ? "升级待支付" : stopped || current.status === "refunding" ? statusNames[current.status] : cycleDeadline ? (
                    <>
                      <Clock3 size={22} aria-hidden="true" />
                      {remaining(cycleDeadline, clock)}
                    </>
                  ) : (
                    "—"
                  )}
                </p>
                <small>
                  {cycleDeadline
                    ? `${shortDate(cycleDeadline)} · 未用额度到期失效`
                    : current.upgrading ? "旧积分已锁定，暂停发放；取消升级订单后恢复"
                    : current.status === "refunding"
                      ? "退订处理中，暂停发放"
                      : current.status === "cancelled" ? "已退订，后续发放已停止" : current.status === "expired" ? "订阅已到期" : ""}
                  {cancelled && completedRefund?.completedAt ? ` · ${shortDate(completedRefund.completedAt)}` : ""}
                </small>
              </div>

              {error ? (
                <p className="subscription-error" role="alert">{error}</p>
              ) : null}

              <dl className="subscription-metrics" aria-label="订阅额度">
                <div>
                  <img src="/usage-plan/reward-coin.webp" alt="" width="44" height="44" decoding="async" />
                  <dt>{stopped ? "原周期额度" : current.billingVersion === 2 ? "每天额度" : "历史每日发放"}</dt>
                  <dd className="subscription-points">{formatPoints(current.dailyPoints)}</dd>
                  {stopped ? <small>已停止发放</small> : current.billingVersion === 2 ? <small>到期重置，不累计</small> : null}
                </div>
                <div>
                  <img src="/failure-compensation/step-bonus.webp" alt="" width="44" height="44" decoding="async" />
                  <dt>历史发放合计</dt>
                  <dd className="subscription-points">{formatPoints(current.issuedPoints)}</dd>
                  <small>
                    {stopped ? `已发放 ${current.grantedCycles || 0} 期` : <>本轮 {current.grantedCycles}{current.totalCycles ? ` / ${current.totalCycles}` : ""} 期</>}
                  </small>
                </div>
                <div className={current.frozenPoints > 0 ? "is-warn" : ""}>
                  <img src="/failure-compensation/step-fail.webp" alt="" width="44" height="44" decoding="async" />
                  <dt>{cancelled ? "退订已回收" : "冻结中"}</dt>
                  <dd>{cancelled && current.revokedPoints == null ? "—" : formatPoints(cancelled ? current.revokedPoints : current.frozenPoints, { withUnit: false })}</dd>
                  <small>{cancelled ? "未使用订阅积分" : current.frozenPoints > 0 ? "变更处理中" : "当前无冻结"}</small>
                  {current.upgradeHeldPoints > 0 ? <small>其中升级锁定 {formatPoints(current.upgradeHeldPoints)}</small> : null}
                </div>
                <div>
                  <img src="/failure-compensation/step-ledger.webp" alt="" width="44" height="44" decoding="async" />
                  <dt>{usageSplitKnown ? current.hasPriorTerm ? '本次升级后使用' : '当前周期使用' : '历史累计使用'}</dt>
                  <dd>{current.billingVersion === 2 ? formatPoints(usageSplitKnown ? current.currentTermSpentPoints : current.spentPoints, { withUnit: false }) : "—"}</dd>
                  <small className="subscription-usage-context">{current.billingVersion === 2 ? <>
                    {usageSplitKnown && current.hasPriorTerm && <span>升级前使用 {formatPoints(current.priorTermSpentPoints)}</span>}
                    <span>历史累计 {formatPoints(current.spentPoints)}</span>
                    {!usageSplitKnown && <span>周期用量未独立记录</span>}
                  </> : "历史消耗未独立记录"}</small>
                </div>
              </dl>
              {current.expiredPoints > 0 ? <p className="subscription-legacy">历史周期已失效 {formatPoints(current.expiredPoints)}，不计为创作消费。</p> : null}
              {current.skippedCycles > 0 ? <p className="subscription-legacy">已跳过 {current.skippedCycles} 个过期周期，不累积补发额度。</p> : null}
              {current.upgradeReclaimedPoints > 0 ? <p className="subscription-legacy">历史升级已置换回收 {formatPoints(current.upgradeReclaimedPoints)}，不计为创作消费。</p> : null}

              <section className="subscription-scope" aria-label="订阅权益">
                <header><h2>{stopped ? '原订阅权益' : '订阅权益'}</h2>{current.contract && <span>权益版本 v{current.contract.planRevision}</span>}</header>
                <dl>
                  <div><dt>价格保护</dt><dd>{current.contract ? current.contract.lockModelPrices ? current.contract.allowTopupPriceLock ? '订阅及合格额度包' : '仅订阅积分' : '按实时价格计费' : '历史订阅按实时价格计费'}</dd></div>
                  {current.contract && <div><dt>额外并发</dt><dd>+{current.contract.concurrencyBonus ?? 0} 张</dd></div>}
                  {!stopped && data.concurrency && <div><dt>并发上限</dt><dd>{data.concurrency.imageLimit ?? data.concurrency.limit} 张<small>基础 {data.concurrency.base} + 订阅 {data.concurrency.bonus}，所有生图场景共用</small></dd></div>}
                  {!stopped && data.concurrency?.chatLimit != null && <div><dt>对话并发上限</dt><dd>{data.concurrency.chatLimit} 次<small>与图片额度独立</small></dd></div>}
                  <div><dt>使用渠道</dt><dd>{current.policy?.channels?.map(value => value === 'api' ? 'API' : value === 'web' ? '网站' : value).join('、') || '按原套餐权益'}</dd></div>
                  <div><dt>适用场景</dt><dd>{current.policy?.featureKeys?.length ? current.policy.featureKeys.map(key => scenes[key] || key).join('、') : '全部场景'}</dd></div>
                  {current.policy?.modelIds?.length > 0 && <div><dt>适用模型</dt><dd>{current.policy.modelIds.join('、')}</dd></div>}
                </dl>
                {current.contract && (current.status !== 'active' || current.upgrading) && <p className="subscription-scope__status">当前订阅权益已暂停或结束</p>}
              </section>

              {current.billingVersion !== 2 ? (
                <p className="subscription-legacy">
                  历史订阅保留原发放规则，已发积分仍在通用钱包中；变更或退款请联系支持核查。
                </p>
              ) : null}
              </div>
              <footer className="subscription-aside__footer" aria-label="订阅操作">
              {current.canChange && current.status === "active" ? (
                <div className="subscription-actions">
                  <button
                    type="button"
                    className="subscription-btn is-primary"
                    disabled={busy || changing}
                    onClick={() => navigate(`/pricing?plan=subscription&upgradeFrom=${encodeURIComponent(current.id)}`)}
                  >
                    升级订阅
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="subscription-btn"
                    title={refundLabel}
                    disabled={busy || changing || current.spentPoints > 0}
                    onClick={openRefund}
                  >
                    <span>{refundLabel}</span>
                  </button>
                </div>
              ) : null}

              <div className="subscription-cta">
                <Link to="/wallet">钱包</Link>
                <Link to="/orders">订单</Link>
                <Link className="is-primary" to="/pricing?plan=topup">购买额度包</Link>
              </div>
              </footer>
            </div>
          </aside>

          <section className="subscription-ledger" aria-label="发放记录">
            <header className="subscription-ledger__head">
              <div>
                <h2>{tab === "grants" ? "发放记录" : "升级与退订"}</h2>
                <p>{tab === "grants" ? "每笔订阅积分到账都会记在这里" : "升级补差价与退订审核进度"}</p>
              </div>
              <button
                type="button"
                ref={pickerRef}
                className="subscription-history-btn"
                aria-expanded={pickerOpen}
                aria-haspopup="listbox"
                onClick={() => (pickerMounted && pickerOpen ? closePicker() : setPickerMounted(true))}
              >
                历史订阅
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </header>
            {pickerMounted && pickerBox
              ? createPortal(
                  <ul
                    ref={menuRef}
                    className={`subscription-picker__menu${dark ? " is-dark" : ""}${pickerOpen ? " is-open" : ""}`}
                    role="listbox"
                    aria-label="历史订阅"
                    style={{
                      top: pickerBox.top,
                      left: pickerBox.left,
                      width: pickerBox.width,
                      maxHeight: pickerBox.maxHeight,
                    }}
                    onTransitionEnd={(event) => {
                      if (event.target === event.currentTarget && !pickerOpen) setPickerMounted(false);
                    }}
                  >
                    {data.items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={item.id === selected}
                          className={item.id === selected ? "is-selected" : ""}
                          onClick={() => {
                            setSelected(item.id);
                            setPage(1);
                            closePicker();
                          }}
                        >
                          <strong>{item.planName}</strong>
                          <span>
                            {statusNames[item.status] || item.status}
                            {" · "}
                            {shortDate(item.startsAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>,
                  document.body,
                )
              : null}

            <div className="subscription-tabs" role="tablist" aria-label="记录分类">
              <button
                type="button"
                role="tab"
                className={tab === "grants" ? "is-active" : ""}
                aria-selected={tab === "grants"}
                onClick={() => setTab("grants")}
              >
                积分发放记录
                {grants.total > 0 ? <em>{grants.total}</em> : null}
              </button>
              <button
                type="button"
                role="tab"
                className={tab === "changes" ? "is-active" : ""}
                aria-selected={tab === "changes"}
                onClick={() => setTab("changes")}
              >
                升级与退订
                {changes.length > 0 ? <em>{changes.length}</em> : null}
              </button>
            </div>

            <div className="subscription-table-wrap">
              {tab === "grants" ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>所属周期</th>
                        <th>实际到账</th>
                        <th>类型</th>
                        <th>积分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grants.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.kind === "legacy"
                              ? item.sourceId.split("/").at(-1)
                              : date(item.scheduledAt)}
                          </td>
                          <td>{date(item.grantedAt)}</td>
                          <td>{grantKind(item)}</td>
                          <td className="subscription-points">
                            +{formatPoints(item.points)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!grants.items.length ? (
                    <p className="subscription-table-empty">暂无发放记录</p>
                  ) : null}
                </>
              ) : tab === "changes" ? (
                <>
                  <table className="subscription-changes-table">
                    <colgroup><col style={{width:155}} /><col style={{width:105}} /><col style={{width:105}} /><col style={{width:145}} /><col /></colgroup>
                    <thead>
                      <tr>
                        <th>申请时间</th>
                        <th>类型</th>
                        <th>金额</th>
                        <th>状态</th>
                        <th>处理进度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((change) => (
                        <tr key={change.id}>
                          <td>{date(change.createdAt)}</td>
                          <td>{change.kind === "refund" ? "退订退款" : "订阅升级"}</td>
                          <td className="subscription-change-money">{formatCents(change.amountCents)}</td>
                          <td>
                            {change.kind === "refund" && change.status === "completed" ? (change.amountCents > 0 ? "退款完成" : "已退订") : statusNames[change.status] || change.status}
                            {change.status === "pending" ? change.kind === "upgrade" ? <button type="button" className="subscription-text-action" onClick={() => openUpgradePayment(change.id)}>去支付</button> : <Link to="/orders">查看订单</Link> : null}
                          </td>
                          <td>
                            {change.kind === "upgrade" && <div className="subscription-change-route">
                              <strong>从「{change.snapshot?.sourcePlan?.planName || "原套餐信息未记录"}」升级至「{change.snapshot?.planName || "目标套餐信息未记录"}」</strong>
                              {change.snapshot?.sourcePlan?.dailyPoints > 0 && <small>原每天 {formatPoints(change.snapshot.sourcePlan.dailyPoints)} · {change.snapshot.sourcePlan.durationDays} 天；新每天 {formatPoints(change.snapshot.dailyPoints)} · {change.snapshot.durationDays} 天</small>}
                            </div>}
                            <p className="subscription-change-message">{change.publicMessage || (change.kind === "refund" ? ({ reviewing: "申请已提交，订阅积分已冻结，审核期间暂停发放。通用积分不受影响。", processing: "审核已通过，正在办理退款。订阅积分暂时冻结，通用积分不受影响。", completed: change.amountCents > 0 ? "退款已确认完成，订阅已结束。" : "退订已完成，本次无可退金额。", rejected: "申请未通过，订阅积分已解冻，原权益按有效期保留。" }[change.status] || "本次申请已结束。") : statusNames[change.status])}</p>
                            <small>更新于 {date(change.updatedAt || change.createdAt)}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!changes.length ? (
                    <p className="subscription-table-empty">暂无变更申请</p>
                  ) : null}
                </>
              ) : null}
            </div>

            {tab === "grants" ? (
              <footer className="subscription-pagination">
                <span>共 {grants.total} 条 · 第 {page} 页</span>
                <button
                  type="button"
                  className="subscription-icon"
                  aria-label="上一页"
                  title="上一页"
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="subscription-icon"
                  aria-label="下一页"
                  title="下一页"
                  disabled={page * 20 >= grants.total}
                  onClick={() => setPage((v) => v + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}
      {dialog && (
        <div className="subscription-dialog-layer">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="申请退订"
            className="subscription-dialog"
          >
            <header>
              <h2>申请退订</h2>
              <button
                type="button"
                className="subscription-icon"
                aria-label="关闭"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </header>
              <>
                <p>
                  预计退款上限{" "}
                  <strong>
                    {formatCents(dialog.preview.estimatedAmountCents)}
                  </strong>
                </p>
                <p>
                  使用过订阅积分不可退款。提交申请后立即冻结订阅积分并暂停发放，审核未通过将解冻；通用积分不受影响。最终退款金额经审核确认。
                </p>
                {dialog.preview.calculation && <dl className="subscription-refund-calculation">
                  <dt>累计实付</dt><dd>{formatCents(dialog.preview.calculation.paidCents)}</dd>
                  <dt>已发 / 已使用</dt><dd>{dialog.preview.calculation.issuedPoints} / {dialog.preview.calculation.spentPoints} 积分</dd>
                  <dt>未来未发额度</dt><dd>{formatPoints(dialog.preview.calculation.futurePoints)}</dd>
                  <dt>剩余时间价值</dt><dd>{formatCents(dialog.preview.calculation.timeValueCents)}</dd>
                  <dt>未消耗权益价值</dt><dd>{formatCents(dialog.preview.calculation.unusedValueCents)}</dd>
                </dl>}
                {dialog.preview.calculation?.rule === "unused_refund_window" && <p>当前未消耗订阅积分，处于未使用退款窗口，可按实付金额申请审核。</p>}
                {dialog.preview.calculation?.rule === "remaining_service_and_unused_credits" && <p>当前未使用订阅积分，已超出全退窗口，退款上限按剩余服务时间核算。</p>}
                {dialog.preview.calculation?.taskFrozenPoints > 0 && <p role="status">该订阅还有 {formatPoints(dialog.preview.calculation.taskFrozenPoints)} 用于进行中任务，结算后才能核定退款。</p>}
                <label>
                  退订原因
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={dialog.reason}
                    onChange={(event) =>
                      setDialog((value) => ({
                        ...value,
                        reason: event.target.value,
                      }))
                    }
                  />
                </label>
              </>
            {dialogError && (
              <p role="alert" className="subscription-error">
                {dialogError}
              </p>
            )}
            <footer>
                <button
                  type="button"
                  className="subscription-btn is-primary"
                  disabled={
                    busy ||
                    dialog.reason.trim().length < 6
                  }
                  onClick={submit}
                >
                  {busy
                    ? "处理中…"
                    : "提交退款审核"}
                </button>
            </footer>
          </section>
        </div>
      )}
      {user?.id && upgradeQuoteId ? <SubscriptionUpgradeCheckout key={`${user.id}:${upgradeQuoteId}`} quoteId={upgradeQuoteId} dark={dark} onClose={closeUpgradePayment} onChanged={() => setVersion(value => value + 1)} /> : null}
    </main>
  );
}
