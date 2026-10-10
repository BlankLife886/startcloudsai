<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Connection, Delete, Plus, Refresh, Search } from "@element-plus/icons-vue";
import { request } from "@/request";
import ProviderPresetDialog from "./ProviderPresetDialog.vue";
import HelpTip from "@/components/HelpTip.vue";
import {
  ADAPTER_OPTIONS,
  apiRoot,
  AUTH_STYLE_OPTIONS,
  IMAGE_API_OPTIONS,
  normalizeAPIPath,
  type CatalogEntry,
  type ConnectionCheck,
  type ModelImport,
  type ModelProvider,
  type ProviderPreset,
  type ProviderRoute,
  type RequestCompat,
} from "./providerTypes";

interface ConfiguredModel {
  id: string;
  name: string;
  providerId: string;
  upstreamModel: string;
  kind: string;
  enabled: boolean;
}

const props = defineProps<{
  providers: ModelProvider[];
  models: ConfiguredModel[];
  /** Latest catalog entries per provider id, shared with the model editor. */
  catalogEntries: Record<string, CatalogEntry[] | undefined>;
}>();

const emit = defineEmits<{
  "import-models": [items: ModelImport[]];
  "edit-model": [modelId: string];
  "new-model": [item: ModelImport];
  "sync-media-tools": [providerId: string];
}>();

const selectedId = ref(props.providers[0]?.id || "");
const listSearch = ref("");
const presetDialogVisible = ref(false);

watch(
  () => props.providers.map((provider) => provider.id).join(","),
  () => {
    if (!props.providers.some((provider) => provider.id === selectedId.value)) {
      selectedId.value = props.providers[0]?.id || "";
    }
  },
);

const provider = computed(() => props.providers.find((item) => item.id === selectedId.value) || null);

const filteredProviders = computed(() => {
  const query = listSearch.value.trim().toLowerCase();
  if (!query) return props.providers;
  return props.providers.filter((item) =>
    [item.name, item.vendor, item.routes?.[0]?.baseUrl].some((value) => String(value || "").toLowerCase().includes(query)),
  );
});

