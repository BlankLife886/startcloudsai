<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { normalizeList, request } from "@/request";
import { useClientPagination } from "@/useClientPagination";
import { formatTime } from "@/utils";

const activeTab = ref("announcements");

// ---------- 公告 ----------
interface Announcement {
  id: string;
  title: string;
  body: string | null;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  config?: Partial<AnnouncementConfig>;
  placement?: AnnouncementConfig["placement"];
  layout?: AnnouncementConfig["layout"];
  assets?: AnnouncementAsset[];
  decorImageUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
  closeText?: string;
  allowClose?: boolean;
  frequency?: AnnouncementConfig["frequency"];
  version?: number;
  dismissHours?: number;
  carouselEnabled?: boolean;
  carouselIntervalMs?: number;
  createdAt?: string;
}

interface AnnouncementAsset {
  url: string;
  alt?: string;
}

interface AnnouncementConfig {
  placement: "modal" | "banner";
  layout:
    | "text_only"
    | "image_top"
    | "image_left"
    | "image_right"
    | "grid"
    | "carousel";
  assets: AnnouncementAsset[];
  decorImageUrl: string;
  ctaText: string;
  ctaUrl: string;
  closeText: string;
  allowClose: boolean;
  frequency:
    | "session_once"
    | "every_open"
    | "once_per_version"
    | "daily"
    | "dismiss_hours";
  version: number;
  dismissHours: number;
  carouselEnabled: boolean;
  carouselIntervalMs: number;
}

interface AnnouncementForm extends AnnouncementConfig {
  title: string;
  body: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  assetsText: string;
}

const PLACEMENT_LABELS = { modal: "居中弹窗", banner: "顶部横幅" } as const;
const LAYOUT_LABELS = {
  text_only: "纯文字",
  image_top: "顶部大图",
  image_left: "左图右文",
  image_right: "左文右图",
  grid: "图片宫格",
  carousel: "图片轮播",
} as const;
const FREQUENCY_LABELS = {
  session_once: "每次会话一次",
  every_open: "每次打开",
  once_per_version: "每个版本一次",
  daily: "每天一次",
  dismiss_hours: "关闭后定时再显示",
} as const;

function defaultAnnouncementForm(): AnnouncementForm {
  return {
    title: "",
    body: "",
    active: true,
    startsAt: "",
    endsAt: "",
    placement: "modal",
    layout: "text_only",
    assets: [],
    assetsText: "",
    decorImageUrl: "",
    ctaText: "",
    ctaUrl: "",
    closeText: "我知道了",
    allowClose: true,
    frequency: "session_once",
    version: 1,
    dismissHours: 24,
    carouselEnabled: false,
    carouselIntervalMs: 4500,
  };
}

const annLoading = ref(false);
const annError = ref("");
const announcements = ref<Announcement[]>([]);
const announcementPagination = useClientPagination(
  () => announcements.value,
  10,
);

async function loadAnnouncements() {
  annLoading.value = true;
  annError.value = "";
  try {
    const data = await request<Announcement[] | { items: Announcement[] }>(
      "/api/v1/admin/announcements",
      { silent: true },
    );
    const items = normalizeList(data).items;
    announcements.value = Array.isArray(items)
      ? items.map((item) => ({ ...item, body: item.body ?? "" }))
      : [];
  } catch (error) {
    announcements.value = [];
    annError.value = error instanceof Error ? error.message : "公告读取失败";
  } finally {
    annLoading.value = false;
  }
}

const annDialogVisible = ref(false);
const annEditingId = ref<string | null>(null);
const annSubmitting = ref(false);
const annForm = reactive<AnnouncementForm>(defaultAnnouncementForm());

const annPreviewAssets = computed(() =>
  parseAnnouncementAssets(annForm.assetsText),
);
const annPreviewImage = computed(() => annPreviewAssets.value[0]?.url || "");
const annPreviewClass = computed(() => ({
  "is-banner": annForm.placement === "banner",
  [`is-${annForm.layout.replace("_", "-")}`]: true,
  "has-media": annPreviewAssets.value.length > 0,
}));

function parseAnnouncementAssets(value: string): AnnouncementAsset[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => {
      const [url, alt = ""] = line.split("|").map((part) => part.trim());
      return { url, alt };
    });
}

