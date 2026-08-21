<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  Bell,
  Delete,
  Document,
  EditPen,
  Plus,
  Refresh,
  Search,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AdminDialog from "@/components/AdminDialog.vue";
import { normalizeList, request } from "@/request";
import { useClientPagination } from "@/useClientPagination";
import { formatShortTime } from "@/utils";

type ContentTab = "announcements" | "changelog";
type AnnStatusFilter = "all" | "live" | "pending" | "ended" | "disabled";
type LogTagFilter = "all" | "feature" | "experience" | "highlight";

const activeTab = ref<ContentTab>("announcements");
const query = ref("");
const annStatusFilter = ref<AnnStatusFilter>("all");
const logTagFilter = ref<LogTagFilter>("all");
const switchingAnnId = ref("");
const switchingLogId = ref("");

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
  if (item.active === false) {
    return { key: "disabled" as const, label: "已停用", tone: "info" as const };
  }
  if (item.startsAt && new Date(item.startsAt).getTime() > now) {
    return { key: "pending" as const, label: "待生效", tone: "warning" as const };
  }
  if (item.endsAt && new Date(item.endsAt).getTime() < now) {
    return { key: "ended" as const, label: "已结束", tone: "info" as const };
  }
  return { key: "live" as const, label: "展示中", tone: "success" as const };
}

function scheduleLabel(item: Announcement) {
  if (!item.startsAt && !item.endsAt) return "长期有效";
  const start = item.startsAt ? formatShortTime(item.startsAt) : "立即开始";
  const end = item.endsAt ? formatShortTime(item.endsAt) : "不限期";
  return `${start} → ${end}`;
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
  highlight?: boolean;
}

const TAG_LABELS: Record<string, string> = {
  feature: "新功能",
  experience: "体验优化",
};

const logLoading = ref(false);
const logError = ref("");
const changelog = ref<ChangelogEntry[]>([]);

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
  highlight: false,
});

function parseVersionParts(version: string) {
  return String(version || "")
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part.replace(/\D.*$/, ""), 10))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(left: string, right: string) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function formatVersion(parts: number[]) {
  const [major = 1, minor = 0, patch = 0] = parts;
  return `${major}.${minor}.${patch}`;
}

function nextChangelogVersion() {
  const versions = changelog.value
    .map((entry) => entry.version.trim())
    .filter(Boolean);
  if (!versions.length) return "1.0.0";
  const latest = versions.reduce((best, current) =>
    compareVersions(current, best) > 0 ? current : best,
  );
  const parts = parseVersionParts(latest);
  if (!parts.length) return "1.0.0";
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  const used = new Set(versions);
  let next = formatVersion(parts);
  while (used.has(next)) {
    parts[2] += 1;
    next = formatVersion(parts);
  }
  return next;
}

