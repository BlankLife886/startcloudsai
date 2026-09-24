<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Check, Close, Connection, Cpu, Delete, EditPen, Loading, Plus, Refresh, Search, Upload } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";
import { useClientPagination } from "@/useClientPagination";
import { formatPoints, IMAGE_SERVICE_ROUTES, normalizePoints } from "@/utils";
import { exactSizeLimits, schemaSupportsExactSize, validateExactSizeLimits, type ExactSizeLimits } from "@/exactImageSize";

type ProviderAdapter = "openai" | "crun";
type ModelKind = "image" | "chat" | "image_tool";
type ModelStatus = "available" | "maintenance";
type ImageTool = string;
type ReasoningPriceScope = "assistant" | "canvas_agent";
type WorkspaceKey =
  | "assistant"
  | "t2i"
  | "coloring"
  | "ui_design"
  | "ecommerce_design"
  | "model_sheet"
  | "game_art"
  | "infinite_canvas";

interface ModelProvider {
  id: string;
  name: string;
  adapter: ProviderAdapter;
  baseUrl: string;
  apiKey: string;
  timeoutSecs: number;
  maxConcurrency: number;
  enabled: boolean;
  discoveredModels: string[];
  routes: ProviderRoute[];
}

interface ProviderRoute {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeoutSecs: number;
  maxConcurrency: number;
  enabled: boolean;
}

interface ReasoningEffortPricing {
  enabled?: boolean;
  assistantPriceCents: number;
  assistantDiscountPriceCents: number | null;
  canvasAgentPriceCents: number;
  canvasAgentDiscountPriceCents: number | null;
}

interface ReasoningPricing {
  defaultEffort: string;
  efforts: Record<string, ReasoningEffortPricing>;
}

interface ImageUpscalePricing {
  thresholdPixels: number;
  highPriceCents: number;
  highDiscountPriceCents: number | null;
  highUpstreamCostCents: number;
}

interface ModelItem {
  id: string;
  name: string;
  iconUrl: string;
  status: ModelStatus;
  providerId: string;
  upstreamModel: string;
  upstreamInputFields: string[];
  upstreamRequiredInputFields: string[];
  upstreamInputSchema: Record<string, unknown>;
  modality: string;
  operations: string[];
  kind: ModelKind;
  tool: ImageTool | "";
  description: string;
  priceCents: number;
  discountPriceCents: number | null;
  upstreamCostCents: number;
  allowZeroPrice: boolean;
  allowLossLeader: boolean;
  imageUpscalePricing: ImageUpscalePricing | null;
  fastMode: boolean;
  minSeconds: number;
  maxSeconds: number;
  resolutions: string[];
  supportsExactSize: boolean;
  exactSizeLimits: ExactSizeLimits;
  aspectRatios: string[];
  aspectRatiosByResolution: Record<string, string[]>;
  autoAspectRatios?: Record<string, string[]>;
  qualities: string[];
  transparentBackground: boolean;
  outputFormats: string[];
  moderationLevels: string[];
  maxReferenceImages: number;
  maxImages: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportedReasoningEfforts: string[];
  reasoningEnabled?: boolean;
  reasoningPricing: ReasoningPricing | null;
  public: boolean;
  default: boolean;
  enabled: boolean;
}

interface ModelConfig {
  version: number;
  providers: ModelProvider[];
  models: ModelItem[];
  workspaces: Record<WorkspaceKey, WorkspaceBinding>;
  editableFiles: EditableFileConfig;
}

interface EditableFileConfig {
  enabled: boolean;
  providerId: string;
  routeId: string;
}

interface WorkspaceBinding {
  modelIds: string[];
  defaultModelIds: Partial<Record<ModelKind, string>>;
  modelPricing: Record<string, WorkspaceModelPricing>;
  modelLimits: Record<string, WorkspaceModelLimits>;
}

/** 页面在模型自身配置之上追加的参考图 / 生成张数，只允许 >= 0。 */
interface WorkspaceModelLimits {
  extraReferenceImages: number;
  extraImages: number;
}

interface WorkspaceModelPricing {
  priceCents: number;
  discountPriceCents: number | null;
}

interface ModelDiscoveryResult {
  models: string[];
  entries?: ModelCatalogEntry[];
  modelCount: number;
  compatibleCount?: number;
  taskModelCount?: number;
  catalogSource?: string;
  warning?: string;
}

interface ModelSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  anyOf?: Array<Record<string, unknown>>;
  items?: Record<string, unknown>;
}

interface ModelCatalogEntry {
  id: string;
  kind: ModelKind | "";
  modelType?: string;
  modality?: string;
  operations?: string[];
  inputFields?: string[];
  requiredInputFields?: string[];
  inputSchema?: {
    type?: string;
    properties?: Record<string, ModelSchemaProperty>;
    required?: string[];
  };
  supportsReference?: boolean;
  compatible: boolean;
  incompatibility?: string;
}

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

interface ModelDraft extends Omit<
  ModelItem,
  "priceCents" | "discountPriceCents" | "upstreamCostCents" | "imageUpscalePricing"
> {
  pricePoints: number;
  discountEnabled: boolean;
  discountPoints: number;
  upstreamCostPoints: number;
  upscaleHighPricePoints: number;
  upscaleHighDiscountEnabled: boolean;
  upscaleHighDiscountPoints: number;
  upscaleHighUpstreamCostPoints: number;
  outputFormatsEnabled: boolean;
  moderationEnabled: boolean;
}

const IMAGE_ASPECT_RATIOS = [
  "auto",
  "16:9",
  "9:16",
  "1:1",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "4:3",
  "3:4",
  "21:9",
  "9:21",
];
const IMAGE_QUALITIES = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"];
const IMAGE_MODERATION_LEVELS = ["auto", "low"];
const EXACT_SIZE_FIELDS: Array<{
  key: keyof ExactSizeLimits;
  label: string;
  hint: string;
  min: number;
  max: number;
  precision: number;
}> = [
  { key: "minWidth", label: "最小宽度", hint: "单位：像素", min: 1, max: 16384, precision: 0 },
  { key: "maxWidth", label: "最大宽度", hint: "单位：像素", min: 1, max: 16384, precision: 0 },
  { key: "minHeight", label: "最小高度", hint: "单位：像素", min: 1, max: 16384, precision: 0 },
  { key: "maxHeight", label: "最大高度", hint: "单位：像素", min: 1, max: 16384, precision: 0 },
  { key: "step", label: "像素步长", hint: "宽、高都必须是此数的整数倍", min: 1, max: 16384, precision: 0 },
  { key: "maxAspectRatio", label: "最大长短边比", hint: "长边 ÷ 短边；0 表示不额外限制", min: 0, max: 16384, precision: 2 },
  { key: "minPixels", label: "最少总像素", hint: "宽 × 高；0 表示不额外限制", min: 0, max: 268435456, precision: 0 },
  { key: "maxPixels", label: "最多总像素", hint: "宽 × 高；0 表示不额外限制", min: 0, max: 268435456, precision: 0 },
];
const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};

function configuredReasoningOptions(model: { supportedReasoningEfforts?: string[]; reasoningPricing?: ReasoningPricing | null }) {
  return [...new Set([...Object.keys(REASONING_EFFORT_LABELS), ...(model.supportedReasoningEfforts || []), ...Object.keys(model.reasoningPricing?.efforts || {})])];
}

function defaultReasoningEffort(efforts: string[]) {
  return efforts.includes("medium") ? "medium" : efforts[0] || "";
}

function reasoningEffortEnabled(
  price: ReasoningEffortPricing | null | undefined,
) {
  return price?.enabled !== false;
}

function enabledReasoningEfforts(model: {
  supportedReasoningEfforts?: string[];
  reasoningPricing?: ReasoningPricing | null;
  reasoningEnabled?: boolean;
}) {
  if (model.reasoningEnabled === false) return [];
  return (model.supportedReasoningEfforts || []).filter((effort) =>
    reasoningEffortEnabled(model.reasoningPricing?.efforts?.[effort]),
  );
}

function legacyReasoningEffortPrice(
  effort: string,
  standard: number,
  discount: number | null,
): ReasoningEffortPricing {
  const multiplier = ["high", "xhigh", "max"].includes(effort) ? 5 : 3;
  return {
    enabled: true,
    assistantPriceCents: normalizePoints(standard),
    assistantDiscountPriceCents:
      discount === null ? null : normalizePoints(discount),
    canvasAgentPriceCents: normalizePoints(standard) * multiplier,
    canvasAgentDiscountPriceCents:
      discount === null ? null : normalizePoints(discount) * multiplier,
  };
}

function normalizeReasoningPricing(
  source: ReasoningPricing | null | undefined,
  efforts: string[],
  standard: number,
  discount: number | null,
  supportedSubset?: string[] | null,
): ReasoningPricing | null {
  if (!efforts.length) return null;
  const fromList =
    Array.isArray(supportedSubset) &&
    !(
      supportedSubset.length === efforts.length &&
      efforts.every((effort) => supportedSubset.includes(effort))
    );
  const enabledSet = new Set(supportedSubset || []);
  const prices = Object.fromEntries(
    efforts.map((effort) => {
      const configured = source?.efforts?.[effort];
      const enabled = configured?.enabled ?? (fromList
        ? enabledSet.has(effort)
        : Boolean(configured));
      return [
        effort,
        configured
          ? {
              enabled,
              assistantPriceCents: normalizePoints(configured.assistantPriceCents),
              assistantDiscountPriceCents:
                configured.assistantDiscountPriceCents === null ||
                configured.assistantDiscountPriceCents === undefined
                  ? null
                  : normalizePoints(configured.assistantDiscountPriceCents),
              canvasAgentPriceCents: normalizePoints(configured.canvasAgentPriceCents),
              canvasAgentDiscountPriceCents:
                configured.canvasAgentDiscountPriceCents === null ||
                configured.canvasAgentDiscountPriceCents === undefined
                  ? null
                  : normalizePoints(configured.canvasAgentDiscountPriceCents),
            }
          : { ...legacyReasoningEffortPrice(effort, standard, discount), enabled },
      ];
    }),
  );
  const enabled = efforts.filter((effort) =>
    reasoningEffortEnabled(prices[effort]),
  );
  return {
    defaultEffort: enabled.includes(source?.defaultEffort || "")
      ? source!.defaultEffort
      : defaultReasoningEffort(enabled),
    efforts: prices,
  };
}

function normalizeAspectRatiosByResolution(
  resolutions: string[],
  source: Record<string, string[] | string> = {},
  fallbackRatios: string[] = IMAGE_ASPECT_RATIOS,
  legacyAutoRatios: Record<string, string[] | string> = {},
) {
  const hasNewRules = Object.keys(source || {}).length > 0;
  return Object.fromEntries(
    resolutions.map((resolution) => {
      const key = String(resolution).toUpperCase();
      const legacyValue = legacyAutoRatios[key];
      const legacyValues = Array.isArray(legacyValue)
        ? legacyValue
        : legacyValue
          ? [legacyValue]
          : [];
      const selectedSource = hasNewRules
        ? source[key]
        : legacyValues.length
          ? [
              ...(fallbackRatios.includes("auto") ? ["auto"] : []),
              ...legacyValues,
            ]
          : fallbackRatios;
      const rawValues = Array.isArray(selectedSource)
        ? selectedSource
        : selectedSource
          ? [selectedSource]
          : fallbackRatios;
      const configured = Array.from(
        new Set(
          rawValues
            .map((ratio) => String(ratio).toLowerCase())
            .filter((ratio) => IMAGE_ASPECT_RATIOS.includes(ratio)),
        ),
      );
      return [key, configured.length ? configured : [...fallbackRatios]];
    }),
  );
}

function aspectRatioUnion(source: Record<string, string[]>) {
  const selected = new Set(Object.values(source).flat());
  return IMAGE_ASPECT_RATIOS.filter((ratio) => selected.has(ratio));
}

const adapterMeta: Record<ProviderAdapter, { name: string; detail: string }> = {
  openai: { name: "OpenAI 兼容", detail: "/v1/models · Images · Chat" },
  crun: { name: "CRUN 任务协议", detail: "后端转换为统一图片调用" },
};

const kindMeta: Record<ModelKind, { name: string; detail: string }> = {
  image: { name: "生图模型", detail: "供全部图片工作台与 AI 助手选择" },
  chat: { name: "对话模型", detail: "供 AI 助手对话、分析和意图识别" },
  image_tool: { name: "媒体工具", detail: "按 CRUN 实时 schema 处理图片、视频和音频" },
};
const kindFilters: Array<{ id: "all" | ModelKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "image", label: "生图模型" },
  { id: "chat", label: "对话模型" },
  { id: "image_tool", label: "媒体工具" },
];

const workspaceMeta: Array<{
  key: WorkspaceKey;
  name: string;
  detail: string;
  kinds: ModelKind[];
}> = [
  {
    key: "assistant",
    name: "AI 助手",
    detail: "对话、图片理解和助手生图",
    kinds: ["chat", "image"],
  },
  {
    key: "t2i",
    name: "文生图",
    detail: "文字生图与图像编辑",
    kinds: ["image"],
  },
  {
    key: "coloring",
    name: "插画染色",
    detail: "线稿和插画智能上色",
    kinds: ["image"],
  },
  {
    key: "ui_design",
    name: "UI 设计稿",
    detail: "整稿生成、框选优化、局部素材重建与元素分析",
    kinds: ["image", "chat"],
  },
  {
    key: "ecommerce_design",
    name: "AI 电商",
    detail: "商品识别、套图、详情页、模特与图片处理",
    kinds: ["image", "chat"],
  },
  {
    key: "model_sheet",
    name: "模型设计",
    detail: "角色多视图与高清参考图",
    kinds: ["image"],
  },
  {
    key: "game_art",
    name: "游戏设计",
    detail: "角色、道具和场景资产",
    kinds: ["image"],
  },
  {
    key: "infinite_canvas",
    name: "无限画布",
    detail: "画布节点生图与文本助手",
    kinds: ["image", "chat"],
  },
];

const loading = ref(false);
const saving = ref(false);
const activeView = ref<"models" | "workspaces" | "providers">("models");
const activeWorkspaceKey = ref<WorkspaceKey>("assistant");
const kindFilter = ref<"all" | ModelKind>("all");
const modelSearch = ref("");
const reasoningPriceScope = ref<ReasoningPriceScope>("assistant");
const savedSignature = ref("");
const configLoaded = ref(false);
const loadFailed = ref(false);
const config = reactive<ModelConfig>({
	version: 8,
  providers: [],
  models: [],
  workspaces: {} as Record<WorkspaceKey, WorkspaceBinding>,
  editableFiles: { enabled: false, providerId: "", routeId: "" },
});

function signature() {
  return JSON.stringify(config);
}

const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase();
  return config.models.filter((model) => {
    if (kindFilter.value !== "all" && model.kind !== kindFilter.value)
      return false;
    if (!query) return true;
    return [
      model.name,
      model.upstreamModel,
      providerName(model.providerId),
    ].some((value) => value.toLowerCase().includes(query));
  });
});

const modelPagination = useClientPagination(() => filteredModels.value, 12);
const providerPagination = useClientPagination(() => config.providers, 10);

const isDirty = computed(
  () => configLoaded.value && signature() !== savedSignature.value,
);
const saveStatusLabel = computed(() => {
  if (saving.value) return "保存中…";
  if (isDirty.value) return "有未保存更改";
  if (loadFailed.value) return "加载失败，禁止保存";
  if (!configLoaded.value) return "加载中…";
  return "已保存";
});

const canSave = computed(
  () => configLoaded.value && !loading.value && !saving.value && isDirty.value,
);
const kindCounts = computed(() => {
  const counts: Record<"all" | ModelKind, number> = { all: config.models.length, image: 0, chat: 0, image_tool: 0 };
  for (const model of config.models) counts[model.kind] = (counts[model.kind] || 0) + 1;
  return counts;
});
const providerRouteCount = computed(() =>
  config.providers.reduce((sum, provider) => sum + (provider.routes?.length || 0), 0),
);
const saveShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘S" : "Ctrl+S";

const modelSearchInput = ref<{ focus: () => void } | null>(null);
const modelSearchFocused = ref(false);

function isDialogOpen() {
  return Array.from(document.querySelectorAll<HTMLElement>(".el-overlay"))
    .some((overlay) => getComputedStyle(overlay).display !== "none");
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function handleToolbarShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    // 弹窗里的草稿尚未写回配置，打开弹窗时不响应全局保存。
    if (canSave.value && !isDialogOpen()) void save();
    return;
  }
  if (
    event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey &&
    activeView.value === "models" && !isTypingTarget(event.target) && !isDialogOpen()
  ) {
    event.preventDefault();
    modelSearchInput.value?.focus();
  }
}

const viewTabs = computed(() => [
  { value: "models" as const, label: "模型目录", count: config.models.length },
  {
    value: "workspaces" as const,
    label: "页面分配",
    count: workspaceMeta.length,
  },
  {
    value: "providers" as const,
    label: "服务商",
    count: config.providers.length,
  },
]);

watch([kindFilter, modelSearch], modelPagination.reset);

function hydrate(value: ModelConfig) {
	config.version = value.version || 8;
  config.providers = (value.providers || []).map((provider) => ({
    ...provider,
    adapter: provider.adapter || "openai",
    maxConcurrency: provider.maxConcurrency || 100,
    discoveredModels: provider.discoveredModels || [],
	routes:
		provider.routes?.length
			? provider.routes.map((route) => ({ ...route, maxConcurrency: route.maxConcurrency || 100 }))
			: [{
				id: `${provider.id}-default`, name: "默认线路", baseUrl: provider.baseUrl,
				apiKey: provider.apiKey, timeoutSecs: provider.timeoutSecs,
				maxConcurrency: provider.maxConcurrency || 100, enabled: provider.enabled,
			  }],
  }));
	for (const provider of config.providers) syncProviderPrimary(provider);
  config.editableFiles = {
    enabled: value.editableFiles?.enabled === true,
    providerId: String(value.editableFiles?.providerId || "").trim(),
    routeId: String(value.editableFiles?.routeId || "").trim(),
  };
  config.models = (value.models || []).map((model) => ({
    ...model,
    iconUrl: String(model.iconUrl || "").trim(),
    status: model.status === "maintenance" ? "maintenance" : "available",
    upstreamInputFields: model.upstreamInputFields || [],
    upstreamRequiredInputFields: model.upstreamRequiredInputFields || [],
    upstreamInputSchema: model.upstreamInputSchema || {},
    modality: model.modality || "",
    operations: model.operations || [],
    imageUpscalePricing: model.imageUpscalePricing || null,
    kind: model.kind || "image",
    tool: model.kind === "image_tool" ? model.tool || "background_remove" : "",
    description: model.description || "",
    supportsExactSize: model.kind === "image" && model.supportsExactSize === true,
    exactSizeLimits: exactSizeLimits(model.exactSizeLimits),
    resolutions: (model.resolutions || []).filter(
      (resolution) => String(resolution).toUpperCase() !== "AUTO",
    ),
    aspectRatios:
      model.kind !== "image"
        ? []
        : model.aspectRatios || [...IMAGE_ASPECT_RATIOS],
    aspectRatiosByResolution:
      model.kind !== "image"
        ? {}
        : normalizeAspectRatiosByResolution(
            model.resolutions || [],
            model.aspectRatiosByResolution || {},
            model.aspectRatios || IMAGE_ASPECT_RATIOS,
            model.autoAspectRatios || {},
          ),
    qualities:
      model.kind !== "image"
        ? []
        : model.qualities || IMAGE_QUALITIES.map((item) => item.value),
    transparentBackground:
      model.kind === "image" && model.transparentBackground !== false,
    outputFormats: model.kind === "image" ? model.outputFormats || [] : [],
    moderationLevels: model.kind === "image" ? model.moderationLevels || [] : [],
    maxReferenceImages:
      model.kind === "image" ? Number(model.maxReferenceImages ?? 4) : 0,
    maxImages: model.kind === "image" ? Number(model.maxImages ?? 4) : 0,
    contextWindowTokens:
      model.kind === "chat" ? Number(model.contextWindowTokens ?? 128000) : 0,
    maxOutputTokens:
      model.kind === "chat" ? Number(model.maxOutputTokens ?? 8192) : 0,
    supportedReasoningEfforts:
      model.kind === "chat" && model.reasoningEnabled !== false
        ? enabledReasoningEfforts({
            supportedReasoningEfforts: configuredReasoningOptions(model),
            reasoningPricing: normalizeReasoningPricing(
              model.reasoningPricing,
              configuredReasoningOptions(model),
              model.priceCents,
              model.discountPriceCents,
              Array.isArray(model.supportedReasoningEfforts)
                ? model.supportedReasoningEfforts
                : null,
            ),
          })
        : [],
    reasoningPricing:
      model.kind === "chat"
        ? normalizeReasoningPricing(
            model.reasoningPricing,
            configuredReasoningOptions(model),
            model.priceCents,
            model.discountPriceCents,
            Array.isArray(model.supportedReasoningEfforts)
              ? model.supportedReasoningEfforts
              : null,
          )
        : null,
    public: model.public !== false,
    default: model.default === true,
  }));
  const incoming = value.workspaces || ({} as ModelConfig["workspaces"]);
  config.workspaces = Object.fromEntries(
    workspaceMeta.map((workspace) => {
      const saved = incoming[workspace.key];
      const eligible = config.models.filter(
        (model) =>
          model.enabled && model.public && workspace.kinds.includes(model.kind),
      );
      const modelIds = saved
        ? [...(saved.modelIds || [])]
        : eligible.map((model) => model.id);
      const defaultModelIds = { ...(saved?.defaultModelIds || {}) };
      for (const kind of workspace.kinds) {
        if (!defaultModelIds[kind]) {
          defaultModelIds[kind] =
            eligible.find((model) => model.kind === kind && model.default)
              ?.id ||
            eligible.find((model) => model.kind === kind)?.id ||
            "";
        }
      }
      const modelPricing = Object.fromEntries(
        Object.entries(saved?.modelPricing || {})
          .filter(([modelId]) => modelIds.includes(modelId))
          .map(([modelId, pricing]) => [modelId, {
            priceCents: Math.max(0, Number(pricing?.priceCents || 0)),
            discountPriceCents:
              pricing?.discountPriceCents === null || pricing?.discountPriceCents === undefined
                ? null
                : Math.max(0, Number(pricing.discountPriceCents)),
          }]),
      );
      const modelLimits = Object.fromEntries(
        Object.entries(saved?.modelLimits || {})
          .filter(([modelId]) => modelIds.includes(modelId))
          .map(([modelId, limits]) => [modelId, {
            extraReferenceImages: Math.max(0, Math.round(Number(limits?.extraReferenceImages) || 0)),
            extraImages: Math.max(0, Math.round(Number(limits?.extraImages) || 0)),
          }]),
      );
      return [workspace.key, { modelIds, defaultModelIds, modelPricing, modelLimits }];
    }),
  ) as Record<WorkspaceKey, WorkspaceBinding>;
  sanitizeWorkspaceBindings();
  savedSignature.value = signature();
}

async function load() {
  if (loading.value || saving.value) return;
  if (isDirty.value) {
    try { await ElMessageBox.confirm("重新加载会放弃未保存的修改，是否继续？", "未保存的修改", { confirmButtonText: "放弃并重新加载", cancelButtonText: "继续编辑", type: "warning" }); }
    catch { return; }
  }
  configLoaded.value = false;
  loadFailed.value = false;
  loading.value = true;
  try {
    const loaded = await request<ModelConfig>("/api/v1/admin/model-config");
    if (!loaded || !Array.isArray(loaded.models) || !Array.isArray(loaded.providers)) {
      ElMessage.error("配置返回格式异常，已禁止保存");
      throw new Error("Invalid model config response");
    }
    hydrate(loaded);
    configLoaded.value = true;
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!configLoaded.value || loading.value || saving.value) return;
  sanitizeWorkspaceBindings();
  sanitizeEditableFileConfig();
  if (signature() === savedSignature.value) return;
  const payload = JSON.parse(JSON.stringify(config)) as ModelConfig;
  const submittedSignature = JSON.stringify(payload);
  saving.value = true;
  try {
    const saved = await request<ModelConfig>("/api/v1/admin/model-config", {
      method: "PUT",
      body: payload,
      scope: "persistent",
    });
    if (signature() === submittedSignature) {
      hydrate(retainSubmittedReasoning(saved, payload));
    } else {
      savedSignature.value = submittedSignature;
    }
    ElMessage.success(signature() === savedSignature.value ? "模型配置已保存" : "已保存提交的配置，后续修改请再次点击保存");
  } catch {
    // Keep the draft dirty after failure. Retry only on an explicit Save click.
  } finally {
    saving.value = false;
  }
}

