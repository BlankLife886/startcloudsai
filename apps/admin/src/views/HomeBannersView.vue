<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ArrowRight, Delete, EditPen, Picture, Plus, Refresh, Search, Upload, View } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AdminDialog from "@/components/AdminDialog.vue";
import AdminListShell from "@/components/AdminListShell.vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";
import { formatTime } from "@/utils";

interface Banner {
  id?: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  linkUrl: string;
  buttonText: string;
  newTab: boolean;
  active: boolean;
  sortOrder: number;
  durationMs: number;
  startsAt: string | null;
  endsAt: string | null;
}

type BannerState = "展示中" | "待上线" | "已结束" | "已下架";

const defaults = (): Banner => ({
  title: "",
  subtitle: "",
  imageUrl: "",
  linkUrl: "",
  buttonText: "",
  newTab: false,
  active: true,
  sortOrder: 0,
  durationMs: 5000,
  startsAt: null,
  endsAt: null,
});

const items = ref<Banner[]>([]);
const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const visible = ref(false);
const error = ref("");
const query = ref("");
const status = ref("all");
const busyId = ref("");
const page = ref(1);
const pageSize = 10;
const editingId = ref<string | undefined>();
const fileInput = ref<HTMLInputElement>();
const form = reactive<Banner>(defaults());
const uploadError = ref("");
const saveError = ref("");
const previewMode = ref<"banner" | "original">("banner");
const previewLoading = ref(false);
const previewFailed = ref(false);
const imageWidth = ref(0);
const imageHeight = ref(0);
let uploadController: AbortController | null = null;
let editorSession = 0;

const previewURL = computed(() => {
  const value = form.imageUrl.trim();
  if (!value || value.startsWith("//") || /[\\\s]/.test(value)) return "";
  try {
    const url = new URL(value, window.location.origin);
    return (value.startsWith("/") || /^https?:\/\//i.test(value)) && !url.username && !url.password
      ? value
      : "";
  } catch {
    return "";
  }
});
const hasPreviewCopy = computed(() => Boolean(form.title.trim() || form.subtitle.trim() || form.linkUrl.trim()));
const previewStatus = computed(() => state(form));
const durationSeconds = computed({
  get: () => form.durationMs / 1000,
  set: (value: number | undefined) => {
    form.durationMs = value == null ? 5000 : Math.round(value * 1000);
  },
});

function cancelUpload() {
  uploadController?.abort();
  uploadController = null;
  uploading.value = false;
}

function onPreviewLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  if (image.getAttribute("src") !== previewURL.value) return;
  imageWidth.value = image.naturalWidth;
  imageHeight.value = image.naturalHeight;
  previewLoading.value = false;
  previewFailed.value = false;
}

function onPreviewError(event: Event) {
  if ((event.target as HTMLImageElement).getAttribute("src") !== previewURL.value) return;
  previewLoading.value = false;
  previewFailed.value = true;
}

watch(previewURL, (value) => {
  imageWidth.value = 0;
  imageHeight.value = 0;
  previewLoading.value = Boolean(value);
  previewFailed.value = false;
});

watch(visible, (open) => {
  if (!open) {
    editorSession += 1;
    cancelUpload();
  }
}, { flush: "sync" });

const statusOptions = [
  { value: "all", label: "全部" },
  { value: "展示中", label: "展示中" },
  { value: "待上线", label: "待上线" },
  { value: "已结束", label: "已结束" },
  { value: "已下架", label: "已下架" },
];

function state(item: Banner): BannerState {
  if (!item.active) return "已下架";
  if (item.startsAt && Date.parse(item.startsAt) > Date.now()) return "待上线";
  if (item.endsAt && Date.parse(item.endsAt) <= Date.now()) return "已结束";
  return "展示中";
}

function stateType(value: BannerState) {
  if (value === "展示中") return "success";
  if (value === "待上线") return "warning";
  return "info";
}

