<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getWallet, listWalletLedger, redeemWalletCode } from '@/services/meApi'
import { claimTrialAccessReward, getTrialAccessApplication } from '@/services/trialAccessApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { useClientWalletBalance, WALLET_UPDATED_EVENT } from '@/composables/useClientWalletBalance'

const router = useRouter()
const authStore = useAuthStore()
const { refreshWalletBalance, applyWalletSnapshot } = useClientWalletBalance()

const wallet = ref(null)
const walletLoading = ref(false)
const walletError = ref('')
const walletLoaded = ref(false)
const ledger = ref([])
const ledgerLoading = ref(false)
const ledgerCursor = ref(null)
const ledgerError = ref('')
const redeemCode = ref('')
const redeeming = ref(false)
const trialApplication = ref(null)
const trialLoading = ref(false)
const trialError = ref('')

const REDEEM_ERROR_MESSAGES = {
  code_invalid: '兑换码不存在，请检查后重试',
  code_redeemed: '该兑换码已被使用',
  code_expired: '兑换码已过期',
  code_disabled: '兑换码已停用',
  rate_limited: '尝试过于频繁，请稍后再试',
}

const balanceCents = computed(() => Number(wallet.value?.balanceCents ?? 0))
const frozenCents = computed(() => Number(wallet.value?.frozenCents ?? 0))
const normalBalanceCents = computed(() =>
  Number(wallet.value?.normalBalanceCents ?? balanceCents.value),
)
const trialBalanceCents = computed(() => Number(wallet.value?.trialBalanceCents ?? 0))
const normalFrozenCents = computed(() =>
  Number(wallet.value?.normalFrozenCents ?? frozenCents.value),
)
const trialFrozenCents = computed(() => Number(wallet.value?.trialFrozenCents ?? 0))
const availableCents = computed(() => Math.max(0, balanceCents.value))
const totalCents = computed(() => availableCents.value + Math.max(0, frozenCents.value))
const trialFeatureLabel = computed(() => trialApplication.value?.feature?.label || '体验')
const showTrialReward = computed(
  () => trialApplication.value?.status === 'approved' && trialApplication.value?.rewardCents,
)

const TASK_TYPE_LABELS = {
  t2i: '文生图',
  coloring: '插画染色',
  ui_design: 'UI 设计稿',
  ecommerce_design: 'AI 电商设计',
  model_sheet: '模型图生成',
  game_art: '游戏美术',
  puzzle: 'AI 拼图',
  background_remove: '背景移除',
}

const TASK_STATUS_LABELS = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
}

