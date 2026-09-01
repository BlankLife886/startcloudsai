<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Check, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { request } from "@/request";

type PageStatus = "normal" | "maintenance" | "developing" | "removed";
type StatusFilter = "all" | PageStatus;

interface PageControl {
  status: PageStatus;
  reason: string;
}

interface PageDefinition {
  key: string;
  label: string;
  path: string;
}

interface PageGroup {
  title: string;
  description: string;
  pages: PageDefinition[];
}

const STATUS_OPTIONS: Array<{
  value: PageStatus;
  label: string;
  fullLabel: string;
  tone: "success" | "warning" | "violet" | "info";
  hint: string;
  defaultReason: string;
}> = [
  {
    value: "normal",
    label: "开放",
    fullLabel: "正常开放",
    tone: "success",
    hint: "用户可正常访问",
    defaultReason: "",
  },
  {
    value: "maintenance",
    label: "维护",
    fullLabel: "维护中",
    tone: "warning",
    hint: "保留入口，拦截访问",
    defaultReason: "页面维护中，请稍后再试。",
  },
  {
    value: "developing",
    label: "开发",
    fullLabel: "正在开发",
    tone: "violet",
    hint: "保留入口，拦截访问",
    defaultReason: "功能正在开发中，敬请期待。",
  },
  {
    value: "removed",
    label: "下架",
    fullLabel: "页面移除",
    tone: "info",
    hint: "隐藏入口，拦截历史链接",
    defaultReason: "该页面已下架。",
  },
];

const PAGE_GROUPS: PageGroup[] = [
  {
    title: "开放能力",
    description: "仍在测试的能力可先下架，避免用户提前使用。",
    pages: [
      { key: "developer_api", label: "开发者 API", path: "/developer-api" },
    ],
  },
  {
    title: "核心创作",
    description: "主创作入口与独立工作台。",
    pages: [
      { key: "studio", label: "创作台", path: "/studio" },
      { key: "canvas", label: "无限画布", path: "/canvas" },
      { key: "assistant", label: "AI 助手", path: "/assistant" },
      { key: "text_to_image", label: "文生图", path: "/text-to-image" },
      { key: "model_sheet", label: "模型设计", path: "/model-sheet" },
      {
        key: "illustration_coloring",
        label: "插画染色",
        path: "/ai-illustration-coloring",
      },
      { key: "ui_design", label: "UI 设计稿", path: "/design-workshop" },
      { key: "game_art", label: "游戏设计", path: "/game-art" },
      { key: "pricing", label: "创作价格", path: "/pricing" },
    ],
  },
  {
    title: "AI 电商",
    description: "各子模块可独立维护或下架。",
    pages: [
      { key: "ecommerce.tryon", label: "虚拟试衣", path: "tool=tryon" },
      { key: "ecommerce.handheld", label: "手持商品", path: "tool=handheld" },
      { key: "ecommerce.accessory", label: "饰品穿戴", path: "tool=accessory" },
      { key: "ecommerce.shoot", label: "AI 商拍", path: "tool=shoot" },
      { key: "ecommerce.listing", label: "商品套图", path: "tool=listing" },
      { key: "ecommerce.detail", label: "A+ 详情", path: "tool=detail" },
      { key: "ecommerce.campaign", label: "营销图", path: "tool=campaign" },
      { key: "ecommerce.background", label: "背景生成", path: "tool=background" },
      { key: "ecommerce.backdrop", label: "背景复刻", path: "tool=backdrop" },
      { key: "ecommerce.shadow", label: "商品阴影", path: "tool=shadow" },
      { key: "ecommerce.outpaint", label: "智能扩图", path: "tool=outpaint" },
      { key: "ecommerce.enhance", label: "清晰增强", path: "tool=enhance" },
    ],
  },
  {
    title: "活动入口",
    description: "下架后用户端不再展示入口。",
    pages: [
      { key: "activity.checkin", label: "签到活动", path: "/check-in" },
      { key: "activity.trial", label: "申请体验", path: "申请弹窗" },
      { key: "activity.usage", label: "用量激励", path: "/incentive-plans/usage" },
      { key: "activity.group", label: "好友拼团", path: "/incentive-plans/group" },
      {
        key: "activity.suggestion",
        label: "建议采纳",
        path: "/incentive-plans/suggestion",
      },
      {
        key: "activity.failure",
        label: "失败补偿",
        path: "/incentive-plans/failure",
      },
    ],
  },
];

