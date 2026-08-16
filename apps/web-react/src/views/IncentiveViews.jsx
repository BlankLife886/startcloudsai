import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
import highFiveArt from "@react/legacy-static/assets/incentives/group-highfive.png";
import { useAuth } from "../auth/AuthContext.jsx";
import { useGrowthPrograms } from "../hooks/useGrowthPrograms.js";
import { useIsDark } from "../hooks/useIsDark.js";

gsap.registerPlugin(useGSAP);

const benefits = [
  {
    id: "group",
    name: "好友拼团",
    category: "拼团裂变",
    icon: "bi-people-fill",
    description: "发起或加入限时拼团，满员后奖励自动发放到每位成员账户。",
    action: "进入拼团",
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
    icon: "bi-shield-check",
    description: "符合规则的失败任务自动退款，并按活动配置发放额外补偿。",
    action: "查看保障",
    tone: "teal",
  },
  {
    id: "usage",
    name: "用量计划",
    category: "用量激励",
    icon: "bi-bar-chart-fill",
    description: "按本月成功交付量解锁档位奖励，达标后积分自动到账。",
    action: "查看计划",
    tone: "amber",
  },
  {
    id: "suggestion",
    name: "建议采纳",
    category: "产品共创",
    icon: "bi-lightbulb-fill",
    description: "提交产品建议，评审采纳后按价值等级发放创作积分。",
    action: "参与共创",
    tone: "green",
  },
];

