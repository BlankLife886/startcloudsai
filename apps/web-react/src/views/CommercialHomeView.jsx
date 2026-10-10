import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Apple, ArrowUp, ArrowUpRight, AudioLines, Box, Clock3, FileArchive,
  Gamepad2, Image as ImageIcon, Layers, LayoutGrid, Maximize2, MessageSquareText,
  Paintbrush, PanelsTopLeft, Plug, Puzzle, Scissors, Shirt, ShoppingBag,
  Smartphone, Sparkles, Video, WandSparkles, Workflow, Wrench,
} from "lucide-react";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { COMMERCE_ENTRY_GROUPS, STUDIO_TOOLS } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import { fetchTaskPricing, minPointsForTaskType } from "@react/legacy-modules/services/pricing.js";
import { PAGE_STATUS, pageKeyForHref } from "../config/pageControls.js";
import { useIsDark } from "../hooks/useIsDark.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import "./commercial-home-react.css";
import "./home/HomeCatalogSections.css";
import { HomeHero } from "./home/HomeHero.jsx";
import { HomeCoverImage } from "./home/HomeCoverImage.jsx";
import { useHomeMotion } from "./home/useHomeMotion.js";
import { useFooterPullReveal } from "./home/useFooterPullReveal.js";
import { createParticleWordmark } from "./home/footerParticles.js";
import { HomeModelMarquee } from "./home/HomeModelMarquee.jsx";
import { collectHomeModels } from "./home/homeModels.js";

const STATUS_META = {
  [PAGE_STATUS.NORMAL]: { label: "可使用", className: "is-normal" },
  [PAGE_STATUS.MAINTENANCE]: { label: "维护中", className: "is-maintenance" },
  [PAGE_STATUS.DEVELOPING]: { label: "开发中", className: "is-developing" },
};

const CARD_ICONS = {
  canvas: Workflow,
  assistant: MessageSquareText,
  t2i: ImageIcon,
  coloring: Paintbrush,
  ui: PanelsTopLeft,
  model: Box,
  game: Gamepad2,
  "commerce-model": Shirt,
  "commerce-create": ShoppingBag,
  "commerce-image": WandSparkles,
  skills: Sparkles,
  "psd-decompose": Layers,
  "all-ai-tools": LayoutGrid,
  "background-remove": Scissors,
  "image-compress": FileArchive,
  puzzle: Puzzle,
  "bi-camera-video": Video,
  "bi-soundwave": AudioLines,
  "bi-badge-hd": Maximize2,
};

const UPCOMING_ITEMS = [
  {
    id: "ios-app",
    label: "苹果 App",
    tagline: "iOS 客户端，随行创作与灵感同步",
    badge: "内测就绪",
    tone: "ready",
    Icon: Apple,
  },
  {
    id: "android-app",
    label: "安卓 App",
    tagline: "Android 客户端，多端实时同步",
    badge: "内测就绪",
    tone: "ready",
    Icon: Smartphone,
  },
  {
    id: "canvas-scheduled-task",
    label: "画布定时任务",
    tagline: "按计划自动化执行工作流",
    badge: "规划中",
    tone: "planning",
    Icon: Clock3,
  },
  {
    id: "mcp",
    label: "MCP 协议生态",
    tagline: "无缝接入 Agent 与开发工作流",
    badge: "首发支持",
    tone: "first",
    Icon: Plug,
  },
];

const CREATION_ITEMS = [
  {
    id: "canvas",
    to: "/canvas",
    label: "无限画布",
    tagline: "节点工作流与自由画布创作",
    cover: "/sucai/covers/cover-canvas-workflow.webp",
    feature: "ai.infiniteCanvas",
    taskType: "infinite_canvas",
  },
  ...STUDIO_TOOLS.filter((item) => item.id !== "ecommerce")
    .map(item => item.id === "assistant" ? { ...item, feature: "ai.assistant" } : item),
];

