<script setup lang="ts">
import { computed } from "vue";
import { formatPoints } from "@/utils";
import PointsInput from "./PointsInput.vue";
import { TIER_QUALITY_LABELS, effectiveTierPrice, type ImagePricingMatrix, type ImageTierPrice } from "./imageTiers";

const props = defineProps<{
  modelValue: ImagePricingMatrix;
  resolutions: string[];
  qualities: string[];
  allowLossLeader: boolean;
  allowZeroPrice: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: ImagePricingMatrix] }>();

function cell(resolution: string, quality: string): ImageTierPrice {
  return props.modelValue[resolution]?.[quality] || { priceCents: 0, discountPriceCents: null, upstreamCostCents: 0 };
}

function update(resolution: string, quality: string, patch: Partial<ImageTierPrice>) {
  const next: ImagePricingMatrix = JSON.parse(JSON.stringify(props.modelValue));
  next[resolution] = next[resolution] || {};
  const merged = { ...cell(resolution, quality), ...patch };
  if (merged.discountPriceCents !== null) merged.discountPriceCents = Math.min(merged.discountPriceCents, merged.priceCents);
  next[resolution][quality] = merged;
  emit("update:modelValue", next);
}

function toggleDiscount(resolution: string, quality: string, enabled: boolean) {
  const current = cell(resolution, quality);
  update(resolution, quality, { discountPriceCents: enabled ? current.priceCents : null });
}

function warning(resolution: string, quality: string): string {
  const value = cell(resolution, quality);
  const effective = effectiveTierPrice(value);
  if (effective === 0 && !props.allowZeroPrice) return "价格为 0";
  if (effective < value.upstreamCostCents && !props.allowLossLeader) return "低于成本";
  return "";
}

const issues = computed(() =>
  props.resolutions.flatMap((resolution) =>
    props.qualities.map((quality) => warning(resolution, quality)).filter(Boolean),
  ).length,
);
</script>

<template>
  <div class="tier-matrix">
    <p v-if="!resolutions.length || !qualities.length" class="tier-empty">
      先在「生图能力」里选择分辨率和输出质量，这里会按它们生成价格表。
    </p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">分辨率</th>
          <th v-for="quality in qualities" :key="quality" scope="col">
            {{ TIER_QUALITY_LABELS[quality] || quality }}质量
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="resolution in resolutions" :key="resolution">
          <th scope="row">{{ resolution }}</th>
          <td v-for="quality in qualities" :key="quality" :class="{ 'is-warn': warning(resolution, quality) }">
            <label class="tier-field">
              <span>标准</span>
              <PointsInput
                :model-value="cell(resolution, quality).priceCents"
                size="small"
                @update:model-value="(value) => update(resolution, quality, { priceCents: value })"
              />
            </label>
            <label class="tier-field">
              <span class="tier-discount">
                <el-checkbox
                  :model-value="cell(resolution, quality).discountPriceCents !== null"
                  size="small"
                  @update:model-value="(value) => toggleDiscount(resolution, quality, Boolean(value))"
                >折扣</el-checkbox>
              </span>
              <PointsInput
                :model-value="cell(resolution, quality).discountPriceCents ?? cell(resolution, quality).priceCents"
                :disabled="cell(resolution, quality).discountPriceCents === null"
                size="small"
                @update:model-value="(value) => update(resolution, quality, { discountPriceCents: value })"
              />
            </label>
            <label class="tier-field">
              <span>成本</span>
              <PointsInput
                :model-value="cell(resolution, quality).upstreamCostCents"
                size="small"
                @update:model-value="(value) => update(resolution, quality, { upstreamCostCents: value })"
              />
            </label>
            <em v-if="warning(resolution, quality)">{{ warning(resolution, quality) }}</em>
            <em v-else class="is-ok">用户付 {{ formatPoints(effectiveTierPrice(cell(resolution, quality))) }}</em>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="issues" class="tier-issues">有 {{ issues }} 个档位价格为 0 或低于成本，保存会被拒绝，除非在「价格策略」里允许。</p>
  </div>
</template>

<style scoped>
.tier-matrix {
  overflow-x: auto;
}
.tier-matrix table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 6px;
}
.tier-matrix th {
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.tier-matrix td {
  min-width: 170px;
  padding: 8px;
  vertical-align: top;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}
.tier-matrix td.is-warn {
  border-color: var(--el-color-warning-light-5);
}
.tier-matrix .tier-field {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tier-discount {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.tier-discount .el-checkbox {
  height: auto;
  margin-right: 0;
}
.tier-discount :deep(.el-checkbox__label) {
  padding-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tier-matrix .tier-field .el-input {
  width: 100%;
}
.tier-matrix em {
  display: block;
  font-size: 12px;
  font-style: normal;
  color: var(--el-color-warning);
}
.tier-matrix em.is-ok {
  color: var(--el-text-color-secondary);
}
.tier-empty,
.tier-issues {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tier-issues {
  margin-top: 6px;
  color: var(--el-color-warning);
}
</style>
