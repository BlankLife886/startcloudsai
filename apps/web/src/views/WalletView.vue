<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { getWallet, listWalletLedger, redeemWalletCode } from '@/services/meApi'
import { claimTrialAccessReward, getTrialAccessApplication } from '@/services/trialAccessApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { useClientWalletBalance, WALLET_UPDATED_EVENT } from '@/composables/useClientWalletBalance'
import ProfileSectionShell from '@/components/profile/ProfileSectionShell.vue'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
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
        description: `本次实际扣除 ${formatPoints(settledCost)}；费用从提交时的预扣中结算，没有重复扣费。`,
        meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
      }
    }
    if (status === 'failed' || status === 'canceled') {
      return {
        icon: 'bi-arrow-counterclockwise',
        tone: 'refund',
        title: taskLabel,
        badge: status === 'canceled' ? '已取消并退款' : '失败已退款',
        amount: '净支出 0 积分',
        amountTone: 'income',
        description: `预扣的 ${formatPoints(taskCost)} 已全部退回，本次没有产生费用。`,
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
      description: `当前暂时冻结 ${formatPoints(taskCost)}；任务成功后结算，失败或取消会自动退回。`,
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
      description: `提交时暂时冻结 ${formatPoints(amount)}；成功后从这笔预扣结算，失败会自动退回。`,
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
      description: `已从此前预扣的 ${formatPoints(taskCost)} 中结算，本条记录没有再次扣除积分。`,
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
      description: `任务失败、取消或未完整交付，${formatPoints(amount)} 已退回可用余额。`,
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
  <div
    class="ps-page"
    :class="{ 'is-light': !appearanceStore.isDark, 'is-dark': appearanceStore.isDark }"
  >
    <div class="ps-atmosphere" aria-hidden="true">
      <div class="ps-atmosphere__wash"></div>
    </div>

    <ProfileSectionShell title="钱包" description="余额、兑换码入账与资金明细。">
      <template #actions>
        <button
          type="button"
          class="ps-btn is-ghost"
          :disabled="walletLoading || ledgerLoading"
          @click="refreshAll"
        >
          <i class="bi bi-arrow-repeat" :class="{ spin: walletLoading || ledgerLoading }"></i>
          刷新
        </button>
      </template>

      <div v-if="walletLoading && !walletLoaded" class="ps-skel" aria-hidden="true">
        <div class="ps-skel__card"></div>
        <div v-for="n in 4" :key="n" class="ps-skel__row"></div>
      </div>

      <div v-else-if="walletError && !wallet" class="ps-empty is-error">
        <strong>钱包加载失败</strong>
        <p>{{ walletError }}</p>
        <button type="button" class="ps-btn is-ghost" @click="loadWallet()">重试</button>
      </div>

      <template v-else>
        <div class="ps-wallet-hero">
          <div>
            <span class="ps-wallet-hero__label">可用余额</span>
            <strong class="ps-wallet-hero__amount">{{ formatPoints(availableCents) }}</strong>
            <div class="ps-wallet-hero__meta">
              <span>账户总额 {{ formatPoints(totalCents) }}</span>
              <span v-if="frozenCents > 0" class="is-frozen">
                冻结 {{ formatPoints(frozenCents) }}
              </span>
            </div>
            <dl class="ps-wallet-buckets">
              <div>
                <dt>普通积分</dt>
                <dd>{{ formatPoints(normalBalanceCents) }}</dd>
                <small v-if="normalFrozenCents">冻结 {{ formatPoints(normalFrozenCents) }}</small>
              </div>
              <div class="is-trial">
                <dt>{{ trialApplication?.feature?.label || '功能' }}体验积分</dt>
                <dd>{{ formatPoints(trialBalanceCents) }}</dd>
                <small v-if="trialFrozenCents">冻结 {{ formatPoints(trialFrozenCents) }}</small>
                <small v-else-if="trialBalanceCents > 0">仅用于对应功能任务</small>
              </div>
            </dl>
          </div>
          <RouterLink class="ps-btn is-primary" to="/pricing">去充值</RouterLink>
        </div>

        <div class="ps-redeem">
          <div class="ps-redeem__head">
            <h3>兑换码</h3>
            <p>持有兑换码可在此入账，格式 SC-XXXX-XXXX-XXXX。</p>
          </div>
          <form class="ps-redeem__form" @submit.prevent="submitRedeem">
            <input
              :value="redeemCode"
              type="text"
              class="ps-redeem__input"
              placeholder="SC-XXXX-XXXX-XXXX"
              maxlength="20"
              autocomplete="off"
              spellcheck="false"
              aria-label="兑换码"
              @input="onRedeemInput"
            />
            <button type="submit" class="ps-btn is-primary" :disabled="redeeming">
              {{ redeeming ? '兑换中…' : '兑换' }}
            </button>
          </form>

          <div
            v-if="trialApplication?.status === 'approved' && trialApplication.rewardCents"
            class="ps-trial-code"
            :class="{
              'is-used': trialApplication.rewardStatus === 'redeemed',
            }"
          >
            <span class="ps-trial-code__icon" aria-hidden="true">
              <i class="bi bi-stars"></i>
            </span>
            <div class="ps-trial-code__copy">
              <div>
                <strong>{{ trialApplication.feature?.label || '功能' }}体验积分礼包</strong>
                <em v-if="trialApplication.rewardStatus === 'redeemed'">已领取</em>
                <em v-else>{{ formatPoints(trialApplication.rewardCents || 0) }}</em>
              </div>
              <p>
                {{
                  trialApplication.rewardStatus === 'redeemed'
                    ? `积分已到账，仅用于${trialApplication.feature?.label || '获批功能'}`
                    : `领取后仅用于${trialApplication.feature?.label || '获批功能'}`
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
            <div class="ps-trial-code__actions">
              <button
                v-if="trialApplication.rewardStatus !== 'redeemed'"
                type="button"
                class="ps-btn is-primary"
                :disabled="redeeming"
                @click="claimTrialReward"
              >
                {{ redeeming ? '领取中…' : '立即领取' }}
              </button>
            </div>
          </div>
          <p v-else-if="trialError" class="ps-trial-error">{{ trialError }}</p>
        </div>

        <div class="ps-ledger">
          <div class="ps-ledger__head">
            <h3>账本明细</h3>
            <span v-if="ledgerError" class="ps-ledger__error">{{ ledgerError }}</span>
          </div>

          <div v-if="ledgerLoading && !ledger.length" class="ps-skel" aria-hidden="true">
            <div v-for="n in 5" :key="n" class="ps-skel__row"></div>
          </div>

          <ul v-else-if="ledgerRows.length" class="ps-ledger-list">
            <li
              v-for="entry in ledgerRows"
              :key="entry.id"
              :class="`is-${entry.presentation.tone}`"
            >
              <span class="ps-ledger__icon" aria-hidden="true">
                <i class="bi" :class="entry.presentation.icon"></i>
              </span>
              <div class="ps-ledger__body">
                <div class="ps-ledger__main">
                  <strong>{{ entry.presentation.title }}</strong>
                  <span class="ps-ledger__badge">{{ entry.presentation.badge }}</span>
                  <span v-if="entry.creditBucket === 'trial'" class="ps-ledger__bucket is-trial">
                    体验积分
                  </span>
                  <span v-else-if="entry.creditBucket === 'mixed'" class="ps-ledger__bucket">
                    混合积分
                  </span>
                </div>
                <p>{{ entry.presentation.description }}</p>
                <small>
                  {{ formatTime(entry.createdAt) }}
                  <template v-if="entry.presentation.meta">
                    · {{ entry.presentation.meta }}
                  </template>
                </small>
              </div>
              <strong class="ps-ledger__amount" :class="`is-${entry.presentation.amountTone}`">
                {{ entry.presentation.amount }}
              </strong>
            </li>
          </ul>

          <p v-else-if="!ledgerLoading" class="ps-empty-inline">暂无余额变动记录。</p>

          <button
            v-if="ledgerCursor"
            type="button"
            class="ps-btn is-ghost ps-more"
            :disabled="ledgerLoading"
            @click="loadLedger({ append: true })"
          >
            {{ ledgerLoading ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </template>
    </ProfileSectionShell>
  </div>
</template>

<style scoped>
.ps-page {
  --ps-text: #1c1a27;
  --ps-muted: rgba(28, 26, 39, 0.58);
  --ps-line: rgba(28, 26, 39, 0.1);
  --ps-surface: rgba(255, 255, 255, 0.82);
  --ps-card: rgba(255, 255, 255, 0.94);
  --ps-accent: #6b5cff;
  --ps-shadow: 0 18px 40px rgba(40, 30, 80, 0.07);
  position: relative;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 28px clamp(16px, 3vw, 36px) 72px;
  color: var(--ps-text);
  overflow: clip;
}

.ps-page.is-dark {
  --ps-text: #f4f2ff;
  --ps-muted: rgba(244, 242, 255, 0.62);
  --ps-line: rgba(244, 242, 255, 0.12);
  --ps-surface: rgba(24, 22, 36, 0.78);
  --ps-card: rgba(32, 28, 48, 0.92);
  --ps-accent: #a99dff;
  --ps-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}

.ps-atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.ps-atmosphere__wash {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(167, 139, 250, 0.22), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(125, 211, 252, 0.16), transparent 50%),
    linear-gradient(180deg, #f6f3ff 0%, #eef2ff 48%, #f8fafc 100%);
}

.ps-page.is-dark .ps-atmosphere__wash {
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(99, 102, 241, 0.28), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(56, 189, 248, 0.14), transparent 50%),
    linear-gradient(180deg, #120f1c 0%, #161325 48%, #101018 100%);
}

.ps-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--ps-line);
  background: #fff;
  color: var(--ps-text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
}

.ps-page.is-dark .ps-btn {
  background: rgba(255, 255, 255, 0.06);
}

.ps-btn.is-primary {
  border-color: transparent;
  background: var(--ps-accent);
  color: #fff;
}

.ps-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(107, 92, 255, 0.35);
  color: var(--ps-accent);
}

.ps-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ps-more {
  width: 100%;
  margin-top: 14px;
}

.ps-skel {
  display: grid;
  gap: 10px;
}

.ps-skel__card {
  height: 120px;
  border-radius: 18px;
  background: rgba(28, 26, 39, 0.05);
}

.ps-skel__row {
  height: 64px;
  border-radius: 14px;
  background: rgba(28, 26, 39, 0.05);
}

.ps-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 48px 16px;
  text-align: center;
  color: var(--ps-muted);
}

.ps-empty strong {
  color: var(--ps-text);
}

.ps-empty-inline {
  margin: 12px 0 0;
  color: var(--ps-muted);
  font-size: 0.86rem;
  text-align: center;
}

.ps-wallet-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(107, 92, 255, 0.14), rgba(125, 211, 252, 0.1));
  border: 1px solid var(--ps-line);
  margin-bottom: 14px;
}

