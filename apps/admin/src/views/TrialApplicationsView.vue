<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { Refresh, Search, Star } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import TrialCampaignSettingsDialog from "@/components/settings/TrialCampaignSettingsDialog.vue";
import { request, type Page } from "@/request";
import { usePagedList } from "@/usePagedList";
import { formatPoints, formatTime, normalizePoints } from "@/utils";

interface TrialApplication {
  id: string;
  applicationNo: number;
  userId: string;
  userEmail: string;
  username: string;
  occupation: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rewardCents: number | null;
  rewardExpiresAt: string | null;
  rewardStatus: string | null;
  featureKey: string;
  feature: TrialFeature;
  featureKeys: string[];
  features: TrialFeature[];
  entitlementActive: boolean;
}

interface TrialFeature {
  key: string;
  label: string;
  route: string;
  taskTypes: string[];
  runtimeKey?: string;
  icon?: string;
  entitlementActive?: boolean;
}

interface TrialCampaign {
  id: string;
  enabled: boolean;
  title: string;
  feature: TrialFeature;
  featureKeys: string[];
  features: TrialFeature[];
  accessMode: "credit_only" | "restricted";
  capacity: number;
  actualApplied: number;
  displayOffset: number;
  displayApplied: number;
  remaining: number;
  full: boolean;
  status: "draft" | "active" | "closed";
  createdAt: string;
  expiresAt: string;
  remainingSeconds: number;
  expired: boolean;
}

interface TrialApplicationPage extends Page<TrialApplication> {
  campaign?: TrialCampaign;
}

function applicationFeatures(application: {
  features?: TrialFeature[];
  feature?: TrialFeature | null;
}): TrialFeature[] {
  return application.features?.length
    ? application.features
    : application.feature
      ? [application.feature]
      : [];
}

function campaignFeatures(campaign: TrialCampaign): TrialFeature[] {
  return campaign.features?.length
    ? campaign.features
    : campaign.feature
      ? [campaign.feature]
      : [];
}

function rewardStatusText(status?: string | null) {
  if (status === "redeemed") return "已领取";
  if (status === "expired") return "已过期";
  if (status) return "待领取";
  return "";
}

const STATUS_OPTIONS = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "未通过" },
  { value: "", label: "全部" },
] as const;

const statusLabels: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "未通过",
};

const rejectReasonPresets = [
  "申请理由不充分",
  "职业与体验功能不符",
  "资料不完整",
  "本期名额已满",
] as const;

const route = useRoute();
const filters = reactive({ campaignId: "", status: "pending", search: "" });
const campaign = ref<TrialCampaign | null>(null);
const campaignOptions = ref<TrialCampaign[]>([]);
const campaignProgress = computed(() => {
  if (!campaign.value?.capacity) return 0;
  return Math.min(
    100,
    Math.round((campaign.value.displayApplied / campaign.value.capacity) * 100),
  );
});

const campaignState = computed(() => {
  const item = campaign.value;
  if (!item) return { label: "", tone: "" };
  if (item.expired) return { label: "已过期", tone: "danger" };
  if (item.status === "active") {
    return item.full
      ? { label: "名额已满", tone: "warning" }
      : { label: "申请开放中", tone: "success" };
  }
  return { label: "活动已关闭", tone: "muted" };
});

const pageSize = ref(20);

const {
  items,
  loading,
  error,
  total,
  page,
  hasPrev,
  hasNext,
  reset,
  goToPage,
  refresh,
  retry,
} = usePagedList<TrialApplication>(
  async (cursor) => {
    const result = await request<TrialApplicationPage>(
      "/api/v1/admin/trial-access-applications",
      {
        query: {
          status: filters.status,
          campaignId: filters.campaignId,
          search: filters.search.trim(),
          limit: pageSize.value,
          cursor,
        },
      },
    );
    campaign.value = result.campaign || null;
    return result;
  },
  () => ({ ...filters, limit: pageSize.value }),
);

const hasFilters = computed(
  () => filters.status !== "pending" || Boolean(filters.search.trim()),
);

