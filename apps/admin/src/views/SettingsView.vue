<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { Check, Connection, Delete, Plus, Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { request } from "@/request";
import { normalizePoints } from "@/utils";
import type { AdminSettings, GrowthMilestone } from "@/components/settings/types";

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
  | "growth"
  | "concurrency"
  | "logging"
  | "retry";

const route = useRoute();
const loading = ref(false);
const activeSection = ref<SettingsSection>("payment");
const saving = ref(false);
const savedSignature = ref("");
const workerConcurrencyCeiling = ref(1);
const testingPayment = ref(false);
const paymentTest = ref<PaymentTestResult | null>(null);
const modelDirectory = ref<ModelDirectory>({ providers: [], models: [] });

const form = reactive({
  userMaxRunningTasks: 100,
  userMaxRunningImages: 400,
  userMaxConcurrentTasks: 20,
  globalMaxConcurrentTasks: 2000,
  globalMaxActiveTasks: 12000,
  globalMaxActiveImages: 12000,
  taskFailureRetryCount: 2,
  taskRetryFirstDelaySecs: 3,
  taskRetryBackoffSecs: 15,
  crossProviderSameModelBalancingEnabled: false,
  platformLoggingEnabled: false,
  platformLogSecurityEnabled: true,
  platformLogOperationsEnabled: true,
  platformLogUserEnabled: false,
  platformLogRetentionDays: 7,
  platformLogMaxMb: 256,
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
    globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
    globalMaxActiveTasks: form.globalMaxActiveTasks,
    globalMaxActiveImages: form.globalMaxActiveImages,
    taskFailureRetryCount: form.taskFailureRetryCount,
    taskRetryFirstDelaySecs: form.taskRetryFirstDelaySecs,
    taskRetryBackoffSecs: form.taskRetryBackoffSecs,
    crossProviderSameModelBalancingEnabled:
      form.crossProviderSameModelBalancingEnabled,
    platformLoggingEnabled: form.platformLoggingEnabled,
    platformLogSecurityEnabled: form.platformLogSecurityEnabled,
    platformLogOperationsEnabled: form.platformLogOperationsEnabled,
    platformLogUserEnabled: form.platformLogUserEnabled,
    platformLogRetentionDays: form.platformLogRetentionDays,
    platformLogMaxMb: form.platformLogMaxMb,
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
  Math.min(form.globalMaxConcurrentTasks, workerConcurrencyCeiling.value),
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
    hint: form.lanjingPayEnabled ? paymentStateLabel.value : "已停用",
    on: form.lanjingPayEnabled,
  },
  {
    id: "image-ai" as const,
    label: "AI 模型",
    hint: imageAnalysisReady.value
      ? selectedImageAnalysisModel.value?.name || imageAnalysisCopy.value.hint
      : imageAnalysisCopy.value.hint,
    on: imageAnalysisReady.value,
  },
  {
    id: "account" as const,
    label: "账号",
    hint: form.registrationEnabled ? "开放注册" : "注册已关闭",
    on: form.registrationEnabled,
  },
  {
    id: "growth" as const,
    label: "增长激励",
    hint: form.growthUsageRewardsEnabled
      ? `用量 ${usageRewardTotal.value.toLocaleString("zh-CN")} 积分`
      : "用量奖励关闭",
    on: form.growthFailureBonusEnabled || form.growthUsageRewardsEnabled,
  },
  {
    id: "concurrency" as const,
    label: "任务并发",
    hint: `${effectiveGlobalConcurrency.value} / ${workerConcurrencyCeiling.value}`,
    on: true,
  },
  {
    id: "logging" as const,
    label: "运行日志",
    hint: form.platformLoggingEnabled
      ? `${form.platformLogRetentionDays} 天 · ${form.platformLogMaxMb} MB`
      : "已关闭",
    on: form.platformLoggingEnabled,
  },
  {
    id: "retry" as const,
    label: "调度与重试",
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
  const last = form.growthUsageMilestones.at(-1);
  form.growthUsageMilestones.push({
    units: last ? last.units + 10 : 10,
    rewardCents: last ? last.rewardCents + 20 : 20,
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
  form.userMaxConcurrentTasks = settings.userMaxConcurrentTasks ?? 20;
  form.globalMaxConcurrentTasks = settings.globalMaxConcurrentTasks ?? 2000;
  form.globalMaxActiveTasks = settings.globalMaxActiveTasks ?? 12000;
  form.globalMaxActiveImages = settings.globalMaxActiveImages ?? 12000;
  form.taskFailureRetryCount = settings.taskFailureRetryCount ?? 2;
  form.taskRetryFirstDelaySecs = settings.taskRetryFirstDelaySecs ?? 3;
  form.taskRetryBackoffSecs = settings.taskRetryBackoffSecs ?? 15;
  form.crossProviderSameModelBalancingEnabled =
    settings.crossProviderSameModelBalancingEnabled ?? false;
  form.platformLoggingEnabled = settings.platformLoggingEnabled ?? false;
  form.platformLogSecurityEnabled = settings.platformLogSecurityEnabled ?? true;
  form.platformLogOperationsEnabled = settings.platformLogOperationsEnabled ?? true;
  form.platformLogUserEnabled = settings.platformLogUserEnabled ?? false;
  form.platformLogRetentionDays = settings.platformLogRetentionDays ?? 7;
  form.platformLogMaxMb = settings.platformLogMaxMb ?? 256;
  form.adminImageAnalysisProviderId = settings.adminImageAnalysisProviderId || "";
  form.adminImageAnalysisModelId = settings.adminImageAnalysisModelId || "";
  form.adminImageAnalysisReasoningEffort =
    settings.adminImageAnalysisReasoningEffort || "";
  workerConcurrencyCeiling.value = Math.max(
    1,
    settings.workerConcurrencyCeiling ?? 1,
  );
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
  saving.value = true;
  try {
    hydrate(
      await request<AdminSettings & PaymentSettings>("/api/v1/admin/settings", {
        method: "PUT",
        body: {
          userMaxRunningTasks: form.userMaxRunningTasks,
          userMaxRunningImages: form.userMaxRunningImages,
          userMaxConcurrentTasks: form.userMaxConcurrentTasks,
          globalMaxConcurrentTasks: form.globalMaxConcurrentTasks,
          globalMaxActiveTasks: form.globalMaxActiveTasks,
          globalMaxActiveImages: form.globalMaxActiveImages,
          taskFailureRetryCount: form.taskFailureRetryCount,
          taskRetryFirstDelaySecs: form.taskRetryFirstDelaySecs,
          taskRetryBackoffSecs: form.taskRetryBackoffSecs,
          crossProviderSameModelBalancingEnabled:
            form.crossProviderSameModelBalancingEnabled,
          platformLoggingEnabled: form.platformLoggingEnabled,
          platformLogSecurityEnabled: form.platformLogSecurityEnabled,
          platformLogOperationsEnabled: form.platformLogOperationsEnabled,
          platformLogUserEnabled: form.platformLogUserEnabled,
          platformLogRetentionDays: form.platformLogRetentionDays,
          platformLogMaxMb: form.platformLogMaxMb,
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
    <PageCard>
      <header class="settings-toolbar">
        <div class="sync-state" :class="{ 'is-dirty': isDirty }">
          <i />{{ isDirty ? "有未保存变更" : "配置已同步" }}
        </div>
        <div class="settings-toolbar__actions">
          <el-button :icon="Refresh" @click="load">刷新</el-button>
          <el-button
            type="primary"
            :icon="Check"
            :loading="saving"
            :disabled="!isDirty"
            @click="save"
          >
            保存并生效
          </el-button>
        </div>
      </header>

      <div class="settings-workspace">
        <nav class="settings-nav" aria-label="系统设置分组">
          <p class="settings-nav__hint">选择分组</p>
          <button
            v-for="item in sections"
            :key="item.id"
            type="button"
            class="settings-nav__item"
            :class="{ 'is-active': activeSection === item.id }"
            @click="activeSection = item.id"
          >
            <i :class="{ 'is-on': item.on }" />
            <span>
              <strong>{{ item.label }}</strong>
              <small>{{ item.hint }}</small>
            </span>
          </button>
        </nav>

        <section class="settings-pane">
          <header class="pane-head">
            <div>
              <strong>{{ activeSectionMeta.label }}</strong>
              <small>{{ activeSectionMeta.hint }}</small>
            </div>
          </header>
          <div class="pane-body">
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
                :step="1"
                :precision="0"
              />
              <em>积分</em>
            </div>
          </label>
        </div>
        <div class="jump-row">
          <RouterLink class="jump-chip" to="/checkin-activity">签到活动</RouterLink>
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
        <div class="field-grid is-stack">
          <label class="field-row">
            <span>
              <strong>全站同时执行</strong>
              <small>上游在途上限</small>
            </span>
            <el-input-number
              v-model="form.globalMaxConcurrentTasks"
              :min="1"
              :max="10000000"
              :step="100"
            />
          </label>
          <label class="field-row">
            <span>
              <strong>单用户同时执行</strong>
              <small>账号同时处于上游执行的任务</small>
            </span>
            <el-input-number
              v-model="form.userMaxConcurrentTasks"
              :min="1"
              :max="10000"
            />
          </label>
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
            </template>

            <template v-else>
      <div class="settings-card">
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
          <label class="field-row">
            <span>
              <strong>同名模型跨服务商泄压</strong>
              <small>同类型、同名称、同积分且参数兼容才参与</small>
            </span>
            <el-switch v-model="form.crossProviderSameModelBalancingEnabled" />
          </label>
        </div>
      </div>
            </template>
          </div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped lang="scss">
.settings-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  background: var(--bg);
}

.settings-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.settings-page :deep(.page-card:hover) {
  border-color: var(--border);
}

.settings-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.settings-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
}

.settings-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);

  :deep(.el-button) {
    margin: 0;
    height: 32px;
  }
}

.sync-state {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-soft);
  }

  &.is-dirty {
    border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
    background: var(--warning-soft);
    color: var(--warning);

    i {
      background: var(--warning);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent);
    }
  }
}

.settings-workspace {
  display: grid;
  flex: 1;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: 12px 8px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.settings-nav__hint {
  margin: 0 10px 8px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.settings-nav__item {
  display: grid;
  width: 100%;
  grid-template-columns: 8px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;

  i {
    width: 7px;
    height: 7px;
    margin-top: 6px;
    border-radius: 50%;
    background: var(--surface-3);

    &.is-on {
      background: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
    }
  }

  span {
    min-width: 0;
  }

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--ink-2);
    font-size: 13px;
    font-weight: 650;
  }

  small {
    margin-top: 2px;
    color: var(--ink-3);
    font-size: 11px;
    line-height: 1.4;
  }

  &:hover {
    background: var(--surface-2);

    strong {
      color: var(--ink);
    }
  }

  &.is-active {
    background: var(--accent-soft);

    strong {
      color: var(--accent-ink);
    }

    small {
      color: color-mix(in srgb, var(--accent-ink) 62%, var(--ink-3));
    }
  }
}

.settings-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.pane-head {
  display: grid;
  flex: 0 0 auto;
  gap: 3px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border);

  strong,
  small {
    display: block;
  }

  strong {
    color: var(--ink);
    font-size: 16px;
    font-weight: 750;
    letter-spacing: -0.02em;
  }

  small {
    color: var(--ink-3);
    font-size: 12px;
    line-height: 1.5;
  }
}

.pane-body {
  flex: 1;
  min-height: 0;
  padding: 16px 18px 18px;
  overflow: auto;
  overscroll-behavior: contain;
}

.settings-card {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.usage-tile {
  display: grid;
  gap: 4px;
  min-height: 72px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  color: inherit;
  text-decoration: none;

  strong,
  small {
    display: block;
  }

  strong {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }

  small {
    color: var(--ink-3);
    font-size: 11px;
    line-height: 1.45;
  }

  &:hover {
    border-color: var(--border-strong);
    background: var(--surface);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.image-ai-fields {
  .field-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 8px;

    :deep(.el-select),
    :deep(.el-input),
    :deep(.el-input-number) {
      width: 100%;
    }
  }
}

.field-empty {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
}

.model-identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--success) 28%, var(--border));
  border-radius: 14px;
  background: var(--success-soft);

  strong,
  small {
    display: block;
  }

  strong {
    color: var(--ink);
    font-size: 14px;
    font-weight: 750;
  }

  small {
    margin-top: 4px;
    color: var(--ink-2);
    font-size: 12px;
  }

  &.is-off {
    border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
    background: var(--warning-soft);
  }
}

.model-identity__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;

  span {
    display: inline-flex;
    align-items: center;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--ink-2);
    font-size: 11px;
    font-weight: 650;
  }
}