function retainSubmittedReasoning(saved: ModelConfig, submitted: ModelConfig) {
  const localById = new Map(submitted.models.map((model) => [model.id, model]));
  return {
    ...saved,
    models: saved.models.map((model) => {
      const local = localById.get(model.id);
      if (!local || local.kind !== "chat" || !local.reasoningPricing) return model;
      return {
        ...model,
        supportedReasoningEfforts: [...(local.supportedReasoningEfforts || [])],
        reasoningPricing: JSON.parse(
          JSON.stringify(local.reasoningPricing),
        ) as ReasoningPricing,
      };
    }),
  };
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function providerName(id: string) {
  return (
    config.providers.find((item) => item.id === id)?.name || "服务商已删除"
  );
}

function providerModels(id: string) {
  return config.models.filter((item) => item.providerId === id);
}

const editableFileProviders = computed(() =>
  config.providers.filter(
    (provider) =>
      provider.enabled &&
      provider.adapter === "openai" &&
      provider.routes.some((route) => route.enabled),
  ),
);

const editableFileRoutes = computed(() => {
  const provider = config.providers.find(
    (item) => item.id === config.editableFiles.providerId,
  );
  return (provider?.routes || []).filter((route) => route.enabled);
});

function selectEditableFileProvider(providerId: string) {
  config.editableFiles.providerId = providerId;
  const provider = editableFileProviders.value.find(
    (item) => item.id === providerId,
  );
  config.editableFiles.routeId =
    provider?.routes.find((route) => route.enabled)?.id || "";
}

function toggleEditableFiles(value: string | number | boolean) {
  const enabled = value === true;
	config.editableFiles.enabled = enabled;
	if (!enabled) return;
  const selected = editableFileProviders.value.find(
    (provider) => provider.id === config.editableFiles.providerId,
  );
  if (!selected) {
    selectEditableFileProvider(editableFileProviders.value[0]?.id || "");
    return;
  }
  if (!selected.routes.some((route) => route.enabled && route.id === config.editableFiles.routeId)) {
    config.editableFiles.routeId =
      selected.routes.find((route) => route.enabled)?.id || "";
  }
}

function sanitizeEditableFileConfig() {
  config.editableFiles.providerId = config.editableFiles.providerId.trim();
  config.editableFiles.routeId = config.editableFiles.routeId.trim();
  if (!config.editableFiles.enabled) return;
  const provider = editableFileProviders.value.find(
    (item) => item.id === config.editableFiles.providerId,
  );
  const validRoute = provider?.routes.some(
    (route) => route.enabled && route.id === config.editableFiles.routeId,
  );
  if (provider && validRoute) return;
  config.editableFiles.enabled = false;
  config.editableFiles.providerId = "";
  config.editableFiles.routeId = "";
}

function workspaceAvailableModels(workspace: (typeof workspaceMeta)[number]) {
  return config.models.filter(
    (model) =>
      model.enabled && model.public && workspace.kinds.includes(model.kind),
  );
}

const activeWorkspace = computed(
  () =>
    workspaceMeta.find((workspace) => workspace.key === activeWorkspaceKey.value) ||
    workspaceMeta[0],
);

const uiDesignServiceRoutes = computed(() =>
  IMAGE_SERVICE_ROUTES.filter(
    (route) => route.key === "ui_design" || route.key === "ui_design_asset",
  ),
);

const assignedWorkspaceModels = computed(() => {
  const binding = config.workspaces[activeWorkspace.value.key];
  if (!binding) return [] as ModelItem[];
  const order = new Map(binding.modelIds.map((id, index) => [id, index]));
  return workspaceAvailableModels(activeWorkspace.value)
    .filter((model) => order.has(model.id))
    .sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
});

const poolSearch = ref("");
watch(activeWorkspaceKey, () => { poolSearch.value = ""; });

// 按模型类型分组：已加入的模型在前，可加入的模型以虚线卡片跟在同组末尾；筛选同时作用于两者。
const workspaceBoardGroups = computed(() => {
  const workspace = activeWorkspace.value;
  const binding = config.workspaces[workspace.key];
  const query = poolSearch.value.trim().toLowerCase();
  const matches = (model: ModelItem) =>
    !query ||
    [model.name, model.upstreamModel, providerName(model.providerId)]
      .some((value) => value.toLowerCase().includes(query));
  const kinds = [...new Set([
    ...workspace.kinds,
    ...assignedWorkspaceModels.value.map((model) => model.kind),
    ...poolWorkspaceModels.value.map((model) => model.kind),
  ])];
  return kinds.map((kind) => {
    const defaultId = binding?.defaultModelIds[kind];
    const defaultModel = defaultId && binding?.modelIds.includes(defaultId)
      ? config.models.find((model) => model.id === defaultId)
      : undefined;
    return {
      kind,
      defaultName: defaultModel?.name || "",
      assigned: assignedWorkspaceModels.value.filter((model) => model.kind === kind && matches(model)),
      pool: poolWorkspaceModels.value.filter((model) => model.kind === kind && matches(model)),
    };
  });
});

const poolWorkspaceModels = computed(() => {
  const binding = config.workspaces[activeWorkspace.value.key];
  const selected = new Set(binding?.modelIds || []);
  return workspaceAvailableModels(activeWorkspace.value).filter(
    (model) => !selected.has(model.id),
  );
});

function workspaceAssignedCount(workspace: (typeof workspaceMeta)[number]) {
  return config.workspaces[workspace.key]?.modelIds.length || 0;
}

function workspaceDefaultSummary(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding?.modelIds.length) return "尚未分配模型";
  const labels = workspace.kinds
    .map((kind) => {
      const id = binding.defaultModelIds[kind];
      if (!id) return "";
      const model = config.models.find((item) => item.id === id);
      const label = workspaceDefaultLabel(workspace, kind);
      return model ? `${label}：${model.name}` : "";
    })
    .filter(Boolean);
  return labels.length ? labels.join(" · ") : `已分配 ${binding.modelIds.length} 个模型`;
}

function isWorkspaceDefaultModel(
  workspace: (typeof workspaceMeta)[number],
  model: ModelItem,
) {
  return config.workspaces[workspace.key]?.defaultModelIds[model.kind] === model.id;
}

function setWorkspaceDefaultModel(
  workspace: (typeof workspaceMeta)[number],
  model: ModelItem,
) {
  const binding = config.workspaces[workspace.key];
  if (!binding || !binding.modelIds.includes(model.id) || model.status === "maintenance") return;
  binding.defaultModelIds[model.kind] = model.id;
}

function addWorkspaceModel(
  workspace: (typeof workspaceMeta)[number],
  modelId: string,
) {
  const binding = config.workspaces[workspace.key];
  if (!binding || binding.modelIds.includes(modelId)) return;
  binding.modelIds.push(modelId);
  ensureWorkspaceDefaults(workspace);
}

function removeWorkspaceModel(
  workspace: (typeof workspaceMeta)[number],
  modelId: string,
) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  binding.modelIds = binding.modelIds.filter((id) => id !== modelId);
  delete binding.modelPricing[modelId];
  delete binding.modelLimits[modelId];
  ensureWorkspaceDefaults(workspace);
}

function clearWorkspaceModels(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  binding.modelIds = [];
  binding.defaultModelIds = {};
  binding.modelPricing = {};
  binding.modelLimits = {};
  ensureWorkspaceDefaults(workspace);
}

async function confirmClearWorkspace(workspace: (typeof workspaceMeta)[number]) {
  const count = workspaceAssignedCount(workspace);
  if (!count) return;
  try {
    await ElMessageBox.confirm(
      `确认移出「${workspace.name}」的全部 ${count} 个模型？该页面的页面价格和追加额度也会一并清除。`,
      "清空页面模型",
      { type: "warning", confirmButtonText: "清空", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  clearWorkspaceModels(workspace);
}

function addAllPoolModels(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  const ids = new Set(binding.modelIds);
  for (const model of poolWorkspaceModels.value) ids.add(model.id);
  binding.modelIds = [...ids];
  ensureWorkspaceDefaults(workspace);
}

function workspaceDefaultOptions(
  workspace: (typeof workspaceMeta)[number],
  kind: ModelKind,
) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return [];
  return workspaceAvailableModels(workspace).filter(
    (model) =>
      model.kind === kind &&
      model.status !== "maintenance" &&
      binding.modelIds.includes(model.id),
  );
}

function ensureWorkspaceDefaults(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  for (const kind of workspace.kinds) {
    const options = workspaceDefaultOptions(workspace, kind);
    if (!options.some((model) => model.id === binding.defaultModelIds[kind])) {
      binding.defaultModelIds[kind] =
        options.find((model) => model.default)?.id || options[0]?.id || "";
    }
  }
}

function sanitizeWorkspaceBindings() {
  for (const workspace of workspaceMeta) {
    const binding = config.workspaces[workspace.key] || {
      modelIds: [],
      defaultModelIds: {},
      modelPricing: {},
      modelLimits: {},
    };
    const allowed = new Set(
      workspaceAvailableModels(workspace).map((model) => model.id),
    );
    binding.modelIds = [...new Set(binding.modelIds || [])].filter((id) =>
      allowed.has(id),
    );
    binding.defaultModelIds = { ...(binding.defaultModelIds || {}) };
    binding.modelPricing = Object.fromEntries(
      Object.entries(binding.modelPricing || {})
        .filter(([modelId]) => {
          const model = config.models.find((item) => item.id === modelId);
          return allowed.has(modelId) && Boolean(model);
        })
        .map(([modelId, pricing]) => {
          const priceCents = Math.max(0, Math.round(Number(pricing.priceCents) || 0));
          const discountPriceCents = pricing.discountPriceCents === null || pricing.discountPriceCents === undefined
            ? null
            : Math.min(priceCents, Math.max(0, Math.round(Number(pricing.discountPriceCents) || 0)));
          return [modelId, { priceCents, discountPriceCents }];
        }),
    );
    // 追加额度只对已加入该页面的生图模型有效，并按服务端硬上限收紧。
    binding.modelLimits = Object.fromEntries(
      Object.entries(binding.modelLimits || {})
        .flatMap(([modelId, limits]) => {
          const model = config.models.find((item) => item.id === modelId);
          if (!model || model.kind !== "image" || !binding.modelIds.includes(modelId)) return [];
          const extraReferenceImages = Math.min(
            Math.max(0, Math.round(Number(limits.extraReferenceImages) || 0)),
            Math.max(0, MAX_REFERENCE_IMAGES_LIMIT - model.maxReferenceImages),
          );
          const extraImages = Math.min(
            Math.max(0, Math.round(Number(limits.extraImages) || 0)),
            Math.max(0, MAX_IMAGES_LIMIT - model.maxImages),
          );
          return extraReferenceImages || extraImages ? [[modelId, { extraReferenceImages, extraImages }]] : [];
        }),
    );
    config.workspaces[workspace.key] = binding;
    ensureWorkspaceDefaults(workspace);
  }
}

function pruneWorkspaceModel(modelId: string) {
  for (const workspace of workspaceMeta) {
    const binding = config.workspaces[workspace.key];
    if (!binding) continue;
    binding.modelIds = binding.modelIds.filter((id) => id !== modelId);
    delete binding.modelPricing[modelId];
    delete binding.modelLimits[modelId];
    for (const kind of workspace.kinds) {
      if (binding.defaultModelIds[kind] === modelId) {
        binding.defaultModelIds[kind] = "";
      }
    }
    ensureWorkspaceDefaults(workspace);
  }
}

function effectivePrice(value: unknown) {
  const model = value as ModelItem;
  return model.discountPriceCents ?? model.priceCents;
}

function workspacePriceOverride(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  return config.workspaces[workspace.key]?.modelPricing?.[model.id] || null;
}

function workspaceEffectivePrice(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  const pricing = workspacePriceOverride(workspace, model);
  return pricing ? pricing.discountPriceCents ?? pricing.priceCents : effectivePrice(model);
}

// 页面价格直接写进配置草稿，与其他页面分配改动一样，点顶部「保存配置」后生效。
function setWorkspacePriceOverride(workspace: (typeof workspaceMeta)[number], model: ModelItem, enabled: boolean) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  if (!binding.modelPricing) binding.modelPricing = {};
  if (!enabled) {
    delete binding.modelPricing[model.id];
    return;
  }
  if (binding.modelPricing[model.id]) return;
  binding.modelPricing[model.id] = {
    priceCents: normalizePoints(model.priceCents),
    discountPriceCents:
      model.discountPriceCents === null || model.discountPriceCents === undefined
        ? null
        : normalizePoints(model.discountPriceCents),
  };
}

function setWorkspacePriceField(
  workspace: (typeof workspaceMeta)[number],
  model: ModelItem,
  key: keyof WorkspaceModelPricing,
  value: string | number,
) {
  const pricing = workspacePriceOverride(workspace, model);
  if (!pricing) return;
  const points = normalizePoints(Math.max(0, Math.round(Number(value) || 0)));
  if (key === "priceCents") {
    pricing.priceCents = points;
    if (pricing.discountPriceCents !== null && pricing.discountPriceCents > points) {
      pricing.discountPriceCents = points;
    }
  } else if (pricing.discountPriceCents !== null) {
    pricing.discountPriceCents = Math.min(points, pricing.priceCents);
  }
}

function setWorkspaceDiscountEnabled(workspace: (typeof workspaceMeta)[number], model: ModelItem, enabled: boolean) {
  const pricing = workspacePriceOverride(workspace, model);
  if (!pricing) return;
  pricing.discountPriceCents = enabled ? pricing.priceCents : null;
}

// 与服务端保存校验一致，提前提示会导致「保存配置」失败的价格。
function workspacePriceWarning(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  const pricing = workspacePriceOverride(workspace, model);
  if (!pricing) return "";
  const effective = pricing.discountPriceCents ?? pricing.priceCents;
  if (effective === 0 && !model.allowZeroPrice) {
    return "用户价格为 0：需先在模型中允许零价，否则保存会失败。";
  }
  if (effective < model.upstreamCostCents && !model.allowLossLeader) {
    return `低于上游成本 ${formatPoints(model.upstreamCostCents)}：需先在模型中允许低于成本，否则保存会失败。`;
  }
  return "";
}

// 与服务端 modelconfig 的硬上限一致：参考图 0-16 张，单次生成 1-100 张。
const MAX_REFERENCE_IMAGES_LIMIT = 16;
const MAX_IMAGES_LIMIT = 100;

function workspaceModelLimits(workspace: (typeof workspaceMeta)[number], model: ModelItem): WorkspaceModelLimits {
  return config.workspaces[workspace.key]?.modelLimits?.[model.id] || { extraReferenceImages: 0, extraImages: 0 };
}

function workspaceLimitSummary(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  const extra = workspaceModelLimits(workspace, model);
  return {
    extended: extra.extraReferenceImages > 0 || extra.extraImages > 0,
    references: Math.min(MAX_REFERENCE_IMAGES_LIMIT, model.maxReferenceImages + extra.extraReferenceImages),
    images: Math.min(MAX_IMAGES_LIMIT, model.maxImages + extra.extraImages),
  };
}

function resetWorkspaceModelLimits(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  delete config.workspaces[workspace.key]?.modelLimits?.[model.id];
}

function workspaceLimitFields(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  const extra = workspaceModelLimits(workspace, model);
  return [
    { key: "extraReferenceImages" as const, label: "参考图", unit: "张", base: model.maxReferenceImages, cap: MAX_REFERENCE_IMAGES_LIMIT, steps: [2, 4, 8] },
    { key: "extraImages" as const, label: "单次生成", unit: "张", base: model.maxImages, cap: MAX_IMAGES_LIMIT, steps: [4, 8, 16] },
  ].map((field) => ({
    ...field,
    extra: extra[field.key],
    maxExtra: Math.max(0, field.cap - field.base),
    total: Math.min(field.cap, field.base + extra[field.key]),
  }));
}

function setWorkspaceModelLimit(
  workspace: (typeof workspaceMeta)[number],
  model: ModelItem,
  key: keyof WorkspaceModelLimits,
  value: number | undefined | null,
) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  const base = key === "extraReferenceImages" ? model.maxReferenceImages : model.maxImages;
  const cap = key === "extraReferenceImages" ? MAX_REFERENCE_IMAGES_LIMIT : MAX_IMAGES_LIMIT;
  const extra = Math.min(Math.max(0, cap - base), Math.max(0, Math.round(Number(value) || 0)));
  const next = { ...workspaceModelLimits(workspace, model), [key]: extra };
  if (!binding.modelLimits) binding.modelLimits = {};
  if (next.extraReferenceImages || next.extraImages) binding.modelLimits[model.id] = next;
  else delete binding.modelLimits[model.id];
}

function workspacePriceUnit(model: ModelItem) {
  return model.kind === "image" ? "积分/张" : "积分/次";
}

function hasDiscountPrice(model: ModelItem) {
  return (
    model.discountPriceCents !== null &&
    model.discountPriceCents !== undefined &&
    model.discountPriceCents < model.priceCents
  );
}

/** 商业折扣率展示，如 -85% */
function discountOffLabel(model: ModelItem) {
  if (!hasDiscountPrice(model) || model.priceCents <= 0) return "";
  const off = Math.round(
    (1 - Number(model.discountPriceCents) / model.priceCents) * 100,
  );
  return off > 0 ? `-${off}%` : "";
}

function effectiveReasoningCents(
  standard: number,
  discount: number | null | undefined,
) {
  return discount === null || discount === undefined ? standard : discount;
}

function formatPointRange(values: number[]) {
  if (!values.length) return "—";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max
    ? formatPoints(min)
    : `${formatPoints(min)}–${formatPoints(max)}`;
}

function formatPricedCents(
  standard: number,
  discount: number | null | undefined,
) {
  const now = effectiveReasoningCents(standard, discount);
  const hasDiscount =
    discount !== null && discount !== undefined && discount < standard;
  return {
    cents: now,
    now: formatPoints(now),
    was: hasDiscount ? formatPoints(standard) : "",
  };
}

function modelReasoningPriceRows(model: ModelItem) {
  if (model.kind !== "chat" || !model.reasoningPricing) return [];
  const defaultEffort = model.reasoningPricing.defaultEffort;
  return enabledReasoningEfforts(model).flatMap((effort) => {
    const price = model.reasoningPricing?.efforts[effort];
    if (!price) return [];
    const assistant = formatPricedCents(
      price.assistantPriceCents,
      price.assistantDiscountPriceCents,
    );
    const canvas = formatPricedCents(
      price.canvasAgentPriceCents,
      price.canvasAgentDiscountPriceCents,
    );
    return [
      {
        effort,
        label: REASONING_EFFORT_LABELS[effort] || effort,
        default: effort === defaultEffort,
        assistantCents: assistant.cents,
        assistant: assistant.now,
        assistantWas: assistant.was,
        canvasCents: canvas.cents,
        canvas: canvas.now,
        canvasWas: canvas.was,
      },
    ];
  });
}

function modelCardPrice(model: ModelItem) {
  const rows = modelReasoningPriceRows(model);
  if (rows.length) {
    const canvasScope = reasoningPriceScope.value === "canvas_agent";
    const values = rows.map((row) =>
      canvasScope ? row.canvasCents : row.assistantCents,
    );
    const other = rows.map((row) =>
      canvasScope ? row.assistantCents : row.canvasCents,
    );
    const defaultRow = rows.find((row) => row.default);
    return {
      amount: formatPointRange(values),
      label: canvasScope ? "画布积分" : "助手积分",
      meta: `${canvasScope ? "助手" : "画布"} ${formatPointRange(other)}`,
      was: "",
      off: "",
      rows,
      countLabel: `${rows.length} 档`,
      defaultLabel: defaultRow?.label || "",
    };
  }
  return {
    amount: formatPoints(
      hasDiscountPrice(model) ? Number(model.discountPriceCents) : model.priceCents,
    ),
    label: model.kind === "chat" ? "基础积分" : "积分",
    meta: "",
    was: hasDiscountPrice(model) ? `原价 ${formatPoints(model.priceCents)}` : "",
    off: discountOffLabel(model),
    rows: [],
    countLabel: "",
    defaultLabel: "",
  };
}

function kindName(value: unknown) {
  return kindMeta[String(value) as ModelKind]?.name || "未知类型";
}

function workspaceDefaultLabel(
  workspace: (typeof workspaceMeta)[number],
  kind: ModelKind,
) {
  if (workspace.key === "ui_design" && kind === "chat") return "元素分析模型";
  if (workspace.key === "ecommerce_design" && kind === "chat")
    return "商品分析模型";
  return `默认${kindName(kind)}`;
}

function modelWorkspaceNames(modelId: string) {
  return workspaceMeta
    .filter((workspace) =>
      config.workspaces[workspace.key]?.modelIds.includes(modelId),
    )
    .map((workspace) => workspace.name);
}

function providerAdapterLabel(providerId: string) {
  return config.providers.find((item) => item.id === providerId)?.adapter ===
    "crun"
    ? "CRUN"
    : "OpenAI";
}

function joinList(values: string[] | undefined, empty = "—") {
  return values?.length ? values.join(" · ") : empty;
}

function formatAspectByResolution(model: ModelItem) {
  const map = model.aspectRatiosByResolution || {};
  const entries = Object.entries(map).filter(([, ratios]) => ratios?.length);
  if (!entries.length) return "—";
  return entries
    .map(([resolution, ratios]) => `${resolution}: ${ratios.join("/")}`)
    .join(" ｜ ");
}

function aspectByResolutionParts(model: ModelItem) {
  const map = model.aspectRatiosByResolution || {};
  return Object.entries(map)
    .filter(([, ratios]) => ratios?.length)
    .map(([resolution, ratios]) => ({
      label: resolution,
      text: ratios.join("/"),
    }));
}

type ModelCardCell = {
  label: string;
  value: string;
  tags?: string[];
  parts?: Array<{ label: string; text: string }>;
  muted?: boolean;
};

