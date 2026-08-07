<script setup>
import { nextTick, ref, watch } from 'vue'
import { redeemWalletCode } from '@/services/meApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { useAppearanceStore } from '@/stores/appearance'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'success'])

const appearanceStore = useAppearanceStore()
const { refreshWalletBalance, applyWalletSnapshot } = useClientWalletBalance()
const inputEl = ref(null)
const redeemCode = ref('')
const redeeming = ref(false)

const REDEEM_ERROR_MESSAGES = {
  code_invalid: '兑换码不存在，请检查后重试',
  code_redeemed: '该兑换码已被使用',
  code_expired: '兑换码已过期',
  code_disabled: '兑换码已停用',
  rate_limited: '操作过于频繁，请稍后再试',
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    redeemCode.value = ''
    redeeming.value = false
    await nextTick()
    inputEl.value?.focus()
  },
)

function close() {
  if (redeeming.value) return
  emit('close')
}

function onInput(event) {
  redeemCode.value = String(event.target.value || '').toUpperCase()
}

async function submit() {
  const code = redeemCode.value.trim().toUpperCase()
  if (!code) {
    notificationService.info('请输入兑换码（格式 SC-XXXX-XXXX-XXXX）')
    return
  }
  if (redeeming.value) return
  redeeming.value = true
  try {
    const result = await redeemWalletCode(code)
    notificationService.success(`已入账 ${formatPoints(result?.grantCents || 0)}`)
    redeemCode.value = ''
    if (result?.balanceCents != null || result?.frozenCents != null) {
      applyWalletSnapshot({
        balanceCents: result?.balanceCents,
        frozenCents: result?.frozenCents,
      })
    }
    await refreshWalletBalance({ force: true }).catch(() => null)
    emit('success', result)
    emit('close')
  } catch (error) {
    const mapped = REDEEM_ERROR_MESSAGES[error?.code]
    if (mapped) {
      notificationService.error(mapped)
    } else if (error?.status === 404) {
      notificationService.info('兑换功能即将开放，敬请期待')
    } else {
      notificationService.error(error?.message || '兑换失败，请稍后再试')
    }
  } finally {
    redeeming.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="redeem-dialog">
      <div
        v-if="open"
        class="redeem-dialog-layer"
        :class="{ 'is-dark': appearanceStore.isDark }"
        role="presentation"
        @mousedown.self="close"
      >
        <section
          class="redeem-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="redeem-dialog-title"
          @keydown.esc.stop="close"
        >
          <header class="redeem-dialog__head">
            <div>
              <h2 id="redeem-dialog-title">兑换积分</h2>
              <p>输入兑换码即可入账。</p>
            </div>
            <button type="button" class="redeem-dialog__close" aria-label="关闭" @click="close">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>

          <form class="redeem-dialog__form" @submit.prevent="submit">
            <input
              ref="inputEl"
              :value="redeemCode"
              type="text"
              class="redeem-dialog__input"
              placeholder="SC-XXXX-XXXX-XXXX"
              maxlength="20"
              autocomplete="off"
              spellcheck="false"
              aria-label="兑换码"
              @input="onInput"
            />
            <button type="submit" class="redeem-dialog__submit" :disabled="redeeming">
              {{ redeeming ? '兑换中…' : '立即兑换' }}
            </button>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.redeem-dialog-layer {
  --rd-accent: #6d5cff;
  --rd-accent-2: #8b7bff;
  --rd-accent-rgb: 109, 92, 255;

  position: fixed;
  inset: 0;
  z-index: 4200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(48, 49, 62, 0.28);
  backdrop-filter: blur(12px) saturate(0.9);
  -webkit-backdrop-filter: blur(12px) saturate(0.9);
}

.redeem-dialog-layer.is-dark {
  background: rgba(9, 9, 12, 0.62);
}

.redeem-dialog {
  width: min(400px, 100%);
  padding: 22px;
  border: 1px solid rgba(109, 92, 255, 0.12);
  border-radius: 20px;
  background:
    radial-gradient(circle at 14% 0%, rgba(109, 92, 255, 0.08), transparent 42%),
    #ffffff;
  box-shadow: 0 24px 64px rgba(43, 39, 77, 0.14);
  color: #242531;
}

.redeem-dialog-layer.is-dark .redeem-dialog {
  background:
    radial-gradient(circle at 12% 0%, rgba(var(--rd-accent-rgb), 0.16), transparent 42%),
    rgba(18, 18, 24, 0.97);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.96);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.48);
}