const ALL_PAGES = PAGE_GROUPS.flatMap((group) => group.pages);
const DEFAULT_REASONS = new Set(
  STATUS_OPTIONS.map((option) => option.defaultReason).filter(Boolean),
);

function emptyControls(): Record<string, PageControl> {
  return Object.fromEntries(
    ALL_PAGES.map((page) => [
      page.key,
      defaultControl(page.key),
    ]),
  );
}

function defaultControl(key: string): PageControl {
  if (key === "developer_api") {
    return { status: "removed", reason: "开放 API 正在内部测试。" };
  }
  return { status: "normal", reason: "" };
}

const loading = ref(false);
const saving = ref(false);
const loadError = ref("");
const query = ref("");
const statusFilter = ref<StatusFilter>("all");
const controls = ref<Record<string, PageControl>>(emptyControls());
const savedControls = ref<Record<string, PageControl>>(emptyControls());

const statusMeta = (status?: PageStatus) =>
  STATUS_OPTIONS.find((option) => option.value === status) || STATUS_OPTIONS[0];

function normalizeControl(value?: Partial<PageControl>): PageControl {
  const status = STATUS_OPTIONS.some((option) => option.value === value?.status)
    ? (value?.status as PageStatus)
    : "normal";
  return { status, reason: String(value?.reason || "").trim() };
}

function cloneControls(values: Record<string, PageControl>) {
  return Object.fromEntries(
    ALL_PAGES.map((page) => [
      page.key,
      values[page.key]
        ? { ...normalizeControl(values[page.key]) }
        : defaultControl(page.key),
    ]),
  );
}

function signatureOf(values: Record<string, PageControl>) {
  return JSON.stringify(
    Object.fromEntries(
      ALL_PAGES.map((page) => [page.key, normalizeControl(values[page.key])]),
    ),
  );
}

const isDirty = computed(
  () =>
    !loading.value &&
    signatureOf(controls.value) !== signatureOf(savedControls.value),
);

const dirtyCount = computed(
  () =>
    ALL_PAGES.filter((page) => isRowDirty(page.key)).length,
);

const statusCounts = computed(() => {
  const counts: Record<PageStatus, number> = {
    normal: 0,
    maintenance: 0,
    developing: 0,
    removed: 0,
  };
  for (const page of ALL_PAGES) {
    counts[controls.value[page.key]?.status || "normal"] += 1;
  }
  return counts;
});

const restrictedCount = computed(
  () => ALL_PAGES.length - statusCounts.value.normal,
);

const matchesQuery = (page: PageDefinition) => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return true;
  return (
    page.label.toLowerCase().includes(needle) ||
    page.path.toLowerCase().includes(needle) ||
    page.key.toLowerCase().includes(needle)
  );
};

const matchesFilter = (page: PageDefinition) => {
  if (statusFilter.value === "all") return true;
  return controls.value[page.key]?.status === statusFilter.value;
};

const visibleGroups = computed(() =>
  PAGE_GROUPS.map((group) => ({
    ...group,
    pages: group.pages.filter(
      (page) => matchesQuery(page) && matchesFilter(page),
    ),
    restricted: group.pages.filter(
      (page) => controls.value[page.key]?.status !== "normal",
    ).length,
  })).filter((group) => group.pages.length > 0),
);

function isRowDirty(key: string) {
  const current = normalizeControl(controls.value[key]);
  const saved = normalizeControl(savedControls.value[key]);
  return current.status !== saved.status || current.reason !== saved.reason;
}

function hydrate(values: Record<string, PageControl> = {}) {
  controls.value = cloneControls(values);
  savedControls.value = cloneControls(values);
}

function setStatus(key: string, status: PageStatus) {
  const control = controls.value[key];
  if (!control || control.status === status) return;
  const previous = control.status;
  control.status = status;
  if (status === "normal") {
    control.reason = "";
    return;
  }
  const reason = control.reason.trim();
  if (!reason || DEFAULT_REASONS.has(reason) || previous === "normal") {
    control.reason = statusMeta(status).defaultReason;
  }
}

function applyGroupStatus(title: string, status: PageStatus) {
  const group = PAGE_GROUPS.find((item) => item.title === title);
  if (!group) return;
  for (const page of group.pages) setStatus(page.key, status);
}

function onGroupCommand(title: string, status: string | number | object) {
  if (
    status === "normal" ||
    status === "maintenance" ||
    status === "developing" ||
    status === "removed"
  ) {
    applyGroupStatus(title, status);
  }
}