const LEDGER_KIND_LABELS = {
  order_grant: '套餐入账',
  grant: '入账',
  task_freeze: '任务冻结',
  task_settle: '任务结算',
  task_release: '任务解冻',
  admin_adjust: '人工调整',
  redeem: '兑换码入账',
  subscription_grant: '订阅每日发放',
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function ledgerTaskLabel(entry) {
  const task = entry?.task
  if (!task) return 'AI 任务'
  if (task.type === 'background_remove' && task.automaticBackgroundRemove) {
    return '生成后自动抠图'
  }
  return TASK_TYPE_LABELS[task.type] || 'AI 任务'
}

function ledgerTaskMeta(entry) {
  const task = entry?.task
  if (!task) return ''
  return [
    String(task.modelName || '').trim(),
    Number(task.count || 1) > 1 ? `${task.count} 张` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function ledgerPresentation(entry) {
  const kind = String(entry?.kind || '').toLowerCase()
  const delta = Number(entry?.deltaCents || 0)
  const amount = Math.abs(delta)
  const taskLabel = ledgerTaskLabel(entry)
  const taskStatus = TASK_STATUS_LABELS[entry?.task?.status] || ''
  const taskCost = Math.max(0, Number(entry?.task?.costPoints || amount))
  const taskMeta = ledgerTaskMeta(entry)
  const balanceLabel = `变动后可用 ${formatPoints(entry?.balanceAfterCents)}`

  if (entry?.task && Array.isArray(entry.relatedEntries)) {
    const status = String(entry.task.status || '').toLowerCase()
    if (status === 'succeeded') {
      const settledCost = Math.max(
        0,
        Number(entry.task.settledCostPoints ?? entry.task.costPoints ?? taskCost),
      )
      return {
        icon: 'bi-check2-circle',
        tone: 'settled',
        title: taskLabel,
        badge: '成功',
        amount: `-${formatPoints(settledCost)}`,
        amountTone: 'spend',
        description: `实际扣除 ${formatPoints(settledCost)}，从预扣中结算。`,
        meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
      }
    }
    if (status === 'failed' || status === 'canceled') {
      return {
        icon: 'bi-arrow-counterclockwise',
        tone: 'refund',
        title: taskLabel,
        badge: status === 'canceled' ? '已取消并退款' : '失败已退款',
        amount: '净支出 0',
        amountTone: 'income',
        description: `预扣 ${formatPoints(taskCost)} 已全部退回。`,
        meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
      }
    }
    return {
      icon: 'bi-hourglass-split',
      tone: 'pending',
      title: taskLabel,
      badge: taskStatus || '处理中',
      amount: `冻结 ${formatPoints(taskCost)}`,
      amountTone: 'neutral',
      description: `暂时冻结 ${formatPoints(taskCost)}；成功结算，失败退回。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }

  if (kind === 'freeze' || kind === 'task_freeze') {
    return {
      icon: 'bi-hourglass-split',
      tone: 'pending',
      title: `${taskLabel}费用预扣`,
      badge: taskStatus || '处理中',
      amount: `-${formatPoints(amount)}`,
      amountTone: 'spend',
      description: `提交时冻结 ${formatPoints(amount)}。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }
  if (kind === 'spend' || kind === 'task_settle') {
    return {
      icon: 'bi-check2-circle',
      tone: 'settled',
      title: `${taskLabel}已完成`,
      badge: '已结算',
      amount: '未再次扣费',
      amountTone: 'neutral',
      description: `已从预扣 ${formatPoints(taskCost)} 中结算。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }
  if (kind === 'release' || kind === 'task_release' || kind === 'refund') {
    return {
      icon: 'bi-arrow-counterclockwise',
      tone: 'refund',
      title: `${taskLabel}费用已退回`,
      badge: taskStatus || '已退款',
      amount: `+${formatPoints(amount)}`,
      amountTone: 'income',
      description: `${formatPoints(amount)} 已退回可用余额。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }

  const sourceLabels = {
    order: '套餐入账',
    redeem_code: '兑换码入账',
    daily_checkin: '签到奖励',
    subscription_daily: '订阅积分发放',
    signup_bonus: '注册赠送',
    admin: '人工调整',
  }
  const title =
    sourceLabels[entry?.sourceType] ||
    LEDGER_KIND_LABELS[kind] ||
    (delta >= 0 ? '积分入账' : '积分扣减')
  return {
    icon: delta >= 0 ? 'bi-plus-circle' : 'bi-dash-circle',
    tone: delta >= 0 ? 'income' : 'spend',
    title,
    badge: delta >= 0 ? '已入账' : '已扣减',
    amount: `${delta >= 0 ? '+' : '-'}${formatPoints(amount)}`,
    amountTone: delta >= 0 ? 'income' : 'spend',
    description: String(entry?.reason || '').trim() || '账户积分发生变动。',
    meta: balanceLabel,
  }
}

const ledgerRows = computed(() => {
  const grouped = new Map()
  ledger.value.forEach((entry) => {
    const taskID = String(entry?.task?.id || '').trim()
    const key = taskID ? `task:${taskID}` : `entry:${entry.id}`
    if (!grouped.has(key)) {
      grouped.set(key, { ...entry, id: key, relatedEntries: [] })
    }
    grouped.get(key).relatedEntries.push(entry)
  })
  return Array.from(grouped.values()).map((entry) => ({
    ...entry,
    presentation: ledgerPresentation(entry),
  }))
})

async function loadWallet() {
  walletLoading.value = true
  walletError.value = ''
  try {
    wallet.value = await getWallet()
    applyWalletSnapshot(wallet.value)
    walletLoaded.value = true
  } catch (error) {
    walletError.value = error?.message || '钱包读取失败'
  } finally {
    walletLoading.value = false
  }
}

async function loadLedger({ append = false } = {}) {
  if (ledgerLoading.value) return
  ledgerLoading.value = true
  ledgerError.value = ''
  try {
    const { items, nextCursor } = await listWalletLedger({
      limit: 15,
      cursor: append ? ledgerCursor.value || '' : '',
    })
    ledger.value = append ? [...ledger.value, ...items] : items
    ledgerCursor.value = nextCursor
  } catch (error) {
    ledgerError.value = error?.message || '账本读取失败'
  } finally {
    ledgerLoading.value = false
  }
}

async function loadTrialApplication() {
  trialLoading.value = true
  trialError.value = ''
  try {
    trialApplication.value = await getTrialAccessApplication()
  } catch (error) {
    trialError.value = error?.message || '体验兑换码读取失败'
  } finally {
    trialLoading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadWallet(), loadLedger(), loadTrialApplication()])
}

function onRedeemInput(event) {
  redeemCode.value = String(event.target.value || '').toUpperCase()
}

async function submitRedeem() {
  const code = redeemCode.value.trim().toUpperCase()
  if (!code) {
    notificationService.info('请输入兑换码（格式 SC-XXXX-XXXX-XXXX）')
    return
  }
  if (redeeming.value) return
  redeeming.value = true
  try {
    const result = await redeemWalletCode(code)
    notificationService.success(`已入账 ${formatPoints(result?.grantCents || 0)}`)
    redeemCode.value = ''
    if (result?.balanceCents != null || result?.frozenCents != null) {
      applyWalletSnapshot({
        balanceCents: result?.balanceCents,
        frozenCents: result?.frozenCents,
        normalBalanceCents: result?.normalBalanceCents,
        trialBalanceCents: result?.trialBalanceCents,
        normalFrozenCents: result?.normalFrozenCents,
        trialFrozenCents: result?.trialFrozenCents,
      })
    }
    await Promise.all([
      loadWallet(),
      loadLedger(),
      loadTrialApplication(),
      refreshWalletBalance({ force: true }).catch(() => null),
    ])
  } catch (error) {
    const mapped = REDEEM_ERROR_MESSAGES[error?.code]
    if (mapped) notificationService.error(mapped)
    else if (error?.status === 404) notificationService.info('兑换功能即将开放，敬请期待')
    else notificationService.error(error?.message || '兑换失败，请稍后再试')
  } finally {
    redeeming.value = false
  }
}

async function claimTrialReward() {
  if (
    redeeming.value ||
    trialApplication.value?.status !== 'approved' ||
    trialApplication.value?.rewardStatus === 'redeemed'
  ) {
    return
  }
  redeeming.value = true
  try {
    const result = await claimTrialAccessReward()
    notificationService.success(`体验积分已到账 +${formatPoints(result?.grantCents || 0)}`)
    if (result?.balanceCents != null || result?.frozenCents != null) {
      applyWalletSnapshot({
        balanceCents: result?.balanceCents,
        frozenCents: result?.frozenCents,
        normalBalanceCents: result?.normalBalanceCents,
        trialBalanceCents: result?.trialBalanceCents,
        normalFrozenCents: result?.normalFrozenCents,
        trialFrozenCents: result?.trialFrozenCents,
      })
    }
    await Promise.all([
      loadWallet(),
      loadLedger(),
      loadTrialApplication(),
      refreshWalletBalance({ force: true }).catch(() => null),
    ])
  } catch (error) {
    if (['trial_reward_already_claimed', 'code_redeemed'].includes(error?.code)) {
      await refreshAll()
    } else {
      notificationService.error(error?.message || '体验积分领取失败')
    }
  } finally {
    redeeming.value = false
  }
}

function onSharedWalletUpdated(event) {
  const snap = event?.detail
  if (!snap) return
  wallet.value = {
    ...(wallet.value || {}),
    balanceCents: Number(snap.balanceCents || 0),
    frozenCents: Number(snap.frozenCents || 0),
    normalBalanceCents: Number(snap.normalBalanceCents || 0),
    trialBalanceCents: Number(snap.trialBalanceCents || 0),
    normalFrozenCents: Number(snap.normalFrozenCents || 0),
    trialFrozenCents: Number(snap.trialFrozenCents || 0),
  }
}

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    router.replace({
      name: 'auth',
      query: { ...createLoginRedirectQuery('/wallet'), mode: 'login' },
    })
    return
  }
  window.addEventListener(WALLET_UPDATED_EVENT, onSharedWalletUpdated)
  await refreshAll()
})

onBeforeUnmount(() => {
  window.removeEventListener(WALLET_UPDATED_EVENT, onSharedWalletUpdated)
})
</script>

<template>
  <main class="wallet">
    <header class="wallet-top">
      <div>
        <h1>钱包</h1>
        <p>余额、兑换入账与资金明细</p>
      </div>
      <div class="wallet-top__actions">
        <button
          type="button"
          class="wallet-btn is-ghost"
          :disabled="walletLoading || ledgerLoading || trialLoading"
          @click="refreshAll"
        >
          <i
            class="bi bi-arrow-repeat"
            :class="{ spin: walletLoading || ledgerLoading || trialLoading }"
            aria-hidden="true"
          ></i>
          刷新
        </button>
        <RouterLink class="wallet-btn is-primary" to="/pricing">查看价格</RouterLink>
      </div>
    </header>

    <div v-if="walletLoading && !walletLoaded" class="wallet-skel" aria-hidden="true">
      <div class="wallet-skel__hero"></div>
      <div class="wallet-skel__side"></div>
      <div v-for="n in 4" :key="n" class="wallet-skel__row"></div>
    </div>

    <section v-else-if="walletError && !wallet" class="wallet-error">
      <i class="bi bi-cloud-slash" aria-hidden="true"></i>
      <strong>钱包加载失败</strong>
      <p>{{ walletError }}</p>
      <button type="button" class="wallet-btn is-ghost" @click="loadWallet">重试</button>
    </section>

    <template v-else>
      <section class="wallet-stage">
        <article class="wallet-balance">
          <span class="wallet-balance__label">可用余额</span>
          <strong>{{ formatPoints(availableCents) }}</strong>
          <div class="wallet-balance__meta">
            <span>账户总额 {{ formatPoints(totalCents) }}</span>
            <span v-if="frozenCents > 0" class="is-frozen">
              冻结 {{ formatPoints(frozenCents) }}
            </span>
          </div>

          <div class="wallet-buckets">
            <div>
              <small>普通积分</small>
              <b>{{ formatPoints(normalBalanceCents) }}</b>
              <em v-if="normalFrozenCents">冻结 {{ formatPoints(normalFrozenCents) }}</em>
            </div>
            <div class="is-trial">
              <small>{{ trialFeatureLabel }}体验积分</small>
              <b>{{ formatPoints(trialBalanceCents) }}</b>
              <em v-if="trialFrozenCents">冻结 {{ formatPoints(trialFrozenCents) }}</em>
              <em v-else-if="trialBalanceCents > 0">仅限对应功能</em>
            </div>
          </div>

          <div class="wallet-balance__links">
            <RouterLink to="/check-in">每日签到</RouterLink>
            <RouterLink to="/incentive-plans">创作激励</RouterLink>
            <RouterLink to="/text-to-image">去创作</RouterLink>
          </div>
        </article>

        <div class="wallet-actions">
          <article class="wallet-panel">
            <header>
              <h2>兑换码入账</h2>
              <p>格式 SC-XXXX-XXXX-XXXX</p>
            </header>
            <form class="wallet-redeem" @submit.prevent="submitRedeem">
              <input
                :value="redeemCode"
                type="text"
                placeholder="SC-XXXX-XXXX-XXXX"
                maxlength="20"
                autocomplete="off"
                spellcheck="false"
                aria-label="兑换码"
                @input="onRedeemInput"
              />
              <button type="submit" class="wallet-btn is-primary" :disabled="redeeming">
                {{ redeeming ? '兑换中…' : '兑换' }}
              </button>
            </form>
          </article>

          <article
            v-if="showTrialReward"
            class="wallet-trial"
            :class="{ 'is-used': trialApplication.rewardStatus === 'redeemed' }"
          >
            <span class="wallet-trial__icon" aria-hidden="true"><i class="bi bi-gift"></i></span>
            <div>
              <strong>{{ trialFeatureLabel }}体验积分礼包</strong>
              <p>
                {{
                  trialApplication.rewardStatus === 'redeemed'
                    ? `已到账，仅用于${trialFeatureLabel}`
                    : `领取后仅用于${trialFeatureLabel}`
                }}
              </p>
              <small>
                {{
                  trialApplication.rewardExpiresAt
                    ? `领取有效期至 ${formatTime(trialApplication.rewardExpiresAt)}`
                    : '长期有效'
                }}
              </small>
            </div>
            <em v-if="trialApplication.rewardStatus === 'redeemed'">已领取</em>
            <button
              v-else
              type="button"
              class="wallet-btn is-light"
              :disabled="redeeming"
              @click="claimTrialReward"
            >
              {{ redeeming ? '领取中…' : `领取 ${formatPoints(trialApplication.rewardCents || 0)}` }}
            </button>
          </article>
          <p v-else-if="trialError" class="wallet-trial-error">{{ trialError }}</p>
        </div>
      </section>

      <section class="wallet-ledger">
        <header>
          <div>
            <h2>账本明细</h2>
            <p>任务冻结、结算与入账记录</p>
          </div>
          <span v-if="ledgerError" class="wallet-ledger__error">{{ ledgerError }}</span>
        </header>

        <div v-if="ledgerLoading && !ledger.length" class="wallet-skel is-inline" aria-hidden="true">
          <div v-for="n in 5" :key="n" class="wallet-skel__row"></div>
        </div>

        <ul v-else-if="ledgerRows.length" class="wallet-ledger__list">
          <li
            v-for="entry in ledgerRows"
            :key="entry.id"
            :class="`is-${entry.presentation.tone}`"
          >
            <span class="wallet-ledger__icon" aria-hidden="true">
              <i class="bi" :class="entry.presentation.icon"></i>
            </span>
            <div class="wallet-ledger__body">
              <div class="wallet-ledger__main">
                <strong>{{ entry.presentation.title }}</strong>
                <span>{{ entry.presentation.badge }}</span>
                <span v-if="entry.creditBucket === 'trial'" class="is-trial">体验积分</span>
                <span v-else-if="entry.creditBucket === 'mixed'">混合积分</span>
              </div>
              <p>{{ entry.presentation.description }}</p>
              <small>
                {{ formatTime(entry.createdAt) }}
                <template v-if="entry.presentation.meta">
                  · {{ entry.presentation.meta }}
                </template>
              </small>
            </div>
            <b :class="`is-${entry.presentation.amountTone}`">{{ entry.presentation.amount }}</b>
          </li>
        </ul>

        <p v-else-if="!ledgerLoading" class="wallet-empty">暂无余额变动记录</p>

        <button
          v-if="ledgerCursor"
          type="button"
          class="wallet-btn is-ghost wallet-more"
          :disabled="ledgerLoading"
          @click="loadLedger({ append: true })"
        >
          {{ ledgerLoading ? '加载中…' : '加载更多' }}
        </button>
      </section>
    </template>
  </main>
</template>

<style scoped>
.wallet {
  --ink: #1f2430;
  --muted: #6f7a8c;
  --line: #ebe3d8;
  --orange: #f27021;
  --card: #fff;
  width: 100%;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 20px 0 48px;
  overflow-x: clip;
  color: var(--ink);
  background:
    radial-gradient(circle at 10% 0%, rgb(255 210 150 / 32%), transparent 30%),
    radial-gradient(circle at 92% 6%, rgb(255 186 120 / 16%), transparent 26%),
    linear-gradient(180deg, #fffaf3 0%, #f6f3ee 46%, #f3f4f7 100%);
}

.wallet-top,
.wallet-stage,
.wallet-ledger,
.wallet-error,
.wallet-skel {
  width: min(1120px, calc(100% - 40px));
  margin-inline: auto;
}

.wallet-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.wallet-top h1 {
  margin: 0;
  font-size: clamp(1.7rem, 2.8vw, 2.2rem);
  font-weight: 850;
  letter-spacing: -0.03em;
}

.wallet-top p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.wallet-top__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wallet-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  background: #fff;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 750;
  text-decoration: none;
  cursor: pointer;
}

.wallet-btn.is-primary {
  color: #fff;
  border-color: var(--orange);
  background: var(--orange);
}

.wallet-btn.is-ghost:hover:not(:disabled) {
  border-color: #f2b27a;
  color: #c45a10;
}

.wallet-btn.is-light {
  color: #9a4b12;
  border-color: transparent;
  background: #fff;
}

.wallet-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wallet-stage {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 14px;
  margin-bottom: 16px;
}

.wallet-balance,
.wallet-panel,
.wallet-trial,
.wallet-ledger {
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 12px 32px rgb(60 45 20 / 6%);
}

.wallet-balance {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 24px;
  background:
    radial-gradient(circle at 100% 0%, rgb(255 186 120 / 28%), transparent 42%),
    linear-gradient(160deg, #fff8ef 0%, #fff 70%);
}

.wallet-balance__label {
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.wallet-balance > strong {
  font-size: clamp(2rem, 3.4vw, 2.6rem);
  font-weight: 850;
  letter-spacing: -0.04em;
  line-height: 1;
}

.wallet-balance__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--muted);
  font-size: 0.76rem;
}

.wallet-balance__meta .is-frozen {
  color: #b45309;
}

.wallet-buckets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 6px;
}

