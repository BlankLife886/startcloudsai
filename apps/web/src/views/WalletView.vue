<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { getWallet, listWalletLedger } from '@/services/meApi'
import { claimTrialAccessReward, getTrialAccessApplication } from '@/services/trialAccessApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { useClientWalletBalance, WALLET_UPDATED_EVENT } from '@/composables/useClientWalletBalance'
import RedeemCodeDialog from '@/components/layout/RedeemCodeDialog.vue'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const { refreshWalletBalance, applyWalletSnapshot } = useClientWalletBalance()

const wallet = ref(null)
const walletLoading = ref(false)
const walletError = ref('')
const walletLoaded = ref(false)
const LEDGER_PAGE_SIZE = 12

const ledger = ref([])
const ledgerLoading = ref(false)
const ledgerError = ref('')
const ledgerFilter = ref('all')
const ledgerPage = ref(1)
const ledgerNextCursor = ref(null)
const ledgerPageCursors = ref([''])
const redeemDialogOpen = ref(false)
const redeeming = ref(false)
const trialApplication = ref(null)
const trialLoading = ref(false)
const trialError = ref('')

const LEDGER_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'income', label: '入账' },
  { id: 'spend', label: '消费' },
  { id: 'pending', label: '冻结' },
  { id: 'refund', label: '退款' },
]

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
const hasPrevLedgerPage = computed(() => ledgerPage.value > 1)
const hasNextLedgerPage = computed(() => Boolean(ledgerNextCursor.value))
const showLedgerPager = computed(
  () => hasPrevLedgerPage.value || hasNextLedgerPage.value || ledgerPage.value > 1,
)

