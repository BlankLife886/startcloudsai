<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { Check, Refresh, Search, Star, Warning } from "@element-plus/icons-vue";
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

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "未通过" },
] as const;

const statusLabels: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "未通过",
};

const statusTypes: Record<string, "warning" | "success" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

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

const {
  items,
  loading,
  error,
  total,
  page,
  hasPrev,
  hasNext,
  reset,
  next,
  prev,
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
          limit: 20,
          cursor,
        },
      },
    );
    campaign.value = result.campaign || null;
    return result;
  },
  () => filters,
);

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
  <div class="page trial-page">
    <PageCard>
      <section v-if="campaign" class="campaign-overview">
        <div class="campaign-overview__identity">
          <span :class="{ 'is-open': campaign.status === 'active' && !campaign.full }">
            {{
              campaign.expired
                ? "活动已过期"
                : campaign.status === 'active'
                ? campaign.full
                  ? "名额已满"
                  : "申请开放中"
                : "活动已关闭"
            }}
          </span>
          <strong>{{ campaign.title }}</strong>
          <small>
            {{ campaignFeatures(campaign).map((feature) => feature.label).join("、") }} ·
            {{ campaign.accessMode === "restricted" ? "权限内测" : "功能专属积分" }}
          </small>
        </div>
        <dl class="campaign-overview__stats">
          <div>
            <dt>真实申请</dt>
            <dd>{{ campaign.actualApplied.toLocaleString("zh-CN") }}</dd>
          </div>
          <div>
            <dt>用户端展示</dt>
            <dd>{{ campaign.displayApplied.toLocaleString("zh-CN") }}</dd>
          </div>
          <div>
            <dt>总名额</dt>
            <dd>{{ campaign.capacity.toLocaleString("zh-CN") }}</dd>
          </div>
          <div>
            <dt>剩余</dt>
            <dd>{{ campaign.remaining.toLocaleString("zh-CN") }}</dd>
          </div>
        </dl>
        <div class="campaign-overview__progress" aria-hidden="true">
          <span :style="{ width: `${campaignProgress}%` }"></span>
        </div>
        <p>
          截止 {{ formatTime(campaign.expiresAt) }} · 展示调整 {{ campaign.displayOffset >= 0 ? "+" : ""
          }}{{ campaign.displayOffset }} · 名额占用 {{ campaignProgress }}%
        </p>
      </section>

      <div class="trial-toolbar">
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

        <div class="trial-toolbar__actions">
          <TrialCampaignSettingsDialog @saved="onCampaignsSaved" />
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
          <el-button @click="reset">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refresh"
            >刷新</el-button
          >
        </div>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        viewport-height="clamp(380px, calc(100vh - 230px), 730px)"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        @prev="prev"
        @next="next"
      >
        <el-table
          v-loading="loading"
          class="trial-table"
          :data="items"
          height="100%"
          size="small"
          table-layout="fixed"
        >
          <template #empty>
            <el-empty description="暂无体验资格申请" :image-size="64" />
          </template>

          <el-table-column label="序号" width="76" align="center">
            <template #default="{ row }">
              <span class="tnum">#{{ row.applicationNo }}</span>
            </template>
          </el-table-column>

          <el-table-column label="申请用户" min-width="210">
            <template #default="{ row }">
              <div class="trial-user">
                <span>{{ row.username || "未命名用户" }}</span>
                <small>{{ row.userEmail }}</small>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="体验功能" min-width="150">
            <template #default="{ row }">
              <div class="trial-feature-cell">
                <div class="trial-feature-cell__tags">
                  <el-tag
                    v-for="feature in applicationFeatures(row)"
                    :key="feature.key"
                    size="small"
                    effect="plain"
                  >{{ feature.label || feature.key }}</el-tag>
                </div>
                <small>{{ applicationFeatures(row).flatMap((feature) => feature.taskTypes).join(", ") }}</small>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="职业" min-width="150">
            <template #default="{ row }">
              <span class="trial-occupation">{{ row.occupation }}</span>
            </template>
          </el-table-column>

          <el-table-column label="申请理由" min-width="300">
            <template #default="{ row }">
              <el-tooltip
                :content="row.reason"
                placement="top"
                :show-after="300"
              >
                <p class="trial-reason">{{ row.reason }}</p>
              </el-tooltip>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag
                :type="statusTypes[row.status]"
                effect="light"
                size="small"
              >
                {{ statusLabels[row.status] || row.status }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="积分发放 / 审核说明" min-width="230">
            <template #default="{ row }">
              <div v-if="row.rewardCents" class="trial-reward-cell">
                <strong>+{{ formatPoints(row.rewardCents) }}</strong>
                <small>
                  {{
                    row.rewardStatus === "redeemed"
                      ? "用户已领取"
                      : row.rewardStatus === "expired"
                        ? "领取已过期"
                        : "待用户领取"
                  }}
                </small>
              </div>
              <div v-else-if="row.reviewNote" class="trial-review-note">
                {{ row.reviewNote }}
              </div>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>

          <el-table-column label="提交时间" width="176">
            <template #default="{ row }">
              <span class="tnum">{{ formatTime(row.createdAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="176" fixed="right" align="right">
            <template #default="{ row }">
              <div v-if="row.status === 'pending'" class="trial-actions">
                <el-button
                  size="small"
                  type="success"
                  :icon="Check"
                  @click="openApprove(row as TrialApplication)"
                >
                  通过
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :icon="Warning"
                  @click="openReject(row as TrialApplication)"
                >
                  不通过
                </el-button>
              </div>
              <el-button
                v-else-if="row.status === 'approved' && row.rewardStatus === 'expired'"
                size="small"
                type="warning"
                plain
                :icon="Refresh"
                @click="openReissue(row as TrialApplication)"
              >补发积分</el-button>
              <span v-else class="muted">已处理</span>
            </template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="approveOpen"
      :title="reviewMode === 'reissue' ? '补发体验积分' : '通过体验资格申请'"
      :subtitle="selected ? `${selected.username} · ${selected.userEmail}` : ''"
      :icon="Star"
      width="500px"
      :confirm-text="reviewMode === 'reissue' ? '确认补发积分' : '通过并推送积分礼包'"
      confirm-type="success"
      :confirm-loading="reviewing"
      @confirm="approve"
    >
      <el-form label-width="104px" @submit.prevent="approve">
        <el-form-item label="授权功能">
          <div class="trial-approved-features">
            <el-tag
              v-for="feature in selected?.features || (selected?.feature ? [selected.feature] : [])"
              :key="feature.key"
              effect="plain"
            >{{ feature.label }} · {{ feature.route }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item label="体验积分" required>
          <el-input-number
            v-model="approveForm.valuePoints"
            :min="1"
            :max="10000000"
            :step="100"
            controls-position="right"
          />
          <span class="form-suffix">积分</span>
        </el-form-item>
        <el-form-item label="领取有效期">
          <el-date-picker
            v-model="approveForm.expiresAt"
            type="datetime"
            placeholder="留空则永久有效"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="审核说明">
          <el-input
            v-model="approveForm.note"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="可选，用户可以看到"
          />
        </el-form-item>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="rejectOpen"
      title="不通过体验资格申请"
      :subtitle="selected ? `${selected.username} · ${selected.userEmail}` : ''"
      :icon="Warning"
      width="500px"
      confirm-text="确认不通过"
      confirm-type="danger"
      :confirm-loading="reviewing"
      @confirm="reject"
    >
      <el-form label-width="92px" @submit.prevent="reject">
        <el-form-item label="原因" required>
          <el-input
            v-model="rejectReason"
            type="textarea"
            :rows="5"
            maxlength="500"
            show-word-limit
            placeholder="请填写用户可以看到的审核说明"
          />
        </el-form-item>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="resultOpen"
      title="体验资格已通过"
      subtitle="积分礼包与站内通知已同步推送"
      :icon="Check"
      width="480px"
      hide-footer
    >
      <div v-if="approvedResult" class="approval-result">
        <span>{{ approvedResult.userEmail }}</span>
        <strong>+{{ formatPoints(approvedResult.rewardCents) }}</strong>
        <p>
          「{{ approvedResult.feature.label }}」体验权限已经生效，专属积分等待用户领取。
        </p>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
.campaign-overview {
  position: relative;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(420px, 1.5fr);
  gap: 14px 28px;
  margin-bottom: 16px;
  padding: 16px 18px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.campaign-overview__identity {
  display: grid;
  align-content: center;
  gap: 4px;
}

.campaign-overview__identity > span {
  width: max-content;
  color: var(--danger);
  font-size: 11px;
  font-weight: 700;
}

.campaign-overview__identity > span.is-open {
  color: var(--success);
}

.campaign-overview__identity strong {
  color: var(--ink);
  font-size: 16px;
}

.campaign-overview__identity small,
.campaign-overview > p,
.campaign-overview__stats dt {
  color: var(--ink-3);
  font-size: 11px;
}

.campaign-overview__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.campaign-overview__stats > div {
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border-left: 1px solid var(--border);
}

.campaign-overview__stats dd {
  margin: 0;
  color: var(--ink);
  font-size: 17px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.campaign-overview__progress {
  grid-column: 1 / -1;
  height: 5px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--border);
}

.campaign-overview__progress span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 220ms ease;
}

.campaign-overview > p {
  grid-column: 1 / -1;
  margin: -6px 0 0;
  text-align: right;
}

.trial-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.trial-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-2);
  border-radius: 12px;
}

.trial-tab {
  min-height: 32px;
  padding: 0 13px;
  color: var(--ink-2);
  background: transparent;
  border: 0;
  border-radius: 9px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.trial-tab.is-active {
  color: var(--accent-on);
  background: var(--accent);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 24%, transparent);
}

.trial-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.trial-search {
  width: 250px;
}

.trial-campaign-select {
  width: 270px;
}

.trial-user,
.trial-reward-cell {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.trial-user span,
.trial-reward-cell strong {
  overflow: hidden;
  color: var(--ink);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trial-user small,
.trial-reward-cell small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trial-occupation {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trial-feature-cell {
  display: grid;
  gap: 5px;
}

.trial-feature-cell__tags,
.trial-approved-features {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.trial-feature-cell small {
  color: var(--ink-3);
  font-size: 11px;
}

.trial-reason {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--ink-2);
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.trial-review-note {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink-2);
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.trial-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.muted {
  color: var(--ink-3);
}

.form-suffix {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: 12px;
}

.trial-approved-features {
  padding-top: 3px;
}

.approval-result {
  display: grid;
  place-items: center;
  gap: 12px;
  padding: 16px 8px 8px;
  text-align: center;
}

.approval-result > span {
  color: var(--ink-3);
  font-size: 12px;
}

.approval-result > strong {
  font-size: 20px;
}

.approval-result > p {
  max-width: 340px;
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 820px) {
  .trial-toolbar__actions,
  .trial-search {
    width: 100%;
  }
}
</style>
