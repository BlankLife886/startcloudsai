<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  Delete,
  EditPen,
  Files,
  Picture,
  Plus,
  Refresh,
  Search,
  Upload,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";

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
const pendingCover = ref<File | null>(null);
const previewUrl = ref("");
const coverInputRef = ref<HTMLInputElement | null>(null);
const coverPreviewOpen = ref(false);
const coverPreviewIndex = ref(0);
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
  } catch (error) {
    items.value = [];
    loadError.value = error instanceof Error ? error.message : "模板读取失败";
  } finally {
    loading.value = false;
  }
}

function resetForm(item?: TemplateItem) {
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

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    document.value = extractDocument(JSON.parse(await file.text()));
    fileName.value = file.name;
    if (!form.title) form.title = file.name.replace(/\.json$/i, "");
    if (!form.slug) form.slug = slugFromTitle(form.title);
    ElMessage.success(
      `已读取 ${document.value.nodes.length} 个节点、${document.value.connections.length} 条连线`,
    );
  } catch (error) {
    document.value = null;
    fileName.value = "";
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
    ElMessage.warning("请选择模板 JSON 文件");
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
    const saved = await request<TemplateItem>(
      editingId.value
        ? `/api/v1/admin/canvas-workflow-templates/${editingId.value}`
        : "/api/v1/admin/canvas-workflow-templates",
      { method: editingId.value ? "PATCH" : "POST", body, silent: true },
    );
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

onMounted(load);

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
        <div v-if="visibleItems.length" class="templates-grid">
          <article
            v-for="item in visibleItems"
            :key="item.id"
            class="template-card"
            :class="{ 'is-off': !item.enabled }"
            :style="{ '--template-accent': item.accent || '#6d5cff' }"
          >
            <div
              class="template-card__visual"
              :class="{ 'has-cover': Boolean(item.coverUrl) }"
              :role="item.coverUrl ? 'button' : undefined"
              :tabindex="item.coverUrl ? 0 : undefined"
              :aria-label="item.coverUrl ? `查看${item.title}封面` : undefined"
              @click="openCoverPreview(item)"
              @keydown.enter.prevent="openCoverPreview(item)"
            >
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
                  @change="toggleEnabled(item, Boolean($event))"
                />
              </label>
              <div class="template-card__actions">
                <el-button :icon="EditPen" @click="resetForm(item)">
                  编辑
                </el-button>
                <el-button
                  type="danger"
                  plain
                  :icon="Delete"
                  aria-label="删除模板"
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
      :footer-hint="pendingCover ? '已选择新封面，保存时一并上传' : ''"
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
          </el-form-item>
          <el-form-item
            :label="editingId ? '替换模板文件（可选）' : '模板文件'"
            required
          >
            <label class="file-picker">
              <el-icon><Upload /></el-icon>
              <span>{{ fileName || "选择 JSON 文件" }}</span>
              <input
                type="file"
                accept="application/json,.json"
                @change="onFileChange"
              />
            </label>
            <small v-if="document" class="file-meta">
              已读取 {{ document.nodes.length }} 个节点、{{
                document.connections.length
              }}
              条连线
            </small>
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
  margin-top: 6px;
  color: var(--ink-3);
  font-size: 12px;
}

.cover-picker {
  position: relative;
  width: 100%;
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

@media (prefers-reduced-motion: reduce) {
  .template-card {
    transition: none;
  }
}
</style>
