<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Delete, Edit, Plus, Upload } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";

import AdminDialog from "@/components/AdminDialog.vue";
import { request } from "@/request";

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

const loading = ref(false);
const saving = ref(false);
const items = ref<TemplateItem[]>([]);
const dialogOpen = ref(false);
const editingId = ref("");
const document = ref<CanvasDocument | null>(null);
const fileName = ref("");
const form = reactive({
  slug: "",
  title: "",
  category: "industry",
  categoryLabel: "行业模板",
  industry: "",
  summary: "",
  platforms: "",
  deliverables: "",
  accent: "#6d5cff",
  sort: 0,
  enabled: true,
});
const dialogTitle = computed(() => (editingId.value ? "编辑画布模板" : "上传画布模板"));

function splitItems(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function load() {
  loading.value = true;
  try {
    const data = await request<{ items: TemplateItem[] }>("/api/v1/admin/canvas-workflow-templates");
    items.value = data.items || [];
  } finally {
    loading.value = false;
  }
}

function resetForm(item?: TemplateItem) {
  editingId.value = item?.id || "";
  form.slug = item?.slug || "";
  form.title = item?.title || "";
  form.category = item?.category || "industry";
  form.categoryLabel = item?.categoryLabel || "行业模板";
  form.industry = item?.industry || "";
  form.summary = item?.summary || "";
  form.platforms = item?.platforms?.join("，") || "";
  form.deliverables = item?.deliverables?.join("，") || "";
  form.accent = item?.accent || "#6d5cff";
  form.sort = item?.sort || 0;
  form.enabled = item?.enabled ?? true;
  document.value = null;
  fileName.value = "";
  dialogOpen.value = true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asTemplateItem(value: unknown): TemplateItem {
  return value as TemplateItem;
}

function extractDocument(value: unknown): CanvasDocument {
  const root = asRecord(value);
  const projects = Array.isArray(root.projects) ? root.projects : [];
  const firstProject = projects.length ? asRecord(asRecord(projects[0]).project) : {};
  const candidate = Object.keys(firstProject).length ? firstProject : asRecord(root.document || root.project || root);
  const version = Object.keys(firstProject).length ? root.version : candidate.version;
  if (version !== 3) throw new Error("只支持画布 v3 JSON");
  const nodes = candidate.nodes;
  const connections = candidate.connections || candidate.edges || [];
  if (!Array.isArray(nodes) || nodes.length === 0 || !Array.isArray(connections)) {
    throw new Error("未找到有效的画布节点与连线");
  }
  return {
    version: 3,
    nodes,
    connections,
    backgroundMode: typeof candidate.backgroundMode === "string" ? candidate.backgroundMode : "lines",
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
    if (!form.slug) {
      form.slug = form.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
    }
    ElMessage.success(`已读取 ${document.value.nodes.length} 个节点`);
  } catch (error) {
    document.value = null;
    fileName.value = "";
    ElMessage.error(error instanceof Error ? error.message : "模板文件读取失败");
  }
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
    await request(
      editingId.value
        ? `/api/v1/admin/canvas-workflow-templates/${editingId.value}`
        : "/api/v1/admin/canvas-workflow-templates",
      { method: editingId.value ? "PATCH" : "POST", body },
    );
    dialogOpen.value = false;
    ElMessage.success(editingId.value ? "模板已更新" : "模板已上传");
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(item: TemplateItem) {
  await request(`/api/v1/admin/canvas-workflow-templates/${item.id}`, {
    method: "PATCH",
    body: { enabled: !item.enabled },
  });
  item.enabled = !item.enabled;
  ElMessage.success(item.enabled ? "模板已发布" : "模板已下架");
}

async function remove(item: TemplateItem) {
  await ElMessageBox.confirm(`删除模板“${item.title}”？`, "删除模板", { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" });
  await request(`/api/v1/admin/canvas-workflow-templates/${item.id}`, { method: "DELETE" });
  ElMessage.success("模板已删除");
  await load();
}

onMounted(load);
</script>

<template>
  <section class="page-shell">
    <div class="page-actions">
      <el-button type="primary" :icon="Plus" @click="resetForm()">上传模板</el-button>
    </div>

    <el-table v-loading="loading" :data="items" row-key="id" class="template-table">
      <el-table-column label="模板" min-width="280">
        <template #default="{ row }">
          <div class="template-name">
            <span class="accent" :style="{ background: row.accent }" />
            <div><strong>{{ row.title }}</strong><small>{{ row.slug }}</small></div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="categoryLabel" label="分类" width="140" />
      <el-table-column prop="industry" label="行业" width="150" />
      <el-table-column prop="nodeCount" label="节点" width="90" align="right" />
      <el-table-column prop="sort" label="排序" width="90" align="right" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? "已发布" : "已下架" }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="toggleEnabled(asTemplateItem(row))">{{ row.enabled ? "下架" : "发布" }}</el-button>
          <el-button size="small" :icon="Edit" @click="resetForm(asTemplateItem(row))">编辑</el-button>
          <el-button size="small" type="danger" plain :icon="Delete" @click="remove(asTemplateItem(row))" />
        </template>
      </el-table-column>
    </el-table>

    <AdminDialog v-model="dialogOpen" :title="dialogTitle" subtitle="模板正文仅在用户点击使用时下载" :icon="Upload" width="720px" confirm-text="保存模板" :confirm-loading="saving" @confirm="submit">
      <el-form label-position="top" @submit.prevent="submit">
        <div class="form-grid">
          <el-form-item label="模板标识" required><el-input v-model="form.slug" placeholder="如 ecommerce-main-image" /></el-form-item>
          <el-form-item label="模板名称" required><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="分类标识" required><el-input v-model="form.category" placeholder="industry" /></el-form-item>
          <el-form-item label="分类名称" required><el-input v-model="form.categoryLabel" placeholder="行业模板" /></el-form-item>
          <el-form-item label="行业"><el-input v-model="form.industry" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" :min="-9999" :max="9999" controls-position="right" /></el-form-item>
        </div>
        <el-form-item label="简介"><el-input v-model="form.summary" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
        <div class="form-grid">
          <el-form-item label="平台（逗号分隔）"><el-input v-model="form.platforms" /></el-form-item>
          <el-form-item label="交付物（逗号分隔）"><el-input v-model="form.deliverables" /></el-form-item>
          <el-form-item label="强调色"><el-color-picker v-model="form.accent" /><span class="color-value">{{ form.accent }}</span></el-form-item>
          <el-form-item label="发布状态"><el-switch v-model="form.enabled" active-text="已发布" inactive-text="已下架" /></el-form-item>
        </div>
        <el-form-item :label="editingId ? '替换模板文件（可选）' : '模板文件'" required>
          <label class="file-picker">
            <el-icon><Upload /></el-icon><span>{{ fileName || "选择 JSON 文件" }}</span>
            <input type="file" accept="application/json,.json" @change="onFileChange" />
          </label>
          <small v-if="document" class="file-meta">已读取 {{ document.nodes.length }} 个节点、{{ document.connections.length }} 条连线</small>
        </el-form-item>
      </el-form>
    </AdminDialog>
  </section>
</template>

<style scoped>
.page-shell { display: grid; gap: 18px; }
.page-actions { display: flex; justify-content: flex-end; }
.template-table { width: 100%; }
.template-name { display: flex; align-items: center; gap: 12px; }
.template-name .accent { width: 5px; height: 38px; border-radius: 3px; }
.template-name div { display: grid; gap: 3px; }
.template-name small { color: var(--text-muted); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.file-picker { display: flex; align-items: center; gap: 8px; min-height: 40px; width: 100%; padding: 0 12px; border: 1px dashed var(--border); cursor: pointer; }
.file-picker:hover { border-color: var(--accent); }
.file-picker input { display: none; }
.file-meta { display: block; margin-top: 6px; color: var(--text-muted); }
.color-value { margin-left: 10px; color: var(--text-muted); font-family: monospace; }
</style>
