<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Check, Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { request } from "@/request";
import { normalizePoints } from "@/utils";

interface AdminSettings {
  growthGroupEnabled?: boolean;
  growthGroupCampaignKey?: string;
  growthGroupTargetMembers?: number;
  growthGroupRewardCents?: number;
  growthGroupDurationHours?: number;
}

interface GrowthGroupItem {
  id: string;
  code: string;
  owner: { id: string; username: string; avatarUrl?: string | null };
  status: "active" | "completed" | "expired";
  targetMembers: number;
  memberCount: number;
  rewardCents: number;
  expiresAt: string;
  completedAt?: string | null;
  createdAt: string;
}

interface GrowthGroupOverview {
  campaignKey: string;
  summary: {
    totalGroups: number;
    activeGroups: number;
    completedGroups: number;
    expiredGroups: number;
    participations: number;
  };
  items: GrowthGroupItem[];
}

const loading = ref(false);
const saving = ref(false);
const overviewLoading = ref(false);
const savedSignature = ref("");
const overview = ref<GrowthGroupOverview | null>(null);
const form = reactive({
  enabled: true,
  campaignKey: "launch-2026",
  targetMembers: 3,
  rewardPoints: 30,
  durationHours: 48,
});

const signature = () => JSON.stringify(form);
const isDirty = computed(
  () => Boolean(savedSignature.value) && signature() !== savedSignature.value,
);
const rulePreview = computed(
  () =>
    `${form.targetMembers} 人成团 · 每人 ${normalizePoints(form.rewardPoints).toLocaleString("zh-CN")} 积分 · ${form.durationHours} 小时有效`,
);
const statusMeta = {
  active: { label: "进行中", type: "warning" as const },
  completed: { label: "已完成", type: "success" as const },
  expired: { label: "已过期", type: "info" as const },
};

