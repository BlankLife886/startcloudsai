<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
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

type SettingsSection = "payment" | "account" | "growth" | "concurrency" | "retry";

const loading = ref(false);
const activeSection = ref<SettingsSection>("payment");
const saving = ref(false);
const savedSignature = ref("");
const workerConcurrencyCeiling = ref(1);
const testingPayment = ref(false);
const paymentTest = ref<PaymentTestResult | null>(null);

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

const sections = computed(() => [
  {
    id: "payment" as const,
    label: "支付",
    hint: form.lanjingPayEnabled ? paymentStateLabel.value : "已停用",
    on: form.lanjingPayEnabled,
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
    hydrate(await request<AdminSettings & PaymentSettings>("/api/v1/admin/settings"));
  } finally {
    loading.value = false;
  }
}

async function save() {
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

onMounted(load);
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

  &.is-on {
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
    background: var(--accent-soft);
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
  flex-wrap: wrap;
  gap: 8px;
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