function openLogCreate() {
  logEditingId.value = null;
  Object.assign(logForm, {
    version: nextChangelogVersion(),
    date: new Date().toISOString().slice(0, 10),
    tag: "feature",
    title: "",
    summary: "",
    itemsText: "",
    highlight: true,
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
    highlight: Boolean(entry.highlight),
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
    highlight: logForm.highlight,
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
      ElMessage.success("版本已发布，打开中的用户端会收到刷新提示");
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

const filteredAnnouncements = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return announcements.value.filter((item) => {
    if (
      annStatusFilter.value !== "all" &&
      announcementState(item).key !== annStatusFilter.value
    ) {
      return false;
    }
    if (!needle) return true;
    const config = announcementConfigOf(item);
    return [item.title, item.body, PLACEMENT_LABELS[config.placement], FREQUENCY_LABELS[config.frequency]]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
});

const filteredChangelog = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return changelog.value.filter((entry) => {
    if (logTagFilter.value === "highlight" && !entry.highlight) return false;
    if (
      (logTagFilter.value === "feature" || logTagFilter.value === "experience") &&
      entry.tag !== logTagFilter.value
    ) {
      return false;
    }
    if (!needle) return true;
    return [
      entry.version,
      entry.title,
      entry.summary,
      entry.date,
      TAG_LABELS[entry.tag],
      ...(entry.items ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
});

const announcementPagination = useClientPagination(
  () => filteredAnnouncements.value,
  10,
);
const changelogPagination = useClientPagination(() => filteredChangelog.value, 10);

const liveAnnCount = computed(
  () => announcements.value.filter((item) => announcementState(item).key === "live").length,
);
const highlightCount = computed(
  () => changelog.value.filter((entry) => entry.highlight).length,
);

const hasFilters = computed(() => {
  if (query.value.trim()) return true;
  return activeTab.value === "announcements"
    ? annStatusFilter.value !== "all"
    : logTagFilter.value !== "all";
});

const currentError = computed(() =>
  activeTab.value === "announcements" ? annError.value : logError.value,
);
const currentLoading = computed(() =>
  activeTab.value === "announcements" ? annLoading.value : logLoading.value,
);
const currentPager = computed(() =>
  activeTab.value === "announcements" ? announcementPagination : changelogPagination,
);

function clearFilters() {
  query.value = "";
  annStatusFilter.value = "all";
  logTagFilter.value = "all";
}

function refreshAll() {
  void loadAnnouncements();
  void loadChangelog();
}

function retryCurrent() {
  if (activeTab.value === "announcements") return loadAnnouncements();
  return loadChangelog();
}

function openCreate() {
  if (activeTab.value === "announcements") openAnnCreate();
  else openLogCreate();
}

async function toggleAnnActive(item: Announcement, active: boolean) {
  if (switchingAnnId.value) return;
  switchingAnnId.value = item.id;
  try {
    await request(`/api/v1/admin/announcements/${item.id}`, {
      method: "PATCH",
      body: { active },
    });
    item.active = active;
    ElMessage.success(active ? "公告已启用" : "公告已停用");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "公告状态更新失败");
  } finally {
    switchingAnnId.value = "";
  }
}

async function toggleLogHighlight(entry: ChangelogEntry, highlight: boolean) {
  if (switchingLogId.value) return;
  switchingLogId.value = entry.id;
  try {
    await request(`/api/v1/admin/changelog/${entry.id}`, {
      method: "PATCH",
      body: { highlight },
    });
    entry.highlight = highlight;
    ElMessage.success(highlight ? "已设为焦点版本" : "已取消焦点");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "更新说明保存失败");
  } finally {
    switchingLogId.value = "";
  }
}

watch([query, annStatusFilter, logTagFilter, activeTab], () => {
  announcementPagination.reset();
  changelogPagination.reset();
});

onMounted(() => {
  void loadAnnouncements();
  void loadChangelog();
});
</script>

<template>
  <div class="page content-admin-page">
    <PageCard>
      <div class="content-toolbar">
        <div class="content-tabs" role="tablist" aria-label="内容类型">
          <button
            type="button"
            role="tab"
            class="content-tab"
            :class="{ 'is-active': activeTab === 'announcements' }"
            :aria-selected="activeTab === 'announcements'"
            @click="activeTab = 'announcements'"
          >
            公告
            <em class="tnum">{{ announcements.length }}</em>
          </button>
          <button
            type="button"
            role="tab"
            class="content-tab"
            :class="{ 'is-active': activeTab === 'changelog' }"
            :aria-selected="activeTab === 'changelog'"
            @click="activeTab = 'changelog'"
          >
            更新说明
            <em class="tnum">{{ changelog.length }}</em>
          </button>
        </div>
        <div class="content-toolbar__right">
          <el-input
            v-model="query"
            :prefix-icon="Search"
            clearable
            :placeholder="
              activeTab === 'announcements'
                ? '搜索公告标题或正文'
                : '搜索版本、标题或条目'
            "
          />
          <el-select
            v-if="activeTab === 'announcements'"
            v-model="annStatusFilter"
            aria-label="公告状态"
          >
            <el-option label="全部状态" value="all" />
            <el-option label="展示中" value="live" />
            <el-option label="待生效" value="pending" />
            <el-option label="已结束" value="ended" />
            <el-option label="已停用" value="disabled" />
          </el-select>
          <el-select v-else v-model="logTagFilter" aria-label="更新类型">
            <el-option label="全部类型" value="all" />
            <el-option label="新功能" value="feature" />
            <el-option label="体验优化" value="experience" />
            <el-option label="焦点版本" value="highlight" />
          </el-select>
          <el-button v-if="hasFilters" @click="clearFilters">清除筛选</el-button>
          <el-button :icon="Refresh" :loading="currentLoading" @click="refreshAll">
            刷新
          </el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">
            {{ activeTab === "announcements" ? "发布公告" : "发布版本" }}
          </el-button>
        </div>
      </div>

      <p class="content-legend">
        <template v-if="activeTab === 'announcements'">
          公告出现在用户通知中心，不会混进通知列表。当前展示中
          <em class="tnum">{{ liveAnnCount }}</em>
          / {{ announcements.length }} 条。
        </template>
        <template v-else>
          发布后同步到用户端更新说明页，打开中的用户会收到刷新提示。焦点版本
          <em class="tnum">{{ highlightCount }}</em>
          条。
        </template>
      </p>

      <ListError
        :error="currentError || null"
        :loading="currentLoading"
        @retry="retryCurrent"
      />

      <div v-loading="currentLoading" class="content-board">
        <div
          v-if="activeTab === 'announcements' && announcementPagination.items.value.length"
          class="ann-grid"
        >
          <article
            v-for="item in announcementPagination.items.value"
            :key="item.id"
            class="ann-card"
            :class="`is-${announcementState(item).key}`"
          >
            <header class="ann-card__head">
              <div>
                <h3>{{ item.title }}</h3>
                <p>{{ item.body || "未填写正文" }}</p>
              </div>
              <span
                class="status-chip"
                :class="`is-${announcementState(item).tone}`"
              >
                {{ announcementState(item).label }}
              </span>
            </header>
            <div class="ann-card__meta">
              <span>{{ PLACEMENT_LABELS[announcementConfigOf(item).placement] }}</span>
              <span>{{ FREQUENCY_LABELS[announcementConfigOf(item).frequency] }}</span>
              <span>{{ LAYOUT_LABELS[announcementConfigOf(item).layout] }}</span>
              <span>{{ scheduleLabel(item) }}</span>
              <span class="tnum">{{ formatShortTime(item.createdAt) }}</span>
            </div>
            <footer class="ann-card__foot">
              <label class="content-switch">
                <span>{{ item.active === false ? "已停用" : "已启用" }}</span>
                <el-switch
                  :model-value="item.active !== false"
                  :loading="switchingAnnId === item.id"
                  @change="toggleAnnActive(item, Boolean($event))"
                />
              </label>
              <div class="content-actions">
                <el-button :icon="EditPen" @click="openAnnEdit(item)">编辑</el-button>
                <el-button
                  type="danger"
                  plain
                  :icon="Delete"
                  aria-label="删除公告"
                  @click="removeAnn(item)"
                />
              </div>
            </footer>
          </article>
        </div>

        <div
          v-else-if="activeTab === 'changelog' && changelogPagination.items.value.length"
          class="log-list"
        >
          <article
            v-for="entry in changelogPagination.items.value"
            :key="entry.id"
            class="log-card"
            :class="{ 'is-highlight': entry.highlight }"
          >
            <div class="log-card__version">
              <strong>{{ entry.version }}</strong>
              <span class="tnum">{{ entry.date }}</span>
            </div>
            <div class="log-card__body">
              <header>
                <h3>{{ entry.title }}</h3>
                <div class="log-card__tags">
                  <span
                    class="status-chip"
                    :class="entry.tag === 'feature' ? 'is-violet' : 'is-success'"
                  >
                    {{ TAG_LABELS[entry.tag] ?? entry.tag }}
                  </span>
                  <span v-if="entry.highlight" class="status-chip is-warning">
                    焦点
                  </span>
                </div>
              </header>
              <p>{{ entry.summary || "未填写摘要" }}</p>
              <span class="log-card__count tnum">
                {{ entry.items?.length || 0 }} 条改动
              </span>
            </div>
            <footer class="log-card__foot">
              <label class="content-switch">
                <span>焦点</span>
                <el-switch
                  :model-value="Boolean(entry.highlight)"
                  :loading="switchingLogId === entry.id"
                  @change="toggleLogHighlight(entry, Boolean($event))"
                />
              </label>
              <div class="content-actions">
                <el-button :icon="EditPen" @click="openLogEdit(entry)">编辑</el-button>
                <el-button
                  type="danger"
                  plain
                  :icon="Delete"
                  aria-label="删除更新说明"
                  @click="removeLog(entry)"
                />
              </div>
            </footer>
          </article>
        </div>

        <div v-else class="content-empty">
          <el-icon>
            <component :is="activeTab === 'announcements' ? Bell : Document" />
          </el-icon>
          <strong>
            {{
              activeTab === "announcements"
                ? announcements.length
                  ? "没有匹配的公告"
                  : "还没有公告"
                : changelog.length
                  ? "没有匹配的更新说明"
                  : "还没有更新说明"
            }}
          </strong>
          <span>
            {{
              hasFilters
                ? "调整筛选条件后再试"
                : activeTab === "announcements"
                  ? "发布后会出现在用户通知中心的公告页签"
                  : "发布版本后，打开中的用户端会收到刷新提示"
            }}
          </span>
          <el-button v-if="hasFilters" @click="clearFilters">清除筛选</el-button>
          <el-button v-else type="primary" :icon="Plus" @click="openCreate">
            {{ activeTab === "announcements" ? "发布公告" : "发布版本" }}
          </el-button>
        </div>
      </div>

      <footer class="content-footer">
        <CursorPager
          :has-prev="currentPager.hasPrev.value"
          :has-next="currentPager.hasNext.value"
          :loading="currentLoading"
          :page="currentPager.page.value"
          :count="currentPager.items.value.length"
          :total="currentPager.total.value"
          @prev="currentPager.prev"
          @next="currentPager.next"
        />
      </footer>
    </PageCard>

    <AdminDialog
      v-model="annDialogVisible"
      :title="annEditingId ? '编辑公告配置' : '发布公告'"
      subtitle="左侧编辑，右侧实时预览用户端效果"
      :icon="Bell"
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
      :title="logEditingId ? '编辑更新说明' : '发布版本'"
      subtitle="发布新版本后，已打开网站的用户会收到刷新提示"
      :icon="Document"
      width="min(960px, calc(100vw - 32px))"
      nested-scroll
      :confirm-text="logEditingId ? '保存' : '发布'"
      :confirm-loading="logSubmitting"
      @confirm="submitLog"
    >
      <el-form class="changelog-editor" label-position="top">
        <div class="changelog-editor__meta">
          <el-form-item label="版本号" required>
            <el-input
              v-model="logForm.version"
              maxlength="32"
              placeholder="如 3.3.1"
            />
            <small v-if="!logEditingId" class="changelog-editor__hint">
              已按上一版自动递增，可直接修改
            </small>
          </el-form-item>
          <el-form-item label="日期" required>
            <el-date-picker
              v-model="logForm.date"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="logForm.tag" style="width: 100%">
              <el-option label="新功能" value="feature" />
              <el-option label="体验优化" value="experience" />
            </el-select>
          </el-form-item>
          <el-form-item label="本期焦点">
            <div class="changelog-editor__highlight">
              <el-switch v-model="logForm.highlight" />
              <span>置顶到用户端更新页</span>
            </div>
          </el-form-item>
        </div>
        <el-form-item label="标题" required>
          <el-input
            v-model="logForm.title"
            maxlength="200"
            show-word-limit
            placeholder="这一版用户能感知到的变化"
          />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input
            v-model="logForm.summary"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            placeholder="一两段话说明这次发版的重点"
          />
        </el-form-item>
        <el-form-item class="changelog-editor__items" label="条目">
          <el-input
            v-model="logForm.itemsText"
            type="textarea"
            :autosize="{ minRows: 12, maxRows: 24 }"
            placeholder="一行一条改动说明，会显示在用户端更新时间线里"
          />
        </el-form-item>
      </el-form>
    </AdminDialog>
  </div>
</template>

<style scoped>
.content-admin-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.content-admin-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.content-admin-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.content-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.content-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.content-tab {
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
  cursor: pointer;
}

.content-tab em {
  font-style: normal;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}

.content-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}

.content-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}

.content-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.content-toolbar__right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.content-toolbar__right .el-input {
  width: 220px;
}

.content-toolbar__right .el-select {
  width: 128px;
}

.content-legend {
  flex: 0 0 auto;
  margin: 12px 0 14px;
  color: var(--ink-3);
  font-size: 12px;
}

.content-legend em {
  color: var(--ink);
  font-style: normal;
  font-weight: 700;
}

.content-board {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.ann-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  align-content: start;
  gap: 12px;
}

.ann-card,
.log-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 transparent;
}

