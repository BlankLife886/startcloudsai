import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Link, useNavigate } from "react-router";
import { fetchAssistantConfig } from "@react/legacy-modules/services/assistantApi.js";
import { getWallet } from "@react/legacy-modules/services/meApi.js";
import {
  listPromptCategories,
  listPromptLibrary,
  recordPromptEngagement,
} from "@react/legacy-modules/services/promptLibrary.js";
import { getFeatureUnitPriceCents } from "@react/legacy-modules/services/pricing.js";
import {
  fetchRuntimeConfig,
  getDefaultRuntimeConfig,
  normalizeRuntimeConfig,
} from "@react/legacy-modules/services/runtimeConfig.js";
import { listTasks, uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import {
  getScopedLocalItem,
  setScopedLocalItem,
} from "@react/legacy-modules/services/scopedLocalStorage.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { imageCountFromPrompt } from "@react/legacy-modules/features/assistant/domain/assistantMessages.js";
import { ECOMMERCE_MODES } from "@react/legacy-modules/features/ecommerce/ecommerceTools.js";
import {
  studioLaunchDefaults,
  studioLaunchFields,
} from "@react/legacy-modules/features/creator-hub/studioLaunchProfiles.js";
import {
  COMMERCE_ENTRY_GROUPS,
  STUDIO_TOOLS,
  ecomToolCover,
  stashPendingPrompt,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import {
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import {
  taskDisplayUrl,
  taskOriginalUrl,
  taskThumbnailUrl,
} from "@react/legacy-modules/features/creator-hub/taskMedia.js";
import "@react/legacy-static/features/creator-hub/creator-hub.css";
import "@react/legacy-static/features/creator-hub/studio-hub.css";
import "@react/legacy-styles/generated/features/home-commercial/components/TypeLine.css";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { useLocale } from "../i18n/index.js";
import {
  ECOMMERCE_PAGE_KEYS,
  isPageEntryVisible,
} from "../config/pageControls.js";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const LEAD_LINES = [
  "先写下想法，再选择工具。从一句话开始，做到成品。",
  "文生图、染色、模型设计、游戏资产——一条创作流。",
  "提示词可复用，进度可回看，结果可继续迭代。",
];
const COMPOSER_TOOLS = new Set(["assistant", "t2i"]);
const COMPOSER_DRAFT_KEY = "studio-hub-composer-draft-v1";
const MAX_COMPOSER_REFS = 4;
const TOOL_WALL_ORDER = ["assistant", "t2i", "model", "coloring", "ui", "game"];
const ECOMMERCE_MODE_IDS = [
  "shoot",
  "listing",
  "detail",
  "tryon",
  "handheld",
  "background",
];

function storedRuntimeConfig() {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("walleven.runtime-config.v2") || "null",
    );
    return normalizeRuntimeConfig(value?.config || getDefaultRuntimeConfig());
  } catch {
    return getDefaultRuntimeConfig();
  }
}

function routeVisible(config, path) {
  const routes = config?.routes || {};
  const exact = routes[path];
  const parentKey = Object.keys(routes)
    .filter((key) => key !== "/" && path.startsWith(`${key}/`))
    .sort((left, right) => right.length - left.length)[0];
  const route = exact || routes[parentKey] || {};
  return route.enabled !== false || route.fallbackType === "disabled";
}

function featureEnabled(config, key) {
  return !key || config?.features?.[key]?.enabled !== false;
}

function normalizeModel(item = {}) {
  const id = String(item.id || item.publicModelKey || item.model || "").trim();
  if (!id) return null;
  return {
    ...item,
    ...normalizeImageModelCapabilities(item),
    id,
    label: String(item.label || item.name || id).trim(),
  };
}

function ratioPreviewStyle(value) {
  if (String(value || "").toLowerCase() === "auto") return { aspectRatio: "1 / 1" };
  const [width, height] = String(value || "").split(":").map(Number);
  return { aspectRatio: `${width || 1} / ${height || 1}` };
}

function ratioPreviewClass(value) {
  if (String(value || "").toLowerCase() === "auto") return "is-auto";
  const [width, height] = String(value || "").split(":").map(Number);
  if (width === height) return "is-square";
  return width > height ? "is-landscape" : "is-portrait";
}

function ratioChipLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "比例";
  return normalized.toLowerCase() === "auto" ? "自动" : normalized;
}

const CAPTIONED_FIELDS = new Set([
  "model",
  "quality",
  "ratio",
  "resolution",
  "count",
  "skill",
  "reasoning",
]);
const REASONING_EFFORT_LABELS = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};

function normalizeReasoningEffortId(value) {
  return String(value || "").trim().toLowerCase();
}

function listReasoningEfforts(model) {
  const priced = Array.isArray(model?.reasoningEfforts) ? model.reasoningEfforts : [];
  const source = priced.length
    ? priced
    : Array.isArray(model?.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
      : [];
  const seen = new Set();
  return source.flatMap((item) => {
    const raw = item && typeof item === "object" ? item : { id: item };
    const id = normalizeReasoningEffortId(raw.id || raw.effort);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: String(raw.label || REASONING_EFFORT_LABELS[id] || id).trim() || id,
      pricePoints: raw.pricePoints,
      standardPricePoints: raw.standardPricePoints,
      discountPricePoints: raw.discountPricePoints,
    }];
  });
}

function firstReasoningEffort(model) {
  return listReasoningEfforts(model)[0]?.id || "";
}

function modelWithReasoningPrice(model, effortId) {
  const option = listReasoningEfforts(model).find(
    (item) => item.id === normalizeReasoningEffortId(effortId),
  );
  if (!option) return model;
  return {
    ...model,
    pricePoints: option.pricePoints ?? model?.pricePoints,
    standardPricePoints: option.standardPricePoints ?? model?.standardPricePoints,
    discountPricePoints: option.discountPricePoints ?? model?.discountPricePoints,
  };
}

function compactModelPriceLabel(model, { perImage = true } = {}) {
  const price = resolveModelPointPricing(model);
  if (!price.configured) return "";
  const suffix = perImage ? "/张" : "";
  if (price.hasDiscount) return `折扣 ${price.discount}积分${suffix}`;
  if (price.effective === 0) return "免费";
  return `${price.effective}积分${suffix}`;
}

function StudioModelPrice({ model, perImage }) {
  const price = resolveModelPointPricing(model);
  if (!price.configured) return null;
  const suffix = perImage ? "/张" : "";
  return (
    <span className={`studio-composer__model-price${price.hasDiscount ? " has-discount" : ""}`}>
      {price.hasDiscount ? (
        <>
          <strong>折扣 {price.discount} 积分{suffix}</strong>
          <del>{price.standard} 积分{suffix}</del>
        </>
      ) : (
        <strong>{price.effective === 0 ? "免费" : `${price.effective} 积分${suffix}`}</strong>
      )}
    </span>
  );
}
const STUDIO_PROMPT_PAGE_SIZE = 48;

function promptLibraryType(tool) {
  return String(tool?.taskType || "").trim();
}

function dialogTransitionClass(phase) {
  if (phase === "entering") return "studio-prompt-enter-active studio-prompt-enter-from";
  if (phase === "open") return "studio-prompt-enter-active";
  if (phase === "closing") return "studio-prompt-leave-active studio-prompt-leave-to";
  return "";
}

function useDialogPresence(open, duration = 240) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState("closed");

  useEffect(() => {
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
      document.documentElement.classList.contains("settings-no-animations");
    let frame = 0;
    let timer = 0;
    if (open) {
      setMounted(true);
      if (reduceMotion) {
        setPhase("open");
        return undefined;
      }
      setPhase("entering");
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setPhase("open"));
      });
    } else {
      if (reduceMotion) {
        setMounted(false);
        setPhase("closed");
        return undefined;
      }
      setPhase((current) => (current === "closed" ? current : "closing"));
      timer = window.setTimeout(() => {
        setMounted(false);
        setPhase("closed");
      }, duration);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [duration, open]);

  return { mounted, phase };
}