const filtered = computed(() =>
  items.value.filter(
    (item) =>
      (!query.value || `${item.title} ${item.subtitle}`.toLowerCase().includes(query.value.trim().toLowerCase())) &&
      (status.value === "all" || state(item) === status.value),
  ),
);
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const counts = computed(() => ({
  all: items.value.length,
  展示中: items.value.filter((item) => state(item) === "展示中").length,
  待上线: items.value.filter((item) => state(item) === "待上线").length,
  已结束: items.value.filter((item) => state(item) === "已结束").length,
  已下架: items.value.filter((item) => state(item) === "已下架").length,
}));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    items.value = (await request<{ items: Banner[] }>("/api/v1/admin/home-banners", { silent: true })).items;
    page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize) || 1));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "轮播图读取失败";
  } finally {
    loading.value = false;
  }
}

function edit(item?: Banner) {
  if (saving.value) return;
  cancelUpload();
  editorSession += 1;
  uploadError.value = "";
  saveError.value = "";
  previewMode.value = "banner";
  editingId.value = item?.id;
  Object.assign(form, defaults(), item || {});
  visible.value = true;
}

async function save() {
  if (saving.value || uploading.value) return;
  if (!form.imageUrl.trim()) {
    ElMessage.warning("请上传图片或填写图片地址");
    return;
  }
  if (!previewURL.value) {
    ElMessage.warning("请填写有效的站内图片路径或 HTTP(S) 图片地址");
    return;
  }
  if (form.startsAt && form.endsAt && Date.parse(form.endsAt) <= Date.parse(form.startsAt)) {
    ElMessage.warning("结束时间必须晚于开始时间");
    return;
  }
  const session = editorSession;
  saveError.value = "";
  saving.value = true;
  try {
    await request(`/api/v1/admin/home-banners${editingId.value ? `/${editingId.value}` : ""}`, {
      method: editingId.value ? "PUT" : "POST",
      body: {
        ...form,
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        imageUrl: form.imageUrl.trim(),
        linkUrl: form.linkUrl.trim(),
        buttonText: form.buttonText.trim(),
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
      },
    });
    if (session === editorSession) visible.value = false;
    ElMessage.success("轮播图已保存");
    await load();
  } catch (error) {
    if (session === editorSession) saveError.value = error instanceof Error ? error.message : "保存失败，请稍后重试";
  } finally {
    saving.value = false;
  }
}

async function toggle(item: Banner) {
  if (busyId.value) return;
  busyId.value = item.id!;
  try {
    await request(`/api/v1/admin/home-banners/${item.id}`, { method: "PUT", body: { ...item, active: !item.active } });
    await load();
  } catch {
    /* request displays the server error. */
  } finally {
    busyId.value = "";
  }
}

async function remove(item: Banner) {
  try {
    await ElMessageBox.confirm(item.title.trim() ? `确认删除轮播图「${item.title}」？` : "确认删除这张轮播图？", "删除轮播图", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  busyId.value = item.id!;
  try {
    await request(`/api/v1/admin/home-banners/${item.id}`, { method: "DELETE" });
    ElMessage.success("已删除");
    await load();
  } catch {
    /* request displays the server error. */
  } finally {
    busyId.value = "";
  }
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || saving.value || uploading.value) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    ElMessage.warning("请选择 PNG、JPG 或 WebP 图片");
    return;
  }
  if (file.size === 0) {
    ElMessage.warning("图片文件为空，请重新选择");
    return;
  }
  const session = editorSession;
  const controller = new AbortController();
  uploadController = controller;
  uploadError.value = "";
  uploading.value = true;
  try {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/v1/admin/home-banners/images", { method: "POST", credentials: "include", body, signal: controller.signal });
    if (response.status === 404 || response.status === 405) throw new Error("图片上传服务暂不可用，请刷新后台后重试，或联系管理员检查服务。");
    if (response.status === 401 || response.status === 403) throw new Error("登录状态已失效或没有上传权限，请重新登录后重试。");
    if (response.status === 413) throw new Error("上传被接入服务拦截，请联系管理员检查上传配置。");
    if (response.status >= 500) throw new Error("图片上传服务暂时异常，请稍后重试。");
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || typeof payload.data?.url !== "string" || !payload.data.url.trim()) {
      const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
      throw new Error(message || "图片上传未完成，请重试或检查图片地址。");
    }
    if (controller.signal.aborted || session !== editorSession || !visible.value) return;
    form.imageUrl = payload.data.url;
  } catch (e) {
    if (!controller.signal.aborted && session === editorSession) uploadError.value = e instanceof Error ? e.message : "图片上传失败，请稍后重试。";
  } finally {
    if (uploadController === controller) {
      uploadController = null;
      uploading.value = false;
    }
  }
}