.status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);

  &.is-on {
    border-color: color-mix(in srgb, var(--success) 28%, var(--border));
    background: var(--success-soft);

    .status-banner__dot {
      background: var(--success);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 18%, transparent);
    }
  }

  &.is-warn {
    border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
    background: var(--warning-soft);

    .status-banner__dot {
      background: var(--warning);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--warning) 18%, transparent);
    }
  }
}

.status-banner__copy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.status-banner__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--ink-3);
}

.status-banner strong {
  display: block;
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
}

.status-banner p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.45;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
  padding: 4px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);

  &.is-stack {
    grid-template-columns: minmax(0, 1fr);
  }
}

.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);

  &.is-wide {
    grid-column: 1 / -1;
  }

  &.is-textarea {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;

    :deep(.el-input) {
      width: 100%;
    }
  }

  &:last-child {
    border-bottom: 0;
  }

  > span {
    min-width: 0;
  }

  strong,
  small {
    display: block;
  }

  strong {
    color: var(--ink);
    font-size: 13px;
    font-weight: 650;
  }

  small {
    margin-top: 3px;
    color: var(--ink-3);
    font-size: 11px;
    line-height: 1.45;
  }

  :deep(.el-input),
  :deep(.el-input-number) {
    width: 220px;
  }
}

.field-unit {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  em {
    color: var(--ink-3);
    font-size: 12px;
    font-style: normal;
    font-weight: 650;
  }
}

