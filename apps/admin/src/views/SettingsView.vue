<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import {
  Check,
  Connection,
  Delete,
  Document,
  MagicStick,
  Odometer,
  Picture,
  Plus,
  Refresh,
  RefreshRight,
  TrendCharts,
  User,
  Wallet,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { request } from "@/request";
import { normalizePoints } from "@/utils";
import type { AdminSettings, GrowthMilestone } from "@/components/settings/types";
import UserProfileRulesDialog from "@/components/UserProfileRulesDialog.vue";
import AdminDialog from "@/components/AdminDialog.vue";
import {
  describeChanges,
  findEmptyNumberFields,
  findWarnings,
  type SettingsChange,
  type SettingsSnapshot,
} from "@/components/settings/settingsChanges";

interface PaymentSettings {
  lanjingPayEnabled?: boolean;
  lanjingPayBaseUrl?: string;
  lanjingPaySecret?: string;
  lanjingPayNotifyUrl?: string;
  lanjingPayTimeoutSecs?: number;
  lanjingPayAlipayEnabled?: boolean;
  lanjingPayWechatEnabled?: boolean;
}

interface PaymentTestResult {
  online: boolean;
  state: number;
  stateLabel: string;
  lastHeartbeatAt?: string | null;
  lastPaymentAt?: string | null;
}

interface ModelProviderOption {
  id: string;
  name: string;
  enabled: boolean;
}

interface ModelOption {
  id: string;
  name: string;
  providerId: string;
  upstreamModel: string;
  kind: "image" | "chat" | "image_tool";
  enabled: boolean;
  supportedReasoningEfforts?: string[];
  reasoningPricing?: { defaultEffort?: string } | null;
}

interface ModelDirectory {
  providers: ModelProviderOption[];
  models: ModelOption[];
}

type SettingsSection =
  | "payment"
  | "image-ai"
  | "account"
  | "image-processing"
  | "growth"
  | "concurrency"
  | "logging"
  | "retry";

const route = useRoute();
const loading = ref(false);
const activeSection = ref<SettingsSection>("payment");
const saving = ref(false);
const savedSignature = ref("");
const testingPayment = ref(false);
const paymentTest = ref<PaymentTestResult | null>(null);
const modelDirectory = ref<ModelDirectory>({ providers: [], models: [] });

const form = reactive({
  userMaxRunningTasks: 100,
  userMaxRunningImages: 400,
  userMaxConcurrentTasks: 4,
  userMaxConcurrentChats: 4,
  globalMaxConcurrentTasks: 2000,
  globalMaxConcurrentChats: 32,
  globalMaxActiveTasks: 12000,
  globalMaxActiveImages: 12000,
  taskFailureRetryCount: 2,
  taskRetryFirstDelaySecs: 3,
  taskRetryBackoffSecs: 15,
  t2iPromptMaxChars: 8000,
  assistantMessageMaxChars: 12000,
  studioHubPromptMaxChars: 2000,
  imageVariantFormat: 'webp',
  imageDisplayLossless: false,
  imageDisplayQuality: 85,
  imageDisplayMaxEdge: 2048,
  imageThumbMaxEdge: 512,
  imageFetchConcurrency: 8,
  crossProviderSameModelBalancingEnabled: false,
  platformLoggingEnabled: false,
  platformLogSecurityEnabled: true,
  platformLogOperationsEnabled: true,
  platformLogUserEnabled: false,
  platformLogRetentionDays: 7,
  platformLogMaxMb: 256,
  auditLogRetentionDays: 180,
  adminImageAnalysisProviderId: "",
  adminImageAnalysisModelId: "",
  adminImageAnalysisReasoningEffort: "",
  registrationEnabled: true,
  signupBonusPoints: 0,
  growthFailureBonusEnabled: true,
  growthFailureBonusPoints: 3,
  growthFailureBonusDailyLimit: 3,
  growthUsageRewardsEnabled: true,
  growthUsageMilestones: [
    { units: 10, rewardCents: 20 },
    { units: 30, rewardCents: 50 },
    { units: 100, rewardCents: 150 },
  ] as GrowthMilestone[],
  suggestionRewardMaxPoints: 5000,
  lanjingPayEnabled: false,
  lanjingPayBaseUrl: "https://2347537.pay.lanjingzf.com",
  lanjingPaySecret: "",
  lanjingPayNotifyUrl: "",
  lanjingPayTimeoutSecs: 10,
  lanjingPayAlipayEnabled: true,
  lanjingPayWechatEnabled: true,
});

const settingsSignature = () =>
  JSON.stringify({
    userMaxRunningTasks: form.userMaxRunningTasks,
    userMaxRunningImages: form.userMaxRunningImages,
    userMaxConcurrentTasks: form.userMaxConcurrentTasks,
    userMaxConcurrentChats: form.userMaxConcurrentChats,
    globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
    globalMaxConcurrentChats: form.globalMaxConcurrentChats,
    globalMaxActiveTasks: form.globalMaxActiveTasks,
    globalMaxActiveImages: form.globalMaxActiveImages,
    taskFailureRetryCount: form.taskFailureRetryCount,
    taskRetryFirstDelaySecs: form.taskRetryFirstDelaySecs,
    taskRetryBackoffSecs: form.taskRetryBackoffSecs,
    t2iPromptMaxChars: form.t2iPromptMaxChars,
    assistantMessageMaxChars: form.assistantMessageMaxChars,
    studioHubPromptMaxChars: form.studioHubPromptMaxChars,
    imageVariantFormat: form.imageVariantFormat,
    imageDisplayLossless: form.imageDisplayLossless,
    imageDisplayQuality: form.imageDisplayQuality,
    imageDisplayMaxEdge: form.imageDisplayMaxEdge,
    imageThumbMaxEdge: form.imageThumbMaxEdge,
    imageFetchConcurrency: form.imageFetchConcurrency,
    crossProviderSameModelBalancingEnabled:
      form.crossProviderSameModelBalancingEnabled,
    platformLoggingEnabled: form.platformLoggingEnabled,
    platformLogSecurityEnabled: form.platformLogSecurityEnabled,
    platformLogOperationsEnabled: form.platformLogOperationsEnabled,
    platformLogUserEnabled: form.platformLogUserEnabled,
    platformLogRetentionDays: form.platformLogRetentionDays,
    platformLogMaxMb: form.platformLogMaxMb,
    auditLogRetentionDays: form.auditLogRetentionDays,
    adminImageAnalysisProviderId: form.adminImageAnalysisProviderId,
    adminImageAnalysisModelId: form.adminImageAnalysisModelId,
    adminImageAnalysisReasoningEffort: form.adminImageAnalysisReasoningEffort,
    registrationEnabled: form.registrationEnabled,
    signupBonusPoints: form.signupBonusPoints,
    growthFailureBonusEnabled: form.growthFailureBonusEnabled,
    growthFailureBonusPoints: form.growthFailureBonusPoints,
    growthFailureBonusDailyLimit: form.growthFailureBonusDailyLimit,
    growthUsageRewardsEnabled: form.growthUsageRewardsEnabled,
    growthUsageMilestones: form.growthUsageMilestones,
    suggestionRewardMaxPoints: form.suggestionRewardMaxPoints,
    lanjingPayEnabled: form.lanjingPayEnabled,
    lanjingPayBaseUrl: form.lanjingPayBaseUrl,
    lanjingPaySecret: form.lanjingPaySecret,
    lanjingPayNotifyUrl: form.lanjingPayNotifyUrl,
    lanjingPayTimeoutSecs: form.lanjingPayTimeoutSecs,
    lanjingPayAlipayEnabled: form.lanjingPayAlipayEnabled,
    lanjingPayWechatEnabled: form.lanjingPayWechatEnabled,
  });

const isDirty = computed(
  () =>
    !loading.value &&
    savedSignature.value !== "" &&
    settingsSignature() !== savedSignature.value,
);
const effectiveGlobalConcurrency = computed(() =>
  Math.max(1, form.globalMaxConcurrentTasks),
);
const usageRewardTotal = computed(() =>
  form.growthUsageMilestones.reduce(
    (sum, milestone) => sum + normalizePoints(milestone.rewardCents),
    0,
  ),
);
const paymentStateLabel = computed(() => {
  if (paymentTest.value) return `监听端${paymentTest.value.stateLabel}`;
  return form.lanjingPayEnabled ? "等待检测" : "支付已停用";
});
type ImageAnalysisStatus =
  | "empty"
  | "incomplete"
  | "missing-provider"
  | "disabled-provider"
  | "missing-model"
  | "invalid-model"
  | "disabled-model"
  | "ready";

const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "更高",
  extra_high: "更高",
  max: "最高",
};

const IMAGE_ANALYSIS_COPY: Record<
  ImageAnalysisStatus,
  { title: string; summary: string; hint: string }
