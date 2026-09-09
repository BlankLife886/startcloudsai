import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowUp, ArrowUpRight, AudioLines, Box, Clock3, Coins, FileArchive,
  Gamepad2, Image as ImageIcon, Layers, LayoutGrid, Maximize2, MessageSquareText,
  Paintbrush, PanelsTopLeft, Puzzle, Scissors, Shirt, ShoppingBag,
  Sparkles, Video, WandSparkles, Workflow, Wrench,
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
    tagline: "iOS 客户端，随时继续创作",
    icon: "bi-apple",
  },
  {
    id: "android-app",
    label: "安卓 App",
    tagline: "Android 客户端，同步作品与任务",
    icon: "bi-android2",
  },
  {
    id: "canvas-scheduled-task",
    label: "无限画布定时任务",
    tagline: "按计划自动跑画布工作流",
    icon: "bi-clock",
  },
  {
    id: "mcp",
    label: "MCP",
    tagline: "把能力接到 Agent 工具链",
    icon: "bi-plugin",
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
  { title: "发现更多", links: [["Skill 中心", "/skills"], ["提示词", "/prompts"], ["创作价格", "/pricing"]] },
  { title: "我的空间", links: [["创作历史", "/history"], ["我的订单", "/orders"], ["账户设置", "/account"]] },
];

const COMMERCE_ITEMS = COMMERCE_ENTRY_GROUPS.map((group) => ({
  id: `commerce-${group.id}`,
  to: group.to,
  label: group.label,
  tagline: group.description,
  cover: group.cover,
  feature: "ai.ecommerceDesign",
  taskType: "ecommerce_design",
}));

const LOCAL_TOOL_ITEMS = [
  { id: "skills", to: "/skills", label: "Skill 中心", tagline: "官方创作模板与参数化提示词", icon: "bi-lightning-charge", minPoints: 0 },
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
      {shownBadge ? (
        <em className={`home-card__status ${badgeClass}`}><StatusIcon size={12} strokeWidth={1.75} aria-hidden="true" /><span>{shownBadge}</span></em>
      ) : null}
      {!blocked && price ? <b className="home-card__price" title={price}><Coins size={12} strokeWidth={1.75} aria-hidden="true" /><span>{price}</span></b> : null}
      <span className="home-card__body">
        <span className="home-card__heading">
          <strong title={item.label}>{item.label}</strong>
          {item.to && !blocked ? <span className="home-card__arrow" aria-hidden="true"><ArrowUpRight size={17} strokeWidth={1.75} /></span> : null}
        </span>
        {blocked && item.reason ? <small className="home-card__description" title={item.reason}>{item.reason}</small> : <span className="home-card__description" title={item.tagline}>{item.tagline}</span>}
      </span>
    </>
  );
  if (item.to) {
    return (
      <Link className={className} to={item.to} aria-label={label} data-home-item>
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
    >
      <span className="home-compact__copy">
        <span className="home-compact__heading">
          <span className="home-compact__icon" aria-hidden="true">
            <Icon size={20} strokeWidth={1.6} />
          </span>
          <strong title={item.label}>{item.label}</strong>
          {blocked ? (
            <em className={`home-card__status ${status.className}`}><StatusIcon size={12} strokeWidth={1.75} aria-hidden="true" /><span>{status.label}</span></em>
          ) : price ? (
            <b className="home-card__price" title={price}><Coins size={12} strokeWidth={1.75} aria-hidden="true" /><span>{price}</span></b>
          ) : null}
        </span>
        {description ? <span className="home-compact__description" title={description}>{description}</span> : null}
      </span>
      <ArrowUpRight className="home-compact__arrow" strokeWidth={1.75} aria-hidden="true" />
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
      <HomeHero studioVisible={isEntryVisible("/studio")} />
      <HomeModelMarquee models={models} motionOff={motionOff} />

      <div id="home-directory" className="home-shell home-catalog__content home-directory">
        {catalog.creation.length ? (
          <HomeSection
            id="creation"
            title="AI 创作"
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
          <header><h2 id="home-upcoming-title">即将上线</h2></header>
          <div className="home-upcoming__items">{UPCOMING_ITEMS.map(item => <div key={item.id} data-home-item>
            <i className={`bi ${item.icon}`} aria-hidden="true" /><span>{item.label}</span><small>敬请期待</small>
          </div>)}</div>
        </section>
      </div>

      <footer className="home-footer">
        <div className="home-shell home-footer__main">
          <div className="home-footer__brand"><img src="/brand/starcloud-logo.svg" alt="" width="32" height="32" /><strong>星空云绘</strong></div>
          {FOOTER_GROUPS.map(group => <nav key={group.title} aria-label={group.title}><h2>{group.title}</h2>
            {group.links.filter(([, to]) => isEntryVisible(to)).map(([label, to]) => <Link key={to} to={to}>{label}<ArrowUpRight size={13} aria-hidden="true" /></Link>)}
          </nav>)}
        </div>
        <div className="home-shell home-footer__bottom"><span>创作，不止于想象。</span><a href="#home-top">回到顶部<ArrowUp size={13} aria-hidden="true" /></a></div>
      </footer>
    </div>
  );
}
