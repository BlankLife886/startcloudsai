<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { InfoFilled, Refresh, Switch } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import PointsInput from "./PointsInput.vue";
import { request } from "@/request";

interface SlotSettings {
  failureThreshold: number;
  probeIntervalMinutes: number;
  probeDailyLimit: number;
}

interface MemberView {
  modelId: string;
  name: string;
  order: number;
  active: boolean;
  status: "healthy" | "down";
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureMessage: string;
  lastSuccessAt: string | null;
  downSince: string | null;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  lastProbeMessage: string;
  nextProbeAt: string | null;
}

interface SlotView {
  modelId: string;
  modelName: string;
  resolution: string;
  autoFailover: boolean;
  activeModelId: string;
  onBackup: boolean;
  unavailable: boolean;
  switchedAt: string | null;
  members: MemberView[];
}

interface SlotEvent {
  id: number;
  modelId: string;
  resolution: string;
  kind: string;
  memberModelId: string;
  fromModelId: string;
  toModelId: string;
  ok: boolean | null;
  message: string;
  createdAt: string;
}

interface Overview {
  settings: SlotSettings;
  probesUsed24h: number;
  slots: SlotView[];
  events: SlotEvent[];
  modelNames: Record<string, string>;
}

const EVENT_LABELS: Record<string, string> = {
  switch: "切换",
  all_down: "全部不可用",
  manual: "手动切换",
  member_down: "判定故障",
  member_up: "恢复",
  probe: "检测",
  member_reset: "手动恢复",
};

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const overview = ref<Overview | null>(null);
const loading = ref(false);
const busy = ref("");
const settingsDraft = reactive<SlotSettings>({ failureThreshold: 3, probeIntervalMinutes: 60, probeDailyLimit: 48 });

async function load() {
  loading.value = true;
  try {
    apply(await request<Overview>("/api/v1/admin/model-config/image-slots"));
  } catch {
    // request() already shows the error; the panel keeps its last state.
  } finally {
    loading.value = false;
  }
}

function apply(data: Overview) {
  overview.value = data;
  Object.assign(settingsDraft, data.settings);
}

watch(visible, (open) => {
  if (open) void load();
});

async function act(key: string, path: string, body: Record<string, unknown>, method: "POST" | "PUT" = "POST") {
  busy.value = key;
  try {
    apply(await request<Overview>(`/api/v1/admin/model-config/image-slots/${path}`, { method, body }));
    return true;
  } catch {
    return false;
  } finally {
    busy.value = "";
  }
}

const settingsDirty = computed(() => {
  const saved = overview.value?.settings;
  if (!saved) return false;
  return (Object.keys(settingsDraft) as (keyof SlotSettings)[]).some((key) => settingsDraft[key] !== saved[key]);
});

const probeUsage = computed(() => {
  const used = overview.value?.probesUsed24h ?? 0;
  const limit = overview.value?.settings.probeDailyLimit ?? 0;
  return { used, limit, percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0 };
});

const slotCounts = computed(() => {
  const slots = overview.value?.slots || [];
  return {
    total: slots.length,
    backup: slots.filter((slot) => !slot.unavailable && slot.onBackup).length,
    down: slots.filter((slot) => slot.unavailable).length,
  };
});

const view = ref<"slots" | "members">("slots");

interface MemberUsage {
  ownerName: string;
  resolution: string;
  role: string;
  active: boolean;
  status: MemberView["status"];
}

/** Each model that serves in any slot, with every slot that borrows it. */
const memberUsages = computed(() => {
  const byMember = new Map<string, { modelId: string; name: string; usages: MemberUsage[] }>();
  for (const slot of overview.value?.slots || []) {
    for (const member of slot.members) {
      const entry = byMember.get(member.modelId) || { modelId: member.modelId, name: member.name, usages: [] };
      entry.usages.push({
        ownerName: slot.modelId === member.modelId ? `${slot.modelName}（自身）` : slot.modelName,
        resolution: slot.resolution,
        role: member.order === 0 ? "主模型" : `备用 ${member.order}`,
        active: member.active,
        status: member.status,
      });
      byMember.set(member.modelId, entry);
    }
  }
  return [...byMember.values()].sort((a, b) => b.usages.length - a.usages.length || a.name.localeCompare(b.name));
});

