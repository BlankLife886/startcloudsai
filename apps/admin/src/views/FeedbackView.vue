<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { ChatDotRound, Link, Refresh, Search } from "@element-plus/icons-vue";
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
  { value: "open", label: "待处理" },
  { value: "in_progress", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
  { value: "", label: "全部" },
];

const REVIEW_STATUSES = [
  { value: "open", label: "待处理" },
  { value: "in_progress", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
] as const;

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
  "/wallet": "我的钱包",
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

const hasFilters = computed(
  () =>
    filters.status !== "open" ||
    Boolean(filters.category) ||
    Boolean(filters.search.trim()),
);

const emptyTitle = computed(() => {
  if (hasFilters.value) return "没有匹配的反馈";
  return filters.status === "open" ? "没有待处理反馈" : "当前状态没有反馈";
});

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
const reviewNeedsReply = computed(() =>
  ["resolved", "closed"].includes(reviewForm.status),
);
const reviewConfirmDisabled = computed(
  () => reviewNeedsReply.value && !reviewForm.adminReply.trim(),
);
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
  <div class="feedback-page">
    <header class="feedback-toolbar">
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

      <div class="feedback-toolbar__right">
        <el-select
          v-model="filters.category"
          class="feedback-category"
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
        <div class="feedback-setting-pill is-limit" :class="{ 'is-dirty': limitDirty() }">
          <span>采纳上限</span>
          <el-input-number
            v-model="suggestionRewardMax"
            :min="0"
            :max="1000000"
            :step="100"
            :precision="0"
            :controls="false"
          />
          <button
            v-if="limitDirty()"
            type="button"
            class="feedback-setting-pill__save"
            :disabled="savingLimit"
            @click="saveSuggestionRewardLimit"
          >
            保存
          </button>
        </div>
        <el-button v-if="hasFilters" @click="clearFilters">清除</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
      </div>
    </header>

    <ListError :error="error" :loading="loading" @retry="retry" />

    <div v-loading="loading && items.length > 0" class="feedback-board">
      <div v-if="loading && !items.length" class="feedback-empty">正在加载反馈…</div>

      <div v-else-if="!items.length" class="feedback-empty">
        <el-icon><ChatDotRound /></el-icon>
        <strong>{{ emptyTitle }}</strong>
        <span>{{ hasFilters ? "调整筛选后再试" : "新反馈会显示在这里" }}</span>
        <el-button v-if="hasFilters" @click="clearFilters">清除筛选</el-button>
      </div>

      <div v-else class="feedback-list">
        <article
          v-for="row in items"
          :key="row.id"
          class="feedback-card"
          :class="`is-${row.status}`"
          @dblclick="openReview(row)"
        >
          <header>
            <strong :title="row.title">{{ row.title }}</strong>
            <span class="feedback-status" :class="`is-${row.status}`">
              {{ statusLabels[row.status] || row.status }}
            </span>
          </header>
          <p>{{ row.content }}</p>
          <div class="feedback-card__meta">
            <span :title="row.userEmail">{{ row.username || "未命名用户" }}</span>
            <i>·</i>
            <span>{{ categoryLabels[row.category] || row.category }}</span>
            <template v-if="pageLabel(row.pageUrl)">
              <i>·</i>
              <span>{{ pageLabel(row.pageUrl) }}</span>
            </template>
            <i>·</i>
            <span class="tnum">{{ formatTime(row.createdAt) }}</span>
            <template v-if="row.adopted">
              <i>·</i>
              <span>已采纳 {{ formatPoints(row.rewardCents) }}</span>
            </template>
          </div>
          <footer>
            <span :class="{ 'is-muted': !row.adminReply }">
              {{ row.adminReply || "尚未回复" }}
            </span>
            <el-button @click="openReview(row)">
              {{ row.status === "open" ? "处理" : "查看" }}
            </el-button>
          </footer>
        </article>
      </div>
    </div>

    <footer v-if="items.length" class="feedback-footer">
      <CursorPager
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        @prev="prev"
        @next="next"
      />
    </footer>

    <AdminDialog
      v-model="reviewOpen"
      panel-class="feedback-review-dialog"
      title="处理反馈"
      :icon="ChatDotRound"
      width="560px"
      confirm-text="保存"
      :confirm-disabled="reviewConfirmDisabled"
      :confirm-loading="reviewing"
      @confirm="submitReview"
    >
      <div v-if="selected" class="feedback-review">
        <div class="feedback-review__summary">
          <div class="feedback-review__meta">
            <span class="feedback-chip">{{
              categoryLabels[selected.category] || selected.category
            }}</span>
            <span>{{ selected.username || "未命名用户" }} · {{ selected.userEmail }}</span>
            <span class="tnum">{{ formatTime(selected.createdAt) }}</span>
          </div>
          <strong>{{ selected.title }}</strong>
          <p>{{ selected.content }}</p>
          <a
            v-if="selected.pageUrl && isExternalPage(selected.pageUrl)"
            :href="selected.pageUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <el-icon><Link /></el-icon>{{ pageLabel(selected.pageUrl) }}
          </a>
          <span v-else-if="selected.pageUrl" class="feedback-review__page">{{
            pageLabel(selected.pageUrl)
          }}</span>
        </div>

        <div class="feedback-review__statuses" role="group" aria-label="处理状态">
          <button
            v-for="option in REVIEW_STATUSES"
            :key="option.value"
            type="button"
            class="feedback-review__chip"
            :class="{ 'is-active': reviewForm.status === option.value }"
            @click="reviewForm.status = option.value"
          >
            {{ option.label }}
          </button>
        </div>

        <el-input
          v-model="reviewForm.adminReply"
          type="textarea"
          :rows="5"
          maxlength="2000"
          show-word-limit
          resize="none"
          :placeholder="reviewNeedsReply ? '回复会通知用户，解决或关闭时必填' : '回复会通知用户'"
        />

        <div v-if="selected.category === 'suggestion'" class="feedback-review__adopt">
          <label
            class="feedback-review__option"
            :class="{ 'is-on': reviewForm.adopted }"
          >
            <span>{{ selected.adopted ? "已采纳" : "采纳并奖励" }}</span>
            <el-switch
              v-model="reviewForm.adopted"
              :disabled="selected.adopted || suggestionRewardMax <= 0"
              size="small"
            />
          </label>
          <label v-if="reviewForm.adopted" class="feedback-review__points">
            <el-input-number
              v-model="reviewForm.rewardPoints"
              :min="1"
              :max="Math.max(1, suggestionRewardMax)"
              :step="10"
              :precision="0"
              :controls="false"
              :disabled="selected.adopted"
            />
            <span>积分</span>
          </label>
          <small v-if="selected.adopted">
            {{ formatTime(selected.rewardedAt) }} 已发放
          </small>
          <small v-else-if="suggestionRewardMax <= 0">当前未开放建议奖励</small>
        </div>

        <details v-if="selected.userAgent" class="feedback-review__diag">
          <summary>浏览器信息</summary>
          <code>{{ selected.userAgent }}</code>
        </details>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
.feedback-page {
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

.feedback-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.feedback-tabs {
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

.feedback-tab {
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

.feedback-toolbar__right {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.feedback-category {
  width: 128px;
}

.feedback-search {
  width: 220px;
}

.feedback-setting-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 8px 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;

  &.is-dirty {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  :deep(.el-input-number) {
    width: 72px;
  }

  :deep(.el-input__wrapper) {
    padding: 0 4px;
    box-shadow: none;
    background: transparent;
  }

  :deep(.el-input__inner) {
    height: 28px;
    text-align: center;
  }
}

.feedback-setting-pill__save {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-on);
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.feedback-board {
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

.feedback-list {
  display: grid;
  flex: 1 1 auto;
  gap: 10px;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.feedback-empty {
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

.feedback-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);
  cursor: pointer;

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

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;

    span {
      min-width: 0;
      overflow: hidden;
      color: var(--ink-2);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .is-muted {
      color: var(--ink-3);
    }
  }
}

.feedback-status {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;

  &.is-open {
    background: var(--warning-soft);
    color: var(--warning);
  }

  &.is-in_progress {
    background: var(--info-soft);
    color: var(--info);
  }

  &.is-resolved {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-closed {
    background: var(--surface);
    color: var(--ink-3);
  }
}

.feedback-card__meta {
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

.feedback-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 40px;
}
</style>

<style lang="scss">
.feedback-review {
  display: grid;
  gap: 14px;
}

.feedback-review__summary {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);

  strong {
    color: var(--ink);
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
  }

  p {
    margin: 0;
    white-space: pre-wrap;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 1.55;
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent-ink);
    font-size: 12px;
    text-decoration: none;
  }
}

.feedback-review__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  color: var(--ink-3);
  font-size: 12px;
}

.feedback-chip {
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--violet-soft);
  color: var(--violet);
  font-size: 11px;
  font-weight: 700;
}

.feedback-review__page {
  color: var(--ink-3);
  font-size: 12px;
}

.feedback-review__statuses {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.feedback-review__chip {
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
    background: var(--accent);
    color: var(--accent-on);
  }
}

.feedback-review__adopt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  small {
    width: 100%;
    color: var(--ink-3);
    font-size: 12px;
  }
}

.feedback-review__option {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 40px;
  padding: 0 14px 0 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &.is-on {
    border-color: color-mix(in srgb, var(--success) 28%, var(--border));
    background: var(--success-soft);
    color: var(--success);
  }
}

.feedback-review__points {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--ink-3);
  font-size: 12px;

  .el-input-number {
    width: 72px;
  }

  .el-input-number .el-input__wrapper {
    padding: 0;
    box-shadow: none;
    background: transparent;
  }
}

.feedback-review__diag {
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;

  summary {
    cursor: pointer;
  }

  code {
    display: block;
    margin-top: 8px;
    overflow-wrap: anywhere;
    white-space: normal;
    line-height: 1.5;
  }
}
</style>
