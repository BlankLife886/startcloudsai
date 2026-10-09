<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Collection,
  Delete,
  EditPen,
  Plus,
  Refresh,
  Search,
} from "@element-plus/icons-vue";
import draggable from "vuedraggable";
import AdminDialog from "@/components/AdminDialog.vue";
import PlanVersionHistory from "@/components/PlanVersionHistory.vue";
import { normalizeList, request } from "@/request";
import { formatPoints, formatTime, normalizePoints } from "@/utils";

type PlanKind = "topup" | "subscription";

interface Plan {
  rechargePolicy?: { pointsPerYuan: number; priceLockMinYuan: number } | null;
  subscriptionPolicy?: { version: number; series: string; tier: number; channels: string[]; featureKeys: string[]; modelIds: string[]; apiModelIds?: string[]; refundWindowHours?: number; lockModelPrices?: boolean; allowTopupPriceLock?: boolean; concurrencyBonus?: number; canvasProjectBonus?: number; assistantConversationBonus?: number };
  revision: number;
  priceLockEligible: boolean;
  id: string;
  code: string;
  name: string;
  description: string;
  badge: string;
  kind: PlanKind;
  priceCents: number;
  grantCents: number;
  bonusCents: number;
  durationDays: number;
  dailyGrantCents: number;
  features: string[];
  active: boolean;
  recommended: boolean;
  sort: number;
  orderCount: number;
  subscriptionCount: number;
  deletable: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PlanForm {
  lockModelPrices: boolean;
  allowTopupPriceLock: boolean;
  priceLockEligible: boolean;
  concurrencyBonus: number;
  canvasProjectBonus: number;
  assistantConversationBonus: number;
  series: string;
  tier: number;
  channels: string[];
  featureKeys: string[];
  modelIds: string[];
  apiModelIds: string[];
  refundWindowHours: number;
  code: string;
  name: string;
  description: string;
  badge: string;
  kind: PlanKind;
  priceYuan: number;
  grantPoints: number;
  bonusPoints: number;
  durationDays: number;
  dailyGrantPoints: number;
  featuresText: string;
  active: boolean;
  recommended: boolean;
  sort: number;
}

const plans = ref<Plan[]>([]);
const baseConcurrency = ref(4);
const baseCanvasProjects = ref(30);
const baseAssistantConversations = ref(40);
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const switchingId = ref("");
const search = ref("");
const kindTab = ref<PlanKind>("subscription");
const statusFilter = ref<"" | "active" | "inactive">("");

function defaultForm(): PlanForm {
  return {
    lockModelPrices: true, allowTopupPriceLock: false, priceLockEligible: false, concurrencyBonus: 0, canvasProjectBonus: 0, assistantConversationBonus: 0,
    series: "general", tier: 1, channels: ["web", "api"], featureKeys: [], modelIds: [], apiModelIds: [], refundWindowHours: 3,
    code: "",
    name: "",
    description: "",
    badge: "",
    kind: "topup",
    priceYuan: 0,
    grantPoints: 100,
    bonusPoints: 0,
    durationDays: 30,
    dailyGrantPoints: 20,
    featuresText: "全平台创作工具通用\n积分实时进入用户钱包",
    active: true,
    recommended: false,
    sort: 0,
  };
}

const form = reactive<PlanForm>(defaultForm());
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const dialogTitle = computed(() => (editingId.value ? "编辑套餐" : "新增套餐"));

const searchedPlans = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return plans.value.filter((plan) => {
    if (statusFilter.value === "active" && !plan.active) return false;
    if (statusFilter.value === "inactive" && plan.active) return false;
    if (!keyword) return true;
    return [plan.name, plan.code, plan.description, plan.badge].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(keyword),
    );
  });
});

const kindTabs = computed(() => [
  {
    key: "subscription" as const,
    title: "订阅计划",
    count: searchedPlans.value.filter((plan) => plan.kind === "subscription")
      .length,
  },
  {
    key: "topup" as const,
    title: "积分包",
    count: searchedPlans.value.filter((plan) => plan.kind === "topup").length,
  },
]);

const visiblePlans = computed(() =>
  searchedPlans.value
    .filter((plan) => plan.kind === kindTab.value)
    .slice()
    .sort(
      (left, right) =>
        (left.sort || 0) - (right.sort || 0) ||
        String(left.createdAt || "").localeCompare(String(right.createdAt || "")) ||
        left.id.localeCompare(right.id),
    ),
);

const dragPlans = ref<Plan[]>([]);
const sorting = ref(false);

watch(
  visiblePlans,
  (next) => {
    if (sorting.value) return;
    dragPlans.value = next.map((plan) => plan);
  },
  { immediate: true },
);

