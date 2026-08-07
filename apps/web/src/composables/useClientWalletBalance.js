import { computed, ref } from 'vue'
import { getWallet } from '@/services/meApi'
import { useAuthStore } from '@/stores/auth'
import { formatPoints } from '@/services/billingApi'

export const WALLET_UPDATED_EVENT = 'starclouds:wallet-updated'

const walletSnapshot = ref(null)
const walletLoading = ref(false)
let inflightRefresh = null

function emitWalletUpdated(snapshot) {
  if (typeof window === 'undefined' || !snapshot) return
  window.dispatchEvent(new CustomEvent(WALLET_UPDATED_EVENT, { detail: snapshot }))
}

function applyWalletSnapshot(partial = {}) {
  const prev = walletSnapshot.value || {}
  const available = Number(
    partial.availableCents ?? partial.balanceCents ?? prev.availableCents ?? prev.balanceCents ?? 0,
  )
  const frozen = Number(partial.frozenCents ?? prev.frozenCents ?? 0)
  walletSnapshot.value = {
    // balanceCents 保留为兼容字段；availableCents 是唯一的可用余额口径。
    balanceCents: available,
    availableCents: available,
    frozenCents: frozen,
    totalCents: Number(partial.totalCents ?? available + frozen),
    normalBalanceCents: Number(
      partial.normalBalanceCents ?? prev.normalBalanceCents ?? partial.balanceCents ?? 0,
    ),
    trialBalanceCents: Number(partial.trialBalanceCents ?? prev.trialBalanceCents ?? 0),
    normalFrozenCents: Number(
      partial.normalFrozenCents ?? prev.normalFrozenCents ?? partial.frozenCents ?? 0,
    ),
    trialFrozenCents: Number(partial.trialFrozenCents ?? prev.trialFrozenCents ?? 0),
    fetchedAt: Date.now(),
  }
  emitWalletUpdated(walletSnapshot.value)
  return walletSnapshot.value
}

export function useClientWalletBalance() {
  const authStore = useAuthStore()

  const balanceCents = computed(() => Number(walletSnapshot.value?.availableCents || 0))
  const frozenCents = computed(() => Number(walletSnapshot.value?.frozenCents || 0))
  const normalBalanceCents = computed(() => Number(walletSnapshot.value?.normalBalanceCents || 0))
  const trialBalanceCents = computed(() => Number(walletSnapshot.value?.trialBalanceCents || 0))
  const normalFrozenCents = computed(() => Number(walletSnapshot.value?.normalFrozenCents || 0))
  const trialFrozenCents = computed(() => Number(walletSnapshot.value?.trialFrozenCents || 0))
  // 服务端 balanceCents 已是扣除冻结额后的可用余额；frozenCents 仅用于展示账户总额。
  const availableCents = computed(() => Math.max(0, balanceCents.value))
  const totalCents = computed(() => Math.max(0, Number(walletSnapshot.value?.totalCents || 0)))
  const balanceDisplay = computed(() => formatPoints(availableCents.value))
  const walletFetchedAt = computed(() => walletSnapshot.value?.fetchedAt || 0)

  async function refreshWalletBalance({ force = false } = {}) {
    if (!authStore.isAuthenticated) {
      walletSnapshot.value = null
      emitWalletUpdated(null)
      return null
    }
    if (!force && inflightRefresh) return inflightRefresh

    walletLoading.value = true
    const request = getWallet()
      .then((wallet) =>
        applyWalletSnapshot({
          balanceCents: Number(wallet?.balanceCents || 0),
          availableCents: Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0),
          frozenCents: Number(wallet?.frozenCents || 0),
          totalCents: Number(
            wallet?.totalCents ??
              Number(wallet?.availableCents ?? wallet?.balanceCents ?? 0) +
                Number(wallet?.frozenCents || 0),
          ),
          normalBalanceCents: Number(wallet?.normalBalanceCents || 0),
          trialBalanceCents: Number(wallet?.trialBalanceCents || 0),
          normalFrozenCents: Number(wallet?.normalFrozenCents || 0),
          trialFrozenCents: Number(wallet?.trialFrozenCents || 0),
        }),
      )
      .finally(() => {
        walletLoading.value = false
        if (inflightRefresh === request) inflightRefresh = null
      })

    inflightRefresh = request
    return request
  }

  return {
    balanceCents,
    frozenCents,
    normalBalanceCents,
    trialBalanceCents,
    normalFrozenCents,
    trialFrozenCents,
    availableCents,
    totalCents,
    balanceDisplay,
    walletLoading,
    walletFetchedAt,
    refreshWalletBalance,
    applyWalletSnapshot,
  }
}