> = {
  empty: {
    title: "尚未配置分析模型",
    summary: "电商素材标题、画布模板和提示词导入都依赖这里绑定的视觉对话模型。",
    hint: "尚未配置",
  },
  incomplete: {
    title: "配置不完整",
    summary: "服务商和图片理解模型必须同时选择后才能保存。",
    hint: "配置不完整",
  },
  "missing-provider": {
    title: "服务商已不存在",
    summary: "当前绑定的服务商已从模型目录移除，请重新选择后保存。",
    hint: "配置已失效",
  },
  "disabled-provider": {
    title: "服务商已停用",
    summary: "已绑定的服务商当前未启用，后台图片分析会返回不可用。",
    hint: "服务商已停用",
  },
  "missing-model": {
    title: "模型已不存在",
    summary: "当前绑定的模型已从目录移除，请重新选择后保存。",
    hint: "配置已失效",
  },
  "invalid-model": {
    title: "模型与服务商不匹配",
    summary: "请选择当前服务商下、支持视觉输入的对话模型。",
    hint: "模型无效",
  },
  "disabled-model": {
    title: "分析模型已停用",
    summary: "已绑定的模型当前未启用，相关后台分析入口会失败。",
    hint: "模型已停用",
  },
  ready: {
    title: "后台图片分析已就绪",
    summary: "电商素材、画布模板和提示词导入会复用这个模型。",
    hint: "已就绪",
  },
};

const imageAnalysisModels = computed(() =>
  modelDirectory.value.models.filter(
    (model) =>
      model.providerId === form.adminImageAnalysisProviderId &&
      model.kind === "chat",
  ),
);
const selectedImageAnalysisProvider = computed(() =>
  modelDirectory.value.providers.find(
    (provider) => provider.id === form.adminImageAnalysisProviderId,
  ),
);
const selectedImageAnalysisModel = computed(() =>
  modelDirectory.value.models.find(
    (model) => model.id === form.adminImageAnalysisModelId,
  ),
);
const imageAnalysisReasoningEfforts = computed(
  () => selectedImageAnalysisModel.value?.supportedReasoningEfforts || [],
);
const imageAnalysisStatus = computed((): ImageAnalysisStatus => {
  const providerId = form.adminImageAnalysisProviderId;
  const modelId = form.adminImageAnalysisModelId;
  if (!providerId && !modelId) return "empty";
  if (!providerId || !modelId) return "incomplete";
  const provider = selectedImageAnalysisProvider.value;
  if (!provider) return "missing-provider";
  if (!provider.enabled) return "disabled-provider";
  const model = selectedImageAnalysisModel.value;
  if (!model) return "missing-model";
  if (model.kind !== "chat" || model.providerId !== providerId) {
    return "invalid-model";
  }
  if (!model.enabled) return "disabled-model";
  return "ready";
});
const imageAnalysisCopy = computed(
  () => IMAGE_ANALYSIS_COPY[imageAnalysisStatus.value],
);
const imageAnalysisReady = computed(
  () => imageAnalysisStatus.value === "ready",
);
const imageAnalysisConfigured = computed(
  () =>
    Boolean(form.adminImageAnalysisProviderId) ||
    Boolean(form.adminImageAnalysisModelId),
);
const enabledProviderCount = computed(
  () => modelDirectory.value.providers.filter((provider) => provider.enabled)
    .length,
);
const enabledChatModelCount = computed(
  () =>
    modelDirectory.value.models.filter(
      (model) => model.kind === "chat" && model.enabled,
    ).length,
);
const selectedReasoningEffortLabel = computed(() => {
  const effort = form.adminImageAnalysisReasoningEffort;
  if (effort) return reasoningEffortLabel(effort);
  return selectedImageAnalysisModel.value?.reasoningPricing?.defaultEffort
    ? `默认 ${reasoningEffortLabel(selectedImageAnalysisModel.value.reasoningPricing.defaultEffort)}`
    : "模型默认";
});

const sections = computed(() => [
  {
    id: "payment" as const,
    label: "支付",
    icon: Wallet,
    desc: "蓝鲸支付商户接入：接口地址、通讯密钥、异步回调与开放的支付方式",
    hint: form.lanjingPayEnabled ? paymentStateLabel.value : "已停用",
    on: form.lanjingPayEnabled,
  },
  {
    id: "image-ai" as const,
    label: "AI 模型",
    icon: MagicStick,
    desc: "后台图片分析使用的服务商与模型，用于电商素材、画布模板和提示词导入",
    hint: imageAnalysisReady.value
      ? selectedImageAnalysisModel.value?.name || imageAnalysisCopy.value.hint
      : imageAnalysisCopy.value.hint,
    on: imageAnalysisReady.value,
  },
  {
    id: "account" as const,
    label: "注册与用户画像",
    icon: User,
    desc: "前台注册开关、新账号赠送积分，以及用户画像规则和增长活动入口",
    hint: form.registrationEnabled ? "开放注册" : "注册已关闭",
    on: form.registrationEnabled,
  },
  {
    id: "growth" as const,
    label: "增长激励",
    icon: TrendCharts,
    desc: "失败补偿、建议采纳奖励和按月累计交付的用量里程碑",
    hint: form.growthUsageRewardsEnabled
      ? `用量 ${usageRewardTotal.value.toLocaleString("zh-CN")} 积分`
      : "用量奖励关闭",
    on: form.growthFailureBonusEnabled || form.growthUsageRewardsEnabled,
  },
  {
    id: "concurrency" as const,
    label: "图片与对话并发",
    icon: Odometer,
    desc: "全站与个人的图片、对话并发额度，排队容量和各输入框字数上限",
    hint: `图片 ${effectiveGlobalConcurrency.value} 张 · 对话 ${form.globalMaxConcurrentChats} 次`,
    on: true,
  },
  {
    id: "image-processing" as const,
    label: "图片处理",
    icon: Picture,
    desc: "展示图与缩略图的压缩格式、质量、尺寸，以及上游结果下载并发",
    hint: "展示图、缩略图与下载并发",
    on: true,
  },
  {
    id: "logging" as const,
    label: "运行日志",
    icon: Document,
    desc: "平台日志分类开关、保留天数、容量上限和操作审计保留期",
    hint: form.platformLoggingEnabled
      ? `${form.platformLogRetentionDays} 天 · ${form.platformLogMaxMb} MB`
      : "已关闭",
    on: form.platformLoggingEnabled,
  },
  {
    id: "retry" as const,
    label: "调度与重试",
    icon: RefreshRight,
    desc: "任务失败后的自动重试策略，以及同名模型跨服务商泄压",
    hint:
      form.taskFailureRetryCount > 0
        ? `重试 ${form.taskFailureRetryCount} 次`
        : "不重试",
    on: form.taskFailureRetryCount > 0,
  },
]);

const activeSectionMeta = computed(
  () =>
    sections.value.find((item) => item.id === activeSection.value) ||
    sections.value[0],
);

function addUsageMilestone() {
  if (form.growthUsageMilestones.length >= 12) {
    ElMessage.warning("最多配置 12 个里程碑");
    return;
  }
  // 按当前最大张数递增，避免与已改大的档位重复（后端不允许重复张数）
  const top = form.growthUsageMilestones.reduce<GrowthMilestone | null>(
    (best, item) => (!best || Number(item.units) > Number(best.units) ? item : best),
    null,
  );
  form.growthUsageMilestones.push({
    units: top ? Number(top.units) + 10 : 10,
    rewardCents: top ? Number(top.rewardCents) + 20 : 20,
  });
}

function removeUsageMilestone(index: number) {
  if (form.growthUsageMilestones.length <= 1) {
    ElMessage.warning("至少保留 1 个里程碑");
    return;
  }
  form.growthUsageMilestones.splice(index, 1);
}

function changeImageAnalysisProvider() {
  form.adminImageAnalysisModelId = "";
  form.adminImageAnalysisReasoningEffort = "";
}

function changeImageAnalysisModel() {
  const model = selectedImageAnalysisModel.value;
  form.adminImageAnalysisReasoningEffort =
    model?.reasoningPricing?.defaultEffort ||
    model?.supportedReasoningEfforts?.[0] ||
    "";
}

function reasoningEffortLabel(effort: string) {
  return REASONING_EFFORT_LABELS[effort] || effort;
}

function toggleImageAnalysisReasoning(effort: string) {
  form.adminImageAnalysisReasoningEffort =
    form.adminImageAnalysisReasoningEffort === effort ? "" : effort;
}

function clearImageAnalysis() {
  form.adminImageAnalysisProviderId = "";
  form.adminImageAnalysisModelId = "";
  form.adminImageAnalysisReasoningEffort = "";
}

function modelOptionLabel(model: ModelOption) {
  const state = model.enabled ? "" : " · 已停用";
  return `${model.name} · ${model.upstreamModel}${state}`;
}

