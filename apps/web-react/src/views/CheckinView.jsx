import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  claimDailyCheckin,
  getCheckinState,
} from "@legacy/services/checkinApi.js";
import { formatPoints } from "@legacy/services/billingApi.js";
import "@legacy/views/CheckinView.vue?react-style";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";

const checkinArt = Object.freeze({
  hero: "/签到页面素材/background-removed-1786338743411 2.webp",
  rewardTitle: "/签到页面素材/background-removed-1786340315242 (1).webp",
  calendar: "/签到页面素材/ai-wallpaper-1786340133951-1-1.webp",
  medal: "/签到页面素材/ai-wallpaper-1786340142606-2-1.webp",
  target: "/签到页面素材/ai-wallpaper-1786340147405-3-1.webp",
  growth: "/签到页面素材/ai-wallpaper-1786340152625-4-1.webp",
  tip: "/签到页面素材/ai-wallpaper-1786340912655-1-1.webp",
  coin: "/签到页面素材/ai-wallpaper-1786340924518-2-1.webp",
});

const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

function buildCalendarDays(state) {
  const [year, month] = String(state?.month || "").split("-").map(Number);
  if (!year || !month) return [];
  const recordMap = new Map(
    (state.monthRecords || []).map((record) => [String(record.date), record]),
  );
  const days = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells = Array.from({ length: firstWeekday }, (_, index) => ({ key: `blank-${index}` }));
  for (let day = 1; day <= days; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({
      key: date,
      day,
      date,
      record: recordMap.get(date) || null,
      today: date === state.today,
    });
  }
  const trailing = Math.max(0, 42 - cells.length);
  cells.push(...Array.from({ length: trailing }, (_, index) => ({ key: `tail-${index}` })));
  return cells;
}

