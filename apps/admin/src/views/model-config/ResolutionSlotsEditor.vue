<script setup lang="ts">
import { ArrowDown, ArrowUp, Close, Plus } from "@element-plus/icons-vue";
import type { ResolutionSlot, ResolutionSlots } from "./imageTiers";

export interface SlotCandidateModel {
  id: string;
  name: string;
  upstreamModel: string;
  providerName: string;
  resolutions: string[];
  enabled: boolean;
}

const props = defineProps<{
  modelValue: ResolutionSlots;
  resolutions: string[];
  ownerId: string;
  models: SlotCandidateModel[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: ResolutionSlots] }>();

function slot(resolution: string): ResolutionSlot | null {
  return props.modelValue[resolution] || null;
}

function write(resolution: string, value: ResolutionSlot | null) {
  const next: ResolutionSlots = JSON.parse(JSON.stringify(props.modelValue));
  if (value) next[resolution] = value;
  else delete next[resolution];
  emit("update:modelValue", next);
}

function patch(resolution: string, change: Partial<ResolutionSlot>) {
  const current = slot(resolution);
  if (!current) return;
  const next = { ...current, ...change };
  if (!next.backupModelIds.length) next.autoFailover = false;
  write(resolution, next);
}

function options(resolution: string, exclude: string[]) {
  return props.models.filter(
    (model) => model.enabled && model.resolutions.includes(resolution) && !exclude.includes(model.id),
  );
}

function label(id: string): string {
  const model = props.models.find((item) => item.id === id);
  if (!model) return `${id}（已删除）`;
  return id === props.ownerId ? `${model.name}（本模型）` : model.name;
}

function detail(id: string): string {
  const model = props.models.find((item) => item.id === id);
  return model ? `${model.providerName} · ${model.upstreamModel}` : "";
}

// 卡片右上角的模式标签：与下方说明文字一一对应。
function mode(resolution: string): { text: string; tone: string } {
  const current = slot(resolution);
  if (!current) return { text: "未配置", tone: "idle" };
  if (current.autoFailover) return { text: "自动切换", tone: "auto" };
  if (current.backupModelIds.length) return { text: "手动切换", tone: "manual" };
  return { text: "无备用", tone: "warn" };
}

function addBackup(resolution: string, id: string) {
  const current = slot(resolution);
  if (!current || !id) return;
  patch(resolution, { backupModelIds: [...current.backupModelIds, id] });
}

function moveBackup(resolution: string, index: number, delta: number) {
  const current = slot(resolution);
  if (!current) return;
  const list = [...current.backupModelIds];
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  patch(resolution, { backupModelIds: list });
}

function removeBackup(resolution: string, index: number) {
  const current = slot(resolution);
  if (!current) return;
  patch(resolution, { backupModelIds: current.backupModelIds.filter((_, i) => i !== index) });
}
</script>

