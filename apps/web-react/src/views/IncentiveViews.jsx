import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  formatCents,
  formatPoints,
  listPlans,
} from "@react/legacy-modules/services/billingApi.js";
import { submitFeedback } from "@react/legacy-modules/services/feedbackApi.js";
import {
  createGrowthGroup,
  joinGrowthGroup,
} from "@react/legacy-modules/services/growthApi.js";
import { getWallet } from "@react/legacy-modules/services/meApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { useGrowthPrograms } from "../hooks/useGrowthPrograms.js";
import { useIsDark } from "../hooks/useIsDark.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";

gsap.registerPlugin(useGSAP);

const allBenefits = [
  {
    id: "group",
    name: "好友拼团",
    category: "拼团裂变",
    icon: "bi-people-fill",
    iconSrc: "/incentives/24.webp",
    artSrc: "/incentives/11.webp",
    tag: "一起拼团 · 更享优惠",
    description: "发起或加入限时拼团，满员后奖励自动发放到每位成员账户。",
    action: "进入拼团",
    ctaSrc: "/incentives/7.webp",
    tone: "coral",
  },
  {
    id: "membership",
    name: "会员计划",
    category: "长期价值",
    icon: "bi-gem",
    description: "集中查看会员周期、积分供给与专属权益方案。",
    action: "查看计划",
    tone: "violet",
  },
  {
    id: "failure",
    name: "失败补偿",
    category: "服务保障",
    icon: "bi-gift-fill",
    iconSrc: "/incentives/21.webp",
    artSrc: "/incentives/12.webp",
    tag: "符合规则 · 自动退款",
    description: "符合规则的失败任务自动退款，并按活动配置发放额外补偿。",
    action: "查看保障",
    ctaSrc: "/incentives/5.webp",
    tone: "blue",
  },
  {
    id: "usage",
    name: "用量激励",
    category: "用量激励",
    icon: "bi-bar-chart-fill",
    iconSrc: "/incentives/22.webp",
    artSrc: "/incentives/14.webp",
    tag: "按月发放 · 自动到账",
    description: "按本月成功交付量解锁档位奖励，达标后积分自动到账。",
    action: "查看计划",
    ctaSrc: "/incentives/8.webp",
    tone: "amber",
  },
  {
    id: "suggestion",
    name: "建议采纳",
    category: "产品共创",
    icon: "bi-lightbulb-fill",
    iconSrc: "/incentives/23.webp",
    artSrc: "/incentives/13.webp",
    tag: "好建议，让产品更进一步",
    description: "提交产品建议，评审采纳后按价值等级发放创作积分。",
    action: "参与共创",
    ctaSrc: "/incentives/6.webp",
    tone: "green",
  },
];

const benefitOrder = ["usage", "group", "suggestion", "failure"];
const benefits = benefitOrder
  .map((id) => allBenefits.find((benefit) => benefit.id === id))
  .filter(Boolean);

const heroHighlights = [
  { icon: "bi-robot", label: "自动到账" },
  { icon: "bi-shield-check", label: "公平透明" },
  { icon: "bi-lightning-charge-fill", label: "快速激励" },
];

const previewPlans = [
  {
    id: "trial",
    name: "体验版",
    subtitle: "适合初次体验的你",
    icon: "bi-gem",
    price: "¥0",
    period: "/ 永久",
    features: ["基础功能访问", "标准内容浏览", "社区支持"],
    action: "当前计划",
    target: "create",
    current: true,
  },
  {
    id: "basic",
    name: "基础版",
    subtitle: "满足日常使用需求",
    icon: "bi-tree-fill",
    price: "¥28",
    period: "/ 月",
    features: ["基础功能全部开放", "高清内容浏览", "优先客服支持"],
    action: "选择此计划",
    target: "trial",
  },
  {
    id: "premium",
    name: "高级版",
    subtitle: "畅享更多专属权益",
    icon: "bi-star-fill",
    price: "¥68",
    period: "/ 月",
    yearly: "¥680 / 年（省 17%）",
    features: ["全部高级功能", "独家内容与资源", "专属客服支持", "无广告体验"],
    action: "选择此计划",
    target: "trial",
    recommended: true,
  },
  {
    id: "pro",
    name: "专业版",
    subtitle: "为高效人士打造",
    icon: "bi-award-fill",
    price: "¥128",
    period: "/ 月",
    yearly: "¥1280 / 年（省 17%）",
    features: [
      "包含高级版所有权益",
      "团队协作功能",
      "数据分析报表",
      "API 访问权限",
    ],
    action: "选择此计划",
    target: "trial",
  },
  {
    id: "enterprise",
    name: "企业版",
    subtitle: "满足企业需求",
    icon: "bi-gem",
    price: "定制价格",
    period: "",
    yearly: "联系销售获取报价",
    features: [
      "包含专业版所有权益",
      "专属解决方案",
      "私有化部署",
      "7×24 小时支持",
    ],
    action: "联系销售",
    target: "feedback",
  },
];

const benefitMap = {
  group: {
    ...allBenefits[0],
    tone: "coral",
    statement: "和好友一起创作，一起解锁积分奖励。",
  },
  membership: {
    ...allBenefits[1],
    tone: "violet",
    statement: "为持续创作准备稳定、清晰的长期权益。",
  },
  failure: {
    ...allBenefits[2],
    tone: "teal",
    statement: "生成服务异常时，获得明确且可预期的保障。",
  },
  milestone: {
    ...allBenefits[3],
    tone: "amber",
    statement: "本月交付越多，自动解锁越高阶的积分回馈。",
  },
  usage: {
    ...allBenefits[3],
    tone: "amber",
    statement: "本月交付越多，自动解锁越高阶的积分回馈。",
  },
  suggestion: {
    ...allBenefits[4],
    tone: "green",
    statement: "让真实、有价值的产品建议获得清晰回报。",
  },
};

function BackButton({ className }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1 && Number(window.history.state?.idx || 0) > 0)
      navigate(-1);
    else navigate("/incentive-plans");
  };
  return (
    <button type="button" className={className} onClick={goBack}>
      <i className="bi bi-arrow-left" aria-hidden="true" />
      返回
    </button>
  );
}

function LoadingBars({ className, label }) {
  return (
    <div className={className} aria-live="polite">
      <span />
      <span />
      <span />
      {label && <p>{label}</p>}
    </div>
  );
}

function IncentiveAtmosphere() {
  return (
    <div className="incentive-hero__atmosphere" aria-hidden="true">
      <span className="incentive-orb incentive-orb--a" />
      <span className="incentive-orb incentive-orb--b" />
      <span className="incentive-orb incentive-orb--c" />
    </div>
  );
}

function useIncentiveEntrance(pageRef, targets, dependencies = []) {
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
        },
        () => {
          if (
            document.documentElement.classList.contains("settings-no-animations")
          ) {
            return undefined;
          }
          const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
          targets.forEach((target, index) => {
            const [selector, extra] = Array.isArray(target)
              ? target
              : [target, {}];
            timeline.from(
              selector,
              {
                y: index === 0 ? 16 : 18,
                autoAlpha: 0,
                duration: index === 0 ? 0.5 : 0.4,
                clearProps: "transform,opacity,visibility",
                ...extra,
              },
              index === 0 ? 0 : "-=0.24",
            );
          });
          return undefined;
        },
      );
      return () => media.revert();
    },
    { scope: pageRef, dependencies, revertOnUpdate: dependencies.length > 0 },
  );
}