.ps-wallet-hero__label {
  display: block;
  color: var(--ps-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.ps-wallet-hero__amount {
  display: block;
  margin-top: 6px;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.ps-wallet-hero__meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
  color: var(--ps-muted);
  font-size: 0.78rem;
}

.ps-wallet-hero__meta .is-frozen {
  color: #d97706;
}

.ps-wallet-buckets {
  display: grid;
  grid-template-columns: repeat(2, minmax(150px, 1fr));
  gap: 8px;
  margin: 14px 0 0;
}

.ps-wallet-buckets > div {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--ps-line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.42);
}

.ps-page.is-dark .ps-wallet-buckets > div {
  background: rgba(255, 255, 255, 0.04);
}

.ps-wallet-buckets dt,
.ps-wallet-buckets small {
  color: var(--ps-muted);
  font-size: 0.7rem;
}

.ps-wallet-buckets dd {
  margin: 4px 0 0;
  font-size: 1rem;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
}

.ps-wallet-buckets .is-trial dd {
  color: #5b4ce0;
}

.ps-redeem,
.ps-ledger {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--ps-line);
}

.ps-redeem__head h3,
.ps-ledger__head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.ps-redeem__head p {
  margin: 6px 0 0;
  color: var(--ps-muted);
  font-size: 0.8rem;
}