const FOOTER_GROUPS = [
  { title: "开始创作", links: [["创作台", "/studio"], ["AI 助手", "/assistant"], ["无限画布", "/canvas"], ["AI 电商", "/ecommerce-design"]] },
  { title: "工具资源", links: [["全部工具", "/ai-tools"], ["技能库", "/skills"], ["提示词", "/prompts"], ["API 调用", "/developer-api"]] },
  { title: "社区活动", links: [["社区", "/share"], ["创作激励", "/incentive-plans"], ["创作价格", "/pricing"], ["更新说明", "/updates"]] },
  { title: "我的空间", links: [["创作历史", "/history"], ["我的订单", "/orders"], ["我的钱包", "/wallet"], ["账户设置", "/account"]] },
];

const FOOTER_LEGAL_LINKS = [
  ["关于我们", "/app-space"],
  ["帮助与支持", "/support"],
  ["问题反馈", "/feedback"],
  ["用户协议", "/terms"],
  ["隐私政策", "/privacy"],
];

const FOOTER_CTA_LINKS = [
  ["开始创作", "/studio", "primary"],
  ["查看价格", "/pricing", "ghost"],
];

const COMMERCE_SUB_TAGS = {
  "commerce-model": ["真人模特试衣", "手持商品置景", "饰品穿戴合成"],
  "commerce-create": ["AI 创意商拍", "全套电商主图", "亚马逊 A+ 详情"],
  "commerce-image": ["多渠道营销图", "智能无损扩图", "商品阴影与质感"],
};

const COMMERCE_ITEMS = COMMERCE_ENTRY_GROUPS.map((group) => ({
  id: `commerce-${group.id}`,
  to: group.to,
  label: group.label,
  tagline: group.description,
  cover: group.cover,
  feature: "ai.ecommerceDesign",
  taskType: "ecommerce_design",
  subtags: COMMERCE_SUB_TAGS[`commerce-${group.id}`] || [],
}));

const LOCAL_TOOL_ITEMS = [
  { id: "skills", to: "/skills", label: "技能库", tagline: "在输入框用 @ 选择技能，提交时自动展开", icon: "bi-lightning-charge", minPoints: 0 },
  { id: "psd-decompose", to: "/psd-decompose", label: "PSD 分解", tagline: "图片转分层 PSD 与素材包", icon: "bi-layers", },
  {
    id: "all-ai-tools",
    to: "/ai-tools",
    label: "全部工具",
    tagline: "查看 AI 助手、无限画布和平台所有能力",
    icon: "bi-grid-3x3-gap-fill",
    minPoints: 0,
  },
  {
    id: "background-remove",
    to: "/tools/background-remove",
    label: "背景移除",
    tagline: "智能抠图并导出透明背景",
    icon: "bi-person-bounding-box",
    feature: "ai.imageTools",
    taskType: "background_remove",
  },
  {
    id: "image-compress",
    to: "/tools/image-compress",
    label: "图片压缩",
    tagline: "减小体积并保留清晰度",
    icon: "bi-file-zip",
    minPoints: 0,
  },
  {
    id: "puzzle",
    to: "/tools/puzzle",
    label: "拼图",
    tagline: "快速拼贴多张图片并导出",
    icon: "bi-puzzle-fill",
    feature: "ai.puzzle",
    minPoints: 0,
  },
];

function mediaToolIcon(tool) {
  if (tool.modality === "video") return "bi-camera-video";
  if (tool.modality === "audio") return "bi-soundwave";
  if (String(tool.tool || "").includes("upscale")) return "bi-badge-hd";
  return "bi-image";
}

function featureAvailable(features, key) {
  return !key || features?.[key]?.enabled !== false;
}

function takePoints(value) {
  const points = Number(value);
  return Number.isFinite(points) && points >= 0 ? Math.round(points) : null;
}

function minModelPoints(models, { canvas = false } = {}) {
  let min = null;
  for (const model of models || []) {
    const candidates = [resolveModelPointPricing(model).effective];
    for (const effort of model.reasoningEfforts || []) {
      const scoped = model.reasoningPrices?.[effort.id] || {};
      candidates.push(
        canvas
          ? scoped.canvasAgentPricePoints ?? effort.pricePoints
          : effort.pricePoints ?? scoped.assistantPricePoints,
      );
    }
    for (const value of candidates) {
      const points = takePoints(value);
      if (points === null) continue;
      min = min === null ? points : Math.min(min, points);
    }
  }
  return min;
}