function formatTokens(value: number) {
  if (!value) return "—";
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function tagCell(label: string, tags: string[], empty = "—"): ModelCardCell {
  return tags.length
    ? { label, value: tags.join(" · "), tags }
    : { label, value: empty, muted: true };
}

function reasoningPriceTags(model: ModelItem, scope: ReasoningPriceScope) {
  if (!model.reasoningPricing) return [];
  return enabledReasoningEfforts(model).map((effort) => {
    const price = model.reasoningPricing!.efforts[effort];
    const value =
      scope === "assistant"
        ? price.assistantDiscountPriceCents ?? price.assistantPriceCents
        : price.canvasAgentDiscountPriceCents ?? price.canvasAgentPriceCents;
    return `${REASONING_EFFORT_LABELS[effort] || effort} ${value}`;
  });
}

// 每类模型固定 4 格概要 + 2 行明细，同类卡片高度一致、字段逐行对齐。
function modelCardStats(model: ModelItem): ModelCardCell[] {
  const seconds = model.maxSeconds ? `${model.minSeconds}-${model.maxSeconds}s` : "—";
  if (model.kind === "image") {
    return [
      tagCell("质量", (model.qualities || []).map(qualityLabel)),
      tagCell("格式", (model.outputFormats || []).map((item) => item.toUpperCase())),
      { label: "参考图 / 单次", value: `${model.maxReferenceImages} / ${model.maxImages} 张` },
      { label: "耗时", value: seconds },
    ];
  }
  if (model.kind === "chat") {
    const efforts = enabledReasoningEfforts(model);
    const defaultEffort = model.reasoningPricing?.defaultEffort;
    return [
      { label: "上下文", value: formatTokens(model.contextWindowTokens) },
      { label: "最大输出", value: formatTokens(model.maxOutputTokens) },
      tagCell("推理档位", efforts.map((effort) => REASONING_EFFORT_LABELS[effort] || effort), "未启用"),
      {
        label: "默认档位",
        value: efforts.length && defaultEffort ? REASONING_EFFORT_LABELS[defaultEffort] || defaultEffort : "—",
        muted: !efforts.length,
      },
    ];
  }
  return [
    { label: "工具", value: model.tool === "background_remove" ? "背景移除" : model.tool || "—" },
    { label: "耗时", value: seconds },
    { label: "协议", value: providerAdapterLabel(model.providerId) },
    { label: "输入字段", value: `${model.upstreamInputFields?.length || 0} 个` },
  ];
}

function modelCardRows(model: ModelItem): ModelCardCell[] {
  const rows: ModelCardCell[] = [];
  if (model.kind === "image") {
    const parts = aspectByResolutionParts(model).map((part) => ({
      label: part.label,
      text: `${part.text.split("/").length} 种比例`,
    }));
    rows.push(
      parts.length
        ? { label: "画幅", value: formatAspectByResolution(model), parts }
        : { label: "画幅", value: "—", muted: true },
      model.supportsExactSize
        ? {
            label: "精确尺寸",
            value: `宽 ${model.exactSizeLimits.minWidth}–${model.exactSizeLimits.maxWidth} · 高 ${model.exactSizeLimits.minHeight}–${model.exactSizeLimits.maxHeight} px`,
          }
        : { label: "精确尺寸", value: "不支持", muted: true },
    );
  } else if (model.kind === "chat") {
    rows.push(
      tagCell("助手积分", reasoningPriceTags(model, "assistant"), "按基础积分"),
      tagCell("画布积分", reasoningPriceTags(model, "canvas_agent"), "按基础积分"),
    );
  } else {
    rows.push(
      tagCell("输入", model.upstreamInputFields || []),
      tagCell("必填", model.upstreamRequiredInputFields || []),
    );
  }
  const pages = modelWorkspaceNames(model.id);
  rows.push(
    { label: "分配", value: pages.length ? pages.join(" · ") : "尚未分配", muted: !pages.length },
    { label: "说明", value: model.description || "暂无说明", muted: !model.description },
  );
  return rows;
}

function modelModerationLine(model: ModelItem) {
  return joinList(
    (model.moderationLevels || []).map((item) =>
      item === "auto" ? "Auto" : item,
    ),
  );
}

const discoveredModelsDialogVisible = ref(false);
const discoveredModelsViewer = reactive({
  providerId: "",
  providerName: "",
  models: [] as string[],
  configured: [] as string[],
});

function isDiscoveredModelConfigured(modelId: string) {
  return discoveredModelsViewer.configured.includes(modelId);
}

function openDiscoveredModelsDialog(provider: ModelProvider) {
  const models = provider.discoveredModels || [];
  if (!models.length) return;
  const configured = providerModels(provider.id).map(
    (model) => model.upstreamModel,
  );
  const configuredSet = new Set(configured);
  discoveredModelsViewer.providerName = provider.name || "服务商";
  discoveredModelsViewer.providerId = provider.id;
  discoveredModelsViewer.configured = configured;
  discoveredModelsViewer.models = [...models].sort((a, b) => {
    const aConfigured = configuredSet.has(a) ? 0 : 1;
    const bConfigured = configuredSet.has(b) ? 0 : 1;
    if (aConfigured !== bConfigured) return aConfigured - bConfigured;
    return a.localeCompare(b);
  });
  discoveredModelsDialogVisible.value = true;
}

const importingDiscoveredTools = ref(false);

function importedToolName(entry: ModelCatalogEntry) {
  const labels: Record<string, string> = {
    "image-background-remove": "背景移除",
    "image-upscale": "图片高清放大",
    "image-watermark-remove": "图片去水印",
    "video-enhance": "视频增强",
    "video-watermark-remove": "视频去水印",
    "vidu/lip-sync": "口型同步",
  };
  return labels[entry.id] || entry.id;
}

async function importDiscoveredMediaTools() {
  const provider = config.providers.find((item) => item.id === discoveredModelsViewer.providerId);
  if (!provider || provider.adapter !== "crun") return;
  const entries = (catalogEntriesByProvider[provider.id] || []).filter(
    (entry) => entry.compatible && entry.kind === "image_tool",
  );
  if (!entries.length) {
    ElMessage.warning("请先在服务商编辑窗口读取最新 CRUN 模型目录");
    return;
  }
  importingDiscoveredTools.value = true;
  try {
    const schemas = await Promise.all(
      entries.map((entry) => fetchCRUNModelSchema(provider, entry.id)),
    );
    let created = 0;
    for (const entry of schemas) {
      const existing = config.models.find(
        (model) => model.providerId === provider.id && model.upstreamModel === entry.id,
      );
      if (existing) {
        existing.upstreamInputFields = [...(entry.inputFields || [])];
        existing.upstreamRequiredInputFields = [...(entry.requiredInputFields || [])];
        existing.upstreamInputSchema = cloneJSON(entry.inputSchema || {});
        existing.modality = entry.modality || "";
        existing.operations = [...(entry.operations || [])];
        existing.tool = String(entry.operations?.[0] || "").replaceAll("-", "_");
        continue;
      }
      const operation = String(entry.operations?.[0] || "").replaceAll("-", "_");
      config.models.push({
        id: createId("media-tool"), name: importedToolName(entry), iconUrl: "", status: "available", providerId: provider.id,
        upstreamModel: entry.id, upstreamInputFields: [...(entry.inputFields || [])],
        upstreamRequiredInputFields: [...(entry.requiredInputFields || [])],
        upstreamInputSchema: cloneJSON(entry.inputSchema || {}), modality: entry.modality || "",
        operations: [...(entry.operations || [])], kind: "image_tool", tool: operation,
        description: "", priceCents: 0, discountPriceCents: null, upstreamCostCents: 0,
        allowZeroPrice: false, allowLossLeader: false, imageUpscalePricing: null, fastMode: false,
        minSeconds: 30, maxSeconds: 600, resolutions: [], aspectRatios: [],
        supportsExactSize: false, exactSizeLimits: exactSizeLimits(),
        aspectRatiosByResolution: {}, qualities: [], transparentBackground: false,
        outputFormats: [], moderationLevels: [], maxReferenceImages: 0, maxImages: 0,
        contextWindowTokens: 0, maxOutputTokens: 0, supportedReasoningEfforts: [],
        reasoningPricing: null, public: false, default: false, enabled: false,
      });
      created += 1;
    }
    discoveredModelsViewer.configured = providerModels(provider.id).map((model) => model.upstreamModel);
    ElMessage.success(`已暂存 ${schemas.length} 个媒体工具，新增 ${created} 个；请设置平台积分并点击顶部“保存配置”`);
  } finally {
    importingDiscoveredTools.value = false;
  }
}

function qualityLabel(value: string) {
  return IMAGE_QUALITIES.find((item) => item.value === value)?.label || value;
}

function adapterName(value: unknown) {
  return adapterMeta[String(value) as ProviderAdapter]?.name || "未知协议";
}

function providerCapacity(value: unknown) {
	const provider = value as ModelProvider;
	return (provider.routes || [])
		.filter((route) => route.enabled)
		.reduce((total, route) => total + (route.maxConcurrency || 0), 0);
}

const providerDialogVisible = ref(false);
const providerEditIndex = ref(-1);
const discoveringProviderModels = ref(false);
const providerCatalogSummary = ref("");
const catalogEntriesByProvider = reactive<Record<string, ModelCatalogEntry[]>>({});
const testingProviderRouteId = ref("");
const providerRouteChecks = reactive<Record<string, string>>({});
const providerDraft = reactive<ModelProvider>({
  id: "",
  name: "",
  adapter: "openai",
  baseUrl: "",
  apiKey: "",
  timeoutSecs: 300,
  maxConcurrency: 100,
  enabled: true,
  discoveredModels: [],
	routes: [],
});

function syncProviderPrimary(provider: ModelProvider) {
	const primary = provider.routes[0];
	if (!primary) return;
	provider.baseUrl = primary.baseUrl;
	provider.apiKey = primary.apiKey;
	provider.timeoutSecs = primary.timeoutSecs;
	provider.maxConcurrency = primary.maxConcurrency;
}

function copyProvider(source: ModelProvider): ModelProvider {
  return {
    id: source.id,
    name: source.name,
    adapter: source.adapter,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    timeoutSecs: source.timeoutSecs,
    maxConcurrency: source.maxConcurrency || 100,
    enabled: source.enabled,
    discoveredModels: [...(source.discoveredModels || [])],
	routes: (source.routes || []).map((route) => ({ ...route })),
  };
}

function openProvider(index = -1) {
  const source = index >= 0 ? config.providers[index] : null;
  Object.assign(
    providerDraft,
    source
      ? copyProvider(source)
      : {
          id: createId("provider"),
          name: "",
          adapter: "openai",
          baseUrl: "",
          apiKey: "",
          timeoutSecs: 300,
          maxConcurrency: 100,
          enabled: true,
          discoveredModels: [],
		  routes: [{
			  id: createId("route"), name: "默认线路", baseUrl: "", apiKey: "",
			  timeoutSecs: 300, maxConcurrency: 100, enabled: true,
		  }],
        },
  );
  providerEditIndex.value = index;
  providerCatalogSummary.value = "";
  for (const key of Object.keys(providerRouteChecks)) delete providerRouteChecks[key];
  providerDialogVisible.value = true;
}

function invalidateProviderModels() {
  providerDraft.discoveredModels = [];
  providerCatalogSummary.value = "";
  for (const key of Object.keys(providerRouteChecks)) delete providerRouteChecks[key];
}

async function fetchProviderModels(provider: ModelProvider) {
	syncProviderPrimary(provider);
  return request<ModelDiscoveryResult>(
    "/api/v1/admin/model-config/discoveries",
    { method: "POST", body: provider },
  );
}

function discoverySummary(result: ModelDiscoveryResult) {
  const compatible = result.compatibleCount ?? result.modelCount ?? result.models?.length ?? 0;
  if (result.catalogSource === "crun-live-catalog") {
    return `可配置 ${compatible} 个 · 媒体目录 ${result.taskModelCount || 0} 个`;
  }
  return `已读取 ${result.modelCount || result.models?.length || 0} 个模型`;
}

async function discoverProviderModels() {
  syncProviderPrimary(providerDraft);
  const baseUrl = providerDraft.baseUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(baseUrl)) {
    ElMessage.warning("请先填写完整 Base URL");
    return null;
  }
  if (!providerDraft.apiKey.trim()) {
    ElMessage.warning("请先填写 API Key");
    return null;
  }
  providerDraft.baseUrl = baseUrl;
  if (providerDraft.routes[0]) providerDraft.routes[0].baseUrl = baseUrl;
  discoveringProviderModels.value = true;
  try {
    const result = await fetchProviderModels(providerDraft);
    providerDraft.discoveredModels = result.models || [];
    catalogEntriesByProvider[providerDraft.id] = result.entries || [];
    providerCatalogSummary.value = discoverySummary(result);
    if (result.warning) ElMessage.warning(result.warning);
    else ElMessage.success(providerCatalogSummary.value);
    return providerDraft.discoveredModels;
  } catch {
    return null;
  } finally {
    discoveringProviderModels.value = false;
  }
}

async function testProviderRoute(route: ProviderRoute) {
  if (testingProviderRouteId.value) return;
  if (!/^https?:\/\//.test(route.baseUrl.trim()) || !route.apiKey.trim()) {
    ElMessage.warning("请先填写该线路的 Base URL 和 API Key");
    return;
  }
  testingProviderRouteId.value = route.id;
  providerRouteChecks[route.id] = "";
  try {
    const result = await request<ModelDiscoveryResult & { ok: boolean }>(
      "/api/v1/admin/model-config/discoveries",
      {
        method: "POST",
        query: { routeId: route.id },
        body: copyProvider(providerDraft),
      },
    );
    providerDraft.discoveredModels = [...new Set([...providerDraft.discoveredModels, ...(result.models || [])])];
    providerRouteChecks[route.id] = `目录连接正常 · 可读取 ${result.modelCount ?? 0} 个${result.warning ? ` · ${result.warning}` : ''}`;
    ElMessage.success(`${route.name || "线路"}连接正常`);
  } catch (error) {
    providerRouteChecks[route.id] = `连接失败：${error instanceof Error ? error.message : '未知错误，请重试'}`;
  } finally {
    testingProviderRouteId.value = "";
  }
}

async function saveProviderDraft() {
  providerDraft.name = providerDraft.name.trim();
	providerDraft.routes = providerDraft.routes.map((route) => ({
		...route, name: route.name.trim(), baseUrl: route.baseUrl.trim().replace(/\/$/, ""),
	}));
	syncProviderPrimary(providerDraft);
	if (!providerDraft.name || !providerDraft.routes.length || providerDraft.routes.some((route) => !route.name || !/^https?:\/\//.test(route.baseUrl))) {
		ElMessage.warning("请填写服务商名称和每条线路的完整 Base URL");
		return;
	}
  if (providerDraft.routes.some((route) => route.enabled && !route.apiKey.trim())) {
		ElMessage.warning("请填写启用线路的 API Key");
    return;
  }
  const value = copyProvider(providerDraft);
  if (providerEditIndex.value >= 0)
    config.providers[providerEditIndex.value] = value;
  else config.providers.push(value);
  providerDialogVisible.value = false;
}

function addProviderRoute() {
	providerDraft.routes.push({
		id: createId("route"), name: `线路 ${providerDraft.routes.length + 1}`,
		baseUrl: "", apiKey: "", timeoutSecs: 300, maxConcurrency: 100, enabled: true,
	});
}

function removeProviderRoute(routeId: string) {
	if (providerDraft.routes.length <= 1) {
		ElMessage.warning("服务商至少需要一条线路");
		return;
	}
	providerDraft.routes = providerDraft.routes.filter((route) => route.id !== routeId);
	syncProviderPrimary(providerDraft);
}

async function removeProvider(index: number) {
  const provider = config.providers[index];
  if (providerModels(provider.id).length) {
    ElMessage.warning("该服务商仍有关联模型，请先删除或迁移模型");
    return;
  }
  await ElMessageBox.confirm(
    `确认删除服务商“${provider.name}”？`,
    "删除服务商",
    {
      type: "warning",
    },
  );
  config.providers.splice(index, 1);
}

const modelDialogVisible = ref(false);
function chooseModelType(kind: ModelKind) {
  selectModelKind(kind);
  modelEditorTab.value = 'basic';
}
type ModelEditorTab = 'basic' | 'pricing' | 'capabilities' | 'publishing';
const modelEditorTab = ref<ModelEditorTab>('basic');
const modelEditorForm = ref<{ $el: HTMLElement } | null>(null);
watch(modelEditorTab, async () => {
  await nextTick();
  modelEditorForm.value?.$el.scrollTo({ top: 0 });
});
const modelEditorTabs = computed(() => [
  { id: 'basic' as const, label: '基本信息', hint: '类型、服务商与模型映射' },
  { id: 'pricing' as const, label: '计费设置', hint: modelDraft.kind === 'chat' ? '基础积分与推理档位' : '积分、成本与预计耗时' },
  { id: 'capabilities' as const, label: modelDraft.kind === 'chat' ? '对话能力' : modelDraft.kind === 'image_tool' ? '媒体能力' : '生图能力', hint: modelDraft.kind === 'chat' ? '上下文与输出上限' : modelDraft.kind === 'image_tool' ? '上游声明的参数' : '尺寸、质量与输出选项' },
  { id: 'publishing' as const, label: '发布设置', hint: '可见性、默认与启用' },
]);
const modelEditIndex = ref(-1);
const discoveringModelOptions = ref(false);
const modelIconInputRef = ref<HTMLInputElement | null>(null);
const modelIconUploading = ref(false);
const modelDraft = reactive<ModelDraft>({
  id: "",
  name: "",
  iconUrl: "",
  status: "available",
  providerId: "",
  upstreamModel: "",
  upstreamInputFields: [],
  upstreamRequiredInputFields: [],
  upstreamInputSchema: {},
  modality: "",
  operations: [],
  kind: "image",
  tool: "",
  description: "",
  pricePoints: 20,
  discountEnabled: false,
  discountPoints: 20,
  upstreamCostPoints: 0,
  allowZeroPrice: false,
  allowLossLeader: false,
  upscaleHighPricePoints: 20,
  upscaleHighDiscountEnabled: false,
  upscaleHighDiscountPoints: 20,
  upscaleHighUpstreamCostPoints: 0,
  fastMode: false,
  minSeconds: 30,
  maxSeconds: 90,
  resolutions: ["1K"],
  supportsExactSize: false,
  exactSizeLimits: exactSizeLimits(),
  aspectRatios: [...IMAGE_ASPECT_RATIOS],
  aspectRatiosByResolution: { "1K": [...IMAGE_ASPECT_RATIOS] },
  qualities: IMAGE_QUALITIES.map((item) => item.value),
  transparentBackground: true,
  outputFormats: [...IMAGE_OUTPUT_FORMATS],
  outputFormatsEnabled: true,
  moderationLevels: [...IMAGE_MODERATION_LEVELS],
  moderationEnabled: true,
  maxReferenceImages: 4,
  maxImages: 4,
  contextWindowTokens: 0,
  maxOutputTokens: 0,
  supportedReasoningEfforts: [],
  reasoningPricing: null,
  public: true,
  reasoningEnabled: false,
  default: false,
  enabled: true,
});

function openModel(index = -1) {
  modelEditorTab.value = 'basic';
  const source = index >= 0 ? config.models[index] : null;
  const defaultProvider =
    config.providers.find((item) => item.enabled)?.id || "";
  Object.assign(
    modelDraft,
    source
      ? {
          id: source.id,
          name: source.name,
          iconUrl: source.iconUrl || "",
          status: source.status === "maintenance" ? "maintenance" : "available",
          providerId: source.providerId,
          upstreamModel: source.upstreamModel,
          upstreamInputFields: [...(source.upstreamInputFields || [])],
          upstreamRequiredInputFields: [...(source.upstreamRequiredInputFields || [])],
          upstreamInputSchema: cloneJSON(source.upstreamInputSchema || {}),
          modality: source.modality || "",
          operations: [...(source.operations || [])],
          kind: source.kind,
          tool: source.kind === "image_tool" ? source.tool || "background_remove" : "",
          description: source.description,
          fastMode: source.fastMode,
          minSeconds: source.minSeconds,
          maxSeconds: source.maxSeconds,
          resolutions: [...(source.resolutions || [])],
          supportsExactSize: source.supportsExactSize === true,
          exactSizeLimits: exactSizeLimits(source.exactSizeLimits),
          aspectRatios: [...(source.aspectRatios || IMAGE_ASPECT_RATIOS)],
          aspectRatiosByResolution: normalizeAspectRatiosByResolution(
            source.resolutions || [],
            source.aspectRatiosByResolution || {},
            source.aspectRatios || IMAGE_ASPECT_RATIOS,
            source.autoAspectRatios || {},
          ),
          qualities: [
            ...(source.qualities || IMAGE_QUALITIES.map((item) => item.value)),
          ],
          transparentBackground: source.transparentBackground !== false,
          outputFormats: [...(source.outputFormats || [])],
          outputFormatsEnabled: (source.outputFormats || []).length > 0,
          moderationLevels: [...(source.moderationLevels || [])],
          moderationEnabled: (source.moderationLevels || []).length > 0,
          maxReferenceImages: Number(source.maxReferenceImages ?? 4),
          maxImages: Number(source.maxImages ?? 4),
          contextWindowTokens: Number(source.contextWindowTokens ?? (source.kind === "chat" ? 128000 : 0)),
          maxOutputTokens: Number(source.maxOutputTokens ?? (source.kind === "chat" ? 8192 : 0)),
          supportedReasoningEfforts:
            source.kind === "chat"
              ? configuredReasoningOptions(source)
              : [],
          reasoningPricing:
            source.kind === "chat"
              ? normalizeReasoningPricing(
                  source.reasoningPricing,
                  configuredReasoningOptions(source),
                  source.priceCents,
                  source.discountPriceCents,
                  Array.isArray(source.supportedReasoningEfforts)
                    ? source.supportedReasoningEfforts
                    : null,
                )
              : null,
          public: source.public,
          reasoningEnabled: source.reasoningEnabled ?? Boolean(source.supportedReasoningEfforts?.length),
          default: source.default,
          enabled: source.enabled,
          pricePoints: normalizePoints(source.priceCents),
          discountEnabled: source.discountPriceCents !== null,
          discountPoints: normalizePoints(source.discountPriceCents),
          upstreamCostPoints: normalizePoints(source.upstreamCostCents || 0),
          allowZeroPrice: source.allowZeroPrice === true,
          allowLossLeader: source.allowLossLeader === true,
          upscaleHighPricePoints: normalizePoints(source.imageUpscalePricing?.highPriceCents ?? source.priceCents),
          upscaleHighDiscountEnabled: source.imageUpscalePricing?.highDiscountPriceCents !== null
            && source.imageUpscalePricing?.highDiscountPriceCents !== undefined,
          upscaleHighDiscountPoints: normalizePoints(
            source.imageUpscalePricing?.highDiscountPriceCents ?? source.imageUpscalePricing?.highPriceCents ?? source.priceCents,
          ),
          upscaleHighUpstreamCostPoints: normalizePoints(
            source.imageUpscalePricing?.highUpstreamCostCents ?? source.upstreamCostCents ?? 0,
          ),
        }
      : {
          id: createId("model"),
          name: "",
          iconUrl: "",
          status: "available",
          providerId: defaultProvider,
          upstreamModel: "",
          upstreamInputFields: [],
          upstreamRequiredInputFields: [],
          upstreamInputSchema: {},
          modality: "",
          operations: [],
          kind:
            kindFilter.value === "chat"
              ? "chat"
              : kindFilter.value === "image_tool"
                ? "image_tool"
                : "image",
          tool: kindFilter.value === "image_tool" ? "background_remove" : "",
          description: "",
          pricePoints: 20,
          discountEnabled: false,
          discountPoints: 20,
          upstreamCostPoints: 0,
          allowZeroPrice: false,
          allowLossLeader: false,
          upscaleHighPricePoints: 20,
          upscaleHighDiscountEnabled: false,
          upscaleHighDiscountPoints: 20,
          upscaleHighUpstreamCostPoints: 0,
          fastMode: false,
          minSeconds: 30,
          maxSeconds: 90,
          resolutions: ["1K"],
          supportsExactSize: false,
          exactSizeLimits: exactSizeLimits(),
          aspectRatios: [...IMAGE_ASPECT_RATIOS],
          aspectRatiosByResolution: { "1K": [...IMAGE_ASPECT_RATIOS] },
          qualities: IMAGE_QUALITIES.map((item) => item.value),
          transparentBackground: true,
          outputFormats: [...IMAGE_OUTPUT_FORMATS],
          outputFormatsEnabled: true,
          moderationLevels: [...IMAGE_MODERATION_LEVELS],
          moderationEnabled: true,
          maxReferenceImages: 4,
          maxImages: 4,
          contextWindowTokens: kindFilter.value === "chat" ? 128000 : 0,
          maxOutputTokens: kindFilter.value === "chat" ? 8192 : 0,
          supportedReasoningEfforts: [],
          reasoningPricing: null,
          reasoningEnabled: false,
          public: true,
          default: false,
          enabled: true,
        },
  );
  modelEditIndex.value = index;
  activeCRUNSchema.value = null;
  modelDialogVisible.value = true;
  if (
    source &&
    config.providers.find((provider) => provider.id === source.providerId)?.adapter === "crun"
  ) {
    void loadCRUNModelSchema(source.upstreamModel);
  }
}

function pickModelIcon() {
  if (!modelIconUploading.value) modelIconInputRef.value?.click();
}

async function onModelIconPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const supported =
    ["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!supported) {
    ElMessage.warning("模型图标仅支持 PNG、JPG 或 WebP");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning("模型图标不能超过 2MB");
    return;
  }
  modelIconUploading.value = true;
  try {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/v1/admin/model-config/icons", {
      method: "POST",
      credentials: "include",
      body,
    });
    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: { url?: string }; error?: string }
      | null;
    if (!response.ok || !payload?.success || !payload.data?.url) {
      throw new Error(payload?.error || `图标上传失败（HTTP ${response.status}）`);
    }
    modelDraft.iconUrl = payload.data.url;
    ElMessage.success("模型图标已上传");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "模型图标上传失败");
  } finally {
    modelIconUploading.value = false;
  }
}

