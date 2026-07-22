<script setup>
import AuthPageShell from './AuthPageShell.vue'
import { fetchAuthProviders, oauthLoginURL, requestEmailAuthCode, resetAccountPassword } from '@/services/auth'
import { normalizeAuthRedirect } from '@/services/authRedirect'
import { useAuthStore } from '@/stores/auth'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import './auth-page.css'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const providers = ref({ github: false, email: true, password: true })
const username = ref('')
const email = ref(String(route.query.email || ''))
const code = ref('')
const password = ref('')
const confirmPassword = ref('')
const codeSent = ref(false)
const sending = ref(false)
const resetting = ref(false)
const error = ref(String(route.query.error || ''))
const info = ref(route.query.oauth === 'success' ? '登录成功，正在进入工作台。' : '')
const developmentCode = ref('')
const redirectTarget = computed(() => normalizeAuthRedirect(route.query.redirect))
const mode = computed(() => ['register', 'forgot'].includes(route.query.mode) ? route.query.mode : 'login')
const isLogin = computed(() => mode.value === 'login')
const isRegister = computed(() => mode.value === 'register')
const isForgot = computed(() => mode.value === 'forgot')
const passwordStrength = computed(() => {
  let score = 0
  if (password.value.length >= 8) score++
  if (/[A-Za-z]/.test(password.value) && /\d/.test(password.value)) score++
  if (/[^A-Za-z0-9]/.test(password.value) || password.value.length >= 12) score++
  return score
})

watch(mode, () => {
  code.value = ''
  password.value = ''
  confirmPassword.value = ''
  codeSent.value = false
  developmentCode.value = ''
  error.value = ''
  info.value = ''
  authStore.error = ''
})

onMounted(async () => {
  const [providerResult] = await Promise.all([
    fetchAuthProviders().catch(() => null),
    authStore.initAuth({ force: true }).catch(() => null),
  ])
  if (providerResult) providers.value = providerResult
  if (authStore.isAuthenticated) await router.replace(redirectTarget.value).catch(() => {})
})

function authQuery(nextMode) {
  return { ...route.query, mode: nextMode }
}

function startGitHub() {
  if (!providers.value.github) {
    error.value = 'GitHub 登录尚未配置'
    return
  }
  window.location.assign(oauthLoginURL('github'))
}

async function sendCode() {
  error.value = ''
  info.value = ''
  sending.value = true
  try {
    const result = await requestEmailAuthCode(email.value, isForgot.value ? 'reset' : 'register')
    codeSent.value = true
    developmentCode.value = result.developmentCode || ''
    info.value = developmentCode.value ? `开发环境验证码：${developmentCode.value}` : '验证码已发送，请检查邮箱。'
  } catch (errValue) {
    error.value = errValue?.message || '验证码发送失败'
  } finally {
    sending.value = false
  }
}

function validatePasswords() {
  if (password.value.length < 8) {
    error.value = '密码至少需要 8 位'
    return false
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return false
  }
  return true
}