async function loadPlans() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await request<Plan[] | { items: Plan[]; baseConcurrency?: number; baseCanvasProjects?: number; baseAssistantConversations?: number }>(
      "/api/v1/admin/plans",
      { silent: true },
    );
    plans.value = normalizeList(data).items;
    if (!Array.isArray(data)) {
      baseConcurrency.value = data.baseConcurrency ?? 4;
      baseCanvasProjects.value = data.baseCanvasProjects ?? 30;
      baseAssistantConversations.value = data.baseAssistantConversations ?? 40;
    }
  } catch (error) {
    plans.value = [];
    loadError.value = error instanceof Error ? error.message : "套餐读取失败";
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, defaultForm());
  form.kind = kindTab.value;
  const sameKind = plans.value.filter((plan) => plan.kind === kindTab.value);
  form.sort = sameKind.length
    ? Math.max(...sameKind.map((plan) => plan.sort || 0)) + 10
    : 10;
  dialogOpen.value = true;
}

function openEdit(row: unknown) {
  const plan = row as Plan;
  editingId.value = plan.id;
  Object.assign(form, {
    ...defaultForm(),
    priceLockEligible: plan.priceLockEligible ?? false,
    lockModelPrices: plan.subscriptionPolicy?.lockModelPrices ?? true,
    allowTopupPriceLock: plan.subscriptionPolicy?.allowTopupPriceLock ?? false,
    concurrencyBonus: plan.subscriptionPolicy?.concurrencyBonus ?? 0,
    canvasProjectBonus: plan.subscriptionPolicy?.canvasProjectBonus ?? 0,
    assistantConversationBonus: plan.subscriptionPolicy?.assistantConversationBonus ?? 0,
    code: plan.code,
    name: plan.name,
    description: plan.description || "",
    badge: plan.badge || "",
    kind: plan.kind,
    priceYuan: Number(plan.priceCents || 0) / 100,
    grantPoints: Number(plan.grantCents || 0),
    bonusPoints: Number(plan.bonusCents || 0),
    durationDays: Number(plan.durationDays || 0),
    dailyGrantPoints: Number(plan.dailyGrantCents || 0),
    featuresText: (plan.features || []).join("\n"),
    series: plan.subscriptionPolicy?.series || "general",
    tier: plan.subscriptionPolicy?.tier || 1,
    channels: plan.subscriptionPolicy?.channels || ["web", "api"],
    featureKeys: plan.subscriptionPolicy?.featureKeys || [],
    modelIds: [...(plan.subscriptionPolicy?.modelIds || [])],
    apiModelIds: plan.subscriptionPolicy?.apiModelIds || [],
    refundWindowHours: plan.subscriptionPolicy?.refundWindowHours ?? 24,
    active: plan.active,
    recommended: plan.recommended,
    sort: Number(plan.sort || 0),
  });
  dialogOpen.value = true;
}

