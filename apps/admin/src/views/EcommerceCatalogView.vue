<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Delete,
  Goods,
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

const APPAREL_OPTIONS = ["上装", "下装", "全身"] as const;
const MAX_PER_KIND = 40;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
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

const sortOpen = ref(false);
const sortQuery = ref("");
const sortItems = ref<CatalogItem[]>([]);
const sortSnapshot = ref<string[]>([]);
const sortSaving = ref(false);
const previewOpen = ref(false);
const previewIndex = ref(0);
const previewUrls = ref<string[]>([]);

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
const remaining = computed(() =>
  Math.max(0, MAX_PER_KIND - items.value.length),
);
const dialogTitle = computed(() =>
  editingId.value ? `编辑${kindMeta.value.label}` : `上传${kindMeta.value.label}`,
);
const dialogConfirmText = computed(() => {
  if (editingId.value) return "保存素材";
  if (pendingUploads.value.length > 1) return `上传 ${pendingUploads.value.length} 张`;
  return "保存素材";
});
const hasFilters = computed(
  () =>
    Boolean(search.value) ||
    statusFilter.value !== "all" ||
    sortMode.value !== "manual",
);
const sortIsSearching = computed(() => Boolean(sortQuery.value.trim()));
const visibleSortItems = computed(() => {
  const keyword = sortQuery.value.trim().toLocaleLowerCase();
  if (!keyword) return sortItems.value;
  return sortItems.value.filter((item) =>
    [item.label, item.apparel].some((value) =>
      String(value || "")
        .toLocaleLowerCase()
        .includes(keyword),
    ),
  );
});
const sortDirty = computed(
  () =>
    sortItems.value.map((item) => item.id).join("|") !== sortSnapshot.value.join("|"),
);

function revokePreview(url = createPreview.value) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  if (url === createPreview.value) createPreview.value = "";
}

function revokePendingUploads() {
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
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "素材读取失败";
  } finally {
    loading.value = false;
  }
}

function setKind(value: CatalogKind) {
  if (kind.value === value) return;
  kind.value = value;
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  sortMode.value = "manual";
}

function formatItemTime(value?: string) {
  if (!value) return "暂无更新时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无更新时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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
  revokePendingUploads();
  revokePreview();
  createPreview.value = item.imageUrl;
  dialogOpen.value = true;
}

function describeCompression(result: CatalogCompressionResult) {
  if (!result.compressed) {
    return `${formatCatalogBytes(result.originalBytes)}（未超过 1MB，保留原图）`;
  }
  const percent = Math.max(1, Math.round(result.ratio * 100));
  return `${formatCatalogBytes(result.originalBytes)} → ${formatCatalogBytes(result.compressedBytes)}（${percent}%）`;
}

function notifyCompression(result: CatalogCompressionResult) {
  if (!result.compressed) {
    ElMessage.info("图片未超过 1MB，已保留原图");
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
          },
        ];
        compressionSummary.value = describeCompression(result);
        notifyCompression(result);
        return;
      }
      pendingUploads.value.push({
        key: nextPendingKey(),
        file: result.file,
        preview,
        label:
          pendingUploads.value.length === 0 && form.label.trim()
            ? form.label.trim()
            : labelFromFilename(file.name),
        summary: describeCompression(result),
      });
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
  }
}

async function uploadMultipart(url: string, method: "POST" | "PUT", body: FormData) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    body,
  });
  const payload = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: CatalogItem; error?: string }
    | null;
  if (!res.ok || !payload?.success) {
    throw new Error(payload?.error || `上传失败（HTTP ${res.status}）`);
  }
  return payload.data;
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
  if (saving.value || compressing.value) return;
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

function openPreview(item: CatalogItem, list = visibleItems.value) {
  const urls = list.map((entry) => entry.imageUrl).filter(Boolean);
  const index = list.findIndex((entry) => entry.id === item.id);
  if (!item.imageUrl || !urls.length) return;
  previewUrls.value = urls;
  previewIndex.value = Math.max(0, index);
  previewOpen.value = true;
}

function openSortDialog() {
  sortQuery.value = "";
  sortItems.value = items.value
    .slice()
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "zh-CN"));
  sortSnapshot.value = sortItems.value.map((item) => item.id);
  sortOpen.value = true;
}

