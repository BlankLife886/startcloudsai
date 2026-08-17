<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
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
const ruleChips = computed(() => [
  { label: "成团", value: `${form.targetMembers} 人` },
  {
    label: "奖励",
    value: `${normalizePoints(form.rewardPoints).toLocaleString("zh-CN")} 积分`,
  },
  { label: "有效期", value: `${form.durationHours} 小时` },
]);
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
      <div class="group-toolbar">
        <div class="sync-state" :class="{ 'is-dirty': isDirty }">
          <i />{{ isDirty ? "有未保存变更" : "配置已同步" }}
        </div>
        <div class="group-toolbar__actions">
          <el-button @click="load">刷新</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!isDirty"
            @click="save"
          >
            保存并生效
          </el-button>
        </div>
      </div>

      <div class="group-workspace">
        <section class="group-config">
          <div class="group-status" :class="{ 'is-open': form.enabled }">
            <div class="group-status__copy">
              <span class="group-status__dot" />
              <div>
                <strong>{{ form.enabled ? "活动开放中" : "活动已暂停" }}</strong>
                <p>
                  {{
                    form.enabled
                      ? "用户可以发起新拼团或输入邀请码加入"
                      : "用户只能查看已有拼团，不能发起或加入"
                  }}
                </p>
              </div>
            </div>
            <el-switch v-model="form.enabled" />
          </div>

          <div class="group-rules">
            <span v-for="chip in ruleChips" :key="chip.label">
              <small>{{ chip.label }}</small>
              <b>{{ chip.value }}</b>
            </span>
          </div>

          <div class="group-fields">
            <label class="group-field is-key">
              <span>
                <strong>活动期标识</strong>
                <small>仅后台可见，更换后开启新一期</small>
              </span>
              <el-input
                v-model="form.campaignKey"
                maxlength="64"
                placeholder="例如 launch-2026"
              />
            </label>
            <label class="group-field">
              <span>
                <strong>成团人数</strong>
                <small>满员后立即结算</small>
              </span>
              <el-input-number
                v-model="form.targetMembers"
                :min="2"
                :max="10"
                :precision="0"
                controls-position="right"
              />
            </label>
            <label class="group-field">
              <span>
                <strong>每人奖励</strong>
                <small>仅满员发放一次</small>
              </span>
              <div class="group-field__unit">
                <el-input-number
                  v-model="form.rewardPoints"
                  :min="0"
                  :max="1000000"
                  :precision="0"
                  controls-position="right"
                />
                <em>积分</em>
              </div>
            </label>
            <label class="group-field">
              <span>
                <strong>拼团有效期</strong>
                <small>超时后邀请码失效</small>
              </span>
              <div class="group-field__unit">
                <el-input-number
                  v-model="form.durationHours"
                  :min="1"
                  :max="720"
                  :precision="0"
                  controls-position="right"
                />
                <em>小时</em>
              </div>
            </label>
          </div>

          <p class="group-note">
            修改人数、奖励或有效期不会追溯已有拼团；修改活动期标识会开启全新一期。
          </p>
        </section>

        <section v-loading="overviewLoading" class="group-ops">
          <header class="group-ops__head">
            <div>
              <strong>当期运行</strong>
              <small data-no-translate>{{
                overview?.campaignKey || form.campaignKey
              }}</small>
            </div>
          </header>

          <div class="group-metrics">
            <div>
              <small>全部拼团</small>
              <strong>{{ overview?.summary.totalGroups ?? 0 }}</strong>
            </div>
            <div>
              <small>进行中</small>
              <strong>{{ overview?.summary.activeGroups ?? 0 }}</strong>
            </div>
            <div>
              <small>已完成</small>
              <strong>{{ overview?.summary.completedGroups ?? 0 }}</strong>
            </div>
            <div>
              <small>已过期</small>
              <strong>{{ overview?.summary.expiredGroups ?? 0 }}</strong>
            </div>
            <div>
              <small>参与人次</small>
              <strong>{{ overview?.summary.participations ?? 0 }}</strong>
            </div>
          </div>

          <div v-if="overview?.items.length" class="group-table-wrap">
          <el-table
            class="group-table"
            :data="overview.items"
            height="100%"
            size="small"
          >
            <el-table-column label="邀请码" min-width="130">
              <template #default="{ row }">
                <code>{{ row.code }}</code>
              </template>
            </el-table-column>
            <el-table-column label="发起人" min-width="150">
              <template #default="{ row }">
                <div class="owner-cell">
                  <el-avatar
                    :size="28"
                    :src="row.owner.avatarUrl || undefined"
                  >
                    {{ row.owner.username?.slice(0, 1) || "用" }}
                  </el-avatar>
                  <span>{{ row.owner.username }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="90">
              <template #default="{ row }">
                {{ row.memberCount }} / {{ row.targetMembers }}
              </template>
            </el-table-column>
            <el-table-column label="每人奖励" width="110">
              <template #default="{ row }">
                {{ normalizePoints(row.rewardCents) }} 积分
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag
                  :type="statusOf(row.status).type"
                  effect="plain"
                  size="small"
                >
                  {{ statusOf(row.status).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="发起时间" width="130">
              <template #default="{ row }">
                {{ formatTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="到期/完成" width="130">
              <template #default="{ row }">
                {{ formatTime(row.completedAt || row.expiresAt) }}
              </template>
            </el-table-column>
          </el-table>
          </div>
          <div v-else class="empty-groups">当前活动期还没有用户发起拼团</div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.group-admin-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.group-admin-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.group-admin-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.group-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
}

.group-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}

.group-toolbar__actions :deep(.el-button) {
  margin: 0;
  height: 32px;
}

.sync-state {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}

.sync-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.sync-state.is-dirty {
  color: var(--warning);
}

.sync-state.is-dirty i {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.group-workspace {
  display: grid;
  flex: 1;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
  min-height: 0;
}

.group-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.group-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);
}

.group-status.is-open {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
  background: var(--accent-soft);
}

.group-status__copy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.group-status__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ink-3);
}

.group-status.is-open .group-status__dot {
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
}

.group-status strong {
  display: block;
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
}

.group-status p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.45;
}

.group-rules {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.group-rules span {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
}

.group-rules small {
  color: var(--ink-3);
  font-size: 11px;
}

.group-rules b {
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.group-fields {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.group-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.group-field:last-child {
  border-bottom: 0;
}

.group-field.is-key {
  grid-template-columns: 1fr;
  gap: 8px;
}

.group-field > span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.group-field strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.group-field small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.4;
}

.group-field :deep(.el-input-number) {
  width: 108px;
}

.group-field__unit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.group-field__unit em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
}

.group-note {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}

.group-ops {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.group-ops__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
}

.group-ops__head strong {
  display: block;
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
}

.group-ops__head small {
  display: block;
  margin-top: 2px;
  color: var(--ink-3);
  font:
    600 11px/1.3 ui-monospace,
    monospace;
}

.group-metrics {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.group-metrics > div {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
}

.group-metrics small {
  color: var(--ink-3);
  font-size: 11px;
}

.group-metrics strong {
  color: var(--ink);
  font-size: 20px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.group-table-wrap {
  flex: 1;
  min-height: 0;
}

.group-table {
  width: 100%;
  --el-table-border-color: var(--border);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.group-table code {
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.04em;
}

.owner-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.owner-cell span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-groups {
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  border: 1px dashed var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 13px;
}
</style>