const TASK_TYPE_LABELS = {
  t2i: '文生图',
  coloring: '插画染色',
  ui_design: 'UI 设计稿',
  ecommerce_design: 'AI 电商',
  model_sheet: '模型设计',
  game_art: '游戏美术',
  puzzle: '拼图',
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

function formatClock(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayLabel(date) {
  const today = new Date()
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((start(today) - start(date)) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays > 1 && diffDays < 7) return `${diffDays} 天前`
  if (date.getFullYear() === today.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
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

function ledgerCategory(entry, presentation) {
  const tone = presentation?.tone || ''
  if (tone === 'income') return 'income'
  if (tone === 'refund') return 'refund'
  if (tone === 'pending') return 'pending'
  if (tone === 'spend' || tone === 'settled') return 'spend'
  const kind = String(entry?.kind || '').toLowerCase()
  if (['grant', 'order_grant', 'redeem', 'subscription_grant', 'admin_adjust'].includes(kind)) {
    return Number(entry?.deltaCents || 0) >= 0 ? 'income' : 'spend'
  }
  if (kind.includes('freeze')) return 'pending'
  if (kind.includes('release') || kind.includes('refund')) return 'refund'
  if (kind.includes('settle') || kind.includes('spend')) return 'spend'
  return Number(entry?.deltaCents || 0) >= 0 ? 'income' : 'spend'
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
  return Array.from(grouped.values()).map((entry) => {
    const presentation = ledgerPresentation(entry)
    return {
      ...entry,
      presentation,
      category: ledgerCategory(entry, presentation),
    }
  })
})

const filterCounts = computed(() => {
  const counts = { all: ledgerRows.value.length, income: 0, spend: 0, pending: 0, refund: 0 }
  ledgerRows.value.forEach((row) => {
    if (counts[row.category] != null) counts[row.category] += 1
  })
  return counts
})

const filteredLedgerRows = computed(() => {
  if (ledgerFilter.value === 'all') return ledgerRows.value
  return ledgerRows.value.filter((row) => row.category === ledgerFilter.value)
})

const ledgerDayGroups = computed(() => {
  const groups = []
  const map = new Map()
  filteredLedgerRows.value.forEach((entry) => {
    const date = parseDate(entry.createdAt)
    const key = date ? dayKey(date) : 'unknown'
    if (!map.has(key)) {
      const group = {
        key,
        label: date ? dayLabel(date) : '更早',
        items: [],
      }
      map.set(key, group)
      groups.push(group)
    }
    map.get(key).items.push(entry)
  })
  return groups
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

async function loadLedger(page = 1) {
  if (ledgerLoading.value) return
  const cursor = ledgerPageCursors.value[page - 1]
  if (cursor === undefined) return
  ledgerLoading.value = true
  ledgerError.value = ''
  try {
    const { items, nextCursor } = await listWalletLedger({
      limit: LEDGER_PAGE_SIZE,
      cursor: cursor || '',
    })
    ledger.value = items
    ledgerPage.value = page
    ledgerNextCursor.value = nextCursor || null
    const cursors = ledgerPageCursors.value.slice(0, page)
    if (nextCursor) cursors[page] = nextCursor
    ledgerPageCursors.value = cursors
  } catch (error) {
    ledgerError.value = error?.message || '账本读取失败'
  } finally {
    ledgerLoading.value = false
  }
}

async function resetLedger() {
  ledgerPageCursors.value = ['']
  ledgerNextCursor.value = null
  ledgerPage.value = 1
  await loadLedger(1)
}

function goLedgerPage(delta) {
  const next = ledgerPage.value + delta
  if (next < 1 || ledgerLoading.value) return
  if (delta > 0 && !hasNextLedgerPage.value) return
  if (delta < 0 && !hasPrevLedgerPage.value) return
  void loadLedger(next)
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
  await Promise.all([loadWallet(), resetLedger(), loadTrialApplication()])
}

function openRedeemDialog() {
  redeemDialogOpen.value = true
}

function closeRedeemDialog() {
  redeemDialogOpen.value = false
}

async function onRedeemSuccess() {
  await Promise.all([
    loadWallet(),
    resetLedger(),
    loadTrialApplication(),
    refreshWalletBalance({ force: true }).catch(() => null),
  ])
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
      resetLedger(),
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
  <main class="wallet" :class="{ 'is-dark': appearanceStore.isDark }">
    <div v-if="walletLoading && !walletLoaded" class="wallet-skel" aria-hidden="true">
      <div class="wallet-skel__aside"></div>
      <div class="wallet-skel__panel"></div>
    </div>

    <section v-else-if="walletError && !wallet" class="wallet-error">
      <i class="bi bi-cloud-slash" aria-hidden="true"></i>
      <strong>钱包加载失败</strong>
      <p>{{ walletError }}</p>
      <button type="button" class="wallet-btn" @click="loadWallet">重试</button>
    </section>

    <div v-else class="wallet-layout">
      <aside class="wallet-aside" aria-label="钱包概览">
        <div class="wallet-aside__card">
          <div class="wallet-aside__glow" aria-hidden="true"></div>

          <div class="wallet-aside__hero">
            <span class="wallet-aside__label">可用余额</span>
            <p class="wallet-aside__amount">
              <strong>{{ formatPoints(availableCents, { withUnit: false }) }}</strong>
              <small>积分</small>
            </p>
            <p class="wallet-aside__hint">
              总额 {{ formatPoints(totalCents) }}
              <template v-if="frozenCents > 0">
                · 冻结 {{ formatPoints(frozenCents) }}
              </template>
            </p>
          </div>

          <div class="wallet-aside__cta">
            <button type="button" class="wallet-btn is-primary" @click="openRedeemDialog">
              <i class="bi bi-ticket-perforated" aria-hidden="true"></i>
              兑换
            </button>
            <RouterLink class="wallet-btn" to="/text-to-image">去创作</RouterLink>
            <RouterLink class="wallet-btn is-ghost" to="/check-in">签到</RouterLink>
            <RouterLink class="wallet-btn is-ghost" to="/incentive-plans">激励</RouterLink>
          </div>

          <div class="wallet-metrics" aria-label="积分构成">
            <article>
              <i class="bi bi-wallet2" aria-hidden="true"></i>
              <span>账户总额</span>
              <strong>{{ formatPoints(totalCents) }}</strong>
            </article>
            <article :class="{ 'is-warn': frozenCents > 0 }">
              <i class="bi bi-hourglass-split" aria-hidden="true"></i>
              <span>冻结中</span>
              <strong>{{ formatPoints(frozenCents) }}</strong>
            </article>
            <article>
              <i class="bi bi-coin" aria-hidden="true"></i>
              <span>普通积分</span>
              <strong>{{ formatPoints(normalBalanceCents) }}</strong>
              <small v-if="normalFrozenCents">含冻结 {{ formatPoints(normalFrozenCents) }}</small>
            </article>
            <article class="is-trial">
              <i class="bi bi-stars" aria-hidden="true"></i>
              <span>{{ trialFeatureLabel }}体验</span>
              <strong>{{ formatPoints(trialBalanceCents) }}</strong>
              <small v-if="trialFrozenCents">含冻结 {{ formatPoints(trialFrozenCents) }}</small>
              <small v-else-if="trialBalanceCents > 0">仅限对应功能</small>
            </article>
          </div>

          <aside
            v-if="showTrialReward"
            class="wallet-trial"
            :class="{ 'is-used': trialApplication.rewardStatus === 'redeemed' }"
          >
            <span class="wallet-trial__icon" aria-hidden="true"><i class="bi bi-gift"></i></span>
            <div class="wallet-trial__copy">
              <strong>{{ trialFeatureLabel }}体验礼包</strong>
              <p>
                {{
                  trialApplication.rewardStatus === 'redeemed'
                    ? `已到账，仅用于${trialFeatureLabel}`
                    : `领取后仅用于${trialFeatureLabel}`
                }}
              </p>
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
          </aside>
          <p v-else-if="trialError" class="wallet-trial-error">{{ trialError }}</p>
        </div>
      </aside>

      <section class="wallet-ledger" aria-label="账本明细">
        <header class="wallet-ledger__head">
          <div>
            <h2>账本明细</h2>
            <p>入账、消费、冻结与退款</p>
          </div>
          <span v-if="ledgerError" class="wallet-ledger__error">{{ ledgerError }}</span>
          <span v-else-if="ledgerLoading" class="wallet-ledger__loading">更新中…</span>
        </header>

        <div class="wallet-tabs" role="tablist" aria-label="账本分类">
          <button
            v-for="tab in LEDGER_FILTERS"
            :key="tab.id"
            type="button"
            role="tab"
            class="wallet-tabs__btn"
            :class="{ 'is-active': ledgerFilter === tab.id }"
            :aria-selected="ledgerFilter === tab.id"
            @click="ledgerFilter = tab.id"
          >
            {{ tab.label }}
            <em v-if="filterCounts[tab.id]">{{ filterCounts[tab.id] }}</em>
          </button>
        </div>

        <div class="wallet-ledger__scroll">
          <div
            v-if="ledgerLoading && !ledger.length"
            class="wallet-skel is-inline"
            aria-hidden="true"
          >
            <div v-for="n in 6" :key="n" class="wallet-skel__row"></div>
          </div>

          <div v-else-if="ledgerDayGroups.length" class="wallet-ledger__groups">
            <section v-for="group in ledgerDayGroups" :key="group.key" class="wallet-day">
              <header class="wallet-day__head">
                <strong>{{ group.label }}</strong>
                <span>{{ group.items.length }}</span>
              </header>
              <ul class="wallet-ledger__list">
                <li
                  v-for="entry in group.items"
                  :key="entry.id"
                  :class="[`is-${entry.presentation.tone}`, `cat-${entry.category}`]"
                >
                  <span class="wallet-ledger__icon" aria-hidden="true">
                    <i class="bi" :class="entry.presentation.icon"></i>
                  </span>
                  <div class="wallet-ledger__body">
                    <div class="wallet-ledger__main">
                      <strong>{{ entry.presentation.title }}</strong>
                      <span>{{ entry.presentation.badge }}</span>
                      <span v-if="entry.creditBucket === 'trial'" class="is-trial">体验</span>
                      <span v-else-if="entry.creditBucket === 'mixed'">混合</span>
                    </div>
                    <p>{{ entry.presentation.description }}</p>
                    <small>
                      {{ formatClock(entry.createdAt) }}
                      <template v-if="entry.presentation.meta">
                        · {{ entry.presentation.meta }}
                      </template>
                    </small>
                  </div>
                  <b :class="`is-${entry.presentation.amountTone}`">{{
                    entry.presentation.amount
                  }}</b>
                </li>
              </ul>
            </section>
          </div>

          <p v-else-if="!ledgerLoading" class="wallet-empty">
            {{ ledgerFilter === 'all' ? '暂无余额变动记录' : '当前分类暂无记录' }}
          </p>
        </div>

        <nav v-if="showLedgerPager" class="wallet-pager" aria-label="账本分页">
          <button
            type="button"
            class="wallet-pager__btn"
            :disabled="ledgerLoading || !hasPrevLedgerPage"
            @click="goLedgerPage(-1)"
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
            上一页
          </button>
          <div class="wallet-pager__meta">
            <strong>第 {{ ledgerPage }} 页</strong>
            <small>{{ ledgerRows.length }} 条本页</small>
          </div>
          <button
            type="button"
            class="wallet-pager__btn"
            :disabled="ledgerLoading || !hasNextLedgerPage"
            @click="goLedgerPage(1)"
          >
            下一页
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </nav>
      </section>
    </div>

    <RedeemCodeDialog
      :open="redeemDialogOpen"
      @close="closeRedeemDialog"
      @success="onRedeemSuccess"
    />
  </main>
</template>

<style scoped>
.wallet {
  --ink: #17171f;
  --muted: #777785;
  --line: rgb(21 22 31 / 9%);
  --accent: #6d5cff;
  --accent-deep: #5746e5;
  --accent-soft: rgb(109 92 255 / 10%);
  --surface: #ffffff;
  --surface-soft: #f6f5fc;
  --bg: #efeef7;
  --income: #0f9f6e;
  --income-soft: rgb(15 159 110 / 12%);
  --spend: #e11d48;
  --spend-soft: rgb(225 29 72 / 10%);
  --pending: #d97706;
  --pending-soft: rgb(217 119 6 / 12%);
  --refund: #0284c7;
  --refund-soft: rgb(2 132 199 / 12%);
  box-sizing: border-box;
  width: 100%;
  height: calc(100dvh - var(--app-header-offset, 72px));
  padding: 14px 0;
  overflow: hidden;
  color: var(--ink);
  background:
    radial-gradient(ellipse 50% 42% at 6% 0%, rgb(109 92 255 / 16%), transparent 58%),
    radial-gradient(ellipse 38% 32% at 96% 6%, rgb(139 123 255 / 11%), transparent 52%),
    var(--bg);
}

.wallet.is-dark {
  --ink: rgba(255, 255, 255, 0.96);
  --muted: rgba(255, 255, 255, 0.52);
  --line: rgb(255 255 255 / 9%);
  --accent: #8b7bff;
  --accent-deep: #a99cff;
  --accent-soft: rgb(109 92 255 / 16%);
  --surface: #1a1824;
  --surface-soft: #15131f;
  --bg: #121218;
  --income: #68c994;
  --income-soft: rgb(104 201 148 / 14%);
  --spend: #fb7185;
  --spend-soft: rgb(251 113 133 / 14%);
  --pending: #fbbf24;
  --pending-soft: rgb(251 191 36 / 14%);
  --refund: #38bdf8;
  --refund-soft: rgb(56 189 248 / 14%);
  background:
    radial-gradient(ellipse 48% 38% at 8% 0%, rgb(109 92 255 / 18%), transparent 56%),
    radial-gradient(ellipse 34% 28% at 92% 8%, rgb(139 123 255 / 12%), transparent 50%),
    var(--bg);
}

.wallet-layout,
.wallet-error,
.wallet-skel {
  width: calc(100% - 40px);
  max-width: 1360px;
  margin-inline: auto;
}

.wallet-layout {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.wallet-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
  background: var(--surface);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 720;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    filter 0.15s ease;
}

.wallet-btn.is-primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 10px 22px rgb(109 92 255 / 22%);
}

.wallet-btn.is-ghost {
  background: color-mix(in srgb, var(--surface-soft) 80%, transparent);
}

.wallet-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--line));
  color: var(--accent-deep);
}

.wallet-btn.is-primary:hover:not(:disabled) {
  color: #fff;
  filter: brightness(1.04);
}

.wallet-btn.is-light {
  color: var(--accent-deep);
  border-color: transparent;
  background: #fff;
}

.wallet-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wallet-aside {
  display: grid;
  min-height: 0;
  height: 100%;
}

.wallet-aside__card {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--surface);
  box-shadow: 0 16px 40px rgb(23 23 31 / 5%);
}

.wallet-aside__glow {
  position: absolute;
  inset: -28% -18% auto -28%;
  height: 58%;
  background:
    radial-gradient(circle at 28% 40%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 62%),
    radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 55%);
  pointer-events: none;
}

