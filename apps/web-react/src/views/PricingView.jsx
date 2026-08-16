import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import "@react/legacy-styles/generated/views/PricingView.css";

gsap.registerPlugin(useGSAP);

const sectionTabs = [
  ["plans", "套餐方案"],
  ["models", "模型价格"],
  ["unit", "创作单价"],
  ["pay", "获取积分"],
  ["faq", "常见问题"],
];

const heroHighlights = ["提交冻结", "完成结算", "失败返还"];

const previewPlans = [
  {
    id: "preview-usage",
    name: "按量创作",
    eyebrow: "灵活起步",
    description: "无需绑定套餐，按工作台任务单价消耗钱包额度，适合轻量试跑。",
    priceMode: "unit",
    suffix: "/ 张起",
    features: [
      "全部 AI 创作工作台",
      "提交冻结 · 完成结算",
      "失败或取消自动返还",
    ],
    preview: true,
  },
  {
    id: "preview-creator",
    name: "创作者计划",
    eyebrow: "持续创作",
    description:
      "面向持续创作的月度方案。在线支付接入前，可先申请体验资格领取积分。",
    priceMode: "coming",
    suffix: "/ 月",
    features: ["体验资格领取积分", "覆盖全部图像工作台", "优先体验后续能力"],
    popular: true,
    preview: true,
  },
  {
    id: "preview-pro",
    name: "专业制作",
    eyebrow: "高频制作",
    description:
      "面向高频生产与协作场景。正式套餐开放前，可通过反馈提交合作需求。",
    priceMode: "coming",
    suffix: "/ 月",
    features: ["更高额度预留", "适合批量生产流程", "支持反馈合作需求"],
    preview: true,
  },
];

const taskTypes = {
  t2i: ["文生图", "bi-image", "violet", "文生图 / 图生图"],
  coloring: ["插画染色", "bi-palette2", "rose", "线稿上色"],
  ui_design: ["UI 设计稿", "bi-window-sidebar", "blue", "界面设计稿"],
  ecommerce_design: ["AI 电商", "bi-bag-check", "green", "电商设计"],
  model_sheet: ["模型设计", "bi-badge-hd", "teal", "模型设计"],
  game_art: ["游戏设计", "bi-controller", "violet", "游戏美术"],
  puzzle: ["拼图", "bi-puzzle", "slate", "本地拼图工具"],
  background_remove: ["背景移除", "bi-scissors", "amber", "背景移除"],
};

const accessMethods = [
  [
    "redeem",
    "兑换码入账",
    "bi-ticket-perforated",
    "持有兑换码可在钱包直接入账",
    "去兑换",
  ],
  [
    "trial",
    "申请体验资格",
    "bi-stars",
    "填写职业与用途，审核后领取积分",
    "立即申请",
  ],
  [
    "checkin",
    "每日签到",
    "bi-calendar-check",
    "连续签到，每天领取免费创作积分",
    "去签到",
  ],
];

const faqs = [
  [
    "现在怎样获取套餐积分？",
    "当前可通过兑换码、体验资格申请和每日签到获取积分。在线支付尚未接入，页面不会创建付款订单。",
  ],
  [
    "模型价格和创作单价有什么区别？",
    "模型价格是具体生图模型的单次积分；创作单价是各工作台任务类型的起步/区间价。实际扣费以提交时选择的模型与工作台为准。",
  ],
  [
    "任务失败会扣积分吗？",
    "任务提交时冻结额度，成功后结算；失败或取消会释放对应冻结额度。",
  ],
  [
    "套餐会自动扣款吗？",
    "不会。当前价格只用于展示，支付接口未开放，不会创建订单或自动扣款。",
  ],
];

const placeholderText =
  /^(简短说明|暂无描述|description|aaa+|test|todo|placeholder)$/i;

async function apiGet(path, signal) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true)
    throw new Error(payload?.error || "请求失败");
  return payload.data;
}