function parseFeatures() {
  return Array.from(
    new Set(
      form.featuresText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function validateForm() {
  form.code = form.code.trim().toLowerCase();
  form.name = form.name.trim();
  form.description = form.description.trim();
  form.badge = form.badge.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.code)) {
    ElMessage.warning("套餐代码仅支持小写字母、数字、短横线和下划线");
    return false;
  }
  if (!form.name || form.name.length > 128) {
    ElMessage.warning("请填写 1-128 字的套餐名称");
    return false;
  }
  if (form.description.length > 500 || form.badge.length > 24) {
    ElMessage.warning("套餐说明最多 500 字，角标最多 24 字");
    return false;
  }
  if (!Number.isFinite(form.priceYuan) || form.priceYuan < 0) {
    ElMessage.warning("销售价格不能为负数");
    return false;
  }
  if (form.kind === "topup" && form.grantPoints + form.bonusPoints <= 0) {
    ElMessage.warning("积分包的发放积分必须大于 0");
    return false;
  }
  if (
    form.kind === "subscription" &&
    (form.durationDays <= 0 || form.dailyGrantPoints <= 0)
  ) {
    ElMessage.warning("订阅套餐必须设置有效天数和每日发放积分");
    return false;
  }
  const features = parseFeatures();
  if (features.length > 12 || features.some((item) => item.length > 120)) {
    ElMessage.warning("最多配置 12 条权益，单条最多 120 字");
    return false;
  }
  return true;
}

function buildPayload() {
  return {
    priceLockEligible: form.kind === 'topup' && form.priceLockEligible,
    code: form.code,
    name: form.name,
    description: form.description,
    badge: form.badge,
    kind: form.kind,
    priceCents: Math.round(Number(form.priceYuan || 0) * 100),
    grantCents: form.kind === "topup" ? normalizePoints(form.grantPoints) : 0,
    bonusCents: form.kind === "topup" ? normalizePoints(form.bonusPoints) : 0,
    durationDays:
      form.kind === "subscription" ? Math.round(form.durationDays) : 0,
    dailyGrantCents:
      form.kind === "subscription" ? normalizePoints(form.dailyGrantPoints) : 0,
    features: parseFeatures(),
    subscriptionPolicy: { version: 2, series: form.series.trim(), tier: form.tier, channels: form.channels, featureKeys: form.featureKeys, modelIds: planModelIds(), apiModelIds: planModelIds().length && form.channels.includes("api") ? form.apiModelIds : [], refundWindowHours: form.refundWindowHours, lockModelPrices: form.lockModelPrices, allowTopupPriceLock: form.lockModelPrices && form.allowTopupPriceLock, concurrencyBonus: form.concurrencyBonus, canvasProjectBonus: form.canvasProjectBonus, assistantConversationBonus: form.assistantConversationBonus },
    active: form.active,
    recommended: form.recommended,
    sort: Math.max(0, Math.round(Number(form.sort || 0))),
  };
}

async function savePlan() {
  if (saving.value || !validateForm()) return;
  saving.value = true;
  try {
    const target = editingId.value
      ? `/api/v1/admin/plans/${editingId.value}`
      : "/api/v1/admin/plans";
    await request<Plan>(target, {
      method: editingId.value ? "PATCH" : "POST",
      body: buildPayload(),
    });
    ElMessage.success(editingId.value ? "套餐已更新" : "套餐已创建");
    dialogOpen.value = false;
    await loadPlans();
  } finally {
    saving.value = false;
  }
}

const versionsOpen = ref(false);
const versionsPlan = ref<Plan | null>(null);
function showVersions(plan: Plan) {
  versionsPlan.value = plan;
  versionsOpen.value = true;
}

async function toggleActive(row: unknown, active: boolean) {
  const plan = row as Plan;
  if (switchingId.value) return;
  const previous = plan.active;
  plan.active = active;
  switchingId.value = plan.id;
  try {
    await request(`/api/v1/admin/plans/${plan.id}`, {
      method: "PATCH",
      body: { active },
    });
    ElMessage.success(active ? "套餐已上架" : "套餐已下架");
    await loadPlans();
  } catch {
    plan.active = previous;
  } finally {
    switchingId.value = "";
  }
}

async function removePlan(row: unknown) {
  const plan = row as Plan;
  if (!plan.deletable) {
    ElMessage.warning("套餐已有历史订单或订阅，只能下架，不能删除");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认永久删除套餐“${plan.name}”？此操作不可撤销。`,
      "删除套餐",
      {
        type: "warning",
        confirmButtonText: "永久删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }
  await request(`/api/v1/admin/plans/${plan.id}`, { method: "DELETE" });
  ElMessage.success("套餐已删除");
  await loadPlans();
}

function resetFilters() {
  search.value = "";
  statusFilter.value = "";
}

const PLAN_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function onDragChange(event: { moved?: unknown }) {
  if (!event?.moved) return;
  void persistOrder();
}

async function persistOrder() {
  const ids = dragPlans.value.map((plan) => String(plan.id || "").trim());
  const current = visiblePlans.value.map((plan) => plan.id);
  if (
    ids.length < 2 ||
    ids.length !== dragPlans.value.length ||
    ids.some((id) => !PLAN_ID_RE.test(id)) ||
    sorting.value ||
    ids.every((id, index) => id === current[index])
  ) {
    return;
  }
  sorting.value = true;
  try {
    await request("/api/v1/admin/plan-order", {
      method: "PATCH",
      silent: true,
      body: { kind: kindTab.value, ids },
    });
    dragPlans.value.forEach((plan, index) => {
      plan.sort = (index + 1) * 10;
      const current = plans.value.find((item) => item.id === plan.id);
      if (current) current.sort = plan.sort;
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "套餐排序保存失败");
    await loadPlans();
  } finally {
    sorting.value = false;
  }
}

function formatMoney(cents: number) {
  return `¥${(Number(cents || 0) / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function valueSummary(row: unknown) {
  const plan = row as Plan;
  if (plan.rechargePolicy) return `自定义金额充值（已下线）· 每1元 ${formatPoints(plan.rechargePolicy.pointsPerYuan)} 积分`;
  if (plan.kind === "subscription") {
    return `${plan.durationDays} 天 · 每24小时 ${formatPoints(plan.dailyGrantCents)} 积分`;
  }
  const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0);
  return `${formatPoints(total)} 积分${plan.bonusCents > 0 ? `（赠 ${formatPoints(plan.bonusCents)}）` : ""}`;
}

function badgeTone(badge: string) {
  if (/热门|hot|popular/i.test(badge)) return "is-hot";
  if (/限时|limited/i.test(badge)) return "is-limited";
  if (/新品|new/i.test(badge)) return "is-new";
  return "";
}

type APIModelOption = { id: string; apiName: string; kind: string; status: string };
const apiModels = ref<APIModelOption[]>([]);
function planModelIds() {
  return Array.from(new Set(form.modelIds.map(v => v.trim()).filter(Boolean)));
}
const limitsModels = computed(() => planModelIds().length > 0);
async function loadAPIModels() {
  try {
    const res = await request<{ items: APIModelOption[] }>("/api/v1/admin/developer-api/models");
    apiModels.value = (res.items || []).filter(item => item.status !== "retired");
  } catch {
    apiModels.value = [];
  }
}

type SiteModelOption = { id: string; name: string; upstreamModel: string; kind: string; enabled: boolean; status?: string };
const siteModels = ref<SiteModelOption[]>([]);
const siteModelKinds: Record<string, string> = { chat: "对话模型", image: "生图模型", image_tool: "图片工具" };
// Grouped by kind for the picker; ids saved on a plan but no longer in the
// catalogue stay selectable so editing never silently drops them.
const siteModelGroups = computed(() => {
  const known = new Set(siteModels.value.map(model => model.id));
  const groups = Object.entries(siteModelKinds).map(([kind, label]) => ({
    label,
    options: siteModels.value.filter(model => model.kind === kind),
  }));
  const others = siteModels.value.filter(model => !siteModelKinds[model.kind]);
  if (others.length) groups.push({ label: "其他", options: others });
  const missing = form.modelIds.filter(id => !known.has(id));
  if (missing.length) groups.push({ label: "已不在模型目录", options: missing.map(id => ({ id, name: id, upstreamModel: "", kind: "", enabled: false })) });
  return groups.filter(group => group.options.length);
});
async function loadSiteModels() {
  try {
    const res = await request<{ models?: SiteModelOption[] }>("/api/v1/admin/model-config", { silent: true });
    siteModels.value = (res.models || []).filter(model => model.status !== "retired");
  } catch {
    siteModels.value = [];
  }
}

const sceneOptions = [
  { value: "text_to_image", label: "文生图" },
  { value: "ai_assistant", label: "AI助手" },
  { value: "ui_design", label: "UI设计" },
  { value: "ecommerce_design", label: "电商创作" },
  { value: "illustration_coloring", label: "插画上色" },
  { value: "model_sheet", label: "角色设定" },
  { value: "game_art", label: "游戏美术" },
  { value: "background_remove", label: "背景移除" },
  { value: "infinite_canvas", label: "无限画布" },
  { value: "developer_api_image", label: "API 调用生图" },
  { value: "developer_api_chat", label: "API 调用对话" },
];

onMounted(() => { loadPlans(); loadAPIModels(); loadSiteModels(); });
</script>

<template>
  <div class="page plans-page">
    <PageCard>
      <div class="plans-toolbar">
        <div class="plans-tabs" role="tablist" aria-label="套餐类型">
          <button
            v-for="tab in kindTabs"
            :key="tab.key"
            type="button"
            role="tab"
            class="plans-tab"
            :class="{ 'is-active': kindTab === tab.key }"
            :aria-selected="kindTab === tab.key"
            @click="kindTab = tab.key"
          >
            {{ tab.title }}
            <em>{{ tab.count }}</em>
          </button>
        </div>
        <div class="plans-toolbar__right">
          <el-input
            v-model="search"
            :prefix-icon="Search"
            placeholder="搜索套餐名称、代码或说明"
            clearable
          />
          <el-select v-model="statusFilter" placeholder="上架状态">
            <el-option label="全部状态" value="" />
            <el-option label="已上架" value="active" />
            <el-option label="已下架" value="inactive" />
          </el-select>
          <el-button v-if="search || statusFilter" @click="resetFilters">
            清除筛选
          </el-button>
          <el-button :icon="Refresh" :loading="loading" @click="loadPlans">
            刷新
          </el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">
            新增套餐
          </el-button>
        </div>
      </div>

      <div v-if="loadError" class="plans-error">
        <el-icon><Collection /></el-icon>
        <strong>套餐读取失败</strong>
        <span>{{ loadError }}</span>
        <el-button @click="loadPlans">重新加载</el-button>
      </div>

      <div v-else v-loading="loading || sorting" class="plans-board">
      <draggable
        v-if="dragPlans.length"
        v-model="dragPlans"
        item-key="id"
        filter=".plan-card__actions, .plan-card__switch, .el-button, .el-switch"
        :prevent-on-filter="true"
        :animation="180"
        :disabled="dragPlans.length < 2 || sorting"
        ghost-class="is-sort-ghost"
        drag-class="is-sort-dragging"
        class="plans-grid"
        @change="onDragChange"
      >
        <template #item="{ element: row }">
        <article
          class="plan-card"
          :class="{
            'is-off': !row.active,
            'is-recommended': row.recommended,
          }"
        >
          <header class="plan-card__head">
            <div class="plan-card__title">
              <strong>{{ row.name }}</strong>
              <small v-if="row.code" data-no-translate>{{ row.code }}</small>
            </div>
            <div v-if="row.recommended || row.badge" class="plan-card__tags">
              <span v-if="row.recommended" class="plan-chip is-recommend">推荐</span>
              <span
                v-if="row.badge"
                class="plan-chip"
                :class="badgeTone(row.badge)"
              >{{ row.badge }}</span>
            </div>
          </header>

          <div class="plan-card__price">
            <b>{{ row.rechargePolicy ? '¥1 起充' : formatMoney(row.priceCents) }}</b>
            <span>{{ valueSummary(row) }}</span>
          </div>

          <p class="plan-card__desc">
            {{ row.description || "未填写套餐说明" }}
          </p>

          <ul v-if="row.features?.length" class="plan-card__features">
            <li v-for="feature in row.features" :key="feature">{{ feature }}</li>
          </ul>

          <dl class="plan-card__meta">
            <div v-if="row.kind === 'subscription'"><dt>图片并发</dt><dd>{{ baseConcurrency }} + {{ row.subscriptionPolicy?.concurrencyBonus ?? 0 }} = {{ baseConcurrency + (row.subscriptionPolicy?.concurrencyBonus ?? 0) }} 张</dd></div>
            <div v-if="row.kind === 'subscription'"><dt>画布项目</dt><dd>{{ baseCanvasProjects }} + {{ row.subscriptionPolicy?.canvasProjectBonus ?? 0 }} = {{ baseCanvasProjects + (row.subscriptionPolicy?.canvasProjectBonus ?? 0) }} 个</dd></div>
            <div v-if="row.kind === 'subscription'"><dt>助手对话</dt><dd>{{ baseAssistantConversations }} + {{ row.subscriptionPolicy?.assistantConversationBonus ?? 0 }} = {{ baseAssistantConversations + (row.subscriptionPolicy?.assistantConversationBonus ?? 0) }} 个</dd></div>
            <div v-if="row.rechargePolicy && row.priceLockEligible"><dt>锁价门槛</dt><dd>单笔满 {{ row.rechargePolicy.priceLockMinYuan }} 元</dd></div>
            <div><dt>权益版本</dt><dd><el-button link type="primary" @click="showVersions(row)">第 {{ row.revision || 1 }} 版 · 变更记录</el-button></dd></div>
            <div><dt>锁价</dt><dd>{{ row.kind === 'topup' ? (row.priceLockEligible ? '接受符合资格的订阅锁价' : '按实时价格消费') : (row.subscriptionPolicy?.lockModelPrices === false ? '不锁定模型价格' : row.subscriptionPolicy?.allowTopupPriceLock ? '订阅及合格额度包' : '仅订阅积分') }}</dd></div>
            <div>
              <dt>使用</dt>
              <dd>订单 {{ row.orderCount || 0 }} · 订阅 {{ row.subscriptionCount || 0 }}</dd>
            </div>
            <div>
              <dt>更新</dt>
              <dd>{{ formatTime(row.updatedAt || row.createdAt) }}</dd>
            </div>
          </dl>

          <footer class="plan-card__foot">
            <div class="plan-card__actions">
              <el-button size="small" :icon="EditPen" @click="openEdit(row)">
                编辑
              </el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :icon="Delete"
                :title="row.deletable ? '永久删除' : '已有历史记录，只能下架'"
                @click="removePlan(row)"
              >
                删除
              </el-button>
            </div>
            <label class="plan-card__switch">
              <span>{{ row.active ? "已上架" : "已下架" }}</span>
              <el-switch
                :model-value="row.active"
                :loading="switchingId === row.id"
                @change="toggleActive(row, Boolean($event))"
              />
            </label>
          </footer>
        </article>
        </template>
      </draggable>
        <div v-else class="plans-empty">
          暂无{{ kindTab === "subscription" ? "订阅计划" : "积分包" }}
        </div>
      </div>
    </PageCard>

    <AdminDialog
      v-model="dialogOpen"
      :title="dialogTitle"
      subtitle="新配置影响后续购买与升级，已购订阅权益和额度包资格保持不变"
      :icon="Collection"
      :width="form.kind === 'subscription' ? '1120px' : '980px'"
      panel-class="plan-editor-dialog"
      :confirm-loading="saving"
      :confirm-disabled="saving"
      confirm-text="保存套餐"
      @confirm="savePlan"
    >
      <el-form label-position="top" class="plan-form">
        <div class="plan-form__cols">
          <div class="plan-form__col">
            <section class="plan-form__section">
              <h3>基本信息</h3>
              <div class="plan-form__grid">
                <el-form-item required>
                  <template #label>套餐名称<HelpTip content="用户在价格页、订单和订阅中心看到的名称，最多 128 字。" /></template>
                  <el-input v-model="form.name" maxlength="128" placeholder="例如：创作者积分包" />
                </el-form-item>
                <el-form-item required>
                  <template #label>套餐代码<HelpTip content="内部唯一标识，用于统计与对账。仅支持小写字母、数字、短横线和下划线，创建后尽量不要修改。" /></template>
                  <el-input v-model="form.code" maxlength="64" placeholder="creator_1000" data-no-translate />
                </el-form-item>
                <el-form-item required>
                  <template #label>套餐类型<HelpTip content="一次性积分包：付款后积分直接进入钱包，长期有效。订阅计划：按周期每 24 小时发放一次积分，未用完的在下次发放时失效。" /></template>
                  <el-segmented v-model="form.kind" :options="[{ label: '一次性积分包', value: 'topup' }, { label: '订阅计划', value: 'subscription' }]" />
                </el-form-item>
                <el-form-item required>
                  <template #label>销售价格（元）<HelpTip content="用户实际支付的金额。修改后只影响之后的购买，已购订单不变。" /></template>
                  <el-input-number v-model="form.priceYuan" :min="0" :max="10000000" :step="1" :precision="2" />
                </el-form-item>
                <el-form-item class="is-wide">
                  <template #label>套餐说明<HelpTip content="展示在价格页套餐卡片上的简介，建议写清适合人群和核心价值，最多 500 字。" /></template>
                  <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="说明适合人群和核心价值" />
                </el-form-item>
              </div>
            </section>

            <section class="plan-form__section">
              <h3>{{ form.kind === 'topup' ? '积分与展示' : '发放与展示' }}</h3>
              <div class="plan-form__grid is-3">
                <template v-if="form.kind === 'topup'">
                  <el-form-item required>
                    <template #label>基础积分<HelpTip content="购买后到账的基础积分。到账总额 = 基础积分 + 额外赠送积分。" /></template>
                    <el-input-number v-model="form.grantPoints" :min="0" :max="1000000000" :precision="0" />
                  </el-form-item>
                  <el-form-item>
                    <template #label>额外赠送积分<HelpTip content="随基础积分一起到账，价格页会单独标注“赠 N 积分”。" /></template>
                    <el-input-number v-model="form.bonusPoints" :min="0" :max="1000000000" :precision="0" />
                  </el-form-item>
                </template>
                <template v-else>
                  <el-form-item required>
                    <template #label>订阅有效天数<HelpTip content="从开通时刻起算的有效期，到期后停止发放，未用积分失效。" /></template>
                    <el-input-number v-model="form.durationDays" :min="1" :max="3650" :precision="0" />
                  </el-form-item>
                  <el-form-item required>
                    <template #label>每24小时发放积分<HelpTip content="每个 24 小时周期发放一次。当期没用完的积分在下次发放时重置，不累计。" /></template>
                    <el-input-number v-model="form.dailyGrantPoints" :min="1" :max="1000000000" :precision="0" />
                  </el-form-item>
                </template>
                <el-form-item>
                  <template #label>展示角标<HelpTip content="价格页卡片右上角的小标签，最多 24 字。包含“热门 / 限时 / 新品”时会自动套用对应颜色。" /></template>
                  <el-input v-model="form.badge" maxlength="24" placeholder="例如：热卖 / 限时" />
                </el-form-item>
              </div>
              <div class="plan-form__summary">
                <template v-if="form.kind === 'topup'">到账合计 <b>{{ formatPoints(form.grantPoints + form.bonusPoints) }}</b> 积分</template>
                <template v-else>整期最多发放 <b>{{ formatPoints(form.durationDays * form.dailyGrantPoints) }}</b> 积分（{{ form.durationDays }} 天 × {{ formatPoints(form.dailyGrantPoints) }}）</template>
              </div>
            </section>

            <section class="plan-form__section">
              <h3>上架与价格保护</h3>
              <div class="plan-form__switches">
                <label>
                  <span><strong>立即上架<HelpTip content="上架后用户在价格页可以看到并购买；下架不影响已购用户。" /></strong><small>上架后用户价格页可见</small></span>
                  <el-switch v-model="form.active" />
                </label>
                <label>
                  <span><strong>设为推荐<HelpTip content="价格页高亮展示，全站同时只保留一个推荐套餐，设置后其他套餐的推荐会被取消。" /></strong><small>全站只保留一个推荐套餐</small></span>
                  <el-switch v-model="form.recommended" />
                </label>
                <template v-if="form.kind === 'subscription'">
                  <label>
                    <span><strong>订阅模型价格保护<HelpTip content="订阅有效期内，后台调整模型价格不影响该用户，站内创作按开通时锁定的价格扣费；API 调用仍按控制台“模型”页价格计费。" /></strong><small>有效期内使用订阅锁定价</small></span>
                    <el-switch v-model="form.lockModelPrices" />
                  </label>
                  <label>
                    <span><strong>延伸至合格额度包<HelpTip content="开启后，该订阅用户使用“接受订阅锁价”的额度包积分时，也按订阅锁定价扣费。需先开启模型价格保护；退款审核期间自动停用。" /></strong><small>额度包也需接受锁价</small></span>
                    <el-switch v-model="form.allowTopupPriceLock" :disabled="!form.lockModelPrices" />
                  </label>
                </template>
                <label v-else>
                  <span><strong>接受订阅锁价<HelpTip content="开启后，持有“延伸至合格额度包”订阅的用户使用本额度包积分时，按其订阅锁定价扣费；关闭则始终按实时价格扣费。" /></strong><small>符合资格的订阅可锁价</small></span>
                  <el-switch v-model="form.priceLockEligible" />
                </label>
              </div>
            </section>
          </div>

          <div class="plan-form__col">
            <section v-if="form.kind === 'subscription'" class="plan-form__section">
              <h3>额度与升级<HelpTip content="额度加成在全站基础额度上为订阅用户增加数量。已购用户按购买时的套餐生效，修改只影响之后的购买。" /></h3>
              <div class="plan-form__grid is-3">
                <el-form-item>
                  <template #label>额外图片并发<HelpTip content="订阅用户可以同时生成的图片数增加多少，所有生图场景共用；对话并发单独计算。" /></template>
                  <el-input-number v-model="form.concurrencyBonus" :min="0" :max="1000" :precision="0" />
                  <small class="plan-form__calc">基础 {{ baseConcurrency }} + {{ form.concurrencyBonus }} = <b>{{ baseConcurrency + form.concurrencyBonus }}</b> 张</small>
                </el-form-item>
                <el-form-item>
                  <template #label>额外画布项目<HelpTip content="无限画布最多可保存的项目数增加多少。" /></template>
                  <el-input-number v-model="form.canvasProjectBonus" :min="0" :max="10000" :precision="0" />
                  <small class="plan-form__calc">基础 {{ baseCanvasProjects }} + {{ form.canvasProjectBonus }} = <b>{{ baseCanvasProjects + form.canvasProjectBonus }}</b> 个</small>
                </el-form-item>
                <el-form-item>
                  <template #label>额外助手对话<HelpTip content="AI 助手最多保留的对话数增加多少；超出时自动归档最久没用的对话。" /></template>
                  <el-input-number v-model="form.assistantConversationBonus" :min="0" :max="10000" :precision="0" />
                  <small class="plan-form__calc">基础 {{ baseAssistantConversations }} + {{ form.assistantConversationBonus }} = <b>{{ baseAssistantConversations + form.assistantConversationBonus }}</b> 个</small>
                </el-form-item>
                <el-form-item>
                  <template #label>订阅系列<HelpTip content="只有同一系列的套餐之间才能互相升级，例如 general。不同系列视为互不相关的产品。" /></template>
                  <el-input v-model="form.series" maxlength="64" data-no-translate />
                </el-form-item>
                <el-form-item>
                  <template #label>升级级别<HelpTip content="同系列内数字越大级别越高，用户只能升级到更高级别；且新套餐的渠道、场景和模型范围要覆盖原套餐。" /></template>
                  <el-input-number v-model="form.tier" :min="1" :max="100" :precision="0" />
                </el-form-item>
                <el-form-item>
                  <template #label>全额退款窗口（小时）<HelpTip content="开通后在这段时间内且没有使用订阅积分，可申请全额退款；超出时限或已使用积分的退订按规则审核。" /></template>
                  <el-input-number v-model="form.refundWindowHours" :min="0" :max="720" :precision="0" />
                </el-form-item>
              </div>
            </section>

            <section v-if="form.kind === 'subscription'" class="plan-form__section">
              <h3>
                适用范围<HelpTip content="订阅积分可以在哪些渠道、功能和模型上使用；范围之外的消费不能使用订阅积分。" />
                <span class="plan-form__channels">
                  使用渠道<HelpTip content="网站：站内各创作功能。API：开发者 API 调用。都不勾选则订阅积分无法使用。" />
                  <el-checkbox-group v-model="form.channels"><el-checkbox value="web">网站</el-checkbox><el-checkbox value="api">API</el-checkbox></el-checkbox-group>
                </span>
              </h3>
              <el-form-item>
                <template #label>适用场景<HelpTip content="订阅积分可用于哪些功能，留空表示全部场景。限定了场景时，API 使用还需勾选“API 调用生图 / 对话”。" /></template>
                <el-select v-model="form.featureKeys" multiple clearable collapse-tags-tooltip placeholder="全部场景" style="width:100%">
                  <el-option v-for="option in sceneOptions" :key="option.value" :value="option.value" :label="option.label" />
                </el-select>
              </el-form-item>
              <el-form-item class="plan-site-models">
                <template #label>适用模型<HelpTip content="订阅积分只能用于选中的站内模型，留空表示全部模型。列表来自模型目录，用户订阅中心会显示模型名称。" /></template>
                <el-select v-model="form.modelIds" multiple clearable filterable collapse-tags-tooltip placeholder="全部模型" style="width:100%">
                  <el-option-group v-for="group in siteModelGroups" :key="group.label" :label="group.label">
                    <el-option v-for="model in group.options" :key="model.id" :value="model.id" :label="model.name || model.id">
                      <span class="plan-model-option">
                        <span>{{ model.name || model.id }}</span>
                        <small data-no-translate>{{ model.upstreamModel }}</small>
                        <em v-if="!model.enabled">未启用</em>
                      </span>
                    </el-option>
                  </el-option-group>
                </el-select>
              </el-form-item>
              <el-form-item v-if="form.channels.includes('api')" class="plan-api-models">
                <template #label>API 模型<HelpTip :content="limitsModels ? '已限定站内模型：API 调用只能用这里选中的 API 模型；不选则订阅积分不能用于 API 调用。' : '适用模型留空时，订阅积分可用于全部 API 模型，无需单独选择。'" /></template>
                <el-select v-if="limitsModels" v-model="form.apiModelIds" multiple clearable filterable collapse-tags-tooltip placeholder="不选则订阅积分不能用于 API 调用" style="width:100%">
                  <el-option v-for="item in apiModels" :key="item.id" :value="item.id" :label="`${item.apiName}（${item.kind === 'chat' ? '对话' : '图片'}）`" />
                </el-select>
                <span v-else class="plan-form__muted">适用模型为全部，订阅积分可用于全部 API 模型。</span>
              </el-form-item>
            </section>

            <section class="plan-form__section">
              <h3>套餐权益文案<HelpTip content="价格页卡片中展示的权益条目，每行一条，最多 12 条、单条 120 字。只是展示文案，不影响实际权限；实际权限以套餐规则为准。" /></h3>
              <el-input v-model="form.featuresText" type="textarea" :rows="form.kind === 'subscription' ? 4 : 12" placeholder="每行一条，最多 12 条" />
            </section>
          </div>
        </div>
      </el-form>
    </AdminDialog>
    <PlanVersionHistory v-model="versionsOpen" :plan="versionsPlan" />
  </div>
</template>

<style scoped>
.plans-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.plans-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.plans-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.plans-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
}

.plans-toolbar__right {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  margin-left: auto;
}

.plans-toolbar__right .el-input {
  width: 220px;
  min-width: 160px;
  flex: 1 1 180px;
}

.plans-toolbar__right .el-select {
  width: 120px;
  flex: 0 0 120px;
}

.plans-toolbar__right :deep(.el-button) {
  flex: 0 0 auto;
}

.plans-tabs {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}

.plans-tab {
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

.plans-tab em {
  font-style: normal;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
}

.plans-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}

.plans-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}

.plans-board {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: stretch;
  align-content: start;
  gap: 14px;
}

.plans-grid :deep(.is-sort-ghost) {
  opacity: 0.4;
}

.plans-grid :deep(.is-sort-dragging) {
  box-shadow: var(--shadow-lg);
}

.plan-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  height: 100%;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  cursor: grab;
}