.ann-card:hover,
.log-card:hover {
  border-color: var(--border-strong);
}

.ann-card.is-live {
  box-shadow: inset 3px 0 0 var(--success);
}

.ann-card.is-pending {
  box-shadow: inset 3px 0 0 var(--warning);
}

.ann-card.is-disabled,
.ann-card.is-ended {
  opacity: 0.78;
}

.log-card {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}

.log-card.is-highlight {
  border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
  background: color-mix(in srgb, var(--warning-soft) 45%, var(--surface-2));
}

.ann-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ann-card__head h3,
.log-card__body h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.35;
}

.log-card__body h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann-card__head p,
.log-card__body p {
  margin: 6px 0 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.log-card__body p {
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

.log-card__count {
  display: inline-flex;
  margin-top: 8px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}

.ann-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.ann-card__foot,
.log-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
}

.log-card__version {
  display: grid;
  gap: 4px;
}

.log-card__version strong {
  font-size: 18px;
  font-weight: 760;
  letter-spacing: -0.04em;
}

.log-card__version span {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.log-card__body header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.log-card__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.status-chip.is-success {
  background: var(--success-soft);
  color: var(--success);
}

.status-chip.is-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.status-chip.is-info {
  background: var(--info-soft);
  color: var(--info);
}

.status-chip.is-violet {
  background: var(--violet-soft);
  color: var(--violet);
}

.content-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.content-actions {
  display: flex;
  gap: 6px;
}

.content-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  min-height: 100%;
  color: var(--ink-3);
  text-align: center;
}

.content-empty .el-icon {
  font-size: 32px;
}

.content-empty strong {
  color: var(--ink);
}

.content-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  min-height: 52px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.log-list {
  display: grid;
  gap: 10px;
  align-content: start;
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

.changelog-editor {
  display: flex;
  flex-direction: column;
  min-height: min(72vh, 760px);
  padding: 8px 8px 4px;
}

.changelog-editor__meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.changelog-editor__highlight {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 10px;
}

.changelog-editor__highlight span {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.4;
}

.changelog-editor__hint {
  display: block;
  margin-top: 6px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.4;
}

.changelog-editor :deep(.el-form-item) {
  margin-bottom: 16px;
}

.changelog-editor :deep(.el-form-item__label) {
  color: var(--ink-2);
  font-weight: 650;
}

.changelog-editor :deep(.el-textarea__inner) {
  line-height: 1.55;
}

.changelog-editor__items {
  flex: 1 1 auto;
}

.changelog-editor__items :deep(.el-form-item__content),
.changelog-editor__items :deep(.el-textarea),
.changelog-editor__items :deep(.el-textarea__inner) {
  min-height: 280px;
}

@media (max-width: 860px) {
  .changelog-editor {
    min-height: 0;
  }

  .changelog-editor__meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}



</style>