async function saveSettings() {
  if (await act("settings", "settings", { ...settingsDraft }, "PUT")) ElMessage.success("已保存");
}

async function probe(slot: SlotView, member: MemberView) {
  if (await act(`probe:${slot.modelId}:${slot.resolution}:${member.modelId}`, "probe", { modelId: slot.modelId, resolution: slot.resolution, memberModelId: member.modelId })) {
    const current = overview.value?.slots
      .find((item) => item.modelId === slot.modelId && item.resolution === slot.resolution)
      ?.members.find((item) => item.modelId === member.modelId);
    if (current?.lastProbeOk) ElMessage.success(`检测通过：${current.lastProbeMessage}`);
    else ElMessage.warning(`检测未通过：${current?.lastProbeMessage || "未知原因"}`);
  }
}

async function reset(slot: SlotView, member: MemberView) {
  try {
    await ElMessageBox.confirm(`把 ${member.name} 在 ${slot.resolution} 上标记为正常？自动切换的槽位会立即按顺序重新选择模型。`, "手动恢复", { type: "warning" });
  } catch {
    return;
  }
  await act(`reset:${slot.resolution}:${member.modelId}`, "reset", { modelId: slot.modelId, resolution: slot.resolution, memberModelId: member.modelId });
}

async function switchTo(slot: SlotView, member: MemberView) {
  await act(`switch:${slot.modelId}:${slot.resolution}`, "switch", { modelId: slot.modelId, resolution: slot.resolution, memberModelId: member.modelId });
}

