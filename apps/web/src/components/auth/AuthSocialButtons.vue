<script setup>
import { buildOAuthStartUrl } from '@/services/auth'

const props = defineProps({
  providers: { type: Array, default: () => [] },
  redirect: { type: String, default: '/profile' },
  disabled: { type: Boolean, default: false },
})

function startOAuth(provider) {
  if (props.disabled) return
  window.location.href = buildOAuthStartUrl(provider, props.redirect)
}
</script>

<template>
  <div v-if="providers.length" class="auth-social">
    <p class="auth-social__label">或使用第三方账号</p>
    <div class="auth-social__actions">
      <button
        v-if="providers.includes('github')"
        type="button"
        class="auth-social__btn is-github"
        :disabled="disabled"
        @click="startOAuth('github')"
      >
        <i class="bi bi-github"></i>
        GitHub 登录
      </button>
    </div>
  </div>
</template>
