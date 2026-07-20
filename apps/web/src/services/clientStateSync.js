import { syncAiWallpaperState } from '@/services/aiWallpaperState'
import {
  clearClientStateSyncMeta,
  isCloudSyncEnabled,
} from '@/services/clientState'
import { useDownloadsStore } from '@/stores/downloads'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useSettingsStore } from '@/stores/settings'
import { useUserStore } from '@/stores/user'

function repairLocalStoresBeforeCloudSync() {
  const favoritesStore = useFavoritesStore()
  return {
    restoredFavorites: favoritesStore.repairFromBackupForSync?.() === true,
  }
}

/**
 * Push all supported local client-state buckets to the current account cloud.
 */
export async function pushAllLocalClientStateToCloud() {
  if (!isCloudSyncEnabled()) {
    return { skipped: true, reason: '云同步未开启' }
  }

  const settingsStore = useSettingsStore()
  const favoritesStore = useFavoritesStore()
  const historyStore = useHistoryStore()
  const userStore = useUserStore()
  const downloadsStore = useDownloadsStore()

  const results = await Promise.allSettled([
    settingsStore.syncSettingsState?.(),
    favoritesStore.syncFavoritesState?.(),
    historyStore.syncHistoryState?.(),
    userStore.syncAuthorsState?.(),
    userStore.syncTagsState?.(),
    downloadsStore.syncDownloadsState?.(),
    syncAiWallpaperState(),
  ])

  return results
}

/**
 * Repair recoverable local-only data, reset stale sync metadata, then publish local snapshots.
 */
export async function reconcileLocalClientStateToCloud(options = {}) {
  if (!isCloudSyncEnabled()) {
    return { skipped: true, reason: '云同步未开启' }
  }

  const repair = repairLocalStoresBeforeCloudSync()

  if (options.resetMeta !== false) {
    clearClientStateSyncMeta()
  }

  const results = await pushAllLocalClientStateToCloud()
  return { repair, results }
}