.wallet-buckets > div {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #f0e4d4;
  border-radius: 14px;
  background: rgb(255 255 255 / 78%);
}

.wallet-buckets small {
  color: var(--muted);
  font-size: 0.68rem;
}

.wallet-buckets b {
  font-size: 1.05rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.wallet-buckets em {
  color: var(--muted);
  font-size: 0.66rem;
  font-style: normal;
}

.wallet-buckets .is-trial b {
  color: #c45a10;
}

.wallet-balance__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.wallet-balance__links a {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #f0d7bc;
  border-radius: 999px;
  color: #b85a12;
  background: rgb(255 255 255 / 80%);
  font-size: 0.72rem;
  font-weight: 700;
  text-decoration: none;
}

.wallet-actions {
  display: grid;
  align-content: start;
  gap: 12px;
}

.wallet-panel {
  padding: 20px;
}

.wallet-panel header h2,
.wallet-ledger header h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 850;
}

.wallet-panel header p,
.wallet-ledger header p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 0.74rem;
}

.wallet-redeem {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-top: 14px;
}

.wallet-redeem input {
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: #fffaf4;
  font: inherit;
  letter-spacing: 0.04em;
  outline: none;
}

.wallet-redeem input:focus {
  border-color: #f2b27a;
  box-shadow: 0 0 0 3px rgb(242 112 33 / 10%);
}

