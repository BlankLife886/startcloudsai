<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  Delete,
  EditPen,
  Files,
  MagicStick,
  Picture,
  Plus,
  Rank,
  Refresh,
  Search,
  Upload,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { strFromU8, unzipSync } from "fflate";
import draggable from "vuedraggable";

import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";
import { formatShortTime } from "@/utils";

type TemplateItem = {
  id: string;
  slug: string;
  title: string;
  category: string;
  categoryLabel: string;
  industry: string;
  summary: string;
  platforms: string[];
  deliverables: string[];
  accent: string;
  coverUrl?: string | null;
  nodeCount: number;
  enabled: boolean;
  sort: number;
  updatedAt: string;
};

type CanvasDocument = {
  version: 3;
  nodes: unknown[];
  connections: unknown[];
  backgroundMode?: string;
  showImageInfo?: boolean;
  viewport?: unknown;
};

type TemplateAnalysis = {
  slug: string;
  title: string;
  category: string;
  categoryLabel: string;
  industry: string;
  summary: string;
  platforms: string[];
  deliverables: string[];
  accent: string;
};

type StatusFilter = "all" | "published" | "unpublished";

const CATEGORY_PRESETS = [
  { value: "quick-test", label: "快速测试" },
  { value: "industry", label: "行业电商" },
  { value: "model-poster", label: "人物模特海报" },
  { value: "commerce-poster", label: "电商海报" },
  { value: "card", label: "卡牌设计" },
  { value: "game-model", label: "人物与游戏模型" },
  { value: "icon", label: "图标设计" },
] as const;

const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const switchingId = ref("");
const items = ref<TemplateItem[]>([]);
const query = ref("");
const categoryFilter = ref("all");
const statusFilter = ref<StatusFilter>("all");
const dialogOpen = ref(false);
const editingId = ref("");
const document = ref<CanvasDocument | null>(null);
const fileName = ref("");
const pendingTemplatePackage = ref<File | null>(null);
const analyzing = ref(false);
const analysisError = ref("");
const analysisApplied = ref(false);
const analysisRequestId = ref(0);
const pendingCover = ref<File | null>(null);
const previewUrl = ref("");
const coverInputRef = ref<HTMLInputElement | null>(null);
const coverPreviewOpen = ref(false);
const coverPreviewIndex = ref(0);
const sortOpen = ref(false);
const sortSaving = ref(false);
const sortItems = ref<TemplateItem[]>([]);
const sortSnapshot = ref<string[]>([]);
const form = reactive({
  slug: "",
  title: "",
  category: "industry",
  categoryLabel: "行业电商",
  industry: "",
  summary: "",
  platforms: "",
  deliverables: "",
  accent: "#6d5cff",
  sort: 0,
  enabled: true,
});

const dialogTitle = computed(() =>
  editingId.value ? "编辑画布模板" : "上传画布模板",
);

const categories = computed(() => {
  const counts = new Map<string, { id: string; label: string; count: number }>();
  for (const item of items.value) {
    const current = counts.get(item.category);
    counts.set(item.category, {
      id: item.category,
      label: item.categoryLabel || item.category,
      count: (current?.count || 0) + 1,
    });
  }
  return [...counts.values()].sort((left, right) =>
    left.label.localeCompare(right.label, "zh-CN"),
  );
});

const publishedCount = computed(
  () => items.value.filter((item) => item.enabled).length,
);

