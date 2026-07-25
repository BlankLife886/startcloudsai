<script setup>
import AuthPageShell from './AuthPageShell.vue'
import { fetchAuthProviders, requestEmailAuthCode } from '@/services/auth'
import { normalizeAuthRedirect } from '@/services/authRedirect'
import { useAuthStore } from '@/stores/auth'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import './auth-page.css'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const providers = ref({ email: true, verificationCode: true })
const email = ref(String(route.query.email || ''))
const code = ref('')
const codeSent = ref(false)
const sending = ref(false)
const resendSeconds = ref(0)
const error = ref(String(route.query.error || ''))
const info = ref('')
const developmentCode = ref('')
let resendTimer = null

onBeforeUnmount(() => {
  if (resendTimer) window.clearInterval(resendTimer)
})

onMounted(async () => {
  const [providerResult] = await Promise.all([
    fetchAuthProviders().catch(() => null),
    authStore.initAuth({ force: true }).catch(() => null),
  ])
  if (providerResult) providers.value = providerResult
  if (authStore.isAuthenticated) {
    await router.replace(normalizeAuthRedirect(route.query.redirect)).catch(() => {})
  }
})

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
    const result = await requestEmailAuthCode(email.value)
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
  if (!/^\d{6}$/.test(code.value)) {
    error.value = '请输入六位邮箱验证码'
    return
  }
  try {
    await authStore.authenticateWithEmailCode({ email: email.value, code: code.value })
    await router.replace(normalizeAuthRedirect(route.query.redirect)).catch(() => {})
  } catch (errValue) {
    error.value = errValue?.message || authStore.error || '验证失败'
  }
}
</script>

<template>
  <AuthPageShell kicker="账号验证" active-mode="login" :show-mode-nav="false" custom-panel>
    <template #panel>
      <article class="auth-panel-card auth-flow-card is-active">
        <div class="auth-panel-head">
          <div class="auth-panel-head__badge" aria-hidden="true">
            <i class="bi bi-envelope-check"></i>
          </div>
          <div class="auth-panel-head__copy">
            <h2>邮箱验证</h2>
            <p>首次验证将自动创建账号</p>
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
            <label class="auth-field auth-field-email">
              <span>Gmail / QQ 邮箱</span>
              <div class="input-wrap">
                <i class="bi bi-envelope"></i>
                <input
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  placeholder="name@gmail.com"
                  required
                />
              </div>
            </label>
            <div class="auth-code-row">
              <label class="auth-field">
                <span>六位验证码</span>
                <div class="input-wrap">
                  <i class="bi bi-shield-check"></i>
                  <input
                    v-model="code"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    pattern="[0-9]{6}"
                    placeholder="6 位验证码"
                    required
                  />
                </div>
              </label>
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
              {{ authStore.isLoading ? '验证中…' : '继续 →' }}
            </button>
          </form>
        </div>

        <footer class="auth-panel-footer auth-mode-footer">
          支持 Gmail、Googlemail 与 QQ 邮箱
        </footer>
      </article>
    </template>
  </AuthPageShell>
</template>

<style scoped>
.auth-mode-footer {
  text-align: center;
}
</style>
