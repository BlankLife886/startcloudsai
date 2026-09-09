import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import { useGSAP } from "@gsap/react";
import { Popover } from "antd";
import {
  ArrowRight,
  Bot,
  Brush,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Gamepad2,
  Image as ImageIcon,
  LockKeyhole,
  LayoutGrid,
  LoaderCircle,
  MessageSquareText,
  MonitorSmartphone,
  PackageSearch,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  ShieldCheck,
  ShoppingBag,
  Wallet,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";
import gsap from "gsap";
import "@react/legacy-styles/generated/views/PricingView.css";
import "./PricingView.css";
import "./PricingCheckout.css";
import { CustomRecharge } from './CustomRecharge.jsx';
import { rechargeCheckoutPlan } from './rechargeQuote.js';
import { useAuth } from "../auth/AuthContext.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { ModelCatalogIcon, ModelMaintenanceBadge, isCatalogModelMaintenance } from "../components/common/ModelCatalogIcon.jsx";
import { useLocale } from "../i18n/index.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { pricingFaqCategories } from "./pricingFaqs.js";
import { buildPricingFaqs } from './pricingFaqData.js';
import { CheckoutOrderStage, checkoutCountdown, mergePaymentOrder } from "./CheckoutOrderStage.jsx";
import { PaymentMethodSwitch } from "./PaymentMethodSwitch.jsx";
import { SubscriptionUpgradeCheckout } from './SubscriptionUpgradeCheckout.jsx';
import { SubscriptionPurchaseBenefits } from './SubscriptionPurchaseBenefits.jsx';
import { upgradeBlockReason } from './subscriptionUpgrade.js';

gsap.registerPlugin(useGSAP);

const MODEL_KIND_META = {
  image: { label: "生图", icon: ImageIcon, unit: "/ 张" },
  chat: { label: "对话", icon: MessageSquareText, unit: "/ 次" },
  tool: { label: "工具", icon: WandSparkles, unit: "/ 次" },
};

const MODEL_PAGE_META = [
  { id: "assistant", label: "AI 助手", icon: Bot, feature: "ai.assistant", lists: ["imageModels", "textModels"], reasoningScope: "assistant" },
  { id: "t2i", label: "文生图", icon: ImageIcon, feature: "ai.wallpaperGeneration", lists: ["publicModels"] },
  { id: "coloring", label: "插画染色", icon: Brush, feature: "ai.illustrationColoring", lists: ["publicModels"] },
  { id: "ui-design", label: "UI 设计稿", icon: MonitorSmartphone, feature: "ai.uiDesign", lists: ["publicModels", "analysisModels"], reasoningScope: "assistant" },
  { id: "ecommerce", label: "AI 电商", icon: ShoppingBag, feature: "ai.ecommerceDesign", lists: ["publicModels", "analysisModels"], reasoningScope: "assistant" },
  { id: "model-sheet", label: "模型设计", icon: PackageSearch, feature: "ai.ultraModelSheet", lists: ["publicModels"] },
  { id: "game-art", label: "游戏设计", icon: Gamepad2, feature: "ai.gameDesign", lists: ["publicModels"] },
  { id: "canvas", label: "无限画布", icon: Workflow, feature: "ai.infiniteCanvas", lists: ["imageModels", "textModels"], reasoningScope: "canvas_agent" },
  { id: "background-remove", label: "背景移除", icon: Scissors, feature: "ai.imageTools", lists: ["backgroundRemovalModels"] },
  { id: "media-tools", label: "媒体工具", icon: WandSparkles, feature: "ai.mediaTools", lists: ["tools"] },
];

const previewPlans = [
  {
    id: "preview-usage",
    kind: "topup",
    name: "按量创作",
    eyebrow: "额度包",
    priceMode: "unit",
    suffix: "/ 张起",
    features: [
      "全部 AI 创作工作台",
      "提交冻结 · 完成结算",
      "按任务规则结算与释放",
    ],
    preview: true,
  },
  {
    id: "preview-creator",
    kind: "subscription",
    name: "创作者计划",
    eyebrow: "订阅",
    priceMode: "coming",
    suffix: "/ 月",
    features: ["使用范围以套餐权益为准", "每天重置订阅额度", "未用额度不结转"],
    popular: true,
    preview: true,
  },
  {
    id: "preview-pro",
    kind: "subscription",
    name: "专业制作",
    eyebrow: "订阅",
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

function FaqList({ t, faqs }) {
  const [open, setOpen] = useState("buy");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLocaleLowerCase();
  const items = faqs.filter(item =>
    (category === "all" || item.category === category) &&
    (!keyword || [item.question, ...item.paragraphs, item.notice, ...item.facts.flatMap(fact => [fact.label, fact.value]), ...item.purchasedFacts.flatMap(fact => [fact.label, fact.value])].some(value => t(value).toLocaleLowerCase().includes(keyword))),
  );

  return (
    <div className="pp-faq-browser">
      <div className="pp-faq-tools">
        <div className="pp-faq-categories" role="group" aria-label={t("问题分类")}>
          {[["all", "全部问题"], ...pricingFaqCategories].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={category === id} onClick={() => { setCategory(id); setOpen(""); }}>{t(label)}</button>
          ))}
        </div>
        <label className="pp-faq-search">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label={t("搜索购买与计费问题")} placeholder={t("搜索问题或关键词")} value={query} onChange={event => { setQuery(event.target.value); setOpen(""); }} />
        </label>
      </div>
      <p className="pp-faq-count" aria-live="polite" aria-atomic="true">{t("相关问题")} · {items.length}</p>
      {items.length ? <div className="pp-faq" role="list">
      {items.map(item => {
        const index = faqs.indexOf(item);
        const expanded = open === item.id;
        const panelId = `pricing-faq-a-${index}`;
        return (
          <article key={item.id} className={`pp-faq__item${expanded ? " is-open" : ""}`} role="listitem">
            <button
              type="button"
              className="pp-faq__q"
              id={`pricing-faq-q-${index}`}
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? "" : item.id)}
            >
              <span>{t(item.question)}</span>
              <i className="pp-faq__mark" aria-hidden="true"><Plus size={16} /></i>
            </button>
            <div id={panelId} className="pp-faq__a" role="region" aria-labelledby={`pricing-faq-q-${index}`} aria-hidden={!expanded} inert={!expanded}>
              <div><div className="pp-faq__copy">
                {item.paragraphs.map((paragraph, i) => <p key={i}>{t(paragraph)}</p>)}
                {item.notice && <p className="pp-faq__notice">{t(item.notice)}</p>}
                {item.facts.length > 0 && <div className="pp-faq__facts"><strong>{t('当前在售规则')}</strong><dl>{item.facts.map((fact, i) => <div key={i}><dt>{t(fact.label)}</dt><dd>{t(fact.value)}</dd></div>)}</dl></div>}
                {item.purchasedFacts.length > 0 && <div className="pp-faq__facts is-purchased"><strong>{t(item.purchasedTitle)}</strong><dl>{item.purchasedFacts.map((fact, i) => <div key={i}><dt>{t(fact.label)}</dt><dd>{t(fact.value)}</dd></div>)}</dl><p>{t(item.purchasedNote)}</p></div>}
                {item.link ? <Link to={item.link[0]} tabIndex={expanded ? 0 : -1}>{t(item.link[1])}<ArrowRight size={14} aria-hidden="true" /></Link> : null}
              </div></div>
            </div>
          </article>
        );
      })}
      </div> : <div className="pp-faq-no-results"><p>{t("没有找到相关问题")}</p><button type="button" onClick={() => { setQuery(""); setCategory("all"); setOpen("buy"); }}>{t("查看全部问题")}</button><Link to="/feedback">{t("提交问题反馈")}</Link></div>}
    </div>
  );
}

const placeholderText =
  /^(简短说明|暂无描述|description|aaa+|test|todo|placeholder)$/i;

const MODEL_TONES = ["mint", "violet", "amber", "gold", "azure", "rose"];