.plan-card:active {
  cursor: grabbing;
}

.plan-card.is-recommended {
  border-color: color-mix(in srgb, var(--accent) 46%, var(--border));
  background: linear-gradient(
    180deg,
    var(--accent-soft) 0%,
    var(--surface) 28%
  );
}

.plan-card.is-off {
  opacity: 0.62;
}

.plan-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.plan-card__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.plan-card__title strong {
  min-width: 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.plan-card__title small {
  flex: 0 0 auto;
  color: var(--ink-3);
  font:
    600 11px/1.3 ui-monospace,
    monospace;
}

.plan-card__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.plan-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 650;
}

.plan-chip.is-recommend {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.plan-chip.is-hot {
  background: var(--warning-soft);
  color: var(--warning);
}

.plan-chip.is-limited {
  background: var(--info-soft);
  color: var(--info);
}

.plan-chip.is-new {
  background: var(--violet-soft);
  color: var(--violet);
}

.plan-card__price {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.plan-card__price b {
  color: var(--ink);
  font-size: 24px;
  font-weight: 760;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.plan-card__price span {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.plan-card__desc {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.plan-card__features {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-card__features li {
  position: relative;
  padding-left: 14px;
  color: var(--ink);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.plan-card__features li::before {
  position: absolute;
  top: 0.55em;
  left: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  content: "";
}

.plan-card__meta {
  display: grid;
  gap: 8px;
  margin: auto 0 0;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface-2);
}

.plan-card__meta > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.plan-card__meta dt {
  flex: 0 0 auto;
  color: var(--ink-3);
  font-size: 12px;
}

.plan-card__meta dd {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
  text-align: right;
  overflow-wrap: anywhere;
}

.plan-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.plan-card__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.plan-card__actions {
  display: flex;
  gap: 6px;
}

.plan-card__actions,
.plan-card__switch {
  cursor: default;
}

.plans-empty {
  display: grid;
  place-items: center;
  min-height: 100%;
  color: var(--ink-3);
  font-size: 13px;
}

.plans-error {
  display: grid;
  flex: 1;
  place-items: center;
  gap: 8px;
  min-height: 0;
  color: var(--ink-3);
  text-align: center;
}

.plans-error .el-icon {
  font-size: 32px;
}

.plans-error strong {
  color: var(--ink);
}

.plan-form__cols {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 16px;
}

.plan-form__col {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
}

.plan-form__section {
  padding: 12px 14px 2px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}

.plan-form__section h3 {
  display: flex;
  align-items: center;
  margin: 0 0 10px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.plan-form__channels {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 500;
}

.plan-form__channels .el-checkbox-group {
  margin-left: 8px;
}

.plan-form__channels .el-checkbox {
  height: 22px;
  margin-right: 14px;
}

.plan-form__section > .el-textarea {
  margin-bottom: 12px;
}

.plan-form__section :deep(.el-form-item) {
  margin-bottom: 12px;
}

.plan-form__section :deep(.el-form-item__label) {
  display: inline-flex;
  align-items: center;
  margin-bottom: 4px;
  line-height: 1.4;
}

.plan-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.plan-form__grid.is-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.plan-form__grid > .is-wide {
  grid-column: 1 / -1;
}

.plan-form :deep(.el-input-number),
.plan-form :deep(.el-segmented) {
  width: 100%;
}

.plan-form__calc {
  display: block;
  width: 100%;
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.4;
}

.plan-form__calc b,
.plan-form__summary b {
  color: var(--ink);
  font-weight: 700;
}

.plan-form__summary {
  margin: -4px 0 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 12px;
}

.plan-form__muted {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}

.plan-form__switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.plan-form__switches label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.plan-form__switches strong,
.plan-form__switches small {
  display: block;
}

.plan-form__switches strong {
  display: flex;
  align-items: center;
  color: var(--ink);
  font-size: 12px;
}

.plan-form__switches small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11px;
}

.plan-model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.plan-model-option small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-model-option em {
  margin-left: auto;
  color: var(--warning);
  font-size: 11px;
  font-style: normal;
}

@media (max-width: 1400px) {
  .plans-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1100px) {
  .plans-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .plans-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1080px) {
  .plan-form__cols {
    grid-auto-flow: row;
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .plan-form__grid,
  .plan-form__grid.is-3,
  .plan-form__switches {
    grid-template-columns: 1fr;
  }
}

</style>
