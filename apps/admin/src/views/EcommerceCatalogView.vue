<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  CircleCheck,
  Delete,
  Goods,
  MagicStick,
  Picture,
  Plus,
  Pointer,
  Rank,
  Refresh,
  Search,
  Setting,
  ShoppingBag,
  Upload,
  User,
} from "@element-plus/icons-vue";
import draggable from "vuedraggable";
import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";
import {
  compressCatalogImage,
  formatCatalogBytes,
  type CatalogCompressionResult,
} from "@/utils/compressCatalogImage";

type CatalogKind = "model" | "scene" | "garment" | "hand";
type CatalogStatus = "all" | "active" | "inactive";
type CatalogSort = "manual" | "newest" | "name";

interface CatalogItem {
  id: string;
  kind: CatalogKind;
  label: string;
  imageUrl: string;
  apparel: string;
  sort: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface PendingUpload {
  key: string;
  file: File;
  preview: string;
  label: string;
  summary: string;
  analysisStatus: "idle" | "queued" | "analyzing" | "done" | "error";
  analysisError: string;
}

const KINDS: {
  value: CatalogKind;
  label: string;
  hint: string;
  icon: Component;
}[] = [
  {
    value: "model",
    label: "模特",
    hint: "适用于虚拟试衣与手持商品的人物参考",
    icon: User,
  },
  {
    value: "scene",
    label: "场景",
    hint: "适用于全部电商生图业务的场景参考",
    icon: Picture,
  },
  {
    value: "garment",
    label: "服装",
    hint: "用于虚拟试衣的服装商品参考",
    icon: Goods,
  },
  {
    value: "hand",
    label: "手图",
    hint: "用于手持商品的手部、肤色与指甲参考",
    icon: Pointer,
  },
];

const STATUS_FILTERS: { value: CatalogStatus; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "已上架" },
  { value: "inactive", label: "已下架" },
];
const APPAREL_OPTIONS = ["上装", "下装", "全身"] as const;
const MAX_PER_KIND = 40;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const COMPRESSION_THRESHOLD_BYTES = 512 * 1024;
const COMPRESSION_PERCENT_KEY = "admin:ecommerce-catalog:compression-percent";

function initialCompressionPercent() {
  const saved = Number(localStorage.getItem(COMPRESSION_PERCENT_KEY));
  return Number.isFinite(saved) && saved >= 5 && saved <= 90 ? saved : 10;
}

function labelFromFilename(name: string) {
  const stem = String(name || "")
    .replace(/\.[^.]+$/, "")
    .trim();
  const chars = Array.from(stem);
  return chars.slice(0, 32).join("") || "未命名素材";
}

function nextPendingKey() {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const kind = ref<CatalogKind>("model");
const catalogItems = ref<CatalogItem[]>([]);
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const compressing = ref(false);
const switchingId = ref("");
const search = ref("");
const statusFilter = ref<CatalogStatus>("all");
const sortMode = ref<CatalogSort>("manual");
const compressionPercent = ref(initialCompressionPercent());
const dialogOpen = ref(false);
const editingId = ref("");
const pendingUploads = ref<PendingUpload[]>([]);
const createPreview = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);
const replaceTargetId = ref("");
const replacingId = ref("");
const compressionSummary = ref("");
const uploadProgress = ref({ current: 0, total: 0 });
const ANALYSIS_CONCURRENCY = 3;
const analysisQueue: PendingUpload[] = [];
let activeAnalyses = 0;
const editingAnalysisStatus = ref<"idle" | "analyzing" | "done" | "error">("idle");
const editingAnalysisError = ref("");

const sortOpen = ref(false);
const sortItems = ref<CatalogItem[]>([]);
const sortSnapshot = ref<string[]>([]);
const sortSaving = ref(false);
const previewOpen = ref(false);
const previewIndex = ref(0);
const previewUrls = ref<string[]>([]);
const selectedIds = reactive(new Set<string>());
const selectionMode = ref(false);
const batchDeleting = ref(false);

const form = reactive({
  label: "",
  apparel: "",
  sort: 0,
  active: true,
});

const kindMeta = computed(
  () => KINDS.find((item) => item.value === kind.value) || KINDS[0],
);
const items = computed(() =>
  catalogItems.value.filter((item) => item.kind === kind.value),
);
const visibleItems = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase();
  const result = items.value.filter((item) => {
    if (statusFilter.value === "active" && !item.active) return false;
    if (statusFilter.value === "inactive" && item.active) return false;
    if (!keyword) return true;
    return [item.label, item.apparel, String(item.sort)].some((value) =>
      String(value || "")
        .toLocaleLowerCase()
        .includes(keyword),
    );
  });
  return [...result].sort((a, b) => {
    if (sortMode.value === "newest") {
      return String(b.updatedAt || b.createdAt || "").localeCompare(
        String(a.updatedAt || a.createdAt || ""),
      );
    }
    if (sortMode.value === "name") {
      return a.label.localeCompare(b.label, "zh-CN");
    }
    return a.sort - b.sort || a.label.localeCompare(b.label, "zh-CN");
  });
});
const kindCounts = computed(
  () =>
    Object.fromEntries(
      KINDS.map((item) => [
        item.value,
        catalogItems.value.filter((catalogItem) => catalogItem.kind === item.value)
          .length,
      ]),
    ) as Record<CatalogKind, number>,
);
const activeCount = computed(
  () => items.value.filter((item) => item.active).length,
);
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
const inactiveCount = computed(() => items.value.length - activeCount.value);
function statusCount(value: CatalogStatus) {
  if (value === "active") return activeCount.value;
  if (value === "inactive") return inactiveCount.value;
  return items.value.length;
}
const remaining = computed(() =>
  Math.max(0, MAX_PER_KIND - items.value.length),
);
const dialogTitle = computed(() =>
  editingId.value ? `编辑${kindMeta.value.label}` : `上传${kindMeta.value.label}`,
);
const dialogSubtitle = computed(() =>
  editingId.value
    ? "修改后立即同步到用户端"
    : `还可上传 ${remaining.value} 张`,
);
const dialogWidth = computed(() => {
  if (editingId.value) return "580px";
  if (pendingUploads.value.length > 4) return "min(880px, 92vw)";
  if (pendingUploads.value.length) return "min(720px, 92vw)";
  return "560px";
});
const dialogNestedScroll = computed(
  () => !editingId.value && pendingUploads.value.length > 4,
);
const dialogConfirmText = computed(() => {
  if (editingId.value) return "保存素材";
  if (pendingUploads.value.length > 1) return `上传 ${pendingUploads.value.length} 张`;
  return "保存素材";
});
const analyzingCount = computed(
  () =>
    pendingUploads.value.filter(
      (item) => item.analysisStatus === "queued" || item.analysisStatus === "analyzing",
    ).length,
);
const editingAnalyzing = computed(
  () => editingAnalysisStatus.value === "analyzing",
);
const editingItem = computed(() =>
  catalogItems.value.find((item) => item.id === editingId.value),
);
const hasFilters = computed(
  () =>
    Boolean(search.value) ||
    statusFilter.value !== "all" ||
    sortMode.value !== "manual",
);
const sortDirty = computed(
  () =>
    sortItems.value.map((item) => item.id).join("|") !== sortSnapshot.value.join("|"),
);

