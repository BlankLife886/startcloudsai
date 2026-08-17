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
import { normalizeList, request } from "@/request";
import { formatPoints, formatTime, normalizePoints } from "@/utils";

type PlanKind = "topup" | "subscription";

interface Plan {
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
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const switchingId = ref("");
const search = ref("");
const kindTab = ref<PlanKind>("subscription");
const statusFilter = ref<"" | "active" | "inactive">("");

function defaultForm(): PlanForm {
  return {
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
    const data = await request<Plan[] | { items: Plan[] }>(
      "/api/v1/admin/plans",
      { silent: true },
    );
    plans.value = normalizeList(data).items;
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
  if (plan.kind === "subscription") {
    return `${plan.durationDays} 天 · 每日 ${formatPoints(plan.dailyGrantCents)} 积分`;
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

onMounted(loadPlans);
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
            <b>{{ formatMoney(row.priceCents) }}</b>
            <span>{{ valueSummary(row) }}</span>
          </div>

          <p class="plan-card__desc">
            {{ row.description || "未填写套餐说明" }}
          </p>

          <ul v-if="row.features?.length" class="plan-card__features">
            <li v-for="feature in row.features" :key="feature">{{ feature }}</li>
          </ul>

          <dl class="plan-card__meta">
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
      subtitle="保存后会实时同步到用户端价格页面"
      :icon="Collection"
      width="780px"
      panel-class="plan-editor-dialog"
      :confirm-loading="saving"
      :confirm-disabled="saving"
      confirm-text="保存套餐"
      @confirm="savePlan"
    >
      <el-form label-position="top" class="plan-form">
        <div class="plan-form__grid">
          <el-form-item label="套餐名称" required>
            <el-input
              v-model="form.name"
              maxlength="128"
              placeholder="例如：创作者积分包"
            />
          </el-form-item>
          <el-form-item label="套餐代码" required>
            <el-input
              v-model="form.code"
              maxlength="64"
              placeholder="creator_1000"
              data-no-translate
            />
          </el-form-item>
          <el-form-item label="套餐类型" required>
            <el-segmented
              v-model="form.kind"
              :options="[
                { label: '一次性积分包', value: 'topup' },
                { label: '订阅计划', value: 'subscription' },
              ]"
            />
          </el-form-item>
          <el-form-item label="销售价格（元）" required>
            <el-input-number
              v-model="form.priceYuan"
              :min="0"
              :max="10000000"
              :step="1"
              :precision="2"
            />
          </el-form-item>
        </div>

        <el-form-item label="套餐说明">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            placeholder="说明适合人群和核心价值"
          />
        </el-form-item>

        <div class="plan-form__grid">
          <template v-if="form.kind === 'topup'">
            <el-form-item label="基础积分" required>
              <el-input-number
                v-model="form.grantPoints"
                :min="0"
                :max="1000000000"
                :precision="0"
              />
            </el-form-item>
            <el-form-item label="额外赠送积分">
              <el-input-number
                v-model="form.bonusPoints"
                :min="0"
                :max="1000000000"
                :precision="0"
              />
            </el-form-item>
          </template>
          <template v-else>
            <el-form-item label="订阅有效天数" required>
              <el-input-number
                v-model="form.durationDays"
                :min="1"
                :max="3650"
                :precision="0"
              />
            </el-form-item>
            <el-form-item label="每日发放积分" required>
              <el-input-number
                v-model="form.dailyGrantPoints"
                :min="1"
                :max="1000000000"
                :precision="0"
              />
            </el-form-item>
          </template>
          <el-form-item label="展示角标">
            <el-input
              v-model="form.badge"
              maxlength="24"
              placeholder="例如：热卖 / 限时"
            />
          </el-form-item>
        </div>

        <el-form-item label="套餐权益">
          <el-input
            v-model="form.featuresText"
            type="textarea"
            :rows="5"
            placeholder="每行一条，最多 12 条"
          />
        </el-form-item>

        <div class="plan-form__switches">
          <label>
            <span
              ><strong>立即上架</strong
              ><small>上架后用户价格页可见</small></span
            >
            <el-switch v-model="form.active" />
          </label>
          <label>
            <span
              ><strong>设为推荐</strong
              ><small>全站同时只保留一个推荐套餐</small></span
            >
            <el-switch v-model="form.recommended" />
          </label>
        </div>
      </el-form>
    </AdminDialog>
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

.plan-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.plan-form :deep(.el-input-number),
.plan-form :deep(.el-segmented) {
  width: 100%;
}

.plan-form__switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.plan-form__switches label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.plan-form__switches strong,
.plan-form__switches small {
  display: block;
}

.plan-form__switches strong {
  color: var(--ink);
  font-size: 12px;
}

.plan-form__switches small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 10px;
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

@media (max-width: 680px) {
  .plan-form__grid,
  .plan-form__switches {
    grid-template-columns: 1fr;
  }
}

</style>
