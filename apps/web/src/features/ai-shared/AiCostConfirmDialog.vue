<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  cost: { type: Object, default: null },
})

const emit = defineEmits(['confirm', 'cancel'])
const panelRef = ref(null)

watch(
  () => props.show,
  (show) => {
    if (show) nextTick(() => panelRef.value?.focus())
  },
)

function formatAmount(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return '0'
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

function formatYuan(cents) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`
}

function formatBalance(value) {
  return `¥${Math.max(0, Number(value || 0)).toFixed(2)}`
}

const isCredits = computed(() => props.cost?.billingMode === 'credits')
const unitCost = computed(() => Math.max(0, Number(props.cost?.unitCost || 0)))
const imageCount = computed(() => Math.max(1, Number(props.cost?.count || 1)))
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
const confirmDisabled = computed(() => isCredits.value && creditInsufficient.value)
const totalLabel = computed(() => {
  if (hasServerPricing.value) return formatYuan(totalPriceCents.value)
  if (isCredits.value && unitCost.value > 0) return `${formatAmount(unitCost.value)} 积分`
  if (!isCredits.value) return `$${Number(unitCost.value || 0).toFixed(4)}`
  return '按实际用量结算'
})
const breakdownLabel = computed(() => {
  if (hasServerPricing.value) {
    return `${formatYuan(unitPriceCents.value)} / 张 × ${imageCount.value} 张`
  }
  return imageCount.value > 1 ? `${imageCount.value} 张` : '1 张'
})
</script>

<template>
  <div v-if="show" class="ai-cost-confirm-layer" @click.self="emit('cancel')">
    <section
      ref="panelRef"
      class="ai-cost-confirm-panel"
      :class="{ 'is-credits': isCredits }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-cost-confirm-title"
      aria-describedby="ai-cost-confirm-summary"
      tabindex="-1"
      @keydown.esc="emit('cancel')"
    >
      <header class="ai-cost-confirm-head">
        <span class="ai-cost-confirm-icon" aria-hidden="true">
          <i class="bi" :class="isCredits ? 'bi-coin' : 'bi-cash-coin'"></i>
        </span>
        <div>
          <span class="ai-cost-confirm-eyebrow">{{ featureLabel }}</span>
          <h5 id="ai-cost-confirm-title">
            {{ isCredits ? '确认生成费用' : '确认本次 AI 费用' }}
          </h5>
        </div>
        <button
          type="button"
          class="ai-cost-confirm-close"
          aria-label="关闭费用确认"
          title="关闭"
          @click="emit('cancel')"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>

      <p id="ai-cost-confirm-summary" class="ai-cost-confirm-summary">
        {{
          isCredits
            ? '提交后先冻结预计费用，任务完成后按实际生成结果结算。'
            : '请确认预计调用费用后再提交任务。'
        }}
      </p>

      <div class="ai-cost-confirm-total">
        <span>本次预计</span>
        <strong>{{ totalLabel }}</strong>
        <small>{{ breakdownLabel }}</small>
      </div>

      <div v-if="isCredits" class="ai-cost-confirm-balance">
        <div>
          <span>当前可用</span>
          <strong>{{ creditAvailable == null ? '读取中' : formatBalance(creditAvailable) }}</strong>
        </div>
        <i class="bi bi-arrow-right" aria-hidden="true"></i>
        <div :class="{ danger: creditInsufficient }">
          <span>支付后余额</span>
          <strong>
            {{
              creditAvailable == null
                ? '待计算'
                : creditInsufficient
                  ? '余额不足'
                  : formatBalance(creditRemaining)
            }}
          </strong>
        </div>
      </div>

      <div v-else class="ai-cost-confirm-balance">
        <div>
          <span>今日已用</span>
          <strong>${{ Number(cost?.dayCost || 0).toFixed(4) }}</strong>
        </div>
        <i class="bi bi-dot" aria-hidden="true"></i>
        <div>
          <span>本月已用</span>
          <strong>${{ Number(cost?.monthCost || 0).toFixed(4) }}</strong>
        </div>
      </div>

      <p v-if="isCredits && !hasServerPricing" class="ai-cost-confirm-warn">
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        暂时读取不到单价，本次费用以服务端结算为准。
      </p>
      <p v-else-if="isCredits && creditInsufficient" class="ai-cost-confirm-warn is-danger">
        <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
        钱包余额不足，请充值后再提交任务。
      </p>

      <footer class="ai-cost-confirm-footer">
        <RouterLink
          class="ai-cost-confirm-preference"
          :to="{ name: 'profile', query: { tab: 'account' }, hash: '#generation-preferences' }"
          @click="emit('cancel')"
        >
          <i class="bi bi-sliders2" aria-hidden="true"></i>
          不再每次确认
        </RouterLink>
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
            {{ isCredits ? '确认并生成' : '继续生成' }}
            <i class="bi bi-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ai-cost-confirm-layer {
  position: fixed;
  inset: 0;
  z-index: 2500;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 6, 9, 0.7);
  backdrop-filter: blur(10px) saturate(0.82);
}

.ai-cost-confirm-panel {
  width: min(430px, calc(100vw - 32px));
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(18, 19, 23, 0.97);
  color: #f5f6f8;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
  animation: ai-cost-confirm-in 0.2s ease-out both;
  outline: none;
}

.ai-cost-confirm-head {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 12px;
}

.ai-cost-confirm-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(118, 219, 162, 0.32);
  border-radius: 8px;
  background: rgba(118, 219, 162, 0.11);
  color: #8de0af;
  font-size: 1rem;
}

.is-credits .ai-cost-confirm-icon {
  border-color: rgba(245, 188, 66, 0.36);
  background: rgba(245, 188, 66, 0.12);
  color: #f5bc42;
}

.ai-cost-confirm-eyebrow {
  display: block;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-cost-confirm-head h5 {
  margin: 3px 0 0;
  font-size: 1rem;
  font-weight: 680;
}

.ai-cost-confirm-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(255, 255, 255, 0.52);
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.ai-cost-confirm-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.ai-cost-confirm-summary {
  margin: 16px 0 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.76rem;
  line-height: 1.6;
}

.ai-cost-confirm-total {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 3px 16px;
  margin-top: 18px;
  padding: 17px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.ai-cost-confirm-total > span {
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.75rem;
}

.ai-cost-confirm-total strong {
  grid-row: 1 / span 2;
  grid-column: 2;
  color: #f5bc42;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.4rem;
  font-weight: 720;
}

.ai-cost-confirm-total small {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.67rem;
}

.ai-cost-confirm-balance {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 15px 0 2px;
}

.ai-cost-confirm-balance > div {
  display: grid;
  gap: 4px;
}

.ai-cost-confirm-balance > div:last-child {
  text-align: right;
}

.ai-cost-confirm-balance span {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.67rem;
}

.ai-cost-confirm-balance strong {
  color: rgba(255, 255, 255, 0.9);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
}

.ai-cost-confirm-balance > i {
  color: rgba(255, 255, 255, 0.22);
  text-align: center;
}

.ai-cost-confirm-balance .danger strong {
  color: #ff9898;
}

.ai-cost-confirm-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 0;
  padding: 9px 10px;
  border-left: 2px solid rgba(245, 188, 66, 0.72);
  background: rgba(245, 188, 66, 0.08);
  color: #f7d99c;
  font-size: 0.7rem;
  line-height: 1.5;
}

.ai-cost-confirm-warn.is-danger {
  border-color: rgba(255, 118, 118, 0.76);
  background: rgba(255, 118, 118, 0.08);
  color: #ffb2b2;
}

.ai-cost-confirm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 20px;
}

.ai-cost-confirm-preference {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 0.68rem;
  text-decoration: none;
  transition: color 0.18s ease;
}

.ai-cost-confirm-preference:hover {
  color: #f5bc42;
}

.ai-cost-confirm-actions {
  display: flex;
  gap: 8px;
}

.ai-cost-confirm-btn {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  border-radius: 7px;
  font-size: 0.76rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    background 0.18s ease,
    border-color 0.18s ease;
}

.ai-cost-confirm-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.ai-cost-confirm-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ai-cost-confirm-btn.ghost {
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
}

.ai-cost-confirm-btn.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.25);
}

.ai-cost-confirm-btn.primary {
  border: 1px solid #dca52f;
  background: #dca52f;
  color: #1b1508;
}

.ai-cost-confirm-btn.primary:hover:not(:disabled) {
  border-color: #efbd4e;
  background: #efbd4e;
}

@keyframes ai-cost-confirm-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 520px) {
  .ai-cost-confirm-layer {
    padding: 12px;
  }
  .ai-cost-confirm-panel {
    padding: 18px;
  }
  .ai-cost-confirm-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .ai-cost-confirm-preference {
    min-height: 28px;
  }
  .ai-cost-confirm-actions {
    display: grid;
    grid-template-columns: 0.8fr 1.2fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-cost-confirm-panel {
    animation: none;
  }
  .ai-cost-confirm-btn,
  .ai-cost-confirm-close,
  .ai-cost-confirm-preference {
    transition: none;
  }
}

:global(.settings-no-animations) .ai-cost-confirm-panel {
  animation: none;
}
</style>
