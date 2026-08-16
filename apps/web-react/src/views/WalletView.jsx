import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { getWallet, listWalletLedger } from "@react/legacy-modules/services/meApi.js";
import {
  claimTrialAccessReward,
  getTrialAccessApplication,
} from "@react/legacy-modules/services/trialAccessApi.js";
import { formatPoints } from "@react/legacy-modules/services/billingApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-styles/generated/views/WalletView.css";
import { RedeemCodeDialog } from "../components/RedeemCodeDialog.jsx";
import { useIsDark } from "../hooks/useIsDark.js";

const PAGE_SIZE = 12;
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

function taskMeta(entry) {
  const task = entry?.task;
  if (!task) return "";
  return [
    String(task.modelName || "").trim(),
    Number(task.count || 1) > 1 ? `${task.count} 张` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function presentationFor(entry) {
  const kind = String(entry?.kind || "").toLowerCase();
  const delta = Number(entry?.deltaCents || 0);
  const amount = Math.abs(delta);
  const label = taskLabel(entry);
  const status = String(entry?.task?.status || "").toLowerCase();
  const statusLabel = TASK_STATUSES[status] || "";
  const cost = Math.max(0, Number(entry?.task?.costPoints || amount));
  const meta = taskMeta(entry);
  const balance = `变动后可用 ${formatPoints(entry?.balanceAfterCents)}`;

  if (entry?.task && Array.isArray(entry.relatedEntries)) {
    if (status === "succeeded") {
      const settled = Math.max(
        0,
        Number(entry.task.settledCostPoints ?? entry.task.costPoints ?? cost),
      );
      return {
        icon: "bi-check2-circle",
        tone: "settled",
        title: label,
        badge: "成功",
        amount: `-${formatPoints(settled)}`,
        amountTone: "spend",
        description: `实际扣除 ${formatPoints(settled)}，从预扣中结算。`,
        meta: [meta, balance].filter(Boolean).join(" · "),
      };
    }
    if (status === "failed" || status === "canceled")
      return {
        icon: "bi-arrow-counterclockwise",
        tone: "refund",
        title: label,
        badge: status === "canceled" ? "已取消并退款" : "失败已退款",
        amount: "净支出 0",
        amountTone: "income",
        description: `预扣 ${formatPoints(cost)} 已全部退回。`,
        meta: [meta, balance].filter(Boolean).join(" · "),
      };
    return {
      icon: "bi-hourglass-split",
      tone: "pending",
      title: label,
      badge: statusLabel || "处理中",
      amount: `冻结 ${formatPoints(cost)}`,
      amountTone: "neutral",
      description: `暂时冻结 ${formatPoints(cost)}；成功结算，失败退回。`,
      meta: [meta, balance].filter(Boolean).join(" · "),
    };
  }
  if (kind === "freeze" || kind === "task_freeze")
    return {
      icon: "bi-hourglass-split",
      tone: "pending",
      title: `${label}费用预扣`,
      badge: statusLabel || "处理中",
      amount: `-${formatPoints(amount)}`,
      amountTone: "spend",
      description: `提交时冻结 ${formatPoints(amount)}。`,
      meta: [meta, balance].filter(Boolean).join(" · "),
    };
  if (kind === "spend" || kind === "task_settle")
    return {
      icon: "bi-check2-circle",
      tone: "settled",
      title: `${label}已完成`,
      badge: "已结算",
      amount: "未再次扣费",
      amountTone: "neutral",
      description: `已从预扣 ${formatPoints(cost)} 中结算。`,
      meta: [meta, balance].filter(Boolean).join(" · "),
    };
  if (["release", "task_release", "refund"].includes(kind))
    return {
      icon: "bi-arrow-counterclockwise",
      tone: "refund",
      title: `${label}费用已退回`,
      badge: statusLabel || "已退款",
      amount: `+${formatPoints(amount)}`,
      amountTone: "income",
      description: `${formatPoints(amount)} 已退回可用余额。`,
      meta: [meta, balance].filter(Boolean).join(" · "),
    };
  const sourceLabels = {
    order: "套餐入账",
    redeem_code: "兑换码入账",
    daily_checkin: "签到奖励",
    subscription_daily: "订阅积分发放",
    signup_bonus: "注册赠送",
    admin: "人工调整",
  };
  return {
    icon: delta >= 0 ? "bi-plus-circle" : "bi-dash-circle",
    tone: delta >= 0 ? "income" : "spend",
    title:
      sourceLabels[entry?.sourceType] ||
      KIND_LABELS[kind] ||
      (delta >= 0 ? "积分入账" : "积分扣减"),
    badge: delta >= 0 ? "已入账" : "已扣减",
    amount: `${delta >= 0 ? "+" : "-"}${formatPoints(amount)}`,
    amountTone: delta >= 0 ? "income" : "spend",
    description: String(entry?.reason || "").trim() || "账户积分发生变动。",
    meta: balance,
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
  if (snapshot)
    window.dispatchEvent(
      new CustomEvent("starclouds:wallet-updated", { detail: snapshot }),
    );
}

export function WalletView() {
  const isDark = useIsDark();
  const mountedRef = useRef(true);
  const walletControllerRef = useRef(null);
  const ledgerControllerRef = useRef(null);
  const trialControllerRef = useRef(null);
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState("");
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerNextCursor, setLedgerNextCursor] = useState(null);
  const [pageCursors, setPageCursors] = useState([""]);
  const [trial, setTrial] = useState(null);
  const [trialError, setTrialError] = useState("");
  const [claiming, setClaiming] = useState(false);
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
    async (page = 1, cursors = pageCursors) => {
      const cursor = cursors[page - 1];
      if (cursor === undefined) return;
      ledgerControllerRef.current?.abort();
      const controller = new AbortController();
      ledgerControllerRef.current = controller;
      setLedgerLoading(true);
      setLedgerError("");
      try {
        const result = await listWalletLedger({
          limit: PAGE_SIZE,
          cursor: cursor || "",
          signal: controller.signal,
        });
        if (!mountedRef.current) return;
        setLedger(result.items);
        setLedgerPage(page);
        setLedgerNextCursor(result.nextCursor || null);
        setPageCursors((current) => {
          const next = current.slice(0, page);
          if (result.nextCursor) next[page] = result.nextCursor;
          return next;
        });
      } catch (error) {
        if (error?.name !== "AbortError" && mountedRef.current)
          setLedgerError(error?.message || "账本读取失败");
      } finally {
        if (mountedRef.current && ledgerControllerRef.current === controller)
          setLedgerLoading(false);
      }
    },
    [pageCursors],
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

  const refreshAll = useCallback(
    async () => Promise.all([loadWallet(), loadLedger(1, [""]), loadTrial()]),
    [loadLedger, loadTrial, loadWallet],
  );

  useEffect(() => {
    mountedRef.current = true;
    loadWallet();
    loadLedger(1, [""]);
    loadTrial();
    const onWalletUpdated = (event) =>
      event.detail &&
      setWallet((current) => ({ ...(current || {}), ...event.detail }));
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    return () => {
      mountedRef.current = false;
      walletControllerRef.current?.abort();
      ledgerControllerRef.current?.abort();
      trialControllerRef.current?.abort();
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
    };
  }, []);

  const ledgerRows = useMemo(() => {
    const groups = new Map();
    ledger.forEach((entry) => {
      const taskId = String(entry?.task?.id || "").trim();
      const key = taskId ? `task:${taskId}` : `entry:${entry.id}`;
      if (!groups.has(key))
        groups.set(key, { ...entry, id: key, relatedEntries: [] });
      groups.get(key).relatedEntries.push(entry);
    });
    return [...groups.values()].map((entry) => {
      const presentation = presentationFor(entry);
      return {
        ...entry,
        presentation,
        category: categoryFor(entry, presentation),
      };
    });
  }, [ledger]);
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
        <aside className="wallet-aside" aria-label="钱包概览">
          <div className="wallet-aside__card">
            <div className="wallet-aside__glow" aria-hidden="true" />
            <div className="wallet-aside__hero">
              <span className="wallet-aside__label">可用余额</span>
              <p className="wallet-aside__amount">
                <strong>{formatPoints(available, { withUnit: false })}</strong>
                <small>积分</small>
              </p>
              <p className="wallet-aside__hint">
                总额 {formatPoints(total)}
                {frozen > 0 ? ` · 冻结 ${formatPoints(frozen)}` : ""}
              </p>
            </div>
            <div className="wallet-aside__cta">
              <button
                type="button"
                className="wallet-btn is-primary"
                onClick={() => setRedeemOpen(true)}
              >
                <i className="bi bi-ticket-perforated" />
                兑换
              </button>
              <Link className="wallet-btn" to="/text-to-image">
                去创作
              </Link>
              <Link className="wallet-btn is-ghost" to="/check-in">
                签到
              </Link>
              <Link className="wallet-btn is-ghost" to="/incentive-plans">
                激励
              </Link>
            </div>
            <div className="wallet-metrics" aria-label="积分构成">
              <article>
                <i className="bi bi-wallet2" />
                <span>账户总额</span>
                <strong>{formatPoints(total)}</strong>
              </article>
              <article className={frozen > 0 ? "is-warn" : ""}>
                <i className="bi bi-hourglass-split" />
                <span>冻结中</span>
                <strong>{formatPoints(frozen)}</strong>
              </article>
              <article>
                <i className="bi bi-coin" />
                <span>普通积分</span>
                <strong>{formatPoints(normal)}</strong>
                {normalFrozen > 0 && (
                  <small>含冻结 {formatPoints(normalFrozen)}</small>
                )}
              </article>
              <article className="is-trial">
                <i className="bi bi-stars" />
                <span>{trialLabel}体验</span>
                <strong>{formatPoints(trialBalance)}</strong>
                {trialFrozen > 0 ? (
                  <small>含冻结 {formatPoints(trialFrozen)}</small>
                ) : trialBalance > 0 ? (
                  <small>仅限对应功能</small>
                ) : null}
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
          </div>
        </aside>
        <section className="wallet-ledger" aria-label="账本明细">
          <header className="wallet-ledger__head">
            <div>
              <h2>账本明细</h2>
              <p>入账、消费、冻结与退款</p>
            </div>
            {ledgerError ? (
              <span className="wallet-ledger__error">{ledgerError}</span>
            ) : ledgerLoading ? (
              <span className="wallet-ledger__loading">更新中…</span>
            ) : null}
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
                          <span className="wallet-ledger__icon">
                            <i className={`bi ${entry.presentation.icon}`} />
                          </span>
                          <div className="wallet-ledger__body">
                            <div className="wallet-ledger__main">
                              <strong>{entry.presentation.title}</strong>
                              <span>{entry.presentation.badge}</span>
                              {entry.creditBucket === "trial" ? (
                                <span className="is-trial">体验</span>
                              ) : entry.creditBucket === "mixed" ? (
                                <span>混合</span>
                              ) : null}
                            </div>
                            <p>{entry.presentation.description}</p>
                            <small>
                              {formatClock(entry.createdAt)}
                              {entry.presentation.meta
                                ? ` · ${entry.presentation.meta}`
                                : ""}
                            </small>
                          </div>
                          <b className={`is-${entry.presentation.amountTone}`}>
                            {entry.presentation.amount}
                          </b>
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
          {(ledgerPage > 1 || ledgerNextCursor) && (
            <nav className="wallet-pager" aria-label="账本分页">
              <button
                type="button"
                className="wallet-pager__btn"
                disabled={ledgerLoading || ledgerPage <= 1}
                onClick={() => loadLedger(ledgerPage - 1)}
              >
                <i className="bi bi-chevron-left" />
                上一页
              </button>
              <div className="wallet-pager__meta">
                <strong>第 {ledgerPage} 页</strong>
                <small>{ledgerRows.length} 条本页</small>
              </div>
              <button
                type="button"
                className="wallet-pager__btn"
                disabled={ledgerLoading || !ledgerNextCursor}
                onClick={() => loadLedger(ledgerPage + 1)}
              >
                下一页
                <i className="bi bi-chevron-right" />
              </button>
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