function providerOptionLabel(provider: ModelProviderOption) {
  return provider.enabled ? provider.name : `${provider.name} · 已停用`;
}

function hydrate(settings: AdminSettings & PaymentSettings) {
  form.userMaxRunningTasks = settings.userMaxRunningTasks ?? 100;
  form.userMaxRunningImages = settings.userMaxRunningImages ?? 400;
  form.userMaxConcurrentTasks = settings.userMaxConcurrentTasks ?? 4;
  form.userMaxConcurrentChats = settings.userMaxConcurrentChats ?? 4;
  form.globalMaxConcurrentTasks = settings.globalMaxConcurrentTasks != null && settings.globalMaxConcurrentTasks > 0
    ? settings.globalMaxConcurrentTasks : settings.effectiveGlobalConcurrency ?? 2000;
  form.globalMaxConcurrentChats = settings.globalMaxConcurrentChats ?? 32;
  form.globalMaxActiveTasks = settings.globalMaxActiveTasks ?? 12000;
  form.globalMaxActiveImages = settings.globalMaxActiveImages ?? 12000;
  form.taskFailureRetryCount = settings.taskFailureRetryCount ?? 2;
  form.taskRetryFirstDelaySecs = settings.taskRetryFirstDelaySecs ?? 3;
  form.taskRetryBackoffSecs = settings.taskRetryBackoffSecs ?? 15;
  form.t2iPromptMaxChars = settings.t2iPromptMaxChars ?? 8000;
  form.assistantMessageMaxChars = settings.assistantMessageMaxChars ?? 12000;
  form.studioHubPromptMaxChars = settings.studioHubPromptMaxChars ?? 2000;
  form.imageVariantFormat = settings.imageVariantFormat === 'png' ? 'png' : 'webp';
  form.imageDisplayLossless = settings.imageDisplayLossless ?? false;
  form.imageDisplayQuality = settings.imageDisplayQuality ?? 85;
  form.imageDisplayMaxEdge = settings.imageDisplayMaxEdge ?? 2048;
  form.imageThumbMaxEdge = settings.imageThumbMaxEdge ?? 512;
  form.imageFetchConcurrency = settings.imageFetchConcurrency ?? 8;
  form.crossProviderSameModelBalancingEnabled =
    settings.crossProviderSameModelBalancingEnabled ?? false;
  form.platformLoggingEnabled = settings.platformLoggingEnabled ?? false;
  form.platformLogSecurityEnabled = settings.platformLogSecurityEnabled ?? true;
  form.platformLogOperationsEnabled = settings.platformLogOperationsEnabled ?? true;
  form.platformLogUserEnabled = settings.platformLogUserEnabled ?? false;
  form.platformLogRetentionDays = settings.platformLogRetentionDays ?? 7;
  form.platformLogMaxMb = settings.platformLogMaxMb ?? 256;
  form.auditLogRetentionDays = settings.auditLogRetentionDays ?? 180;
  form.adminImageAnalysisProviderId = settings.adminImageAnalysisProviderId || "";
  form.adminImageAnalysisModelId = settings.adminImageAnalysisModelId || "";
  form.adminImageAnalysisReasoningEffort =
    settings.adminImageAnalysisReasoningEffort || "";
  form.registrationEnabled = settings.registrationEnabled ?? true;
  form.signupBonusPoints = normalizePoints(settings.signupBonusCents);
  form.growthFailureBonusEnabled = settings.growthFailureBonusEnabled ?? true;
  form.growthFailureBonusPoints = normalizePoints(
    settings.growthFailureBonusCents ?? 3,
  );
  form.growthFailureBonusDailyLimit =
    settings.growthFailureBonusDailyLimit ?? 3;
  form.growthUsageRewardsEnabled = settings.growthUsageRewardsEnabled ?? true;
  form.growthUsageMilestones =
    Array.isArray(settings.growthUsageMilestones) &&
    settings.growthUsageMilestones.length > 0
      ? settings.growthUsageMilestones.map((milestone) => ({
          units: normalizePoints(milestone.units),
          rewardCents: normalizePoints(milestone.rewardCents),
        }))
      : [
          { units: 10, rewardCents: 20 },
          { units: 30, rewardCents: 50 },
          { units: 100, rewardCents: 150 },
        ];
  form.suggestionRewardMaxPoints = normalizePoints(
    settings.suggestionRewardMaxCents ?? 5000,
  );
  form.lanjingPayEnabled = settings.lanjingPayEnabled ?? false;
  form.lanjingPayBaseUrl =
    settings.lanjingPayBaseUrl || "https://2347537.pay.lanjingzf.com";
  form.lanjingPaySecret = settings.lanjingPaySecret || "";
  form.lanjingPayNotifyUrl = settings.lanjingPayNotifyUrl || "";
  form.lanjingPayTimeoutSecs = settings.lanjingPayTimeoutSecs ?? 10;
  form.lanjingPayAlipayEnabled = settings.lanjingPayAlipayEnabled ?? true;
  form.lanjingPayWechatEnabled = settings.lanjingPayWechatEnabled ?? true;
  savedSignature.value = settingsSignature();
}

