import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useGSAP } from "@gsap/react";
import { QRCode } from "antd";
import {
  Bot,
  Brush,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Gamepad2,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  MonitorSmartphone,
  PackageSearch,
  RefreshCw,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";
import gsap from "gsap";
import "@react/legacy-styles/generated/views/PricingView.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { useLocale } from "../i18n/index.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";

gsap.registerPlugin(useGSAP);

const sectionTabs = [
  ["plans", "套餐方案"],
  ["models", "模型价格"],
  ["unit", "创作单价"],
  ["pay", "获取积分"],
  ["faq", "常见问题"],
];

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
      "失败或取消自动返还",
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
    features: ["覆盖全部图像工作台", "订阅期内按日发放额度", "优先体验后续能力"],
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

const accessMethods = [
  ["redeem", "兑换码", "bi-ticket-perforated", "去兑换"],
  ["trial", "体验资格", "bi-stars", "立即申请"],
  ["checkin", "每日签到", "bi-calendar-check", "去签到"],
];

const faqs = [
  [
    "现在可以购买套餐吗？",
    "支付渠道启用后，选择额度包或订阅方案，可使用支付宝或微信扫码支付。",
  ],
  [
    "现在怎样获取积分？",
    "兑换码、体验资格或每日签到。已有额度可直接用于创作。",
  ],
  [
    "模型价格和创作单价有什么区别？",
    "模型价格是单次模型积分；创作单价是工作台起步价。提交时按所选模型结算。",
  ],
  [
    "任务失败会扣积分吗？",
    "任务提交时冻结额度，成功后结算；失败或取消会释放对应冻结额度。",
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
    eyebrow: plan.kind === "subscription" ? "订阅" : "额度包",
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
    : ["全平台创作工具通用", "支付成功自动入账", "失败订单不会发放积分"];
}

function checkoutCountdown(expiresAt, now) {
	const expiresAtMs = new Date(expiresAt || "").getTime();
	if (!Number.isFinite(expiresAtMs)) {
		return { expired: false, label: null };
	}
	const remaining = Math.max(0, expiresAtMs - now);
  const seconds = Math.ceil(remaining / 1000);
  return {
    expired: seconds <= 0,
    label: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
  };
}

function mergePaymentOrder(previous, current) {
	if (!previous) return current;
	if (!current) return previous;
	const merged = { ...previous, ...current };
	if (!current.payUrl && previous.payUrl) merged.payUrl = previous.payUrl;
	if (!current.expiresAt && previous.expiresAt) merged.expiresAt = previous.expiresAt;
	if (!current.payUrl && previous.requiresManualAmount) merged.requiresManualAmount = true;
	return merged;
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

function modelBrandIcon(model, kind) {
  const identity = [model?.id, model?.name, model?.label, model?.providerName, model?.provider]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (identity.includes("nano-banana") || identity.includes("nano banana")) {
    return { src: "/icons/nano-banana.svg", branded: true };
  }
  if (identity.includes("gemini")) return { src: "/icons/gemini.svg", branded: true };
  if (identity.includes("kling")) return { src: "/icons/kling.svg", branded: true };
  if (identity.includes("bytedance") || identity.includes("byte dance")) {
    return { src: "/icons/bytedance.svg", branded: true };
  }
  if (identity.includes("openai") || /(^|[\s/_-])gpt(?:[\s/_.-]|$)/.test(identity)) {
    return { src: "/icons/openai.svg", branded: true };
  }

  const tool = String(model?.tool || model?.operations?.[0] || "").replaceAll("-", "_");
  if (tool === "background_remove") return { component: Scissors, branded: false };
  if (tool === "image_upscale") return { component: Maximize2, branded: false };
  if (tool.includes("motion") || tool.includes("animate")) return { component: Workflow, branded: false };
  if (tool.includes("video") || tool.includes("template")) return { component: Sparkles, branded: false };
  return { component: MODEL_KIND_META[kind].icon, branded: false };
}

function normalizeModelCard(model, page) {
  const id = String(model?.id || model?.publicModelKey || model?.model || "").trim();
  if (!id) return null;
  const provider = String(model.providerName || model.provider || "").trim();
  const description = String(model.description || "").trim();
  const kind = inferModelKind(model);
  const price = baseModelPrice(model);
  const icon = modelBrandIcon(model, kind);
  return {
    id,
    pageId: page.id,
    name: String(model.label || model.name || id),
    provider: placeholderText.test(provider) ? "" : provider,
    description: placeholderText.test(description) ? "" : description,
    ...price,
    fastMode: model.fastMode === true,
    isDefault: model.default === true,
    workspacePriceOverridden: model.workspacePriceOverridden === true,
    kind,
    icon: icon.component,
    iconSrc: icon.src || "",
    brandedIcon: icon.branded,
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

export function PricingView() {
  const { t } = useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageRef = useRef(null);
  const [activeSection, setActiveSection] = useState("plans");
  const planKind =
    searchParams.get("plan") === "subscription" ? "subscription" : "topup";
  const [plans, setPlans] = useState([]);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [pricing, setPricing] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [plansLoadFailed, setPlansLoadFailed] = useState(false);
  const [activeModelPage, setActiveModelPage] = useState("assistant");
  const [wallet, setWallet] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [checkoutNow, setCheckoutNow] = useState(Date.now());
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

  useEffect(() => {
    if (!checkout) return undefined;
    const onKeydown = (event) => {
      if (event.key === "Escape" && !checkout.loading) setCheckout(null);
    };
    document.addEventListener("keydown", onKeydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [checkout]);

  useEffect(() => {
    if (!checkout?.order?.expiresAt || checkout.order.status !== "pending") return undefined;
    setCheckoutNow(Date.now());
    const timer = window.setInterval(() => setCheckoutNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [checkout?.order?.expiresAt, checkout?.order?.status]);

  useEffect(() => {
    const order = checkout?.order;
    if (!order?.id || order.status !== "pending") return undefined;
    const controller = new AbortController();
    let stopped = false;
    let timer = null;
    const poll = async () => {
      try {
        const current = await apiGet(`/orders/${encodeURIComponent(order.id)}`, controller.signal);
        if (stopped) return;
        if (current?.status === "completed") {
          const nextWallet = await apiGet("/me/wallet", controller.signal).catch(() => null);
          if (stopped) return;
          if (nextWallet) {
            setWallet(nextWallet);
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
        if (current?.status === "expired" || current?.status === "failed") return;
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

  useEffect(() => {
    const onWalletUpdated = (event) => {
      if (event?.detail) setWallet((current) => ({ ...(current || {}), ...event.detail }));
    };
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    return () => window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
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
              y: 28,
              autoAlpha: 0,
              duration: 0.62,
            })
            .from(
              ".pp-wallet",
              {
                y: 24,
                autoAlpha: 0,
                duration: 0.55,
                clearProps: "transform,opacity,visibility",
              },
              "-=0.36",
            );
          gsap.to(".pp-orb--a", {
            y: 18,
            x: 12,
            duration: 6.4,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
          });
          gsap.to(".pp-orb--b", {
            y: -16,
            x: -10,
            duration: 7.2,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
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
      apiGet("/plans", controller.signal),
      apiGet("/pricing", controller.signal),
      fetchRuntimeConfig(),
    ]).then(
      ([plansResult, pricingResult, runtimeResult]) => {
        if (controller.signal.aborted) return;
        if (plansResult.status === "fulfilled") {
          setPlans(
            Array.isArray(plansResult.value?.items)
              ? plansResult.value.items
              : [],
          );
          setPaymentEnabled(plansResult.value?.paymentEnabled === true);
          setPaymentMethods(
            Array.isArray(plansResult.value?.paymentMethods)
              ? plansResult.value.paymentMethods.filter((method) =>
                  ["alipay", "wechat"].includes(method),
                )
              : [],
          );
        } else setPlansLoadFailed(true);
        if (pricingResult.status === "fulfilled")
          setPricing(pricingResult.value || null);
        if (runtimeResult.status === "fulfilled")
          setRuntimeConfig(runtimeResult.value || null);
        setPlansLoading(false);
        setModelsLoading(false);
      },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setWallet(null);
      return undefined;
    }
    const controller = new AbortController();
    apiGet("/me/wallet", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWallet(value || null);
      })
      .catch(() => null);
    return () => controller.abort();
  }, [user?.id]);

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

  const modelPageGroups = useMemo(() => buildModelPageGroups(runtimeConfig), [runtimeConfig]);
  const activeModelGroup = useMemo(
    () => modelPageGroups.find((group) => group.id === activeModelPage) || modelPageGroups[0] || null,
    [activeModelPage, modelPageGroups],
  );
  const modelCards = activeModelGroup?.models || [];

  useEffect(() => {
    if (!modelPageGroups.length) return;
    if (!modelPageGroups.some((group) => group.id === activeModelPage)) {
      setActiveModelPage(modelPageGroups[0].id);
    }
  }, [activeModelPage, modelPageGroups]);
  const ActiveModelPageIcon = activeModelGroup?.icon || LayoutGrid;

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
  const available = Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0);

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
        y: 20,
        autoAlpha: 0,
        duration: 0.42,
        stagger: 0.07,
        ease: "power3.out",
        clearProps: "transform,opacity,visibility",
      });
      return undefined;
    },
    { scope: pageRef, dependencies: [planKind, plansLoading, visiblePlans.length] },
  );
  const frozen = Number(wallet?.frozenCents || 0);

  function requestTrial() {
    const next = new URLSearchParams(searchParams);
    next.set("trial", "apply");
    navigate(`/pricing?${next.toString()}`);
  }
  function startCheckout(plan) {
    if (!user) {
      navigate("/auth");
      return;
    }
    setCheckout({
      plan,
      method: paymentMethods[0] || "alipay",
      order: null,
      loading: false,
      error: "",
		cancelConfirm: false,
		cancelled: false,
    });
  }
  async function createPaymentOrder(method) {
    if (!checkout?.plan?.id || checkout.loading) return;
    setCheckout((value) => ({ ...value, method, loading: true, error: "" }));
    try {
      const order = await apiPost("/orders", {
        planId: checkout.plan.id,
        paymentMethod: method,
      });
      setCheckoutNow(Date.now());
		setCheckout((value) => ({
			...value,
			method: order.paymentMethod || method,
			order,
			loading: false,
			error: "",
			cancelConfirm: false,
			cancelled: false,
		}));
    } catch (error) {
      setCheckout((value) => ({
        ...value,
        loading: false,
        error: error?.message || "订单创建失败，请稍后重试",
      }));
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
			setCheckout((value) => value?.order?.id === order.id ? {
				...value,
				order: mergePaymentOrder(value.order, current),
				loading: false,
				error: "",
				cancelConfirm: false,
				cancelled: current?.status === "expired",
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
    if (nextKind === "subscription") next.set("plan", "subscription");
    else next.delete("plan");
    setSearchParams(next, { replace: true });
    setActiveSection("plans");
  }
  function scrollToSection(id) {
    setActiveSection(id);
    document
      .getElementById(`pricing-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (plan.priceMode === "coming" || planLocked(plan)) return "支付接入后开放";
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
          <span className="pp-hero__gridline" />
          <span className="pp-orb pp-orb--a" />
          <span className="pp-orb pp-orb--b" />
        </div>
        <div className="pp-shell pp-hero__grid">
          <div className="pp-hero__copy">
            <h1>{t("创作价格")}</h1>
            <div
              className={`pp-hero__chip${paymentEnabled ? " is-on" : ""}`}
              role="status"
            >
              <i
                className={`bi ${paymentEnabled ? "bi-unlock" : "bi-lock"}`}
                aria-hidden="true"
              />
              {paymentEnabled ? t("支付已接入") : t("套餐暂不可用")}
            </div>
            <div className="pp-hero__actions">
              <button
                type="button"
                className="pp-btn is-primary"
                onClick={() => navigate("/text-to-image")}
              >
                {t("开始创作")}
                <i className="bi bi-arrow-up-right" aria-hidden="true" />
              </button>
            </div>
          </div>
          <aside className="pp-wallet" aria-label={t("钱包概览")}>
            <div className="pp-wallet__top">
              <span>{t("我的钱包")}</span>
              {user && (
                <Link className="pp-wallet__link" to="/wallet">
                  {t("明细")}
                  <i className="bi bi-arrow-right" aria-hidden="true" />
                </Link>
              )}
            </div>
            {user ? (
              <>
                <strong>{formatPoints(available, { withUnit: false })}</strong>
                <span className="pp-wallet__unit">{t("积分")}</span>
                {frozen > 0 && (
                  <span className="pp-wallet__frozen">
                    {t(`${formatPoints(frozen)} 冻结`)}
                  </span>
                )}
              </>
            ) : (
              <>
                <strong className="is-muted">—</strong>
                <button
                  type="button"
                  className="pp-btn is-primary is-compact"
                  onClick={() => navigate("/auth")}
                >
                  {t("前往登录")}
                </button>
              </>
            )}
          </aside>
        </div>
      </section>

      <nav className="pp-nav" aria-label={t("价格分区")}>
        <div className="pp-shell pp-nav__inner">
          {sectionTabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? "is-active" : ""}
              onClick={() => scrollToSection(id)}
            >
              {t(label)}
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
            <h2 id="plans-title">{t("套餐方案")}</h2>
            <div className="pp-plan-tabs" role="tablist" aria-label={t("套餐类型")}>
              <button
                type="button"
                role="tab"
                aria-selected={planKind === "topup"}
                className={planKind === "topup" ? "is-active" : ""}
                onClick={() => setPlanKind("topup")}
              >
                <i className="bi bi-box-seam" aria-hidden="true" />
                {t("额度包")}
                <span>{packPlans.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={planKind === "subscription"}
                className={planKind === "subscription" ? "is-active" : ""}
                onClick={() => setPlanKind("subscription")}
              >
                <i className="bi bi-arrow-repeat" aria-hidden="true" />
                {t("订阅")}
                <span>{subscriptionPlans.length}</span>
              </button>
            </div>
          </header>
          {plansLoading ? (
            <div className="pp-plan-grid" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <article key={n} className="pp-plan is-loading" />
              ))}
            </div>
          ) : visiblePlans.length ? (
            <div className="pp-plan-grid" data-count={visiblePlans.length}>
              {visiblePlans.map((plan) => {
                const quota = quotaLine(plan);
                const locked = planLocked(plan);
                return (
                  <article
                    key={plan.id}
                    className={`pp-plan${plan.popular ? " is-popular" : ""}${locked ? " is-locked" : ""}`}
                  >
                    {(plan.badge || plan.popular) && (
                      <div className="pp-plan__badge">
                        {t(plan.badge || "推荐")}
                      </div>
                    )}
                    <small>{t(plan.eyebrow)}</small>
                    <h3>{t(plan.name)}</h3>
                    <div className="pp-plan__price">
                      <strong>{t(planPrice(plan))}</strong>
                      <span>{t(planSuffix(plan))}</span>
                    </div>
                    {quota && <b>{t(quota)}</b>}
                    <ul>
                      {planFeatures(plan).map((feature) => (
                        <li key={feature}>
                          <i
                            className="bi bi-check2-circle"
                            aria-hidden="true"
                          />
                          {t(feature)}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        isUsagePlan(plan)
                          ? navigate("/text-to-image")
                          : startCheckout(plan)
                      }
                    >
                      {locked
                        ? t("暂不可用")
                        : isUsagePlan(plan)
                          ? t("开始创作")
                          : t("选择此方案")}
                      {!locked && (
                        <i className="bi bi-arrow-up-right" aria-hidden="true" />
                      )}
                    </button>
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

      <section
        id="pricing-models"
        className="pp-section is-soft"
        data-section="models"
        aria-labelledby="models-title"
      >
        <div className="pp-shell">
          <header className="pp-head">
            <h2 id="models-title">{t("模型价格")}</h2>
            {!modelsLoading && activeModelGroup && (
              <label className="pp-model-page-select">
                <ActiveModelPageIcon size={18} strokeWidth={1.9} aria-hidden="true" />
                <select
                  aria-label={t("创作页面")}
                  value={activeModelGroup.id}
                  onChange={(event) => setActiveModelPage(event.target.value)}
                >
                  {modelPageGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {t(group.label)} · {group.models.length}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
              </label>
            )}
          </header>
          {modelsLoading ? (
            <div className="pp-model-browser is-loading" aria-busy="true">
              <div className="pp-model-browser__content">
                {[1, 2, 3, 4].map((n) => (
                  <article key={n} className="pp-model-row is-loading" />
                ))}
              </div>
            </div>
          ) : modelPageGroups.length && activeModelGroup ? (
            <div className="pp-model-browser">
              <section className="pp-model-browser__content" aria-label={t(activeModelGroup.label)}>
                {modelCards.length ? (
                  <div className="pp-model-table" role="table">
                    <div className="pp-model-table__head" role="row">
                      <span>{t("模型")}</span>
                      <span>{t("当前价格")}</span>
                      <span>{t("价格明细")}</span>
                    </div>
                    {modelCards.map((model) => {
                      const meta = MODEL_KIND_META[model.kind];
                      const ModelIcon = model.icon;
                      return (
                        <article
                          key={`${activeModelGroup.id}:${model.id}`}
                          className={`pp-model-row${model.isDefault ? " is-default" : ""}`}
                          role="row"
                        >
                          <div className="pp-model-row__identity" role="cell">
                            <span className={`pp-model-row__icon${model.brandedIcon ? " is-brand" : ""}`} aria-hidden="true">
                              {model.iconSrc
                                ? <img src={model.iconSrc} alt="" width="20" height="20" />
                                : <ModelIcon size={20} strokeWidth={1.9} />}
                            </span>
                            <div>
                              <strong>{model.name}</strong>
                              <small>
                                {t(meta.label)} · {model.provider || t("平台模型")}
                                {model.workspacePriceOverridden && <em>{t("页面价")}</em>}
                                {model.isDefault && <em>{t("默认")}</em>}
                                {model.fastMode && <em className="is-fast">{t("极速")}</em>}
                              </small>
                            </div>
                          </div>
                          <div className="pp-model-row__price" role="cell">
                            <span>
                              <b>{t(formatPoints(model.points, { withUnit: false }))}</b>
                              <small>{t("积分")}{t(meta.unit)}</small>
                            </span>
                            {model.hasDiscount && (
                              <span className="is-discount">
                                <del>{t(formatPoints(model.standard))}</del>
                                <em>{t("折扣")}</em>
                              </span>
                            )}
                          </div>
                          <div className="pp-model-row__variants" role="cell">
                            {model.variants.length ? model.variants.map((variant) => (
                              <span key={variant.id}>
                                <small>{t(variant.label)}</small>
                                <strong>
                                  {variant.hasDiscount && (
                                    <del>{t(formatPoints(variant.standard, { withUnit: false }))}</del>
                                  )}
                                  <b>{t(formatPoints(variant.points, { withUnit: false }))}</b>
                                  <i>{t("积分")}</i>
                                </strong>
                              </span>
                            )) : <span className="is-empty">—</span>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="pp-model-browser__empty">{t("该页面暂无此类模型")}</div>
                )}
              </section>
            </div>
          ) : (
            <div className="pp-empty">
              <strong>{t("暂无已上架模型")}</strong>
            </div>
          )}
        </div>
      </section>

      <section className="pp-section">
        <div className="pp-shell pp-more">
          <div
            id="pricing-unit"
            className="pp-more__col"
            data-section="unit"
            aria-labelledby="unit-title"
          >
            <header className="pp-head">
              <h2 id="unit-title">{t("创作单价")}</h2>
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
                  <strong>{t(card.label)}</strong>
                  <div className="pp-unit__price">
                    <b>{t(unitPrice(card))}</b>
                    {card.type !== "puzzle" && card.minPoints !== null && (
                      <span>{t("/ 张")}</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div
            id="pricing-pay"
            className="pp-more__col"
            data-section="pay"
            aria-labelledby="pay-title"
          >
            <header className="pp-head">
              <h2 id="pay-title">{t("获取积分")}</h2>
            </header>
            <div className="pp-access">
              {accessMethods.map(([id, name, icon, action]) => (
                <article key={id}>
                  <i className={`bi ${icon}`} aria-hidden="true" />
                  <strong>{t(name)}</strong>
                  <button type="button" onClick={() => useAccessMethod(id)}>
                    {t(action)}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="pricing-faq"
        className="pp-section is-soft"
        data-section="faq"
        aria-labelledby="faq-title"
      >
        <div className="pp-shell pp-faq-layout">
          <h2 id="faq-title">{t("常见问题")}</h2>
          <div className="pp-faq">
            {faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0 ? true : undefined}>
                <summary>
                  <span>{t(question)}</span>
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                </summary>
                <p>{t(answer)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {checkout && (
        <div
          className="pp-checkout-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !checkout.loading) setCheckout(null);
          }}
        >
          <section
            className="pp-checkout"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pp-checkout-title"
          >
            <header className="pp-checkout__head">
              <div>
                <small>{checkout.order ? t("扫码支付") : t("确认方案")}</small>
                <h2 id="pp-checkout-title">{t(checkout.plan.name)}</h2>
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

            {checkout.order?.status === "completed" ? (
              <div className="pp-checkout__success">
                <CheckCircle2 size={44} aria-hidden="true" />
                <strong>{t("支付成功，积分已到账")}</strong>
                <span>{t(quotaLine(checkout.plan))}</span>
                <button type="button" onClick={() => setCheckout(null)}>
                  {t("完成")}
                </button>
              </div>
            ) : checkout.order ? (
              <PaymentQRCode
                checkout={checkout}
                now={checkoutNow}
                onCancel={cancelPaymentOrder}
				onRequestCancel={() => setCheckout((value) => ({ ...value, cancelConfirm: true, error: "" }))}
				onKeepPaying={() => setCheckout((value) => ({ ...value, cancelConfirm: false }))}
                onRetry={() =>
					setCheckout((value) => ({ ...value, order: null, error: "", cancelled: false, cancelConfirm: false }))
                }
                t={t}
              />
            ) : (
              <div className="pp-checkout__body">
                <div className="pp-checkout__summary">
                  <span>{t(quotaLine(checkout.plan))}</span>
                  <strong>{t(formatCents(checkout.plan.priceCents))}</strong>
                </div>
                <div className="pp-pay-methods" role="radiogroup" aria-label={t("支付方式")}>
                  {[
                    ["alipay", "支付宝", "bi-alipay"],
                    ["wechat", "微信支付", "bi-wechat"],
                  ]
                    .filter(([id]) => paymentMethods.includes(id))
                    .map(([id, name, icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={checkout.method === id}
                      className={checkout.method === id ? "is-active" : ""}
                      onClick={() => setCheckout((value) => ({ ...value, method: id }))}
                    >
                      <i className={`bi ${icon}`} aria-hidden="true" />
                      <span>{t(name)}</span>
                      <i className="bi bi-check-circle-fill" aria-hidden="true" />
                    </button>
                    ))}
                </div>
                {checkout.error && <p className="pp-checkout__error">{t(checkout.error)}</p>}
                <button
                  type="button"
                  className="pp-checkout__submit"
                  disabled={checkout.loading}
                  onClick={() => createPaymentOrder(checkout.method)}
                >
                  {checkout.loading ? (
                    <LoaderCircle className="is-spinning" size={18} aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={18} aria-hidden="true" />
                  )}
                  {t(checkout.loading ? "正在创建订单" : `使用${checkout.method === "wechat" ? "微信" : "支付宝"}支付`)}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

    </main>
  );
}

function PaymentQRCode({ checkout, now, onCancel, onRequestCancel, onKeepPaying, onRetry, t }) {
	const order = checkout.order;
	const countdown = checkoutCountdown(order.expiresAt, now);
	const terminal = order.status === "expired" || order.status === "failed";
	const paymentName = (order.paymentMethod || checkout.method) === "wechat" ? "微信" : "支付宝";
  const amount = formatCents(order.payAmountCents ?? order.amountCents);

  if (terminal) {
    return (
      <div className="pp-checkout__expired">
        <Clock3 size={38} aria-hidden="true" />
			<strong>{t(checkout.cancelled ? "支付订单已取消" : "支付订单已失效")}</strong>
        <button type="button" onClick={onRetry}>
          <RefreshCw size={17} aria-hidden="true" />
          {t("重新创建")}
        </button>
      </div>
    );
  }

  return (
    <div className="pp-checkout__pay">
      <div className="pp-checkout__qr">
        <QRCode value={String(order.payUrl || "")} size={212} bordered={false} />
      </div>
      <div className="pp-checkout__amount">
        <small>{t("应付金额")}</small>
        <strong>{amount}</strong>
		<span>
			<Clock3 size={14} aria-hidden="true" />
			{t(countdown.expired ? "正在确认订单状态" : countdown.label ? `请在 ${countdown.label} 内完成` : "请尽快完成支付")}
		</span>
      </div>
	{order.requiresManualAmount && (
		<p className="pp-checkout__notice">
			{t(`扫码后请手动输入 ${amount}，付款金额必须完全一致`)}
		</p>
      )}
		{checkout.error && <p className="pp-checkout__error">{t(checkout.error)}</p>}
		{checkout.cancelConfirm && (
			<div className="pp-checkout__confirm" role="alert">
				<div>
					<strong>{t("确认取消订单？")}</strong>
					<span>{t("确认后当前二维码将失效，未付款不会产生扣款。")}</span>
				</div>
				<div>
					<button type="button" disabled={checkout.loading} onClick={onKeepPaying}>{t("返回支付")}</button>
					<button type="button" disabled={checkout.loading} onClick={onCancel}>
						{checkout.loading && <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />}
						{t(checkout.loading ? "取消中" : "确认取消")}
					</button>
				</div>
			</div>
		)}
		<div className="pp-checkout__pay-actions">
        <a href={order.payUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={16} aria-hidden="true" />
          {t(`打开${paymentName}`)}
        </a>
			<button type="button" disabled={checkout.loading || checkout.cancelConfirm} onClick={onRequestCancel}>
				{t("取消订单")}
        </button>
      </div>
    </div>
  );
}