function moveSortItem(index: number, destination: number) {
  if (sortIsSearching.value) return;
  if (index < 0 || index >= sortItems.value.length) return;
  const target = Math.max(0, Math.min(destination, sortItems.value.length - 1));
  if (target === index) return;
  const [item] = sortItems.value.splice(index, 1);
  if (item) sortItems.value.splice(target, 0, item);
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
          placeholder="搜索名称、品类或排序"
        />
        <el-select v-model="statusFilter" class="toolbar-select is-short" aria-label="上架状态">
          <el-option label="全部状态" value="all" />
          <el-option label="已上架" value="active" />
          <el-option label="已下架" value="inactive" />
        </el-select>
        <el-select v-model="sortMode" class="toolbar-select is-short" aria-label="素材排序">
          <el-option label="手动排序" value="manual" />
          <el-option label="最近更新" value="newest" />
          <el-option label="按名称" value="name" />
        </el-select>
        <el-button v-if="hasFilters" @click="clearFilters">重置</el-button>
        <span class="catalog-result-count">{{ visibleItems.length }} / {{ items.length }} 张</span>
      </div>
      <div class="library-toolbar__actions">
        <el-popover placement="bottom-end" :width="292" trigger="click">
          <template #reference>
            <el-button :icon="Setting">压缩 {{ compressionPercent }}%</el-button>
          </template>
          <div class="catalog-compression-settings">
            <div class="catalog-compression-settings__heading">
              <strong>上传压缩</strong>
              <span>超过 1MB 时生效</span>
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
        <el-button :icon="Rank" :disabled="!items.length" @click="openSortDialog">排序</el-button>
        <div class="library-toolbar__buttons">
          <el-button type="primary" :icon="Plus" :disabled="remaining <= 0" @click="openCreate">
            上传
          </el-button>
          <el-button :icon="Refresh" :loading="loading" @click="loadItems">刷新</el-button>
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
          <header class="catalog-heading">
            <div>
              <strong>{{ kindMeta.label }}</strong>
              <span>{{ activeCount }} 张已上架</span>
            </div>
            <p>{{ kindMeta.hint }}</p>
          </header>

          <div v-if="loadError" class="catalog-error">
            <el-icon><ShoppingBag /></el-icon>
            <div>
              <strong>素材读取失败</strong>
              <span>{{ loadError }}</span>
            </div>
            <el-button @click="loadItems">重新加载</el-button>
          </div>

          <div v-else v-loading="loading" class="catalog-feed">
            <div v-if="visibleItems.length" class="catalog-grid">
              <article
                v-for="item in visibleItems"
                :key="item.id"
                class="catalog-card"
                :class="{ 'is-inactive': !item.active }"
              >
                <div
                  class="catalog-card__image"
                  role="button"
                  tabindex="0"
                  :aria-label="`查看${item.label}大图`"
                  @click="openPreview(item)"
                  @keydown.enter.prevent="openPreview(item)"
                >
                  <img :src="item.imageUrl" :alt="item.label" />
                  <span class="catalog-card__status" :class="{ 'is-active': item.active }">
                    {{ item.active ? "已上架" : "已下架" }}
                  </span>
                  <el-tooltip :content="`更换${kindMeta.label}图片`" placement="top">
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
                      @change="toggleActive(item, Boolean($event))"
                    />
                  </header>
                  <div class="catalog-card__meta">
                    <span v-if="item.apparel">{{ item.apparel }}</span>
                    <small>{{ formatItemTime(item.updatedAt || item.createdAt) }}</small>
                    <div class="catalog-card__actions">
                      <el-button link type="primary" @click="openEdit(item)">编辑</el-button>
                      <el-button link type="danger" @click="removeItem(item)">删除</el-button>
                    </div>
                  </div>
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
      :subtitle="editingId ? kindMeta.hint : `可一次选择多张，当前分类还能上传 ${remaining} 张`"
      :icon="ShoppingBag"
      :width="editingId ? '520px' : 'min(1360px, 96vw)'"
      :nested-scroll="!editingId"
      panel-class="catalog-upload-dialog"
      :confirm-loading="saving"
      :confirm-disabled="saving || compressing"
      :confirm-text="dialogConfirmText"
      :footer-hint="
        uploadProgress.total > 1
          ? `正在上传 ${uploadProgress.current} / ${uploadProgress.total}`
          : compressionSummary
      "
      @confirm="saveItem"
    >
      <el-form
        label-position="top"
        class="catalog-form"
        :class="{ 'is-create': !editingId }"
      >
        <div class="catalog-form__meta">
          <el-form-item
            v-if="editingId || !pendingUploads.length"
            :label="`${kindMeta.label}名称`"
            required
          >
            <el-input
              v-model="form.label"
              maxlength="32"
              show-word-limit
              :placeholder="`例如：${kind === 'model' ? '东亚女性' : kind === 'scene' ? '纯色棚拍' : kind === 'hand' ? '自然肤色右手' : '白色衬衫'}`"
            />
          </el-form-item>
          <el-form-item v-else :label="`已选${kindMeta.label}`">
            <div class="catalog-form__count">
              <strong>{{ pendingUploads.length }}</strong>
              <span>张，还可再传 {{ Math.max(0, remaining - pendingUploads.length) }} 张</span>
            </div>
          </el-form-item>
          <el-form-item v-if="kind === 'garment'" label="衣服类型">
            <el-select v-model="form.apparel">
              <el-option
                v-for="option in APPAREL_OPTIONS"
                :key="option"
                :label="option"
                :value="option"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="editingId" label="排序">
            <el-input-number v-model="form.sort" :min="0" :max="9999" />
          </el-form-item>
          <el-form-item label="上架">
            <el-switch v-model="form.active" />
          </el-form-item>
        </div>
        <el-form-item :label="editingId ? '更换图片（可选）' : '图片'" required>
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
              <el-input v-model="item.label" maxlength="32" placeholder="素材名称" />
              <small>{{ item.summary }}</small>
            </article>
            <label v-if="remaining - pendingUploads.length > 0" class="catalog-pending__add">
              <el-icon><Plus /></el-icon>
              继续添加
              <small>还可再选 {{ remaining - pendingUploads.length }} 张</small>
              <input
                type="file"
                multiple
                :accept="IMAGE_ACCEPT"
                :disabled="compressing || saving"
                @change="onPickCreateFiles"
              />
            </label>
          </div>
          <label v-else v-loading="compressing" class="catalog-file">
            <img v-if="createPreview" :src="createPreview" alt="" />
            <span v-else>
              <el-icon :size="20"><Upload /></el-icon>
              {{ editingId ? "选择 PNG / JPG / WebP" : "选择一张或多张 PNG / JPG / WebP" }}
              <small>超过 1MB 时转 WebP，目标 {{ compressionPercent }}%</small>
            </span>
            <input
              type="file"
              :multiple="!editingId"
              :accept="IMAGE_ACCEPT"
              :disabled="compressing"
              @change="onPickCreateFiles"
            />
          </label>
        </el-form-item>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="sortOpen"
      :title="`${kindMeta.label}排序`"
      subtitle="拖拽调整当前分类顺序，保存后立即同步到用户端"
      :icon="Rank"
      width="min(720px, 94vw)"
      nested-scroll
      panel-class="catalog-sort-dialog"
      :close-on-click-modal="!sortDirty"
      confirm-text="保存顺序"
      :confirm-loading="sortSaving"
      :confirm-disabled="!sortDirty || sortIsSearching || !sortItems.length"
      @confirm="saveSortOrder"
    >
      <template #footer>
        <div class="admin-dialog__footer">
          <span class="admin-dialog__hint">
            {{
              sortIsSearching
                ? "搜索时不能拖拽，清除搜索后再保存顺序"
                : sortDirty
                  ? "当前顺序有改动，尚未保存"
                  : "当前顺序已保存"
            }}
          </span>
          <div class="admin-dialog__actions">
            <el-button :disabled="sortSaving" @click="closeSortDialog">取消</el-button>
            <el-button
              type="primary"
              :loading="sortSaving"
              :disabled="!sortDirty || sortIsSearching || !sortItems.length"
              @click="saveSortOrder"
            >
              保存顺序
            </el-button>
          </div>
        </div>
      </template>
      <div class="catalog-sort-panel">
        <el-input
          v-model="sortQuery"
          clearable
          :prefix-icon="Search"
          placeholder="搜索名称，快速定位目标"
        />
        <div v-if="!sortItems.length" class="catalog-sort-empty">
          <el-icon><Rank /></el-icon>
          <strong>当前分类没有素材</strong>
        </div>
        <div v-else-if="sortIsSearching" class="catalog-sort-list">
          <article v-for="item in visibleSortItems" :key="item.id" class="catalog-sort-row is-search-result">
            <span class="catalog-sort-index">·</span>
            <span class="catalog-sort-cover">
              <img :src="item.imageUrl" :alt="item.label" />
            </span>
            <span class="catalog-sort-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.active ? "已上架" : "已下架" }}{{ item.apparel ? ` · ${item.apparel}` : "" }}</small>
            </span>
          </article>
          <div v-if="!visibleSortItems.length" class="catalog-sort-empty">
            <strong>没有匹配的素材</strong>
          </div>
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
              <button type="button" class="catalog-sort-handle" title="拖动排序" aria-label="拖动排序">
                <el-icon><Rank /></el-icon>
              </button>
              <span class="catalog-sort-index">{{ index + 1 }}</span>
              <span class="catalog-sort-cover">
                <img :src="item.imageUrl" :alt="item.label" />
              </span>
              <span class="catalog-sort-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ item.active ? "已上架" : "已下架" }}{{ item.apparel ? ` · ${item.apparel}` : "" }}</small>
              </span>
              <span class="catalog-sort-actions">
                <button type="button" title="置顶" :disabled="index === 0" @click="moveSortItem(index, 0)">⇈</button>
                <button type="button" title="上移" :disabled="index === 0" @click="moveSortItem(index, index - 1)">↑</button>
                <button type="button" title="下移" :disabled="index === sortItems.length - 1" @click="moveSortItem(index, index + 1)">↓</button>
                <button
                  type="button"
                  title="置底"
                  :disabled="index === sortItems.length - 1"
                  @click="moveSortItem(index, sortItems.length - 1)"
                >
                  ⇊
                </button>
              </span>
            </article>
          </template>
        </draggable>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
.ecommerce-catalog-page {
  --library-border: var(--border);
  box-sizing: border-box;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 16px 18px;
  background: var(--bg);
}

.library-toolbar,
.library-toolbar__filters,
.library-toolbar__actions,
.library-toolbar__buttons,
.catalog-heading > div,
.catalog-error,
.catalog-card__body header,
.catalog-card__meta,
.catalog-card__actions,
.catalog-compression-settings__heading,
.catalog-compression-settings__value,
.catalog-capacity > div,
.catalog-sort-row,
.catalog-sort-actions {
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
  width: min(260px, 100%);
  flex: 1 1 180px;
  max-width: 280px;
}

.toolbar-select {
  width: 132px;
  flex: 0 0 auto;
}

.toolbar-select.is-short {
  width: 118px;
}

.catalog-result-count {
  color: var(--ink-3);
  font: 500 11px/1 ui-monospace, monospace;
  white-space: nowrap;
}

.library-toolbar__actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
}