.redeem-dialog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.redeem-dialog__head h2 {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 760;
  letter-spacing: -0.02em;
}

.redeem-dialog__head p {
  margin: 6px 0 0;
  color: rgba(43, 45, 60, 0.56);
  font-size: 0.82rem;
  line-height: 1.5;
}

.redeem-dialog-layer.is-dark .redeem-dialog__head p {
  color: rgba(255, 255, 255, 0.54);
}

.redeem-dialog__close {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: #f6f6fb;
  color: rgba(43, 45, 60, 0.72);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.redeem-dialog__close:hover {
  background: rgba(109, 92, 255, 0.1);
  color: #242531;
}

.redeem-dialog-layer.is-dark .redeem-dialog__close {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
}

.redeem-dialog-layer.is-dark .redeem-dialog__close:hover {
  background: rgba(var(--rd-accent-rgb), 0.16);
  color: #fff;
}

.redeem-dialog__form {
  display: grid;
  gap: 12px;
}

.redeem-dialog__input {
  width: 100%;
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid rgba(109, 92, 255, 0.16);
  border-radius: 999px;
  background: #f6f6fb;
  color: inherit;
  font: inherit;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
  letter-spacing: 0.04em;
  outline: 0;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.redeem-dialog__input::placeholder {
  color: rgba(43, 45, 60, 0.38);
}

.redeem-dialog-layer.is-dark .redeem-dialog__input {
  border-color: rgba(var(--rd-accent-rgb), 0.28);
  background: rgba(var(--rd-accent-rgb), 0.08);
  color: rgba(255, 255, 255, 0.94);
}

.redeem-dialog-layer.is-dark .redeem-dialog__input::placeholder {
  color: rgba(255, 255, 255, 0.34);
}

.redeem-dialog__input:focus {
  border-color: rgba(109, 92, 255, 0.55);
  box-shadow: 0 0 0 3px rgba(109, 92, 255, 0.16);
}

.redeem-dialog__submit {
  min-height: 46px;
  border: 1px solid rgba(242, 247, 255, 0.28);
  border-radius: 999px;
  background:
    radial-gradient(ellipse at 18% 0%, rgba(255, 255, 255, 0.22), transparent 44%),
    linear-gradient(
      108deg,
      rgba(84, 70, 255, 0.96),
      rgba(127, 103, 255, 0.88) 54%,
      rgba(159, 125, 255, 0.9)
    );
  color: #fff;
  font: inherit;
  font-weight: 720;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    0 10px 24px rgba(91, 77, 255, 0.28);
  transition:
    transform 0.16s ease,
    box-shadow 0.18s ease;
}

.redeem-dialog__submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 14px 28px rgba(91, 77, 255, 0.38);
}

.redeem-dialog-layer.is-dark .redeem-dialog__submit {
  color: #fff;
}

.redeem-dialog__submit:disabled {
  opacity: 0.55;
  cursor: wait;
  transform: none;
}

.redeem-dialog-enter-active,
.redeem-dialog-leave-active {
  transition: opacity 180ms ease;
}

.redeem-dialog-enter-active .redeem-dialog,
.redeem-dialog-leave-active .redeem-dialog {
  transition:
    transform 180ms ease,
    opacity 180ms ease;
}

.redeem-dialog-enter-from,
.redeem-dialog-leave-to {
  opacity: 0;
}

.redeem-dialog-enter-from .redeem-dialog,
.redeem-dialog-leave-to .redeem-dialog {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .redeem-dialog-enter-active,
  .redeem-dialog-leave-active,
  .redeem-dialog-enter-active .redeem-dialog,
  .redeem-dialog-leave-active .redeem-dialog,
  .redeem-dialog__submit,
  .redeem-dialog__close,
  .redeem-dialog__input {
    transition: none;
  }
}
</style>
