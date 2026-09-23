import { onScopeDispose, ref, watch } from 'vue'

const STORAGE_KEY = 'admin.tasks.autoRefresh'

function normalizeSeconds(value: unknown): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 5 && seconds <= 300
    ? Math.round(seconds) : 15
}

/** Keep polling and the elapsed-time clock under the same persisted switch. */
export function useTaskAutoRefresh(refresh: () => void, tick: () => void, canRefresh: () => boolean) {
  let saved: { enabled?: boolean; intervalSeconds?: number } = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}
  } catch { /* Storage may be unavailable or contain an older value. */ }
  const autoRefresh = ref(saved.enabled !== false)
  const refreshIntervalSeconds = ref(normalizeSeconds(saved.intervalSeconds))
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  let elapsedTimer: ReturnType<typeof setInterval> | undefined

  function stop() {
    clearInterval(refreshTimer)
    clearInterval(elapsedTimer)
    refreshTimer = undefined
    elapsedTimer = undefined
  }

  watch([autoRefresh, refreshIntervalSeconds], () => {
    stop()
    const seconds = normalizeSeconds(refreshIntervalSeconds.value)
    if (seconds !== refreshIntervalSeconds.value) {
      refreshIntervalSeconds.value = seconds
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: autoRefresh.value, intervalSeconds: seconds }))
    } catch { /* Preferences still work for this visit without storage. */ }
    if (!autoRefresh.value) return
    refreshTimer = setInterval(() => {
      if (autoRefresh.value && document.visibilityState === 'visible' && canRefresh()) refresh()
    }, seconds * 1000)
    elapsedTimer = setInterval(() => {
      if (autoRefresh.value && document.visibilityState === 'visible') tick()
    }, 1000)
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(stop)
  return { autoRefresh, refreshIntervalSeconds }
}
