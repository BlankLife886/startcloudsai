import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { downloadWalletBill, getWallet, getWalletSummary, listWalletLedger } from "@react/legacy-modules/services/meApi.js";
import {
  claimTrialAccessReward,
  getTrialAccessApplication,
} from "@react/legacy-modules/services/trialAccessApi.js";
import { formatPoints } from "@react/legacy-modules/services/billingApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { publishWalletSnapshot } from "@react/legacy-modules/services/walletSync.js";
import { TASK_UPDATE_EVENT, isTerminalTaskStatus } from "@react/legacy-modules/services/tasksApi.js";
import "@react/legacy-styles/generated/views/WalletView.css";
import { RedeemCodeDialog } from "../components/RedeemCodeDialog.jsx";
import "./WalletView.css";
import { useIsDark } from "../hooks/useIsDark.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";

const PAGE_SIZE = 12;
const PAGE_SIZES = [12, 20, 50];
const SUMMARY_LINKS = {
  daily_checkin: "/check-in",
  usage_milestone: "/incentive-plans/usage",
  growth_group: "/incentive-plans/group",
  feedback_adoption: "/incentive-plans/suggestion",
  task_failure_bonus: "/incentive-plans/failure",
  order: "/incentive-plans/membership",
  subscription_daily: "/incentive-plans/membership",
};
const FILTERS = [
  ["all", "全部"],
  ["income", "入账"],
  ["spend", "消费"],
  ["pending", "冻结"],
  ["refund", "退款"],
];
const TASK_TYPES = {
  t2i: "文生图",
  infinite_canvas: "无限画布",
  coloring: "插画染色",
  ui_design: "UI 设计稿",
  ecommerce_design: "AI 电商",
  model_sheet: "模型设计",
  game_art: "游戏设计",
  puzzle: "拼图",
  background_remove: "背景移除",
  assistant: "AI 助手",
};
const TASK_STATUSES = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};
const KIND_LABELS = {
  order_grant: "套餐入账",
  grant: "入账",
  task_freeze: "任务冻结",
  task_settle: "任务结算",
  task_release: "任务解冻",
  admin_adjust: "人工调整",
  redeem: "兑换码入账",
  subscription_grant: "订阅每日发放",
};

function visiblePages(current, total) {
  if (!total || total < 1) return [current];
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const picked = new Set([1, total, current]);
  for (let page = current - 1; page <= current + 1; page += 1) {
    if (page > 1 && page < total) picked.add(page);
  }
  const sorted = [...picked].sort((a, b) => a - b);
  const result = [];
  sorted.forEach((page, index) => {
    if (index && page - sorted[index - 1] > 1) result.push("…");
    result.push(page);
  });
  return result;
}

function formatClock(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
}

