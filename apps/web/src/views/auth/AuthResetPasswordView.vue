<script setup>
import { confirmPasswordReset } from '@/services/auth'
import { getPasswordMeta, validatePassword } from './useAuthPage.js'
import AuthPageShell from './AuthPageShell.vue'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import './auth-page.css'

const route = useRoute()
const router = useRouter()

const token = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const error = ref('')
const isLoading = ref(false)
const passwordMeta = computed(() => getPasswordMeta(newPassword.value))
const confirmPasswordMismatch = computed(
  () => Boolean(confirmPassword.value) && newPassword.value !== confirmPassword.value,
)

onMounted(() => {
  token.value = String(route.query.token || route.query.reset_token || '').trim()
  if (!token.value) {
    error.value = '重置链接无效，请重新申请找回密码'
  }
})

async function submitReset() {
  error.value = ''
  const passwordError = validatePassword(newPassword.value)
  if (passwordError) {
    error.value = passwordError
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  if (!token.value) {
    error.value = '重置链接无效'
    return
  }

  isLoading.value = true
  try {
    await confirmPasswordReset({
      token: token.value,
      newPassword: newPassword.value,
    })
    await router.replace({
      name: 'auth',
      query: { mode: 'login', reset: '1' },
    })
  } catch (err) {
    error.value = err?.message || '密码重置失败'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <AuthPageShell
    kicker="设置新密码"
    title-main="Set new"
    title-accent="password"
    panel-title="重置密码"
    panel-subtitle="通过邮件链接设置新的登录密码"
    panel-icon="bi bi-shield-lock"
    active-mode="forgot"
  >
    <form class="auth-form" @submit.prevent="submitReset">
      <label class="auth-field auth-field-password">
        <span>新密码</span>
        <div class="input-wrap">
          <i class="bi bi-lock input-wrap__icon"></i>
          <input
            v-model="newPassword"
            :type="showNewPassword ? 'text' : 'password'"
            minlength="8"
            required
            placeholder="至少 8 位"
            aria-label="新密码"
          />
          <button type="button" aria-label="切换新密码可见性" @click="showNewPassword = !showNewPassword">
            <i :class="showNewPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
          </button>
        </div>
        <div class="auth-strength" aria-live="polite">
          <div class="auth-strength-track" aria-hidden="true">
            <span
              :class="{ 'is-weak': passwordMeta.score < 2, 'is-strong': passwordMeta.score >= 3 }"
              :style="{ width: `${passwordMeta.percent}%` }"
            ></span>
          </div>
          <small>强度：{{ passwordMeta.label }}</small>
        </div>
      </label>

      <label class="auth-field auth-field-confirm">
        <span>确认新密码</span>
        <div class="input-wrap" :class="{ 'is-error': confirmPasswordMismatch }">
          <i class="bi bi-shield-lock input-wrap__icon"></i>
          <input
            v-model="confirmPassword"
            :type="showConfirmPassword ? 'text' : 'password'"
            minlength="8"
            required
            placeholder="再输入一次"
            aria-label="确认新密码"
          />
          <button
            type="button"
            aria-label="切换确认新密码可见性"
            @click="showConfirmPassword = !showConfirmPassword"
          >
            <i :class="showConfirmPassword ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
          </button>
        </div>
        <p v-if="confirmPasswordMismatch" class="auth-field-hint is-error">两次输入的密码不一致</p>
      </label>

      <button class="auth-submit" type="submit" :disabled="isLoading || !token">
        <span v-if="isLoading" class="auth-spinner"></span>
        <span>{{ isLoading ? '保存中…' : '保存新密码' }}</span>
      </button>
    </form>

    <template #alerts>
      <p v-if="error" class="auth-notice is-error" role="alert">
        <i class="bi bi-exclamation-triangle"></i>
        {{ error }}
      </p>
    </template>

    <template #footer>
      <p class="auth-switch-link">
        <RouterLink :to="{ name: 'auth', query: { mode: 'forgot' } }">重新申请找回密码</RouterLink>
        ·
        <RouterLink :to="{ name: 'auth', query: { mode: 'login' } }">返回登录</RouterLink>
      </p>
    </template>
  </AuthPageShell>
</template>