function minPointsForItem(item, pricing, features) {
  if (item.minPoints != null) return takePoints(item.minPoints);
  if (item.pricePoints != null) return takePoints(item.pricePoints);
  if (item.taskType === "assistant") {
    const config = features?.["ai.assistant"]?.config || {};
    return minModelPoints([...(config.imageModels || []), ...(config.textModels || [])]);
  }
  if (item.taskType === "infinite_canvas") {
    const fromPricing = minPointsForTaskType(pricing, "infinite_canvas");
    if (fromPricing !== null) return fromPricing;
    const config = features?.["ai.infiniteCanvas"]?.config || {};
    return minModelPoints([...(config.imageModels || []), ...(config.textModels || [])], {
      canvas: true,
    });
  }
  return minPointsForTaskType(pricing, item.taskType);
}

function priceLabel(points) {
  if (points === null || points === undefined) return "";
  if (points === 0) return "免费";
  return `最低 ${points.toLocaleString("zh-CN")} 积分`;
}

function PriceMark({ points, title }) {
  if (points === null || points === undefined) return null;
  if (points === 0) {
    return (
      <b className="home-card__price is-free" title={title}>
        <span className="home-card__price-icon" aria-hidden="true">
          <Sparkles size={11} strokeWidth={2.2} />
        </span>
        <span className="home-card__price-val">
          <span className="home-card__price-num">免费</span>
        </span>
      </b>
    );
  }
  return (
    <b className="home-card__price" title={title}>
      <span className="home-card__price-icon" aria-hidden="true">
        <Sparkles size={11} strokeWidth={2.2} />
      </span>
      <span className="home-card__price-val">
        <span className="home-card__price-label">消耗</span>
        {" "}
        <span className="home-card__price-num">{points.toLocaleString("zh-CN")}</span>
        {" "}
        <i>积分</i>
      </span>
    </b>
  );
}

