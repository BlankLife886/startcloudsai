<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import {
  ChatDotRound,
  Link,
  Refresh,
  Search,
  Select,
} from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { request, type Page } from "@/request";
import { usePagedList } from "@/usePagedList";
import { formatPoints, formatTime, normalizePoints } from "@/utils";

interface FeedbackItem {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  category: string;
  title: string;
  content: string;
  pageUrl: string | null;
  userAgent: string | null;
  status: "open" | "in_progress" | "resolved" | "closed";
  adminReply: string | null;
  handledBy: string | null;
  handledAt: string | null;
  adopted: boolean;
  rewardCents: number;
  rewardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "open", label: "待处理" },
  { value: "in_progress", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "全部分类" },
  { value: "bug", label: "功能异常" },
  { value: "generation", label: "生成问题" },
  { value: "account", label: "账号问题" },
  { value: "billing", label: "积分与兑换" },
  { value: "suggestion", label: "产品建议" },
  { value: "other", label: "其他问题" },
];

const statusLabels: Record<string, string> = {
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};
const statusTypes: Record<string, "warning" | "primary" | "success" | "info"> =
  {
    open: "warning",
    in_progress: "primary",
    resolved: "success",
    closed: "info",
  };
const categoryLabels = Object.fromEntries(
  CATEGORY_OPTIONS.filter((item) => item.value).map((item) => [
    item.value,
    item.label,
  ]),
);

const PAGE_LABELS: Record<string, string> = {
  "/": "首页",
  "/studio": "创作台",
  "/text-to-image": "文生图",
  "/canvas": "无限画布",
  "/assistant": "AI 助手",
  "/ai-illustration-coloring": "插画染色",
  "/design-workshop": "UI 设计稿",
  "/model-sheet": "模型设计",
  "/game-art": "游戏设计",
  "/ecommerce-design": "AI 电商",
  "/tools/background-remove": "背景移除",
  "/tools/image-compress": "图片压缩",
  "/tools/puzzle": "拼图",
  "/prompts": "提示词",
  "/assets": "我的资产",
  "/history": "历史记录",
  "/check-in": "每日签到",
  "/wallet": "钱包",
  "/pricing": "创作价格",
  "/profile": "个人中心",
  "/account": "账号设置",
  "/notifications": "通知中心",
  "/submissions": "我的投稿",
  "/incentive-plans": "创作激励",
  "/incentive-plans/group": "好友拼团",
  "/incentive-plans/membership": "会员计划",
  "/incentive-plans/failure": "失败补偿",
  "/incentive-plans/suggestion": "建议采纳",
  "/incentive-plans/usage": "用量计划",
  "/share": "社区",
  "/updates": "更新说明",
  "/app-space": "关于我们",
  "/feedback": "问题反馈",
};

function pagePath(raw?: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return (value.startsWith("http") ? new URL(value).pathname : value)
      .replace(/\/+$/, "") || "/";
  } catch {
    return value;
  }
}

function pageLabel(raw?: string | null) {
  const path = pagePath(raw);
  if (PAGE_LABELS[path]) return PAGE_LABELS[path];
  if (path.startsWith("/canvas")) return PAGE_LABELS["/canvas"];
  if (path.startsWith("/ecommerce-design")) return PAGE_LABELS["/ecommerce-design"];
  if (path.startsWith("/incentive-plans")) return PAGE_LABELS["/incentive-plans"];
  return valueOrEmpty(raw);
}

function valueOrEmpty(raw?: string | null) {
  return String(raw || "").trim();
}

function isExternalPage(raw?: string | null) {
  return /^https?:\/\//i.test(String(raw || "").trim());
}

const route = useRoute();
const filters = reactive({ status: "open", category: "", search: "" });

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
} = usePagedList<FeedbackItem>(
  (cursor) =>
    request<Page<FeedbackItem>>("/api/v1/admin/feedback", {
      query: {
        status: filters.status,
        category: filters.category,
        search: filters.search.trim(),
        limit: 20,
        cursor,
      },
    }),
  () => filters,
);

function setStatus(status: string) {
  if (filters.status === status) return;
  filters.status = status;
  void reset();
}

function clearFilters() {
  filters.status = "open";
  filters.category = "";
  filters.search = "";
  void reset();
}

