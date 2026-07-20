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
<section class="pc-section pc-wallet">
  <div
    ref="walletTabsRef"
    class="pc-wallet-tabs"
    :class="{ 'is-indicator-ready': walletTabIndicatorReady }"
    role="tablist"
    aria-label="钱包分区"
  >
    <span
      class="pc-wallet-tabs__indicator"
      aria-hidden="true"
      :style="walletTabIndicatorStyle"
    ></span>
    <button
      type="button"
      role="tab"
      :ref="(el) => setWalletTabButtonRef('recharge', el)"
      class="pc-wallet-tabs__btn"
      :class="{ 'is-active': walletPanelTab === 'recharge' }"
      :aria-selected="walletPanelTab === 'recharge'"
      @click="selectWalletPanelTab('recharge')"
    >
      在线充值
    </button>
    <button
      type="button"
      role="tab"
      :ref="(el) => setWalletTabButtonRef('redeem', el)"
      class="pc-wallet-tabs__btn"
      :class="{ 'is-active': walletPanelTab === 'redeem' }"
      :aria-selected="walletPanelTab === 'redeem'"
      @click="selectWalletPanelTab('redeem')"
    >
      兑换码
    </button>
    <button
      type="button"
      role="tab"
      :ref="(el) => setWalletTabButtonRef('exchange', el)"
      class="pc-wallet-tabs__btn"
      :class="{ 'is-active': walletPanelTab === 'exchange' }"
      :aria-selected="walletPanelTab === 'exchange'"
      @click="selectWalletPanelTab('exchange')"
    >
      兑换积分
    </button>
    <button
      type="button"
      role="tab"
      :ref="(el) => setWalletTabButtonRef('history', el)"
      class="pc-wallet-tabs__btn"
      :class="{ 'is-active': walletPanelTab === 'history' }"
      :aria-selected="walletPanelTab === 'history'"
      @click="selectWalletPanelTab('history')"
    >
      交易记录
    </button>
  </div>

  <Transition name="pc-wallet-panel" mode="out-in">
    <div v-if="walletPanelTab === 'recharge'" key="recharge" class="pc-wallet-layout">
      <div class="pc-wallet-main">
        <div v-if="rechargeAmountOptions.length" class="pc-wallet-amount-grid">
          <button
            v-for="option in rechargeAmountOptions"
            :key="option.amount"
            type="button"
            class="pc-wallet-amount-card"
            :class="{
              'is-active':
                !isCustomRechargeSelected && selectedRechargeAmount === option.amount,
              'is-pending': !option.ready,
            }"
            :style="walletCardBgStyle"
            :aria-pressed="
              !isCustomRechargeSelected && selectedRechargeAmount === option.amount
            "
            @click="selectRechargeAmount(option.amount)"
          >
            <div class="pc-wallet-amount-card__body">
              <div class="pc-wallet-amount-card__headline">
                <img
                  class="pc-wallet-amount-card__mark"
                  :src="walletRechargeIconWallet"
                  alt=""
                />
                <span class="pc-wallet-amount-card__eyebrow">充值档位</span>
              </div>
              <div class="pc-wallet-amount-card__price">
                <span class="pc-num pc-wallet-amount-card__amount"
                  >${{ option.amount }}</span
                >
              </div>
            </div>

            <div class="pc-wallet-amount-card__dock">
              <div class="pc-wallet-amount-card__metric">
                <img
                  class="pc-wallet-amount-card__metric-mark is-pay"
                  :src="walletRechargeIconCheck"
                  alt=""
                />
                <div class="pc-wallet-amount-card__metric-text">
                  <span class="pc-wallet-amount-card__metric-label">支付</span>
                  <strong class="pc-num pc-wallet-amount-card__metric-value is-accent">
                    ${{ option.amount }}
                  </strong>
                </div>
              </div>
              <span
                class="pc-wallet-amount-card__dock-divider"
                aria-hidden="true"
              ></span>
              <div
                class="pc-wallet-amount-card__metric is-receive"
                :class="{ 'is-unconfigured': !option.ready }"
              >
                <img
                  class="pc-wallet-amount-card__metric-mark is-receive"
                  :src="walletRechargeIconClock"
                  alt=""
                />
                <div class="pc-wallet-amount-card__metric-text">
                  <span class="pc-wallet-amount-card__metric-label">到账</span>
                  <strong class="pc-num pc-wallet-amount-card__metric-value">
                    {{ formatRechargeReceiveLabel(option) }}
                  </strong>
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            class="pc-wallet-amount-card pc-wallet-amount-card--custom"
            :class="{ 'is-active': isCustomRechargeSelected }"
            :style="walletCardBgStyle"
            :aria-pressed="isCustomRechargeSelected"
            @click="openWalletCustomModal"
          >
            <div class="pc-wallet-amount-card__body">
              <div class="pc-wallet-amount-card__headline">
                <img
                  class="pc-wallet-amount-card__mark"
                  :src="walletRechargeIconWallet"
                  alt=""
                />
                <span class="pc-wallet-amount-card__eyebrow">自定义</span>
              </div>
              <div class="pc-wallet-amount-card__price">
                <span
                  v-if="isCustomRechargeSelected"
                  class="pc-num pc-wallet-amount-card__amount"
                >
                  {{ selectedRechargeAmount }}
                </span>
                <span v-else class="pc-wallet-amount-card__custom-title">任意金额</span>
              </div>
            </div>

            <div class="pc-wallet-amount-card__dock">
              <div class="pc-wallet-amount-card__metric is-wide">
                <img
                  class="pc-wallet-amount-card__metric-mark is-receive"
                  :src="walletRechargeIconClock"
                  alt=""
                />
                <div class="pc-wallet-amount-card__metric-text">
                  <span class="pc-wallet-amount-card__metric-label">
                    {{ isCustomRechargeSelected ? '支付' : '说明' }}
                  </span>
                  <strong
                    class="pc-num pc-wallet-amount-card__metric-value"
                    :class="{ 'is-accent': isCustomRechargeSelected }"
                  >
                    {{
                      isCustomRechargeSelected
                        ? `$${selectedRechargeAmount}`
                        : '输入任意 USD 金额'
                    }}
                  </strong>
                </div>
              </div>
            </div>
          </button>
        </div>

        <div v-else class="pc-wallet-empty">
          <i class="bi bi-credit-card"></i>
          <strong>暂无充值入口</strong>
          <p>请联系管理员配置充值档位。</p>
        </div>

        <div v-if="orphanTopupPlans.length" class="pc-wallet-orphan">
          <p class="pc-wallet-orphan__label">其他档位</p>
          <div class="pc-wallet-amount-grid pc-wallet-amount-grid--compact">
            <button
              v-for="item in orphanTopupPlans"
              :key="item.key"
              type="button"
              class="pc-wallet-amount-card pc-wallet-amount-card--compact"
              :disabled="checkoutLoading === item.key"
              @click="purchasePlan(item.plan)"
            >
              <div class="pc-wallet-amount-card__head">
                <span class="pc-wallet-amount-card__eyebrow">充值</span>
                <div class="pc-wallet-amount-card__price">
                  <sup class="pc-wallet-amount-card__currency">$</sup>
                  <span class="pc-num">{{ item.price.amount.replace(/^\$/, '') }}</span>
                </div>
              </div>
              <ul class="pc-wallet-amount-card__details">
                <li class="is-receive">
                  <i class="bi bi-check2" aria-hidden="true"></i>
                  <span>
                    到账 <strong class="pc-num">{{ item.price.amount }}</strong>
                  </span>
                </li>
              </ul>
            </button>
          </div>
        </div>
      </div>

      <aside class="pc-wallet-summary">
        <dl class="pc-wallet-summary__rows">
          <div class="pc-wallet-summary__row">
            <dt>充值金额</dt>
            <dd class="pc-num">
              {{ selectedRechargeAmount ? `$${selectedRechargeAmount}` : '—' }}
            </dd>
          </div>
          <div
            v-if="selectedCheckoutProvider === 'alipay' && selectedAlipayPayEstimate"
            class="pc-wallet-summary__row"
          >
            <dt>支付宝支付</dt>
            <dd class="pc-num">{{ selectedAlipayPayEstimate }}</dd>
          </div>
          <div class="pc-wallet-summary__row is-total">
            <dt>到账总计</dt>
            <dd class="pc-num">
              {{
                selectedRechargeAmount
                  ? formatMoneyDisplay(selectedRechargeAmount)
                  : '—'
              }}
            </dd>
          </div>
        </dl>

        <p v-if="alipayFxHint" class="pc-wallet-summary__fx">
          {{ alipayFxHint }}
        </p>
        <p v-if="selectedRechargeHint" class="pc-wallet-summary__warn">
          {{ selectedRechargeHint }}
        </p>

        <div class="pc-wallet-summary__pay">
          <span class="pc-wallet-summary__pay-label">支付方式</span>
          <div class="pc-wallet-pay-methods">
            <button
              v-for="item in checkoutProviderOptions"
              :key="item.id"
              type="button"
              class="pc-wallet-pay-method"
              :class="{
                'is-active': selectedCheckoutProvider === item.id,
                'is-unconfigured': !item.configured,
                'is-alipay': item.id === 'alipay',
              }"
              :title="item.configured ? item.label : `${item.label}（未配置）`"
              @click="selectCheckoutProvider(item.id)"
            >
              <i class="bi" :class="item.icon"></i>
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          class="pc-wallet-summary__cta"
          :class="{ 'is-alipay': selectedCheckoutProvider === 'alipay' }"
          :disabled="!canSubmitRecharge || Boolean(checkoutLoading)"
          @click="rechargeWallet"
        >
          {{
            checkoutLoading
              ? '处理中…'
              : selectedRechargeAmount
                ? selectedCheckoutProvider === 'alipay'
                  ? `支付宝充值 $${selectedRechargeAmount} →`
                  : `充值 $${selectedRechargeAmount} →`
                : '请选择充值金额'
          }}
        </button>

        <p class="pc-wallet-summary__legal">
          支付受 SSL 加密保护。继续即表示同意服务条款。
        </p>
      </aside>
    </div>

    <div v-else-if="walletPanelTab === 'redeem'" key="redeem" class="pc-wallet-redeem">
      <div v-if="!authStore.isAuthenticated" class="pc-wallet-redeem__card">
        <header class="pc-wallet-redeem__head">
          <i class="bi bi-ticket-perforated" aria-hidden="true"></i>
          <div>
            <h3>兑换码</h3>
            <p>兑换码仅限登录用户使用。请先登录后再兑换。</p>
          </div>
        </header>
        <RouterLink
          class="pc-wallet-redeem__cta"
          :to="{
            name: 'auth',
            query: { mode: 'login', redirect: '/pricing?section=wallet' },
          }"
        >
          登录后兑换
        </RouterLink>
      </div>
      <div v-else class="pc-wallet-redeem__card">
        <header class="pc-wallet-redeem__head">
          <i class="bi bi-ticket-perforated" aria-hidden="true"></i>
          <div>
            <h3>兑换码</h3>
            <p>
              输入兑换码后，美元会立即入账钱包，可用于 API 调用。兑换码面额以 USD 为准。
            </p>
          </div>
        </header>
        <div v-if="walletRedeemSuccess" class="pc-wallet-redeem__success">
          <i class="bi bi-check-circle-fill" aria-hidden="true"></i>
          <div>
            <strong>兑换成功</strong>
            <p>
              本次到账
              <span class="pc-num">{{
                formatMoneyDisplay(walletRedeemSuccess.amountUsd)
              }}</span
              >， 左侧可用余额已更新。
              <button
                type="button"
                class="pc-wallet-redeem__history-link"
                @click="selectWalletPanelTab('history')"
              >
                查看流水
              </button>
            </p>
          </div>
        </div>
        <label class="pc-wallet-redeem__field" for="pc-wallet-redeem-input">
          <span>兑换码</span>
          <input
            id="pc-wallet-redeem-input"
            v-model="walletRedeemDraft"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder=""
            :disabled="walletRedeemLoading"
            @input="walletRedeemSuccess = null"
            @keydown.enter.prevent="redeemWalletCode"
          />
        </label>
        <button
          type="button"
          class="pc-wallet-redeem__cta"
          :disabled="walletRedeemLoading || !String(walletRedeemDraft || '').trim()"
          @click="redeemWalletCode"
        >
          {{ walletRedeemLoading ? '兑换中…' : '立即兑换' }}
        </button>
        <p class="pc-wallet-redeem__note">
          每个兑换码仅可使用一次。兑换成功后码立即失效。
        </p>
      </div>
    </div>

    <div
      v-else-if="walletPanelTab === 'exchange'"
      key="exchange"
      class="pc-wallet-redeem"
    >
      <div v-if="!authStore.isAuthenticated" class="pc-wallet-redeem__card">
        <header class="pc-wallet-redeem__head">
          <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
          <div>
            <h3>兑换壁纸积分</h3>
            <p>将美元余额兑换为壁纸积分，仅用于壁纸相关功能。请先登录。</p>
          </div>
        </header>
        <RouterLink
          class="pc-wallet-redeem__cta"
          :to="{
            name: 'auth',
            query: { mode: 'login', redirect: '/pricing?section=wallet' },
          }"
        >
          登录后兑换
        </RouterLink>
      </div>
      <div v-else class="pc-wallet-redeem__card">
        <header class="pc-wallet-redeem__head">
          <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
          <div>
            <h3>兑换壁纸积分</h3>
            <p>
              从左侧可用余额扣除相应金额，兑换壁纸积分。当前汇率
              <strong>$1 = {{ walletExchangeCreditsPerUsd }} 积分</strong>，已有壁纸积分
              <strong class="pc-num">{{ formatCredits(wallpaperCredits) }}</strong
              >。
            </p>
          </div>
        </header>
        <label class="pc-wallet-redeem__field" for="pc-wallet-exchange-input">
          <span>兑换金额 (USD)</span>
          <input
            id="pc-wallet-exchange-input"
            v-model="walletExchangeDraft"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            spellcheck="false"
            placeholder="例如 1.00"
            :disabled="walletExchangeLoading"
            @keydown.enter.prevent="exchangeWalletUsd"
          />
        </label>
        <p v-if="walletExchangePreviewCredits > 0" class="pc-wallet-redeem__preview">
          <span class="pc-wallet-redeem__preview-label">预计到账</span>
          <strong class="pc-num">{{
            formatCredits(walletExchangePreviewCredits)
          }}</strong>
          <span class="pc-wallet-redeem__preview-unit">壁纸积分</span>
        </p>
        <button
          type="button"
          class="pc-wallet-redeem__cta"
          :disabled="
            walletExchangeLoading ||
            !String(walletExchangeDraft || '').trim() ||
            walletExchangePreviewCredits <= 0
          "
          @click="exchangeWalletUsd"
        >
          {{ walletExchangeLoading ? '兑换中…' : '立即兑换' }}
        </button>
        <p class="pc-wallet-redeem__note">
          壁纸积分与 API 美元余额独立；兑换后不可撤销。
        </p>
      </div>
    </div>

    <div
      v-else-if="walletPanelTab === 'history'"
      key="history"
      class="pc-wallet-history"
    >
      <header class="pc-wallet-history__head">
        <p class="pc-wallet-reconcile">
          此处仅展示充值、兑换等钱包流水；API 调用扣费明细见「用量」。
          <template v-if="walletReconcileSummary.frozen > 0">
            当前有
            <strong class="pc-num">{{
              formatMoneyDisplay(walletReconcileSummary.frozen)
            }}</strong>
            预冻结，左侧可用余额已扣除该部分。
          </template>
        </p>
      </header>
      <div
        v-if="!walletHistoryTimeline.length && !creditLedgerRows.length"
        class="pc-wallet-empty"
      >
        <i class="bi bi-receipt"></i>
        <strong>暂无流水</strong>
        <p>充值到账、兑换码入账等钱包变动会显示在这里。API 调用明细请查看「用量」。</p>
      </div>
      <ul v-if="walletHistoryTimeline.length" class="pc-wallet-history__list">
        <li v-for="entry in walletHistoryTimeline.slice(0, 80)" :key="entry.id">
          <template v-if="entry.kind === 'recharge_order'">
            <div class="pc-wallet-history__main">
              <strong>{{ entry.row.display.title }}</strong>
              <small>
                {{ entry.row.display.createdAtLabel }}
                <template v-if="entry.row.display.payAmountLabel">
                  · 支付宝 {{ entry.row.display.payAmountLabel }}
                </template>
                · {{ entry.row.display.providerLabel }} ·
                {{ entry.row.display.statusLabel }} · {{ entry.row.display.id }}
              </small>
            </div>
            <div class="pc-wallet-history__actions">
              <button
                v-if="
                  entry.row.display.isPayable &&
                  entry.row.order.checkoutProvider === 'alipay'
                "
                type="button"
                class="pc-btn pc-btn--primary pc-btn--compact"
                :disabled="Boolean(checkoutLoading)"
                @click="openCheckoutOrderStatus(entry.row.order)"
              >
                继续支付
              </button>
              <span
                v-else
                class="pc-wallet-history__amount pc-num pc-wallet-history__status"
              >
                {{ entry.row.display.statusLabel }}
              </span>
            </div>
          </template>
          <template v-else>
            <div class="pc-wallet-history__main">
              <strong>{{ resolveUsdLedgerRowTitle(entry.row) }}</strong>
              <small
                >{{ formatDate(entry.row.createdAt) }} ·
                {{ ledgerSourceTypeLabel(entry.row.sourceType) }}</small
              >
            </div>
            <div
              class="pc-wallet-history__amount pc-num"
              :class="{ 'is-spend': isLedgerSpend(entry.row.direction) }"
            >
              {{ isLedgerSpend(entry.row.direction) ? '-' : '+'
              }}{{ formatMoneyDisplay(entry.row.amount) }}
            </div>
          </template>
        </li>
      </ul>
      <template v-if="creditLedgerRows.length">
        <header class="pc-wallet-history__section">
          <h3>壁纸积分流水</h3>
        </header>
        <ul class="pc-wallet-history__list">
          <li v-for="row in creditLedgerRows.slice(0, 20)" :key="`credit-${row.id}`">
            <div class="pc-wallet-history__main">
              <strong>{{ row.reason || ledgerDirectionLabel(row.direction) }}</strong>
              <small
                >{{ formatDate(row.createdAt) }} ·
                {{ ledgerSourceTypeLabel(row.sourceType) }}</small
              >
            </div>
            <div
              class="pc-wallet-history__amount pc-num"
              :class="{ 'is-spend': isLedgerSpend(row.direction) }"
            >
              {{ isLedgerSpend(row.direction) ? '-' : '+'
              }}{{ formatCredits(row.amount) }} 积分
            </div>
          </li>
        </ul>
      </template>
    </div>
  </Transition>

  <Teleport to="body">
    <div
      v-if="walletCustomModalOpen"
      class="pc-pricing-modal-root pc-keys-modal-backdrop"
      @click.self="closeWalletCustomModal"
    >
      <div
        class="pc-keys-modal pc-keys-modal--compact pc-wallet-custom-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-wallet-custom-modal-title"
        @keydown.esc.stop="closeWalletCustomModal"
      >
        <header class="pc-keys-modal__head">
          <h2 id="pc-wallet-custom-modal-title">自定义充值金额</h2>
          <button
            type="button"
            class="pc-keys-modal__close"
            @click="closeWalletCustomModal"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
            <span class="visually-hidden">关闭</span>
          </button>
        </header>
        <div class="pc-keys-modal__body">
          <label class="pc-keys-modal__field" for="pc-wallet-custom-amount-input">
            <span>充值金额 (USD)</span>
            <div class="pc-wallet-custom-modal__amount">
              <span class="pc-wallet-custom-modal__currency" aria-hidden="true">$</span>
              <input
                id="pc-wallet-custom-amount-input"
                ref="walletCustomModalInputRef"
                v-model="walletCustomDraft"
                class="pc-wallet-custom-modal__input"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0"
                @keydown.enter.prevent="applyCustomRechargeAmount"
              />
            </div>
          </label>
          <p class="pc-wallet-custom-modal__hint">
            输入任意 USD 金额，确认后右侧将同步到账明细。
          </p>
        </div>
        <footer class="pc-keys-modal__foot">
          <button
            type="button"
            class="pc-btn pc-btn--ghost"
            @click="closeWalletCustomModal"
          >
            取消
          </button>
          <button
            type="button"
            class="pc-btn pc-btn--primary"
            @click="applyCustomRechargeAmount"
          >
            确认
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</section>
</template>
