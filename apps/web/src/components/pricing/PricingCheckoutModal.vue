<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { CHECKOUT_UI_PHASE } from '@/features/pricing/pricingCheckout'
import { animateCheckoutModalOpen } from '@/features/pricing/pricingMotion'

const props = defineProps({
  open: { type: Boolean, default: false },
  presentation: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  checkoutUrl: { type: String, default: '' },
  providerLabel: { type: String, default: '支付宝' },
  showManualConfirm: { type: Boolean, default: false },
  showContinuePay: { type: Boolean, default: false },
  showRefresh: { type: Boolean, default: false },
  showTestConfirm: { type: Boolean, default: false },
  showCancelOrder: { type: Boolean, default: false },
})

const emit = defineEmits([
  'close',
  'confirm-paid',
  'refresh',
  'confirm-test',
  'cancel-order',
])

const toneClass = computed(() => {
  const tone = String(props.presentation?.tone || 'info')
  return `pc-pay-modal--${tone}`
})

const primaryLabel = computed(() => {
  if (props.loading) return '处理中…'
  if (props.presentation?.phase === CHECKOUT_UI_PHASE.SUCCESS) return '完成'
  if (
    props.presentation?.phase === CHECKOUT_UI_PHASE.CANCELLED ||
    props.presentation?.phase === CHECKOUT_UI_PHASE.EXPIRED
  ) {
    return '知道了'
  }
  if (props.presentation?.phase === CHECKOUT_UI_PHASE.FAILED) return '关闭'
  return ''
})

function handlePrimary() {
  if (props.presentation?.phase === CHECKOUT_UI_PHASE.SUCCESS) {
    emit('close')
    return
  }
  if (
    props.presentation?.phase === CHECKOUT_UI_PHASE.CANCELLED ||
    props.presentation?.phase === CHECKOUT_UI_PHASE.EXPIRED ||
    props.presentation?.phase === CHECKOUT_UI_PHASE.FAILED
  ) {
    emit('close')
  }
}

const modalBackdropRef = ref(null)
const modalPanelRef = ref(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    animateCheckoutModalOpen(modalBackdropRef.value, modalPanelRef.value)
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pc-pay-modal" role="presentation">
      <div
        ref="modalBackdropRef"
        class="pc-pay-modal__backdrop"
        @click="presentation.closable ? $emit('close') : undefined"
      ></div>

      <section
        ref="modalPanelRef"
        class="pc-pay-modal__panel"
        :class="toneClass"
        role="dialog"
        aria-modal="true"
        :aria-label="presentation.title || '支付状态'"
      >
        <header class="pc-pay-modal__head">
          <div class="pc-pay-modal__icon" aria-hidden="true">
            <i v-if="loading" class="bi bi-arrow-repeat pc-pay-modal__spin"></i>
            <i v-else class="bi" :class="presentation.icon || 'bi-wallet2'"></i>
          </div>
          <div class="pc-pay-modal__head-copy">
            <p class="pc-pay-modal__provider">{{ providerLabel }}</p>
            <h2>{{ presentation.title }}</h2>
            <p>{{ presentation.description }}</p>
          </div>
          <button
            v-if="presentation.closable"
            type="button"
            class="pc-pay-modal__close"
            aria-label="关闭"
            @click="$emit('close')"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <dl v-if="presentation.showOrder" class="pc-pay-modal__order">
          <div>
            <dt>商品</dt>
            <dd>{{ presentation.planName }}</dd>
          </div>
          <div v-if="presentation.payAmountLabel">
            <dt>支付宝支付</dt>
            <dd class="pc-num">{{ presentation.payAmountLabel }}</dd>
          </div>
          <div>
            <dt>到账</dt>
            <dd class="pc-num">{{ presentation.amount }}</dd>
          </div>
          <div>
            <dt>订单号</dt>
            <dd class="pc-num">{{ presentation.orderNo }}</dd>
          </div>
          <div v-if="presentation.expiresInLabel">
            <dt>有效时间</dt>
            <dd>{{ presentation.expiresInLabel }}</dd>
          </div>
        </dl>

        <ol
          v-if="presentation.showSteps"
          class="pc-pay-modal__steps"
          aria-label="支付进度"
        >
          <li
            v-for="step in presentation.steps || []"
            :key="step.id"
            class="pc-pay-modal__step"
            :class="`is-${step.state}`"
          >
            <span class="pc-pay-modal__step-dot" aria-hidden="true"></span>
            <span>{{ step.label }}</span>
          </li>
        </ol>

        <footer class="pc-pay-modal__actions">
          <button
            v-if="showCancelOrder"
            type="button"
            class="pc-btn pc-btn--ghost pc-pay-modal__cancel"
            :disabled="loading"
            @click="$emit('cancel-order')"
          >
            取消订单
          </button>
          <button
            v-if="showRefresh"
            type="button"
            class="pc-btn pc-btn--ghost"
            :disabled="loading"
            @click="$emit('refresh')"
          >
            刷新状态
          </button>
          <a
            v-if="showContinuePay && checkoutUrl"
            :href="checkoutUrl"
            class="pc-btn pc-btn--ghost"
          >
            继续支付
          </a>
          <button
            v-if="showManualConfirm"
            type="button"
            class="pc-btn pc-btn--primary"
            :disabled="loading"
            @click="$emit('confirm-paid')"
          >
            {{ loading ? '确认中…' : '我已完成支付' }}
          </button>
          <button
            v-if="showTestConfirm"
            type="button"
            class="pc-btn pc-btn--primary"
            :disabled="loading"
            @click="$emit('confirm-test')"
          >
            确认测试支付
          </button>
          <button
            v-if="primaryLabel"
            type="button"
            class="pc-btn pc-btn--primary"
            :disabled="loading && presentation.phase !== CHECKOUT_UI_PHASE.SUCCESS"
            @click="handlePrimary"
          >
            {{ primaryLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
