<script setup>
import AuthSocialButtons from '@/components/auth/AuthSocialButtons.vue'
import AuthTurnstile from '@/components/auth/AuthTurnstile.vue'
import {
  confirmPasswordReset,
  requestEmailCode,
  requestPasswordReset,
  verifyEmailCode,
  verifyMagicLinkToken,
} from '@/services/auth'
import { normalizeAuthRedirect } from '@/services/authRedirect'
import { useAuthStore } from '@/stores/auth'
import AuthPageShell from './AuthPageShell.vue'
import { getPasswordMeta, useAuthPage, validateEmail, validatePassword } from './useAuthPage.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import './auth-page.css'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const {
  authConfig,
  authConfigReady,
  turnstileToken,
  turnstileRef,
  turnstileRequired,
  turnstileSiteKey,
  oauthProviders,
  ensureTurnstileReady,
  resetTurnstile,
} = useAuthPage()

const email = ref(String(route.query.email || ''))
const loginPassword = ref('')
const importGuestData = ref(false)
const registerDisplayName = ref('')
const registerPassword = ref('')
const registerConfirmPassword = ref('')
const registerEmailCode = ref('')
const registerVerificationToken = ref('')
const registerCodeSent = ref(false)
const registerCodeVerified = ref(false)
const registerCodeCooldown = ref(0)
const forgotMethod = ref('link')
const forgotEmailCode = ref('')
const forgotVerificationToken = ref('')
const forgotNewPassword = ref('')
const forgotConfirmPassword = ref('')
const forgotCodeCooldown = ref(0)
const showLoginPassword = ref(false)
const showRegisterPassword = ref(false)
const showRegisterConfirmPassword = ref(false)
const showForgotNewPassword = ref(false)
const showForgotConfirmPassword = ref(false)
const error = ref('')
const info = ref('')
const isSendingRegisterCode = ref(false)
const isRegisterSubmitting = ref(false)
const isForgotLoading = ref(false)

let registerCooldownTimer = null
let forgotCooldownTimer = null
let handledMagicToken = ''

const authRedirectTarget = computed(() => normalizeAuthRedirect(route.query.redirect))
const referralId = computed(() => String(route.query.referrerId || route.query.ref || '').trim())
const requireEmailVerification = computed(() => authConfig.value.requireEmailVerification !== false)
const routeMode = computed(() => {
  if (route.query.mode === 'register') return 'register'
  if (route.query.mode === 'forgot') return 'forgot'
  return 'login'
})
const activeMode = ref(routeMode.value)
const registerPasswordMeta = computed(() => getPasswordMeta(registerPassword.value))
const forgotPasswordMeta = computed(() => getPasswordMeta(forgotNewPassword.value))
const registerConfirmMismatch = computed(
  () => Boolean(registerConfirmPassword.value) && registerPassword.value !== registerConfirmPassword.value,
)
const forgotConfirmMismatch = computed(
  () => Boolean(forgotConfirmPassword.value) && forgotNewPassword.value !== forgotConfirmPassword.value,
)
const modeOrder = ['login', 'register', 'forgot']
const shellCopy = computed(() => {
  if (activeMode.value === 'register') {
    return {
      kicker: '注册',
      panelTitle: '创建账号',
      panelSubtitle: '验证邮箱后即可完成注册',
      panelIcon: 'bi bi-person-plus',
    }
  }
  if (activeMode.value === 'forgot') {
    return {
      kicker: '找回密码',
      panelTitle: '忘记密码',
      panelSubtitle: '选择验证方式',
      panelIcon: 'bi bi-key',
    }
  }
  return {
    kicker: '登录',
    panelTitle: '登录账号',
    panelSubtitle: '邮箱密码或第三方账号登录',
    panelIcon: 'bi bi-box-arrow-in-right',
  }
})

onMounted(async () => {
  await authStore.initAuth().catch(() => null)
  if (authStore.isAuthenticated) {
    await router.replace(authRedirectTarget.value).catch(() => {})
    return
  }
  await handleRouteSignals()
})

onBeforeUnmount(() => {
  if (registerCooldownTimer) clearInterval(registerCooldownTimer)
  if (forgotCooldownTimer) clearInterval(forgotCooldownTimer)
})