async function load() {
  loading.value = true;
  try {
    const [settings, directory] = await Promise.all([
      request<AdminSettings & PaymentSettings>("/api/v1/admin/settings"),
      request<ModelDirectory>("/api/v1/admin/model-config"),
    ]);
    modelDirectory.value = {
      providers: Array.isArray(directory.providers) ? directory.providers : [],
      models: Array.isArray(directory.models) ? directory.models : [],
    };
    hydrate(settings);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (
    form.platformLoggingEnabled &&
    !form.platformLogSecurityEnabled &&
    !form.platformLogOperationsEnabled &&
    !form.platformLogUserEnabled
  ) {
    ElMessage.warning("启用日志时至少开启一个日志分类");
    return;
  }
  if (
    Boolean(form.adminImageAnalysisProviderId) !==
    Boolean(form.adminImageAnalysisModelId)
  ) {
    ElMessage.warning("后台图片分析的服务商和模型必须同时配置");
    return;
  }
  if (
    form.lanjingPayEnabled &&
    (!form.lanjingPayBaseUrl.trim() ||
      !form.lanjingPaySecret.trim() ||
      !form.lanjingPayNotifyUrl.trim())
  ) {
    ElMessage.warning("启用支付前请补全接口地址、通讯密钥和异步回调");
    return;
  }
  if (
    form.lanjingPayEnabled &&
    !form.lanjingPayAlipayEnabled &&
    !form.lanjingPayWechatEnabled
  ) {
    ElMessage.warning("启用支付时至少开放一种支付方式");
    return;
  }
  const empty = findEmptyNumberFields(
    JSON.parse(savedSignature.value || "{}") as SettingsSnapshot,
    JSON.parse(settingsSignature()) as SettingsSnapshot,
  );
  if (empty.length) {
    activeSection.value = empty[0].section as SettingsSection;
    ElMessage.warning(`请先填写：${empty.map((item) => item.label).join("、")}`);
    return;
  }
  const units = form.growthUsageMilestones.map((item) => Number(item.units));
  const duplicated = units.find((value, index) => units.indexOf(value) !== index);
  if (duplicated !== undefined) {
    activeSection.value = "growth";
    ElMessage.warning(`用量计划档位的累计交付张数不能重复：${duplicated} 张`);
    return;
  }
  pendingChanges.value = describeChanges(
    JSON.parse(savedSignature.value || "{}") as SettingsSnapshot,
    JSON.parse(settingsSignature()) as SettingsSnapshot,
  );
  confirmOpen.value = true;
}

/** 确认改动清单后才真正提交 */
async function commitSave() {
  saving.value = true;
  try {
    hydrate(
      await request<AdminSettings & PaymentSettings>("/api/v1/admin/settings", {
        method: "PUT",
        body: {
          userMaxRunningTasks: form.userMaxRunningTasks,
          userMaxRunningImages: form.userMaxRunningImages,
          userMaxConcurrentTasks: form.userMaxConcurrentTasks,
          userMaxConcurrentChats: form.userMaxConcurrentChats,
          globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
          globalMaxConcurrentChats: form.globalMaxConcurrentChats,
          globalMaxActiveTasks: form.globalMaxActiveTasks,
          globalMaxActiveImages: form.globalMaxActiveImages,
          taskFailureRetryCount: form.taskFailureRetryCount,
          taskRetryFirstDelaySecs: form.taskRetryFirstDelaySecs,
          taskRetryBackoffSecs: form.taskRetryBackoffSecs,
          t2iPromptMaxChars: form.t2iPromptMaxChars,
          assistantMessageMaxChars: form.assistantMessageMaxChars,
          studioHubPromptMaxChars: form.studioHubPromptMaxChars,
          imageVariantFormat: form.imageVariantFormat,
          imageDisplayLossless: form.imageDisplayLossless,
          imageDisplayQuality: form.imageDisplayQuality,
          imageDisplayMaxEdge: form.imageDisplayMaxEdge,
          imageThumbMaxEdge: form.imageThumbMaxEdge,
          imageFetchConcurrency: form.imageFetchConcurrency,
          crossProviderSameModelBalancingEnabled:
            form.crossProviderSameModelBalancingEnabled,
          platformLoggingEnabled: form.platformLoggingEnabled,
          platformLogSecurityEnabled: form.platformLogSecurityEnabled,
          platformLogOperationsEnabled: form.platformLogOperationsEnabled,
          platformLogUserEnabled: form.platformLogUserEnabled,
          platformLogRetentionDays: form.platformLogRetentionDays,
          platformLogMaxMb: form.platformLogMaxMb,
          auditLogRetentionDays: form.auditLogRetentionDays,
          adminImageAnalysisProviderId: form.adminImageAnalysisProviderId,
          adminImageAnalysisModelId: form.adminImageAnalysisModelId,
          adminImageAnalysisReasoningEffort:
            form.adminImageAnalysisReasoningEffort,
          registrationEnabled: form.registrationEnabled,
          signupBonusCents: normalizePoints(form.signupBonusPoints),
          growthFailureBonusEnabled: form.growthFailureBonusEnabled,
          growthFailureBonusCents: normalizePoints(
            form.growthFailureBonusPoints,
          ),
          growthFailureBonusDailyLimit: form.growthFailureBonusDailyLimit,
          growthUsageRewardsEnabled: form.growthUsageRewardsEnabled,
          growthUsageMilestones: form.growthUsageMilestones
            .map((milestone) => ({
              units: normalizePoints(milestone.units),
              rewardCents: normalizePoints(milestone.rewardCents),
            }))
            .sort((a, b) => a.units - b.units),
          suggestionRewardMaxCents: normalizePoints(
            form.suggestionRewardMaxPoints,
          ),
          lanjingPayEnabled: form.lanjingPayEnabled,
          lanjingPayBaseUrl: form.lanjingPayBaseUrl.trim(),
          lanjingPaySecret: form.lanjingPaySecret.trim(),
          lanjingPayNotifyUrl: form.lanjingPayNotifyUrl.trim(),
          lanjingPayTimeoutSecs: form.lanjingPayTimeoutSecs,
          lanjingPayAlipayEnabled: form.lanjingPayAlipayEnabled,
          lanjingPayWechatEnabled: form.lanjingPayWechatEnabled,
        },
      }),
    );
    confirmOpen.value = false;
    ElMessage.success("系统设置已生效");
  } finally {
    saving.value = false;
  }
}

async function testPaymentConnection() {
  if (
    !form.lanjingPayBaseUrl.trim() ||
    !form.lanjingPaySecret.trim() ||
    !form.lanjingPayNotifyUrl.trim()
  ) {
    ElMessage.warning("请先填写接口地址、通讯密钥和异步回调");
    return;
  }
  testingPayment.value = true;
  paymentTest.value = null;
  try {
    paymentTest.value = await request<PaymentTestResult>(
      "/api/v1/admin/providers/lanjing-pay/tests",
      {
        method: "POST",
        body: {
          baseUrl: form.lanjingPayBaseUrl.trim(),
          secret: form.lanjingPaySecret.trim(),
          notifyUrl: form.lanjingPayNotifyUrl.trim(),
          timeoutSecs: form.lanjingPayTimeoutSecs,
        },
      },
    );
    if (paymentTest.value.online) ElMessage.success("支付监听端在线");
    else ElMessage.warning(`接口可用，监听端${paymentTest.value.stateLabel}`);
  } finally {
    testingPayment.value = false;
  }
}

function formatPaymentTime(value?: string | null) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无记录" : date.toLocaleString("zh-CN");
}

// ---------- 保存确认 / 离开提醒 / 矛盾检查 ----------
const confirmOpen = ref(false);
const pendingChanges = ref<SettingsChange[]>([]);
const dangerCount = computed(() => pendingChanges.value.filter((item) => item.danger).length);

const warnings = computed(() => findWarnings(JSON.parse(settingsSignature()) as SettingsSnapshot));
const sectionWarnings = computed(() => warnings.value.filter((item) => item.section === activeSection.value));
function warningCount(section: string) {
  return warnings.value.filter((item) => item.section === section).length;
}

/** 撤销：重新读取服务器上的配置 */
async function discardChanges() {
  await load();
}

onBeforeRouteLeave(async () => {
  if (!isDirty.value) return true;
  try {
    await ElMessageBox.confirm(
      "系统设置有未保存的更改，离开后这些更改会丢失。",
      "离开系统设置？",
      { type: "warning", confirmButtonText: "放弃更改并离开", cancelButtonText: "留下继续编辑" },
    );
    return true;
  } catch {
    return false;
  }
});

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}
window.addEventListener("beforeunload", warnBeforeUnload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnBeforeUnload));

onMounted(() => {
  const section = String(route.query.section || "");
  if (sections.value.some((item) => item.id === section)) {
    activeSection.value = section as SettingsSection;
  }
  void load();
});
</script>