function reasonPlaceholder(status: PageStatus) {
  if (status === "normal") return "正常开放无需说明";
  if (status === "maintenance") return "例如：系统升级，预计今晚恢复";
  if (status === "developing") return "例如：功能开发中，敬请期待";
  return "例如：活动已结束";
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const settings = await request<{ pageControls?: Record<string, PageControl> }>(
      "/api/v1/admin/settings",
      { silent: true },
    );
    hydrate(settings.pageControls || {});
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "页面配置读取失败";
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (loading.value || saving.value || !isDirty.value) return;

  for (const page of ALL_PAGES) {
    const control = controls.value[page.key];
    control.reason = control.reason.trim();
    if (control.status !== "normal" && !control.reason) {
      ElMessage.warning(`「${page.label}」需要填写展示给用户的原因`);
      return;
    }
  }

  const newlyRemoved = ALL_PAGES.filter(
    (page) =>
      controls.value[page.key].status === "removed" &&
      savedControls.value[page.key]?.status !== "removed",
  );
  if (newlyRemoved.length) {
    try {
      await ElMessageBox.confirm(
        `将下架 ${newlyRemoved.map((page) => page.label).join("、")}。用户端会隐藏入口，并拦截历史链接。`,
        "确认下架页面",
        { type: "warning", confirmButtonText: "确认下架", cancelButtonText: "取消" },
      );
    } catch {
      return;
    }
  }

  saving.value = true;
  try {
    const settings = await request<{ pageControls: Record<string, PageControl> }>(
      "/api/v1/admin/settings",
      { method: "PUT", body: { pageControls: controls.value } },
    );
    hydrate(settings.pageControls);
    ElMessage.success("页面状态已更新");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="page page-controls-page">
    <PageCard>
      <div class="controls-toolbar">
        <div class="sync-state" :class="{ 'is-dirty': isDirty }">
          <i />
          {{
            isDirty
              ? `有 ${dirtyCount} 处未保存变更`
              : "配置已同步"
          }}
        </div>
        <el-input
          v-model="query"
          class="controls-search"
          clearable
          :prefix-icon="Search"
          placeholder="搜索页面或路径"
        />
        <div class="controls-toolbar__actions">
          <el-button :icon="Refresh" :disabled="saving" @click="load">
            刷新
          </el-button>
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

      <div class="status-summary" role="tablist" aria-label="按状态筛选">
        <button
          type="button"
          class="status-summary__item"
          :class="{ 'is-active': statusFilter === 'all' }"
          @click="statusFilter = 'all'"
        >
          <span>全部</span>
          <b class="tnum">{{ ALL_PAGES.length }}</b>
        </button>
        <button
          v-for="option in STATUS_OPTIONS"
          :key="option.value"
          type="button"
          class="status-summary__item"
          :class="[`is-${option.tone}`, { 'is-active': statusFilter === option.value }]"
          :title="option.hint"
          @click="statusFilter = option.value"
        >
          <span>{{ option.fullLabel }}</span>
          <b class="tnum">{{ statusCounts[option.value] }}</b>
        </button>
      </div>

      <p class="status-legend">
        维护和开发仍保留入口；下架会隐藏入口并拦截历史链接。当前
        <em class="tnum">{{ restrictedCount }}</em>
        个页面处于受限状态。
      </p>

      <ListError :error="loadError" :loading="loading" @retry="load" />

      <div class="controls-body">
        <el-empty
          v-if="!visibleGroups.length"
          description="没有匹配的页面"
        />
        <section
          v-for="group in visibleGroups"
          :key="group.title"
          class="control-group"
        >
          <header class="control-group__head">
            <div>
              <h3>{{ group.title }}</h3>
              <p>
                {{ group.description }}
                <span class="tnum">{{ group.pages.length }}</span>
                个页面
                <template v-if="group.restricted">
                  ·
                  <span class="tnum">{{ group.restricted }}</span>
                  个受限
                </template>
              </p>
            </div>
            <el-dropdown
              trigger="click"
              @command="(status) => onGroupCommand(group.title, status)"
            >
              <el-button text>
                整组设为
                <span class="control-group__caret">▾</span>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="option in STATUS_OPTIONS"
                    :key="option.value"
                    :command="option.value"
                  >
                    {{ option.fullLabel }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </header>

          <div class="control-list">
            <article
              v-for="page in group.pages"
              :key="page.key"
              class="control-row"
              :class="{
                'is-dirty': isRowDirty(page.key),
                [`is-${controls[page.key].status}`]: true,
              }"
            >
              <div class="page-name">
                <strong>{{ page.label }}</strong>
                <small class="mono">{{ page.path }}</small>
              </div>
              <div
                class="status-switch"
                role="radiogroup"
                :aria-label="`${page.label} 页面状态`"
              >
                <button
                  v-for="option in STATUS_OPTIONS"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="controls[page.key].status === option.value"
                  class="status-switch__btn"
                  :class="[
                    `is-${option.tone}`,
                    { 'is-active': controls[page.key].status === option.value },
                  ]"
                  :title="`${option.fullLabel} · ${option.hint}`"
                  @click="setStatus(page.key, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
              <el-input
                v-model="controls[page.key].reason"
                class="reason-input"
                :disabled="controls[page.key].status === 'normal'"
                :placeholder="reasonPlaceholder(controls[page.key].status)"
                maxlength="200"
                show-word-limit
              />
            </article>
          </div>
        </section>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.page-controls-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.page-controls-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.page-controls-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.controls-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
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
  white-space: nowrap;
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

.controls-search {
  width: 240px;
  margin-left: auto;
}

.controls-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.controls-toolbar__actions :deep(.el-button) {
  margin: 0;
  height: 32px;
}

.status-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  flex: 0 0 auto;
}