async function submit() {
  error.value = ''
  info.value = ''
  try {
    if (isLogin.value) {
      await authStore.loginWithPassword({ email: email.value, password: password.value })
      await router.replace(redirectTarget.value).catch(() => {})
      return
    }
    if (!validatePasswords()) return
    if (!codeSent.value || !/^\d{6}$/.test(code.value)) {
      error.value = '请输入六位邮箱验证码'
      return
    }
    if (isRegister.value) {
      await authStore.registerWithEmail({ username: username.value, email: email.value, code: code.value, password: password.value })
      await router.replace(redirectTarget.value).catch(() => {})
      return
    }
    resetting.value = true
    await resetAccountPassword({ email: email.value, code: code.value, password: password.value })
    await router.replace({ name: 'auth', query: { ...route.query, mode: 'login', email: email.value } })
    info.value = '密码已重置，请使用新密码登录。'
  } catch (errValue) {
    error.value = errValue?.message || authStore.error || (isForgot.value ? '密码重置失败' : isRegister.value ? '注册失败' : '登录失败')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <AuthPageShell :kicker="isRegister ? '注册' : isForgot ? '找回密码' : '登录'" :active-mode="isRegister ? 'register' : 'login'" custom-panel>
    <template #panel>
      <article class="auth-panel-card auth-flow-card is-active">
        <nav class="auth-route-nav" aria-label="账号操作">
          <RouterLink :to="{ name: 'auth', query: authQuery('login') }" :class="{ 'is-active': isLogin || isForgot }">登录</RouterLink>
          <RouterLink :to="{ name: 'auth', query: authQuery('register') }" :class="{ 'is-active': isRegister }">注册</RouterLink>
        </nav>

        <div class="auth-panel-head">
          <div class="auth-panel-head__badge" aria-hidden="true">
            <i class="bi" :class="isRegister ? 'bi-person-plus' : isForgot ? 'bi-shield-lock' : 'bi-box-arrow-in-right'"></i>
          </div>
          <div class="auth-panel-head__copy">
            <h2>{{ isRegister ? '创建账号' : isForgot ? '重置密码' : '登录账号' }}</h2>
            <p>{{ isRegister ? '验证邮箱后即可完成注册' : isForgot ? '验证注册邮箱后设置新密码' : '邮箱密码或 GitHub 账号登录' }}</p>
          </div>
        </div>

        <div v-if="error || authStore.error || info" class="auth-panel-alerts" aria-live="polite">
          <p v-if="error || authStore.error" class="auth-notice is-error" role="alert"><i class="bi bi-exclamation-triangle"></i>{{ error || authStore.error }}</p>
          <p v-if="info" class="auth-notice is-info" role="status"><i class="bi bi-check-circle"></i>{{ info }}</p>
        </div>

        <div class="auth-panel-body">
          <form class="auth-form" @submit.prevent="submit">
            <label v-if="isRegister" class="auth-field">
              <span>用户名</span>
              <div class="input-wrap"><i class="bi bi-person"></i><input v-model="username" autocomplete="username" maxlength="64" placeholder="怎么称呼你" required /></div>
            </label>
            <label class="auth-field auth-field-email">
              <span>Gmail / QQ 邮箱</span>
              <div class="input-wrap"><i class="bi bi-envelope"></i><input v-model="email" type="email" autocomplete="email" placeholder="name@gmail.com" required /></div>
            </label>
            <div v-if="!isLogin" class="auth-code-row">
              <label class="auth-field"><span>六位验证码</span><div class="input-wrap"><i class="bi bi-shield-check"></i><input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位验证码" required /></div></label>
              <button class="auth-code-btn" type="button" :disabled="sending" @click="sendCode">{{ sending ? '发送中…' : codeSent ? '重新发送' : '发送验证码' }}</button>
            </div>
            <label class="auth-field">
              <span>{{ isForgot ? '新密码' : '密码' }}</span>
              <div class="input-wrap"><i class="bi bi-lock"></i><input v-model="password" type="password" :autocomplete="isLogin ? 'current-password' : 'new-password'" :placeholder="isLogin ? '密码' : '至少 8 位'" required /></div>
            </label>
            <div v-if="!isLogin" class="password-meter" :data-score="passwordStrength"><span></span><span></span><span></span></div>
            <label v-if="!isLogin" class="auth-field">
              <span>确认密码</span>
              <div class="input-wrap"><i class="bi bi-shield-lock"></i><input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="再输入一次密码" required /></div>
            </label>
            <button v-if="isLogin" class="auth-link-button auth-link-button--right" type="button" @click="router.push({ name: 'auth', query: authQuery('forgot') })">忘记密码？</button>
            <button class="auth-submit" type="submit" :disabled="authStore.isLoading || resetting">
              {{ authStore.isLoading || resetting ? '处理中…' : isRegister ? '创建账号 →' : isForgot ? '重置密码 →' : '登录 →' }}
            </button>
          </form>

          <template v-if="isLogin">
            <div class="auth-divider"><span>或使用第三方账号</span></div>
            <button type="button" class="auth-submit auth-submit--github" :disabled="!providers.github" @click="startGitHub"><i class="bi bi-github"></i>GitHub 登录</button>
          </template>
        </div>

        <footer class="auth-panel-footer auth-mode-footer">
          <template v-if="isLogin">还没有账号？ <RouterLink :to="{ name: 'auth', query: authQuery('register') }">立即注册</RouterLink></template>
          <template v-else>已有账号？ <RouterLink :to="{ name: 'auth', query: authQuery('login') }">返回登录</RouterLink></template>
        </footer>
      </article>
    </template>
  </AuthPageShell>
</template>

<style scoped>
.auth-divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: #78838d; font-size: 12px; }
.auth-divider::before, .auth-divider::after { content: ''; height: 1px; flex: 1; background: rgba(20, 28, 36, .12); }
.auth-link-button { width: 100%; border: 0; background: transparent; color: var(--auth-accent); padding: 6px 0; cursor: pointer; font-weight: 700; }
.auth-link-button--right { text-align: right; }
.auth-submit--github { background: var(--auth-surface, #fff); color: var(--auth-ink, #171717); border: 1px solid rgba(20, 28, 36, .16); }
.password-meter { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: -8px; }
.password-meter span { height: 4px; background: rgba(20, 28, 36, .12); }
.password-meter[data-score='1'] span:first-child,
.password-meter[data-score='2'] span:nth-child(-n+2),
.password-meter[data-score='3'] span { background: var(--auth-accent); }
.auth-mode-footer { text-align: center; }
.auth-mode-footer a { color: var(--auth-accent); font-weight: 800; text-decoration: none; }
</style>