<template>
  <div v-loading="loading" class="page settings-page">
    <aside class="settings-nav" aria-label="系统设置分组">
      <p class="settings-nav__title">设置分组</p>
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        class="settings-nav__item"
        :class="{ 'is-active': activeSection === item.id }"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        @click="activeSection = item.id"
      >
        <span class="settings-nav__icon"><component :is="item.icon" /></span>
        <span class="settings-nav__copy">
          <strong>{{ item.label }}</strong>
          <small>{{ item.hint }}</small>
        </span>
        <em v-if="warningCount(item.id)" class="settings-nav__warn" :title="`${warningCount(item.id)} 条配置提醒`">{{ warningCount(item.id) }}</em>
        <i v-else class="settings-nav__dot" :class="{ 'is-on': item.on }" :title="item.on ? '已启用' : '未启用'" />
      </button>
    </aside>

    <section class="settings-main">
      <header class="settings-head">
        <span class="settings-head__icon"><component :is="activeSectionMeta.icon" /></span>
        <div class="settings-head__copy">
          <h2>{{ activeSectionMeta.label }}</h2>
          <p>{{ activeSectionMeta.desc }}</p>
        </div>
        <div class="settings-head__actions">
          <span class="sync-state" :class="{ 'is-dirty': isDirty }"><i />{{ isDirty ? "有未保存变更" : "配置已同步" }}</span>
          <el-button :icon="Refresh" @click="load">刷新</el-button>
          <el-button type="primary" :icon="Check" :loading="saving" :disabled="!isDirty" @click="save">保存并生效</el-button>
        </div>
      </header>

          <div class="pane-body">
            <div v-if="sectionWarnings.length" class="warn-box" role="alert">
              <strong>配置提醒</strong>
              <ul><li v-for="item in sectionWarnings" :key="item.text">{{ item.text }}</li></ul>
            </div>
            <template v-if="activeSection === 'payment'">
      <div class="settings-card">
        <div
          class="status-banner"
          :class="{
            'is-on': form.lanjingPayEnabled,
            'is-warn': paymentTest && !paymentTest.online,
          }"
        >
          <div class="status-banner__copy">
            <span class="status-banner__dot" />
            <div>
              <strong>蓝鲸支付</strong>
              <p>{{ paymentStateLabel }}</p>
            </div>
          </div>
          <el-switch v-model="form.lanjingPayEnabled" />
        </div>

        <div class="field-grid">
          <label class="field-row is-wide">
            <span>
              <strong>接口地址</strong>
              <small>蓝鲸支付商户实例</small>
            </span>
            <el-input
              v-model="form.lanjingPayBaseUrl"
              placeholder="https://2347537.pay.lanjingzf.com"
            />
          </label>
          <label class="field-row is-wide">
            <span>
              <strong>通讯密钥</strong>
              <small>保存时加密，掩码原样保存不换钥</small>
            </span>
            <el-input
              v-model="form.lanjingPaySecret"
              type="password"
              show-password
              autocomplete="new-password"
              placeholder="输入商户后台通讯密钥"
            />
          </label>
          <label class="field-row is-wide">
            <span>
              <strong>异步回调</strong>
              <small>生产环境须为公网 HTTPS</small>
            </span>
            <el-input
              v-model="form.lanjingPayNotifyUrl"
              placeholder="https://你的域名/api/v1/payments/lanjing/notify"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>请求超时</strong>
              <small>创建、查询和关闭订单</small>
            </span>
            <div class="field-unit">
              <el-input-number
                v-model="form.lanjingPayTimeoutSecs"
                :min="1"
                :max="60"
                :precision="0"
              />
              <em>秒</em>
            </div>
          </label>
          <div class="field-row">
            <span>
              <strong>支付方式</strong>
              <small>价格页只展示已开放渠道</small>
            </span>
            <div class="method-pills">
              <label class="method-pill" :class="{ 'is-on': form.lanjingPayAlipayEnabled }">
                <el-checkbox v-model="form.lanjingPayAlipayEnabled">支付宝</el-checkbox>
              </label>
              <label class="method-pill" :class="{ 'is-on': form.lanjingPayWechatEnabled }">
                <el-checkbox v-model="form.lanjingPayWechatEnabled">微信</el-checkbox>
              </label>
            </div>
          </div>
        </div>

        <div class="pay-test">
          <div v-if="paymentTest" class="pay-test__meta">
            <span>最近心跳 <b class="tnum">{{ formatPaymentTime(paymentTest.lastHeartbeatAt) }}</b></span>
            <span>最近收款 <b class="tnum">{{ formatPaymentTime(paymentTest.lastPaymentAt) }}</b></span>
          </div>
          <p v-else>连接测试只查询监听状态，不创建支付订单</p>
          <el-button
            :icon="Connection"
            :loading="testingPayment"
            @click="testPaymentConnection"
          >
            测试连接
          </el-button>
        </div>
      </div>
            </template>

            <template v-else-if="activeSection === 'image-ai'">
              <div class="settings-card image-ai-card">
                <div
                  class="status-banner"
                  :class="{
                    'is-on': imageAnalysisReady,
                    'is-warn':
                      imageAnalysisConfigured && !imageAnalysisReady,
                  }"
                >
                  <div class="status-banner__copy">
                    <span class="status-banner__dot" />
                    <div>
                      <strong>后台图片分析</strong>
                      <p>
                        {{
                          imageAnalysisReady && selectedImageAnalysisModel
                            ? `已就绪 · 使用 ${selectedImageAnalysisModel.name}`
                            : imageAnalysisCopy.summary
                        }}
                      </p>
                    </div>
                  </div>
                  <el-button
                    v-if="imageAnalysisConfigured"
                    text
                    @click="clearImageAnalysis"
                  >
                    清除配置
                  </el-button>
                </div>

                <div class="usage-grid" aria-label="使用位置">
                  <RouterLink class="usage-tile" to="/ecommerce">
                    <strong>电商素材</strong>
                    <small>上传时生成图片标题</small>
                  </RouterLink>
                  <RouterLink class="usage-tile" to="/canvas-templates">
                    <strong>画布模板</strong>
                    <small>导入模板时分析结构</small>
                  </RouterLink>
                  <RouterLink class="usage-tile" to="/prompt-library">
                    <strong>提示词导入</strong>
                    <small>批量封面与条目分析</small>
                  </RouterLink>
                </div>

                <div class="field-grid image-ai-fields">
                  <label class="field-row">
                    <span>
                      <strong>服务商</strong>
                      <small>从模型目录选择已启用的服务商</small>
                    </span>
                    <el-select
                      v-model="form.adminImageAnalysisProviderId"
                      clearable
                      filterable
                      placeholder="选择服务商"
                      @change="changeImageAnalysisProvider"
                    >
                      <el-option
                        v-for="provider in modelDirectory.providers"
                        :key="provider.id"
                        :label="providerOptionLabel(provider)"
                        :value="provider.id"
                        :disabled="!provider.enabled"
                      />
                    </el-select>
                  </label>
                  <label class="field-row">
                    <span>
                      <strong>图片理解模型</strong>
                      <small>请选择支持视觉输入的对话模型</small>
                    </span>
                    <el-select
                      v-model="form.adminImageAnalysisModelId"
                      clearable
                      filterable
                      :disabled="!form.adminImageAnalysisProviderId"
                      :placeholder="
                        form.adminImageAnalysisProviderId
                          ? imageAnalysisModels.length
                            ? '选择模型'
                            : '该服务商没有对话模型'
                          : '先选择服务商'
                      "
                      @change="changeImageAnalysisModel"
                    >
                      <el-option
                        v-for="model in imageAnalysisModels"
                        :key="model.id"
                        :label="modelOptionLabel(model)"
                        :value="model.id"
                        :disabled="!model.enabled"
                      />
                    </el-select>
                  </label>
                  <div class="field-row is-wide">
                    <span>
                      <strong>推理强度</strong>
                      <small>随分析请求发送；留空则用模型默认</small>
                    </span>
                    <div
                      v-if="imageAnalysisReasoningEfforts.length"
                      class="method-pills"
                    >
                      <button
                        v-for="effort in imageAnalysisReasoningEfforts"
                        :key="effort"
                        type="button"
                        class="method-pill"
                        :class="{
                          'is-on':
                            form.adminImageAnalysisReasoningEffort === effort,
                        }"
                        @click="toggleImageAnalysisReasoning(effort)"
                      >
                        {{ reasoningEffortLabel(effort) }}
                      </button>
                    </div>
                    <em v-else class="field-empty">
                      当前模型不支持单独设置推理强度
                    </em>
                  </div>
                </div>

                <div
                  v-if="selectedImageAnalysisModel"
                  class="model-identity"
                  :class="{ 'is-off': !imageAnalysisReady }"
                >
                  <div>
                    <strong>{{ selectedImageAnalysisModel.name }}</strong>
                    <small class="mono">
                      {{ selectedImageAnalysisModel.upstreamModel }}
                    </small>
                  </div>
                  <div class="model-identity__meta">
                    <span>{{
                      selectedImageAnalysisProvider?.name || "未知服务商"
                    }}</span>
                    <span>{{
                      selectedImageAnalysisModel.enabled ? "已启用" : "已停用"
                    }}</span>
                    <span>{{ selectedReasoningEffortLabel }}</span>
                  </div>
                </div>

                <div class="jump-row">
                  <RouterLink class="jump-chip" to="/model-config">
                    打开模型配置
                  </RouterLink>
                  <span class="jump-note">
                    {{ enabledChatModelCount.toLocaleString("zh-CN") }} 个可用对话模型
                    ·
                    {{ enabledProviderCount.toLocaleString("zh-CN") }} 个启用服务商
                  </span>
                </div>
              </div>
            </template>

            <template v-else-if="activeSection === 'logging'">
              <div class="settings-card">
                <div class="status-banner" :class="{ 'is-on': form.platformLoggingEnabled }">
                  <div class="status-banner__copy">
                    <span class="status-banner__dot" />
                    <div>
                      <strong>{{ form.platformLoggingEnabled ? "平台日志已开启" : "平台日志已关闭" }}</strong>
                      <p>{{ form.platformLoggingEnabled ? "按分类保存脱敏事件并自动清理" : "不创建日志队列，不写平台日志表" }}</p>
                    </div>
                  </div>
                  <el-switch v-model="form.platformLoggingEnabled" />
                </div>

                <div class="field-grid is-stack">
                  <label class="field-row">
                    <span>
                      <strong>安全日志</strong>
                      <small>登录、鉴权失败、限流与异常访问</small>
                    </span>
                    <el-switch v-model="form.platformLogSecurityEnabled" :disabled="!form.platformLoggingEnabled" />
                  </label>
                  <label class="field-row">
                    <span>
                      <strong>运维日志</strong>
                      <small>任务阶段、重试、上游错误与慢请求</small>
                    </span>
                    <el-switch v-model="form.platformLogOperationsEnabled" :disabled="!form.platformLoggingEnabled" />
                  </label>
                  <label class="field-row">
                    <span>
                      <strong>用户日志</strong>
                      <small>用户创建、修改和删除操作，不记录请求内容</small>
                    </span>
                    <el-switch v-model="form.platformLogUserEnabled" :disabled="!form.platformLoggingEnabled" />
                  </label>
                  <label class="field-row">
                    <span>
                      <strong>自动保留</strong>
                      <small>每小时删除超过保留期的最旧日志</small>
                    </span>
                    <div class="field-unit">
                      <el-input-number v-model="form.platformLogRetentionDays" :min="1" :max="90" :precision="0" />
                      <em>天</em>
                    </div>
                  </label>
                  <label class="field-row">
                    <span>
                      <strong>容量上限</strong>
                      <small>达到后优先删除最旧记录</small>
                    </span>
                    <div class="field-unit">
                      <el-input-number v-model="form.platformLogMaxMb" :min="32" :max="4096" :step="32" :precision="0" />
                      <em>MB</em>
                    </div>
                  </label>
                  <label class="field-row">
                    <span>
                      <strong>操作审计保留</strong>
                      <small>管理员操作记录，每小时删除超过保留期的记录；不受上方日志开关影响</small>
                    </span>
                    <div class="field-unit">
                      <el-input-number v-model="form.auditLogRetentionDays" :min="7" :max="365" :precision="0" />
                      <em>天</em>
                    </div>
                  </label>
                </div>

                <div class="jump-row">
                  <RouterLink class="jump-chip" to="/platform-logs">打开运行日志与容量</RouterLink>
                  <span class="jump-note">关闭总开关后，核心错误仍写入受限的 Docker 容器日志</span>
                </div>
              </div>
            </template>

            <template v-else-if="activeSection === 'account'">
      <div class="settings-card">
        <div class="status-banner" :class="{ 'is-on': form.registrationEnabled }">
          <div class="status-banner__copy">
            <span class="status-banner__dot" />
            <div>
              <strong>{{ form.registrationEnabled ? "开放注册" : "注册已关闭" }}</strong>
              <p>{{ form.registrationEnabled ? "新用户可以从前台注册入口加入" : "前台注册入口关闭，已有账号不受影响" }}</p>
            </div>
          </div>
          <el-switch v-model="form.registrationEnabled" />
        </div>
        <div class="field-grid">
          <label class="field-row is-wide">
            <span>
              <strong>注册赠送</strong>
              <small>新账号首次获得的积分</small>
            </span>
            <div class="field-unit">
              <el-input-number
                v-model="form.signupBonusPoints"
                :min="0"
                :max="1000000"
                :step="1"
                :precision="0"
              />
              <em>积分</em>
            </div>
          </label>
        </div>
        <div class="jump-row">
          <RouterLink class="jump-chip" to="/checkin-activity">签到活动</RouterLink>
          <UserProfileRulesDialog />
          <RouterLink class="jump-chip" to="/growth-groups">好友拼团</RouterLink>
          <RouterLink class="jump-chip" to="/trial-applications">体验活动</RouterLink>
        </div>
      </div>
            </template>

            <template v-else-if="activeSection === 'growth'">
      <div class="settings-card">
        <div class="field-grid">
          <label class="field-row">
            <span>
              <strong>失败额外补偿</strong>
              <small>任务费用仍全额退回，再发安抚积分</small>
            </span>
            <el-switch v-model="form.growthFailureBonusEnabled" />
          </label>
          <label class="field-row">
            <span>
              <strong>单次补偿</strong>
              <small>仅真实上游失败，强制终止不发</small>
            </span>
            <div class="field-unit">
              <el-input-number
                v-model="form.growthFailureBonusPoints"
                :min="0"
                :max="1000000"
                :precision="0"
              />
              <em>积分</em>
            </div>
          </label>
          <label class="field-row">
            <span>
              <strong>每日补偿次数</strong>
              <small>按用户限制，0 表示当天不发</small>
            </span>
            <el-input-number
              v-model="form.growthFailureBonusDailyLimit"
              :min="0"
              :max="100"
              :precision="0"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>建议采纳上限</strong>
              <small>单次最高奖励</small>
            </span>
            <div class="field-unit">
              <el-input-number
                v-model="form.suggestionRewardMaxPoints"
                :min="0"
                :max="1000000"
                :step="100"
                :precision="0"
              />
              <em>积分</em>
            </div>
          </label>
        </div>

        <div class="usage-block">
          <header>
            <div>
              <strong>用量计划档位</strong>
              <small>按自然月累计成功交付图片数，达标自动发放</small>
            </div>
            <div class="usage-block__actions">
              <span class="usage-total tnum">总奖励 {{ usageRewardTotal.toLocaleString("zh-CN") }} 积分</span>
              <el-switch v-model="form.growthUsageRewardsEnabled" />
              <el-button
                :icon="Plus"
                :disabled="form.growthUsageMilestones.length >= 12"
                @click="addUsageMilestone"
              >
                添加
              </el-button>
            </div>
          </header>
          <div class="milestone-list">
            <div
              v-for="(milestone, index) in form.growthUsageMilestones"
              :key="index"
              class="milestone-row"
            >
              <span class="milestone-index tnum">{{ index + 1 }}</span>
              <label>
                <span>累计交付</span>
                <el-input-number
                  v-model="milestone.units"
                  :min="1"
                  :max="1000000"
                  :precision="0"
                />
                <em>张</em>
              </label>
              <label>
                <span>奖励</span>
                <el-input-number
                  v-model="milestone.rewardCents"
                  :min="1"
                  :max="1000000"
                  :precision="0"
                />
                <em>积分</em>
              </label>
              <el-button
                circle
                text
                type="danger"
                :icon="Delete"
                :disabled="form.growthUsageMilestones.length <= 1"
                aria-label="删除里程碑"
                @click="removeUsageMilestone(index)"
              />
            </div>
          </div>
        </div>
      </div>
            </template>

            <template v-else-if="activeSection === 'concurrency'">
      <div class="settings-card">
        <header class="card-head"><strong>并发额度</strong><small>同时执行的图片张数与对话次数</small></header>
        <div class="field-grid is-stack">
          <label class="field-row">
            <span>
              <strong>全站图片并发（张）</strong>
              <small>全部生图场景共享，按实际图片数量占用</small>
            </span>
            <el-input-number
              v-model="form.globalMaxConcurrentTasks"
              :min="1"
              :max="10000000"
              :step="1"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>个人基础图片并发（张）</strong>
              <small>生图、助手生图、画布和 API 共用；订阅增加图片额度</small>
            </span>
            <el-input-number
              v-model="form.userMaxConcurrentTasks"
              :min="1"
              :max="10000"
            />
          </label>
          <label class="field-row">
            <span><strong>全站对话并发（次）</strong><small>对话单独占用额度，不计入图片并发</small></span>
            <el-input-number v-model="form.globalMaxConcurrentChats" :min="1" :max="10000000" />
          </label>
          <label class="field-row">
            <span><strong>个人对话并发（次）</strong><small>同一账号允许同时执行的对话次数</small></span>
            <el-input-number v-model="form.userMaxConcurrentChats" :min="1" :max="10000" />
          </label>
        </div>
      </div>
      <div class="settings-card">
        <header class="card-head"><strong>排队容量</strong><small>排队与运行合计达到上限后停止接收新任务</small></header>
        <div class="field-grid is-stack">
          <label class="field-row">
            <span>
              <strong>全站待处理容量</strong>
              <small>排队与运行达到后停收</small>
            </span>
            <el-input-number
              v-model="form.globalMaxActiveTasks"
              :min="10"
              :max="10000000"
              :step="100"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>全站图片容量</strong>
              <small>按任务 count 累计</small>
            </span>
            <el-input-number
              v-model="form.globalMaxActiveImages"
              :min="10"
              :max="10000000"
              :step="100"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>单用户待处理任务</strong>
              <small>运行中与排队总量</small>
            </span>
            <el-input-number
              v-model="form.userMaxRunningTasks"
              :min="1"
              :max="10000"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>单用户图片容量</strong>
              <small>排队与运行图片单位</small>
            </span>
            <el-input-number
              v-model="form.userMaxRunningImages"
              :min="1"
              :max="100000"
              :step="10"
            />
          </label>
        </div>
      </div>
      <div class="settings-card">
        <header class="card-head"><strong>输入字数</strong><small>前台各输入框允许的最大字数</small></header>
        <div class="field-grid is-stack">
          <label class="field-row">
            <span>
              <strong>文生图提示词字数</strong>
              <small>文生图输入框上限</small>
            </span>
            <el-input-number v-model="form.t2iPromptMaxChars" :min="100" :max="100000" :step="100" />
          </label>
          <label class="field-row">
            <span>
              <strong>AI 助手消息字数</strong>
              <small>助手单条用户消息上限</small>
            </span>
            <el-input-number v-model="form.assistantMessageMaxChars" :min="100" :max="100000" :step="100" />
          </label>
          <label class="field-row">
            <span>
              <strong>创作台描述字数</strong>
              <small>创作台首页输入框上限</small>
            </span>
            <el-input-number v-model="form.studioHubPromptMaxChars" :min="100" :max="100000" :step="100" />
          </label>
        </div>
      </div>
            </template>

            <template v-else-if="activeSection === 'image-processing'">
              <div class="settings-card">
                <div class="field-grid is-stack">
                  <label class="field-row">
                    <span><strong>压缩格式</strong><small>展示图和缩略图使用的格式，下载始终使用原图</small></span>
                    <el-radio-group v-model="form.imageVariantFormat"><el-radio-button value="webp">WebP</el-radio-button><el-radio-button value="png">PNG</el-radio-button></el-radio-group>
                  </label>
                  <label class="field-row">
                    <span><strong>展示图无损压缩</strong><small>仅 WebP 生效，PNG 始终无损</small></span>
                    <el-switch v-model="form.imageDisplayLossless" :disabled="form.imageVariantFormat !== 'webp'" />
                  </label>
                  <label class="field-row">
                    <span><strong>展示图质量</strong><small>仅有损 WebP 生效</small></span>
                    <el-input-number v-model="form.imageDisplayQuality" :min="1" :max="100" :precision="0" :disabled="form.imageVariantFormat !== 'webp' || form.imageDisplayLossless" />
                  </label>
                  <label class="field-row">
                    <span><strong>展示图最长边</strong><small>超出后等比缩小，单位为像素</small></span>
                    <el-input-number v-model="form.imageDisplayMaxEdge" :min="512" :max="8192" :step="256" :precision="0" />
                  </label>
                  <label class="field-row">
                    <span><strong>缩略图最长边</strong><small>列表预览尺寸，单位为像素</small></span>
                    <el-input-number v-model="form.imageThumbMaxEdge" :min="128" :max="1024" :step="64" :precision="0" />
                  </label>
                  <label class="field-row">
                    <span><strong>图片下载并发</strong><small>单个任务同时拉取上游结果的图片数量</small></span>
                    <el-input-number v-model="form.imageFetchConcurrency" :min="1" :max="32" :precision="0" />
                  </label>
                </div>
              </div>
            </template>

            <template v-else>
      <div class="settings-card">
        <header class="card-head"><strong>失败重试</strong><small>连接、超时或临时上游错误时自动重试</small></header>
        <div class="field-grid is-stack">
          <label class="field-row">
            <span>
              <strong>任务失败重试</strong>
              <small>连接、超时或临时上游错误；0 不重试</small>
            </span>
            <el-input-number
              v-model="form.taskFailureRetryCount"
              :min="0"
              :max="100"
              :precision="0"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>首次重试等待</strong>
              <small>第一次重试前的等待</small>
            </span>
            <div class="field-unit">
              <el-input-number
                v-model="form.taskRetryFirstDelaySecs"
                :min="1"
                :max="600"
                :precision="0"
              />
              <em>秒</em>
            </div>
          </label>
          <label class="field-row">
            <span>
              <strong>后续重试间隔</strong>
              <small>第 N 次等待 (N-1)×该值 秒</small>
            </span>
            <div class="field-unit">
              <el-input-number
                v-model="form.taskRetryBackoffSecs"
                :min="1"
                :max="600"
                :step="5"
                :precision="0"
              />
              <em>秒</em>
            </div>
          </label>
        </div>
      </div>
      <div class="settings-card">
        <header class="card-head"><strong>负载均衡</strong><small>上游拥堵时把请求分摊到其他服务商</small></header>
        <div class="field-grid is-stack">
          <label class="field-row">
            <span>
              <strong>同名模型跨服务商泄压</strong>
              <small>同类型、同名称、同积分且参数兼容才参与</small>
            </span>
            <el-switch v-model="form.crossProviderSameModelBalancingEnabled" />
          </label>
        </div>
        <div class="explain">
          <div class="explain__item">
            <strong>作用</strong>
            <p>
              某家服务商的并发额度用满时，新任务可以改用另一家服务商上的同名模型执行，不用排队等待。
              关闭时，任务只在用户选定的服务商上执行，满载就排队。
            </p>
          </div>
          <div class="explain__item">
            <strong>借用条件（需全部满足）</strong>
            <ul>
              <li>另一家的模型已启用、已公开且当前可用</li>
              <li>类型相同：都是生图，或都是对话</li>
              <li>模型名称相同（不区分大小写）</li>
              <li>积分价格完全一致，仍按用户下单时的价格扣费</li>
            </ul>
          </div>
          <div class="explain__item">
            <strong>生效时机</strong>
            <p>
              可借用哪些服务商在用户提交任务时就已确定。修改开关只影响之后新提交的任务，
              已在排队的任务仍按提交时的条件执行。
            </p>
          </div>
        </div>
      </div>
            </template>
          </div>

      <transition name="save-bar">
        <div v-if="isDirty" class="save-bar" role="status">
          <span><i />有未保存的更改，保存后立即对全站生效</span>
          <el-button text @click="discardChanges">撤销更改</el-button>
          <el-button type="primary" :icon="Check" :loading="saving" @click="save">保存并生效</el-button>
        </div>
      </transition>
    </section>

    <AdminDialog
      v-model="confirmOpen"
      title="确认保存系统设置"
      :subtitle="`共 ${pendingChanges.length} 项改动，保存后立即对全站生效`"
      :icon="Check"
      width="560px"
      :confirm-text="dangerCount ? `确认保存（含 ${dangerCount} 项高影响改动）` : '确认保存'"
      :confirm-loading="saving"
      @confirm="commitSave"
    >
      <ul class="change-list">
        <li v-for="change in pendingChanges" :key="change.key" :class="{ 'is-danger': change.danger }">
          <div class="change-list__line">
            <span class="change-list__section">{{ change.section }}</span>
            <strong>{{ change.label }}</strong>
            <span class="change-list__diff">
              <template v-if="change.from"><s>{{ change.from }}</s><em>→</em></template>
              <b>{{ change.to }}</b>
            </span>
          </div>
          <p v-if="change.danger" class="change-list__danger">⚠ {{ change.danger }}</p>
        </li>
      </ul>
      <p v-if="warnings.length" class="change-list__warnings">另有 {{ warnings.length }} 条配置提醒未处理，可以照常保存。</p>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