function providerModelCount(providerId: string) {
  return props.models.filter((model) => model.providerId === providerId).length;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function syncPrimary(target: ModelProvider) {
  const primary = target.routes.find((route) => route.enabled) || target.routes[0];
  if (!primary) return;
  target.baseUrl = primary.baseUrl;
  target.apiKey = primary.apiKey;
  target.timeoutSecs = primary.timeoutSecs;
  target.maxConcurrency = primary.maxConcurrency;
}

function addFromPreset(preset: ProviderPreset) {
  const usedNames = new Set(props.providers.map((item) => item.name));
  let name = preset.id === "custom" ? "" : preset.name;
  for (let index = 2; name && usedNames.has(name); index += 1) name = `${preset.name} ${index}`;
  const route: ProviderRoute = {
    id: createId("route"), name: "默认线路", baseUrl: preset.baseUrl || "", apiKey: "",
    timeoutSecs: 300, maxConcurrency: 100, enabled: true,
  };
  const created: ModelProvider = {
    id: createId("provider"),
    name,
    adapter: preset.adapter,
    vendor: preset.id,
    apiPath: preset.apiPath || "",
    authStyle: preset.authStyle || "",
    imageApi: preset.imageApi ?? "",
    // Request rules are per model: the template's rules are copied onto each
    // model when it is imported (see importCompat).
    compat: null,
    baseUrl: route.baseUrl,
    apiKey: "",
    timeoutSecs: route.timeoutSecs,
    maxConcurrency: route.maxConcurrency,
    // A new provider stays off until its key is filled and tested.
    enabled: false,
    discoveredModels: [],
    routes: [route],
  };
  props.providers.push(created);
  selectedId.value = created.id;
  ElMessage.success(`已添加「${preset.name}」，填写 API Key 后测试并启用`);
}

// Presets are only read here to label providers and link to the vendor's key page.
const presets = ref<ProviderPreset[]>([]);
onMounted(async () => {
  try {
    presets.value = (await request<{ presets: ProviderPreset[] }>("/api/v1/admin/model-config/presets", { silent: true })).presets || [];
  } catch {
    presets.value = [];
  }
});
const vendorPreset = computed(() => presets.value.find((item) => item.id === provider.value?.vendor) || null);

async function removeProvider() {
  const target = provider.value;
  if (!target) return;
  if (providerModelCount(target.id)) {
    ElMessage.warning("该服务商仍有关联模型，请先删除或迁移模型");
    return;
  }
  await ElMessageBox.confirm(`确认删除服务商「${target.name || "未命名"}」？保存配置后生效。`, "删除服务商", { type: "warning" });
  const index = props.providers.findIndex((item) => item.id === target.id);
  if (index >= 0) props.providers.splice(index, 1);
}

// ---- connection fields -------------------------------------------------

const apiPathInput = ref("");
watch(provider, (value) => { apiPathInput.value = value?.apiPath || ""; }, { immediate: true });

function commitAPIPath() {
  if (!provider.value) return;
  provider.value.apiPath = normalizeAPIPath(apiPathInput.value);
  apiPathInput.value = provider.value.apiPath;
  invalidateCatalog();
}

const primaryBaseURL = computed(() => provider.value?.routes.find((route) => route.enabled)?.baseUrl || provider.value?.routes[0]?.baseUrl || "");
const endpointPreview = computed(() => {
  if (!provider.value) return "";
  const root = apiRoot(provider.value, primaryBaseURL.value);
  return root || "填写线路 Base URL 后显示";
});

function onAdapterChange() {
  if (!provider.value) return;
  if (provider.value.adapter !== "openai") provider.value.imageApi = "";
  invalidateCatalog();
}

// ---- routes ---------------------------------------------------------------

function addRoute() {
  provider.value?.routes.push({
    id: createId("route"), name: `线路 ${provider.value.routes.length + 1}`,
    baseUrl: provider.value.routes[0]?.baseUrl || "", apiKey: "", timeoutSecs: 300, maxConcurrency: 100, enabled: true,
  });
}

function removeRoute(routeId: string) {
  if (!provider.value) return;
  if (provider.value.routes.length <= 1) {
    ElMessage.warning("服务商至少需要一条线路");
    return;
  }
  provider.value.routes = provider.value.routes.filter((route) => route.id !== routeId);
  syncPrimary(provider.value);
}

function capacity(target: ModelProvider) {
  return target.routes.filter((route) => route.enabled).reduce((sum, route) => sum + (route.maxConcurrency || 0), 0);
}

// ---- connection test ------------------------------------------------------

const testing = ref("");
const testResults = reactive<Record<string, { routeName: string; ok: boolean; checks: ConnectionCheck[]; at: string }>>({});

function requestBody(target: ModelProvider) {
  syncPrimary(target);
  return JSON.parse(JSON.stringify(target));
}

async function testRoute(route: ProviderRoute) {
  const target = provider.value;
  if (!target || testing.value) return;
  if (!/^https?:\/\//.test(route.baseUrl.trim()) || !route.apiKey.trim()) {
    ElMessage.warning("请先填写该线路的 Base URL 和 API Key");
    return;
  }
  testing.value = route.id;
  try {
    const result = await request<{ ok: boolean; checks: ConnectionCheck[] }>("/api/v1/admin/model-config/connection-tests", {
      method: "POST",
      query: { routeId: route.id },
      body: requestBody(target),
    });
    testResults[target.id] = { routeName: route.name, ok: result.ok, checks: result.checks, at: new Date().toLocaleTimeString() };
    if (result.ok) ElMessage.success(`${route.name} 连接正常`);
  } catch (error) {
    testResults[target.id] = {
      routeName: route.name, ok: false, at: new Date().toLocaleTimeString(),
      checks: [{ name: "models", ok: false, latencyMs: 0, error: error instanceof Error ? error.message : "请求失败" }],
    };
  } finally {
    testing.value = "";
  }
}

const CHECK_LABELS: Record<string, string> = { models: "读取模型列表" };

// ---- catalog ----------------------------------------------------------------

const discovering = ref(false);
const catalogSearch = ref("");
const catalogKindFilter = ref<"all" | "chat" | "image" | "unset" | "unconfigured">("unconfigured");
const selection = reactive<Record<string, boolean>>({});
const kindOverrides = reactive<Record<string, "chat" | "image">>({});
const catalogWarning = reactive<Record<string, string>>({});

function invalidateCatalog() {
  if (provider.value) delete testResults[provider.value.id];
}

// kind is never guessed: "" until the admin picks 对话 or 生图. CRUN media
// tools keep their upstream-declared type because they cannot be chat/image.
interface CatalogRow {
  id: string;
  kind: "chat" | "image" | "image_tool" | "";
  importable: boolean;
  note: string;
  configured: ConfiguredModel[];
}

const catalogRows = computed<CatalogRow[]>(() => {
  const target = provider.value;
  if (!target) return [];
  const entries = props.catalogEntries[target.id];
  const byId = new Map((entries || []).map((entry) => [entry.id, entry]));
  const ids = [...new Set([...(target.discoveredModels || []), ...(entries || []).map((entry) => entry.id)])];
  return ids.map((id) => {
    const entry = byId.get(id);
    const configured = props.models.filter((model) => model.providerId === target.id && model.upstreamModel === id);
    const kind = (entry?.kind === "image_tool"
      ? "image_tool"
      : configured[0]?.kind || kindOverrides[`${target.id}/${id}`] || "") as CatalogRow["kind"];
    const crunMedia = target.adapter === "crun" && (kind === "image" || kind === "image_tool");
    return {
      id,
      kind,
      importable: (!entry || entry.compatible) && !crunMedia,
      note: entry && !entry.compatible ? entry.incompatibility || "暂不支持" : crunMedia ? "需读取实时参数，点「配置」" : "",
      configured,
    };
  }).sort((a, b) => Number(a.configured.length > 0) - Number(b.configured.length > 0) || a.id.localeCompare(b.id));
});

const visibleCatalogRows = computed(() => {
  const query = catalogSearch.value.trim().toLowerCase();
  return catalogRows.value.filter((row) => {
    if (query && !row.id.toLowerCase().includes(query)) return false;
    if (catalogKindFilter.value === "unconfigured") return !row.configured.length;
    if (catalogKindFilter.value === "all") return true;
    if (catalogKindFilter.value === "unset") return !row.kind;
    return row.kind === catalogKindFilter.value;
  });
});

const catalogCounts = computed(() => ({
  all: catalogRows.value.length,
  unconfigured: catalogRows.value.filter((row) => !row.configured.length).length,
  chat: catalogRows.value.filter((row) => row.kind === "chat").length,
  image: catalogRows.value.filter((row) => row.kind === "image").length,
  unset: catalogRows.value.filter((row) => !row.kind).length,
}));

const selectedRows = computed(() =>
  catalogRows.value.filter((row) => provider.value && selection[`${provider.value.id}/${row.id}`] && row.importable && !row.configured.length),
);

const allVisibleSelected = computed(() => {
  const rows = visibleCatalogRows.value.filter((row) => row.importable && !row.configured.length);
  return rows.length > 0 && rows.every((row) => selection[`${provider.value?.id}/${row.id}`]);
});

function toggleAllVisible(value: boolean) {
  if (!provider.value) return;
  for (const row of visibleCatalogRows.value) {
    if (row.importable && !row.configured.length) selection[`${provider.value.id}/${row.id}`] = value;
  }
}

async function discover() {
  const target = provider.value;
  if (!target) return;
  syncPrimary(target);
  if (!/^https?:\/\//.test(target.baseUrl.trim()) || !target.apiKey.trim()) {
    ElMessage.warning("请先填写线路的 Base URL 和 API Key");
    return;
  }
  discovering.value = true;
  try {
    const result = await request<{ models: string[]; entries?: CatalogEntry[]; warning?: string; modelCount: number }>(
      "/api/v1/admin/model-config/discoveries",
      { method: "POST", body: requestBody(target) },
    );
    target.discoveredModels = result.models || [];
    props.catalogEntries[target.id] = result.entries || [];
    catalogWarning[target.id] = result.warning || "";
    ElMessage.success(`已读取 ${result.modelCount ?? target.discoveredModels.length} 个模型`);
  } finally {
    discovering.value = false;
  }
}

/** The vendor template's request rules, applied to newly imported image models only. */
function importCompat(kind: string): RequestCompat | null {
  const rules = vendorPreset.value?.compat;
  return rules && kind === "image" && provider.value?.adapter !== "crun" ? JSON.parse(JSON.stringify(rules)) : null;
}

function setRowKind(row: CatalogRow, kind: "chat" | "image") {
  if (provider.value) kindOverrides[`${provider.value.id}/${row.id}`] = kind;
}

function importSelected() {
  const target = provider.value;
  if (!target || !selectedRows.value.length) return;
  const unset = selectedRows.value.filter((row) => !row.kind);
  if (unset.length) {
    ElMessage.warning(`还有 ${unset.length} 个选中的模型没有设定类型，请先选择「对话」或「生图」`);
    return;
  }
  const items = selectedRows.value.map((row) => ({
    providerId: target.id, upstreamModel: row.id, kind: row.kind as "chat" | "image", compat: importCompat(row.kind),
  }));
  emit("import-models", items);
  for (const row of selectedRows.value) delete selection[`${target.id}/${row.id}`];
}

</script>

<template>
  <div class="pw">
    <aside class="pw-list" aria-label="服务商列表">
      <div class="pw-list__head">
        <el-input v-model="listSearch" :prefix-icon="Search" placeholder="搜索服务商" clearable size="default" aria-label="搜索服务商" />
        <el-button type="primary" :icon="Plus" @click="presetDialogVisible = true">添加</el-button>
      </div>
      <div class="pw-list__items" role="listbox" aria-label="服务商">
        <button
          v-for="item in filteredProviders"
          :key="item.id"
          type="button"
          role="option"
          class="pw-item"
          :class="{ 'is-active': item.id === selectedId, 'is-off': !item.enabled }"
          :aria-selected="item.id === selectedId"
          @click="selectedId = item.id"
        >
          <span class="pw-item__avatar" :class="`is-${item.adapter}`" aria-hidden="true">{{ (item.name || "?").slice(0, 1).toUpperCase() }}</span>
          <span class="pw-item__copy">
            <strong>{{ item.name || "未命名服务商" }}</strong>
          </span>
          <span class="pw-item__state" :class="item.enabled ? 'is-on' : 'is-off'">{{ item.enabled ? "启用" : "停用" }}</span>
        </button>
        <p v-if="!filteredProviders.length" class="pw-empty">{{ providers.length ? "没有匹配的服务商" : "还没有服务商，点「添加」选择厂商模板" }}</p>
      </div>
    </aside>

    <section v-if="provider" class="pw-detail" :aria-label="`${provider.name || '服务商'} 设置`">
      <header class="pw-detail__head">
        <span class="pw-item__avatar is-lg" :class="`is-${provider.adapter}`" aria-hidden="true">{{ (provider.name || "?").slice(0, 1).toUpperCase() }}</span>
        <el-input v-model="provider.name" class="pw-name" placeholder="服务商名称，例如 Gemini 官方" aria-label="服务商名称" />
        <span v-if="provider.vendor" class="pw-chip">{{ vendorPreset?.name || provider.vendor }}</span>
        <a v-if="vendorPreset?.keyUrl" class="pw-chip is-link" :href="vendorPreset.keyUrl" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a>
        <div class="pw-detail__head-actions">
          <el-button
            size="small"
            :icon="Connection"
            :loading="testing === provider.routes[0]?.id"
            :disabled="!provider.routes.length || Boolean(testing)"
            @click="testRoute(provider.routes.find((route) => route.enabled) || provider.routes[0])"
          >检查主线路</el-button>
          <HelpTip content="只检查地址、路径和 Key 能否读取模型列表；对话和出图请在「模型目录」里按模型测试。新服务商建议先检查再启用。" />
          <label class="pw-switch"><span>启用</span><el-switch v-model="provider.enabled" aria-label="启用服务商" /></label>
          <el-tooltip content="删除服务商" placement="top">
            <button type="button" class="pw-icon-btn is-danger" aria-label="删除服务商" @click="removeProvider"><Delete /></button>
          </el-tooltip>
        </div>
      </header>

      <div class="pw-grid">
        <div v-if="testResults[provider.id]" class="pw-checks" role="status">
          <span class="pw-checks__title" :class="testResults[provider.id].ok ? 'is-ok' : 'is-fail'">
            {{ testResults[provider.id].ok ? "✓ 连接检查通过" : "✕ 连接检查未通过" }}
            <small>{{ testResults[provider.id].routeName }} · {{ testResults[provider.id].at }}</small>
          </span>
          <span
            v-for="check in testResults[provider.id].checks"
            :key="check.name"
            class="pw-check"
            :class="check.ok ? 'is-ok' : 'is-fail'"
            :title="check.ok ? check.detail : check.error"
          >
            <strong>{{ check.ok ? "✓" : "✕" }} {{ CHECK_LABELS[check.name] || check.name }}</strong>
            <span class="tnum">{{ check.latencyMs }} ms</span>
            <em>{{ check.ok ? check.detail : check.error }}</em>
          </span>
        </div>

        <section class="pw-card">
          <header><strong>连接方式</strong><HelpTip content="决定请求发到哪里、怎么带 Key。协议对应上游的接口规范；接口路径前缀接在每条线路的 Base URL 后面。" /></header>
          <div class="pw-fields">
            <label class="pw-field">
              <span>调用协议<HelpTip content="OpenAI 兼容适用于大多数中转；Gemini、百炼、MiniMax 走各自原生接口；CRUN 为 CRUN 任务协议。切换会清空已读取的模型目录。" /></span>
              <el-select v-model="provider.adapter" aria-label="调用协议" @change="onAdapterChange">
                <el-option v-for="option in ADAPTER_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </label>
            <label class="pw-field">
              <span>接口路径前缀<HelpTip content="留空使用协议默认值：OpenAI 兼容 /v1，Gemini /v1beta，CRUN 与百炼 /api/v1。有的中转需要额外前缀，例如 /v1beta/openai。" /></span>
              <el-input
                v-model="apiPathInput"
                :placeholder="provider.adapter === 'crun' || provider.adapter === 'dashscope' ? '留空：/api/v1' : provider.adapter === 'gemini' ? '留空：/v1beta' : '留空：自动 /v1'"
                aria-label="接口路径前缀"
                @change="commitAPIPath"
              />
            </label>
            <label class="pw-field">
              <span>鉴权方式<HelpTip content="Key 放在哪个请求头里；协议默认通常即可，个别中转要求特定写法。" /></span>
              <el-select
                :model-value="provider.authStyle || 'default'"
                aria-label="鉴权方式"
                @update:model-value="(value: string) => (provider!.authStyle = (value === 'default' ? '' : value) as ModelProvider['authStyle'])"
              >
                <el-option v-for="option in AUTH_STYLE_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'default'" />
              </el-select>
            </label>
            <label v-if="provider.adapter === 'openai'" class="pw-field">
              <span>生图接口<HelpTip :content="IMAGE_API_OPTIONS.map((option) => `${option.label}：${option.hint}`).join('；')" /></span>
              <el-select
                :model-value="provider.imageApi || 'auto'"
                aria-label="生图接口"
                @update:model-value="(value: string) => (provider!.imageApi = value === 'auto' ? '' : 'standard')"
              >
                <el-option v-for="option in IMAGE_API_OPTIONS" :key="option.value" :label="option.label" :value="option.value || 'auto'">
                  <span>{{ option.label }}</span><small class="pw-option-hint">{{ option.hint }}</small>
                </el-option>
              </el-select>
            </label>
          </div>
          <div class="pw-endpoint">
            <span>接口根地址</span>
            <code>{{ endpointPreview }}</code>
            <small v-if="provider.adapter === 'openai'">对话 <code>/chat/completions</code> · 生图 <code>/images/generations</code> · 目录 <code>/models</code></small>
            <small v-else-if="provider.adapter === 'dashscope'">生图 <code>/services/aigc/multimodal-generation/generation</code> · 对话与目录走 Base URL 下的 <code>/compatible-mode/v1</code></small>
            <small v-else-if="provider.adapter === 'minimax'">生图 <code>/image_generation</code> · 对话 <code>/chat/completions</code> · 目录 <code>/models</code></small>
            <small v-else-if="provider.adapter === 'gemini'">生图 <code>/models/{模型}:generateContent</code>（Imagen 为 <code>:predict</code>）· 对话 <code>/openai/chat/completions</code> · 目录 <code>/models</code></small>
          </div>
        </section>

        <section class="pw-card is-wide">
          <header>
            <strong>线路</strong><HelpTip content="按顺序优先使用第一条启用线路，失败或满载时换下一条。超时不含排队，0 使用默认值（OpenAI 300 秒，CRUN 图片 1200 秒）。Key 保存后只显示末四位，留空表示沿用已保存的 Key。" />
            <small>已启用 {{ provider.routes.filter((route) => route.enabled).length }} 条 · 总并发 {{ capacity(provider) }}</small>
            <el-button size="small" :icon="Plus" class="pw-card__action" @click="addRoute">添加线路</el-button>
          </header>
          <table class="pw-table">
            <thead>
              <tr><th>名称</th><th>Base URL</th><th>API Key</th><th class="is-num">并发</th><th class="is-num">超时(秒)</th><th>启用</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="(route, routeIndex) in provider.routes" :key="route.id">
                <td class="col-name"><el-input v-model="route.name" size="small" aria-label="线路名称" /></td>
                <td class="col-url">
                  <el-input
                    v-model="route.baseUrl"
                    size="small"
                    :placeholder="provider.adapter === 'crun' ? 'https://api.crun.ai' : 'https://api.example.com'"
                    aria-label="Base URL"
                    @change="routeIndex === 0 && invalidateCatalog()"
                  />
                </td>
                <td class="col-key">
                  <el-input
                    v-model="route.apiKey"
                    size="small"
                    type="password"
                    show-password
                    :placeholder="route.apiKey.startsWith('****') ? route.apiKey : '填写 API Key'"
                    aria-label="API Key"
                  />
                </td>
                <td class="col-num"><el-input-number v-model="route.maxConcurrency" size="small" :min="1" :max="10000" :step="10" controls-position="right" aria-label="并发容量" /></td>
                <td class="col-num"><el-input-number v-model="route.timeoutSecs" size="small" :min="0" :max="1800" :step="30" controls-position="right" aria-label="请求超时" /></td>
                <td><el-switch v-model="route.enabled" size="small" aria-label="启用线路" /></td>
                <td class="col-actions">
                  <el-button size="small" text :loading="testing === route.id" :disabled="Boolean(testing) && testing !== route.id" @click="testRoute(route)">测试</el-button>
                  <button v-if="provider.routes.length > 1" type="button" class="pw-icon-btn is-danger" aria-label="删除线路" @click="removeRoute(route.id)"><Delete /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>


        <section class="pw-card is-wide">
          <header>
            <strong>上游模型</strong><HelpTip content="读取上游 /models，勾选后批量导入为站内模型；导入后默认停用，设置积分后再开放。对话或生图类型由你在这里选定。" />
            <small>
              {{ catalogRows.length ? `共 ${catalogCounts.all} 个，未配置 ${catalogCounts.unconfigured} 个` : "还没有读取" }}
              <template v-if="catalogWarning[provider.id]"> · {{ catalogWarning[provider.id] }}</template>
            </small>
            <div class="pw-card__action">
              <el-button v-if="provider.adapter === 'crun' && catalogRows.length" size="small" @click="emit('sync-media-tools', provider.id)">同步全部媒体工具</el-button>
              <el-button size="small" :icon="Refresh" :loading="discovering" @click="discover">{{ catalogRows.length ? "重新读取" : "读取模型" }}</el-button>
            </div>
          </header>
          <template v-if="catalogRows.length">
            <div class="pw-catalog-bar">
              <div class="pw-segment" role="tablist" aria-label="目录筛选">
                <button
                  v-for="item in ([
                    { id: 'unconfigured', label: '未配置' },
                    { id: 'all', label: '全部' },
                    { id: 'chat', label: '对话' },
                    { id: 'image', label: '生图' },
                    { id: 'unset', label: '未设定类型' },
                  ] as const)"
                  :key="item.id"
                  type="button"
                  role="tab"
                  :aria-selected="catalogKindFilter === item.id"
                  :class="{ 'is-active': catalogKindFilter === item.id }"
                  @click="catalogKindFilter = item.id"
                >{{ item.label }} <em class="tnum">{{ catalogCounts[item.id] }}</em></button>
              </div>
              <el-input v-model="catalogSearch" size="small" :prefix-icon="Search" clearable placeholder="搜索模型 ID" class="pw-catalog-search" aria-label="搜索模型 ID" />
              <el-button type="primary" size="small" :disabled="!selectedRows.length" @click="importSelected">导入选中（{{ selectedRows.length }}）</el-button>
            </div>
            <div class="pw-catalog-scroll">
              <table class="pw-table is-catalog">
                <thead>
                  <tr>
                    <th class="col-check"><el-checkbox :model-value="allVisibleSelected" aria-label="全选" @change="(value: unknown) => toggleAllVisible(value === true)" /></th>
                    <th>上游模型 ID</th><th>类型</th><th>状态</th><th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in visibleCatalogRows" :key="row.id" :class="{ 'is-configured': row.configured.length }">
                    <td class="col-check">
                      <el-checkbox
                        v-model="selection[`${provider.id}/${row.id}`]"
                        :disabled="!row.importable || row.configured.length > 0"
                        :aria-label="`选择 ${row.id}`"
                      />
                    </td>
                    <td class="mono">{{ row.id }}</td>
                    <td>
                      <span v-if="row.kind === 'image_tool'" class="pw-kind is-tool">媒体工具</span>
                      <div v-else class="pw-kind-switch" role="group" :aria-label="`${row.id} 类型`">
                        <button type="button" :class="{ 'is-active': row.kind === 'chat' }" :disabled="row.configured.length > 0" @click="setRowKind(row, 'chat')">对话</button>
                        <button type="button" :class="{ 'is-active': row.kind === 'image' }" :disabled="row.configured.length > 0" @click="setRowKind(row, 'image')">生图</button>
                      </div>
                    </td>
                    <td>
                      <template v-if="row.configured.length">
                        <button v-for="model in row.configured" :key="model.id" type="button" class="pw-configured" @click="emit('edit-model', model.id)">
                          {{ model.name }}<em>{{ model.enabled ? "已启用" : "未启用" }}</em>
                        </button>
                      </template>
                      <span v-else class="pw-muted-inline">{{ row.note || "未配置" }}</span>
                    </td>
                    <td class="col-actions">
                      <el-button
                        v-if="!row.configured.length && row.kind !== 'image_tool'"
                        size="small"
                        text
                        :disabled="!row.kind"
                        :title="row.kind ? '' : '先选择对话或生图'"
                        @click="emit('new-model', { providerId: provider.id, upstreamModel: row.id, kind: row.kind as 'chat' | 'image', compat: importCompat(row.kind) })"
                      >配置</el-button>
                    </td>
                  </tr>
                  <tr v-if="!visibleCatalogRows.length"><td colspan="5" class="pw-empty">没有符合筛选的模型</td></tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>
      </div>
    </section>

    <section v-else class="pw-detail is-empty">
      <el-empty description="选择左侧服务商，或点「添加」从厂商模板创建" :image-size="64" />
    </section>

    <ProviderPresetDialog v-model="presetDialogVisible" @pick="addFromPreset" />
  </div>