watch(routeMode, (nextMode) => {
  setActiveMode(nextMode)
})

watch(
  () => route.query,
  async () => {
    if (route.query.email) email.value = String(route.query.email)
    await handleRouteSignals()
  },
)

watch(email, () => {
  registerEmailCode.value = ''
  registerVerificationToken.value = ''
  registerCodeVerified.value = false
  registerCodeSent.value = false
  forgotEmailCode.value = ''
  forgotVerificationToken.value = ''
})

function releaseCardFocus() {
  if (typeof document === 'undefined') return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest('.auth-flow-card')) {
    focused.blur()
  }
}

function setActiveMode(mode) {
  if (!modeOrder.includes(mode)) return
  releaseCardFocus()
  if (activeMode.value === mode) return
  activeMode.value = mode
  error.value = ''
  info.value = ''
  authStore.error = ''
  resetTurnstile()
}

function prepareModeSwitch(mode) {
  setActiveMode(mode)
}

function startRegisterCooldown(seconds = 60) {
  registerCodeCooldown.value = seconds
  if (registerCooldownTimer) clearInterval(registerCooldownTimer)
  registerCooldownTimer = setInterval(() => {
    registerCodeCooldown.value = Math.max(0, registerCodeCooldown.value - 1)
    if (registerCodeCooldown.value <= 0) clearInterval(registerCooldownTimer)
  }, 1000)
}

function authQuery(mode, extra = {}) {
  return {
    ...route.query,
    ...extra,
    mode,
  }
}

function modeCardClass(mode) {
  const activeIndex = modeOrder.indexOf(activeMode.value)
  const modeIndex = modeOrder.indexOf(mode)
  return {
    'is-active': activeMode.value === mode,
    'is-before': modeIndex < activeIndex,
    'is-after': modeIndex > activeIndex,
  }
}

function startForgotCooldown(seconds = 60) {
  forgotCodeCooldown.value = seconds
  if (forgotCooldownTimer) clearInterval(forgotCooldownTimer)
  forgotCooldownTimer = setInterval(() => {
    forgotCodeCooldown.value = Math.max(0, forgotCodeCooldown.value - 1)
    if (forgotCodeCooldown.value <= 0) clearInterval(forgotCooldownTimer)
  }, 1000)
}

async function handleRouteSignals() {
  if (route.query.registered === '1') info.value = '账号已创建，请使用邮箱和密码登录。'
  if (route.query.reset === '1') info.value = '密码已重置，请使用新密码登录。'
  if (route.query.oauth === 'error') error.value = String(route.query.reason || '第三方登录失败')

  if (route.query.oauth === 'success') {
    await authStore.initAuth().catch(() => null)
    if (authStore.isAuthenticated) {
      info.value = '第三方登录成功'
      await router.replace(authRedirectTarget.value).catch(() => {})
      return
    }
    info.value = '第三方登录成功，请继续完成登录。'
  }

  const magicToken = String(route.query.magic_token || '').trim()
  if (magicToken && magicToken !== handledMagicToken) {
    handledMagicToken = magicToken
    try {
      await verifyMagicLinkToken(magicToken)
      await authStore.initAuth()
      await router.replace(authRedirectTarget.value).catch(() => {})
    } catch (err) {
      error.value = err?.message || '魔法链接登录失败'
    }
  }
}

async function submitLogin() {
  error.value = ''
  info.value = ''
  authStore.error = ''

  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  const passwordError = validatePassword(loginPassword.value)
  if (passwordError) {
    error.value = passwordError
    return
  }
  if (!authConfigReady.value) {
    error.value = '正在加载验证组件，请稍候…'
    return
  }
  if (!ensureTurnstileReady()) {
    error.value = '请完成人机验证'
    return
  }

  try {
    await authStore.login({
      email: email.value,
      password: loginPassword.value,
      importGuestData: importGuestData.value,
      turnstileToken: turnstileToken.value,
    })
    await router.replace(authRedirectTarget.value).catch(() => {})
  } catch (err) {
    error.value = err?.message || '登录失败'
    resetTurnstile()
    await nextTick()
  }
}