.library-toolbar__buttons {
  flex: 0 0 auto;
  gap: 8px;
  white-space: nowrap;
}

.library-toolbar__buttons :deep(.el-button) {
  margin-left: 0 !important;
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
  border-radius: 16px;
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
  color: var(--ink-2);
  font: 600 11px/1 ui-monospace, monospace;
}

.catalog-content {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 16px;
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

.catalog-heading {
  display: grid;
  gap: 4px;
  min-width: 0;
  margin-bottom: 14px;
}

.catalog-heading > div {
  gap: 8px;
  min-width: 0;
}

.catalog-heading strong {
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-heading span {
  flex: 0 0 auto;
  padding: 3px 7px;
  color: var(--accent-ink);
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 11px;
  font-weight: 650;
}

.catalog-heading p {
  margin: 0;
  color: var(--ink-2);
  font-size: 12px;
}

.catalog-error {
  justify-content: flex-start;
  gap: 12px;
  min-height: 180px;
  padding: 24px;
  color: var(--ink-2);
  border: 1px dashed var(--border-strong);
  border-radius: 14px;
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

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 12px;
}

.catalog-card {
  display: grid;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 14px;
  background: var(--surface);
  box-sizing: border-box;
}

.catalog-card:hover {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--library-border));
  box-shadow: var(--shadow-sm);
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
  background: var(--surface-2);
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
  padding: 3px 7px;
  color: var(--ink-2);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(8px);
  font-size: 10px;
  font-weight: 650;
}

