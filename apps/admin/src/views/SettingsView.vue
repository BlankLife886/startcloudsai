<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Check, Connection, Delete, Plus, Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { request } from "@/request";
import { normalizePoints } from "@/utils";

interface AdminSettings {
  userMaxRunningTasks?: number;
  userMaxRunningImages?: number;
  userMaxConcurrentTasks?: number;
  globalMaxConcurrentTasks?: number;
  globalMaxActiveTasks?: number;
  globalMaxActiveImages?: number;
  taskFailureRetryCount?: number;
  taskRetryFirstDelaySecs?: number;
  taskRetryBackoffSecs?: number;
  crossProviderSameModelBalancingEnabled?: boolean;
  workerConcurrencyCeiling?: number;
  effectiveGlobalConcurrency?: number;
  registrationEnabled?: boolean;
  signupBonusCents?: number;
  checkinEnabled?: boolean;
  checkinCampaignTitle?: string;
  checkinRewards?: number[];
  growthGroupEnabled?: boolean;
  growthGroupCampaignKey?: string;
  growthGroupTargetMembers?: number;
  growthGroupRewardCents?: number;
  growthGroupDurationHours?: number;
  growthFailureBonusEnabled?: boolean;
  growthFailureBonusCents?: number;
  growthFailureBonusDailyLimit?: number;
  growthUsageRewardsEnabled?: boolean;
  growthUsageMilestones?: GrowthMilestone[];
  suggestionRewardMaxCents?: number;
  lanjingPayEnabled?: boolean;
  lanjingPayBaseUrl?: string;
  lanjingPaySecret?: string;
  lanjingPayNotifyUrl?: string;
  lanjingPayTimeoutSecs?: number;
  lanjingPayAlipayEnabled?: boolean;
  lanjingPayWechatEnabled?: boolean;
}

interface GrowthMilestone {
  units: number;
  rewardCents: number;
}

interface PaymentTestResult {
  online: boolean;
  state: number;
  stateLabel: string;
  lastHeartbeatAt?: string | null;
  lastPaymentAt?: string | null;
}

