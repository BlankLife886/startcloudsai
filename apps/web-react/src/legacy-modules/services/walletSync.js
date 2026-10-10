import { apiGet } from './apiClient.js'

export const WALLET_UPDATED_EVENT = 'starclouds:wallet-updated'
const WALLET_CHANNEL = 'starclouds:wallet-sync'

let channel = null
let refreshTimer = 0
let refreshPromise = null

function dispatchLocal(snapshot) {
  if (!snapshot || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WALLET_UPDATED_EVENT, { detail: snapshot }))
}

function walletChannel() {
  if (channel || typeof window === 'undefined' || !window.location || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(WALLET_CHANNEL)
  channel.addEventListener('message', (event) => dispatchLocal(event?.data))
  return channel
}

export function publishWalletSnapshot(snapshot, { broadcast = true } = {}) {
  if (!snapshot) return null
  dispatchLocal(snapshot)
  if (broadcast) walletChannel()?.postMessage(snapshot)
  return snapshot
}

export async function refreshWalletSnapshot() {
  if (refreshPromise) return refreshPromise
  refreshPromise = apiGet('/me/wallet', { fallbackMessage: '钱包读取失败' })
    .then((snapshot) => publishWalletSnapshot(snapshot))
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

export function scheduleWalletRefresh(delay = 120) {
  if (typeof window === 'undefined' || !window.location) return
  if (refreshTimer) globalThis.clearTimeout(refreshTimer)
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0
    void refreshWalletSnapshot().catch(() => null)
  }, Math.max(0, Number(delay) || 0))
}

// Start listening lazily at module load so wallet changes from another tab are
// available before a page-specific wallet component mounts.
walletChannel()
