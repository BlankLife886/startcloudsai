import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Dialog, Toast } from "@mobile/components/overlay/index.js";
import {
  BellOutline,
  CalendarOutline,
  EditSOutline,
  GiftOutline,
  GlobalOutline,
  MessageOutline,
  PicturesOutline,
  QuestionCircleOutline,
  StarOutline,
  UploadOutline,
} from "antd-mobile-icons";
import { useAuth } from "@react/auth/AuthContext.jsx";
import { logoutAccount } from "@react/legacy-modules/services/auth.js";
import { getOverview } from "@react/legacy-modules/services/meApi.js";
import { getCheckinState } from "@react/legacy-modules/services/checkinApi.js";
import { goLogin } from "@mobile/app/login.js";
import { PageHeader } from "@mobile/components/PageHeader.jsx";
import { ChevronRightIcon } from "@mobile/components/icons.jsx";
import "./me.css";

// 手机版还没有的页面暂时跳电脑版。
function openDesktop(path) {
  window.location.assign(path);
}

function displayName(user) {
  return user?.username || user?.nickname || user?.displayName || String(user?.email || "").split("@")[0] || "创作者";
}

function countLabel(count) {
  return count > 99 ? "99+" : String(count);
}

function checkinDetail(state) {
  if (!state) return "同步中";
  if (state.enabled === false) return "暂未开放";
  if (state.todayChecked) return `已签到 · ${state.currentStreak || 1} 天`;
  return `+${Number(state.claimRewardCents) || 0} 积分`;
}

/** 设置列表的一行：左侧图标井、标题与说明、右侧箭头。 */
function ActionCell({ icon, title, detail, badge = 0, onClick }) {
  return (
    <button type="button" className="m-me-cell m-pressable" onClick={onClick}>
      <span className="m-me-cell-icon">
        {icon}
        {badge > 0 && <em className="m-me-badge">{countLabel(badge)}</em>}
      </span>
      <span className="m-me-cell-text">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <span className="m-me-cell-arrow"><ChevronRightIcon /></span>
    </button>
  );
}

function Metric({ value, label, onClick }) {
  return (
    <button type="button" className="m-me-metric m-pressable" onClick={onClick}>
      <strong>{value ?? "--"}</strong>
      <small>{label}</small>
    </button>
  );
}