const heroHighlights = ["自动到账", "账户联动", "规则透明"];

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
    ...benefits[0],
    tone: "coral",
    statement: "和好友一起创作，一起解锁积分奖励。",
  },
  membership: {
    ...benefits[1],
    tone: "violet",
    statement: "为持续创作准备稳定、清晰的长期权益。",
  },
  failure: {
    ...benefits[2],
    tone: "teal",
    statement: "生成服务异常时，获得明确且可预期的保障。",
  },
  milestone: {
    ...benefits[3],
    tone: "amber",
    statement: "本月交付越多，自动解锁越高阶的积分回馈。",
  },
  usage: {
    ...benefits[3],
    tone: "amber",
    statement: "本月交付越多，自动解锁越高阶的积分回馈。",
  },
  suggestion: {
    ...benefits[4],
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
            .from(".rewards-hero", {
              y: 18,
              autoAlpha: 0,
              duration: 0.55,
            })
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
    getWallet({ signal: controller.signal })
      .then(setWallet)
      .catch(() => null);
    return () => controller.abort();
  }, []);

  const joinedPlans =
    Number(Boolean(data?.group)) +
    Number(Number(data?.monthUnits || 0) > 0) +
    Number(Number(data?.failureClaims || 0) > 0) +
    Number(Boolean(data?.suggestion?.status));
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
      "bi-hexagon-fill",
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
      "bi-wallet2",
      "blue",
      "/wallet",
      "查看冻结",
    ],
    [
      "joined",
      "已参与计划",
      String(joinedPlans),
      "bi-calendar2-check",
      "green",
      "#reward-plans",
      "查看计划",
    ],
    [
      "benefits",
      "可用权益",
      String(benefits.length),
      "bi-trophy-fill",
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
          <div className="rewards-hero__atmosphere" aria-hidden="true">
            <span className="rewards-orb rewards-orb--a" />
            <span className="rewards-orb rewards-orb--b" />
            <span className="rewards-orb rewards-orb--c" />
          </div>
          <div className="rewards-hero__copy">
            <p>CREATOR REWARDS</p>
            <h1>创作激励</h1>
            <span>选择一个激励计划，查看权益、进度与参与方式。</span>
            <ul className="rewards-hero__pills">
              {heroHighlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="rewards-hero__actions">
              <a href="#reward-plans">
                查看激励计划
                <i className="bi bi-arrow-right" aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
        <section
          id="reward-plans"
          className="benefit-section"
          aria-label="创作激励计划"
        >
          <div className="benefit-grid">
            {benefits.map((benefit, index) => (
              <Link
                key={benefit.id}
                to={`/incentive-plans/${benefit.id}`}
                className={`benefit-card is-${benefit.tone}`}
              >
                <div className="benefit-card__top">
                  <span className="benefit-card__icon" aria-hidden="true">
                    <i className={`bi ${benefit.icon}`} />
                  </span>
                  <span className="benefit-card__number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <small>{benefit.category}</small>
                <h2>{benefit.name}</h2>
                <p>{benefit.description}</p>
                <span className="benefit-card__cta">
                  {benefit.action}
                  <i className="bi bi-arrow-right" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="rewards-summary" aria-label="激励概览">
          {stats.map(([id, label, value, icon, tone, to, hint]) => {
            const content = (
              <>
                <div className="rewards-summary__head">
                  <span className="rewards-summary__icon" aria-hidden="true">
                    <i className={`bi ${icon}`} />
                  </span>
                  <span className="rewards-summary__hint">
                    {hint}
                    <i className="bi bi-arrow-right" aria-hidden="true" />
                  </span>
                </div>
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

export function FriendGroupView() {
  const location = useLocation();
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data, loading, error, reload } = useGrowthPrograms();
  const [submitting, setSubmitting] = useState(false);
  const rules = data?.rules || {};
  const group = data?.group || null;
  const inviteCode =
    new URLSearchParams(location.search).get("code")?.trim().toUpperCase() ||
    "";
  const targetMembers = Number(
    group?.targetMembers || rules.groupTargetMembers || 0,
  );
  const memberCount = Number(group?.memberCount || (loading ? 0 : 1));
  const remainingMembers = Math.max(0, targetMembers - memberCount);
  const rewardCents = Number(group?.rewardCents ?? rules.groupRewardCents ?? 0);
  const rewardNumber =
    rewardCents > 0
      ? formatPoints(rewardCents).replace(/\s*积分\s*$/, "")
      : "—";
  const slots = Array.from(
    { length: Math.max(3, targetMembers || 3) },
    (_, index) => ({ filled: index < memberCount, owner: index === 0 }),
  );
  const actionLabel = submitting
    ? inviteCode && !group
      ? "加入中…"
      : "处理中…"
    : group
      ? group.status === "completed"
        ? "奖励已到账"
        : "邀请好友"
      : inviteCode
        ? "加入好友拼团"
        : "发起拼团";

  const shareGroup = async () => {
    if (!group?.code) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("code", group.code);
    try {
      if (navigator.share)
        await navigator.share({
          title: "好友拼团",
          text: "和我一起拼团，成团后领取积分奖励。",
          url: url.href,
        });
      else {
        await navigator.clipboard.writeText(url.href);
        notificationService.success("邀请链接已复制");
      }
    } catch (shareError) {
      if (shareError?.name !== "AbortError")
        notificationService.error("邀请链接分享失败");
    }
  };
  const runPrimaryAction = async () => {
    if (submitting || rules.groupEnabled === false) return;
    if (group) {
      if (group.status !== "completed") await shareGroup();
      return;
    }
    setSubmitting(true);
    try {
      if (inviteCode) {
        await joinGrowthGroup(inviteCode);
        notificationService.success("已加入好友拼团");
      } else {
        await createGrowthGroup();
        notificationService.success("拼团已发起，现在邀请好友加入吧");
      }
      await reload();
    } catch (actionError) {
      notificationService.error(actionError?.message || "拼团操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  useIncentiveEntrance(pageRef, [
    ".group-hero",
    ".group-panel",
    [".group-step", { stagger: 0.06 }],
  ]);

  return (
    <main
      ref={pageRef}
      className={`group-page${isDark ? " is-dark" : ""}`}
    >
      <section className="group-hero">
        <span className="group-hero__corner" aria-hidden="true" />
        <span className="group-hero__sun" aria-hidden="true" />
        <div className="group-shell group-hero__inner">
          <div className="group-hero__copy">
            <BackButton className="group-back" />
            <h1>好友拼团</h1>
            <p>和好友一起创作，一起解锁积分奖励。</p>
            <div className="group-target" aria-label="拼团目标">
              <span className="group-target__coin" aria-hidden="true">
                <i className="bi bi-star-fill" />
              </span>
              <span className="group-target__divider" />
              <p>
                目标 <strong>{loading ? "—" : targetMembers}</strong>{" "}
                人，成团后每人获得 <strong>{rewardNumber}</strong> 积分。
              </p>
            </div>
          </div>
          <div className="group-hero__asset" aria-hidden="true">
            <img src={highFiveArt} alt="" loading="lazy" />
          </div>
        </div>
      </section>
      <section className="group-shell group-panel" aria-label="好友拼团进度">
        {error && (
          <div className="group-error">
            <span>{error}</span>
            <button type="button" onClick={reload}>
              重新加载
            </button>
          </div>
        )}
        <div className="group-panel__main">
          <div className="group-progress-block">
            <h2>拼团进度</h2>
            <div
              className="member-track"
              style={{ "--slot-count": slots.length }}
            >
              {slots.map((slot, index) => (
                <div
                  key={index}
                  className={`member-slot${slot.filled ? " is-filled" : ""}`}
                >
                  <span>
                    <i className="bi bi-person-fill" />
                  </span>
                  <strong>
                    {slot.owner
                      ? "发起人"
                      : slot.filled
                        ? "已加入"
                        : "待加入"}
                  </strong>
                </div>
              ))}
            </div>
            <p className="group-remaining">
              {remainingMembers > 0 ? (
                <>
                  还差 <strong>{remainingMembers}</strong>{" "}
                  人即可成团，邀请好友一起加入吧！
                </>
              ) : (
                "拼团已完成，奖励将自动发放到每位成员账户。"
              )}
            </p>
          </div>
          <div className="group-reward">
            <span className="group-reward__gift" aria-hidden="true">
              <i className="bi bi-gift-fill" />
            </span>
            <div className="group-reward__copy">
              <span>成团奖励</span>
              <strong>{rewardNumber} 积分</strong>
              <small>成团后每人获得</small>
            </div>
            <button
              type="button"
              disabled={
                loading ||
                submitting ||
                rules.groupEnabled === false ||
                group?.status === "completed"
              }
              onClick={runPrimaryAction}
            >
              {actionLabel}
              {group?.status !== "completed" && (
                <i className="bi bi-arrow-right" />
              )}
            </button>
          </div>
        </div>
        <div className="group-steps" aria-label="拼团步骤">
          {[
            ["bi-people-fill", "邀请好友", "分享链接给好友"],
            ["bi-person-plus-fill", "好友加入", "好友点击链接加入拼团"],
            ["bi-gift-fill", "成团领奖", `成团后每人获得 ${rewardNumber} 积分`],
          ].map((item, index) => (
            <Fragment key={item[1]}>
              <div className="group-step">
                <span>
                  <i className={`bi ${item[0]}`} />
                </span>
                <p>
                  <strong>{item[1]}</strong>
                  <small>{item[2]}</small>
                </p>
              </div>
              {index < 2 && (
                <i
                  className="group-step-arrow bi bi-chevron-right"
                  aria-hidden="true"
                />
              )}
            </Fragment>
          ))}
        </div>
      </section>
    </main>
  );
}

export function MembershipPlanView() {
  const isDark = useIsDark();
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
        action: paymentEnabled ? "选择此计划" : "申请体验",
        target: "trial",
        recommended: plan.recommended === true,
      }))
    : previewPlans;
  const recommended = displayPlans.find((plan) => plan.recommended);
  const usePlan = (plan) =>
    navigate(
      plan.target === "create"
        ? "/text-to-image"
        : plan.target === "feedback"
          ? "/feedback"
          : "/pricing?trial=apply",
    );
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
                  {loading ? "—" : paymentEnabled ? "在线开通" : "申请体验"}
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
                  <button type="button" onClick={() => usePlan(plan)}>
                    {plan.current ? "当前计划" : plan.action}
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
  const bonusLabel =
    rules.failureBonusEnabled === false
      ? "暂未开放"
      : formatPoints(rules.failureBonusCents);
  const items = [
    [
      "bi-arrow-counterclockwise",
      "自动释放",
      "失败任务费用",
      "任务失败或取消后，冻结积分按结算规则释放。",
      "查看钱包记录",
      "/wallet",
    ],
    [
      "bi-gift-fill",
      bonusLabel,
      "额外补偿积分",
      "符合活动规则的失败任务自动获得额外补偿。",
      "查看任务记录",
      "/history",
    ],
    [
      "bi-calendar-check",
      `${remainingClaims} 次`,
      "今日剩余补偿",
      `今日已触发 ${claimsToday} 次，每日上限 ${dailyLimit || "—"} 次。`,
      "意见反馈",
      "/feedback",
    ],
  ];
  const tips = [
    ["bi-journal-check", "规则透明", "补偿条件清晰可查"],
    ["bi-lightning-charge-fill", "自动处理", "符合条件无需手动领取"],
    ["bi-shield-check", "账本可查", "每笔积分变化均有记录"],
  ];
  useIncentiveEntrance(pageRef, [
    ".compensation-top",
    [".compensation-card", { stagger: 0.07 }],
    [".tip-list li", { stagger: 0.05 }],
  ]);
  return (
    <main
      ref={pageRef}
      className={`compensation-page${isDark ? " is-dark" : ""}`}
    >
      <div className="compensation-frame">
        <header className="compensation-top">
          <IncentiveAtmosphere />
          <div className="compensation-top__inner">
            <div className="compensation-top__copy">
              <BackButton className="compensation-back" />
              <p>SERVICE GUARD</p>
              <h1>失败补偿</h1>
              <span>
                创作失败也有明确保障：冻结费用按规则释放，符合条件时自动发放额外补偿。
              </span>
              <ul className="compensation-pills">
                {["自动释放", "额外补偿", "账本可查"].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="compensation-facts" aria-label="补偿概览">
              <span>
                <i className="bi bi-arrow-counterclockwise" />
                <small>费用处理</small>
                <strong>{loading ? "—" : "自动释放"}</strong>
              </span>
              <span>
                <i className="bi bi-gift-fill" />
                <small>额外补偿</small>
                <strong>{loading ? "—" : bonusLabel}</strong>
              </span>
              <span>
                <i className="bi bi-calendar-check" />
                <small>今日剩余</small>
                <strong>{loading ? "—" : `${remainingClaims} 次`}</strong>
              </span>
            </div>
          </div>
        </header>
        <section
          className="compensation-workspace"
          aria-label="补偿内容"
        >
          <div className="workspace-heading">
            <div>
              <span className="status-dot" />
              <strong>自动处理</strong>
              <small>所有补偿均由系统自动处理，无需手动领取。</small>
            </div>
            {error && (
              <button type="button" className="text-action" onClick={reload}>
                <i className="bi bi-arrow-clockwise" />
                重新加载
              </button>
            )}
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
            </div>
          ) : (
            <div className="compensation-cards">
              {items.map(([icon, value, title, copy, action, to]) => (
                <article key={title} className="compensation-card">
                  <span className="compensation-card__icon">
                    <i className={`bi ${icon}`} />
                  </span>
                  <div className="compensation-card__body">
                    <div className="compensation-card__head">
                      <span className="compensation-card__value">{value}</span>
                      <h3>{title}</h3>
                    </div>
                    <p>{copy}</p>
                    {icon === "bi-calendar-check" && (
                      <div className="compensation-card__meter">
                        <i style={{ width: `${claimPercent}%` }} />
                      </div>
                    )}
                  </div>
                  <Link className="compensation-card__action" to={to}>
                    {action}
                    <i className="bi bi-arrow-right" />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
        <footer className="compensation-tips" aria-label="失败补偿说明">
          <ol className="tip-list">
            {tips.map(([icon, title, copy]) => (
              <li key={title}>
                <i className={`bi ${icon}`} />
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
  const achievedCount = milestones.filter((item) => item.achieved).length;
  const lastTarget = Math.max(1, Number(milestones.at(-1)?.units || 1));
  const progressPercent = milestones.length
    ? Math.min(100, Math.round((delivered / lastTarget) * 100))
    : 0;
  const remaining = nextMilestone
    ? Math.max(0, Number(nextMilestone.units || 0) - delivered)
    : 0;
  useIncentiveEntrance(pageRef, [
    ".usage-top",
    [".usage-ladder > li", { stagger: 0.05 }],
    [".rule-list li", { stagger: 0.05 }],
  ]);
  return (
    <main ref={pageRef} className={`usage-page${isDark ? " is-dark" : ""}`}>
      <div className="usage-frame">
        <header className="usage-top">
          <IncentiveAtmosphere />
          <div className="usage-top__inner">
            <div className="usage-top__copy">
              <BackButton className="usage-back" />
              <p>USAGE REWARDS</p>
              <h1>用量计划</h1>
              <span>本月成功交付越多，自动解锁越高阶的积分回馈。</span>
              <ul className="usage-pills">
                {["按月累计", "达标到账", "同档一次"].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="usage-facts" aria-label="本月用量">
              <span>
                <i className="bi bi-box-seam" />
                <small>本月交付</small>
                <strong>{loading ? "—" : `${delivered} 张`}</strong>
              </span>
              <span>
                <i className="bi bi-unlock" />
                <small>已解锁</small>
                <strong>
                  {loading ? "—" : `${achievedCount}/${milestones.length || "—"}`}
                </strong>
              </span>
              <span>
                <i className="bi bi-arrow-up-circle" />
                <small>{nextMilestone ? "距下一档" : "本月进度"}</small>
                <strong>
                  {nextMilestone ? `${remaining} 张` : `${progressPercent}%`}
                </strong>
              </span>
            </div>
          </div>
        </header>
        <section className="usage-workspace" aria-label="用量档位">
          <div className="workspace-heading">
            <div>
              <span
                className={`status-dot${!nextMilestone && milestones.length ? " is-complete" : ""}`}
              />
              <strong>本月档位</strong>
              <small>
                达到对应交付数量后，奖励自动发放到钱包，同档位本月只结算一次。
              </small>
            </div>
            {error && (
              <button type="button" className="text-action" onClick={reload}>
                <i className="bi bi-arrow-clockwise" />
                重新加载
              </button>
            )}
          </div>
          {loading ? (
            <LoadingBars className="usage-loading" label="正在读取用量计划…" />
          ) : error ? (
            <div className="usage-empty-state">
              <i className="bi bi-exclamation-circle" />
              <h2>暂时无法读取用量计划</h2>
              <p>{error}</p>
            </div>
          ) : milestones.length ? (
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
          ) : (
            <p className="usage-empty">暂未配置用量档位，请稍后再看。</p>
          )}
        </section>
        <footer className="usage-rules" aria-labelledby="usage-rules-title">
          <h2 id="usage-rules-title" className="sr-only">
            用量计划说明
          </h2>
          <ol className="rule-list">
            {[
              ["按自然月统计", "每月 1 日重新累计交付量"],
              ["达标自动到账", "无需手动领取，写入钱包账本"],
              ["同档不重复发", "每个档位每月最多结算一次"],
            ].map(([title, copy], index) => (
              <li key={title}>
                <span>{index + 1}</span>
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

const suggestionTypes = [
  ["feature", "新功能建议"],
  ["experience", "体验优化"],
  ["generation", "模型与生成效果"],
  ["content", "内容与活动"],
  ["other", "其他建议"],
];

export function SuggestionAdoptionView() {
  const isDark = useIsDark();
  const pageRef = useRef(null);
  const { data, loading } = useGrowthPrograms();
  const [form, setForm] = useState({ title: "", content: "", type: "" });
  const [submitting, setSubmitting] = useState(false);
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
      notificationService.success("产品建议已提交，可在问题反馈中查看处理进度");
    } catch (error) {
      notificationService.error(error?.message || "产品建议提交失败");
    } finally {
      setSubmitting(false);
    }
  };
  const steps = [
    ["bi-lightbulb-fill", "提交建议", "填写建议并提交，我们会尽快评估"],
    ["bi-file-earmark-text-fill", "评估审核", "产品团队评估建议价值与可行性"],
    ["bi-patch-check-fill", "采纳通知", "建议被采纳后，系统会通知你"],
    ["bi-stack", "发放奖励", "按价值等级发放创作积分"],
  ];
  const tips = [
    ["bi-chat-quote", "真实具体", "写清问题、场景与可执行方案"],
    ["bi-award", "按价值奖励", "采纳后按等级发放积分"],
    ["bi-clock-history", "进度可查", "可在问题反馈中追踪状态"],
  ];
  useIncentiveEntrance(pageRef, [
    ".suggestion-top",
    ".suggestion-layout",
    [".tip-list li", { stagger: 0.05 }],
  ]);
  return (
    <main
      ref={pageRef}
      className={`suggestion-page${isDark ? " is-dark" : ""}`}
    >
      <div className="suggestion-frame">
        <header className="suggestion-top">
          <IncentiveAtmosphere />
          <div className="suggestion-top__inner">
            <div className="suggestion-top__copy">
              <BackButton className="suggestion-back" />
              <p>PRODUCT CO-CREATE</p>
              <h1>建议采纳</h1>
              <span>
                提交真实、具体且可执行的产品建议，采纳后按价值等级发放创作积分。
              </span>
              <ul className="suggestion-pills">
                {["真实具体", "按价值奖励", "进度可查"].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="suggestion-facts" aria-label="建议采纳概览">
              <span>
                <i className="bi bi-stars" />
                <small>奖励上限</small>
                <strong>{loading ? "—" : `${rewardLabel} 积分`}</strong>
              </span>
              <span>
                <i className="bi bi-tags" />
                <small>建议类型</small>
                <strong>{suggestionTypes.length} 类</strong>
              </span>
              <span>
                <i className="bi bi-clock-history" />
                <small>进度追踪</small>
                <strong>问题反馈</strong>
              </span>
            </div>
          </div>
        </header>
        <section className="suggestion-workspace" aria-label="建议提交">
          <div className="suggestion-layout">
            <form className="suggestion-form" onSubmit={submit}>
              <div className="section-copy">
                <span className="section-kicker">提交建议</span>
                <h2>产品建议</h2>
                <p>写清问题、场景、方案与预期价值，便于更快评估与采纳。</p>
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
                  <i className="bi bi-chevron-down" />
                </span>
              </label>
              <div className="suggestion-submit-row">
                <p>
                  提交后可在{" "}
                  <Link to="/feedback?category=suggestion">问题反馈</Link>{" "}
                  中追踪建议状态与奖励进度
                </p>
                <button
                  type="submit"
                  className="primary-action"
                  disabled={!canSubmit}
                >
                  <i className="bi bi-send" />
                  {submitting ? "正在提交…" : "提交产品建议"}
                </button>
              </div>
            </form>
            <aside className="suggestion-process" aria-label="建议处理流程">
              <div className="section-copy">
                <span className="section-kicker">处理流程</span>
                <h2>从提交到奖励</h2>
                <p>全程可在问题反馈中追踪进度。</p>
              </div>
              <ol>
                {steps.map(([icon, title, copy], index) => (
                  <li key={title}>
                    <span className="process-icon">
                      <i className={`bi ${icon}`} />
                    </span>
                    <span className="process-index">{index + 1}</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>
        <footer
          className="suggestion-tips"
          aria-labelledby="suggestion-tips-title"
        >
          <h2 id="suggestion-tips-title" className="sr-only">
            建议采纳说明
          </h2>
          <ol className="tip-list">
            {tips.map(([icon, title, copy]) => (
              <li key={title}>
                <span>
                  <i className={`bi ${icon}`} />
                </span>
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
