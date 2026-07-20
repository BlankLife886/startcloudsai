<script setup>
import { defineAsyncComponent } from 'vue'
import PricingPageSkeleton from '@/views/pricing/PricingPageSkeleton.vue'
import { usePricingPage } from './pricing/usePricingPage'

const PricingCheckoutModal = defineAsyncComponent(
  () => import('@/components/pricing/PricingCheckoutModal.vue'),
)
const PricingOverviewSection = defineAsyncComponent(
  () => import('./pricing/PricingOverviewSection.vue'),
)
const PricingModelsSection = defineAsyncComponent(
  () => import('./pricing/PricingModelsSection.vue'),
)
const PricingKeysSection = defineAsyncComponent(() => import('./pricing/PricingKeysSection.vue'))
const PricingUsageSection = defineAsyncComponent(() => import('./pricing/PricingUsageSection.vue'))
const PricingWalletSection = defineAsyncComponent(() => import('./pricing/PricingWalletSection.vue'))
const PricingDocsSection = defineAsyncComponent(() => import('./pricing/PricingDocsSection.vue'))
const PricingReferralsSection = defineAsyncComponent(
  () => import('./pricing/PricingReferralsSection.vue'),
)
const PricingSettingsSection = defineAsyncComponent(
  () => import('./pricing/PricingSettingsSection.vue'),
)
const PricingPlansSection = defineAsyncComponent(() => import('./pricing/PricingPlansSection.vue'))

const {
  PRICING_BRAND,
  resolveSidebarNavBadge,
  authStore,
  balanceDisplay,
  runtimeConfigStore,
  pricingPageRoot,
  activeSection,
  plansLoading,
  pricingModelsLoading,
  consoleBooting,
  sectionSwitchPending,
  resourcesLoading,
  referralsLoading,
  accountSettingsLoading,
  checkoutModalOpen,
  accountError,
  checkoutOrder,
  checkoutOrderView,
  checkoutModalPresentation,
  checkoutModalLoading,
  checkoutModalShowManualConfirm,
  checkoutModalShowContinuePay,
  checkoutModalShowCancel,
  checkoutModalShowRefresh,
  checkoutModalShowTestConfirm,
  settingsLoading,
  pricingSettings,
  mobileNavItems,
  sidebarFooterLinks,
  navGroups,
  sectionTitle,
  sectionSubtitle,
  usage,
  sidebarNavBadges,
  subscriptionPeriod,
  subscriptionSidebarHint,
  currentPlanLabel,
  isPlanUnsubscribed,
  accountSettingsAvatar,
  selectSection,
  loadResources,
  refreshActiveSection,
  confirmOrder,
  confirmAlipayOrder,
  cancelCheckoutOrder,
  handleCheckoutModalClose,
  refreshCheckoutStatus,
  goRecharge,
  goSubscribe,
} = usePricingPage()
</script>