const selected = ref<FeedbackItem | null>(null);
const reviewOpen = ref(false);
const reviewing = ref(false);
const savingLimit = ref(false);
const suggestionRewardMax = ref(10000);
const savedSuggestionRewardMax = ref(10000);
const reviewForm = reactive({
  status: "in_progress",
  adminReply: "",
  adopted: false,
  rewardPoints: 100,
});
const limitDirty = () =>
  normalizePoints(suggestionRewardMax.value) !==
  normalizePoints(savedSuggestionRewardMax.value);

function openReview(row: FeedbackItem) {
  selected.value = row;
  reviewForm.status = row.status === "open" ? "in_progress" : row.status;
  reviewForm.adminReply = row.adminReply || "";
  reviewForm.adopted = row.adopted === true;
  reviewForm.rewardPoints = Math.min(
    row.rewardCents || 100,
    Math.max(1, suggestionRewardMax.value),
  );
  reviewOpen.value = true;
}

async function submitReview() {
  if (!selected.value || reviewing.value) return;
  const reply = reviewForm.adminReply.trim();
  if (["resolved", "closed"].includes(reviewForm.status) && !reply) {
    ElMessage.warning("解决或关闭反馈时必须填写给用户的回复");
    return;
  }
  if (reviewForm.adopted && !selected.value.adopted) {
    if (selected.value.category !== "suggestion") {
      ElMessage.warning("只有产品建议可以标记为已采纳");
      return;
    }
    if (!["resolved", "closed"].includes(reviewForm.status)) {
      ElMessage.warning("采纳建议时须同时解决或关闭反馈");
      return;
    }
    const reward = normalizePoints(reviewForm.rewardPoints);
    if (reward <= 0 || reward > suggestionRewardMax.value) {
      ElMessage.warning(`建议采纳奖励须在 1-${suggestionRewardMax.value} 积分之间`);
      return;
    }
  }
  reviewing.value = true;
  try {
    await request(`/api/v1/admin/feedback/${selected.value.id}`, {
      method: "PATCH",
      body: {
        status: reviewForm.status,
        adminReply: reply || undefined,
        adopted: reviewForm.adopted,
        rewardCents:
          reviewForm.adopted && !selected.value.adopted
            ? normalizePoints(reviewForm.rewardPoints)
            : undefined,
      },
    });
    reviewOpen.value = false;
    ElMessage.success("反馈状态已更新，处理结果已通知用户");
    await refresh();
  } finally {
    reviewing.value = false;
  }
}

async function loadSuggestionRewardLimit() {
  try {
    const settings = await request<{ suggestionRewardMaxCents?: number }>(
      "/api/v1/admin/settings",
      { silent: true },
    );
    const value = normalizePoints(settings.suggestionRewardMaxCents ?? 10000);
    suggestionRewardMax.value = value;
    savedSuggestionRewardMax.value = value;
  } catch {
    // 列表仍可处理普通反馈，采纳时后端继续执行最终上限校验。
  }
}

async function saveSuggestionRewardLimit() {
  const value = normalizePoints(suggestionRewardMax.value);
  if (value < 0 || value > 1_000_000) {
    ElMessage.warning("建议采纳上限须在 0-1000000 积分之间");
    return;
  }
  savingLimit.value = true;
  try {
    const settings = await request<{ suggestionRewardMaxCents?: number }>(
      "/api/v1/admin/settings",
      {
        method: "PUT",
        body: { suggestionRewardMaxCents: value },
      },
    );
    const next = normalizePoints(settings.suggestionRewardMaxCents ?? value);
    suggestionRewardMax.value = next;
    savedSuggestionRewardMax.value = next;
    reviewForm.rewardPoints = Math.min(reviewForm.rewardPoints, Math.max(1, next));
    ElMessage.success("建议采纳上限已生效，前台将展示该积分上限");
  } finally {
    savingLimit.value = false;
  }
}

onMounted(() => {
  const search = String(route.query.search || "").trim();
  if (search) {
    filters.search = search;
    filters.status = "";
  }
  void reset();
  void loadSuggestionRewardLimit();
});
</script>