/* 系统设置：左侧分组导航 + 右侧表单，各自滚动；无嵌套边框，跟随后台主题 */
.settings-page {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 2px;
}

/* ---------- 左侧导航 ---------- */
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  padding: 14px 10px;
  overflow-y: auto;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 10px 26px -16px rgb(0 0 0 / 0.2);
}
html.dark .settings-nav { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 12px 30px -18px rgb(0 0 0 / 0.7); }
.settings-nav__title { margin: 0 8px 8px; color: var(--ink-3); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; }
.settings-nav__item {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 8px;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.settings-nav__item:hover { background: var(--surface-2); color: var(--ink); }
.settings-nav__item:focus { outline: none; }
/* 键盘焦点：柔和的细描边；选中项本身已有底色和色条，不再叠加粗框 */
.settings-nav__item:focus-visible { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
.settings-nav__item.is-active { background: color-mix(in srgb, var(--accent) 13%, var(--surface-2)); color: var(--ink); }
.settings-nav__item.is-active::before { content: ''; position: absolute; top: 10px; bottom: 10px; left: 0; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
.settings-nav__icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--surface-2); color: var(--ink-2); transition: background 0.15s ease, color 0.15s ease; }
.settings-nav__icon svg { width: 17px; height: 17px; }
.settings-nav__item.is-active .settings-nav__icon { background: var(--accent); color: var(--accent-on); box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent) 70%, transparent); }
.settings-nav__copy { display: grid; gap: 1px; min-width: 0; }
.settings-nav__copy strong { color: inherit; font-size: 13px; font-weight: 650; }
.settings-nav__copy small { overflow: hidden; color: var(--ink-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.settings-nav__dot { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in srgb, var(--ink-3) 45%, transparent); }
.settings-nav__dot.is-on { background: var(--success); box-shadow: 0 0 0 3px var(--success-soft); }

/* ---------- 右侧主区 ---------- */
.settings-main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.settings-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  border-radius: 18px;
  background:
    radial-gradient(70% 140% at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%),
    var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 10px 26px -16px rgb(0 0 0 / 0.2);
}
html.dark .settings-head { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05), 0 12px 30px -18px rgb(0 0 0 / 0.7); }
.settings-head__icon {
  display: grid; flex: 0 0 auto; place-items: center; width: 44px; height: 44px; border-radius: 14px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 85%, #fff), color-mix(in srgb, var(--accent) 70%, #000));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.45), 0 8px 18px -8px color-mix(in srgb, var(--accent) 70%, transparent);
  color: var(--accent-on);
}
.settings-head__icon svg { width: 22px; height: 22px; }
.settings-head__copy { flex: 1; min-width: 0; }
.settings-head__copy h2 { margin: 0; color: var(--ink); font-size: 20px; font-weight: 750; letter-spacing: -0.01em; }
.settings-head__copy p { margin: 3px 0 0; color: var(--ink-3); font-size: 13px; }
.settings-head__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.settings-head__actions :deep(.el-button) { margin: 0; }
.sync-state { display: inline-flex; align-items: center; gap: 6px; margin-right: 4px; color: var(--ink-3); font-size: 12px; font-weight: 600; white-space: nowrap; }
.sync-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.sync-state.is-dirty { color: var(--warning); }
.sync-state.is-dirty i { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-soft); }