function announcementConfigOf(item: Announcement): AnnouncementConfig {
  const defaults = defaultAnnouncementForm();
  const config = item.config || {};
  return {
    placement: item.placement || config.placement || defaults.placement,
    layout: item.layout || config.layout || defaults.layout,
    assets: item.assets || config.assets || [],
    decorImageUrl: item.decorImageUrl ?? config.decorImageUrl ?? "",
    ctaText: item.ctaText ?? config.ctaText ?? "",
    ctaUrl: item.ctaUrl ?? config.ctaUrl ?? "",
    closeText: item.closeText ?? config.closeText ?? defaults.closeText,
    allowClose: item.allowClose ?? config.allowClose ?? true,
    frequency: item.frequency || config.frequency || defaults.frequency,
    version: item.version || config.version || 1,
    dismissHours: item.dismissHours || config.dismissHours || 24,
    carouselEnabled: item.carouselEnabled ?? config.carouselEnabled ?? false,
    carouselIntervalMs:
      item.carouselIntervalMs || config.carouselIntervalMs || 4500,
  };
}

function announcementState(item: Announcement) {
  const now = Date.now();
  if (item.active === false) return { label: "已停用", type: "info" as const };
  if (item.startsAt && new Date(item.startsAt).getTime() > now) {
    return { label: "待生效", type: "warning" as const };
  }
  if (item.endsAt && new Date(item.endsAt).getTime() < now) {
    return { label: "已结束", type: "info" as const };
  }
  return { label: "展示中", type: "success" as const };
}

function openAnnCreate() {
  annEditingId.value = null;
  Object.assign(annForm, defaultAnnouncementForm());
  annDialogVisible.value = true;
}

function openAnnEdit(item: Announcement) {
  annEditingId.value = item.id;
  const config = announcementConfigOf(item);
  Object.assign(annForm, {
    ...defaultAnnouncementForm(),
    title: item.title || "",
    body: item.body || "",
    active: item.active ?? true,
    startsAt: item.startsAt || "",
    endsAt: item.endsAt || "",
    ...config,
    assetsText: config.assets
      .map((asset) => `${asset.url}${asset.alt ? ` | ${asset.alt}` : ""}`)
      .join("\n"),
  });
  annDialogVisible.value = true;
}

async function submitAnn() {
  if (!annForm.title.trim() || !annForm.body.trim()) {
    ElMessage.warning("请填写标题与内容");
    return;
  }
  const assets = parseAnnouncementAssets(annForm.assetsText);
  if (annForm.layout !== "text_only" && assets.length === 0) {
    ElMessage.warning("当前图文布局至少需要配置一张图片");
    return;
  }
  if (
    (annForm.ctaText.trim() && !annForm.ctaUrl.trim()) ||
    (!annForm.ctaText.trim() && annForm.ctaUrl.trim())
  ) {
    ElMessage.warning("行动按钮文案和跳转地址需要同时填写");
    return;
  }
  const body = {
    title: annForm.title.trim(),
    body: annForm.body.trim(),
    active: annForm.active,
    startsAt: annForm.startsAt || null,
    endsAt: annForm.endsAt || null,
    config: {
      placement: annForm.placement,
      layout: annForm.layout,
      assets,
      decorImageUrl: annForm.decorImageUrl.trim(),
      ctaText: annForm.ctaText.trim(),
      ctaUrl: annForm.ctaUrl.trim(),
      closeText: annForm.closeText.trim(),
      allowClose: annForm.allowClose,
      frequency: annForm.frequency,
      version: annForm.version,
      dismissHours: annForm.dismissHours,
      carouselEnabled: annForm.layout === "carousel" && annForm.carouselEnabled,
      carouselIntervalMs: annForm.carouselIntervalMs,
    },
  };
  annSubmitting.value = true;
  try {
    if (annEditingId.value) {
      await request(`/api/v1/admin/announcements/${annEditingId.value}`, {
        method: "PATCH",
        body,
      });
      ElMessage.success("公告已更新");
    } else {
      await request("/api/v1/admin/announcements", { method: "POST", body });
      ElMessage.success("公告已发布");
    }
    annDialogVisible.value = false;
    await loadAnnouncements();
  } finally {
    annSubmitting.value = false;
  }
}