.ps-redeem__form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.ps-redeem__input {
  flex: 1;
  min-width: 180px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--ps-line);
  border-radius: 12px;
  background: var(--ps-card);
  color: var(--ps-text);
  font: inherit;
  letter-spacing: 0.04em;
}

.ps-trial-code {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
  padding: 15px;
  color: #fff;
  background: #176f60;
  border-radius: 8px;
  box-shadow: 0 14px 30px rgba(16, 104, 87, 0.18);
}

.ps-trial-code.is-used {
  filter: saturate(0.48);
}

.ps-trial-code__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: #176f60;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  font-size: 1.1rem;
}

.ps-trial-code__copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.ps-trial-code__copy > div {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}

.ps-trial-code__copy strong {
  font-size: 0.84rem;
}

.ps-trial-code__copy em {
  padding: 2px 8px;
  color: #155f51;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 999px;
  font-size: 0.66rem;
  font-style: normal;
  font-weight: 800;
}

.ps-trial-code__copy p {
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.78rem;
  line-height: 1.45;
}

.ps-trial-code__copy small {
  color: rgba(255, 255, 255, 0.64);
  font-size: 0.68rem;
}

.ps-trial-code__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ps-trial-code .ps-btn.is-ghost {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
}

.ps-trial-code .ps-btn.is-primary {
  color: #155f51;
  background: #fff;
}

