<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Refresh, Select } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { request } from "@/request";

type PageStatus = "normal" | "maintenance" | "developing" | "removed";

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
  type: "success" | "warning" | "primary" | "info";
}> = [
  { value: "normal", label: "正常开放", type: "success" },
  { value: "maintenance", label: "维护中", type: "warning" },
  { value: "developing", label: "正在开发", type: "primary" },
  { value: "removed", label: "页面移除", type: "info" },
];

const PAGE_GROUPS: PageGroup[] = [
  {
    title: "核心创作",
    description: "控制主创作入口与独立工作台。",
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
    description: "各子模块可以独立维护或下架。",
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
    description: "页面移除后用户端不再展示入口，历史链接会显示下架原因。",
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

const loading = ref(false);
const saving = ref(false);
const controls = ref<Record<string, PageControl>>(
  Object.fromEntries(
    PAGE_GROUPS.flatMap((group) => group.pages).map((page) => [
      page.key,
      { status: "normal", reason: "" } satisfies PageControl,
    ]),
  ),
);
const savedSignature = ref("");

const statusMeta = (status?: PageStatus) =>
  STATUS_OPTIONS.find((option) => option.value === status) || STATUS_OPTIONS[0];

function normalizeControl(value?: Partial<PageControl>): PageControl {
  const status = STATUS_OPTIONS.some((option) => option.value === value?.status)
    ? (value?.status as PageStatus)
    : "normal";
  return { status, reason: String(value?.reason || "").trim() };
}

function signature() {
  return JSON.stringify(controls.value);
}

const isDirty = computed(
  () => savedSignature.value !== "" && signature() !== savedSignature.value,
);

function hydrate(values: Record<string, PageControl> = {}) {
  controls.value = Object.fromEntries(
    PAGE_GROUPS.flatMap((group) => group.pages).map((page) => [
      page.key,
      normalizeControl(values[page.key]),
    ]),
  );
  savedSignature.value = signature();
}

function onStatusChange(key: string) {
  const control = controls.value[key];
  if (control.status === "normal") control.reason = "";
}

async function load() {
  loading.value = true;
  try {
    const settings = await request<{ pageControls?: Record<string, PageControl> }>(
      "/api/v1/admin/settings",
      { silent: true },
    );
    hydrate(settings.pageControls || {});
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "页面配置读取失败");
  } finally {
    loading.value = false;
  }
}

async function save() {
  for (const group of PAGE_GROUPS) {
    for (const page of group.pages) {
      const control = controls.value[page.key];
      control.reason = control.reason.trim();
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
  <div class="page-controls" v-loading="loading">
    <header class="page-controls__head">
      <div>
        <h2>用户端页面控制</h2>
        <p>维护中和正在开发仍保留入口；页面移除会隐藏入口并拦截历史链接。</p>
      </div>
      <div class="page-controls__actions">
        <el-button :icon="Refresh" :disabled="saving" @click="load">刷新</el-button>
        <el-button
          type="primary"
          :icon="Select"
          :loading="saving"
          :disabled="!isDirty"
          @click="save"
        >
          保存更改
        </el-button>
      </div>
    </header>

    <section v-for="group in PAGE_GROUPS" :key="group.title" class="control-group">
      <header class="control-group__head">
        <div>
          <h3>{{ group.title }}</h3>
          <p>{{ group.description }}</p>
        </div>
        <span>{{ group.pages.length }} 个页面</span>
      </header>
      <el-table :data="group.pages" row-key="key" class="control-table">
        <el-table-column label="页面" min-width="190">
          <template #default="{ row }">
            <div class="page-name">
              <strong>{{ row.label }}</strong>
              <small>{{ row.path }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="150">
          <template #default="{ row }">
            <el-tag :type="statusMeta(controls[row.key]?.status).type" effect="light">
              {{ statusMeta(controls[row.key]?.status).label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="控制" width="180">
          <template #default="{ row }">
            <el-select
              v-model="controls[row.key].status"
              aria-label="页面状态"
              @change="onStatusChange(row.key)"
            >
              <el-option
                v-for="option in STATUS_OPTIONS"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="展示给用户的原因" min-width="320">
          <template #default="{ row }">
            <el-input
              v-model="controls[row.key].reason"
              :disabled="controls[row.key].status === 'normal'"
              :placeholder="
                controls[row.key].status === 'normal'
                  ? '正常开放无需说明'
                  : '请输入维护、开发或下架原因'
              "
              maxlength="200"
              show-word-limit
            />
          </template>
        </el-table-column>
      </el-table>
      <div class="mobile-control-list">
        <div v-for="page in group.pages" :key="page.key" class="mobile-control-row">
          <header>
            <div class="page-name">
              <strong>{{ page.label }}</strong>
              <small>{{ page.path }}</small>
            </div>
            <el-tag :type="statusMeta(controls[page.key].status).type" effect="light">
              {{ statusMeta(controls[page.key].status).label }}
            </el-tag>
          </header>
          <el-select
            v-model="controls[page.key].status"
            aria-label="页面状态"
            @change="onStatusChange(page.key)"
          >
            <el-option
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-input
            v-model="controls[page.key].reason"
            :disabled="controls[page.key].status === 'normal'"
            :placeholder="
              controls[page.key].status === 'normal'
                ? '正常开放无需说明'
                : '请输入展示给用户的原因'
            "
            maxlength="200"
            show-word-limit
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-controls {
  display: grid;
  gap: 24px;
  min-height: 360px;
}

.page-controls__head,
.control-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.page-controls__head h2,
.control-group__head h3 {
  margin: 0;
  color: var(--text);
  letter-spacing: 0;
}

.page-controls__head h2 { font-size: 20px; }
.control-group__head h3 { font-size: 16px; }

.page-controls__head p,
.control-group__head p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.page-controls__actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.control-group {
  display: grid;
  gap: 12px;
}

.control-group__head {
  padding: 0 4px;
}

.control-group__head > span {
  color: var(--text-muted);
  font-size: 12px;
}

.control-table {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.page-name {
  display: grid;
  gap: 4px;
}

.page-name strong { color: var(--text); font-size: 14px; }
.page-name small { color: var(--text-muted); font-family: ui-monospace, monospace; }

.mobile-control-list { display: none; }

@media (max-width: 860px) {
  .page-controls__head { align-items: flex-start; flex-direction: column; }
  .page-controls__actions { width: 100%; }
  .page-controls__actions :deep(.el-button) { flex: 1; }
  .control-table { display: none; }
  .mobile-control-list { display: grid; gap: 10px; }
  .mobile-control-row {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .mobile-control-row > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
}
</style>