.wallet-aside__hero {
  position: relative;
  z-index: 1;
  padding: 22px 22px 14px;
}

.wallet-aside__label {
  display: block;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 720;
  letter-spacing: 0.06em;
}

.wallet-aside__amount {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 8px 0 0;
}

.wallet-aside__amount strong {
  font-size: clamp(2.2rem, 3.2vw, 2.85rem);
  font-weight: 860;
  letter-spacing: -0.05em;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(135deg, var(--ink) 38%, var(--accent-deep));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.wallet.is-dark .wallet-aside__amount strong {
  background: linear-gradient(135deg, #fff 35%, var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
}

.wallet-aside__amount small {
  color: var(--muted);
  font-size: 0.9rem;
  font-weight: 700;
}

.wallet-aside__hint {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 0.74rem;
}

.wallet-aside__cta {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.15fr 1fr 0.85fr 0.85fr;
  gap: 8px;
  padding: 0 18px 16px;
}

.wallet-aside__cta > .wallet-btn {
  min-width: 0;
  padding-inline: 8px;
}

.wallet-metrics {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
  min-height: 0;
  padding: 0 18px 16px;
  align-content: stretch;
}

.wallet-metrics > article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  align-content: center;
  gap: 2px 10px;
  min-height: 0;
  padding: 14px 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-soft) 78%, var(--surface));
}