.catalog-card__status.is-active {
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent-soft) 88%, transparent);
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
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.catalog-card__body header {
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.catalog-card__body strong {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-card__meta {
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  color: var(--ink-3);
}

.catalog-card__meta > span {
  flex: 0 0 auto;
  padding: 2px 6px;
  color: var(--ink-2);
  border-radius: 6px;
  background: var(--surface-3);
  font-size: 10px;
}

.catalog-card__meta small {
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-card__actions {
  margin-left: auto;
  gap: 0;
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
  gap: 4px;
  min-width: 0;
}

.catalog-form.is-create {
  flex: 1 1 auto;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
}

.catalog-form__meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.catalog-form.is-create .catalog-form__meta {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 16px;
}

.catalog-form__meta :deep(.el-form-item) {
  margin-bottom: 8px;
}

.catalog-form__count {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 32px;
  color: var(--ink-2);
  font-size: 13px;
}

.catalog-form__count strong {
  color: var(--accent-ink);
  font: 700 18px/1 ui-monospace, monospace;
}

.catalog-form.is-create :deep(.el-form-item:last-child) {
  display: flex;
  min-height: 0;
  flex-direction: column;
  margin-bottom: 0;
}

.catalog-form.is-create :deep(.el-form-item:last-child .el-form-item__content) {
  flex: 1 1 auto;
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
  border-radius: 12px;
  background: var(--surface-2);
  cursor: pointer;
}

.catalog-file {
  height: 220px;
}

.catalog-form.is-create .catalog-file {
  height: min(320px, 42vh);
}

.catalog-file:hover,
.catalog-pending__add:hover {
  color: var(--ink);
  border-color: var(--accent);
}

.catalog-file > span,
.catalog-pending__add {
  gap: 6px;
  font-size: 13px;
}

.catalog-file > span {
  display: grid;
  place-items: center;
}

.catalog-file > span small,
.catalog-pending__add small {
  color: var(--ink-3);
  font-size: 11px;
}

.catalog-file img {
  width: 100%;
  height: 100%;
  object-fit: contain;
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  max-height: min(560px, calc(100dvh - 280px));
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
}

.catalog-pending__item {
  display: grid;
  grid-template-rows: auto auto auto;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.catalog-pending__thumb {
  position: relative;
  overflow: hidden;
  aspect-ratio: 4 / 5;
  border-radius: 8px;
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

.catalog-pending__item small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-pending__add {
  min-height: 0;
  aspect-ratio: 4 / 5;
  align-content: center;
  justify-items: center;
  text-align: center;
}

.catalog-sort-panel {
  display: grid;
  height: 100%;
  flex: 1 1 auto;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
}

.catalog-sort-list {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
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
  grid-template-columns: 32px 32px 56px minmax(0, 1fr) auto;
  gap: 10px;
  min-width: 0;
  min-height: 68px;
  margin-bottom: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.catalog-sort-row.is-search-result {
  grid-template-columns: 32px 56px minmax(0, 1fr);
}

.catalog-sort-row.is-sort-ghost,
.is-sort-ghost .catalog-sort-row {
  opacity: 0.32;
}

.catalog-sort-handle {
  display: grid;
  width: 32px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-3);
  cursor: grab;
}

.catalog-sort-handle:active {
  cursor: grabbing;
}

.catalog-sort-index {
  color: var(--ink-3);
  font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: center;
}

.catalog-sort-cover {
  display: grid;
  width: 56px;
  height: 50px;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-2);
}

.catalog-sort-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.catalog-sort-copy {
  min-width: 0;
}

.catalog-sort-copy strong,
.catalog-sort-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-sort-copy strong {
  font-size: 13px;
}

.catalog-sort-copy small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 10px;
}

.catalog-sort-actions {
  gap: 4px;
}

.catalog-sort-actions button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
}

.catalog-sort-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.catalog-sort-actions button:disabled {
  opacity: 0.28;
  cursor: not-allowed;
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .catalog-form.is-create .catalog-form__meta,
  .catalog-pending {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .ecommerce-catalog-page {
    padding: 12px;
  }

  .catalog-form.is-create .catalog-form__meta,
  .catalog-pending {
    grid-template-columns: minmax(0, 1fr);
  }

  .library-toolbar__actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .catalog-search,
  .toolbar-select {
    width: 100%;
    max-width: none;
  }

  .catalog-grid {
    grid-template-columns: repeat(auto-fill, minmax(166px, 1fr));
  }

  .catalog-sort-row {
    grid-template-columns: 32px 32px minmax(0, 1fr);
  }

  .catalog-sort-cover,
  .catalog-sort-actions {
    display: none;
  }
}
</style>