export function CreatorIncentivesView() {
  const auth = useAuth();
  const { isEntryVisible } = usePageControls();
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data } = useGrowthPrograms();
  const [wallet, setWallet] = useState(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
        },
        () => {
          if (document.documentElement.classList.contains("settings-no-animations")) {
            return undefined;
          }
          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(".rewards-hero__copy > *", {
              y: 18,
              autoAlpha: 0,
              duration: 0.45,
              stagger: 0.05,
              clearProps: "transform,opacity,visibility",
            })
            .from(
              ".rewards-hero__visual",
              {
                x: 18,
                autoAlpha: 0,
                duration: 0.5,
                clearProps: "transform,opacity,visibility",
              },
              "-=0.36",
            )
            .from(
              ".benefit-card",
              {
                y: 22,
                autoAlpha: 0,
                duration: 0.42,
                stagger: 0.07,
                clearProps: "transform,opacity,visibility",
              },
              "-=0.28",
            )
            .from(
              ".rewards-summary",
              {
                y: 14,
                autoAlpha: 0,
                duration: 0.4,
                clearProps: "transform,opacity,visibility",
              },
              "-=0.22",
            );
          return undefined;
        },
      );
      return () => media.revert();
    },
    { scope: pageRef },
  );

  useEffect(() => {
    const controller = new AbortController();
    const onWalletUpdated = (event) => {
      if (event?.detail) setWallet((current) => ({ ...(current || {}), ...event.detail }));
    };
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    getWallet({ signal: controller.signal })
      .then(setWallet)
      .catch(() => null);
    return () => {
      controller.abort();
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
    };
  }, []);

  const joinedPlans =
    Number(Boolean(data?.group)) +
    Number(Number(data?.monthUnits || 0) > 0) +
    Number(Number(data?.failureClaims || 0) > 0) +
    Number(Boolean(data?.suggestion?.status));
  const visibleBenefits = benefits.filter((benefit) =>
    isEntryVisible(`/incentive-plans/${benefit.id}`),
  );
  const stats = [
    [
      "points",
      "我的积分",
      formatPoints(
        Math.max(
          0,
          Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0),
        ),
        { withUnit: false },
      ),
      "/incentives/1.webp",
      "violet",
      "/wallet",
      "查看钱包",
    ],
    [
      "pending",
      "待发放奖励",
      formatPoints(Math.max(0, Number(wallet?.frozenCents || 0)), {
        withUnit: false,
      }),
      "/incentives/2.webp",
      "blue",
      "/wallet",
      "查看冻结",
    ],
    [
      "joined",
      "已参与计划",
      String(joinedPlans),
      "/incentives/4.webp",
      "green",
      "#reward-plans",
      "查看计划",
    ],
    [
      "benefits",
      "可用权益",
      String(visibleBenefits.length),
      "/incentives/3.webp",
      "orange",
      "#reward-plans",
      "浏览权益",
    ],
  ];
  return (
    <main
      ref={pageRef}
      className={`rewards-page${isDark ? " is-dark" : ""}`}
    >
      <div className="rewards-shell">
        <section className="rewards-hero">
          <div className="rewards-hero__copy">
            <p>CREATOR REWARDS</p>
            <h1>创作激励</h1>
            <span>选择一个激励计划，查看权益、进度与参与方式，让每一份创作被看见。</span>
            <ul className="rewards-hero__pills">
              {heroHighlights.map((item) => (
                <li key={item.label}>
                  <i className={`bi ${item.icon}`} aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>
            <div className="rewards-hero__actions">
              <a href="#reward-plans">
                查看激励计划
                <i className="bi bi-arrow-right" aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="rewards-hero__visual" aria-hidden="true">
            <img src="/incentives/hero-trophy.webp" alt="" width="900" height="900" decoding="async" />
          </div>
        </section>
        <section
          id="reward-plans"
          className="benefit-section"
          aria-label="创作激励计划"
        >
          <div className="benefit-grid">
            {visibleBenefits.map((benefit) => (
              <Link
                key={benefit.id}
                to={`/incentive-plans/${benefit.id}`}
                className={`benefit-card is-${benefit.tone}`}
              >
                <div className="benefit-card__head">
                  <span className="benefit-card__icon" aria-hidden="true">
                    {benefit.iconSrc ? (
                      <img src={benefit.iconSrc} alt="" width="160" height="160" />
                    ) : (
                      <i className={`bi ${benefit.icon}`} />
                    )}
                  </span>
                  <div className="benefit-card__titles">
                    <h2>{benefit.name}</h2>
                    {benefit.tag ? (
                      <span className="benefit-card__tag">{benefit.tag}</span>
                    ) : null}
                  </div>
                </div>
                <p>{benefit.description}</p>
                <span className="benefit-card__cta">
                  {benefit.ctaSrc ? (
                    <img
                      src={benefit.ctaSrc}
                      alt={benefit.action}
                      width="128"
                      height="56"
                      decoding="async"
                    />
                  ) : (
                    <>
                      {benefit.action}
                      <i className="bi bi-arrow-right" aria-hidden="true" />
                    </>
                  )}
                </span>
                {benefit.artSrc ? (
                  <div className="benefit-card__art" aria-hidden="true">
                    <img
                      src={benefit.artSrc}
                      alt=""
                      width="720"
                      height="720"
                      decoding="async"
                    />
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
        <section className="rewards-summary" aria-label="激励概览">
          {stats.map(([id, label, value, icon, tone, to]) => {
            const content = (
              <>
                <span className="rewards-summary__icon" aria-hidden="true">
                  <img src={icon} alt="" width="128" height="128" />
                </span>
                <div className="rewards-summary__copy">
                  <small>{label}</small>
                  <strong>{auth.isAuthenticated ? value : "—"}</strong>
                </div>
              </>
            );
            return to.startsWith("#") ? (
              <a
                key={id}
                href={to}
                className={`rewards-summary__item is-${tone}`}
              >
                {content}
              </a>
            ) : (
              <Link
                key={id}
                to={to}
                className={`rewards-summary__item is-${tone}`}
              >
                {content}
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function readGrowthGroup(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.group && typeof payload.group === "object") return payload.group;
  if (payload.code) return payload;
  return null;
}

function remainingGroupTime(expiresAt) {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "已过期";
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `剩余 ${minutes} 分钟`;
  const hours = Math.max(1, Math.ceil(ms / 36e5));
  if (hours <= 48) return `剩余 ${hours} 小时`;
  return `剩余 ${Math.ceil(hours / 24)} 天`;
}

const groupArt = Object.freeze({
  gift: "/friend-group/hero-gift.webp",
  coin: "/friend-group/reward-coin.webp",
  invite: "/friend-group/step-invite.webp",
  join: "/friend-group/step-join.webp",
  reward: "/friend-group/step-reward.webp",
});

const GROWTH_AUTO_JOIN_KEY = "sc_growth_auto_join";

function rememberAutoJoin(code) {
  const value = String(code || "")
    .trim()
    .toUpperCase();
  if (value.length < 6) return;
  sessionStorage.setItem(GROWTH_AUTO_JOIN_KEY, value);
}

function takeAutoJoin(expectedCode = "") {
  const pending = sessionStorage.getItem(GROWTH_AUTO_JOIN_KEY)?.trim().toUpperCase() || "";
  const expected = String(expectedCode || "")
    .trim()
    .toUpperCase();
  if (!expected || pending !== expected) return "";
  sessionStorage.removeItem(GROWTH_AUTO_JOIN_KEY);
  return pending;
}

export function FriendGroupView() {
  const location = useLocation();
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data, setData, loading, error, reload } = useGrowthPrograms();
  const [submitting, setSubmitting] = useState("");
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [copied, setCopied] = useState("");
  const copiedTimerRef = useRef(0);
  const queryCode =
    new URLSearchParams(location.search).get("code")?.trim().toUpperCase() ||
    "";
  const [joinCode, setJoinCode] = useState(queryCode);
  const rules = data?.rules || {};
  const group = data?.group || null;
  const members = Array.isArray(group?.members) ? group.members : [];
  const targetMembers = Math.max(
    0,
    Number(group?.targetMembers || rules.groupTargetMembers || 3),
  );
  const memberCount = members.length || Number(group?.memberCount || 0);
  const remainingMembers = Math.max(0, targetMembers - memberCount);
  const rewardCents = Number(group?.rewardCents ?? rules.groupRewardCents ?? 30);
  const rewardNumber = formatPoints(rewardCents, { withUnit: false });
  const durationHours = Number(rules.groupDurationHours || 48);
  const campaignOrdinal = Math.max(0, Number(rules.groupCampaignOrdinal || 0));
  const periodLabel = campaignOrdinal > 0 ? `当前第 ${campaignOrdinal} 期` : "";
  const expired =
    group?.status === "expired" ||
    (group?.expiresAt && new Date(group.expiresAt).getTime() <= Date.now());
  const completed = group?.status === "completed";
  const campaignOpen = rules.groupEnabled !== false;
  const requestError = error && error !== "请先登录" ? error : "";
  const expiryLabel =
    group && !completed ? remainingGroupTime(group.expiresAt) : "";
  const slots = Array.from(
    { length: Math.max(targetMembers || 0, 0) },
    (_, index) => {
      const member = members[index] || null;
      const filled = Boolean(member) || (!members.length && index < memberCount);
      const owner =
        member?.role === "owner" ||
        (member && group?.ownerId && member.userId === group.ownerId) ||
        (!member && filled && index === 0);
      return { filled, owner, member };
    },
  );
  const joinFirst = Boolean(queryCode) && !group;
  useEffect(() => {
    if (queryCode) setJoinCode(queryCode);
  }, [queryCode]);

  const inviteUrl = () => {
    const url = new URL(window.location.href);
    url.search = "";
    if (group?.code) url.searchParams.set("code", group.code);
    return url.href;
  };
  const inviteMessage = () => {
    const code = group?.code || "";
    return `我在发起好友拼团，满 ${targetMembers} 人各得 ${rewardNumber} 积分。打开链接加入，或输入拼团码 ${code}\n${inviteUrl()}`;
  };
  const markCopied = (key) => {
    window.clearTimeout(copiedTimerRef.current);
    setCopied(key);
    copiedTimerRef.current = window.setTimeout(() => setCopied(""), 1600);
  };
  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);
  const copyText = async (value, okMessage, failMessage, key = "") => {
    try {
      await navigator.clipboard.writeText(value);
      if (key) markCopied(key);
      notificationService.success(okMessage);
    } catch {
      notificationService.error(failMessage);
    }
  };
  const copyCode = async () => {
    if (!group?.code) return;
    await copyText(group.code, "拼团码已复制", "拼团码复制失败", "code");
  };
  const copyInviteText = async () => {
    if (!group?.code) return;
    await copyText(
      inviteMessage(),
      "邀请文案已复制，发给好友即可加入",
      "邀请文案复制失败",
      "text",
    );
  };
  const copyInviteLink = async () => {
    if (!group?.code) return;
    await copyText(inviteUrl(), "邀请链接已复制", "邀请链接复制失败", "link");
  };
  const shareGroup = async () => {
    if (!group?.code) return;
    const url = inviteUrl();
    try {
      if (navigator.share)
        await navigator.share({
          title: "好友拼团",
          text: inviteMessage(),
          url,
        });
      else await copyInviteText();
    } catch (shareError) {
      if (shareError?.name !== "AbortError")
        notificationService.error("邀请链接分享失败");
    }
  };
  const askCreate = () => {
    if (submitting || !campaignOpen) return;
    if (requestAuth({ featureLabel: "好友拼团" })) return;
    setConfirmCreate(true);
  };
  const runCreate = async () => {
    if (submitting || !campaignOpen) return;
    if (requestAuth({ featureLabel: "好友拼团" })) return;
    setSubmitting("create");
    try {
      const created = readGrowthGroup(await createGrowthGroup());
      if (created) setData((prev) => ({ ...(prev || {}), group: created }));
      setConfirmCreate(false);
      await reload();
      notificationService.success("拼团已发起，复制邀请文案发给好友即可加入");
    } catch (actionError) {
      notificationService.error(actionError?.message || "发起拼团失败");
    } finally {
      setSubmitting("");
    }
  };
  const runJoin = async (event, rawCode = joinCode) => {
    event?.preventDefault?.();
    if (submitting || !campaignOpen) return;
    const code = String(rawCode || "")
      .trim()
      .toUpperCase();
    if (code.length < 6) {
      notificationService.info("请输入有效的好友邀请码");
      return;
    }
    if (requestAuth({ featureLabel: "好友拼团" })) {
      rememberAutoJoin(code);
      return;
    }
    setSubmitting("join");
    try {
      const joined = readGrowthGroup(await joinGrowthGroup(code));
      if (joined) setData((prev) => ({ ...(prev || {}), group: joined }));
      await reload();
      notificationService.success("已加入好友拼团");
    } catch (actionError) {
      notificationService.error(actionError?.message || "加入拼团失败");
    } finally {
      setSubmitting("");
    }
  };
  const runPrimaryAction = async () => {
    if (!group || completed || expired || submitting || !campaignOpen) return;
    if (requestAuth({ featureLabel: "好友拼团" })) return;
    await shareGroup();
  };

  useEffect(() => {
    if (
      loading ||
      group ||
      !campaignOpen ||
      submitting ||
      !auth.isAuthenticated
    ) {
      return undefined;
    }
    const pending = takeAutoJoin(queryCode);
    if (!pending) return undefined;
    setJoinCode(pending);
    void runJoin(null, pending);
    return undefined;
  }, [
    auth.isAuthenticated,
    campaignOpen,
    group,
    loading,
    queryCode,
    submitting,
  ]);

  useIncentiveEntrance(pageRef, [
    ".group-hero",
    ".group-layout",
    [".member-slot", { stagger: 0.07 }],
    [".group-process li", { stagger: 0.05 }],
  ]);

  const remainingCopy = !group
    ? joinFirst
      ? "好友邀请你加入这场拼团。加入后本期不能再参加其他团。"
      : "还没有拼团。发起新团，或输入好友邀请码加入。"
    : completed
      ? "拼团已完成，奖励已发放到每位成员账户。"
      : expired
        ? "这期拼团已过期，不能继续加入。"
        : remainingMembers > 0
          ? (
              <>
                还差 <strong>{remainingMembers}</strong>{" "}
                人即可成团，把邀请文案发给好友吧！
              </>
            )
          : "人数已满，正在结算奖励。";
  const stepIndex = !group
    ? joinFirst
      ? 1
      : 0
    : completed
      ? 2
      : remainingMembers > 0
        ? 0
        : 2;
  const canInviteSlot = Boolean(group?.code) && !completed && !expired;

  return (
    <main
      ref={pageRef}
      className={`group-page${isDark ? " is-dark" : ""}`}
    >
      <div className="group-frame">
        <header className="group-hero">
          <div className="group-hero__copy">
            <BackButton className="group-back" />
            <div className="group-hero__intro">
              <div className="group-hero__title">
                <h1>
                  好友<span>拼团</span>
                </h1>
                {periodLabel ? (
                  <span className="group-period">{periodLabel}</span>
                ) : null}
              </div>
              <p>
                和好友一起创作，一起解锁积分奖励。一期一团，成团后奖励自动到账。
              </p>
            </div>
            <article className="group-hero-reward" aria-label="成团奖励">
              <img src={groupArt.coin} alt="" />
              <div>
                <small>成团奖励</small>
                <strong>
                  {rewardNumber}
                  <span>积分</span>
                </strong>
                <p>
                  目标 {targetMembers} 人成团，每人获得奖励
                  {durationHours > 0 ? `，有效期 ${durationHours} 小时` : ""}
                  {campaignOrdinal > 0
                    ? `。第 ${campaignOrdinal} 期只能参加一团。`
                    : "。一期只能参加一团。"}
                </p>
              </div>
            </article>
          </div>
          <img className="group-hero__art" src={groupArt.gift} alt="" />
        </header>
        <section className="group-workspace" aria-label="好友拼团进度">
          <div className="group-layout">
            <article className="group-board">
              <div className="group-section">
                <h2>拼团进度</h2>
                <p className="group-count">
                  <b>
                    {memberCount}/{targetMembers}
                  </b>
                  <span>人已加入</span>
                </p>
              </div>
              {requestError && (
                <div className="group-error">
                  <span>{requestError}</span>
                  <button type="button" onClick={reload}>
                    重新加载
                  </button>
                </div>
              )}
              {!campaignOpen && (
                <div className="group-error">
                  <span>本期拼团活动未开放。</span>
                </div>
              )}
              <div className="group-stage">
                <div
                  className="member-track"
                  style={{ "--slot-count": Math.max(slots.length, 1) }}
                >
                {(slots.length ? slots : [{ filled: false, owner: false }]).map(
                  (slot, index) => (
                    <div
                      key={slot.member?.userId || index}
                      className={`member-slot${slot.filled ? " is-filled" : ""}${
                        !slot.filled && canInviteSlot ? " is-invite" : ""
                      }`}
                      role={
                        !slot.filled && canInviteSlot ? "button" : undefined
                      }
                      tabIndex={
                        !slot.filled && canInviteSlot ? 0 : undefined
                      }
                      onClick={
                        !slot.filled && canInviteSlot
                          ? copyInviteText
                          : undefined
                      }
                      onKeyDown={
                        !slot.filled && canInviteSlot
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                void copyInviteText();
                              }
                            }
                          : undefined
                      }
                    >
                      <span
                        className={
                          slot.member?.avatarUrl ? "member-avatar" : undefined
                        }
                      >
                        {slot.member?.avatarUrl ? (
                          <img src={slot.member.avatarUrl} alt="" />
                        ) : (
                          <i
                            className={`bi ${
                              slot.filled ? "bi-person-fill" : "bi-plus-lg"
                            }`}
                          />
                        )}
                      </span>
                      <strong>
                        {slot.member?.username ||
                          (slot.owner
                            ? "发起人"
                            : slot.filled
                              ? "已加入"
                              : "待加入")}
                      </strong>
                      {slot.member?.userId &&
                      slot.member.userId === auth.user?.id ? (
                        <em>我</em>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
              <p className="group-remaining">{remainingCopy}</p>
              </div>
              {group?.code && (
                <div className="group-code-row">
                  <div className="group-code-main">
                    <span>拼团码</span>
                    <strong>{group.code}</strong>
                    {expiryLabel ? <em>{expiryLabel}</em> : null}
                  </div>
                  <div className="group-code-tools">
                    <button
                      type="button"
                      className={copied === "code" ? "is-copied" : undefined}
                      onClick={copyCode}
                    >
                      复制码
                    </button>
                    {!completed && !expired && (
                      <>
                        <button
                          type="button"
                          className={`is-primary${copied === "text" ? " is-copied" : ""}`}
                          onClick={copyInviteText}
                        >
                          复制邀请文案
                        </button>
                        <button
                          type="button"
                          className={copied === "link" ? "is-copied" : undefined}
                          onClick={copyInviteLink}
                        >
                          复制链接
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {group ? (
                <div className="group-submit-row">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={
                      loading ||
                      Boolean(submitting) ||
                      !campaignOpen ||
                      completed ||
                      expired
                    }
                    onClick={runPrimaryAction}
                  >
                    {completed ? "奖励已到账" : expired ? "已过期" : "邀请好友"}
                    {!completed && !expired && (
                      <i className="bi bi-arrow-right" />
                    )}
                  </button>
                </div>
              ) : (
                <div
                  className={`group-actions${joinFirst ? " is-join-first" : ""}`}
                >
                  {!joinFirst && (
                    <button
                      type="button"
                      className="primary-action"
                      disabled={loading || Boolean(submitting) || !campaignOpen}
                      onClick={askCreate}
                    >
                      {submitting === "create" ? "处理中…" : "发起拼团"}
                      <i className="bi bi-arrow-right" />
                    </button>
                  )}
                  <form className="group-join" onSubmit={runJoin}>
                    <input
                      value={joinCode}
                      maxLength="16"
                      autoComplete="off"
                      placeholder="输入好友邀请码"
                      aria-label="好友邀请码"
                      disabled={Boolean(submitting) || !campaignOpen}
                      onChange={(event) =>
                        setJoinCode(event.target.value.toUpperCase())
                      }
                    />
                    <button
                      type="submit"
                      disabled={
                        loading ||
                        Boolean(submitting) ||
                        !campaignOpen ||
                        joinCode.trim().length < 6
                      }
                    >
                      {submitting === "join" ? "加入中…" : "加入好友拼团"}
                    </button>
                  </form>
                  {joinFirst ? (
                    <>
                      <p className="group-join-hint">
                        加入后本期不能再发起或加入其他团。
                      </p>
                      <button
                        type="button"
                        className="group-create-alt"
                        disabled={
                          loading || Boolean(submitting) || !campaignOpen
                        }
                        onClick={askCreate}
                      >
                        发起新团
                      </button>
                    </>
                  ) : (
                    <p className="group-join-hint">
                      发起后本期只能参加这一团，不能再加入好友的团。
                    </p>
                  )}
                </div>
              )}
            </article>
            <aside className="group-process" aria-label="拼团步骤">
              <div className="group-section">
                <h2>拼团流程</h2>
              </div>
              <ol>
                {[
                  [groupArt.invite, "邀请好友", "复制邀请文案或链接"],
                  [groupArt.join, "好友加入", "好友打开链接或输入邀请码"],
                  [
                    groupArt.reward,
                    "成团领奖",
                    `满员后每人获得 ${rewardNumber} 积分`,
                  ],
                ].map((item, index) => (
                  <li
                    key={item[1]}
                    className={stepIndex === index ? "is-current" : undefined}
                  >
                    <span className="process-icon-wrap">
                      <img className="process-icon" src={item[0]} alt="" />
                    </span>
                    <div>
                      <strong>
                        <em>{index + 1}</em>
                        {item[1]}
                      </strong>
                      <p>{item[2]}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirmCreate}
        busy={submitting === "create"}
        heading="发起好友拼团？"
        description={
          joinFirst
            ? "当前有好友邀请码。发起新团后，本期不能再加入这场拼团。"
            : "发起后本期只能参加这一团，不能再加入好友的团。"
        }
        confirmLabel="确认发起"
        busyLabel="发起中…"
        icon="bi-people-fill"
        tone="accent"
        light={!isDark}
        onClose={() => submitting !== "create" && setConfirmCreate(false)}
        onConfirm={runCreate}
      />
    </main>
  );
}

export function MembershipPlanView() {
  const isDark = useIsDark();
  const { isEntryVisible } = usePageControls();
  const trialVisible = isEntryVisible("activity.trial");
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const loadPlans = useCallback(async (signal) => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await listPlans({ signal });
      if (mountedRef.current) {
        setCatalog(result.items);
        setPaymentEnabled(result.paymentEnabled);
      }
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setLoadError(error?.message || "会员计划读取失败");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void loadPlans(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [loadPlans]);
  const displayPlans = catalog.length
    ? catalog.map((plan) => ({
        ...plan,
        id: plan.id || plan.code,
        subtitle:
          plan.description ||
          (plan.kind === "subscription" ? "周期会员方案" : "创作积分方案"),
        icon: plan.kind === "subscription" ? "bi-star-fill" : "bi-gem",
        price: formatCents(plan.priceCents),
        period:
          plan.kind === "subscription"
            ? `/ ${plan.durationDays || 30} 天`
            : "一次性",
        features:
          Array.isArray(plan.features) && plan.features.length
            ? plan.features
            : [
                `发放 ${formatPoints(Number(plan.grantCents || 0) + Number(plan.bonusCents || 0))}`,
                "全平台创作工具通用",
              ],
        action: paymentEnabled ? "选择此计划" : trialVisible ? "申请体验" : "暂不可用",
        target: "trial",
        recommended: plan.recommended === true,
      }))
    : previewPlans;
  const recommended = displayPlans.find((plan) => plan.recommended);
  const usePlan = (plan) => {
    if (!paymentEnabled && plan.target === "trial" && !trialVisible) return;
    navigate(
      plan.target === "create"
        ? "/text-to-image"
        : plan.target === "feedback"
          ? "/feedback"
          : "/pricing?trial=apply",
    );
  };
  const tips = [
    ["bi-shield-check", "安全可靠", "数据加密存储，隐私有保障"],
    ["bi-arrow-repeat", "灵活自由", "随时升级、降级或取消"],
    ["bi-headset", "优质支持", "专业团队，快速响应"],
  ];
  useIncentiveEntrance(pageRef, [
    ".membership-top",
    [".plan-card", { stagger: 0.06 }],
    [".tip-list li", { stagger: 0.05 }],
  ]);
  return (
    <main
      ref={pageRef}
      className={`membership-page${isDark ? " is-dark" : ""}`}
    >
      <div className="membership-frame">
        <header className="membership-top">
          <IncentiveAtmosphere />
          <div className="membership-top__inner">
            <div className="membership-top__copy">
              <BackButton className="membership-back" />
              <p>MEMBERSHIP</p>
              <h1>会员计划</h1>
              <span>查看会员周期、积分供给与专属权益，按需选择并随时调整。</span>
              <ul className="membership-pills">
                {["周期权益", "积分供给", "随时调整"].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="membership-facts" aria-label="会员概览">
              <span>
                <i className="bi bi-collection" />
                <small>方案档位</small>
                <strong>{loading ? "—" : displayPlans.length}</strong>
              </span>
              <span>
                <i className="bi bi-star" />
                <small>推荐方案</small>
                <strong>{loading ? "—" : recommended?.name || "—"}</strong>
              </span>
              <span>
                <i className="bi bi-shield-check" />
                <small>开通方式</small>
                <strong>
                  {loading
                    ? "—"
                    : paymentEnabled
                      ? "在线开通"
                      : trialVisible
                        ? "申请体验"
                        : "暂未开放"}
                </strong>
              </span>
            </div>
          </div>
        </header>
        <section
          className="membership-workspace"
          aria-label="会员方案对比"
        >
          <div className="workspace-heading">
            <div>
              <strong>选择适合你的方案</strong>
              <small>解锁专属权益，随时升级或取消。</small>
            </div>
            {loadError && (
              <button
                type="button"
                className="text-action"
                onClick={() => loadPlans()}
              >
                <i className="bi bi-arrow-clockwise" />
                重新加载
              </button>
            )}
          </div>
          {loading ? (
            <LoadingBars
              className="membership-loading"
              label="正在读取会员方案…"
            />
          ) : loadError ? (
            <div className="membership-empty-state">
              <i className="bi bi-exclamation-circle" />
              <h2>暂时无法读取会员计划</h2>
              <p>{loadError}</p>
            </div>
          ) : (
            <div className="plan-grid">
              {displayPlans.map((plan) => (
                <article
                  key={plan.id}
                  className={`plan-card${plan.recommended ? " is-recommended" : ""}${plan.current ? " is-current" : ""}`}
                >
                  {plan.recommended ? (
                    <span className="plan-badge">推荐</span>
                  ) : plan.current ? (
                    <span className="plan-badge is-current">当前</span>
                  ) : null}
                  <span className="plan-card__icon">
                    <i className={`bi ${plan.icon}`} />
                  </span>
                  <h3>{plan.name}</h3>
                  <p>{plan.subtitle}</p>
                  <div className="plan-card__pricing">
                    <div className="plan-card__price">
                      <strong>{plan.price}</strong>
                      <span>{plan.period || ""}</span>
                    </div>
                    {plan.yearly && <small>{plan.yearly}</small>}
                  </div>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <i className="bi bi-check2" aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={
                      plan.current ||
                      (!paymentEnabled && plan.target === "trial" && !trialVisible)
                    }
                    onClick={() => usePlan(plan)}
                  >
                    {plan.current
                      ? "当前计划"
                      : !paymentEnabled && plan.target === "trial" && !trialVisible
                        ? "暂不可用"
                        : plan.action}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <footer className="membership-tips" aria-label="会员服务说明">
          <ol className="tip-list">
            {tips.map(([icon, title, copy]) => (
              <li key={title}>
                <i className={`bi ${icon}`} aria-hidden="true" />
                <div>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </footer>
      </div>
    </main>
  );
}

const compensationArt = Object.freeze({
  gift: "/failure-compensation/hero-gift.webp",
  coin: "/failure-compensation/reward-coin.webp",
  fail: "/failure-compensation/step-fail.webp",
  release: "/failure-compensation/step-release.webp",
  bonus: "/failure-compensation/step-bonus.webp",
  ledger: "/failure-compensation/step-ledger.webp",
  fee: "/failure-compensation/1.webp",
  extra: "/failure-compensation/2.webp",
  today: "/failure-compensation/3.webp",
});

export function FailureCompensationView() {
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data, loading, error, reload } = useGrowthPrograms();
  const rules = data?.rules || {};
  const claimsToday = Number(rules.failureClaimsToday || 0);
  const dailyLimit = Number(rules.failureBonusDailyLimit || 0);
  const remainingClaims = Math.max(0, dailyLimit - claimsToday);
  const claimPercent = dailyLimit
    ? Math.min(100, Math.round((remainingClaims / dailyLimit) * 100))
    : 0;
  const bonusEnabled = rules.failureBonusEnabled !== false;
  const bonusValue = formatPoints(rules.failureBonusCents, { withUnit: false });
  const bonusLabel = bonusEnabled ? bonusValue : "暂未开放";
  const items = [
    {
      icon: compensationArt.fee,
      title: "失败任务费用",
      value: "自动释放",
      copy: "任务失败或取消后，冻结积分按结算规则释放。",
    },
    {
      icon: compensationArt.extra,
      title: "额外补偿积分",
      value: loading ? "—" : bonusLabel,
      copy: "符合活动规则的失败任务自动获得额外补偿。",
    },
    {
      icon: compensationArt.today,
      title: "今日剩余补偿",
      value: loading ? "—" : `${remainingClaims} 次`,
      copy: `今日已触发 ${claimsToday} 次，每日上限 ${dailyLimit || "—"} 次。`,
      meter: true,
    },
  ];
  const steps = [
    [compensationArt.fail, "任务失败", "生成失败或任务取消后，自动进入保障流程"],
    [compensationArt.release, "费用释放", "冻结积分按结算规则自动退回钱包"],
    [compensationArt.bonus, "额外补偿", "符合条件时自动发放补偿积分"],
    [compensationArt.ledger, "账本记录", "每笔积分变化均可在钱包中查询"],
  ];
  useIncentiveEntrance(pageRef, [
    ".compensation-hero",
    ".compensation-layout",
    [".compensation-process li", { stagger: 0.05 }],
  ]);
  return (
    <main
      ref={pageRef}
      className={`compensation-page${isDark ? " is-dark" : ""}`}
    >
      <div className="compensation-frame">
        <header className="compensation-hero">
          <div className="compensation-hero__copy">
            <BackButton className="compensation-back" />
            <div className="compensation-hero__intro">
              <h1>
                <span>失败补偿</span>
                页面
              </h1>
              <p>创作失败也有明确保障：冻结费用按规则释放，符合条件时自动发放额外补偿。</p>
            </div>
            <article className="compensation-reward" aria-label="单次额外补偿">
              <img src={compensationArt.coin} alt="" />
              <div>
                <small>单次额外补偿</small>
                <strong>
                  {loading ? "—" : bonusLabel}
                  {bonusEnabled && !loading ? <span>积分</span> : null}
                </strong>
                <p>符合活动规则的失败任务自动获得额外补偿。</p>
              </div>
            </article>
          </div>
          <img
            className="compensation-hero__art"
            src={compensationArt.gift}
            alt=""
          />
        </header>
        <section className="compensation-workspace" aria-label="补偿内容">
          <div className="compensation-layout">
            <section className="compensation-details">
              <div className="section-copy">
                <h2>补偿说明</h2>
              </div>
              {loading ? (
                <LoadingBars
                  className="compensation-loading"
                  label="正在读取补偿规则…"
                />
              ) : error ? (
                <div className="compensation-empty-state">
                  <i className="bi bi-exclamation-circle" />
                  <h2>暂时无法读取补偿规则</h2>
                  <p>{error}</p>
                  <button type="button" className="text-action" onClick={reload}>
                    <i className="bi bi-arrow-clockwise" />
                    重新加载
                  </button>
                </div>
              ) : (
                <>
                  <ul className="compensation-points">
                    {items.map((item) => (
                      <li key={item.title}>
                        <span className="compensation-point__icon">
                          <img src={item.icon} alt="" />
                        </span>
                        <div>
                          <div className="compensation-point__head">
                            <h3>{item.title}</h3>
                            <strong>{item.value}</strong>
                          </div>
                          <p>{item.copy}</p>
                          {item.meter ? (
                            <div className="compensation-point__meter">
                              <i style={{ width: `${claimPercent}%` }} />
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="compensation-submit-row">
                    <p>所有补偿均由系统自动处理，无需手动领取。</p>
                    <Link className="primary-action" to="/wallet">
                      查看钱包记录
                    </Link>
                  </div>
                </>
              )}
            </section>
            <aside className="compensation-process" aria-label="补偿处理流程">
              <div className="section-copy">
                <h2>补偿处理流程</h2>
              </div>
              <ol>
                {steps.map(([art, title, copy], index) => (
                  <li key={title}>
                    <span className="process-icon-wrap">
                      <img className="process-icon" src={art} alt="" />
                    </span>
                    <div>
                      <strong>
                        <em>{index + 1}</em>
                        {title}
                      </strong>
                      <p>{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

const usageArt = Object.freeze({
  gift: "/usage-plan/hero-gift.webp",
  coin: "/usage-plan/reward-coin.webp",
  month: "/usage-plan/step-month.webp",
  deliver: "/usage-plan/step-deliver.webp",
  unlock: "/usage-plan/step-unlock.webp",
  wallet: "/usage-plan/step-wallet.webp",
});

export function UsagePlanView() {
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data, loading, error, reload } = useGrowthPrograms();
  const rules = data?.rules || {};
  const milestones = Array.isArray(rules.usageMilestones)
    ? rules.usageMilestones
    : [];
  const delivered = Number(rules.monthDeliveredUnits || 0);
  const nextMilestone = milestones.find((item) => !item.achieved) || null;
  const remaining = nextMilestone
    ? Math.max(0, Number(nextMilestone.units || 0) - delivered)
    : 0;
  const nextReward = nextMilestone
    ? formatPoints(nextMilestone.rewardCents, { withUnit: false })
    : "";
  const rewardLabel = loading
    ? "—"
    : nextMilestone
      ? nextReward
      : milestones.length
        ? "已完成"
        : "—";
  const rewardHint = nextMilestone
    ? `再交付 ${remaining} 张即可解锁`
    : milestones.length
      ? "本月档位已全部达成并结算"
      : "达到对应交付数量后，奖励自动发放。";
  const steps = [
    [usageArt.month, "按月累计", "每月 1 日重新累计交付量"],
    [usageArt.deliver, "成功交付", "本月成功交付计入用量进度"],
    [usageArt.unlock, "达标解锁", "达到档位后积分自动到账"],
    [usageArt.wallet, "同档一次", "每个档位每月最多结算一次"],
  ];
  useIncentiveEntrance(pageRef, [
    ".usage-hero",
    ".usage-layout",
    [".usage-process li", { stagger: 0.05 }],
  ]);
  return (
    <main ref={pageRef} className={`usage-page${isDark ? " is-dark" : ""}`}>
      <div className="usage-frame">
        <header className="usage-hero">
          <div className="usage-hero__copy">
            <BackButton className="usage-back" />
            <div className="usage-hero__intro">
              <h1>
                <span>用量计划</span>
                页面
              </h1>
              <p>本月成功交付越多，自动解锁越高阶的积分回馈。</p>
            </div>
            <article className="usage-reward" aria-label="下一档奖励">
              <img src={usageArt.coin} alt="" />
              <div>
                <small>{nextMilestone || loading ? "下一档奖励" : "本月进度"}</small>
                <strong>
                  {rewardLabel}
                  {nextMilestone && !loading ? <span>积分</span> : null}
                </strong>
                <p>{loading ? "正在读取本月档位…" : rewardHint}</p>
              </div>
            </article>
          </div>
          <img className="usage-hero__art" src={usageArt.gift} alt="" />
        </header>
        <section className="usage-workspace" aria-label="用量档位">
          <div className="usage-layout">
            <section className="usage-details">
              <div className="section-copy">
                <h2>本月档位</h2>
              </div>
              {loading ? (
                <LoadingBars
                  className="usage-loading"
                  label="正在读取用量计划…"
                />
              ) : error ? (
                <div className="usage-empty-state">
                  <i className="bi bi-exclamation-circle" />
                  <h2>暂时无法读取用量计划</h2>
                  <p>{error}</p>
                  <button type="button" className="text-action" onClick={reload}>
                    <i className="bi bi-arrow-clockwise" />
                    重新加载
                  </button>
                </div>
              ) : milestones.length ? (
                <>
                  <ul className="usage-ladder">
                    {milestones.map((milestone, index) => (
                      <li
                        key={`${milestone.units}-${index}`}
                        className={`${milestone.achieved ? "is-achieved" : ""}${!milestone.achieved && milestone === nextMilestone ? " is-next" : ""}`}
                      >
                        <span className="usage-ladder__index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="usage-ladder__copy">
                          <strong>交付 {milestone.units} 张</strong>
                          <small>
                            {milestone.achieved
                              ? "本月已达成并结算"
                              : milestone === nextMilestone
                                ? `再交付 ${remaining} 张即可解锁`
                                : "达到数量后自动发放"}
                          </small>
                        </div>
                        <div className="usage-ladder__reward">
                          <span>奖励</span>
                          <b>{formatPoints(milestone.rewardCents)}</b>
                        </div>
                        <i
                          className={`bi usage-ladder__state ${milestone.achieved ? "bi-check-circle-fill" : "bi-circle"}`}
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="usage-submit-row">
                    <p>
                      本月已交付 {delivered} 张。达到对应数量后，奖励自动发放到钱包，同档位本月只结算一次。
                    </p>
                    <Link className="primary-action" to="/wallet">
                      查看钱包记录
                    </Link>
                  </div>
                </>
              ) : (
                <div className="usage-empty-state">
                  <i className="bi bi-bar-chart" />
                  <h2>暂未配置用量档位</h2>
                  <p>请稍后再看，档位开放后会按本月成功交付自动结算。</p>
                </div>
              )}
            </section>
            <aside className="usage-process" aria-label="用量处理流程">
              <div className="section-copy">
                <h2>用量处理流程</h2>
              </div>
              <ol>
                {steps.map(([art, title, copy], index) => (
                  <li key={title}>
                    <span className="process-icon-wrap">
                      <img className="process-icon" src={art} alt="" />
                    </span>
                    <div>
                      <strong>
                        <em>{index + 1}</em>
                        {title}
                      </strong>
                      <p>{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

const suggestionTypes = [
  ["feature", "新功能建议"],
  ["experience", "体验优化"],
  ["generation", "模型与生成效果"],
  ["content", "内容与活动"],
  ["other", "其他建议"],
];

const suggestionArt = Object.freeze({
  gift: "/suggestion-adoption/hero-gift.webp",
  coin: "/suggestion-adoption/reward-coin.webp",
  submit: "/suggestion-adoption/step-submit.webp",
  review: "/suggestion-adoption/step-review.webp",
  adopt: "/suggestion-adoption/step-adopt.webp",
  reward: "/suggestion-adoption/step-reward.webp",
});

export function SuggestionAdoptionView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data, loading } = useGrowthPrograms();
  const [form, setForm] = useState({ title: "", content: "", type: "" });
  const [submitting, setSubmitting] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeTriggerRef = useRef(null);
  const typeMenuRef = useRef(null);
  const [typeMenuStyle, setTypeMenuStyle] = useState({});
  const selectedTypeLabel =
    suggestionTypes.find(([value]) => value === form.type)?.[1] || "";
  const reward = Number(data?.rules?.suggestionRewardMaxCents || 0);
  const rewardLabel =
    reward > 0 ? formatPoints(reward).replace(/\s*积分\s*$/, "") : "—";
  const canSubmit =
    form.title.trim().length >= 5 &&
    form.title.trim().length <= 50 &&
    form.content.trim().length >= 20 &&
    form.content.trim().length <= 1000 &&
    Boolean(form.type) &&
    !submitting;
  const update = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (requestAuth({ featureLabel: "建议采纳" })) return;
    if (!canSubmit) {
      notificationService.info("请完整填写标题、建议描述与建议类型");
      return;
    }
    setSubmitting(true);
    try {
      const typeLabel =
        suggestionTypes.find(([value]) => value === form.type)?.[1] ||
        "其他建议";
      await submitFeedback({
        category: "suggestion",
        title: form.title,
        content: `建议类型：${typeLabel}\n\n${form.content}`,
        pageUrl: "/incentive-plans/suggestion",
      });
      setForm({ title: "", content: "", type: "" });
      setTypeOpen(false);
      notificationService.success("产品建议已提交，可在问题反馈中查看处理进度");
    } catch (error) {
      notificationService.error(error?.message || "产品建议提交失败");
    } finally {
      setSubmitting(false);
    }
  };
  const steps = [
    [suggestionArt.submit, "提交建议", "填写建议并提交，我们会尽快评估"],
    [suggestionArt.review, "评估审核", "产品团队进行评估，判断建议价值"],
    [suggestionArt.adopt, "采纳通知", "建议被采纳后，系统将通知你"],
    [suggestionArt.reward, "发放奖励", "按价值等级发放积分奖励"],
  ];
  useIncentiveEntrance(pageRef, [
    ".suggestion-hero",
    ".suggestion-layout",
    [".suggestion-process li", { stagger: 0.05 }],
  ]);
  useEffect(() => {
    if (!typeOpen) return undefined;
    const place = () => {
      const trigger = typeTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuHeight = suggestionTypes.length * 40 + 12;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;
      setTypeMenuStyle({
        left: rect.left,
        width: rect.width,
        top: openUp ? undefined : rect.bottom + 6,
        bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      });
    };
    place();
    const close = (event) => {
      if (
        typeTriggerRef.current?.contains(event.target) ||
        typeMenuRef.current?.contains(event.target)
      )
        return;
      setTypeOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", close, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", close, true);
    };
  }, [typeOpen]);
  return (
    <main
      ref={pageRef}
      className={`suggestion-page${isDark ? " is-dark" : ""}`}
    >
      <div className="suggestion-frame">
        <header className="suggestion-hero">
          <div className="suggestion-hero__copy">
            <BackButton className="suggestion-back" />
            <div className="suggestion-hero__intro">
              <h1>
                <span>建议采纳</span>
                页面
              </h1>
              <p>让真实、有价值的产品建议获得清晰回报。</p>
            </div>
            <article className="suggestion-reward" aria-label="单次奖励上限">
              <img src={suggestionArt.coin} alt="" />
              <div>
                <small>单次奖励上限</small>
                <strong>
                  {loading ? "—" : rewardLabel}
                  <span>积分</span>
                </strong>
                <p>
                  提交真实、具体且可执行的产品建议，采纳后按价值等级发放奖励。
                </p>
              </div>
            </article>
          </div>
          <img
            className="suggestion-hero__art"
            src={suggestionArt.gift}
            alt=""
          />
        </header>
        <section className="suggestion-workspace" aria-label="建议提交">
          <div className="suggestion-layout">
            <form className="suggestion-form" onSubmit={submit}>
              <div className="section-copy">
                <h2>提交产品建议</h2>
              </div>
              <label className="suggestion-field">
                <span>建议标题</span>
                <span className="suggestion-control">
                  <input
                    value={form.title}
                    maxLength="50"
                    autoComplete="off"
                    placeholder="请简要概括你的建议（不超过 50 字）"
                    onChange={(event) => update("title", event.target.value)}
                  />
                  <small>{form.title.length}/50</small>
                </span>
              </label>
              <label className="suggestion-field suggestion-field--grow">
                <span>建议描述</span>
                <span className="suggestion-control suggestion-control--textarea">
                  <textarea
                    value={form.content}
                    maxLength="1000"
                    placeholder="请详细描述你的建议，包括问题、场景、方案与预期价值（不少于 20 字）"
                    onChange={(event) => update("content", event.target.value)}
                  />
                  <small>{form.content.length}/1000</small>
                </span>
              </label>
              <label className="suggestion-field">
                <span>建议类型</span>
                <span className="suggestion-control suggestion-control--select">
                  <select
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    value={form.type}
                    onChange={(event) => update("type", event.target.value)}
                  >
                    <option value="" disabled>
                      请选择建议类型
                    </option>
                    {suggestionTypes.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    ref={typeTriggerRef}
                    type="button"
                    className={`suggestion-type-trigger${typeOpen ? " is-open" : ""}${form.type ? "" : " is-placeholder"}`}
                    aria-haspopup="listbox"
                    aria-expanded={typeOpen}
                    onClick={() => setTypeOpen((open) => !open)}
                  >
                    <span>{selectedTypeLabel || "请选择建议类型"}</span>
                    <i className="bi bi-chevron-down" aria-hidden="true" />
                  </button>
                </span>
              </label>
              {typeOpen &&
                createPortal(
                  <div
                    ref={typeMenuRef}
                    className={`suggestion-type-menu${isDark ? " is-dark" : ""}`}
                    style={typeMenuStyle}
                    role="listbox"
                    aria-label="建议类型"
                  >
                    {suggestionTypes.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={form.type === value}
                        className={form.type === value ? "is-selected" : ""}
                        onClick={() => {
                          update("type", value);
                          setTypeOpen(false);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              <div className="suggestion-submit-row">
                <p>
                  {auth.isAuthenticated ? (
                    <>
                      提交后可在
                      <Link to="/feedback?category=suggestion">问题反馈</Link>
                      中查看处理进度与奖励状态
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="suggestion-login"
                        onClick={() =>
                          requestAuth({ featureLabel: "建议采纳" })
                        }
                      >
                        登录
                      </button>
                      后提交，可追踪建议状态与奖励进度
                    </>
                  )}
                </p>
                <button
                  type="submit"
                  className="primary-action"
                  name="提交产品建议"
                  disabled={!canSubmit}
                >
                  {submitting ? "正在提交…" : "提交产品建议"}
                </button>
              </div>
            </form>
            <aside className="suggestion-process" aria-label="建议处理流程">
              <div className="section-copy">
                <h2>建议处理流程</h2>
              </div>
              <ol>
                {steps.map(([art, title, copy], index) => (
                  <li key={title}>
                    <span className="process-icon-wrap">
                      <img className="process-icon" src={art} alt="" />
                    </span>
                    <div>
                      <strong>
                        <em>{index + 1}</em>
                        {title}
                      </strong>
                      <p>{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export function CreatorIncentiveDetailView() {
  const isDark = useIsDark();
  const { program = "" } = useParams();
  const programId = benefitMap[program] ? program : "group";
  const benefit = benefitMap[programId];
  const { data, loading, error, reload } = useGrowthPrograms();
  const [groupAction, setGroupAction] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const rules = data?.rules || {};
  const group = data?.group || null;
  const milestones = Array.isArray(rules.usageMilestones)
    ? rules.usageMilestones
    : [];
  const target = Number(group?.targetMembers || rules.groupTargetMembers || 0);
  const current = Number(group?.memberCount || 0);
  const groupProgress =
    target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const startGroup = async () => {
    if (groupAction || rules.groupEnabled === false) return;
    setGroupAction("create");
    try {
      await createGrowthGroup();
      await reload();
      notificationService.success("拼团已创建，邀请好友输入拼团码即可加入");
    } catch (actionError) {
      notificationService.error(actionError?.message || "创建拼团失败");
    } finally {
      setGroupAction("");
    }
  };
  const joinGroup = async (event) => {
    event.preventDefault();
    const code = joinCode.trim();
    if (groupAction || code.length < 6) {
      if (code.length < 6) notificationService.warning("请输入有效的拼团码");
      return;
    }
    setGroupAction("join");
    try {
      await joinGrowthGroup(code);
      setJoinCode("");
      await reload();
      notificationService.success("已加入拼团");
    } catch (actionError) {
      notificationService.error(actionError?.message || "加入拼团失败");
    } finally {
      setGroupAction("");
    }
  };
  const copyCode = async () => {
    if (!group?.code) return;
    await navigator.clipboard.writeText(group.code);
    notificationService.success("拼团码已复制");
  };
  let content = null;
  if (loading) content = <LoadingBars className="detail-loading" />;
  else if (error)
    content = (
      <div className="detail-error">
        <p>{error}</p>
        <button type="button" onClick={reload}>
          重新加载
        </button>
      </div>
    );
  else if (programId === "group")
    content = (
      <div className="detail-content">
        {group ? (
          <>
            <div className="group-summary">
              <strong>
                {group.memberCount} / {group.targetMembers} 人
              </strong>
              <span>每人奖励 {formatPoints(group.rewardCents)}</span>
            </div>
            <div
              className="group-progress"
              role="progressbar"
              aria-valuenow={groupProgress}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <i style={{ width: `${groupProgress}%` }} />
            </div>
            <button type="button" className="group-code" onClick={copyCode}>
              <span>拼团码</span>
              <strong>{group.code}</strong>
              <i className="bi bi-copy" />
            </button>
          </>
        ) : (
          <>
            <p>
              目标 {rules.groupTargetMembers || 0} 人，成团后每人获得{" "}
              {formatPoints(rules.groupRewardCents)}。
            </p>
            <div className="group-actions">
              <button
                type="button"
                disabled={Boolean(groupAction) || rules.groupEnabled === false}
                onClick={startGroup}
              >
                {groupAction === "create" ? "创建中" : "发起拼团"}
              </button>
              <form onSubmit={joinGroup}>
                <input
                  value={joinCode}
                  maxLength="16"
                  autoComplete="off"
                  placeholder="输入好友拼团码"
                  aria-label="好友拼团码"
                  onChange={(event) => setJoinCode(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={
                    Boolean(groupAction) || rules.groupEnabled === false
                  }
                >
                  {groupAction === "join" ? "加入中" : "加入"}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    );
  else if (programId === "membership")
    content = (
      <div className="detail-content metric-content">
        <span>当前入口</span>
        <strong>会员与创作方案</strong>
        <p>查看当前可用的会员周期、积分供给和专属权益。</p>
        <Link to="/pricing">
          查看会员方案
          <i className="bi bi-arrow-right" />
        </Link>
      </div>
    );
  else if (programId === "failure")
    content = (
      <div className="detail-content metric-content">
        <span>单次补偿</span>
        <strong>{formatPoints(rules.failureBonusCents)}</strong>
        <p>
          今日已触发 {rules.failureClaimsToday || 0} /{" "}
          {rules.failureBonusDailyLimit || 0} 次，符合条件时自动到账。
        </p>
      </div>
    );
  else if (programId === "milestone" || programId === "usage")
    content = (
      <div className="detail-content metric-content">
        <span>本月成功交付</span>
        <strong>{rules.monthDeliveredUnits || 0} 张</strong>
        <div className="milestone-list">
          {milestones.map((milestone) => (
            <div
              key={milestone.units}
              className={milestone.achieved ? "is-achieved" : ""}
            >
              <span>{milestone.units} 张</span>
              <strong>{formatPoints(milestone.rewardCents)}</strong>
              <i
                className={`bi ${milestone.achieved ? "bi-check-circle-fill" : "bi-circle"}`}
              />
            </div>
          ))}
        </div>
        <Link to="/incentive-plans/usage">
          打开用量计划
          <i className="bi bi-arrow-right" />
        </Link>
      </div>
    );
  else
    content = (
      <div className="detail-content metric-content">
        <span>单次奖励上限</span>
        <strong>{formatPoints(rules.suggestionRewardMaxCents)}</strong>
        <p>提交真实、具体且可执行的产品建议，采纳后按价值等级发放奖励。</p>
        <Link to="/feedback">
          提交产品建议
          <i className="bi bi-arrow-right" />
        </Link>
      </div>
    );
  return (
    <main
      className={`detail-page${isDark ? " is-dark" : ""}`}
      data-tone={benefit.tone}
    >
      <nav className="detail-nav" aria-label="创作激励导航">
        <Link to="/incentive-plans" className="back-link">
          <i className="bi bi-arrow-left" />
          返回创作激励
        </Link>
      </nav>
      <section className="detail-hero">
        <div className="detail-copy">
          <p className="detail-eyebrow">
            <span />
            {benefit.category}
          </p>
          <span className="detail-icon">
            <i className={`bi ${benefit.icon}`} />
          </span>
          <h1>{benefit.name}</h1>
          <p className="detail-lead">{benefit.statement}</p>
          {content}
        </div>
        <aside className="detail-visual" aria-hidden="true">
          <div className="detail-visual__index">
            CREATOR / {programId.toUpperCase()}
          </div>
          <div className="detail-visual__mark">
            <i className={`bi ${benefit.icon}`} />
          </div>
          <div className="detail-visual__rules">
            <span>权益计划</span>
            <span>账户联动</span>
            <span>自动结算</span>
          </div>
          <div className="detail-visual__copy">
            <small>STARCLOUD CREATIVE</small>
            <strong>{benefit.name}</strong>
            <p>{benefit.description}</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