.wallet-metrics > article > i {
  grid-row: 1 / span 3;
  align-self: center;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  font-size: 0.95rem;
}

.wallet-metrics span {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
}

.wallet-metrics strong {
  font-size: 1.05rem;
  font-weight: 820;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}

.wallet-metrics small {
  color: var(--muted);
  font-size: 0.62rem;
}

.wallet-metrics > article.is-warn > i,
.wallet-metrics > article.is-warn strong {
  color: var(--pending);
}

.wallet-metrics > article.is-warn > i {
  background: var(--pending-soft);
}

.wallet-metrics > article.is-trial > i,
.wallet-metrics > article.is-trial strong {
  color: var(--accent-deep);
}

.wallet-trial {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 0 14px 14px;
  padding: 12px 12px;
  color: #fff;
  border-radius: 14px;
  background: linear-gradient(135deg, #5b4de8 0%, #6d5cff 55%, #8b7bff 100%);
  box-shadow: 0 12px 28px rgb(109 92 255 / 16%);
}

.wallet-trial.is-used {
  filter: saturate(0.55);
}

.wallet-trial__icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  color: var(--accent-deep);
  background: #fff;
  font-size: 1rem;
}

.wallet-trial__copy strong {
  display: block;
  font-size: 0.8rem;
  font-weight: 780;
}

