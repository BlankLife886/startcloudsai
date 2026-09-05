import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Image as ImageIcon } from "lucide-react";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { COMMERCE_ENTRY_GROUPS, STUDIO_TOOLS } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import { fetchTaskPricing, minPointsForTaskType } from "@react/legacy-modules/services/pricing.js";
import { PAGE_STATUS, pageKeyForHref } from "../config/pageControls.js";
import { useIsDark } from "../hooks/useIsDark.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import "./commercial-home-react.css";

const STATUS_META = {
  [PAGE_STATUS.NORMAL]: { label: "可使用", className: "is-normal" },
  [PAGE_STATUS.MAINTENANCE]: { label: "维护中", className: "is-maintenance" },
  [PAGE_STATUS.DEVELOPING]: { label: "开发中", className: "is-developing" },
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
    id: "payment-subscription",
    label: "支付订阅",
    tagline: "在线购买套餐并自动续费",
    icon: "bi-credit-card-2-front-fill",
  },
  {
    id: "canvas-scheduled-task",
    label: "无限画布定时任务",
    tagline: "按计划自动跑画布工作流",
    icon: "bi-clock",
  },
  {
    id: "skill",
    label: "Skill",
    tagline: "可复用的创作技能包",
    icon: "bi-lightning-charge-fill",
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
  ...STUDIO_TOOLS.filter((item) => item.id !== "ecommerce"),
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

function CoverCard({ item, badge = "" }) {
  const status = STATUS_META[item.status] || STATUS_META[PAGE_STATUS.NORMAL];
  const blocked = !badge && (item.status === PAGE_STATUS.DEVELOPING || item.status === PAGE_STATUS.MAINTENANCE);
  const shownBadge = badge || (blocked ? status.label : "");
  const badgeClass = badge ? "is-developing" : status.className;
  const price = priceLabel(item.minPoints);
  const className = [
    "home-card",
    blocked ? status.className : "",
    item.cover ? "" : "is-icon",
    item.to ? "" : "is-static",
  ]
    .filter(Boolean)
    .join(" ");
  const label = [item.label, shownBadge, price].filter(Boolean).join("，");
  const body = (
    <>
      <span className="home-card__media">
        {item.cover ? (
          <img src={item.cover} alt="" loading="lazy" decoding="async" />
        ) : item.icon ? (
          <i className={`bi ${item.icon}`} aria-hidden="true" />
        ) : (
          <ImageIcon aria-hidden="true" />
        )}
      </span>
      {blocked ? (
        <span className={`home-card__mask ${badgeClass}`} aria-hidden="true">
          <strong>{shownBadge}</strong>
        </span>
      ) : shownBadge ? (
        <em className={`home-card__status ${badgeClass}`}>{shownBadge}</em>
      ) : null}
      {price ? <b className="home-card__price">{price}</b> : null}
      <span className="home-card__body">
        <strong>{item.label}</strong>
        {blocked && item.reason ? <small>{item.reason}</small> : null}
        {item.to && !blocked ? (
          <i>
            进入
            <ArrowRight aria-hidden="true" />
          </i>
        ) : null}
      </span>
    </>
  );
  if (item.to) {
    return (
      <Link className={className} to={item.to} aria-label={label}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} role="group" aria-label={label}>
      {body}
    </div>
  );
}

function CompactCard({ item }) {
  const status = STATUS_META[item.status] || STATUS_META[PAGE_STATUS.NORMAL];
  const blocked = item.status === PAGE_STATUS.DEVELOPING || item.status === PAGE_STATUS.MAINTENANCE;
  const price = priceLabel(item.minPoints);
  return (
    <Link
      className={`home-compact ${blocked ? status.className : ""}`}
      to={item.to}
      aria-label={[item.label, blocked ? status.label : "", price].filter(Boolean).join("，")}
    >
      <span className="home-compact__icon" aria-hidden="true">
        <i className={`bi ${item.icon || "bi-tools"}`} />
      </span>
      <span className="home-compact__copy">
        <strong>{item.label}</strong>
        {item.tagline ? <span>{item.tagline}</span> : null}
      </span>
      {blocked ? (
        <span className={`home-compact__mask ${status.className}`} aria-hidden="true">
          <strong>{status.label}</strong>
        </span>
      ) : price ? (
        <b className="home-card__price">{price}</b>
      ) : null}
    </Link>
  );
}

function HomeSection({ id, title, description, kind, children }) {
  return (
    <section className="home-section" aria-labelledby={`home-${id}-title`}>
      <header className="home-section__head">
        <div className="home-section__lead">
          <h2 id={`home-${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        {kind ? <span className="home-section__kind">{kind}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function CommercialHomeView() {
  const isDark = useIsDark();
  const { controls, controlForKey } = usePageControls();
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
        status: PAGE_STATUS.NORMAL,
        reason: "",
        minPoints:
          takePoints(tool.imageUpscalePricing?.lowPricePoints) ?? takePoints(tool.pricePoints),
      }),
    );
    return {
      creation,
      commerce: COMMERCE_ITEMS.map(enrich).filter(keep),
      tools: [...mediaItems, ...LOCAL_TOOL_ITEMS.map(enrich)].filter(keep),
    };
  }, [controlForKey, controls, pricing, runtimeConfig]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "星空云绘 · AI 创作平台";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className={`commercial-home home-catalog${isDark ? " is-dark" : ""}`}>
      <div className="home-catalog__atmosphere" aria-hidden="true">
        <div className="home-catalog__aurora" />
        <span className="home-catalog__orb is-a" />
        <span className="home-catalog__orb is-b" />
      </div>

      <main className="home-catalog__content">
        <HomeSection
          id="upcoming"
          title="即将上线"
          description="客户端、支付、画布与开放能力"
          kind="预告"
        >
          <div className="home-card-grid is-upcoming">
            {UPCOMING_ITEMS.map((item) => (
              <CoverCard key={item.id} item={item} badge="即将上线" />
            ))}
          </div>
        </HomeSection>

        {catalog.creation.length ? (
          <HomeSection
            id="creation"
            title="AI 创作"
            description="画布、对话、生图和设计"
            kind="创作类"
          >
            <div className="home-card-grid is-dense">
              {catalog.creation.map((item) => (
                <CoverCard key={item.id} item={item} />
              ))}
            </div>
          </HomeSection>
        ) : null}

        {catalog.commerce.length ? (
          <HomeSection
            id="commerce"
            title="AI 电商"
            description="从真人展示到主图和详情页"
            kind="电商类"
          >
            <div className="home-card-grid is-three">
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
            description="抠图、压缩、拼图和媒体处理"
            kind="工具类"
          >
            <div className="home-compact-grid">
              {catalog.tools.map((item) => (
                <CompactCard key={item.id} item={item} />
              ))}
            </div>
          </HomeSection>
        ) : null}
      </main>
    </div>
  );
}
