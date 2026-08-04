<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AdminDialog from "@/components/AdminDialog.vue";
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
            <el-button type="primary" @click="openAnnCreate">发布公告</el-button>
          </template>

          <ListError :error="annError || null" :loading="annLoading" @retry="loadAnnouncements" />

          <AdminListShell
            class="content-list-shell"
            :has-prev="announcementPagination.hasPrev.value"
            :has-next="announcementPagination.hasNext.value"
            :loading="annLoading"
            :page="announcementPagination.page.value"
            :count="announcementPagination.items.value.length"
            :total="announcementPagination.total.value"
            @prev="announcementPagination.prev"
            @next="announcementPagination.next"
          >
            <div class="content-table-shell">
              <el-table
                v-loading="annLoading"
                class="content-table"
                :data="announcementPagination.items.value"
                height="100%"
                size="small"
              >
                <template #empty>
                  <el-empty description="暂无公告" :image-size="60">
                    <div class="empty-sub">点击右上角「发布公告」创建第一条公告</div>
                  </el-empty>
                </template>
                <el-table-column label="标题" min-width="190" align="left" header-align="left" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="cell-text">{{ row.title }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="内容" min-width="240" align="left" header-align="left" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="cell-muted">{{ row.body }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="展示方式" width="120" align="left" header-align="left">
                  <template #default="{ row }">
                    <span class="cell-text">{{
                      PLACEMENT_LABELS[announcementConfigOf(row as Announcement).placement]
                    }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="展示频率" width="150" align="left" header-align="left">
                  <template #default="{ row }">
                    <span class="cell-text">{{
                      FREQUENCY_LABELS[announcementConfigOf(row as Announcement).frequency]
                    }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="90" align="left" header-align="left">
                  <template #default="{ row }">
                    <el-tag :type="announcementState(row as Announcement).type" size="small">
                      {{ announcementState(row as Announcement).label }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="创建时间" width="170" align="left" header-align="left">
                  <template #default="{ row }">
                    <span class="cell-text tnum">{{ formatTime(row.createdAt) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="140" fixed="right" align="left" header-align="left">
                  <template #default="{ row }">
                    <el-button size="small" @click="openAnnEdit(row as Announcement)">编辑</el-button>
                    <el-button size="small" type="danger" plain @click="removeAnn(row as Announcement)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </AdminListShell>
        </PageCard>
      </el-tab-pane>

      <el-tab-pane label="更新说明" name="changelog">
        <PageCard title="更新说明" subtitle="用户端「更新说明」页的版本条目">
          <template #actions>
            <el-button type="primary" @click="openLogCreate">新增条目</el-button>
          </template>

          <ListError :error="logError || null" :loading="logLoading" @retry="loadChangelog" />

          <AdminListShell
            class="content-list-shell"
            :has-prev="changelogPagination.hasPrev.value"
            :has-next="changelogPagination.hasNext.value"
            :loading="logLoading"
            :page="changelogPagination.page.value"
            :count="changelogPagination.items.value.length"
            :total="changelogPagination.total.value"
            @prev="changelogPagination.prev"
            @next="changelogPagination.next"
          >
            <div class="content-table-shell">
              <el-table
                v-loading="logLoading"
                class="content-table"
                :data="changelogPagination.items.value"
                height="100%"
                size="small"
              >
                <template #empty>
                  <el-empty description="暂无更新说明" :image-size="60">
                    <div class="empty-sub">点击右上角「新增条目」发布第一条更新说明</div>
                  </el-empty>
                </template>
                <el-table-column label="版本" width="100" align="left" header-align="left">
                  <template #default="{ row }">
                    <span class="cell-num">{{ row.version }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="日期" width="120" align="left" header-align="left">
                  <template #default="{ row }">
                    <span class="cell-text tnum">{{ row.date }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="类型" width="100" align="left" header-align="left">
                  <template #default="{ row }">
                    <el-tag :type="row.tag === 'feature' ? 'primary' : 'success'" size="small">
                      {{ TAG_LABELS[row.tag] ?? row.tag }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="标题" min-width="160" align="left" header-align="left" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="cell-text">{{ row.title }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="摘要" min-width="220" align="left" header-align="left" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="cell-muted">{{ row.summary }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="条目数" width="88" align="left" header-align="left">
                  <template #default="{ row }">
                    <span class="cell-num tnum">{{ row.items?.length ?? 0 }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="140" fixed="right" align="left" header-align="left">
                  <template #default="{ row }">
                    <el-button size="small" @click="openLogEdit(row as ChangelogEntry)">编辑</el-button>
                    <el-button size="small" type="danger" plain @click="removeLog(row as ChangelogEntry)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </AdminListShell>
        </PageCard>
      </el-tab-pane>
    </el-tabs>

    <AdminDialog
      v-model="annDialogVisible"
      :title="annEditingId ? '编辑公告配置' : '发布公告'"
      subtitle="左侧编辑，右侧实时预览用户端效果"
      width="min(1060px, calc(100vw - 32px))"
      nested-scroll
      confirm-text="保存"
      :confirm-loading="annSubmitting"
      @confirm="submitAnn"
    >
      <div class="announcement-editor">
        <el-form class="announcement-editor__form" label-position="top">
          <section class="announcement-editor__section">
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
    </AdminDialog>

    <AdminDialog
      v-model="logDialogVisible"
      :title="logEditingId ? '编辑更新说明' : '新增更新说明'"
      width="560px"
      confirm-text="保存"
      :confirm-loading="logSubmitting"
      @confirm="submitLog"
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
    </AdminDialog>
  </div>
</template>

<style scoped>
.page :deep(.el-tabs__header) {
  margin-bottom: 14px;
}

.content-list-shell {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.content-list-shell :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}

.content-list-shell :deep(.cursor-pager__meta strong) {
  color: var(--ink);
}

.content-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.content-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.content-table :deep(.el-table__header-wrapper th.el-table__cell),
.content-table :deep(.el-table__body td.el-table__cell),
.content-table :deep(.el-table .cell) {
  text-align: left !important;
}

.content-table :deep(.el-table .cell) {
  display: block;
  justify-content: flex-start;
  padding-left: 12px;
  padding-right: 12px;
}

.content-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 48px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.content-table :deep(.el-table__body .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.content-table :deep(.el-table__row td.el-table__cell) {
  height: 56px;
}

.content-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.content-table :deep(.el-table__body tr.el-table__row:last-child td.el-table__cell) {
  border-bottom-color: transparent;
}

.cell-text,
.cell-num,
.cell-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-text {
  color: var(--ink-2);
  font-size: 12px;
}

.cell-num {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
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
  padding: 0 0 16px;
  margin: 0 0 8px;
}

.announcement-editor__section:not(:last-child) {
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  margin-bottom: 16px;
}

.announcement-editor__section:last-child {
  margin-bottom: 0;
  border-bottom: 0;
}

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
  padding: 16px;
  color: rgba(255, 255, 255, 0.94);
  background: var(--surface-2);
  border-left: 1px solid var(--border);
}

.announcement-preview-stage__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--ink-2);
}

.announcement-preview-stage__meta span {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.announcement-preview-stage__meta em {
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 11px;
  font-style: normal;
  font-weight: 650;
}

.announcement-preview-canvas {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    #0c0c10;
  background-size: 24px 24px, 24px 24px, auto;
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