.wallet-trial__copy p {
  margin: 2px 0 0;
  color: rgb(255 255 255 / 82%);
  font-size: 0.66rem;
  line-height: 1.35;
}

.wallet-trial > em {
  padding: 4px 9px;
  border-radius: 999px;
  color: var(--accent-deep);
  background: #fff;
  font-style: normal;
  font-size: 0.64rem;
  font-weight: 800;
}

.wallet-trial-error {
  margin: 0 18px 14px;
  color: var(--spend);
  font-size: 0.72rem;
}

.wallet-ledger {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--surface);
  box-shadow: 0 16px 40px rgb(23 23 31 / 5%);
  padding: 14px 14px 10px;
  overflow: hidden;
}

.wallet-ledger__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.wallet-ledger__head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 840;
  letter-spacing: -0.02em;
}

.wallet-ledger__head p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 0.7rem;
}

.wallet-ledger__error {
  color: var(--spend);
  font-size: 0.72rem;
}

.wallet-ledger__loading {
  color: var(--muted);
  font-size: 0.72rem;
}

.wallet-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.wallet-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-soft);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 720;
  cursor: pointer;
}

.wallet-tabs__btn em {
  min-width: 1.05rem;
  padding: 0 5px;
  border-radius: 999px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  font-style: normal;
  font-size: 0.64rem;
  font-weight: 780;
  font-variant-numeric: tabular-nums;
}

