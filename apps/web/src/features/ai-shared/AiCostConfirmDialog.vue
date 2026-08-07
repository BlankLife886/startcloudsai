<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { updateProfile } from '@/services/meApi'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  show: { type: Boolean, default: false },
  cost: { type: Object, default: null },
  light: { type: Boolean, default: false },
  elevated: { type: Boolean, default: false },
  hidePreference: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])
const authStore = useAuthStore()
const panelRef = ref(null)
const skipEveryTime = ref(false)
const savingPreference = ref(false)

watch(
  () => props.show,
  (show) => {
    if (show) {
      skipEveryTime.value = false
      savingPreference.value = false
      nextTick(() => panelRef.value?.focus())
    }
  },
)

function formatAmount(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return '0'
  return Math.round(amount).toLocaleString('zh-CN')
}

function formatPoints(value) {
  const points = Math.max(0, Math.round(Number(value || 0)))
  return `${points.toLocaleString('zh-CN')} 积分`
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
const totalCostPoints = computed(() => {
  if (hasServerPricing.value) return totalPriceCents.value
  return unitCost.value
})
const creditRemaining = computed(() => {
  if (creditAvailable.value == null) return null
  return Math.max(0, creditAvailable.value - totalCostPoints.value)
})
const creditInsufficient = computed(
  () =>
    creditAvailable.value != null &&
    totalCostPoints.value > 0 &&
    creditAvailable.value < totalCostPoints.value,
)
const featureLabel = computed(() => String(props.cost?.featureLabel || '本次 AI 功能').trim())
const unitLabel = computed(() => String(props.cost?.unitLabel || '张').trim())
const summary = computed(() =>
  String(
    props.cost?.summary ||
      (isCredits.value
        ? '提交后先冻结预计费用，任务完成后按实际生成结果结算。'
        : '请确认预计调用费用后再提交任务。'),
  ),
)
const confirmDisabled = computed(
  () => (isCredits.value && creditInsufficient.value) || savingPreference.value,
)
const totalLabel = computed(() => {
  if (hasServerPricing.value) return formatPoints(totalPriceCents.value)
  if (isCredits.value && unitCost.value > 0) return `${formatAmount(unitCost.value)} 积分`
  if (!isCredits.value) return `$${Number(unitCost.value || 0).toFixed(4)}`
  return '按实际用量结算'
})
const breakdownLabel = computed(() => {
  if (hasServerPricing.value) {
    return `${formatPoints(unitPriceCents.value)} / ${unitLabel.value} × ${imageCount.value} ${unitLabel.value}`
  }
  return `${imageCount.value} ${unitLabel.value}`
})

async function persistSkipPreference() {
  if (!skipEveryTime.value || !authStore.isAuthenticated) return
  savingPreference.value = true
  try {
    const result = await updateProfile({ requireCostConfirm: false })
    authStore.patchUser(result?.user || { requireCostConfirm: false })
  } catch {
    // 偏好保存失败不阻断本次确认生成
  } finally {
    savingPreference.value = false
  }
}

async function handleConfirm() {
  if (confirmDisabled.value) return
  await persistSkipPreference()
  emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="ai-cost-confirm-layer"
      :class="{ 'is-light': light, 'is-elevated': elevated }"
      @click.self="emit('cancel')"
    >
      <section
        ref="panelRef"
        class="ai-cost-confirm-panel"
        :class="{ 'is-credits': isCredits }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-cost-confirm-title"
        aria-describedby="ai-cost-confirm-summary"
        tabindex="-1"
        @keydown.esc.stop.prevent="emit('cancel')"
      >
        <header class="ai-cost-confirm-head">
          <span class="ai-cost-confirm-icon" aria-hidden="true">
            <i class="bi" :class="isCredits ? 'bi-coin' : 'bi-cash-coin'"></i>
          </span>
          <div class="ai-cost-confirm-titles">
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
            @click.stop="emit('cancel')"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <p id="ai-cost-confirm-summary" class="ai-cost-confirm-summary">
          {{ summary }}
        </p>

        <div class="ai-cost-confirm-card">
          <div class="ai-cost-confirm-total">
            <div class="ai-cost-confirm-total__copy">
              <span>本次预计</span>
              <small>{{ breakdownLabel }}</small>
            </div>
            <strong>{{ totalLabel }}</strong>
          </div>

          <div v-if="isCredits" class="ai-cost-confirm-balance">
            <div>
              <span>当前可用</span>
              <strong>{{
                creditAvailable == null ? '读取中' : formatPoints(creditAvailable)
              }}</strong>
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
                      : formatPoints(creditRemaining)
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
        </div>

        <p v-if="isCredits && !hasServerPricing" class="ai-cost-confirm-warn">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          暂时读取不到单价，本次费用以服务端结算为准。
        </p>
        <p v-else-if="isCredits && creditInsufficient" class="ai-cost-confirm-warn is-danger">
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
          钱包余额不足，请充值后再提交任务。
        </p>

        <footer class="ai-cost-confirm-footer" :class="{ 'is-no-preference': hidePreference }">
          <label v-if="!hidePreference" class="ai-cost-confirm-preference">
            <input v-model="skipEveryTime" type="checkbox" />
            <span>不再每次确认</span>
          </label>
          <div class="ai-cost-confirm-actions">
            <button type="button" class="ai-cost-confirm-btn ghost" @click.stop="emit('cancel')">
              取消
            </button>
            <button
              type="button"
              class="ai-cost-confirm-btn primary"
              :disabled="confirmDisabled"
              @click.stop="handleConfirm"
            >
              确认
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-cost-confirm-layer {
  --cc-accent: #6d5cff;
  --cc-accent-2: #8b7bff;
  --cc-accent-rgb: 109, 92, 255;
  --cc-on-accent: #fff;
  --cc-danger: #ff8d8d;
  --cc-danger-soft: rgba(255, 141, 141, 0.12);

  position: fixed;
  inset: 0;
  z-index: 2500;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(9, 9, 12, 0.62);
  backdrop-filter: blur(12px) saturate(0.9);
}

.ai-cost-confirm-layer.is-elevated {
  z-index: 10100;
}

.ai-cost-confirm-panel {
  width: min(420px, calc(100vw - 32px));
  padding: 22px 22px 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background:
    radial-gradient(circle at 12% 0%, rgba(var(--cc-accent-rgb), 0.16), transparent 42%),
    rgba(18, 18, 24, 0.97);
  color: rgba(255, 255, 255, 0.96);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.48);
  animation: ai-cost-confirm-in 0.2s ease-out both;
  outline: none;
}

.ai-cost-confirm-head {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 12px;
}

.ai-cost-confirm-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(var(--cc-accent-rgb), 0.38);
  border-radius: 12px;
  background: rgba(var(--cc-accent-rgb), 0.14);
  color: var(--cc-accent-2);
  font-size: 1.05rem;
}

