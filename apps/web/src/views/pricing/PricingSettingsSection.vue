<script lang="ts">
import { usePricingPageContext } from './pricingPageContext'
import ApiDocsView from '@/views/ApiDocsView.vue'
import PcDateTimeField from '@/components/pricing/PcDateTimeField.vue'
import PcAnimatedNumber from '@/components/pricing/PcAnimatedNumber.vue'
import PcStatAnimatedValue from '@/components/pricing/PcStatAnimatedValue.vue'
import PcSubscriptionDashboardPanel from '@/components/pricing/PcSubscriptionDashboardPanel.vue'

export default {
  components: {
    ApiDocsView,
    PcDateTimeField,
    PcAnimatedNumber,
    PcStatAnimatedValue,
    PcSubscriptionDashboardPanel,
  },
  setup: usePricingPageContext,
}
</script>

<template>
<section class="pc-section pc-settings">
  <div v-if="!authStore.isAuthenticated" class="pc-settings-empty">
    <i class="bi bi-person-lock"></i>
    <strong>登录后查看账号设置</strong>
    <p>登录后可在此查看资料、API 接入信息与账号安全设置。</p>
    <RouterLink
      class="pc-settings-cta"
      :to="{
        name: 'auth',
        query: { mode: 'login', redirect: '/pricing?section=settings' },
      }"
    >
      去登录
    </RouterLink>
  </div>

  <template v-else>
    <article class="pc-settings-hero">
      <span class="pc-settings-avatar">{{ accountSettingsAvatar }}</span>
      <div class="pc-settings-hero__main">
        <h2>{{ authStore.displayName }}</h2>
        <p>{{ authStore.user?.email || authStore.user?.id }}</p>
      </div>
      <span class="pc-settings-badge">已登录</span>
    </article>

    <div class="pc-settings-split">
      <article class="pc-settings-panel">
        <header class="pc-settings-panel__head">
          <h2>账号资料</h2>
          <p>登录信息与 API 接入地址，可复制用于 SDK 配置。</p>
        </header>
        <div class="pc-settings-rows">
          <div
            v-for="row in accountSettingsInfoRows"
            :key="row.id"
            class="pc-settings-row"
          >
            <div class="pc-settings-row__main">
              <span>{{ row.label }}</span>
              <strong :class="{ 'is-mono': row.mono }">{{ row.value }}</strong>
            </div>
            <button
              v-if="row.copyable"
              type="button"
              class="pc-btn pc-btn--ghost"
              @click="copyText(row.value, `${row.label} 已复制`)"
            >
              <i class="bi bi-clipboard"></i>
              复制
            </button>
          </div>
        </div>
      </article>

      <article class="pc-settings-panel">
        <header class="pc-settings-panel__head">
          <h2>安全与偏好</h2>
          <p>修改密码、客户端偏好或退出当前账号。</p>
        </header>
        <div class="pc-settings-actions">
          <RouterLink
            v-for="item in accountSettingsSecurityActions.filter(
              (entry) => entry.kind === 'route',
            )"
            :key="item.id"
            :to="item.to"
            class="pc-settings-action"
            :class="{ 'is-danger': item.tone === 'danger' }"
          >
            <span class="pc-settings-action__icon"
              ><i class="bi" :class="item.icon"></i
            ></span>
            <span class="pc-settings-action__main">
              <strong>{{ item.label }}</strong>
              <small>{{ item.desc }}</small>
            </span>
            <i class="bi bi-chevron-right"></i>
          </RouterLink>
          <button
            v-for="item in accountSettingsSecurityActions.filter(
              (entry) => entry.kind === 'action',
            )"
            :key="item.id"
            type="button"
            class="pc-settings-action"
            :class="{ 'is-danger': item.tone === 'danger' }"
            :disabled="authStore.isLoading"
            @click="handleAccountSecurityAction(item)"
          >
            <span class="pc-settings-action__icon"
              ><i class="bi" :class="item.icon"></i
            ></span>
            <span class="pc-settings-action__main">
              <strong>{{ item.label }}</strong>
              <small>{{ item.desc }}</small>
            </span>
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>
      </article>
    </div>
  </template>
</section>
</template>