function formatPoints(points, { withUnit = true } = {}) {
  const value = Number(points || 0);
  const text = (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString(
    "zh-CN",
  );
  return withUnit ? `${text} 积分` : text;
}

function formatCents(cents) {
  return `¥${(Number(cents || 0) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizePlans(plans) {
  if (!plans.length) return previewPlans;
  return plans.map((plan) => ({
    ...plan,
    eyebrow: plan.kind === "subscription" ? "订阅方案" : "额度包",
    description:
      String(plan.description || "").trim() ||
      (plan.kind === "subscription"
        ? "订阅期内按计划发放创作积分。"
        : "一次性发放到钱包，可用于全部创作工作台。"),
    popular: plan.recommended === true,
    preview: false,
  }));
}

function planFeatures(plan) {
  if (plan.preview) return plan.features;
  const configured = Array.isArray(plan.features) ? plan.features : [];
  const cleaned = configured.filter(
    (item) =>
      !/余额\s*[\d.]+\s*元|约\s*\d+\s*张|创作额度|积分入账|发放\s*\d/.test(
        String(item || ""),
      ),
  );
  return cleaned.length
    ? cleaned
    : ["全平台创作工具通用", "积分进入个人钱包", "当前不会自动创建订单"];
}

export function PricingView() {
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const [activeSection, setActiveSection] = useState("plans");
  const [plans, setPlans] = useState([]);
  const [pricing, setPricing] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [plansLoadFailed, setPlansLoadFailed] = useState(false);
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [dark, setDark] = useState(
    () =>
      document.documentElement.classList.contains("color-scheme-dark") ||
      localStorage.getItem("walleven-color-scheme") === "dark",
  );

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("color-scheme-dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-color-scheme"],
    });
    return () => observer.disconnect();
  }, []);

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
          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(".pp-hero__copy", {
              y: 18,
              autoAlpha: 0,
              duration: 0.5,
            })
            .from(
              ".pp-wallet",
              {
                y: 18,
                autoAlpha: 0,
                duration: 0.45,
                clearProps: "transform,opacity,visibility",
              },
              "-=0.28",
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
    Promise.allSettled([
      apiGet("/plans", controller.signal),
      apiGet("/pricing", controller.signal),
      apiGet("/runtime-config", controller.signal),
      apiGet("/auth/session", controller.signal),
    ]).then(
      async ([plansResult, pricingResult, runtimeResult, sessionResult]) => {
        if (controller.signal.aborted) return;
        if (plansResult.status === "fulfilled")
          setPlans(
            Array.isArray(plansResult.value?.items)
              ? plansResult.value.items
              : [],
          );
        else setPlansLoadFailed(true);
        if (pricingResult.status === "fulfilled")
          setPricing(pricingResult.value || null);
        if (runtimeResult.status === "fulfilled")
          setRuntimeConfig(runtimeResult.value || null);
        const nextUser =
          sessionResult.status === "fulfilled"
            ? sessionResult.value?.user || null
            : null;
        setUser(nextUser);
        setPlansLoading(false);
        setModelsLoading(false);
        if (nextUser) {
          apiGet("/me/wallet", controller.signal)
            .then((value) => {
              if (!controller.signal.aborted) setWallet(value || null);
            })
            .catch(() => null);
        }
      },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const nodes = [
      ...(pageRef.current?.querySelectorAll("[data-section]") || []),
    ];
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit?.target?.dataset.section)
          setActiveSection(hit.target.dataset.section);
      },
      { rootMargin: "-42% 0px -42% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    const syncTopSection = () => {
      const plansTop = document.getElementById("pricing-plans")?.offsetTop || 0;
      if (window.scrollY < Math.max(1, plansTop - window.innerHeight * 0.42)) {
        setActiveSection("plans");
      }
    };
    window.addEventListener("scroll", syncTopSection, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", syncTopSection);
    };
  }, []);

  const taskPriceCards = useMemo(() => {
    const values = pricing?.taskPointPrices || pricing?.taskPrices || {};
    const ranges =
      pricing?.taskPointPriceRanges || pricing?.taskPriceRanges || {};
    return Object.entries(taskTypes).map(
      ([type, [label, icon, tone, blurb]]) => {
        const range = ranges[type] || {};
        const fallback = Object.prototype.hasOwnProperty.call(values, type)
          ? Number(values[type])
          : null;
        const min =
          Number(range.minPoints ?? range.MinCents ?? range.minCents) ||
          fallback;
        const max =
          Number(range.maxPoints ?? range.MaxCents ?? range.maxCents) || min;
        return {
          type,
          label,
          icon,
          tone,
          blurb,
          minPoints: Number.isFinite(min) ? min : null,
          maxPoints: Number.isFinite(max) ? max : null,
        };
      },
    );
  }, [pricing]);

  const modelCards = useMemo(() => {
    const models = Array.isArray(runtimeConfig?.aiModelCatalog?.publicModels)
      ? runtimeConfig.aiModelCatalog.publicModels
      : [];
    const seen = new Set();
    return models
      .map((model) => {
        const id = String(model?.id || model?.publicModelKey || "").trim();
        if (!id || seen.has(id)) return null;
        seen.add(id);
        const points = Number(
          model.pricePoints ??
            model.creditCost ??
            model.priceCents ??
            model.pricing?.points ??
            model.pricing?.cents ??
            0,
        );
        const standard = Number(
          model.standardPricePoints ?? model.pricing?.standardPoints ?? 0,
        );
        const discount = Number(
          model.discountPricePoints ?? model.pricing?.discountPoints ?? 0,
        );
        const provider = String(
          model.providerName || model.provider || "",
        ).trim();
        const description = String(model.description || "").trim();
        return {
          id,
          name: String(model.label || model.name || id),
          provider: placeholderText.test(provider) ? "" : provider,
          description: placeholderText.test(description) ? "" : description,
          points: Number.isFinite(points) ? points : 0,
          standard: Number.isFinite(standard) ? standard : 0,
          discount: Number.isFinite(discount) ? discount : 0,
          fastMode: model.fastMode === true,
          isDefault: model.default === true,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) => a.points - b.points || a.name.localeCompare(b.name, "zh"),
      );
  }, [runtimeConfig]);

  const displayPlans = useMemo(() => normalizePlans(plans), [plans]);
  const available = Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0);
  const frozen = Number(wallet?.frozenCents || 0);

  function requestTrial() {
    navigate("/pricing?trial=apply");
  }
  function scrollToSection(id) {
    setActiveSection(id);
    document
      .getElementById(`pricing-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function planPrice(plan) {
    if (plan.priceMode === "unit") {
      const mins = taskPriceCards
        .map((card) => card.minPoints)
        .filter((value) => value !== null && value > 0);
      return mins.length ? `${formatPoints(Math.min(...mins))}起` : "按量计费";
    }
    if (plan.priceMode === "coming") return "体验申请中";
    return formatCents(plan.priceCents);
  }
  function planSuffix(plan) {
    if (plan.priceMode === "coming") return "正式价待开放";
    if (plan.suffix) return plan.suffix;
    if (plan.kind === "subscription")
      return Number(plan.durationDays || 0) > 0
        ? `/ ${plan.durationDays} 天`
        : "/ 订阅期";
    return "一次性入账";
  }
  function quotaLine(plan) {
    if (plan.preview) return "";
    if (plan.kind === "subscription")
      return Number(plan.dailyGrantCents || 0) > 0
        ? `每天发放 ${formatPoints(plan.dailyGrantCents)}`
        : "";
    const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0);
    return total > 0 ? `共入账 ${formatPoints(total)}` : "";
  }
  function unitPrice(card) {
    if (card.type === "puzzle") return "永久免费";
    if (card.minPoints === null || !Number.isFinite(card.minPoints))
      return "暂不可用";
    if (
      card.maxPoints !== null &&
      Number.isFinite(card.maxPoints) &&
      card.maxPoints > card.minPoints
    )
      return `${formatPoints(card.minPoints, { withUnit: false })}–${formatPoints(card.maxPoints)}`;
    return formatPoints(card.minPoints);
  }
  function useAccessMethod(id) {
    if (id === "redeem") navigate("/wallet");
    else if (id === "trial") requestTrial();
    else navigate("/check-in");
  }

  return (
    <main ref={pageRef} className={`pp${dark ? " is-dark" : ""}`}>
      <section className="pp-hero">
        <div className="pp-hero__atmosphere" aria-hidden="true">
          <span className="pp-orb pp-orb--a" />
          <span className="pp-orb pp-orb--b" />
        </div>
        <div className="pp-shell pp-hero__grid">
          <div className="pp-hero__copy">
            <p className="pp-kicker">STARCLOUDS · BILLING</p>
            <h1>创作价格</h1>
            <p>
              按模型与任务清晰计价。提交时冻结，完成后结算；失败或取消自动返还。
            </p>
            <ul className="pp-hero__pills">
              {heroHighlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="pp-hero__actions">
              <button
                type="button"
                className="pp-btn is-primary"
                onClick={() => navigate("/text-to-image")}
              >
                开始创作{" "}
                <i className="bi bi-arrow-up-right" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pp-btn is-ghost"
                onClick={requestTrial}
              >
                申请体验资格
              </button>
            </div>
          </div>
          <aside className="pp-wallet" aria-label="钱包概览">
            <div className="pp-wallet__top">
              <span>我的钱包</span>
              <em>
                <i className="bi bi-shield-check" aria-hidden="true" />
                安全计费
              </em>
            </div>
            {user ? (
              <>
                <small>当前可用</small>
                <strong>{formatPoints(available)}</strong>
                {frozen > 0 && (
                  <span className="pp-wallet__frozen">
                    {formatPoints(frozen)} 任务冻结中
                  </span>
                )}
              </>
            ) : (
              <>
                <small>登录后查看余额</small>
                <strong className="is-muted">—</strong>
                <button
                  type="button"
                  className="pp-btn is-primary is-compact"
                  onClick={() => navigate("/auth")}
                >
                  前往登录
                </button>
              </>
            )}
            <p>额度可用于全部 AI 创作工作台，不会自动扣款。</p>
            {user && (
              <Link className="pp-wallet__link" to="/wallet">
                查看钱包明细{" "}
                <i className="bi bi-arrow-right" aria-hidden="true" />
              </Link>
            )}
          </aside>
        </div>
      </section>

      <nav className="pp-nav" aria-label="价格分区">
        <div className="pp-shell pp-nav__inner">
          {sectionTabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? "is-active" : ""}
              onClick={() => scrollToSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <section
        id="pricing-plans"
        className="pp-section"
        data-section="plans"
        aria-labelledby="plans-title"
      >
        <div className="pp-shell">
          <header className="pp-head">
            <div>
              <p className="pp-kicker">01 / PLANS</p>
              <h2 id="plans-title">套餐方案</h2>
              <p>价格与权益由运营后台配置；当前可申请体验或使用兑换码入账。</p>
            </div>
          </header>
          {plansLoading ? (
            <div className="pp-plan-grid" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <article key={n} className="pp-plan is-loading" />
              ))}
            </div>
          ) : (
            <div className="pp-plan-grid">
              {displayPlans.map((plan) => {
                const quota = quotaLine(plan);
                return (
                  <article
                    key={plan.id}
                    className={`pp-plan${plan.popular ? " is-popular" : ""}`}
                  >
                    {(plan.badge || plan.popular) && (
                      <div className="pp-plan__badge">
                        {plan.badge || "推荐"}
                      </div>
                    )}
                    <small>{plan.eyebrow}</small>
                    <h3>{plan.name}</h3>
                    <p>{plan.description}</p>
                    <div className="pp-plan__price">
                      <strong>{planPrice(plan)}</strong>
                      <span>{planSuffix(plan)}</span>
                    </div>
                    {quota && <b>{quota}</b>}
                    <ul>
                      {planFeatures(plan).map((feature) => (
                        <li key={feature}>
                          <i
                            className="bi bi-check2-circle"
                            aria-hidden="true"
                          />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() =>
                        plan.preview && plan.priceMode === "unit"
                          ? navigate("/text-to-image")
                          : requestTrial()
                      }
                    >
                      {plan.preview && plan.priceMode === "unit"
                        ? "开始创作"
                        : "申请体验"}{" "}
                      <i className="bi bi-arrow-up-right" aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {plansLoadFailed && (
            <p className="pp-note">套餐暂时不可用，已显示预览方案。</p>
          )}
        </div>
      </section>

      <section
        id="pricing-models"
        className="pp-section is-soft"
        data-section="models"
        aria-labelledby="models-title"
      >
        <div className="pp-shell">
          <header className="pp-head">
            <div>
              <p className="pp-kicker">02 / MODELS</p>
              <h2 id="models-title">模型价格</h2>
              <p>各生图模型的单次积分；提交任务时按所选模型结算。</p>
            </div>
            {modelCards.length > 0 && (
              <span className="pp-head__meta">
                {modelCards.length} 个可用模型
              </span>
            )}
          </header>
          {modelsLoading ? (
            <div className="pp-model-table" aria-busy="true">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="pp-model-row is-loading" />
              ))}
            </div>
          ) : modelCards.length ? (
            <div
              className="pp-model-table"
              role="table"
              aria-label="模型价格表"
            >
              <div className="pp-model-row is-head" role="row">
                <span>模型</span>
                <span>说明</span>
                <span>单价</span>
              </div>
              {modelCards.map((model) => (
                <article
                  key={model.id}
                  className={`pp-model-row${model.isDefault ? " is-default" : ""}`}
                  role="row"
                >
                  <div className="pp-model-row__name">
                    <span className="pp-model-row__icon" aria-hidden="true">
                      <i className="bi bi-cpu" />
                    </span>
                    <div>
                      <strong>{model.name}</strong>
                      <small>
                        {model.provider && <>{model.provider} · </>}
                        {model.isDefault ? (
                          <em>默认</em>
                        ) : model.fastMode ? (
                          <em className="is-fast">极速</em>
                        ) : (
                          <>标准</>
                        )}
                      </small>
                    </div>
                  </div>
                  <p>
                    {model.description ||
                      "按所选模型单次计费，提交时冻结对应积分。"}
                  </p>
                  <div className="pp-model-row__price">
                    <b>{formatPoints(model.points)}</b>
                    <span>/ 张</span>
                    {model.standard > 0 &&
                      model.discount > 0 &&
                      model.discount < model.standard && (
                        <small>标准 {formatPoints(model.standard)}</small>
                      )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="pp-empty">
              <i className="bi bi-cpu" aria-hidden="true" />
              <strong>暂无已上架模型价格</strong>
              <p>请稍后在创作台查看可用模型，或联系运营确认模型目录配置。</p>
            </div>
          )}
        </div>
      </section>

      <section
        id="pricing-unit"
        className="pp-section"
        data-section="unit"
        aria-labelledby="unit-title"
      >
        <div className="pp-shell">
          <header className="pp-head">
            <div>
              <p className="pp-kicker">03 / UNITS</p>
              <h2 id="unit-title">创作单价</h2>
              <p>按工作台任务类型计价；有模型区间时显示最低至最高。</p>
            </div>
          </header>
          <div className="pp-unit-grid">
            {taskPriceCards.map((card) => (
              <article
                key={card.type}
                className="pp-unit"
                data-tone={card.tone}
              >
                <span className="pp-unit__icon" aria-hidden="true">
                  <i className={`bi ${card.icon}`} />
                </span>
                <div className="pp-unit__copy">
                  <strong>{card.label}</strong>
                  <small>{card.blurb || card.type}</small>
                </div>
                <div className="pp-unit__price">
                  <b>{unitPrice(card)}</b>
                  {card.type !== "puzzle" && card.minPoints !== null && (
                    <span>/ 张</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing-pay"
        className="pp-section is-soft"
        data-section="pay"
        aria-labelledby="pay-title"
      >
        <div className="pp-shell">
          <header className="pp-head">
            <div>
              <p className="pp-kicker">04 / CREDITS</p>
              <h2 id="pay-title">获取创作积分</h2>
              <p>在线支付接入前，也可以通过以下方式开始创作。</p>
            </div>
          </header>
          <div className="pp-access">
            {accessMethods.map(([id, name, icon, note, action], index) => (
              <article key={id}>
                <span className="pp-access__step">0{index + 1}</span>
                <i className={`bi ${icon}`} aria-hidden="true" />
                <div>
                  <strong>{name}</strong>
                  <small>{note}</small>
                </div>
                <button type="button" onClick={() => useAccessMethod(id)}>
                  {action}
                  <i className="bi bi-arrow-right" aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing-faq"
        className="pp-section"
        data-section="faq"
        aria-labelledby="faq-title"
      >
        <div className="pp-shell pp-faq-layout">
          <header className="pp-head is-stack">
            <p className="pp-kicker">05 / FAQ</p>
            <h2 id="faq-title">常见问题</h2>
            <p>计费规则、积分获取与退款说明。</p>
          </header>
          <div className="pp-faq">
            {faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0 ? true : undefined}>
                <summary>
                  <span>{question}</span>
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="pp-cta">
        <div className="pp-shell pp-cta__inner">
          <div>
            <h2>额度就绪，继续你的创作流程</h2>
            <p>跳转到文生图工作台，按所选模型与任务类型结算。</p>
          </div>
          <div className="pp-cta__actions">
            <button
              type="button"
              className="pp-btn is-primary"
              onClick={() => navigate("/text-to-image")}
            >
              开始创作 <i className="bi bi-arrow-up-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pp-btn is-light"
              onClick={() => navigate("/wallet")}
            >
              打开钱包
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
