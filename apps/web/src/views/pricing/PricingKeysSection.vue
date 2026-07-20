<script lang="ts">
import { usePricingPageContext } from './pricingPageContext'
import ApiDocsView from '@/views/ApiDocsView.vue'
import PcDateTimeField from '@/components/pricing/PcDateTimeField.vue'
import PcAnimatedNumber from '@/components/pricing/PcAnimatedNumber.vue'
import PcStatAnimatedValue from '@/components/pricing/PcStatAnimatedValue.vue'
import PcSubscriptionDashboardPanel from '@/components/pricing/PcSubscriptionDashboardPanel.vue'
import PricingKeyDialogs from './PricingKeyDialogs.vue'

export default {
  components: {
    ApiDocsView,
    PcDateTimeField,
    PcAnimatedNumber,
    PcStatAnimatedValue,
    PcSubscriptionDashboardPanel,
    PricingKeyDialogs,
  },
  setup: usePricingPageContext,
}
</script>

<template>
<section class="pc-section pc-keys-section">
  <div v-if="!authStore.isAuthenticated" class="pc-card pc-empty">
    <i class="bi bi-lock"></i>
    <strong>登录后管理充值密钥</strong>
    <p>充值密钥用于按量调用，可设置限额与模型权限。订阅密钥请在「套餐订阅」页管理。</p>
    <RouterLink
      class="pc-btn pc-btn--primary"
      :to="{
        name: 'auth',
        query: { mode: 'login', redirect: '/pricing?section=keys' },
      }"
    >
      去登录
    </RouterLink>
  </div>
  <template v-else>
    <div v-if="accountNewSecret && !accountNewSecretIsSubscription" class="pc-secret">
      <div class="pc-secret-head">
        <i class="bi bi-shield-exclamation"></i>
        <div>
          <strong>请立即保存你的密钥</strong>
          <small>完整密钥只显示这一次，离开页面后无法再次查看。</small>
        </div>
      </div>
      <div class="pc-secret-body">
        <code>{{ accountNewSecret }}</code>
        <div class="pc-secret-actions">
          <button
            type="button"
            class="pc-btn pc-btn--primary"
            @click="copyText(accountNewSecret, '密钥已复制')"
          >
            <i class="bi bi-clipboard"></i>
            复制密钥
          </button>
          <button type="button" class="pc-btn pc-btn--ghost" @click="dismissNewSecret">
            我已保存
          </button>
        </div>
      </div>
    </div>

    <article class="pc-dash-panel pc-keys-board">
      <header class="pc-keys-board__toolbar">
        <button
          type="button"
          class="pc-btn pc-btn--primary"
          :disabled="!canCreateWalletKey"
          @click="openKeyCreateModal"
        >
          <i class="bi bi-plus-lg"></i>
          创建充值密钥
        </button>
        <small v-if="!canCreateWalletKey" class="pc-keys-board__hint">
          充值密钥已达上限（{{ walletKeyLimit }} 个）
        </small>
        <small v-else class="pc-keys-board__hint">
          金额限额下「剩余额度」取日/月剩余与钱包可用中的较小值；次数限额显示剩余次数
        </small>
      </header>

      <div v-if="!filteredApiKeys.length" class="pc-dash-empty">
        <i class="bi bi-key"></i>
        <strong>还没有充值密钥</strong>
        <p>充值美元后，可在此创建充值密钥用于按量调用 API</p>
      </div>

      <div v-else class="pc-keys-board__table-wrap">
        <table class="pc-keys-board__table">
          <thead>
            <tr>
              <th>名称</th>
              <th>日/月/次数限额</th>
              <th class="pc-cell-right">已用</th>
              <th class="pc-cell-right">剩余额度</th>
              <th>模型</th>
              <th>最后使用</th>
              <th class="pc-cell-center">状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="key in filteredApiKeys"
              :key="key.id"
              :class="{
                'is-paused': String(key.status) === 'paused',
                'is-revoked': ['revoked', 'expired'].includes(String(key.status)),
              }"
            >
              <td class="pc-keys-board__name">
                <strong>{{ key.label || '未命名密钥' }}</strong>
                <code>{{ key.keyPrefix }}••••••••</code>
              </td>
              <td class="pc-keys-board__limit pc-num">
                {{ formatKeyLimitCell(key) }}
              </td>
              <td class="pc-num pc-cell-right pc-keys-board__used">
                {{ formatKeyUsedCell(key) }}
              </td>
              <td
                class="pc-num pc-cell-right pc-keys-board__balance"
                :title="formatKeyRemainingTitle(key)"
              >
                {{ formatKeyRemainingCell(key) }}
              </td>
              <td class="pc-keys-board__models">{{ formatKeyModelsCell(key) }}</td>
              <td class="pc-keys-board__time pc-num">
                {{ formatKeyLastUsedCell(key) }}
              </td>
              <td class="pc-keys-board__status">
                <label
                  class="pc-keys-switch"
                  :class="{ 'is-disabled': isKeyToggleDisabled(key) }"
                >
                  <input
                    type="checkbox"
                    :checked="String(key.status || 'active') === 'active'"
                    :disabled="Boolean(keyActionLoading) || isKeyToggleDisabled(key)"
                    @change="togglePlatformKeyStatus(key)"
                  />
                  <span aria-hidden="true"></span>
                </label>
              </td>
              <td class="pc-keys-board__actions-cell">
                <button
                  type="button"
                  class="pc-keys-menu__trigger"
                  aria-label="操作菜单"
                  :disabled="Boolean(keyActionLoading)"
                  @click.stop="toggleKeyMenu(key, $event)"
                >
                  <i class="bi bi-three-dots"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <PricingKeyDialogs />
  </template>
</section>
</template>