.status-summary__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.status-summary__item:hover {
  border-color: var(--border-strong);
}

.status-summary__item:focus-visible,
.status-switch__btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.status-summary__item span {
  font-size: 12px;
  font-weight: 650;
}

.status-summary__item b {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--ink);
}

.status-summary__item.is-active {
  border-color: var(--border-strong);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--ink);
}

.status-summary__item.is-success.is-active {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 28%, var(--border));
  color: var(--success);
}

.status-summary__item.is-warning.is-active {
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
  color: var(--warning);
}

.status-summary__item.is-violet.is-active {
  background: var(--violet-soft);
  border-color: color-mix(in srgb, var(--violet) 28%, var(--border));
  color: var(--violet);
}

.status-summary__item.is-info.is-active {
  background: var(--info-soft);
  border-color: color-mix(in srgb, var(--info) 28%, var(--border));
  color: var(--info);
}

.status-summary__item.is-success.is-active b,
.status-summary__item.is-warning.is-active b,
.status-summary__item.is-violet.is-active b,
.status-summary__item.is-info.is-active b {
  color: inherit;
}

.status-legend {
  margin: 10px 0 14px;
  color: var(--ink-3);
  font-size: 12px;
}

.status-legend em {
  color: var(--ink);
  font-style: normal;
  font-weight: 700;
}

.controls-body {
  display: grid;
  gap: 18px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.control-group {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.control-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
}

.control-group__head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.control-group__head p {
  margin: 2px 0 0;
  color: var(--ink-3);
  font-size: 12px;
}

.control-group__caret {
  margin-left: 4px;
  color: var(--ink-3);
}

.control-list {
  display: grid;
  gap: 6px;
}

.control-row {
  display: grid;
  grid-template-columns: minmax(132px, 168px) 248px minmax(220px, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 transparent;
}

.control-row.is-dirty {
  box-shadow: inset 3px 0 0 var(--warning);
}

.control-row.is-maintenance {
  background: color-mix(in srgb, var(--warning-soft) 55%, var(--surface-2));
}

.control-row.is-developing {
  background: color-mix(in srgb, var(--violet-soft) 55%, var(--surface-2));
}

.control-row.is-removed {
  background: color-mix(in srgb, var(--info-soft) 55%, var(--surface-2));
}

.page-name {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.page-name strong {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.3;
}

.page-name small {
  color: var(--ink-3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-switch {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.status-switch__btn {
  height: 28px;
  padding: 0 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.status-switch__btn:hover:not(.is-active) {
  color: var(--ink);
  background: var(--surface-2);
}

.status-switch__btn.is-active.is-success {
  background: var(--success-soft);
  color: var(--success);
}

.status-switch__btn.is-active.is-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.status-switch__btn.is-active.is-violet {
  background: var(--violet-soft);
  color: var(--violet);
}

.status-switch__btn.is-active.is-info {
  background: var(--info-soft);
  color: var(--info);
}

.reason-input :deep(.el-input__wrapper) {
  background: var(--surface);
}

.reason-input :deep(.el-input__count) {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1320px) {
  .control-row {
    grid-template-columns: minmax(120px, 150px) 228px minmax(180px, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .control-row,
  .status-summary__item,
  .status-switch__btn {
    transition: none;
  }
}
</style>
