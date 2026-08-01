<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Refresh } from "@element-plus/icons-vue";
import { request } from "@/request";
import { useClientPagination } from "@/useClientPagination";
import { formatPoints, normalizePoints } from "@/utils";

type ProviderAdapter = "openai" | "crun";
type ModelKind = "image" | "chat";
type WorkspaceKey =
  "assistant" | "t2i" | "coloring" | "ui_design" | "model_sheet" | "game_art";

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
}

interface ModelItem {
  id: string;
  name: string;
  providerId: string;
  upstreamModel: string;
  executionPoolId: string;
  kind: ModelKind;
  description: string;
  priceCents: number;
  discountPriceCents: number | null;
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
  public: boolean;
  default: boolean;
  enabled: boolean;
}

interface ModelConfig {
  version: number;
  providers: ModelProvider[];
  models: ModelItem[];
  workspaces: Record<WorkspaceKey, WorkspaceBinding>;
}

interface WorkspaceBinding {
  modelIds: string[];
  defaultModelIds: Partial<Record<ModelKind, string>>;
}

interface ModelDiscoveryResult {
  models: string[];
  modelCount: number;
  compatibleCount?: number;
  taskModelCount?: number;
  catalogSource?: string;
  warning?: string;
}

interface ModelDraft extends Omit<
  ModelItem,
  "priceCents" | "discountPriceCents"
> {
  pricePoints: number;
  discountEnabled: boolean;
  discountPoints: number;
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
};
const kindFilters: Array<{ id: "all" | ModelKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "image", label: "生图模型" },
  { id: "chat", label: "对话模型" },
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
    detail: "设计稿生成与局部素材重建",
    kinds: ["image"],
  },
  {
    key: "model_sheet",
    name: "超高清模型图",
    detail: "角色多视图与高清参考图",
    kinds: ["image"],
  },
  {
    key: "game_art",
    name: "游戏设计",
    detail: "角色、道具和场景资产",
    kinds: ["image"],
  },
];

