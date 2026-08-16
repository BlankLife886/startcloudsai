import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Link, useLocation, useNavigate } from "react-router";
import { getOverview, updateProfile } from "@react/legacy-modules/services/meApi.js";
import { logoutAccount } from "@react/legacy-modules/services/auth.js";
import { formatPoints } from "@react/legacy-modules/services/billingApi.js";
import { TASK_UPDATE_EVENT } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-static/views/ProfileView.modern.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { LogoutDialog } from "../components/LogoutDialog.jsx";
import { useIsDark } from "../hooks/useIsDark.js";

gsap.registerPlugin(useGSAP);

const LEGACY_TABS = {
  works: "/history",
  notifications: "/notifications",
  materials: "/assets",
  submissions: "/submissions",
  wallet: "/wallet",
  account: "/account",
};

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function ProfileView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const location = useLocation();
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  const realtimeTimerRef = useRef(0);
  const [overview, setOverview] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadOverview = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await getOverview({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      setOverview(result);
      const unread = numeric(result?.unreadNotifications);
      setUnreadCount(unread);
      window.dispatchEvent(
        new CustomEvent("starclouds:notifications-updated", {
          detail: { unreadCount: unread, source: "profile-overview" },
        }),
      );
    } catch (error) {
      if (error?.name !== "AbortError") {
        // The dashboard keeps stable zero states when overview is unavailable.
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const tab = new URLSearchParams(location.search).get("tab") || "";
    if (LEGACY_TABS[tab]) {
      navigate(LEGACY_TABS[tab], { replace: true });
      return undefined;
    }
    void loadOverview();
    const onTaskUpdate = (event) => {
      const status = event?.detail?.task?.status;
      if (!["succeeded", "failed", "canceled"].includes(status)) return;
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
      realtimeTimerRef.current = window.setTimeout(() => {
        realtimeTimerRef.current = 0;
        void loadOverview();
      }, 120);
    };
    const onWalletUpdated = (event) => {
      const snapshot = event?.detail;
      if (!snapshot) return;
      setOverview((current) => ({
        ...(current || {}),
        wallet: {
          ...(current?.wallet || {}),
          balanceCents: Number(snapshot.balanceCents || 0),
          frozenCents: Number(snapshot.frozenCents || 0),
        },
      }));
    };
    window.addEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      window.removeEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    };
  }, [loadOverview, location.search, navigate]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduce: "(prefers-reduced-motion: reduce)",
          motion: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          const targets = [
            ".pp-soft-hero",
            ".pp-bento-hero-figure",
            ".pp-soft-performance",
            ".pp-soft-stat",
          ];
          if (context.conditions.reduce) {
            gsap.set(targets, { clearProps: "all" });
            return undefined;
          }
          const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
          timeline
            .from(".pp-soft-hero", { autoAlpha: 0, y: 18, duration: 0.5 }, 0)
            .from(
              ".pp-bento-hero-figure",
              { autoAlpha: 0, y: 20, duration: 0.55 },
              0.12,
            )
            .from(
              ".pp-soft-performance",
              { autoAlpha: 0, y: 22, duration: 0.48 },
              0.1,
            )
            .from(
              ".pp-soft-stat",
              {
                autoAlpha: 0,
                y: 18,
                duration: 0.45,
                stagger: 0.05,
                clearProps: "transform",
              },
              0.16,
            );
          return undefined;
        },
      );
      return () => media.revert();
    },
    { scope: pageRef },
  );

  const taskStats = useMemo(
    () => ({
      total: numeric(overview?.taskStats?.total),
      succeeded: numeric(overview?.taskStats?.succeeded),
      failed: numeric(overview?.taskStats?.failed),
      running: numeric(overview?.taskStats?.running),
    }),
    [overview],
  );
  const successRate = useMemo(() => {
    const done = taskStats.succeeded + taskStats.failed;
    return done ? Math.round((taskStats.succeeded / done) * 100) : 0;
  }, [taskStats]);
  const submissionStats = useMemo(
    () => ({
      total: numeric(overview?.submissionStats?.total),
      pending: numeric(overview?.submissionStats?.pending),
      approved: numeric(overview?.submissionStats?.approved),
      rejected: numeric(overview?.submissionStats?.rejected),
      removed: numeric(overview?.submissionStats?.removed),
    }),
    [overview],
  );
  const materialCount = numeric(overview?.assetCount);
  const balanceCents = numeric(overview?.wallet?.balanceCents);
  const pointsDisplay = formatPoints(balanceCents, { withUnit: false });
  const requireCostConfirm = auth.user?.requireCostConfirm !== false;

  const setCostConfirmPreference = async (enabled) => {
    if (preferenceSaving) return;
    const previous = requireCostConfirm;
    const next = Boolean(enabled);
    auth.setUser((user) => ({ ...user, requireCostConfirm: next }));
    setPreferenceSaving(true);
    try {
      const result = await updateProfile({ requireCostConfirm: next });
      if (!mountedRef.current) return;
      const patch = result?.user || { requireCostConfirm: next };
      auth.setUser((user) => ({ ...user, ...patch }));
      notificationService.success(
        next ? "已开启生成前费用确认" : "已关闭生成前费用确认",
      );
    } catch (error) {
      if (!mountedRef.current) return;
      auth.setUser((user) => ({ ...user, requireCostConfirm: previous }));
      notificationService.error(error?.message || "创作偏好保存失败");
    } finally {
      if (mountedRef.current) setPreferenceSaving(false);
    }
  };

  const confirmLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAccount().catch(() => null);
      auth.setUser(null);
      if (mountedRef.current)
        navigate("/auth?mode=login&redirect=%2Fprofile", { replace: true });
    } finally {
      if (mountedRef.current) {
        setLoggingOut(false);
        setLogoutOpen(false);
      }
    }
  };

  return (
    <div
      ref={pageRef}
      className={`pp-page is-soft is-dashboard ${isDark ? "is-dark" : "is-light"}`}
    >
      <div className="pp-atmosphere" aria-hidden="true">
        <div className="pp-atmosphere__wash" />
        <div className="pp-atmosphere__orb pp-atmosphere__orb--a" />
        <div className="pp-atmosphere__orb pp-atmosphere__orb--b" />
      </div>
      <div className="pp-shell">
        <main className="pp-main">
          <section
            id="profile-panel-dashboard"
            className="pp-panel pp-soft-board"
            role="tabpanel"
          >
            <div className="pp-soft-hero">
              <div className="pp-soft-stripes" aria-hidden="true" />
              <div className="pp-soft-character" aria-hidden="true">
                <img
                  className="pp-bento-hero-figure"
                  src="/sucai/profile-hero-character.png?v=4"
                  alt=""
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
              </div>
              <div className="pp-soft-event">
                <p className="pp-soft-event__eyebrow">Hi, Welcome</p>
                <h2>
                  {auth.user?.username || "创作者"} <em>Studio</em>
                </h2>
                <p className="pp-soft-event__date">
                  可用积分 {pointsDisplay} · 累计任务 {taskStats.total}
                </p>
                <div className="pp-soft-event__actions">
                  <Link to="/ai-wallpaper">+ 开始创作</Link>
                  <Link to="/pricing">+ 充值积分</Link>
                </div>
                <div className="pp-soft-event__chip">
                  <i /> 素材 {materialCount} · 投稿通过{" "}
                  {submissionStats.approved}
                </div>
                <button
                  type="button"
                  className="pp-soft-event__logout"
                  disabled={loggingOut}
                  onClick={() => setLogoutOpen(true)}
                >
                  <i className="bi bi-box-arrow-right" aria-hidden="true" />
                  {loggingOut ? "退出中…" : "退出登录"}
                </button>
              </div>
            </div>
            <aside className="pp-soft-performance">
              <header>
                <strong>Performance</strong>
                <button type="button" onClick={() => navigate("/submissions")}>
                  查看投稿
                </button>
              </header>
              <div className="pp-soft-progress">
                <span>成功率 {successRate}%</span>
                <b>
                  <i style={{ width: `${successRate}%` }} />
                </b>
              </div>
              <ul className="pp-soft-perf-list">
                <li>
                  <span>进行中</span>
                  <strong>{taskStats.running}</strong>
                </li>
                <li>
                  <span>已成功</span>
                  <strong>{taskStats.succeeded}</strong>
                </li>
                <li>
                  <span>失败</span>
                  <strong>{taskStats.failed}</strong>
                </li>
                <li>
                  <span>审核中</span>
                  <strong>{submissionStats.pending}</strong>
                </li>
              </ul>
              <label
                className={`pp-soft-switch${preferenceSaving ? " is-saving" : ""}`}
              >
                <span>
                  <em>生成前确认费用</em>
                  <small>{requireCostConfirm ? "已开启" : "已关闭"}</small>
                </span>
                <input
                  type="checkbox"
                  checked={requireCostConfirm}
                  disabled={preferenceSaving}
                  onChange={(event) =>
                    setCostConfirmPreference(event.target.checked)
                  }
                />
              </label>
              <div className="pp-soft-perf-foot">
                <Link to="/history">创作历史</Link>
                <Link to="/account">账号设置</Link>
              </div>
            </aside>
            <div className="pp-soft-stats">
              <Link to="/assets" className="pp-soft-stat">
                <small>To do</small>
                <strong>{materialCount}</strong>
                <span>我的资产</span>
              </Link>
              <Link to="/notifications" className="pp-soft-stat">
                <small>On going</small>
                <strong>{unreadCount}</strong>
                <span>未读通知</span>
              </Link>
              <Link to="/submissions" className="pp-soft-stat">
                <small>Complete</small>
                <strong>
                  {String(submissionStats.approved).padStart(2, "0")}
                </strong>
                <span>过审投稿</span>
              </Link>
              <Link to="/wallet" className="pp-soft-stat is-earn">
                <small>Earnings</small>
                <strong>{pointsDisplay}</strong>
                <span>可用积分</span>
              </Link>
            </div>
          </section>
        </main>
      </div>
      <LogoutDialog
        open={logoutOpen}
        busy={loggingOut}
        isDark={isDark}
        onClose={() => !loggingOut && setLogoutOpen(false)}
        onConfirm={confirmLogout}
      />
    </div>
  );
}