function revokePreview(url = createPreview.value) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  if (url === createPreview.value) createPreview.value = "";
}

function revokePendingUploads() {
  analysisQueue.splice(0);
  for (const item of pendingUploads.value) revokePreview(item.preview);
  pendingUploads.value = [];
}

function resetForm() {
  form.label = "";
  form.apparel = kind.value === "garment" ? "上装" : "";
  form.sort = items.value.length
    ? Math.max(...items.value.map((item) => item.sort)) + 10
    : 10;
  form.active = true;
  compressionSummary.value = "";
  uploadProgress.value = { current: 0, total: 0 };
  editingAnalysisStatus.value = "idle";
  editingAnalysisError.value = "";
  revokePendingUploads();
  revokePreview();
}

async function loadItems() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await request<{ items: CatalogItem[] }>(
      "/api/v1/admin/ecommerce/catalog",
    );
    catalogItems.value = Array.isArray(data?.items) ? data.items : [];
    const loadedIds = new Set(catalogItems.value.map((item) => item.id));
    for (const id of [...selectedIds]) {
      if (!loadedIds.has(id)) selectedIds.delete(id);
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "素材读取失败";
  } finally {
    loading.value = false;
  }
}

function setKind(value: CatalogKind) {
  if (kind.value === value) return;
  selectedIds.clear();
  kind.value = value;
}

function toggleSelectionMode() {
  if (selectionMode.value) selectedIds.clear();
  selectionMode.value = !selectionMode.value;
}

function toggleSelected(id: string, selected: boolean) {
  if (batchDeleting.value) return;
  if (selected) selectedIds.add(id);
  else selectedIds.delete(id);
}

function toggleVisibleSelection(selected: boolean) {
  if (batchDeleting.value) return;
  for (const item of visibleItems.value) {
    if (selected) selectedIds.add(item.id);
    else selectedIds.delete(item.id);
  }
}

function clearSelection() {
  selectedIds.clear();
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  sortMode.value = "manual";
}

function openCreate() {
  if (items.value.length >= MAX_PER_KIND) {
    ElMessage.warning(`每种素材最多 ${MAX_PER_KIND} 张`);
    return;
  }
  editingId.value = "";
  resetForm();
  dialogOpen.value = true;
}

function openEdit(item: CatalogItem) {
  editingId.value = item.id;
  form.label = item.label;
  form.apparel = item.apparel || (kind.value === "garment" ? "上装" : "");
  form.sort = item.sort;
  form.active = item.active;
  compressionSummary.value = "";
  uploadProgress.value = { current: 0, total: 0 };
  editingAnalysisStatus.value = "idle";
  editingAnalysisError.value = "";
  revokePendingUploads();
  revokePreview();
  createPreview.value = item.imageUrl;
  dialogOpen.value = true;
}

function describeCompression(result: CatalogCompressionResult) {
  if (!result.compressed) {
    return `${formatCatalogBytes(result.originalBytes)}（未超过 512KB，保留原图）`;
  }
  const percent = Math.max(1, Math.round(result.ratio * 100));
  return `${formatCatalogBytes(result.originalBytes)} → ${formatCatalogBytes(result.compressedBytes)}（${percent}%）`;
}

function notifyCompression(result: CatalogCompressionResult) {
  if (!result.compressed) {
    ElMessage.info("图片未超过 512KB，已保留原图");
    return;
  }
  const message = `已转为 WebP：${describeCompression(result)}`;
  if (result.targetReached) ElMessage.success(message);
  else ElMessage.warning(`${message}，已达到清晰度保护下限`);
}

async function compressPickedFile(file: File) {
  return compressCatalogImage(file, {
    targetRatio: compressionPercent.value / 100,
    thresholdBytes: COMPRESSION_THRESHOLD_BYTES,
  });
}

async function analyzePendingUpload(item: PendingUpload) {
  const labelBeforeAnalysis = item.label;
  item.analysisStatus = "analyzing";
  item.analysisError = "";
  try {
    const body = new FormData();
    body.append("kind", kind.value);
    body.append("file", item.file);
    const result = await uploadMultipart<{ title: string }>(
      "/api/v1/admin/ecommerce/catalog/analyze",
      "POST",
      body,
    );
    const title = String(result?.title || "").trim();
    if (!title) throw new Error("AI 未返回有效标题");
    const shouldApply = item.label === labelBeforeAnalysis;
    if (shouldApply) {
      item.label = title;
    }
    item.analysisStatus = shouldApply ? "done" : "idle";
  } catch (error) {
    item.analysisStatus = "error";
    item.analysisError = error instanceof Error ? error.message : "AI 分析失败";
    ElMessage.error(item.analysisError);
  }
}

function drainAnalysisQueue() {
  while (activeAnalyses < ANALYSIS_CONCURRENCY && analysisQueue.length) {
    const queued = analysisQueue.shift();
    if (!queued || !pendingUploads.value.includes(queued)) continue;
    activeAnalyses += 1;
    void analyzePendingUpload(queued).finally(() => {
      activeAnalyses -= 1;
      drainAnalysisQueue();
    });
  }
}

function queueImageAnalysis(item: PendingUpload) {
  if (item.analysisStatus === "queued" || item.analysisStatus === "analyzing") return;
  item.analysisStatus = "queued";
  item.analysisError = "";
  analysisQueue.push(item);
  drainAnalysisQueue();
}