function mapPromptLibraryItems(items = []) {
  return items
    .filter((item) => item?.id && item?.prompt)
    .map((item) => ({
      id: item.id,
      value: `library:${item.id}`,
      label: item.title || item.label || "提示词素材",
      prompt: String(item.prompt).trim(),
      category: item.category || item.categoryKey || "",
      coverUrl: item.coverUrl || item.imageUrl || "",
    }));
}

function taskPrompt(task) {
  return String(
    task?.params?.userPrompt ||
      task?.userPrompt ||
      task?.params?.prompt ||
      task?.prompt ||
      "",
  ).trim();
}

function taskAspect(task) {
  const [width, height] = String(
    task?.aspectRatio || task?.params?.aspectRatio || "",
  )
    .split(":")
    .map(Number);
  if (width > 0 && height > 0) return `${width} / ${height}`;
  const match = String(task?.outputSize || task?.params?.size || "").match(
    /(\d+)\s*[x×]\s*(\d+)/i,
  );
  return match ? `${match[1]} / ${match[2]}` : "3 / 4";
}

function aspectScore(aspect) {
  const [width, height] = String(aspect).split("/").map(Number);
  return width > 0 && height > 0
    ? 1 / Math.max(0.35, Math.min(width / height, 3.2))
    : 1;
}

function readComposerDraft() {
  try {
    const raw = getScopedLocalItem(COMPOSER_DRAFT_KEY);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && typeof draft === "object" ? draft : {};
  } catch {
    return {};
  }
}

function persistableReferences(items = []) {
  return items
    .map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      name: String(item.name || "参考图"),
      dataUrl: String(item.dataUrl || item.url || ""),
      thumbnailUrl: String(item.thumbnailUrl || item.dataUrl || item.url || ""),
      fileKey: String(item.fileKey || item.key || ""),
    }))
    .filter((item) => item.fileKey || item.dataUrl)
    .slice(0, MAX_COMPOSER_REFS);
}

function defaultLaunchConfigs() {
  return Object.fromEntries(
    STUDIO_TOOLS.map((tool) => [tool.id, studioLaunchDefaults(tool.id)]),
  );
}

function mergeLaunchConfigs(saved) {
  const defaults = defaultLaunchConfigs();
  if (!saved || typeof saved !== "object") return defaults;
  return Object.fromEntries(
    Object.entries(defaults).map(([id, fallback]) => [
      id,
      {
        ...fallback,
        ...(saved[id] && typeof saved[id] === "object" ? saved[id] : {}),
      },
    ]),
  );
}

function clipboardImageFiles(data) {
  if (!data) return [];
  const fromFiles = Array.from(data.files || []).filter((file) =>
    file.type?.startsWith("image/"),
  );
  if (fromFiles.length) return fromFiles;
  const fromItems = [];
  for (const item of data.items || []) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file?.type?.startsWith("image/")) fromItems.push(file);
  }
  return fromItems;
}

function balanceColumns(items, count) {
  const columns = Array.from({ length: count }, () => []);
  const heights = Array.from({ length: count }, () => 0);
  items.forEach((item) => {
    let target = 0;
    for (let index = 1; index < count; index += 1)
      if (heights[index] < heights[target]) target = index;
    columns[target].push(item);
    heights[target] += aspectScore(item.aspect);
  });
  return columns;
}