function Section({ title, children }) {
  return (
    <section className="m-me-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** 与 App 的“我的”Tab 一致：身份区 + 数据、内容管理、权益与服务、设置与支持。 */
export default function MePage({ active }) {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading, setUser } = useAuth();
  const [overview, setOverview] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const refresh = useCallback(() => {
    if (!isAuthenticated) {
      setOverview(null);
      setCheckin(null);
      return;
    }
    getOverview().then(setOverview).catch(() => null);
    getCheckinState().then(setCheckin).catch(() => null);
  }, [isAuthenticated]);

  // 每次切到“我的”都刷新数据，其他页面生成后这里能看到最新数字。
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  const logout = async () => {
    const ok = await Dialog.confirm({ content: "确定退出当前账号？", confirmText: "退出", danger: true });
    if (!ok) return;
    try {
      await logoutAccount();
    } catch {
      // 服务端会话失效也要清掉本机登录状态。
    }
    setUser(null);
    Toast.show({ content: "已退出登录" });
  };

  const avatar = avatarFailed ? "" : user?.avatarUrl || user?.avatar || "";
  const unread = Number(overview?.unreadNotifications) || 0;
  const points = overview?.wallet ? Math.max(0, Number(overview.wallet.balancePoints ?? overview.wallet.availableCents ?? 0)) : null;

  const support = (
    <Section title="设置与支持">
      <div className="m-me-cells">
        <ActionCell icon={<QuestionCircleOutline />} title="帮助中心" onClick={() => openDesktop("/support")} />
        <ActionCell icon={<MessageOutline />} title="问题反馈" onClick={() => openDesktop("/feedback")} />
        <ActionCell icon={<GlobalOutline />} title="切换到电脑版" detail="完整功能" onClick={() => openDesktop("/")} />
      </div>
    </Section>
  );

  if (!isAuthenticated) {
    return (
      <>
        <PageHeader title="我的" />
        <div className="m-tab-body m-me">
          <section className="m-me-guest m-card-surface">
            <span className="m-me-avatar is-brand"><img src={`${import.meta.env.BASE_URL}brand/brand_mark.svg`} alt="" /></span>
            <span className="m-me-name">
              <strong>星空账号</strong>
              <small>{loading ? "正在读取账号…" : "未登录"}</small>
            </span>
            {!loading && (
              <button type="button" className="m-btn-primary m-pressable" onClick={goLogin}>登录</button>
            )}
          </section>

          <Section title="我的创作">
            <div className="m-me-tiles">
              <button type="button" className="m-me-tile m-card-surface m-pressable" onClick={() => navigate("/create")}>
                <PicturesOutline />
                <strong>我的作品</strong>
              </button>
              <button type="button" className="m-me-tile m-card-surface m-pressable" onClick={() => openDesktop("/assets")}>
                <PicturesOutline />
                <strong>我的素材</strong>
              </button>
            </div>
          </Section>

          {support}

          <nav className="m-me-legal">
            <a href="/terms">用户协议</a>
            <a href="/privacy">隐私政策</a>
          </nav>
        </div>
      </>
    );
  }

  return (
    <div className="m-tab-body m-me is-signed-in">
      <section className="m-me-hero">
        <div className="m-me-identity">
          <span className="m-me-avatar">
            {avatar ? <img src={avatar} alt="" onError={() => setAvatarFailed(true)} /> : displayName(user).slice(0, 1).toUpperCase()}
          </span>
          <span className="m-me-name">
            <strong>{displayName(user)}</strong>
            {user?.email && <small>{user.email}</small>}
          </span>
          <span className="m-me-hero-actions">
            <button type="button" className="m-me-icon-btn m-pressable" aria-label="通知" onClick={() => openDesktop("/notifications")}>
              <BellOutline />
              {unread > 0 && <em className="m-me-badge">{countLabel(unread)}</em>}
            </button>
            <button type="button" className="m-me-icon-btn m-pressable" aria-label="编辑资料" onClick={() => openDesktop("/profile")}>
              <EditSOutline />
            </button>
          </span>
        </div>
        <div className="m-me-metrics">
          <Metric value={points} label="可用积分" onClick={() => openDesktop("/wallet")} />
          <Metric value={overview?.taskStats?.total} label="历史记录" onClick={() => navigate("/create")} />
          <Metric value={overview?.assetCount} label="我的素材" onClick={() => openDesktop("/assets")} />
        </div>
      </section>

      <Section title="内容管理">
        <div className="m-me-cells">
          <ActionCell
            icon={<UploadOutline />}
            title="我的投稿"
            detail={overview?.submissionStats?.total ? `${overview.submissionStats.total} 个投稿` : "暂无投稿"}
            onClick={() => openDesktop("/submissions")}
          />
          <ActionCell icon={<StarOutline />} title="我的收藏" detail="收藏的提示词" onClick={() => navigate("/home?tab=prompts")} />
          <ActionCell icon={<BellOutline />} title="通知中心" detail={unread ? `${unread} 条未读` : "暂无未读"} badge={unread} onClick={() => openDesktop("/notifications")} />
        </div>
      </Section>

      <Section title="权益与服务">
        <button type="button" className="m-me-banner m-pressable" onClick={() => navigate("/orders")}>
          <span className="m-me-banner-text">
            <strong>套餐与订单</strong>
            <small>购买积分，查看历史订单</small>
          </span>
          <span className="m-me-banner-go">去查看</span>
        </button>
        <div className="m-me-pair">
          <button type="button" className="m-me-color is-mint m-pressable" onClick={() => openDesktop("/check-in")}>
            <CalendarOutline />
            <strong>每日签到</strong>
            <small>{checkinDetail(checkin)}</small>
          </button>
          <button type="button" className="m-me-color is-rose m-pressable" onClick={() => openDesktop("/incentive-plans")}>
            <GiftOutline />
            <strong>福利中心</strong>
            <small>领取活动与试用权益</small>
          </button>
        </div>
      </Section>

      {support}

      <button type="button" className="m-me-logout m-pressable" onClick={logout}>退出登录</button>
    </div>
  );
}
