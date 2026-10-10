<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, ArrowUp, Delete, Plus, Search } from "@element-plus/icons-vue";
import { request } from "@/request";
import { formatPoints } from "@/utils";
import PointsInput from "./PointsInput.vue";
import {
  CLOCK_OPTIONS, KIND_HINTS, KIND_LABELS, MAX_PERCENT, MIN_PERCENT,
  applyAdjustment, beijingClock, emptySchedule, formatAdjustment, hitsFloor, newRule, normalizeSchedule,
  ruleProblem, ruleWindowText, subscriberAdjustment,
  type AdjustMode, type Adjustment, type PriceRule, type PriceSchedule, type RuleKind, type SchedulePayload, type ScheduleModel,
} from "./priceSchedule";

const SUBSCRIBER = "subscriber";
const KIND_FILTERS = [
  { value: "", label: "全部" },
  { value: "image", label: "生图" },
  { value: "chat", label: "对话" },
  { value: "image_tool", label: "媒体工具" },
];
const MODEL_KIND_LABELS: Record<string, string> = { image: "生图", chat: "对话", image_tool: "媒体工具" };

const loading = ref(false);
const saving = ref(false);
const payload = ref<SchedulePayload | null>(null);
const draft = reactive<PriceSchedule>(emptySchedule());
const savedJSON = ref(JSON.stringify(emptySchedule()));
const selected = ref<string>(SUBSCRIBER);
const search = ref("");
const kindFilter = ref("");
const checked = ref<Set<string>>(new Set());
const batch = reactive<{ direction: "down" | "up"; amount: number; mode: AdjustMode }>({ direction: "down", amount: 10, mode: "percent" });
const now = ref(new Date());
let clockTimer: number | undefined;