function modelTone(id) {
  const text = String(id || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return MODEL_TONES[hash % MODEL_TONES.length];
}

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

async function apiPost(path, body = null, signal) {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body == null ? null : JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const error = new Error(payload?.error || "请求失败");
    error.code = payload?.code || "request_failed";
    throw error;
  }
  return payload.data;
}

async function fetchUnsettledOrders(signal) {
  const groups = await Promise.all(["pending", "uncertain", "paid"].map(async (status) => {
    const data = await apiGet(`/orders?status=${status}&limit=100`, signal);
    if (!Array.isArray(data?.items)) throw new Error("订单状态暂时无法读取");
    return data.items;
  }));
  return groups.flat().filter((order) => ["pending", "uncertain", "paid"].includes(order.status));
}

function formatPoints(points, { withUnit = true } = {}) {
  const value = Number(points || 0);
  const text = (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString(
    "zh-CN",
  );
  return withUnit ? `${text} 积分` : text;
}

function PlanMark({ kind }) {
  const src = kind === "subscription" ? "/pricing/hot-chest.png" : "/pricing/topup-bag.png";
  return (
    <span className="pp-plan__mark" aria-hidden="true">
      <img className="pp-plan__cube" src={src} alt="" />
    </span>
  );
}

function formatCents(cents) {
  return `¥${(Number(cents || 0) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function motionDisabled() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.classList.contains("settings-no-animations");
}

function formatPlanAmount(cents) {
  return (Number(cents || 0) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function PlanAmount({ cents, id }) {
  const targetCents = Math.round(Number(cents || 0));
  const amount = formatPlanAmount(targetCents);
  const decimals = amount.includes(".") ? amount.split(".")[1].length : 0;
  const valueRef = useRef(null);

  useGSAP(() => {
    const node = valueRef.current;
    if (!node) return undefined;
    const paint = (value) => {
      node.textContent = (Math.round(value) / 100).toLocaleString("zh-CN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    };
    if (motionDisabled()) {
      node.textContent = amount;
      return undefined;
    }
    const state = { value: 0 };
    paint(0);
    const tween = gsap.to(state, {
      value: targetCents,
      duration: 1.15,
      delay: 0.04,
      ease: "expo.out",
      snap: { value: 1 },
      onUpdate: () => paint(state.value),
      onComplete: () => {
        node.textContent = amount;
      },
    });
    return () => tween.kill();
  }, { dependencies: [id, targetCents, amount, decimals] });

  return (
    <>
      <small>¥</small>
      <span className="pp-plan__price-value" ref={valueRef}>{amount}</span>
    </>
  );
}

function normalizePlans(plans) {
  if (!plans.length) return previewPlans;
  return plans.map((plan) => ({
    ...plan,
    eyebrow: plan.kind === "subscription" ? "订阅" : "额度包",
    description:
      String(plan.description || "").trim().replace(/每\s*24\s*小时/g, '每天') ||
      (plan.kind === "subscription"
        ? "订阅期内每天重置额度，未用积分不结转。"
        : "一次性发放到钱包，可用于全部创作工作台。"),
    features: Array.isArray(plan.features) ? plan.features.map(item => String(item).replace(/每\s*24\s*小时/g, '每天')) : [],
    popular: plan.recommended === true,
    preview: false,
  }));
}

function planFeatures(plan, baseConcurrency = 4) {
  if (plan.preview) return plan.features;
  const configured = Array.isArray(plan.features) ? plan.features : [];
  const cleaned = configured.filter(
    (item) =>
      !/余额\s*[\d.]+\s*元|约\s*\d+\s*张|创作额度|积分入账|发放\s*\d/.test(
        String(item || ""),
      ) && !(plan.kind === 'subscription' && ['每天重置，未用积分不结转', '每日刷新，剩余额度不结转'].includes(String(item || '').trim())),
  );
  const base = cleaned.length
    ? cleaned
    : plan.kind === "subscription"
      ? ["使用范围以套餐权益为准"]
      : ["全平台创作工具通用", "支付成功自动入账", "失败订单不会发放积分"];
  const policy = plan.subscriptionPolicy || {};
  const rights = plan.kind === 'subscription'
    ? [policy.lockModelPrices === false ? '模型按实时价格计费' : policy.allowTopupPriceLock ? '订阅及合格额度包享价格保护' : '订阅积分享价格保护',
      `并发 +${policy.concurrencyBonus > 0 ? policy.concurrencyBonus : 0} 张`]
    : [plan.priceLockEligible ? plan.rechargePolicy ? `单笔满${plan.rechargePolicy.priceLockMinYuan}元可接受订阅锁价` : '有效合格订阅下可享价格保护' : '按实时模型价格消费'];
  return [...new Set([...base, ...rights])];
}


function collectRawModels(runtimeConfig) {
  const out = [];
  const push = (list) => {
    if (Array.isArray(list)) out.push(...list);
  };
  const catalog = runtimeConfig?.aiModelCatalog || {};
  push(catalog.models);
  push(catalog.publicModels);
  push(catalog.featurePublicModels);
  if (Array.isArray(catalog.providers)) {
    for (const provider of catalog.providers) push(provider.models);
  }
  const features = runtimeConfig?.features || {};
  for (const feature of Object.values(features)) {
    const config = feature?.config || {};
    push(config.publicModels);
    push(config.imageModels);
    push(config.textModels);
    push(config.analysisModels);
    push(config.backgroundRemovalModels);
    push(config.tools);
  }
  return out;
}

function inferModelKind(model) {
  const kind = String(model?.kind || "").toLowerCase();
  const tool = String(model?.tool || "").toLowerCase();
  const caps = Array.isArray(model?.capabilities)
    ? model.capabilities.map((item) => String(item).toLowerCase()).join(" ")
    : "";
  const unit = String(model?.pricing?.unit || "").toLowerCase();
  if (
    kind.includes("tool") ||
    tool ||
    caps.includes("background") ||
    caps.includes("image.tool")
  ) {
    return "tool";
  }
  if (
    kind.includes("chat") ||
    kind.includes("text") ||
    unit === "token" ||
    /text\.chat|text\.analysis|image\.understand/.test(caps)
  ) {
    return "chat";
  }
  return "image";
}

function finitePoints(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pricePair({ effective, standard, discount }) {
  const explicitDiscount = finitePoints(discount);
  const standardPoints = finitePoints(standard);
  const effectivePoints = finitePoints(effective) ?? explicitDiscount ?? standardPoints ?? 0;
  const comparePoints = standardPoints ?? effectivePoints;
  return {
    points: effectivePoints,
    standard: comparePoints,
    discount: explicitDiscount,
    hasDiscount: explicitDiscount !== null && explicitDiscount < comparePoints,
  };
}

function baseModelPrice(model) {
  return pricePair({
    effective:
      model.pricePoints ??
      model.creditCost ??
      model.priceCents ??
      model.pricing?.points ??
      model.pricing?.cents,
    standard: model.standardPricePoints ?? model.pricing?.standardPoints,
    discount: model.discountPricePoints ?? model.pricing?.discountPoints,
  });
}

function modelPriceVariants(model, page) {
  const upscale = model?.imageUpscalePricing;
  if (upscale && typeof upscale === "object") {
    return [
      {
        id: "upscale-low",
        label: `≤ ${Number(upscale.thresholdPixels || 2048)}px`,
        ...pricePair({
          effective: upscale.lowPricePoints,
          standard: upscale.lowStandardPricePoints,
          discount: upscale.lowDiscountPricePoints,
        }),
      },
      {
        id: "upscale-high",
        label: `${Number(upscale.thresholdPixels || 2048) + 1}–4096px`,
        ...pricePair({
          effective: upscale.highPricePoints,
          standard: upscale.highStandardPricePoints,
          discount: upscale.highDiscountPricePoints,
        }),
      },
    ];
  }

  const efforts = Array.isArray(model?.reasoningEfforts) ? model.reasoningEfforts : [];
  return efforts.map((effort) => {
    const scoped = model?.reasoningPrices?.[effort.id] || {};
    const canvas = page.reasoningScope === "canvas_agent";
    return {
      id: `reasoning-${effort.id}`,
      label: effort.label || effort.id,
      ...pricePair({
        effective: canvas ? scoped.canvasAgentPricePoints : effort.pricePoints,
        standard: canvas ? scoped.canvasAgentStandardPricePoints : effort.standardPricePoints,
        discount: canvas ? scoped.canvasAgentDiscountPricePoints : effort.discountPricePoints,
      }),
    };
  });
}

function listResolutions(model) {
  if (!Array.isArray(model?.resolutions)) return [];
  const seen = new Set();
  const values = [];
  for (const item of model.resolutions) {
    const raw = String(item || "").trim();
    if (!raw) continue;
    const upper = raw.toUpperCase();
    const value = /^(1|2|4)K$/.test(upper) ? upper : raw;
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  const rank = { "1K": 1, "2K": 2, "4K": 3 };
  return values.sort((left, right) => (rank[left] || 10) - (rank[right] || 10) || left.localeCompare(right));
}

function mergeResolutions(models) {
  const seen = new Set();
  const values = [];
  for (const model of models) {
    for (const item of listResolutions(model)) {
      if (seen.has(item)) continue;
      seen.add(item);
      values.push(item);
    }
  }
  const rank = { "1K": 1, "2K": 2, "4K": 3 };
  return values.sort((left, right) => (rank[left] || 10) - (rank[right] || 10) || left.localeCompare(right));
}

function normalizeModelCard(model, page) {
  const id = String(model?.id || model?.publicModelKey || model?.model || "").trim();
  if (!id) return null;
  const provider = String(model.providerName || model.provider || "").trim();
  const description = String(model.description || "").trim();
  const kind = inferModelKind(model);
  const price = baseModelPrice(model);
  return {
    id,
    pageId: page.id,
    name: String(model.label || model.name || id),
    provider: placeholderText.test(provider) ? "" : provider,
    description: placeholderText.test(description) ? "" : description,
    resolutions: listResolutions(model),
    ...price,
    fastMode: model.fastMode === true,
    isDefault: model.default === true,
    workspacePriceOverridden: model.workspacePriceOverridden === true,
    kind,
    catalogModel: model,
    variants: modelPriceVariants(model, page),
  };
}

function buildModelPageGroups(runtimeConfig) {
  const assigned = new Set();
  const features = runtimeConfig?.features || {};
  const groups = MODEL_PAGE_META.flatMap((page) => {
    const config = features[page.feature]?.config || {};
    const seen = new Set();
    const rawModels = page.lists.flatMap((key) => (Array.isArray(config[key]) ? config[key] : []));
    const models = rawModels
      .map((model) => {
        const card = normalizeModelCard(model, page);
        if (!card || seen.has(card.id)) return null;
        seen.add(card.id);
        assigned.add(card.id);
        return card;
      })
      .filter(Boolean);
    return models.length ? [{ ...page, models }] : [];
  });

  const fallbackPage = { id: "other", label: "其他已上架模型", icon: LayoutGrid };
  const seen = new Set();
  const remaining = collectRawModels(runtimeConfig)
    .map((model) => normalizeModelCard(model, fallbackPage))
    .filter((model) => {
      if (!model || assigned.has(model.id) || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  if (remaining.length) groups.push({ ...fallbackPage, models: remaining });
  return groups;
}

function isUsagePlan(plan) {
  return plan.preview === true && plan.priceMode === "unit";
}

function standaloneModels(runtimeConfig, groups) {
  const canonical = new Map();
  const catalog = runtimeConfig?.aiModelCatalog || {};
  for (const raw of [catalog.publicModels, catalog.models].flatMap(list => Array.isArray(list) ? list : [])) {
    const model = normalizeModelCard(raw, { id: "catalog" });
    if (!model) continue;
    const hasPrice = [raw.pricePoints, raw.creditCost, raw.priceCents, raw.pricing?.points, raw.pricing?.cents,
      raw.standardPricePoints, raw.discountPricePoints, raw.pricing?.standardPoints, raw.pricing?.discountPoints]
      .some(value => finitePoints(value) !== null);
    if (hasPrice && !canonical.has(model.id)) canonical.set(model.id, model);
  }
  const entries = new Map();
  for (const group of groups) {
    for (const model of group.models) {
      if (!entries.has(model.id)) entries.set(model.id, []);
      entries.get(model.id).push(model);
    }
  }
  return [...entries].map(([id, versions]) => {
    const base = canonical.get(id);
    const available = versions.filter(model => !isCatalogModelMaintenance(model.catalogModel));
    const fallback = available[0] || versions[0];
    // Without a catalog price, show the actual scene range, not the first scene's price as a universal rate.
    const rates = available.map(model => model.points);
    const min = rates.length ? Math.min(...rates) : fallback.points;
    const max = rates.length ? Math.max(...rates) : fallback.points;
    const listed = base || fallback;
    const description = [base, fallback, ...versions].map((item) => item?.description).find(Boolean) || "";
    return {
      ...listed,
      description,
      resolutions: mergeResolutions([base, fallback, ...versions]),
      sceneRange: !base && max > min ? [min, max] : null,
    };
  });
}

function PriceAmount({ model, t }) {
  if (isCatalogModelMaintenance(model.catalogModel)) return <span className="pc-price-unavailable">—</span>;
  const meta = MODEL_KIND_META[model.kind];
  const discounted = model.hasDiscount && !model.sceneRange;
  return <span className={`pc-price${discounted ? " has-discount" : ""}`}>
    <strong>{model.sceneRange ? model.sceneRange.map(value => formatPoints(value, { withUnit: false })).join("–") : formatPoints(model.points, { withUnit: false })}</strong>
    <small>{t("积分")}{t(meta.unit)}</small>
    {discounted && <em>{t("折扣")}</em>}
    {discounted && <del>{t("原价")} {formatPoints(model.standard, { withUnit: false })}</del>}
  </span>;
}

function PriceVariants({ model, t }) {
  if (!model.variants.length || isCatalogModelMaintenance(model.catalogModel)) return null;
  return <dl className="pc-variants">{model.variants.map(variant => <div key={variant.id}>
    <dt>{t(variant.label)}</dt><dd>
      {variant.hasDiscount && <del>{formatPoints(variant.standard, { withUnit: false })}</del>}
      {formatPoints(variant.points, { withUnit: false })}<small>{t("积分")}</small>
    </dd>
  </div>)}</dl>;
}

function FloatingPrices({ id, label, title = label, icon: Icon, dark, children, t }) {
  const [mode, setMode] = useState("closed");
  const open = mode !== "closed";
  const triggerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (event.key !== "Escape") return;
      setMode("closed");
      if (document.getElementById(id)?.contains(document.activeElement)) triggerRef.current?.focus();
    };
    const closeOutside = event => {
      if (triggerRef.current?.contains(event.target) || document.getElementById(id)?.contains(event.target)) return;
      setMode("closed");
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [id, open]);
  return <Popover open={open} onOpenChange={visible => setMode(current => current === "pinned" ? current : visible ? "hover" : "closed")} trigger="hover" placement="bottomLeft"
    mouseEnterDelay={0.15} mouseLeaveDelay={0.18} arrow={false}
    classNames={{ root: `pc-popover${dark ? " is-dark" : ""}` }}
    content={<section id={id} className="pc-float" role="dialog" aria-label={`${t(title)}${t("价格明细")}`}>
      <header><span>{Icon && <Icon size={18} aria-hidden="true" />}{t(title)}</span>
        <button type="button" title={t("关闭")} aria-label={t("关闭")} onClick={() => { setMode("closed"); triggerRef.current?.focus(); }}><X size={16} /></button>
      </header><div className="pc-float__body">{children}</div>
    </section>}>
    <button ref={triggerRef} type="button" className="pc-float-trigger" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onClick={() => setMode(current => current === "pinned" ? "closed" : "pinned")}>
      {Icon && <Icon size={16} aria-hidden="true" />}{t(label)}<ChevronDown size={13} aria-hidden="true" />
    </button>
  </Popover>;
}

function ModelPrices({ runtimeConfig, groups, loading, dark, t }) {
  const [kind, setKind] = useState("all");
  const models = useMemo(() => standaloneModels(runtimeConfig, groups), [runtimeConfig, groups]);
  const filtered = models.filter(model => kind === "all" || model.kind === kind);
  return <section id="pricing-models" className="pp-section pc-models" data-section="models" aria-labelledby="models-title">
    <div className="pp-shell">
      <header className="pc-section-heading">
        <h2 id="models-title">{t("模型价格")}</h2>
        <div className="pc-model-controls">
          <div className="pc-model-kinds" role="group" aria-label={t("模型类型")}>
            {["all", ...Object.keys(MODEL_KIND_META)].map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
              {t(value === "all" ? "全部模型" : MODEL_KIND_META[value].label)}
            </button>)}
          </div>
        </div>
      </header>
      {loading ? <div className="pc-model-grid" aria-busy="true" aria-label={t("模型价格加载中")}>
        {[1, 2, 3].map(n => <article key={n} className="pc-model is-loading">
          <div className="pc-model__head" /><p className="pc-model__desc" /><ul className="pc-model__resolutions" /><div className="pc-model__meta" />
        </article>)}
      </div> : filtered.length ? <div className="pc-model-grid">{filtered.map(model => <article key={model.id} className="pc-model" data-model-id={model.id} data-tone={modelTone(model.id)}>
        <div className="pc-model__head">
          <span className="pc-model__mark"><ModelCatalogIcon model={model.catalogModel} size="md" /></span>
          <div className="pc-model__copy">
            <div className="pc-model__title">
              <h3>{model.name}</h3>
              <span className="pc-model__badge">
                {isCatalogModelMaintenance(model.catalogModel) ? <ModelMaintenanceBadge model={model.catalogModel} /> : null}
              </span>
            </div>
          </div>
        </div>
        <p className="pc-model__desc">{model.description ? t(model.description) : "\u00a0"}</p>
        <ul className="pc-model__resolutions" aria-label={model.resolutions.length ? t("支持分辨率") : undefined} aria-hidden={model.resolutions.length ? undefined : "true"}>
          {model.resolutions.map((resolution) => <li key={resolution}>{resolution}</li>)}
        </ul>
        <div className="pc-model__meta">
          <PriceAmount model={model} t={t} />
          <div className="pc-model__detail">
            {!!model.variants.length && !isCatalogModelMaintenance(model.catalogModel) ? (
              <FloatingPrices id={`model-details-${encodeURIComponent(model.id)}`} label="价格明细" title={model.name} dark={dark} t={t}><PriceVariants model={model} t={t} /></FloatingPrices>
            ) : null}
          </div>
        </div>
      </article>)}</div> : <div className="pp-empty"><ImageIcon size={26} aria-hidden="true" /><strong>{t(models.length ? "暂无此类模型" : "暂无已上架模型")}</strong></div>}
    </div>
  </section>;
}

export function PricingView() {
  const { t } = useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageRef = useRef(null);
  const checkoutPanelRef = useRef(null);
  const planKind =
    searchParams.get("plan") === "topup" ? "topup" : "subscription";
  const planSwitchRef = useRef(null);
  const planThumbRef = useRef(null);
  const previousPlanKind = useRef(null);
  useGSAP(() => {
    const thumb = planThumbRef.current;
    if (!thumb) return;
    const position = { xPercent: planKind === "subscription" ? 100 : 0, x: planKind === "subscription" ? 4 : 0 };
    const instant = previousPlanKind.current === null || previousPlanKind.current === planKind
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.documentElement.classList.contains("settings-no-animations");
    gsap.to(thumb, { ...position, duration: instant ? 0 : 0.3, ease: "power3.out", overwrite: true });
    previousPlanKind.current = planKind;
  }, { scope: planSwitchRef, dependencies: [planKind] });
  const [plans, setPlans] = useState([]);
  const [faqCatalog, setFaqCatalog] = useState(null);
  const catalogRequestVersion = useRef(0);
  const [baseConcurrency, setBaseConcurrency] = useState(4);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [pricing, setPricing] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [plansLoadFailed, setPlansLoadFailed] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [checkoutNow, setCheckoutNow] = useState(Date.now());
  const [subscriptionSnapshot, setSubscriptionSnapshot] = useState(null);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const currentSubscription = user?.id && subscriptionSnapshot?.userId === user.id ? subscriptionSnapshot.summary : null;
  const subscriptionLoading = Boolean(user?.id && subscriptionSnapshot?.userId !== user.id);
  const upgradeFrom = searchParams.get('upgradeFrom') || '';
  const upgradeSource = user?.id && subscriptionSnapshot?.userId === user.id ? subscriptionSnapshot.items?.find(item => upgradeFrom ? item.id === upgradeFrom : item.id === currentSubscription?.id) : null;
  const upgradeChanges = user?.id && subscriptionSnapshot?.userId === user.id ? subscriptionSnapshot.changes || [] : [];
  const accountConcurrency = user?.id && subscriptionSnapshot?.userId === user.id ? subscriptionSnapshot.concurrency : null;
  const faqs = useMemo(() => buildPricingFaqs({
    catalog: faqCatalog,
    status: plansLoading ? 'loading' : plansLoadFailed ? 'error' : 'ready',
    subscription: upgradeSource,
    accountConcurrency,
  }), [faqCatalog, plansLoading, plansLoadFailed, upgradeSource, accountConcurrency]);
  const [upgradeBusy, setUpgradeBusy] = useState('');
  const [upgradeError, setUpgradeError] = useState('');
  const upgradeRequest = useRef(null);
  const checkoutRequest = useRef(null);
  const upgradeQuoteId = searchParams.get("upgrade") || "";
  const [orderSnapshot, setOrderSnapshot] = useState({ userId: null, items: [] });
  const orderRevisionRef = useRef(0);
  const unsettledOrders = orderSnapshot.userId === user?.id ? orderSnapshot.items : [];
  const unpaidOrderCount = unsettledOrders.filter((order) => order.status === "pending").length;
  const hasPaymentCountdown = unsettledOrders.some((order) => order.status === "pending" && order.expiresAt)
    || Boolean(checkout?.order?.status === "pending" && checkout.order.expiresAt);
  const [dark, setDark] = useState(
    () =>
      document.documentElement.classList.contains("color-scheme-dark") ||
      localStorage.getItem("walleven-color-scheme") === "dark",
  );

  const refreshPlanCatalog = useCallback(async (signal) => {
    const version = ++catalogRequestVersion.current;
    try {
      const catalog = await apiGet('/plans', signal);
      if (!Array.isArray(catalog?.items)) throw new Error('套餐配置读取失败');
      if (!signal.aborted && version === catalogRequestVersion.current) {
        setFaqCatalog(catalog);
        setPlans(catalog.items);
        setPaymentEnabled(catalog.paymentEnabled === true);
        setBaseConcurrency(Number(catalog.baseConcurrency) || 4);
        setPaymentMethods(Array.isArray(catalog.paymentMethods) ? catalog.paymentMethods.filter(method => ['alipay', 'wechat'].includes(method)) : []);
        setPlansLoadFailed(false);
      }
      return catalog;
    } catch (error) {
      if (!signal.aborted && version === catalogRequestVersion.current) {
        setFaqCatalog(null);
        setPlansLoadFailed(true);
      }
      throw error;
    } finally {
      if (!signal.aborted && version === catalogRequestVersion.current) setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { if (!document.hidden) refreshPlanCatalog(controller.signal).catch(() => {}); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshPlanCatalog]);

  useEffect(() => {
    setCheckout(null);
    setUpgradeBusy('');
    setUpgradeError('');
    return () => { upgradeRequest.current?.abort(); upgradeRequest.current = null; checkoutRequest.current?.abort(); checkoutRequest.current = null; };
  }, [user?.id]);

  useEffect(() => {
    setSubscriptionSnapshot(null);
    if (!user?.id) return undefined;
    const controller = new AbortController();
    let sequence = 0;
    const refresh = async () => {
      const own = ++sequence;
      try {
        const [summary, detail] = await Promise.all([apiGet('/me/subscription',controller.signal),apiGet('/me/subscriptions',controller.signal)]);
        if (!controller.signal.aborted && own === sequence) setSubscriptionSnapshot({userId:user.id,summary,items:detail.items || [],changes:detail.changes || [],concurrency:detail.concurrency});
      } catch {
        if (!controller.signal.aborted && own === sequence) setSubscriptionSnapshot({userId:user.id,error:'订阅状态读取失败，请重试'});
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("starclouds:wallet-updated", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("starclouds:wallet-updated", refresh); };
  }, [user?.id, subscriptionVersion]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const revision = orderRevisionRef.current;
      try {
        const items = await fetchUnsettledOrders(controller.signal);
        // A list started before payment/cancellation must not restore stale orders.
        if (!controller.signal.aborted && revision === orderRevisionRef.current) {
          setOrderSnapshot({ userId: user.id, items });
        }
      } catch { /* Keep the last known order; checkout performs a fresh blocking check. */ }
      finally { inFlight = false; }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user?.id, subscriptionVersion]);

  useEffect(() => {
    if (!checkout?.checking || !user?.id) return undefined;
    const controller = new AbortController();
    const planId = checkout.plan.id;
    const checkOrders = async () => {
      try {
        const items = await fetchUnsettledOrders(controller.signal);
        if (controller.signal.aborted) return;
        const blockedOrder = items.find((order) => order.subscriptionChangeId || order.planId !== planId || (checkout.plan.rechargeAmountYuan != null && order.amountCents !== checkout.plan.priceCents));
        const existing = items.find((order) => !order.subscriptionChangeId && order.planId === planId);
        let order = null;
        if (!blockedOrder && existing) {
          const current = await apiGet(`/orders/${encodeURIComponent(existing.id)}`, controller.signal);
          if (!current?.id || current.id !== existing.id) throw new Error("订单状态暂时无法读取");
          order = mergePaymentOrder(existing, current);
        }
        if (controller.signal.aborted) return;
        orderRevisionRef.current++;
        setOrderSnapshot({ userId: user.id, items });
        if (order) rememberOrder(order);
        let latestPlan = null;
        if (!order && !blockedOrder && checkout.plan.kind === 'subscription') {
          const catalog = await refreshPlanCatalog(controller.signal);
          latestPlan = catalog.items?.find(plan => plan.id === planId && plan.kind === 'subscription');
          if (!latestPlan) throw new Error('订阅方案不可用');
        }
        if (controller.signal.aborted) return;
        setCheckoutNow(Date.now());
        setCheckout((value) => value?.checking && value.plan.id === planId
          ? { ...value, checking: false, blockedOrder, checkFailed: false, order,
            plan: order ? { ...value.plan, name: order.planName || value.plan.name, priceCents: order.amountCents, grantCents: order.grantCents, bonusCents: order.bonusCents } : latestPlan || value.plan,
            subscriptionAccepted: false,
            method: order?.paymentMethod || value.method, error: order?.syncError || "" } : value);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCheckout((value) => value?.checking && value.plan.id === planId
          ? { ...value, checking: false, checkFailed: true, error: checkout.plan.kind === 'subscription' ? '暂时无法确认订单或订阅权益，请重新检查' : "暂时无法确认是否有未支付订单，请重试" } : value);
      }
    };
    checkOrders();
    return () => controller.abort();
  }, [checkout?.checking, checkout?.plan?.id, checkout?.plan?.rechargeAmountYuan, user?.id, refreshPlanCatalog]);

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

  useEffect(() => {
    if (!checkout) return undefined;
    const onKeydown = (event) => {
      if (event.key !== "Tab") return;
      const panel = checkoutPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [Boolean(checkout)]);

  useEffect(() => {
    if (!hasPaymentCountdown) return undefined;
    setCheckoutNow(Date.now());
    const timer = window.setInterval(() => setCheckoutNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasPaymentCountdown]);

  useEffect(() => {
    const order = checkout?.order;
    if (!order?.id || !["pending", "uncertain", "paid"].includes(order.status)) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let timer = null;
    const poll = async () => {
      try {
        const current = await apiGet(`/orders/${encodeURIComponent(order.id)}`, controller.signal);
        if (stopped) return;
        rememberOrder(mergePaymentOrder(order, current));
        if (current?.status === "completed") {
          const nextWallet = await apiGet("/me/wallet", controller.signal).catch(() => null);
          if (stopped) return;
          if (nextWallet) {
            window.dispatchEvent(
              new CustomEvent("starclouds:wallet-updated", { detail: nextWallet }),
            );
          }
          setCheckout((value) =>
			value?.order?.id === order.id
				? { ...value, order: mergePaymentOrder(value.order, current), error: "" }
              : value,
          );
          return;
        }
        setCheckout((value) =>
		value?.order?.id === order.id
			? { ...value, order: mergePaymentOrder(value.order, current), error: "" }
            : value,
        );
        if (["cancelled", "expired", "failed"].includes(current?.status)) return;
      } catch (error) {
        if (error?.name === "AbortError" || stopped) return;
        setCheckout((value) =>
          value?.order?.id === order.id
            ? { ...value, error: "支付状态确认失败，正在重试" }
            : value,
        );
      }
      if (!stopped) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [checkout?.order?.id, checkout?.order?.status]);

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
          gsap.from(".pp-hero__copy", {
            y: 12,
            autoAlpha: 0,
            duration: 0.4,
            clearProps: "transform,opacity,visibility",
          });
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
      apiGet("/pricing", controller.signal),
      fetchRuntimeConfig(),
    ]).then(
      ([pricingResult, runtimeResult]) => {
        if (controller.signal.aborted) return;
        if (pricingResult.status === "fulfilled")
          setPricing(pricingResult.value || null);
        if (runtimeResult.status === "fulfilled")
          setRuntimeConfig(runtimeResult.value || null);
        setModelsLoading(false);
      },
    );
    return () => controller.abort();
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

  const modelPageGroups = useMemo(() => buildModelPageGroups(runtimeConfig), [runtimeConfig]);

  const displayPlans = useMemo(() => normalizePlans(plans), [plans]);
  const packPlans = useMemo(
    () => displayPlans.filter((plan) => plan.kind !== "subscription"),
    [displayPlans],
  );
  const subscriptionPlans = useMemo(
    () => displayPlans.filter((plan) => plan.kind === "subscription"),
    [displayPlans],
  );
  const visiblePlans = planKind === "subscription" ? subscriptionPlans : packPlans;

  useGSAP(
    () => {
      if (
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("settings-no-animations")
      ) {
        return undefined;
      }
      const cards = pageRef.current?.querySelectorAll(".pp-plan:not(.is-loading)");
      if (!cards?.length) return undefined;
      gsap.from(cards, {
        y: 16,
        autoAlpha: 0,
        duration: 0.4,
        stagger: 0.06,
        ease: "power2.out",
        clearProps: "transform,opacity,visibility",
      });
      return undefined;
    },
    { scope: pageRef, dependencies: [planKind, plansLoading, visiblePlans.length] },
  );

  function rememberOrder(order) {
    if (!order?.id) return;
    orderRevisionRef.current++;
    setOrderSnapshot((value) => {
      const items = value.userId === user?.id ? value.items.filter((item) => item.id !== order.id) : [];
      if (["pending", "uncertain", "paid"].includes(order.status)) items.unshift(order);
      return { userId: user?.id, items };
    });
  }

  function resumeUnpaidOrder() {
    const order = unsettledOrders.find((item) => item.status === "pending") || unsettledOrders[0];
    if (!order) return;
    if (order.subscriptionChangeId) {
      const next = new URLSearchParams(searchParams);
      next.set('upgrade',order.subscriptionChangeId);
      setSearchParams(next);
      return;
    }
    startCheckout({
      ...displayPlans.find(plan => plan.id === order.planId),
      id: order.planId,
      name: order.planName || "套餐订单",
      kind: order.planKind,
      priceCents: order.amountCents,
      grantCents: order.grantCents,
      bonusCents: order.bonusCents,
      dailyGrantCents: order.dailyGrantCents,
      durationDays: order.durationDays,
      rechargePolicy: order.rechargePolicy,
      rechargeAmountYuan: order.rechargePolicy ? order.amountCents / 100 : undefined,
      maxRechargeYuan: order.rechargePolicy ? Math.min(100000, Math.floor(1000000000 / order.rechargePolicy.pointsPerYuan)) : undefined,
      revision: order.planRevision,
    });
  }

  async function startUpgrade(plan) {
    if (upgradeRequest.current || !upgradeSource || upgradeBlockReason(upgradeSource,plan,upgradeChanges)) return;
    setUpgradeError('');
    if (unsettledOrders.length) { setUpgradeError('已有未完成订单，请先支付或取消原订单后再升级。'); return; }
    const controller = new AbortController();
    upgradeRequest.current = controller;
    setUpgradeBusy(plan.id);
    try {
      const existing = await fetchUnsettledOrders(controller.signal);
      if (controller.signal.aborted) return;
      if (existing.length) {
        orderRevisionRef.current++;
        setOrderSnapshot({userId:user.id,items:existing});
        setUpgradeError('已有未完成订单，请先支付或取消原订单后再升级。');
        return;
      }
      const quote = await apiPost(`/me/subscriptions/${encodeURIComponent(upgradeSource.id)}/upgrade-quote`,{planId:plan.id},controller.signal);
      if (controller.signal.aborted) return;
      const next = new URLSearchParams(searchParams);
      next.set('plan','subscription'); next.set('upgradeFrom',upgradeSource.id); next.set('upgrade',quote.id);
      setSearchParams(next);
    } catch (error) {
      if (!controller.signal.aborted) setUpgradeError(error.message);
    } finally {
      if (upgradeRequest.current === controller) { upgradeRequest.current = null; setUpgradeBusy(''); }
    }
  }

  function closeUpgradePayment() {
    const next = new URLSearchParams(searchParams);
    next.delete('upgrade');
    setSearchParams(next,{replace:true});
    setSubscriptionVersion(value => value + 1);
  }

  function startCheckout(plan) {
    if (!user) {
      navigate("/auth");
      return;
    }
    setCheckout({
      plan: rechargeCheckoutPlan(plan, plan.rechargeAmountYuan ?? '1'),
      method: paymentMethods[0] || "alipay",
      order: null,
      checking: true,
      loading: false,
      subscriptionAccepted: false,
      error: "",
		cancelConfirm: false,
		cancelled: false,
    });
  }
  async function createPaymentOrder(method) {
    if (!checkout?.plan?.id || checkout.loading || checkout.checking || checkout.checkFailed || checkout.blockedOrder || checkoutRequest.current) return;
    if (checkout.plan.rechargePolicy && checkout.plan.rechargeAmountYuan == null) return;
    if (checkout.plan.kind === 'subscription' && !checkout.subscriptionAccepted) return;
    const controller = new AbortController();
    const planId = checkout.plan.id;
    checkoutRequest.current = controller;
    setCheckout((value) => ({ ...value, method, loading: true, error: "", errorCode: "" }));
    try {
      const order = await apiPost("/orders", {
        planId: checkout.plan.id,
        paymentMethod: method,
        ...(checkout.plan.rechargePolicy ? { amountYuan: checkout.plan.rechargeAmountYuan, expectedPlanRevision: checkout.plan.revision } : {}),
        ...(checkout.plan.kind === 'subscription' ? { expectedPlanRevision: checkout.plan.revision } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;
      rememberOrder(order);
      setCheckoutNow(Date.now());
		setCheckout((value) => value?.plan?.id === planId ? ({
			...value,
			method: order.paymentMethod || method,
			order,
			loading: false,
			plan: { ...value.plan, name: order.planName || value.plan.name, priceCents: order.amountCents, grantCents: order.grantCents, bonusCents: order.bonusCents },
			error: "",
			cancelConfirm: false,
			cancelled: false,
		}) : value);
    } catch (error) {
      if (controller.signal.aborted) return;
      setCheckout((value) => value?.plan?.id === planId ? ({
        ...value,
        loading: false,
        error: error?.message || "订单创建失败，请稍后重试",
        errorCode: error?.code || "",
        subscriptionAccepted: error?.code === 'plan_changed' ? false : value?.subscriptionAccepted,
      }) : value);
    } finally {
      if (checkoutRequest.current === controller) checkoutRequest.current = null;
    }
  }
  async function cancelPaymentOrder() {
    const order = checkout?.order;
    if (!order?.id || checkout.loading) {
      setCheckout(null);
      return;
    }
		setCheckout((value) => ({ ...value, loading: true, error: "" }));
		try {
			const current = await apiPost(`/orders/${encodeURIComponent(order.id)}/close`);
      rememberOrder(mergePaymentOrder(order, current));
			setCheckout((value) => value?.order?.id === order.id ? {
				...value,
				order: mergePaymentOrder(value.order, current),
				loading: false,
				error: "",
				cancelConfirm: false,
				cancelled: current?.status === "cancelled",
			} : value);
    } catch (error) {
      setCheckout((value) => ({
        ...value,
        loading: false,
				error: error?.message || "订单关闭失败，请稍后重试",
				cancelConfirm: false,
      }));
    }
  }
  function setPlanKind(nextKind) {
    const next = new URLSearchParams(searchParams);
    next.set("plan", nextKind);
    setSearchParams(next, { replace: true });
  }
  function planLocked(plan) {
    return !isUsagePlan(plan) && !paymentEnabled;
  }
  function planPrice(plan) {
    if (plan.priceMode === "unit") {
      const mins = taskPriceCards
        .map((card) => card.minPoints)
        .filter((value) => value !== null && value > 0);
      return mins.length ? `${formatPoints(Math.min(...mins))}起` : "按量计费";
    }
    if (plan.priceMode === "coming") return "待开放";
    return formatCents(plan.priceCents);
  }
  function planSuffix(plan) {
    if (plan.rechargePolicy) return '起';
    if (plan.kind === "topup") return "";
    if (plan.priceMode === "coming") return "支付接入后开放";
    if (plan.suffix) return plan.suffix;
    if (plan.kind === "subscription")
      return Number(plan.durationDays || 0) > 0
        ? `/ ${plan.durationDays} 天`
        : "/ 订阅期";
    return "";
  }
  function quotaLine(plan) {
    if (plan.preview) return "";
    if (plan.kind === "subscription")
      return Number(plan.dailyGrantCents || 0) > 0
        ? `每天重置为 ${formatPoints(plan.dailyGrantCents)}`
        : "";
    const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0);
    return total > 0 ? `共入账 ${formatPoints(total)}` : "";
  }
  return (
    <main ref={pageRef} className={`pp pp-pricing${dark ? " is-dark" : ""}`}>
      <section className="pp-hero">
        <div className="pp-shell pp-hero__grid">
          <div className="pp-hero__copy">
            <h1>{t("选择适合你的")}<span>{t("创作方案")}</span></h1>
            <p className="pp-hero__subtitle">{t("按需选择额度包或订阅方案，让创作预算更清晰。")}</p>
          </div>
        </div>
      </section>

      <section
        id="pricing-plans"
        className="pp-section pc-plans"
        data-section="plans"
        aria-labelledby="plans-title"
      >
        <div className="pp-shell">
          <header className={`pp-head pc-plans__heading${unpaidOrderCount ? " has-pending-order" : ""}`}>
            <h2 id="plans-title" className="visually-hidden">{t("套餐方案")}</h2>
            <div ref={planSwitchRef} className="pp-plan-tabs" data-plan-value={planKind} role="group" aria-label={t("套餐类型")} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "topup" : event.key === "End" ? "subscription" : planKind === "topup" ? "subscription" : "topup";
              setPlanKind(next);
              event.currentTarget.querySelector(`[data-plan-kind="${next}"]`)?.focus();
            }}>
              <span ref={planThumbRef} className="pp-plan-thumb" aria-hidden="true" />
              <button
                type="button"
                data-plan-kind="topup"
                tabIndex={planKind === "topup" ? 0 : -1}
                aria-pressed={planKind === "topup"}
                className={planKind === "topup" ? "is-active" : ""}
                onClick={() => setPlanKind("topup")}
              >
                {t("额度包")}
              </button>
              <button
                type="button"
                data-plan-kind="subscription"
                tabIndex={planKind === "subscription" ? 0 : -1}
                aria-pressed={planKind === "subscription"}
                className={planKind === "subscription" ? "is-active" : ""}
                onClick={() => setPlanKind("subscription")}
              >
                {t("订阅")}
              </button>
            </div>
            {unpaidOrderCount > 0 && <p className="pc-plans__pending-hint" role="status">
              <Clock3 size={13} aria-hidden="true" />
              <span>{t(`你有 ${unpaidOrderCount} 笔未支付订单`)}</span>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={resumeUnpaidOrder}>{t("去支付")}</button>
            </p>}
          </header>
          {planKind === 'subscription' && (upgradeSource || upgradeFrom || subscriptionSnapshot?.error || upgradeError) && <div className="pp-upgrade-context" role="status">
            <div><strong>{upgradeSource ? `当前订阅：${upgradeSource.planName}` : subscriptionLoading ? '正在读取订阅' : upgradeFrom ? '该订阅暂不可升级' : '订阅状态暂不可用'}</strong>
              <span>{upgradeError || subscriptionSnapshot?.error || (upgradeSource ? `每天 ${formatPoints(upgradeSource.dailyPoints)} · 新套餐按完整周期置换，补差价以结算报价为准` : '请返回我的订阅确认最新状态')}</span></div>
            {subscriptionSnapshot?.error ? <button type="button" onClick={() => setSubscriptionVersion(value => value + 1)}>重新读取</button> : <Link to="/subscriptions">我的订阅<ArrowRight size={15} /></Link>}
          </div>}
          {plansLoading ? (
            <div className="pp-plan-grid" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <article key={n} className="pp-plan is-loading" />
              ))}
            </div>
          ) : visiblePlans.length ? (
            <div className="pp-plan-grid" data-count={visiblePlans.length}>
              {visiblePlans.map((plan) => {
                const quota = plan.preview ? null : plan.kind === "subscription"
                  ? Number(plan.dailyGrantCents || 0)
                  : plan.rechargePolicy ? Number(plan.rechargePolicy.pointsPerYuan) : Number(plan.grantCents || 0) + Number(plan.bonusCents || 0);
                const existingOrder = unsettledOrders.find((order) => !order.subscriptionChangeId && order.planId === plan.id);
                const countdown = existingOrder?.status === "pending" ? checkoutCountdown(existingOrder.expiresAt, checkoutNow) : null;
                const locked = planLocked(plan) && !existingOrder;
                const subscriptionBlocked = plan.kind === "subscription" && (currentSubscription?.active || currentSubscription?.blockingPurchase || Boolean(user?.id && upgradeFrom)) && !existingOrder;
                const upgradeReason = upgradeSource ? upgradeBlockReason(upgradeSource,plan,upgradeChanges) : '当前订阅不可升级';
                const upgradeAvailable = subscriptionBlocked && !upgradeReason;
                const subscriptionUnavailable = plan.kind === 'subscription' && Boolean(user?.id) && (subscriptionLoading || Boolean(subscriptionSnapshot?.error) || Boolean(upgradeFrom && (!upgradeSource || upgradeSource.status !== 'active' || !upgradeSource.canChange)));
                const isCurrentPlan = subscriptionBlocked && currentSubscription?.planId === plan.id;
                return (
                  <article
                    key={plan.id}
                    className={`pp-plan${plan.popular ? " is-popular" : ""}${locked ? " is-locked" : ""}`}
                  >
                    {plan.popular && (
                      <div className="pp-plan__ribbon" title={t(plan.badge || "推荐方案")}>
                        <span className="pp-plan__ribbon-flag">
                          <em aria-hidden="true">🔥</em>
                          <b>{String(t(plan.badge || "推荐方案")).replace(/\s*\/\s*/g, " / ")}</b>
                        </span>
                      </div>
                    )}
                    <div className="pp-plan__top">
                      <PlanMark kind={plan.kind} />
                      <div className="pp-plan__heading">
                        <h3>{t(plan.name)}</h3>
                      </div>
                    </div>
                    <div className="pp-plan__purchase">
                      <div className="pp-plan__price">
                        <strong aria-label={plan.preview ? undefined : `¥${formatPlanAmount(plan.priceCents)}`}>
                          {!plan.preview ? <PlanAmount cents={plan.priceCents} id={plan.id} /> : t(planPrice(plan))}
                        </strong>
                        {planSuffix(plan) ? <span className={plan.kind === 'subscription' ? 'pp-plan__period' : undefined}>{t(planSuffix(plan))}</span> : null}
                      </div>
                      <button
                        type="button"
                        disabled={locked || subscriptionUnavailable || Boolean(upgradeBusy) || (subscriptionBlocked && !upgradeAvailable)}
                        className={existingOrder ? "is-unsettled" : undefined}
                        onClick={() => existingOrder ? resumeUnpaidOrder() : upgradeAvailable ? startUpgrade(plan) : subscriptionBlocked ? navigate("/subscriptions") : isUsagePlan(plan) ? navigate("/text-to-image") : startCheckout(plan)}
                      >
                        {locked && <LockKeyhole size={14} aria-hidden="true" />}
                        {existingOrder ? <>
                          <span>{t(existingOrder.status === "pending" ? countdown?.expired ? "支付待确认" : "去支付" : existingOrder.status === "uncertain" ? "订单待核实" : "到账确认中")}</span>
                          {countdown?.label && !countdown.expired && <span className="pp-plan__countdown" aria-label={t(`剩余支付时间 ${countdown.label}`)}>
                            <Clock3 size={13} aria-hidden="true" /><span>{countdown.label}</span>
                          </span>}
                        </> : subscriptionLoading && plan.kind === 'subscription' ? t('读取订阅中') : isCurrentPlan ? t('当前订阅') : subscriptionUnavailable ? t(subscriptionBlocked ? '暂不支持升级' : '订阅状态待确认') : upgradeBusy === plan.id ? t('计算差价中') : subscriptionBlocked ? t(upgradeAvailable ? '升级至此方案' : '暂不支持升级') : locked ? t("暂不可用") : isUsagePlan(plan) ? t("开始创作") : t(plan.rechargePolicy ? '自定义金额' : "选择此方案")}
                        {!locked && !existingOrder && !subscriptionUnavailable && (!subscriptionBlocked || upgradeAvailable) && (
                          <span className="pp-plan__go" aria-hidden="true">
                            <ArrowRight size={16} />
                          </span>
                        )}
                      </button>
                    </div>
                    <div className="pp-plan__benefits">
                      <h4 className="visually-hidden">{t("方案权益")}</h4>
                      <div className="pp-plan__quota">
                        <div>
                          <strong>{quota === null ? "—" : formatPoints(quota, { withUnit: false })}</strong>
                          <span className="pp-plan__quota-unit">{t("积分")}{plan.kind === "subscription" ? ` / ${t("天")}` : plan.rechargePolicy ? ` / ${t('元')}` : ""}</span>
                        </div>
                        <small>{!plan.preview && t(plan.kind === "subscription" ? "自开通时起每24小时重置" : plan.rechargePolicy ? '整数金额，1元起充' : "一次性入账")}</small>
                      </div>
                      <ul>{planFeatures(plan, baseConcurrency).map(feature => <li key={feature}><Check size={15} aria-hidden="true" /><span>{t(feature)}</span></li>)}</ul>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="pp-empty">
              <i className="bi bi-box" aria-hidden="true" />
              <strong>
                {planKind === "subscription" ? t("暂无订阅方案") : t("暂无额度包")}
              </strong>
              <p>{t("可先用兑换码或体验资格获取积分。")}</p>
            </div>
          )}
          {plansLoadFailed && (
            <p className="pp-note">{t("套餐暂时不可用，已显示预览方案。")}</p>
          )}
        </div>
      </section>

      <ModelPrices runtimeConfig={runtimeConfig} groups={modelPageGroups} loading={modelsLoading} dark={dark} t={t} />

      <section
        id="pricing-faq"
        className="pp-section"
        data-section="faq"
        aria-labelledby="faq-title"
      >
        <div className="pp-shell pp-faq-layout">
          <h2 id="faq-title">{t("常见问题")}</h2>
          <FaqList t={t} faqs={faqs} />
        </div>
      </section>

      <DialogMotion
        open={Boolean(checkout)}
        layerClassName={`pp pp-pricing pp-checkout-backdrop${dark ? " is-dark" : ""}`}
        panelClassName={`pp-checkout${checkout?.plan?.kind === 'subscription' && !checkout.checking && !checkout.checkFailed && !checkout.blockedOrder && !checkout.order ? ' pp-subscription-purchase' : ''}`}
        panelRef={checkoutPanelRef}
        variant="checkout"
        ariaLabelledby="pp-checkout-title"
        closeOnBackdrop={false}
        closeDisabled={checkout?.loading === true}
        onClose={() => setCheckout(null)}
      >
        {checkout && <>
            <header className="pp-checkout__head">
              <div>
                <h2 id="pp-checkout-title">
                  <Wallet size={22} aria-hidden="true" />
                  {t(checkout.blockedOrder ? "请先处理现有订单" : checkout.plan.name)}
                </h2>
              </div>
              <button
                type="button"
                className="pp-icon-button"
                aria-label={t("关闭")}
                title={t("关闭")}
                disabled={checkout.loading}
                onClick={() => setCheckout(null)}
              >
                <X size={18} />
              </button>
            </header>

            {checkout.checking ? (
              <div className="pp-checkout__confirming" role="status" aria-live="polite">
                <LoaderCircle className="is-spinning" size={30} aria-hidden="true" />
                <strong>{t("正在检查未支付订单")}</strong>
              </div>
            ) : checkout.checkFailed ? (
              <div className="pp-checkout__confirming">
                <p className="pp-checkout__error" role="alert">{t(checkout.error)}</p>
                <button type="button" className="pp-checkout__submit" onClick={() => startCheckout(checkout.plan)}>
                  <RefreshCw size={17} aria-hidden="true" />{t("重新检查")}
                </button>
              </div>
            ) : checkout.blockedOrder ? (
              <div className="pp-checkout__confirming" role="alert">
                <Clock3 size={30} aria-hidden="true" />
                <strong>{t(checkout.blockedOrder.status === "pending" ? "你有一笔未支付订单" : checkout.blockedOrder.status === "uncertain" ? "你有一笔支付结果待核实的订单" : "你有一笔正在确认到账的订单")}</strong>
                <span>{t(checkout.blockedOrder.planName || "套餐订单")} · {formatCents(checkout.blockedOrder.amountCents)}</span>
                <span>{t(checkout.blockedOrder.status === "pending" ? "请先完成支付或取消该订单，再选择其他套餐。" : "请等待该订单处理完成，再选择其他套餐，请勿重复支付。")}</span>
                <Link className="pp-checkout__submit" to="/orders" onClick={() => setCheckout(null)}>
                  {t("查看我的订单")}<ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
            ) : checkout.order ? (
              <CheckoutOrderStage
                checkout={checkout}
                now={checkoutNow}
                quotaText={t(quotaLine(checkout.plan))}
                onClose={() => setCheckout(null)}
                onCancel={cancelPaymentOrder}
                onRequestCancel={() => setCheckout((value) => ({ ...value, cancelConfirm: true, error: "" }))}
                onKeepPaying={() => setCheckout((value) => ({ ...value, cancelConfirm: false }))}
                onRetry={() =>
                  checkout.order?.subscriptionChangeId ? navigate("/subscriptions") : startCheckout(checkout.plan)
                }
                t={t}
              />
            ) : (
              <div className={`pp-checkout__body${checkout.plan.rechargePolicy ? ' pp-custom-recharge' : ''}`}>
                <div className="pp-checkout__hero" data-dialog-motion-item>
                  <div className="pp-checkout__summary">
                    <strong>{checkout.plan.rechargePolicy && checkout.plan.rechargeAmountYuan == null ? '--' : t(formatCents(checkout.plan.priceCents))}</strong>
                    {quotaLine(checkout.plan) && (
                      <span className="pp-checkout__quota">
                        <Coins size={16} aria-hidden="true" />
                        {t(quotaLine(checkout.plan))}
                      </span>
                    )}
                  </div>
                  <img className="pp-checkout__art" src="/pricing/subscription-upgrade.webp" alt="" />
                </div>
                {checkout.plan.rechargePolicy && <CustomRecharge plan={checkout.plan} disabled={checkout.loading} t={t} onChange={input => setCheckout(value => ({ ...value, plan: rechargeCheckoutPlan(value.plan, input), error: '', errorCode: '' }))} />}
                {checkout.plan.kind === 'subscription' && <SubscriptionPurchaseBenefits plan={checkout.plan} t={t} />}
                <PaymentMethodSwitch methods={paymentMethods} value={checkout.method} onChange={method => setCheckout(value => ({ ...value, method }))} disabled={checkout.loading} t={t} />
                {checkout.error && <p className="pp-checkout__error" role="alert">{t(checkout.error)}</p>}
                {checkout.errorCode === "user_unsettled_order" && (
                  <Link to="/orders" onClick={() => setCheckout(null)}>{t("查看我的订单")}</Link>
                )}
                {checkout.errorCode === "subscription_exists" && <Link to="/subscriptions">{t("管理我的订阅")}</Link>}
                {checkout.errorCode === 'plan_changed' && <button type="button" onClick={() => checkout.plan.kind === 'subscription' ? startCheckout(checkout.plan) : window.location.reload()}>{t(checkout.plan.kind === 'subscription' ? '重新确认订阅权益' : '刷新充值规则')}</button>}
                {checkout.plan.kind === 'subscription' && <label className="pp-subscription-consent"><input type="checkbox" checked={Boolean(checkout.subscriptionAccepted)} disabled={checkout.loading || checkout.errorCode === 'plan_changed'} onChange={event => setCheckout(value => ({...value,subscriptionAccepted:event.target.checked}))} /><span>{t('我已了解订阅权益、积分重置及退款规则')}</span></label>}
                <button
                  type="button"
                  className="pp-checkout__submit"
                  data-dialog-motion-item
                  disabled={checkout.loading || (checkout.plan.rechargePolicy && checkout.plan.rechargeAmountYuan == null) || (checkout.plan.kind === 'subscription' && (!checkout.subscriptionAccepted || checkout.errorCode === 'plan_changed'))}
                  onClick={() => createPaymentOrder(checkout.method)}
                >
                  {checkout.loading ? (
                    <LoaderCircle className="is-spinning" size={18} aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={18} aria-hidden="true" />
                  )}
                  {t(checkout.loading ? "正在创建订单" : `使用${checkout.method === "wechat" ? "微信" : "支付宝"}支付`)}
                  {!checkout.loading && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </div>
            )}
        </>}
      </DialogMotion>
      {user?.id && upgradeQuoteId && <SubscriptionUpgradeCheckout key={`${user.id}:${upgradeQuoteId}`} quoteId={upgradeQuoteId} dark={dark} returnLabel="返回价格页面" onClose={closeUpgradePayment} onChanged={() => setSubscriptionVersion(value => value + 1)} />}
    </main>
  );
}