function CoverCard({ item, badge = "", featured = false }) {
  const Icon = CARD_ICONS[item.id] || CARD_ICONS[item.icon] || ImageIcon;
  const status = STATUS_META[item.status] || STATUS_META[PAGE_STATUS.NORMAL];
  const StatusIcon = item.status === PAGE_STATUS.MAINTENANCE ? Wrench : Clock3;
  const blocked = !badge && (item.status === PAGE_STATUS.DEVELOPING || item.status === PAGE_STATUS.MAINTENANCE);
  const shownBadge = badge || (blocked ? status.label : "");
  const badgeClass = badge ? "is-developing" : status.className;
  const price = priceLabel(item.minPoints);
  const className = [
    "home-card",
    featured ? "is-featured" : "",
    blocked ? status.className : "",
    item.cover ? "" : "is-icon",
    item.to ? "" : "is-static",
  ]
    .filter(Boolean)
    .join(" ");
  const label = [item.label, shownBadge, blocked ? "" : price].filter(Boolean).join("，");
  const body = (
    <>
      <span className="home-card__media">
        {item.cover ? (
          <HomeCoverImage src={item.cover} />
        ) : (
          <Icon size={32} strokeWidth={1.75} aria-hidden="true" />
        )}
      </span>
      <span className="home-card__veil" aria-hidden="true" />
      {shownBadge ? (
        <em className={`home-card__status ${badgeClass}`}><StatusIcon size={12} strokeWidth={1.75} aria-hidden="true" /><span>{shownBadge}</span></em>
      ) : null}
      {!blocked && price ? <span className="home-card__price-hidden sr-only">{price}</span> : null}
      {item.to && !blocked ? (
        <span className="home-card__arrow" aria-hidden="true">
          <span className="home-card__capsule">
            <span className="home-card__capsule-text">立即体验</span>
            <span className="home-card__capsule-icon">
              <ArrowUpRight size={13} strokeWidth={1.75} />
            </span>
          </span>
        </span>
      ) : null}
      <span className="home-card__body">
        <span className="home-card__heading">
          <strong title={item.label}>{item.label}</strong>
        </span>
        {blocked && item.reason ? <small className="home-card__description" title={item.reason}>{item.reason}</small> : <span className="home-card__description" title={item.tagline}>{item.tagline}</span>}
        {item.subtags?.length && !blocked ? (
          <span className="home-card__subtags" aria-label="核心能力">
            {item.subtags.map((subtag) => (
              <span key={subtag} className="home-card__subtag">{subtag}</span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
  if (item.to) {
    return (
      <Link className={className} to={item.to} aria-label={label} data-home-item viewTransition>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} role="group" aria-label={label} data-home-item>
      {body}
    </div>
  );
}

function CompactCard({ item }) {
  const Icon = CARD_ICONS[item.id] || CARD_ICONS[item.icon] || ImageIcon;
  const StatusIcon = item.status === PAGE_STATUS.MAINTENANCE ? Wrench : Clock3;
  const status = STATUS_META[item.status] || STATUS_META[PAGE_STATUS.NORMAL];
  const blocked = item.status === PAGE_STATUS.DEVELOPING || item.status === PAGE_STATUS.MAINTENANCE;
  const price = priceLabel(item.minPoints);
  const description = blocked ? item.reason || item.tagline : item.tagline;
  return (
    <Link
      className={`home-compact ${blocked ? status.className : ""}`}
      data-tool={item.id}
      data-spotlight
      to={item.to}
      aria-label={[item.label, blocked ? status.label : price].filter(Boolean).join("，")}
      data-home-item
      viewTransition
    >
      <span className="home-spot-ring" aria-hidden="true" />
      <span className="home-compact__icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.6} />
      </span>
      <span className="home-compact__heading">
        <strong title={item.label}>{item.label}</strong>
      </span>
      {description ? <span className="home-compact__description" title={description}>{description}</span> : null}
      {blocked ? (
        <em className={`home-card__status ${status.className}`}><StatusIcon size={12} strokeWidth={1.75} aria-hidden="true" /><span>{status.label}</span></em>
      ) : (
        <PriceMark points={item.minPoints} title={price} />
      )}
      {blocked ? null : (
        <span className="home-compact__arrow" aria-hidden="true">
          <ArrowUpRight size={14} strokeWidth={1.75} />
        </span>
      )}
    </Link>
  );
}

// 悬停聚光：把指针在卡片内的位置写进 --mx / --my，供边框光和点阵高亮使用
function trackSpotlight(event) {
  const card = event.target.closest?.("[data-spotlight]");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  card.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

function HomeSection({ id, title, description, children }) {
  return (
    <section id={`home-${id}`} className={`home-section home-section--${id}`} aria-labelledby={`home-${id}-title`}>
      <header className="home-section__head">
        <div className="home-section__lead">
          <h2 id={`home-${id}-title`}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export function CommercialHomeView() {
  const isDark = useIsDark();
  const { controls, controlForKey, isEntryVisible } = usePageControls();
  const rootRef = useRef(null);
  const pullRef = useRef(null);
  const ctaRef = useRef(null);
  const particleCanvasRef = useRef(null);
  const particlesRef = useRef(null);
  const pullProgressRef = useRef(0);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    let active = true;
    fetchRuntimeConfig()
      .then((config) => active && setRuntimeConfig(config))
      .catch(() => null);
    fetchTaskPricing()
      .then((data) => active && setPricing(data))
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  const catalog = useMemo(() => {
    const features = runtimeConfig?.features || {};
    const enrich = (item) => {
      const configured = controlForKey(pageKeyForHref(item.to));
      const available = featureAvailable(features, item.feature);
      return {
        ...item,
        status:
          configured.status === PAGE_STATUS.NORMAL && !available
            ? PAGE_STATUS.MAINTENANCE
            : configured.status,
        reason:
          configured.status === PAGE_STATUS.NORMAL && !available
            ? "当前暂无可用模型"
            : configured.reason,
        minPoints: minPointsForItem(item, pricing, features),
      };
    };
    const keep = (item) => item.status !== PAGE_STATUS.REMOVED;
    const creation = CREATION_ITEMS.map(enrich).filter(keep);
    const mediaItems = (runtimeConfig?.features?.["ai.mediaTools"]?.config?.tools || []).map(
      (tool) => ({
        id: `media-${tool.id}`,
        to: `/tools/${encodeURIComponent(tool.id)}`,
        label: String(tool.name || tool.label || "媒体工具"),
        icon: mediaToolIcon(tool),
        feature: "ai.mediaTools",
        minPoints:
          takePoints(tool.imageUpscalePricing?.lowPricePoints) ?? takePoints(tool.pricePoints),
      }),
    );
    return {
      creation,
      commerce: COMMERCE_ITEMS.map(enrich).filter(keep),
      tools: [...mediaItems, ...LOCAL_TOOL_ITEMS].map(enrich).filter(keep),
    };
  }, [controlForKey, controls, pricing, runtimeConfig]);

  const models = useMemo(() => collectHomeModels(runtimeConfig), [runtimeConfig]);
  const motionOff = useHomeMotion(rootRef);
  // 减少动态效果时不做聚合过程，大字一出现就是完整字形
  const particleProgress = (progress) => (motionOff && progress > 0 ? 1 : progress);
  useFooterPullReveal(pullRef, (progress) => {
    pullProgressRef.current = progress;
    particlesRef.current?.draw(particleProgress(progress));
  });

  // 号召区第一次进入视口时把绳线“画”出来，只播放一次
  useEffect(() => {
    const cta = ctaRef.current;
    if (!cta || !("IntersectionObserver" in window)) {
      cta?.classList.add("is-drawn");
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      cta.classList.add("is-drawn");
      observer.disconnect();
    }, { threshold: 0.4 });
    observer.observe(cta);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = particleCanvasRef.current;
    if (!canvas) return undefined;
    const wordmark = createParticleWordmark(canvas);
    wordmark.setAlpha(isDark ? 0.8 : 0.7);
    const redraw = () => {
      wordmark.layout();
      wordmark.draw(particleProgress(pullProgressRef.current));
    };
    particlesRef.current = wordmark;
    redraw();
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(redraw, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      particlesRef.current = null;
    };
    // particleProgress 只依赖 motionOff
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, motionOff]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "星空云绘 · AI 创作平台";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div id="home-top" ref={rootRef} className={`commercial-home home-catalog${isDark ? " is-dark" : ""}`} data-motion={motionOff ? "off" : "on"}>
      <HomeHero />
      <HomeModelMarquee models={models} motionOff={motionOff} />

      <div id="home-directory" className="home-shell home-catalog__content home-directory">
        {catalog.creation.length ? (
          <HomeSection
            id="creation"
            title="AI 创作"
            description="画布、对话、图像与设计"
          >
            <div className="home-creation-layout" data-count={catalog.creation.length}>
              <CoverCard item={catalog.creation[0]} featured />
              {catalog.creation.length > 1 ? (
                <div className="home-creation-support" data-count={catalog.creation.length - 1}>
                  {catalog.creation.slice(1).map((item) => (
                    <CoverCard key={item.id} item={item} />
                  ))}
                </div>
              ) : null}
            </div>
          </HomeSection>
        ) : null}

        {catalog.commerce.length ? (
          <HomeSection
            id="commerce"
            title="AI 电商"
            description="模特、商品与营销视觉"
          >
            <div className="home-card-grid is-three" data-count={catalog.commerce.length}>
              {catalog.commerce.map((item) => (
                <CoverCard key={item.id} item={item} />
              ))}
            </div>
          </HomeSection>
        ) : null}

        {catalog.tools.length ? (
          <HomeSection
            id="tools"
            title="实用工具"
            description="处理、压缩与拼贴"
          >
            <div className="home-compact-grid" data-count={catalog.tools.length} onPointerMove={trackSpotlight}>
              {catalog.tools.map((item) => (
                <CompactCard key={item.id} item={item} />
              ))}
            </div>
          </HomeSection>
        ) : null}
      </div>

      <div className="home-shell home-news">
        <section className="home-upcoming" aria-labelledby="home-upcoming-title">
          <header className="home-section__head">
            <div className="home-section__lead">
              <h2 id="home-upcoming-title">即将上线</h2>
              <p>跨端协同、自动化工作流与生态接入</p>
            </div>
          </header>
          <div className="home-upcoming__items" onPointerMove={trackSpotlight}>{UPCOMING_ITEMS.map((item) => {
            const Icon = item.Icon;
            return (
              <div key={item.id} className="home-upcoming__item" data-tone={item.tone} data-spotlight data-home-item>
                <span className="home-spot-ring" aria-hidden="true" />
                <span className="home-upcoming__ghost" aria-hidden="true"><Icon size={112} strokeWidth={1.1} /></span>
                <div className="home-upcoming__top">
                  <span className="home-upcoming__icon" aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span>
                  {item.badge ? <span className="home-upcoming__badge" data-badge={item.tone}>{item.badge}</span> : null}
                </div>
                <div className="home-upcoming__copy">
                  <span className="home-upcoming__label">{item.label}</span>
                  <span className="home-upcoming__description">{item.tagline}</span>
                </div>
                <small className="home-upcoming__status">
                  <span className="home-upcoming__dot" aria-hidden="true" />
                  敬请期待
                </small>
              </div>
            );
          })}</div>
        </section>
      </div>

      <footer className="home-footer">
        <div ref={ctaRef} className="home-shell home-footer__cta">
          <div className="home-footer__cta-copy">
            <h2>
              以<em>星</em>为墨，以<em>云</em>为纸。落笔生花，绘梦成真。
              <svg className="home-footer__rope" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="home-footer-rope" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#ffd6a5" />
                    <stop offset="1" stopColor="#ff8a5b" />
                  </linearGradient>
                </defs>
                {/* 手绘绳线：从「落笔」下起笔，在逗号处绕一个绳结，落成「绘梦成真」的下划线 */}
                <path pathLength="1" d="M 606 20 C 660 34, 760 36, 836 26 C 880 18, 916 2, 896 -4 C 874 -10, 850 12, 870 30 C 892 48, 980 40, 1040 32 C 1080 28, 1110 30, 1136 22" />
              </svg>
            </h2>
            <p>让想象落地成画，一个平台完成从灵感到成片。</p>
          </div>
          <div className="home-footer__cta-actions">
            {FOOTER_CTA_LINKS.filter(([, to]) => isEntryVisible(to)).map(([label, to, tone]) => (
              <Link key={to} className={`home-footer__cta-link is-${tone}`} to={to} viewTransition>{label}<ArrowUpRight size={16} aria-hidden="true" /></Link>
            ))}
          </div>
        </div>
        <div className="home-shell home-footer__main">
          <div className="home-footer__identity">
            <div className="home-footer__brand"><img src="/brand/starcloud-logo.svg" alt="" width="32" height="32" /><strong>星空云绘</strong></div>
            <p className="home-footer__pitch">创作，不止于想象。</p>
            <a className="home-footer__apps" href="#home-upcoming-title">
              <span><Apple size={14} aria-hidden="true" /><Smartphone size={14} aria-hidden="true" /></span>
              iOS 与安卓客户端即将上线
            </a>
          </div>
          {FOOTER_GROUPS.map(group => {
            const links = group.links.filter(([, to]) => isEntryVisible(to));
            return links.length ? <nav key={group.title} aria-label={group.title}><h2>{group.title}</h2>
              {links.map(([label, to]) => <Link key={to} to={to} viewTransition>{label}<ArrowUpRight size={13} aria-hidden="true" /></Link>)}
            </nav> : null;
          })}
        </div>
        <div className="home-shell home-footer__bottom">
          <span className="home-footer__rule" aria-hidden="true" />
          <span className="home-footer__copyright">© {new Date().getFullYear()} 星空云绘</span>
          <div className="home-footer__legal">
            {FOOTER_LEGAL_LINKS.filter(([, to]) => isEntryVisible(to)).map(([label, to]) => <Link key={to} to={to} viewTransition>{label}</Link>)}
          </div>
          <a className="home-footer__top" href="#home-top">回到顶部<ArrowUp size={13} aria-hidden="true" /></a>
        </div>
        <div ref={pullRef} className="home-pullmark" aria-hidden="true">
          <div className="home-shell">
            <canvas ref={particleCanvasRef} className="home-pullmark__canvas" />
          </div>
        </div>
      </footer>
    </div>
  );
}
