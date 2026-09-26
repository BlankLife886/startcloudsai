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
    Icon: Apple,
  },
  {
    id: "android-app",
    label: "安卓 App",
    tagline: "Android 客户端，多端实时同步",
    badge: "内测就绪",
    Icon: Smartphone,
  },
  {
    id: "canvas-scheduled-task",
    label: "画布定时任务",
    tagline: "按计划自动化执行工作流",
    badge: "规划中",
    Icon: Clock3,
  },
  {
    id: "mcp",
    label: "MCP 协议生态",
    tagline: "无缝接入 Agent 与开发工作流",
    badge: "首发支持",
    Icon: Plug,
  },
];

const CREATION_ITEMS = [
  {
    id: "canvas",
    to: "/canvas",
    label: "无限画布",
    tagline: "节点工作流与自由画布创作",
    cover: "/sucai/canvas-hero.webp",
    feature: "ai.infiniteCanvas",
    taskType: "infinite_canvas",
  },
  ...STUDIO_TOOLS.filter((item) => item.id !== "ecommerce")
    .map(item => item.id === "assistant" ? { ...item, feature: "ai.assistant" } : item),
];

const FOOTER_GROUPS = [
  { title: "开始创作", links: [["创作台", "/studio"], ["AI 助手", "/assistant"], ["无限画布", "/canvas"]] },
  { title: "发现更多", links: [["技能库", "/skills"], ["提示词", "/prompts"], ["创作价格", "/pricing"]] },
  { title: "我的空间", links: [["创作历史", "/history"], ["我的订单", "/orders"], ["账户设置", "/account"]] },
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
      to={item.to}
      aria-label={[item.label, blocked ? status.label : price].filter(Boolean).join("，")}
      data-home-item
      viewTransition
    >
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
            <div className="home-compact-grid" data-count={catalog.tools.length}>
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
          <div className="home-upcoming__items">{UPCOMING_ITEMS.map((item) => {
            const Icon = item.Icon;
            return (
              <div key={item.id} className="home-upcoming__item" data-home-item>
                <div className="home-upcoming__top">
                  <span className="home-upcoming__icon" aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span>
                  {item.badge ? (
                    <span
                      className="home-upcoming__badge"
                      data-badge={
                        item.badge === "内测就绪"
                          ? "ready"
                          : item.badge === "规划中"
                          ? "planning"
                          : "first"
                      }
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </div>
                <span className="home-upcoming__label">{item.label}</span>
                <span className="home-upcoming__description">{item.tagline}</span>
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
        <div className="home-shell home-footer__main">
          <div className="home-footer__brand"><img src="/brand/starcloud-logo.svg" alt="" width="32" height="32" /><strong>星空云绘</strong></div>
          {FOOTER_GROUPS.map(group => <nav key={group.title} aria-label={group.title}><h2>{group.title}</h2>
            {group.links.filter(([, to]) => isEntryVisible(to)).map(([label, to]) => <Link key={to} to={to} viewTransition>{label}<ArrowUpRight size={13} aria-hidden="true" /></Link>)}
          </nav>)}
        </div>
        <div className="home-shell home-footer__bottom"><span>创作，不止于想象。</span><a href="#home-top">回到顶部<ArrowUp size={13} aria-hidden="true" /></a></div>
      </footer>
    </div>
  );
}
