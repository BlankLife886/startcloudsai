<script setup>
import { computed } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  cost: { type: Object, default: null },
})

const emit = defineEmits(['confirm', 'cancel'])

function formatAmount(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return '0'
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

function isCreditBilling(cost) {
  return cost?.billingMode === 'credits'
}

const isCredits = computed(() => isCreditBilling(props.cost))
const unitCost = computed(() => Math.max(0, Number(props.cost?.unitCost || 0)))
const imageCount = computed(() => Math.max(1, Number(props.cost?.count || 1)))
// 服务端真实单价（分）：来自 GET /api/meta/pricing，为 null 表示读取失败
const unitPriceCents = computed(() => {
  const value = props.cost?.unitPriceCents
  return Number.isFinite(Number(value)) && value !== null && value !== undefined
    ? Math.max(0, Number(value))
    : null
})
const hasServerPricing = computed(() => unitPriceCents.value != null)
const totalPriceCents = computed(() =>
  hasServerPricing.value
    ? Math.max(0, Number(props.cost?.totalPriceCents ?? unitPriceCents.value * imageCount.value))
    : null,
)
function formatYuan(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`
}
// creditAvailable 语义 = 钱包可用余额（元）
const creditAvailable = computed(() => {
  const value = props.cost?.creditAvailable
  if (value === undefined || value === null || value === '') return null
  return Math.max(0, Number(value || 0))
})
const totalCostYuan = computed(() => {
  if (hasServerPricing.value) return totalPriceCents.value / 100
  return unitCost.value
})
const creditRemaining = computed(() => {
  if (creditAvailable.value == null) return null
  return Math.max(0, creditAvailable.value - totalCostYuan.value)
})
const creditInsufficient = computed(
  () =>
    creditAvailable.value != null &&
    totalCostYuan.value > 0 &&
    creditAvailable.value + 1e-9 < totalCostYuan.value,
)
const featureLabel = computed(() => String(props.cost?.featureLabel || '本次 AI 功能').trim())
// 单价读取失败不禁用确认（以服务端结算为准）；仅在明确余额不足时禁用
const confirmDisabled = computed(() => isCredits.value && creditInsufficient.value)
</script>

<template>
  <div v-if="show" class="ai-cost-confirm-layer" @click.self="emit('cancel')">
    <section
      class="ai-cost-confirm-panel"
      :class="{ 'is-credits': isCredits }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-cost-confirm-title"
    >
      <div class="ai-cost-confirm-icon" :class="{ credits: isCredits }">
        <i class="bi" :class="isCredits ? 'bi-coin' : 'bi-cash-coin'"></i>
      </div>
      <div class="ai-cost-confirm-copy">
        <h5 id="ai-cost-confirm-title">
          {{ isCredits ? '确认本次生成费用' : '确认本次 AI 费用' }}
        </h5>
        <p v-if="isCredits">
          <strong>{{ featureLabel }}</strong> 将从
          <strong>钱包余额</strong> 中冻结并按张结算，确认后将提交生成任务。
        </p>
        <p v-else>生成前请确认预计美元费用，避免误触产生额外调用。</p>
      </div>

      <div class="ai-cost-confirm-list">
        <div class="ai-cost-confirm-item highlight">
          <span>预计扣除</span>
          <div class="ai-cost-confirm-value">
            <strong v-if="hasServerPricing">{{ formatYuan(totalPriceCents) }}</strong>
            <strong v-else-if="isCredits && unitCost > 0">{{ formatAmount(unitCost) }} 积分</strong>
            <strong v-else-if="!isCredits">${{ Number(unitCost || 0).toFixed(4) }}</strong>
            <strong v-else>以服务端结算为准</strong>
            <small v-if="hasServerPricing">
              {{ formatYuan(unitPriceCents) }} / 张 × {{ imageCount }} 张
            </small>
          </div>
        </div>

        <template v-if="isCredits">
          <div class="ai-cost-confirm-item">
            <span>当前可用</span>
            <strong>
              {{ creditAvailable == null ? '—' : `¥${formatAmount(creditAvailable)}` }}
            </strong>
          </div>
          <div class="ai-cost-confirm-item" :class="{ danger: creditInsufficient }">
            <span>扣除后剩余</span>
            <strong>
              {{
                creditAvailable == null
                  ? '—'
                  : creditInsufficient
                    ? '余额不足'
                    : `¥${formatAmount(creditRemaining)}`
              }}
            </strong>
          </div>
        </template>

        <template v-else>
          <div class="ai-cost-confirm-item">
            <span>今日已消耗</span>
            <strong>${{ Number(cost?.dayCost || 0).toFixed(4) }}</strong>
          </div>
          <div class="ai-cost-confirm-item">
            <span>本月已消耗</span>
            <strong>${{ Number(cost?.monthCost || 0).toFixed(4) }}</strong>
          </div>
        </template>
      </div>

      <p v-if="isCredits && !hasServerPricing" class="ai-cost-confirm-warn">
        暂时读取不到单价，本次费用以服务端结算为准。
      </p>
      <p v-else-if="isCredits && creditInsufficient" class="ai-cost-confirm-warn">
        钱包余额不足。请前往「价格页」充值后再试。
      </p>

      <div class="ai-cost-confirm-actions">
        <button type="button" class="ai-cost-confirm-btn ghost" @click="emit('cancel')">
          取消
        </button>
        <button
          type="button"
          class="ai-cost-confirm-btn primary"
          :disabled="confirmDisabled"
          @click="emit('confirm')"
        >
          {{ isCredits ? '确认扣除并生成' : '继续生成' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ai-cost-confirm-layer {
  position: absolute;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(5px);
}

.ai-cost-confirm-panel {
  width: min(400px, calc(100vw - 40px));
  padding: 18px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(18, 18, 20, 0.9);
  color: #fff;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.36);
}

.ai-cost-confirm-icon {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #102313;
  background: rgba(152, 228, 175, 0.94);
}

.ai-cost-confirm-icon.credits {
  color: #422006;
  background: rgba(251, 191, 36, 0.92);
}

.ai-cost-confirm-copy {
  margin-top: 12px;
}

.ai-cost-confirm-copy h5 {
  margin: 0;
  font-size: 1rem;
}

.ai-cost-confirm-copy p {
  margin: 7px 0 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.78rem;
  line-height: 1.55;
}

.ai-cost-confirm-copy strong {
  color: #fff;
  font-weight: 600;
}

.ai-cost-confirm-warn {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 179, 113, 0.12);
  color: #ffd5ab;
  font-size: 0.74rem;
  line-height: 1.45;
}

.ai-cost-confirm-footnote {
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.72rem;
  line-height: 1.45;
}

.ai-cost-confirm-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.ai-cost-confirm-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  font-size: 0.8rem;
}

.ai-cost-confirm-item.highlight strong {
  color: #fbbf24;
}

.ai-cost-confirm-item.danger strong {
  color: #fca5a5;
}

.ai-cost-confirm-item span {
  color: rgba(255, 255, 255, 0.64);
  padding-top: 1px;
}

.ai-cost-confirm-value {
  min-width: 0;
  text-align: right;
}

.ai-cost-confirm-value strong {
  display: block;
  overflow-wrap: anywhere;
}

.ai-cost-confirm-value small {
  display: block;
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.72rem;
}

.ai-cost-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.ai-cost-confirm-btn {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 0.8rem;
}

.ai-cost-confirm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ai-cost-confirm-btn.ghost {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.ai-cost-confirm-btn.primary {
  border: 1px solid rgba(152, 228, 175, 0.64);
  background: rgba(152, 228, 175, 0.24);
  color: #ecfff0;
}

.ai-cost-confirm-panel.is-credits .ai-cost-confirm-btn.primary {
  border-color: rgba(251, 191, 36, 0.64);
  background: rgba(251, 191, 36, 0.22);
  color: #fff7ed;
}
</style>