.method-pills {
  display: flex;
  align-items: center;
  gap: 8px;
}

.method-pill {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;

  &:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  &.is-on {
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  :deep(.el-checkbox) {
    margin: 0;
    height: auto;
  }
}

.pay-test {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;

  p {
    margin: 0;
  }
}

.pay-test__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 22px;

  b {
    margin-left: 6px;
    color: var(--ink-2);
    font-weight: 650;
  }
}

.jump-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.jump-note {
  color: var(--ink-3);
  font-size: 11px;
}

.jump-chip {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  text-decoration: none;

  &:hover {
    border-color: var(--border-strong);
    background: var(--surface);
    color: var(--ink);
  }
}

.usage-block {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);

  > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    strong,
    small {
      display: block;
    }

    strong {
      color: var(--ink);
      font-size: 13px;
      font-weight: 700;
    }

    small {
      margin-top: 3px;
      color: var(--ink-3);
      font-size: 11px;
    }
  }
}

.usage-block__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.usage-total {
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.milestone-list {
  display: grid;
  gap: 8px;
}

.milestone-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) 36px;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);

  > label {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--ink-3);
    font-size: 12px;
  }

  :deep(.el-input-number) {
    width: 100%;
  }

  em {
    font-style: normal;
  }
}

.milestone-index {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 750;
}
</style>