.pane-body { display: flex; flex: 1; flex-direction: column; gap: 14px; min-height: 0; padding: 14px 2px 90px; overflow-y: auto; }

/* ---------- 卡片 ---------- */
.settings-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 22px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 10px 26px -16px rgb(0 0 0 / 0.2);
}
html.dark .settings-card { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 12px 30px -18px rgb(0 0 0 / 0.7); }
.card-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: -4px; }
.card-head strong { color: var(--ink); font-size: 15px; font-weight: 700; }
.card-head small { color: var(--ink-3); font-size: 12px; }

/* 状态横幅：开关类总控 */
.status-banner {
  --tone: var(--ink-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface-2);
}
.status-banner.is-on { --tone: var(--success); background: color-mix(in srgb, var(--success) 9%, var(--surface-2)); }
.status-banner.is-warn { --tone: var(--warning); background: color-mix(in srgb, var(--warning) 10%, var(--surface-2)); }
.status-banner__copy { display: flex; align-items: center; gap: 12px; min-width: 0; }
.status-banner__dot { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; background: var(--tone); box-shadow: 0 0 0 4px color-mix(in srgb, var(--tone) 18%, transparent); }
.status-banner strong { display: block; color: var(--ink); font-size: 14px; font-weight: 700; }
.status-banner p { margin: 2px 0 0; color: var(--ink-2); font-size: 12px; }

