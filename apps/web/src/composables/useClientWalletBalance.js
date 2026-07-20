import { computed, ref } from 'vue'
import { getWallet } from '@/services/meApi'
import { useAuthStore } from '@/stores/auth'

const walletSnapshot = ref(null)
const walletLoading = ref(false)
let inflightRefresh = null

export function useClientWalletBalance() {
  const authStore = useAuthStore()

  const balanceCents = computed(() => Number(walletSnapshot.value?.balanceCents || 0))
  const frozenCents = computed(() => Number(walletSnapshot.value?.frozenCents || 0))
  const availableCents = computed(() => Math.max(0, balanceCents.value - frozenCents.value))
  const balanceDisplay = computed(() => `¥${(availableCents.value / 100).toFixed(2)}`)
  const walletFetchedAt = computed(() => walletSnapshot.value?.fetchedAt || 0)

  async function refreshWalletBalance({ force = false } = {}) {
    if (!authStore.isAuthenticated) {
      walletSnapshot.value = null
      return null
    }
    if (!force && inflightRefresh) return inflightRefresh

    walletLoading.value = true
    inflightRefresh = getWallet()
      .then((wallet) => {
        walletSnapshot.value = {
          balanceCents: Number(wallet?.balanceCents || 0),
          frozenCents: Number(wallet?.frozenCents || 0),
          fetchedAt: Date.now(),
        }
        return walletSnapshot.value
      })
      .finally(() => {
        walletLoading.value = false
        inflightRefresh = null
      })

    return inflightRefresh
  }

  return {
    balanceCents,
    frozenCents,
    availableCents,
    balanceDisplay,
    walletLoading,
    walletFetchedAt,
    refreshWalletBalance,
  }
}
