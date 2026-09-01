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
import { ElMessage, ElMessageBox } from "element-plus";
import { Coin, Connection, Cpu, Delete, Plus, Refresh, Search } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";
import { useClientPagination } from "@/useClientPagination";
import { formatPoints, IMAGE_SERVICE_ROUTES, normalizePoints } from "@/utils";

type ProviderAdapter = "openai" | "crun";
type ModelKind = "image" | "chat" | "image_tool";
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
const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};

function reasoningModelIs(model: string, base: string) {
  return model === base || model.startsWith(`${base}-`);
}

function reasoningEffortsForModel(raw: string) {
  const model = String(raw || "")
    .trim()
    .toLowerCase()
    .split("/")
    .at(-1) || "";
  if (!model || model.includes("-chat")) return [];
  if (reasoningModelIs(model, "gpt-5.6"))
    return ["low", "medium", "high", "xhigh", "max"];
  if (["gpt-5.5-pro", "gpt-5.4-pro", "gpt-5.2-pro"].some((base) => reasoningModelIs(model, base)))
    return ["medium", "high", "xhigh"];
  if (["gpt-5.5", "gpt-5.4", "gpt-5.2"].some((base) => reasoningModelIs(model, base)))
    return ["low", "medium", "high", "xhigh"];
  if (reasoningModelIs(model, "gpt-5.3-codex") || model === "codex-auto-review")
    return ["low", "medium", "high", "xhigh"];
  if (reasoningModelIs(model, "gpt-5.1"))
    return ["none", "low", "medium", "high"];
  if (["gpt-5", "gpt-5-mini", "gpt-5-nano"].includes(model))
    return ["minimal", "low", "medium", "high"];
  return [];
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
}) {
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
      const enabled = fromList
        ? enabledSet.has(effort)
        : reasoningEffortEnabled(configured);
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
const workspacePricingDialogVisible = ref(false);
const pricingWorkspaceKey = ref<WorkspaceKey>("assistant");
const workspacePricingDraft = ref<
  Record<WorkspaceKey, Record<string, WorkspaceModelPricing>>
>({} as Record<WorkspaceKey, Record<string, WorkspaceModelPricing>>);
const kindFilter = ref<"all" | ModelKind>("all");
const modelSearch = ref("");
const reasoningPriceScope = ref<ReasoningPriceScope>("assistant");
const savedSignature = ref("");
const autoSaveReady = ref(false);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueued = false;
const config = reactive<ModelConfig>({
	version: 7,
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
  () => autoSaveReady.value && signature() !== savedSignature.value,
);
const saveStatusLabel = computed(() => {
  if (saving.value) return "保存中…";
  if (isDirty.value) return "有未保存更改";
  if (!autoSaveReady.value) return "加载中…";
  return "已自动保存";
});

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
	config.version = value.version || 7;
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
    upstreamInputFields: model.upstreamInputFields || [],
    upstreamRequiredInputFields: model.upstreamRequiredInputFields || [],
    upstreamInputSchema: model.upstreamInputSchema || {},
    modality: model.modality || "",
    operations: model.operations || [],
    imageUpscalePricing: model.imageUpscalePricing || null,
    kind: model.kind || "image",
    tool: model.kind === "image_tool" ? model.tool || "background_remove" : "",
    description: model.description || "",
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
      model.kind === "chat"
        ? enabledReasoningEfforts({
            supportedReasoningEfforts: reasoningEffortsForModel(
              model.upstreamModel,
            ),
            reasoningPricing: normalizeReasoningPricing(
              model.reasoningPricing,
              reasoningEffortsForModel(model.upstreamModel),
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
            reasoningEffortsForModel(model.upstreamModel),
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
      return [workspace.key, { modelIds, defaultModelIds, modelPricing }];
    }),
  ) as Record<WorkspaceKey, WorkspaceBinding>;
  sanitizeWorkspaceBindings();
  savedSignature.value = signature();
}

async function load() {
  autoSaveReady.value = false;
  loading.value = true;
  try {
    hydrate(await request<ModelConfig>("/api/v1/admin/model-config"));
  } finally {
    loading.value = false;
    autoSaveReady.value = true;
  }
}

async function save() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (saving.value) {
    saveQueued = true;
    return;
  }
  sanitizeWorkspaceBindings();
  sanitizeEditableFileConfig();
  if (signature() === savedSignature.value) return;
  const payload = JSON.parse(JSON.stringify(config)) as ModelConfig;
  const submittedSignature = JSON.stringify(payload);
  saveQueued = false;
  let succeeded = false;
  saving.value = true;
  try {
    const saved = await request<ModelConfig>("/api/v1/admin/model-config", {
      method: "PUT",
      body: payload,
    });
    if (signature() === submittedSignature) {
      hydrate(retainSubmittedReasoning(saved, payload));
    } else {
      savedSignature.value = submittedSignature;
      saveQueued = true;
    }
    succeeded = true;
  } finally {
    saving.value = false;
    if (succeeded && (saveQueued || signature() !== savedSignature.value))
      scheduleSave();
  }
}

function scheduleSave() {
  if (!autoSaveReady.value || loading.value) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void save().catch(() => undefined);
  }, 500);
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

watch(
  () => signature(),
  (value) => {
    if (!autoSaveReady.value || loading.value || value === savedSignature.value)
      return;
    scheduleSave();
  },
  { flush: "post" },
);

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

const pricingWorkspace = computed(
  () =>
    workspaceMeta.find(
      (workspace) => workspace.key === pricingWorkspaceKey.value,
    ) || workspaceMeta[0],
);

const pricingWorkspaceModels = computed(() => {
  const binding = config.workspaces[pricingWorkspace.value.key];
  if (!binding) return [] as ModelItem[];
  const assigned = new Set(binding.modelIds);
  return config.models.filter(
    (model) =>
      assigned.has(model.id) && pricingWorkspace.value.kinds.includes(model.kind),
  );
});

function openWorkspacePricing() {
  const firstAssigned = workspaceMeta.find(
    (workspace) => workspaceAssignedCount(workspace) > 0,
  );
  if (!workspaceAssignedCount(activeWorkspace.value) && firstAssigned) {
    pricingWorkspaceKey.value = firstAssigned.key;
  } else {
    pricingWorkspaceKey.value = activeWorkspace.value.key;
  }
  workspacePricingDraft.value = Object.fromEntries(
    workspaceMeta.map((workspace) => [
      workspace.key,
      cloneJSON(config.workspaces[workspace.key]?.modelPricing || {}),
    ]),
  ) as Record<WorkspaceKey, Record<string, WorkspaceModelPricing>>;
  workspacePricingDialogVisible.value = true;
}

function pricingDraftOverride(model: ModelItem) {
  return workspacePricingDraft.value[pricingWorkspace.value.key]?.[model.id] || null;
}