<template>
  <main
    ref="pricingPageRoot"
    class="pricing-page"
    :class="{
      'pricing-page--booting': consoleBooting,
      'pricing-page--section-pending': sectionSwitchPending,
    }"
    :aria-busy="consoleBooting"
    aria-live="polite"
  >
    <Transition name="pc-boot">
      <PricingPageSkeleton v-if="consoleBooting" key="boot-skeleton" />
      <div v-else key="boot-content" class="pc-shell">
        <aside class="pc-sidebar">
          <div class="pc-sidebar__surface">
            <div class="pc-sidenav__head">
              <div v-if="authStore.isAuthenticated" class="pc-sidenav-user">
                <div class="pc-sidenav-user__main">
                  <span class="pc-sidenav-user__avatar" aria-hidden="true">{{
                    accountSettingsAvatar
                  }}</span>
                  <div class="pc-sidenav-user__copy">
                    <strong class="pc-sidenav-user__name">{{ authStore.displayName }}</strong>
                    <div
                      v-if="
                        subscriptionPeriod.isActive ||
                        (currentPlanLabel !== '未订阅' && !isPlanUnsubscribed)
                      "
                      class="pc-sidenav-user__line"
                    >
                      <template v-if="subscriptionPeriod.isActive">
                        <span class="pc-sidenav-user__status is-active">{{
                          currentPlanLabel
                        }}</span>
                        <span
                          v-if="subscriptionSidebarHint"
                          class="pc-sidenav-user__dot"
                          aria-hidden="true"
                          >·</span
                        >
                        <small v-if="subscriptionSidebarHint" class="pc-sidenav-user__period">
                          {{ subscriptionSidebarHint }}
                        </small>
                      </template>
                      <span
                        v-else-if="currentPlanLabel !== '未订阅'"
                        class="pc-sidenav-user__status"
                      >
                        {{ currentPlanLabel }}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  v-if="isPlanUnsubscribed"
                  type="button"
                  class="pc-sidenav-user__subscribe"
                  @click="goSubscribe"
                >
                  {{ currentPlanLabel !== '未订阅' ? '续订' : '去订阅' }}
                  <i class="bi bi-chevron-right" aria-hidden="true"></i>
                </button>
              </div>

              <div v-if="authStore.isAuthenticated" class="pc-sidenav-wallet">
                <div class="pc-sidenav-wallet__balance">
                  <span class="pc-sidenav-wallet__label">{{ PRICING_BRAND.balanceLabel }}</span>
                  <strong class="pc-sidenav-wallet__amount pc-num">{{ balanceDisplay }}</strong>
                </div>
                <button
                  v-if="PRICING_BRAND.rechargeLabel || pricingSettings.wallet?.rechargeUrl"
                  type="button"
                  class="pc-sidenav-wallet__recharge"
                  @click="goRecharge"
                >
                  <span class="pc-sidenav-wallet__recharge-shine" aria-hidden="true"></span>
                  <span class="pc-sidenav-wallet__recharge-content">
                    <span class="pc-sidenav-wallet__recharge-label">{{
                      PRICING_BRAND.rechargeLabel
                    }}</span>
                    <span class="pc-sidenav-wallet__recharge-trail" aria-hidden="true">
                      <svg
                        class="pc-sidenav-wallet__recharge-arrows"
                        viewBox="0 0 66 43"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          class="pc-sidenav-wallet__recharge-chev pc-sidenav-wallet__recharge-chev--one"
                          d="M40.1543933,3.89485454 L43.9763149,0.139296592 C44.1708311,-0.0518420739 44.4826329,-0.0518571125 44.6771675,0.139262789 L65.6916134,20.7848311 C66.0855801,21.1718824 66.0911863,21.8050225 65.704135,22.1989893 C65.7000188,22.2031791 65.6958657,22.2073326 65.6916762,22.2114492 L44.677098,42.8607841 C44.4825957,43.0519059 44.1708242,43.0519358 43.9762853,42.8608513 L40.1545186,39.1069479 C39.9575152,38.9134427 39.9546793,38.5968729 40.1481845,38.3998695 C40.1502893,38.3977268 40.1524132,38.395603 40.1545562,38.3934985 L56.9937789,21.8567812 C57.1908028,21.6632968 57.193672,21.3467273 57.0001876,21.1497035 C56.9980647,21.1475418 56.9959223,21.1453995 56.9937605,21.1432767 L40.1545208,4.60825197 C39.9574869,4.41477773 39.9546013,4.09820839 40.1480756,3.90117456 C40.1501626,3.89904911 40.1522686,3.89694235 40.1543933,3.89485454 Z"
                          fill="currentColor"
                        />
                        <path
                          class="pc-sidenav-wallet__recharge-chev pc-sidenav-wallet__recharge-chev--two"
                          d="M20.1543933,3.89485454 L23.9763149,0.139296592 C24.1708311,-0.0518420739 24.4826329,-0.0518571125 24.6771675,0.139262789 L45.6916134,20.7848311 C46.0855801,21.1718824 46.0911863,21.8050225 45.704135,22.1989893 C45.7000188,22.2031791 45.6958657,22.2073326 45.6916762,22.2114492 L24.677098,42.8607841 C24.4825957,43.0519059 24.1708242,43.0519358 23.9762853,42.8608513 L20.1545186,39.1069479 C19.9575152,38.9134427 19.9546793,38.5968729 20.1481845,38.3998695 C20.1502893,38.3977268 20.1524132,38.395603 20.1545562,38.3934985 L36.9937789,21.8567812 C37.1908028,21.6632968 37.193672,21.3467273 37.0001876,21.1497035 C36.9980647,21.1475418 36.9959223,21.1453995 36.9937605,21.1432767 L20.1545208,4.60825197 C19.9574869,4.41477773 19.9546013,4.09820839 20.1480756,3.90117456 C20.1501626,3.89904911 20.1522686,3.89694235 20.1543933,3.89485454 Z"
                          fill="currentColor"
                        />
                        <path
                          class="pc-sidenav-wallet__recharge-chev pc-sidenav-wallet__recharge-chev--three"
                          d="M0.154393339,3.89485454 L3.97631488,0.139296592 C4.17083111,-0.0518420739 4.48263286,-0.0518571125 4.67716753,0.139262789 L25.6916134,20.7848311 C26.0855801,21.1718824 26.0911863,21.8050225 25.704135,22.1989893 C25.7000188,22.2031791 25.6958657,22.2073326 25.6916762,22.2114492 L4.67709797,42.8607841 C4.48259567,43.0519059 4.17082418,43.0519358 3.97628526,42.8608513 L0.154518591,39.1069479 C-0.0424848215,38.9134427 -0.0453206733,38.5968729 0.148184538,38.3998695 C0.150289256,38.3977268 0.152413239,38.395603 0.154556228,38.3934985 L16.9937789,21.8567812 C17.1908028,21.6632968 17.193672,21.3467273 17.0001876,21.1497035 C16.9980647,21.1475418 16.9959223,21.1453995 16.9937605,21.1432767 L0.15452076,4.60825197 C-0.0425130651,4.41477773 -0.0453986756,4.09820839 0.148075568,3.90117456 C0.150162624,3.89904911 0.152268631,3.89694235 0.154393339,3.89485454 Z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                  </span>
                </button>
              </div>
            </div>

            <nav class="pc-sidenav__nav" aria-label="价格控制台">
              <div v-for="group in navGroups" :key="group.id" class="pc-sidenav-group">
                <span class="pc-sidenav-group__label">{{ group.label }}</span>
                <div class="pc-sidenav-group__items">
                  <template v-for="item in group.items" :key="item.id">
                    <RouterLink v-if="item.href" :to="item.href" class="pc-sidenav-link">
                      <span class="pc-sidenav-link__icon"
                        ><i class="bi" :class="item.icon"></i
                      ></span>
                      <span class="pc-sidenav-link__label">{{ item.label }}</span>
                    </RouterLink>
                    <button
                      v-else
                      type="button"
                      class="pc-sidenav-link"
                      :class="{ 'is-active': activeSection === item.id }"
                      @click="selectSection(item.id)"
                    >
                      <span class="pc-sidenav-link__icon"
                        ><i class="bi" :class="item.icon"></i
                      ></span>
                      <span class="pc-sidenav-link__label">{{ item.label }}</span>
                      <span
                        v-if="resolveSidebarNavBadge(item.id, sidebarNavBadges)"
                        class="pc-sidenav-link__badge"
                      >
                        {{ resolveSidebarNavBadge(item.id, sidebarNavBadges) }}
                      </span>
                    </button>
                  </template>
                </div>
              </div>
            </nav>

            <div class="pc-sidenav__foot">
              <template v-for="link in sidebarFooterLinks" :key="link.id">
                <button
                  type="button"
                  class="pc-sidenav-foot-link"
                  :class="{ 'is-active': activeSection === link.id }"
                  @click="selectSection(link.id)"
                >
                  <i class="bi" :class="link.icon"></i>
                  <span>{{ link.label }}</span>
                </button>
              </template>

              <RouterLink
                v-if="!authStore.isAuthenticated"
                :to="{ name: 'auth', query: { mode: 'login', redirect: '/pricing' } }"
                class="pc-sidenav-login"
              >
                <i class="bi bi-box-arrow-in-right"></i>
                登录账号
              </RouterLink>
            </div>
          </div>
        </aside>

        <section class="pc-main">
          <div class="pc-main__surface">
            <nav class="pc-mobile-nav" aria-label="价格控制台分区">
              <template v-for="item in mobileNavItems" :key="item.id">
                <RouterLink v-if="item.href" :to="item.href" class="pc-mobile-nav-link">
                  <i class="bi" :class="item.icon"></i>
                  <span>{{ item.shortLabel || item.label }}</span>
                </RouterLink>
                <button
                  v-else
                  type="button"
                  :class="{ active: activeSection === item.id }"
                  @click="selectSection(item.id)"
                >
                  <i class="bi" :class="item.icon"></i>
                  <span>{{ item.shortLabel || item.label }}</span>
                </button>
              </template>
            </nav>

            <div v-if="accountError" class="pc-banner pc-banner--error">
              <div class="pc-banner-text">
                <strong><i class="bi bi-exclamation-triangle"></i> {{ accountError }}</strong>
              </div>
              <div class="pc-banner-actions">
                <button type="button" class="pc-btn pc-btn--ghost" @click="loadResources()">
                  重试
                </button>
              </div>
            </div>

            <header class="pc-section-head">
              <div class="pc-section-heading">
                <h1>{{ sectionTitle }}</h1>
                <p v-if="sectionSubtitle">{{ sectionSubtitle }}</p>
              </div>
              <div class="pc-section-actions">
                <button
                  type="button"
                  class="pc-btn pc-btn--ghost"
                  :disabled="
                    runtimeConfigStore.isLoading ||
                    pricingModelsLoading ||
                    resourcesLoading ||
                    settingsLoading ||
                    plansLoading ||
                    accountSettingsLoading ||
                    referralsLoading
                  "
                  @click="refreshActiveSection"
                >
                  <i
                    class="bi bi-arrow-clockwise"
                    :class="{
                      spin:
                        runtimeConfigStore.isLoading ||
                        pricingModelsLoading ||
                        resourcesLoading ||
                        settingsLoading ||
                        plansLoading ||
                        accountSettingsLoading ||
                        referralsLoading,
                    }"
                  ></i>
                  刷新
                </button>
              </div>
            </header>
            <PricingOverviewSection v-if="activeSection === 'overview'" />

            <PricingModelsSection v-else-if="activeSection === 'models'" />

            <PricingKeysSection v-else-if="activeSection === 'keys'" />
            <PricingUsageSection v-else-if="activeSection === 'usage'" />

            <PricingWalletSection v-else-if="activeSection === 'wallet'" />

            <PricingDocsSection v-else-if="activeSection === 'docs'" />

            <PricingReferralsSection v-else-if="activeSection === 'referrals'" />

            <PricingSettingsSection v-else-if="activeSection === 'settings'" />

            <PricingPlansSection v-else-if="activeSection === 'plans'" />
          </div>
        </section>
      </div>
    </Transition>
  </main>

  <PricingCheckoutModal
    :open="checkoutModalOpen"
    :presentation="checkoutModalPresentation"
    :loading="checkoutModalLoading"
    :checkout-url="checkoutOrder?.checkoutUrl || ''"
    :provider-label="checkoutOrderView?.providerLabel || '支付宝'"
    :show-manual-confirm="checkoutModalShowManualConfirm"
    :show-continue-pay="checkoutModalShowContinuePay"
    :show-refresh="checkoutModalShowRefresh"
    :show-test-confirm="checkoutModalShowTestConfirm"
    :show-cancel-order="checkoutModalShowCancel"
    @close="handleCheckoutModalClose"
    @confirm-paid="confirmAlipayOrder()"
    @refresh="refreshCheckoutStatus"
    @confirm-test="confirmOrder(checkoutOrder)"
    @cancel-order="cancelCheckoutOrder"
  />
</template>
