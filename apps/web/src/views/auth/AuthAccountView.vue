<script setup>
import { normalizeAuthRedirect } from '@/services/authRedirect'
import { useAuthStore } from '@/stores/auth'
import AuthPageShell from './AuthPageShell.vue'
import { getPasswordMeta, validateEmail, validatePassword } from './useAuthPage.js'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import './auth-page.css'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref(String(route.query.email || ''))
const loginPassword = ref('')
const registerDisplayName = ref('')
const registerPassword = ref('')
const registerConfirmPassword = ref('')
const showLoginPassword = ref(false)
const showRegisterPassword = ref(false)
const showRegisterConfirmPassword = ref(false)
const error = ref('')
const info = ref('')
const isRegisterSubmitting = ref(false)

const authRedirectTarget = computed(() => normalizeAuthRedirect(route.query.redirect))
const routeMode = computed(() => (route.query.mode === 'register' ? 'register' : 'login'))
const activeMode = ref(routeMode.value)
const registerPasswordMeta = computed(() => getPasswordMeta(registerPassword.value))
const registerConfirmMismatch = computed(
  () =>
    Boolean(registerConfirmPassword.value) &&
    registerPassword.value !== registerConfirmPassword.value,
)
const modeOrder = ['login', 'register']
const shellCopy = computed(() => {
  if (activeMode.value === 'register') {
    return {
      kicker: '注册',
      panelTitle: '创建账号',
      panelSubtitle: '使用邮箱和密码即可注册',
      panelIcon: 'bi bi-person-plus',
    }
  }
  return {
    kicker: '登录',
    panelTitle: '登录账号',
    panelSubtitle: '使用邮箱和密码登录',
    panelIcon: 'bi bi-box-arrow-in-right',
  }
})

onMounted(async () => {
  await authStore.initAuth().catch(() => null)
  if (authStore.isAuthenticated) {
    await router.replace(authRedirectTarget.value).catch(() => {})
    return
  }
  if (route.query.registered === '1') info.value = '账号已创建，请使用邮箱和密码登录。'
})

watch(routeMode, (nextMode) => {
  setActiveMode(nextMode)
})

watch(
  () => route.query,
  () => {
    if (route.query.email) email.value = String(route.query.email)
  },
)

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
}

