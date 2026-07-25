<script setup>
import AuthPageShell from './AuthPageShell.vue'
import { fetchAuthProviders, requestEmailAuthCode } from '@/services/auth'
import { normalizeAuthRedirect } from '@/services/authRedirect'
import { useAuthStore } from '@/stores/auth'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import './auth-page.css'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const providers = ref({ email: true, verificationCode: true })
const username = ref('')
const email = ref(String(route.query.email || ''))
const code = ref('')
const codeSent = ref(false)
const sending = ref(false)
const resendSeconds = ref(0)
const error = ref(String(route.query.error || ''))
const info = ref('')
const developmentCode = ref('')
const redirectTarget = computed(() => normalizeAuthRedirect(route.query.redirect))
const mode = computed(() => (route.query.mode === 'register' ? 'register' : 'login'))
const isLogin = computed(() => mode.value === 'login')
const isRegister = computed(() => mode.value === 'register')
let resendTimer = null

watch(mode, () => {
  code.value = ''
  codeSent.value = false
  resendSeconds.value = 0
  developmentCode.value = ''
  error.value = ''
  info.value = ''
  authStore.error = ''
})

onBeforeUnmount(() => {
  if (resendTimer) window.clearInterval(resendTimer)
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

function startResendCountdown(seconds = 60) {
  if (resendTimer) window.clearInterval(resendTimer)
  resendSeconds.value = seconds
  resendTimer = window.setInterval(() => {
    resendSeconds.value = Math.max(0, resendSeconds.value - 1)
    if (resendSeconds.value === 0) {
      window.clearInterval(resendTimer)
      resendTimer = null
    }
  }, 1000)
}

async function sendCode() {
  if (!providers.value.email) {
    error.value = '邮箱验证码服务暂不可用，请联系管理员'
    return
  }
  error.value = ''
  info.value = ''
  sending.value = true
  try {
    const result = await requestEmailAuthCode(email.value, isLogin.value ? 'login' : 'register')
    codeSent.value = true
    startResendCountdown(result.resendAfter || 60)
    developmentCode.value = result.developmentCode || ''
    info.value = developmentCode.value
      ? `开发环境验证码：${developmentCode.value}`
      : '验证码已发送，请检查邮箱。'
  } catch (errValue) {
    error.value = errValue?.message || '验证码发送失败'
  } finally {
    sending.value = false
  }
}

async function submit() {
  error.value = ''
  info.value = ''
  try {
    if (!/^\d{6}$/.test(code.value)) {
      error.value = '请输入六位邮箱验证码'
      return
    }
    if (isLogin.value) {
      await authStore.loginWithEmailCode({ email: email.value, code: code.value })
      await router.replace(redirectTarget.value).catch(() => {})
      return
    }
    await authStore.registerWithEmail({
      username: username.value,
      email: email.value,
      code: code.value,
    })
    await router.replace(redirectTarget.value).catch(() => {})
  } catch (errValue) {
    error.value =
      errValue?.message || authStore.error || (isRegister.value ? '注册失败' : '登录失败')
  }
}
</script>

<template>
  <AuthPageShell
    :kicker="isRegister ? '注册' : '登录'"
    :active-mode="isRegister ? 'register' : 'login'"
    custom-panel
  >
    <template #panel>
      <article class="auth-panel-card auth-flow-card is-active">
        <nav class="auth-route-nav" aria-label="账号操作">
          <RouterLink
            :to="{ name: 'auth', query: authQuery('login') }"
            :class="{ 'is-active': isLogin }"
            >登录</RouterLink
          >
          <RouterLink
            :to="{ name: 'auth', query: authQuery('register') }"
            :class="{ 'is-active': isRegister }"
            >注册</RouterLink
          >
        </nav>

        <div class="auth-panel-head">
          <div class="auth-panel-head__badge" aria-hidden="true">
            <i class="bi" :class="isRegister ? 'bi-person-plus' : 'bi-box-arrow-in-right'"></i>
          </div>
          <div class="auth-panel-head__copy">
            <h2>{{ isRegister ? '创建账号' : '登录账号' }}</h2>
            <p>{{ isRegister ? '验证邮箱后即可完成注册' : '使用邮箱验证码安全登录' }}</p>
          </div>
        </div>

        <div v-if="error || authStore.error || info" class="auth-panel-alerts" aria-live="polite">
          <p v-if="error || authStore.error" class="auth-notice is-error" role="alert">
            <i class="bi bi-exclamation-triangle"></i>{{ error || authStore.error }}
          </p>
          <p v-if="info" class="auth-notice is-info" role="status">
            <i class="bi bi-check-circle"></i>{{ info }}
          </p>
        </div>

        <div class="auth-panel-body">
          <form class="auth-form" @submit.prevent="submit">
            <label v-if="isRegister" class="auth-field">
              <span>用户名</span>
              <div class="input-wrap">
                <i class="bi bi-person"></i
                ><input
                  v-model="username"
                  autocomplete="username"
                  maxlength="64"
                  placeholder="怎么称呼你"
                  required
                />
              </div>
            </label>
            <label class="auth-field auth-field-email">
              <span>Gmail / QQ 邮箱</span>
              <div class="input-wrap">
                <i class="bi bi-envelope"></i
                ><input
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  placeholder="name@gmail.com"
                  required
                />
              </div>
            </label>
            <div class="auth-code-row">
              <label class="auth-field"
                ><span>六位验证码</span>
                <div class="input-wrap">
                  <i class="bi bi-shield-check"></i
                  ><input
                    v-model="code"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    pattern="[0-9]{6}"
                    placeholder="6 位验证码"
                    required
                  /></div
              ></label>
              <button
                class="auth-code-btn"
                type="button"
                :disabled="sending || resendSeconds > 0 || !providers.email"
                @click="sendCode"
              >
                {{
                  sending
                    ? '发送中…'
                    : resendSeconds > 0
                      ? `${resendSeconds}s 后重发`
                      : codeSent
                        ? '重新发送'
                        : '获取验证码'
                }}
              </button>
            </div>
            <button class="auth-submit" type="submit" :disabled="authStore.isLoading">
              {{ authStore.isLoading ? '处理中…' : isRegister ? '创建账号 →' : '登录 →' }}
            </button>
          </form>
        </div>

        <footer class="auth-panel-footer auth-mode-footer">
          <template v-if="isLogin"
            >还没有账号？
            <RouterLink :to="{ name: 'auth', query: authQuery('register') }"
              >立即注册</RouterLink
            ></template
          >
          <template v-else
            >已有账号？
            <RouterLink :to="{ name: 'auth', query: authQuery('login') }"
              >返回登录</RouterLink
            ></template
          >
        </footer>
      </article>
    </template>
  </AuthPageShell>
</template>

<style scoped>
.auth-mode-footer {
  text-align: center;
}
.auth-mode-footer a {
  color: var(--auth-accent);
  font-weight: 800;
  text-decoration: none;
}
</style>
