<script setup>
import LogoutConfirmDialog from '@/components/profile/LogoutConfirmDialog.vue'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { formatMoneyDisplay } from '@/features/pricing/pricingMoney.js'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  balanceUsd: { type: Number, default: 0 },
  balanceLabel: { type: String, default: '创作余额' },
  syncEnabled: { type: Boolean, default: false },
  completeness: { type: Number, default: 0 },
  publicProfilePath: { type: String, default: '' },
  bio: { type: String, default: '' },
})

const emit = defineEmits(['edit', 'open-public'])

const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const isLoggingOut = ref(false)
const showLogoutDialog = ref(false)

const displayName = computed(
  () =>
    authStore.displayName ||
    settingsStore.settings.display_name ||
    settingsStore.settings.username ||
    '创作者',
)
const avatarUrl = computed(() => settingsStore.settings.avatar_url || '/placeholder.svg')
const accountEmail = computed(() => authStore.user?.email || '')
const shortBio = computed(() => {
  const text = String(props.bio || settingsStore.settings.bio || '').trim()
  if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text
  return ''
})
const loginRoute = computed(() => ({
  name: 'auth',
  query: { ...createLoginRedirectQuery('/profile'), mode: 'login' },
}))

function requestLogout() {
  if (isLoggingOut.value) return
  showLogoutDialog.value = true
}

async function confirmLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await authStore.logout()
    showLogoutDialog.value = false
    notificationService.success('已退出登录')
    await router.replace({
      name: 'auth',
      query: { ...createLoginRedirectQuery('/profile'), mode: 'login' },
    })
  } catch (error) {
    notificationService.error(error?.message || '退出登录失败')
  } finally {
    isLoggingOut.value = false
  }
}

function openWallet() {
  router.push({ name: 'pricing', query: { section: 'wallet' } })
}
</script>

<template>
  <div class="profile-identity" data-pf-rail>
    <div class="profile-identity__hero">
      <div class="profile-identity__avatar-wrap">
        <img
          class="profile-identity__avatar"
          :src="avatarUrl"
          alt=""
          @error="($event.target).src = '/placeholder.svg'"
        />
        <span
          class="profile-identity__status"
          :class="{ 'is-online': authStore.isAuthenticated }"
          :title="authStore.isAuthenticated ? '已登录' : '未登录'"
        />
      </div>
      <div class="profile-identity__copy">
        <h2 class="profile-identity__name">{{ displayName }}</h2>
        <p v-if="shortBio" class="profile-identity__bio">{{ shortBio }}</p>
        <p v-else-if="accountEmail" class="profile-identity__email">{{ accountEmail }}</p>
        <p v-else class="profile-identity__email">登录后同步收藏与创作</p>
      </div>
    </div>

    <button type="button" class="profile-identity__wallet" @click="openWallet">
      <span class="profile-identity__wallet-meta">
        <small>{{ balanceLabel }}</small>
        <strong>{{ formatMoneyDisplay(balanceUsd) }}</strong>
      </span>
      <i class="bi bi-chevron-right" aria-hidden="true"></i>
    </button>

    <div class="profile-identity__progress" :aria-label="`资料完成度 ${completeness}%`">
      <div class="profile-identity__progress-meta">
        <span>资料完整度</span>
        <em>{{ completeness }}%</em>
      </div>
      <div class="profile-identity__progress-track">
        <i :style="{ width: `${completeness}%` }"></i>
      </div>
      <span class="profile-identity__sync" :class="{ 'is-on': syncEnabled }">
        <i class="bi" :class="syncEnabled ? 'bi-cloud-check' : 'bi-hdd'"></i>
        {{ syncEnabled ? '云同步开启' : '仅本地数据' }}
      </span>
    </div>

    <div class="profile-identity__actions">
      <button
        type="button"
        class="profile-identity__btn profile-identity__btn--primary"
        @click="emit('edit')"
      >
        编辑资料
      </button>
      <button
        v-if="publicProfilePath"
        type="button"
        class="profile-identity__btn"
        @click="emit('open-public')"
      >
        公开主页
      </button>
      <RouterLink v-else-if="!authStore.isAuthenticated" :to="loginRoute" class="profile-identity__btn">
        登录
      </RouterLink>
      <button
        v-else
        type="button"
        class="profile-identity__btn profile-identity__btn--ghost"
        :disabled="isLoggingOut"
        @click="requestLogout"
      >
        退出
      </button>
    </div>

    <LogoutConfirmDialog
      v-model:open="showLogoutDialog"
      :loading="isLoggingOut"
      @confirm="confirmLogout"
    />
  </div>
</template>