.wallet-tabs__btn.is-active {
  color: #fff;
  background: var(--accent);
}

.wallet-tabs__btn.is-active em {
  color: var(--accent-deep);
  background: #fff;
}

.wallet-ledger__scroll {
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.wallet-ledger__groups {
  display: grid;
  gap: 2px;
  padding-bottom: 4px;
}

.wallet-day__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 4px 5px;
  position: sticky;
  top: 0;
  z-index: 1;
  background: linear-gradient(var(--surface) 72%, transparent);
}

.wallet-day__head strong {
  font-size: 0.74rem;
  font-weight: 780;
}

.wallet-day__head span {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.66rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.wallet-ledger__list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface-soft) 50%, var(--surface));
}

.wallet-ledger__list > li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 10px 11px;
  border-top: 1px solid var(--line);
  transition: background 0.15s ease;
}

.wallet-ledger__list > li:first-child {
  border-top: 0;
}

.wallet-ledger__list > li:hover {
  background: color-mix(in srgb, var(--accent-soft) 55%, transparent);
}

.wallet-ledger__icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  color: var(--muted);
  background: var(--surface);
  font-size: 0.88rem;
}

.wallet-ledger__list > li.is-pending .wallet-ledger__icon {
  color: var(--pending);
  background: var(--pending-soft);
}

.wallet-ledger__list > li.is-settled .wallet-ledger__icon,
.wallet-ledger__list > li.is-income .wallet-ledger__icon {
  color: var(--income);
  background: var(--income-soft);
}

.wallet-ledger__list > li.is-refund .wallet-ledger__icon {
  color: var(--refund);
  background: var(--refund-soft);
}

.wallet-ledger__list > li.is-spend .wallet-ledger__icon {
  color: var(--spend);
  background: var(--spend-soft);
}

.wallet-ledger__body {
  min-width: 0;
}

.wallet-ledger__main {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.wallet-ledger__main strong {
  font-size: 0.82rem;
  font-weight: 740;
}

.wallet-ledger__main span {
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface);
  font-size: 0.6rem;
  font-weight: 700;
}

.wallet-ledger__main span.is-trial {
  color: var(--accent-deep);
  background: var(--accent-soft);
}

.wallet-ledger__body p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.4;
}

.wallet-ledger__body small {
  display: block;
  margin-top: 2px;
  color: color-mix(in srgb, var(--muted) 82%, transparent);
  font-size: 0.62rem;
}