.wallet-trial {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 16px;
  color: #fff;
  border: 0;
  background: linear-gradient(145deg, #2f9f7f, #1d7a62);
  box-shadow: 0 14px 30px rgb(29 122 98 / 18%);
}

.wallet-trial.is-used {
  filter: saturate(0.55);
}

.wallet-trial__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 12px;
  color: #1d7a62;
  background: #fff;
  font-size: 1.15rem;
}

.wallet-trial strong {
  display: block;
  font-size: 0.88rem;
}

.wallet-trial p {
  margin: 4px 0 0;
  color: rgb(255 255 255 / 88%);
  font-size: 0.74rem;
  line-height: 1.4;
}

.wallet-trial small {
  display: block;
  margin-top: 4px;
  color: rgb(255 255 255 / 62%);
  font-size: 0.66rem;
}

.wallet-trial > em {
  padding: 4px 10px;
  border-radius: 999px;
  color: #1d7a62;
  background: #fff;
  font-style: normal;
  font-size: 0.66rem;
  font-weight: 800;
}

.wallet-trial-error {
  margin: 0;
  color: #dc2626;
  font-size: 0.74rem;
}

.wallet-ledger {
  padding: 20px;
}

.wallet-ledger > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.wallet-ledger__error {
  color: #dc2626;
  font-size: 0.74rem;
}