async function openReasoningPricing(model: ModelItem) {
  openModel(modelOriginalIndex(model));
  modelEditorTab.value = 'pricing';
  await nextTick();
  document
    .getElementById("model-reasoning-pricing-section")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusModelCapabilities() {
  modelEditorTab.value = 'capabilities';
  requestAnimationFrame(() => {
    document
      .getElementById("model-capabilities-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

const activeCRUNSchema = ref<ModelCatalogEntry | null>(null);
const loadingCRUNSchema = ref(false);

const selectedModelProvider = computed(() =>
  config.providers.find((item) => item.id === modelDraft.providerId),
);

const selectedProviderCatalogEntries = computed(
  () => catalogEntriesByProvider[modelDraft.providerId] || [],
);

const modelProviderOptions = computed(() => {
  const provider = selectedModelProvider.value;
  const entries = selectedProviderCatalogEntries.value;
  if (provider?.adapter === "crun" && entries.length) {
    return entries
      .filter((entry) => entry.compatible && entry.kind === modelDraft.kind)
      .map((entry) => entry.id);
  }
  return provider?.discoveredModels || [];
});

const currentSchemaProperties = computed(
  () => activeCRUNSchema.value?.inputSchema?.properties || {},
);

function schemaStringEnum(field: string) {
  return (currentSchemaProperties.value[field]?.enum || [])
    .map((value) => String(value).trim())
    .filter(Boolean);
}

const schemaResolutionOptions = computed(() =>
  Array.from(
    new Set(
      schemaStringEnum("resolution").map((value) => value.toUpperCase()),
    ),
  ),
);

const schemaAspectRatioOptions = computed(() =>
  schemaStringEnum("aspect_ratio")
    .map((value) => value.toLowerCase())
    .filter((value) => IMAGE_ASPECT_RATIOS.includes(value)),
);

const schemaQualityOptions = computed(() =>
  schemaStringEnum("quality")
    .map((value) => value.toLowerCase())
    .filter((value) => IMAGE_QUALITIES.some((item) => item.value === value)),
);

const schemaOutputFormatOptions = computed(() =>
  schemaStringEnum("output_format")
    .map((value) => value.toLowerCase())
    .filter((value) => IMAGE_OUTPUT_FORMATS.includes(value)),
);

const schemaModerationOptions = computed(() =>
  schemaStringEnum("moderation")
    .map((value) => value.toLowerCase())
    .filter((value) => IMAGE_MODERATION_LEVELS.includes(value)),
);

const schemaSupportsTransparentBackground = computed(() =>
  schemaStringEnum("background").some(
    (value) => value.toLowerCase() === "transparent",
  ),
);

const schemaReferenceMax = computed(() => {
  if (!modelDraft.upstreamInputFields.includes("img_urls")) return 0;
  const maxItems = Number(currentSchemaProperties.value.img_urls?.maxItems || 0);
  return Math.min(16, Math.max(1, maxItems || 1));
});

const isSchemaDrivenCRUNImage = computed(
  () =>
    selectedModelProvider.value?.adapter === "crun" &&
    modelDraft.kind === "image",
);

const canConfigureExactSize = computed(() =>
  !isSchemaDrivenCRUNImage.value || schemaSupportsExactSize(modelDraft.upstreamInputSchema, modelDraft.upstreamInputFields),
);

const availableResolutionOptions = computed(() =>
  isSchemaDrivenCRUNImage.value
    ? schemaResolutionOptions.value
    : ["1K", "2K", "4K"],
);

const availableAspectRatioOptions = computed(() =>
  isSchemaDrivenCRUNImage.value
    ? schemaAspectRatioOptions.value
    : IMAGE_ASPECT_RATIOS,
);

const availableQualityOptions = computed(() =>
  isSchemaDrivenCRUNImage.value
    ? IMAGE_QUALITIES.filter((item) =>
        schemaQualityOptions.value.includes(item.value),
      )
    : IMAGE_QUALITIES,
);

const availableOutputFormatOptions = computed(() =>
  isSchemaDrivenCRUNImage.value
    ? schemaOutputFormatOptions.value
    : IMAGE_OUTPUT_FORMATS,
);

const availableModerationOptions = computed(() =>
  isSchemaDrivenCRUNImage.value
    ? schemaModerationOptions.value
    : IMAGE_MODERATION_LEVELS,
);

async function fetchCRUNModelSchema(provider: ModelProvider, model: string) {
  syncProviderPrimary(provider);
  return request<ModelCatalogEntry>("/api/v1/admin/model-config/discoveries", {
    method: "POST",
    query: { model },
    body: provider,
  });
}

function applyCRUNModelSchema(entry: ModelCatalogEntry) {
  activeCRUNSchema.value = entry;
  modelDraft.upstreamInputFields = [...(entry.inputFields || [])];
  modelDraft.upstreamRequiredInputFields = [...(entry.requiredInputFields || [])];
  modelDraft.upstreamInputSchema = cloneJSON(entry.inputSchema || {});
  modelDraft.modality = entry.modality || "";
  modelDraft.operations = [...(entry.operations || [])];
  if (entry.kind && modelDraft.kind !== entry.kind) {
    modelDraft.kind = entry.kind;
    onModelKindChange(entry.kind);
  }
  modelDraft.tool = entry.kind === "image_tool"
    ? String(entry.operations?.[0] || "").replaceAll("-", "_")
    : "";
  if (entry.kind !== "image") return;

  const resolutions = [...schemaResolutionOptions.value];
  const ratios = [...schemaAspectRatioOptions.value];
  modelDraft.resolutions = resolutions;
  modelDraft.aspectRatios = ratios;
  modelDraft.aspectRatiosByResolution = Object.fromEntries(
    resolutions.map((resolution) => [resolution, [...ratios]]),
  );
  modelDraft.qualities = [...schemaQualityOptions.value];
  modelDraft.transparentBackground = schemaSupportsTransparentBackground.value;
  modelDraft.outputFormats = [...schemaOutputFormatOptions.value];
  modelDraft.outputFormatsEnabled = modelDraft.outputFormats.length > 0;
  modelDraft.moderationLevels = [...schemaModerationOptions.value];
  modelDraft.moderationEnabled = modelDraft.moderationLevels.length > 0;
  modelDraft.maxReferenceImages = schemaReferenceMax.value;
  modelDraft.maxImages = Math.min(4, Math.max(1, modelDraft.maxImages || 4));
}

async function loadCRUNModelSchema(model: string) {
  const provider = selectedModelProvider.value;
  if (provider?.adapter !== "crun" || !model.trim()) {
    activeCRUNSchema.value = null;
    return;
  }
  const catalogEntry = selectedProviderCatalogEntries.value.find(
    (entry) => entry.id === model,
  );
  if (catalogEntry?.kind === "chat") {
    activeCRUNSchema.value = catalogEntry;
    modelDraft.upstreamInputFields = [];
    return;
  }
  loadingCRUNSchema.value = true;
  try {
    applyCRUNModelSchema(await fetchCRUNModelSchema(provider, model));
    ElMessage.success("已按 CRUN 实时参数同步模型能力");
  } catch {
    activeCRUNSchema.value = null;
    modelDraft.upstreamInputFields = [];
    modelDraft.upstreamRequiredInputFields = [];
    modelDraft.upstreamInputSchema = {};
    modelDraft.modality = "";
    modelDraft.operations = [];
  } finally {
    loadingCRUNSchema.value = false;
  }
}

function onModelProviderChange() {
  modelDraft.upstreamModel = "";
  modelDraft.upstreamInputFields = [];
  modelDraft.upstreamRequiredInputFields = [];
  modelDraft.upstreamInputSchema = {};
  modelDraft.modality = "";
  modelDraft.operations = [];
  activeCRUNSchema.value = null;
  syncModelDraftReasoningPricing();
}

function selectModelKind(kind: ModelKind) {
  if (modelDraft.kind === kind) return;
  modelDraft.kind = kind;
  onModelKindChange(kind);
}

function onModelKindChange(value: unknown) {
  const kind = String(value) as ModelKind;
	modelDraft.tool = kind === "image_tool" ? modelDraft.tool : "";
	modelDraft.contextWindowTokens = kind === "chat" ? Math.max(4096, modelDraft.contextWindowTokens || 128000) : 0;
	modelDraft.maxOutputTokens = kind === "chat" ? Math.max(256, modelDraft.maxOutputTokens || 8192) : 0;
	if (kind !== "image") {
    modelDraft.supportsExactSize = false;
    modelDraft.resolutions = [];
    modelDraft.fastMode = false;
    modelDraft.aspectRatios = [];
    modelDraft.aspectRatiosByResolution = {};
    modelDraft.qualities = [];
    modelDraft.transparentBackground = false;
    modelDraft.outputFormats = [];
    modelDraft.outputFormatsEnabled = false;
    modelDraft.moderationLevels = [];
    modelDraft.moderationEnabled = false;
    modelDraft.maxReferenceImages = 0;
    modelDraft.maxImages = 0;
  } else if (!modelDraft.resolutions.length) {
    modelDraft.resolutions = ["1K"];
    modelDraft.aspectRatios = [...IMAGE_ASPECT_RATIOS];
    modelDraft.aspectRatiosByResolution = normalizeAspectRatiosByResolution(
      modelDraft.resolutions,
      modelDraft.aspectRatiosByResolution,
      modelDraft.aspectRatios,
    );
    modelDraft.qualities = IMAGE_QUALITIES.map((item) => item.value);
    modelDraft.transparentBackground = true;
    modelDraft.outputFormats = [...IMAGE_OUTPUT_FORMATS];
    modelDraft.outputFormatsEnabled = true;
    modelDraft.moderationLevels = [...IMAGE_MODERATION_LEVELS];
    modelDraft.moderationEnabled = true;
    modelDraft.maxReferenceImages = 4;
    modelDraft.maxImages = 4;
  }
	syncModelDraftReasoningPricing();
}

async function onUpstreamModelChange(value: string) {
  if (!modelDraft.name.trim()) modelDraft.name = value;
  syncModelDraftReasoningPricing();
  await loadCRUNModelSchema(value);
}

function syncModelDraftReasoningPricing(fillFromBase = false) {
  const efforts =
    modelDraft.kind === "chat"
      ? configuredReasoningOptions(modelDraft)
      : [];
  modelDraft.supportedReasoningEfforts = efforts;
  modelDraft.reasoningPricing = normalizeReasoningPricing(
    fillFromBase ? null : modelDraft.reasoningPricing,
    efforts,
    modelDraft.pricePoints,
    modelDraft.discountEnabled ? modelDraft.discountPoints : null,
  );
}

function toggleReasoningSupport(value: unknown) {
  modelDraft.reasoningEnabled = value === true;
  if (modelDraft.reasoningEnabled) {
    syncModelDraftReasoningPricing();
    if (!enabledReasoningEfforts(modelDraft).length && modelDraft.reasoningPricing) {
      modelDraft.reasoningPricing.efforts.medium.enabled = true;
      modelDraft.reasoningPricing.defaultEffort = 'medium';
    }
  }
}

function fillReasoningPricingFromBase() {
  const previous = modelDraft.reasoningPricing;
  syncModelDraftReasoningPricing(true);
  if (previous && modelDraft.reasoningPricing) {
    for (const effort of modelDraft.supportedReasoningEfforts) {
      const next = modelDraft.reasoningPricing.efforts[effort];
      const prior = previous.efforts?.[effort];
      if (next) next.enabled = reasoningEffortEnabled(prior);
    }
    const enabled = enabledReasoningEfforts(modelDraft);
    modelDraft.reasoningPricing.defaultEffort = enabled.includes(
      previous.defaultEffort,
    )
      ? previous.defaultEffort
      : defaultReasoningEffort(enabled);
  }
  ElMessage.success("已按兼容规则填充各推理档积分");
}

function reasoningDiscountEnabled(
  effort: string,
  scope: ReasoningPriceScope,
) {
  const price = modelDraft.reasoningPricing?.efforts?.[effort];
  return scope === "assistant"
    ? price?.assistantDiscountPriceCents !== null &&
        price?.assistantDiscountPriceCents !== undefined
    : price?.canvasAgentDiscountPriceCents !== null &&
        price?.canvasAgentDiscountPriceCents !== undefined;
}

function toggleReasoningDiscount(
  effort: string,
  scope: ReasoningPriceScope,
  enabled: unknown,
) {
  const price = modelDraft.reasoningPricing?.efforts?.[effort];
  if (!price) return;
  if (scope === "assistant") {
    price.assistantDiscountPriceCents =
      enabled === true ? price.assistantPriceCents : null;
  } else {
    price.canvasAgentDiscountPriceCents =
      enabled === true ? price.canvasAgentPriceCents : null;
  }
}

function setReasoningPrice(
  effort: string,
  field: 'assistantPriceCents' | 'assistantDiscountPriceCents' | 'canvasAgentPriceCents' | 'canvasAgentDiscountPriceCents',
  value: number | null | undefined,
) {
  const price = modelDraft.reasoningPricing?.efforts?.[effort];
  if (!price) return;
  // Null means explicitly disabled, never a temporarily cleared numeric input.
  price[field] = normalizePoints(value ?? 0);
}

function syncDefaultReasoningEffort() {
  const enabledEfforts = enabledReasoningEfforts(modelDraft);
  if (!modelDraft.reasoningPricing) return;
  if (!enabledEfforts.includes(modelDraft.reasoningPricing.defaultEffort)) {
    modelDraft.reasoningPricing.defaultEffort =
      defaultReasoningEffort(enabledEfforts);
  }
}

function setReasoningEffortEnabled(effort: string, on: boolean) {
  const price = modelDraft.reasoningPricing?.efforts?.[effort];
  if (!price) return;
  price.enabled = on;
  syncDefaultReasoningEffort();
}

function draftReasoningEffortOn(effort: string) {
  return reasoningEffortEnabled(modelDraft.reasoningPricing?.efforts?.[effort]);
}

watch(
  () => modelDraft.resolutions.join("|"),
  () => {
    modelDraft.aspectRatiosByResolution = normalizeAspectRatiosByResolution(
      modelDraft.resolutions,
      modelDraft.aspectRatiosByResolution,
      modelDraft.aspectRatios,
    );
  },
);

function onOutputFormatsEnabled(value: unknown) {
  if (value === true && !modelDraft.outputFormats.length) {
    modelDraft.outputFormats = [...availableOutputFormatOptions.value];
  }
}

function onModerationEnabled(value: unknown) {
  if (value === true && !modelDraft.moderationLevels.length) {
    modelDraft.moderationLevels = [...availableModerationOptions.value];
  }
}

async function refreshModelOptions() {
  const provider = config.providers.find(
    (item) => item.id === modelDraft.providerId,
  );
  if (!provider) {
    ElMessage.warning("请先选择服务商");
    return;
  }
  discoveringModelOptions.value = true;
  try {
    const result = await fetchProviderModels(provider);
    provider.discoveredModels = result.models || [];
    catalogEntriesByProvider[provider.id] = result.entries || [];
    providerCatalogSummary.value = discoverySummary(result);
    if (provider.adapter === "crun" && modelDraft.upstreamModel) {
      await loadCRUNModelSchema(modelDraft.upstreamModel);
    }
    if (result.warning) ElMessage.warning(result.warning);
    else ElMessage.success(providerCatalogSummary.value);
  } finally {
    discoveringModelOptions.value = false;
  }
}

async function saveModelDraft() {
  if (
    !modelDraft.name.trim() ||
    !modelDraft.upstreamModel.trim() ||
    !modelDraft.providerId
  ) {
    modelEditorTab.value = 'basic';
    ElMessage.warning("请填写模型名称、上游模型 ID 和服务商");
    return;
  }
  if (modelDraft.kind === "image") {
    const error = modelDraft.supportsExactSize && !canConfigureExactSize.value
      ? "此模型未声明支持精确尺寸，请先读取模型能力或关闭精确尺寸"
      : validateExactSizeLimits(modelDraft.exactSizeLimits);
    if (error) {
      modelEditorTab.value = 'capabilities';
      ElMessage.warning(error);
      focusModelCapabilities();
      return;
    }
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.resolutions.length > 0 &&
    modelDraft.resolutions.some(
      (resolution) => !modelDraft.aspectRatiosByResolution[resolution]?.length,
    )
  ) {
    modelEditorTab.value = 'capabilities';
    ElMessage.warning("每个分辨率至少选择一个用户可用比例");
    focusModelCapabilities();
    return;
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.resolutions.length > 0 &&
    modelDraft.resolutions.some((resolution) => {
      const ratios = modelDraft.aspectRatiosByResolution[resolution] || [];
      return ratios.includes("auto") && !ratios.some((ratio) => ratio !== "auto");
    })
  ) {
    modelEditorTab.value = 'capabilities';
    ElMessage.warning("选择 Auto 的分辨率还需要至少一个固定比例");
    focusModelCapabilities();
    return;
  }
	const provider = config.providers.find((item) => item.id === modelDraft.providerId);
	if (
		provider?.adapter === "crun" &&
		modelDraft.kind !== "chat" &&
		!modelDraft.upstreamInputFields.length
	) {
		modelEditorTab.value = 'basic';
		ElMessage.warning("请先读取该 CRUN 模型的实时参数，不能按猜测配置");
		return;
	}
	if (modelDraft.kind === "image_tool") {
		if (!modelDraft.tool || !modelDraft.operations.length || !Object.keys(modelDraft.upstreamInputSchema).length) {
			modelEditorTab.value = 'basic';
			ElMessage.warning("请先读取 CRUN 实时 schema，工具能力不能手工填写");
			return;
		}
		if (provider?.adapter !== "crun") {
			modelEditorTab.value = 'basic';
			ElMessage.warning("媒体工具当前只支持 CRUN 服务商");
			return;
		}
		if (
			modelDraft.tool === "image_upscale" &&
			modelDraft.upscaleHighDiscountEnabled &&
			modelDraft.upscaleHighDiscountPoints > modelDraft.upscaleHighPricePoints
		) {
			modelEditorTab.value = 'pricing';
			ElMessage.warning("4096px 档折扣积分不能高于标准积分");
			return;
		}
	}
  if (
    modelDraft.kind === "image" &&
    modelDraft.outputFormatsEnabled &&
    !modelDraft.outputFormats.length
  ) {
    modelEditorTab.value = 'capabilities';
    ElMessage.warning("开启指定输出格式后，至少选择一种格式");
    return;
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.moderationEnabled &&
    !modelDraft.moderationLevels.length
  ) {
    modelEditorTab.value = 'capabilities';
    ElMessage.warning("开启内容审核级别后，至少选择一个级别");
    return;
  }
  if (modelDraft.default && (!modelDraft.public || !modelDraft.enabled)) {
    modelEditorTab.value = 'publishing';
    ElMessage.warning("默认模型必须启用并对用户开放");
    return;
  }
  if (modelDraft.default && modelDraft.status === "maintenance") {
    modelEditorTab.value = 'publishing';
    ElMessage.warning("维护中的模型不能设为默认模型");
    return;
  }
  if (modelDraft.kind === "chat" && modelDraft.reasoningEnabled && modelDraft.reasoningPricing) {
    for (const effort of modelDraft.supportedReasoningEfforts) {
      const price = modelDraft.reasoningPricing.efforts[effort];
      if (price && !reasoningEffortEnabled(price)) continue;
      if (!price) {
        modelEditorTab.value = 'pricing';
        ElMessage.warning(`推理强度 ${effort} 缺少积分配置`);
        return;
      }
      if (
        (price.assistantDiscountPriceCents !== null &&
          price.assistantDiscountPriceCents > price.assistantPriceCents) ||
        (price.canvasAgentDiscountPriceCents !== null &&
          price.canvasAgentDiscountPriceCents > price.canvasAgentPriceCents)
      ) {
        modelEditorTab.value = 'pricing';
        ElMessage.warning(`${REASONING_EFFORT_LABELS[effort] || effort}档折扣积分不能高于标准积分`);
        return;
      }
      if (modelDraft.enabled && modelDraft.public) {
        const channels = [
          {
            label: "AI 助手",
            standard: price.assistantPriceCents,
            discount: price.assistantDiscountPriceCents,
          },
          {
            label: "无限画布 Agent",
            standard: price.canvasAgentPriceCents,
            discount: price.canvasAgentDiscountPriceCents,
          },
        ];
        for (const channel of channels) {
          const effective = channel.discount ?? channel.standard;
          if (effective === 0 && !modelDraft.allowZeroPrice) {
            modelEditorTab.value = 'pricing';
            ElMessage.warning(`${REASONING_EFFORT_LABELS[effort] || effort}档 ${channel.label} 为 0 积分，请开启允许零积分`);
            return;
          }
          if (effective < modelDraft.upstreamCostPoints && !modelDraft.allowLossLeader) {
            modelEditorTab.value = 'pricing';
            ElMessage.warning(`${REASONING_EFFORT_LABELS[effort] || effort}档 ${channel.label} 价格低于上游成本`);
            return;
          }
        }
      }
    }
  }
  const value: ModelItem = {
    id: modelDraft.id,
    name: modelDraft.name.trim(),
    iconUrl: modelDraft.iconUrl.trim(),
    status: modelDraft.status,
    providerId: modelDraft.providerId,
    upstreamModel: modelDraft.upstreamModel.trim(),
    upstreamInputFields: [...modelDraft.upstreamInputFields],
    upstreamRequiredInputFields: [...modelDraft.upstreamRequiredInputFields],
    upstreamInputSchema: cloneJSON(modelDraft.upstreamInputSchema),
    modality: modelDraft.modality,
    operations: [...modelDraft.operations],
    kind: modelDraft.kind,
    tool: modelDraft.kind === "image_tool" ? modelDraft.tool : "",
    description: modelDraft.description.trim(),
    priceCents: normalizePoints(modelDraft.pricePoints),
    discountPriceCents: modelDraft.discountEnabled
      ? normalizePoints(modelDraft.discountPoints)
      : null,
    upstreamCostCents: normalizePoints(modelDraft.upstreamCostPoints),
    allowZeroPrice: modelDraft.allowZeroPrice,
    allowLossLeader: modelDraft.allowLossLeader,
    imageUpscalePricing:
      modelDraft.kind === "image_tool" && modelDraft.tool === "image_upscale"
        ? {
            thresholdPixels: 2048,
            highPriceCents: normalizePoints(modelDraft.upscaleHighPricePoints),
            highDiscountPriceCents: modelDraft.upscaleHighDiscountEnabled
              ? normalizePoints(modelDraft.upscaleHighDiscountPoints)
              : null,
            highUpstreamCostCents: normalizePoints(modelDraft.upscaleHighUpstreamCostPoints),
          }
        : null,
    fastMode: false,
    minSeconds: modelDraft.minSeconds,
    maxSeconds: modelDraft.maxSeconds,
    supportsExactSize: modelDraft.kind === "image" && modelDraft.supportsExactSize,
    exactSizeLimits: { ...modelDraft.exactSizeLimits },
    resolutions:
      modelDraft.kind === "image"
        ? modelDraft.resolutions.filter(
            (resolution) => String(resolution).toUpperCase() !== "AUTO",
          )
        : [],
    aspectRatios: modelDraft.kind === "image"
      ? modelDraft.resolutions.length
        ? aspectRatioUnion(modelDraft.aspectRatiosByResolution)
        : [...modelDraft.aspectRatios]
      : [],
    aspectRatiosByResolution:
      modelDraft.kind === "image"
        ? normalizeAspectRatiosByResolution(
            modelDraft.resolutions,
            modelDraft.aspectRatiosByResolution,
            modelDraft.aspectRatios,
          )
        : {},
    qualities: modelDraft.kind === "image" ? [...modelDraft.qualities] : [],
    transparentBackground:
      modelDraft.kind === "image" && modelDraft.transparentBackground,
    outputFormats:
      modelDraft.kind === "image" && modelDraft.outputFormatsEnabled
        ? [...modelDraft.outputFormats]
        : [],
    moderationLevels:
      modelDraft.kind === "image" && modelDraft.moderationEnabled
        ? [...modelDraft.moderationLevels]
        : [],
    maxReferenceImages:
      modelDraft.kind === "image"
        ? Math.min(16, Math.max(0, Math.round(modelDraft.maxReferenceImages)))
        : 0,
    maxImages:
      modelDraft.kind === "image"
        ? Math.min(100, Math.max(1, Math.round(modelDraft.maxImages)))
        : 0,
    contextWindowTokens:
      modelDraft.kind === "chat"
        ? Math.min(2000000, Math.max(4096, Math.round(modelDraft.contextWindowTokens)))
        : 0,
    maxOutputTokens:
      modelDraft.kind === "chat"
        ? Math.min(
            Math.max(256, Math.round(modelDraft.contextWindowTokens) - 1),
            Math.max(256, Math.round(modelDraft.maxOutputTokens)),
          )
        : 0,
    supportedReasoningEfforts: [] as string[],
    reasoningPricing: null as ReasoningPricing | null,
    reasoningEnabled: modelDraft.kind === "chat" && modelDraft.reasoningEnabled === true,
    public: modelDraft.public,
    default: modelDraft.default,
    enabled: modelDraft.enabled,
  };
  if (modelDraft.kind === "chat") {
    const pricing = normalizeReasoningPricing(
      modelDraft.reasoningPricing,
      modelDraft.supportedReasoningEfforts,
      modelDraft.pricePoints,
      modelDraft.discountEnabled ? modelDraft.discountPoints : null,
    );
    value.reasoningPricing = pricing;
    value.supportedReasoningEfforts = value.reasoningEnabled ? enabledReasoningEfforts({
      supportedReasoningEfforts: modelDraft.supportedReasoningEfforts,
      reasoningPricing: pricing,
    }) : [];
  } else {
    value.supportedReasoningEfforts = [];
    value.reasoningPricing = null;
  }
  if (value.default) {
    for (const item of config.models) {
      if (item.kind === value.kind && item.id !== value.id)
        item.default = false;
    }
  }
  if (modelEditIndex.value >= 0) config.models[modelEditIndex.value] = value;
  else config.models.push(value);
  if (
    !config.models.some(
      (item) =>
        item.kind === value.kind && item.default && item.public && item.enabled && item.status !== "maintenance",
    )
  ) {
    value.default = value.public && value.enabled && value.status !== "maintenance";
  }
  sanitizeWorkspaceBindings();
  modelDialogVisible.value = false;
  ElMessage.success("模型修改已暂存，请点击顶部“保存配置”生效");
}

async function removeModel(index: number) {
  const model = config.models[index];
  await ElMessageBox.confirm(`确认删除模型“${model.name}”？`, "删除模型", {
    type: "warning",
  });
  config.models.splice(index, 1);
  pruneWorkspaceModel(model.id);
  if (model.default) {
    const next = config.models.find(
      (item) => item.kind === model.kind && item.public && item.enabled && item.status !== "maintenance",
    );
    if (next) next.default = true;
  }
}

function modelOriginalIndex(value: unknown) {
  const row = value as ModelItem;
  return config.models.findIndex((item) => item.id === row.id);
}

function onCatalogModelStateChange(value: unknown) {
  const model = value as ModelItem;
  if (model.status === "maintenance") model.default = false;
  if (!model.public || !model.enabled) {
    model.default = false;
    pruneWorkspaceModel(model.id);
  }
}

function openFrontendTool(value: unknown) {
  const model = value as ModelItem;
  const url = new URL(
    `/tools/${encodeURIComponent(model.id)}`,
    window.location.origin,
  );
  if (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.port === "3200"
  ) {
    url.port = "3105";
  }
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value && !saving.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onBeforeRouteLeave(async () => {
  if (saving.value) { ElMessage.warning("正在保存，请稍候再离开"); return false; }
  if (!isDirty.value) return true;
  try {
    await ElMessageBox.confirm("修改尚未保存。离开会放弃这些修改，不会提交到服务器。", "未保存的修改", { confirmButtonText: "放弃并离开", cancelButtonText: "继续编辑", type: "warning" });
    return true;
  } catch { return false; }
});
onMounted(() => {
  window.addEventListener("beforeunload", warnBeforeUnload);
  window.addEventListener("keydown", handleToolbarShortcut);
  void load();
});
onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", warnBeforeUnload);
  window.removeEventListener("keydown", handleToolbarShortcut);
});
</script>

<template>
  <div v-loading="loading" class="model-config-page">
    <el-alert v-if="loadFailed" type="error" title="配置加载失败，保存已禁用。请重新加载，不要重新创建现有配置。" :closable="false" show-icon />
    <PageCard>
      <div class="config-toolbar">
        <div class="config-toolbar__row">
          <div class="status-tabs" role="tablist" aria-label="模型配置视图">
            <button
              v-for="tab in viewTabs"
              :key="tab.value"
              type="button"
              role="tab"
              class="status-tab"
              :class="{ 'is-active': activeView === tab.value }"
              :aria-selected="activeView === tab.value"
              @click="activeView = tab.value"
            >
              {{ tab.label }}
              <em class="tnum">{{ tab.count }}</em>
            </button>
          </div>

          <div class="config-toolbar__commit">
            <el-tooltip content="从服务器重新加载配置" placement="bottom">
              <el-button class="toolbar-icon-button" :icon="Refresh" :loading="loading" aria-label="刷新" @click="load" />
            </el-tooltip>
            <el-button v-if="loadFailed" :disabled="loading" @click="load">重新加载</el-button>
            <button
              type="button"
              class="save-button"
              :class="{ 'is-dirty': isDirty || saving, 'is-failed': loadFailed }"
              :disabled="!canSave"
              :aria-label="isDirty ? `保存配置（${saveShortcutLabel}）` : saveStatusLabel"
              @click="save"
            >
              <Loading v-if="saving" class="save-button__icon is-spinning" aria-hidden="true" />
              <span v-else-if="isDirty" class="save-button__dot" aria-hidden="true" />
              <Check v-else-if="configLoaded && !loadFailed" class="save-button__icon" aria-hidden="true" />
              <span role="status">{{ isDirty && !saving ? "保存配置" : saveStatusLabel }}</span>
              <kbd v-if="isDirty && !saving">{{ saveShortcutLabel }}</kbd>
            </button>
          </div>
        </div>

        <div v-if="activeView === 'models'" class="config-toolbar__row config-toolbar__row--sub">
          <div class="config-toolbar__filters">
            <div class="kind-filter" role="tablist" aria-label="模型类型">
              <button
                v-for="item in kindFilters"
                :key="item.id"
                type="button"
                role="tab"
                :aria-selected="kindFilter === item.id"
                :class="{ active: kindFilter === item.id }"
                @click="kindFilter = item.id"
              >
                {{ item.label }}
                <em class="tnum">{{ kindCounts[item.id] }}</em>
              </button>
            </div>
            <el-input
              ref="modelSearchInput"
              v-model="modelSearch"
              clearable
              placeholder="搜索模型 / 上游 ID / 服务商"
              class="model-search"
              :prefix-icon="Search"
              @focus="modelSearchFocused = true"
              @blur="modelSearchFocused = false"
              @keydown.esc="modelSearch ? (modelSearch = '') : ($event.target as HTMLInputElement).blur()"
            >
              <template v-if="!modelSearch && !modelSearchFocused" #suffix>
                <kbd class="search-kbd" title="按 / 聚焦搜索">/</kbd>
              </template>
            </el-input>
            <span v-if="modelSearch.trim()" class="config-toolbar__result tnum">
              匹配 {{ filteredModels.length }} 个
            </span>
          </div>
          <div class="config-toolbar__buttons">
            <el-tooltip content="请先添加服务商" placement="bottom" :disabled="!!config.providers.length">
              <span class="toolbar-button-wrap">
                <el-button class="toolbar-add" :icon="Plus" :disabled="!config.providers.length" @click="openModel()">
                  添加模型
                </el-button>
              </span>
            </el-tooltip>
          </div>
        </div>

        <div v-else-if="activeView === 'providers'" class="config-toolbar__row config-toolbar__row--sub">
          <span class="config-toolbar__summary tnum">
            {{ config.providers.length }} 个服务商 · {{ providerRouteCount }} 条线路
          </span>
          <div class="config-toolbar__buttons">
            <el-button class="toolbar-add" :icon="Plus" @click="openProvider()">添加服务商</el-button>
          </div>
        </div>
      </div>

      <section v-if="activeView === 'models'" class="config-panel">
        <AdminListShell
          class="config-list-shell model-catalog-shell"
          fill
          :has-prev="modelPagination.hasPrev.value"
          :has-next="modelPagination.hasNext.value"
          :loading="loading"
          :page="modelPagination.page.value"
          :count="modelPagination.items.value.length"
          :total="modelPagination.total.value"
          :page-size="modelPagination.pageSize.value"
          @update:page="modelPagination.goToPage"
          @update:page-size="modelPagination.setPageSize"
        >
          <div
            v-if="modelPagination.items.value.length"
            class="model-card-grid"
          >
            <article
              v-for="row in modelPagination.items.value"
              :key="row.id"
              class="model-card"
              :class="{ 'is-disabled': !row.enabled }"
            >
              <header class="model-card__head">
                <div class="model-card__identity">
                  <span class="model-card__icon" aria-hidden="true">
                    <img v-if="row.iconUrl" :src="row.iconUrl" alt="" />
                    <Cpu v-else />
                  </span>
                  <div class="model-card__identity-copy">
                    <div class="model-card__title">
                      <strong :title="row.name">{{ row.name }}</strong>
                      <span class="kind-badge" :class="`is-${row.kind}`">{{
                        kindName(row.kind)
                      }}</span>
                      <span v-if="row.default" class="default-badge">默认</span>
                      <span v-if="row.status === 'maintenance'" class="maintenance-badge">维护中</span>
                    </div>
                    <div
                      class="model-card__line"
                      :title="`${providerName(row.providerId)} · ${row.upstreamModel} · ${providerAdapterLabel(row.providerId)}`"
                    >
                      <span>{{ providerName(row.providerId) }}</span>
                      <span class="mono">{{ row.upstreamModel || "—" }}</span>
                      <span>{{ providerAdapterLabel(row.providerId) }}</span>
                    </div>
                  </div>
                </div>
                <el-popover
                  v-for="price in [modelCardPrice(row as ModelItem)]"
                  :key="`${row.id}-price`"
                  :disabled="!price.rows.length"
                  placement="bottom-end"
                  :width="280"
                  trigger="click"
                  :show-arrow="false"
                >
                  <template #reference>
                    <button
                      type="button"
                      class="model-card__price"
                      :class="{ 'is-interactive': price.rows.length }"
                      :tabindex="price.rows.length ? 0 : -1"
                      :aria-label="
                        price.rows.length
                          ? `查看 ${price.countLabel}${price.label}`
                          : undefined
                      "
                    >
                      <div class="price-now">
                        <strong class="tnum">{{ price.amount }}</strong>
                        <span>{{ price.label }}</span>
                      </div>
                      <div
                        v-if="price.meta || price.was || price.countLabel"
                        class="price-meta"
                      >
                        <span v-if="price.countLabel" class="price-count">{{
                          price.countLabel
                        }}</span>
                        <span v-if="price.meta" class="price-scope tnum">{{
                          price.meta
                        }}</span>
                        <span v-if="price.was" class="price-was tnum">{{
                          price.was
                        }}</span>
                        <span v-if="price.off" class="price-off">{{
                          price.off
                        }}</span>
                      </div>
                    </button>
                  </template>
                  <div class="model-price-pop">
                    <header class="model-price-pop__head">
                      <strong>{{ price.countLabel }}推理</strong>
                      <span v-if="price.defaultLabel">默认 {{ price.defaultLabel }}</span>
                    </header>
                    <div
                      class="price-scope-switch"
                      role="tablist"
                      aria-label="积分渠道"
                    >
                      <button
                        type="button"
                        role="tab"
                        :class="{
                          'is-active': reasoningPriceScope === 'assistant',
                        }"
                        @click="reasoningPriceScope = 'assistant'"
                      >
                        AI 助手
                      </button>
                      <button
                        type="button"
                        role="tab"
                        :class="{
                          'is-active': reasoningPriceScope === 'canvas_agent',
                        }"
                        @click="reasoningPriceScope = 'canvas_agent'"
                      >
                        无限画布
                      </button>
                    </div>
                    <table class="model-price-pop__table">
                      <thead>
                        <tr>
                          <th>档位</th>
                          <th
                            :class="{
                              'is-active': reasoningPriceScope === 'assistant',
                            }"
                          >
                            助手
                          </th>
                          <th
                            :class="{
                              'is-active':
                                reasoningPriceScope === 'canvas_agent',
                            }"
                          >
                            画布
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="item in price.rows"
                          :key="item.effort"
                          :class="{ 'is-default': item.default }"
                        >
                          <td>
                            {{ item.label }}
                            <em v-if="item.default">默认</em>
                          </td>
                          <td
                            class="tnum"
                            :class="{
                              'is-muted': reasoningPriceScope !== 'assistant',
                            }"
                          >
                            <s v-if="item.assistantWas">{{
                              item.assistantWas
                            }}</s>
                            {{ item.assistant }}
                          </td>
                          <td
                            class="tnum"
                            :class="{
                              'is-muted':
                                reasoningPriceScope !== 'canvas_agent',
                            }"
                          >
                            <s v-if="item.canvasWas">{{ item.canvasWas }}</s>
                            {{ item.canvas }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </el-popover>
              </header>

              <dl class="model-card__stats">
                <div
                  v-for="cell in modelCardStats(row as ModelItem)"
                  :key="cell.label"
                  class="model-card__stat"
                >
                  <dt>{{ cell.label }}</dt>
                  <dd :title="cell.value" :class="{ 'is-muted': cell.muted }">
                    <span v-if="cell.tags" class="model-card__tags">
                      <span v-for="tag in cell.tags" :key="tag" class="res-badge">{{ tag }}</span>
                    </span>
                    <span v-else class="model-card__text">{{ cell.value }}</span>
                  </dd>
                </div>
              </dl>

              <dl class="model-card__rows">
                <div
                  v-for="cell in modelCardRows(row as ModelItem)"
                  :key="cell.label"
                  class="model-card__row"
                >
                  <dt>{{ cell.label }}</dt>
                  <dd :title="cell.value" :class="{ 'is-muted': cell.muted }">
                    <span v-if="cell.parts" class="model-card__aspects">
                      <span v-for="part in cell.parts" :key="part.label" class="model-card__aspect">
                        <span class="res-badge">{{ part.label }}</span>{{ part.text }}
                      </span>
                    </span>
                    <span v-else-if="cell.tags" class="model-card__tags">
                      <span v-for="tag in cell.tags" :key="tag" class="res-badge">{{ tag }}</span>
                    </span>
                    <span v-else class="model-card__text">{{ cell.value }}</span>
                  </dd>
                </div>
              </dl>

              <footer class="model-card__foot">
                <div
                  v-if="row.kind === 'image'"
                  class="model-card__foot-meta"
                  :title="modelModerationLine(row as ModelItem)"
                >
                  <span>审核</span>
                  <strong>{{ modelModerationLine(row as ModelItem) }}</strong>
                </div>
                <label class="model-card__switch">
                  <span>{{ row.kind === "image_tool" ? "前台展示" : "可选" }}</span>
                  <el-switch
                    v-model="row.public"
                    size="small"
                    @change="onCatalogModelStateChange(row)"
                  />
                </label>
                <label class="model-card__switch">
                  <span>启用</span>
                  <el-switch
                    v-model="row.enabled"
                    size="small"
                    @change="onCatalogModelStateChange(row)"
                  />
                </label>
                <label v-if="row.kind === 'image'" class="model-card__switch">
                  <span>移除背景</span>
                  <el-switch v-model="row.transparentBackground" size="small" />
                </label>
                <div class="model-card__actions">
                  <el-button
                    v-if="
                      row.kind === 'image_tool' &&
                      row.tool !== 'background_remove' &&
                      row.public &&
                      row.enabled
                    "
                    link
                    type="primary"
                    @click="openFrontendTool(row)"
                  >
                    前台使用
                  </el-button>
                  <el-button
                    v-if="row.kind === 'chat' && row.supportedReasoningEfforts.length"
                    link
                    type="primary"
                    @click="openReasoningPricing(row as ModelItem)"
                  >
                    推理定价
                  </el-button>
                  <el-button
                    link
                    type="primary"
                    @click="openModel(modelOriginalIndex(row))"
                  >
                    编辑
                  </el-button>
                  <el-button
                    link
                    type="danger"
                    @click="removeModel(modelOriginalIndex(row))"
                  >
                    删除
                  </el-button>
                </div>
              </footer>
            </article>
          </div>
          <el-empty
            v-else
            class="model-catalog-empty"
            description="先连接服务商，再添加要开放给用户的模型"
            :image-size="72"
          />
        </AdminListShell>
      </section>

      <section
        v-else-if="activeView === 'workspaces'"
        class="config-panel assignment-panel"
      >
        <div class="assignment-shell">
          <aside class="assignment-rail" aria-label="前台页面">
            <p class="assignment-rail__hint">业务页面</p>
            <button
              v-for="workspace in workspaceMeta"
              :key="workspace.key"
              type="button"
              class="assignment-rail-item"
              :class="{
                'is-active': activeWorkspaceKey === workspace.key,
                'is-empty': !workspaceAssignedCount(workspace),
              }"
              :title="workspaceDefaultSummary(workspace)"
              :aria-current="activeWorkspaceKey === workspace.key ? 'page' : undefined"
              @click="activeWorkspaceKey = workspace.key"
            >
              <span class="assignment-rail-item__name">{{ workspace.name }}</span>
              <em class="tnum">{{ workspaceAssignedCount(workspace) }}</em>
            </button>
          </aside>

          <div class="assignment-main">
            <header class="assignment-main__head">
              <div class="assignment-main__title">
                <strong>{{ activeWorkspace.name }}</strong>
                <small>{{ activeWorkspace.detail }}</small>
              </div>
              <div v-if="activeWorkspace.kinds.length" class="assignment-defaults">
                <label
                  v-for="kind in activeWorkspace.kinds"
                  :key="kind"
                  class="assignment-default"
                >
                  <span>{{ workspaceDefaultLabel(activeWorkspace, kind) }}</span>
                  <el-select
                    v-model="
                      config.workspaces[activeWorkspace.key].defaultModelIds[kind]
                    "
                    clearable
                    filterable
                    :disabled="
                      !workspaceDefaultOptions(activeWorkspace, kind).length
                    "
                    placeholder="先加入模型"
                  >
                    <el-option
                      v-for="model in workspaceDefaultOptions(
                        activeWorkspace,
                        kind,
                      )"
                      :key="model.id"
                      :label="model.name"
                      :value="model.id"
                    />
                  </el-select>
                </label>
              </div>
            </header>

            <section
              v-if="activeWorkspace.key === 'ui_design'"
              class="workspace-billing-note"
              aria-label="UI 设计稿计费说明"
            >
              <header>
                <strong>框选优化与素材重建计费</strong>
                <small
                  ><code>ui_design_asset</code>
                  与整稿共用本工作区图片模型单价；请将图片价设为非 0，否则前端会显示费用但服务端冻结为
                  0。</small
                >
              </header>
              <ul>
                <li v-for="route in uiDesignServiceRoutes" :key="route.key">
                  <code>{{ route.key }}</code>
                  <span>
                    <b>{{ route.label }}</b>
                    <small>{{ route.detail }}</small>
                  </span>
                </li>
              </ul>
            </section>

            <div class="assignment-toolbar">
              <el-input
                v-model="poolSearch"
                clearable
                placeholder="筛选模型 / 服务商"
                class="assignment-search"
                :prefix-icon="Search"
              />
              <span class="assignment-toolbar__summary tnum">
                已加入 <b>{{ assignedWorkspaceModels.length }}</b>
                <template v-if="poolWorkspaceModels.length"> · 可加入 <b>{{ poolWorkspaceModels.length }}</b></template>
              </span>
              <button
                type="button"
                class="assignment-link"
                :disabled="!poolWorkspaceModels.length"
                @click="addAllPoolModels(activeWorkspace)"
              >
                全部加入
              </button>
              <button
                type="button"
                class="assignment-link is-danger"
                :disabled="!assignedWorkspaceModels.length"
                @click="confirmClearWorkspace(activeWorkspace)"
              >
                清空
              </button>
            </div>

            <div class="assignment-board">
              <section
                v-for="group in workspaceBoardGroups"
                :key="group.kind"
                class="assign-group"
              >
                <header class="assign-group__head">
                  <i class="kind-dot" :class="`is-${group.kind}`" />
                  <strong>{{ kindName(group.kind) }}</strong>
                  <em class="tnum">{{ group.assigned.length }}</em>
                  <small v-if="group.defaultName">默认：{{ group.defaultName }}</small>
                </header>

                <div class="assign-grid">
                  <article
                    v-for="model in group.assigned"
                    :key="model.id"
                    class="assign-card"
                    :class="{ 'is-default': isWorkspaceDefaultModel(activeWorkspace, model) }"
                  >
                    <header class="assign-card__head">
                      <span class="assign-card__title">
                        <strong :title="model.name">{{ model.name }}</strong>
                        <small>
                          {{ providerName(model.providerId) }}
                          <em v-if="model.status === 'maintenance'" class="assignment-maintenance">维护中</em>
                        </small>
                      </span>
                      <button
                        type="button"
                        role="radio"
                        class="assignment-default-radio"
                        :class="{ 'is-on': isWorkspaceDefaultModel(activeWorkspace, model) }"
                        :aria-checked="isWorkspaceDefaultModel(activeWorkspace, model)"
                        :disabled="model.status === 'maintenance' && !isWorkspaceDefaultModel(activeWorkspace, model)"
                        :title="
                          isWorkspaceDefaultModel(activeWorkspace, model)
                            ? `当前是${workspaceDefaultLabel(activeWorkspace, model.kind)}`
                            : model.status === 'maintenance'
                              ? '维护中的模型不能设为默认'
                              : `设为${workspaceDefaultLabel(activeWorkspace, model.kind)}`
                        "
                        @click="setWorkspaceDefaultModel(activeWorkspace, model)"
                      >
                        <i aria-hidden="true" />
                        <span>{{ isWorkspaceDefaultModel(activeWorkspace, model) ? "默认" : "设为默认" }}</span>
                      </button>
                    </header>
                    <div class="assign-card__controls">
                    <el-popover
                      v-if="model.kind === 'image'"
                      placement="bottom-end"
                      :width="320"
                      trigger="click"
                      :show-arrow="false"
                    >
                      <template #reference>
                        <button
                          v-for="limit in [workspaceLimitSummary(activeWorkspace, model)]"
                          :key="`${model.id}-limit`"
                          type="button"
                          class="assignment-limit-chip"
                          :class="{ 'is-extended': limit.extended }"
                          :title="`本页面：参考图最多 ${limit.references} 张，单次最多生成 ${limit.images} 张（点击调整追加额度）`"
                        >
                          <span><em>参考</em><b class="tnum">{{ limit.references }}</b></span>
                          <span><em>生成</em><b class="tnum">{{ limit.images }}</b></span>
                        </button>
                      </template>
                      <div class="assignment-limit-pop">
                        <header>
                          <strong>页面追加额度</strong>
                          <small>只对「{{ activeWorkspace.name }}」里的 {{ model.name }} 生效</small>
                        </header>
                        <section
                          v-for="field in workspaceLimitFields(activeWorkspace, model)"
                          :key="field.key"
                          class="assignment-limit-field"
                        >
                          <div class="assignment-limit-field__head">
                            <span>{{ field.label }}</span>
                            <strong class="tnum" :class="{ 'is-extended': field.extra > 0 }">
                              {{ field.total }}<small>{{ field.unit }}</small>
                            </strong>
                          </div>
                          <div class="assignment-limit-field__body">
                            <div class="limit-stepper">
                              <button
                                type="button"
                                :disabled="field.extra <= 0"
                                :aria-label="`${field.label}追加减 1`"
                                @click="setWorkspaceModelLimit(activeWorkspace, model, field.key, field.extra - 1)"
                              >−</button>
                              <label>
                                <span>+</span>
                                <input
                                  class="tnum"
                                  type="number"
                                  inputmode="numeric"
                                  min="0"
                                  :max="field.maxExtra"
                                  :value="field.extra"
                                  :aria-label="`${field.label}追加数量`"
                                  @change="setWorkspaceModelLimit(activeWorkspace, model, field.key, Number(($event.target as HTMLInputElement).value)); ($event.target as HTMLInputElement).value = String(workspaceModelLimits(activeWorkspace, model)[field.key])"
                                />
                              </label>
                              <button
                                type="button"
                                :disabled="field.extra >= field.maxExtra"
                                :aria-label="`${field.label}追加加 1`"
                                @click="setWorkspaceModelLimit(activeWorkspace, model, field.key, field.extra + 1)"
                              >+</button>
                            </div>
                            <div class="limit-quick">
                              <button
                                v-for="step in field.steps"
                                :key="step"
                                type="button"
                                :disabled="field.extra >= field.maxExtra"
                                @click="setWorkspaceModelLimit(activeWorkspace, model, field.key, field.extra + step)"
                              >+{{ step }}</button>
                            </div>
                          </div>
                          <small class="assignment-limit-field__hint tnum">
                            模型 {{ field.base }} 张{{ field.extra ? ` + 页面追加 ${field.extra} 张` : "" }} · 最多 {{ field.cap }} 张
                          </small>
                        </section>
                        <footer>
                          <p>追加前请确认上游模型支持这么多输入图，否则任务会在上游失败。</p>
                          <button
                            type="button"
                            class="assignment-link"
                            :disabled="!workspaceLimitSummary(activeWorkspace, model).extended"
                            @click="resetWorkspaceModelLimits(activeWorkspace, model)"
                          >恢复模型默认</button>
                        </footer>
                      </div>
                    </el-popover>
                    <el-popover
                      placement="bottom-end"
                      :width="300"
                      trigger="click"
                      :show-arrow="false"
                    >
                      <template #reference>
                        <button
                          type="button"
                          class="price-tag"
                          :class="{ 'is-override': workspacePriceOverride(activeWorkspace, model) }"
                          :title="`点击设置「${activeWorkspace.name}」里的页面价格`"
                        >
                          <b class="tnum">{{ formatPoints(workspaceEffectivePrice(activeWorkspace, model)) }}</b>
                          <span class="price-tag__unit">积分</span>
                          <span class="price-tag__source">
                            {{ workspacePriceOverride(activeWorkspace, model) ? "页面价" : "继承" }}
                          </span>
                          <EditPen class="price-tag__edit" aria-hidden="true" />
                        </button>
                      </template>
                      <div class="assignment-price-pop">
                        <header>
                          <strong>页面价格</strong>
                          <small>只对「{{ activeWorkspace.name }}」里的 {{ model.name }} 生效</small>
                        </header>
                        <div class="price-mode" role="radiogroup" aria-label="定价方式">
                          <button
                            type="button"
                            role="radio"
                            :aria-checked="!workspacePriceOverride(activeWorkspace, model)"
                            :class="{ 'is-on': !workspacePriceOverride(activeWorkspace, model) }"
                            @click="setWorkspacePriceOverride(activeWorkspace, model, false)"
                          >继承目录价</button>
                          <button
                            type="button"
                            role="radio"
                            :aria-checked="Boolean(workspacePriceOverride(activeWorkspace, model))"
                            :class="{ 'is-on': workspacePriceOverride(activeWorkspace, model) }"
                            @click="setWorkspacePriceOverride(activeWorkspace, model, true)"
                          >页面单独定价</button>
                        </div>

                        <div v-if="!workspacePriceOverride(activeWorkspace, model)" class="price-inherit">
                          <span>用户支付</span>
                          <strong class="tnum">{{ formatPoints(effectivePrice(model)) }}<small>{{ workspacePriceUnit(model) }}</small></strong>
                          <em v-if="hasDiscountPrice(model)" class="tnum">原价 {{ formatPoints(model.priceCents) }}</em>
                        </div>

                        <template v-else>
                          <label class="price-field">
                            <span>标准价格</span>
                            <span class="price-input">
                              <input
                                class="tnum"
                                type="number"
                                inputmode="numeric"
                                min="0"
                                step="1"
                                :value="workspacePriceOverride(activeWorkspace, model)?.priceCents"
                                aria-label="标准价格"
                                @change="setWorkspacePriceField(activeWorkspace, model, 'priceCents', ($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = String(workspacePriceOverride(activeWorkspace, model)?.priceCents ?? '')"
                              />
                              <em>{{ workspacePriceUnit(model) }}</em>
                            </span>
                          </label>
                          <div class="price-field">
                            <span class="price-field__switch">
                              活动价格
                              <el-switch
                                size="small"
                                :model-value="workspacePriceOverride(activeWorkspace, model)?.discountPriceCents != null"
                                @change="setWorkspaceDiscountEnabled(activeWorkspace, model, $event === true)"
                              />
                            </span>
                            <span
                              v-if="workspacePriceOverride(activeWorkspace, model)?.discountPriceCents != null"
                              class="price-input"
                            >
                              <input
                                class="tnum"
                                type="number"
                                inputmode="numeric"
                                min="0"
                                :max="workspacePriceOverride(activeWorkspace, model)?.priceCents"
                                step="1"
                                :value="workspacePriceOverride(activeWorkspace, model)?.discountPriceCents"
                                aria-label="活动价格"
                                @change="setWorkspacePriceField(activeWorkspace, model, 'discountPriceCents', ($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = String(workspacePriceOverride(activeWorkspace, model)?.discountPriceCents ?? '')"
                              />
                              <em>{{ workspacePriceUnit(model) }}</em>
                            </span>
                            <small v-else>开启后按活动价结算</small>
                          </div>
                          <p v-if="workspacePriceWarning(activeWorkspace, model)" class="price-warn">
                            {{ workspacePriceWarning(activeWorkspace, model) }}
                          </p>
                        </template>

                        <footer class="tnum">
                          目录价 {{ formatPoints(effectivePrice(model)) }} {{ workspacePriceUnit(model) }}
                          <template v-if="model.upstreamCostCents"> · 上游成本 {{ formatPoints(model.upstreamCostCents) }}</template>
                        </footer>
                      </div>
                    </el-popover>
                      <el-tooltip content="移出此页面" placement="top">
                        <button
                          type="button"
                          class="assignment-icon-btn is-danger assign-card__remove"
                          aria-label="移出此页面"
                          @click="removeWorkspaceModel(activeWorkspace, model.id)"
                        >
                          <Close aria-hidden="true" />
                        </button>
                      </el-tooltip>
                    </div>
                  </article>

                  <button
                    v-for="model in group.pool"
                    :key="model.id"
                    type="button"
                    class="assign-card is-ghost"
                    :title="`加入「${activeWorkspace.name}」`"
                    @click="addWorkspaceModel(activeWorkspace, model.id)"
                  >
                    <span class="assign-card__plus"><Plus aria-hidden="true" /></span>
                    <span class="assign-card__title">
                      <strong>{{ model.name }}</strong>
                      <small class="tnum">{{ providerName(model.providerId) }} · {{ formatPoints(effectivePrice(model)) }} 积分</small>
                    </span>
                    <em>加入</em>
                  </button>

                  <p v-if="!group.assigned.length && !group.pool.length" class="assign-grid__empty">
                    {{ poolSearch.trim() ? "没有匹配的模型" : `还没有可用的${kindName(group.kind)}（需在模型目录中启用并对用户开放）` }}
                  </p>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="config-panel">
      <div class="editable-file-control">
        <div class="editable-file-control__identity">
          <span class="editable-file-control__icon"><el-icon><Connection /></el-icon></span>
          <div>
            <strong>
              可编辑文件 · PPT / PSD
              <span class="provider-chip" :class="config.editableFiles.enabled ? 'is-on' : 'is-off'">
                {{ config.editableFiles.enabled ? "用户端已开放" : "未开放" }}
              </span>
            </strong>
            <small>为 PPT / PSD 导出指定服务商与线路</small>
          </div>
        </div>
        <div class="editable-file-control__fields">
          <el-select
            :model-value="config.editableFiles.providerId"
            placeholder="选择服务商"
            :disabled="!config.editableFiles.enabled"
            @change="selectEditableFileProvider"
          >
            <el-option
              v-for="provider in editableFileProviders"
              :key="provider.id"
              :label="provider.name"
              :value="provider.id"
            />
          </el-select>
          <el-select
            v-model="config.editableFiles.routeId"
            placeholder="选择线路"
            :disabled="!config.editableFiles.enabled || !config.editableFiles.providerId"
          >
            <el-option
              v-for="route in editableFileRoutes"
              :key="route.id"
              :label="route.name"
              :value="route.id"
            />
          </el-select>
          <el-switch
            v-model="config.editableFiles.enabled"
            :disabled="!editableFileProviders.length"
            inline-prompt
            active-text="开"
            inactive-text="关"
            @change="toggleEditableFiles"
          />
        </div>
      </div>
      <AdminListShell
        class="config-list-shell"
        fill
        :has-prev="providerPagination.hasPrev.value"
        :has-next="providerPagination.hasNext.value"
        :loading="loading"
        :page="providerPagination.page.value"
        :count="providerPagination.items.value.length"
        :total="providerPagination.total.value"
        :page-size="providerPagination.pageSize.value"
        @update:page="providerPagination.goToPage"
        @update:page-size="providerPagination.setPageSize"
      >
        <div class="config-table-shell">
      <el-table
        :data="providerPagination.items.value"
        height="100%"
        row-key="id"
        size="small"
        class="config-table"
      >
        <template #empty>
          <el-empty description="添加服务商并读取其模型目录" :image-size="60" />
        </template>
        <el-table-column
          label="服务商"
          min-width="240"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <div
              class="provider-identity"
              :class="{ 'is-disabled': !row.enabled }"
              :title="`${row.name || '—'} · ${row.baseUrl || '—'}`"
            >
              <span class="provider-avatar" :class="`is-${row.adapter}`" aria-hidden="true">
                {{ (row.name || "?").slice(0, 1).toUpperCase() }}
              </span>
              <span class="provider-identity__copy">
                <strong>{{ row.name || "—" }}</strong>
                <span class="mono">{{ row.baseUrl || "—" }}</span>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="协议" min-width="120" align="left" header-align="left">
          <template #default="{ row }">
            <span class="provider-chip" :class="`is-${row.adapter}`">{{ adapterName(row.adapter) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="线路" min-width="72" align="left" header-align="left">
          <template #default="{ row }">
            <span class="provider-count tnum">{{ row.routes?.length || 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="并发 主 / 总"
          min-width="110"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <span class="cell-text tnum">
              {{ row.maxConcurrency }}<span class="cell-sep">/</span>{{ providerCapacity(row as ModelProvider) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          label="超时"
          min-width="80"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <span class="cell-text tnum">{{ row.timeoutSecs }}<span class="cell-unit">s</span></span>
          </template>
        </el-table-column>
        <el-table-column
          label="模型目录"
          min-width="110"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <button
              v-if="row.discoveredModels?.length"
              type="button"
              class="provider-catalog-btn"
              @click="openDiscoveredModelsDialog(row as ModelProvider)"
            >
              <span class="tnum">{{ row.discoveredModels.length }}</span> 个 · 查看
            </button>
            <span v-else class="cell-text is-muted">未读取</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" min-width="76" align="left" header-align="left">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" />
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          min-width="130"
          align="left"
          header-align="left"
        >
          <template #default="{ $index }">
            <div class="row-actions">
              <button type="button" class="card-btn is-solid" @click="openProvider($index)">
                <EditPen aria-hidden="true" />
                编辑
              </button>
              <el-tooltip content="删除服务商" placement="top">
                <button type="button" class="card-btn is-icon is-danger" aria-label="删除服务商" @click="removeProvider($index)">
                  <Delete aria-hidden="true" />
                </button>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </AdminListShell>
      </section>
    </PageCard>

    <AdminDialog
      v-model="discoveredModelsDialogVisible"
      :title="`${discoveredModelsViewer.providerName} · 可读取模型`"
      :subtitle="`共 ${discoveredModelsViewer.models.length} 个，已配置 ${discoveredModelsViewer.configured.length} 个`"
      :icon="Cpu"
      width="min(720px, calc(100% - 24px))"
      :show-confirm="false"
      cancel-text="关闭"
    >
      <div v-if="config.providers.find((item) => item.id === discoveredModelsViewer.providerId)?.adapter === 'crun'" class="discovered-model-actions">
        <el-button type="primary" :loading="importingDiscoveredTools" @click="importDiscoveredMediaTools">
          同步全部媒体工具
        </el-button>
        <span>严格读取每个工具的实时 schema；新工具默认关闭，设置本站积分后再开放。</span>
      </div>
      <div class="discovered-model-grid">
        <span
          v-for="modelId in discoveredModelsViewer.models"
          :key="modelId"
          class="discovered-model-chip"
          :class="{ 'is-configured': isDiscoveredModelConfigured(modelId) }"
          :title="modelId"
        >
          {{ modelId }}
          <em v-if="isDiscoveredModelConfigured(modelId)">已配置</em>
        </span>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="providerDialogVisible"
      :title="providerEditIndex >= 0 ? '编辑服务商' : '添加服务商'"
      subtitle="配置 Base URL 线路、密钥与模型目录"
      :icon="Connection"
      width="min(1120px, calc(100% - 24px))"
      confirm-text="确认"
      :confirm-loading="discoveringProviderModels"
      @confirm="saveProviderDraft"
    >
      <el-form label-position="top" class="dialog-form">
        <div class="form-grid">
          <el-form-item label="自定义名称"
            ><el-input
              v-model="providerDraft.name"
              placeholder="例如 C2A 主线路 / RS Image"
          /></el-form-item>
          <el-form-item label="调用协议">
            <el-radio-group
              v-model="providerDraft.adapter"
              class="full-radio"
              @change="invalidateProviderModels"
            >
              <el-radio-button value="openai">OpenAI 兼容</el-radio-button
              ><el-radio-button value="crun">CRUN</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="启用服务商"
            ><el-switch v-model="providerDraft.enabled"
          /></el-form-item>
        </div>
        <section class="provider-route-editor">
          <div class="provider-route-heading">
            <div>
              <strong>Base URL 线路</strong>
              <span>
                已启用 {{ providerDraft.routes.filter((route) => route.enabled).length }} 条，
                总并发 {{ providerCapacity(providerDraft) }}
              </span>
            </div>
            <el-button :icon="Plus" @click="addProviderRoute">添加线路</el-button>
          </div>
          <div
            v-for="(route, routeIndex) in providerDraft.routes"
            :key="route.id"
            class="provider-route-item"
          >
            <div class="provider-route-item-head">
              <div>
                <strong>{{ route.name || `线路 ${routeIndex + 1}` }}</strong>
                <el-tag v-if="routeIndex === 0" size="small" effect="plain">主线路</el-tag>
              </div>
              <div class="provider-route-actions">
                <el-button
                  size="small"
                  plain
                  :loading="testingProviderRouteId === route.id"
                  :disabled="Boolean(testingProviderRouteId) && testingProviderRouteId !== route.id"
                  @click="testProviderRoute(route)"
                >
                  测试线路
                </el-button>
                <span>启用</span>
                <el-switch v-model="route.enabled" />
                <el-tooltip v-if="routeIndex > 0" content="删除线路" placement="top">
                  <el-button
                    :icon="Delete"
                    circle
                    plain
                    type="danger"
                    aria-label="删除线路"
                    @click="removeProviderRoute(route.id)"
                  />
                </el-tooltip>
              </div>
            </div>
            <div class="provider-route-fields">
              <label class="provider-route-field route-name-field">
                <span>线路名称</span>
                <el-input v-model="route.name" placeholder="例如 主线路" />
              </label>
              <label class="provider-route-field route-url-field">
                <span>Base URL</span>
                <el-input
                  v-model="route.baseUrl"
                  :placeholder="
                    providerDraft.adapter === 'crun'
                      ? 'https://api.crun.ai'
                      : 'https://api.example.com/v1'
                  "
                  @input="invalidateProviderModels"
                />
              </label>
              <label class="provider-route-field route-key-field">
                <span>API Key</span>
                <el-input
                  v-model="route.apiKey"
                  type="password"
                  show-password
                  :placeholder="route.apiKey.startsWith('****') ? route.apiKey : 'API Key'"
                  @input="invalidateProviderModels"
                />
              </label>
              <label class="provider-route-field route-limit-field">
                <span>并发容量</span>
                <el-input-number
                  v-model="route.maxConcurrency"
                  :min="1"
                  :max="10000"
                  :step="10"
                />
              </label>
              <label class="provider-route-field route-timeout-field">
                <span>请求超时（秒）</span>
                <el-input-number
                  v-model="route.timeoutSecs"
                  :min="0"
                  :max="1800"
                  :step="30"
                />
              </label>
            </div>
            <p class="discovery-note">超时不含排队。0 使用默认值（OpenAI 300 秒，CRUN 图片 1200 秒）；对话小于 30 秒按 300 秒处理。目录测试单次最多 20 秒。OpenAI 图片异步切线等待至少 180 秒，超时后仍可能继续查询或重试，不代表立即停止上游生成。</p>
            <div v-if="providerRouteChecks[route.id]" class="provider-route-check">
              <el-tag
                :type="providerRouteChecks[route.id].startsWith('连接失败') ? 'danger' : 'success'"
                size="small"
                effect="plain"
              >
                {{ providerRouteChecks[route.id] }}
              </el-tag>
            </div>
          </div>
        </section>
        <div class="model-discovery">
          <div>
            <strong>模型目录</strong
            ><span v-if="providerCatalogSummary">{{
              providerCatalogSummary
            }}</span
            ><span v-else-if="providerDraft.discoveredModels.length"
              >已读取 {{ providerDraft.discoveredModels.length }} 个模型</span
            ><span v-else>{{
              providerDraft.adapter === "crun"
                ? "实时读取 CRUN 对话与媒体目录，并过滤尚未接入的能力"
                : "从 /v1/models 读取兼容模型目录，也可手工填写模型 ID"
            }}</span>
          </div>
          <el-button
            :icon="Refresh"
            :loading="discoveringProviderModels"
            @click="discoverProviderModels"
            >{{
              providerDraft.discoveredModels.length ? "重新读取" : "读取模型"
            }}</el-button
          >
        </div>
        <p class="discovery-note">线路测试读取模型目录，验证地址与鉴权；不代表所有模型均可生成。具体模型能力仍以上游实际调用为准。</p>
        <div v-if="providerDraft.discoveredModels.length" class="discovered-model-list" aria-label="已读取的模型">
          <el-tag v-for="model in providerDraft.discoveredModels" :key="model" size="small" effect="plain">{{ model }}</el-tag>
        </div>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="modelDialogVisible"
      :title="modelEditIndex >= 0 ? '编辑模型' : '添加模型'"
      :subtitle="`${kindMeta[modelDraft.kind].name} · ${modelDraft.name || '未命名模型'}`"
      :icon="Cpu"
      width="min(1080px, calc(100% - 32px))"
      panel-class="model-config-editor-dialog"
      nested-scroll
      :close-on-click-modal="false"
      :confirm-text="modelEditIndex >= 0 ? '确认修改' : '添加模型'"
      footer-hint="确认后加入页面待保存配置，点击页面「保存」后生效"
      @confirm="saveModelDraft"
    >
      <div class="model-type-tabs" role="group" aria-label="模型类型">
        <button v-for="item in kindFilters.filter(entry => entry.id !== 'all')" :key="item.id" type="button" :aria-pressed="modelDraft.kind === item.id" :class="{ 'is-active': modelDraft.kind === item.id }" @click="chooseModelType(item.id as ModelKind)">{{ item.label }}</button>
      </div>
      <div class="model-editor-layout">
      <nav class="model-editor-nav" aria-label="模型配置分组">
        <button v-for="tab in modelEditorTabs" :key="tab.id" type="button" :class="{ 'is-active': modelEditorTab === tab.id }" :aria-current="modelEditorTab === tab.id ? 'page' : undefined" @click="modelEditorTab = tab.id">
          <span><strong>{{ tab.label }}</strong><small>{{ tab.hint }}</small></span>
        </button>
      </nav>
      <el-form ref="modelEditorForm" label-position="top" class="dialog-form model-editor">

        <section v-if="modelDraft.kind === 'chat'" v-show="modelEditorTab === 'pricing'" class="model-section">
          <header class="model-section__head model-support-toggle">
            <span><strong>支持推理强度</strong><small>由管理员按上游能力配置；关闭后不向上游传递推理强度，用户按基础积分计费</small></span>
            <el-switch :model-value="modelDraft.reasoningEnabled === true" @change="toggleReasoningSupport" />
          </header>
        </section>

        <section
          v-if="modelDraft.kind === 'chat' && modelDraft.reasoningEnabled && modelDraft.reasoningPricing && modelDraft.supportedReasoningEfforts.length"
          id="model-reasoning-pricing-section"
          v-show="modelEditorTab === 'pricing'"
          class="model-section reasoning-pricing-section"
        >
          <header class="model-section__head reasoning-pricing-head">
            <span>
              <strong>推理强度计费</strong>
              <small>只开启上游支持的档位。积分为 0 不会关闭档位；免费使用需开启「允许零积分」</small>
            </span>
            <div class="reasoning-base-price">
              <label>
                <span>兼容基础价</span>
                <el-input-number
                  v-model="modelDraft.pricePoints"
                  :min="0"
                  :precision="0"
                  :step="1"
                />
              </label>
              <el-button size="small" @click="fillReasoningPricingFromBase">
                按基础价初始化
              </el-button>
            </div>
          </header>
          <div class="reasoning-default-row">
            <span>
              <strong>默认推理强度</strong>
              <small>{{
                enabledReasoningEfforts(modelDraft).length
                  ? "用户未手动切换时使用此档"
                  : "已关闭全部推理档，用户端按基础积分计费"
              }}</small>
            </span>
            <el-select
              v-model="modelDraft.reasoningPricing.defaultEffort"
              :disabled="!enabledReasoningEfforts(modelDraft).length"
              clearable
              placeholder="未开启"
              style="width: 160px"
            >
              <el-option
                v-for="effort in enabledReasoningEfforts(modelDraft)"
                :key="effort"
                :label="`${REASONING_EFFORT_LABELS[effort] || effort} (${effort})`"
                :value="effort"
              />
            </el-select>
          </div>
          <div class="reasoning-price-table">
            <div class="reasoning-price-table__head">
              <span>启用</span>
              <span>档位</span>
              <span>AI 助手</span>
              <span>无限画布 Agent</span>
            </div>
            <div
              v-for="effort in modelDraft.supportedReasoningEfforts"
              :key="effort"
              class="reasoning-price-row"
              :class="{
                'is-off': !draftReasoningEffortOn(effort),
              }"
            >
              <div class="reasoning-effort-enable">
                <el-switch
                  :model-value="draftReasoningEffortOn(effort)"
                  size="small"
                  @change="setReasoningEffortEnabled(effort, $event === true)"
                />
              </div>
              <div class="reasoning-effort-name">
                <strong>{{ REASONING_EFFORT_LABELS[effort] || effort }}</strong>
                <small>{{ effort }}</small>
              </div>
              <div class="reasoning-channel-price" data-channel="AI 助手">
                <div class="reasoning-price-field">
                  <span>标准积分</span>
                  <el-input-number
                    :model-value="modelDraft.reasoningPricing.efforts[effort].assistantPriceCents"
                    :key="`assistant-standard-${draftReasoningEffortOn(effort)}`"
                    :aria-label="effort + ' AI 助手标准积分'"
                    @update:model-value="setReasoningPrice(effort, 'assistantPriceCents', $event)"
                    :disabled="!draftReasoningEffortOn(effort)"
                    :min="0"
                    :precision="0"
                    :step="1"
                  />
                </div>
                <div class="reasoning-price-field">
                  <span>折扣积分</span>
                  <div class="reasoning-discount-control">
                    <el-switch
                      :model-value="reasoningDiscountEnabled(effort, 'assistant')"
                      :disabled="!draftReasoningEffortOn(effort)"
                      @change="toggleReasoningDiscount(effort, 'assistant', $event)"
                    />
                    <el-input-number
                      :model-value="modelDraft.reasoningPricing.efforts[effort].assistantDiscountPriceCents"
                      :key="`assistant-discount-${draftReasoningEffortOn(effort)}-${reasoningDiscountEnabled(effort, 'assistant')}`"
                    :aria-label="effort + ' AI 助手折扣积分'"
                    @update:model-value="setReasoningPrice(effort, 'assistantDiscountPriceCents', $event)"
                      :disabled="
                        !draftReasoningEffortOn(effort) ||
                        !reasoningDiscountEnabled(effort, 'assistant')
                      "
                      :min="0"
                      :precision="0"
                      :step="1"
                    />
                  </div>
                </div>
              </div>
              <div class="reasoning-channel-price" data-channel="无限画布 Agent">
                <div class="reasoning-price-field">
                  <span>标准积分</span>
                  <el-input-number
                    :model-value="modelDraft.reasoningPricing.efforts[effort].canvasAgentPriceCents"
                    :key="`canvas-standard-${draftReasoningEffortOn(effort)}`"
                    :aria-label="effort + ' 画布 Agent 标准积分'"
                    @update:model-value="setReasoningPrice(effort, 'canvasAgentPriceCents', $event)"
                    :disabled="!draftReasoningEffortOn(effort)"
                    :min="0"
                    :precision="0"
                    :step="1"
                  />
                </div>
                <div class="reasoning-price-field">
                  <span>折扣积分</span>
                  <div class="reasoning-discount-control">
                    <el-switch
                      :model-value="reasoningDiscountEnabled(effort, 'canvas_agent')"
                      :disabled="!draftReasoningEffortOn(effort)"
                      @change="toggleReasoningDiscount(effort, 'canvas_agent', $event)"
                    />
                    <el-input-number
                      :model-value="modelDraft.reasoningPricing.efforts[effort].canvasAgentDiscountPriceCents"
                      :key="`canvas-discount-${draftReasoningEffortOn(effort)}-${reasoningDiscountEnabled(effort, 'canvas_agent')}`"
                    :aria-label="effort + ' 画布 Agent 折扣积分'"
                    @update:model-value="setReasoningPrice(effort, 'canvasAgentDiscountPriceCents', $event)"
                      :disabled="
                        !draftReasoningEffortOn(effort) ||
                        !reasoningDiscountEnabled(effort, 'canvas_agent')
                      "
                      :min="0"
                      :precision="0"
                      :step="1"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="model-field-grid">
            <el-form-item label="上游成本/次">
              <el-input-number
                v-model="modelDraft.upstreamCostPoints"
                :min="0"
                :precision="0"
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
          </div>
        </section>

        <section v-show="modelEditorTab === 'basic'" class="model-section">
          <header class="model-section__head">
            <strong>模型信息</strong>
            <small>先选择服务商与上游模型，再设置用户端看到的名称和介绍</small>
          </header>
          <div class="model-field-grid model-basics-grid">
            <el-form-item label="服务商" class="model-field-provider">
              <el-select
                v-model="modelDraft.providerId"
                style="width: 100%"
                @change="onModelProviderChange"
              >
                <el-option
                  v-for="provider in config.providers"
                  :key="provider.id"
                  :value="provider.id"
                  :label="provider.name"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="显示名称" class="model-field-name">
              <el-input
                v-model="modelDraft.name"
                placeholder="用户端显示的模型名称"
              />
            </el-form-item>
            <el-form-item label="上游模型 ID" class="is-wide model-field-upstream">
              <div class="model-picker">
                <el-select
                  v-model="modelDraft.upstreamModel"
                  :loading="loadingCRUNSchema"
                  filterable
                  allow-create
                  default-first-option
                  :reserve-keyword="false"
                  placeholder="搜索服务商模型，或手工输入"
                  @change="onUpstreamModelChange"
                >
                  <el-option
                    v-for="model in modelProviderOptions"
                    :key="model"
                    :label="model"
                    :value="model"
                  />
                </el-select>
                <el-button
                  :icon="Refresh"
                  :loading="discoveringModelOptions"
                  :disabled="!modelDraft.providerId"
                  @click="refreshModelOptions"
                >
                  刷新
                </el-button>
              </div>
              <div
                v-if="selectedModelProvider?.adapter === 'crun' && modelDraft.upstreamModel"
                class="model-schema-state"
              >
                <el-tag
                  :type="activeCRUNSchema ? 'success' : 'warning'"
                  size="small"
                  effect="plain"
                >
                  {{
                    loadingCRUNSchema
                      ? "正在读取实时参数"
                      : activeCRUNSchema
                        ? `参数已验证 · ${modelDraft.upstreamInputFields.length} 个字段`
                        : "参数尚未验证"
                  }}
                </el-tag>
                <span v-if="activeCRUNSchema?.operations?.length">
                  {{ activeCRUNSchema.operations.join(" · ") }}
                </span>
              </div>
            </el-form-item>
            <el-form-item label="模型图标（选填）" class="model-field-icon">
              <div class="model-icon-editor">
                <span class="model-icon-editor__preview" aria-hidden="true">
                  <img v-if="modelDraft.iconUrl" :src="modelDraft.iconUrl" alt="" />
                  <Cpu v-else />
                </span>
                <div class="model-icon-editor__actions">
                  <div>
                    <el-button :icon="Upload" :loading="modelIconUploading" @click="pickModelIcon">
                      {{ modelDraft.iconUrl ? "替换图标" : "上传图标" }}
                    </el-button>
                    <el-button v-if="modelDraft.iconUrl" link type="danger" @click="modelDraft.iconUrl = ''">
                      移除
                    </el-button>
                  </div>
                  <small>建议上传正方形 PNG、JPG 或 WebP，最大 2MB</small>
                </div>
                <input
                  ref="modelIconInputRef"
                  class="model-icon-editor__input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  @change="onModelIconPick"
                />
              </div>
            </el-form-item>
            <el-form-item label="模型介绍（选填）" class="model-field-description">
              <el-input
                v-model="modelDraft.description"
                type="textarea"
                :rows="3"
                resize="none"
                placeholder="用户选择模型时看到的简短说明"
              />
            </el-form-item>
          </div>
        </section>

        <section
          v-if="
            modelDraft.kind !== 'chat' ||
            !modelDraft.reasoningEnabled ||
            !modelDraft.reasoningPricing ||
            !modelDraft.supportedReasoningEfforts.length
          "
          class="model-section"
          v-show="modelEditorTab === 'pricing'"
        >
          <header class="model-section__head">
            <strong>计费与耗时</strong>
            <small>积分定价与预计等待时间</small>
          </header>
          <div class="model-field-grid">
            <el-form-item :label="modelDraft.kind === 'image_tool' && modelDraft.tool === 'image_upscale' ? '≤ 2048px 标准积分' : '标准积分'">
              <el-input-number
                v-model="modelDraft.pricePoints"
                :min="0"
                :precision="0"
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item :label="modelDraft.kind === 'image_tool' && modelDraft.tool === 'image_upscale' ? '≤ 2048px 折扣积分' : '折扣积分'">
              <div class="discount-input">
                <el-switch v-model="modelDraft.discountEnabled" />
                <el-input-number
                  v-model="modelDraft.discountPoints"
                  :disabled="!modelDraft.discountEnabled"
                  :min="0"
                  :precision="0"
                  :step="1"
                />
              </div>
            </el-form-item>
            <el-form-item :label="modelDraft.kind === 'image_tool' && modelDraft.tool === 'image_upscale' ? '≤ 2048px 上游成本' : '上游成本/次'">
              <el-input-number
                v-model="modelDraft.upstreamCostPoints"
                :min="0"
                :precision="0"
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item
              v-if="modelDraft.kind === 'image_tool' && modelDraft.tool === 'image_upscale'"
              label="2049–4096px 标准积分"
            >
              <el-input-number
                v-model="modelDraft.upscaleHighPricePoints"
                :min="0"
                :precision="0"
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item
              v-if="modelDraft.kind === 'image_tool' && modelDraft.tool === 'image_upscale'"
              label="2049–4096px 折扣积分"
            >
              <div class="discount-input">
                <el-switch v-model="modelDraft.upscaleHighDiscountEnabled" />
                <el-input-number
                  v-model="modelDraft.upscaleHighDiscountPoints"
                  :disabled="!modelDraft.upscaleHighDiscountEnabled"
                  :min="0"
                  :precision="0"
                  :step="1"
                />
              </div>
            </el-form-item>
            <el-form-item
              v-if="modelDraft.kind === 'image_tool' && modelDraft.tool === 'image_upscale'"
              label="2049–4096px 上游成本"
            >
              <el-input-number
                v-model="modelDraft.upscaleHighUpstreamCostPoints"
                :min="0"
                :precision="0"
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item
              v-if="modelDraft.kind !== 'chat'"
              label="预计生成耗时"
              :class="{ 'is-wide': modelDraft.kind !== 'image' }"
            >
              <div class="eta-input">
                <el-input-number
                  v-model="modelDraft.minSeconds"
                  :min="0"
                  :max="3600"
                />
                <span>至</span>
                <el-input-number
                  v-model="modelDraft.maxSeconds"
                  :min="modelDraft.minSeconds"
                  :max="3600"
                />
                <span>秒</span>
              </div>
              <small>用于调度估算完成时间、比较线路；不包含排队，不会到时中断任务。未知可填 0，调度默认按 45 秒估算。</small>
            </el-form-item>
          </div>
        </section>

        <section v-show="modelEditorTab === 'pricing'" class="model-section">
          <header class="model-section__head"><strong>价格策略</strong><small>适用于当前模型的所有价格档位</small></header>
          <div class="model-price-policy">
            <label><span><strong>允许零积分</strong><small>开启后可保存并使用免费档位</small></span><el-switch v-model="modelDraft.allowZeroPrice" /></label>
            <label><span><strong>允许低于成本</strong><small>开启后可设置低于上游成本的价格</small></span><el-switch v-model="modelDraft.allowLossLeader" /></label>
          </div>
        </section>

        <section v-show="modelEditorTab === 'publishing'" class="model-section">
          <header class="model-section__head">
            <strong>发布状态</strong>
            <small>控制可见性与调度</small>
          </header>
          <el-form-item label="用户端状态" class="model-public-status">
            <el-radio-group v-model="modelDraft.status">
              <el-radio-button value="available">正常服务</el-radio-button>
              <el-radio-button value="maintenance">维护中</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <div class="model-status-grid">
            <label>
              <span>
                <strong>用户可选</strong>
                <small>{{
                  modelDraft.kind === "image_tool"
                    ? "显示在对应图片操作入口"
                    : "显示在用户端模型列表"
                }}</small>
              </span>
              <el-switch v-model="modelDraft.public" />
            </label>
            <label>
              <span>
                <strong>默认模型</strong>
                <small>作为该类型首选模型</small>
              </span>
              <el-switch
                v-model="modelDraft.default"
                :disabled="!modelDraft.public || !modelDraft.enabled"
              />
            </label>
            <label>
              <span>
                <strong>启用模型</strong>
                <small>允许后台调度执行</small>
              </span>
              <el-switch v-model="modelDraft.enabled" />
            </label>
          </div>
        </section>

        <section
          v-if="modelDraft.kind === 'chat'"
          id="model-capabilities-section"
          v-show="modelEditorTab === 'capabilities'"
          class="model-section"
        >
          <header class="model-section__head">
            <strong>对话上下文</strong>
            <small>控制助手可使用的历史消息预算与单轮输出预留</small>
          </header>
          <div class="model-capability-tiles">
            <div class="model-capability-tile">
              <div class="model-capability-copy">
                <strong>上下文窗口</strong>
                <span>模型输入与输出的总 token 上限</span>
              </div>
              <el-input-number
                v-model="modelDraft.contextWindowTokens"
                :min="4096"
                :max="2000000"
                :step="4096"
                :precision="0"
              />
            </div>
            <div class="model-capability-tile">
              <div class="model-capability-copy">
                <strong>最大输出</strong>
                <span>每轮为模型回答预留的 token 数</span>
              </div>
              <el-input-number
                v-model="modelDraft.maxOutputTokens"
                :min="256"
                :max="Math.max(256, modelDraft.contextWindowTokens - 1)"
                :step="256"
                :precision="0"
              />
            </div>
          </div>
        </section>

        <section
          v-if="modelDraft.kind === 'image'"
          id="model-capabilities-section"
          v-show="modelEditorTab === 'capabilities'"
          class="model-section"
        >
          <header class="model-section__head">
            <strong>图片能力</strong>
            <small
              >{{ modelDraft.resolutions.length }} 档分辨率 ·
              {{
                modelDraft.resolutions.length
                  ? aspectRatioUnion(modelDraft.aspectRatiosByResolution).length
                  : modelDraft.aspectRatios.length
              }}
              种比例</small
            >
          </header>

          <div class="model-capability-block">
            <div class="model-capability-row">
              <div class="model-capability-copy">
                <strong>支持分辨率</strong>
                <span>仅显示上游实时 schema 声明的档位</span>
              </div>
              <el-checkbox-group
                v-if="availableResolutionOptions.length"
                v-model="modelDraft.resolutions"
                class="capability-options compact-options"
              >
                <el-checkbox-button
                  v-for="resolution in availableResolutionOptions"
                  :key="resolution"
                  :value="resolution"
                >
                  {{ resolution }}
                </el-checkbox-button>
              </el-checkbox-group>
              <em v-else>模型使用内置分辨率</em>
            </div>

            <div v-if="availableAspectRatioOptions.length" class="auto-aspect-rules">
              <div class="auto-aspect-rules__heading">
                <strong>比例控制</strong>
                <span>仅开放上游当前接受的比例</span>
              </div>
              <div v-if="modelDraft.resolutions.length" class="auto-aspect-rules__grid">
                <label
                  v-for="resolution in modelDraft.resolutions"
                  :key="resolution"
                  class="auto-aspect-rule"
                >
                  <strong>{{ resolution }}</strong>
                  <i>→</i>
                  <el-select
                    v-model="modelDraft.aspectRatiosByResolution[resolution]"
                    multiple
                    collapse-tags
                    collapse-tags-tooltip
                    :max-collapse-tags="2"
                    placeholder="选择多个比例"
                    popper-class="aspect-ratio-dropdown"
                  >
                    <el-option
                      v-for="ratio in availableAspectRatioOptions"
                      :key="ratio"
                      :label="ratio === 'auto' ? 'Auto' : ratio"
                      :value="ratio"
                    />
                  </el-select>
                </label>
              </div>
              <el-select
                v-else
                v-model="modelDraft.aspectRatios"
                multiple
                collapse-tags
                collapse-tags-tooltip
                placeholder="选择用户可用比例"
              >
                <el-option
                  v-for="ratio in availableAspectRatioOptions"
                  :key="ratio"
                  :label="ratio === 'auto' ? 'Auto' : ratio"
                  :value="ratio"
                />
              </el-select>
            </div>

            <div class="model-capability-row">
              <div class="model-capability-copy">
                <strong>支持精确尺寸</strong>
                <span>允许用户按像素输入宽度和高度</span>
              </div>
              <el-switch
                v-model="modelDraft.supportsExactSize"
                aria-label="支持精确尺寸"
                :disabled="!canConfigureExactSize && !modelDraft.supportsExactSize"
              />
            </div>
            <p v-if="!canConfigureExactSize" class="exact-size-hint">
              此模型尚未声明支持精确宽高，请读取最新模型能力后确认。
            </p>
            <div v-if="modelDraft.supportsExactSize" class="exact-size-settings">
              <p class="exact-size-hint">按模型实际支持的范围填写；精确模式将使用用户输入的尺寸，超出限制时提示修改。</p>
              <div class="model-capability-tiles">
                <div v-for="field in EXACT_SIZE_FIELDS" :key="field.key" class="model-capability-tile">
                  <div class="model-capability-copy">
                    <strong>{{ field.label }}</strong>
                    <span>{{ field.hint }}</span>
                  </div>
                  <el-input-number
                    v-model="modelDraft.exactSizeLimits[field.key]"
                    :aria-label="`精确尺寸${field.label}`"
                    :min="field.min"
                    :max="field.max"
                    :precision="field.precision"
                    controls-position="right"
                  />
                </div>
              </div>
            </div>

            <div class="model-capability-tiles">
              <div class="model-capability-tile">
                <div class="model-capability-copy">
                  <strong>输出质量</strong>
                  <span>用户可选档位</span>
                </div>
                <el-checkbox-group
                  v-if="availableQualityOptions.length"
                  v-model="modelDraft.qualities"
                  class="capability-options compact-options"
                >
                  <el-checkbox-button
                    v-for="quality in availableQualityOptions"
                    :key="quality.value"
                    :value="quality.value"
                  >
                    {{ quality.label }}
                  </el-checkbox-button>
                </el-checkbox-group>
                <em v-else>模型使用内置质量</em>
              </div>
              <div class="model-capability-tile">
                <div class="model-capability-copy">
                  <strong>移除背景</strong>
                  <span>允许用户移除背景，输出透明底图片</span>
                </div>
                <el-switch
                  v-model="modelDraft.transparentBackground"
                  :disabled="isSchemaDrivenCRUNImage && !schemaSupportsTransparentBackground"
                />
              </div>
              <div class="model-capability-tile is-wide">
                <div class="model-capability-copy">
                  <strong>指定格式</strong>
                  <span>关闭时使用模型内置格式</span>
                </div>
                <div class="capability-control">
                  <el-switch
                    v-model="modelDraft.outputFormatsEnabled"
                    :disabled="isSchemaDrivenCRUNImage && !availableOutputFormatOptions.length"
                    @change="onOutputFormatsEnabled"
                  />
                  <el-checkbox-group
                    v-if="modelDraft.outputFormatsEnabled"
                    v-model="modelDraft.outputFormats"
                    class="capability-options compact-options"
                  >
                    <el-checkbox-button
                      v-for="format in availableOutputFormatOptions"
                      :key="format"
                      :value="format"
                    >
                      {{ format.toUpperCase() }}
                    </el-checkbox-button>
                  </el-checkbox-group>
                  <em v-else>模型内置</em>
                </div>
              </div>
              <div class="model-capability-tile is-wide">
                <div class="model-capability-copy">
                  <strong>内容审核</strong>
                  <span>关闭时使用模型内置审核</span>
                </div>
                <div class="capability-control">
                  <el-switch
                    v-model="modelDraft.moderationEnabled"
                    :disabled="isSchemaDrivenCRUNImage && !availableModerationOptions.length"
                    @change="onModerationEnabled"
                  />
                  <el-checkbox-group
                    v-if="modelDraft.moderationEnabled"
                    v-model="modelDraft.moderationLevels"
                    class="capability-options compact-options"
                  >
                    <el-checkbox-button
                      v-for="level in availableModerationOptions"
                      :key="level"
                      :value="level"
                    >
                      {{ level }}
                    </el-checkbox-button>
                  </el-checkbox-group>
                  <em v-else>模型内置</em>
                </div>
              </div>
              <div class="model-capability-tile">
                <div class="model-capability-copy">
                  <strong>参考图片</strong>
                  <span>0 表示不接收参考图</span>
                </div>
                <div class="reference-limit">
                  <el-input-number
                    v-model="modelDraft.maxReferenceImages"
                    :min="0"
                    :max="isSchemaDrivenCRUNImage ? schemaReferenceMax : 16"
                    :disabled="isSchemaDrivenCRUNImage && schemaReferenceMax === 0"
                    :step="1"
                    :precision="0"
                  />
                  <span>张</span>
                </div>
              </div>
              <div class="model-capability-tile">
                <div class="model-capability-copy">
                  <strong>单次生成</strong>
                  <span>一次请求最多出几张图</span>
                </div>
                <div class="reference-limit">
                  <el-input-number
                    v-model="modelDraft.maxImages"
                    :min="1"
                    :max="100"
                    :step="1"
                    :precision="0"
                  />
                  <span>张</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section v-if="modelDraft.kind === 'image_tool'" v-show="modelEditorTab === 'capabilities'" class="model-section">
          <header class="model-section__head"><strong>媒体工具能力</strong><small>以下信息来自上游模型参数，修改模型映射后可重新读取</small></header>
          <div class="model-media-summary"><span>媒体类型：{{ modelDraft.modality || '未读取' }}</span><span>操作：{{ modelDraft.operations.join('、') || '未读取' }}</span></div>
          <el-empty v-if="!modelDraft.upstreamInputFields.length" description="请在基本信息中选择模型并读取上游参数" :image-size="56" />
          <div v-else class="model-media-fields">
            <div v-for="field in modelDraft.upstreamInputFields" :key="field"><code>{{ field }}</code><el-tag size="small" :type="modelDraft.upstreamRequiredInputFields.includes(field) ? 'warning' : 'info'">{{ modelDraft.upstreamRequiredInputFields.includes(field) ? '必填' : '可选' }}</el-tag></div>
          </div>
          <el-button @click="modelEditorTab = 'basic'">前往模型映射</el-button>
        </section>
      </el-form>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
.model-editor {
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  gap: 14px;
  padding: 2px 8px 12px 0;
  scrollbar-gutter: stable;
}

.model-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  gap: 16px;
}

.model-editor-nav {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.model-editor-nav button {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  text-align: center;
  cursor: pointer;
}

.model-editor-nav button:hover {
  background: var(--surface-2);
}

.model-editor-nav button.is-active {
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--accent-ink);
}

.model-editor-nav button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.model-editor-nav strong,
.model-editor-nav small {
  display: block;
}

.model-editor-nav strong { font-size: 13px; }
.model-editor-nav small { margin-top: 5px; font-size: 11px; line-height: 1.5; color: var(--ink-3); }
.model-editor-nav__number { font-size: 12px; opacity: 0.65; font-variant-numeric: tabular-nums; }
.model-editor-nav p { margin: auto 8px 8px; color: var(--ink-3); font-size: 11px; line-height: 1.6; }

.model-price-policy { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.model-price-policy label { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px; border-radius: 8px; background: var(--surface-2); }
.model-price-policy strong { display: block; font-size: 13px; color: var(--ink-2); }
.model-price-policy small { display: block; margin-top: 5px; font-size: 11px; line-height: 1.5; color: var(--ink-3); }
.model-media-summary { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: var(--ink-2); }
.model-media-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.model-media-fields > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; background: var(--surface-2); border-radius: 8px; }
.model-media-fields code { overflow-wrap: anywhere; min-width: 0; }

@media (max-width: 900px) {
  .model-editor-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 12px; }
  .model-editor-nav { flex-direction: row; padding: 0 0 10px; border-right: 0; border-bottom: 1px solid var(--border); }
  .model-editor-nav button { flex: 1; justify-content: center; padding: 10px 6px; }
  .model-editor-nav small, .model-editor-nav p, .model-editor-nav__number { display: none; }
}

@media (max-width: 600px) {
  .model-editor .model-field-grid,
  .model-editor .model-capability-tiles,
  .model-price-policy,
  .model-media-fields { grid-template-columns: minmax(0, 1fr); }
  .model-editor .reasoning-pricing-head { grid-template-columns: minmax(0, 1fr); }
  .model-editor .reasoning-default-row { flex-wrap: wrap; }
}

.model-section {
  display: grid;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.model-section__head {
  display: grid;
  gap: 2px;
}

.model-section__head strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.model-section__head small {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
}

.model-support-toggle { display: flex; justify-content: space-between; align-items: center; gap: 24px; }
.model-support-toggle > span { display: grid; gap: 4px; }
.model-support-toggle :deep(.el-switch) { flex-shrink: 0; }
.model-public-status { margin: 0; }
.model-basics-grid { column-gap: 24px; }
.model-type-tabs { display: inline-flex; align-self: flex-end; flex-wrap: wrap; gap: 3px; padding: 3px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.model-type-tabs button { padding: 5px 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--ink-2); font-size: 12px; line-height: 18px; cursor: pointer; }
.model-type-tabs button.is-active { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 25%, var(--border)); color: var(--accent-ink); }
.model-type-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.model-basics-grid .model-field-icon,
.model-basics-grid .model-field-description { margin-top: 10px; padding-top: 16px; border-top: 1px solid var(--border); }
.model-basics-grid .model-icon-editor { align-items: flex-start; }

.reasoning-pricing-head {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.reasoning-base-price {
  display: flex;
  align-items: end;
  gap: 10px;
}

.reasoning-base-price label {
  display: grid;
  gap: 4px;
}

.reasoning-base-price label span {
  color: var(--ink-3);
  font-size: 12px;
}

.reasoning-base-price :deep(.el-input-number) {
  width: 120px;
}

.reasoning-pricing-head > span,
.reasoning-default-row > span {
  display: grid;
  gap: 2px;
}

.reasoning-default-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.reasoning-default-row strong {
  color: var(--ink-2);
  font-size: 13px;
}

.reasoning-default-row small {
  color: var(--ink-3);
  font-size: 11px;
}

.reasoning-price-table {
  display: grid;
  gap: 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.reasoning-price-table__head,
.reasoning-price-row {
  display: grid;
  grid-template-columns: 56px 84px repeat(2, minmax(250px, 1fr));
  min-width: 680px;
}

.reasoning-price-table__head {
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
}

.reasoning-price-table__head > span,
.reasoning-price-row > div {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.reasoning-price-row.is-off {
  background: color-mix(in srgb, var(--surface-2) 55%, var(--surface));
}

.reasoning-effort-enable {
  display: grid;
  place-items: center start;
}

.reasoning-effort-name {
  display: grid;
  align-content: center;
  gap: 2px;
}

.reasoning-effort-name strong {
  color: var(--ink-2);
  font-size: 13px;
}

.reasoning-effort-name small,
.reasoning-price-field > span {
  color: var(--ink-3);
  font-size: 12px;
}

.reasoning-channel-price {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.reasoning-price-field {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.reasoning-channel-price :deep(.el-input-number) {
  width: 100%;
}

.reasoning-discount-control {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}

.model-section__field {
  margin-bottom: 0;
}

.model-tool-picker {
  display: grid;
  gap: 8px;
}

.model-tool-picker__label {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 650;
}

.model-tool-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.model-tool-option {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.model-tool-option strong {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 700;
}

.model-tool-option small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.35;
}

.model-tool-option:hover {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  background: var(--surface);
}

.model-tool-option.is-active {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface));
  box-shadow: var(--shadow-sm);
}

.model-tool-option.is-active strong {
  color: var(--accent-ink);
}

.model-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.model-field-grid .is-wide {
  grid-column: 1 / -1;
}

.model-field-grid :deep(.el-form-item) {
  margin-bottom: 12px;
}

.model-field-grid :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.model-icon-editor {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.model-icon-editor__preview,
.model-card__icon {
  display: grid;
  flex: 0 0 auto;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--accent-ink);
  background: var(--surface-2);
}

.model-icon-editor__preview {
  width: 54px;
  height: 54px;
}

.model-icon-editor__preview img,
.model-card__icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.model-icon-editor__preview svg {
  width: 24px;
  height: 24px;
}

.model-icon-editor__actions {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.model-icon-editor__actions small {
  color: var(--ink-3);
  font-size: 12px;
}

.model-icon-editor__input {
  display: none;
}

.model-status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.model-status-grid > label {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  background: var(--surface-2);
}

.model-status-grid > label > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.model-status-grid strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.model-status-grid small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-capability-block {
  display: grid;
  gap: 12px;
}

.model-capability-row,
.model-capability-tile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border-radius: 10px;
  background: var(--surface-2);
}

.model-capability-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.exact-size-settings {
  display: grid;
  gap: 10px;
}

.exact-size-hint {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
}

.exact-size-settings .model-capability-tile {
  min-width: 0;
  flex-wrap: wrap;
}

.model-capability-tile.is-wide {
  grid-column: 1 / -1;
}

.model-capability-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.model-capability-copy strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.model-capability-copy span {
  color: var(--ink-3);
  font-size: 11px;
}
.model-config-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.model-config-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.model-config-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.config-toolbar {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.config-toolbar__row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-toolbar__row--sub {
  gap: 10px;
}

.config-toolbar__commit,
.config-toolbar__filters,
.config-toolbar__buttons {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.config-toolbar__commit,
.config-toolbar__buttons {
  flex: 0 0 auto;
  white-space: nowrap;
}

.config-toolbar__filters {
  flex: 1 1 auto;
}

.config-toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

.config-toolbar__result,
.config-toolbar__summary {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.config-toolbar .toolbar-icon-button {
  --el-button-text-color: var(--ink-2);
  --el-button-bg-color: var(--surface-2);
  --el-button-border-color: transparent;
  --el-button-hover-text-color: var(--ink);
  --el-button-hover-bg-color: var(--surface-3);
  --el-button-hover-border-color: transparent;
  --el-button-active-bg-color: var(--surface-3);
  --el-button-active-border-color: transparent;
  font-weight: 600;
}

.toolbar-icon-button {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
}

.search-kbd {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 5px;
  color: var(--ink-3);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.config-toolbar__row--sub :deep(.el-button) {
  height: 34px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
}

.model-search :deep(.el-input__wrapper) {
  height: 34px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  box-shadow: none;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.model-search :deep(.el-input__wrapper:hover) {
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.model-search :deep(.el-input__wrapper.is-focus) {
  background: var(--surface);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.toolbar-button-wrap {
  display: inline-flex;
}

.config-toolbar .toolbar-add {
  --el-button-text-color: var(--accent-ink);
  --el-button-bg-color: var(--accent-soft);
  --el-button-border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  --el-button-hover-text-color: var(--accent-on);
  --el-button-hover-bg-color: var(--accent);
  --el-button-hover-border-color: var(--accent);
  --el-button-active-text-color: var(--accent-on);
  --el-button-active-bg-color: var(--accent-hover);
  --el-button-active-border-color: var(--accent-hover);
  font-weight: 700;
}

.save-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--ink-3);
  background: var(--surface-2);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
  cursor: default;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.save-button__icon {
  width: 14px;
  height: 14px;
  color: var(--success);
}

.save-button__icon.is-spinning {
  color: inherit;
  animation: save-spin 0.9s linear infinite;
}

.save-button__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-on);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-on) 18%, transparent);
}

.save-button kbd {
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-on) 12%, transparent);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.75;
}

.save-button.is-dirty {
  color: var(--accent-on);
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
  cursor: pointer;
}

.save-button.is-dirty:hover:not(:disabled) {
  background: var(--accent-hover);
}

.save-button.is-dirty:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 45%, transparent);
}

.save-button.is-failed {
  color: var(--danger);
  background: var(--danger-soft);
}

@keyframes save-spin {
  to {
    transform: rotate(360deg);
  }
}

.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
}

.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.status-tab em {
  font-style: normal;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}

.status-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}

.status-tab.is-active em {
  color: color-mix(in srgb, var(--surface) 78%, transparent);
}

.status-tab:not(.is-active):hover {
  color: var(--ink);
}

html.dark .status-tab.is-active {
  background: var(--ink);
  color: var(--bg);
  box-shadow: none;
}

html.dark .status-tab.is-active em {
  color: color-mix(in srgb, var(--bg) 60%, transparent);
}

.config-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.editable-file-control {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  padding: 10px 12px 10px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}

.editable-file-control__identity,
.editable-file-control__fields {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.editable-file-control__icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.editable-file-control__identity > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.editable-file-control__identity strong {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.editable-file-control__identity small {
  color: var(--ink-3);
  font-size: 12px;
}

.editable-file-control__fields :deep(.el-select__wrapper) {
  border-radius: var(--radius-pill);
}

.editable-file-control__fields :deep(.el-select) {
  width: 180px;
}

@media (max-width: 900px) {
  .editable-file-control {
    grid-template-columns: 1fr;
  }

  .editable-file-control__fields {
    flex-wrap: wrap;
  }

  .editable-file-control__fields :deep(.el-select) {
    width: min(100%, 240px);
  }
}

.config-list-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.config-list-shell :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}

.config-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.model-catalog-shell {
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.model-catalog-shell :deep(.admin-list-shell) {
  border-top: 0;
}

.model-catalog-shell :deep(.admin-list-shell__footer) {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}

.model-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  padding: 2px 2px 8px;
}

@media (max-width: 1180px) {
  .model-card-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.model-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.model-card:hover {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  box-shadow: var(--shadow-md);
}

.model-card.is-disabled {
  opacity: 0.72;
}

.model-card__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.model-card__head .model-card__price {
  position: static;
  flex: 0 0 auto;
  margin: -4px -4px 0 0;
}

.model-card__identity {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
}

.model-card__identity-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.model-card__icon {
  width: 38px;
  height: 38px;
}

.model-card__icon svg {
  width: 17px;
  height: 17px;
}

.model-card__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.model-card__title strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__title > span {
  flex: 0 0 auto;
}

.model-card__line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  overflow: hidden;
  white-space: nowrap;
}

.model-card__line span {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
}

.model-card__line span.mono {
  color: var(--ink-3);
}

.model-card__line span + span::before {
  content: "·";
  margin: 0 7px;
  color: var(--ink-3);
}

.meta-badge {
  flex: 0 0 auto;
  align-self: center;
}

.model-card__line > .kind-badge + .default-badge,
.model-card__line > .kind-badge + .maintenance-badge,
.model-card__line > .kind-badge + .meta-badge,
.model-card__line > .default-badge + .maintenance-badge,
.model-card__line > .default-badge + .meta-badge,
.model-card__line > .maintenance-badge + .meta-badge {
  margin-left: 4px;
}

.model-card__line > .kind-badge + strong,
.model-card__line > .default-badge + strong,
.model-card__line > .maintenance-badge + strong,
.model-card__line > .meta-badge + strong {
  margin-left: 8px;
}

.model-card__line > .kind-badge + *::before,
.model-card__line > .default-badge + *::before,
.model-card__line > .maintenance-badge + *::before,
.model-card__line > .meta-badge + *::before {
  content: none;
}

.model-card__line > :not(.kind-badge):not(.default-badge):not(.maintenance-badge):not(.meta-badge)
  + :not(.kind-badge):not(.default-badge):not(.maintenance-badge):not(.meta-badge)::before {
  content: "·";
  margin: 0 8px;
  color: var(--ink-3);
}

.meta-badge {
  display: inline-flex;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--violet);
  background: var(--violet-soft);
  font-size: 10px;
  font-weight: 650;
}

.maintenance-badge,
.assignment-maintenance {
  display: inline-flex;
  padding: 3px 6px;
  border-radius: 5px;
  color: #9a3412;
  background: #ffedd5;
  font-size: 10px;
  font-weight: 650;
}

html.dark .maintenance-badge,
html.dark .assignment-maintenance {
  color: #fed7aa;
  background: rgb(154 52 18 / 32%);
}

.model-card__price {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  display: grid;
  min-width: 88px;
  justify-items: end;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--ink);
  color: #fff;
  font: inherit;
  text-align: right;
}

.model-card__price.is-interactive {
  cursor: pointer;
}

.model-card__price.is-interactive:hover,
.model-card__price.is-interactive:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.model-card__price .price-now {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  color: #fff;
  line-height: 1;
}

.model-card__price .price-now strong {
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.model-card__price .price-now span {
  color: rgb(255 255 255 / 0.72);
  font-size: 11px;
  font-weight: 600;
}

.model-card__price .price-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.model-card__price .price-was {
  color: rgb(255 255 255 / 0.55);
  font-size: 11px;
  text-decoration: line-through;
}

.model-card__price .price-scope {
  color: rgb(255 255 255 / 0.72);
  font-size: 11px;
  font-weight: 600;
}

.model-card__price .price-count {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--accent-on);
  background: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
}

.model-card__price .price-off {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  color: #fff;
  background: var(--danger);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
}

html.dark .model-card__price {
  background: #f4f6fa;
  color: #12141a;
}

html.dark .model-card__price .price-now {
  color: #12141a;
}

html.dark .model-card__price .price-now span {
  color: rgb(18 20 26 / 0.55);
}

html.dark .model-card__price .price-was {
  color: rgb(18 20 26 / 0.45);
}

html.dark .model-card__price .price-scope {
  color: rgb(18 20 26 / 0.55);
}

.model-price-pop {
  display: grid;
  gap: 10px;
}

.model-price-pop__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.model-price-pop__head strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.model-price-pop__head span {
  color: var(--ink-3);
  font-size: 12px;
}

.price-scope-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--surface-2);
}