</template>

<style scoped>
.pw {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  height: 100%;
}

.pw-list {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  padding-right: 14px;
  border-right: 1px solid var(--border);
}

.pw-list__head {
  display: flex;
  gap: 8px;
}

.pw-list__items {
  display: grid;
  align-content: start;
  gap: 4px;
  overflow-y: auto;
  min-height: 0;
}

.pw-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pw-item:hover {
  background: var(--surface-2);
}

.pw-item.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent-soft);
}

.pw-item.is-off .pw-item__copy strong {
  color: var(--ink-3);
}

.pw-item__avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--accent-ink);
  background: var(--accent-soft);
  font-size: 13px;
  font-weight: 700;
}

.pw-item__avatar.is-crun {
  color: var(--warning);
  background: var(--warning-soft);
}

.pw-item__avatar.is-lg {
  width: 36px;
  height: 36px;
  font-size: 15px;
}

.pw-item__copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.pw-item__copy strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-item__copy small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-item__state {
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
}

.pw-item__state.is-on {
  color: var(--success);
  background: var(--success-soft);
}

.pw-item__state.is-off {
  color: var(--ink-3);
  background: var(--surface-3);
}

.pw-detail {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.pw-detail.is-empty {
  place-items: center;
}

.pw-detail__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.pw-name {
  max-width: 340px;
}

.pw-name :deep(.el-input__inner) {
  font-size: 15px;
  font-weight: 650;
}

.pw-chip {
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  color: var(--ink-2);
  background: var(--surface-2);
  font-size: 12px;
  white-space: nowrap;
}

.pw-chip.is-link {
  color: var(--accent);
  text-decoration: none;
}

.pw-detail__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.pw-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-size: 13px;
}