<template>
  <div class="page feedback-admin-page">
    <PageCard>
      <div class="feedback-limit-bar">
        <div class="feedback-limit-bar__copy">
          <strong>建议采纳上限</strong>
          <small>前台展示单次最高奖励，后台采纳时也不能超过这个数</small>
        </div>
        <div class="feedback-limit-bar__actions">
          <div class="points-input">
            <el-input-number
              v-model="suggestionRewardMax"
              :min="0"
              :max="1000000"
              :step="100"
              :precision="0"
              controls-position="right"
            />
            <b>积分</b>
          </div>
          <el-button
            type="primary"
            :loading="savingLimit"
            :disabled="!limitDirty()"
            @click="saveSuggestionRewardLimit"
          >
            保存上限
          </el-button>
        </div>
      </div>
      <div class="feedback-toolbar">
        <div class="feedback-tabs" role="tablist" aria-label="反馈状态">
          <button
            v-for="option in STATUS_OPTIONS"
            :key="option.value || 'all'"
            type="button"
            role="tab"
            class="feedback-tab"
            :class="{ 'is-active': filters.status === option.value }"
            :aria-selected="filters.status === option.value"
            @click="setStatus(option.value)"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="feedback-toolbar__actions">
          <el-select
            v-model="filters.category"
            class="feedback-category-filter"
            placeholder="全部分类"
            @change="reset"
          >
            <el-option
              v-for="option in CATEGORY_OPTIONS"
              :key="option.value || 'all'"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-input
            v-model="filters.search"
            class="feedback-search"
            :prefix-icon="Search"
            placeholder="搜索用户、标题或内容"
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
          class="feedback-table"
          :data="items"
          height="100%"
          size="small"
          table-layout="fixed"
          @row-dblclick="openReview"
        >
          <template #empty>
            <el-empty description="暂无用户反馈" :image-size="64" />
          </template>

          <el-table-column label="反馈用户" min-width="200">
            <template #default="{ row }">
              <div class="feedback-user">
                <span>{{ row.username || "未命名用户" }}</span>
                <small>{{ row.userEmail }}</small>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="分类" width="126">
            <template #default="{ row }">
              <span class="feedback-category">{{
                categoryLabels[row.category] || row.category
              }}</span>
              <el-tag v-if="row.adopted" type="warning" size="small" effect="plain">
                已采纳 · {{ formatPoints(row.rewardCents) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="问题" min-width="380">
            <template #default="{ row }">
              <div class="feedback-problem">
                <strong>{{ row.title }}</strong>
                <p>{{ row.content }}</p>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="105" align="center">
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

          <el-table-column label="管理员回复" min-width="250">
            <template #default="{ row }">
              <p v-if="row.adminReply" class="feedback-reply-cell">
                {{ row.adminReply }}
              </p>
              <span v-else class="muted">尚未回复</span>
            </template>
          </el-table-column>

          <el-table-column label="提交时间" width="176">
            <template #default="{ row }">
              <span class="tnum">{{ formatTime(row.createdAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="112" fixed="right" align="right">
            <template #default="{ row }">
              <el-button
                type="primary"
                plain
                size="small"
                @click="openReview(row as FeedbackItem)"
              >
                {{ row.status === "open" ? "开始处理" : "查看处理" }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="reviewOpen"
      title="处理用户反馈"
      :subtitle="
        selected
          ? `${selected.username || '未命名用户'} · ${selected.userEmail}`
          : ''
      "
      :icon="ChatDotRound"
      width="640px"
      confirm-text="保存并通知用户"
      :confirm-icon="Select"
      :confirm-loading="reviewing"
      @confirm="submitReview"
    >
      <div v-if="selected" class="feedback-review">
        <div class="feedback-review__summary">
          <div>
            <el-tag effect="plain" size="small">{{
              categoryLabels[selected.category]
            }}</el-tag>
            <span>{{ formatTime(selected.createdAt) }}</span>
          </div>
          <h3>{{ selected.title }}</h3>
          <p>{{ selected.content }}</p>
          <a
            v-if="selected.pageUrl && isExternalPage(selected.pageUrl)"
            :href="selected.pageUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <el-icon><Link /></el-icon>{{ pageLabel(selected.pageUrl) }}
          </a>
          <span v-else-if="selected.pageUrl">{{ pageLabel(selected.pageUrl) }}</span>
        </div>

        <el-form label-width="92px" @submit.prevent="submitReview">
          <el-form-item label="处理状态" required>
            <el-select v-model="reviewForm.status" style="width: 100%">
              <el-option label="待处理" value="open" />
              <el-option label="处理中" value="in_progress" />
              <el-option label="已解决" value="resolved" />
              <el-option label="已关闭" value="closed" />
            </el-select>
          </el-form-item>
          <el-form-item
            label="回复用户"
            :required="['resolved', 'closed'].includes(reviewForm.status)"
          >
            <el-input
              v-model="reviewForm.adminReply"
              type="textarea"
              :rows="5"
              maxlength="2000"
              show-word-limit
              placeholder="说明处理进度、解决方法或后续计划；用户会收到站内通知。"
            />
          </el-form-item>
          <el-form-item v-if="selected.category === 'suggestion'" label="建议采纳">
            <div class="feedback-adoption-control">
              <el-switch
                v-model="reviewForm.adopted"
                :disabled="selected.adopted || suggestionRewardMax <= 0"
                active-text="采纳并奖励"
              />
              <div v-if="reviewForm.adopted" class="feedback-adoption-points">
                <el-input-number
                  v-model="reviewForm.rewardPoints"
                  :min="1"
                  :max="Math.max(1, suggestionRewardMax)"
                  :step="10"
                  :precision="0"
                  :disabled="selected.adopted"
                />
                <span>积分</span>
              </div>
              <small v-if="selected.adopted">
                已于 {{ formatTime(selected.rewardedAt) }} 发放，不能重复奖励
              </small>
              <small v-else-if="suggestionRewardMax <= 0">
                建议奖励当前未开放，请先在系统设置中配置奖励上限
              </small>
            </div>
          </el-form-item>
        </el-form>

        <details v-if="selected.userAgent" class="feedback-diagnostic">
          <summary>浏览器诊断信息</summary>
          <code>{{ selected.userAgent }}</code>
        </details>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
.feedback-admin-page {
  height: 100%;
}
.feedback-admin-page :deep(.page-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.feedback-limit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}
.feedback-limit-bar__copy {
  min-width: 0;
}
.feedback-limit-bar__copy strong {
  display: block;
  font-size: 13px;
}
.feedback-limit-bar__copy small {
  display: block;
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}
.feedback-limit-bar__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}
.points-input {
  display: flex;
  align-items: center;
  gap: 8px;
}
.points-input :deep(.el-input-number) {
  width: 148px;
}
.points-input b {
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 600;
}
.feedback-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.feedback-tabs {
  display: flex;
  gap: 3px;
  padding: 4px;
  border-radius: 12px;
  background: var(--el-fill-color-light);
}
.feedback-tab {
  min-height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  color: var(--el-text-color-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.feedback-tab.is-active {
  color: #182000;
  background: #8ade00;
  box-shadow: 0 5px 14px rgb(112 185 0 / 18%);
  font-weight: 700;
}
.feedback-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.feedback-category-filter {
  width: 135px;
}
.feedback-search {
  width: 230px;
}
.feedback-adoption-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.feedback-adoption-points {
  display: flex;
  align-items: center;
  gap: 8px;
}
.feedback-adoption-control small {
  width: 100%;
  color: var(--el-text-color-secondary);
}
.feedback-user span,
.feedback-user small {
  display: block;
}
.feedback-user span {
  font-weight: 650;
}
.feedback-user small {
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.feedback-category {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 8px;
  color: #6854ca;
  background: rgb(104 84 202 / 8%);
  font-size: 11px;
  font-weight: 650;
}
.feedback-problem strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feedback-problem p,
.feedback-reply-cell {
  display: -webkit-box;
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.45;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.feedback-reply-cell {
  margin: 0;
  color: var(--el-text-color-regular);
}
.muted {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}
.feedback-review {
  display: grid;
  gap: 20px;
}
.feedback-review__summary {
  padding: 17px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 13px;
  background: var(--el-fill-color-lighter);
}
.feedback-review__summary > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.feedback-review__summary h3 {
  margin: 15px 0 8px;
  font-size: 15px;
}
.feedback-review__summary p {
  margin: 0;
  white-space: pre-wrap;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.7;
}
.feedback-review__summary a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 13px;
  color: var(--el-color-primary);
  font-size: 11px;
  text-decoration: none;
}
.feedback-diagnostic {
  padding: 10px 13px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.feedback-diagnostic summary {
  cursor: pointer;
}
.feedback-diagnostic code {
  display: block;
  margin-top: 8px;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.5;
}
@media (max-width: 1100px) {
  .feedback-limit-bar {
    align-items: flex-start;
    flex-direction: column;
  }
  .feedback-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .feedback-toolbar__actions {
    width: 100%;
    flex-wrap: wrap;
  }
  .feedback-search {
    flex: 1;
    min-width: 200px;
  }
}
</style>