const emptyTitle = computed(() => {
  if (hasFilters.value) return "没有匹配的申请";
  return filters.status === "pending" ? "没有待审核申请" : "当前状态没有申请";
});

function setStatus(status: string) {
  if (filters.status === status) return;
  filters.status = status;
  void reset();
}

function clearFilters() {
  filters.status = "pending";
  filters.search = "";
  void reset();
}

const selected = ref<TrialApplication | null>(null);
const approveOpen = ref(false);
const rejectOpen = ref(false);
const reviewing = ref(false);
const reviewMode = ref<"approve" | "reissue">("approve");
const approveForm = reactive({
  valuePoints: 1000,
  expiresAt: null as Date | null,
  note: "",
});
const rejectReason = ref("");
const resultOpen = ref(false);
const approvedResult = ref<TrialApplication | null>(null);

function openApprove(row: TrialApplication) {
  reviewMode.value = "approve";
  selected.value = row;
  approveForm.valuePoints = 1000;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  approveForm.expiresAt = expiry;
  approveForm.note = "";
  approveOpen.value = true;
}

function openReissue(row: TrialApplication) {
  reviewMode.value = "reissue";
  selected.value = row;
  approveForm.valuePoints = row.rewardCents || 1000;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  approveForm.expiresAt = expiry;
  approveForm.note = row.reviewNote || "";
  approveOpen.value = true;
}

function openReject(row: TrialApplication) {
  selected.value = row;
  rejectReason.value = "";
  rejectOpen.value = true;
}

function applyRejectPreset(reason: string) {
  const parts = rejectReason.value
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const index = parts.indexOf(reason);
  if (index >= 0) parts.splice(index, 1);
  else parts.push(reason);
  rejectReason.value = parts.join("；");
}

function rejectPresetSelected(reason: string) {
  return rejectReason.value
    .split(/[；;]/)
    .map((part) => part.trim())
    .includes(reason);
}

async function approve() {
  if (!selected.value || reviewing.value) return;
  const grantCents = normalizePoints(approveForm.valuePoints);
  if (grantCents <= 0 || grantCents > 10_000_000) {
    ElMessage.warning("体验积分须在 1 - 10,000,000 之间");
    return;
  }
  if (approveForm.expiresAt && approveForm.expiresAt.getTime() <= Date.now()) {
    ElMessage.warning("领取有效期必须晚于当前时间");
    return;
  }
  reviewing.value = true;
  try {
    const reissue = reviewMode.value === "reissue";
    approvedResult.value = await request<TrialApplication>(
      reissue
        ? `/api/v1/admin/trial-access-applications/${selected.value.id}/reward-reissues`
        : `/api/v1/admin/trial-access-applications/${selected.value.id}`,
      {
        method: reissue ? "POST" : "PATCH",
        body: {
          ...(reissue ? {} : { status: "approved" }),
          grantCents,
          expiresAt: approveForm.expiresAt?.toISOString(),
          reviewNote: approveForm.note.trim() || undefined,
        },
      },
    );
    approveOpen.value = false;
    resultOpen.value = true;
    ElMessage.success(
      reissue ? "新的体验积分礼包已推送给用户" : "申请已通过，体验积分礼包已推送给用户",
    );
    await refresh();
  } finally {
    reviewing.value = false;
  }
}

async function reject() {
  if (!selected.value || reviewing.value) return;
  const note = rejectReason.value.trim();
  if (!note) {
    ElMessage.warning("请填写未通过原因");
    return;
  }
  reviewing.value = true;
  try {
    await request(
      `/api/v1/admin/trial-access-applications/${selected.value.id}`,
      {
        method: "PATCH",
        body: { status: "rejected", reviewNote: note },
      },
    );
    rejectOpen.value = false;
    ElMessage.success("审核结果已通知用户");
    await refresh();
  } finally {
    reviewing.value = false;
  }
}