.pw-icon-btn {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}

.pw-icon-btn svg {
  width: 14px;
  height: 14px;
}

.pw-icon-btn.is-danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.pw-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 10px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 2px;
}

.pw-card {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.pw-card.is-wide {
  grid-column: 1 / -1;
}

.pw-card > header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}

.pw-card > header strong {
  color: var(--ink);
  font-size: 13px;
}

.pw-card > header small {
  color: var(--ink-3);
  font-size: 12px;
}

.pw-card__action {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
}

.pw-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 12px;
}

.pw-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.pw-field > span {
  display: inline-flex;
  align-items: center;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}

.pw-option-hint {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: 11px;
}

.pw-endpoint {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--surface-2);
  font-size: 12px;
}

.pw-endpoint > span {
  color: var(--ink-3);
}

.pw-endpoint > code {
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 12px;
}

.pw-endpoint small {
  color: var(--ink-3);
}

.pw-checks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pw-checks__title {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
}

.pw-checks__title small {
  color: var(--ink-3);
  font-weight: 400;
}

.is-ok {
  color: var(--success);
}

.is-fail {
  color: var(--danger);
}

.pw-check {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 420px;
  min-width: 0;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
}

.pw-check.is-ok {
  background: var(--success-soft);
}

.pw-check.is-fail {
  background: var(--danger-soft);
}

