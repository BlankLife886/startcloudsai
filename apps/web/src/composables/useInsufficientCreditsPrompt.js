import { ref } from 'vue'
import { fetchStudioCreditAccountSnapshot } from '@/features/ai-shared/studioUsage'
import { useAuthStore } from '@/stores/auth'

export const INSUFFICIENT_CREDITS_CODE = 'INSUFFICIENT_CREDITS'

export function isInsufficientCreditsError(error) {
  if (!error) return false
  if (error.code === INSUFFICIENT_CREDITS_CODE) return true
  const message = String(error.message || error || '')
  return /积分余额不足|积分不足|insufficient.*credit/i.test(message)
}

export function useInsufficientCreditsPrompt() {
  const authStore = useAuthStore()
  const dialogOpen = ref(false)
  const requiredCredits = ref(0)
  const availableCredits = ref(0)

  async function readAvailableCredits() {
    if (!authStore.isAuthenticated) return 0
    const data = await fetchStudioCreditAccountSnapshot()
    return Number(data.creditAvailable || 0)
  }

  function openPrompt(payload = {}) {
    requiredCredits.value = Math.max(0, Number(payload.required || 0))
    availableCredits.value = Math.max(0, Number(payload.available || 0))
    dialogOpen.value = true
  }

  function closePrompt() {
    dialogOpen.value = false
  }

  async function ensureCreditsAvailable(required, options = {}) {
    const amount = Math.max(0, Number(required || 0))
    if (amount <= 0) return true
    if (!authStore.isAuthenticated) return false
    const available =
      options.available != null ? Number(options.available || 0) : await readAvailableCredits()
    if (available + 1e-9 >= amount) return true
    openPrompt({ required: amount, available })
    const error = new Error('壁纸积分不足')
    error.code = INSUFFICIENT_CREDITS_CODE
    error.required = amount
    error.available = available
    throw error
  }

  function handleCreditError(error) {
    if (!isInsufficientCreditsError(error)) return false
    openPrompt({
      required: Number(error.required || 0),
      available: Number(error.available || 0),
    })
    return true
  }

  return {
    dialogOpen,
    requiredCredits,
    availableCredits,
    readAvailableCredits,
    ensureCreditsAvailable,
    openPrompt,
    closePrompt,
    handleCreditError,
  }
}