const loading = ref(false);
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
  checkinEnabled: true,
  checkinCampaignTitle: "连续签到领创作积分",
  checkinRewards: [10, 15, 20, 25, 30, 40, 80],
  growthGroupEnabled: true,
  growthGroupCampaignKey: "launch-2026",
  growthGroupTargetMembers: 3,
  growthGroupRewardPoints: 30,
  growthGroupDurationHours: 48,
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
    checkinEnabled: form.checkinEnabled,
    checkinCampaignTitle: form.checkinCampaignTitle,
    checkinRewards: form.checkinRewards,
    growthGroupEnabled: form.growthGroupEnabled,
    growthGroupCampaignKey: form.growthGroupCampaignKey,
    growthGroupTargetMembers: form.growthGroupTargetMembers,
    growthGroupRewardPoints: form.growthGroupRewardPoints,
    growthGroupDurationHours: form.growthGroupDurationHours,
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
const checkinWeekTotal = computed(() =>
  form.checkinRewards.reduce((sum, reward) => sum + normalizePoints(reward), 0),
);
const usageRewardTotal = computed(() =>
  form.growthUsageMilestones.reduce(
    (sum, milestone) => sum + normalizePoints(milestone.rewardCents),
    0,
  ),
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

function hydrate(settings: AdminSettings) {
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
  form.checkinEnabled = settings.checkinEnabled ?? true;
  form.checkinCampaignTitle =
    settings.checkinCampaignTitle || "连续签到领创作积分";
  form.checkinRewards =
    Array.isArray(settings.checkinRewards) &&
    settings.checkinRewards.length === 7
      ? settings.checkinRewards.map(normalizePoints)
      : [10, 15, 20, 25, 30, 40, 80];
  form.growthGroupEnabled = settings.growthGroupEnabled ?? true;
  form.growthGroupCampaignKey =
    settings.growthGroupCampaignKey || "launch-2026";
  form.growthGroupTargetMembers = settings.growthGroupTargetMembers ?? 3;
  form.growthGroupRewardPoints = normalizePoints(
    settings.growthGroupRewardCents ?? 30,
  );
  form.growthGroupDurationHours = settings.growthGroupDurationHours ?? 48;
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
    hydrate(await request<AdminSettings>("/api/v1/admin/settings"));
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
      await request<AdminSettings>("/api/v1/admin/settings", {
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
          checkinEnabled: form.checkinEnabled,
          checkinCampaignTitle: form.checkinCampaignTitle.trim(),
          checkinRewards: form.checkinRewards.map(normalizePoints),
          growthGroupEnabled: form.growthGroupEnabled,
          growthGroupCampaignKey: form.growthGroupCampaignKey.trim(),
          growthGroupTargetMembers: form.growthGroupTargetMembers,
          growthGroupRewardCents: normalizePoints(form.growthGroupRewardPoints),
          growthGroupDurationHours: form.growthGroupDurationHours,
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
  <div v-loading="loading" class="page">
    <PageCard>
      <div class="settings-toolbar">
        <div class="save-state" :class="{ 'is-dirty': isDirty }">
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
      </div>

      <div class="settings-body">
        <section class="settings-group payment-settings">
          <header class="settings-group__head payment-settings__head">
            <div>
              <strong>支付</strong>
              <span>蓝鲸支付渠道、回调和监听状态</span>
            </div>
            <div class="payment-settings__controls">
              <span
                class="payment-state"
                :class="{
                  'is-online': paymentTest?.online,
                  'is-offline': paymentTest && !paymentTest.online,
                }"
              >
                {{
                  paymentTest
                    ? `监听端${paymentTest.stateLabel}`
                    : form.lanjingPayEnabled
                      ? "等待检测"
                      : "支付已停用"
                }}
              </span>
              <el-switch
                v-model="form.lanjingPayEnabled"
                active-text="启用"
                inactive-text="停用"
              />
            </div>
          </header>

          <div class="settings-grid settings-grid--pair payment-settings__grid">
            <label class="setting-tile">
              <div class="setting-tile__top setting-tile__top--stack">
                <strong>接口地址</strong>
                <el-input
                  v-model="form.lanjingPayBaseUrl"
                  placeholder="https://2347537.pay.lanjingzf.com"
                />
              </div>
              <small>蓝鲸支付商户实例地址</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top setting-tile__top--stack">
                <strong>通讯密钥</strong>
                <el-input
                  v-model="form.lanjingPaySecret"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  placeholder="输入商户后台通讯密钥"
                />
              </div>
              <small>保存时加密；掩码原样保存不会更换密钥</small>
            </label>

            <label class="setting-tile payment-settings__callback">
              <div class="setting-tile__top setting-tile__top--stack">
                <strong>异步回调地址</strong>
                <el-input
                  v-model="form.lanjingPayNotifyUrl"
                  placeholder="https://你的域名/api/v1/payments/lanjing/notify"
                />
              </div>
              <small>生产环境必须为平台可访问的公网 HTTPS 地址</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>请求超时</strong>
                <div class="points-input">
                  <el-input-number
                    v-model="form.lanjingPayTimeoutSecs"
                    class="settings-stepper"
                    :min="1"
                    :max="60"
                    :precision="0"
                  />
                  <b>秒</b>
                </div>
              </div>
              <small>创建、查询和关闭订单的服务端超时</small>
            </label>

            <div class="setting-tile payment-settings__methods">
              <div class="setting-tile__top">
                <strong>支付方式</strong>
                <el-checkbox v-model="form.lanjingPayAlipayEnabled">
                  支付宝
                </el-checkbox>
                <el-checkbox v-model="form.lanjingPayWechatEnabled">
                  微信支付
                </el-checkbox>
              </div>
              <small>至少开放一种；用户价格页只展示已开放渠道</small>
            </div>

            <div class="payment-settings__test">
              <div v-if="paymentTest" class="payment-test-result">
                <span>最近心跳</span>
                <strong>{{ formatPaymentTime(paymentTest.lastHeartbeatAt) }}</strong>
                <span>最近收款</span>
                <strong>{{ formatPaymentTime(paymentTest.lastPaymentAt) }}</strong>
              </div>
              <span v-else>连接测试只查询监听状态，不创建支付订单</span>
              <el-button
                :icon="Connection"
                :loading="testingPayment"
                @click="testPaymentConnection"
              >
                测试连接
              </el-button>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>账号</strong>
            <span>注册入口与新用户赠送</span>
          </header>
          <div class="settings-grid settings-grid--pair">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>开放注册</strong>
                <el-switch v-model="form.registrationEnabled" />
              </div>
              <small>控制新用户注册入口</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>注册赠送</strong>
                <div class="points-input">
                  <el-input-number
                    v-model="form.signupBonusPoints"
                    class="settings-stepper"
                    :min="0"
                    :step="1"
                    :precision="0"
                  />
                  <b>积分</b>
                </div>
              </div>
              <small>新账号首次获得的积分</small>
            </label>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>增长与商业模式</strong>
            <span>拼团、合作申请和用户激励规则</span>
          </header>

          <div class="settings-grid settings-grid--pair">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>开放好友拼团</strong>
                <el-switch v-model="form.growthGroupEnabled" />
              </div>
              <small>用户可创建或加入当期拼团，满员后自动发放奖励</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>拼团活动批次</strong>
                <el-input
                  v-model="form.growthGroupCampaignKey"
                  maxlength="64"
                  placeholder="launch-2026"
                />
              </div>
              <small>更换批次会开启新一期活动，历史拼团仍保留</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>成团人数</strong>
                <el-input-number
                  v-model="form.growthGroupTargetMembers"
                  class="settings-stepper"
                  :min="2"
                  :max="10"
                  :precision="0"
                />
              </div>
              <small>每个拼团达到该人数后立即结算</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>每人拼团奖励</strong>
                <div class="points-input">
                  <el-input-number
                    v-model="form.growthGroupRewardPoints"
                    class="settings-stepper"
                    :min="0"
                    :max="1000000"
                    :precision="0"
                  />
                  <b>积分</b>
                </div>
              </div>
              <small>仅满员时发放，每个成员同一拼团只到账一次</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>拼团有效期</strong>
                <div class="points-input">
                  <el-input-number
                    v-model="form.growthGroupDurationHours"
                    class="settings-stepper"
                    :min="1"
                    :max="720"
                    :precision="0"
                  />
                  <b>小时</b>
                </div>
              </div>
              <small>超时未满员的拼团不能继续加入</small>
            </label>

          </div>

          <div class="growth-subsection">
            <header>
              <div>
                <strong>自动激励</strong>
                <small>失败补偿和建议采纳奖励均通过积分账本发放</small>
              </div>
            </header>
            <div class="settings-grid settings-grid--pair">
              <label class="setting-tile">
                <div class="setting-tile__top">
                  <strong>失败额外补偿</strong>
                  <el-switch v-model="form.growthFailureBonusEnabled" />
                </div>
                <small>任务费用仍全额退回，开启后再发放额外安抚积分</small>
              </label>

              <label class="setting-tile">
                <div class="setting-tile__top">
                  <strong>单次补偿</strong>
                  <div class="points-input">
                    <el-input-number
                      v-model="form.growthFailureBonusPoints"
                      class="settings-stepper"
                      :min="0"
                      :max="1000000"
                      :precision="0"
                    />
                    <b>积分</b>
                  </div>
                </div>
                <small>只对真实上游失败生效，管理员强制终止不奖励</small>
              </label>

              <label class="setting-tile">
                <div class="setting-tile__top">
                  <strong>每日补偿次数</strong>
                  <el-input-number
                    v-model="form.growthFailureBonusDailyLimit"
                    class="settings-stepper"
                    :min="0"
                    :max="100"
                    :precision="0"
                  />
                </div>
                <small>按用户限制，0 表示当天不发额外补偿</small>
              </label>

              <label class="setting-tile">
                <div class="setting-tile__top">
                  <strong>建议采纳上限</strong>
                  <div class="points-input">
                    <el-input-number
                      v-model="form.suggestionRewardMaxPoints"
                      class="settings-stepper"
                      :min="0"
                      :max="1000000"
                      :step="100"
                      :precision="0"
                    />
                    <b>积分</b>
                  </div>
                </div>
                <small>后台采纳产品建议时可发放的单次最高奖励</small>
              </label>
            </div>
          </div>

          <div class="growth-subsection">
            <header>
              <div>
                <strong>用量计划档位</strong>
                <small>按自然月累计成功交付图片数，达标自动发放</small>
              </div>
              <div class="growth-subsection__actions">
                <span
                  >总奖励
                  {{ usageRewardTotal.toLocaleString("zh-CN") }} 积分</span
                >
                <el-tooltip content="添加里程碑" placement="top">
                  <el-button
                    circle
                    :icon="Plus"
                    :disabled="form.growthUsageMilestones.length >= 12"
                    aria-label="添加里程碑"
                    @click="addUsageMilestone"
                  />
                </el-tooltip>
              </div>
            </header>
            <label class="growth-reward-toggle">
              <span>
                <strong>启用用量奖励</strong>
                <small>关闭后保留历史到账记录，不再产生新奖励</small>
              </span>
              <el-switch v-model="form.growthUsageRewardsEnabled" />
            </label>
            <div class="growth-milestones">
              <div
                v-for="(milestone, index) in form.growthUsageMilestones"
                :key="index"
                class="growth-milestone"
              >
                <span class="growth-milestone__index">{{ index + 1 }}</span>
                <label>
                  <span>累计交付</span>
                  <el-input-number
                    v-model="milestone.units"
                    :min="1"
                    :max="1000000"
                    :precision="0"
                    controls-position="right"
                  />
                  <small>张</small>
                </label>
                <label>
                  <span>奖励</span>
                  <el-input-number
                    v-model="milestone.rewardCents"
                    :min="1"
                    :max="1000000"
                    :precision="0"
                    controls-position="right"
                  />
                  <small>积分</small>
                </label>
                <el-tooltip content="删除里程碑" placement="top">
                  <el-button
                    circle
                    text
                    type="danger"
                    :icon="Delete"
                    :disabled="form.growthUsageMilestones.length <= 1"
                    aria-label="删除里程碑"
                    @click="removeUsageMilestone(index)"
                  />
                </el-tooltip>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>签到活动</strong>
            <span>连续签到奖励与用户回访激励</span>
          </header>
          <div class="settings-grid settings-grid--pair">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>开放签到活动</strong>
                <el-switch v-model="form.checkinEnabled" />
              </div>
              <small>关闭后保留历史记录，但用户无法领取新的签到奖励</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top setting-tile__top--stack">
                <strong>活动标题</strong>
                <el-input
                  v-model="form.checkinCampaignTitle"
                  maxlength="40"
                  placeholder="连续签到领创作积分"
                />
              </div>
              <small>显示在用户签到页的主活动标题</small>
            </label>
          </div>

          <div class="checkin-reward-card">
            <div class="checkin-reward-card__head">
              <div>
                <strong>7 天循环奖励</strong>
                <small
                  >连续第 7 天建议设置高额里程碑奖励，之后从第 1 天循环</small
                >
              </div>
              <span
                >每周期共
                {{ checkinWeekTotal.toLocaleString("zh-CN") }} 积分</span
              >
            </div>
            <div class="checkin-reward-grid">
              <label v-for="(_, index) in form.checkinRewards" :key="index">
                <span>第 {{ index + 1 }} 天</span>
                <el-input-number
                  v-model="form.checkinRewards[index]"
                  :min="0"
                  :max="1000000"
                  :step="index === 6 ? 10 : 5"
                  :precision="0"
                  controls-position="right"
                />
                <small>{{ index === 6 ? "里程碑" : "积分" }}</small>
              </label>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>任务并发</strong>
            <span>全站与单用户执行水位</span>
          </header>
          <div class="settings-grid">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>全站同时执行</strong>
                <el-input-number
                  v-model="form.globalMaxConcurrentTasks"
                  class="settings-stepper"
                  :min="1"
                  :max="10000000"
                  :step="100"
                />
              </div>
              <small>
                上游在途上限 · 当前 {{ effectiveGlobalConcurrency }} / Worker
                {{ workerConcurrencyCeiling }}
              </small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>单用户同时执行</strong>
                <el-input-number
                  v-model="form.userMaxConcurrentTasks"
                  class="settings-stepper"
                  :min="1"
                  :max="10000"
                />
              </div>
              <small>每个账号允许同时处于上游执行中的任务数</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>全站待处理容量</strong>
                <el-input-number
                  v-model="form.globalMaxActiveTasks"
                  class="settings-stepper"
                  :min="10"
                  :max="10000000"
                  :step="100"
                />
              </div>
              <small>排队与运行达到水位后停止接收新任务</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>全站图片容量</strong>
                <el-input-number
                  v-model="form.globalMaxActiveImages"
                  class="settings-stepper"
                  :min="10"
                  :max="10000000"
                  :step="100"
                />
              </div>
              <small>按任务 count 累计的排队与运行图片单位上限</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>单用户待处理任务</strong>
                <el-input-number
                  v-model="form.userMaxRunningTasks"
                  class="settings-stepper"
                  :min="1"
                  :max="10000"
                />
              </div>
              <small>运行中与排队中的任务总量上限</small>
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>单用户图片容量</strong>
                <el-input-number
                  v-model="form.userMaxRunningImages"
                  class="settings-stepper"
                  :min="1"
                  :max="100000"
                  :step="10"
                />
              </div>
              <small>单个账号排队与运行中的图片单位上限</small>
            </label>
          </div>
        </section>

        <section class="settings-group">
          <header class="settings-group__head">
            <strong>调度与重试</strong>
            <span>失败补偿与跨服务商泄压</span>
          </header>
          <div class="settings-grid settings-grid--pair">
            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>任务失败重试</strong>
                <el-input-number
                  v-model="form.taskFailureRetryCount"
                  class="settings-stepper"
                  :min="0"
                  :max="100"
                  :step="1"
                  :precision="0"
                />
              </div>
              <small
                >连接、超时或临时上游错误的额外尝试次数；0 表示不重试</small
              >
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>首次重试等待（秒）</strong>
                <el-input-number
                  v-model="form.taskRetryFirstDelaySecs"
                  class="settings-stepper"
                  :min="1"
                  :max="600"
                  :step="1"
                  :precision="0"
                />
              </div>
              <small
                >上游临时报错（如账号池忙）后第一次重试前的等待时间；越短用户等待越少</small
              >
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>后续重试间隔（秒）</strong>
                <el-input-number
                  v-model="form.taskRetryBackoffSecs"
                  class="settings-stepper"
                  :min="1"
                  :max="600"
                  :step="5"
                  :precision="0"
                />
              </div>
              <small
                >第二次起每次重试的间隔步长（第 N 次重试等待 (N-1)×该值 秒），避免持续打爆上游</small
              >
            </label>

            <label class="setting-tile">
              <div class="setting-tile__top">
                <strong>同名模型跨服务商泄压</strong>
                <el-switch
                  v-model="form.crossProviderSameModelBalancingEnabled"
                />
              </div>
              <small
                >仅同类型、同名称、同积分且参数兼容的模型参与容量调度</small
              >
            </label>
          </div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.settings-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.settings-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.save-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.save-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.save-state.is-dirty {
  color: var(--warning);
}

.save-state.is-dirty i {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.settings-body {
  display: grid;
  gap: 20px;
  width: 100%;
}

.settings-group {
  display: grid;
  gap: 10px;
}

.settings-group__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
}

.settings-group__head strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.settings-group__head span {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 500;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.settings-grid--pair {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.setting-tile {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 6px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: default;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.setting-tile:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--surface-2) 55%, var(--surface));
}

.setting-tile__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.setting-tile__top--stack {
  align-items: stretch;
  flex-direction: column;
}

.payment-settings__head {
  align-items: center;
  justify-content: space-between;
}

.payment-settings__head > div:first-child strong,
.payment-settings__head > div:first-child span {
  display: block;
}

.payment-settings__head > div:first-child span {
  margin-top: 3px;
}

.payment-settings__controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.payment-state {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--ink-3) !important;
  background: var(--surface-2);
  font-size: 11px !important;
  font-weight: 650 !important;
}

.payment-state.is-online {
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
  color: var(--success) !important;
  background: var(--success-soft);
}

.payment-state.is-offline {
  border-color: color-mix(in srgb, var(--warning) 35%, var(--border));
  color: var(--warning) !important;
  background: var(--warning-soft);
}

.payment-settings__methods .setting-tile__top {
  justify-content: flex-start;
}

.payment-settings__methods .setting-tile__top > strong {
  margin-right: auto;
}

.payment-settings__test {
  grid-column: 1 / -1;
  display: flex;
  min-height: 52px;
  padding: 8px 12px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 11px;
}

.payment-test-result {
  display: grid;
  grid-template-columns: auto minmax(130px, 1fr) auto minmax(130px, 1fr);
  align-items: center;
  gap: 4px 10px;
}

.payment-test-result strong {
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.growth-subsection {
  display: grid;
  gap: 12px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.growth-subsection > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.growth-subsection > header strong,
.growth-subsection > header small {
  display: block;
}

.growth-subsection > header strong {
  color: var(--ink);
  font-size: 13px;
}

.growth-subsection > header small,
.growth-reward-toggle small {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: 11px;
}

.growth-subsection__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.growth-subsection__actions > span {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
}

.growth-reward-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.growth-reward-toggle strong,
.growth-reward-toggle small {
  display: block;
}

.growth-reward-toggle strong {
  color: var(--ink);
  font-size: 12px;
}

.growth-milestones {
  display: grid;
  gap: 8px;
}

.growth-milestone {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) 32px;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.growth-milestone__index {
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

.growth-milestone > label {
  display: grid;
  grid-template-columns: 58px minmax(110px, 1fr) 32px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.growth-milestone > label > span,
.growth-milestone > label > small {
  color: var(--ink-3);
  font-size: 11px;
}

.growth-milestone :deep(.el-input-number) {
  width: 100%;
}

.checkin-reward-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 6px);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent-soft) 58%, var(--surface)),
    var(--surface)
  );
  box-shadow: var(--shadow-sm);
}

.checkin-reward-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.checkin-reward-card__head strong,
.checkin-reward-card__head small {
  display: block;
}

.checkin-reward-card__head strong {
  font-size: 13px;
}

.checkin-reward-card__head small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11px;
}