.ps-trial-error {
  margin: 12px 0 0;
  color: #ef4444;
  font-size: 0.76rem;
}

@media (max-width: 640px) {
  .ps-trial-code {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .ps-trial-code__actions {
    grid-column: 1 / -1;
  }

  .ps-trial-code__actions .ps-btn {
    flex: 1;
  }
}

.ps-ledger__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.ps-ledger__error {
  color: #ef4444;
  font-size: 0.76rem;
}

.ps-ledger-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.ps-ledger-list li {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 12px;
  border: 1px solid var(--ps-line);
  border-radius: 16px;
  background: var(--ps-card);
}

.ps-ledger__icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(28, 26, 39, 0.06);
  color: var(--ps-muted);
}

.ps-ledger-list li.is-pending .ps-ledger__icon {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.ps-ledger-list li.is-settled .ps-ledger__icon,
.ps-ledger-list li.is-income .ps-ledger__icon {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.ps-ledger-list li.is-refund .ps-ledger__icon {
  background: rgba(56, 189, 248, 0.14);
  color: #0284c7;
}

.ps-ledger__body {
  min-width: 0;
}

.ps-ledger__main {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.ps-ledger__badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(28, 26, 39, 0.06);
  font-size: 0.68rem;
  font-weight: 700;
}

.ps-ledger__bucket {
  padding: 2px 7px;
  color: #6b5cff;
  border: 1px solid rgba(107, 92, 255, 0.22);
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
}

.ps-ledger__bucket.is-trial {
  color: #14705e;
  border-color: rgba(20, 112, 94, 0.24);
}

.ps-ledger__body p {
  margin: 4px 0 0;
  color: var(--ps-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.ps-ledger__body small {
  display: block;
  margin-top: 4px;
  color: var(--ps-muted);
  font-size: 0.7rem;
}

.ps-ledger__amount {
  font-size: 0.86rem;
  font-weight: 800;
  white-space: nowrap;
}

.ps-ledger__amount.is-income {
  color: #16a34a;
}

.ps-ledger__amount.is-spend {
  color: #ef4444;
}

.ps-ledger__amount.is-neutral {
  color: var(--ps-muted);
}

.spin {
  animation: ps-spin 0.9s linear infinite;
}

@keyframes ps-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