.wallet-ledger__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wallet-ledger__list > li {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 12px;
  border: 1px solid #f0e8dc;
  border-radius: 14px;
  background: #fffaf6;
}

.wallet-ledger__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  color: var(--muted);
  background: #f3eee6;
  font-size: 1.05rem;
}

.wallet-ledger__list > li.is-pending .wallet-ledger__icon {
  color: #d97706;
  background: #fff7ed;
}

.wallet-ledger__list > li.is-settled .wallet-ledger__icon,
.wallet-ledger__list > li.is-income .wallet-ledger__icon {
  color: #16a34a;
  background: #ecfdf5;
}

.wallet-ledger__list > li.is-refund .wallet-ledger__icon {
  color: #0284c7;
  background: #e0f2fe;
}

.wallet-ledger__list > li.is-spend .wallet-ledger__icon {
  color: #dc2626;
  background: #fef2f2;
}

.wallet-ledger__body {
  min-width: 0;
}

.wallet-ledger__main {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.wallet-ledger__main strong {
  font-size: 0.88rem;
}

.wallet-ledger__main span {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--muted);
  background: #f1ebe3;
  font-size: 0.64rem;
  font-weight: 700;
}

.wallet-ledger__main span.is-trial {
  color: #14705e;
  background: #dcf5ee;
}

