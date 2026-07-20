import { computed, ref } from 'vue'
import { getClientResourceSummary } from '@/services/aiWallpaper'
import {
  formatMoneyDisplay,
  normalizeClientResourceSummary,
  resolveAvailableUsdBalance,
} from '@/features/pricing/pricingMoney.js'
import { useAuthStore } from '@/stores/auth'

const walletSnapshot = ref(null)
const walletLoading = ref(false)
let inflightRefresh = null

function readAvailableUsd(snapshot = walletSnapshot.value) {
  if (!snapshot) return 0
  const wallet = snapshot.wallet || snapshot.account || {}
  return resolveAvailableUsdBalance(wallet)
}

export function applyWalletFromSummary(summary = {}) {
  const normalized = normalizeClientResourceSummary(summary)
  walletSnapshot.value = {
    wallet: normalized.wallet,
    account: normalized.account,
    fetchedAt: Date.now(),
  }
  return walletSnapshot.value
}

export function useClientWalletBalance() {
  const authStore = useAuthStore()

  const availableUsd = computed(() => readAvailableUsd())
  const balanceDisplay = computed(() => formatMoneyDisplay(availableUsd.value))
  const walletFetchedAt = computed(() => walletSnapshot.value?.fetchedAt || 0)

  async function refreshWalletBalance({ force = false } = {}) {
    if (!authStore.isAuthenticated) {
      walletSnapshot.value = null
      return null
    }
    if (!force && inflightRefresh) return inflightRefresh

    walletLoading.value = true
    inflightRefresh = getClientResourceSummary({ scope: 'usage' })
      .then((data) => applyWalletFromSummary(data?.summary || {}))
      .catch((error) => {
        throw error
      })
      .finally(() => {
        walletLoading.value = false
        inflightRefresh = null
      })

    return inflightRefresh
  }

  return {
    availableUsd,
    balanceDisplay,
    walletLoading,
    walletFetchedAt,
    applyWalletFromSummary,
    refreshWalletBalance,
  }
}