.price-scope-switch button {
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.price-scope-switch button.is-active {
  background: var(--accent);
  color: var(--accent-on);
}

.model-price-pop__table {
  width: 100%;
  border-collapse: collapse;
}

.model-price-pop__table th,
.model-price-pop__table td {
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  text-align: left;
}

.model-price-pop__table th {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.model-price-pop__table th:not(:first-child),
.model-price-pop__table td:not(:first-child) {
  text-align: right;
}

.model-price-pop__table tr:last-child td {
  border-bottom: 0;
}

.model-price-pop__table td {
  color: var(--ink);
}

.model-price-pop__table .is-default td {
  font-weight: 650;
}

.model-price-pop__table th.is-active {
  color: var(--ink);
}

.model-price-pop__table td.is-muted {
  color: var(--ink-3);
}

.model-price-pop__table em {
  margin-left: 6px;
  color: var(--ink-3);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}

.model-price-pop__table s {
  margin-right: 4px;
  color: var(--ink-3);
}

.model-card__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  padding: 10px 0;
  border-radius: 10px;
  background: var(--surface-2);
}

.model-card__stat {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 5px;
  padding: 0 12px;
}

.model-card__stat + .model-card__stat {
  border-left: 1px solid var(--border);
}

.model-card__stat dt,
.model-card__row dt {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.model-card__stat dd {
  display: flex;
  min-width: 0;
  height: 20px;
  align-items: center;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__rows {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0 2px;
}

.model-card__row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 20px;
}

.model-card__row dd {
  display: flex;
  min-width: 0;
  align-items: center;
  margin: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__stat dd.is-muted,
.model-card__row dd.is-muted {
  color: var(--ink-3);
  font-weight: 500;
}

.model-card__tags,
.model-card__aspects {
  display: flex;
  min-width: 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.model-card__aspects {
  gap: 12px;
}

.model-card__aspect {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
}

.res-badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 6px;
  color: #fff;
  background: var(--ink);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.3;
}

html.dark .res-badge {
  color: var(--bg);
  background: var(--ink);
}

.model-card__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
}

.model-card__foot-meta {
  display: inline-flex;
  min-width: 0;
  max-width: 160px;
  align-items: baseline;
  gap: 6px;
  margin-right: 4px;
  color: var(--ink-3);
  font-size: 12px;
}

.model-card__foot-meta strong {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
}

.model-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--ink-2);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.card-btn svg {
  width: 13px;
  height: 13px;
}

.card-btn:hover {
  color: var(--ink);
  background: var(--surface-2);
}

.card-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
}