async function currentEditingImageFile() {
  const replacement = pendingUploads.value[0]?.file;
  if (replacement) return replacement;
  const item = editingItem.value;
  if (!item?.imageUrl) throw new Error("当前素材没有可分析的图片");
  const response = await fetch(item.imageUrl, { credentials: "include" });
  if (!response.ok) throw new Error(`素材图片读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("当前素材不是有效图片");
  return new File([blob], `${item.id}.png`, { type: blob.type });
}

async function analyzeEditingImage() {
  if (!editingId.value || editingAnalyzing.value) return;
  const labelBeforeAnalysis = form.label;
  editingAnalysisStatus.value = "analyzing";
  editingAnalysisError.value = "";
  try {
    const body = new FormData();
    body.append("kind", kind.value);
    body.append("file", await currentEditingImageFile());
    const result = await uploadMultipart<{ title: string }>(
      "/api/v1/admin/ecommerce/catalog/analyze",
      "POST",
      body,
    );
    const title = String(result?.title || "").trim();
    if (!title) throw new Error("AI 未返回有效标题");
    if (form.label === labelBeforeAnalysis) form.label = title;
    editingAnalysisStatus.value = "done";
  } catch (error) {
    editingAnalysisStatus.value = "error";
    editingAnalysisError.value =
      error instanceof Error ? error.message : "AI 分析失败";
    ElMessage.error(editingAnalysisError.value);
  }
}

async function appendPendingFiles(files: File[]) {
  const room = editingId.value
    ? 1
    : Math.max(0, remaining.value - pendingUploads.value.length);
  if (!room) {
    ElMessage.warning(`当前分类还能上传 ${remaining.value} 张`);
    return;
  }
  const picked = files.slice(0, room);
  if (picked.length < files.length) {
    ElMessage.warning(`当前分类还能再传 ${room} 张，已忽略多余文件`);
  }
  compressing.value = true;
  try {
    let lastResult: CatalogCompressionResult | null = null;
    for (const file of picked) {
      const result = await compressPickedFile(file);
      lastResult = result;
      const preview = URL.createObjectURL(result.file);
      if (editingId.value) {
        editingAnalysisStatus.value = "idle";
        editingAnalysisError.value = "";
        revokePendingUploads();
        revokePreview();
        createPreview.value = preview;
        pendingUploads.value = [
          {
            key: nextPendingKey(),
            file: result.file,
            preview,
            label: form.label || labelFromFilename(file.name),
            summary: describeCompression(result),
            analysisStatus: "idle",
            analysisError: "",
          },
        ];
        compressionSummary.value = describeCompression(result);
        notifyCompression(result);
        return;
      }
      const manualLabel = pendingUploads.value.length === 0 && form.label.trim();
      const pendingItem: PendingUpload = {
        key: nextPendingKey(),
        file: result.file,
        preview,
        label: manualLabel ? form.label.trim() : labelFromFilename(file.name),
        summary: describeCompression(result),
        analysisStatus: "idle",
        analysisError: "",
      };
      pendingUploads.value.push(pendingItem);
      compressionSummary.value = describeCompression(result);
    }
    if (lastResult && picked.length === 1) notifyCompression(lastResult);
    else if (picked.length > 1) ElMessage.success(`已准备 ${picked.length} 张图片`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图片压缩失败");
  } finally {
    compressing.value = false;
  }
}

async function onPickCreateFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  await appendPendingFiles(files);
}

function removePendingUpload(key: string) {
  const index = pendingUploads.value.findIndex((item) => item.key === key);
  if (index < 0) return;
  const [removed] = pendingUploads.value.splice(index, 1);
  if (removed) revokePreview(removed.preview);
  if (editingId.value) {
    createPreview.value = "";
    compressionSummary.value = "";
    editingAnalysisStatus.value = "idle";
    editingAnalysisError.value = "";
  }
}

async function uploadMultipart<T = CatalogItem>(
  url: string,
  method: "POST" | "PUT",
  body: FormData,
) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    body,
  });
  const payload = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null;
  if (!res.ok || !payload?.success) {
    throw new Error(payload?.error || `上传失败（HTTP ${res.status}）`);
  }
  return payload.data as T;
}

async function createCatalogItem(item: PendingUpload, sort: number) {
  const label = item.label.trim();
  if (!label) throw new Error("请填写名称");
  const body = new FormData();
  body.append("kind", kind.value);
  body.append("label", label);
  body.append("sort", String(Math.max(0, Math.round(sort))));
  body.append("active", form.active ? "true" : "false");
  if (kind.value === "garment") body.append("apparel", form.apparel);
  body.append("file", item.file);
  await uploadMultipart("/api/v1/admin/ecommerce/catalog", "POST", body);
}

async function saveItem() {
  if (saving.value || compressing.value || editingAnalyzing.value) return;
  if (editingId.value) {
    const label = form.label.trim();
    if (!label) {
      ElMessage.warning("请填写名称");
      return;
    }
    saving.value = true;
    try {
      await request(`/api/v1/admin/ecommerce/catalog/${editingId.value}`, {
        method: "PATCH",
        body: {
          label,
          apparel: kind.value === "garment" ? form.apparel : "",
          sort: Math.max(0, Math.round(Number(form.sort || 0))),
          active: form.active,
        },
      });
      const nextFile = pendingUploads.value[0]?.file;
      if (nextFile) {
        const body = new FormData();
        body.append("file", nextFile);
        await uploadMultipart(
          `/api/v1/admin/ecommerce/catalog/${editingId.value}/image`,
          "PUT",
          body,
        );
      }
      ElMessage.success("素材已更新");
      dialogOpen.value = false;
      await loadItems();
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      saving.value = false;
    }
    return;
  }

  if (!pendingUploads.value.length) {
    ElMessage.warning("请先选择图片");
    return;
  }
  if (pendingUploads.value.some((item) => !item.label.trim())) {
    ElMessage.warning("请为每张图片填写名称");
    return;
  }
  if (items.value.length + pendingUploads.value.length > MAX_PER_KIND) {
    ElMessage.warning(`每种素材最多 ${MAX_PER_KIND} 张`);
    return;
  }

  saving.value = true;
  uploadProgress.value = { current: 0, total: pendingUploads.value.length };
  let created = 0;
  try {
    let sort = form.sort;
    for (const item of pendingUploads.value) {
      uploadProgress.value.current = created + 1;
      await createCatalogItem(item, sort);
      created += 1;
      sort += 10;
    }
    ElMessage.success(
      created > 1 ? `已上传 ${created} 张${kindMeta.value.label}` : "素材已添加",
    );
    dialogOpen.value = false;
    await loadItems();
  } catch (error) {
    ElMessage.error(
      created
        ? `已上传 ${created} 张，后续失败：${error instanceof Error ? error.message : "保存失败"}`
        : error instanceof Error
          ? error.message
          : "保存失败",
    );
    if (created) await loadItems();
  } finally {
    saving.value = false;
    uploadProgress.value = { current: 0, total: 0 };
  }
}

async function toggleActive(item: CatalogItem, active: boolean) {
  const previous = item.active;
  item.active = active;
  switchingId.value = item.id;
  try {
    await request(`/api/v1/admin/ecommerce/catalog/${item.id}`, {
      method: "PATCH",
      body: { active },
    });
  } catch {
    item.active = previous;
  } finally {
    switchingId.value = "";
  }
}

function pickReplaceImage(item: CatalogItem) {
  replaceTargetId.value = item.id;
  fileInputRef.value?.click();
}

async function onReplaceFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const id = replaceTargetId.value;
  input.value = "";
  replaceTargetId.value = "";
  if (!file || !id) return;
  replacingId.value = id;
  try {
    const result = await compressPickedFile(file);
    const body = new FormData();
    body.append("file", result.file);
    await uploadMultipart(`/api/v1/admin/ecommerce/catalog/${id}/image`, "PUT", body);
    notifyCompression(result);
    ElMessage.success("图片已更换");
    await loadItems();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "图片压缩或更换失败");
  } finally {
    replacingId.value = "";
  }
}

async function removeItem(item: CatalogItem) {
  try {
    await ElMessageBox.confirm(
      `删除后，用户端将不再展示「${item.label}」。已保存在用户本地草稿里的选择可能失效。`,
      `删除${kindMeta.value.label}`,
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  await request(`/api/v1/admin/ecommerce/catalog/${item.id}`, {
    method: "DELETE",
  });
  ElMessage.success("素材已删除");
  await loadItems();
}

async function removeSelectedItems() {
  const targets = selectedItems.value;
  if (!targets.length) {
    ElMessage.warning("请先选择素材");
    return;
  }

  try {
    await ElMessageBox.confirm(
      `删除后，用户端将不再展示已选的 ${targets.length} 个${kindMeta.value.label}素材，已保存在用户本地草稿里的选择可能失效。`,
      "批量删除电商素材",
      {
        type: "warning",
        confirmButtonText: "确认删除",
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
        await request(`/api/v1/admin/ecommerce/catalog/${item.id}`, {
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
    if (successCount) ElMessage.success(`已删除 ${successCount} 个素材`);
    if (failedIds.size) {
      for (const id of failedIds) selectedIds.add(id);
      ElMessage.error(`${failedIds.size} 个素材删除失败，已保留选择`);
    }
    if (successCount) await loadItems();
  } finally {
    batchDeleting.value = false;
  }
}

function openPreview(item: CatalogItem, list = visibleItems.value) {
  const urls = list.map((entry) => entry.imageUrl).filter(Boolean);
  const index = list.findIndex((entry) => entry.id === item.id);
  if (!item.imageUrl || !urls.length) return;
  previewUrls.value = urls;
  previewIndex.value = Math.max(0, index);
  previewOpen.value = true;
}

function openSortDialog() {
  sortItems.value = items.value
    .slice()
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "zh-CN"));
  sortSnapshot.value = sortItems.value.map((item) => item.id);
  sortOpen.value = true;
}

async function saveSortOrder() {
  if (!sortItems.value.length || !sortDirty.value || sortSaving.value) return;
  sortSaving.value = true;
  try {
    await request("/api/v1/admin/ecommerce/catalog/order", {
      method: "PATCH",
      body: {
        kind: kind.value,
        ids: sortItems.value.map((item) => item.id),
      },
    });
    sortSnapshot.value = sortItems.value.map((item) => item.id);
    ElMessage.success(`已保存 ${sortItems.value.length} 张${kindMeta.value.label}的顺序`);
    sortOpen.value = false;
    await loadItems();
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

watch(kind, () => {
  clearFilters();
  if (sortOpen.value) openSortDialog();
});

watch(compressionPercent, (value) => {
  localStorage.setItem(COMPRESSION_PERCENT_KEY, String(value));
});

watch(dialogOpen, (open) => {
  if (!open) {
    compressionSummary.value = "";
    uploadProgress.value = { current: 0, total: 0 };
    revokePendingUploads();
    revokePreview();
  }
});


onMounted(loadItems);

onBeforeUnmount(() => {
  revokePendingUploads();
  revokePreview();
});
</script>

<template>
  <div class="ecommerce-catalog-page">
    <header class="library-toolbar">
      <div class="library-toolbar__filters">
        <el-input
          v-model="search"
          :prefix-icon="Search"
          clearable
          class="catalog-search"
          placeholder="搜索名称或品类"
        />
        <div class="catalog-status-pills" role="tablist" aria-label="上架状态">
          <button
            v-for="item in STATUS_FILTERS"
            :key="item.value"
            type="button"
            role="tab"
            class="catalog-status-pills__item"
            :class="{ 'is-active': statusFilter === item.value }"
            :aria-selected="statusFilter === item.value"
            @click="statusFilter = item.value"
          >
            {{ item.label }}
            <em class="tnum">{{ statusCount(item.value) }}</em>
          </button>
        </div>
        <el-select v-model="sortMode" class="toolbar-select is-short" aria-label="素材排序">
          <el-option label="手动排序" value="manual" />
          <el-option label="最近更新" value="newest" />
          <el-option label="按名称" value="name" />
        </el-select>
        <el-button v-if="hasFilters" @click="clearFilters">重置</el-button>
      </div>
      <div class="library-toolbar__actions">
        <el-popover placement="bottom-end" :width="292" trigger="click">
          <template #reference>
            <el-button :icon="Setting">压缩</el-button>
          </template>
          <div class="catalog-compression-settings">
            <div class="catalog-compression-settings__heading">
              <strong>上传压缩</strong>
              <span>超过 512KB 时生效</span>
            </div>
            <div class="catalog-compression-settings__value">
              <span>目标文件体积</span>
              <strong>{{ compressionPercent }}%</strong>
            </div>
            <el-slider
              v-model="compressionPercent"
              :min="5"
              :max="90"
              :step="5"
              :show-tooltip="true"
            />
            <small>数值越低，文件越小；系统会优先保留清晰度，再逐级缩放。</small>
          </div>
        </el-popover>
        <el-button
          :icon="Rank"
          :disabled="!items.length || batchDeleting"
          @click="openSortDialog"
        >
          排序
        </el-button>
        <el-button
          :type="selectionMode ? 'primary' : undefined"
          :icon="CircleCheck"
          :disabled="batchDeleting || !items.length"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? "退出多选" : "多选" }}
        </el-button>
        <div class="library-toolbar__buttons">
          <el-button
            type="primary"
            :icon="Plus"
            :disabled="remaining <= 0 || batchDeleting"
            @click="openCreate"
          >
            上传
          </el-button>
          <el-button
            :icon="Refresh"
            :loading="loading"
            :disabled="batchDeleting"
            @click="loadItems"
          >
            刷新
          </el-button>
        </div>
      </div>
    </header>

    <section class="items-workspace">
      <aside class="category-rail" aria-label="素材分类">
        <button
          v-for="item in KINDS"
          :key="item.value"
          type="button"
          :class="{ 'is-active': kind === item.value }"
          :aria-current="kind === item.value ? 'page' : undefined"
          @click="setKind(item.value)"
        >
          <i>
            <el-icon><component :is="item.icon" /></el-icon>
          </i>
          <span>{{ item.label }}</span>
          <em class="tnum">{{ kindCounts[item.value] }}</em>
        </button>
        <div class="catalog-capacity">
          <div>
            <span>当前分类容量</span>
            <strong>{{ items.length }} / {{ MAX_PER_KIND }}</strong>
          </div>
          <el-progress
            :percentage="Math.round((items.length / MAX_PER_KIND) * 100)"
            :stroke-width="5"
            :show-text="false"
          />
        </div>
      </aside>

      <main class="catalog-content">
        <div class="catalog-content__scroll">
          <div v-if="loadError" class="catalog-error">
            <el-icon><ShoppingBag /></el-icon>
            <div>
              <strong>素材读取失败</strong>
              <span>{{ loadError }}</span>
            </div>
            <el-button @click="loadItems">重新加载</el-button>
          </div>

          <div v-else v-loading="loading" class="catalog-feed">
            <div
              v-if="selectionMode"
              class="catalog-bulk-bar"
              :class="{ 'is-active': selectedItems.length }"
            >
              <div class="catalog-bulk-selection">
                <el-checkbox
                  :model-value="allVisibleSelected"
                  :indeterminate="someVisibleSelected"
                  :disabled="!visibleItems.length || batchDeleting"
                  @change="toggleVisibleSelection(Boolean($event))"
                >
                  全选当前结果
                </el-checkbox>
                <span v-if="selectedItems.length">已选 {{ selectedItems.length }} 个</span>
              </div>
              <div v-if="selectedItems.length" class="catalog-bulk-actions">
                <el-button
                  type="danger"
                  size="small"
                  :icon="Delete"
                  :loading="batchDeleting"
                  @click="removeSelectedItems"
                >
                  删除所选
                </el-button>
                <el-button
                  text
                  size="small"
                  :disabled="batchDeleting"
                  @click="clearSelection"
                >
                  清除选择
                </el-button>
              </div>
            </div>
            <div v-if="visibleItems.length" class="catalog-grid">
              <article
                v-for="item in visibleItems"
                :key="item.id"
                class="catalog-card"
                :class="{
                  'is-inactive': !item.active,
                  'is-selected': selectedIds.has(item.id),
                  'is-selection-mode': selectionMode,
                }"
              >
                <div
                  class="catalog-card__image"
                  role="button"
                  tabindex="0"
                  :aria-label="selectionMode ? `选择${item.label}` : `查看${item.label}大图`"
                  @click="
                    selectionMode
                      ? toggleSelected(item.id, !selectedIds.has(item.id))
                      : openPreview(item)
                  "
                  @keydown.enter.prevent="
                    selectionMode
                      ? toggleSelected(item.id, !selectedIds.has(item.id))
                      : openPreview(item)
                  "
                >
                  <img :src="item.imageUrl" :alt="item.label" />
                  <el-checkbox
                    v-if="selectionMode"
                    class="catalog-card__select"
                    :model-value="selectedIds.has(item.id)"
                    :aria-label="`选择 ${item.label}`"
                    :disabled="batchDeleting"
                    @click.stop
                    @change="toggleSelected(item.id, Boolean($event))"
                  />
                  <span class="catalog-card__status" :class="{ 'is-active': item.active }">
                    {{ item.active ? "已上架" : "已下架" }}
                  </span>
                  <el-tooltip
                    v-if="!selectionMode"
                    :content="`更换${kindMeta.label}图片`"
                    placement="top"
                  >
                    <el-button
                      class="catalog-card__replace"
                      :icon="Upload"
                      circle
                      :loading="replacingId === item.id"
                      aria-label="更换图片"
                      @click.stop="pickReplaceImage(item)"
                    />
                  </el-tooltip>
                </div>
                <div class="catalog-card__body">
                  <header>
                    <strong :title="item.label">{{ item.label }}</strong>
                    <el-switch
                      :model-value="item.active"
                      size="small"
                      :loading="switchingId === item.id"
                      :disabled="batchDeleting"
                      @change="toggleActive(item, Boolean($event))"
                    />
                  </header>
                  <footer class="catalog-card__footer">
                    <span v-if="item.apparel">{{ item.apparel }}</span>
                    <div class="catalog-card__actions">
                      <el-button size="small" text :disabled="batchDeleting" @click="openEdit(item)">
                        编辑
                      </el-button>
                      <el-button
                        size="small"
                        text
                        type="danger"
                        :disabled="batchDeleting"
                        @click="removeItem(item)"
                      >
                        删除
                      </el-button>
                    </div>
                  </footer>
                </div>
              </article>
            </div>

            <div v-else class="library-empty">
              <el-icon><ShoppingBag /></el-icon>
              <strong>{{ items.length ? "没有匹配的素材" : `还没有${kindMeta.label}` }}</strong>
              <span>{{ items.length ? "调整筛选条件后再试" : `上传后会立即同步到用户端${kindMeta.label}列表` }}</span>
              <el-button v-if="!items.length" type="primary" :icon="Plus" @click="openCreate">
                上传{{ kindMeta.label }}
              </el-button>
              <el-button v-else @click="clearFilters">清除筛选</el-button>
            </div>
          </div>
        </div>
      </main>
    </section>

    <el-image-viewer
      v-if="previewOpen && previewUrls.length"
      :url-list="previewUrls"
      :initial-index="previewIndex"
      teleported
      hide-on-click-modal
      @close="previewOpen = false"
    />

    <input
      ref="fileInputRef"
      type="file"
      hidden
      :accept="IMAGE_ACCEPT"
      @change="onReplaceFile"
    />

    <AdminDialog
      v-model="dialogOpen"
      :title="dialogTitle"
      :subtitle="dialogSubtitle"
      :icon="kindMeta.icon"
      :width="dialogWidth"
      :nested-scroll="dialogNestedScroll"
      panel-class="catalog-upload-dialog"
      :confirm-loading="saving"
      :confirm-disabled="saving || compressing || analyzingCount > 0 || editingAnalyzing"
      :confirm-text="dialogConfirmText"
      :footer-hint="
        uploadProgress.total > 1
          ? `正在上传 ${uploadProgress.current} / ${uploadProgress.total}`
          : analyzingCount
            ? `AI 正在分析 ${analyzingCount} 张图片`
          : compressionSummary
      "
      @confirm="saveItem"
    >
      <el-form
        label-position="top"
        class="catalog-form"
        :class="{
          'is-create': !editingId,
          'is-edit': Boolean(editingId),
          'has-files': !editingId && pendingUploads.length,
        }"
      >
        <div class="catalog-form__fields">
          <el-form-item
            v-if="editingId || !pendingUploads.length"
            :label="`${kindMeta.label}名称`"
            required
            class="is-name"
          >
            <div class="catalog-title-input">
              <el-input
                v-model="form.label"
                maxlength="32"
                show-word-limit
                :placeholder="`例如：${kind === 'model' ? '东亚女性' : kind === 'scene' ? '纯色棚拍' : kind === 'hand' ? '自然肤色右手' : '白色衬衫'}`"
              />
              <el-tooltip
                v-if="editingId"
                :content="pendingUploads.length ? 'AI 分析替换图片' : 'AI 分析当前图片'"
                placement="top"
              >
                <el-button
                  :icon="MagicStick"
                  circle
                  :loading="editingAnalyzing"
                  :disabled="saving || compressing"
                  aria-label="AI 分析图片标题"
                  @click="analyzeEditingImage"
                />
              </el-tooltip>
            </div>
            <small
              v-if="editingId && editingAnalysisStatus !== 'idle'"
              class="catalog-edit-analysis"
              :class="{
                'is-success': editingAnalysisStatus === 'done',
                'is-error': editingAnalysisStatus === 'error',
              }"
              :title="editingAnalysisError"
            >
              {{
                editingAnalysisStatus === "analyzing"
                  ? "AI 正在识别图片"
                  : editingAnalysisStatus === "done"
                    ? "AI 已生成标题"
                    : "AI 分析失败"
              }}
            </small>
          </el-form-item>
          <div v-else class="catalog-form__count">
            <strong class="tnum">{{ pendingUploads.length }}</strong>
            <span>张已选</span>
          </div>
          <el-form-item v-if="kind === 'garment'" label="衣服类型" class="is-compact">
            <el-select v-model="form.apparel" style="width: 120px">
              <el-option
                v-for="option in APPAREL_OPTIONS"
                :key="option"
                :label="option"
                :value="option"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="editingId" label="排序" class="is-compact">
            <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" />
          </el-form-item>
          <el-form-item label="上架" class="is-switch">
            <el-switch v-model="form.active" />
          </el-form-item>
        </div>

        <div class="catalog-form__media">
          <div v-if="!editingId && pendingUploads.length" class="catalog-pending">
            <article v-for="item in pendingUploads" :key="item.key" class="catalog-pending__item">
              <div class="catalog-pending__thumb">
                <img :src="item.preview" :alt="item.label" />
                <el-button
                  class="catalog-pending__remove"
                  text
                  type="danger"
                  :icon="Delete"
                  aria-label="移除这张图片"
                  @click="removePendingUpload(item.key)"
                />
              </div>
              <div class="catalog-pending__name">
                <el-input
                  v-model="item.label"
                  maxlength="32"
                  placeholder="素材名称"
                />
                <el-tooltip
                  :content="item.analysisStatus === 'error' ? '重新分析图片' : '使用 AI 分析图片标题'"
                  placement="top"
                >
                  <el-button
                    :icon="MagicStick"
                    circle
                    :loading="item.analysisStatus === 'queued' || item.analysisStatus === 'analyzing'"
                    :disabled="saving || compressing"
                    aria-label="AI 分析图片标题"
                    @click="queueImageAnalysis(item)"
                  />
                </el-tooltip>
              </div>
              <small
                class="catalog-pending__analysis"
                :class="{
                  'is-success': item.analysisStatus === 'done',
                  'is-error': item.analysisStatus === 'error',
                }"
                :title="item.analysisError || item.summary"
              >
                {{
                  item.analysisStatus === "queued"
                    ? "等待 AI 分析"
                    : item.analysisStatus === "analyzing"
                      ? "AI 正在识别图片"
                      : item.analysisStatus === "done"
                        ? "AI 已生成标题"
                        : item.analysisStatus === "error"
                          ? "AI 分析失败，已保留当前标题"
                          : item.summary
                }}
              </small>
            </article>
            <label v-if="remaining - pendingUploads.length > 0" class="catalog-pending__add">
              <el-icon><Plus /></el-icon>
              继续添加
              <input
                type="file"
                multiple
                :accept="IMAGE_ACCEPT"
                :disabled="compressing || saving"
                @change="onPickCreateFiles"
              />
            </label>
          </div>
          <label v-else v-loading="compressing" class="catalog-file" :class="{ 'has-image': Boolean(createPreview) }">
            <img v-if="createPreview" :src="createPreview" alt="" />
            <span v-else>
              <i><el-icon><Upload /></el-icon></i>
              <strong>{{ editingId ? "点击更换图片" : "点击或拖入图片" }}</strong>
              <small>PNG / JPG / WebP{{ editingId ? "" : "，可多选" }}</small>
            </span>
            <input
              type="file"
              :multiple="!editingId"
              :accept="IMAGE_ACCEPT"
              :disabled="compressing"
              @change="onPickCreateFiles"
            />
          </label>
        </div>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="sortOpen"
      :title="`调整${kindMeta.label}顺序`"
      subtitle="拖动缩略图排序，保存后同步到用户端"
      :icon="Rank"
      width="min(520px, 94vw)"
      nested-scroll
      panel-class="catalog-sort-dialog"
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
      <div v-if="!sortItems.length" class="catalog-sort-empty">
        <el-icon><Rank /></el-icon>
        <strong>当前分类没有素材</strong>
      </div>
      <draggable
        v-else
        v-model="sortItems"
        item-key="id"
        handle=".catalog-sort-handle"
        :animation="180"
        ghost-class="is-sort-ghost"
        drag-class="is-sort-dragging"
        class="catalog-sort-list"
      >
        <template #item="{ element: item, index }">
          <article class="catalog-sort-row">
            <span class="catalog-sort-index">{{ index + 1 }}</span>
            <button
              type="button"
              class="catalog-sort-handle catalog-sort-cover"
              :aria-label="`拖动第 ${index + 1} 项`"
            >
              <img :src="item.imageUrl" :alt="item.label" />
            </button>
          </article>
        </template>
      </draggable>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
.ecommerce-catalog-page {
  --library-border: var(--border);
  box-sizing: border-box;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 0;
  background: var(--bg);
}

.library-toolbar,
.library-toolbar__filters,
.library-toolbar__actions,
.library-toolbar__buttons,
.catalog-error,
.catalog-card__body header,
.catalog-card__footer,
.catalog-card__actions,
.catalog-compression-settings__heading,
.catalog-compression-settings__value,
.catalog-capacity > div {
  display: flex;
  align-items: center;
}

.library-toolbar {
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.library-toolbar__filters {
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.catalog-search {
  width: min(240px, 100%);
  flex: 1 1 180px;
  max-width: 260px;
}

.catalog-status-pills {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.catalog-status-pills__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  em {
    color: var(--ink-3);
    font-size: 11px;
    font-style: normal;
    font-weight: 700;
  }

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface);
  }

  &.is-active {
    background: var(--accent);
    color: var(--accent-on);

    em {
      color: color-mix(in srgb, var(--accent-on) 72%, transparent);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
}

.toolbar-select {
  width: 132px;
  flex: 0 0 auto;
}

.toolbar-select.is-short {
  width: 118px;
}

.library-toolbar__actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
}

.library-toolbar__buttons {
  flex: 0 0 auto;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  white-space: nowrap;

  :deep(.el-button) {
    margin: 0;
    height: 32px;
  }

  :deep(.el-button + .el-button) {
    margin-left: 0 !important;
  }
}

.items-workspace {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.category-rail {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 10px;
  border: 1px solid var(--library-border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.category-rail > button {
  display: grid;
  width: 100%;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin: 2px 0;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  color: var(--ink-2);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.category-rail > button i {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  font-style: normal;
}

.category-rail > button > span {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-rail > button > em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.category-rail > button:hover {
  background: var(--surface-2);
}

.category-rail > button.is-active {
  color: var(--accent-ink);
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent-ink);
}

.category-rail > button.is-active > em {
  color: var(--accent-ink);
}

.catalog-capacity {
  display: grid;
  gap: 8px;
  margin-top: auto;
  padding: 14px 8px 2px;
  border-top: 1px solid var(--border);
}

.catalog-capacity > div {
  justify-content: space-between;
  gap: 8px;
  color: var(--ink-3);
  font-size: 11px;
}

.catalog-capacity strong {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.catalog-content {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.catalog-content__scroll {
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px;
}

.catalog-error {
  justify-content: flex-start;
  gap: 12px;
  min-height: 180px;
  padding: 24px;
  color: var(--ink-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-card);
}

.catalog-error > div {
  display: grid;
  gap: 3px;
  margin-right: auto;
  min-width: 0;
}

.catalog-error span {
  color: var(--ink-3);
  font-size: 12px;
}

.catalog-feed {
  min-height: 240px;
}

.catalog-bulk-bar {
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
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(14px);
}

.catalog-bulk-bar.is-active {
  border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
}

.catalog-bulk-selection,
.catalog-bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.catalog-bulk-selection > span {
  padding-left: 9px;
  border-left: 1px solid var(--border);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.catalog-bulk-actions {
  margin-left: auto;
}

.catalog-bulk-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 12px;
}

.catalog-card {
  display: grid;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);
  box-sizing: border-box;
}

.catalog-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.catalog-card.is-selected {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}

.catalog-card.is-selection-mode .catalog-card__image {
  cursor: pointer;
}

.catalog-card.is-inactive .catalog-card__image img {
  opacity: 0.58;
  filter: saturate(0.65);
}

.catalog-card__image {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  background: var(--surface);
  cursor: zoom-in;
}

.catalog-card__image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.catalog-card__status {
  position: absolute;
  inset: 8px auto auto 8px;
  padding: 3px 8px;
  color: var(--ink-2);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(8px);
  font-size: 11px;
  font-weight: 650;
}

.catalog-card.is-selection-mode .catalog-card__status {
  left: 40px;
}

.catalog-card__select {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  padding: 4px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(8px);
}

.catalog-card__status.is-active {
  color: var(--success);
  background: color-mix(in srgb, var(--success-soft) 88%, transparent);
}

.catalog-card__replace {
  position: absolute;
  inset: 8px 8px auto auto;
  width: 30px;
  height: 30px;
  color: var(--ink) !important;
  background: color-mix(in srgb, var(--surface) 88%, transparent) !important;
  backdrop-filter: blur(8px);
}

.catalog-card__body {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px 8px;
}

.catalog-card__body header {
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.catalog-card__body strong {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-card__footer {
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  color: var(--ink-3);
  font-size: 12px;
}

.catalog-card__actions {
  margin-left: auto;
  gap: 0;

  .el-button + .el-button {
    margin-left: 0;
  }
}

.library-empty {
  display: grid;
  min-height: 280px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
}

.library-empty .el-icon {
  font-size: 28px;
}

.library-empty strong {
  color: var(--ink);
}

.catalog-compression-settings {
  display: grid;
  gap: 12px;
  padding: 2px;
}

.catalog-compression-settings__heading,
.catalog-compression-settings__value {
  justify-content: space-between;
  gap: 12px;
}

.catalog-compression-settings__heading strong {
  font-size: 13px;
  font-weight: 650;
}

.catalog-compression-settings__heading span,
.catalog-compression-settings__value span,
.catalog-compression-settings small {
  color: var(--ink-3);
  font-size: 11px;
}

.catalog-compression-settings__value strong {
  color: var(--accent-ink);
  font: 700 13px/1 ui-monospace, monospace;
}

.catalog-form {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.catalog-form.is-edit {
  grid-template-columns: 176px minmax(0, 1fr);
  align-items: start;
}

.catalog-form.is-edit .catalog-form__media {
  order: -1;
}

.catalog-form.has-files {
  flex: 1 1 auto;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
}

.catalog-form.has-files .catalog-pending {
  max-height: none;
  height: 100%;
}

.catalog-form__fields {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px 12px;
  min-width: 0;
}

.catalog-form__fields :deep(.el-form-item) {
  margin-bottom: 0;
}

.catalog-form__fields .is-name {
  flex: 1 1 220px;
  min-width: 0;
}

.catalog-title-input {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.catalog-title-input :deep(.el-input) {
  min-width: 0;
  flex: 1 1 auto;
}

.catalog-title-input :deep(.el-button) {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  margin: 0;
}

.catalog-edit-analysis {
  display: block;
  width: 100%;
  margin-top: 5px;
  color: var(--ink-3);
  font-size: 11px;
}

.catalog-edit-analysis.is-success {
  color: var(--success);
}

.catalog-edit-analysis.is-error {
  color: var(--danger);
}

.catalog-form__fields .is-compact,
.catalog-form__fields .is-switch {
  flex: 0 0 auto;
}

.catalog-form.is-edit .catalog-form__fields {
  display: grid;
  gap: 10px;
}

.catalog-form.is-edit .is-name,
.catalog-form.is-edit .is-compact,
.catalog-form.is-edit .is-switch {
  flex: none;
  width: 100%;
}

.catalog-form__count {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 32px;
  margin-right: auto;
  color: var(--ink-2);
  font-size: 13px;
}

.catalog-form__count strong {
  color: var(--ink);
  font-size: 20px;
  font-weight: 700;
}

.catalog-form__media {
  min-width: 0;
  min-height: 0;
}

.catalog-file,
.catalog-pending__add {
  position: relative;
  display: grid;
  width: 100%;
  place-items: center;
  overflow: hidden;
  color: var(--ink-2);
  border: 1px dashed var(--border-strong);
  border-radius: 16px;
  background: var(--surface-2);
  cursor: pointer;
}

.catalog-file {
  min-height: 168px;
}

.catalog-form.is-edit .catalog-file {
  min-height: 0;
  aspect-ratio: 4 / 5;
}

.catalog-file.has-image {
  background: var(--surface);
  border-style: solid;
  border-color: var(--border);
}

.catalog-file:hover,
.catalog-pending__add:hover {
  color: var(--ink);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface-2));
}

.catalog-file > span,
.catalog-pending__add {
  display: grid;
  justify-items: center;
  gap: 6px;
  font-size: 13px;
  text-align: center;
}

.catalog-file > span i {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 12px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  font-style: normal;
}

.catalog-file > span strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.catalog-file > span small,
.catalog-pending__add small {
  color: var(--ink-3);
  font-size: 12px;
}

.catalog-file img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.catalog-file input,
.catalog-pending__add input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.catalog-pending {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  align-content: start;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  max-height: min(480px, calc(100dvh - 280px));
  overflow-x: hidden;
  overflow-y: auto;
}

.catalog-pending__item {
  display: grid;
  grid-template-rows: auto auto auto;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
}

.catalog-pending__thumb {
  position: relative;
  overflow: hidden;
  aspect-ratio: 4 / 5;
  border-radius: 10px;
  background: var(--surface);
}

.catalog-pending__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.catalog-pending__remove {
  position: absolute;
  inset: 6px 6px auto auto;
  width: 28px;
  height: 28px;
  color: var(--ink) !important;
  background: color-mix(in srgb, var(--surface) 88%, transparent) !important;
  backdrop-filter: blur(8px);
}

.catalog-pending__name {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.catalog-pending__name :deep(.el-button) {
  width: 32px;
  height: 32px;
  margin: 0;
}

.catalog-pending__item small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-pending__analysis.is-success {
  color: var(--success);
}

.catalog-pending__analysis.is-error {
  color: var(--danger);
}

.catalog-pending__add {
  min-height: 0;
  aspect-ratio: 4 / 5;
  align-content: center;
}

.catalog-sort-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 10px;
  max-height: min(60vh, 520px);
  overflow: auto;
  padding: 4px 2px;
}

.catalog-sort-empty {
  display: grid;
  min-height: 180px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
}

.catalog-sort-row {
  display: grid;
  gap: 6px;
  justify-items: center;
  min-width: 0;
}

.catalog-sort-handle {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
}

.catalog-sort-handle:active {
  cursor: grabbing;
}

.catalog-sort-index {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.catalog-sort-cover {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
}

.catalog-sort-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.is-sort-ghost {
  opacity: 0.35;
}

.is-sort-ghost .catalog-sort-cover {
  border-style: dashed;
}

.is-sort-dragging .catalog-sort-cover {
  box-shadow: var(--shadow-md);
}

@media (max-width: 1100px) {
  .items-workspace {
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .category-rail {
    display: flex;
    min-height: auto;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .category-rail > button {
    width: auto;
    min-width: 132px;
    flex: 0 0 auto;
  }

  .catalog-capacity {
    display: none;
  }
}

@media (max-width: 1200px) {
  .catalog-pending {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  }
}

@media (max-width: 900px) {
  .catalog-form.is-edit {
    grid-template-columns: 1fr;
  }

  .catalog-form.is-edit .catalog-form__media {
    order: 0;
  }

  .catalog-form.is-edit .catalog-file {
    max-height: 220px;
  }
}

@media (max-width: 720px) {
  .catalog-search,
  .toolbar-select {
    width: 100%;
    max-width: none;
  }

  .catalog-grid {
    grid-template-columns: repeat(auto-fill, minmax(166px, 1fr));
  }
}
</style>