const loading = ref(false);
const saving = ref(false);
const activeView = ref<"models" | "workspaces" | "providers">("models");
const activeWorkspaceKey = ref<WorkspaceKey>("assistant");
const kindFilter = ref<"all" | ModelKind>("all");
const modelSearch = ref("");
const savedSignature = ref("");
const autoSaveReady = ref(false);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueued = false;
const config = reactive<ModelConfig>({
  version: 3,
  providers: [],
  models: [],
  workspaces: {} as Record<WorkspaceKey, WorkspaceBinding>,
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

const modelPagination = useClientPagination(() => filteredModels.value, 10);
const providerPagination = useClientPagination(() => config.providers, 10);

watch([kindFilter, modelSearch], modelPagination.reset);

function hydrate(value: ModelConfig) {
  config.version = value.version || 3;
  config.providers = (value.providers || []).map((provider) => ({
    ...provider,
    adapter: provider.adapter || "openai",
    maxConcurrency: provider.maxConcurrency || 100,
    discoveredModels: provider.discoveredModels || [],
  }));
  config.models = (value.models || []).map((model) => ({
    ...model,
    executionPoolId: model.executionPoolId || model.id,
    kind: model.kind || "image",
    description: model.description || "",
    resolutions: (model.resolutions || []).filter(
      (resolution) => String(resolution).toUpperCase() !== "AUTO",
    ),
    aspectRatios:
      model.kind === "chat"
        ? []
        : model.aspectRatios || [...IMAGE_ASPECT_RATIOS],
    aspectRatiosByResolution:
      model.kind === "chat"
        ? {}
        : normalizeAspectRatiosByResolution(
            model.resolutions || [],
            model.aspectRatiosByResolution || {},
            model.aspectRatios || IMAGE_ASPECT_RATIOS,
            model.autoAspectRatios || {},
          ),
    qualities:
      model.kind === "chat"
        ? []
        : model.qualities || IMAGE_QUALITIES.map((item) => item.value),
    transparentBackground:
      model.kind !== "chat" && model.transparentBackground !== false,
    outputFormats: model.kind === "chat" ? [] : model.outputFormats || [],
    moderationLevels: model.kind === "chat" ? [] : model.moderationLevels || [],
    maxReferenceImages:
      model.kind === "chat" ? 0 : Number(model.maxReferenceImages ?? 4),
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
      return [workspace.key, { modelIds, defaultModelIds }];
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
  if (saving.value) {
    saveQueued = true;
    return;
  }
  sanitizeWorkspaceBindings();
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
    if (signature() === submittedSignature) hydrate(saved);
    else {
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

function executionPoolSummary(value: unknown) {
	const model = value as ModelItem;
	const poolId = model.executionPoolId || model.id;
	const members = config.models.filter(
		(item) => (item.executionPoolId || item.id) === poolId,
	);
	const primary = members.find((item) => item.public) || members[0] || model;
	return `${primary.name} · ${members.length} 条`;
}

function providerModels(id: string) {
  return config.models.filter((item) => item.providerId === id);
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

function selectAllWorkspaceModels(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  binding.modelIds = workspaceAvailableModels(workspace).map((model) => model.id);
  ensureWorkspaceDefaults(workspace);
}

function clearWorkspaceModels(workspace: (typeof workspaceMeta)[number]) {
  const binding = config.workspaces[workspace.key];
  if (!binding) return;
  binding.modelIds = [];
  binding.defaultModelIds = {};
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
    };
    const allowed = new Set(
      workspaceAvailableModels(workspace).map((model) => model.id),
    );
    binding.modelIds = [...new Set(binding.modelIds || [])].filter((id) =>
      allowed.has(id),
    );
    binding.defaultModelIds = { ...(binding.defaultModelIds || {}) };
    config.workspaces[workspace.key] = binding;
    ensureWorkspaceDefaults(workspace);
  }
}

function pruneWorkspaceModel(modelId: string) {
  for (const workspace of workspaceMeta) {
    const binding = config.workspaces[workspace.key];
    if (!binding) continue;
    binding.modelIds = binding.modelIds.filter((id) => id !== modelId);
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

function kindName(value: unknown) {
  return kindMeta[String(value) as ModelKind]?.name || "未知类型";
}

function modelWorkspaceNames(modelId: string) {
  return workspaceMeta
    .filter((workspace) =>
      config.workspaces[workspace.key]?.modelIds.includes(modelId),
    )
    .map((workspace) => workspace.name);
}

function modelAspectRatioSummary(value: unknown) {
  const model = value as ModelItem;
  const ratios = model.aspectRatios || [];
  if (!ratios.length) return "模型内置";
  const labels = ratios.map((ratio) => (ratio === "auto" ? "Auto" : ratio));
  return labels.length > 4
    ? `${labels.slice(0, 4).join(" · ")} · +${labels.length - 4}`
    : labels.join(" · ");
}

function modelAspectRatioDetail(value: unknown) {
  const model = value as ModelItem;
  const perResolution = model.resolutions
    .map((resolution) => {
      const ratios = model.aspectRatiosByResolution?.[resolution] || [];
      if (!ratios.length) return "";
      const labels = ratios.map((ratio) => (ratio === "auto" ? "Auto" : ratio));
      return `${resolution}: ${labels.join(" / ")}`;
    })
    .filter(Boolean);
  if (perResolution.length) return perResolution.join(" ｜ ");
  return (model.aspectRatios || [])
    .map((ratio) => (ratio === "auto" ? "Auto" : ratio))
    .join(" · ");
}

function qualityLabel(value: string) {
  return IMAGE_QUALITIES.find((item) => item.value === value)?.label || value;
}

function outputFormatSummary(value: unknown) {
  const model = value as ModelItem;
  return model.outputFormats.length
    ? model.outputFormats.map((item) => item.toUpperCase()).join(" / ")
    : "内置格式";
}

function moderationSummary(value: unknown) {
  const model = value as ModelItem;
  return model.moderationLevels.length
    ? model.moderationLevels
        .map((item) => (item === "auto" ? "Auto" : item))
        .join(" / ")
    : "内置";
}

function adapterName(value: unknown) {
  return adapterMeta[String(value) as ProviderAdapter]?.name || "未知协议";
}

const providerDialogVisible = ref(false);
const providerEditIndex = ref(-1);
const discoveringProviderModels = ref(false);
const providerCatalogSummary = ref("");
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
});

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
        },
  );
  providerEditIndex.value = index;
  providerCatalogSummary.value = "";
  providerDialogVisible.value = true;
}

function invalidateProviderModels() {
  providerDraft.discoveredModels = [];
  providerCatalogSummary.value = "";
}

async function fetchProviderModels(provider: ModelProvider) {
  return request<ModelDiscoveryResult>(
    "/api/v1/admin/model-config/discoveries",
    { method: "POST", body: provider },
  );
}

function discoverySummary(result: ModelDiscoveryResult) {
  if (result.catalogSource === "crun_full") {
    return `全量 ${result.modelCount} 个：兼容模型 ${result.compatibleCount || 0} 个，CreateTask 任务模型 ${result.taskModelCount || 0} 个（已去重）`;
  }
  return `已读取 ${result.modelCount || result.models?.length || 0} 个模型`;
}

async function discoverProviderModels() {
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
  discoveringProviderModels.value = true;
  try {
    const result = await fetchProviderModels(providerDraft);
    providerDraft.discoveredModels = result.models || [];
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

async function saveProviderDraft() {
  providerDraft.name = providerDraft.name.trim();
  providerDraft.baseUrl = providerDraft.baseUrl.trim().replace(/\/$/, "");
  if (!providerDraft.name || !/^https?:\/\//.test(providerDraft.baseUrl)) {
    ElMessage.warning("请填写服务商名称和完整 Base URL");
    return;
  }
  if (!providerDraft.apiKey.trim()) {
    ElMessage.warning("请填写 API Key");
    return;
  }
  const value = copyProvider(providerDraft);
  if (providerEditIndex.value >= 0)
    config.providers[providerEditIndex.value] = value;
  else config.providers.push(value);
  providerDialogVisible.value = false;
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
const modelEditorTab = ref("basic");
const discoveringModelOptions = ref(false);
const modelDraft = reactive<ModelDraft>({
  id: "",
  name: "",
  providerId: "",
  upstreamModel: "",
  executionPoolId: "",
  kind: "image",
  description: "",
  pricePoints: 20,
  discountEnabled: false,
  discountPoints: 20,
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
  public: true,
  default: false,
  enabled: true,
});

function openModel(index = -1) {
  const source = index >= 0 ? config.models[index] : null;
	const newModelId = createId("model");
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
          executionPoolId: source.executionPoolId || source.id,
          kind: source.kind,
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
          public: source.public,
          default: source.default,
          enabled: source.enabled,
          pricePoints: normalizePoints(source.priceCents),
          discountEnabled: source.discountPriceCents !== null,
          discountPoints: normalizePoints(source.discountPriceCents),
        }
      : {
		  id: newModelId,
          name: "",
          providerId: defaultProvider,
          upstreamModel: "",
		  executionPoolId: newModelId,
          kind: kindFilter.value === "chat" ? "chat" : "image",
          description: "",
          pricePoints: 20,
          discountEnabled: false,
          discountPoints: 20,
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
          public: true,
          default: false,
          enabled: true,
        },
  );
  modelEditIndex.value = index;
  modelEditorTab.value = "basic";
  modelDialogVisible.value = true;
}

const modelProviderOptions = computed(
  () =>
    config.providers.find((item) => item.id === modelDraft.providerId)
      ?.discoveredModels || [],
);

const executionPoolOptions = computed(() => {
	const pools = new Map<string, { id: string; name: string; count: number }>();
	for (const model of config.models) {
		if (model.kind !== modelDraft.kind || model.id === modelDraft.id) continue;
		const id = model.executionPoolId || model.id;
		const current = pools.get(id);
		if (current) current.count += 1;
		else pools.set(id, { id, name: model.name, count: 1 });
	}
	const currentId = modelDraft.executionPoolId || modelDraft.id;
	if (currentId && !pools.has(currentId)) {
		pools.set(currentId, {
			id: currentId,
			name: modelDraft.name.trim() || "独立资源池",
			count: 1,
		});
	}
	return [...pools.values()];
});

function onModelProviderChange() {
  modelDraft.upstreamModel = "";
}

function onModelKindChange(value: unknown) {
  const kind = String(value) as ModelKind;
	modelDraft.executionPoolId = modelDraft.id;
  if (kind === "chat") {
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
  }
}

function onUpstreamModelChange(value: string) {
  if (!modelDraft.name.trim()) modelDraft.name = value;
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
    modelDraft.outputFormats = [...IMAGE_OUTPUT_FORMATS];
  }
}

function onModerationEnabled(value: unknown) {
  if (value === true && !modelDraft.moderationLevels.length) {
    modelDraft.moderationLevels = [...IMAGE_MODERATION_LEVELS];
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
    providerCatalogSummary.value = discoverySummary(result);
    if (result.warning) ElMessage.warning(result.warning);
    else ElMessage.success(providerCatalogSummary.value);
  } finally {
    discoveringModelOptions.value = false;
  }
}

function saveModelDraft() {
  if (
    !modelDraft.name.trim() ||
    !modelDraft.upstreamModel.trim() ||
    !modelDraft.providerId
  ) {
    ElMessage.warning("请填写模型名称、上游模型 ID 和服务商");
    return;
  }
  if (modelDraft.kind === "image" && !modelDraft.resolutions.length) {
    ElMessage.warning("图片模型至少选择一个支持分辨率");
    return;
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.resolutions.some(
      (resolution) => !modelDraft.aspectRatiosByResolution[resolution]?.length,
    )
  ) {
    ElMessage.warning("每个分辨率至少选择一个用户可用比例");
    modelEditorTab.value = "capabilities";
    return;
  }
  if (
    modelDraft.kind === "image" &&
    modelDraft.resolutions.some((resolution) => {
      const ratios = modelDraft.aspectRatiosByResolution[resolution] || [];
      return ratios.includes("auto") && !ratios.some((ratio) => ratio !== "auto");
    })
  ) {
    ElMessage.warning("选择 Auto 的分辨率还需要至少一个固定比例");
    modelEditorTab.value = "capabilities";
    return;
  }
  if (modelDraft.kind === "image" && !modelDraft.qualities.length) {
    ElMessage.warning("图片模型至少选择一个输出质量");
    return;
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
  const value: ModelItem = {
    id: modelDraft.id,
    name: modelDraft.name.trim(),
    providerId: modelDraft.providerId,
    upstreamModel: modelDraft.upstreamModel.trim(),
    executionPoolId: modelDraft.executionPoolId.trim() || modelDraft.id,
    kind: modelDraft.kind,
    description: modelDraft.description.trim(),
    priceCents: normalizePoints(modelDraft.pricePoints),
    discountPriceCents: modelDraft.discountEnabled
      ? normalizePoints(modelDraft.discountPoints)
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
      ? aspectRatioUnion(modelDraft.aspectRatiosByResolution)
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
    public: modelDraft.public,
    default: modelDraft.default,
    enabled: modelDraft.enabled,
  };
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
    <nav class="model-config-tabs" aria-label="模型配置视图">
      <button
        :class="{ 'is-active': activeView === 'models' }"
        @click="activeView = 'models'"
      >
        模型目录
      </button>
      <button
        :class="{ 'is-active': activeView === 'workspaces' }"
        @click="activeView = 'workspaces'"
      >
        页面分配
      </button>
      <button
        :class="{ 'is-active': activeView === 'providers' }"
        @click="activeView = 'providers'"
      >
        服务商
      </button>
    </nav>

    <section v-if="activeView === 'models'" class="config-surface">
      <header>
        <div>
          <strong>用户模型目录</strong
          ><span>图片工作台和 AI 助手只显示这里开放的模型</span>
        </div>
        <div class="catalog-tools">
          <div class="kind-filter">
            <button
              v-for="item in kindFilters"
              :key="item.id"
              :class="{ active: kindFilter === item.id }"
              @click="kindFilter = item.id"
            >
              {{ item.label }}
            </button>
          </div>
          <el-input
            v-model="modelSearch"
            clearable
            placeholder="搜索模型"
            class="model-search"
          />
          <el-button
            type="primary"
            :icon="Plus"
            :disabled="!config.providers.length"
            @click="openModel()"
            >添加模型</el-button
          >
        </div>
      </header>
      <AdminListShell
        :has-prev="modelPagination.hasPrev.value"
        :has-next="modelPagination.hasNext.value"
        :loading="loading"
        :page="modelPagination.page.value"
        :count="modelPagination.items.value.length"
        :total="modelPagination.total.value"
        viewport-height="clamp(360px, calc(100vh - 245px), 680px)"
        @prev="modelPagination.prev"
        @next="modelPagination.next"
      >
      <el-table :data="modelPagination.items.value" height="100%" row-key="id" class="config-table catalog-table">
        <template #empty>
          <el-empty
            description="先连接服务商，再添加要开放给用户的模型"
            :image-size="64"
          />
        </template>
        <el-table-column label="模型" min-width="230">
          <template #default="{ row }"
            ><div class="primary-cell">
              <strong>{{ row.name }}</strong
              ><small class="mono">{{ row.upstreamModel }}</small
              ><small v-if="row.description" class="model-description">{{
                row.description
              }}</small>
            </div></template
          >
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }"
            ><span class="kind-badge" :class="`is-${row.kind}`">{{
              kindName(row.kind)
            }}</span></template
          >
        </el-table-column>
        <el-table-column label="服务商" min-width="125">
          <template #default="{ row }"
            ><div class="provider-cell">
              <b>{{ providerName(row.providerId) }}</b
              ><small>{{
                config.providers.find((item) => item.id === row.providerId)
                  ?.adapter === "crun"
                  ? "CRUN"
                  : "OpenAI"
              }}</small>
            </div></template
          >
        </el-table-column>
		<el-table-column label="调度资源池" min-width="150">
		  <template #default="{ row }">
			<span>{{ executionPoolSummary(row) }}</span>
		  </template>
		</el-table-column>
        <el-table-column label="积分价格" width="135">
          <template #default="{ row }"
            ><div class="price-cell">
              <strong>{{ formatPoints(effectivePrice(row)) }} 积分</strong
              ><del v-if="row.discountPriceCents !== null"
                >{{ formatPoints(row.priceCents) }} 积分</del
              >
            </div></template
          >
        </el-table-column>
        <el-table-column label="规格" min-width="240">
          <template #default="{ row }">
            <div v-if="row.kind === 'image'" class="catalog-capability">
              <div class="resolution-list">
                <i v-for="item in row.resolutions" :key="item">{{ item }}</i>
                <i v-if="row.fastMode" class="is-fast">快速</i>
              </div>
              <el-tooltip
                v-if="row.aspectRatios.length"
                :content="modelAspectRatioDetail(row)"
                placement="top"
              >
                <span class="capability-line"
                  ><b>比例</b>{{ modelAspectRatioSummary(row) }}</span
                >
              </el-tooltip>
              <span class="capability-line"
                ><b>耗时</b>{{ row.minSeconds }}–{{ row.maxSeconds }} 秒</span
              >
            </div>
            <div v-else class="catalog-capability">
              <span class="chat-capability">对话 · 图片理解 · 意图识别</span>
              <span class="capability-line"
                ><b>耗时</b>{{ row.minSeconds }}–{{ row.maxSeconds }} 秒</span
              >
            </div>
          </template>
        </el-table-column>
        <el-table-column label="输出" min-width="220">
          <template #default="{ row }">
            <div v-if="row.kind === 'image'" class="catalog-output">
              <div class="output-tags">
                <i v-for="quality in row.qualities" :key="quality">{{
                  qualityLabel(quality)
                }}</i>
                <i v-if="!row.qualities.length">模型内置质量</i>
              </div>
              <span>
                {{ outputFormatSummary(row) }}
                · {{ row.transparentBackground ? "透明背景" : "普通背景" }}
              </span>
              <span
                >参考图 {{ row.maxReferenceImages }} 张 · 审核
                {{ moderationSummary(row) }}</span
              >
            </div>
            <span v-else class="chat-capability">文本与多模态输入</span>
          </template>
        </el-table-column>
        <el-table-column label="页面分配" min-width="185">
          <template #default="{ row }">
            <div v-if="modelWorkspaceNames(row.id).length" class="workspace-tags">
              <i v-for="name in modelWorkspaceNames(row.id)" :key="name">{{ name }}</i>
            </div>
            <span v-else class="unassigned-label">尚未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="用户可选" width="90" align="center"
          ><template #default="{ row }"
            ><el-switch
              v-model="row.public"
              @change="onCatalogModelStateChange(row)" /></template
        ></el-table-column>
        <el-table-column label="默认" width="75" align="center"
          ><template #default="{ row }"
            ><span v-if="row.default" class="default-badge">默认</span
            ><span v-else>—</span></template
          ></el-table-column
        >
        <el-table-column label="启用" width="75" align="center"
          ><template #default="{ row }"
            ><el-switch
              v-model="row.enabled"
              @change="onCatalogModelStateChange(row)" /></template
        ></el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }"
            ><el-button
              link
              type="primary"
              @click="openModel(modelOriginalIndex(row))"
              >编辑</el-button
            ><el-button
              link
              type="danger"
              @click="removeModel(modelOriginalIndex(row))"
              >删除</el-button
            ></template
          >
        </el-table-column>
      </el-table>
      </AdminListShell>
    </section>

    <section
      v-else-if="activeView === 'workspaces'"
      class="config-surface assignment-surface"
    >
      <header>
        <div>
          <strong>页面模型分配</strong
          ><span
            >每个页面只会展示并执行这里分配的模型；用户端仅显示自定义名称</span
          >
        </div>
      </header>
      <div class="assignment-layout">
        <nav class="workspace-rail" aria-label="可配置页面">
          <button
            v-for="(workspace, index) in workspaceMeta"
            :key="workspace.key"
            :class="{ 'is-active': activeWorkspaceKey === workspace.key }"
            @click="activeWorkspaceKey = workspace.key"
          >
            <span class="workspace-index">{{ index + 1 }}</span>
            <span class="workspace-nav-copy">
              <strong>{{ workspace.name }}</strong>
              <small>{{ workspace.detail }}</small>
            </span>
            <b>{{ config.workspaces[workspace.key]?.modelIds.length || 0 }}</b>
          </button>
        </nav>

        <article class="workspace-detail">
          <header>
            <div class="workspace-title">
              <span class="workspace-index">{{
                workspaceMeta.indexOf(activeWorkspace) + 1
              }}</span>
              <div>
                <strong>{{ activeWorkspace.name }}</strong>
                <small>{{ activeWorkspace.detail }}</small>
              </div>
            </div>
            <div class="workspace-summary">
              <span
                >已选择
                <b>{{
                  config.workspaces[activeWorkspace.key]?.modelIds.length || 0
                }}</b>
                / {{ workspaceAvailableModels(activeWorkspace).length }}</span
              >
              <button
                type="button"
                @click="selectAllWorkspaceModels(activeWorkspace)"
              >
                全选
              </button>
              <button
                type="button"
                :disabled="!config.workspaces[activeWorkspace.key]?.modelIds.length"
                @click="clearWorkspaceModels(activeWorkspace)"
              >
                清空
              </button>
            </div>
          </header>

          <section class="workspace-model-section">
            <div class="workspace-section-heading">
              <div>
                <strong>可用模型</strong>
                <span>用户只能在此页面看到已选择的模型</span>
              </div>
            </div>
            <el-checkbox-group
              v-if="workspaceAvailableModels(activeWorkspace).length"
              v-model="config.workspaces[activeWorkspace.key].modelIds"
              class="assignment-models"
              @change="ensureWorkspaceDefaults(activeWorkspace)"
            >
              <el-checkbox
                v-for="model in workspaceAvailableModels(activeWorkspace)"
                :key="model.id"
                :value="model.id"
                class="assignment-model"
              >
                <span>
                  <span class="assignment-model__title">
                    <strong>{{ model.name }}</strong>
                    <i>{{ kindName(model.kind) }}</i>
                  </span>
                  <small v-if="model.kind === 'image'">
                    {{ model.resolutions.join(" · ") || "未配置分辨率" }}
                    <em v-if="model.fastMode">快速</em>
                  </small>
                  <small v-else>对话 · 图片理解</small>
                </span>
              </el-checkbox>
            </el-checkbox-group>
            <el-empty
              v-else
              description="模型目录中暂无可用模型"
              :image-size="42"
            />
          </section>

          <footer class="workspace-defaults">
            <div class="workspace-section-heading">
              <div>
                <strong>默认模型</strong>
                <span>进入页面时优先使用，必须先在上方选中</span>
              </div>
            </div>
            <div class="workspace-default-grid">
              <label v-for="kind in activeWorkspace.kinds" :key="kind">
                <span>{{ kind === "chat" ? "对话模型" : "生图模型" }}</span>
                <el-select
                  v-model="config.workspaces[activeWorkspace.key].defaultModelIds[kind]"
                  :disabled="!workspaceDefaultOptions(activeWorkspace, kind).length"
                  placeholder="暂未分配"
                >
                  <el-option
                    v-for="model in workspaceDefaultOptions(activeWorkspace, kind)"
                    :key="model.id"
                    :label="model.name"
                    :value="model.id"
                  />
                </el-select>
              </label>
            </div>
          </footer>
        </article>
      </div>
    </section>

    <section v-else class="config-surface">
      <header>
        <div>
          <strong>图片与对话服务商</strong
          ><span>服务商只负责连接；具体用途由其模型类型决定</span>
        </div>
        <el-button type="primary" :icon="Plus" @click="openProvider()"
          >添加服务商</el-button
        >
      </header>
      <AdminListShell
        :has-prev="providerPagination.hasPrev.value"
        :has-next="providerPagination.hasNext.value"
        :loading="loading"
        :page="providerPagination.page.value"
        :count="providerPagination.items.value.length"
        :total="providerPagination.total.value"
        viewport-height="clamp(360px, calc(100vh - 245px), 680px)"
        @prev="providerPagination.prev"
        @next="providerPagination.next"
      >
      <el-table :data="providerPagination.items.value" height="100%" row-key="id" class="config-table">
        <template #empty>
          <el-empty description="暂无服务商" :image-size="64" />
        </template>
        <el-table-column label="服务商" min-width="180"
          ><template #default="{ row }"
            ><div class="primary-cell">
              <strong>{{ row.name }}</strong
              ><small>{{ adapterName(row.adapter) }}</small>
            </div></template
          ></el-table-column
        >
        <el-table-column label="Base URL" min-width="250"
          ><template #default="{ row }"
            ><span class="mono endpoint">{{ row.baseUrl }}</span></template
          ></el-table-column
        >
        <el-table-column label="已配置模型" min-width="230">
          <template #default="{ row }"
            ><div class="provider-models">
              <span
                v-for="model in providerModels(row.id).slice(0, 3)"
                :key="model.id"
                >{{ model.name }}</span
              ><small v-if="providerModels(row.id).length > 3"
                >+{{ providerModels(row.id).length - 3 }}</small
              ><em v-if="!providerModels(row.id).length">尚未配置</em>
            </div></template
          >
        </el-table-column>
        <el-table-column label="可读取模型" width="105" align="center"
          ><template #default="{ row }"
            ><strong class="model-count">{{
              row.discoveredModels?.length || 0
            }}</strong></template
          ></el-table-column
        >
        <el-table-column label="并发容量" width="105" align="center"
          ><template #default="{ row }"
            ><strong>{{ row.maxConcurrency || 100 }}</strong></template
        ></el-table-column>
        <el-table-column label="状态" width="80" align="center"
          ><template #default="{ row }"
            ><el-switch v-model="row.enabled" /></template
        ></el-table-column>
        <el-table-column label="操作" width="130" fixed="right"
          ><template #default="{ $index }"
            ><el-button link type="primary" @click="openProvider($index)"
              >编辑</el-button
            ><el-button link type="danger" @click="removeProvider($index)"
              >删除</el-button
            ></template
          ></el-table-column
        >
      </el-table>
      </AdminListShell>
      <el-empty
        v-if="!config.providers.length"
        description="添加服务商并读取其模型目录"
        :image-size="64"
      />
    </section>

    <el-dialog
      v-model="providerDialogVisible"
      :title="providerEditIndex >= 0 ? '编辑服务商' : '添加服务商'"
      width="min(680px, calc(100% - 20px))"
      top="4vh"
      destroy-on-close
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
          <el-form-item label="Base URL" class="is-wide"
            ><el-input
              v-model="providerDraft.baseUrl"
              :placeholder="
                providerDraft.adapter === 'crun'
                  ? 'https://api.crun.ai'
                  : 'https://gpt.xkyh.cc.cd/v1'
              "
              @input="invalidateProviderModels"
          /></el-form-item>
          <el-form-item label="API Key" class="is-wide"
            ><el-input
              v-model="providerDraft.apiKey"
              type="password"
              show-password
              :placeholder="
                providerDraft.apiKey.startsWith('****')
                  ? providerDraft.apiKey
                  : 'API Key'
              "
              @input="invalidateProviderModels"
          /></el-form-item>
          <el-form-item label="请求超时（秒）"
            ><el-input-number
              v-model="providerDraft.timeoutSecs"
              :min="0"
              :max="1800"
              :step="30"
              style="width: 100%"
          /></el-form-item>
          <el-form-item label="并发容量"
            ><el-input-number
              v-model="providerDraft.maxConcurrency"
              :min="1"
              :max="10000"
              :step="10"
              style="width: 100%"
          /></el-form-item>
          <el-form-item label="启用服务商"
            ><el-switch v-model="providerDraft.enabled"
          /></el-form-item>
        </div>
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
                ? "读取兼容模型，并合并 CRUN 全部 CreateTask 图片、视频、音频与工具模型"
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
      <template #footer
        ><el-button @click="providerDialogVisible = false">取消</el-button
        ><el-button
          type="primary"
          :loading="discoveringProviderModels"
          @click="saveProviderDraft"
          >确认</el-button
        ></template
      >
    </el-dialog>

    <el-dialog
      v-model="modelDialogVisible"
      :title="modelEditIndex >= 0 ? '编辑模型' : '添加模型'"
      width="min(1040px, calc(100% - 24px))"
      top="0"
      destroy-on-close
      class="model-editor-dialog"
    >
      <el-form label-position="top" class="dialog-form model-editor-form">
        <el-tabs v-model="modelEditorTab" class="model-editor-tabs">
          <el-tab-pane label="基础配置" name="basic">
            <div class="model-editor-pane">
              <div class="form-grid model-basic-grid">
                <el-form-item label="模型类型" class="is-wide">
                  <el-radio-group
                    v-model="modelDraft.kind"
                    class="kind-radio"
                    @change="onModelKindChange"
                  >
                    <el-radio-button value="image">生图模型</el-radio-button>
                    <el-radio-button value="chat">对话模型</el-radio-button>
                  </el-radio-group>
                </el-form-item>
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
                      >刷新</el-button
                    >
                  </div>
                </el-form-item>
				<el-form-item label="调度资源池" class="is-wide">
				  <el-select
					v-model="modelDraft.executionPoolId"
					filterable
					allow-create
					default-first-option
					style="width: 100%"
				  >
					<el-option
					  v-for="pool in executionPoolOptions"
					  :key="pool.id"
					  :value="pool.id"
					  :label="`${pool.name} · ${pool.count} 条线路`"
					/>
				  </el-select>
				</el-form-item>
                <el-form-item label="模型说明" class="is-wide">
                  <el-input
                    v-model="modelDraft.description"
                    placeholder="用户选择模型时看到的简短说明"
                  />
                </el-form-item>
                <el-form-item label="标准积分">
                  <el-input-number
                    v-model="modelDraft.pricePoints"
                    :min="0"
                    :precision="0"
                    :step="1"
                    style="width: 100%"
                  />
                </el-form-item>
                <el-form-item label="折扣积分">
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
                <el-form-item
                  v-if="modelDraft.kind === 'image'"
                  label="快速模型"
                >
                  <el-switch v-model="modelDraft.fastMode" />
                </el-form-item>
                <el-form-item
                  v-if="modelDraft.kind === 'image'"
                  label="预计耗时"
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

              <div class="model-status-grid">
                <label>
                  <span
                    ><strong>用户可选</strong
                    ><small>显示在用户端模型列表</small></span
                  >
                  <el-switch v-model="modelDraft.public" />
                </label>
                <label>
                  <span
                    ><strong>默认模型</strong
                    ><small>作为该类型首选模型</small></span
                  >
                  <el-switch
                    v-model="modelDraft.default"
                    :disabled="!modelDraft.public || !modelDraft.enabled"
                  />
                </label>
                <label>
                  <span
                    ><strong>启用模型</strong
                    ><small>允许后台调度执行</small></span
                  >
                  <el-switch v-model="modelDraft.enabled" />
                </label>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane
            v-if="modelDraft.kind === 'image'"
            label="图片能力"
            name="capabilities"
          >
            <div class="model-editor-pane capability-pane">
              <section class="image-capability-editor">
                <header>
                  <div>
                    <strong>图片输出能力</strong>
                    <span>用户端只展示当前模型明确支持的选项</span>
                  </div>
                  <span
                    >{{ modelDraft.resolutions.length }} 档 ·
                    {{ aspectRatioUnion(modelDraft.aspectRatiosByResolution).length }} 种</span
                  >
                </header>

                <div class="capability-row resolution-capability-row">
                  <div class="capability-label">
                    <strong>支持分辨率</strong>
                    <span>至少选择一个输出档位</span>
                  </div>
                  <el-checkbox-group
                    v-model="modelDraft.resolutions"
                    class="capability-options compact-options"
                  >
                    <el-checkbox-button value="1K">1K</el-checkbox-button>
                    <el-checkbox-button value="2K">2K</el-checkbox-button>
                    <el-checkbox-button value="4K">4K</el-checkbox-button>
                  </el-checkbox-group>
                </div>

                <div class="auto-aspect-rules">
                  <div class="auto-aspect-rules__heading">
                    <strong>比例控制</strong>
                    <span>为每个分辨率配置用户可选比例，可包含 Auto</span>
                  </div>
                  <div class="auto-aspect-rules__grid">
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
                      >
                        <el-option
                          v-for="ratio in IMAGE_ASPECT_RATIOS"
                          :key="ratio"
                          :label="ratio === 'auto' ? 'Auto' : ratio"
                          :value="ratio"
                        />
                      </el-select>
                    </label>
                  </div>
                </div>

                <div class="capability-compact-grid">
                  <div class="capability-tile">
                    <div class="capability-label">
                      <strong>输出质量</strong><span>用户可选档位</span>
                    </div>
                    <el-checkbox-group
                      v-model="modelDraft.qualities"
                      class="capability-options compact-options"
                    >
                      <el-checkbox-button
                        v-for="quality in IMAGE_QUALITIES"
                        :key="quality.value"
                        :value="quality.value"
                        >{{ quality.label }}</el-checkbox-button
                      >
                    </el-checkbox-group>
                  </div>
                  <div class="capability-tile">
                    <div class="capability-label">
                      <strong>透明背景</strong><span>允许生成透明底图片</span>
                    </div>
                    <el-switch v-model="modelDraft.transparentBackground" />
                  </div>
                  <div class="capability-tile">
                    <div class="capability-label">
                      <strong>指定格式</strong
                      ><span>关闭时使用模型内置格式</span>
                    </div>
                    <div class="capability-control">
                      <el-switch
                        v-model="modelDraft.outputFormatsEnabled"
                        @change="onOutputFormatsEnabled"
                      />
                      <el-checkbox-group
                        v-if="modelDraft.outputFormatsEnabled"
                        v-model="modelDraft.outputFormats"
                        class="capability-options compact-options"
                      >
                        <el-checkbox-button
                          v-for="format in IMAGE_OUTPUT_FORMATS"
                          :key="format"
                          :value="format"
                          >{{ format.toUpperCase() }}</el-checkbox-button
                        >
                      </el-checkbox-group>
                      <em v-else>模型内置</em>
                    </div>
                  </div>
                  <div class="capability-tile">
                    <div class="capability-label">
                      <strong>内容审核</strong
                      ><span>关闭时使用模型内置审核</span>
                    </div>
                    <div class="capability-control">
                      <el-switch
                        v-model="modelDraft.moderationEnabled"
                        @change="onModerationEnabled"
                      />
                      <el-checkbox-group
                        v-if="modelDraft.moderationEnabled"
                        v-model="modelDraft.moderationLevels"
                        class="capability-options compact-options"
                      >
                        <el-checkbox-button
                          v-for="level in IMAGE_MODERATION_LEVELS"
                          :key="level"
                          :value="level"
                          >{{ level }}</el-checkbox-button
                        >
                      </el-checkbox-group>
                      <em v-else>模型内置</em>
                    </div>
                  </div>
                  <div class="capability-tile">
                    <div class="capability-label">
                      <strong>参考图片</strong><span>0 表示不接收参考图</span>
                    </div>
                    <div class="reference-limit">
                      <el-input-number
                        v-model="modelDraft.maxReferenceImages"
                        :min="0"
                        :max="16"
                        :step="1"
                        :precision="0"
                      />
                      <span>张</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-form>
      <template #footer
        ><el-button @click="modelDialogVisible = false">取消</el-button
        ><el-button type="primary" @click="saveModelDraft"
          >确认</el-button
        ></template
      >
    </el-dialog>
  </div>
</template>

<style scoped>
:global(.model-editor-dialog) {
  display: flex;
  max-height: calc(100dvh - 24px);
  margin: 12px auto !important;
  flex-direction: column;
  overflow: hidden;
}
:global(.model-editor-dialog .el-dialog__header),
:global(.model-editor-dialog .el-dialog__footer) {
  flex: none;
}
:global(.model-editor-dialog .el-dialog__body) {
  display: flex;
  min-height: 0;
  padding-top: 0;
  overflow: hidden;
}
.model-editor-form,
.model-editor-tabs {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.model-editor-tabs :deep(.el-tabs__header) {
  margin: 0 0 12px;
  flex: none;
}
.model-editor-tabs :deep(.el-tabs__content) {
  min-height: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
}
.model-editor-pane {
  display: grid;
  gap: 12px;
  padding: 1px 2px 4px;
}
.model-basic-grid :deep(.el-form-item) {
  margin-bottom: 12px;
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
  padding: 11px 12px;
  border-radius: 6px;
  background: var(--surface-2);
}
.model-status-grid > label > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.model-status-grid strong {
  color: var(--ink-1);
  font-size: 12px;
}
.model-status-grid small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-config-page {
  display: grid;
  min-height: 100%;
  gap: 10px;
  padding: 14px 18px 22px;
  align-content: start;
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
  margin: 0 13px 12px;
  padding: 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-soft) 58%, var(--surface-1));
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
.catalog-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-config-tabs,
.kind-filter {
  display: inline-grid;
  width: fit-content;
  padding: 2px;
  border-radius: 6px;
  background: var(--surface-3);
}
.model-config-tabs {
  grid-template-columns: repeat(3, 1fr);
}
.kind-filter {
  grid-template-columns: repeat(3, max-content);
  flex: 0 0 auto;
}
.model-config-tabs button,
.kind-filter button {
  border: 0;
  border-radius: 5px;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}
.model-config-tabs button {
  min-width: 120px;
  padding: 6px 12px;
}
.kind-filter button {
  padding: 5px 9px;
}
.model-config-tabs button.is-active,
.kind-filter button.active {
  color: var(--ink-1);
  background: var(--surface);
  box-shadow: 0 1px 3px rgb(15 23 42 / 8%);
  font-weight: 650;
}
.config-surface {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}
.config-surface > header {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
.config-surface > header > div:first-child {
  display: grid;
  gap: 3px;
}
.config-surface > header strong {
  color: var(--ink-1);
  font-size: 14px;
}
.config-surface > header span {
  color: var(--ink-3);
  font-size: 11px;
}
.assignment-surface {
  overflow: visible;
}
.assignment-layout {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  align-items: start;
  padding: 10px;
}
.workspace-rail {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 6px 10px 6px 6px;
  border-right: 1px solid var(--border);
}
.workspace-rail > button {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 9px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}
.workspace-rail > button:hover {
  background: var(--surface-2);
}
.workspace-rail > button.is-active {
  background: color-mix(in srgb, var(--accent-soft) 72%, var(--surface-2));
}
.workspace-rail > button.is-active .workspace-index {
  color: #fff;
  background: var(--accent);
}
.workspace-nav-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.workspace-nav-copy strong {
  color: var(--ink-1);
  font-size: 12px;
}
.workspace-nav-copy small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-rail > button > b {
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 4px;
  color: var(--ink-3);
  background: var(--surface-3);
  font-size: 9px;
}
.workspace-detail {
  display: grid;
  min-width: 0;
  grid-template-rows: auto auto auto;
  margin-left: 10px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--surface-2);
}
.workspace-detail > header {
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: var(--surface-3);
}
.workspace-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.workspace-title > div {
  display: grid;
  gap: 2px;
}
.workspace-title strong {
  color: var(--ink-1);
  font-size: 14px;
}
.workspace-title small {
  color: var(--ink-3);
  font-size: 10px;
}
.workspace-summary {
  display: flex;
  align-items: center;
  gap: 6px;
}
.workspace-summary > span {
  margin-right: 4px;
  color: var(--ink-3);
  font-size: 10px;
}
.workspace-summary > span b {
  color: var(--accent-ink);
  font-size: 12px;
}
.workspace-summary > button {
  min-width: 44px;
  padding: 5px 8px;
  border: 0;
  border-radius: 5px;
  color: var(--ink-2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  cursor: pointer;
  font-size: 10px;
}
.workspace-summary > button:hover:not(:disabled) {
  color: var(--accent-ink);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 42%, var(--border));
}
.workspace-summary > button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}
.workspace-model-section {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px;
}
.workspace-section-heading > div {
  display: grid;
  gap: 2px;
}
.workspace-section-heading strong {
  color: var(--ink-1);
  font-size: 12px;
}
.workspace-section-heading span {
  color: var(--ink-3);
  font-size: 9px;
}
.workspace-defaults {
  display: grid;
  gap: 10px;
  padding: 13px 16px 15px;
  border-top: 1px solid var(--border);
  background: var(--surface-3);
}
.workspace-default-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.workspace-default-grid label {
  display: grid;
  min-width: 0;
  gap: 5px;
}
.workspace-default-grid label > span {
  color: var(--ink-3);
  font-size: 10px;
}
.workspace-default-grid .el-select {
  width: 100%;
}
.workspace-title .workspace-index,
.workspace-rail .workspace-index {
  display: grid;
}
.workspace-index {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 5px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  font-size: 10px;
  font-weight: 750;
}
.assignment-models {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.assignment-model {
  width: 100%;
  min-width: 0;
  height: auto;
  margin: 0;
  padding: 11px 12px;
  border-radius: 6px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
}
.assignment-model.is-checked {
  background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface));
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--accent) 35%, var(--border));
}
.assignment-model :deep(.el-checkbox__label) {
  min-width: 0;
  flex: 1;
}
.assignment-model :deep(.el-checkbox__label > span) {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.assignment-model__title {
  display: flex !important;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.assignment-model__title > i {
  flex: none;
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--ink-3);
  background: var(--surface-3);
  font-size: 8px;
  font-style: normal;
  font-weight: 650;
}
.assignment-model strong,
.assignment-model small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assignment-model strong {
  color: var(--ink-1);
  font-size: 12px;
}
.assignment-model small {
  color: var(--ink-3);
  font-size: 10px;
}
.assignment-model small em {
  margin-left: 4px;
  color: var(--success);
  font-style: normal;
}
.model-search {
  width: 160px;
}
.config-table :deep(th.el-table__cell) {
  height: 38px;
  color: var(--ink-3);
  background: var(--surface-2);
  font-size: 10px;
}
.config-table :deep(td.el-table__cell) {
  height: 50px;
}
.catalog-table :deep(td.el-table__cell) {
  height: 82px;
}
.primary-cell,
.provider-cell {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.primary-cell strong {
  color: var(--ink-1);
  font-size: 12px;
}
.primary-cell small,
.provider-cell small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 10px;
  text-overflow: ellipsis;
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
.chat-capability {
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
@media (max-width: 1050px) {
  .assignment-layout {
    grid-template-columns: 1fr;
  }
  .workspace-rail {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 6px 6px 10px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .workspace-detail {
    margin: 10px 0 0;
  }
}
@media (max-width: 720px) {
  .model-config-page {
    padding: 10px;
  }
  .model-config-tabs {
    width: 100%;
  }
  .model-config-tabs button {
    min-width: 0;
  }
  .config-surface > header {
    align-items: stretch;
    flex-direction: column;
  }
  .catalog-tools {
    align-items: stretch;
    flex-wrap: wrap;
  }
  .kind-filter {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }
  .model-search {
    min-width: 150px;
    flex: 1;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-grid .is-wide {
    grid-column: auto;
  }
  .model-status-grid,
  .capability-compact-grid {
    grid-template-columns: 1fr;
  }
  .capability-tile + .capability-tile,
  .capability-tile:nth-child(4) {
    border-left: 0;
    border-top: 1px solid var(--border);
  }
  .auto-aspect-rules__grid {
    grid-template-columns: 1fr;
  }
  .model-discovery {
    align-items: stretch;
    flex-direction: column;
  }
  .model-picker {
    grid-template-columns: 1fr;
  }
  .workspace-rail {
    display: flex;
    overflow-x: auto;
  }
  .workspace-rail > button {
    min-width: 188px;
  }
  .workspace-detail > header {
    align-items: flex-start;
    flex-direction: column;
  }
  .assignment-models,
  .workspace-default-grid {
    grid-template-columns: 1fr;
  }
}
</style>