async function sendRegisterEmailCode() {
  error.value = ''
  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  if (!authConfigReady.value) {
    error.value = '正在加载验证组件，请稍候…'
    return
  }
  if (!ensureTurnstileReady()) {
    error.value = '请先完成人机验证'
    return
  }

  isSendingRegisterCode.value = true
  try {
    const result = await requestEmailCode({
      email: email.value,
      purpose: 'register',
      turnstileToken: turnstileToken.value,
    })
    registerCodeSent.value = true
    registerVerificationToken.value = ''
    registerCodeVerified.value = false
    info.value = result.sent ? '验证码已发送到你的邮箱' : '如果邮箱可用，验证码已发送'
    if (result.debugCode) info.value = `开发模式验证码：${result.debugCode}`
    startRegisterCooldown(result.cooldownSeconds || 60)
    resetTurnstile()
  } catch (err) {
    error.value = err?.message || '验证码发送失败'
    resetTurnstile()
  } finally {
    isSendingRegisterCode.value = false
  }
}

async function resolveRegisterVerificationToken() {
  if (!requireEmailVerification.value) return ''
  if (registerVerificationToken.value) return registerVerificationToken.value

  if (!/^\d{6}$/.test(registerEmailCode.value)) {
    throw new Error('请输入 6 位验证码')
  }

  const result = await verifyEmailCode({
    email: email.value,
    code: registerEmailCode.value,
    purpose: 'register',
  })
  registerVerificationToken.value = result.verificationToken
  registerCodeVerified.value = true
  return result.verificationToken
}