async function removeAnn(item: Announcement) {
  try {
    await ElMessageBox.confirm(`确认删除公告「${item.title}」？`, "删除公告", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await request(`/api/v1/admin/announcements/${item.id}`, { method: "DELETE" });
  ElMessage.success("已删除");
  await loadAnnouncements();
}

// ---------- 更新说明 changelog ----------
interface ChangelogEntry {
  id: string;
  version: string;
  date: string;
  tag: string;
  title: string;
  summary: string;
  items: string[];
}

const TAG_LABELS: Record<string, string> = {
  feature: "新功能",
  experience: "体验优化",
};

const logLoading = ref(false);
const logError = ref("");
const changelog = ref<ChangelogEntry[]>([]);
const changelogPagination = useClientPagination(() => changelog.value, 10);

async function loadChangelog() {
  logLoading.value = true;
  logError.value = "";
  try {
    const data = await request<ChangelogEntry[] | { items: ChangelogEntry[] }>(
      "/api/v1/admin/changelog",
      { silent: true },
    );
    const items = normalizeList(data).items;
    changelog.value = Array.isArray(items) ? items : [];
  } catch (error) {
    changelog.value = [];
    logError.value =
      error instanceof Error ? error.message : "更新说明读取失败";
  } finally {
    logLoading.value = false;
  }
}

const logDialogVisible = ref(false);
const logEditingId = ref<string | null>(null);
const logSubmitting = ref(false);
const logForm = reactive({
  version: "",
  date: "",
  tag: "feature",
  title: "",
  summary: "",
  itemsText: "",
});

function openLogCreate() {
  logEditingId.value = null;
  Object.assign(logForm, {
    version: "",
    date: new Date().toISOString().slice(0, 10),
    tag: "feature",
    title: "",
    summary: "",
    itemsText: "",
  });
  logDialogVisible.value = true;
}

function openLogEdit(entry: ChangelogEntry) {
  logEditingId.value = entry.id;
  Object.assign(logForm, {
    version: entry.version,
    date: entry.date,
    tag: entry.tag,
    title: entry.title,
    summary: entry.summary,
    itemsText: (entry.items ?? []).join("\n"),
  });
  logDialogVisible.value = true;
}

async function submitLog() {
  if (!logForm.version.trim() || !logForm.date || !logForm.title.trim()) {
    ElMessage.warning("请填写版本号、日期与标题");
    return;
  }
  const body = {
    version: logForm.version.trim(),
    date: logForm.date,
    tag: logForm.tag,
    title: logForm.title.trim(),
    summary: logForm.summary.trim(),
    items: logForm.itemsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
  logSubmitting.value = true;
  try {
    if (logEditingId.value) {
      await request(`/api/v1/admin/changelog/${logEditingId.value}`, {
        method: "PATCH",
        body,
      });
      ElMessage.success("更新说明已保存");
    } else {
      await request("/api/v1/admin/changelog", { method: "POST", body });
      ElMessage.success("更新说明已发布");
    }
    logDialogVisible.value = false;
    await loadChangelog();
  } finally {
    logSubmitting.value = false;
  }
}

async function removeLog(entry: ChangelogEntry) {
  try {
    await ElMessageBox.confirm(
      `确认删除更新说明 ${entry.version}「${entry.title}」？`,
      "删除更新说明",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  await request(`/api/v1/admin/changelog/${entry.id}`, { method: "DELETE" });
  ElMessage.success("已删除");
  await loadChangelog();
}

onMounted(() => {
  void loadAnnouncements();
  void loadChangelog();
});
</script>

<template>
  <div class="page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="公告" name="announcements">
        <PageCard
          title="全站公告"
          subtitle="配置用户端公告的内容、展示形式、频率与有效期"
        >
          <template #actions>
            <el-button type="primary" size="small" @click="openAnnCreate"
              >发布公告</el-button
            >
          </template>
          <el-alert
            v-if="annError"
            class="content-load-error"
            type="error"
            :title="annError"
            show-icon
            :closable="false"
          >
            <template #default>
              <el-button size="small" @click="loadAnnouncements"
                >重新加载</el-button
              >
            </template>
          </el-alert>
          <AdminListShell
            :has-prev="announcementPagination.hasPrev.value"
            :has-next="announcementPagination.hasNext.value"
            :loading="annLoading"
            :page="announcementPagination.page.value"
            :count="announcementPagination.items.value.length"
            :total="announcementPagination.total.value"
            @prev="announcementPagination.prev"
            @next="announcementPagination.next"
          >
          <el-table v-loading="annLoading" :data="announcementPagination.items.value" height="100%" size="small">
            <template #empty>
              <el-empty description="暂无公告" :image-size="60">
                <div class="empty-sub">
                  点击右上角「发布公告」创建第一条公告
                </div>
              </el-empty>
            </template>
            <el-table-column prop="title" label="标题" min-width="190" />
            <el-table-column
              prop="body"
              label="内容"
              min-width="240"
              show-overflow-tooltip
            />
            <el-table-column label="展示方式" width="120">
              <template #default="{ row }">
                {{
                  PLACEMENT_LABELS[
                    announcementConfigOf(row as Announcement).placement
                  ]
                }}
              </template>
            </el-table-column>
            <el-table-column label="展示频率" width="150">
              <template #default="{ row }">
                {{
                  FREQUENCY_LABELS[
                    announcementConfigOf(row as Announcement).frequency
                  ]
                }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag
                  :type="announcementState(row as Announcement).type"
                  size="small"
                >
                  {{ announcementState(row as Announcement).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="170">
              <template #default="{ row }">{{
                formatTime(row.createdAt)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button
                  size="small"
                  @click="openAnnEdit(row as Announcement)"
                  >编辑</el-button
                >
                <el-button
                  size="small"
                  type="danger"
                  plain
                  @click="removeAnn(row as Announcement)"
                  >删除</el-button
                >
              </template>
            </el-table-column>
          </el-table>
          </AdminListShell>
        </PageCard>
      </el-tab-pane>

      <el-tab-pane label="更新说明" name="changelog">
        <PageCard title="更新说明" subtitle="用户端「更新说明」页的版本条目">
          <template #actions>
            <el-button type="primary" size="small" @click="openLogCreate"
              >新增条目</el-button
            >
          </template>
          <el-alert
            v-if="logError"
            class="content-load-error"
            type="error"
            :title="logError"
            show-icon
            :closable="false"
          >
            <template #default>
              <el-button size="small" @click="loadChangelog"
                >重新加载</el-button
              >
            </template>
          </el-alert>
          <AdminListShell
            :has-prev="changelogPagination.hasPrev.value"
            :has-next="changelogPagination.hasNext.value"
            :loading="logLoading"
            :page="changelogPagination.page.value"
            :count="changelogPagination.items.value.length"
            :total="changelogPagination.total.value"
            @prev="changelogPagination.prev"
            @next="changelogPagination.next"
          >
          <el-table v-loading="logLoading" :data="changelogPagination.items.value" height="100%" size="small">
            <template #empty>
              <el-empty description="暂无更新说明" :image-size="60">
                <div class="empty-sub">
                  点击右上角「新增条目」发布第一条更新说明
                </div>
              </el-empty>
            </template>
            <el-table-column prop="version" label="版本" width="100" />
            <el-table-column prop="date" label="日期" width="120" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag
                  :type="row.tag === 'feature' ? 'primary' : 'success'"
                  size="small"
                >
                  {{ TAG_LABELS[row.tag] ?? row.tag }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="160" />
            <el-table-column
              prop="summary"
              label="摘要"
              min-width="220"
              show-overflow-tooltip
            />
            <el-table-column
              label="条目数"
              width="80"
              align="right"
              class-name="col-num"
            >
              <template #default="{ row }">{{
                row.items?.length ?? 0
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button
                  size="small"
                  @click="openLogEdit(row as ChangelogEntry)"
                  >编辑</el-button
                >
                <el-button
                  size="small"
                  type="danger"
                  plain
                  @click="removeLog(row as ChangelogEntry)"
                  >删除</el-button
                >
              </template>
            </el-table-column>
          </el-table>
          </AdminListShell>
        </PageCard>
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="annDialogVisible"
      class="announcement-config-dialog"
      :title="annEditingId ? '编辑公告配置' : '发布公告'"
      width="min(1060px, calc(100vw - 32px))"
      top="5vh"
    >
      <div class="announcement-editor">
        <el-form class="announcement-editor__form" label-position="top">
          <section class="announcement-editor__section">
            <div class="announcement-editor__heading">
              <strong>公告内容</strong>
              <span>用户首先看到的信息</span>
            </div>
            <el-form-item label="标题" required>
              <el-input
                v-model="annForm.title"
                maxlength="200"
                show-word-limit
                placeholder="简洁说明本次公告"
              />
            </el-form-item>
            <el-form-item label="正文" required>
              <el-input
                v-model="annForm.body"
                type="textarea"
                :rows="5"
                maxlength="3000"
                show-word-limit
                placeholder="支持换行，建议只保留与用户相关的重点内容"
              />
            </el-form-item>
          </section>

          <section class="announcement-editor__section">
            <div class="announcement-editor__heading">
              <strong>展示样式</strong>
              <span>视觉会实时同步到右侧预览</span>
            </div>
            <div class="announcement-editor__row">
              <el-form-item label="展示位置">
                <el-radio-group v-model="annForm.placement">
                  <el-radio-button value="modal">居中弹窗</el-radio-button>
                  <el-radio-button value="banner">顶部横幅</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="内容布局">
                <el-select
                  v-model="annForm.layout"
                  :disabled="annForm.placement === 'banner'"
                >
                  <el-option
                    v-for="(label, value) in LAYOUT_LABELS"
                    :key="value"
                    :label="label"
                    :value="value"
                  />
                </el-select>
              </el-form-item>
            </div>
            <el-form-item label="内容图片">
              <el-input
                v-model="annForm.assetsText"
                type="textarea"
                :rows="3"
                placeholder="每行一张：图片地址 | 图片说明（最多 4 张）"
              />
            </el-form-item>
            <el-form-item label="装饰图片">
              <el-input
                v-model="annForm.decorImageUrl"
                placeholder="可选，用作横幅缩略图或弹窗轻量装饰"
              />
            </el-form-item>
            <div
              v-if="annForm.layout === 'carousel'"
              class="announcement-editor__row"
            >
              <el-form-item label="自动轮播">
                <el-switch v-model="annForm.carouselEnabled" />
              </el-form-item>
              <el-form-item label="轮播间隔">
                <el-input-number
                  v-model="annForm.carouselIntervalMs"
                  :min="1500"
                  :max="20000"
                  :step="500"
                  controls-position="right"
                />
                <span class="form-unit">毫秒</span>
              </el-form-item>
            </div>
          </section>

          <section class="announcement-editor__section">
            <div class="announcement-editor__heading">
              <strong>交互与频率</strong>
              <span>控制按钮、关闭方式和重复展示</span>
            </div>
            <div class="announcement-editor__row">
              <el-form-item label="行动按钮文案">
                <el-input
                  v-model="annForm.ctaText"
                  maxlength="40"
                  placeholder="例如：立即体验"
                />
              </el-form-item>
              <el-form-item label="跳转地址">
                <el-input
                  v-model="annForm.ctaUrl"
                  placeholder="/wallpaper 或 https://..."
                />
              </el-form-item>
            </div>
            <div class="announcement-editor__row">
              <el-form-item label="关闭按钮文案">
                <el-input
                  v-model="annForm.closeText"
                  maxlength="40"
                  placeholder="我知道了"
                />
              </el-form-item>
              <el-form-item label="允许关闭">
                <el-switch v-model="annForm.allowClose" />
              </el-form-item>
            </div>
            <div class="announcement-editor__row">
              <el-form-item label="展示频率">
                <el-select v-model="annForm.frequency">
                  <el-option
                    v-for="(label, value) in FREQUENCY_LABELS"
                    :key="value"
                    :label="label"
                    :value="value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item
                v-if="annForm.frequency === 'once_per_version'"
                label="公告版本"
              >
                <el-input-number
                  v-model="annForm.version"
                  :min="1"
                  :max="1000000"
                  controls-position="right"
                />
              </el-form-item>
              <el-form-item
                v-else-if="annForm.frequency === 'dismiss_hours'"
                label="再次展示间隔"
              >
                <el-input-number
                  v-model="annForm.dismissHours"
                  :min="1"
                  :max="720"
                  controls-position="right"
                />
                <span class="form-unit">小时</span>
              </el-form-item>
            </div>
          </section>

          <section class="announcement-editor__section">
            <div class="announcement-editor__heading">
              <strong>发布排期</strong>
              <span>留空时间表示立即开始或长期有效</span>
            </div>
            <div class="announcement-editor__row">
              <el-form-item label="开始时间">
                <el-date-picker
                  v-model="annForm.startsAt"
                  type="datetime"
                  value-format="YYYY-MM-DDTHH:mm:ss"
                  placeholder="立即开始"
                />
              </el-form-item>
              <el-form-item label="结束时间">
                <el-date-picker
                  v-model="annForm.endsAt"
                  type="datetime"
                  value-format="YYYY-MM-DDTHH:mm:ss"
                  placeholder="长期有效"
                />
              </el-form-item>
            </div>
            <div class="announcement-publish-switch">
              <div>
                <strong>启用公告</strong>
                <span>关闭后用户端不会读取到这条公告</span>
              </div>
              <el-switch v-model="annForm.active" />
            </div>
          </section>
        </el-form>

        <aside class="announcement-preview-stage">
          <div class="announcement-preview-stage__meta">
            <span>用户端实时预览</span>
            <em>{{ PLACEMENT_LABELS[annForm.placement] }}</em>
          </div>
          <div class="announcement-preview-canvas">
            <article class="announcement-preview" :class="annPreviewClass">
              <img
                v-if="annForm.placement === 'banner' && annForm.decorImageUrl"
                class="announcement-preview__decor"
                :src="annForm.decorImageUrl"
                alt=""
              />
              <div
                v-if="
                  annForm.placement === 'modal' &&
                  annForm.layout !== 'text_only' &&
                  annPreviewImage
                "
                class="announcement-preview__media"
              >
                <template v-if="annForm.layout === 'grid'">
                  <img
                    v-for="asset in annPreviewAssets"
                    :key="asset.url"
                    :src="asset.url"
                    :alt="asset.alt || '公告预览'"
                  />
                </template>
                <img v-else :src="annPreviewImage" alt="公告预览" />
              </div>
              <div class="announcement-preview__copy">
                <small>ANNOUNCEMENT</small>
                <strong>{{ annForm.title || "公告标题" }}</strong>
                <p>{{ annForm.body || "公告正文会显示在这里。" }}</p>
                <div class="announcement-preview__actions">
                  <span v-if="annForm.ctaText">{{ annForm.ctaText }}</span>
                  <button v-if="annForm.allowClose" type="button">
                    {{ annForm.closeText || "我知道了" }}
                  </button>
                </div>
              </div>
            </article>
          </div>
        </aside>
      </div>
      <template #footer>
        <el-button @click="annDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="annSubmitting" @click="submitAnn"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="logDialogVisible"
      :title="logEditingId ? '编辑更新说明' : '新增更新说明'"
      width="560px"
    >
      <el-form label-width="80px">
        <el-form-item label="版本号" required>
          <el-input
            v-model="logForm.version"
            placeholder="如 1.4.0"
            style="width: 200px"
          />
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker
            v-model="logForm.date"
            type="date"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="logForm.tag" style="width: 200px">
            <el-option label="新功能" value="feature" />
            <el-option label="体验优化" value="experience" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="logForm.title" />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="logForm.summary" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="条目">
          <el-input
            v-model="logForm.itemsText"
            type="textarea"
            :rows="4"
            placeholder="一行一条改动说明"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="logDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="logSubmitting" @click="submitLog"
          >保存</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.content-load-error {
  margin-bottom: 12px;
}

:deep(.announcement-config-dialog .el-dialog__body) {
  padding: 0;
  overflow: hidden;
}

:deep(.announcement-config-dialog .el-dialog__footer) {
  border-top: 1px solid var(--border);
  padding: 14px 20px;
}

.announcement-editor {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  height: min(76vh, 780px);
  min-height: 560px;
}

.announcement-editor__form {
  min-width: 0;
  overflow-y: auto;
  padding: 20px;
}

.announcement-editor__section {
  padding: 0 0 20px;
  margin: 0 0 20px;
  border-bottom: 1px solid var(--border);
}

.announcement-editor__section:last-child {
  margin-bottom: 0;
  border-bottom: 0;
}

.announcement-editor__heading {
  display: grid;
  gap: 3px;
  margin-bottom: 16px;
}

.announcement-editor__heading strong {
  color: var(--ink-1);
  font-size: 14px;
  font-weight: 650;
}

.announcement-editor__heading span,
.announcement-publish-switch span {
  color: var(--ink-3);
  font-size: 12px;
}

.announcement-editor__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.announcement-editor__row :deep(.el-select),
.announcement-editor__row :deep(.el-date-editor) {
  width: 100%;
}

.form-unit {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: 12px;
}

.announcement-publish-switch {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.announcement-publish-switch > div {
  display: grid;
  gap: 2px;
}

.announcement-publish-switch strong {
  font-size: 13px;
}

.announcement-preview-stage {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 20px;
  color: rgba(255, 255, 255, 0.94);
  background-color: #09090c;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 24px 24px;
}

.announcement-preview-stage__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.announcement-preview-stage__meta span {
  font-size: 13px;
  font-weight: 650;
}

.announcement-preview-stage__meta em {
  padding: 4px 8px;
  border: 1px solid rgba(139, 123, 255, 0.36);
  border-radius: 999px;
  color: #b8adff;
  font-size: 11px;
  font-style: normal;
}

.announcement-preview-canvas {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 22px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  background: rgba(18, 18, 24, 0.84);
}

.announcement-preview {
  width: min(360px, 100%);
  max-height: 100%;
  overflow: hidden;
  display: grid;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(20, 20, 28, 0.96);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.42);
}

.announcement-preview.is-image-left,
.announcement-preview.is-image-right {
  width: min(430px, 100%);
  grid-template-columns: minmax(120px, 0.82fr) minmax(160px, 1fr);
}

.announcement-preview.is-image-right .announcement-preview__media {
  order: 2;
}

.announcement-preview.is-banner {
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  border-radius: 14px;
}

.announcement-preview__decor {
  width: 54px;
  height: 54px;
  margin-left: 12px;
  border-radius: 10px;
  object-fit: cover;
}

.announcement-preview__media {
  height: 180px;
  background: #111118;
}

.announcement-preview.is-image-left .announcement-preview__media,
.announcement-preview.is-image-right .announcement-preview__media {
  height: 100%;
  min-height: 220px;
}

.announcement-preview__media img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.announcement-preview.is-grid .announcement-preview__media {
  height: 220px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
}

.announcement-preview.is-grid .announcement-preview__media img {
  min-height: 0;
  border-radius: 8px;
}

.announcement-preview__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 20px;
}

.announcement-preview.is-banner .announcement-preview__copy {
  gap: 4px;
  padding: 13px 14px;
}

.announcement-preview__copy small {
  color: #9b8cff;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.announcement-preview__copy > strong {
  overflow-wrap: anywhere;
  font-size: 17px;
  line-height: 1.28;
}

.announcement-preview.is-banner .announcement-preview__copy > strong {
  font-size: 13px;
}

.announcement-preview__copy p {
  margin: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.58);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-line;
}

.announcement-preview.is-banner .announcement-preview__copy p {
  max-width: 34ch;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-preview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.announcement-preview.is-banner .announcement-preview__actions {
  margin-top: 4px;
}

.announcement-preview__actions span,
.announcement-preview__actions button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 650;
}

.announcement-preview__actions span {
  background: #7565ff;
  color: #fff;
}

.announcement-preview__actions button {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.78);
}

@media (max-width: 860px) {
  .announcement-editor {
    height: min(82vh, 900px);
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .announcement-editor__form {
    overflow: visible;
  }

  .announcement-preview-stage {
    min-height: 460px;
  }
}

@media (max-width: 560px) {
  .announcement-editor__row {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .announcement-editor__form,
  .announcement-preview-stage {
    padding: 16px;
  }
}
</style>