/* 表单行：左说明、右控件 */
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; }
.field-grid.is-stack { grid-template-columns: minmax(0, 1fr); }
.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  min-height: 60px;
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink-3) 14%, transparent);
}
.field-grid.is-stack .field-row:last-child { border-bottom: 0; }
.field-row.is-wide { grid-column: 1 / -1; grid-template-columns: minmax(200px, 0.8fr) minmax(0, 1.6fr); }
.field-row > span:first-child { display: grid; gap: 3px; min-width: 0; }
.field-row > span:first-child strong { color: var(--ink); font-size: 14px; font-weight: 600; }
.field-row > span:first-child small { color: var(--ink-3); font-size: 12px; line-height: 1.45; }
.field-row :deep(.el-input-number) { width: 180px; }
.field-row :deep(.el-select) { width: 280px; }
.field-row.is-wide :deep(.el-input), .field-row.is-wide :deep(.el-select) { width: 100%; }
.field-unit { display: inline-flex; align-items: center; gap: 8px; }
.field-unit em { min-width: 28px; color: var(--ink-3); font-size: 12px; font-style: normal; }
.field-empty { justify-self: end; color: var(--ink-3); font-size: 12px; font-style: normal; text-align: right; }
.field-row.is-wide > .method-pills { justify-self: end; }

/* 选择胶囊：支付方式 / 推理强度 */
.method-pills { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.method-pill {
  display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border: 0; border-radius: 999px;
  background: var(--surface-2); color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.method-pill:hover { color: var(--ink); }
.method-pill.is-on { background: var(--accent-soft); color: var(--accent-ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
.method-pill :deep(.el-checkbox) { height: auto; margin: 0; color: inherit; }
.method-pill :deep(.el-checkbox__label) { color: inherit; font-weight: 600; }

/* 支付测试 */
.pay-test { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-radius: 14px; background: var(--surface-2); color: var(--ink-3); font-size: 12px; }
.pay-test p { margin: 0; }
.pay-test__meta { display: flex; gap: 20px; }
.pay-test__meta b { margin-left: 4px; color: var(--ink); font-weight: 650; }

/* AI 模型：使用位置、模型身份 */
.usage-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.usage-tile {
  display: grid; gap: 3px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); color: inherit; text-decoration: none;
  transition: background 0.15s ease, transform 0.15s ease;
}
.usage-tile:hover { background: color-mix(in srgb, var(--accent) 10%, var(--surface-2)); transform: translateY(-1px); }
.usage-tile strong { color: var(--ink); font-size: 13px; font-weight: 650; }
.usage-tile small { color: var(--ink-3); font-size: 12px; }
.model-identity { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-radius: 14px; background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); }
.model-identity.is-off { background: var(--surface-2); }
.model-identity > div:first-child { display: grid; gap: 2px; }
.model-identity strong { color: var(--ink); font-size: 14px; font-weight: 700; }
.model-identity small { color: var(--ink-3); font-size: 12px; }
.model-identity__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.model-identity__meta span { padding: 3px 10px; border-radius: 999px; background: var(--surface); color: var(--ink-2); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

/* 功能说明 */
.explain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.explain__item { display: grid; align-content: start; gap: 6px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); }
.explain__item strong { color: var(--ink); font-size: 13px; font-weight: 650; }
.explain__item p { margin: 0; color: var(--ink-2); font-size: 12px; line-height: 1.6; }
.explain__item ul { display: grid; gap: 3px; margin: 0; padding-left: 16px; color: var(--ink-2); font-size: 12px; line-height: 1.5; }

/* 跳转入口 */
.jump-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 2px; }
.jump-chip, .jump-row :deep(.el-button) {
  display: inline-flex; align-items: center; height: 32px; margin: 0; padding: 0 14px; border: 0; border-radius: 999px;
  background: var(--surface-2); color: var(--ink-2); font-size: 12px; font-weight: 600; text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}
.jump-chip::after { content: '→'; margin-left: 6px; opacity: 0.6; }
.jump-chip:hover, .jump-row :deep(.el-button:hover) { background: var(--accent-soft); color: var(--accent-ink); }
.jump-note { color: var(--ink-3); font-size: 12px; }

/* 用量里程碑 */
.usage-block { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 14px; background: var(--surface-2); }
.usage-block > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.usage-block > header > div:first-child { display: grid; gap: 2px; }
.usage-block > header strong { color: var(--ink); font-size: 14px; font-weight: 700; }
.usage-block > header small { color: var(--ink-3); font-size: 12px; }
.usage-block__actions { display: flex; align-items: center; gap: 12px; }
.usage-block__actions :deep(.el-button) { margin: 0; }
.usage-total { padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); font-size: 12px; font-weight: 700; }
.milestone-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 8px; }
.milestone-row { display: grid; grid-template-columns: 28px 1fr 1fr 32px; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 12px; background: var(--surface); }
.milestone-index { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--accent-soft); color: var(--accent-ink); font-size: 12px; font-weight: 750; }
.milestone-row label { display: flex; align-items: center; gap: 8px; min-width: 0; }
.milestone-row label > span { color: var(--ink-3); font-size: 12px; white-space: nowrap; }
.milestone-row label em { color: var(--ink-3); font-size: 12px; font-style: normal; }
.milestone-row :deep(.el-input-number) { width: 120px; }

/* ---------- 底部保存栏 ---------- */
.save-bar {
  position: absolute; right: 50%; bottom: 18px; z-index: 5;
  display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 18px;
  border-radius: 999px; background: var(--ink); color: var(--surface); font-size: 13px; font-weight: 600;
  box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.45);
  transform: translateX(50%);
}
html.dark .save-bar { background: var(--surface-3); color: var(--ink); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08), 0 18px 40px -12px rgb(0 0 0 / 0.8); }
.save-bar > span { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.save-bar > span i { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
.save-bar :deep(.el-button) { margin: 0; border-radius: 999px; }
.save-bar :deep(.el-button.is-text) { color: inherit; opacity: 0.8; }
.save-bar-enter-active, .save-bar-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.save-bar-enter-from, .save-bar-leave-to { opacity: 0; transform: translate(50%, 12px); }
@media (prefers-reduced-motion: reduce) { .save-bar-enter-active, .save-bar-leave-active { transition: none; } }

/* 配置提醒 */
.settings-nav__warn { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--warning-soft); color: var(--warning); font-size: 11px; font-style: normal; font-weight: 700; }
.warn-box { padding: 12px 16px; border-radius: 14px; background: var(--warning-soft); color: var(--ink-2); font-size: 13px; }
.warn-box strong { display: block; margin-bottom: 4px; color: var(--warning); font-size: 13px; }
.warn-box ul { margin: 0; padding-left: 18px; }
.warn-box li + li { margin-top: 2px; }

/* 保存确认清单 */
.change-list { display: grid; gap: 6px; max-height: 50vh; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.change-list li { padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
.change-list li.is-danger { background: var(--danger-soft); }
.change-list__line { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 13px; }
.change-list__section { padding: 2px 8px; border-radius: 999px; background: var(--surface); color: var(--ink-3); font-size: 11px; white-space: nowrap; }
.change-list__line strong { overflow: hidden; color: var(--ink); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.change-list__diff { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; overflow: hidden; white-space: nowrap; }
.change-list__diff s { overflow: hidden; color: var(--ink-3); text-overflow: ellipsis; }
.change-list__diff em { color: var(--ink-3); font-style: normal; }
.change-list__diff b { overflow: hidden; color: var(--ink); font-weight: 700; text-overflow: ellipsis; }
.change-list__danger { margin: 6px 0 0; color: var(--danger); font-size: 12px; font-weight: 600; }
.change-list__warnings { margin: 10px 0 0; color: var(--warning); font-size: 12px; }

@media (max-width: 1400px) {
  .settings-page { grid-template-columns: 220px minmax(0, 1fr); }
  .field-grid { grid-template-columns: minmax(0, 1fr); }
  .explain { grid-template-columns: minmax(0, 1fr); }
  .sync-state { display: none; }
}
</style>