async function submitRegister() {
  error.value = ''
  info.value = ''
  authStore.error = ''

  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  const passwordError = validatePassword(registerPassword.value)
  if (passwordError) {
    error.value = passwordError
    return
  }
  if (registerPassword.value !== registerConfirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  if (!authConfigReady.value) {
    error.value = '正在加载验证组件，请稍候…'
    return
  }
  if (!ensureTurnstileReady()) {
    error.value = '请完成人机验证'
    return
  }

  isRegisterSubmitting.value = true
  try {
    const emailVerificationToken = await resolveRegisterVerificationToken()
    await authStore.register({
      email: email.value,
      password: registerPassword.value,
      displayName: registerDisplayName.value,
      referrerId: referralId.value,
      emailVerificationToken,
      turnstileToken: turnstileToken.value,
    })
    await router.replace({
      name: 'auth',
      query: authQuery('login', {
        registered: '1',
        email: email.value,
      }),
    })
  } catch (err) {
    error.value = err?.message || '注册失败'
    resetTurnstile()
  } finally {
    isRegisterSubmitting.value = false
  }
}

async function sendResetLink() {
  error.value = ''
  info.value = ''
  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  if (!authConfigReady.value) {
    error.value = '正在加载验证组件，请稍候…'
    return
  }
  if (!ensureTurnstileReady()) {
    error.value = '请完成人机验证'
    return
  }

  isForgotLoading.value = true
  try {
    const result = await requestPasswordReset({
      email: email.value,
      turnstileToken: turnstileToken.value,
    })
    info.value = '如果邮箱存在，我们已发送重置链接，请查收邮件。'
    if (result.debugLink) info.value = `开发模式重置链接：${result.debugLink}`
    resetTurnstile()
  } catch (err) {
    error.value = err?.message || '重置邮件发送失败'
    resetTurnstile()
  } finally {
    isForgotLoading.value = false
  }
}

async function sendResetCode() {
  error.value = ''
  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  if (!authConfigReady.value) {
    error.value = '正在加载验证组件，请稍候…'
    return
  }
  if (!ensureTurnstileReady()) {
    error.value = '请完成人机验证'
    return
  }

  isForgotLoading.value = true
  try {
    const result = await requestEmailCode({
      email: email.value,
      purpose: 'password_reset',
      turnstileToken: turnstileToken.value,
    })
    info.value = result.sent ? '验证码已发送到你的邮箱' : '如果邮箱存在，验证码已发送'
    if (result.debugCode) info.value = `开发模式验证码：${result.debugCode}`
    startForgotCooldown(result.cooldownSeconds || 60)
    resetTurnstile()
  } catch (err) {
    error.value = err?.message || '验证码发送失败'
    resetTurnstile()
  } finally {
    isForgotLoading.value = false
  }
}

async function resetWithCode() {
  error.value = ''
  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  if (!/^\d{6}$/.test(forgotEmailCode.value)) {
    error.value = '请输入 6 位验证码'
    return
  }
  const passwordError = validatePassword(forgotNewPassword.value)
  if (passwordError) {
    error.value = passwordError
    return
  }
  if (forgotNewPassword.value !== forgotConfirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  isForgotLoading.value = true
  try {
    if (!forgotVerificationToken.value) {
      const verified = await verifyEmailCode({
        email: email.value,
        code: forgotEmailCode.value,
        purpose: 'password_reset',
      })
      forgotVerificationToken.value = verified.verificationToken
    }

    await confirmPasswordReset({
      email: email.value,
      verificationToken: forgotVerificationToken.value,
      newPassword: forgotNewPassword.value,
    })

    await router.replace({
      name: 'auth',
      query: {
        email: email.value,
        mode: 'login',
        reset: '1',
      },
    })
  } catch (err) {
    error.value = err?.message || '密码重置失败'
    forgotVerificationToken.value = ''
  } finally {
    isForgotLoading.value = false
  }
}
</script>

<template>
  <AuthPageShell
    :kicker="shellCopy.kicker"
    :active-mode="activeMode"
    custom-panel
  >
    <template #panel>
      <nav class="auth-route-nav auth-route-nav--stack" aria-label="账号操作">
        <RouterLink
          :to="{ name: 'auth', query: authQuery('login') }"
          :class="{ 'is-active': activeMode === 'login' }"
          @click="prepareModeSwitch('login')"
        >
          登录
        </RouterLink>
        <RouterLink
          :to="{ name: 'auth', query: authQuery('register') }"
          :class="{ 'is-active': activeMode === 'register' }"
          @click="prepareModeSwitch('register')"
        >
          注册
        </RouterLink>
      </nav>

      <div class="auth-card-stage">
        <article
          class="auth-panel-card auth-flow-card"
          :class="modeCardClass('login')"
          :inert="activeMode !== 'login'"
        >
          <div class="auth-panel-head">
            <div class="auth-panel-head__badge" aria-hidden="true">
              <i class="bi bi-box-arrow-in-right"></i>
            </div>
            <div class="auth-panel-head__copy">
              <h2>登录账号</h2>
              <p>邮箱密码或第三方账号登录</p>
            </div>
          </div>

          <div v-if="activeMode === 'login' && (error || authStore.error || info)" class="auth-panel-alerts" aria-live="polite">
            <p v-if="error || authStore.error" class="auth-notice is-error" role="alert">
              <i class="bi bi-exclamation-triangle"></i>
              {{ error || authStore.error }}
            </p>
            <p v-if="info" class="auth-notice is-info" role="status">
              <i class="bi bi-check-circle"></i>
              {{ info }}
            </p>
          </div>

          <div class="auth-panel-body">
            <form class="auth-form" @submit.prevent="submitLogin">
              <label class="auth-field auth-field-email">
                <span>邮箱</span>
                <div class="input-wrap">
                  <i class="bi bi-envelope input-wrap__icon"></i>
                  <input v-model.trim="email" type="email" autocomplete="email" required placeholder="邮箱" aria-label="邮箱" />
                </div>
              </label>

              <label class="auth-field auth-field-password">
                <span>密码</span>
                <div class="input-wrap">
                  <i class="bi bi-lock input-wrap__icon"></i>
                  <input
                    v-model="loginPassword"
                    :type="showLoginPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    minlength="8"
                    required
                    placeholder="密码"
                    aria-label="密码"
                  />
                  <button type="button" aria-label="切换密码可见性" @click="showLoginPassword = !showLoginPassword">
                    <i :class="showLoginPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
                  </button>
                </div>
              </label>

              <div class="auth-inline-links">
                <RouterLink :to="{ name: 'auth', query: authQuery('forgot') }" @click="prepareModeSwitch('forgot')">忘记密码？</RouterLink>
              </div>

              <label class="auth-check">
                <input v-model="importGuestData" type="checkbox" />
                <span>登录后合并当前浏览器的访客收藏与设置</span>
              </label>

              <AuthTurnstile
                v-if="activeMode === 'login'"
                ref="turnstileRef"
                :site-key="turnstileSiteKey"
                :enabled="turnstileRequired"
                @update:token="turnstileToken = $event"
              />

              <button class="auth-submit" type="submit" :disabled="authStore.isLoading || !authConfigReady">
                <span v-if="authStore.isLoading" class="auth-spinner"></span>
                <span>{{ authStore.isLoading ? '登录中…' : '登录' }}</span>
                <i v-if="!authStore.isLoading" class="bi bi-arrow-right"></i>
              </button>

              <AuthSocialButtons :providers="oauthProviders" :redirect="authRedirectTarget" :disabled="authStore.isLoading" />
            </form>
          </div>

          <div class="auth-panel-footer">
            <p class="auth-switch-link">
              还没有账号？
              <RouterLink :to="{ name: 'auth', query: authQuery('register') }" @click="prepareModeSwitch('register')">立即注册</RouterLink>
            </p>
          </div>
        </article>

        <article
          class="auth-panel-card auth-flow-card"
          :class="modeCardClass('register')"
          :inert="activeMode !== 'register'"
        >
          <div class="auth-panel-head">
            <div class="auth-panel-head__badge" aria-hidden="true">
              <i class="bi bi-person-plus"></i>
            </div>
            <div class="auth-panel-head__copy">
              <h2>创建账号</h2>
              <p>验证邮箱后即可完成注册</p>
            </div>
          </div>

          <div v-if="activeMode === 'register' && (error || authStore.error || info)" class="auth-panel-alerts" aria-live="polite">
            <p v-if="error || authStore.error" class="auth-notice is-error" role="alert">
              <i class="bi bi-exclamation-triangle"></i>
              {{ error || authStore.error }}
            </p>
            <p v-if="info" class="auth-notice is-info" role="status">
              <i class="bi bi-check-circle"></i>
              {{ info }}
            </p>
          </div>

          <div class="auth-panel-body">
            <form class="auth-form" @submit.prevent="submitRegister">
              <label class="auth-field auth-field-name">
                <span>显示名</span>
                <div class="input-wrap">
                  <i class="bi bi-person input-wrap__icon"></i>
                  <input v-model.trim="registerDisplayName" autocomplete="nickname" placeholder="怎么称呼你" aria-label="显示名" />
                </div>
              </label>

              <label class="auth-field auth-field-email">
                <span>邮箱</span>
                <div class="input-wrap">
                  <i class="bi bi-envelope input-wrap__icon"></i>
                  <input v-model.trim="email" type="email" autocomplete="email" required placeholder="邮箱" aria-label="邮箱" />
                </div>
              </label>

              <div v-if="requireEmailVerification" class="auth-code-row" :class="{ 'is-complete': registerCodeVerified }">
                <label class="auth-field auth-field-code">
                  <span>邮箱验证码</span>
                  <div class="input-wrap">
                    <i class="bi bi-shield-check input-wrap__icon"></i>
                    <input
                      v-model.trim="registerEmailCode"
                      autocomplete="one-time-code"
                      inputmode="numeric"
                      maxlength="6"
                      placeholder="6 位验证码"
                      aria-label="邮箱验证码"
                    />
                  </div>
                </label>
                <button
                  type="button"
                  class="auth-code-btn"
                  :disabled="isSendingRegisterCode || registerCodeCooldown > 0"
                  @click="sendRegisterEmailCode"
                >
                  {{ registerCodeCooldown > 0 ? `${registerCodeCooldown}s` : registerCodeSent ? '重新发送' : '发送验证码' }}
                </button>
              </div>

              <label class="auth-field auth-field-password">
                <span>密码</span>
                <div class="input-wrap">
                  <i class="bi bi-lock input-wrap__icon"></i>
                  <input
                    v-model="registerPassword"
                    :type="showRegisterPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    minlength="8"
                    required
                    placeholder="至少 8 位"
                    aria-label="密码"
                  />
                  <button type="button" aria-label="切换密码可见性" @click="showRegisterPassword = !showRegisterPassword">
                    <i :class="showRegisterPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
                  </button>
                </div>
                <div class="auth-strength" aria-live="polite">
                  <div class="auth-strength-track" aria-hidden="true">
                    <span
                      :class="{ 'is-weak': registerPasswordMeta.score < 2, 'is-strong': registerPasswordMeta.score >= 3 }"
                      :style="{ width: `${registerPasswordMeta.percent}%` }"
                    ></span>
                  </div>
                  <small>强度：{{ registerPasswordMeta.label }}</small>
                </div>
              </label>

              <label class="auth-field auth-field-confirm">
                <span>确认密码</span>
                <div class="input-wrap" :class="{ 'is-error': registerConfirmMismatch }">
                  <i class="bi bi-shield-lock input-wrap__icon"></i>
                  <input
                    v-model="registerConfirmPassword"
                    :type="showRegisterConfirmPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    minlength="8"
                    required
                    placeholder="再输入一次密码"
                    aria-label="确认密码"
                  />
                  <button
                    type="button"
                    aria-label="切换确认密码可见性"
                    @click="showRegisterConfirmPassword = !showRegisterConfirmPassword"
                  >
                    <i :class="showRegisterConfirmPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
                  </button>
                </div>
                <p v-if="registerConfirmMismatch" class="auth-field-hint is-error">两次输入的密码不一致</p>
              </label>

              <AuthTurnstile
                v-if="activeMode === 'register'"
                ref="turnstileRef"
                :site-key="turnstileSiteKey"
                :enabled="turnstileRequired"
                @update:token="turnstileToken = $event"
              />

              <button class="auth-submit" type="submit" :disabled="isRegisterSubmitting || authStore.isLoading || !authConfigReady">
                <span v-if="isRegisterSubmitting || authStore.isLoading" class="auth-spinner"></span>
                <span>{{ isRegisterSubmitting || authStore.isLoading ? '创建中…' : '创建账号' }}</span>
                <i v-if="!isRegisterSubmitting && !authStore.isLoading" class="bi bi-arrow-right"></i>
              </button>
            </form>
          </div>

          <div class="auth-panel-footer">
            <p class="auth-switch-link">
              已有账号？
              <RouterLink :to="{ name: 'auth', query: authQuery('login') }" @click="prepareModeSwitch('login')">返回登录</RouterLink>
            </p>
          </div>
        </article>

        <article
          class="auth-panel-card auth-flow-card"
          :class="modeCardClass('forgot')"
          :inert="activeMode !== 'forgot'"
        >
          <div class="auth-panel-head">
            <div class="auth-panel-head__badge" aria-hidden="true">
              <i class="bi bi-key"></i>
            </div>
            <div class="auth-panel-head__copy">
              <h2>忘记密码</h2>
              <p>选择验证方式</p>
            </div>
          </div>

          <div v-if="activeMode === 'forgot' && (error || authStore.error || info)" class="auth-panel-alerts" aria-live="polite">
            <p v-if="error || authStore.error" class="auth-notice is-error" role="alert">
              <i class="bi bi-exclamation-triangle"></i>
              {{ error || authStore.error }}
            </p>
            <div v-if="info" class="auth-notice is-info" role="status">
              <i class="bi bi-check-circle"></i>
              <div class="auth-notice__body">
                <p>{{ info.startsWith('开发模式重置链接：') ? '开发模式重置链接已生成' : info }}</p>
                <a
                  v-if="info.startsWith('开发模式重置链接：')"
                  class="auth-debug-link"
                  :href="info.replace('开发模式重置链接：', '')"
                >
                  {{ info.replace('开发模式重置链接：', '') }}
                </a>
              </div>
            </div>
          </div>

          <div class="auth-panel-body">
            <div class="auth-forgot-flow">
              <div class="auth-segment" :class="{ 'is-code': forgotMethod === 'code' }" role="tablist" aria-label="找回密码方式">
                <span class="auth-segment__indicator" aria-hidden="true"></span>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="forgotMethod === 'link'"
                  :class="{ 'is-active': forgotMethod === 'link' }"
                  @click="forgotMethod = 'link'"
                >
                  <i class="bi bi-envelope-at"></i>
                  <span>邮件链接</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="forgotMethod === 'code'"
                  :class="{ 'is-active': forgotMethod === 'code' }"
                  @click="forgotMethod = 'code'"
                >
                  <i class="bi bi-shield-lock"></i>
                  <span>验证码</span>
                </button>
              </div>

              <form class="auth-form" @submit.prevent="forgotMethod === 'link' ? sendResetLink() : resetWithCode()">
                <label class="auth-field auth-field-email">
                  <span>邮箱</span>
                  <div class="input-wrap">
                    <i class="bi bi-envelope input-wrap__icon"></i>
                    <input v-model.trim="email" type="email" autocomplete="email" required placeholder="注册邮箱" aria-label="邮箱" />
                  </div>
                </label>

                <div v-if="forgotMethod === 'code'" class="auth-code-fields">
                  <div class="auth-code-row">
                    <label class="auth-field auth-field-code">
                      <span>验证码</span>
                      <div class="input-wrap">
                        <i class="bi bi-shield-check input-wrap__icon"></i>
                        <input
                          v-model.trim="forgotEmailCode"
                          autocomplete="one-time-code"
                          inputmode="numeric"
                          maxlength="6"
                          placeholder="6 位验证码"
                          aria-label="验证码"
                        />
                      </div>
                    </label>
                    <button
                      type="button"
                      class="auth-code-btn"
                      :disabled="isForgotLoading || forgotCodeCooldown > 0"
                      @click="sendResetCode"
                    >
                      {{ forgotCodeCooldown > 0 ? `${forgotCodeCooldown}s` : '发送验证码' }}
                    </button>
                  </div>

                  <label class="auth-field auth-field-password">
                    <span>新密码</span>
                    <div class="input-wrap">
                      <i class="bi bi-lock input-wrap__icon"></i>
                      <input
                        v-model="forgotNewPassword"
                        :type="showForgotNewPassword ? 'text' : 'password'"
                        minlength="8"
                        required
                        placeholder="至少 8 位"
                        aria-label="新密码"
                      />
                      <button type="button" aria-label="切换新密码可见性" @click="showForgotNewPassword = !showForgotNewPassword">
                        <i :class="showForgotNewPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
                      </button>
                    </div>
                    <div class="auth-strength" aria-live="polite">
                      <div class="auth-strength-track" aria-hidden="true">
                        <span
                          :class="{ 'is-weak': forgotPasswordMeta.score < 2, 'is-strong': forgotPasswordMeta.score >= 3 }"
                          :style="{ width: `${forgotPasswordMeta.percent}%` }"
                        ></span>
                      </div>
                      <small>强度：{{ forgotPasswordMeta.label }}</small>
                    </div>
                  </label>

                  <label class="auth-field auth-field-confirm">
                    <span>确认新密码</span>
                    <div class="input-wrap" :class="{ 'is-error': forgotConfirmMismatch }">
                      <i class="bi bi-shield-lock input-wrap__icon"></i>
                      <input
                        v-model="forgotConfirmPassword"
                        :type="showForgotConfirmPassword ? 'text' : 'password'"
                        minlength="8"
                        required
                        placeholder="再输入一次"
                        aria-label="确认新密码"
                      />
                      <button
                        type="button"
                        aria-label="切换确认新密码可见性"
                        @click="showForgotConfirmPassword = !showForgotConfirmPassword"
                      >
                        <i :class="showForgotConfirmPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
                      </button>
                    </div>
                    <p v-if="forgotConfirmMismatch" class="auth-field-hint is-error">两次输入的密码不一致</p>
                  </label>
                </div>

                <AuthTurnstile
                  v-if="activeMode === 'forgot'"
                  ref="turnstileRef"
                  :site-key="turnstileSiteKey"
                  :enabled="turnstileRequired"
                  @update:token="turnstileToken = $event"
                />

                <button class="auth-submit" type="submit" :disabled="isForgotLoading || !authConfigReady">
                  <span v-if="isForgotLoading" class="auth-spinner"></span>
                  <span>{{ forgotMethod === 'link' ? (isForgotLoading ? '发送中…' : '发送重置链接') : (isForgotLoading ? '重置中…' : '重置密码') }}</span>
                </button>
              </form>
            </div>
          </div>

          <div class="auth-panel-footer">
            <p class="auth-switch-link">
              想起密码了？
              <RouterLink :to="{ name: 'auth', query: authQuery('login') }" @click="prepareModeSwitch('login')">返回登录</RouterLink>
            </p>
          </div>
        </article>
      </div>
    </template>
  </AuthPageShell>
</template>