.pw-check span {
  color: var(--ink-3);
}

.pw-check strong,
.pw-check span {
  flex: none;
  white-space: nowrap;
}

.pw-check em {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-muted {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
}

.pw-muted-inline {
  color: var(--ink-3);
}

.pw-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.pw-table th {
  padding: 4px 6px;
  color: var(--ink-3);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.pw-table td {
  padding: 4px 6px;
  border-top: 1px solid var(--border);
  vertical-align: middle;
}

.pw-table .col-name {
  width: 130px;
}

.pw-table .col-key {
  width: 240px;
}

.pw-table .col-num {
  width: 112px;
}

.pw-table .col-num :deep(.el-input-number) {
  width: 100%;
}

.pw-table .col-actions {
  width: 1%;
  white-space: nowrap;
}

.pw-table .col-check {
  width: 32px;
}

.pw-table :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  border-color: var(--accent);
  background: var(--accent);
}

.pw-table.is-catalog td {
  padding: 3px 6px;
}

.pw-table tr.is-configured td.mono {
  color: var(--ink-3);
}

.pw-catalog-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pw-catalog-search {
  max-width: 240px;
}

.pw-catalog-bar > .el-button {
  margin-left: auto;
}

.pw-catalog-scroll {
  min-width: 0;
}

.pw-segment {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--surface-2);
}

.pw-segment button {
  padding: 3px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.pw-segment button em {
  color: var(--ink-3);
  font-style: normal;
}

.pw-segment button.is-active {
  color: var(--ink);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.pw-kind-switch {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.pw-kind-switch button {
  padding: 1px 8px;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.pw-kind-switch button.is-active {
  color: var(--accent-on);
  background: var(--accent);
}

.pw-kind-switch button:disabled {
  cursor: default;
  opacity: 0.6;
}

.pw-kind.is-tool {
  color: var(--warning);
  font-size: 11px;
}

.pw-configured {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 6px;
  padding: 1px 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.pw-configured em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
}

.pw-empty {
  margin: 0;
  padding: 18px 8px;
  color: var(--ink-3);
  font-size: 12px;
  text-align: center;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 1280px) {
  .pw-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .pw {
    grid-template-columns: 1fr;
  }

  .pw-list {
    max-height: 260px;
    padding-right: 0;
    border-right: 0;
  }
}
</style>