const visibleItems = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return items.value
    .filter((item) => {
      if (categoryFilter.value !== "all" && item.category !== categoryFilter.value) {
        return false;
      }
      if (statusFilter.value === "published" && !item.enabled) return false;
      if (statusFilter.value === "unpublished" && item.enabled) return false;
      if (!needle) return true;
      return [
        item.title,
        item.slug,
        item.industry,
        item.summary,
        item.categoryLabel,
        ...item.platforms,
        ...item.deliverables,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .slice()
    .sort(
      (left, right) =>
        (left.sort || 0) - (right.sort || 0) ||
        left.title.localeCompare(right.title, "zh-CN"),
    );
});

const hasFilters = computed(
  () =>
    Boolean(query.value.trim()) ||
    categoryFilter.value !== "all" ||
    statusFilter.value !== "all",
);

const selectedIds = reactive(new Set<string>());
const selectionMode = ref(false);
const batchSaving = ref(false);
const batchDeleting = ref(false);
const batchBusy = computed(() => batchSaving.value || batchDeleting.value);
const batchForm = reactive({
  category: "",
  enabled: "" as "" | "published" | "unpublished",
});

const selectedItems = computed(() =>
  items.value.filter((item) => selectedIds.has(item.id)),
);
const selectedVisibleCount = computed(() =>
  visibleItems.value.reduce(
    (count, item) => count + Number(selectedIds.has(item.id)),
    0,
  ),
);
const allVisibleSelected = computed(
  () =>
    visibleItems.value.length > 0 &&
    selectedVisibleCount.value === visibleItems.value.length,
);
const someVisibleSelected = computed(
  () => selectedVisibleCount.value > 0 && !allVisibleSelected.value,
);
const hasBatchChanges = computed(
  () => Boolean(batchForm.category || batchForm.enabled),
);

function resetBatchForm() {
  batchForm.category = "";
  batchForm.enabled = "";
}

function pruneSelection() {
  const loadedIds = new Set(items.value.map((item) => item.id));
  for (const id of [...selectedIds]) {
    if (!loadedIds.has(id)) selectedIds.delete(id);
  }
}

function clearSelection() {
  selectedIds.clear();
  resetBatchForm();
}

function toggleSelectionMode() {
  if (selectionMode.value) clearSelection();
  selectionMode.value = !selectionMode.value;
}

function toggleSelected(id: string, selected: boolean) {
  if (selected) selectedIds.add(id);
  else selectedIds.delete(id);
}

function toggleVisibleSelection(selected: boolean) {
  for (const item of visibleItems.value) {
    if (selected) selectedIds.add(item.id);
    else selectedIds.delete(item.id);
  }
}

function categoryLabelOf(value: string) {
  return (
    CATEGORY_PRESETS.find((item) => item.value === value)?.label ||
    categories.value.find((item) => item.id === value)?.label ||
    value
  );
}

async function applyBatchEdit() {
  const targets = selectedItems.value;
  if (!targets.length) {
    ElMessage.warning("请先选择模板");
    return;
  }
  if (!hasBatchChanges.value) {
    ElMessage.warning("请选择需要批量修改的字段");
    return;
  }

  const body: { category?: string; categoryLabel?: string; enabled?: boolean } =
    {};
  if (batchForm.category) {
    body.category = batchForm.category;
    body.categoryLabel = categoryLabelOf(batchForm.category);
  }
  if (batchForm.enabled) body.enabled = batchForm.enabled === "published";

  batchSaving.value = true;
  const queue = [...targets];
  const failedIds = new Set<string>();
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      try {
        await request(`/api/v1/admin/canvas-workflow-templates/${item.id}`, {
          method: "PATCH",
          body,
          silent: true,
        });
        Object.assign(item, body);
        selectedIds.delete(item.id);
      } catch {
        failedIds.add(item.id);
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(6, targets.length) }, worker),
    );
    const successCount = targets.length - failedIds.size;
    if (successCount) ElMessage.success(`已更新 ${successCount} 个模板`);
    if (failedIds.size) {
      for (const id of failedIds) selectedIds.add(id);
      ElMessage.error(`${failedIds.size} 个更新失败，已保留选择`);
    } else {
      resetBatchForm();
    }
  } finally {
    batchSaving.value = false;
  }
}

async function applyBatchDelete() {
  const targets = selectedItems.value;
  if (!targets.length) {
    ElMessage.warning("请先选择模板");
    return;
  }

  try {
    await ElMessageBox.confirm(
      `删除后，用户端无限画布将不再展示已选的 ${targets.length} 个模板。`,
      "批量删除模板",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }

  batchDeleting.value = true;
  const queue = [...targets];
  const failedIds = new Set<string>();
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      try {
        await request(`/api/v1/admin/canvas-workflow-templates/${item.id}`, {
          method: "DELETE",
          silent: true,
        });
        selectedIds.delete(item.id);
      } catch {
        failedIds.add(item.id);
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(6, targets.length) }, worker),
    );
    const successCount = targets.length - failedIds.size;
    if (successCount) ElMessage.success(`已删除 ${successCount} 个模板`);
    if (failedIds.size) {
      for (const id of failedIds) selectedIds.add(id);
      ElMessage.error(`${failedIds.size} 个删除失败，已保留选择`);
    }
    if (successCount) await load();
  } finally {
    batchDeleting.value = false;
  }
}

const coverPreviewUrls = computed(() =>
  visibleItems.value.map((item) => item.coverUrl).filter(Boolean) as string[],
);

const activeCategoryLabel = computed(() => {
  if (categoryFilter.value === "all") return "全部模板";
  return (
    categories.value.find((item) => item.id === categoryFilter.value)?.label ||
    "模板"
  );
});

const sortableItems = computed(() => {
  const list =
    categoryFilter.value === "all"
      ? items.value
      : items.value.filter((item) => item.category === categoryFilter.value);
  return [...list].sort(
    (left, right) =>
      (left.sort || 0) - (right.sort || 0) ||
      left.title.localeCompare(right.title, "zh-CN"),
  );
});

const sortDirty = computed(
  () => sortItems.value.map((item) => item.id).join("|") !== sortSnapshot.value.join("|"),
);

const sortDialogTitle = computed(() => `调整${activeCategoryLabel.value}顺序`);

function splitItems(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clearFilters() {
  query.value = "";
  categoryFilter.value = "all";
  statusFilter.value = "all";
}

function slugFromTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function applyCategoryPreset(value: string) {
  form.category = value;
  const preset = CATEGORY_PRESETS.find((item) => item.value === value);
  const isPresetLabel = CATEGORY_PRESETS.some(
    (item) => item.label === form.categoryLabel,
  );
  if (preset && (!form.categoryLabel || isPresetLabel)) {
    form.categoryLabel = preset.label;
  }
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await request<{ items: TemplateItem[] }>(
      "/api/v1/admin/canvas-workflow-templates",
      { silent: true },
    );
    items.value = data.items || [];
    pruneSelection();
  } catch (error) {
    items.value = [];
    loadError.value = error instanceof Error ? error.message : "模板读取失败";
  } finally {
    loading.value = false;
  }
}