.wallet-ledger__list > li > b {
  font-size: 0.8rem;
  font-weight: 820;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.wallet-ledger__list > li > b.is-income {
  color: var(--income);
}

.wallet-ledger__list > li > b.is-spend {
  color: var(--spend);
}

.wallet-ledger__list > li > b.is-neutral {
  color: var(--muted);
}

.wallet-pager {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.wallet-pager__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--ink);
  background: var(--surface-soft);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 720;
  cursor: pointer;
}

.wallet-pager__btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--line));
  color: var(--accent-deep);
}

.wallet-pager__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.wallet-pager__meta {
  display: grid;
  justify-items: center;
  gap: 1px;
  text-align: center;
}

.wallet-pager__meta strong {
  font-size: 0.78rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.wallet-pager__meta small {
  color: var(--muted);
  font-size: 0.64rem;
}

.wallet-empty {
  display: grid;
  place-items: center;
  margin: 0;
  min-height: 180px;
  padding: 24px 12px;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
}

.wallet-error {
  display: grid;
  place-items: center;
  gap: 8px;
  height: 100%;
  min-height: 280px;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--surface);
  text-align: center;
}

.wallet-error i {
  color: var(--accent);
  font-size: 1.6rem;
}

.wallet-error p {
  margin: 0;
  color: var(--muted);
}

.wallet-skel {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  gap: 14px;
  height: 100%;
}

.wallet-skel.is-inline {
  display: grid;
  grid-template-columns: 1fr;
  width: 100%;
  margin: 0;
  height: auto;
  gap: 8px;
}

.wallet-skel__aside,
.wallet-skel__panel,
.wallet-skel__row {
  border-radius: 18px;
  background: linear-gradient(
    90deg,
    var(--surface) 25%,
    color-mix(in srgb, var(--accent) 10%, var(--surface)) 50%,
    var(--surface) 75%
  );
  background-size: 200% 100%;
  animation: wallet-shimmer 1.2s linear infinite;
}

.wallet-skel__aside,
.wallet-skel__panel {
  min-height: 100%;
}

.wallet-skel__row {
  height: 56px;
  border-radius: 12px;
}

@keyframes wallet-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 1080px) {
  .wallet-aside__cta {
    grid-template-columns: 1fr 1fr;
  }

  .wallet-metrics {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    overflow: auto;
  }
}

@media (max-width: 980px) {
  .wallet {
    height: auto;
    min-height: calc(100dvh - var(--app-header-offset, 72px));
    overflow: auto;
  }

  .wallet-layout,
  .wallet-skel {
    grid-template-columns: 1fr;
    height: auto;
  }

  .wallet-aside,
  .wallet-aside__card {
    height: auto;
  }

  .wallet-aside__card {
    grid-template-rows: auto;
  }

  .wallet-metrics {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto;
    overflow: visible;
  }

  .wallet-ledger {
    height: min(68dvh, 640px);
    min-height: 420px;
  }
}

@media (max-width: 640px) {
  .wallet {
    padding: 10px 0 14px;
  }

  .wallet-layout,
  .wallet-error,
  .wallet-skel {
    width: calc(100% - 20px);
    max-width: none;
  }

  .wallet-aside__hero {
    padding: 18px 16px 12px;
  }

  .wallet-aside__cta,
  .wallet-metrics {
    padding-inline: 14px;
  }

  .wallet-aside__cta {
    grid-template-columns: 1fr 1fr;
  }

  .wallet-metrics {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .wallet-trial {
    grid-template-columns: 34px minmax(0, 1fr);
    margin-inline: 12px;
  }

  .wallet-trial > .wallet-btn,
  .wallet-trial > em {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .wallet-ledger {
    border-radius: 18px;
    padding: 12px 10px 8px;
  }

  .wallet-tabs {
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }

  .wallet-tabs__btn {
    flex: 0 0 auto;
  }

  .wallet-ledger__list > li {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .wallet-ledger__list > li > b {
    grid-column: 2;
    justify-self: start;
  }

  .wallet-pager {
    grid-template-columns: 1fr auto 1fr;
  }

  .wallet-pager__btn:last-child {
    justify-self: end;
  }
}
</style>