export function CheckinView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const mountedRef = useRef(true);
  const burstTimerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [claimError, setClaimError] = useState("");
  const [state, setState] = useState(null);
  const [claimBurst, setClaimBurst] = useState(false);

  const todayChecked = state?.todayChecked === true;
  const activityEnabled = state?.enabled !== false;
  const claimReward = Math.max(0, Number(state?.claimRewardCents || 0));
  const nextReward = Math.max(0, Number(state?.nextRewardCents || 0));
  const activeCycleDay = Math.min(7, Math.max(1, Number(state?.claimCycleDay || 1)));
  const completedCycleDay = todayChecked
    ? Number(state?.todayRecord?.cycleDay || activeCycleDay)
    : Math.max(0, activeCycleDay - 1);
  const displayName = auth.user?.username || auth.user?.email?.split("@")[0] || "创作者";
  const calendarDays = useMemo(() => buildCalendarDays(state), [state]);
  const rewardItems = Array.isArray(state?.rewards) ? state.rewards : [];
  const [monthYear, monthNumber] = String(state?.month || "").split("-");
  const monthTitle = monthYear && monthNumber
    ? `${monthYear} 年 ${Number(monthNumber)} 月`
    : "本月签到";
  const progressDone = todayChecked ? completedCycleDay : Math.max(0, activeCycleDay - 1);
  const progressPercent = Math.min(100, Math.max(0, (progressDone / 7) * 100));
  const statusLabel = !activityEnabled ? "活动暂停" : todayChecked ? "今日已签到" : "今日可领取";
  const statusDetail = !activityEnabled
    ? "签到活动暂未开放，稍后再来"
    : todayChecked
      ? `明日可领 ${formatPoints(nextReward)}，继续保持连续`
      : `签到即可领取 ${formatPoints(claimReward)}，连续越多奖励越高`;

  const load = async (signal) => {
    setLoading(true);
    setLoadError("");
    try {
      const nextState = await getCheckinState({ signal });
      if (mountedRef.current) setState(nextState);
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current) {
        setLoadError(error?.message || "签到活动读取失败");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
      if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current);
    };
  }, []);

  const claim = async () => {
    if (claiming || todayChecked || !activityEnabled) return;
    setClaiming(true);
    setClaimError("");
    try {
      const result = await claimDailyCheckin();
      if (!mountedRef.current) return;
      setState(result);
      if (!result?.alreadyChecked) {
        setClaimBurst(false);
        requestAnimationFrame(() => setClaimBurst(true));
        burstTimerRef.current = window.setTimeout(() => setClaimBurst(false), 1200);
      }
    } catch (error) {
      if (mountedRef.current) setClaimError(error?.message || "签到失败，请稍后重试");
    } finally {
      if (mountedRef.current) setClaiming(false);
    }
  };

  return (
    <main className={`ck${isDark ? " is-dark" : ""}`}>
      {loading ? (
        <div className="ck-state" aria-live="polite">
          <div className="ck-state__loader" aria-hidden="true"><span /><span /><span /></div>
          <p>正在读取签到状态...</p>
        </div>
      ) : loadError ? (
        <section className="ck-state is-error">
          <i className="bi bi-cloud-slash" aria-hidden="true" />
          <h1>签到活动加载失败</h1>
          <p>{loadError}</p>
          <button type="button" className="ck-action is-secondary" onClick={() => load()}><i className="bi bi-arrow-clockwise" aria-hidden="true" />重新加载</button>
        </section>
      ) : state ? (
        <div className="ck-dashboard">
          <section className="ck-hero" aria-labelledby="ck-page-title">
            <div className="ck-hero__copy">
              <p className="ck-kicker">DAILY CHECK-IN</p>
              <h1 id="ck-page-title"><span>连续签到</span><span>领<strong>创作积分</strong></span></h1>
              <p className="ck-lead">坚持每天签到，积累积分，解锁更多创作可能。</p>
              <div className="ck-hero__actions">
                <button
                  type="button"
                  className={`ck-action is-primary${todayChecked ? " is-claimed" : ""}${claimBurst ? " is-burst" : ""}`}
                  disabled={claiming || todayChecked || !activityEnabled}
                  onClick={claim}
                >
                  <i className={`bi ${todayChecked ? "bi-check2-circle" : claiming ? "bi-arrow-repeat ck-spin" : "bi-gift-fill"}`} aria-hidden="true" />
                  <span>
                    <strong>{todayChecked ? "今日已签到" : claiming ? "签到中..." : "立即签到"}</strong>
                    <small>{activityEnabled ? (todayChecked ? `明日 +${formatPoints(nextReward, { withUnit: false })} 积分` : `领取 +${formatPoints(claimReward, { withUnit: false })} 积分`) : "等待活动重新开放"}</small>
                  </span>
                </button>
                <div className="ck-status" data-tone={!activityEnabled ? "off" : todayChecked ? "done" : "ready"} aria-live="polite">
                  <i aria-hidden="true" /><span><strong>{statusLabel}</strong><small>{statusDetail}</small></span>
                </div>
              </div>
              {claimError && <p className="ck-claim-error" role="alert">{claimError}</p>}
            </div>
            <figure className="ck-hero__visual">
              <img src={checkinArt.hero} alt="橙色签到日历与创作积分" width="1254" height="1254" fetchPriority="high" />
            </figure>
          </section>

          <section className="ck-stats" aria-label="签到数据概览">
            {[
              [checkinArt.calendar, "连续签到", state.currentStreak, "天"],
              [checkinArt.medal, "累计积分", formatPoints(state.monthRewardCents, { withUnit: false }), "分"],
              [checkinArt.target, "本月签到", state.monthRecords?.length || 0, "次"],
              [checkinArt.growth, "当前进度", `D${String(activeCycleDay).padStart(2, "0")}`, "/7"],
            ].map(([image, label, value, unit]) => (
              <article key={label}><div className="ck-stat__icon"><img src={image} alt="" width="128" height="128" /></div><p>{label}</p><strong>{value}<em>{unit}</em></strong></article>
            ))}
          </section>

          <section className="ck-panel ck-rewards" aria-labelledby="ck-rewards-title">
            <header className="ck-panel__header">
              <div className="ck-panel__title"><img src={checkinArt.rewardTitle} alt="" width="128" height="96" /><div><h2 id="ck-rewards-title">签到奖励</h2><p>连续签到得更多积分，中断后从第 1 天重新计算。</p></div></div>
              <span className="ck-cycle-label">{todayChecked ? `已完成 D${completedCycleDay}` : `今天 D${activeCycleDay}`}</span>
            </header>
            <div className="ck-reward-track" role="list">
              {rewardItems.map((reward) => {
                const active = !todayChecked && reward.day === activeCycleDay;
                const done = reward.day <= completedCycleDay;
                return (
                  <article key={reward.day} role="listitem" className={`${active ? "is-active " : ""}${done ? "is-done " : ""}${reward.milestone ? "is-milestone" : ""}`}>
                    {active && <span className="ck-reward__today">今天</span>}
                    <span className="ck-reward__day">DAY {reward.day}</span>
                    <img src={checkinArt.coin} alt="" width="128" height="128" loading="lazy" />
                    <strong>+{formatPoints(reward.rewardCents, { withUnit: false })}</strong>
                    <small>{reward.milestone ? "里程碑" : "积分"}</small>
                    {done && <i className="bi bi-check-circle-fill" aria-hidden="true" />}
                  </article>
                );
              })}
            </div>
            <div className="ck-progress" aria-label="本周期签到进度"><span style={{ width: `${progressPercent}%` }} /></div>
            <footer className="ck-reward-note"><img src={checkinArt.tip} alt="" width="128" height="85" loading="lazy" /><p>积分自动入账钱包，可用于全部 AI 创作工作台。</p><Link to="/wallet">查看钱包<i className="bi bi-arrow-right" aria-hidden="true" /></Link></footer>
          </section>

          <section className="ck-panel ck-calendar" aria-labelledby="ck-calendar-title">
            <header className="ck-panel__header">
              <div><h2 id="ck-calendar-title">{monthTitle}</h2><p>已签到 {state.monthRecords?.length || 0} 天</p></div>
              <span className="ck-user" title={auth.user?.email || displayName}><em>{displayName.slice(0, 1).toUpperCase()}</em><span>{displayName}</span></span>
            </header>
            <div className="ck-calendar__body">
              <div className="ck-week" aria-hidden="true">{weekLabels.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="ck-grid">
                {calendarDays.map((cell) => (
                  <div
                    key={cell.key}
                    className={`ck-day${cell.record ? " is-checked" : ""}${cell.today ? " is-today" : ""}${!cell.day ? " is-empty" : ""}`}
                    aria-label={cell.day ? `${cell.date}${cell.record ? "，已签到" : cell.today ? "，今天" : ""}` : undefined}
                  >
                    {cell.day && <span>{cell.day}</span>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