function statusOf(status: GrowthGroupItem["status"]) {
  return statusMeta[status] || statusMeta.expired;
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function hydrate(settings: AdminSettings) {
  form.enabled = settings.growthGroupEnabled ?? true;
  form.campaignKey = settings.growthGroupCampaignKey || "launch-2026";
  form.targetMembers = settings.growthGroupTargetMembers ?? 3;
  form.rewardPoints = normalizePoints(settings.growthGroupRewardCents ?? 30);
  form.durationHours = settings.growthGroupDurationHours ?? 48;
  savedSignature.value = signature();
}

async function loadOverview() {
  if (form.campaignKey.trim().length < 2) {
    overview.value = null;
    return;
  }
  overviewLoading.value = true;
  try {
    overview.value = await request<GrowthGroupOverview>(
      "/api/v1/admin/growth/groups",
      { query: { campaignKey: form.campaignKey.trim() }, silent: true },
    );
  } catch {
    overview.value = null;
  } finally {
    overviewLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    hydrate(await request<AdminSettings>("/api/v1/admin/settings"));
    await loadOverview();
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const settings = await request<AdminSettings>("/api/v1/admin/settings", {
      method: "PUT",
      body: {
        growthGroupEnabled: form.enabled,
        growthGroupCampaignKey: form.campaignKey.trim(),
        growthGroupTargetMembers: form.targetMembers,
        growthGroupRewardCents: normalizePoints(form.rewardPoints),
        growthGroupDurationHours: form.durationHours,
      },
    });
    hydrate(settings);
    await loadOverview();
    ElMessage.success("好友拼团配置已生效");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="page group-admin-page">
    <PageCard>
      <div class="page-toolbar">
        <div class="sync-state" :class="{ 'is-dirty': isDirty }">
          <i />{{ isDirty ? "有未保存变更" : "配置已同步" }}
        </div>
        <div>
          <el-button :icon="Refresh" @click="load">刷新</el-button>
          <el-button type="primary" :icon="Check" :loading="saving" :disabled="!isDirty" @click="save">
            保存并生效
          </el-button>
        </div>
      </div>

      <section class="activity-state">
        <div class="activity-state__main">
          <span class="activity-indicator" :class="{ 'is-open': form.enabled }" />
          <div>
            <small>当前用户端状态</small>
            <h2>{{ form.enabled ? "活动开放中" : "活动已暂停" }}</h2>
            <p>{{ form.enabled ? "用户可以发起新拼团或输入好友邀请码加入。" : "用户只能查看已有拼团，不能发起或加入。" }}</p>
          </div>
        </div>
        <div class="activity-rule">
          <small>用户端规则预览</small>
          <strong>{{ rulePreview }}</strong>
          <span>满员后系统自动向每位成员发放奖励，无需管理员操作。</span>
        </div>
      </section>

      <section class="config-section">
        <header>
          <div><h2>活动配置</h2><p>保存后，新发起的拼团使用以下规则。</p></div>
        </header>
        <div class="config-grid">
          <label class="config-control is-switch">
            <div><strong>开放好友拼团</strong><small>控制用户端发起和加入入口</small></div>
            <el-switch v-model="form.enabled" />
          </label>
          <label class="config-control">
            <span>活动期标识（仅后台可见）</span>
            <el-input v-model="form.campaignKey" maxlength="64" placeholder="例如 launch-2026" />
            <small>更换并保存后开启新一期，用户可重新参团；旧一期数据仍保留。</small>
          </label>
          <label class="config-control">
            <span>成团人数</span>
            <el-input-number v-model="form.targetMembers" :min="2" :max="10" :precision="0" />
            <small>达到该人数后立即完成并结算。</small>
          </label>
          <label class="config-control">
            <span>每人奖励</span>
            <div class="number-with-unit">
              <el-input-number v-model="form.rewardPoints" :min="0" :max="1000000" :precision="0" />
              <b>积分</b>
            </div>
            <small>仅满员时发放，每位成员只到账一次。</small>
          </label>
          <label class="config-control">
            <span>拼团有效期</span>
            <div class="number-with-unit">
              <el-input-number v-model="form.durationHours" :min="1" :max="720" :precision="0" />
              <b>小时</b>
            </div>
            <small>超时未满员后邀请码失效，用户可重新参与。</small>
          </label>
        </div>
        <div class="config-warning">
          <i class="bi bi-info-circle" />
          <span>修改人数、奖励或有效期不会追溯已有拼团；修改活动期标识会开启全新一期。</span>
        </div>
      </section>

      <section class="operations-section" v-loading="overviewLoading">
        <header>
          <div>
            <h2>当期运行情况</h2>
            <p>活动期 {{ overview?.campaignKey || form.campaignKey }}，只读展示，避免人工修改破坏奖励一致性。</p>
          </div>
          <el-button size="small" :icon="Refresh" @click="loadOverview">刷新数据</el-button>
        </header>
        <div class="metric-row">
          <div><small>全部拼团</small><strong>{{ overview?.summary.totalGroups ?? 0 }}</strong></div>
          <div><small>进行中</small><strong>{{ overview?.summary.activeGroups ?? 0 }}</strong></div>
          <div><small>已完成</small><strong>{{ overview?.summary.completedGroups ?? 0 }}</strong></div>
          <div><small>已过期</small><strong>{{ overview?.summary.expiredGroups ?? 0 }}</strong></div>
          <div><small>参与人次</small><strong>{{ overview?.summary.participations ?? 0 }}</strong></div>
        </div>

        <el-table v-if="overview?.items.length" class="group-table" :data="overview.items" size="small">
          <el-table-column label="邀请码" min-width="130">
            <template #default="{ row }"><code>{{ row.code }}</code></template>
          </el-table-column>
          <el-table-column label="发起人" min-width="150">
            <template #default="{ row }">
              <div class="owner-cell">
                <el-avatar :size="28" :src="row.owner.avatarUrl || undefined">{{ row.owner.username?.slice(0, 1) || "用" }}</el-avatar>
                <span>{{ row.owner.username }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="进度" width="90">
            <template #default="{ row }">{{ row.memberCount }} / {{ row.targetMembers }}</template>
          </el-table-column>
          <el-table-column label="每人奖励" width="110">
            <template #default="{ row }">{{ normalizePoints(row.rewardCents) }} 积分</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><el-tag :type="statusOf(row.status).type" effect="plain" size="small">{{ statusOf(row.status).label }}</el-tag></template>
          </el-table-column>
          <el-table-column label="发起时间" width="130">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="到期/完成" width="130">
            <template #default="{ row }">{{ formatTime(row.completedAt || row.expiresAt) }}</template>
          </el-table-column>
        </el-table>
        <div v-else class="empty-groups">当前活动期还没有用户发起拼团</div>
      </section>
    </PageCard>
  </div>
</template>

<style scoped>
.group-admin-page { min-width: 0; }
.page-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
.page-toolbar > div { display: flex; gap: 8px; }
.sync-state { display: inline-flex; height: 32px; align-items: center; gap: 7px; padding: 0 11px; color: var(--ink-3); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight: 650; }
.sync-state i { width: 7px; height: 7px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 3px var(--success-soft); }
.sync-state.is-dirty { color: var(--warning); }
.sync-state.is-dirty i { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-soft); }
.activity-state { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.activity-state__main,
.activity-rule { display: flex; min-height: 118px; align-items: center; gap: 13px; padding: 20px; }
.activity-state__main { background: var(--surface); border-right: 1px solid var(--border); }
.activity-rule { align-items: flex-start; justify-content: center; flex-direction: column; background: var(--surface-2); }
.activity-indicator { width: 11px; height: 11px; flex: 0 0 auto; background: var(--ink-3); border-radius: 50%; }
.activity-indicator.is-open { background: var(--success); box-shadow: 0 0 0 5px var(--success-soft); }
.activity-state small,
.activity-state p,
.activity-state span { color: var(--ink-3); font-size: 11px; }
.activity-state h2 { margin: 4px 0 0; color: var(--ink); font-size: 18px; }
.activity-state p { margin: 6px 0 0; line-height: 1.5; }
.activity-rule strong { color: var(--ink); font-size: 14px; }
.config-section,
.operations-section { margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--border); }
.config-section > header,
.operations-section > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 13px; }
.config-section h2,
.operations-section h2 { margin: 0; color: var(--ink); font-size: 14px; }
.config-section header p,
.operations-section header p { margin: 4px 0 0; color: var(--ink-3); font-size: 11px; }
.config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.config-control { display: grid; min-width: 0; gap: 8px; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
.config-control.is-switch { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.config-control.is-switch div { display: flex; flex-direction: column; gap: 5px; }
.config-control > span,
.config-control strong { color: var(--ink); font-size: 12px; font-weight: 700; }
.config-control small { color: var(--ink-3); font-size: 11px; line-height: 1.45; }
.config-control :deep(.el-input-number) { width: 100%; }
.number-with-unit { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.number-with-unit b { color: var(--ink-3); font-size: 11px; }
.config-warning { display: flex; align-items: flex-start; gap: 9px; margin-top: 10px; padding: 10px 12px; color: var(--ink-3); background: var(--warning-soft); border-radius: 6px; font-size: 11px; line-height: 1.5; }
.config-warning i { color: var(--warning); }
.metric-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.metric-row > div { display: flex; min-height: 62px; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 14px; background: var(--surface); border-right: 1px solid var(--border); }
.metric-row > div:last-child { border-right: 0; }
.metric-row small { color: var(--ink-3); font-size: 11px; }
.metric-row strong { color: var(--ink); font-size: 18px; font-variant-numeric: tabular-nums; }
.group-table { width: 100%; margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.group-table code { color: var(--accent-ink); font-size: 12px; font-weight: 750; letter-spacing: .04em; }
.owner-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.owner-cell span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-groups { display: grid; min-height: 110px; margin-top: 12px; place-items: center; color: var(--ink-3); background: var(--surface-2); border: 1px dashed var(--border); border-radius: 8px; font-size: 12px; }

@media (max-width: 820px) {
  .activity-state,
  .config-grid { grid-template-columns: minmax(0, 1fr); }
  .activity-state__main { border-right: 0; border-bottom: 1px solid var(--border); }
  .metric-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-row > div { border-bottom: 1px solid var(--border); }
}

@media (max-width: 560px) {
  .page-toolbar { align-items: stretch; flex-direction: column; }
  .page-toolbar > div:last-child { display: grid; grid-template-columns: 1fr 1fr; }
  .config-section > header,
  .operations-section > header { align-items: flex-start; flex-direction: column; }
  .metric-row { grid-template-columns: minmax(0, 1fr); }
  .metric-row > div { border-right: 0; }
}
</style>