function useColumnCount() {
  const read = () =>
    window.innerWidth <= 480
      ? 1
      : window.innerWidth <= 760
        ? 2
        : window.innerWidth <= 1100
          ? 3
          : 4;
  const [count, setCount] = useState(read);
  useEffect(() => {
    const update = () => setCount(read());
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);
  return count;
}

function StudioTypeLine({ texts }) {
  const reduced =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations");
  const [text, setText] = useState(reduced ? texts[0] || "" : "");
  useEffect(() => {
    if (reduced) {
      setText(texts[0] || "");
      return undefined;
    }
    let disposed = false;
    let timer = 0;
    let item = 0;
    let length = 0;
    let deleting = false;
    const step = () => {
      if (disposed) return;
      const current = texts[item] || "";
      if (deleting) {
        length -= 1;
        setText(current.slice(0, Math.max(0, length)));
        if (length <= 0) {
          deleting = false;
          item = (item + 1) % texts.length;
          timer = window.setTimeout(step, 250);
        } else timer = window.setTimeout(step, 29);
      } else {
        length += 1;
        setText(current.slice(0, length));
        if (length >= current.length) {
          deleting = true;
          timer = window.setTimeout(step, 2200);
        } else timer = window.setTimeout(step, 42);
      }
    };
    timer = window.setTimeout(step, 760);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [reduced, texts]);
  return (
    <span className="type-line">
      <span className="sr-only">{texts[0]}</span>
      <span aria-hidden="true">
        {text}
        {!reduced && <i />}
      </span>
    </span>
  );
}

function StudioCostDialog({ cost, onConfirm, onCancel }) {
  if (!cost) return null;
  const count = Math.max(1, Number(cost.count || 1));
  const unitPrice = Number.isFinite(Number(cost.unitPriceCents))
    ? Math.max(0, Number(cost.unitPriceCents))
    : null;
  const total =
    unitPrice == null
      ? Math.max(0, Number(cost.unitCost || 0))
      : Math.max(0, Number(cost.totalPriceCents ?? unitPrice * count));
  const available =
    cost.creditAvailable == null
      ? null
      : Math.max(0, Number(cost.creditAvailable || 0));
  const insufficient = available != null && total > available;
  const format = (value) =>
    `${Math.round(Number(value || 0)).toLocaleString("zh-CN")} 积分`;
  return (
    <div
      className="ai-cost-confirm-layer is-elevated"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="ai-cost-confirm-panel is-credits"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-cost-confirm-title"
      >
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon">
            <i className="bi bi-coin" />
          </span>
          <div className="ai-cost-confirm-titles">
            <span className="ai-cost-confirm-eyebrow">
              {cost.featureLabel || "本次 AI 功能"}
            </span>
            <h5 id="ai-cost-confirm-title">确认生成费用</h5>
          </div>
          <button
            type="button"
            className="ai-cost-confirm-close"
            aria-label="关闭费用确认"
            onClick={onCancel}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <p className="ai-cost-confirm-summary">{cost.summary}</p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total">
            <div className="ai-cost-confirm-total__copy">
              <span>本次预计</span>
              <small>
                {unitPrice == null
                  ? `${count} ${cost.unitLabel || "张"}`
                  : `${format(unitPrice)} / ${cost.unitLabel || "张"} × ${count} ${cost.unitLabel || "张"}`}
              </small>
            </div>
            <strong>
              {unitPrice == null && !total ? "按实际用量结算" : format(total)}
            </strong>
          </div>
          <div className="ai-cost-confirm-balance">
            <div>
              <span>当前可用</span>
              <strong>
                {available == null ? "读取中" : format(available)}
              </strong>
            </div>
            <i className="bi bi-arrow-right" />
            <div className={insufficient ? "danger" : ""}>
              <span>支付后余额</span>
              <strong>
                {available == null
                  ? "待计算"
                  : insufficient
                    ? "余额不足"
                    : format(available - total)}
              </strong>
            </div>
          </div>
        </div>
        {unitPrice == null && (
          <p className="ai-cost-confirm-warn">
            <i className="bi bi-info-circle" />
            暂时读取不到单价，本次费用以服务端结算为准。
          </p>
        )}
        {insufficient && (
          <p className="ai-cost-confirm-warn is-danger">
            <i className="bi bi-exclamation-circle" />
            钱包余额不足，请充值后再提交任务。
          </p>
        )}
        <footer className="ai-cost-confirm-footer is-no-preference">
          <div className="ai-cost-confirm-actions">
            <button
              type="button"
              className="ai-cost-confirm-btn ghost"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="button"
              className="ai-cost-confirm-btn primary"
              disabled={insufficient}
              onClick={onConfirm}
            >
              确认
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function StudioHubView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const { t } = useLocale();
  const navigate = useNavigate();
  const leadLines = useMemo(() => LEAD_LINES.map((line) => t(line)), [t]);
  const rootRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  const recentControllerRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const recognitionRef = useRef(null);
  const [runtimeConfig, setRuntimeConfig] = useState(storedRuntimeConfig);
  const [draftPrompt, setDraftPrompt] = useState(() =>
    String(readComposerDraft().prompt || "").slice(0, 2000),
  );
  const [selectedToolId, setSelectedToolId] = useState(
    () => readComposerDraft().toolId || "assistant",
  );
  const [activePanel, setActivePanel] = useState("");
  const [launchConfigs, setLaunchConfigs] = useState(() =>
    mergeLaunchConfigs(readComposerDraft().configs),
  );
  const [assistantModels, setAssistantModels] = useState({
    conversation: [],
    image: [],
  });
  const [promptLibrary, setPromptLibrary] = useState({
    items: [],
    page: 1,
    hasMore: false,
    total: 0,
  });
  const [promptCategories, setPromptCategories] = useState([]);
  const [promptCategory, setPromptCategory] = useState("all");
  const [promptSearchDraft, setPromptSearchDraft] = useState("");
  const [promptSearch, setPromptSearch] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptLoadingMore, setPromptLoadingMore] = useState(false);
  const promptRequestRef = useRef(0);
  const promptListRef = useRef(null);
  const promptCatsRef = useRef(null);
  const promptCatsDragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startLeft: 0,
  });
  const [promptCatsOverflow, setPromptCatsOverflow] = useState({
    left: false,
    right: false,
  });
  const promptDialog = useDialogPresence(activePanel === "prompts");
  const [references, setReferences] = useState(() =>
    persistableReferences(readComposerDraft().references),
  );
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [launchSubmitting, setLaunchSubmitting] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState(null);
  const [cost, setCost] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState(() => new Set());
  const columnCount = useColumnCount();

  const visibleTools = useMemo(
    () =>
      STUDIO_TOOLS.filter(
        (tool) =>
          featureEnabled(runtimeConfig, tool.feature) &&
          routeVisible(runtimeConfig, tool.to) &&
          (tool.id === "ecommerce"
            ? ECOMMERCE_PAGE_KEYS.some((key) =>
                isPageEntryVisible(runtimeConfig.pageControls, key),
              )
            : isPageEntryVisible(runtimeConfig.pageControls, tool.to)),
      ),
    [runtimeConfig],
  );
  const composerTools = useMemo(
    () =>
      visibleTools.filter(
        (tool) => tool.taskType && COMPOSER_TOOLS.has(tool.id),
      ),
    [visibleTools],
  );
  const selectedTool =
    composerTools.find((tool) => tool.id === selectedToolId) ||
    composerTools[0] ||
    null;
  const selectedConfig =
    launchConfigs[selectedTool?.id || "t2i"] || studioLaunchDefaults("t2i");
  const modelOptions = useMemo(() => {
    if (!selectedTool) return [];
    if (selectedTool.id === "assistant")
      return selectedConfig.skill === "image"
        ? assistantModels.image
        : assistantModels.conversation;
    return (
      runtimeConfig?.features?.[selectedTool.feature]?.config?.publicModels ||
      []
    )
      .map(normalizeModel)
      .filter(Boolean);
  }, [assistantModels, runtimeConfig, selectedConfig.skill, selectedTool]);
  const selectedModel =
    modelOptions.find((model) => model.id === selectedConfig.model) ||
    modelOptions.find((model) => model.default) ||
    modelOptions[0] ||
    null;
  const maxReferences =
    selectedTool?.id === "assistant"
      ? 4
      : Math.max(0, Number(selectedModel?.maxReferenceImages ?? 4) || 0);
  const fields = useMemo(() => {
    const launchFields = studioLaunchFields(selectedTool?.id, selectedConfig);
    const capabilities = normalizeImageModelCapabilities(selectedModel || {});
    const allowedResolutions = new Set(capabilities.resolutions);
    const allowedQualities = new Set(capabilities.qualities);
    const allowedRatios = getModelAspectRatiosForResolution(
      selectedModel || {},
      selectedConfig.resolution,
    );
    const ratioLabels = new Map(
      launchFields
        .find((field) => field.key === "ratio")
        ?.options.map((option) => [option.value, option.label]) || [],
    );
    const usesModelImageParams =
      selectedTool?.id === "t2i" ||
      (selectedTool?.id === "assistant" && selectedConfig.skill === "image");
    const reasoningOptions = usesModelImageParams
      ? []
      : listReasoningEfforts(selectedModel);
    return launchFields.flatMap((field) => {
      if (field.key === "reasoning") {
        if (!reasoningOptions.length) return [];
        return [{
          ...field,
          options: reasoningOptions.map((item) => ({
            value: item.id,
            label: item.label,
            description: item.id,
            priceModel: {
              pricePoints: item.pricePoints ?? selectedModel?.pricePoints,
              standardPricePoints: item.standardPricePoints ?? selectedModel?.standardPricePoints,
              discountPricePoints: item.discountPricePoints ?? selectedModel?.discountPricePoints,
            },
            perImage: false,
          })),
        }];
      }
      if (field.key === "model")
        return [{
          ...field,
          options: [
            ...(!modelOptions.length
              ? [{ value: "", label: "默认模型" }]
              : []),
            ...modelOptions.map((model) => {
              const pricedModel = usesModelImageParams
                ? model
                : modelWithReasoningPrice(model, firstReasoningEffort(model));
              const reasoningCount = listReasoningEfforts(model).length;
              return {
                value: model.id,
                label: model.label,
                priceModel: pricedModel,
                perImage: usesModelImageParams,
                description:
                  !usesModelImageParams && reasoningCount
                    ? `推理强度 ${reasoningCount} 档`
                    : "",
              };
            }),
          ],
        }];
      if (!usesModelImageParams) return [field];
      if (field.key === "resolution")
        return [{
          ...field,
          options: field.options.filter((option) =>
            allowedResolutions.has(String(option.value).toUpperCase()),
          ),
        }];
      if (field.key === "quality")
        return [{
          ...field,
          options: field.options.filter((option) =>
            allowedQualities.has(String(option.value).toLowerCase()),
          ),
        }];
      if (field.key === "ratio")
        return [{
          ...field,
          options: allowedRatios.map((value) => ({
            value,
            label: ratioLabels.get(value) || ratioChipLabel(value),
          })),
        }];
      return [field];
    });
  }, [modelOptions, selectedConfig, selectedModel, selectedTool?.id]);
  const wallTools = useMemo(() => {
    const map = new Map(visibleTools.map((tool) => [tool.id, tool]));
    const ordered = TOOL_WALL_ORDER.map((id) => map.get(id)).filter(Boolean);
    return [
      ...ordered,
      ...visibleTools.filter((tool) => !TOOL_WALL_ORDER.includes(tool.id)),
    ].filter((tool) => tool.id !== "ecommerce");
  }, [visibleTools]);
  const promptCategoryChips = useMemo(() => {
    const seen = new Set();
    const chips = [{ key: "all", label: "全部" }];
    for (const item of promptCategories) {
      const key = String(item.key || "").trim();
      if (!key || key === "all" || seen.has(key)) continue;
      seen.add(key);
      chips.push({ key, label: item.label || key, count: item.count });
    }
    return chips;
  }, [promptCategories]);
  const promptCategoryLabel = (value) =>
    promptCategoryChips.find((item) => item.key === String(value || ""))?.label ||
    "";
  const updatePromptCatsOverflow = useCallback(() => {
    const node = promptCatsRef.current;
    if (!node) {
      setPromptCatsOverflow({ left: false, right: false });
      return;
    }
    setPromptCatsOverflow({
      left: node.scrollLeft > 4,
      right: node.scrollLeft + node.clientWidth < node.scrollWidth - 4,
    });
  }, []);
  const slidePromptCats = (direction) => {
    const node = promptCatsRef.current;
    if (!node) return;
    node.scrollBy({
      left: Math.round(node.clientWidth * 0.72) * direction,
      behavior: "smooth",
    });
  };
  const ecommerceTool = visibleTools.find((tool) => tool.id === "ecommerce");
  const ecommerceModes = ECOMMERCE_MODE_IDS.map((id) =>
    ECOMMERCE_MODES.find((mode) => mode.id === id),
  ).filter(
    (mode) =>
      mode &&
      isPageEntryVisible(runtimeConfig.pageControls, `ecommerce.${mode.id}`),
  );
  const ecommerceGroups = COMMERCE_ENTRY_GROUPS.map((group) => {
    const ids = group.ids.filter((id) =>
      isPageEntryVisible(runtimeConfig.pageControls, `ecommerce.${id}`),
    );
    return ids.length
      ? { ...group, ids, to: `/ecommerce-design?tool=${ids[0]}` }
      : null;
  }).filter(Boolean);
  const recentItems = recentTasks.map((task, index) => ({
    key: String(task.id),
    task,
    index,
    aspect: taskAspect(task),
    src: failedThumbs.has(String(task.id))
      ? // 缩略图加载失败时优先展示图（压缩大图），没有再退原图
        taskDisplayUrl(task) || taskOriginalUrl(task) || taskThumbnailUrl(task)
      : taskThumbnailUrl(task) || taskOriginalUrl(task),
    fallbackSrc: failedThumbs.has(String(task.id)) ? taskOriginalUrl(task) : "",
  }));
  const columns = balanceColumns(recentItems, columnCount);

  const updateSelectedConfig = (patch) =>
    setLaunchConfigs((current) => {
      const toolId = selectedTool?.id || "t2i";
      return {
        ...current,
        [toolId]: { ...(current[toolId] || selectedConfig), ...patch },
      };
    });
  const optionSelected = (field, value) => {
    const key = field.configKey || field.key;
    const current = selectedConfig[key];
    return field.multiple
      ? String(value) === "none"
        ? !current?.length
        : (current || []).some((item) => String(item) === String(value))
      : String(current ?? "") === String(value);
  };
  const fieldLabel = (field) => {
    const key = field.configKey || field.key;
    const current = selectedConfig[key];
    if (field.multiple) {
      if (!current?.length) return "Skills";
      return `Skills · ${current.length}`;
    }
    if (field.key === "ratio") return ratioChipLabel(current);
    return (
      field.options.find(
        (option) => String(option.value) === String(current ?? ""),
      )?.label || field.label
    );
  };
  const usesImagePrice =
    selectedTool?.id === "t2i" ||
    (selectedTool?.id === "assistant" && selectedConfig.skill === "image");
  const explicitModel =
    modelOptions.find((model) => model.id === selectedConfig.model) || null;
  const fieldCaption = (field) => {
    if (field.key === "model") {
      const priced = usesImagePrice
        ? explicitModel
        : modelWithReasoningPrice(explicitModel, selectedConfig.reasoningEffort);
      const priceLabel = compactModelPriceLabel(priced, { perImage: usesImagePrice });
      return priceLabel ? `${field.label} · ${priceLabel}` : field.label;
    }
    return field.label;
  };
  const fieldValueText = (field) => {
    if (field.key === "skill" && field.multiple) {
      const count = selectedConfig.skills?.length || 0;
      return count ? `${count} 项` : "未选";
    }
    return fieldLabel(field);
  };
  const renderField = (field) => (
    <div
      key={`${selectedToolId}-${field.key}`}
      className="studio-composer__field-wrap"
    >
      <button
        type="button"
        className={`studio-composer__control is-field is-${field.key}${CAPTIONED_FIELDS.has(field.key) ? " is-captioned" : ""}${activePanel === `field:${field.key}` ? " is-open" : ""}`}
        title={field.label}
        aria-label={`${field.label} ${fieldValueText(field)}`}
        aria-expanded={activePanel === `field:${field.key}`}
        onClick={(event) => {
          event.stopPropagation();
          setActivePanel((current) =>
            current === `field:${field.key}` ? "" : `field:${field.key}`,
          );
        }}
      >
        {CAPTIONED_FIELDS.has(field.key) ? (
          <small>{fieldCaption(field)}</small>
        ) : null}
        <span className="studio-composer__control-value">
          {field.key === "ratio" ? (
            <i
              className={`studio-composer__ratio-preview ${ratioPreviewClass(selectedConfig.ratio)}`}
              style={ratioPreviewStyle(selectedConfig.ratio)}
              aria-hidden="true"
            />
          ) : null}
          {field.key !== "ratio" && !CAPTIONED_FIELDS.has(field.key) ? (
            <i className={`bi ${field.icon}`} />
          ) : null}
          <em>{fieldValueText(field)}</em>
          <i className="bi bi-chevron-down" />
        </span>
      </button>
      {activePanel === `field:${field.key}` && (
        <div
          className={`studio-composer__field-menu is-${field.key}`}
          role="listbox"
          aria-label={field.label}
          aria-multiselectable={field.multiple || undefined}
        >
          {field.options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              title={option.label}
              aria-selected={optionSelected(field, option.value)}
              className={optionSelected(field, option.value) ? "is-selected" : ""}
              onClick={() => selectOption(field, option.value)}
            >
              {field.key === "ratio" ? (
                <>
                  <i
                    className={`studio-composer__ratio-preview ${ratioPreviewClass(option.value)}`}
                    style={ratioPreviewStyle(option.value)}
                    aria-hidden="true"
                  />
                  <small>{ratioChipLabel(option.value)}</small>
                </>
              ) : (
                <>
                  {option.icon && (
                    <i className={`bi ${option.icon}`} aria-hidden="true" />
                  )}
                  <span className="studio-composer__field-option-copy">
                    <strong>{option.label}</strong>
                    {option.description && (
                      <small>{option.description}</small>
                    )}
                  </span>
                  {option.priceModel ? (
                    <StudioModelPrice
                      model={option.priceModel}
                      perImage={option.perImage}
                    />
                  ) : null}
                  {optionSelected(field, option.value) && (
                    <i className="bi bi-check2" />
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const selectOption = (field, value) => {
    const key = field.configKey || field.key;
    if (field.multiple) {
      const current = Array.isArray(selectedConfig[key])
        ? selectedConfig[key]
        : [];
      updateSelectedConfig({
        [key]:
          String(value) === "none"
            ? []
            : current.some((item) => String(item) === String(value))
              ? current.filter((item) => String(item) !== String(value))
              : [...current, value],
      });
    } else {
      const patch = { [key]: value };
      if (selectedTool?.id === "assistant" && key === "skill") {
        const nextModels =
          value === "image" ? assistantModels.image : assistantModels.conversation;
        patch.mode = value;
        patch.model = nextModels[0]?.id || "";
        patch.reasoningEffort =
          value === "image" ? "" : firstReasoningEffort(nextModels[0]);
      }
      updateSelectedConfig(patch);
      setActivePanel("");
    }
  };

  const loadRecent = useCallback(async () => {
    recentControllerRef.current?.abort();
    if (!auth.isAuthenticated) {
      setRecentTasks([]);
      setRecentLoading(false);
      return;
    }
    const controller = new AbortController();
    recentControllerRef.current = controller;
    setRecentLoading(true);
    try {
      const result = await listTasks({ limit: 12, excludeSource: "react_canvas", signal: controller.signal });
      if (mountedRef.current && !controller.signal.aborted)
        setRecentTasks(
          (result.items || []).filter(
            (task) =>
              taskThumbnailUrl(task) ||
              taskOriginalUrl(task) ||
              task.status === "succeeded",
          ),
        );
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setRecentTasks([]);
    } finally {
      if (mountedRef.current && recentControllerRef.current === controller)
        setRecentLoading(false);
    }
  }, [auth.isAuthenticated]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    Promise.allSettled([
      fetchRuntimeConfig().then((config) => {
        if (mountedRef.current) setRuntimeConfig(config);
      }),
      fetchAssistantConfig(controller.signal).then((config) => {
        if (!mountedRef.current) return;
        const normalize = (items) =>
          (Array.isArray(items) ? items : [])
            .map((item) => normalizeModel({ ...item, id: item?.model }))
            .filter(Boolean);
        setAssistantModels({
          conversation: normalize(config?.conversationModels),
          image: normalize(config?.imageModels),
        });
      }),
    ]).catch(() => null);
    void loadRecent();
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = () => mountedRef.current && setVoiceListening(true);
      recognition.onend = () => mountedRef.current && setVoiceListening(false);
      recognition.onerror = () => {
        if (mountedRef.current) {
          setVoiceListening(false);
          notificationService.warning("语音识别暂时不可用");
        }
      };
      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1)
          transcript += event.results[index]?.[0]?.transcript || "";
        if (mountedRef.current)
          setDraftPrompt(
            (current) =>
              `${current.trim()}${current.trim() && transcript ? "\n" : ""}${transcript}`,
          );
      };
      recognitionRef.current = recognition;
      setVoiceSupported(true);
    }
    return () => {
      mountedRef.current = false;
      controller.abort();
      recentControllerRef.current?.abort();
      uploadControllerRef.current?.abort();
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    };
  }, [loadRecent]);

  useEffect(() => {
    if (
      composerTools.length &&
      !composerTools.some((tool) => tool.id === selectedToolId)
    )
      setSelectedToolId(composerTools[0].id);
  }, [composerTools, selectedToolId]);

  useEffect(() => {
    const usesImageParams =
      selectedTool?.id === "t2i" ||
      (selectedTool?.id === "assistant" && selectedConfig.skill === "image");
    if (!usesImageParams) return;
    const resolutionField = fields.find((field) => field.key === "resolution");
    const qualityField = fields.find((field) => field.key === "quality");
    const ratioField = fields.find((field) => field.key === "ratio");
    const patch = {};
    if (
      resolutionField?.options.length &&
      !resolutionField.options.some(
        (option) => String(option.value) === String(selectedConfig.resolution),
      )
    )
      patch.resolution = resolutionField.options[0].value;
    if (
      qualityField?.options.length &&
      !qualityField.options.some(
        (option) => String(option.value) === String(selectedConfig.quality),
      )
    )
      patch.quality = qualityField.options[0].value;
    if (
      ratioField?.options.length &&
      !ratioField.options.some(
        (option) => String(option.value) === String(selectedConfig.ratio),
      )
    )
      patch.ratio = ratioField.options[0].value;
    if (Object.keys(patch).length) updateSelectedConfig(patch);
  }, [
    fields,
    selectedConfig.quality,
    selectedConfig.ratio,
    selectedConfig.resolution,
    selectedConfig.skill,
    selectedTool?.id,
  ]);

  useEffect(() => {
    if (!modelOptions.length) return;
    const toolId = selectedTool?.id || "t2i";
    const firstModelId = modelOptions[0]?.id;
    if (!firstModelId) return;
    setLaunchConfigs((current) => {
      const prev = current[toolId] || {};
      if (modelOptions.some((model) => model.id === prev.model)) return current;
      return { ...current, [toolId]: { ...prev, model: firstModelId } };
    });
  }, [modelOptions, selectedTool?.id]);

  useEffect(() => {
    if (selectedTool?.id !== "assistant" || selectedConfig.skill === "image") return;
    const toolId = selectedTool.id;
    const next = firstReasoningEffort(selectedModel);
    if (!next) return;
    setLaunchConfigs((current) => {
      const prev = current[toolId] || {};
      const currentValid = listReasoningEfforts(selectedModel).some(
        (item) => item.id === prev.reasoningEffort,
      );
      if (currentValid) return current;
      return { ...current, [toolId]: { ...prev, reasoningEffort: next } };
    });
  }, [selectedConfig.skill, selectedModel, selectedTool?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setScopedLocalItem(
        COMPOSER_DRAFT_KEY,
        JSON.stringify({
          prompt: draftPrompt,
          toolId: selectedToolId,
          configs: launchConfigs,
          references: persistableReferences(references),
        }),
      );
    }, 240);
    return () => window.clearTimeout(timer);
  }, [draftPrompt, launchConfigs, references, selectedToolId]);

  useEffect(() => {
    setPromptCategory("all");
    setPromptSearchDraft("");
    setPromptSearch("");
  }, [selectedToolId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setPromptSearch(promptSearchDraft.trim()),
      280,
    );
    return () => window.clearTimeout(timer);
  }, [promptSearchDraft]);

  useEffect(() => {
    if (!promptDialog.mounted) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeydown = (event) => {
      if (event.key === "Escape") setActivePanel("");
    };
    window.addEventListener("keydown", onKeydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeydown);
    };
  }, [promptDialog.mounted]);

  useEffect(() => {
    if (!promptDialog.mounted) return undefined;
    const node = promptCatsRef.current;
    if (!node) return undefined;
    updatePromptCatsOverflow();
    const onWheel = (event) => {
      if (node.scrollWidth <= node.clientWidth) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY + event.deltaX;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePromptCatsOverflow);
    observer?.observe(node);
    return () => {
      node.removeEventListener("wheel", onWheel);
      observer?.disconnect();
    };
  }, [promptCategoryChips.length, promptDialog.mounted, updatePromptCatsOverflow]);

  useEffect(() => {
    if (activePanel !== "prompts" || !selectedTool) return;
    const type = promptLibraryType(selectedTool);
    let cancelled = false;
    listPromptCategories({ type })
      .then((items) => {
        if (!cancelled && mountedRef.current) setPromptCategories(items || []);
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setPromptCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, selectedTool]);

  useEffect(() => {
    if (activePanel !== "prompts" || !selectedTool) return;
    const type = promptLibraryType(selectedTool);
    const requestId = ++promptRequestRef.current;
    setPromptLoading(true);
    setPromptLoadingMore(false);
    listPromptLibrary(type, {
      pageNumber: 1,
      pageSize: STUDIO_PROMPT_PAGE_SIZE,
      category: promptCategory,
      search: promptSearch,
    })
      .then((result) => {
        if (requestId !== promptRequestRef.current || !mountedRef.current) return;
        setPromptLibrary({
          items: mapPromptLibraryItems(result.items),
          page: 1,
          hasMore: result.hasMore === true,
          total: Number(result.total || 0),
        });
      })
      .catch(() => {
        if (requestId !== promptRequestRef.current || !mountedRef.current) return;
        setPromptLibrary({ items: [], page: 1, hasMore: false, total: 0 });
      })
      .finally(() => {
        if (requestId === promptRequestRef.current && mountedRef.current)
          setPromptLoading(false);
      });
  }, [activePanel, promptCategory, promptSearch, selectedTool]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduce: "(prefers-reduced-motion: reduce)",
          motion: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          if (context.conditions.reduce) {
            gsap.set(
              "[data-studio-enter], [data-studio-tool], [data-studio-reveal], [data-studio-orb]",
              { clearProps: "all" },
            );
            return;
          }
          gsap.from("[data-studio-enter]", {
            autoAlpha: 0,
            y: 24,
            duration: 0.65,
            ease: "power3.out",
            stagger: 0.08,
            clearProps: "transform,opacity,visibility",
          });
          gsap.from("[data-studio-tool]", {
            autoAlpha: 0,
            y: 28,
            scale: 0.985,
            duration: 0.55,
            ease: "power2.out",
            stagger: 0.05,
            delay: 0.12,
            clearProps: "transform,opacity,visibility",
          });
          gsap.utils.toArray("[data-studio-reveal]").forEach((element) =>
            gsap.from(element, {
              autoAlpha: 0,
              y: 36,
              duration: 0.7,
              ease: "power3.out",
              clearProps: "transform,opacity,visibility",
              scrollTrigger: {
                trigger: element,
                start: "top 88%",
                once: true,
                fastScrollEnd: true,
              },
            }),
          );
          gsap.utils.toArray("[data-studio-orb]").forEach((orb, index) =>
            gsap.to(orb, {
              y: index % 2 ? 12 : -14,
              x: index % 2 ? -8 : 10,
              duration: 4.8 + index * 0.6,
              ease: "sine.inOut",
              repeat: -1,
              yoyo: true,
              force3D: true,
            }),
          );
        },
      );
      return () => media.revert();
    },
    { scope: rootRef },
  );

  const openPromptLibrary = () => {
    setActivePanel((current) => (current === "prompts" ? "" : "prompts"));
  };

  const applyPromptItem = (item) => {
    setDraftPrompt(item.prompt);
    if (item.id)
      void recordPromptEngagement(item.id, "use", true).catch(() => null);
    setActivePanel("");
  };

  const loadMorePrompts = useCallback(async () => {
    const type = promptLibraryType(selectedTool);
    if (!selectedTool || promptLoading || promptLoadingMore || !promptLibrary.hasMore)
      return;
    const requestId = promptRequestRef.current;
    const nextPage = promptLibrary.page + 1;
    setPromptLoadingMore(true);
    try {
      const result = await listPromptLibrary(type, {
        pageNumber: nextPage,
        pageSize: STUDIO_PROMPT_PAGE_SIZE,
        category: promptCategory,
        search: promptSearch,
      });
      if (!mountedRef.current || requestId !== promptRequestRef.current) return;
      const incoming = mapPromptLibraryItems(result.items);
      setPromptLibrary((current) => {
        const seen = new Set(current.items.map((item) => item.id));
        return {
          ...current,
          items: [
            ...current.items,
            ...incoming.filter((item) => !seen.has(item.id)),
          ],
          page: nextPage,
          hasMore: result.hasMore === true && incoming.length > 0,
          total: Number(result.total || current.total),
        };
      });
    } finally {
      if (mountedRef.current && requestId === promptRequestRef.current)
        setPromptLoadingMore(false);
    }
  }, [
    promptCategory,
    promptLibrary.hasMore,
    promptLibrary.page,
    promptLoading,
    promptLoadingMore,
    promptSearch,
    selectedTool,
  ]);

  useEffect(() => {
    if (activePanel !== "prompts" || promptLoading || promptLoadingMore) return;
    const node = promptListRef.current;
    if (!node || !promptLibrary.hasMore) return;
    if (node.scrollHeight <= node.clientHeight + 24) void loadMorePrompts();
  }, [
    activePanel,
    loadMorePrompts,
    promptLibrary.hasMore,
    promptLibrary.items.length,
    promptLoading,
    promptLoadingMore,
  ]);

  const addReferences = async (files) => {
    const incoming = Array.from(files || [])
      .filter((file) => file.type?.startsWith("image/"))
      .slice(
        0,
        Math.max(0, Math.min(MAX_COMPOSER_REFS, maxReferences) - references.length),
      );
    if (!incoming.length) return;
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setReferenceUploading(true);
    try {
      const uploaded = await Promise.all(
        incoming.map(async (file) => {
          const result = await uploadFile(file, { signal: controller.signal });
          return persistableReferences([
            {
              id: crypto.randomUUID(),
              name: file.name || "参考图",
              dataUrl: result.url,
              thumbnailUrl: result.thumbnailUrl || result.url,
              fileKey: result.key,
            },
          ])[0];
        }),
      );
      if (mountedRef.current && !controller.signal.aborted)
        setReferences((current) => [...current, ...uploaded]);
    } catch (error) {
      if (error?.name !== "AbortError")
        notificationService.error(error?.message || "参考图上传失败");
    } finally {
      if (mountedRef.current) setReferenceUploading(false);
    }
  };

  const startCreate = async (event) => {
    event.preventDefault();
    if (requestAuth({ featureLabel: selectedTool?.label || "创作台" })) return;
    const prompt = draftPrompt.trim();
    if (!selectedTool || launchSubmitting || referenceUploading) return;
    if (!prompt) {
      notificationService.info("请先输入创作内容");
      return;
    }
    const config = {
      ...selectedConfig,
      skills: [...(selectedConfig.skills || [])],
      referenceImages: references.map((item) => ({ ...item })),
      autoStart: true,
      costConfirmed: true,
    };
    if (selectedTool.id === "assistant") {
      const assistantSkill = selectedConfig.skill === "image"
        ? "image"
        : selectedConfig.skill === "chat"
          ? "chat"
          : "agent";
      config.mode = assistantSkill;
      config.skill = assistantSkill;
      if (assistantSkill !== "image" && selectedConfig.reasoningEffort) {
        config.reasoningEffort = selectedConfig.reasoningEffort;
      }
      config.count =
        imageCountFromPrompt(prompt) || Math.max(1, Number(config.count) || 2);
      if (config.mode === "image") {
        const resolution = String(config.resolution || "1K").toUpperCase();
        config.resolution = resolution;
        config.quality =
          { "1K": "low", "2K": "medium", "4K": "high" }[resolution] || "high";
      }
    }
    setLaunchSubmitting(true);
    try {
      const [wallet, unit] = await Promise.all([
        getWallet().catch(() => null),
        selectedTool.id === "assistant"
          ? Promise.resolve(null)
          : getFeatureUnitPriceCents("wallpaper"),
      ]);
      const count =
        selectedTool.id === "assistant"
          ? 1
          : Math.max(1, Math.min(4, Number(config.count) || 1));
      const assistantImageMode = selectedConfig.skill === "image";
      const assistantModel = (
        assistantImageMode ? assistantModels.image : assistantModels.conversation
      ).find((item) => item.id === config.model) ||
        (assistantImageMode
          ? assistantModels.image[0]
          : assistantModels.conversation[0]);
      const pricedAssistantModel = assistantImageMode
        ? assistantModel
        : modelWithReasoningPrice(assistantModel, config.reasoningEffort);
      const assistantUnit = Math.max(
        0,
        Number(resolveModelPointPricing(pricedAssistantModel).effective ?? 0),
      );
      const assistantTotal = assistantImageMode
        ? assistantUnit * Math.min(4, Number(config.count) || 2)
        : assistantUnit;
      const unitPrice =
        selectedTool.id === "assistant"
          ? assistantTotal
          : Number(
              resolveModelPointPricing(selectedModel).effective ??
                selectedModel?.pricePoints ??
                unit ??
                0,
            );
      setPendingLaunch({ tool: selectedTool, prompt, config });
      setCost({
        billingMode: "credits",
        unitCost: unitPrice * count,
        unitPriceCents: unitPrice,
        totalPriceCents: unitPrice * count,
        count,
        unitLabel: selectedTool.id === "assistant" ? "次" : "张",
        featureLabel:
          selectedTool.id === "assistant"
            ? selectedConfig.skill === "image"
              ? "AI 助手 图片生成"
              : selectedConfig.skill === "chat"
                ? "AI 助手 问答"
                : "AI 助手 Agent"
            : "文生图",
        summary:
          selectedTool.id === "assistant"
            ? "确认后将进入一个全新的对话并立即执行；按实际路由结算，多余预留积分自动退回。"
            : "确认后将进入文生图工作台并立即执行；失败或取消时由服务端退回未结算积分。",
        creditAvailable: auth.isAuthenticated
          ? Number(
              wallet?.normalBalanceCents ??
                wallet?.availableCents ??
                wallet?.balanceCents ??
                0,
            )
          : null,
      });
    } catch (error) {
      notificationService.error(error?.message || "积分计算失败，请稍后重试");
    } finally {
      if (mountedRef.current) setLaunchSubmitting(false);
    }
  };

  const confirmLaunch = () => {
    if (!pendingLaunch) return;
    stashPendingPrompt({
      prompt: pendingLaunch.prompt,
      taskType: pendingLaunch.tool.taskType || pendingLaunch.tool.id || "t2i",
      config: pendingLaunch.config,
    });
    navigate(pendingLaunch.tool.to);
    setCost(null);
    setPendingLaunch(null);
  };

  return (
    <>
      <main
        ref={rootRef}
        className="studio-hub"
        onPointerDown={(event) => {
          if (
            !event.target.closest(
              ".studio-composer__popover, .studio-composer__field-wrap, .studio-composer__control.is-workflow, .studio-composer__control.is-library, .studio-prompt-layer",
            )
          )
            setActivePanel("");
        }}
        onPaste={(event) => {
          const inOtherField =
            event.target.closest(
              "input, textarea, [contenteditable='true']",
            ) && !event.target.closest(".studio-composer");
          if (inOtherField || maxReferences <= 0) return;
          const files = clipboardImageFiles(event.clipboardData);
          if (!files.length) return;
          if (references.length >= maxReferences) {
            notificationService.info(`参考图最多 ${maxReferences} 张`);
            return;
          }
          event.preventDefault();
          const text = String(event.clipboardData?.getData("text/plain") || "");
          if (text && event.target.closest(".studio-composer__input"))
            setDraftPrompt((current) => `${current}${text}`.slice(0, 2000));
          void addReferences(files);
        }}
      >
        <div className="studio-hub__atmosphere" aria-hidden="true">
          <div className="studio-hub__aurora" />
          <div className="studio-hub__blinds" />
          <span className="studio-hub__orb is-a" data-studio-orb />
          <span className="studio-hub__orb is-b" data-studio-orb />
        </div>
        <div className="studio-hub__shell">
          <header className="studio-hero">
            <h1 className="studio-hero__brand" data-studio-enter>
              星空云绘
            </h1>
            <div className="studio-hero__lead" data-studio-enter>
              <StudioTypeLine texts={leadLines} />
            </div>
            <form
              ref={composerRef}
              className={`studio-composer${activePanel ? " has-open-panel" : ""}`}
              data-studio-enter
              onSubmit={startCreate}
            >
              {maxReferences > 0 && (
                <div
                  className={`studio-composer__ref-dock${references.length || referenceUploading ? " has-refs" : ""}`}
                  aria-label="参考图"
                >
                  {references.map((item, index) => (
                    <figure
                      key={item.id}
                      className="studio-composer__reference"
                    >
                      <AuthenticatedImage
                        src={item.thumbnailUrl || item.dataUrl}
                        alt={item.name}
                        maxDimension={128}
                      />
                      <em>{index + 1}</em>
                      <button
                        type="button"
                        title="移除参考图"
                        aria-label="移除参考图"
                        onClick={() =>
                          setReferences((current) =>
                            current.filter(
                              (reference) => reference.id !== item.id,
                            ),
                          )
                        }
                      >
                        <i className="bi bi-x-lg" />
                      </button>
                    </figure>
                  ))}
                  {referenceUploading && (
                    <span
                      className="studio-composer__reference is-loading"
                      aria-label="正在上传"
                    />
                  )}
                  {references.length < maxReferences && (
                    <button
                      type="button"
                      className="studio-composer__add-ref"
                      disabled={referenceUploading}
                      title={`添加参考图，最多 ${maxReferences} 张`}
                      aria-label="添加参考图"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <i className="bi bi-plus-lg" />
                    </button>
                  )}
                </div>
              )}
              <div className="studio-composer__prompt">
                <textarea
                  value={draftPrompt}
                  className="studio-composer__input"
                  rows="4"
                  maxLength="2000"
                  placeholder="描述你想做的画面、角色、风格或界面…"
                  aria-label="创作描述"
                  onChange={(event) => setDraftPrompt(event.target.value)}
                />
                <div className="studio-composer__dock">
                  <div className="studio-composer__controls">
                    <div className="studio-composer__rail">
                    <div className="studio-composer__workflow-wrap">
                      <button
                        type="button"
                        className={`studio-composer__control is-workflow${activePanel === "tools" ? " is-open" : ""}`}
                        aria-expanded={activePanel === "tools"}
                        onClick={(event) => {
                          event.stopPropagation();
                          setActivePanel((current) =>
                            current === "tools" ? "" : "tools",
                          );
                        }}
                      >
                        <i className={`bi ${selectedTool?.icon || "bi-stars"}`} />
                        <span>{selectedTool?.label}</span>
                        <i className="bi bi-chevron-down" />
                      </button>
                      {activePanel === "tools" && (
                        <div
                          className="studio-composer__popover studio-composer__popover--tools"
                          role="menu"
                          aria-label="选择创作工具"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <p className="studio-composer__popover-label">创作工具</p>
                          <div className="studio-composer__tool-menu">
                            {composerTools.map((tool) => (
                              <button
                                key={tool.id}
                                type="button"
                                className={selectedToolId === tool.id ? "is-active" : ""}
                                role="menuitem"
                                onClick={() => {
                                  setSelectedToolId(tool.id);
                                  setActivePanel("");
                                }}
                              >
                                <i className={`bi ${tool.icon}`} />
                                <span>
                                  <strong>{tool.label}</strong>
                                  <small>{tool.tagline}</small>
                                </span>
                                {selectedToolId === tool.id && <i className="bi bi-check2" />}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="studio-composer__rail-group">
                    {fields.map(renderField)}
                    <button
                      type="button"
                      className={`studio-composer__control is-icon is-library${activePanel === "prompts" ? " is-open" : ""}`}
                      title="提示词库"
                      aria-label="提示词库"
                      aria-expanded={activePanel === "prompts"}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openPromptLibrary();
                      }}
                    >
                      <i className="bi bi-book" />
                    </button>
                    </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(event) => {
                        void addReferences(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                  <div className="studio-composer__commit">
                    {voiceListening && (
                      <span className="studio-composer__voice-status">
                        正在聆听
                      </span>
                    )}
                    <span
                      className={`studio-composer__count${draftPrompt.length ? " is-visible" : ""}`}
                    >
                      {draftPrompt.length}
                      <small>/2000</small>
                    </span>
                    <div className="studio-composer__actions">
                      <button
                        type="button"
                        className={`studio-composer__voice${voiceListening ? " is-listening" : ""}`}
                        disabled={!voiceSupported}
                        title={
                          voiceSupported
                            ? voiceListening
                              ? "停止语音输入"
                              : "语音输入"
                            : "当前浏览器不支持语音输入"
                        }
                        aria-label={voiceListening ? "停止语音输入" : "语音输入"}
                        aria-pressed={voiceListening}
                        onClick={() => {
                          if (voiceListening) recognitionRef.current?.stop?.();
                          else {
                            recognitionRef.current.lang = "zh-CN";
                            recognitionRef.current?.start?.();
                          }
                        }}
                      >
                        <i
                          className={`bi ${voiceListening ? "bi-stop-fill" : "bi-mic"}`}
                        />
                      </button>
                      <button
                        type="submit"
                        className="studio-composer__submit"
                        disabled={
                          auth.isAuthenticated &&
                          (!selectedTool ||
                            !draftPrompt.trim() ||
                            referenceUploading ||
                            launchSubmitting)
                        }
                        title="开始创作"
                        aria-label="开始创作"
                      >
                        <i className="bi bi-arrow-up" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </header>
          <section
            className="studio-section"
            aria-label="创作工具"
            data-studio-reveal
          >
            <div className="studio-section__head">
              <div>
                <h2>创作工具</h2>
              </div>
              <Link to="/prompts">去提示词库 →</Link>
            </div>
            {wallTools.length > 0 && (
              <div className="studio-bento">
                {wallTools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={tool.to}
                    className={`studio-bento__item is-${tool.id}`}
                    data-studio-tool
                  >
                    {tool.cover && (
                      <img
                        src={tool.cover}
                        alt={tool.label}
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          const png = tool.cover.replace(/\.webp$/i, ".png");
                          if (png !== tool.cover) event.currentTarget.src = png;
                        }}
                      />
                    )}
                    <div className="studio-bento__copy">
                      <strong>
                        <i className={`bi ${tool.icon}`} /> {tool.label}
                      </strong>
                      {tool.tagline && <span>{tool.tagline}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          {ecommerceTool && (
            <section
              className="studio-section studio-section--commerce"
              aria-label="AI 电商"
              data-studio-reveal
            >
              <div className="studio-section__head">
                <div>
                  <h2>AI 电商</h2>
                  <p>商品、人物与营销视觉独立工作流</p>
                </div>
                <Link to={ecommerceGroups[0]?.to || ecommerceTool.to}>
                  进入电商工作台 →
                </Link>
              </div>
              <div className="studio-commerce-module">
                <div className="studio-commerce-groups" aria-label="电商业务分组">
                  {ecommerceGroups.map((group) => (
                    <Link
                      key={group.id}
                      to={group.to}
                      className={`studio-commerce-group is-${group.id}`}
                      data-studio-tool
                    >
                      <img
                        src={group.cover}
                        alt={group.label}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="studio-commerce-group__copy">
                        <strong>{group.label}</strong>
                        <small>{group.description}</small>
                      </span>
                    </Link>
                  ))}
                </div>
                <div
                  className="studio-commerce-module__modes"
                  aria-label="电商工具快捷入口"
                >
                  {ecommerceModes.map((mode) => (
                    <Link
                      key={mode.id}
                      to={`${ecommerceTool.to}?tool=${mode.id}`}
                      className="studio-commerce-mode"
                      data-studio-tool
                    >
                      <img
                        src={ecomToolCover(mode.id)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="studio-commerce-mode__copy">
                        <strong>{mode.shortLabel || mode.label}</strong>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )}
          <section
            className="studio-section studio-section--recent"
            aria-label="最近创作"
            data-studio-reveal
          >
            <div className="studio-section__head">
              <div>
                <h2>最近创作</h2>
              </div>
              <Link to="/history">查看全部 →</Link>
            </div>
            {!auth.isAuthenticated ? (
              <div className="studio-recent-login">
                <strong>登录后查看最近作品</strong>
                <span>同步云端任务进度与历史记录</span>
                <Link className="ch-btn is-primary" to="/auth?mode=login">
                  去登录
                </Link>
              </div>
            ) : recentLoading ? (
              <div className="studio-recent-loading">正在读取最近创作…</div>
            ) : !recentTasks.length ? (
              <div className="studio-recent-empty">
                <strong>还没有作品</strong>
                <span>在上方输入想法，或从工具墙开始第一次创作</span>
              </div>
            ) : (
              <div
                className="ch-masonry"
                style={{ "--ch-masonry-cols": columnCount }}
              >
                {columns.map((column, index) => (
                  <div key={index} className="ch-masonry__col">
                    {column.map((item) => (
                      <Link
                        key={item.key}
                        className="ch-card"
                        to="/history"
                        title={taskPrompt(item.task) || "查看历史"}
                      >
                        <div
                          className="ch-card__media"
                          style={{ aspectRatio: item.aspect }}
                        >
                          {item.src ? (
                            <AuthenticatedImage
                              src={item.src}
                              fallbackSrc={item.fallbackSrc}
                              alt={taskPrompt(item.task) || "AI 作品"}
                              loading={
                                item.index < Math.max(4, columnCount * 2)
                                  ? "eager"
                                  : "lazy"
                              }
                              rootMargin="240px 0px"
                              retryCount={2}
                              maxDimension={
                                failedThumbs.has(item.key) ? 0 : 720
                              }
                              onError={() =>
                                setFailedThumbs(
                                  (current) => new Set([...current, item.key]),
                                )
                              }
                            />
                          ) : (
                            <div className="ch-card__placeholder">
                              <i className="bi bi-image" />
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      {promptDialog.mounted &&
        createPortal(
          <div
            className={`studio-prompt-layer ${dialogTransitionClass(promptDialog.phase)}`}
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setActivePanel("");
            }}
          >
            <section
              className="studio-prompt-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="studio-prompt-title"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="studio-composer__popover-head">
                <div className="studio-composer__prompt-title">
                  <h2 id="studio-prompt-title">{selectedTool?.label}提示词</h2>
                  {promptLibrary.total > 0 && (
                    <small>{promptLibrary.total} 条</small>
                  )}
                </div>
                <button
                  type="button"
                  title="关闭"
                  aria-label="关闭"
                  onClick={() => setActivePanel("")}
                >
                  <i className="bi bi-x-lg" />
                </button>
              </div>
              <label className="studio-composer__prompt-search">
                <i className="bi bi-search" aria-hidden="true" />
                <input
                  type="search"
                  value={promptSearchDraft}
                  placeholder="搜索标题或提示词"
                  autoComplete="off"
                  onChange={(event) => setPromptSearchDraft(event.target.value)}
                />
                {promptSearchDraft && (
                  <button
                    type="button"
                    title="清空搜索"
                    aria-label="清空搜索"
                    onClick={() => setPromptSearchDraft("")}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                )}
              </label>
              {promptCategoryChips.length > 1 && (
                <div
                  className={`studio-prompt-cats-wrap${promptCatsOverflow.left ? " has-left" : ""}${promptCatsOverflow.right ? " has-right" : ""}`}
                >
                  {promptCatsOverflow.left && (
                    <button
                      type="button"
                      className="studio-prompt-cats-nav is-prev"
                      title="向左查看分类"
                      aria-label="向左查看分类"
                      onClick={() => slidePromptCats(-1)}
                    >
                      <i className="bi bi-chevron-left" />
                    </button>
                  )}
                  <div
                    ref={promptCatsRef}
                    className="studio-composer__prompt-cats"
                    role="tablist"
                    aria-label="提示词分类"
                    onScroll={updatePromptCatsOverflow}
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      const node = promptCatsRef.current;
                      if (!node) return;
                      promptCatsDragRef.current = {
                        active: true,
                        moved: false,
                        startX: event.clientX,
                        startLeft: node.scrollLeft,
                      };
                      node.setPointerCapture?.(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const drag = promptCatsDragRef.current;
                      const node = promptCatsRef.current;
                      if (!drag.active || !node) return;
                      const delta = event.clientX - drag.startX;
                      if (Math.abs(delta) > 4) drag.moved = true;
                      if (drag.moved) node.scrollLeft = drag.startLeft - delta;
                    }}
                    onPointerUp={() => {
                      promptCatsDragRef.current.active = false;
                    }}
                    onPointerCancel={() => {
                      promptCatsDragRef.current.active = false;
                    }}
                  >
                    {promptCategoryChips.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={promptCategory === item.key}
                        className={promptCategory === item.key ? "is-active" : ""}
                        onClick={(event) => {
                          if (promptCatsDragRef.current.moved) return;
                          setPromptCategory(item.key);
                          event.currentTarget.scrollIntoView({
                            inline: "center",
                            block: "nearest",
                            behavior: "smooth",
                          });
                        }}
                      >
                        {item.label}
                        {item.key !== "all" && item.count > 0 ? ` ${item.count}` : ""}
                      </button>
                    ))}
                  </div>
                  {promptCatsOverflow.right && (
                    <button
                      type="button"
                      className="studio-prompt-cats-nav is-next"
                      title="向右查看分类"
                      aria-label="向右查看分类"
                      onClick={() => slidePromptCats(1)}
                    >
                      <i className="bi bi-chevron-right" />
                    </button>
                  )}
                </div>
              )}
              {promptLoading ? (
                <div className="studio-composer__prompt-empty">
                  正在加载提示词…
                </div>
              ) : promptLibrary.items.length ? (
                <div
                  ref={promptListRef}
                  className="studio-prompt-scroll"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    if (
                      promptLibrary.hasMore &&
                      !promptLoadingMore &&
                      node.scrollTop + node.clientHeight >= node.scrollHeight - 120
                    )
                      void loadMorePrompts();
                  }}
                >
                  <div className="studio-composer__prompt-menu">
                    {promptLibrary.items.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => applyPromptItem(item)}
                      >
                        {item.coverUrl ? (
                          <AuthenticatedImage
                            src={item.coverUrl}
                            alt=""
                            loading="lazy"
                            maxDimension={320}
                          />
                        ) : (
                          <span className="studio-composer__prompt-cover" aria-hidden="true">
                            <i className="bi bi-stars" />
                          </span>
                        )}
                        <span className="studio-composer__prompt-copy">
                          <strong>{item.label}</strong>
                          {item.category ? (
                            <small>{promptCategoryLabel(item.category)}</small>
                          ) : null}
                          <span>{item.prompt}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {promptLoadingMore && (
                    <p className="studio-composer__prompt-more">正在加载更多…</p>
                  )}
                  {!promptLibrary.hasMore && (
                    <p className="studio-composer__prompt-more">已经到底了</p>
                  )}
                </div>
              ) : (
                <div className="studio-composer__prompt-empty">
                  {promptSearch ? "没有匹配的提示词" : "暂无提示词"}
                </div>
              )}
              <div className="studio-composer__prompt-foot">
                <Link to="/prompts" onClick={() => setActivePanel("")}>
                  查看完整词库
                </Link>
              </div>
            </section>
          </div>,
          document.body,
        )}
      <StudioCostDialog
        cost={cost}
        onConfirm={confirmLaunch}
        onCancel={() => {
          setCost(null);
          setPendingLaunch(null);
        }}
      />
    </>
  );
}
