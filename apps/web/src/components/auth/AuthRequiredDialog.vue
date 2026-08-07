<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { translateClientText } from '@/i18n/clientTranslations'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { authGateState, dismissAuthenticationRequest } from '@/services/authGate'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { setBodyScrollLock } from '@/utils/bodyScrollLock'

const router = useRouter()
const authStore = useAuthStore()
const localeStore = useLocaleStore()
const dialog = ref(null)
const AUTH_GATE_SCROLL_LOCK = 'auth-required-dialog'
let previousActiveElement = null

const copy = computed(() => {
  const locale = localeStore.locale
  const pageTitle = translateClientText(authGateState.pageTitle, locale)
  if (locale === 'en') {
    return {
      title: 'Ready to create?',
      lead: `Sign in before accessing “${pageTitle}”.`,
      detail:
        'Save generation history, sync personal assets, and continue creating across devices. Your first email verification creates a free account automatically.',
      register: 'Sign up for free',
      login: 'Sign in',
      support: 'Email codes support Gmail, Googlemail, and QQ Mail',
      close: 'Close sign-in prompt',
    }
  }

  const zh = {
    title: '准备开始创作？',
    lead: `访问“${pageTitle}”前需要先登录账号。`,
    detail:
      '登录后即可保存生成记录、同步个人素材，并在不同设备继续你的创作。首次邮箱验证会自动创建免费账号。',
    register: '免费注册',
    login: '去登录',
    support: '支持 Gmail、Googlemail 与 QQ 邮箱验证码',
    close: '关闭登录提示',
  }
  if (locale !== 'zh-TW') return zh
  return Object.fromEntries(
    Object.entries(zh).map(([key, value]) => [key, translateClientText(value, locale)]),
  )
})

function close() {
  dismissAuthenticationRequest()
}

function continueToAuth(mode = 'login') {
  const target = authGateState.target
  dismissAuthenticationRequest()
  router
    .push({
      name: 'auth',
      query: {
        mode,
        ...createLoginRedirectQuery(target),
      },
    })
    .catch(() => {})
}

watch(
  () => authGateState.open,
  async (open) => {
    setBodyScrollLock(AUTH_GATE_SCROLL_LOCK, open, { freezeViewport: true })
    if (!open) {
      previousActiveElement?.focus?.()
      previousActiveElement = null
      return
    }
    previousActiveElement = document.activeElement
    await nextTick()
    dialog.value?.focus()
  },
  { immediate: true },
)

watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (!authenticated || !authGateState.open) return
    const target = authGateState.target
    dismissAuthenticationRequest()
    router.push(target).catch(() => {})
  },
)

onBeforeUnmount(() => {
  setBodyScrollLock(AUTH_GATE_SCROLL_LOCK, false)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="auth-required">
      <div
        v-if="authGateState.open"
        class="auth-required-layer"
        role="presentation"
        @mousedown.self="close"
      >
        <section
          ref="dialog"
          class="auth-required-dialog"
          data-no-translate
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-required-title"
          aria-describedby="auth-required-description"
          tabindex="-1"
          @keydown.esc="close"
        >
          <button
            type="button"
            class="auth-required-close"
            :aria-label="copy.close"
            :title="copy.close"
            @click="close"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>

          <div class="auth-required-copy">
            <p class="auth-required-eyebrow">
              <span aria-hidden="true"></span>
              STARCLOUD CREATIVE
            </p>
            <h2 id="auth-required-title">{{ copy.title }}</h2>
            <p id="auth-required-description" class="auth-required-lead">
              {{ copy.lead }}
            </p>
            <p class="auth-required-detail">{{ copy.detail }}</p>

            <div class="auth-required-actions">
              <button type="button" class="is-primary" @click="continueToAuth('register')">
                {{ copy.register }}
                <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
              </button>
              <button type="button" class="is-secondary" @click="continueToAuth('login')">
                {{ copy.login }}
              </button>
            </div>

            <p class="auth-required-support">
              <i class="bi bi-shield-check" aria-hidden="true"></i>
              {{ copy.support }}
            </p>
          </div>

          <figure class="auth-required-visual" aria-hidden="true">
            <img src="/sucai/1home-intro-02.png" alt="" />
            <span class="auth-required-visual__line is-one"></span>
            <span class="auth-required-visual__line is-two"></span>
            <figcaption>
              <strong>CREATE WITHOUT LIMITS</strong>
              <span>IMAGE · DESIGN · STORY</span>
            </figcaption>
          </figure>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.auth-required-layer {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: grid;
  place-items: center;
  padding: clamp(18px, 4vw, 64px);
  background: rgb(4 5 8 / 78%);
  backdrop-filter: blur(18px) saturate(0.8);
}

.auth-required-dialog {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(380px, 1.05fr);
  width: min(1280px, 100%);
  max-height: min(820px, calc(100dvh - 48px));
  overflow: hidden;
  color: #f7f7f8;
  background: radial-gradient(circle at 20% 12%, rgb(124 58 237 / 14%), transparent 31%), #111214;
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 28px;
  box-shadow: 0 38px 110px rgb(0 0 0 / 56%);
  outline: none;
}

.auth-required-close {
  position: absolute;
  z-index: 4;
  top: 22px;
  right: 22px;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  color: #fff;
  background: rgb(12 13 16 / 62%);
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: 50%;
  backdrop-filter: blur(14px);
  transition:
    background-color 160ms ease,
    transform 160ms ease;
}

.auth-required-close:hover {
  background: rgb(255 255 255 / 15%);
  transform: rotate(4deg);
}

.auth-required-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: clamp(48px, 6vw, 94px);
}

.auth-required-eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 26px;
  color: #a8a8b2;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.auth-required-eyebrow span {
  width: 34px;
  height: 2px;
  background: linear-gradient(90deg, #8b5cf6, #f43f8f);
}

.auth-required-copy h2 {
  max-width: 620px;
  margin: 0;
  color: #fff;
  font-size: clamp(2.8rem, 5.2vw, 5.35rem);
  font-weight: 850;
  line-height: 0.98;
  letter-spacing: -0.065em;
}

.auth-required-lead {
  margin: 38px 0 0;
  color: #e8e8ec;
  font-size: clamp(1.05rem, 1.45vw, 1.35rem);
  font-weight: 650;
  line-height: 1.55;
}

.auth-required-detail {
  max-width: 610px;
  margin: 14px 0 0;
  color: #9d9da7;
  font-size: 0.98rem;
  line-height: 1.8;
}

.auth-required-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 42px;
}