.wallet-ledger__body p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 0.74rem;
  line-height: 1.45;
}

.wallet-ledger__body small {
  display: block;
  margin-top: 4px;
  color: rgb(111 122 140 / 78%);
  font-size: 0.66rem;
}

.wallet-ledger__list > li > b {
  font-size: 0.84rem;
  font-weight: 850;
  white-space: nowrap;
}

.wallet-ledger__list > li > b.is-income {
  color: #16a34a;
}

.wallet-ledger__list > li > b.is-spend {
  color: #dc2626;
}

.wallet-ledger__list > li > b.is-neutral {
  color: var(--muted);
}

.wallet-more {
  width: 100%;
  margin-top: 12px;
}

.wallet-empty {
  margin: 8px 0 0;
  padding: 28px 12px;
  color: var(--muted);
  font-size: 0.82rem;
  text-align: center;
}

.wallet-error {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 320px;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: #fff;
  text-align: center;
}

.wallet-error i {
  color: var(--orange);
  font-size: 1.8rem;
}

.wallet-error p {
  margin: 0;
  color: var(--muted);
}

.wallet-skel {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 14px;
}

.wallet-skel.is-inline {
  display: grid;
  grid-template-columns: 1fr;
  width: 100%;
  margin: 0;
}

.wallet-skel__hero,
.wallet-skel__side,
.wallet-skel__row {
  border-radius: 16px;
  background: linear-gradient(90deg, #fff 25%, #fff6eb 50%, #fff 75%);
  background-size: 200% 100%;
  animation: wallet-shimmer 1.2s linear infinite;
}

.wallet-skel__hero {
  min-height: 260px;
}

.wallet-skel__side {
  min-height: 180px;
}

.wallet-skel__row {
  grid-column: 1 / -1;
  height: 72px;
}

.spin {
  animation: wallet-spin 0.9s linear infinite;
}

@keyframes wallet-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes wallet-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 900px) {
  .wallet-stage,
  .wallet-skel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .wallet-top,
  .wallet-stage,
  .wallet-ledger,
  .wallet-error,
  .wallet-skel {
    width: calc(100% - 24px);
  }
  .wallet-top {
    align-items: stretch;
    flex-direction: column;
  }
  .wallet-top__actions {
    width: 100%;
  }
  .wallet-top__actions .wallet-btn {
    flex: 1;
  }
  .wallet-buckets,
  .wallet-redeem,
  .wallet-trial {
    grid-template-columns: 1fr;
  }
  .wallet-ledger__list > li {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .wallet-ledger__list > li > b {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