.is-credits .ai-cost-confirm-icon {
  border-color: rgba(var(--cc-accent-rgb), 0.42);
  background: rgba(var(--cc-accent-rgb), 0.16);
  color: var(--cc-accent-2);
}

.ai-cost-confirm-titles {
  min-width: 0;
}

.ai-cost-confirm-eyebrow {
  display: block;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.48);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.68rem;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-cost-confirm-head h5 {
  margin: 4px 0 0;
  font-size: 1.05rem;
  font-weight: 720;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.ai-cost-confirm-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
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
  margin: 14px 0 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.78rem;
  line-height: 1.55;
}

.ai-cost-confirm-card {
  display: grid;
  gap: 0;
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid rgba(var(--cc-accent-rgb), 0.18);
  border-radius: 14px;
  background: rgba(var(--cc-accent-rgb), 0.08);
}

.ai-cost-confirm-total {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 12px;
}

.ai-cost-confirm-total__copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.ai-cost-confirm-total__copy > span {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.72rem;
  font-weight: 600;
}

.ai-cost-confirm-total__copy > small {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.66rem;
  line-height: 1.35;
}

.ai-cost-confirm-total strong {
  flex: 0 0 auto;
  color: var(--cc-accent-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.35rem;
  font-weight: 760;
  line-height: 1;
  white-space: nowrap;
}

.ai-cost-confirm-balance {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid rgba(var(--cc-accent-rgb), 0.14);
}

.ai-cost-confirm-balance > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.ai-cost-confirm-balance > div:last-child {
  text-align: right;
}

.ai-cost-confirm-balance span {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.66rem;
}

.ai-cost-confirm-balance strong {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.92);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.84rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-cost-confirm-balance > i {
  color: rgba(var(--cc-accent-rgb), 0.55);
  text-align: center;
}

.ai-cost-confirm-balance .danger strong {
  color: var(--cc-danger);
}

.ai-cost-confirm-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(var(--cc-accent-rgb), 0.28);
  background: rgba(var(--cc-accent-rgb), 0.1);
  color: #c9c0ff;
  font-size: 0.72rem;
  line-height: 1.5;
}