function resetForm(item?: TemplateItem) {
  analysisRequestId.value += 1;
  editingId.value = item?.id || "";
  form.slug = item?.slug || "";
  form.title = item?.title || "";
  form.category = item?.category || "industry";
  form.categoryLabel = item?.categoryLabel || "行业电商";
  form.industry = item?.industry || "";
  form.summary = item?.summary || "";
  form.platforms = item?.platforms?.join("，") || "";
  form.deliverables = item?.deliverables?.join("，") || "";
  form.accent = item?.accent || "#6d5cff";
  form.sort =
    item?.sort ??
    (items.value.length
      ? Math.max(...items.value.map((entry) => entry.sort || 0)) + 10
      : 10);
  form.enabled = item?.enabled ?? true;
  document.value = null;
  fileName.value = "";
  pendingTemplatePackage.value = null;
  analyzing.value = false;
  analysisError.value = "";
  analysisApplied.value = false;
  pendingCover.value = null;
  if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = item?.coverUrl || "";
  dialogOpen.value = true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractDocument(value: unknown): CanvasDocument {
  const root = asRecord(value);
  const projects = Array.isArray(root.projects) ? root.projects : [];
  const firstProject = projects.length
    ? asRecord(asRecord(projects[0]).project)
    : {};
  const candidate = Object.keys(firstProject).length
    ? firstProject
    : asRecord(root.document || root.project || root);
  const version = Object.keys(firstProject).length
    ? root.version
    : candidate.version;
  if (version !== 3) throw new Error("只支持画布 v3 JSON");
  const nodes = candidate.nodes;
  const connections = candidate.connections || candidate.edges || [];
  if (
    !Array.isArray(nodes) ||
    nodes.length === 0 ||
    !Array.isArray(connections)
  ) {
    throw new Error("未找到有效的画布节点与连线");
  }
  return {
    version: 3,
    nodes,
    connections,
    backgroundMode:
      typeof candidate.backgroundMode === "string"
        ? candidate.backgroundMode
        : "lines",
    showImageInfo: Boolean(candidate.showImageInfo),
    viewport: candidate.viewport,
  };
}

function applyTemplateAnalysis(result: TemplateAnalysis) {
  form.slug = result.slug;
  form.title = result.title;
  form.category = result.category;
  form.categoryLabel = result.categoryLabel;
  form.industry = result.industry;
  form.summary = result.summary;
  form.platforms = result.platforms.join("，");
  form.deliverables = result.deliverables.join("，");
  form.accent = result.accent;
}

async function analyzeTemplate(
  source: CanvasDocument | null = document.value,
  sourceName = fileName.value,
) {
  if (!source || analyzing.value) return;
  const requestId = ++analysisRequestId.value;
  analyzing.value = true;
  analysisError.value = "";
  analysisApplied.value = false;
  try {
    const result = await request<TemplateAnalysis>(
      "/api/v1/admin/canvas-workflow-templates/analyze",
      {
        method: "POST",
        body: { document: source, fileName: sourceName },
        silent: true,
      },
    );
    if (requestId !== analysisRequestId.value) return;
    applyTemplateAnalysis(result);
    analysisApplied.value = true;
    ElMessage.success("AI 已分析画布并填充模板信息");
  } catch (error) {
    if (requestId !== analysisRequestId.value) return;
    analysisError.value = error instanceof Error ? error.message : "AI 分析失败";
    ElMessage.error(analysisError.value);
  } finally {
    if (requestId === analysisRequestId.value) analyzing.value = false;
  }
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    analysisRequestId.value += 1;
    analyzing.value = false;
    if (file.size > 128 * 1024 * 1024) {
      throw new Error("画布导出包不能超过 128MB");
    }
    const isZip = file.name.toLowerCase().endsWith(".zip");
    let source: unknown;
    if (isZip) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (entry) => entry.name.replace(/^\.\//, "") === "projects.json",
      });
      const manifest = entries["projects.json"] || entries["./projects.json"];
      if (!manifest) throw new Error("ZIP 中缺少 projects.json");
      source = JSON.parse(strFromU8(manifest));
    } else {
      source = JSON.parse(await file.text());
    }
    const parsed = extractDocument(source);
    document.value = parsed;
    fileName.value = file.name;
    pendingTemplatePackage.value = isZip ? file : null;
    analysisError.value = "";
    analysisApplied.value = false;
    if (!form.title) form.title = file.name.replace(/\.json$/i, "");
    if (!form.slug) form.slug = slugFromTitle(form.title);
    ElMessage.success(
      `已读取 ${document.value.nodes.length} 个节点、${document.value.connections.length} 条连线`,
    );
    void analyzeTemplate(parsed, file.name);
  } catch (error) {
    analysisRequestId.value += 1;
    analyzing.value = false;
    analysisError.value = "";
    analysisApplied.value = false;
    document.value = null;
    fileName.value = "";
    pendingTemplatePackage.value = null;
    ElMessage.error(error instanceof Error ? error.message : "模板文件读取失败");
  }
}

function pickCover(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    ElMessage.warning("封面仅支持 PNG、JPG 或 WebP");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    ElMessage.warning("模板封面不能超过 8MB");
    return;
  }
  pendingCover.value = file;
  if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(file);
}

function triggerCoverPick() {
  coverInputRef.value?.click();
}

function openCoverPreview(item: TemplateItem) {
  if (!item.coverUrl) return;
  const index = coverPreviewUrls.value.indexOf(item.coverUrl);
  coverPreviewIndex.value = Math.max(0, index);
  coverPreviewOpen.value = true;
}