.card-btn.is-solid {
  color: var(--ink);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border);
}

.card-btn.is-solid:hover {
  color: var(--accent-on);
  background: var(--accent);
  box-shadow: none;
}

.card-btn.is-icon {
  width: 28px;
  justify-content: center;
  padding: 0;
  color: var(--ink-3);
}

.card-btn.is-danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.model-catalog-empty {
  display: grid;
  height: 100%;
  place-items: center;
}

.model-search {
  flex: 0 1 260px;
  width: auto;
  min-width: 160px;
}
.image-capability-editor {
  display: grid;
  overflow: hidden;
  border-radius: 7px;
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.capability-compact-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid var(--border);
}
.capability-tile {
  display: flex;
  min-width: 0;
  min-height: 70px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
}
.capability-tile + .capability-tile {
  border-left: 1px solid var(--border);
}
.capability-tile:nth-child(4) {
  border-left: 0;
}
.capability-tile:nth-child(n + 4) {
  border-top: 1px solid var(--border);
}
.capability-tile .capability-label {
  flex-basis: auto;
}
.capability-tile .capability-control {
  min-width: 0;
  flex-wrap: wrap;
}
.image-capability-editor > header,
.capability-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 11px 13px;
}
.image-capability-editor > header {
  background: var(--surface-3);
}
.image-capability-editor > header > div,
.capability-label {
  display: grid;
  gap: 2px;
}
.image-capability-editor > header strong,
.capability-label strong {
  color: var(--ink-1);
  font-size: 12px;
}
.image-capability-editor > header span,
.capability-label span {
  color: var(--ink-3);
  font-size: 10px;
}
.image-capability-editor > header > span {
  padding: 3px 7px;
  border-radius: 4px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  font-weight: 700;
}
.capability-row + .capability-row {
  border-top: 1px solid var(--border);
}
.capability-row.is-stack {
  align-items: flex-start;
}
.capability-label {
  flex: 0 0 142px;
}
.capability-control,
.reference-limit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.capability-control em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
}
.capability-options {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ratio-options {
  flex: 1;
  gap: 5px;
}
.ratio-options :deep(.el-checkbox-button__inner) {
  min-width: 48px;
  border: 0;
  border-radius: 5px;
  padding: 6px 8px;
  box-shadow: inset 0 0 0 1px var(--border);
}
.ratio-options
  :deep(.el-checkbox-button:first-child .el-checkbox-button__inner),
.ratio-options
  :deep(.el-checkbox-button:last-child .el-checkbox-button__inner) {
  border-radius: 5px;
}
.auto-aspect-rules {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--surface-2);
}
.auto-aspect-rules__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.auto-aspect-rules__heading strong {
  color: var(--ink-1);
  font-size: 12px;
}
.auto-aspect-rules__heading span {
  color: var(--ink-3);
  font-size: 10px;
}
.auto-aspect-rules__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.auto-aspect-rule {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.auto-aspect-rule > strong {
  color: var(--accent-ink);
  font-size: 12px;
}
.auto-aspect-rule > i {
  color: var(--ink-3);
  font-style: normal;
}
.auto-aspect-rule :deep(.el-select) {
  width: 100%;
}
.compact-options :deep(.el-checkbox-button__inner) {
  min-width: 58px;
}
.reference-limit > span {
  color: var(--ink-3);
  font-size: 11px;
}
.kind-filter {
  display: inline-flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
}

.kind-filter button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.kind-filter button em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  opacity: 0.8;
}