.checkin-reward-card__head > span {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  font-size: 11px;
  font-weight: 700;
}

.checkin-reward-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.checkin-reward-grid > label {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.checkin-reward-grid > label > span,
.checkin-reward-grid > label > small {
  text-align: center;
  font-size: 10px;
}

.checkin-reward-grid > label > span {
  color: var(--ink-2);
  font-weight: 700;
}

.checkin-reward-grid > label > small {
  color: var(--ink-3);
}

.checkin-reward-grid :deep(.el-input-number) {
  width: 100%;
}

@media (max-width: 1180px) {
  .checkin-reward-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .checkin-reward-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .checkin-reward-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .settings-grid,
  .settings-grid--pair {
    grid-template-columns: minmax(0, 1fr);
  }

  .payment-settings__head,
  .payment-settings__test {
    align-items: flex-start;
    flex-direction: column;
  }

  .payment-settings__test :deep(.el-button) {
    width: 100%;
  }

  .payment-test-result {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .growth-subsection > header {
    align-items: flex-start;
    flex-direction: column;
  }

  .growth-milestone {
    grid-template-columns: 28px minmax(0, 1fr) 32px;
  }

  .growth-milestone > label {
    grid-column: 2;
  }

  .growth-milestone > :deep(.el-button) {
    grid-column: 3;
    grid-row: 1;
  }
}

.setting-tile__top strong {
  min-width: 0;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.setting-tile > small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
}

.points-input {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.points-input b {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.setting-tile :deep(.settings-stepper) {
  width: 136px;
  line-height: 34px;
}

.setting-tile :deep(.settings-stepper .el-input-number__decrease),
.setting-tile :deep(.settings-stepper .el-input-number__increase) {
  width: 30px;
  color: var(--ink-2);
  background: var(--surface-2);
  border-color: var(--border);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.setting-tile :deep(.settings-stepper .el-input-number__decrease) {
  border-radius: var(--radius-control) 0 0 var(--radius-control);
}

.setting-tile :deep(.settings-stepper .el-input-number__increase) {
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}

.setting-tile :deep(.settings-stepper .el-input-number__decrease:hover),
.setting-tile :deep(.settings-stepper .el-input-number__increase:hover) {
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.setting-tile :deep(.settings-stepper .el-input__wrapper) {
  height: 34px;
  padding: 0 34px;
  border-radius: var(--radius-control);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--border) inset;
  transition: box-shadow 0.15s ease;
}

.setting-tile :deep(.settings-stepper .el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 55%, var(--border)) inset,
    0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.setting-tile :deep(.settings-stepper .el-input__inner) {
  height: 34px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  text-align: center;
}
</style>
