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
<section class="pc-section pc-referrals">
  <div v-if="!referralProgramConfig.enabled" class="pc-banner pc-banner--warn">
    <div class="pc-banner-text">
      <strong><i class="bi bi-pause-circle"></i> 推荐计划暂未开放</strong>
      <span>管理员关闭推荐奖励后，邀请链接仍可分享，但不会发放美元奖励。</span>
    </div>
  </div>

  <div class="pc-referrals-stats">
    <article
      v-for="card in referralStatsCards"
      :key="card.id"
      class="pc-referrals-stat"
      :class="`is-${card.tone}`"
    >
      <div class="pc-referrals-stat__head">
        <span>{{ card.label }}</span>
        <i class="bi" :class="card.icon"></i>
      </div>
      <PcStatAnimatedValue
        :card="card"
        :enabled="sectionNumbersEnabled && activeSection === 'referrals'"
      />
      <small>{{ card.hint }}</small>
    </article>
  </div>

  <div class="pc-referrals-main">
    <article class="pc-referrals-panel pc-referrals-panel--invite">
      <header class="pc-referrals-panel__head">
        <div>
          <h2>邀请链接</h2>
          <p>
            {{
              referralProgramConfig.description ||
              '分享链接，好友注册并完成首笔订单后获得奖励。'
            }}
          </p>
        </div>
        <span v-if="referralProgramConfig.enabled" class="pc-referrals-badge">
          奖励已启用
        </span>
      </header>

      <div v-if="!authStore.isAuthenticated" class="pc-referrals-empty">
        <i class="bi bi-lock"></i>
        <strong>登录后生成专属邀请链接</strong>
        <p>邀请码与你的账号绑定，登录后即可复制分享。</p>
        <RouterLink
          class="pc-referrals-cta"
          :to="{
            name: 'auth',
            query: { mode: 'login', redirect: '/pricing?section=referrals' },
          }"
        >
          去登录
        </RouterLink>
      </div>
      <div v-else class="pc-referrals-invite-body">
        <div class="pc-referrals-url">
          <span class="pc-referrals-url__label">邀请链接</span>
          <div class="pc-referrals-url__row">
            <code>{{ referralUrl || '暂未配置邀请入口' }}</code>
            <button
              type="button"
              class="pc-referrals-copy"
              :disabled="!referralUrl"
              @click="copyText(referralUrl, '邀请链接已复制')"
            >
              <i class="bi bi-clipboard"></i>
              复制
            </button>
          </div>
        </div>
        <div
          v-if="referralStats.inviteCode"
          class="pc-referrals-url pc-referrals-url--code"
        >
          <span class="pc-referrals-url__label">邀请码</span>
          <div class="pc-referrals-url__row">
            <strong class="pc-num">{{ referralStats.inviteCode }}</strong>
            <button
              type="button"
              class="pc-referrals-copy pc-referrals-copy--ghost"
              @click="copyText(referralStats.inviteCode, '邀请码已复制')"
            >
              复制码
            </button>
          </div>
        </div>
      </div>
    </article>

    <article class="pc-referrals-panel pc-referrals-panel--rules">
      <header class="pc-referrals-panel__head">
        <div>
          <h2>奖励规则</h2>
          <p>与后台结算配置一致，好友首单达标后自动发放。</p>
        </div>
      </header>
      <div
        class="pc-referrals-rules"
        :class="{
          'is-placeholder':
            referralRewardSummary.length === 1 &&
            referralRewardSummary[0]?.id === 'default',
        }"
      >
        <div
          v-for="rule in referralRewardSummary"
          :key="rule.id"
          class="pc-referrals-rule"
        >
          <span class="pc-referrals-rule__icon"
            ><i class="bi" :class="rule.icon"></i
          ></span>
          <div class="pc-referrals-rule__body">
            <span class="pc-referrals-rule__label">{{ rule.label }}</span>
            <strong class="pc-num">{{ rule.value }}</strong>
            <p>{{ rule.hint }}</p>
          </div>
        </div>
      </div>
    </article>
  </div>

  <article class="pc-referrals-flow">
    <header class="pc-referrals-flow__head">
      <h3>如何参与</h3>
      <p>四步完成邀请，奖励美元自动进入钱包。</p>
    </header>
    <ol class="pc-referrals-flow__list">
      <li v-for="(step, index) in referralSteps" :key="step.title">
        <span class="pc-referrals-flow__index">{{ index + 1 }}</span>
        <div class="pc-referrals-flow__copy">
          <strong>{{ step.title }}</strong>
          <p>{{ step.body }}</p>
        </div>
      </li>
    </ol>
  </article>

  <article class="pc-referrals-panel pc-referrals-panel--records">
    <header class="pc-referrals-panel__head">
      <div>
        <h2>推荐记录</h2>
        <p>注册绑定与奖励结算记录。</p>
      </div>
    </header>

    <div v-if="!authStore.isAuthenticated" class="pc-referrals-records-empty">
      <i class="bi bi-lock"></i>
      <strong>登录后查看推荐记录</strong>
    </div>
    <div
      v-else-if="referralsLoading && !referralStats.referrals?.length"
      class="pc-referrals-records-empty"
    >
      <i class="bi bi-arrow-repeat is-spinning"></i>
      <strong>正在加载推荐记录…</strong>
    </div>
    <div
      v-else-if="!referralStats.referrals?.length"
      class="pc-referrals-records-empty"
    >
      <i class="bi bi-person-plus"></i>
      <strong>暂无推荐记录</strong>
      <p>分享邀请链接，好友注册并付费后，记录会出现在下方表格。</p>
    </div>
    <div v-else class="pc-referrals-table-wrap">
      <table class="pc-referrals-table">
        <thead>
          <tr>
            <th>被邀请用户</th>
            <th>状态</th>
            <th class="pc-cell-right">奖励金额</th>
            <th>关联订单</th>
            <th>注册时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in referralStats.referrals" :key="item.id">
            <td>
              <strong>{{ maskReferralUserId(item.referredUserId) }}</strong>
              <small>{{ item.referredUserId }}</small>
            </td>
            <td>
              <span
                class="pc-referrals-pill"
                :class="referralRecordClass(referralRecordView(item).tone)"
              >
                {{ referralRecordView(item).label }}
              </span>
            </td>
            <td class="pc-cell-right pc-num">
              {{
                item.rewardCredits > 0
                  ? formatReferralRewardUsd(item.rewardCredits)
                  : '—'
              }}
            </td>
            <td>
              <span>{{ formatReferralOrderHint(item) }}</span>
            </td>
            <td class="pc-num">{{ formatDate(item.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>
</section>
</template>