async function loadCampaignOptions() {
  const data = await request<{ items: TrialCampaign[] }>("/api/v1/admin/trial-campaigns");
  campaignOptions.value = Array.isArray(data.items) ? data.items : [];
  if (!campaignOptions.value.some((item) => item.id === filters.campaignId)) {
    filters.campaignId =
      campaignOptions.value.find((item) => item.status === "active")?.id ||
      campaignOptions.value[0]?.id ||
      "";
  }
}

async function onCampaignsSaved() {
  await loadCampaignOptions();
  await reset();
}

onMounted(async () => {
  const search = String(route.query.search || "").trim();
  if (search) {
    filters.search = search;
    filters.status = "";
  }
  await loadCampaignOptions();
  await reset();
});
</script>

<template>
  <div class="trial-page">
    <header class="trial-toolbar">
      <div class="trial-tabs" role="tablist" aria-label="申请状态">
        <button
          v-for="option in STATUS_OPTIONS"
          :key="option.value || 'all'"
          type="button"
          role="tab"
          class="trial-tab"
          :class="{ 'is-active': filters.status === option.value }"
          :aria-selected="filters.status === option.value"
          @click="setStatus(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="trial-toolbar__right">
        <el-select
          v-model="filters.campaignId"
          class="trial-campaign-select"
          placeholder="选择活动"
          @change="reset"
        >
          <el-option
            v-for="item in campaignOptions"
            :key="item.id"
            :label="`${item.title} · ${item.status === 'active' ? '启用中' : item.status === 'draft' ? '草稿' : '已关闭'}`"
            :value="item.id"
          />
        </el-select>
        <el-input
          v-model="filters.search"
          class="trial-search"
          :prefix-icon="Search"
          placeholder="搜索邮箱、用户名或职业"
          clearable
          @keyup.enter="reset"
          @clear="reset"
        />
        <TrialCampaignSettingsDialog @saved="onCampaignsSaved" />
        <el-button v-if="hasFilters" @click="clearFilters">清除</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
      </div>
    </header>

    <section v-if="campaign" class="trial-campaign">
      <div class="trial-campaign__copy">
        <span class="trial-campaign__state" :class="`is-${campaignState.tone}`">
          {{ campaignState.label }}
        </span>
        <strong>{{ campaign.title }}</strong>
        <span>
          {{ campaignFeatures(campaign).map((feature) => feature.label).join("、") }}
          · {{ campaign.accessMode === "restricted" ? "权限内测" : "功能专属积分" }}
          · 截止 {{ formatTime(campaign.expiresAt) }}
        </span>
      </div>
      <div class="trial-campaign__stats">
        <div>
          <strong class="tnum">{{ campaign.actualApplied.toLocaleString("zh-CN") }}</strong>
          <span>申请</span>
        </div>
        <div>
          <strong class="tnum">{{ campaign.displayApplied.toLocaleString("zh-CN") }}</strong>
          <span>展示</span>
        </div>
        <div>
          <strong class="tnum">{{ campaign.capacity.toLocaleString("zh-CN") }}</strong>
          <span>名额</span>
        </div>
        <div>
          <strong class="tnum">{{ campaign.remaining.toLocaleString("zh-CN") }}</strong>
          <span>剩余</span>
        </div>
      </div>
      <div class="trial-campaign__meter" aria-hidden="true">
        <span :style="{ width: `${campaignProgress}%` }"></span>
      </div>
    </section>

    <ListError :error="error" :loading="loading" @retry="retry" />

    <div v-loading="loading && items.length > 0" class="trial-board">
      <div v-if="loading && !items.length" class="trial-empty">正在加载申请…</div>

      <div v-else-if="!items.length" class="trial-empty">
        <el-icon><Star /></el-icon>
        <strong>{{ emptyTitle }}</strong>
        <span>{{ hasFilters ? "调整筛选后再试" : "新申请会显示在这里" }}</span>
        <el-button v-if="hasFilters" @click="clearFilters">清除筛选</el-button>
      </div>

      <div v-else class="trial-list">
        <article
          v-for="row in items"
          :key="row.id"
          class="trial-card"
          :class="`is-${row.status}`"
        >
          <header>
            <div class="trial-card__title">
              <em class="tnum">#{{ row.applicationNo }}</em>
              <strong :title="row.userEmail">{{ row.username || "未命名用户" }}</strong>
            </div>
            <span class="trial-status" :class="`is-${row.status}`">
              {{ statusLabels[row.status] || row.status }}
            </span>
          </header>
          <p>{{ row.reason }}</p>
          <div class="trial-card__meta">
            <span>{{ row.occupation || "未填写职业" }}</span>
            <template v-for="feature in applicationFeatures(row)" :key="feature.key">
              <i>·</i>
              <span>{{ feature.label || feature.key }}</span>
            </template>
            <i>·</i>
            <span class="tnum">{{ formatTime(row.createdAt) }}</span>
            <template v-if="row.rewardCents">
              <i>·</i>
              <span>+{{ formatPoints(row.rewardCents) }} {{ rewardStatusText(row.rewardStatus) }}</span>
            </template>
            <template v-else-if="row.reviewNote">
              <i>·</i>
              <span :title="row.reviewNote">{{ row.reviewNote }}</span>
            </template>
          </div>
          <footer>
            <div v-if="row.status === 'pending'" class="trial-card__actions">
              <button type="button" class="trial-action is-approve" @click="openApprove(row)">
                通过
              </button>
              <button type="button" class="trial-action is-reject" @click="openReject(row)">
                不通过
              </button>
            </div>
            <button
              v-else-if="row.status === 'approved' && row.rewardStatus === 'expired'"
              type="button"
              class="trial-action is-reissue"
              @click="openReissue(row)"
            >
              补发积分
            </button>
          </footer>
        </article>
      </div>
    </div>

    <footer v-if="items.length" class="trial-footer">
      <CursorPager
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="(size: number) => { pageSize = size; reset() }"
      />
    </footer>

    <AdminDialog
      v-model="approveOpen"
      panel-class="trial-review-dialog"
      :title="reviewMode === 'reissue' ? '补发体验积分' : '通过申请'"
      :icon="Star"
      width="520px"
      :confirm-text="reviewMode === 'reissue' ? '确认补发' : '通过并推送'"
      :confirm-loading="reviewing"
      @confirm="approve"
    >
      <div v-if="selected" class="trial-review">
        <div class="trial-review__person">
          <strong>{{ selected.username || "未命名用户" }}</strong>
          <span>{{ selected.userEmail }} · {{ selected.occupation || "未填写职业" }}</span>
        </div>
        <div class="trial-review__features">
          <span
            v-for="feature in applicationFeatures(selected)"
            :key="feature.key"
          >{{ feature.label }}</span>
        </div>
        <label class="trial-review__field">
          <span>体验积分</span>
          <div class="trial-review__points">
            <el-input-number
              v-model="approveForm.valuePoints"
              :min="1"
              :max="10000000"
              :step="100"
              :controls="false"
            />
            <em>积分</em>
          </div>
        </label>
        <label class="trial-review__field">
          <span>领取有效期</span>
          <el-date-picker
            v-model="approveForm.expiresAt"
            type="datetime"
            placeholder="留空则永久有效"
            style="width: 100%"
          />
        </label>
        <el-input
          v-model="approveForm.note"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          resize="none"
          placeholder="审核说明，用户可见（可选）"
        />
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="rejectOpen"
      panel-class="trial-review-dialog"
      title="不通过申请"
      width="520px"
      confirm-text="确认不通过"
      confirm-type="danger"
      :confirm-disabled="!rejectReason.trim()"
      :confirm-loading="reviewing"
      @confirm="reject"
    >
      <div v-if="selected" class="trial-review">
        <div class="trial-review__person">
          <strong>{{ selected.username || "未命名用户" }}</strong>
          <span>{{ selected.userEmail }} · {{ selected.occupation || "未填写职业" }}</span>
        </div>
        <div class="trial-review__presets">
          <button
            v-for="reason in rejectReasonPresets"
            :key="reason"
            type="button"
            class="trial-review__chip"
            :class="{ 'is-active': rejectPresetSelected(reason) }"
            @click="applyRejectPreset(reason)"
          >
            {{ reason }}
          </button>
        </div>
        <el-input
          v-model="rejectReason"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          resize="none"
          placeholder="未通过原因会通知用户"
        />
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="resultOpen"
      title="已通过"
      :icon="Star"
      width="420px"
      hide-footer
    >
      <div v-if="approvedResult" class="trial-result">
        <strong>+{{ formatPoints(approvedResult.rewardCents) }}</strong>
        <span>{{ approvedResult.username || approvedResult.userEmail }}</span>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