.auth-required-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-width: 148px;
  min-height: 54px;
  padding: 0 25px;
  font-size: 0.98rem;
  font-weight: 800;
  border-radius: 13px;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease;
}

.auth-required-actions button:hover {
  transform: translateY(-2px);
}

.auth-required-actions .is-primary {
  color: #111214;
  background: #f6f6f7;
  border: 1px solid #fff;
  box-shadow: 0 0 0 5px rgb(255 255 255 / 8%);
}

.auth-required-actions .is-secondary {
  color: #fff;
  background: transparent;
  border: 1px solid rgb(255 255 255 / 24%);
}

.auth-required-actions .is-secondary:hover {
  background: rgb(255 255 255 / 7%);
  border-color: rgb(255 255 255 / 42%);
}

.auth-required-support {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 32px 0 0;
  color: #777780;
  font-size: 0.8rem;
}

.auth-required-visual {
  position: relative;
  min-height: 690px;
  margin: 0;
  overflow: hidden;
  background: #d6d6d6;
}

.auth-required-visual::after {
  position: absolute;
  inset: 0;
  content: '';
  background:
    linear-gradient(180deg, transparent 52%, rgb(7 7 10 / 52%) 100%),
    linear-gradient(90deg, rgb(17 18 20 / 28%), transparent 22%);
  pointer-events: none;
}

.auth-required-visual img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: cover;
  object-position: 50% 42%;
  filter: contrast(1.05);
}

.auth-required-visual__line {
  position: absolute;
  z-index: 2;
  width: 4px;
  height: 130%;
  background: #f13a93;
  box-shadow: 0 0 20px rgb(241 58 147 / 38%);
  transform: rotate(23deg);
}

.auth-required-visual__line.is-one {
  top: -18%;
  left: 28%;
}

.auth-required-visual__line.is-two {
  top: -12%;
  right: 18%;
  transform: rotate(7deg);
}

.auth-required-visual figcaption {
  position: absolute;
  z-index: 3;
  right: 30px;
  bottom: 28px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  color: #fff;
  text-shadow: 0 2px 18px rgb(0 0 0 / 58%);
}

.auth-required-visual figcaption strong {
  font-size: 0.78rem;
  letter-spacing: 0.15em;
}

.auth-required-visual figcaption span {
  margin-top: 4px;
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  opacity: 0.7;
}

.auth-required-enter-active,
.auth-required-leave-active {
  transition: opacity 180ms ease;
}

.auth-required-enter-active .auth-required-dialog,
.auth-required-leave-active .auth-required-dialog {
  transition:
    transform 220ms ease,
    opacity 180ms ease;
}

.auth-required-enter-from,
.auth-required-leave-to {
  opacity: 0;
}

.auth-required-enter-from .auth-required-dialog,
.auth-required-leave-to .auth-required-dialog {
  opacity: 0;
  transform: translateY(18px) scale(0.985);
}

@media (max-width: 900px) {
  .auth-required-layer {
    padding: 14px;
  }

  .auth-required-dialog {
    grid-template-columns: 1fr;
    max-height: calc(100dvh - 28px);
    overflow-y: auto;
    border-radius: 22px;
  }

  .auth-required-copy {
    order: 2;
    padding: 34px 28px 36px;
  }

  .auth-required-copy h2 {
    font-size: clamp(2.35rem, 12vw, 4rem);
  }

  .auth-required-eyebrow {
    margin-bottom: 18px;
  }

  .auth-required-lead {
    margin-top: 24px;
  }

  .auth-required-actions {
    margin-top: 30px;
  }

  .auth-required-actions button {
    flex: 1 1 140px;
  }

  .auth-required-visual {
    order: 1;
    min-height: 230px;
    max-height: 32dvh;
  }

  .auth-required-visual img {
    object-position: 50% 36%;
  }

  .auth-required-visual figcaption {
    right: 20px;
    bottom: 18px;
  }

  .auth-required-close {
    top: 16px;
    right: 16px;
  }
}

@media (max-width: 520px) {
  .auth-required-support {
    align-items: flex-start;
  }

  .auth-required-visual {
    min-height: 190px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-required-enter-active,
  .auth-required-leave-active,
  .auth-required-enter-active .auth-required-dialog,
  .auth-required-leave-active .auth-required-dialog,
  .auth-required-actions button,
  .auth-required-close {
    transition: none;
  }
}
</style>