.ai-cost-confirm-warn.is-danger {
  border-color: rgba(255, 141, 141, 0.36);
  background: var(--cc-danger-soft);
  color: #ffb2b2;
}

.ai-cost-confirm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
}

.ai-cost-confirm-footer.is-no-preference {
  justify-content: flex-end;
}

.ai-cost-confirm-preference {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.72rem;
  cursor: pointer;
  user-select: none;
}

.ai-cost-confirm-preference input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--cc-accent);
  cursor: pointer;
}

.ai-cost-confirm-preference span {
  line-height: 1.3;
}

.ai-cost-confirm-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.ai-cost-confirm-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 680;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
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
  color: rgba(255, 255, 255, 0.78);
}

.ai-cost-confirm-btn.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.25);
}

.ai-cost-confirm-btn.primary {
  border: 1px solid rgba(242, 247, 255, 0.28);
  background:
    radial-gradient(ellipse at 18% 0%, rgba(255, 255, 255, 0.22), transparent 44%),
    linear-gradient(108deg, rgba(84, 70, 255, 0.96), rgba(127, 103, 255, 0.88) 54%, rgba(159, 125, 255, 0.9));
  color: var(--cc-on-accent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    0 10px 24px rgba(91, 77, 255, 0.34);
}

.ai-cost-confirm-btn.primary:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.36);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 14px 28px rgba(91, 77, 255, 0.42);
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

@media (max-width: 420px) {
  .ai-cost-confirm-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .ai-cost-confirm-actions {
    width: 100%;
  }

  .ai-cost-confirm-btn {
    flex: 1 1 auto;
  }

  .ai-cost-confirm-preference {
    justify-content: center;
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

.ai-cost-confirm-layer.is-light {
  background: rgba(48, 49, 62, 0.28);
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-panel {
  border-color: rgba(109, 92, 255, 0.12);
  background:
    radial-gradient(circle at 14% 0%, rgba(109, 92, 255, 0.08), transparent 40%),
    #ffffff;
  color: #242531;
  box-shadow: 0 24px 64px rgba(43, 39, 77, 0.14);
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-summary,
.ai-cost-confirm-layer.is-light .ai-cost-confirm-eyebrow,
.ai-cost-confirm-layer.is-light .ai-cost-confirm-total__copy > span,
.ai-cost-confirm-layer.is-light .ai-cost-confirm-total__copy > small,
.ai-cost-confirm-layer.is-light .ai-cost-confirm-balance span,
.ai-cost-confirm-layer.is-light .ai-cost-confirm-preference {
  color: rgba(43, 45, 60, 0.62);
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-card {
  border-color: rgba(109, 92, 255, 0.14);
  background: #f6f6fb;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-balance {
  border-top-color: rgba(109, 92, 255, 0.1);
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-balance strong {
  color: #242531;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-total strong {
  color: #5b4ae8;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-balance > i {
  color: rgba(109, 92, 255, 0.55);
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-balance .danger strong {
  color: #d94848;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-warn {
  border-color: rgba(109, 92, 255, 0.18);
  background: rgba(109, 92, 255, 0.06);
  color: #5a4db8;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-warn.is-danger {
  border-color: rgba(217, 72, 72, 0.22);
  background: rgba(217, 72, 72, 0.06);
  color: #c24141;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-close,
.ai-cost-confirm-layer.is-light .ai-cost-confirm-btn.ghost {
  border-color: rgba(34, 36, 50, 0.12);
  color: rgba(43, 45, 60, 0.72);
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-close:hover {
  background: rgba(109, 92, 255, 0.08);
  color: #242531;
}

.ai-cost-confirm-layer.is-light .ai-cost-confirm-btn.ghost:hover:not(:disabled) {
  border-color: rgba(109, 92, 255, 0.28);
  background: rgba(109, 92, 255, 0.06);
}
</style>