function pricingDraftEffectivePrice(model: ModelItem) {
  const pricing = pricingDraftOverride(model);
  return pricing ? pricing.discountPriceCents ?? pricing.priceCents : effectivePrice(model);
}

function setPricingDraftOverride(model: ModelItem, enabled: boolean) {
  const workspacePricing =
    workspacePricingDraft.value[pricingWorkspace.value.key] ||
    (workspacePricingDraft.value[pricingWorkspace.value.key] = {});
  if (!enabled) {
    delete workspacePricing[model.id];
    return;
  }
  workspacePricing[model.id] = {
    priceCents: normalizePoints(model.priceCents),
    discountPriceCents:
      model.discountPriceCents === null || model.discountPriceCents === undefined
        ? null
        : normalizePoints(model.discountPriceCents),
  };
}

function setPricingDraftDiscount(model: ModelItem, enabled: boolean) {
  const pricing = pricingDraftOverride(model);
  if (!pricing) return;
  pricing.discountPriceCents = enabled ? pricing.priceCents : null;
}

function pricingWorkspaceOverrideCount(
  workspace: (typeof workspaceMeta)[number],
) {
  const assigned = new Set(config.workspaces[workspace.key]?.modelIds || []);
  return Object.keys(workspacePricingDraft.value[workspace.key] || {}).filter(
    (modelId) => assigned.has(modelId),
  ).length;
}

async function saveWorkspacePricingDraft() {
  for (const workspace of workspaceMeta) {
    const binding = config.workspaces[workspace.key];
    if (!binding) continue;
    const assigned = new Set(binding.modelIds);
    binding.modelPricing = Object.fromEntries(
      Object.entries(workspacePricingDraft.value[workspace.key] || {})
        .filter(([modelId]) => assigned.has(modelId))
        .map(([modelId, pricing]) => {
          const priceCents = normalizePoints(pricing.priceCents);
          const discountPriceCents =
            pricing.discountPriceCents === null ||
            pricing.discountPriceCents === undefined
              ? null
              : Math.min(priceCents, normalizePoints(pricing.discountPriceCents));
          return [modelId, { priceCents, discountPriceCents }];
        }),
    );
  }
  await save();
  workspacePricingDialogVisible.value = false;
}

function openWorkspaceAssignmentFromPricing() {
  activeWorkspaceKey.value = pricingWorkspace.value.key;
  workspacePricingDialogVisible.value = false;
  activeView.value = "workspaces";
}

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
  if (!binding || !binding.modelIds.includes(model.id)) return;
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
  ensureWorkspaceDefaults(workspace);
}