async function uploadCover(id: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/v1/admin/canvas-workflow-templates/${id}/cover`, {
    method: "PUT",
    credentials: "include",
    body,
  });
  const payload = (await res.json().catch(() => null)) as
    | {
        success?: boolean;
        data?: { coverUrl?: string };
        code?: string;
        error?: string;
      }
    | null;
  if (!res.ok || !payload?.success) {
    const detail =
      payload?.error && payload.error !== "Not Found" ? payload.error : "";
    throw new Error(detail || `封面上传失败（HTTP ${res.status}）`);
  }
  return payload.data?.coverUrl ?? "";
}

async function submit() {
  if (!form.slug || !form.title || !form.category || !form.categoryLabel) {
    ElMessage.warning("请填写模板标识、名称和分类");
    return;
  }
  if (!editingId.value && !document.value) {
    ElMessage.warning("请选择模板 JSON 或 ZIP 文件");
    return;
  }
  saving.value = true;
  try {
    const body = {
      ...form,
      platforms: splitItems(form.platforms),
      deliverables: splitItems(form.deliverables),
      ...(document.value ? { document: document.value } : {}),
    };
    const creating = !editingId.value;
    const endpoint = editingId.value
      ? `/api/v1/admin/canvas-workflow-templates/${editingId.value}`
      : "/api/v1/admin/canvas-workflow-templates";
    let saved: TemplateItem;
    if (pendingTemplatePackage.value) {
      const payload = new FormData();
      payload.append("metadata", JSON.stringify(body));
      payload.append("package", pendingTemplatePackage.value);
      const response = await fetch(endpoint, {
        method: editingId.value ? "PATCH" : "POST",
        credentials: "include",
        body: payload,
      });
      const envelope = (await response.json().catch(() => null)) as
        | { success?: boolean; data?: TemplateItem; error?: string }
        | null;
      if (!response.ok || !envelope?.success || !envelope.data) {
        if (response.status === 413) {
          throw new Error(
            "画布导出包被上传网关拒绝，请确认文件不超过 128MB，并检查线上网关上传限制",
          );
        }
        throw new Error(envelope?.error || `模板保存失败（HTTP ${response.status}）`);
      }
      saved = envelope.data;
    } else {
      saved = await request<TemplateItem>(endpoint, {
        method: editingId.value ? "PATCH" : "POST",
        body,
        silent: true,
      });
    }
    const id = saved?.id || editingId.value;
    if (creating && id) editingId.value = id;
    if (pendingCover.value && id) {
      previewUrl.value =
        (await uploadCover(id, pendingCover.value)) || previewUrl.value;
      pendingCover.value = null;
    }
    dialogOpen.value = false;
    ElMessage.success(creating ? "模板已上传" : "模板已更新");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "模板保存失败");
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(item: TemplateItem, enabled: boolean) {
  if (switchingId.value) return;
  switchingId.value = item.id;
  try {
    await request(`/api/v1/admin/canvas-workflow-templates/${item.id}`, {
      method: "PATCH",
      body: { enabled },
    });
    item.enabled = enabled;
    ElMessage.success(enabled ? "模板已发布" : "模板已下架");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "模板状态更新失败");
  } finally {
    switchingId.value = "";
  }
}

async function remove(item: TemplateItem) {
  try {
    await ElMessageBox.confirm(
      `删除后，用户端无限画布将不再展示「${item.title}」。`,
      "删除模板",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  await request(`/api/v1/admin/canvas-workflow-templates/${item.id}`, {
    method: "DELETE",
  });
  ElMessage.success("模板已删除");
  await load();
}

function openSortDialog() {
  sortItems.value = sortableItems.value.map((item) => ({ ...item }));
  sortSnapshot.value = sortItems.value.map((item) => item.id);
  sortOpen.value = true;
}

async function saveSortOrder() {
  if (!sortItems.value.length || !sortDirty.value || sortSaving.value) return;
  sortSaving.value = true;
  try {
    await request("/api/v1/admin/canvas-workflow-templates/order", {
      method: "PATCH",
      body: { ids: sortItems.value.map((item) => item.id) },
    });
    sortSnapshot.value = sortItems.value.map((item) => item.id);
    ElMessage.success(`已保存 ${sortItems.value.length} 个模板的顺序`);
    sortOpen.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "排序保存失败");
  } finally {
    sortSaving.value = false;
  }
}

async function closeSortDialog() {
  if (!sortDirty.value || sortSaving.value) {
    sortOpen.value = false;
    return;
  }
  try {
    await ElMessageBox.confirm("当前排序还没有保存，确定放弃这些调整吗？", "放弃排序调整", {
      type: "warning",
      confirmButtonText: "放弃调整",
      cancelButtonText: "继续排序",
    });
    sortOpen.value = false;
  } catch {
    /* keep open */
  }
}

onMounted(load);

watch(categoryFilter, () => {
  if (sortOpen.value) openSortDialog();
});

watch(dialogOpen, (open) => {
  if (open) return;
  if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  pendingCover.value = null;
});
</script>

<template>
  <div class="page templates-page">
    <PageCard>
      <div class="templates-toolbar">
        <div class="templates-tabs" role="tablist" aria-label="模板分类">
          <button
            type="button"
            role="tab"
            class="templates-tab"
            :class="{ 'is-active': categoryFilter === 'all' }"
            :aria-selected="categoryFilter === 'all'"
            @click="categoryFilter = 'all'"
          >
            全部
            <em class="tnum">{{ items.length }}</em>
          </button>
          <button
            v-for="item in categories"
            :key="item.id"
            type="button"
            role="tab"
            class="templates-tab"
            :class="{ 'is-active': categoryFilter === item.id }"
            :aria-selected="categoryFilter === item.id"
            @click="categoryFilter = item.id"
          >
            {{ item.label }}
            <em class="tnum">{{ item.count }}</em>
          </button>
        </div>
        <div class="templates-toolbar__right">
          <el-input
            v-model="query"
            :prefix-icon="Search"
            clearable
            placeholder="搜索名称、行业或交付物"
          />
          <el-select v-model="statusFilter" aria-label="发布状态">
            <el-option label="全部状态" value="all" />
            <el-option label="已发布" value="published" />
            <el-option label="已下架" value="unpublished" />
          </el-select>
          <el-button v-if="hasFilters" @click="clearFilters">清除筛选</el-button>
          <el-button
            :icon="Rank"
            :disabled="!sortableItems.length || batchBusy"
            @click="openSortDialog"
          >
            排序
          </el-button>
          <el-button
            :type="selectionMode ? 'primary' : undefined"
            :icon="EditPen"
            :disabled="batchBusy"
            @click="toggleSelectionMode"
          >
            {{ selectionMode ? "退出多选" : "多选" }}
          </el-button>
          <el-button :icon="Refresh" :loading="loading" @click="load">
            刷新
          </el-button>
          <el-button type="primary" :icon="Plus" @click="resetForm()">
            上传模板
          </el-button>
        </div>
      </div>

      <p class="templates-legend">
        {{ activeCategoryLabel }} · 已发布
        <em class="tnum">{{ publishedCount }}</em>
        / {{ items.length }} ，封面会同步到无限画布的生产工作流弹窗。
      </p>

      <div v-if="loadError" class="templates-error">
        <el-icon><Files /></el-icon>
        <strong>模板读取失败</strong>
        <span>{{ loadError }}</span>
        <el-button @click="load">重新加载</el-button>
      </div>

      <div v-else v-loading="loading" class="templates-board">
        <div
          v-if="selectionMode"
          class="templates-bulk-bar"
          :class="{ 'is-active': selectedItems.length }"
        >
          <div class="templates-bulk-selection">
            <el-checkbox
              :model-value="allVisibleSelected"
              :indeterminate="someVisibleSelected"
              :disabled="!visibleItems.length || batchBusy"
              @change="toggleVisibleSelection(Boolean($event))"
            >
              全选当前结果
            </el-checkbox>
            <span v-if="selectedItems.length">已选 {{ selectedItems.length }} 个</span>
          </div>
          <div v-if="selectedItems.length" class="templates-bulk-controls">
            <el-select
              v-model="batchForm.category"
              clearable
              size="small"
              placeholder="修改分类"
              aria-label="批量修改分类"
              :disabled="batchBusy"
            >
              <el-option
                v-for="preset in CATEGORY_PRESETS"
                :key="preset.value"
                :label="preset.label"
                :value="preset.value"
              />
            </el-select>
            <el-select
              v-model="batchForm.enabled"
              clearable
              size="small"
              placeholder="修改状态"
              aria-label="批量修改发布状态"
              :disabled="batchBusy"
            >
              <el-option label="已发布" value="published" />
              <el-option label="已下架" value="unpublished" />
            </el-select>
            <el-button
              type="primary"
              size="small"
              :loading="batchSaving"
              :disabled="!hasBatchChanges || batchBusy"
              @click="applyBatchEdit"
            >
              应用修改
            </el-button>
            <el-button
              type="danger"
              size="small"
              :icon="Delete"
              :loading="batchDeleting"
              :disabled="batchBusy"
              @click="applyBatchDelete"
            >
              删除
            </el-button>
            <el-button text size="small" :disabled="batchBusy" @click="clearSelection">
              清除选择
            </el-button>
          </div>
        </div>

        <div v-if="visibleItems.length" class="templates-grid">
          <article
            v-for="item in visibleItems"
            :key="item.id"
            class="template-card"
            :class="{
              'is-off': !item.enabled,
              'is-selected': selectedIds.has(item.id),
              'is-selection-mode': selectionMode,
            }"
            :style="{ '--template-accent': item.accent || '#6d5cff' }"
          >
            <div
              class="template-card__visual"
              :class="{
                'has-cover': Boolean(item.coverUrl) && !selectionMode,
              }"
              :role="item.coverUrl && !selectionMode ? 'button' : undefined"
              :tabindex="item.coverUrl && !selectionMode ? 0 : undefined"
              :aria-label="item.coverUrl && !selectionMode ? `查看${item.title}封面` : undefined"
              @click="
                selectionMode
                  ? toggleSelected(item.id, !selectedIds.has(item.id))
                  : openCoverPreview(item)
              "
              @keydown.enter.prevent="
                selectionMode
                  ? toggleSelected(item.id, !selectedIds.has(item.id))
                  : openCoverPreview(item)
              "
            >
              <el-checkbox
                v-if="selectionMode"
                class="template-card__select"
                :model-value="selectedIds.has(item.id)"
                :aria-label="`选择 ${item.title}`"
                @click.stop
                @change="toggleSelected(item.id, Boolean($event))"
              />
              <img
                v-if="item.coverUrl"
                :src="item.coverUrl"
                :alt="item.title"
                loading="lazy"
              />
              <div v-else class="template-card__placeholder" aria-hidden="true">
                <strong>{{ item.title.slice(0, 1) }}</strong>
              </div>
              <span class="template-card__badge">{{ item.categoryLabel }}</span>
              <span
                class="template-card__status"
                :class="{ 'is-on': item.enabled }"
              >
                {{ item.enabled ? "已发布" : "已下架" }}
              </span>
            </div>

            <div class="template-card__body">
              <span v-if="item.industry" class="template-card__industry">
                {{ item.industry }}
              </span>
              <h3>{{ item.title }}</h3>
              <small class="mono">{{ item.slug }}</small>
              <p>{{ item.summary || "未填写简介" }}</p>
              <div class="template-card__meta">
                <span class="tnum">{{ item.nodeCount }} 个节点</span>
                <span v-if="item.platforms.length">
                  {{ item.platforms.slice(0, 2).join(" / ") }}
                </span>
                <span v-if="item.deliverables.length">
                  {{ item.deliverables.length }} 类交付物
                </span>
                <span>{{ formatShortTime(item.updatedAt) }}</span>
              </div>
            </div>

            <footer class="template-card__foot">
              <label class="template-card__switch">
                <span>{{ item.enabled ? "已发布" : "已下架" }}</span>
                <el-switch
                  :model-value="item.enabled"
                  :loading="switchingId === item.id"
                  :disabled="batchBusy"
                  @change="toggleEnabled(item, Boolean($event))"
                />
              </label>
              <div class="template-card__actions">
                <el-button :icon="EditPen" :disabled="batchBusy" @click="resetForm(item)">
                  编辑
                </el-button>
                <el-button
                  type="danger"
                  plain
                  :icon="Delete"
                  aria-label="删除模板"
                  :disabled="batchBusy"
                  @click="remove(item)"
                />
              </div>
            </footer>
          </article>
        </div>

        <div v-else class="templates-empty">
          <el-icon><Files /></el-icon>
          <strong>
            {{ items.length ? "没有匹配的模板" : "还没有画布模板" }}
          </strong>
          <span>
            {{
              items.length
                ? "调整分类、状态或搜索后再试"
                : "上传 JSON 和封面后，会同步到用户端无限画布"
            }}
          </span>
          <el-button
            v-if="!items.length"
            type="primary"
            :icon="Plus"
            @click="resetForm()"
          >
            上传模板
          </el-button>
          <el-button v-else @click="clearFilters">清除筛选</el-button>
        </div>
      </div>
    </PageCard>

    <AdminDialog
      v-model="dialogOpen"
      :title="dialogTitle"
      subtitle="封面会显示在无限画布的生产工作流模板弹窗中"
      :icon="Upload"
      width="880px"
      confirm-text="保存模板"
      :confirm-loading="saving"
      :confirm-disabled="saving || analyzing"
      :footer-hint="
        analyzing
          ? 'AI 正在分析画布 JSON'
          : pendingCover
            ? '已选择新封面，保存时将自动压缩上传'
            : ''
      "
      @confirm="submit"
    >
      <el-form
        class="template-editor"
        label-position="top"
        @submit.prevent="submit"
      >
        <aside class="template-editor__media">
          <el-form-item label="模板封面">
            <div class="cover-picker" :class="{ 'has-image': Boolean(previewUrl) }">
              <button
                v-if="previewUrl"
                type="button"
                class="cover-picker__preview"
                @click="triggerCoverPick"
              >
                <img :src="previewUrl" alt="模板封面预览" />
              </button>
              <button
                v-else
                type="button"
                class="cover-picker__empty"
                @click="triggerCoverPick"
              >
                <el-icon :size="22"><Picture /></el-icon>
                <strong>点击上传封面</strong>
                <small>PNG / JPG / WebP · 8MB</small>
              </button>
              <button
                v-if="previewUrl"
                type="button"
                class="cover-picker__replace"
                @click="triggerCoverPick"
              >
                更换图片
              </button>
              <input
                ref="coverInputRef"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                @change="pickCover"
              />
            </div>
            <small class="cover-compression-note">
              上传后由服务端自动压缩，最长边不超过 1280px
            </small>
          </el-form-item>
          <el-form-item
            :label="editingId ? '替换模板文件（可选）' : '模板文件'"
            required
          >
            <label class="file-picker">
              <el-icon><Upload /></el-icon>
              <span>{{ fileName || "选择画布 JSON / ZIP" }}</span>
              <input
                type="file"
                accept="application/json,application/zip,.json,.zip"
                @change="onFileChange"
              />
            </label>
            <div v-if="document" class="file-analysis">
              <small
                class="file-meta"
                :class="{
                  'is-success': analysisApplied,
                  'is-error': Boolean(analysisError),
                }"
                :title="analysisError"
              >
                {{
                  analyzing
                    ? "AI 正在分析节点、配置和连接关系"
                    : analysisApplied
                      ? "AI 已自动填充全部模板信息"
                      : analysisError
                        ? "AI 分析失败，已保留当前表单"
                        : `已读取 ${document.nodes.length} 个节点、${document.connections.length} 条连线`
                }}
              </small>
              <el-button
                type="primary"
                link
                :icon="MagicStick"
                :loading="analyzing"
                :disabled="saving"
                @click="analyzeTemplate()"
              >
                {{ analysisApplied || analysisError ? "重新分析并填充" : "AI 分析并填充" }}
              </el-button>
            </div>
          </el-form-item>
        </aside>

        <div class="template-editor__fields">
          <div class="form-grid">
            <el-form-item label="模板名称" required>
              <el-input
                v-model="form.title"
                maxlength="120"
                placeholder="例如：美妆护肤｜新品全渠道上市"
              />
            </el-form-item>
            <el-form-item label="模板标识" required>
              <el-input
                v-model="form.slug"
                maxlength="80"
                placeholder="ecommerce-main-image"
                data-no-translate
              />
            </el-form-item>
            <el-form-item label="分类" required>
              <el-select
                v-model="form.category"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入分类标识"
                @change="applyCategoryPreset"
              >
                <el-option
                  v-for="preset in CATEGORY_PRESETS"
                  :key="preset.value"
                  :label="preset.label"
                  :value="preset.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="分类名称" required>
              <el-input
                v-model="form.categoryLabel"
                maxlength="60"
                placeholder="行业电商"
              />
            </el-form-item>
            <el-form-item label="行业">
              <el-input v-model="form.industry" maxlength="80" />
            </el-form-item>
            <el-form-item label="排序">
              <el-input-number
                v-model="form.sort"
                :min="-9999"
                :max="9999"
                controls-position="right"
              />
            </el-form-item>
          </div>
          <el-form-item label="简介">
            <el-input
              v-model="form.summary"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="说明这条生产线适合什么场景"
            />
          </el-form-item>
          <div class="form-grid">
            <el-form-item label="平台">
              <el-input
                v-model="form.platforms"
                placeholder="天猫，京东，抖音商城"
              />
            </el-form-item>
            <el-form-item label="交付物">
              <el-input
                v-model="form.deliverables"
                placeholder="透明商品母版，方形商品主图"
              />
            </el-form-item>
            <el-form-item label="强调色">
              <div class="accent-field">
                <el-color-picker v-model="form.accent" />
                <span class="mono">{{ form.accent }}</span>
              </div>
            </el-form-item>
            <el-form-item label="发布状态">
              <el-switch
                v-model="form.enabled"
                active-text="已发布"
                inactive-text="已下架"
              />
            </el-form-item>
          </div>
        </div>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="sortOpen"
      :title="sortDialogTitle"
      subtitle="拖动缩略图排序，保存后同步到无限画布"
      :icon="Rank"
      width="min(520px, 94vw)"
      nested-scroll
      panel-class="template-sort-dialog"
      :close-on-click-modal="!sortDirty"
      confirm-text="保存顺序"
      :confirm-loading="sortSaving"
      :confirm-disabled="!sortDirty || !sortItems.length"
      @confirm="saveSortOrder"
    >
      <template #footer>
        <div class="admin-dialog__footer">
          <span class="admin-dialog__hint">
            {{ sortDirty ? "当前顺序有改动，尚未保存" : "拖动缩略图调整顺序" }}
          </span>
          <div class="admin-dialog__actions">
            <el-button :disabled="sortSaving" @click="closeSortDialog">取消</el-button>
            <el-button
              type="primary"
              :loading="sortSaving"
              :disabled="!sortDirty || !sortItems.length"
              @click="saveSortOrder"
            >
              保存顺序
            </el-button>
          </div>
        </div>
      </template>
      <div v-if="!sortItems.length" class="template-sort-empty">
        <el-icon><Rank /></el-icon>
        <strong>当前分类没有模板</strong>
      </div>
      <draggable
        v-else
        v-model="sortItems"
        item-key="id"
        handle=".template-sort-handle"
        :animation="180"
        ghost-class="is-sort-ghost"
        drag-class="is-sort-dragging"
        class="template-sort-list"
      >
        <template #item="{ element: item, index }">
          <article class="template-sort-row">
            <span class="template-sort-index">{{ index + 1 }}</span>
            <button
              type="button"
              class="template-sort-handle template-sort-cover"
              :aria-label="`拖动第 ${index + 1} 项`"
            >
              <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" />
              <span v-else>{{ item.title.slice(0, 1) }}</span>
            </button>
          </article>
        </template>
      </draggable>
    </AdminDialog>

    <el-image-viewer
      v-if="coverPreviewOpen && coverPreviewUrls.length"
      :url-list="coverPreviewUrls"
      :initial-index="coverPreviewIndex"
      teleported
      hide-on-click-modal
      @close="coverPreviewOpen = false"
    />
  </div>
</template>

<style scoped>
.templates-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.templates-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.templates-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.templates-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.templates-tabs {
  display: flex;
  min-width: 0;
  flex: 1 1 420px;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  scrollbar-width: none;
}

.templates-tabs::-webkit-scrollbar {
  display: none;
}

.templates-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.templates-tab em {
  font-style: normal;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}

.templates-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}

.templates-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}

.templates-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.templates-toolbar__right {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.templates-toolbar__right .el-input {
  width: 220px;
}

.templates-toolbar__right .el-select {
  width: 120px;
}

.templates-legend {
  flex: 0 0 auto;
  margin: 12px 0 14px;
  color: var(--ink-3);
  font-size: 12px;
}

.templates-legend em {
  color: var(--ink);
  font-style: normal;
  font-weight: 700;
}

.templates-board {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.templates-bulk-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  min-height: 46px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 12px;
  margin-bottom: 12px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(14px);
}

.templates-bulk-bar.is-active {
  border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
}

.templates-bulk-selection {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
}

.templates-bulk-selection > span {
  padding-left: 9px;
  border-left: 1px solid var(--border);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.templates-bulk-controls {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
}

.templates-bulk-controls :deep(.el-select) {
  width: 128px;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  align-content: start;
  gap: 14px;
}

.template-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.template-card:hover {
  border-color: color-mix(in srgb, var(--template-accent) 42%, var(--border));
  box-shadow: var(--shadow-md);
}

.template-card.is-off {
  opacity: 0.72;
}

.template-card.is-selected {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}

.template-card.is-selection-mode {
  cursor: pointer;
}

.template-card__select {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
}

.template-card__visual {
  position: relative;
  display: grid;
  height: 148px;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(
      120% 90% at 20% 10%,
      color-mix(in srgb, var(--template-accent) 18%, var(--surface)),
      transparent 58%
    ),
    var(--surface-2);
}

.template-card__visual.has-cover {
  cursor: zoom-in;
}

.template-card__visual img {
  display: block;
  width: calc(100% - 28px);
  height: calc(100% - 28px);
  object-fit: contain;
  filter: drop-shadow(0 8px 16px rgb(16 24 40 / 0.12));
}

.template-card.is-off .template-card__visual img {
  filter: grayscale(0.35) drop-shadow(0 8px 16px rgb(16 24 40 / 0.08));
}

.template-card__placeholder {
  display: grid;
  place-items: center;
}

.template-card__placeholder strong {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--template-accent) 16%, var(--surface));
  color: var(--template-accent);
  font-size: 18px;
}

.template-card__badge,
.template-card__status {
  position: absolute;
  max-width: calc(100% - 20px);
  overflow: hidden;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-card__badge {
  top: 10px;
  left: 10px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--ink-2);
  box-shadow: var(--shadow-sm);
}

.template-card.is-selection-mode .template-card__badge {
  left: 38px;
  max-width: calc(100% - 96px);
}

.template-card__status {
  top: 10px;
  right: 10px;
  background: var(--surface-3);
  color: var(--ink-3);
}

.template-card__status.is-on {
  background: var(--success-soft);
  color: var(--success);
}

.template-card__body {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 14px 16px 10px;
}

.template-card__industry {
  color: var(--template-accent);
  font-size: 11px;
  font-weight: 700;
}

.template-card__body h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-card__body small {
  color: var(--ink-3);
  font-size: 11px;
}

.template-card__body p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 8px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
}

.template-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
}

.template-card__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.template-card__actions {
  display: flex;
  gap: 6px;
}

.templates-empty,
.templates-error {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  min-height: 100%;
  color: var(--ink-3);
  text-align: center;
}

.templates-empty .el-icon,
.templates-error .el-icon {
  font-size: 32px;
}

.templates-empty strong,
.templates-error strong {
  color: var(--ink);
}

.template-editor {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 20px;
}

.template-editor__media,
.template-editor__fields {
  min-width: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.form-grid :deep(.el-input-number),
.form-grid :deep(.el-select) {
  width: 100%;
}

.accent-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.accent-field span {
  color: var(--ink-3);
}

.file-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  width: 100%;
  padding: 0 12px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
}

.file-picker:hover {
  border-color: var(--accent);
}

.file-picker input {
  display: none;
}

.file-meta {
  display: block;
  color: var(--ink-3);
  font-size: 12px;
}

.file-analysis {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.file-analysis .file-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-analysis .file-meta.is-success {
  color: var(--success);
}

.file-analysis .file-meta.is-error {
  color: var(--danger);
}

.file-analysis :deep(.el-button) {
  flex: none;
  padding-inline: 4px;
}

.cover-picker {
  position: relative;
  width: 100%;
}

.cover-compression-note {
  display: block;
  margin-top: 6px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.45;
}

.cover-picker input {
  display: none;
}

.cover-picker__preview,
.cover-picker__empty {
  display: grid;
  width: 100%;
  min-height: 168px;
  place-items: center;
  overflow: hidden;
  border: 1px dashed var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink-3);
  cursor: pointer;
}

.cover-picker__preview {
  padding: 0;
}

.cover-picker__preview img {
  display: block;
  width: 100%;
  height: 168px;
  object-fit: cover;
}

.cover-picker__empty {
  gap: 6px;
}

.cover-picker__empty strong {
  color: var(--ink);
  font-size: 13px;
}

.cover-picker__empty small {
  font-size: 12px;
}

.cover-picker__replace {
  position: absolute;
  right: 10px;
  bottom: 10px;
  border: 0;
  border-radius: 8px;
  background: rgb(18 20 26 / 0.78);
  color: #fff;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.template-sort-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 10px;
  max-height: min(60vh, 520px);
  overflow: auto;
  padding: 4px 2px;
}

.template-sort-empty {
  display: grid;
  min-height: 180px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
}

.template-sort-row {
  display: grid;
  gap: 6px;
  justify-items: center;
  min-width: 0;
}

.template-sort-handle {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
}

.template-sort-handle:active {
  cursor: grabbing;
}

.template-sort-index {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.template-sort-cover {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
  color: var(--ink-2);
  font-size: 18px;
  font-weight: 700;
}

.template-sort-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.is-sort-ghost {
  opacity: 0.35;
}

.is-sort-ghost .template-sort-cover {
  border-style: dashed;
}

.is-sort-dragging .template-sort-cover {
  box-shadow: var(--shadow-md);
}

@media (prefers-reduced-motion: reduce) {
  .template-card {
    transition: none;
  }
}
</style>