onMounted(load);
onBeforeUnmount(cancelUpload);
</script>

<template>
  <div class="banner-page">
    <PageCard
      title="首页轮播"
      :subtitle="`${counts.all} 张轮播图 · 展示中 ${counts['展示中']}`"
    >
      <template #actions>
        <div class="banner-actions">
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="edit()">新增轮播图</el-button>
        </div>
      </template>

      <div class="banner-toolbar">
        <div class="status-tabs" role="tablist" aria-label="展示状态">
          <button
            v-for="option in statusOptions"
            :key="option.value"
            type="button"
            role="tab"
            class="status-tab"
            :class="{ 'is-active': status === option.value }"
            :aria-selected="status === option.value"
            @click="status = option.value; page = 1"
          >
            {{ option.label }}
            <em class="tnum">{{ option.value === "all" ? counts.all : counts[option.value as BannerState] }}</em>
          </button>
        </div>
        <div class="banner-toolbar__actions">
          <el-input
            v-model="query"
            class="banner-search"
            placeholder="搜索轮播标题"
            :prefix-icon="Search"
            clearable
            @input="page = 1"
            @clear="page = 1"
          />
        </div>
      </div>

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />

      <AdminListShell
        class="banner-board"
        fill
        :has-prev="page > 1"
        :has-next="page * pageSize < filtered.length"
        :loading="loading"
        :page="page"
        :count="rows.length"
        :total="filtered.length"
        :page-size="pageSize"
        @update:page="page = $event"
      >
        <el-table v-loading="loading" class="banner-table" :data="rows" row-key="id" height="100%" table-layout="fixed">
          <template #empty>
            <el-empty description="暂无轮播图" :image-size="64" />
          </template>
          <el-table-column label="轮播内容" min-width="280">
            <template #default="{ row }">
              <div class="banner-row">
                <el-image :src="row.imageUrl" fit="cover" :preview-src-list="[row.imageUrl]" preview-teleported />
                <div>
                  <strong>{{ row.title || "未命名轮播图" }}</strong>
                  <span>{{ row.subtitle || "—" }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="排序" prop="sortOrder" width="76" align="center" sortable />
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="stateType(state(row as Banner))" effect="light" size="small">
                {{ state(row as Banner) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="展示时间" min-width="168">
            <template #default="{ row }">
              <div class="banner-time">
                <strong>{{ row.startsAt ? formatTime(row.startsAt) : "立即开始" }}</strong>
                <span>{{ row.endsAt ? formatTime(row.endsAt) : "长期有效" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="时长" width="76" align="center">
            <template #default="{ row }">{{ row.durationMs / 1000 }} 秒</template>
          </el-table-column>
          <el-table-column label="上架" width="80" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.active"
                :disabled="!!busyId"
                :aria-label="`${row.title || '未命名轮播图'}上架`"
                @change="toggle(row as Banner)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" :icon="EditPen" :disabled="!!busyId" @click="edit(row as Banner)">编辑</el-button>
              <el-button text size="small" type="danger" :icon="Delete" :disabled="!!busyId" @click="remove(row as Banner)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="visible"
      :title="editingId ? '编辑轮播图' : '新增轮播图'"
      subtitle="设置画面、文案与展示计划"
      :icon="Picture"
      width="min(1180px, calc(100vw - 48px))"
      panel-class="banner-editor-dialog"
      nested-scroll
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      confirm-text="保存"
      :confirm-loading="saving"
      :confirm-disabled="uploading"
      :cancel-disabled="saving"
      :footer-hint="uploading ? '正在上传原图，取消可停止本次上传' : '标题选填 · 未填跳转地址时隐藏按钮'"
      @confirm="save"
    >
      <div class="banner-editor">
        <el-form class="banner-editor__form" label-position="top" :disabled="saving">
          <section class="banner-editor__section">
            <header class="banner-editor__head">
              <span class="banner-editor__step">01</span>
              <div><strong>轮播画面</strong><small>上传清晰原图，或直接填写图片地址</small></div>
            </header>
            <el-form-item label="轮播图片" required>
              <div class="banner-upload">
                <el-input v-model="form.imageUrl" placeholder="粘贴图片地址，或上传原图" aria-label="图片地址" :disabled="uploading" @input="uploadError = ''" />
                <el-button :icon="Upload" :loading="uploading" @click="fileInput?.click()">上传图片</el-button>
              </div>
              <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="upload" />
              <p class="banner-upload-hint">原图上传，保留原始尺寸、格式和画质。请客服自行处理好图片后上传。</p>
            </el-form-item>
            <el-alert v-if="uploadError" class="banner-upload-error" :title="uploadError" type="error" show-icon :closable="false" />
          </section>
          <section class="banner-editor__section">
            <header class="banner-editor__head">
              <span class="banner-editor__step">02</span>
              <div><strong>标题与说明</strong><small>均为选填，留空时隐藏对应文案</small></div>
            </header>
            <el-form-item label="标题">
              <el-input v-model="form.title" maxlength="60" show-word-limit placeholder="选填，留空不显示主标题" />
            </el-form-item>
            <el-form-item label="副标题">
              <el-input v-model="form.subtitle" type="textarea" :rows="2" resize="none" maxlength="160" show-word-limit placeholder="补充一句说明，或留空仅展示图片" />
            </el-form-item>
          </section>
          <section class="banner-editor__section">
            <header class="banner-editor__head">
              <span class="banner-editor__step">03</span>
              <div><strong>跳转设置</strong><small>填写地址后，轮播图上才会显示入口按钮</small></div>
            </header>
            <el-form-item label="跳转地址">
              <el-input v-model="form.linkUrl" placeholder="选填，例如 /text-to-image 或 https://…" />
            </el-form-item>
            <div class="banner-editor__row">
              <el-form-item label="按钮文字">
                <el-input v-model="form.buttonText" maxlength="20" placeholder="查看详情" />
              </el-form-item>
              <el-form-item label="链接打开方式">
                <el-checkbox v-model="form.newTab" class="banner-editor__checkbox" :disabled="!form.linkUrl.trim()">新标签页打开</el-checkbox>
              </el-form-item>
            </div>
          </section>
          <section class="banner-editor__section">
            <header class="banner-editor__head">
              <span class="banner-editor__step">04</span>
              <div><strong>发布计划</strong><small>设置展示顺序、停留时长与生效时间</small></div>
            </header>
            <div class="banner-editor__row">
              <el-form-item label="排序">
                <el-input-number v-model="form.sortOrder" :min="0" :max="99999" controls-position="right" />
                <small class="banner-field-hint">数字越小，展示越靠前</small>
              </el-form-item>
              <el-form-item label="播放时长（秒）">
                <el-input-number v-model="durationSeconds" :min="3" :max="20" :step="1" :precision="0" controls-position="right" />
                <small class="banner-field-hint">每张图片停留 3–20 秒</small>
              </el-form-item>
              <el-form-item label="开始时间">
                <el-date-picker v-model="form.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="立即开始" />
              </el-form-item>
              <el-form-item label="结束时间">
                <el-date-picker v-model="form.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="长期有效" />
              </el-form-item>
            </div>
            <div class="banner-publish-toggle">
              <div><strong>发布状态</strong><small>{{ form.active ? '按设置的时间对用户展示' : '保存为下架状态' }}</small></div>
              <el-switch v-model="form.active" aria-label="发布状态" active-text="上架" inactive-text="下架" />
            </div>
          </section>
          <el-alert v-if="saveError" class="banner-save-error" :title="saveError" type="error" show-icon :closable="false" />
        </el-form>
        <aside class="banner-editor__aside">
          <header class="banner-preview-heading">
            <div><strong>画面预览</strong><small>随左侧编辑实时更新</small></div>
            <el-tag :type="stateType(previewStatus)" effect="light" round>{{ previewStatus }}</el-tag>
          </header>
          <div class="banner-preview-modes" role="group" aria-label="预览模式">
            <button type="button" :aria-pressed="previewMode === 'banner'" @click="previewMode = 'banner'">首页效果</button>
            <button type="button" :aria-pressed="previewMode === 'original'" @click="previewMode = 'original'">完整原图</button>
          </div>
          <div class="banner-editor__preview" :class="{ 'is-original': previewMode === 'original', 'is-empty': !previewURL || previewFailed }" :aria-busy="previewLoading">
            <img v-if="previewURL && !previewFailed" :key="previewURL" :src="previewURL" alt="轮播预览" @load="onPreviewLoad" @error="onPreviewError" />
            <div v-if="!previewURL || previewFailed" class="banner-preview-empty">
              <el-icon :size="28"><Picture /></el-icon>
              <strong>{{ previewFailed ? '图片暂时无法显示' : '预览你的轮播画面' }}</strong>
              <span>{{ previewFailed ? '请检查地址，或重新上传图片' : '上传原图或填写图片地址' }}</span>
            </div>
            <div v-if="previewURL && !previewFailed && previewMode === 'banner' && hasPreviewCopy" class="banner-editor__copy">
              <div class="banner-preview-words">
                <strong v-if="form.title.trim()">{{ form.title.trim() }}</strong>
                <p v-if="form.subtitle.trim()">{{ form.subtitle.trim() }}</p>
              </div>
              <span v-if="form.linkUrl.trim()">{{ form.buttonText.trim() || "查看详情" }}<el-icon><ArrowRight /></el-icon></span>
            </div>
          </div>
          <div class="banner-preview-meta">
            <span>{{ imageWidth && imageHeight ? `${imageWidth} × ${imageHeight} px` : '参考比例 16:5' }}</span>
            <a v-if="previewURL && imageWidth" :href="previewURL" target="_blank" rel="noopener noreferrer"><el-icon><View /></el-icon>查看原图</a>
          </div>
          <p class="banner-preview-note">首页效果按横幅比例预览，实际展示随屏幕裁切。完整原图可查看全部画面。</p>
          <section class="banner-publish-summary" aria-label="发布概览">
            <h3>发布概览</h3>
            <dl>
              <div><dt>展示顺序</dt><dd>{{ form.sortOrder }}</dd></div>
              <div><dt>每张停留</dt><dd>{{ durationSeconds }} 秒</dd></div>
              <div><dt>开始时间</dt><dd>{{ form.startsAt ? formatTime(form.startsAt) : '立即开始' }}</dd></div>
              <div><dt>结束时间</dt><dd>{{ form.endsAt ? formatTime(form.endsAt) : '长期有效' }}</dd></div>
              <div><dt>跳转按钮</dt><dd>{{ form.linkUrl.trim() ? (form.buttonText.trim() || '查看详情') : '未设置，隐藏按钮' }}</dd></div>
            </dl>
          </section>
          <div class="banner-preview-tip"><el-icon><Picture /></el-icon><p>图片已包含标题时，可将左侧文案留空。文案显示在左下，按钮显示在右下。</p></div>
        </aside>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
.banner-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.banner-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.banner-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.banner-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.banner-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}
.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.status-tab em {
  font-style: normal;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}
.status-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}
.status-tab.is-active em {
  color: color-mix(in srgb, var(--surface) 78%, transparent);
}
html.dark .status-tab.is-active {
  background: var(--surface-3);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
html.dark .status-tab.is-active em {
  color: var(--ink-3);
}
.banner-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.banner-search {
  width: min(220px, 40vw);
}
.banner-search :deep(.el-input__wrapper) {
  min-height: 36px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--border) inset;
}
.banner-board {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.banner-board :deep(.admin-list-shell) {
  border-top: 0;
}
.banner-board :deep(.admin-list-shell__viewport) {
  overflow: hidden;
  scrollbar-gutter: auto;
}
.banner-board :deep(.admin-list-shell__footer) {
  min-height: 52px;
  padding: 0 16px;
  background: var(--surface-2);
}
.banner-table {
  --el-table-border-color: transparent;
}
.banner-table :deep(.el-table__inner-wrapper::before),
.banner-table :deep(.el-table__inner-wrapper::after),
.banner-table :deep(.el-table__border-left-patch) {
  display: none;
}
.banner-table :deep(.el-table .cell) {
  overflow: hidden;
  padding: 0 12px;
}
.banner-table :deep(.el-table td.el-table__cell),
.banner-table :deep(.el-table th.el-table__cell) {
  border: 0;
}
.banner-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 40px;
  padding: 0;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}
.banner-table :deep(.el-table__body .el-table__cell) {
  padding: 8px 0;
}
.banner-table :deep(.el-table__row td.el-table__cell) {
  height: 64px;
}
.banner-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}
.banner-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.banner-row :deep(.el-image) {
  width: 112px;
  height: 56px;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-2);
}
.banner-row > div {
  min-width: 0;
}
.banner-row strong,
.banner-row span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.banner-row strong {
  color: var(--ink);
  font-size: 13px;
}
.banner-row span,
.banner-time span {
  color: var(--ink-3);
  font-size: 12px;
}
.banner-time {
  display: grid;
  gap: 2px;
}
.banner-time strong {
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}
.banner-editor {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 20px;
  min-height: 0;
  overflow: hidden;
}
.banner-editor__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  padding: 2px 10px 18px 2px;
}
.banner-editor__form :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 12px;
}
.banner-editor__form :deep(.el-form-item:last-child) { margin-bottom: 0; }
.banner-editor__form :deep(.el-form-item__label) {
  color: var(--ink-2);
  margin-bottom: 6px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 650;
}
.banner-editor__form :deep(.el-input),
.banner-editor__form :deep(.el-select),
.banner-editor__form :deep(.el-date-editor),
.banner-editor__form :deep(.el-input-number) {
  width: 100%;
  min-width: 0;
  --el-component-size: 38px;
}
.banner-editor__form :deep(.el-input__wrapper),
.banner-editor__form :deep(.el-textarea__inner) {
  border-radius: 9px;
  font-size: 13px;
}
.banner-editor__form :deep(.el-textarea__inner) { min-height: 72px !important; padding: 9px 12px 22px; line-height: 1.6; }
.banner-editor__form :deep(.el-input__count),
.banner-editor__form :deep(.el-input__count-inner) { color: var(--ink-3); font-size: 11px; background: transparent; }
.banner-editor__section { flex: 0 0 auto; min-width: 0; padding: 16px 18px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
.banner-editor__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.banner-editor__step { display: grid; flex: 0 0 30px; width: 30px; height: 30px; place-items: center; border-radius: 9px; background: var(--accent-soft); color: var(--accent-ink); font-size: 11px; font-weight: 750; font-variant-numeric: tabular-nums; }
.banner-editor__head > div { display: grid; min-width: 0; gap: 2px; }
.banner-editor__head strong {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  line-height: 20px;
}
.banner-editor__head small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.45;
}
.banner-editor__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.banner-editor__row :deep(.el-form-item) { margin-bottom: 0; }
.banner-editor__checkbox { box-sizing: border-box; display: flex; align-items: center; width: 100%; height: 38px; padding: 0 12px; margin: 0; border: 1px solid var(--border); border-radius: 9px; }
.banner-editor__checkbox :deep(.el-checkbox__label) { overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.banner-field-hint { display: block; width: 100%; margin-top: 5px; color: var(--ink-3); font-size: 11px; line-height: 16px; }
.banner-publish-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding: 12px; border-radius: 10px; background: var(--surface-2); }
.banner-publish-toggle > div { display: grid; gap: 3px; }
.banner-publish-toggle strong { font-size: 12px; font-weight: 650; color: var(--ink-2); }
.banner-publish-toggle small { font-size: 11px; color: var(--ink-3); }
.banner-upload {
  display: flex;
  width: 100%;
  gap: 8px;
}
.banner-upload :deep(.el-button) { height: 38px; flex: 0 0 auto; border-radius: 9px; padding-inline: 14px; }
.banner-upload-hint {
  width: 100%;
  margin: 8px 0 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.6;
}
.banner-upload-error, .banner-save-error { flex: 0 0 auto; margin-top: 12px; border-radius: 10px; }
.banner-editor__aside { display: flex; flex-direction: column; gap: 12px; min-height: 0; min-width: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 2px 4px 18px 2px; }
.banner-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.banner-preview-heading > div { display: grid; gap: 3px; }
.banner-preview-heading strong { color: var(--ink); font-size: 14px; font-weight: 700; }
.banner-preview-heading small { color: var(--ink-3); font-size: 11px; }
.banner-preview-modes { display: grid; flex: 0 0 auto; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-2); }
.banner-preview-modes button { height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--ink-3); font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
.banner-preview-modes button[aria-pressed="true"] { color: var(--ink); background: var(--surface); box-shadow: var(--shadow-sm); }
.banner-preview-modes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.banner-editor__preview {
  position: relative;
  flex: 0 0 auto;
  aspect-ratio: 16 / 5;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface-2);
}
.banner-editor__preview > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.banner-editor__preview.is-original > img { object-fit: contain; }
.banner-preview-empty { display: grid; height: 100%; align-content: center; justify-items: center; gap: 5px; color: var(--ink-3); text-align: center; }
.banner-preview-empty strong { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.banner-preview-empty > span { font-size: 11px; }
.banner-editor__copy {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
  padding: 12px;
  color: #fff;
  pointer-events: none;
}
.banner-preview-words { display: grid; min-width: 0; gap: 4px; text-shadow: 0 1px 5px rgb(0 0 0 / 0.55); }
.banner-editor__copy strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.banner-editor__copy p {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  color: rgb(255 255 255 / 0.9);
  font-size: 10px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.banner-editor__copy > span {
  display: inline-flex;
  max-width: 140px;
  min-width: 0;
  min-height: 25px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  overflow: hidden;
  padding: 5px 8px;
  border-radius: 5px;
  color: #171b19;
  background: #fff;
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
.banner-preview-meta { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; color: var(--ink-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.banner-preview-meta a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent-ink); text-decoration: none; }
.banner-preview-note { margin: -2px 0 0; color: var(--ink-3); font-size: 11px; line-height: 1.6; }
.banner-publish-summary { flex: 0 0 auto; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-2); }
.banner-publish-summary h3 { margin: 0 0 8px; color: var(--ink); font-size: 12px; font-weight: 700; }
.banner-publish-summary dl { margin: 0; }
.banner-publish-summary dl > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 12px; align-items: center; padding: 6px 0; }
.banner-publish-summary dt { color: var(--ink-3); font-size: 11px; font-weight: 400; }
.banner-publish-summary dd { min-width: 0; margin: 0; overflow: hidden; color: var(--ink-2); font-size: 12px; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.banner-preview-tip { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 8px; padding: 12px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-ink); }
.banner-preview-tip > .el-icon { flex: 0 0 auto; margin-top: 2px; }
.banner-preview-tip p { margin: 0; font-size: 11px; line-height: 1.65; }
@media (max-width: 1320px) {
  .banner-editor { grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; }
  .banner-editor__section { padding: 14px 16px; }
}
</style>

<style>
.banner-editor-dialog.admin-dialog.el-dialog { height: min(780px, calc(100dvh - 56px)); padding: 0; }
.banner-editor-dialog.admin-dialog .el-dialog__body { display: flex; flex: 1; min-height: 0; overflow: hidden; padding: 8px 20px 0; scrollbar-gutter: auto; }
.banner-editor-dialog .admin-dialog__content { display: flex; flex: 1; min-width: 0; min-height: 0; }
.banner-editor-dialog.admin-dialog .el-dialog__footer { padding-top: 12px; border-top: 1px solid var(--border); }
</style>