function clearWorkspaceModels(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  binding.modelIds = [];
  binding.defaultModelIds = {};
  binding.modelPricing = {};
  ensureWorkspaceDefaults(workspace);
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
    (model) => model.kind === kind && binding.modelIds.includes(model.id),
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

function workspacePriceLabel(workspace: (typeof workspaceMeta)[number], model: ModelItem) {
  const pricing = workspacePriceOverride(workspace, model);
  const prefix = pricing ? "页面价" : "继承";
  return `${prefix} ${formatPoints(workspaceEffectivePrice(workspace, model))} 积分`;
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

function modelWorkspaceLine(modelId: string) {
  const names = modelWorkspaceNames(modelId);
  return names.length ? names.join(" · ") : "尚未分配";
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

function modelCardHighlights(model: ModelItem) {
  if (model.kind === "chat" && model.reasoningPricing) {
    const efforts = enabledReasoningEfforts(model);
    if (!efforts.length) return [];
    const label = (effort: string) =>
      REASONING_EFFORT_LABELS[effort] || effort;
    const effective = (standard: number, discount: number | null) =>
      discount === null ? standard : discount;
    return [
      {
        label: "推理档位",
        value: efforts.map(label).join(" · "),
        tags: efforts.map(label),
      },
      {
        label: "AI 助手积分",
        value: efforts
          .map((effort) => {
            const price = model.reasoningPricing!.efforts[effort];
            return `${label(effort)} ${effective(price.assistantPriceCents, price.assistantDiscountPriceCents)}`;
          })
          .join(" · "),
        tags: efforts.map((effort) => {
          const price = model.reasoningPricing!.efforts[effort];
          return `${label(effort)} ${effective(price.assistantPriceCents, price.assistantDiscountPriceCents)}`;
        }),
      },
      {
        label: "画布 Agent 积分",
        value: efforts
          .map((effort) => {
            const price = model.reasoningPricing!.efforts[effort];
            return `${label(effort)} ${effective(price.canvasAgentPriceCents, price.canvasAgentDiscountPriceCents)}`;
          })
          .join(" · "),
        tags: efforts.map((effort) => {
          const price = model.reasoningPricing!.efforts[effort];
          return `${label(effort)} ${effective(price.canvasAgentPriceCents, price.canvasAgentDiscountPriceCents)}`;
        }),
      },
    ];
  }
  if (model.kind !== "image") return [];
  const qualities = (model.qualities || []).map((item) => qualityLabel(item));
  const formats = (model.outputFormats || []).map((item) =>
    item.toUpperCase(),
  );
  return [
    {
      label: "质量",
      value: joinList(qualities),
      tags: qualities,
    },
    {
      label: "格式",
      value: joinList(formats),
      tags: formats,
    },
    {
      label: "参考图",
      value: `${model.maxReferenceImages} 张`,
    },
    {
      label: "单次张数",
      value: `${model.maxImages} 张`,
    },
    {
      label: "耗时",
      value: `${model.minSeconds}-${model.maxSeconds}s`,
    },
  ];
}

function modelCardSections(model: ModelItem) {
  type Spec = {
    label: string;
    value: string;
    wide?: boolean;
    parts?: Array<{ label: string; text: string }>;
  };
  type Section = { title: string; items: Spec[] };
  const sections: Section[] = [];

  const runtime: Spec[] = [];
  if (model.kind === "image_tool") {
    runtime.push({
      label: "工具",
      value:
        model.tool === "background_remove"
          ? "背景移除"
          : model.tool || "—",
    });
  }
  if (model.kind !== "chat" && model.kind !== "image") {
    runtime.push({
      label: "耗时",
      value: `${model.minSeconds}-${model.maxSeconds}s`,
    });
  }
  if (runtime.length) sections.push({ title: "运行", items: runtime });

  if (model.kind === "image") {
    const aspectParts = aspectByResolutionParts(model);
    sections.push({
      title: "画面",
      items: [
        {
          label: "",
          value: formatAspectByResolution(model),
          wide: true,
          parts: aspectParts.length ? aspectParts : undefined,
        },
      ],
    });
  }

  sections.push({
    title: "分配",
    items: [
      {
        label: "",
        value: modelWorkspaceLine(model.id),
        wide: true,
      },
    ],
  });

  return sections;
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
        id: createId("media-tool"), name: importedToolName(entry), providerId: provider.id,
        upstreamModel: entry.id, upstreamInputFields: [...(entry.inputFields || [])],
        upstreamRequiredInputFields: [...(entry.requiredInputFields || [])],
        upstreamInputSchema: cloneJSON(entry.inputSchema || {}), modality: entry.modality || "",
        operations: [...(entry.operations || [])], kind: "image_tool", tool: operation,
        description: "", priceCents: 0, discountPriceCents: null, upstreamCostCents: 0,
        allowZeroPrice: false, allowLossLeader: false, imageUpscalePricing: null, fastMode: false,
        minSeconds: 30, maxSeconds: 600, resolutions: [], aspectRatios: [],
        aspectRatiosByResolution: {}, qualities: [], transparentBackground: false,
        outputFormats: [], moderationLevels: [], maxReferenceImages: 0, maxImages: 0,
        contextWindowTokens: 0, maxOutputTokens: 0, supportedReasoningEfforts: [],
        reasoningPricing: null, public: false, default: false, enabled: false,
      });
      created += 1;
    }
    discoveredModelsViewer.configured = providerModels(provider.id).map((model) => model.upstreamModel);
    await save();
    ElMessage.success(`已同步 ${schemas.length} 个媒体工具，新增 ${created} 个；请设置平台积分后再启用`);
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
    providerRouteChecks[route.id] = `连接正常 · 可配置 ${result.compatibleCount ?? result.modelCount ?? 0} 个`;
    ElMessage.success(`${route.name || "线路"}连接正常`);
  } catch {
    providerRouteChecks[route.id] = "连接失败";
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
const modelEditIndex = ref(-1);
const discoveringModelOptions = ref(false);
const modelDraft = reactive<ModelDraft>({
  id: "",
  name: "",
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
  default: false,
  enabled: true,
});

function openModel(index = -1) {
  const source = index >= 0 ? config.models[index] : null;
  const defaultProvider =
    config.providers.find((item) => item.enabled)?.id || "";
  Object.assign(
    modelDraft,
    source
      ? {
          id: source.id,
          name: source.name,
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
              ? reasoningEffortsForModel(source.upstreamModel)
              : [],
          reasoningPricing:
            source.kind === "chat"
              ? normalizeReasoningPricing(
                  source.reasoningPricing,
                  reasoningEffortsForModel(source.upstreamModel),
                  source.priceCents,
                  source.discountPriceCents,
                  Array.isArray(source.supportedReasoningEfforts)
                    ? source.supportedReasoningEfforts
                    : null,
                )
              : null,
          public: source.public,
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

async function openReasoningPricing(model: ModelItem) {
  openModel(modelOriginalIndex(model));
  await nextTick();
  document
    .getElementById("model-reasoning-pricing-section")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusModelCapabilities() {
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
      ? reasoningEffortsForModel(modelDraft.upstreamModel)
      : [];
  modelDraft.supportedReasoningEfforts = efforts;
  modelDraft.reasoningPricing = normalizeReasoningPricing(
    fillFromBase ? null : modelDraft.reasoningPricing,
    efforts,
    modelDraft.pricePoints,
    modelDraft.discountEnabled ? modelDraft.discountPoints : null,
  );
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
    ElMessage.warning("请填写模型名称、上游模型 ID 和服务商");
    return;
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.resolutions.length > 0 &&
    modelDraft.resolutions.some(
      (resolution) => !modelDraft.aspectRatiosByResolution[resolution]?.length,
    )
  ) {
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
		ElMessage.warning("请先读取该 CRUN 模型的实时参数，不能按猜测配置");
		return;
	}
	if (modelDraft.kind === "image_tool") {
		if (!modelDraft.tool || !modelDraft.operations.length || !Object.keys(modelDraft.upstreamInputSchema).length) {
			ElMessage.warning("请先读取 CRUN 实时 schema，工具能力不能手工填写");
			return;
		}
		if (provider?.adapter !== "crun") {
			ElMessage.warning("媒体工具当前只支持 CRUN 服务商");
			return;
		}
		if (
			modelDraft.tool === "image_upscale" &&
			modelDraft.upscaleHighDiscountEnabled &&
			modelDraft.upscaleHighDiscountPoints > modelDraft.upscaleHighPricePoints
		) {
			ElMessage.warning("4096px 档折扣积分不能高于标准积分");
			return;
		}
	}
  if (
    modelDraft.kind === "image" &&
    modelDraft.outputFormatsEnabled &&
    !modelDraft.outputFormats.length
  ) {
    ElMessage.warning("开启指定输出格式后，至少选择一种格式");
    return;
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.moderationEnabled &&
    !modelDraft.moderationLevels.length
  ) {
    ElMessage.warning("开启内容审核级别后，至少选择一个级别");
    return;
  }
  if (modelDraft.default && (!modelDraft.public || !modelDraft.enabled)) {
    ElMessage.warning("默认模型必须启用并对用户开放");
    return;
  }
  if (modelDraft.kind === "chat" && modelDraft.reasoningPricing) {
    for (const effort of modelDraft.supportedReasoningEfforts) {
      const price = modelDraft.reasoningPricing.efforts[effort];
      if (!price) {
        ElMessage.warning(`推理强度 ${effort} 缺少积分配置`);
        return;
      }
      if (
        (price.assistantDiscountPriceCents !== null &&
          price.assistantDiscountPriceCents > price.assistantPriceCents) ||
        (price.canvasAgentDiscountPriceCents !== null &&
          price.canvasAgentDiscountPriceCents > price.canvasAgentPriceCents)
      ) {
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
            ElMessage.warning(`${REASONING_EFFORT_LABELS[effort] || effort}档 ${channel.label} 为 0 积分，请开启允许零积分`);
            return;
          }
          if (effective < modelDraft.upstreamCostPoints && !modelDraft.allowLossLeader) {
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
    fastMode: modelDraft.kind === "image" && modelDraft.fastMode,
    minSeconds: modelDraft.minSeconds,
    maxSeconds: modelDraft.maxSeconds,
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
        ? Math.min(16, Math.max(1, Math.round(modelDraft.maxImages)))
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
    value.supportedReasoningEfforts = enabledReasoningEfforts({
      supportedReasoningEfforts: modelDraft.supportedReasoningEfforts,
      reasoningPricing: pricing,
    });
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
        item.kind === value.kind && item.default && item.public && item.enabled,
    )
  ) {
    value.default = value.public && value.enabled;
  }
  sanitizeWorkspaceBindings();
  modelDialogVisible.value = false;
  try {
    await save();
    ElMessage.success("模型已保存");
  } catch {
    // request() already presents the server validation message.
  }
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
      (item) => item.kind === model.kind && item.public && item.enabled,
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

onMounted(load);
onBeforeUnmount(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  const shouldFlush =
    autoSaveReady.value && signature() !== savedSignature.value;
  autoSaveReady.value = false;
  if (shouldFlush) void save().catch(() => undefined);
});
</script>

<template>
  <div v-loading="loading" class="model-config-page">
    <PageCard>
      <div class="config-toolbar">
        <div class="config-toolbar__heading">
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

          <div class="config-toolbar__heading-actions">
            <div
              class="save-status"
              :class="{ 'is-dirty': isDirty, 'is-saving': saving }"
            >
              <span class="save-status__dot" />
              {{ saveStatusLabel }}
            </div>
            <el-button
              v-if="activeView === 'models'"
              type="primary"
              :icon="Coin"
              class="workspace-pricing-entry"
              @click="openWorkspacePricing"
            >
              页面模型价格
            </el-button>
          </div>
        </div>

        <div v-if="activeView === 'models'" class="config-toolbar__actions">
          <div class="kind-filter" role="tablist" aria-label="模型类型">
            <button
              v-for="item in kindFilters"
              :key="item.id"
              type="button"
              :class="{ active: kindFilter === item.id }"
              @click="kindFilter = item.id"
            >
              {{ item.label }}
            </button>
          </div>
          <el-input
            v-model="modelSearch"
            clearable
            placeholder="搜索模型 / 上游 ID / 服务商"
            class="model-search"
            :prefix-icon="Search"
          />
          <div class="config-toolbar__buttons">
            <el-button
              type="primary"
              :icon="Plus"
              :disabled="!config.providers.length"
              @click="openModel()"
            >
              添加模型
            </el-button>
            <el-button :icon="Refresh" :loading="loading" @click="load">
              刷新
            </el-button>
          </div>
        </div>

        <div v-else-if="activeView === 'providers'" class="config-toolbar__actions">
          <div class="config-toolbar__buttons">
            <el-button type="primary" :icon="Plus" @click="openProvider()">
              添加服务商
            </el-button>
            <el-button :icon="Refresh" :loading="loading" @click="load">
              刷新
            </el-button>
          </div>
        </div>

        <div v-else class="config-toolbar__actions">
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
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
          @prev="modelPagination.prev"
          @next="modelPagination.next"
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
                  <div
                    class="model-card__line"
                    :title="`${kindName(row.kind)} · ${row.name} · ${providerName(row.providerId)} · ${row.upstreamModel} · ${providerAdapterLabel(row.providerId)}`"
                  >
                    <span class="kind-badge" :class="`is-${row.kind}`">{{
                      kindName(row.kind)
                    }}</span>
                    <span v-if="row.default" class="default-badge">默认</span>
                    <span v-if="row.fastMode" class="meta-badge">快速</span>
                    <strong>{{ row.name }}</strong>
                    <span>{{ providerName(row.providerId) }}</span>
                    <span class="mono">{{ row.upstreamModel || "—" }}</span>
                    <span>{{ providerAdapterLabel(row.providerId) }}</span>
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

              <div
                v-if="modelCardHighlights(row as ModelItem).length"
                class="model-card__highlights"
                :class="{ 'is-reasoning': row.kind === 'chat' }"
              >
                <div
                  v-for="item in modelCardHighlights(row as ModelItem)"
                  :key="item.label"
                  class="model-card__highlight"
                >
                  <span>{{ item.label }}</span>
                  <div
                    v-if="item.tags?.length"
                    class="model-card__tags"
                    :title="item.value"
                  >
                    <span
                      v-for="tag in item.tags"
                      :key="tag"
                      class="res-badge"
                      >{{ tag }}</span
                    >
                  </div>
                  <strong v-else :title="item.value">{{ item.value }}</strong>
                </div>
              </div>

              <div class="model-card__sections">
                <section
                  v-for="section in modelCardSections(row as ModelItem)"
                  :key="section.title"
                  class="model-card__block"
                >
                  <dl>
                    <div
                      v-for="(item, itemIndex) in section.items"
                      :key="`${section.title}-${itemIndex}`"
                      class="model-card__spec"
                      :class="{ 'is-wide': item.wide }"
                    >
                      <dt v-if="item.label">{{ item.label }}</dt>
                      <dd v-if="item.parts?.length" :title="item.value">
                        <span class="model-card__aspects">
                          <span
                            v-for="part in item.parts"
                            :key="part.label"
                            class="model-card__aspect"
                          >
                            <span class="res-badge">{{ part.label }}</span>
                            <span>{{ part.text }}</span>
                          </span>
                        </span>
                      </dd>
                      <dd v-else :title="item.value">{{ item.value }}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <p class="model-card__desc" :title="row.description || undefined">
                {{ row.description || "暂无说明" }}
              </p>

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
                  <span>透明背景</span>
                  <el-switch v-model="row.transparentBackground" size="small" />
                </label>
                <label v-if="row.kind === 'image'" class="model-card__switch">
                  <span>快速模式</span>
                  <el-switch v-model="row.fastMode" size="small" />
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
            <p class="assignment-rail__hint">① 选择页面</p>
            <button
              v-for="workspace in workspaceMeta"
              :key="workspace.key"
              type="button"
              class="assignment-rail-item"
              :class="{ 'is-active': activeWorkspaceKey === workspace.key }"
              @click="activeWorkspaceKey = workspace.key"
            >
              <span class="assignment-rail-item__main">
                <strong>{{ workspace.name }}</strong>
                <small>{{ workspaceDefaultSummary(workspace) }}</small>
              </span>
              <em class="tnum">{{ workspaceAssignedCount(workspace) }}</em>
            </button>
          </aside>

          <div class="assignment-main">
            <header class="assignment-main__head">
              <div>
                <strong>{{ activeWorkspace.name }}</strong>
                <small
                  >用户在「{{ activeWorkspace.name }}」能看到的模型 ·
                  {{ activeWorkspace.detail }}</small
                >
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

            <div class="assignment-defaults" v-if="activeWorkspace.kinds.length">
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
                  placeholder="先从右侧加入模型"
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

            <div class="assignment-transfer">
              <section class="assignment-col is-on">
                <header class="assignment-col__head">
                  <div>
                    <strong>② 已加入此页面</strong>
                    <span class="tnum">{{ assignedWorkspaceModels.length }}</span>
                  </div>
                  <el-button
                    link
                    type="danger"
                    :disabled="!assignedWorkspaceModels.length"
                    @click="clearWorkspaceModels(activeWorkspace)"
                  >
                    清空
                  </el-button>
                </header>
                <ul v-if="assignedWorkspaceModels.length" class="assignment-list">
                  <li
                    v-for="model in assignedWorkspaceModels"
                    :key="model.id"
                    class="assignment-card"
                    :class="{
                      'is-default': isWorkspaceDefaultModel(
                        activeWorkspace,
                        model,
                      ),
                    }"
                  >
                    <div class="assignment-card__body">
                      <strong :title="model.name">{{ model.name }}</strong>
                      <small
                        >{{ kindName(model.kind) }} ·
                        {{ providerName(model.providerId) }}</small
                      >
                      <em class="assignment-card__price">
                        {{ workspacePriceLabel(activeWorkspace, model) }}
                      </em>
                    </div>
                    <div class="assignment-card__foot">
                      <button
                        v-if="
                          isWorkspaceDefaultModel(activeWorkspace, model)
                        "
                        type="button"
                        class="assignment-default-tag"
                        disabled
                      >
                        默认
                      </button>
                      <button
                        v-else
                        type="button"
                        class="assignment-default-btn"
                        @click="
                          setWorkspaceDefaultModel(activeWorkspace, model)
                        "
                      >
                        设为默认
                      </button>
                      <el-button
                        link
                        type="danger"
                        @click="removeWorkspaceModel(activeWorkspace, model.id)"
                      >
                        移除
                      </el-button>
                    </div>
                  </li>
                </ul>
                <el-empty
                  v-else
                  description="还没有模型，从右侧点「加入」"
                  :image-size="48"
                />
              </section>

              <section class="assignment-col is-pool">
                <header class="assignment-col__head">
                  <div>
                    <strong>③ 从目录加入</strong>
                    <span class="tnum">{{ poolWorkspaceModels.length }}</span>
                  </div>
                  <el-button
                    link
                    :disabled="!poolWorkspaceModels.length"
                    @click="addAllPoolModels(activeWorkspace)"
                  >
                    全部加入
                  </el-button>
                </header>
                <ul v-if="poolWorkspaceModels.length" class="assignment-list">
                  <li
                    v-for="model in poolWorkspaceModels"
                    :key="model.id"
                    class="assignment-card"
                  >
                    <div class="assignment-card__body">
                      <strong :title="model.name">{{ model.name }}</strong>
                      <small
                        >{{ kindName(model.kind) }} ·
                        {{ providerName(model.providerId) }}</small
                      >
                      <em class="tnum"
                        >{{ formatPoints(effectivePrice(model)) }} 积分</em
                      >
                    </div>
                    <div class="assignment-card__foot">
                      <el-button
                        link
                        @click="addWorkspaceModel(activeWorkspace, model.id)"
                      >
                        加入
                      </el-button>
                    </div>
                  </li>
                </ul>
                <el-empty
                  v-else
                  :description="
                    workspaceAvailableModels(activeWorkspace).length
                      ? '目录模型都已加入此页面'
                      : '模型目录暂无可用模型（需启用且对用户开放）'
                  "
                  :image-size="48"
                />
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
            <strong>PPT / PSD</strong>
            <small>{{ config.editableFiles.enabled ? "用户端已开放" : "用户端未开放" }}</small>
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
        @prev="providerPagination.prev"
        @next="providerPagination.next"
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
          label="名称 / Base URL"
          min-width="200"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <div
              class="provider-identity"
              :title="`${row.name || '—'} · ${row.baseUrl || '—'}`"
            >
              <strong>{{ row.name || "—" }}</strong>
              <span class="mono">{{ row.baseUrl || "—" }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="并发（主/总）"
          min-width="110"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <span class="cell-text tnum">
              {{ row.maxConcurrency }} /
              {{ providerCapacity(row as ModelProvider) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="线路数" min-width="80" align="left" header-align="left">
          <template #default="{ row }">
            <span class="cell-text tnum">{{ row.routes?.length || 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="可读取模型"
          min-width="100"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <el-button
              v-if="row.discoveredModels?.length"
              link
              type="primary"
              @click="openDiscoveredModelsDialog(row as ModelProvider)"
            >
              查看
            </el-button>
            <span v-else class="cell-text is-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column
          label="主超时秒"
          min-width="96"
          align="left"
          header-align="left"
        >
          <template #default="{ row }">
            <span class="cell-text tnum">{{ row.timeoutSecs }}</span>
          </template>
        </el-table-column>
        <el-table-column label="协议" min-width="120" align="left" header-align="left">
          <template #default="{ row }">
            <span class="cell-text">{{ adapterName(row.adapter) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" min-width="88" align="left" header-align="left">
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
            <el-button link type="primary" @click="openProvider($index)">编辑</el-button>
            <el-button link type="danger" @click="removeProvider($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </AdminListShell>
      </section>
    </PageCard>

    <AdminDialog
      v-model="workspacePricingDialogVisible"
      title="页面模型价格"
      subtitle="修改已分配到各业务页面的模型价格"
      :icon="Coin"
      width="min(1040px, calc(100% - 24px))"
      panel-class="workspace-pricing-dialog-panel"
      confirm-text="保存价格"
      :confirm-loading="saving"
      :close-on-click-modal="false"
      @confirm="saveWorkspacePricingDraft"
    >
      <div class="workspace-pricing-dialog">
        <aside class="workspace-pricing-pages" aria-label="业务页面">
          <button
            v-for="workspace in workspaceMeta"
            :key="workspace.key"
            type="button"
            :class="{ 'is-active': pricingWorkspaceKey === workspace.key }"
            @click="pricingWorkspaceKey = workspace.key"
          >
            <span>
              <strong>{{ workspace.name }}</strong>
              <small>已分配 {{ workspaceAssignedCount(workspace) }} 个模型</small>
            </span>
            <em
              v-if="pricingWorkspaceOverrideCount(workspace)"
              class="tnum"
            >
              {{ pricingWorkspaceOverrideCount(workspace) }}
            </em>
          </button>
        </aside>

        <section class="workspace-pricing-main">
          <header class="workspace-pricing-main__head">
            <span>
              <strong>{{ pricingWorkspace.name }}</strong>
              <small>{{ pricingWorkspace.detail }}</small>
            </span>
            <em class="tnum">{{ pricingWorkspaceModels.length }} 个模型</em>
          </header>

          <div v-if="pricingWorkspaceModels.length" class="workspace-pricing-list">
            <article
              v-for="model in pricingWorkspaceModels"
              :key="model.id"
              class="workspace-pricing-row"
            >
              <header>
                <span>
                  <strong>{{ model.name }}</strong>
                  <small>
                    {{ kindName(model.kind) }} · {{ providerName(model.providerId) }} ·
                    模型目录 {{ formatPoints(effectivePrice(model)) }}
                    {{ workspacePriceUnit(model) }}
                  </small>
                </span>
                <em>
                  当前 {{ formatPoints(pricingDraftEffectivePrice(model)) }}
                  {{ workspacePriceUnit(model) }}
                </em>
              </header>

              <div class="workspace-pricing-row__controls">
                <label class="workspace-pricing-toggle">
                  <span>
                    <strong>页面单独定价</strong>
                    <small>关闭后继承模型目录价格</small>
                  </span>
                  <el-switch
                    :model-value="Boolean(pricingDraftOverride(model))"
                    @change="setPricingDraftOverride(model, $event === true)"
                  />
                </label>

                <template v-if="pricingDraftOverride(model)">
                  <label class="workspace-pricing-field">
                    <span>标准价格</span>
                    <el-input-number
                      v-model="workspacePricingDraft[pricingWorkspace.key][model.id].priceCents"
                      :min="0"
                      :precision="0"
                      :step="1"
                    />
                    <em>{{ workspacePriceUnit(model) }}</em>
                  </label>
                  <label class="workspace-pricing-toggle is-compact">
                    <span>
                      <strong>活动价格</strong>
                      <small>开启后优先结算</small>
                    </span>
                    <el-switch
                      :model-value="pricingDraftOverride(model)?.discountPriceCents !== null"
                      @change="setPricingDraftDiscount(model, $event === true)"
                    />
                  </label>
                  <label
                    v-if="pricingDraftOverride(model)?.discountPriceCents !== null"
                    class="workspace-pricing-field"
                  >
                    <span>活动价格</span>
                    <el-input-number
                      v-model="workspacePricingDraft[pricingWorkspace.key][model.id].discountPriceCents"
                      :min="0"
                      :max="workspacePricingDraft[pricingWorkspace.key][model.id].priceCents"
                      :precision="0"
                      :step="1"
                    />
                    <em>{{ workspacePriceUnit(model) }}</em>
                  </label>
                </template>
              </div>
            </article>
          </div>

          <el-empty
            v-else
            description="该页面还没有分配模型"
            :image-size="64"
          >
            <el-button type="primary" @click="openWorkspaceAssignmentFromPricing">
              前往页面分配
            </el-button>
          </el-empty>
        </section>
      </div>
    </AdminDialog>

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
                <span>超时（秒）</span>
                <el-input-number
                  v-model="route.timeoutSecs"
                  :min="0"
                  :max="1800"
                  :step="30"
                />
              </label>
            </div>
            <div v-if="providerRouteChecks[route.id]" class="provider-route-check">
              <el-tag
                :type="providerRouteChecks[route.id] === '连接失败' ? 'danger' : 'success'"
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
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="modelDialogVisible"
      :title="modelEditIndex >= 0 ? '编辑模型' : '添加模型'"
      subtitle="按区块填写映射、计费与能力，确认后写入模型目录"
      :icon="Cpu"
      width="min(880px, calc(100% - 24px))"
      confirm-text="确认"
      @confirm="saveModelDraft"
    >
      <el-form label-position="top" class="dialog-form model-editor">
        <section class="model-section">
          <header class="model-section__head">
            <strong>模型类型</strong>
            <small>决定用户端入口与后续可配项</small>
          </header>
          <div class="model-kind-switch" role="radiogroup" aria-label="模型类型">
            <button
              v-for="item in kindFilters.filter((entry) => entry.id !== 'all')"
              :key="item.id"
              type="button"
              class="model-kind-card"
              :class="{ 'is-active': modelDraft.kind === item.id }"
              @click="selectModelKind(item.id as ModelKind)"
            >
              <strong>{{ item.label }}</strong>
              <small>{{ kindMeta[item.id as ModelKind].detail }}</small>
            </button>
          </div>
          <div v-if="modelDraft.kind === 'image_tool'" class="model-tool-picker">
            <span class="model-tool-picker__label">工具能力</span>
            <div class="model-tool-options" aria-label="工具能力">
              <div class="model-tool-option is-active">
                <strong>{{ modelDraft.operations.join(" · ") || "等待读取上游 schema" }}</strong>
                <small>能力、媒体类型和参数均由 CRUN 实时接口自动同步</small>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="modelDraft.kind === 'chat' && modelDraft.reasoningPricing && modelDraft.supportedReasoningEfforts.length"
          id="model-reasoning-pricing-section"
          class="model-section reasoning-pricing-section"
        >
          <header class="model-section__head reasoning-pricing-head">
            <span>
              <strong>推理强度计费</strong>
              <small>可按档开启或关闭；全部关闭后用户端按基础积分计费，且不再出现推理强度选项</small>
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
              <div class="reasoning-channel-price">
                <label>
                  <span>标准积分</span>
                  <el-input-number
                    v-model="modelDraft.reasoningPricing.efforts[effort].assistantPriceCents"
                    :disabled="!draftReasoningEffortOn(effort)"
                    :min="0"
                    :precision="0"
                    :step="1"
                  />
                </label>
                <label>
                  <span>折扣积分</span>
                  <div class="reasoning-discount-control">
                    <el-switch
                      :model-value="reasoningDiscountEnabled(effort, 'assistant')"
                      :disabled="!draftReasoningEffortOn(effort)"
                      @change="toggleReasoningDiscount(effort, 'assistant', $event)"
                    />
                    <el-input-number
                      v-model="modelDraft.reasoningPricing.efforts[effort].assistantDiscountPriceCents"
                      :disabled="
                        !draftReasoningEffortOn(effort) ||
                        !reasoningDiscountEnabled(effort, 'assistant')
                      "
                      :min="0"
                      :precision="0"
                      :step="1"
                    />
                  </div>
                </label>
              </div>
              <div class="reasoning-channel-price">
                <label>
                  <span>标准积分</span>
                  <el-input-number
                    v-model="modelDraft.reasoningPricing.efforts[effort].canvasAgentPriceCents"
                    :disabled="!draftReasoningEffortOn(effort)"
                    :min="0"
                    :precision="0"
                    :step="1"
                  />
                </label>
                <label>
                  <span>折扣积分</span>
                  <div class="reasoning-discount-control">
                    <el-switch
                      :model-value="reasoningDiscountEnabled(effort, 'canvas_agent')"
                      :disabled="!draftReasoningEffortOn(effort)"
                      @change="toggleReasoningDiscount(effort, 'canvas_agent', $event)"
                    />
                    <el-input-number
                      v-model="modelDraft.reasoningPricing.efforts[effort].canvasAgentDiscountPriceCents"
                      :disabled="
                        !draftReasoningEffortOn(effort) ||
                        !reasoningDiscountEnabled(effort, 'canvas_agent')
                      "
                      :min="0"
                      :precision="0"
                      :step="1"
                    />
                  </div>
                </label>
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
            <el-form-item label="零价与亏损策略" class="is-wide">
              <div class="discount-input">
                <el-switch v-model="modelDraft.allowZeroPrice" />
                <span>允许零积分</span>
                <el-switch v-model="modelDraft.allowLossLeader" />
                <span>允许价格低于成本</span>
              </div>
            </el-form-item>
          </div>
        </section>

        <section class="model-section">
          <header class="model-section__head">
            <strong>映射与展示</strong>
            <small>服务商上游模型与用户端显示文案</small>
          </header>
          <div class="model-field-grid">
            <el-form-item label="自定义名称">
              <el-input
                v-model="modelDraft.name"
                placeholder="用户端显示的模型名称"
              />
            </el-form-item>
            <el-form-item label="服务商">
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
            <el-form-item label="上游模型 ID" class="is-wide">
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
            <el-form-item label="模型说明" class="is-wide">
              <el-input
                v-model="modelDraft.description"
                placeholder="用户选择模型时看到的简短说明"
              />
            </el-form-item>
          </div>
        </section>

        <section
          v-if="
            modelDraft.kind !== 'chat' ||
            !modelDraft.reasoningPricing ||
            !modelDraft.supportedReasoningEfforts.length
          "
          class="model-section"
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
            <el-form-item label="零价与亏损策略" class="is-wide">
              <div class="discount-input">
                <el-switch v-model="modelDraft.allowZeroPrice" />
                <span>允许零积分</span>
                <el-switch v-model="modelDraft.allowLossLeader" />
                <span>允许价格低于成本</span>
              </div>
            </el-form-item>
            <el-form-item
              v-if="modelDraft.kind === 'image'"
              label="快速模型"
            >
              <el-switch v-model="modelDraft.fastMode" />
            </el-form-item>
            <el-form-item
              v-if="modelDraft.kind !== 'chat'"
              label="预计耗时"
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
            </el-form-item>
          </div>
        </section>

        <section class="model-section">
          <header class="model-section__head">
            <strong>发布状态</strong>
            <small>控制可见性与调度</small>
          </header>
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
                  <strong>透明背景</strong>
                  <span>允许生成透明底图片</span>
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
                    :max="16"
                    :step="1"
                    :precision="0"
                  />
                  <span>张</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </el-form>
    </AdminDialog>
  </div>
</template>

<style scoped>
.model-editor {
  display: grid;
  gap: 14px;
  padding: 2px 0 4px;
}

.model-section {
  display: grid;
  gap: 12px;
  padding: 14px;
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
}

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
}

.reasoning-price-table__head,
.reasoning-price-row {
  display: grid;
  grid-template-columns: 56px 84px repeat(2, minmax(250px, 1fr));
  min-width: 680px;
}

.reasoning-price-table__head {
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
  opacity: 0.58;
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
.reasoning-channel-price label > span {
  color: var(--ink-3);
  font-size: 10px;
}

.reasoning-channel-price {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.reasoning-channel-price label {
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

.model-kind-switch {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.model-kind-card {
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

.model-kind-card strong {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 700;
}

.model-kind-card small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.35;
}

.model-kind-card:hover {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  background: var(--surface);
}

.model-kind-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface));
  box-shadow: var(--shadow-sm);
}

.model-kind-card.is-active strong {
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

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}

.save-status__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent);
}

.save-status.is-dirty .save-status__dot {
  background: var(--warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent);
}

.save-status.is-saving .save-status__dot {
  background: var(--info);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 18%, transparent);
}

.config-toolbar {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.config-toolbar__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.config-toolbar__heading-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
}

.workspace-pricing-entry {
  min-width: 112px;
}

.config-toolbar__actions {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.config-toolbar__buttons {
  display: inline-flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.config-toolbar__buttons :deep(.el-button) {
  margin-left: 0 !important;
}

.config-toolbar__buttons :deep(.el-button + .el-button) {
  margin-left: 0 !important;
}

.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-2);
  box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
}

.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
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

html.dark .status-tab.is-active {
  background: var(--surface-3);
  color: var(--ink);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.28);
}

.config-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.editable-file-control {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(420px, auto);
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
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
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--accent-ink);
}

.editable-file-control__identity > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.editable-file-control__identity strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.editable-file-control__identity small {
  color: var(--ink-3);
  font-size: 11px;
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
  display: grid;
  gap: 10px;
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
  padding-right: 168px;
}

.model-card__identity {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  gap: 6px;
}

.model-card__line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  overflow: hidden;
  white-space: nowrap;
}

.model-card__line strong {
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
}

.model-card__line span {
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
}

.model-card__line span.mono {
  color: var(--ink-3);
}

.model-card__line > .kind-badge,
.model-card__line > .default-badge,
.model-card__line > .meta-badge {
  flex: 0 0 auto;
  align-self: center;
}

.model-card__line > .kind-badge + .default-badge,
.model-card__line > .kind-badge + .meta-badge,
.model-card__line > .default-badge + .meta-badge {
  margin-left: 4px;
}

.model-card__line > .kind-badge + strong,
.model-card__line > .default-badge + strong,
.model-card__line > .meta-badge + strong {
  margin-left: 8px;
}

.model-card__line > .kind-badge + *::before,
.model-card__line > .default-badge + *::before,
.model-card__line > .meta-badge + *::before {
  content: none;
}

.model-card__line > :not(.kind-badge):not(.default-badge):not(.meta-badge)
  + :not(.kind-badge):not(.default-badge):not(.meta-badge)::before {
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

.model-card__desc {
  margin: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.model-card__highlights {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
}

.model-card__highlights.is-reasoning {
  grid-template-columns: minmax(0, 1fr);
}

.model-card__highlights.is-reasoning .model-card__highlight {
  grid-template-columns: 104px minmax(0, 1fr);
  align-items: start;
}

.model-card__highlight {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.model-card__highlight > span {
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
}

.model-card__highlight strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.model-card__sections {
  display: grid;
  gap: 8px;
}

.model-card__block {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
}

.model-card__block > dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
}

.model-card__spec {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.model-card__spec.is-wide,
.model-card__block > dl .model-card__spec:nth-child(1):nth-last-child(1) {
  grid-column: 1 / -1;
}

.model-card__spec dt {
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
}

.model-card__spec dd {
  margin: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__aspects {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  white-space: normal;
}

.model-card__aspect {
  display: inline;
  color: var(--ink-2);
}

.model-card__aspect > .res-badge {
  margin-right: 6px;
  vertical-align: middle;
}

.res-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  padding: 2px 7px;
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
  padding-top: 4px;
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

.model-catalog-empty {
  display: grid;
  height: 100%;
  place-items: center;
}

.model-search {
  flex: 1 1 160px;
  width: auto;
  min-width: 120px;
  max-width: 240px;
}

.config-toolbar__actions .kind-filter,
.config-toolbar__actions .save-status {
  flex: 0 0 auto;
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
  box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
}

.kind-filter button {
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

.kind-filter button.active {
  color: var(--ink);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font-weight: 700;
}

.assignment-panel {
  --assign-accent: #3f6b2a;
  --assign-accent-soft: #e8f0e4;
  --assign-accent-ink: #2a4a1c;
  --assign-tint: #f3f6f2;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

html.dark .assignment-panel {
  --assign-accent: #7ea66a;
  --assign-accent-soft: rgb(126 166 106 / 0.16);
  --assign-accent-ink: #b7d0a8;
  --assign-tint: color-mix(in srgb, var(--assign-accent-soft) 55%, var(--surface));
}

.assignment-shell {
  display: grid;
  flex: 1;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 0;
}

.assignment-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: 14px 12px;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--assign-tint) 70%, var(--surface-2));
}

.assignment-rail__hint {
  margin: 0 8px 10px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.assignment-rail-item {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.assignment-rail-item:hover {
  background: color-mix(in srgb, var(--surface) 70%, transparent);
}

.assignment-rail-item.is-active {
  background: var(--surface);
  box-shadow: inset 2px 0 0 var(--assign-accent);
}

.assignment-rail-item.is-active .assignment-rail-item__main strong {
  color: var(--assign-accent-ink);
}

.assignment-rail-item__main {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.assignment-rail-item__main strong {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 650;
}

.assignment-rail-item__main small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignment-rail-item > em {
  display: inline-grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-3) 80%, transparent);
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 650;
}

.assignment-rail-item.is-active > em {
  background: var(--assign-accent-soft);
  color: var(--assign-accent-ink);
}

.assignment-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  padding: 16px 18px;
  background: var(--surface);
}

.assignment-main__head {
  display: grid;
  gap: 3px;
}

.assignment-main__head strong {
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
}

.assignment-main__head small {
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
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--assign-tint);
}

.assignment-default {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.assignment-default > span {
  color: var(--assign-accent-ink);
  font-size: 12px;
  font-weight: 600;
}

.assignment-default :deep(.el-select) {
  width: 100%;
}

.assignment-transfer {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
}

.assignment-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 12px 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.assignment-col.is-on {
  background: var(--assign-tint);
  border-color: color-mix(in srgb, var(--assign-accent) 22%, var(--border));
}

.assignment-col.is-pool {
  background: color-mix(in srgb, var(--surface-2) 70%, var(--surface));
}

.assignment-col__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
}

.assignment-col__head > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.assignment-col__head strong {
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}

.assignment-col__head span {
  display: inline-grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-3) 75%, var(--surface));
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 650;
}

.assignment-col.is-on .assignment-col__head span {
  background: var(--assign-accent-soft);
  color: var(--assign-accent-ink);
}

.assignment-list {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  align-content: start;
  gap: 8px;
  min-height: 0;
  margin: 0;
  padding: 2px 0 0;
  overflow: auto;
  list-style: none;
}

.assignment-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.assignment-card:hover {
  border-color: color-mix(in srgb, var(--assign-accent) 28%, var(--border));
  box-shadow: var(--shadow-md);
}

.assignment-card.is-default {
  border-color: color-mix(in srgb, var(--assign-accent) 42%, var(--border));
  background: color-mix(in srgb, var(--assign-accent-soft) 45%, var(--surface));
}

.assignment-card__body {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.assignment-card__body strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  word-break: break-word;
}

.assignment-card__body small,
.assignment-card__body em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  line-height: 1.35;
}

.assignment-card__body em {
  color: var(--ink-2);
  font-weight: 600;
}

.assignment-card__body .assignment-card__price {
  color: var(--assign-accent-ink);
}

.assignment-card__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: auto;
  padding-top: 2px;
}

.assignment-default-tag,
.assignment-default-btn {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}

.assignment-default-tag {
  color: var(--assign-accent-ink);
  background: var(--assign-accent-soft);
  cursor: default;
}

.assignment-default-btn {
  color: var(--ink-3);
  background: var(--surface-2);
}

.assignment-default-btn:hover {
  color: var(--assign-accent-ink);
  background: var(--assign-accent-soft);
}

.assignment-card__foot :deep(.el-button.is-link) {
  color: var(--ink-2);
  font-weight: 600;
}

.assignment-card__foot > :last-child {
  margin-left: auto;
}

.assignment-card__foot :deep(.el-button.is-link:hover) {
  color: var(--assign-accent-ink);
}

.assignment-card__foot :deep(.el-button.is-link--danger),
.assignment-card__foot :deep(.el-button--danger.is-link) {
  color: var(--danger);
}

.assignment-card__foot :deep(.el-button.is-link--danger:hover),
.assignment-card__foot :deep(.el-button--danger.is-link:hover) {
  color: color-mix(in srgb, var(--danger) 85%, var(--ink));
}

.assignment-col .el-empty {
  flex: 1;
}

.workspace-pricing-dialog {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: min(560px, calc(100dvh - 230px));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.workspace-pricing-pages {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding: 10px;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
}

.workspace-pricing-pages button {
  display: flex;
  width: 100%;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
}

.workspace-pricing-pages button:hover {
  background: var(--surface);
}

.workspace-pricing-pages button.is-active {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}

.workspace-pricing-pages button > span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.workspace-pricing-pages strong {
  font-size: 13px;
  font-weight: 700;
}

.workspace-pricing-pages small {
  color: var(--ink-3);
  font-size: 11px;
}

.workspace-pricing-pages em {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.workspace-pricing-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.workspace-pricing-main__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.workspace-pricing-main__head > span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.workspace-pricing-main__head strong {
  color: var(--ink);
  font-size: 14px;
}

.workspace-pricing-main__head small,
.workspace-pricing-main__head > em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
}

.workspace-pricing-list {
  min-height: 0;
  overflow-y: auto;
}

.workspace-pricing-row {
  display: grid;
  gap: 14px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.workspace-pricing-row > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.workspace-pricing-row > header > span {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.workspace-pricing-row > header strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-pricing-row > header small {
  color: var(--ink-3);
  font-size: 11px;
}

.workspace-pricing-row > header > em {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--accent-ink);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.workspace-pricing-row__controls {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(240px, 1.15fr);
  align-items: center;
  gap: 12px 18px;
}

.workspace-pricing-toggle {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.workspace-pricing-toggle > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.workspace-pricing-toggle strong,
.workspace-pricing-field > span {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.workspace-pricing-toggle small {
  color: var(--ink-3);
  font-size: 11px;
}

.workspace-pricing-field {
  display: grid;
  grid-template-columns: 64px minmax(110px, 1fr) 52px;
  align-items: center;
  gap: 8px;
}

.workspace-pricing-field :deep(.el-input-number) {
  width: 100%;
}

.workspace-pricing-field > em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
}

@media (max-width: 760px) {
  .workspace-pricing-dialog {
    grid-template-columns: minmax(0, 1fr);
    min-height: min(640px, calc(100dvh - 190px));
  }

  .workspace-pricing-pages {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .workspace-pricing-pages button {
    min-width: 152px;
  }

  .workspace-pricing-row > header,
  .workspace-pricing-row__controls {
    grid-template-columns: minmax(0, 1fr);
  }

  .workspace-pricing-row > header {
    align-items: stretch;
    flex-direction: column;
  }

  .workspace-pricing-row > header > em {
    align-self: flex-start;
  }
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
  gap: 8px;
}

.provider-identity strong {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-identity span {
  flex: 1 1 12ch;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  .config-toolbar__heading {
    flex-wrap: wrap;
  }

  .config-toolbar__heading-actions {
    width: 100%;
    justify-content: space-between;
  }

  .config-toolbar__actions {
    justify-content: flex-start;
  }
}


</style>
