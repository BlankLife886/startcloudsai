<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CopyDocument, Refresh, Search } from "@element-plus/icons-vue";
import { request, type Page } from "@/request";
import { usePagedList } from "@/usePagedList";
import {
  formatPoints,
  formatTime,
  shortId,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  taskTypeLabel,
} from "@/utils";

interface AdminTask {
  id: string;
  type: string;
  status: string;
  prompt: string;
  params: Record<string, unknown> | null;
  count: number;
  inputKeys?: string[];
  outputKeys?: string[];
  outputUrls?: string[];
  costCents: number;
  errorCode: string | null;
  errorMessage: string | null;
  userId?: string;
  userEmail?: string;
  user?: { id: string; email: string };
  source?: "task" | "assistant";
  serviceProvider?: "c2a" | "sub2api" | "crun" | "local";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TaskSummary {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
  today: number;
}

interface TaskPage extends Page<AdminTask> {
  summary?: TaskSummary;
}

const filters = reactive({ type: "", status: "", user: "", errorCode: "" });
const summary = ref<TaskSummary>({
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  today: 0,
});
const lastUpdatedAt = ref<Date | null>(null);
const autoRefresh = ref(true);

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
} = usePagedList<AdminTask>(
  async (cursor) => {
    const page = await request<TaskPage>("/api/v1/admin/tasks", {
      query: {
        type: filters.type,
        status: filters.status,
        user: filters.user,
        errorCode: filters.errorCode,
        limit: 20,
        cursor,
      },
    });
    if (page.summary) summary.value = page.summary;
    lastUpdatedAt.value = new Date();
    return page;
  },
  () => ({
    type: filters.type,
    status: filters.status,
    user: filters.user,
    errorCode: filters.errorCode,
  }),
);

const statusCards = computed(() => [
  {
    value: "",
    label: "全部任务",
    count: summary.value.total,
    tone: "all",
    hint: `今日新增 ${summary.value.today}`,
  },
  {
    value: "queued",
    label: "等待中",
    count: summary.value.queued,
    tone: "queued",
    hint: "尚未开始执行",
  },
  {
    value: "running",
    label: "运行中",
    count: summary.value.running,
    tone: "running",
    hint: "正在占用执行槽位",
  },
  {
    value: "failed",
    label: "需要处理",
    count: summary.value.failed,
    tone: "failed",
    hint: "可查看错误并重试",
  },
  {
    value: "succeeded",
    label: "已成功",
    count: summary.value.succeeded,
    tone: "succeeded",
    hint: "已完成交付",
  },
  {
    value: "canceled",
    label: "已取消",
    count: summary.value.canceled,
    tone: "canceled",
    hint: "主动取消或终止",
  },
]);

const activeFilterCount = computed(
  () =>
    [
      filters.type,
      filters.status,
      filters.user.trim(),
      filters.errorCode.trim(),
    ].filter(Boolean).length,
);
const lastUpdatedLabel = computed(() =>
  lastUpdatedAt.value
    ? lastUpdatedAt.value.toLocaleTimeString("zh-CN", { hour12: false })
    : "尚未刷新",
);

let refreshTimer: number | null = null;

function stopAutoRefresh() {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (!autoRefresh.value) return;
  refreshTimer = window.setInterval(() => {
    if (!loading.value && document.visibilityState === "visible")
      void refresh();
  }, 15_000);
}

watch(autoRefresh, startAutoRefresh);

onMounted(() => {
  void reset();
  startAutoRefresh();
});

onBeforeUnmount(stopAutoRefresh);

function applyStatus(status: string) {
  if (filters.status === status) return;
  filters.status = status;
  void reset();
}

function clearFilters() {
  filters.type = "";
  filters.status = "";
  filters.user = "";
  filters.errorCode = "";
  void reset();
}

function refreshNow() {
  if (!loading.value) void refresh();
}

function taskPrompt(task: AdminTask) {
  return (
    task.prompt?.trim() ||
    (task.source === "assistant" ? "AI 助手任务" : "未填写提示词")
  );
}