.kind-filter button.active {
  color: var(--ink);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font-weight: 700;
}

.kind-filter button.active em {
  color: var(--ink-2);
  opacity: 1;
}

.kind-filter button:not(.active):hover {
  color: var(--ink);
}

html.dark .kind-filter button.active {
  background: var(--surface-3);
}

.assignment-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.assignment-shell {
  display: grid;
  flex: 1;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.assignment-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: 12px 8px;
  overflow: auto;
  border-radius: 14px;
  background: var(--surface-2);
}

.assignment-rail__hint {
  margin: 2px 10px 8px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.assignment-rail-item {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 38px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.assignment-rail-item:hover {
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  color: var(--ink);
}

.assignment-rail-item.is-active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}

.assignment-rail-item.is-active::before {
  position: absolute;
  top: 50%;
  left: 0;
  width: 3px;
  height: 16px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
  content: "";
  transform: translateY(-50%);
}

.assignment-rail-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
}

.assignment-rail-item__name {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignment-rail-item > em {
  display: inline-grid;
  min-width: 24px;
  height: 20px;
  flex: 0 0 auto;
  padding: 0 7px;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.assignment-rail-item.is-active > em {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

/* 页面还没有分配任何模型时，用警示色提醒 */
.assignment-rail-item.is-empty > em {
  background: var(--warning-soft);
  color: var(--warning);
}

.assignment-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  padding: 4px 0 0;
}

.assignment-main__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}

.assignment-main__title {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.assignment-main__title strong {
  color: var(--ink);
  font-size: 17px;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.assignment-main__title small {
  color: var(--ink-3);
  font-size: 12px;
}

.workspace-billing-note {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--brand, #7568f4) 28%, var(--line, #e6e8ee));
  border-radius: 10px;
  background: color-mix(in srgb, var(--brand, #7568f4) 8%, var(--surface, #fff));
}

.workspace-billing-note > header {
  display: grid;
  gap: 4px;
}

.workspace-billing-note > header strong {
  font-size: 13px;
}

.workspace-billing-note > header small {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.45;
}

.workspace-billing-note ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workspace-billing-note li {
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.workspace-billing-note code {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 0 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ink, #111) 6%, transparent);
  font-size: 11px;
}

.workspace-billing-note li span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.workspace-billing-note li b {
  font-size: 12px;
}

.workspace-billing-note li small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.4;
}

.assignment-defaults {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assignment-default {
  display: inline-flex;
  align-items: center;
  gap: 0;
  height: 34px;
  padding-left: 12px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.assignment-default > span {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.assignment-default :deep(.el-select) {
  width: 180px;
}

.assignment-default :deep(.el-select__wrapper) {
  min-height: 34px;
  border-radius: var(--radius-pill);
  background: transparent;
  box-shadow: none !important;
  font-weight: 650;
}

.assignment-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.assignment-toolbar .assignment-search {
  width: 260px;
}

.assignment-toolbar .assignment-search :deep(.el-input__wrapper) {
  height: 34px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  box-shadow: none;
}

.assignment-toolbar .assignment-search :deep(.el-input__wrapper.is-focus) {
  background: var(--surface);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.assignment-toolbar__summary {
  margin-right: auto;
  color: var(--ink-3);
  font-size: 12px;
}

.assignment-toolbar__summary b {
  color: var(--ink);
  font-weight: 700;
}

.assignment-board {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 22px;
  min-height: 0;
  padding: 16px;
  overflow: auto;
  border-radius: 16px;
  background: var(--surface-2);
}

.assign-group {
  display: grid;
  gap: 10px;
}

.assign-group__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ink);
  font-size: 13px;
}

.assign-group__head strong {
  font-weight: 700;
}

.assign-group__head em {
  display: inline-grid;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--ink-2);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.assign-group__head small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assign-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 10px;
}

.assign-grid__empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 18px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  color: var(--ink-3);
  font-size: 12px;
  text-align: center;
}

.assign-card {
  position: relative;
  display: grid;
  align-content: space-between;
  gap: 12px;
  min-width: 0;
  min-height: 100px;
  padding: 14px 14px 12px 16px;
  border: 0;
  border-radius: 16px;
  background: var(--surface);
  box-shadow:
    0 1px 2px rgb(16 24 40 / 0.06),
    0 2px 8px rgb(16 24 40 / 0.04);
  transition: box-shadow 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.assign-card:hover {
  box-shadow:
    0 2px 4px rgb(16 24 40 / 0.06),
    0 10px 24px rgb(16 24 40 / 0.08);
  transform: translateY(-1px);
}

.assign-card.is-default {
  background: color-mix(in srgb, var(--accent-soft) 75%, var(--surface));
}

html.dark .assign-card:not(.is-ghost) {
  background: var(--surface-3);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}

html.dark .assign-card:not(.is-ghost):hover {
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.35);
}

html.dark .assign-card.is-default {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface-3));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.assign-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.assign-card__title {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.assign-card__title strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assign-card__title small {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assign-card__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.assign-card__controls .assignment-limit-chip {
  width: auto;
  height: 28px;
  padding: 0 10px;
  border-radius: 10px;
}

.assign-card.is-default .assignment-limit-chip:not(.is-extended),
.assign-card.is-default .price-tag:not(.is-override) {
  background: color-mix(in srgb, var(--surface) 80%, transparent);
}

html.dark .assign-card .assignment-limit-chip:not(.is-extended),
html.dark .assign-card .price-tag:not(.is-override) {
  background: var(--surface-2);
}

.assign-card__remove {
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.assign-card:hover .assign-card__remove,
.assign-card__remove:focus-visible {
  opacity: 1;
}

.assign-card .assignment-default-radio {
  flex: 0 0 auto;
  margin: -2px -4px 0 0;
}

.assign-card .assignment-default-radio span {
  display: inline;
}

/* 可加入的模型：虚线卡片，整张可点 */
.assign-card.is-ghost {
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-self: start;
  min-height: 60px;
  padding: 10px 12px;
  align-content: center;
  align-items: center;
  background: color-mix(in srgb, var(--surface) 45%, transparent);
  box-shadow: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.assign-card.is-ghost .assign-card__title strong {
  color: var(--ink-2);
  font-weight: 650;
}

.assign-card.is-ghost:hover {
  background: var(--surface);
  box-shadow:
    0 1px 2px rgb(16 24 40 / 0.06),
    0 2px 8px rgb(16 24 40 / 0.04);
  transform: none;
}

.assign-card.is-ghost:hover .assign-card__title strong {
  color: var(--ink);
}

html.dark .assign-card.is-ghost {
  background: color-mix(in srgb, var(--surface-3) 28%, transparent);
}

html.dark .assign-card.is-ghost:hover {
  background: var(--surface-3);
}

.assign-card__plus {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink-2);
  transition: background 0.15s ease, color 0.15s ease;
}

.assign-card__plus svg {
  width: 15px;
  height: 15px;
}

.assign-card.is-ghost:hover .assign-card__plus {
  background: var(--accent);
  color: var(--accent-on);
}

.assign-card.is-ghost > em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
}

.assign-card.is-ghost:hover > em {
  color: var(--accent-ink);
}

.assignment-link {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
}

.assignment-link:hover:not(:disabled) {
  color: var(--ink);
  background: var(--surface-3);
}

.assignment-link.is-danger:hover:not(:disabled) {
  color: var(--danger);
  background: var(--danger-soft);
}

.assignment-link:disabled {
  color: var(--ink-3);
  opacity: 0.5;
  cursor: not-allowed;
}

.kind-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
}

.kind-dot.is-image {
  background: var(--info);
}

.kind-dot.is-chat {
  background: var(--success);
}

.kind-dot.is-image_tool {
  background: var(--warning);
}

/* 价格列按整列最宽值对齐：同一分组内的行共用最小宽度 */





.assignment-limit-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 112px;
  height: 26px;
  justify-content: center;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
}

.assignment-limit-chip span {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
}

.assignment-limit-chip em {
  color: var(--ink-3);
  font-style: normal;
}

.assignment-limit-chip b {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

.assignment-limit-chip:hover {
  background: var(--surface-3);
}

.assignment-limit-chip.is-extended {
  background: var(--info-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--info) 30%, transparent);
}

.assignment-limit-chip.is-extended b {
  color: var(--info);
}

.assignment-limit-pop {
  display: grid;
  gap: 12px;
}

.assignment-limit-pop header {
  display: grid;
  gap: 2px;
}

.assignment-limit-pop header strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.assignment-limit-pop header small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignment-limit-field {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-2);
}

.assignment-limit-field__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 650;
}

.assignment-limit-field__head strong {
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1;
}

.assignment-limit-field__head strong.is-extended {
  color: var(--info);
}

.assignment-limit-field__head strong small {
  margin-left: 2px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.assignment-limit-field__body {
  display: flex;
  align-items: center;
  gap: 8px;
}

.limit-stepper {
  display: inline-grid;
  grid-template-columns: 34px 58px 34px;
  height: 34px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
}

.limit-stepper button {
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}

.limit-stepper button:hover:not(:disabled) {
  background: var(--surface-3);
}

.limit-stepper button:disabled {
  color: var(--ink-3);
  opacity: 0.45;
  cursor: not-allowed;
}

.limit-stepper label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-inline: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 13px;
  font-weight: 700;
}

.limit-stepper input {
  width: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  outline: none;
  appearance: textfield;
  -moz-appearance: textfield;
}

.limit-stepper input::-webkit-inner-spin-button,
.limit-stepper input::-webkit-outer-spin-button {
  margin: 0;
  -webkit-appearance: none;
}

.limit-stepper:focus-within {
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.limit-quick {
  display: flex;
  flex: 1;
  gap: 4px;
}

.limit-quick button {
  flex: 1;
  height: 30px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.limit-quick button:hover:not(:disabled) {
  color: var(--accent-ink);
  background: var(--accent-soft);
  box-shadow: none;
}

.limit-quick button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.assignment-limit-field__hint {
  color: var(--ink-3);
  font-size: 11px;
}

.assignment-limit-pop footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.assignment-limit-pop footer p {
  margin: 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.5;
}

.assignment-limit-pop footer .assignment-link {
  flex: 0 0 auto;
}




/* 页面价格胶囊：价格为主，来源（继承 / 页面价）为辅，末尾的笔形图标提示可编辑 */
.price-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px 0 10px;
  border: 0;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-3);
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease;
}

.price-tag b {
  color: var(--ink);
  font-size: 13px;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.price-tag__unit {
  color: var(--ink-3);
}

.price-tag__source {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 2px;
  color: var(--ink-3);
}

.price-tag__source::before {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  content: "";
  opacity: 0.6;
}

.price-tag__edit {
  width: 12px;
  height: 12px;
  margin-left: 2px;
  color: var(--ink-3);
  opacity: 0.45;
  transition: opacity 0.12s ease, color 0.12s ease;
}

.price-tag:hover {
  background: var(--surface-3);
}

.price-tag:hover .price-tag__edit,
.price-tag:focus-visible .price-tag__edit {
  color: var(--ink);
  opacity: 1;
}

.price-tag:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
}

.price-tag.is-override {
  background: var(--warning-soft);
}

.price-tag.is-override b,
.price-tag.is-override .price-tag__source,
.price-tag.is-override .price-tag__edit {
  color: var(--warning);
}

.price-tag.is-override .price-tag__source {
  font-weight: 700;
}

.price-tag.is-override:hover {
  background: color-mix(in srgb, var(--warning) 18%, var(--surface));
}

.assignment-price-pop {
  display: grid;
  gap: 12px;
}

.assignment-price-pop header {
  display: grid;
  gap: 2px;
}

.assignment-price-pop header strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.assignment-price-pop header small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.price-mode button {
  height: 30px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.price-mode button.is-on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}

.price-inherit {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
}

.price-inherit strong {
  margin-left: auto;
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1;
}

.price-inherit strong small {
  margin-left: 3px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.price-inherit em {
  color: var(--ink-3);
  font-style: normal;
  text-decoration: line-through;
}

.price-field {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 34px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}

.price-field__switch {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.price-field > small {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 500;
}

.price-input {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  transition: box-shadow 0.15s ease;
}

.price-input:focus-within {
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.price-input input {
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  outline: none;
  appearance: textfield;
  -moz-appearance: textfield;
}

.price-input input::-webkit-inner-spin-button,
.price-input input::-webkit-outer-spin-button {
  margin: 0;
  -webkit-appearance: none;
}

.price-input em {
  flex: 0 0 auto;
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.price-warn {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11px;
  line-height: 1.5;
}

.assignment-price-pop footer {
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  color: var(--ink-3);
  font-size: 11px;
}

.assignment-default-radio {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px 0 6px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.assignment-default-radio i {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px var(--border-strong);
  transition: box-shadow 0.12s ease, background 0.12s ease;
}

.assignment-default-radio span {
  display: none;
}

.assignment-default-radio:hover:not(:disabled) {
  background: var(--surface-3);
}

.assignment-default-radio:hover:not(:disabled) i {
  box-shadow: inset 0 0 0 1.5px var(--accent-ink);
}

.assignment-default-radio.is-on {
  color: var(--accent-on);
  background: var(--accent);
  cursor: default;
}

.assignment-default-radio.is-on i {
  background: var(--accent-on);
  box-shadow: inset 0 0 0 3.5px var(--accent);
}

.assignment-default-radio.is-on span {
  display: inline;
}

.assignment-default-radio:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.assignment-icon-btn {
  display: inline-grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}

.assignment-icon-btn svg {
  width: 13px;
  height: 13px;
}

.assignment-icon-btn.is-danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.config-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.config-table :deep(.el-table__header-wrapper th.el-table__cell),
.config-table :deep(.el-table__body td.el-table__cell),
.config-table :deep(.el-table .cell) {
  text-align: left !important;
}

.config-table :deep(.el-table .cell) {
  display: block;
  padding-left: 12px;
  padding-right: 12px;
}

.config-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 48px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.config-table :deep(.el-table__body .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.config-table :deep(.el-table__row td.el-table__cell) {
  height: 64px;
}

.config-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.config-table :deep(.el-table__body tr.el-table__row:last-child td.el-table__cell) {
  border-bottom-color: transparent;
}

.cell-text {
  display: block;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price-plain {
  display: block;
  width: 40px;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.35;
}

.price-deal {
  display: grid;
  grid-template-columns: 40px 40px 48px;
  align-items: center;
  column-gap: 6px;
  min-width: 0;
}

.price-deal strong {
  width: 40px;
  color: var(--warning);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.2;
}

.price-deal__was {
  width: 40px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.2;
  text-decoration: line-through;
}

.price-deal em {
  display: inline-flex;
  width: 48px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger-soft) 80%, var(--surface));
  color: var(--danger);
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  line-height: 1;
}

.cell-text.is-muted,
.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
}

.cell-text.mono {
  color: var(--ink-2);
  font-size: 12px;
}

.provider-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.provider-identity.is-disabled {
  opacity: 0.55;
}

.provider-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border-radius: 10px;
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
}

.provider-avatar.is-crun {
  background: var(--warning-soft);
  color: var(--warning);
  box-shadow: none;
}

.provider-identity__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.provider-identity__copy strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-identity__copy .mono {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 650;
  white-space: nowrap;
}

.provider-chip.is-openai {
  background: var(--info-soft);
  color: var(--info);
}

.provider-chip.is-crun {
  background: var(--warning-soft);
  color: var(--warning);
}

.provider-chip.is-on {
  background: var(--success-soft);
  color: var(--success);
}

.provider-chip.is-off {
  background: var(--surface-3);
  color: var(--ink-3);
}

.provider-count {
  display: inline-grid;
  min-width: 24px;
  height: 22px;
  padding: 0 7px;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

.cell-sep {
  margin: 0 4px;
  color: var(--ink-3);
}

.cell-unit {
  margin-left: 1px;
  color: var(--ink-3);
  font-size: 11px;
}

.provider-catalog-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.provider-catalog-btn:hover {
  background: var(--accent);
  color: var(--accent-on);
}

.discovered-model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.discovered-model-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
}

.discovered-model-actions span {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .discovered-model-actions {
    align-items: stretch;
    flex-direction: column;
  }
}

.discovered-model-chip {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-all;
  box-shadow: var(--shadow-sm);
}

.discovered-model-chip.is-configured {
  border-color: color-mix(in srgb, var(--success) 28%, var(--border));
  background: color-mix(in srgb, var(--success-soft) 70%, var(--surface));
}

.discovered-model-chip em {
  flex: none;
  color: var(--success);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  white-space: nowrap;
}
.primary-cell .model-description {
  display: -webkit-box;
  max-width: 220px;
  overflow: hidden;
  color: var(--ink-2);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}
.provider-cell b {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.endpoint {
  display: block;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kind-badge,
.default-badge {
  display: inline-flex;
  width: fit-content;
  padding: 3px 6px;
  border-radius: 5px;
  font-size: 10px;
}
.kind-badge.is-image {
  color: var(--info);
  background: var(--info-soft);
}
.kind-badge.is-chat {
  color: var(--success);
  background: var(--success-soft);
}
.kind-badge.is-image_tool {
  color: var(--warning);
  background: var(--warning-soft);
}
.default-badge {
  color: var(--accent);
  background: var(--accent-soft);
}
.price-cell {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.price-cell strong {
  color: var(--danger);
  font-size: 13px;
}
.price-cell del {
  color: var(--ink-3);
  font-size: 10px;
}
.resolution-list,
.provider-models {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.resolution-list i,
.provider-models span {
  padding: 3px 5px;
  border-radius: 4px;
  color: var(--info);
  background: var(--info-soft);
  font-size: 9px;
  font-style: normal;
}
.resolution-list i.is-fast {
  color: var(--success);
  background: var(--success-soft);
}
.catalog-capability,
.catalog-output {
  display: grid;
  min-width: 0;
  gap: 5px;
}
.capability-line,
.catalog-output > span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.capability-line b {
  flex: none;
  color: var(--ink-2);
  font-size: 9px;
  font-weight: 650;
}
.output-tags,
.workspace-tags {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.output-tags i,
.workspace-tags i {
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-style: normal;
}
.output-tags i {
  color: var(--success);
  background: var(--success-soft);
}
.workspace-tags i {
  color: var(--accent-ink);
  background: var(--accent-soft);
}
.unassigned-label {
  color: var(--ink-3);
  font-size: 10px;
}
.chat-capability,
.tool-capability {
  color: var(--ink-3);
  font-size: 10px;
}
.provider-models span {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-models small {
  color: var(--accent);
  font-size: 10px;
}
.provider-models em {
  color: var(--ink-3);
  font-size: 10px;
  font-style: normal;
}
.model-count {
  color: var(--accent);
  font-size: 13px;
}
.dialog-form {
  padding: 0 4px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.form-grid .is-wide {
  grid-column: 1/-1;
}
.full-radio,
.kind-radio {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, 1fr);
}
.full-radio :deep(.el-radio-button),
.kind-radio :deep(.el-radio-button) {
  width: 100%;
}
.full-radio :deep(.el-radio-button__inner),
.kind-radio :deep(.el-radio-button__inner) {
  width: 100%;
}
.model-discovery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.provider-route-editor {
  display: grid;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}
.provider-route-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--ink-1);
  font-size: 13px;
}
.provider-route-heading > div {
  display: grid;
  gap: 2px;
}
.provider-route-heading span {
  color: var(--ink-3);
  font-size: 11px;
}
.provider-route-item {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}
.provider-route-item-head,
.provider-route-actions,
.provider-route-item-head > div {
  display: flex;
  align-items: center;
}
.provider-route-item-head {
  justify-content: space-between;
  gap: 12px;
}
.provider-route-item-head > div,
.provider-route-actions {
  gap: 8px;
}
.provider-route-actions > span {
  color: var(--ink-3);
  font-size: 11px;
}
.provider-route-fields {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 8px;
}
.provider-route-field {
  display: grid;
  min-width: 0;
  gap: 5px;
}
.provider-route-field small,
.discovery-note {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
}
.discovered-model-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}
.discovered-model-list :deep(.el-tag),
.provider-route-check :deep(.el-tag) {
  height: auto;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.provider-route-field > span {
  color: var(--ink-3);
  font-size: 11px;
}
.provider-route-field :deep(.el-input-number) {
  width: 100%;
}
.route-name-field {
  grid-column: span 4;
}
.route-url-field {
  grid-column: span 8;
}
.route-key-field {
  grid-column: span 6;
}
.route-limit-field,
.route-timeout-field {
  grid-column: span 3;
}
.provider-route-check {
  display: flex;
  justify-content: flex-end;
}

.model-discovery > div {
  display: grid;
  gap: 2px;
}
.model-discovery strong {
  color: var(--ink-1);
  font-size: 13px;
}
.model-discovery span {
  color: var(--ink-3);
  font-size: 10px;
}
.model-picker {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.model-picker .el-select {
  width: 100%;
}
.model-schema-state {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: var(--ink-3);
  font-size: 11px;
}
.discount-input,
.eta-input {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
}
.discount-input .el-input-number {
  flex: 1;
}
.eta-input .el-input-number {
  width: 108px;
}
.eta-input span {
  color: var(--ink-3);
  font-size: 11px;
}
@media (max-width: 1100px) {
  .config-toolbar__row--sub {
    flex-wrap: wrap;
  }
}

@media (max-width: 700px) {
  :global(.model-config-editor-dialog .admin-dialog__footer) { flex-wrap: wrap; gap: 10px; }
  :global(.model-config-editor-dialog .admin-dialog__hint) { flex: 1 0 100%; max-width: none; font-size: 11px; line-height: 1.5; }
  :global(.model-config-editor-dialog .admin-dialog__actions) { margin-left: auto; }
  .model-editor .reasoning-price-table { border: 0; overflow: visible; gap: 12px; }
  .model-editor .reasoning-price-table__head { display: none; }
  .model-editor .reasoning-price-row { min-width: 0; grid-template-columns: 40px minmax(0, 1fr); border: 1px solid var(--border); border-radius: 10px; padding: 6px; }
  .model-editor .reasoning-channel-price { grid-column: 1 / -1; }
  .model-editor .reasoning-channel-price::before { content: attr(data-channel); grid-column: 1 / -1; color: var(--ink-2); font-size: 12px; font-weight: 600; }
  .model-editor-nav { padding: 4px; gap: 2px; }
  .model-editor-nav button { padding: 10px 2px; }
  .model-editor-nav strong { font-size: 12px; }
  .model-editor .model-section { padding: 14px; }
  .model-editor .model-status-grid { grid-template-columns: minmax(0, 1fr); }
}</style>