const dirty = computed(() => JSON.stringify(draft) !== savedJSON.value);
const models = computed(() => payload.value?.models || []);
const modelById = computed(() => new Map(models.value.map((model) => [model.id, model])));
const selectedRule = computed(() => draft.rules.find((rule) => rule.id === selected.value) || null);
const isSubscriber = computed(() => selected.value === SUBSCRIBER);
const editingModels = computed<Record<string, Adjustment>>(() =>
  isSubscriber.value ? draft.subscriber.models : selectedRule.value?.models || {},
);
const visibleModels = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return models.value.filter((model) =>
    (!kindFilter.value || model.kind === kindFilter.value) &&
    (!keyword || `${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(keyword)),
  );
});
const participating = computed(() => Object.keys(editingModels.value).length);
const liveRules = computed(() => {
  const counts = new Map<string, number>();
  for (const hit of Object.values(payload.value?.active || {})) counts.set(hit.ruleId, (counts.get(hit.ruleId) || 0) + 1);
  return counts;
});
const liveCount = computed(() => Object.keys(payload.value?.active || {}).length);
const problems = computed(() => draft.rules.map((rule) => ({ rule, problem: ruleProblem(rule) })).filter((item) => item.problem));
const clock = computed(() => beijingClock(now.value));
const nextChangeText = computed(() => {
  const next = payload.value?.nextChangeAt;
  return next ? beijingClock(new Date(next)).slice(5, 16) : "";
});
const allVisibleChecked = computed(() => visibleModels.value.length > 0 && visibleModels.value.every((model) => checked.value.has(model.id)));

function apply(data: SchedulePayload) {
  payload.value = data;
  const schedule = normalizeSchedule(data.schedule);
  Object.assign(draft, schedule);
  savedJSON.value = JSON.stringify(draft);
  if (selected.value !== SUBSCRIBER && !draft.rules.some((rule) => rule.id === selected.value)) {
    selected.value = draft.rules[0]?.id || SUBSCRIBER;
  }
}

async function load() {
  loading.value = true;
  try {
    apply(await request<SchedulePayload>("/api/v1/admin/model-config/price-schedule"));
  } catch {
    // request() 已提示错误；面板保留上次的内容。
  } finally {
    loading.value = false;
  }
}

async function save() {
  const first = problems.value[0];
  if (first) {
    selected.value = first.rule.id;
    ElMessage.warning(`${first.rule.name || "规则"}：${first.problem}`);
    return;
  }
  saving.value = true;
  try {
    apply(await request<SchedulePayload>("/api/v1/admin/model-config/price-schedule", { method: "PUT", body: JSON.parse(JSON.stringify(draft)) }));
    ElMessage.success("调价规则已保存，用户下一次提交起按新规则计价");
  } catch {
    // request() 已提示错误。
  } finally {
    saving.value = false;
  }
}

function reset() {
  Object.assign(draft, normalizeSchedule(JSON.parse(savedJSON.value)));
  if (selected.value !== SUBSCRIBER && !draft.rules.some((rule) => rule.id === selected.value)) selected.value = draft.rules[0]?.id || SUBSCRIBER;
}

function addRule(kind: RuleKind) {
  const rule = newRule(kind, new Date());
  draft.rules.push(rule);
  selected.value = rule.id;
}

async function removeRule(rule: PriceRule) {
  try {
    await ElMessageBox.confirm(`删除规则「${rule.name}」？保存后生效。`, "删除规则", { type: "warning", confirmButtonText: "删除" });
  } catch {
    return;
  }
  const index = draft.rules.findIndex((item) => item.id === rule.id);
  draft.rules.splice(index, 1);
  selected.value = draft.rules[Math.min(index, draft.rules.length - 1)]?.id || SUBSCRIBER;
}

function moveRule(rule: PriceRule, delta: number) {
  const index = draft.rules.findIndex((item) => item.id === rule.id);
  const target = index + delta;
  if (target < 0 || target >= draft.rules.length) return;
  const [item] = draft.rules.splice(index, 1);
  draft.rules.splice(target, 0, item);
}

function changeKind(rule: PriceRule, kind: RuleKind) {
  const fresh = newRule(kind, new Date());
  rule.kind = kind;
  rule.startTime = fresh.startTime;
  rule.endTime = fresh.endTime;
  rule.startAt = fresh.startAt;
  rule.endAt = fresh.endAt;
}

function dateRange(rule: PriceRule): [string, string] | null {
  return rule.startAt && rule.endAt ? [rule.startAt, rule.endAt] : null;
}

function setDateRange(rule: PriceRule, value: [string, string] | null) {
  rule.startAt = value?.[0] || "";
  rule.endAt = value?.[1] || "";
}

// 规则里的幅度带符号（负数降价）；订阅优惠的幅度始终为正（表示再减多少）。
function defaultAdjustment(): Adjustment {
  return isSubscriber.value ? { mode: "percent", value: 5 } : { mode: "percent", value: -10 };
}

function setParticipating(modelId: string, on: boolean) {
  const target = editingModels.value;
  if (on && !target[modelId]) target[modelId] = defaultAdjustment();
  if (!on) delete target[modelId];
}

function direction(adjustment: Adjustment): "down" | "up" {
  return adjustment.value > 0 && !isSubscriber.value ? "up" : "down";
}

function setDirection(modelId: string, value: "down" | "up") {
  const adjustment = editingModels.value[modelId];
  if (adjustment) adjustment.value = value === "up" ? Math.abs(adjustment.value) : -Math.abs(adjustment.value);
}

function setAmount(modelId: string, amount: number) {
  const adjustment = editingModels.value[modelId];
  if (!adjustment) return;
  if (isSubscriber.value) adjustment.value = amount;
  else adjustment.value = direction(adjustment) === "up" ? amount : -amount;
}

function setMode(modelId: string, mode: AdjustMode) {
  const adjustment = editingModels.value[modelId];
  if (adjustment) adjustment.mode = mode;
}

function amountMax(mode: AdjustMode, dir: "down" | "up"): number {
  if (mode === "points") return 1_000_000;
  if (isSubscriber.value) return 100;
  return dir === "up" ? MAX_PERCENT : -MIN_PERCENT;
}

function toggleChecked(modelId: string, on: boolean) {
  const next = new Set(checked.value);
  if (on) next.add(modelId);
  else next.delete(modelId);
  checked.value = next;
}

function toggleAllVisible(on: boolean) {
  const next = new Set(checked.value);
  for (const model of visibleModels.value) {
    if (on) next.add(model.id);
    else next.delete(model.id);
  }
  checked.value = next;
}

function applyBatch() {
  const ids = [...checked.value].filter((id) => modelById.value.has(id));
  if (!ids.length) return;
  const amount = Math.min(batch.amount, amountMax(batch.mode, batch.direction));
  const value = isSubscriber.value || batch.direction === "up" ? amount : -amount;
  for (const id of ids) editingModels.value[id] = { mode: batch.mode, value };
  ElMessage.success(`已为 ${ids.length} 个模型设置 ${formatAdjustment(isSubscriber.value ? subscriberAdjustment({ mode: batch.mode, value }) : { mode: batch.mode, value })}`);
}

function removeBatch() {
  for (const id of checked.value) delete editingModels.value[id];
}

function effectiveAdjustment(adjustment: Adjustment): Adjustment {
  return isSubscriber.value ? subscriberAdjustment(adjustment) : adjustment;
}

function priceText(model: ScheduleModel): string {
  return model.tiered && model.minPricePoints !== model.maxPricePoints
    ? `${formatPoints(model.minPricePoints)}–${formatPoints(model.maxPricePoints)}`
    : formatPoints(model.pricePoints);
}

function previewText(model: ScheduleModel, adjustment: Adjustment): string {
  const effective = effectiveAdjustment(adjustment);
  if (model.tiered && model.minPricePoints !== model.maxPricePoints) {
    return `${formatPoints(applyAdjustment(model.minPricePoints, effective, model))}–${formatPoints(applyAdjustment(model.maxPricePoints, effective, model))}`;
  }
  return formatPoints(applyAdjustment(model.pricePoints, effective, model));
}

function previewTone(model: ScheduleModel, adjustment: Adjustment): string {
  const effective = effectiveAdjustment(adjustment);
  if (hitsFloor(model.tiered ? model.minPricePoints : model.pricePoints, effective, model)) return "is-floor";
  if (effective.value < 0) return "is-down";
  if (effective.value > 0) return "is-up";
  return "";
}

watch(selected, () => {
  checked.value = new Set();
});

onMounted(() => {
  void load();
  clockTimer = window.setInterval(() => {
    now.value = new Date();
  }, 1000);
});
onBeforeUnmount(() => window.clearInterval(clockTimer));

defineExpose({ dirty });
</script>

<template>
  <div v-loading="loading" class="ps">
    <header class="ps-head">
      <label class="ps-master">
        <el-switch v-model="draft.enabled" />
        <span><strong>启用动态调价</strong><small>关闭后所有时段规则暂停，订阅优惠不受影响</small></span>
      </label>
      <div class="ps-status">
        <span class="ps-clock">北京时间 <b class="tnum">{{ clock }}</b></span>
        <span v-if="liveCount" class="ps-live">当前 {{ liveCount }} 个模型按规则调价</span>
        <span v-else class="ps-idle">当前没有生效的时段规则</span>
        <span v-if="nextChangeText" class="ps-next">下次变化 <b class="tnum">{{ nextChangeText }}</b></span>
      </div>
      <div class="ps-actions">
        <el-button :disabled="!dirty || saving" @click="reset">撤销更改</el-button>
        <el-button type="primary" :disabled="!dirty" :loading="saving" @click="save">保存调价规则</el-button>
      </div>
    </header>
    <p class="ps-note">
      只影响站内用户（各生图页面、AI 助手、AI 电商）；开发者 API 不参与。价格以用户<b>提交任务时</b>的北京时间为准，提交时价格更低直接按低价扣费，更高则提示用户重新确认。
      同一模型同时命中多条规则时只取一条：<b>指定日期 &gt; 周末 &gt; 工作日</b>，同类型取列表中靠前的。
    </p>

    <div class="ps-body">
      <aside class="ps-rules">
        <div class="ps-rules__head">
          <strong>时段规则</strong>
          <el-dropdown trigger="click" @command="addRule">
            <el-button size="small" :icon="Plus">新建规则</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="kind in (['weekday', 'weekend', 'date'] as RuleKind[])" :key="kind" :command="kind">
                  <span class="ps-menu-item"><b>{{ KIND_LABELS[kind] }}</b><small>{{ KIND_HINTS[kind] }}</small></span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <p v-if="!draft.rules.length" class="ps-empty">还没有时段规则。新建一条工作日、周末或指定日期规则，再勾选参与的模型。</p>
        <button
          v-for="rule in draft.rules"
          :key="rule.id"
          type="button"
          class="ps-rule"
          :class="{ 'is-selected': selected === rule.id, 'is-off': !rule.enabled || !draft.enabled }"
          @click="selected = rule.id"
        >
          <span class="ps-rule__top">
            <span class="ps-kind" :class="`is-${rule.kind}`">{{ KIND_LABELS[rule.kind] }}</span>
            <strong>{{ rule.name || "未命名规则" }}</strong>
            <em v-if="ruleProblem(rule)" class="ps-flag is-warn">待修正</em>
            <em v-else-if="liveRules.get(rule.id)" class="ps-flag is-live">生效中</em>
            <em v-else-if="!rule.enabled" class="ps-flag">已停用</em>
          </span>
          <small class="tnum">{{ ruleWindowText(rule) }}</small>
          <small>{{ Object.keys(rule.models).length }} 个模型</small>
        </button>

        <div class="ps-rules__head is-sub"><strong>订阅用户</strong></div>
        <button
          type="button"
          class="ps-rule is-subscriber"
          :class="{ 'is-selected': isSubscriber, 'is-off': !draft.subscriber.enabled }"
          @click="selected = SUBSCRIBER"
        >
          <span class="ps-rule__top">
            <span class="ps-kind is-subscriber">订阅</span>
            <strong>订阅用户额外优惠</strong>
            <em v-if="draft.subscriber.enabled" class="ps-flag is-live">始终生效</em>
            <em v-else class="ps-flag">未开启</em>
          </span>
          <small>在当前价格上再减，不看时段</small>
          <small>{{ Object.keys(draft.subscriber.models).length }} 个模型</small>
        </button>
      </aside>

      <section class="ps-editor">
        <div v-if="selectedRule" class="ps-form">
          <label class="ps-field is-name">
            <span>规则名称</span>
            <el-input v-model="selectedRule.name" maxlength="40" placeholder="例如：工作日白天降价" />
          </label>
          <label class="ps-field">
            <span>类型</span>
            <el-select :model-value="selectedRule.kind" @update:model-value="(value: RuleKind) => changeKind(selectedRule!, value)">
              <el-option v-for="kind in (['weekday', 'weekend', 'date'] as RuleKind[])" :key="kind" :value="kind" :label="KIND_LABELS[kind]" />
            </el-select>
          </label>
          <label v-if="selectedRule.kind !== 'date'" class="ps-field is-window">
            <span>每天时段（北京时间）</span>
            <span class="ps-window">
              <el-select v-model="selectedRule.startTime" filterable allow-create default-first-option placeholder="开始">
                <el-option v-for="option in CLOCK_OPTIONS.slice(0, -1)" :key="option" :value="option" />
              </el-select>
              <i>至</i>
              <el-select v-model="selectedRule.endTime" filterable allow-create default-first-option placeholder="结束">
                <el-option v-for="option in CLOCK_OPTIONS.slice(1)" :key="option" :value="option" />
              </el-select>
            </span>
          </label>
          <label v-else class="ps-field is-window">
            <span>起止时间（北京时间）</span>
            <el-date-picker
              :model-value="dateRange(selectedRule)"
              type="datetimerange"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm"
              start-placeholder="开始"
              end-placeholder="结束"
              :clearable="false"
              @update:model-value="(value: [string, string] | null) => setDateRange(selectedRule!, value)"
            />
          </label>
          <label class="ps-field is-switch">
            <span>启用</span>
            <el-switch v-model="selectedRule.enabled" />
          </label>
          <span class="ps-form__tools">
            <el-button link :icon="ArrowUp" :disabled="draft.rules[0]?.id === selectedRule.id" title="上移（同类型规则靠前优先）" @click="moveRule(selectedRule, -1)" />
            <el-button link :icon="ArrowDown" :disabled="draft.rules[draft.rules.length - 1]?.id === selectedRule.id" title="下移" @click="moveRule(selectedRule, 1)" />
            <el-button link type="danger" :icon="Delete" title="删除规则" @click="removeRule(selectedRule)" />
          </span>
          <p v-if="ruleProblem(selectedRule)" class="ps-problem">{{ ruleProblem(selectedRule) }}</p>
        </div>
        <div v-else class="ps-form">
          <label class="ps-field is-switch">
            <span>开启订阅优惠</span>
            <el-switch v-model="draft.subscriber.enabled" />
          </label>
          <p class="ps-form__hint">
            有生效中订阅的用户，在当时的站内价格（含时段调价）基础上再减去下面设置的积分或百分比；不看时段，开发者 API 不参与。只对勾选参与的模型生效。
          </p>
        </div>

        <div class="ps-toolbar">
          <el-input v-model="search" class="ps-search" :prefix-icon="Search" clearable placeholder="搜索模型、服务商" />
          <div class="ps-tabs" role="tablist">
            <button
              v-for="filter in KIND_FILTERS"
              :key="filter.value"
              type="button"
              :class="{ 'is-active': kindFilter === filter.value }"
              @click="kindFilter = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
          <span class="ps-count">参与 <b>{{ participating }}</b> / {{ models.length }}</span>
          <div class="ps-batch" :class="{ 'is-idle': !checked.size }">
            <span>已选 <b>{{ checked.size }}</b></span>
            <el-radio-group v-if="!isSubscriber" v-model="batch.direction" size="small">
              <el-radio-button value="down">下调</el-radio-button>
              <el-radio-button value="up">上调</el-radio-button>
            </el-radio-group>
            <span v-else class="ps-batch__label">再减</span>
            <PointsInput v-model="batch.amount" class="ps-batch__amount" size="small" :max="amountMax(batch.mode, batch.direction)" />
            <el-select v-model="batch.mode" size="small" class="ps-unit">
              <el-option value="percent" label="%" />
              <el-option value="points" label="积分" />
            </el-select>
            <el-button size="small" type="primary" :disabled="!checked.size" @click="applyBatch">应用到所选</el-button>
            <el-button size="small" :disabled="!checked.size" @click="removeBatch">移出所选</el-button>
          </div>
        </div>

        <div class="ps-table-wrap">
          <table class="ps-table">
            <thead>
              <tr>
                <th class="is-check">
                  <el-checkbox :model-value="allVisibleChecked" :indeterminate="!allVisibleChecked && visibleModels.some((model) => checked.has(model.id))" @update:model-value="(value) => toggleAllVisible(Boolean(value))" />
                </th>
                <th>模型</th>
                <th class="is-num">当前价</th>
                <th class="is-join">参与</th>
                <th>{{ isSubscriber ? "订阅再减" : "调价" }}</th>
                <th class="is-num">{{ isSubscriber ? "订阅价" : "调价后" }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in visibleModels" :key="model.id" :class="{ 'is-on': editingModels[model.id], 'is-disabled': !model.enabled }">
                <td class="is-check">
                  <el-checkbox :model-value="checked.has(model.id)" @update:model-value="(value) => toggleChecked(model.id, Boolean(value))" />
                </td>
                <td>
                  <span class="ps-model">
                    <strong :title="model.id">{{ model.name }}</strong>
                    <span class="ps-model__kind">{{ MODEL_KIND_LABELS[model.kind] || model.kind }}</span>
                    <small>{{ model.providerName || "—" }}<template v-if="model.tiered"> · 分档计价</template><template v-if="!model.enabled"> · 已停用</template></small>
                  </span>
                </td>
                <td class="is-num tnum">{{ priceText(model) }}</td>
                <td class="is-join">
                  <el-switch size="small" :model-value="Boolean(editingModels[model.id])" @update:model-value="(value) => setParticipating(model.id, Boolean(value))" />
                </td>
                <td>
                  <span v-if="editingModels[model.id]" class="ps-adjust">
                    <el-radio-group
                      v-if="!isSubscriber"
                      size="small"
                      :model-value="direction(editingModels[model.id])"
                      @update:model-value="(value) => setDirection(model.id, value as 'down' | 'up')"
                    >
                      <el-radio-button value="down">降</el-radio-button>
                      <el-radio-button value="up">涨</el-radio-button>
                    </el-radio-group>
                    <PointsInput
                      size="small"
                      class="ps-adjust__amount"
                      :model-value="Math.abs(editingModels[model.id].value)"
                      :max="amountMax(editingModels[model.id].mode, direction(editingModels[model.id]))"
                      @update:model-value="(value) => setAmount(model.id, value)"
                    />
                    <el-select size="small" class="ps-unit" :model-value="editingModels[model.id].mode" @update:model-value="(value: AdjustMode) => setMode(model.id, value)">
                      <el-option value="percent" label="%" />
                      <el-option value="points" label="积分" />
                    </el-select>
                  </span>
                  <span v-else class="ps-muted">不参与</span>
                </td>
                <td class="is-num">
                  <template v-if="editingModels[model.id]">
                    <b class="ps-preview tnum" :class="previewTone(model, editingModels[model.id])">{{ previewText(model, editingModels[model.id]) }}</b>
                    <small v-if="previewTone(model, editingModels[model.id]) === 'is-floor'" class="ps-floor">已到底线</small>
                  </template>
                  <span v-else class="ps-muted tnum">{{ priceText(model) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!visibleModels.length" class="ps-empty is-table">没有匹配的模型（只列出对用户开放的模型）。</p>
        </div>
        <p class="ps-foot">
          百分比按四舍五入取整，幅度范围 {{ MIN_PERCENT }}% 到 +{{ MAX_PERCENT }}%。降价不会低于模型的底线：不允许零积分时至少 1 积分，不允许低于成本时不低于上游成本（在模型的「价格策略」里设置）。
          分档计价的模型每一格按同样的幅度调整；页面单价也一并调整。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ps {
  display: grid;
  gap: 10px;
}
.ps-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.ps-master {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.ps-master > span {
  display: grid;
}
.ps-master strong {
  color: var(--ink);
  font-size: 14px;
}
.ps-master small,
.ps-note,
.ps-foot,
.ps-form__hint {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.6;
}
.ps-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-2);
}
.ps-status > span {
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}
.ps-status b {
  color: var(--ink);
  font-weight: 650;
}
.ps-status .ps-live {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.ps-actions {
  display: inline-flex;
  margin-left: auto;
}
.ps-note,
.ps-foot {
  margin: 0;
  padding: 0 4px;
}
.ps-note b {
  color: var(--ink-2);
}
.ps-body {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

/* 左侧规则列表 */
.ps-rules {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.ps-rules__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 2px;
}
.ps-rules__head.is-sub {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.ps-rules__head strong {
  color: var(--ink);
  font-size: 13px;
}
.ps-menu-item {
  display: grid;
  line-height: 1.4;
}
.ps-menu-item small {
  color: var(--ink-3);
  font-size: 11px;
}
.ps-rule {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.ps-rule:hover {
  border-color: var(--border-strong);
}
.ps-rule.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.ps-rule.is-off:not(.is-selected) {
  opacity: 0.6;
}
.ps-rule__top {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.ps-rule__top strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-rule small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-kind {
  flex: none;
  padding: 0 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 650;
  line-height: 18px;
}
.ps-kind.is-weekday { background: color-mix(in srgb, var(--info) 14%, transparent); color: var(--info); }
.ps-kind.is-weekend { background: color-mix(in srgb, var(--violet) 14%, transparent); color: var(--violet); }
.ps-kind.is-date { background: var(--warning-soft); color: var(--warning); }
.ps-kind.is-subscriber { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
.ps-flag {
  flex: none;
  margin-left: auto;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--ink-3);
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
}
.ps-flag.is-live { background: var(--accent); color: var(--accent-on); }
.ps-flag.is-warn { background: var(--warning-soft); color: var(--warning); }
.ps-empty {
  margin: 0;
  padding: 14px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
.ps-empty.is-table {
  margin: 10px;
}

/* 右侧编辑区 */
.ps-editor {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.ps-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.ps-field {
  display: grid;
  gap: 4px;
}
.ps-field > span:first-child {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}
.ps-field.is-name { width: 240px; }
.ps-field .el-select { width: 120px; }
.ps-field.is-window :deep(.el-date-editor) { width: 340px; }
.ps-field.is-switch {
  justify-items: start;
}
.ps-field.is-switch .el-switch {
  height: 32px;
}
.ps-window {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ps-window .el-select {
  width: 100px;
}
.ps-window i {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
}
.ps-form__tools {
  display: inline-flex;
  margin-left: auto;
  padding-bottom: 6px;
}
.ps-form__hint {
  flex: 1 1 400px;
  margin: 0;
  padding-bottom: 6px;
}
.ps-problem {
  flex-basis: 100%;
  margin: 0;
  color: var(--warning);
  font-size: 12px;
}
.ps-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.ps-search {
  width: 220px;
}
.ps-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}
.ps-tabs button {
  padding: 3px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ps-tabs button.is-active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.ps-count {
  color: var(--ink-3);
  font-size: 12px;
}
.ps-count b,
.ps-batch b {
  color: var(--ink);
}
.ps-batch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 4px 6px 4px 10px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 12px;
  color: var(--ink-2);
}
.ps-batch.is-idle {
  opacity: 0.7;
}
.ps-batch__amount {
  width: 72px;
}
.ps-batch .el-button + .el-button {
  margin-left: 0;
}
.ps-unit {
  width: 72px;
}
.ps-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 540px);
  min-height: 240px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.ps-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ps-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.ps-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.ps-table tr:last-child td {
  border-bottom: 0;
}
.ps-table tr.is-on td {
  background: color-mix(in srgb, var(--accent-soft) 45%, transparent);
}
.ps-table tr.is-disabled td {
  color: var(--ink-3);
}
.ps-table .is-check {
  width: 36px;
}
.ps-table .is-join {
  width: 56px;
}
.ps-table .is-num {
  text-align: right;
  white-space: nowrap;
}
.ps-model {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: start;
  align-items: center;
  column-gap: 8px;
}
.ps-model strong {
  overflow: hidden;
  max-width: 280px;
  color: var(--ink);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-model__kind {
  padding: 0 6px;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--ink-2);
  font-size: 11px;
  line-height: 18px;
}
.ps-model small {
  grid-column: 1 / -1;
  color: var(--ink-3);
  font-size: 11px;
}
.ps-adjust {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ps-adjust__amount {
  width: 76px;
}
.ps-muted {
  color: var(--ink-3);
  font-size: 12px;
}
.ps-preview {
  font-weight: 700;
}
.ps-preview.is-down { color: var(--success); }
.ps-preview.is-up { color: var(--danger); }
.ps-preview.is-floor { color: var(--warning); }
.ps-floor {
  display: block;
  color: var(--warning);
  font-size: 11px;
}
</style>