function compactTaskId(id: string) {
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

function taskMediaUrls(task: AdminTask) {
  const outputs = (task.outputUrls ?? []).filter(Boolean);
  if (outputs.length) return outputs;
  return (task.inputKeys ?? []).filter(Boolean).map(fileUrl);
}

function taskOutputCount(task: AdminTask) {
  return task.outputUrls?.length || task.outputKeys?.length || 0;
}

function taskDuration(task: AdminTask) {
  if (!task.startedAt) return "未开始";
  const start = new Date(task.startedAt).getTime();
  const end = task.finishedAt
    ? new Date(task.finishedAt).getTime()
    : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return "-";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function taskRowClass({ row }: { row: AdminTask }) {
  return `task-row is-${row.status}`;
}

async function copyTaskId(id: string) {
  await navigator.clipboard.writeText(id);
  ElMessage.success("任务 ID 已复制");
}

async function copyTaskPrompt(task: AdminTask) {
  await navigator.clipboard.writeText(taskPrompt(task));
  ElMessage.success("任务内容已复制");
}

function taskUser(task: AdminTask): string {
  return task.userEmail ?? task.user?.email ?? task.userId ?? "-";
}

function taskSourceLabel(task: AdminTask) {
  return task.source === "assistant" ? "AI 助手" : "图片任务";
}

const serviceProviderMeta = {
  c2a: { name: "C2A", detail: "gpt.xkyh.cc.cd/v1" },
  sub2api: { name: "Sub2API", detail: "OpenAI 兼容服务" },
  crun: { name: "CRUN", detail: "api.crun.ai" },
  local: { name: "本地处理", detail: "浏览器 Canvas" },
} as const;

function taskServiceProvider(
  task: AdminTask,
): keyof typeof serviceProviderMeta {
  if (task.serviceProvider && task.serviceProvider in serviceProviderMeta) {
    return task.serviceProvider;
  }
  if (task.type === "puzzle") return "local";
  if (task.source === "assistant") return "sub2api";
  const provider = String(task.params?._serviceProvider || "");
  return provider === "sub2api" || provider === "crun" ? provider : "c2a";
}

function taskServiceProviderMeta(task: AdminTask) {
  const params = task.params || {};
  const providerNames = [
    params._providerDisplayName,
    params._chatProviderDisplayName,
    params._imageProviderDisplayName,
  ]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const modelNames = [
    params._modelDisplayName,
    params._chatModelDisplayName,
    params._imageModelDisplayName,
  ]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  if (providerNames.length) {
    return {
      name: providerNames.join(" / "),
      detail:
        modelNames.join(" / ") ||
        serviceProviderMeta[taskServiceProvider(task)].detail,
    };
  }
  return serviceProviderMeta[taskServiceProvider(task)];
}

function taskCount(task: AdminTask): number | string {
  if (task.source !== "assistant") return task.count;
  const resolvedMode = String(
    task.params?.resolvedMode || task.params?.mode || "",
  );
  return resolvedMode === "image" ? task.count : "-";
}

/** 输入图直接走文件网关（302 到 R2 presigned URL） */
function fileUrl(key: string): string {
  return `/api/v1/files/${key}`;
}

// 详情抽屉
const detailVisible = ref(false);
const detail = ref<AdminTask | null>(null);

const detailParams = computed(() => {
  const params = detail.value?.params;
  return params && Object.keys(params).length > 0
    ? JSON.stringify(params, null, 2)
    : "";
});

const detailInputUrls = computed(() =>
  (detail.value?.inputKeys ?? []).map(fileUrl),
);
const detailOutputUrls = computed(() => detail.value?.outputUrls ?? []);
const detailMediaMode = ref<"output" | "input">("output");
const detailMediaIndex = ref(0);
const detailMediaUrls = computed(() =>
  detailMediaMode.value === "output"
    ? detailOutputUrls.value
    : detailInputUrls.value,
);
const detailActiveMediaUrl = computed(
  () => detailMediaUrls.value[detailMediaIndex.value] ?? "",
);

function setDetailMediaMode(mode: "output" | "input") {
  detailMediaMode.value = mode;
  detailMediaIndex.value = 0;
}

function openDetail(task: AdminTask) {
  detail.value = task;
  detailMediaMode.value = task.outputUrls?.length ? "output" : "input";
  detailMediaIndex.value = 0;
  detailVisible.value = true;
}

const acting = ref(false);

async function requeue(task: AdminTask) {
  await ElMessageBox.confirm(
    `确认将失败任务 ${task.id} 重新入队？不会重复向用户扣费。`,
    "重新入队",
    {
      type: "warning",
      confirmButtonText: "重新入队",
      cancelButtonText: "取消",
    },
  );
  acting.value = true;
  try {
    await request(`/api/v1/admin/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "queued" },
    });
    ElMessage.success("已重新入队");
    detailVisible.value = false;
    refresh();
  } finally {
    acting.value = false;
  }
}

async function cancel(task: AdminTask) {
  await ElMessageBox.confirm(
    task.source === "assistant"
      ? `确认取消排队中的 AI 助手任务 ${task.id}？`
      : `确认取消排队中任务 ${task.id}？取消后将解冻退还该任务费用。`,
    "取消任务",
    {
      type: "warning",
      confirmButtonText: "取消任务",
      cancelButtonText: "返回",
    },
  );
  acting.value = true;
  try {
    await request(`/api/v1/admin/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "canceled" },
    });
    ElMessage.success(
      task.source === "assistant" ? "AI 助手任务已取消" : "已取消并解冻费用",
    );
    detailVisible.value = false;
    refresh();
  } finally {
    acting.value = false;
  }
}

