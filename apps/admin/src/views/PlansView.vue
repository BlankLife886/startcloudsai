<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Collection,
  Delete,
  EditPen,
  Plus,
  Refresh,
  Search,
  Star,
} from "@element-plus/icons-vue";
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
const kindFilter = ref<"" | PlanKind>("");
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

const filteredPlans = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return plans.value.filter((plan) => {
    if (kindFilter.value && plan.kind !== kindFilter.value) return false;
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

const stats = computed(() => ({
  total: plans.value.length,
  active: plans.value.filter((plan) => plan.active).length,
  topup: plans.value.filter((plan) => plan.kind === "topup").length,
  subscription: plans.value.filter((plan) => plan.kind === "subscription")
    .length,
}));

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
  form.sort = plans.value.length
    ? Math.max(...plans.value.map((plan) => plan.sort || 0)) + 10
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
  kindFilter.value = "";
  statusFilter.value = "";
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

onMounted(loadPlans);
</script>

<template>
  <div class="page plans-page">
    <section class="plans-hero">
      <div>
        <span class="plans-hero__eyebrow">COMMERCIAL CATALOG</span>
        <h1>套餐管理</h1>
        <p>统一管理用户价格页展示的积分包和订阅计划。</p>
      </div>
      <div class="plans-hero__actions">
        <el-button :icon="Refresh" :loading="loading" @click="loadPlans">
          刷新
        </el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">
          新增套餐
        </el-button>
      </div>
    </section>

    <section class="plans-metrics" aria-label="套餐统计">
      <article>
        <span>全部套餐</span><strong>{{ stats.total }}</strong
        ><small>个</small>
      </article>
      <article>
        <span>正在上架</span><strong>{{ stats.active }}</strong
        ><small>个</small>
      </article>
      <article>
        <span>积分包</span><strong>{{ stats.topup }}</strong
        ><small>个</small>
      </article>
      <article>
        <span>订阅计划</span><strong>{{ stats.subscription }}</strong
        ><small>个</small>
      </article>
    </section>

    <PageCard>
      <div class="plans-toolbar">
        <el-input
          v-model="search"
          :prefix-icon="Search"
          placeholder="搜索套餐名称、代码或说明"
          clearable
        />
        <el-select v-model="kindFilter" placeholder="套餐类型">
          <el-option label="全部类型" value="" />
          <el-option label="一次性积分包" value="topup" />
          <el-option label="订阅计划" value="subscription" />
        </el-select>
        <el-select v-model="statusFilter" placeholder="上架状态">
          <el-option label="全部状态" value="" />
          <el-option label="已上架" value="active" />
          <el-option label="已下架" value="inactive" />
        </el-select>
        <el-button
          v-if="search || kindFilter || statusFilter"
          @click="resetFilters"
        >
          清除筛选
        </el-button>
      </div>

      <div v-if="loadError" class="plans-error">
        <el-icon><Collection /></el-icon>
        <strong>套餐读取失败</strong>
        <span>{{ loadError }}</span>
        <el-button @click="loadPlans">重新加载</el-button>
      </div>

      <el-table
        v-else
        v-loading="loading"
        :data="filteredPlans"
        row-key="id"
        class="plans-table"
        empty-text="暂无套餐，点击右上角新增第一个套餐"
      >
        <el-table-column label="套餐" min-width="250">
          <template #default="{ row }">
            <div class="plan-name-cell">
              <span class="plan-name-cell__mark" :class="`is-${row.kind}`">
                <el-icon
                  ><Star v-if="row.recommended" /><Collection v-else
                /></el-icon>
              </span>
              <div>
                <strong>{{ row.name }}</strong>
                <small data-no-translate>{{ row.code }}</small>
                <p>{{ row.description || "未填写套餐说明" }}</p>
              </div>
              <el-tag v-if="row.badge" size="small" effect="plain">{{
                row.badge
              }}</el-tag>
              <el-tag v-if="row.recommended" size="small" type="warning"
                >推荐</el-tag
              >
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag
              :type="row.kind === 'subscription' ? 'success' : 'info'"
              effect="light"
            >
              {{ row.kind === "subscription" ? "订阅计划" : "积分包" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="售价" width="120">
          <template #default="{ row }">
            <strong class="plan-price">{{
              formatMoney(row.priceCents)
            }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="发放权益" min-width="210">
          <template #default="{ row }">
            <div class="plan-value">
              <strong>{{ valueSummary(row) }}</strong>
              <small>{{ row.features?.length || 0 }} 条展示权益</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="使用记录" width="120" align="center">
          <template #default="{ row }">
            <div class="plan-usage">
              <strong>{{ row.orderCount || 0 }}</strong>
              <small>订单 · {{ row.subscriptionCount || 0 }} 订阅</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="排序" width="78" align="center" prop="sort" />
        <el-table-column label="上架" width="90" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.active"
              :loading="switchingId === row.id"
              @change="toggleActive(row, Boolean($event))"
            />
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="145">
          <template #default="{ row }">
            <span class="plan-time">{{
              formatTime(row.updatedAt || row.createdAt)
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <div class="plan-actions">
              <el-button
                text
                type="primary"
                :icon="EditPen"
                @click="openEdit(row)"
              >
                编辑
              </el-button>
              <el-button
                text
                type="danger"
                :icon="Delete"
                :title="row.deletable ? '永久删除' : '已有历史记录，只能下架'"
                @click="removePlan(row)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
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
          <el-form-item label="展示排序">
            <el-input-number
              v-model="form.sort"
              :min="0"
              :max="1000000"
              :step="10"
              :precision="0"
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
  display: grid;
  gap: 18px;
}

.plans-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 26px;
  overflow: hidden;
  border-radius: var(--radius-card);
  color: #fff;
  background:
    radial-gradient(
      circle at 80% -20%,
      rgb(196 181 253 / 35%),
      transparent 38%
    ),
    linear-gradient(135deg, #25203b, #14121f 72%);
  box-shadow: var(--shadow-md);
}

.plans-hero__eyebrow {
  color: #c4b5fd;
  font:
    750 11px/1 ui-monospace,
    monospace;
  letter-spacing: 0.12em;
}

.plans-hero h1 {
  margin: 10px 0 0;
  font-size: 30px;
  letter-spacing: -0.04em;
}

.plans-hero p {
  margin: 8px 0 0;
  color: rgb(255 255 255 / 62%);
  font-size: 13px;
}

.plans-hero__actions {
  display: flex;
  gap: 9px;
}

.plans-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.plans-metrics article {
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.plans-metrics span {
  display: block;
  margin-bottom: 9px;
  color: var(--ink-3);
  font-size: 12px;
}

.plans-metrics strong {
  color: var(--ink);
  font-size: 25px;
}

.plans-metrics small {
  margin-left: 4px;
  color: var(--ink-3);
  font-size: 11px;
}

.plans-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 160px 140px auto;
  gap: 10px;
  padding-bottom: 16px;
}

.plan-name-cell {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.plan-name-cell__mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #6d5cf5;
  background: #efedff;
}

.plan-name-cell__mark.is-subscription {
  color: #059669;
  background: #dcfce7;
}

.plan-name-cell > div {
  min-width: 0;
}

.plan-name-cell strong,
.plan-name-cell small {
  display: block;
}

.plan-name-cell strong {
  color: var(--ink);
  font-size: 13px;
}

.plan-name-cell small {
  margin-top: 2px;
  color: var(--ink-3);
  font:
    600 10px ui-monospace,
    monospace;
}

.plan-name-cell p {
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-price,
.plan-value strong,
.plan-value small,
.plan-usage strong,
.plan-usage small {
  display: block;
}

.plan-price {
  color: var(--ink);
  font-size: 14px;
}

.plan-value strong {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.plan-value small,
.plan-usage small,
.plan-time {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 10px;
}

.plan-usage strong {
  color: var(--ink);
  font-size: 15px;
}

.plan-actions {
  display: flex;
  gap: 2px;
}

.plans-error {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 300px;
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

@media (max-width: 980px) {
  .plans-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .plans-toolbar {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 680px) {
  .plans-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .plans-hero__actions > * {
    flex: 1;
  }

  .plans-toolbar,
  .plan-form__grid,
  .plan-form__switches {
    grid-template-columns: 1fr;
  }
}
</style>