function time(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function slotState(slot: SlotView): { label: string; tone: string } {
  if (slot.unavailable) return { label: slot.autoFailover ? "全部不可用" : "当前模型故障", tone: "danger" };
  if (slot.onBackup) return { label: slot.autoFailover ? "使用备用中" : "手动指定备用", tone: "warning" };
  return { label: "主模型运行中", tone: "success" };
}

function name(id: string): string {
  return overview.value?.modelNames[id] || id;
}

function eventText(event: SlotEvent): string {
  const subject = event.modelId ? `${name(event.modelId)} · ${event.resolution}` : `${name(event.memberModelId)} · ${event.resolution}`;
  return `${subject}：${event.message || `${name(event.fromModelId)} → ${name(event.toModelId)}`}`;
}
</script>

<template>
  <AdminDialog
    v-model="visible"
    title="分辨率槽位状态"
    subtitle="每个分辨率当前使用的模型、各模型健康度与切换记录"
    :icon="Switch"
    width="1080px"
    hide-footer
  >
    <div v-loading="loading" class="ss">
      <section class="ss-panel">
        <header class="ss-panel__head">
          <strong>检测与切换设置</strong>
          <small>对全部槽位生效</small>
          <span class="ss-panel__actions">
            <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
            <el-button type="primary" :disabled="!settingsDirty" :loading="busy === 'settings'" @click="saveSettings">保存设置</el-button>
          </span>
        </header>
        <div class="ss-settings">
          <label class="ss-setting">
            <span class="ss-setting__label">连续失败判定故障</span>
            <PointsInput v-model="settingsDraft.failureThreshold" :min="1" :max="20" suffix="次" />
            <small>连续失败达到次数判为故障，成功一次清零（1–20）</small>
          </label>
          <label class="ss-setting">
            <span class="ss-setting__label">故障模型检测间隔</span>
            <PointsInput v-model="settingsDraft.probeIntervalMinutes" :min="5" :max="1440" suffix="分钟" />
            <small>故障模型每隔多久真实出图检测一次（5–1440）</small>
          </label>
          <label class="ss-setting">
            <span class="ss-setting__label">
              24 小时检测上限
              <em>已用 {{ probeUsage.used }}<template v-if="probeUsage.limit"> / {{ probeUsage.limit }}</template></em>
            </span>
            <PointsInput v-model="settingsDraft.probeDailyLimit" :min="0" :max="1000" suffix="次" />
            <span class="ss-meter" :class="{ 'is-full': probeUsage.limit && probeUsage.used >= probeUsage.limit }">
              <i :style="{ width: `${probeUsage.percent}%` }" />
            </span>
            <small>全部槽位共用，为 0 时停止自动检测（0–1000）</small>
          </label>
        </div>
        <p class="ss-note">
          <el-icon><InfoFilled /></el-icon>
          <span>检测会真实出一张低质量图并产生上游费用；上限为 0 时不再自动检测，只能手动标记恢复。CRUN 类服务商暂不支持自动检测。</span>
        </p>
      </section>

      <div v-if="overview && !overview.slots.length" class="ss-empty">
        <el-icon><Switch /></el-icon>
        <strong>还没有配置分辨率槽位</strong>
        <span>在模型编辑的「分辨率槽位」里为生图模型设置主模型和备用模型。</span>
      </div>

      <header v-if="slotCounts.total" class="ss-summary">
        <strong>槽位</strong>
        <span>共 {{ slotCounts.total }} 个</span>
        <span v-if="slotCounts.backup" class="is-warning">{{ slotCounts.backup }} 个使用备用</span>
        <span v-if="slotCounts.down" class="is-danger">{{ slotCounts.down }} 个不可用</span>
        <el-segmented v-model="view" class="ss-view" size="small" :options="[{ label: '按槽位', value: 'slots' }, { label: '按成员模型', value: 'members' }]" />
      </header>

      <table v-if="view === 'members' && memberUsages.length" class="ss-members">
        <thead>
          <tr><th>成员模型</th><th>被借用</th><th>用在哪里</th></tr>
        </thead>
        <tbody>
          <tr v-for="member in memberUsages" :key="member.modelId">
            <td><strong>{{ member.name }}</strong></td>
            <td>{{ member.usages.length }} 处</td>
            <td>
              <span v-for="usage in member.usages" :key="`${usage.ownerName}:${usage.resolution}`" class="ss-usage" :class="{ 'is-down': usage.status === 'down' }">
                {{ usage.ownerName }} · {{ usage.resolution }} · {{ usage.role }}<template v-if="usage.active"> · 使用中</template><template v-if="usage.status === 'down'"> · 故障</template>
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-show="view === 'slots'" class="ss-slots">
        <article v-for="slot in overview?.slots || []" :key="`${slot.modelId}:${slot.resolution}`" class="ss-slot" :class="`is-${slotState(slot).tone}`">
          <header>
            <span class="ss-res">{{ slot.resolution }}</span>
            <strong>{{ slot.modelName }}</strong>
            <el-tag size="small" :type="slotState(slot).tone as any">{{ slotState(slot).label }}</el-tag>
            <el-tag size="small" effect="plain" type="info">{{ slot.autoFailover ? "自动切换" : "手动切换" }}</el-tag>
            <small v-if="slot.switchedAt">上次切换 {{ time(slot.switchedAt) }}</small>
          </header>
          <table>
            <thead>
              <tr><th>顺序</th><th>模型</th><th>状态</th><th>最近失败</th><th>最近检测</th><th>下次检测</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="member in slot.members" :key="member.modelId" :class="{ 'is-active': member.active }">
                <td>{{ member.order === 0 ? "主" : `备 ${member.order}` }}</td>
                <td>
                  <strong>{{ member.name }}</strong>
                  <el-tag v-if="member.active" size="small" type="primary" effect="plain">使用中</el-tag>
                </td>
                <td>
                  <el-tag size="small" :type="member.status === 'down' ? 'danger' : 'success'">{{ member.status === "down" ? "故障" : "正常" }}</el-tag>
                  <small v-if="member.consecutiveFailures" class="ss-muted">连续失败 {{ member.consecutiveFailures }}</small>
                </td>
                <td :title="member.lastFailureMessage">
                  {{ time(member.lastFailureAt) }}
                  <small v-if="member.lastFailureMessage" class="ss-msg">{{ member.lastFailureMessage }}</small>
                </td>
                <td :title="member.lastProbeMessage">
                  <template v-if="member.lastProbeAt">
                    <span :class="member.lastProbeOk ? 'ss-ok' : 'ss-bad'">{{ member.lastProbeOk ? "✓" : "✕" }}</span> {{ time(member.lastProbeAt) }}
                    <small class="ss-msg">{{ member.lastProbeMessage }}</small>
                  </template>
                  <template v-else>—</template>
                </td>
                <td>{{ member.status === "down" ? time(member.nextProbeAt) : "—" }}</td>
                <td class="ss-actions">
                  <el-button link size="small" :loading="busy === `probe:${slot.modelId}:${slot.resolution}:${member.modelId}`" :disabled="!!busy" @click="probe(slot, member)">立即检测</el-button>
                  <el-button v-if="member.status === 'down'" link size="small" :disabled="!!busy" @click="reset(slot, member)">标记正常</el-button>
                  <el-button v-if="!slot.autoFailover && !member.active" link size="small" type="primary" :disabled="!!busy" @click="switchTo(slot, member)">切换到此模型</el-button>
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>

      <section v-if="overview?.events.length" class="ss-events">
        <h4>最近记录</h4>
        <ol>
          <li v-for="event in overview.events.slice(0, 60)" :key="event.id">
            <time>{{ time(event.createdAt) }}</time>
            <el-tag size="small" effect="plain" :type="event.kind === 'all_down' || event.kind === 'member_down' || event.ok === false ? 'danger' : event.kind === 'switch' ? 'warning' : 'info'">
              {{ EVENT_LABELS[event.kind] || event.kind }}
            </el-tag>
            <span>{{ eventText(event) }}</span>
          </li>
        </ol>
      </section>
    </div>
  </AdminDialog>
</template>

<style scoped>
.ss {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 240px;
}
.ss-panel {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.ss-panel__head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ss-panel__head strong {
  color: var(--ink);
  font-size: 13px;
}
.ss-panel__head small {
  color: var(--ink-3);
  font-size: 11px;
}
.ss-panel__actions {
  display: inline-flex;
  margin-left: auto;
}
.ss-settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.ss-setting {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
}
.ss-setting__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}
.ss-setting__label em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.ss-setting small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.5;
}
.ss-meter {
  display: block;
  height: 4px;
  margin-top: 2px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
}
.ss-meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s;
}
.ss-meter.is-full i {
  background: var(--warning);
}
.ss-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.6;
}
.ss-note .el-icon {
  flex: none;
  margin-top: 3px;
  color: var(--info);
}
.ss-empty {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 36px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
  color: var(--ink-3);
  font-size: 12px;
  text-align: center;
}
.ss-empty .el-icon {
  font-size: 22px;
  color: var(--ink-3);
}
.ss-empty strong {
  color: var(--ink-2);
  font-size: 13px;
}
.ss-muted {
  font-size: 12px;
  color: var(--ink-3);
}
.ss-summary {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  color: var(--ink-3);
}
.ss-summary strong {
  color: var(--ink);
  font-size: 13px;
}
.ss-summary .is-warning { color: var(--warning); }
.ss-view { margin-left: auto; }
.ss-members { width: 100%; border-collapse: collapse; font-size: 13px; }
.ss-members th, .ss-members td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.ss-members th { color: var(--ink-3); font-weight: 500; }
.ss-usage { display: inline-block; margin: 2px 6px 2px 0; padding: 2px 8px; border-radius: 5px; background: var(--el-fill-color-light); }
.ss-usage.is-down { color: var(--danger); }
.ss-summary .is-danger { color: var(--danger); }
.ss-res {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--surface);
  font-size: 12px;
  font-weight: 700;
}
.ss-slots {
  display: grid;
  gap: 10px;
}
.ss-slot {
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-left-width: 3px;
  border-radius: 12px;
  background: var(--el-bg-color);
}
.ss-slot.is-success { border-left-color: var(--el-color-success); }
.ss-slot.is-warning { border-left-color: var(--el-color-warning); }
.ss-slot.is-danger { border-left-color: var(--el-color-danger); }
.ss-slot header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ss-slot header small {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ss-slot table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ss-slot th {
  padding: 4px 6px;
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}
.ss-slot td {
  padding: 6px;
  border-top: 1px solid var(--el-border-color-extra-light);
  vertical-align: top;
}
.ss-slot td strong {
  margin-right: 6px;
}
.ss-slot tr.is-active td {
  background: var(--el-fill-color-lighter);
}
.ss-msg {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ss-ok { color: var(--el-color-success); }
.ss-bad { color: var(--el-color-danger); }
.ss-actions {
  white-space: nowrap;
  text-align: right;
}
.ss-events h4 {
  margin: 4px 0 6px;
  font-size: 13px;
}
.ss-events ol {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
}
.ss-events li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
}
.ss-events time {
  flex: none;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