async function forceFail(task: AdminTask) {
  await ElMessageBox.confirm(
    task.source === "assistant"
      ? `确认将运行中的 AI 助手任务 ${task.id} 强制置为失败？仅用于卡死任务。`
      : `确认将运行中任务 ${task.id} 强制置为失败？将解冻并退还该任务冻结的费用（errorCode=admin_force_failed）。仅用于卡死任务，若任务仍在正常执行请勿操作。`,
    "强制失败",
    {
      type: "error",
      confirmButtonText: "强制失败",
      confirmButtonClass: "el-button--danger",
      cancelButtonText: "取消",
    },
  );
  acting.value = true;
  try {
    await request(`/api/v1/admin/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "failed" },
    });
    ElMessage.success("已强制失败并解冻退款");
    detailVisible.value = false;
    refresh();
  } finally {
    acting.value = false;
  }
}
</script>

<template>
  <div class="task-monitor">
    <section class="task-filter-panel">
      <div class="task-filter-panel__refresh">
        <div class="refresh-state">
          <span :class="{ 'is-live': autoRefresh }" />
          <small>更新于 {{ lastUpdatedLabel }}</small>
        </div>
        <el-switch
          v-model="autoRefresh"
          inline-prompt
          active-text="开"
          inactive-text="关"
        />
        <el-button :icon="Refresh" :loading="loading" @click="refreshNow"
          >立即刷新</el-button
        >
      </div>
      <div class="task-filter-panel__lead">
        <el-input
          v-model="filters.user"
          :prefix-icon="Search"
          placeholder="搜索用户邮箱或用户 ID"
          clearable
          @keyup.enter="reset"
          @clear="reset"
        />
      </div>
      <el-select
        v-model="filters.type"
        placeholder="全部任务类型"
        clearable
        @change="reset"
      >
        <el-option
          v-for="(label, value) in TASK_TYPE_LABELS"
          :key="value"
          :label="label"
          :value="value"
        />
      </el-select>
      <el-input
        v-model="filters.errorCode"
        placeholder="搜索错误码"
        clearable
        @keyup.enter="reset"
        @clear="reset"
      />
      <el-button type="primary" @click="reset">应用筛选</el-button>
      <el-button :disabled="!activeFilterCount" @click="clearFilters"
        >清除条件</el-button
      >
    </section>

    <section class="status-overview" aria-label="任务状态汇总">
      <button
        v-for="card in statusCards"
        :key="card.value || 'all'"
        type="button"
        class="status-card"
        :class="[
          `is-${card.tone}`,
          { 'is-active': filters.status === card.value },
        ]"
        @click="applyStatus(card.value)"
      >
        <span class="status-card__dot" />
        <span class="status-card__copy"
          ><small>{{ card.label }}</small
          ><strong>{{ card.count }}</strong
          ><em>{{ card.hint }}</em></span
        >
      </button>
    </section>

    <section class="task-list-panel">
      <header class="task-list-panel__head">
        <div>
          <strong>{{
            filters.status ? TASK_STATUS_LABELS[filters.status] : "全部任务"
          }}</strong>
          <span
            >当前页 {{ items.length }} 条<span v-if="activeFilterCount">
              · {{ activeFilterCount }} 个筛选条件</span
            ></span
          >
        </div>
        <span class="today-badge">今日新增 {{ summary.today }}</span>
      </header>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <div class="task-table-shell">
        <el-table
          v-loading="loading"
          :data="items"
          height="100%"
          size="small"
          scrollbar-always-on
          :row-class-name="taskRowClass"
          @row-dblclick="openDetail"
        >
          <template #empty>
            <el-empty description="没有符合条件的任务" :image-size="64">
              <div class="empty-sub">清除部分筛选条件后再试</div>
            </el-empty>
          </template>
          <el-table-column label="图片" width="72" fixed="left" align="center">
            <template #default="{ row }">
              <el-image
                v-if="taskMediaUrls(row as AdminTask).length"
                :src="taskMediaUrls(row as AdminTask)[0]"
                :preview-src-list="taskMediaUrls(row as AdminTask)"
                fit="cover"
                class="task-table-image"
                preview-teleported
                hide-on-click-modal
                @dblclick.stop
              />
              <span v-else class="task-image-empty">—</span>
            </template>
          </el-table-column>
          <el-table-column label="任务 ID" width="142" fixed="left">
            <template #default="{ row }">
              <div class="task-primary" @click="openDetail(row as AdminTask)">
                <div class="task-primary__id">
                  <span class="mono" :title="row.id">{{
                    compactTaskId(row.id)
                  }}</span>
                  <button
                    type="button"
                    title="复制任务 ID"
                    @click.stop="copyTaskId(row.id)"
                  >
                    <el-icon><CopyDocument /></el-icon>
                  </button>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="任务内容" width="240">
            <template #default="{ row }">
              <div class="task-prompt-cell">
                <span :title="taskPrompt(row as AdminTask)">{{
                  taskPrompt(row as AdminTask)
                }}</span>
                <button
                  type="button"
                  title="复制任务内容"
                  @click.stop="copyTaskPrompt(row as AdminTask)"
                >
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="112">
            <template #default="{ row }">
              <span class="task-status" :class="`is-${row.status}`">
                <i />{{ TASK_STATUS_LABELS[row.status] ?? row.status }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="任务类型" width="118" align="center">
            <template #default="{ row }">
              <div class="task-type">
                <strong>{{ taskTypeLabel(row.type) }}</strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="任务来源" width="104" align="center">
            <template #default="{ row }">
              <span
                class="task-source"
                :class="{ 'is-assistant': row.source === 'assistant' }"
                >{{ taskSourceLabel(row as AdminTask) }}</span
              >
            </template>
          </el-table-column>
          <el-table-column label="服务商" width="142" align="center">
            <template #default="{ row }">
              <span
                class="task-provider"
                :class="`is-${taskServiceProvider(row as AdminTask)}`"
                :title="`${taskServiceProviderMeta(row as AdminTask).name} · ${taskServiceProviderMeta(row as AdminTask).detail}`"
              >
                <i />
                <span>
                  <strong>{{
                    taskServiceProviderMeta(row as AdminTask).name
                  }}</strong>
                  <small>{{
                    taskServiceProviderMeta(row as AdminTask).detail
                  }}</small>
                </span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="用户" min-width="175">
            <template #default="{ row }">
              <span class="task-user" :title="taskUser(row as AdminTask)">{{
                taskUser(row as AdminTask)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="82" align="center">
            <template #default="{ row }">
              <div class="task-numbers">
                <strong
                  >{{ taskOutputCount(row as AdminTask) }} /
                  {{ taskCount(row as AdminTask) }}</strong
                >
              </div>
            </template>
          </el-table-column>
          <el-table-column label="积分" width="100" align="center">
            <template #default="{ row }">
              <strong class="task-cost"
                >{{ formatPoints(row.costCents) }} 积分</strong
              >
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="110" align="center">
            <template #default="{ row }">
              <div class="task-time">
                <strong>{{ taskDuration(row as AdminTask) }}</strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="异常" min-width="180">
            <template #default="{ row }">
              <div
                v-if="row.errorCode"
                class="task-error"
                :title="row.errorMessage ?? ''"
              >
                <strong>{{ row.errorCode }}</strong
                ><small>{{ row.errorMessage || "点击详情查看错误信息" }}</small>
              </div>
              <span v-else class="task-error-empty">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <footer class="task-list-panel__footer">
        <span>双击任务行可快速打开详情</span>
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
    </section>

    <el-drawer
      v-model="detailVisible"
      :with-header="false"
      size="640px"
      class="task-detail-drawer"
    >
      <template v-if="detail">
        <header class="detail-hero">
          <div>
            <span>任务详情</span>
            <h2>{{ taskTypeLabel(detail.type) }}</h2>
            <button type="button" @click="copyTaskId(detail.id)">
              <span class="mono">{{ detail.id }}</span
              ><el-icon><CopyDocument /></el-icon>
            </button>
          </div>
          <span class="task-status is-large" :class="`is-${detail.status}`"
            ><i />{{ TASK_STATUS_LABELS[detail.status] ?? detail.status }}</span
          >
        </header>

        <section
          v-if="detailOutputUrls.length || detailInputUrls.length"
          class="detail-media-panel"
        >
          <header class="detail-media-panel__head">
            <div class="detail-media-tabs">
              <button
                v-if="detailOutputUrls.length"
                type="button"
                :class="{ 'is-active': detailMediaMode === 'output' }"
                @click="setDetailMediaMode('output')"
              >
                生成结果 <span>{{ detailOutputUrls.length }}</span>
              </button>
              <button
                v-if="detailInputUrls.length"
                type="button"
                :class="{ 'is-active': detailMediaMode === 'input' }"
                @click="setDetailMediaMode('input')"
              >
                输入参考 <span>{{ detailInputUrls.length }}</span>
              </button>
            </div>
            <small>点击大图全屏预览</small>
          </header>
          <div class="detail-media-stage">
            <el-image
              v-if="detailActiveMediaUrl"
              :key="`${detailMediaMode}-${detailMediaIndex}`"
              :src="detailActiveMediaUrl"
              :preview-src-list="detailMediaUrls"
              :initial-index="detailMediaIndex"
              fit="contain"
              class="detail-main-image"
              preview-teleported
              hide-on-click-modal
            />
            <span class="detail-media-counter"
              >{{ detailMediaIndex + 1 }} / {{ detailMediaUrls.length }}</span
            >
          </div>
          <div v-if="detailMediaUrls.length > 1" class="detail-media-thumbs">
            <button
              v-for="(url, index) in detailMediaUrls"
              :key="`${url}-${index}`"
              type="button"
              :class="{ 'is-active': detailMediaIndex === index }"
              @click="detailMediaIndex = index"
            >
              <img
                :src="url"
                :alt="`${detailMediaMode === 'output' ? '生成结果' : '输入参考'} ${index + 1}`"
                loading="lazy"
              />
            </button>
          </div>
        </section>
        <div v-else class="detail-media-empty">
          <span>此任务没有图片产物</span>
          <small>{{
            detail.status === "failed"
              ? "请查看下方异常信息"
              : "对话任务或产物仍在处理中"
          }}</small>
        </div>

        <el-descriptions :column="2" size="small" border class="detail-meta">
          <el-descriptions-item label="ID">
            <span class="mono">{{ shortId(detail.id) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="耗时">{{
            taskDuration(detail)
          }}</el-descriptions-item>
          <el-descriptions-item label="用户">{{
            taskUser(detail)
          }}</el-descriptions-item>
          <el-descriptions-item label="服务商">
            {{ taskServiceProviderMeta(detail).name }} ·
            {{ taskServiceProviderMeta(detail).detail }}
          </el-descriptions-item>
          <el-descriptions-item label="积分消耗"
            >{{ formatPoints(detail.costCents) }} 积分</el-descriptions-item
          >
          <el-descriptions-item label="创建">{{
            formatTime(detail.createdAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="开始">{{
            formatTime(detail.startedAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="结束">{{
            formatTime(detail.finishedAt)
          }}</el-descriptions-item>
        </el-descriptions>

        <h4>任务内容</h4>
        <pre class="detail-pre">{{ detail.prompt || "-" }}</pre>

        <template v-if="detailParams">
          <h4>请求参数</h4>
          <pre class="detail-pre mono">{{ detailParams }}</pre>
        </template>

        <template v-if="detail.errorCode || detail.errorMessage">
          <h4>异常信息</h4>
          <el-alert
            type="error"
            :closable="false"
            :title="detail.errorCode ?? '错误'"
            :description="detail.errorMessage ?? ''"
          />
        </template>

        <div class="detail-actions">
          <el-button
            v-if="detail.status === 'failed'"
            type="warning"
            :loading="acting"
            @click="requeue(detail)"
          >
            重新入队
          </el-button>
          <el-button
            v-if="detail.status === 'queued'"
            type="warning"
            :loading="acting"
            @click="cancel(detail)"
          >
            取消任务
          </el-button>
          <el-button
            v-if="detail.status === 'running'"
            type="danger"
            :loading="acting"
            @click="forceFail(detail)"
          >
            强制失败
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.task-monitor {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  padding: 18px 22px 16px;
  overflow: hidden;
}

.task-filter-panel__refresh,
.refresh-state {
  display: flex;
  align-items: center;
}

.task-filter-panel__refresh {
  flex: 0 0 auto;
  gap: 10px;
  padding-right: 10px;
  border-right: 1px solid var(--border);
}

.refresh-state {
  gap: 8px;
  padding-right: 2px;
}

.refresh-state > span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-3);
}

.refresh-state > span.is-live {
  background: var(--success);
  box-shadow: 0 0 0 4px var(--success-soft);
  animation: task-live 1.8s ease-in-out infinite;
}

.refresh-state small {
  font-size: 10px;
  line-height: 1.25;
}

.refresh-state small {
  color: var(--ink-3);
}

@keyframes task-live {
  50% {
    opacity: 0.5;
  }
}

.status-overview {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.status-card {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: 9px minmax(0, 1fr);
  align-items: start;
  gap: 9px;
  padding: 11px 12px;
  border: 0;
  border-right: 1px solid var(--border);
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.status-card:last-child {
  border-right: 0;
}
.status-card:hover {
  background: var(--surface-2);
}
.status-card.is-active {
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.status-card__dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: currentColor;
}

.status-card.is-running {
  color: var(--info);
}
.status-card.is-failed {
  color: var(--danger);
}
.status-card.is-succeeded {
  color: var(--success);
}
.status-card.is-queued {
  color: var(--warning);
}

.status-card__copy {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0 8px;
}

.status-card__copy small {
  color: var(--ink-3);
  font-size: 10px;
}
.status-card__copy strong {
  color: var(--ink);
  font-size: 19px;
  line-height: 1.15;
}
.status-card__copy em {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 9px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-filter-panel {
  display: grid;
  grid-template-columns: auto minmax(240px, 1.2fr) minmax(150px, 0.5fr) minmax(
      170px,
      0.6fr
    ) auto auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.task-list-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.task-list-panel__head,
.task-list-panel__footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-list-panel__head {
  min-height: 46px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.task-list-panel__head > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.task-list-panel__head strong {
  color: var(--ink);
  font-size: 14px;
}
.task-list-panel__head span {
  color: var(--ink-3);
  font-size: 10px;
}

.today-badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--surface-3);
}

.task-table-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.task-list-panel__footer {
  min-height: 42px;
  padding: 4px 10px 4px 12px;
  border-top: 1px solid var(--border);
}

.task-list-panel__footer > span {
  color: var(--ink-3);
  font-size: 10px;
}
.task-primary {
  min-width: 0;
  cursor: pointer;
}
.task-primary__id {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-2);
}
.task-primary__id button,
.task-prompt-cell button {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
  opacity: 0.55;
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
}
.task-primary:hover .task-primary__id button,
.task-prompt-cell:hover button {
  opacity: 1;
}
.task-primary__id button:hover,
.task-prompt-cell button:hover {
  color: var(--accent-ink);
  background: var(--surface-3);
}

.task-table-image {
  display: block;
  width: 40px;
  height: 40px;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-3);
  cursor: zoom-in;
}

.task-image-empty {
  display: block;
  width: 40px;
  margin: 0 auto;
  color: var(--ink-3);
  text-align: center;
}

.task-cost {
  display: inline-block;
  padding: 4px 7px;
  border-radius: 6px;
  color: var(--warning);
  background: var(--warning-soft);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-prompt-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}

.task-prompt-cell > span {
  flex: 1;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}
.task-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.task-status.is-running {
  color: var(--info);
}
.task-status.is-queued {
  color: var(--warning);
}
.task-status.is-failed {
  color: var(--danger);
}
.task-status.is-succeeded {
  color: var(--success);
}
.task-status.is-large {
  padding: 6px 9px;
  border-radius: 999px;
  background: var(--surface);
}

.task-type,
.task-numbers,
.task-time,
.task-error {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.task-type strong,
.task-numbers strong,
.task-time strong,
.task-error strong {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-type small,
.task-numbers small,
.task-time small,
.task-error small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-error strong {
  color: var(--danger);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.task-error-empty {
  color: var(--ink-3);
}
.task-user {
  display: block;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-source {
  display: inline-flex;
  padding: 4px 7px;
  border-radius: 6px;
  color: var(--info);
  background: var(--info-soft);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
.task-source.is-assistant {
  color: var(--accent-ink);
  background: var(--accent-soft);
}
.task-provider {
  display: inline-flex;
  max-width: 126px;
  align-items: center;
  gap: 7px;
  text-align: left;
}
.task-provider > i {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: currentColor;
}
.task-provider > span {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.task-provider strong,
.task-provider small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-provider strong {
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 650;
}
.task-provider small {
  color: var(--ink-3);
  font-size: 9px;
}
.task-provider.is-c2a {
  color: var(--info);
}
.task-provider.is-sub2api {
  color: var(--accent);
}
.task-provider.is-crun {
  color: var(--warning);
}
.task-provider.is-local {
  color: var(--success);
}
:deep(.el-table) {
  --el-table-row-hover-bg-color: var(--surface-2);
  height: 100% !important;
}
:deep(.el-table th.el-table__cell) {
  height: 38px;
  color: var(--ink-3);
  background: var(--surface-2);
  font-size: 10px;
  font-weight: 600;
}
:deep(.el-table td.el-table__cell) {
  height: 52px;
  padding: 5px 0;
}
:deep(.el-table .task-row.is-failed td.el-table__cell) {
  background: color-mix(in srgb, var(--danger-soft) 28%, var(--surface));
}
:deep(.el-table .task-row.is-running td.el-table__cell) {
  background: color-mix(in srgb, var(--info-soft) 22%, var(--surface));
}
:deep(.el-table__inner-wrapper::before) {
  display: none;
}

.detail-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin: -20px -20px 16px;
  padding: 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.detail-hero > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.detail-hero > div > span {
  color: var(--ink-3);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.detail-hero h2 {
  margin: 0;
  font-size: 20px;
}
.detail-hero button {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
}
.detail-hero button .mono {
  overflow: hidden;
  max-width: 360px;
  text-overflow: ellipsis;
}
.detail-media-panel {
  overflow: hidden;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
}

.detail-media-panel__head {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.detail-media-panel__head > small {
  flex: 0 0 auto;
  color: var(--ink-3);
  font-size: 10px;
}

.detail-media-tabs {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.detail-media-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  color: var(--ink-3);
  background: transparent;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.detail-media-tabs button:hover {
  color: var(--ink);
  background: var(--surface-2);
}
.detail-media-tabs button.is-active {
  color: var(--accent-ink);
  background: var(--accent-soft);
}
.detail-media-tabs button span {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 9px;
  text-align: center;
}

.detail-media-stage {
  position: relative;
  display: grid;
  height: clamp(260px, 42vh, 430px);
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% 24%,
      color-mix(in srgb, var(--accent) 10%, transparent),
      transparent 44%
    ),
    var(--surface-3);
}

.detail-media-stage::before {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      45deg,
      color-mix(in srgb, var(--ink) 3%, transparent) 25%,
      transparent 25%
    ),
    linear-gradient(
      -45deg,
      color-mix(in srgb, var(--ink) 3%, transparent) 25%,
      transparent 25%
    ),
    linear-gradient(
      45deg,
      transparent 75%,
      color-mix(in srgb, var(--ink) 3%, transparent) 75%
    ),
    linear-gradient(
      -45deg,
      transparent 75%,
      color-mix(in srgb, var(--ink) 3%, transparent) 75%
    );
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
  content: "";
  opacity: 0.38;
  pointer-events: none;
}

.detail-main-image {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  cursor: zoom-in;
}

.detail-media-counter {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, white 18%, transparent);
  border-radius: 999px;
  color: white;
  background: rgb(0 0 0 / 58%);
  font-size: 9px;
  line-height: 1;
  backdrop-filter: blur(8px);
}

.detail-media-thumbs {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding: 9px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  scrollbar-width: thin;
}

.detail-media-thumbs button {
  flex: 0 0 58px;
  width: 58px;
  height: 58px;
  overflow: hidden;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.detail-media-thumbs button:hover {
  border-color: var(--ink-3);
  transform: translateY(-1px);
}
.detail-media-thumbs button.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.detail-media-thumbs img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
}

.detail-media-empty {
  display: grid;
  min-height: 110px;
  place-content: center;
  gap: 4px;
  margin-bottom: 14px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--ink-2);
  background: var(--surface-2);
  text-align: center;
}

.detail-media-empty span {
  font-size: 12px;
  font-weight: 650;
}
.detail-media-empty small {
  color: var(--ink-3);
  font-size: 10px;
}
.detail-meta {
  margin-bottom: 14px;
}

.detail-pre {
  overflow: auto;
  max-height: 190px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  margin: 0;
}

h4 {
  margin: 14px 0 7px;
}

.detail-actions {
  position: sticky;
  bottom: -20px;
  z-index: 2;
  display: flex;
  gap: 8px;
  margin: 18px -20px -20px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  backdrop-filter: blur(12px);
}

@media (max-width: 1180px) {
  .status-overview {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .status-card:nth-child(3) {
    border-right: 0;
  }
  .status-card:nth-child(-n + 3) {
    border-bottom: 1px solid var(--border);
  }
  .task-filter-panel {
    grid-template-columns: auto minmax(220px, 1fr) minmax(150px, 0.5fr) minmax(
        160px,
        0.6fr
      ) auto;
  }
  .task-filter-panel > .el-button:last-child {
    display: none;
  }
}

@media (max-width: 760px) {
  .task-monitor {
    height: auto;
    min-height: 100%;
    grid-template-rows: auto;
    padding: 12px;
    overflow: auto;
  }
  .task-filter-panel__refresh {
    width: 100%;
    grid-column: 1 / -1;
    padding: 0 0 8px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .refresh-state {
    margin-right: auto;
  }
  .status-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .status-card {
    border-bottom: 1px solid var(--border);
  }
  .status-card:nth-child(2n) {
    border-right: 0;
  }
  .task-filter-panel {
    grid-template-columns: 1fr 1fr;
  }
  .task-filter-panel__lead {
    grid-column: 1 / -1;
  }
  .task-list-panel {
    min-height: 560px;
  }
  .task-list-panel__footer > span {
    display: none;
  }
  .detail-media-panel__head > small {
    display: none;
  }
  .detail-media-stage {
    height: min(52vh, 380px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-state > span.is-live {
    animation: none;
  }
}
</style>