function prepareModeSwitch(mode) {
  setActiveMode(mode)
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

async function submitLogin() {
  error.value = ''
  info.value = ''
  authStore.error = ''

  const emailError = validateEmail(email.value)
  if (emailError) {
    error.value = emailError
    return
  }
  if (!loginPassword.value) {
    error.value = '请输入密码'
    return
  }

  try {
    await authStore.login({
      email: email.value.trim(),
      password: loginPassword.value,
    })
    await router.replace(authRedirectTarget.value).catch(() => {})
  } catch {
    // authStore.error 已带失败信息
  }
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

  isRegisterSubmitting.value = true
  try {
    await authStore.register({
      email: email.value.trim(),
      password: registerPassword.value,
      username: registerDisplayName.value.trim(),
    })
    // 新契约注册即登录，直接进入目标页
    if (authStore.isAuthenticated) {
      await router.replace(authRedirectTarget.value).catch(() => {})
      return
    }
    await router.replace({
      name: 'auth',
      query: { email: email.value.trim(), mode: 'login', registered: '1' },
    })
  } catch {
    // authStore.error 已带失败信息
  } finally {
    isRegisterSubmitting.value = false
  }
}
</script>

<template>
  <AuthPageShell :kicker="shellCopy.kicker" :active-mode="activeMode" custom-panel>
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
        <!-- 登录 -->
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
              <p>使用邮箱和密码登录</p>
            </div>
          </div>

          <div
            v-if="activeMode === 'login' && (error || authStore.error || info)"
            class="auth-panel-alerts"
            aria-live="polite"
          >
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
                  <i class="bi bi-envelope" aria-hidden="true"></i>
                  <input
                    v-model="email"
                    type="email"
                    autocomplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </label>
              <label class="auth-field auth-field-password">
                <span>密码</span>
                <div class="input-wrap">
                  <i class="bi bi-lock" aria-hidden="true"></i>
                  <input
                    v-model="loginPassword"
                    :type="showLoginPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    placeholder="输入密码"
                    required
                  />
                  <button
                    type="button"
                    class="input-visibility"
                    :aria-label="showLoginPassword ? '隐藏密码' : '显示密码'"
                    @click="showLoginPassword = !showLoginPassword"
                  >
                    <i class="bi" :class="showLoginPassword ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </div>
              </label>

              <button class="auth-submit" type="submit" :disabled="authStore.isLoading">
                <i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>
                {{ authStore.isLoading ? '登录中…' : '登录' }}
              </button>
            </form>
          </div>

          <div class="auth-panel-footer">
            <p>
              还没有账号？
              <RouterLink :to="{ name: 'auth', query: authQuery('register') }">立即注册</RouterLink>
            </p>
          </div>
        </article>

        <!-- 注册 -->
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
              <p>使用邮箱和密码即可注册</p>
            </div>
          </div>

          <div
            v-if="activeMode === 'register' && (error || authStore.error || info)"
            class="auth-panel-alerts"
            aria-live="polite"
          >
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
                <span>用户名（可选）</span>
                <div class="input-wrap">
                  <i class="bi bi-person" aria-hidden="true"></i>
                  <input
                    v-model="registerDisplayName"
                    type="text"
                    maxlength="24"
                    autocomplete="nickname"
                    placeholder="展示在个人中心和画廊"
                  />
                </div>
              </label>
              <label class="auth-field auth-field-email">
                <span>邮箱</span>
                <div class="input-wrap">
                  <i class="bi bi-envelope" aria-hidden="true"></i>
                  <input
                    v-model="email"
                    type="email"
                    autocomplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </label>
              <label class="auth-field auth-field-password">
                <span>密码</span>
                <div class="input-wrap">
                  <i class="bi bi-lock" aria-hidden="true"></i>
                  <input
                    v-model="registerPassword"
                    :type="showRegisterPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="至少 8 位，含字母和数字更安全"
                    required
                  />
                  <button
                    type="button"
                    class="input-visibility"
                    :aria-label="showRegisterPassword ? '隐藏密码' : '显示密码'"
                    @click="showRegisterPassword = !showRegisterPassword"
                  >
                    <i class="bi" :class="showRegisterPassword ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </div>
                <span v-if="registerPassword" class="auth-field-hint">
                  密码强度：{{ registerPasswordMeta.label }}
                </span>
              </label>
              <label class="auth-field auth-field-confirm">
                <span>确认密码</span>
                <div class="input-wrap">
                  <i class="bi bi-lock-fill" aria-hidden="true"></i>
                  <input
                    v-model="registerConfirmPassword"
                    :type="showRegisterConfirmPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="再次输入密码"
                    required
                  />
                  <button
                    type="button"
                    class="input-visibility"
                    :aria-label="showRegisterConfirmPassword ? '隐藏密码' : '显示密码'"
                    @click="showRegisterConfirmPassword = !showRegisterConfirmPassword"
                  >
                    <i class="bi" :class="showRegisterConfirmPassword ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </div>
                <p v-if="registerConfirmMismatch" class="auth-field-hint is-error">
                  两次输入的密码不一致
                </p>
              </label>

              <button
                class="auth-submit"
                type="submit"
                :disabled="isRegisterSubmitting || authStore.isLoading"
              >
                <i class="bi bi-person-plus" aria-hidden="true"></i>
                {{ isRegisterSubmitting ? '注册中…' : '注册并登录' }}
              </button>
            </form>
          </div>

          <div class="auth-panel-footer">
            <p>
              已有账号？
              <RouterLink :to="{ name: 'auth', query: authQuery('login') }">直接登录</RouterLink>
            </p>
          </div>
        </article>
      </div>
    </template>
  </AuthPageShell>
</template>