.trial-page {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding: 0;
  background: var(--bg);
}

.trial-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.trial-tabs {
  display: inline-flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.trial-tab {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface);
  }

  &.is-active {
    background: var(--accent);
    color: var(--accent-on);
  }
}

.trial-toolbar__right {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.trial-campaign-select {
  width: 220px;
}

.trial-search {
  width: 220px;
}

.trial-campaign {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
  gap: 10px 18px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.trial-campaign__copy {
  display: grid;
  align-content: center;
  gap: 4px;
  min-width: 0;

  strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 15px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span:last-child {
    overflow: hidden;
    color: var(--ink-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.trial-campaign__state {
  width: max-content;
  font-size: 11px;
  font-weight: 700;

  &.is-success {
    color: var(--success);
  }

  &.is-warning {
    color: var(--warning);
  }

  &.is-danger {
    color: var(--danger);
  }

  &.is-muted {
    color: var(--ink-3);
  }
}

.trial-campaign__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;

  div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  strong {
    color: var(--ink);
    font-size: 18px;
    font-weight: 750;
  }

  span {
    color: var(--ink-3);
    font-size: 11px;
  }
}

.trial-campaign__meter {
  grid-column: 1 / -1;
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface-3);

  span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
}

.trial-board {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.trial-list {
  display: grid;
  flex: 1 1 auto;
  gap: 10px;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.trial-empty {
  display: grid;
  min-height: 280px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
  text-align: center;

  .el-icon {
    font-size: 30px;
  }

  strong {
    color: var(--ink);
  }

  span {
    font-size: 12px;
  }
}

.trial-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);

  &:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-sm);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  > p {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 1.5;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  footer:empty {
    display: none;
  }

  footer:not(:empty) {
    display: flex;
    justify-content: flex-end;
  }
}

.trial-card__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;

  em {
    color: var(--ink-3);
    font-size: 12px;
    font-style: normal;
    font-weight: 700;
  }

  strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.trial-status {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;

  &.is-pending {
    background: var(--warning-soft);
    color: var(--warning);
  }

  &.is-approved {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-rejected {
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.trial-card__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  white-space: nowrap;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  i {
    flex: 0 0 auto;
    font-style: normal;
  }
}

.trial-card__actions {
  display: flex;
  gap: 6px;
}

.trial-action {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  &.is-approve {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-reject {
    background: var(--danger-soft);
    color: var(--danger);
  }

  &.is-reissue {
    background: var(--warning-soft);
    color: var(--warning);
  }
}

.trial-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 40px;
}
</style>

<style lang="scss">
.trial-review {
  display: grid;
  gap: 14px;
}

.trial-review__person {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);

  strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--ink-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.trial-review__features {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--violet-soft);
    color: var(--violet);
    font-size: 11px;
    font-weight: 700;
  }
}

.trial-review__field {
  display: grid;
  gap: 6px;

  > span {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }
}

.trial-review__points {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);

  .el-input-number {
    width: 120px;
  }

  .el-input-number .el-input__wrapper {
    padding: 0;
    box-shadow: none;
    background: transparent;
  }

  em {
    color: var(--ink-3);
    font-size: 12px;
    font-style: normal;
  }
}

.trial-review__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trial-review__chip {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface-3);
  }

  &.is-active {
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.trial-result {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 8px 0 4px;
  text-align: center;

  strong {
    color: var(--ink);
    font-size: 28px;
    font-weight: 750;
  }

  span {
    color: var(--ink-3);
    font-size: 13px;
  }
}
</style>