<template>
  <p v-if="!resolutions.length" class="slots-empty">先在「生图能力」里选择分辨率。</p>
  <div v-else class="slots">
    <article v-for="resolution in resolutions" :key="resolution" class="slot" :class="{ 'is-on': slot(resolution) }">
      <header class="slot-head">
        <span class="slot-res">{{ resolution }}</span>
        <span class="slot-mode" :class="`is-${mode(resolution).tone}`">{{ mode(resolution).text }}</span>
        <el-button
          v-if="slot(resolution)"
          class="slot-remove"
          link
          size="small"
          :icon="Close"
          aria-label="取消槽位"
          title="取消槽位"
          @click="write(resolution, null)"
        />
      </header>

      <div v-if="!slot(resolution)" class="slot-idle">
        <p>直接使用本模型自己的服务商线路。</p>
        <el-button :icon="Plus" @click="write(resolution, { primaryModelId: ownerId, backupModelIds: [], autoFailover: false })">
          配置主模型和备用
        </el-button>
      </div>

      <template v-else>
        <ol class="slot-chain">
          <li class="slot-member is-primary">
            <span class="slot-badge">主</span>
            <div class="slot-body">
              <el-select
                :model-value="slot(resolution)!.primaryModelId"
                filterable
                placeholder="选择主模型"
                @update:model-value="(value: string) => patch(resolution, { primaryModelId: value, backupModelIds: slot(resolution)!.backupModelIds.filter((id) => id !== value) })"
              >
                <el-option v-for="model in options(resolution, [])" :key="model.id" :label="label(model.id)" :value="model.id">
                  <span>{{ label(model.id) }}</span><small class="slot-option">{{ detail(model.id) }}</small>
                </el-option>
              </el-select>
              <small class="slot-detail">{{ detail(slot(resolution)!.primaryModelId) }}</small>
            </div>
          </li>
          <li v-for="(id, index) in slot(resolution)!.backupModelIds" :key="id" class="slot-member">
            <span class="slot-badge">{{ index + 1 }}</span>
            <div class="slot-body">
              <span class="slot-name" :title="label(id)">{{ label(id) }}</span>
              <small class="slot-detail">{{ detail(id) }}</small>
            </div>
            <span class="slot-actions">
              <el-button link size="small" :icon="ArrowUp" :disabled="index === 0" aria-label="上移" @click="moveBackup(resolution, index, -1)" />
              <el-button link size="small" :icon="ArrowDown" :disabled="index === slot(resolution)!.backupModelIds.length - 1" aria-label="下移" @click="moveBackup(resolution, index, 1)" />
              <el-button link size="small" type="danger" :icon="Close" aria-label="移除" @click="removeBackup(resolution, index)" />
            </span>
          </li>
          <li class="slot-member is-add">
            <span class="slot-badge"><el-icon><Plus /></el-icon></span>
            <div class="slot-body">
              <el-select
                :model-value="''"
                filterable
                placeholder="添加备用模型"
                @update:model-value="(value: string) => addBackup(resolution, value)"
              >
                <el-option
                  v-for="model in options(resolution, [slot(resolution)!.primaryModelId, ...slot(resolution)!.backupModelIds])"
                  :key="model.id" :label="label(model.id)" :value="model.id"
                >
                  <span>{{ label(model.id) }}</span><small class="slot-option">{{ detail(model.id) }}</small>
                </el-option>
              </el-select>
            </div>
          </li>
        </ol>

        <footer class="slot-foot">
          <label class="slot-auto">
            <span>故障时自动切换到备用</span>
            <el-switch
              :model-value="slot(resolution)!.autoFailover"
              :disabled="!slot(resolution)!.backupModelIds.length"
              size="small"
              @update:model-value="(value) => patch(resolution, { autoFailover: Boolean(value) })"
            />
          </label>
          <p class="slot-hint">
            <template v-if="slot(resolution)!.autoFailover">
              正在用的模型连续失败达到阈值后，按顺序切到下一个健康的模型；故障模型按检测间隔真实出图检测，恢复后自动切回排在前面的模型。
            </template>
            <template v-else-if="slot(resolution)!.backupModelIds.length">
              手动模式：故障时只告警并暂停该分辨率接单，在「槽位状态」里手动切换到备用模型。
            </template>
            <template v-else>
              没有备用模型：主模型故障时该分辨率暂停接单。开启自动切换至少需要一个备用模型。
            </template>
          </p>
        </footer>
      </template>
    </article>
  </div>
</template>

<style scoped>
.slots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  align-items: start;
}
.slot {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
  background: var(--surface-2);
}
.slot.is-on {
  border-style: solid;
  border-color: var(--border);
  background: var(--surface);
}
.slot-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slot-res {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--surface);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.slot:not(.is-on) .slot-res {
  background: var(--surface-3);
  color: var(--ink-2);
}
.slot-mode {
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  line-height: 18px;
}
.slot-mode.is-idle { background: var(--surface-3); color: var(--ink-3); }
.slot-mode.is-auto { background: var(--accent-soft); color: var(--accent-ink); }
.slot-mode.is-manual { background: color-mix(in srgb, var(--info) 12%, transparent); color: var(--info); }
.slot-mode.is-warn { background: var(--warning-soft); color: var(--warning); }
.slot-remove {
  margin-left: auto;
  color: var(--ink-3);
}
.slot-remove:hover {
  color: var(--danger);
}
.slot-idle {
  display: grid;
  justify-items: start;
  gap: 8px;
}
.slot-idle p {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
}

/* 主模型 → 备用 1 → 备用 2 … 竖向串起来，序号圆点之间连一条线。 */
.slot-chain {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.slot-member {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
}
.slot-member + .slot-member::before {
  content: "";
  position: absolute;
  top: -9px;
  left: 11px;
  height: 18px;
  border-left: 1px solid var(--border-strong);
}
.slot-member.is-add::before {
  border-left-style: dashed;
}
.slot-badge {
  position: relative;
  z-index: 1;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;
}
.is-primary .slot-badge {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-on);
}
.is-add .slot-badge {
  border-style: dashed;
  color: var(--ink-3);
}
.slot-body {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.slot-body .el-select {
  width: 100%;
}
.slot-name {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-detail,
.slot-option {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-detail:empty {
  display: none;
}
.slot-option {
  margin-left: 8px;
}
.slot-actions {
  display: inline-flex;
}
.slot-actions .el-button + .el-button {
  margin-left: 2px;
}
.slot-foot {
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.slot-auto {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}
.slot-hint,
.slots-empty {
  margin: 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.6;
}
</style>