function generationDuration(entry) {
  const started = Date.parse(entry?.task?.startedAt || "");
  const finished = Date.parse(entry?.task?.finishedAt || "");
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return "";
  const seconds = Math.max(0, Math.round((finished - started) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
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

function taskLabel(entry) {
  const task = entry?.task;
  const displayName = String(task?.displayName || "").trim();
  if (displayName) return displayName;
  if (!task) {
    return String(entry?.sourceType || "").includes("assistant")
      ? "AI 助手"
      : "AI 任务";
  }
  if (task.type === "background_remove" && task.automaticBackgroundRemove)
    return "生成后自动抠图";
  const source = String(task.source || "").toLowerCase();
  if (source === "react_canvas" || source.includes("canvas")) return "无限画布";
  if (source === "assistant" || task.type === "assistant") return "AI 助手";
  return TASK_TYPES[task.type] || "AI 任务";
}

function taskModel(entry) {
  return String(entry?.task?.modelName || "").trim();
}

function taskMeta(entry) {
  const count = Number(entry?.task?.count || 1);
  return count > 1 ? `${count} 张` : "";
}

function remainingCents(entry) {
  const value = entry?.balanceAfterCents ?? entry?.balanceAfterPoints;
  return value == null || value === "" ? null : Number(value);
}

function signedAmount(delta) {
  const value = Number(delta) || 0;
  const text = formatPoints(Math.abs(value));
  if (value > 0) return { text: `+${text}`, tone: "income" };
  if (value < 0) return { text: `-${text}`, tone: "spend" };
  return { text: "0 积分", tone: "neutral" };
}

function presentationFor(entry) {
  const kind = String(entry?.kind || "").toLowerCase();
  const delta = Number(entry?.deltaCents || 0);
  const amount = signedAmount(delta);
  const label = taskLabel(entry);
  const status = String(entry?.task?.status || "").toLowerCase();
  const statusLabel = TASK_STATUSES[status] || "";
  const cost = Math.max(0, Number(entry?.task?.costPoints || Math.abs(delta)));
  const meta = taskMeta(entry);
  const model = taskModel(entry);
  const remaining = remainingCents(entry);
  const remainingText = remaining == null ? "—" : formatPoints(remaining, { withUnit: false });
  const reason = String(entry?.reason || "").trim();

  if (kind === "freeze" || kind === "task_freeze")
    return {
      icon: "bi-hourglass-split",
      tone: "pending",
      kindLabel: "冻结",
      title: label,
      badge: statusLabel || "处理中",
      amount: amount.text.startsWith("-") ? amount.text : `-${formatPoints(Math.abs(delta) || cost)}`,
      amountTone: "spend",
      description: `提交时预扣 ${formatPoints(Math.abs(delta) || cost)}。成功后从预扣结算，失败会退回。`,
      meta,
      model,
      remainingText,
    };
  if (kind === "spend" || kind === "task_settle")
    return {
      icon: "bi-check2-circle",
      tone: "settled",
      kindLabel: "消费",
      title: label,
      badge: "已结算",
      amount: delta === 0 ? `结算 ${formatPoints(cost)}` : amount.text,
      amountTone: delta === 0 ? "neutral" : "spend",
      description: delta === 0 ? `已从预扣中结算 ${formatPoints(cost)}，可用余额不再另扣。` : `实际扣除 ${formatPoints(Math.abs(delta))}。`,
      meta,
      model,
      remainingText,
    };
  if (["release", "task_release", "refund"].includes(kind))
    return {
      icon: "bi-arrow-counterclockwise",
      tone: "refund",
      kindLabel: "退款",
      title: label,
      badge: status === "canceled" ? "已取消" : statusLabel || "已退回",
      amount: amount.tone === "income" ? amount.text : `+${formatPoints(Math.abs(delta) || cost)}`,
      amountTone: "income",
      description: status === "canceled" || status === "failed"
        ? `任务未完成，${formatPoints(Math.abs(delta) || cost)} 已退回可用余额。`
        : `${formatPoints(Math.abs(delta) || cost)} 已退回可用余额。`,
      meta,
      model,
      remainingText,
    };
  const sourceLabels = {
    order: "套餐入账",
    redeem_code: "兑换码入账",
    daily_checkin: "签到奖励",
    subscription_daily: "订阅积分发放",
    signup_bonus: "注册赠送",
    admin: "人工调整",
    trial_access: "体验积分",
    usage_milestone: "激励积分",
    growth_group: "拼团积分",
    feedback_adoption: "建议采纳",
    task_failure_bonus: "失败补偿",
  };
  const income = delta >= 0;
  return {
    icon: income ? "bi-plus-circle" : "bi-dash-circle",
    tone: income ? "income" : "spend",
    kindLabel: income ? "入账" : "消费",
    title:
      sourceLabels[entry?.sourceType] ||
      KIND_LABELS[kind] ||
      (income ? "积分入账" : "积分扣减"),
    badge: income ? "已入账" : "已扣减",
    amount: amount.text,
    amountTone: amount.tone,
    description: reason || "账户积分发生变动。",
    meta,
    model,
    remainingText,
  };
}

function categoryFor(entry, presentation) {
  if (["income", "refund", "pending"].includes(presentation.tone))
    return presentation.tone;
  if (["spend", "settled"].includes(presentation.tone)) return "spend";
  const kind = String(entry?.kind || "").toLowerCase();
  if (
    [
      "grant",
      "order_grant",
      "redeem",
      "subscription_grant",
      "admin_adjust",
    ].includes(kind)
  )
    return Number(entry?.deltaCents || 0) >= 0 ? "income" : "spend";
  if (kind.includes("freeze")) return "pending";
  if (kind.includes("release") || kind.includes("refund")) return "refund";
  return Number(entry?.deltaCents || 0) >= 0 ? "income" : "spend";
}

function publishWallet(snapshot) {
  publishWalletSnapshot(snapshot);
}

export function WalletView() {
  const isDark = useIsDark();
  const { isEntryVisible } = usePageControls();
  const mountedRef = useRef(true);
  const walletControllerRef = useRef(null);
  const ledgerControllerRef = useRef(null);
  const trialControllerRef = useRef(null);
  const summaryControllerRef = useRef(null);
  const ledgerRealtimeTimerRef = useRef(0);
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(null);
  const [ledgerNextCursor, setLedgerNextCursor] = useState(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [jumpPage, setJumpPage] = useState("");
  const [trial, setTrial] = useState(null);
  const [trialError, setTrialError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const loadWallet = useCallback(async () => {
    walletControllerRef.current?.abort();
    const controller = new AbortController();
    walletControllerRef.current = controller;
    setWalletLoading(true);
    setWalletError("");
    try {
      const result = await getWallet({ signal: controller.signal });
      if (mountedRef.current) {
        setWallet(result);
        publishWallet(result);
      }
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setWalletError(error?.message || "钱包读取失败");
    } finally {
      if (mountedRef.current && walletControllerRef.current === controller)
        setWalletLoading(false);
    }
  }, []);

  const loadLedger = useCallback(
    async (page = 1, size = pageSize) => {
      ledgerControllerRef.current?.abort();
      const controller = new AbortController();
      ledgerControllerRef.current = controller;
      setLedgerLoading(true);
      setLedgerError("");
      try {
        const result = await listWalletLedger({
          limit: size,
          page,
          signal: controller.signal,
        });
        if (!mountedRef.current) return;
        setLedger(result.items);
        setLedgerPage(Number(result.page || page) || 1);
        setLedgerTotal(Number.isFinite(result.total) ? result.total : null);
        setLedgerNextCursor(result.nextCursor || null);
      } catch (error) {
        if (error?.name !== "AbortError" && mountedRef.current)
          setLedgerError(error?.message || "账本读取失败");
      } finally {
        if (mountedRef.current && ledgerControllerRef.current === controller)
          setLedgerLoading(false);
      }
    },
    [pageSize],
  );

  const loadTrial = useCallback(async () => {
    trialControllerRef.current?.abort();
    const controller = new AbortController();
    trialControllerRef.current = controller;
    setTrialError("");
    try {
      const result = await getTrialAccessApplication({
        signal: controller.signal,
      });
      if (mountedRef.current) setTrial(result);
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setTrialError(error?.message || "体验兑换码读取失败");
    }
  }, []);

  const loadSummary = useCallback(async () => {
    summaryControllerRef.current?.abort();
    const controller = new AbortController();
    summaryControllerRef.current = controller;
    setSummaryError("");
    try {
      const result = await getWalletSummary({ signal: controller.signal });
      if (mountedRef.current) setSummary(result);
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current) {
        const message = String(error?.message || "");
        setSummaryError(
          error?.status === 404 || message === "Not Found"
            ? "账单汇总读取失败，请稍后重试"
            : message || "账单汇总读取失败",
        );
      }
    }
  }, []);

  const refreshAll = useCallback(
    async () => Promise.all([loadWallet(), loadLedger(1), loadTrial(), loadSummary()]),
    [loadLedger, loadSummary, loadTrial, loadWallet],
  );

  useEffect(() => {
    mountedRef.current = true;
    loadWallet();
    loadLedger(1);
    loadTrial();
    loadSummary();
    const onWalletUpdated = (event) =>
      event.detail &&
      setWallet((current) => ({ ...(current || {}), ...event.detail }));
    const onTaskUpdated = (event) => {
      if (!isTerminalTaskStatus(event?.detail?.task?.status)) return;
      if (ledgerRealtimeTimerRef.current) window.clearTimeout(ledgerRealtimeTimerRef.current);
      ledgerRealtimeTimerRef.current = window.setTimeout(() => {
        ledgerRealtimeTimerRef.current = 0;
        void loadLedger(1);
        void loadSummary();
      }, 180);
    };
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    window.addEventListener(TASK_UPDATE_EVENT, onTaskUpdated);
    return () => {
      mountedRef.current = false;
      walletControllerRef.current?.abort();
      ledgerControllerRef.current?.abort();
      trialControllerRef.current?.abort();
      summaryControllerRef.current?.abort();
      if (ledgerRealtimeTimerRef.current) window.clearTimeout(ledgerRealtimeTimerRef.current);
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
      window.removeEventListener(TASK_UPDATE_EVENT, onTaskUpdated);
    };
  }, []);

  const ledgerRows = useMemo(
    () =>
      ledger.map((entry) => {
        const presentation = presentationFor(entry);
        return {
          ...entry,
          presentation,
          category: categoryFor(entry, presentation),
        };
      }),
    [ledger],
  );
  const filterCounts = useMemo(
    () =>
      ledgerRows.reduce(
        (counts, row) => ({
          ...counts,
          all: counts.all + 1,
          [row.category]: counts[row.category] + 1,
        }),
        { all: 0, income: 0, spend: 0, pending: 0, refund: 0 },
      ),
    [ledgerRows],
  );
  const filteredRows =
    ledgerFilter === "all"
      ? ledgerRows
      : ledgerRows.filter((row) => row.category === ledgerFilter);
  const dayGroups = useMemo(() => {
    const result = [];
    const map = new Map();
    filteredRows.forEach((entry) => {
      const date = entry.createdAt ? new Date(entry.createdAt) : null;
      const valid = date && !Number.isNaN(date.getTime());
      const key = valid ? dayKey(date) : "unknown";
      if (!map.has(key)) {
        const group = {
          key,
          label: valid ? dayLabel(date) : "更早",
          items: [],
        };
        map.set(key, group);
        result.push(group);
      }
      map.get(key).items.push(entry);
    });
    return result;
  }, [filteredRows]);

  const balance = Number(wallet?.balanceCents || 0);
  const frozen = Number(wallet?.frozenCents || 0);
  const available = Math.max(0, balance);
  const total = available + Math.max(0, frozen);
  const normal = Number(wallet?.normalBalanceCents ?? balance);
  const trialBalance = Number(wallet?.trialBalanceCents || 0);
  const normalFrozen = Number(wallet?.normalFrozenCents ?? frozen);
  const trialFrozen = Number(wallet?.trialFrozenCents || 0);
  const trialLabel = trial?.feature?.label || "体验";
  const showTrial = trial?.status === "approved" && trial?.rewardCents;
  const summaryItems = (Array.isArray(summary?.items) ? summary.items : []).filter(
    (item) => item.id !== "trial_access",
  );
  const pageCount =
    ledgerTotal == null ? null : Math.max(1, Math.ceil(Math.max(0, ledgerTotal) / pageSize));
  const canPrev = ledgerPage > 1;
  const canNext = pageCount != null ? ledgerPage < pageCount : Boolean(ledgerNextCursor);
  const showPager =
    Boolean(ledger.length) || ledgerPage > 1 || Boolean(ledgerNextCursor) || (ledgerTotal != null && ledgerTotal > 0);

  const goToPage = (page) => {
    const next = Math.max(1, pageCount != null ? Math.min(pageCount, page) : page);
    if (!ledgerLoading) void loadLedger(next);
  };

  const changePageSize = (size) => {
    const nextSize = Number(size) || PAGE_SIZE;
    setPageSize(nextSize);
    setJumpPage("");
    void loadLedger(1, nextSize);
  };

  const submitJump = (event) => {
    event.preventDefault();
    const next = Number.parseInt(jumpPage, 10);
    if (!Number.isFinite(next)) return;
    goToPage(next);
    setJumpPage("");
  };

  const exportBill = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await downloadWalletBill();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      notificationService.success("账单已导出");
    } catch (error) {
      notificationService.error(error?.message || "账单导出失败");
    } finally {
      if (mountedRef.current) setExporting(false);
    }
  };

  const claimReward = async () => {
    if (
      claiming ||
      trial?.status !== "approved" ||
      trial?.rewardStatus === "redeemed"
    )
      return;
    setClaiming(true);
    try {
      const result = await claimTrialAccessReward();
      notificationService.success(
        `体验积分已到账 +${formatPoints(result?.grantCents || 0)}`,
      );
      publishWallet(result);
      await refreshAll();
    } catch (error) {
      if (
        ["trial_reward_already_claimed", "code_redeemed"].includes(error?.code)
      )
        await refreshAll();
      else notificationService.error(error?.message || "体验积分领取失败");
    } finally {
      if (mountedRef.current) setClaiming(false);
    }
  };

  if (walletLoading && !wallet)
    return (
      <main className={`wallet${isDark ? " is-dark" : ""}`}>
        <div className="wallet-skel" aria-hidden="true">
          <div className="wallet-skel__aside" />
          <div className="wallet-skel__panel" />
        </div>
      </main>
    );
  if (walletError && !wallet)
    return (
      <main className={`wallet${isDark ? " is-dark" : ""}`}>
        <section className="wallet-error">
          <i className="bi bi-cloud-slash" />
          <strong>钱包加载失败</strong>
          <p>{walletError}</p>
          <button type="button" className="wallet-btn" onClick={loadWallet}>
            重试
          </button>
        </section>
      </main>
    );

  return (
    <main className={`wallet${isDark ? " is-dark" : ""}`}>
      <div className="wallet-layout">
        <aside className="wallet-aside" aria-label="我的钱包">
          <div className="wallet-aside__card">
            <div className="wallet-aside__hero">
              <img
                className="wallet-aside__mascot"
                src="/usage-plan/step-wallet.webp"
                alt=""
                width="128"
                height="128"
                decoding="async"
              />
              <div>
                <span className="wallet-aside__label">可用余额</span>
                <p className="wallet-aside__amount">
                  <strong>{formatPoints(available, { withUnit: false })}</strong>
                  <small>积分</small>
                </p>
                {frozen > 0 ? (
                  <p className="wallet-aside__hint">
                    另有 {formatPoints(frozen)} 冻结中，完成后结算或退回。
                  </p>
                ) : null}
              </div>
            </div>
            <div className="wallet-metrics" aria-label="积分构成">
              <article>
                <img src="/failure-compensation/step-release.webp" alt="" width="48" height="48" decoding="async" />
                <span>账户总额</span>
                <strong>{formatPoints(total, { withUnit: false })}</strong>
                <small>可用 + 冻结</small>
              </article>
              <article className={frozen > 0 ? "is-warn" : ""}>
                <img src="/failure-compensation/step-fail.webp" alt="" width="48" height="48" decoding="async" />
                <span>冻结中</span>
                <strong>{formatPoints(frozen, { withUnit: false })}</strong>
                <small>{frozen > 0 ? "任务处理中预扣" : "当前无预扣"}</small>
              </article>
              <article>
                <img src="/签到页面素材/ai-wallpaper-1786340924518-2-1.webp" alt="" width="48" height="48" decoding="async" />
                <span>普通积分</span>
                <strong>{formatPoints(normal, { withUnit: false })}</strong>
                {normalFrozen > 0 ? (
                  <small>含冻结 {formatPoints(normalFrozen, { withUnit: false })}</small>
                ) : (
                  <small>通用额度</small>
                )}
              </article>
              <article className="is-trial">
                <img src="/failure-compensation/step-bonus.webp" alt="" width="48" height="48" decoding="async" />
                <span>体验积分</span>
                <strong>{formatPoints(trialBalance, { withUnit: false })}</strong>
                {trialFrozen > 0 ? (
                  <small>含冻结 {formatPoints(trialFrozen, { withUnit: false })}</small>
                ) : trialBalance > 0 ? (
                  <small>仅限对应功能</small>
                ) : (
                  <small>暂无体验额度</small>
                )}
              </article>
            </div>
            {showTrial ? (
              <aside
                className={`wallet-trial${trial.rewardStatus === "redeemed" ? " is-used" : ""}`}
              >
                <span className="wallet-trial__icon">
                  <i className="bi bi-gift" />
                </span>
                <div className="wallet-trial__copy">
                  <strong>{trialLabel}体验礼包</strong>
                  <p>
                    {trial.rewardStatus === "redeemed"
                      ? `已到账，仅用于${trialLabel}`
                      : `领取后仅用于${trialLabel}`}
                  </p>
                </div>
                {trial.rewardStatus === "redeemed" ? (
                  <em>已领取</em>
                ) : (
                  <button
                    type="button"
                    className="wallet-btn is-light"
                    disabled={claiming}
                    onClick={claimReward}
                  >
                    {claiming
                      ? "领取中…"
                      : `领取 ${formatPoints(trial.rewardCents || 0)}`}
                  </button>
                )}
              </aside>
            ) : trialError ? (
              <p className="wallet-trial-error">{trialError}</p>
            ) : null}
            <section className="wallet-summary" aria-label="账单汇总">
              <header>
                <img src="/failure-compensation/step-ledger.webp" alt="" width="56" height="56" decoding="async" />
                <div>
                  <strong>账单汇总</strong>
                  <p>合计消耗不含冻结中预扣，入账按渠道分开统计</p>
                </div>
              </header>
              {summaryError ? (
                <div className="wallet-summary__error">
                  <p>{summaryError}</p>
                  <button type="button" className="wallet-btn is-light" onClick={loadSummary}>
                    重新加载
                  </button>
                </div>
              ) : (
                <>
                  <div className="wallet-summary__totals">
                    <article className="is-spend">
                      <span>合计消耗</span>
                      <strong>{formatPoints(summary?.consumedCents || 0, { withUnit: false })}</strong>
                      <small>{summary?.consumedCount || 0} 笔已结算</small>
                    </article>
                    <article className="is-income">
                      <span>合计入账</span>
                      <strong>{formatPoints(summary?.incomeCents || 0, { withUnit: false })}</strong>
                      <small>{summary?.incomeCount || 0} 笔到账</small>
                    </article>
                    <article className="is-refund">
                      <span>失败退回</span>
                      <strong>{formatPoints(summary?.refundCents || 0, { withUnit: false })}</strong>
                      <small>{summary?.refundCount || 0} 笔解冻</small>
                    </article>
                  </div>
                  <ul>
                    {summaryItems.map((item) => {
                      const target = SUMMARY_LINKS[item.id];
                      const href = target && isEntryVisible(target) ? target : "";
                      const body = (
                        <>
                          <div>
                            <span>{item.label}</span>
                            <small>{item.hint}</small>
                          </div>
                          <b>{formatPoints(item.cents || 0, { withUnit: false })}</b>
                          <em>{item.count || 0} 笔</em>
                          {href ? <i className="bi bi-chevron-right" aria-hidden="true" /> : <i />}
                        </>
                      );
                      return (
                        <li key={item.id}>
                          {href ? (
                            <Link to={href} className="wallet-summary__row">
                              {body}
                            </Link>
                          ) : (
                            <div className="wallet-summary__row">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          </div>
        </aside>
        <section className="wallet-ledger" aria-label="账本明细">
          <header className="wallet-ledger__head">
            <div>
              <h2>账本明细</h2>
              <p>每笔流水都会记下变动后的可用结余</p>
            </div>
            <div className="wallet-ledger__tools">
              {ledgerError ? (
                <span className="wallet-ledger__error">{ledgerError}</span>
              ) : ledgerLoading ? (
                <span className="wallet-ledger__loading">更新中…</span>
              ) : null}
              <button
                type="button"
                className="wallet-btn"
                onClick={() => setRedeemOpen(true)}
              >
                <i className="bi bi-ticket-perforated" aria-hidden="true" />
                兑换
              </button>
              <button
                type="button"
                className="wallet-btn"
                disabled={exporting}
                onClick={exportBill}
              >
                <i className="bi bi-download" aria-hidden="true" />
                {exporting ? "导出中…" : "导出账单"}
              </button>
            </div>
          </header>
          <div className="wallet-tabs" role="tablist" aria-label="账本分类">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`wallet-tabs__btn${ledgerFilter === id ? " is-active" : ""}`}
                aria-selected={ledgerFilter === id}
                onClick={() => setLedgerFilter(id)}
              >
                {label}
                {filterCounts[id] > 0 && <em>{filterCounts[id]}</em>}
              </button>
            ))}
          </div>
          <div className="wallet-ledger__cols" aria-hidden="true">
            <span>时间</span>
            <span>生成耗时</span>
            <span>项目</span>
            <span>说明</span>
            <span>模型</span>
            <span>类型</span>
            <span>变动</span>
            <span>结余</span>
          </div>
          <div className="wallet-ledger__scroll">
            {ledgerLoading && !ledger.length ? (
              <div className="wallet-skel is-inline" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="wallet-skel__row" />
                ))}
              </div>
            ) : dayGroups.length ? (
              <div className="wallet-ledger__groups">
                {dayGroups.map((group) => (
                  <section key={group.key} className="wallet-day">
                    <header className="wallet-day__head">
                      <strong>{group.label}</strong>
                      <span>{group.items.length}</span>
                    </header>
                    <ul className="wallet-ledger__list">
                      {group.items.map((entry) => (
                        <li
                          key={entry.id}
                          className={`is-${entry.presentation.tone} cat-${entry.category}`}
                        >
                          <time dateTime={entry.createdAt || undefined}>
                            {formatClock(entry.createdAt)}
                          </time>
                          <span className="wallet-ledger__generated">
                            <strong>{generationDuration(entry) || "—"}</strong>
                          </span>
                          <div className="wallet-ledger__body">
                            <div className="wallet-ledger__main">
                              <strong>{entry.presentation.title}</strong>
                              {entry.creditBucket === "trial" ? (
                                <span className="is-trial">体验</span>
                              ) : entry.creditBucket === "mixed" ? (
                                <span>混合</span>
                              ) : null}
                            </div>
                            {entry.presentation.meta ? (
                              <small>{entry.presentation.meta}</small>
                            ) : null}
                          </div>
                          <p className="wallet-ledger__note">{entry.presentation.description}</p>
                          <span className="wallet-ledger__model" title={entry.presentation.model || undefined}>
                            {entry.presentation.model || "—"}
                          </span>
                          <em className={`wallet-ledger__kind is-${entry.category}`}>
                            {entry.presentation.kindLabel}
                          </em>
                          <b className={`is-${entry.presentation.amountTone}`}>
                            {entry.presentation.amount}
                          </b>
                          <span className="wallet-ledger__remain">
                            <small>结余</small>
                            <strong>{entry.presentation.remainingText}</strong>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : !ledgerLoading ? (
              <p className="wallet-empty">
                {ledgerFilter === "all"
                  ? "暂无余额变动记录"
                  : "当前分类暂无记录"}
              </p>
            ) : null}
          </div>
          {showPager && (
            <nav className="wallet-pager" aria-label="账本分页">
              <div className="wallet-pager__nav">
                <button
                  type="button"
                  className="wallet-pager__btn"
                  disabled={ledgerLoading || !canPrev}
                  onClick={() => goToPage(ledgerPage - 1)}
                >
                  <i className="bi bi-chevron-left" aria-hidden="true" />
                  上一页
                </button>
                {visiblePages(ledgerPage, pageCount).map((item, index) =>
                  item === "…" ? (
                    <span key={`ellipsis-${index}`} className="wallet-pager__ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={`wallet-pager__num${item === ledgerPage ? " is-active" : ""}`}
                      disabled={ledgerLoading || item === ledgerPage}
                      onClick={() => goToPage(item)}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="wallet-pager__btn"
                  disabled={ledgerLoading || !canNext}
                  onClick={() => goToPage(ledgerPage + 1)}
                >
                  下一页
                  <i className="bi bi-chevron-right" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="wallet-pager__btn"
                  disabled={ledgerLoading || !canNext || pageCount == null}
                  onClick={() => goToPage(pageCount)}
                  aria-label="末页"
                >
                  末页
                  <i className="bi bi-chevron-double-right" aria-hidden="true" />
                </button>
              </div>
              <div className="wallet-pager__meta">
                <strong>第 {ledgerPage} 页</strong>
                {pageCount != null ? (
                  <>
                    <span>/</span>
                    <small>{pageCount}</small>
                  </>
                ) : null}
                <span>·</span>
                <small>
                  {ledgerTotal != null
                    ? `共 ${ledgerTotal.toLocaleString("zh-CN")} 条`
                    : `${ledgerRows.length} 条`}
                </small>
              </div>
              <form className="wallet-pager__jump" onSubmit={submitJump}>
                <label>
                  每页
                  <select
                    value={pageSize}
                    disabled={ledgerLoading}
                    onChange={(event) => changePageSize(event.target.value)}
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  跳至
                  <input
                    type="number"
                    min="1"
                    max={pageCount || undefined}
                    inputMode="numeric"
                    value={jumpPage}
                    disabled={ledgerLoading}
                    placeholder="页码"
                    onChange={(event) => setJumpPage(event.target.value)}
                  />
                </label>
                <button type="submit" className="wallet-pager__btn" disabled={ledgerLoading || !jumpPage}>
                  确定
                </button>
              </form>
            </nav>
          )}
        </section>
      </div>
      <RedeemCodeDialog
        open={redeemOpen}
        isDark={isDark}
        onClose={() => setRedeemOpen(false)}
        onSuccess={refreshAll}
      />
    </main>
  );
}
