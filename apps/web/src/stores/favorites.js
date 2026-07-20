import storageService from '@/services/storage'
import notificationService from '@/services/notification'
import {
  fetchClientStateQuietly,
  getCloudSyncConflictStrategy,
  isCloudSyncEnabled,
  scheduleClientStatePushQuietly,
  shouldApplyRemoteClientState,
} from '@/services/clientState'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRuntimeConfigStore } from './runtimeConfig'

export const useFavoritesStore = defineStore('favorites', () => {
  // 状态
  const favorites = ref([])
  const isLoading = ref(false)
  const error = ref(null)
  const lastBackupTime = ref(null)
  const collections = ref([]) // 收藏集合
  const selectedCollection = ref(null) // 当前选中的收藏集合
  const statistics = ref({
    totalCount: 0,
    byCategory: {},
    byResolution: {},
    byUploader: {},
    lastUpdated: null,
  }) // 收藏统计数据
  let initPromise = null
  let hasInitialized = false

  // 备份键名
  const FAVORITES_KEY = 'favorites'
  const FAVORITES_BACKUP_KEY = 'favorites_backup'
  const BACKUP_TIMESTAMP_KEY = 'favorites_backup_timestamp'
  const FAVORITES_CLEARED_MARKER_KEY = 'favorites_cleared_marker'

  function normalizeFavoriteItem(item) {
    if (!item || Array.isArray(item.collections)) {
      return item
    }

    return {
      ...item,
      collections: [],
    }
  }

  function normalizeFavoritesList(list = []) {
    let changed = false
    const normalized = list.map((item) => {
      const next = normalizeFavoriteItem(item)
      if (next !== item) {
        changed = true
      }
      return next
    })

    return { normalized, changed }
  }

  function extractRemoteFavoritesPayload(remotePayload = {}) {
    const remoteFavorites = Array.isArray(remotePayload.favorites)
      ? remotePayload.favorites
      : Array.isArray(remotePayload)
        ? remotePayload
        : []
    const remoteCollections = Array.isArray(remotePayload.collections)
      ? remotePayload.collections
      : []
    const remoteStatistics =
      remotePayload.statistics && typeof remotePayload.statistics === 'object'
        ? remotePayload.statistics
        : null

    return { remoteFavorites, remoteCollections, remoteStatistics }
  }

  function mergeFavoriteLists(remoteFavorites = [], localFavorites = []) {
    const favoriteMap = new Map()
    ;[...remoteFavorites, ...localFavorites].forEach((item) => {
      if (!item?.id) return
      const existing = favoriteMap.get(item.id) || {}
      const existingCollections = Array.isArray(existing.collections) ? existing.collections : []
      const nextCollections = Array.isArray(item.collections) ? item.collections : []
      favoriteMap.set(item.id, {
        ...existing,
        ...item,
        collections: Array.from(new Set([...existingCollections, ...nextCollections])),
      })
    })

    return Array.from(favoriteMap.values()).sort((a, b) => {
      const at = Date.parse(a.favorited_at || a.created_at || 0)
      const bt = Date.parse(b.favorited_at || b.created_at || 0)
      return bt - at
    })
  }

  function mergeFavoriteCollections(remoteCollections = [], localCollections = []) {
    const collectionMap = new Map()
    ;[...remoteCollections, ...localCollections].forEach((collection) => {
      if (!collection?.id) return
      collectionMap.set(collection.id, {
        ...(collectionMap.get(collection.id) || {}),
        ...collection,
      })
    })
    return Array.from(collectionMap.values())
  }

  function applyFavoritesPayload(remotePayload = {}, strategy = 'remote') {
    const { remoteFavorites, remoteCollections, remoteStatistics } =
      extractRemoteFavoritesPayload(remotePayload)
    const { normalized: normalizedRemoteFavorites } = normalizeFavoritesList(remoteFavorites)

    if (strategy === 'merge') {
      favorites.value = mergeFavoriteLists(normalizedRemoteFavorites, favorites.value)
      collections.value = mergeFavoriteCollections(remoteCollections, collections.value)
    } else if (strategy === 'remote') {
      favorites.value = normalizedRemoteFavorites
      collections.value = remoteCollections
    }

    storageService.set(FAVORITES_KEY, favorites.value)
    storageService.set('favorite_collections', collections.value)

    if (typeof remotePayload.lastBackupTime === 'string' && remotePayload.lastBackupTime) {
      lastBackupTime.value = new Date(remotePayload.lastBackupTime)
      storageService.set(BACKUP_TIMESTAMP_KEY, remotePayload.lastBackupTime)
    }

    if (remoteStatistics && strategy === 'remote') {
      statistics.value = remoteStatistics
      storageService.set('favorites_statistics', statistics.value)
      return false
    }

    return true
  }

  function syncFavoritesState() {
    if (isLoading.value) {
      return Promise.resolve({
        success: false,
        skipped: true,
        reason: 'favorites hydrating',
      })
    }

    return scheduleClientStatePushQuietly('favorites', () => ({
      favorites: favorites.value,
      collections: collections.value,
      statistics: statistics.value,
      lastBackupTime: lastBackupTime.value ? lastBackupTime.value.toISOString() : null,
    }))
  }

  // 计算属性
  const favoritesCount = computed(() => favorites.value.length)
  const isFavorited = computed(() => (id) => favorites.value.some((item) => item.id === id))

  // 当前收藏集合中的壁纸
  const collectionFavorites = computed(() => {
    if (!selectedCollection.value) return favorites.value

    return favorites.value.filter((item) => {
      return item.collections && item.collections.includes(selectedCollection.value.id)
    })
  })

  // 收藏集合数量
  const collectionsCount = computed(() => collections.value.length)

  // 监听收藏变化，延迟创建精简备份
  let backupTimer = null
  watch(
    favorites,
    (newValue) => {
      if (isLoading.value || newValue.length === 0) {
        return
      }

      if (backupTimer) clearTimeout(backupTimer)
      backupTimer = setTimeout(() => {
        createBackup()
      }, 8000)
    },
    { deep: true },
  )

  // 初始化收藏列表
  async function initFavorites(options = {}) {
    if (hasInitialized && !options.forceRemote) return true
    if (initPromise) return initPromise

    initPromise = loadFavorites(options)
    try {
      const result = await initPromise
      hasInitialized = true
      return result
    } finally {
      initPromise = null
    }
  }

  async function reloadFavorites(options = {}) {
    hasInitialized = false
    return initFavorites(options)
  }

  function repairFromBackupForSync() {
    const hasExplicitClearMarker = !!storageService.get(FAVORITES_CLEARED_MARKER_KEY, null)
    if (hasExplicitClearMarker || favorites.value.length > 0) {
      return false
    }

    const backup = storageService.get(FAVORITES_BACKUP_KEY, [])
    if (!Array.isArray(backup) || backup.length === 0) {
      return false
    }

    const { normalized } = normalizeFavoritesList(backup)
    if (!normalized.length) {
      return false
    }

    favorites.value = normalized
    storageService.set(FAVORITES_KEY, normalized)
    updateCollectionCounts({ syncRemote: false })
    updateStatistics({ syncRemote: false })
    return true
  }

  async function mergeCloudFavorites() {
    repairFromBackupForSync()
    const remoteState = await fetchClientStateQuietly('favorites')
    const remotePayload = remoteState?.payload || {}
    const strategy = getCloudSyncConflictStrategy()
    if (strategy === 'remote' || strategy === 'merge') {
      applyFavoritesPayload(remotePayload, strategy)
    }
    updateCollectionCounts({ syncRemote: false })
    updateStatistics({ syncRemote: false })
    hasInitialized = true
    return syncFavoritesState()
  }

  async function loadFavorites(options = {}) {
    try {
      isLoading.value = true
      error.value = null

      // 从本地存储加载收藏
      let storedFavorites = storageService.get(FAVORITES_KEY, null)
      const hasExplicitClearMarker = !!storageService.get(FAVORITES_CLEARED_MARKER_KEY, null)
      let shouldRebuildStatistics = false

      // 只有主存储缺失/损坏时才自动从备份恢复；用户主动清空后的空数组必须保留。
      if (!Array.isArray(storedFavorites)) {
        console.log('主存储中没有收藏数据，尝试从备份恢复...')
        storedFavorites = storageService.get(FAVORITES_BACKUP_KEY, [])

        if (
          !hasExplicitClearMarker &&
          storedFavorites &&
          Array.isArray(storedFavorites) &&
          storedFavorites.length > 0
        ) {
          console.log(`从备份中恢复了 ${storedFavorites.length} 条收藏数据`)
          storageService.set(FAVORITES_KEY, storedFavorites)
        } else {
          storedFavorites = []
        }
      }

      const { normalized: localFavorites, changed: localFavoritesChanged } =
        normalizeFavoritesList(storedFavorites)
      favorites.value = localFavorites

      if (localFavoritesChanged) {
        storageService.set(FAVORITES_KEY, localFavorites)
      }

      // 加载收藏集合
      const storedCollections = storageService.get('favorite_collections', [])
      collections.value = Array.isArray(storedCollections) ? storedCollections : []
      if (!Array.isArray(storedCollections)) {
        storageService.set('favorite_collections', collections.value)
      }

      // 加载上次备份时间
      const timestamp = storageService.get(BACKUP_TIMESTAMP_KEY, null)
      if (timestamp) {
        lastBackupTime.value = new Date(timestamp)
      }

      // 加载统计数据
      const storedStatistics = storageService.get('favorites_statistics', null)
      if (storedStatistics && typeof storedStatistics === 'object') {
        statistics.value = storedStatistics
      } else {
        shouldRebuildStatistics = true
      }

      const remoteState = await fetchClientStateQuietly('favorites')
      if (remoteState?.payload) {
        const strategy = options.conflictStrategy || getCloudSyncConflictStrategy()
        const shouldApplyRemote =
          strategy === 'merge' ||
          (strategy !== 'local' &&
            (options.forceRemote ||
              shouldApplyRemoteClientState('favorites', remoteState.updatedAt)))

        if (shouldApplyRemote) {
          shouldRebuildStatistics = applyFavoritesPayload(
            remoteState.payload,
            strategy === 'merge' ? 'merge' : 'remote',
          )
        } else if (strategy === 'local') {
          void syncFavoritesState()
        }
      } else if (isCloudSyncEnabled()) {
        void syncFavoritesState()
      }

      if (shouldRebuildStatistics) {
        updateStatistics({ syncRemote: false })
      }

      isLoading.value = false
      return true
    } catch (err) {
      console.error('初始化收藏失败:', err)
      error.value = '加载收藏失败'
      isLoading.value = false
      throw err
    }
  }

  // 更新收藏统计数据
  function updateStatistics(options = {}) {
    try {
      const syncRemote = options.syncRemote === true
      const categoryStats = {}
      const resolutionStats = {}
      const uploaderStats = {}

      favorites.value.forEach((item) => {
        // 按分类统计
        if (item.category) {
          categoryStats[item.category] = (categoryStats[item.category] || 0) + 1
        }

        // 按分辨率统计
        if (item.resolution) {
          resolutionStats[item.resolution] = (resolutionStats[item.resolution] || 0) + 1
        }

        // 按上传者统计
        if (item.uploader) {
          uploaderStats[item.uploader] = (uploaderStats[item.uploader] || 0) + 1
        }
      })

      // 更新统计数据
      statistics.value = {
        totalCount: favorites.value.length,
        byCategory: categoryStats,
        byResolution: resolutionStats,
        byUploader: uploaderStats,
        lastUpdated: new Date().toISOString(),
      }

      // 保存到本地存储
      storageService.set('favorites_statistics', statistics.value)
      if (syncRemote) {
        void syncFavoritesState()
      }

      return statistics.value
    } catch (err) {
      console.error('更新收藏统计数据失败:', err)
      return null
    }
  }

  // 创建收藏集合
  function createCollection(name, description = '', icon = 'folder') {
    try {
      // 检查是否已存在同名集合
      if (collections.value.some((c) => c.name === name)) {
        return { success: false, message: '已存在同名收藏集合' }
      }

      // 创建新集合
      const newCollection = {
        id: 'collection_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        name,
        description,
        icon,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        count: 0,
      }

      // 添加到集合列表
      collections.value.push(newCollection)

      // 保存到本地存储
      storageService.set('favorite_collections', collections.value)
      void syncFavoritesState()

      return { success: true, collection: newCollection }
    } catch (err) {
      console.error('创建收藏集合失败:', err)
      return { success: false, message: '创建收藏集合失败' }
    }
  }

  // 更新收藏集合
  function updateCollection(id, updates) {
    try {
      // 查找集合
      const index = collections.value.findIndex((c) => c.id === id)
      if (index === -1) {
        return { success: false, message: '收藏集合不存在' }
      }

      // 更新集合
      const updatedCollection = {
        ...collections.value[index],
        ...updates,
        updated_at: new Date().toISOString(),
      }

      // 替换原集合
      collections.value.splice(index, 1, updatedCollection)

      // 保存到本地存储
      storageService.set('favorite_collections', collections.value)

      // 如果当前选中的是这个集合，更新选中的集合
      if (selectedCollection.value && selectedCollection.value.id === id) {
        selectedCollection.value = updatedCollection
      }

      void syncFavoritesState()

      return { success: true, collection: updatedCollection }
    } catch (err) {
      console.error('更新收藏集合失败:', err)
      return { success: false, message: '更新收藏集合失败' }
    }
  }

  // 删除收藏集合
  function deleteCollection(id) {
    try {
      // 查找集合
      const index = collections.value.findIndex((c) => c.id === id)
      if (index === -1) {
        return { success: false, message: '收藏集合不存在' }
      }

      // 从所有收藏中移除该集合
      favorites.value.forEach((item) => {
        if (item.collections && item.collections.includes(id)) {
          item.collections = item.collections.filter((cid) => cid !== id)
        }
      })

      // 删除集合
      collections.value.splice(index, 1)

      // 保存到本地存储
      storageService.set('favorite_collections', collections.value)
      storageService.set(FAVORITES_KEY, favorites.value)

      // 如果当前选中的是这个集合，清除选中
      if (selectedCollection.value && selectedCollection.value.id === id) {
        selectedCollection.value = null
      }

      void syncFavoritesState()

      return { success: true }
    } catch (err) {
      console.error('删除收藏集合失败:', err)
      return { success: false, message: '删除收藏集合失败' }
    }
  }

  // 选择收藏集合
  function selectCollection(collection) {
    selectedCollection.value = collection
  }

  // 清除选中的收藏集合
  function clearSelectedCollection() {
    selectedCollection.value = null
  }

  // 添加壁纸到收藏集合
  function addToCollection(wallpaperId, collectionId) {
    try {
      // 查找壁纸
      const wallpaperIndex = favorites.value.findIndex((item) => item.id === wallpaperId)
      if (wallpaperIndex === -1) {
        return { success: false, message: '壁纸不存在于收藏中' }
      }

      // 查找集合
      const collectionIndex = collections.value.findIndex((c) => c.id === collectionId)
      if (collectionIndex === -1) {
        return { success: false, message: '收藏集合不存在' }
      }

      // 初始化collections数组（如果不存在）
      if (!favorites.value[wallpaperIndex].collections) {
        favorites.value[wallpaperIndex].collections = []
      }

      // 检查是否已在集合中
      if (favorites.value[wallpaperIndex].collections.includes(collectionId)) {
        return { success: true, message: '壁纸已在该收藏集合中' }
      }

      // 添加到集合
      favorites.value[wallpaperIndex].collections.push(collectionId)

      // 更新集合计数
      collections.value[collectionIndex].count = (collections.value[collectionIndex].count || 0) + 1
      collections.value[collectionIndex].updated_at = new Date().toISOString()

      // 保存到本地存储
      storageService.set(FAVORITES_KEY, favorites.value)
      storageService.set('favorite_collections', collections.value)

      void syncFavoritesState()

      return { success: true }
    } catch (err) {
      console.error('添加壁纸到收藏集合失败:', err)
      return { success: false, message: '添加壁纸到收藏集合失败' }
    }
  }

  // 从收藏集合中移除壁纸
  function removeFromCollection(wallpaperId, collectionId) {
    try {
      // 查找壁纸
      const wallpaperIndex = favorites.value.findIndex((item) => item.id === wallpaperId)
      if (wallpaperIndex === -1) {
        return { success: false, message: '壁纸不存在于收藏中' }
      }

      // 查找集合
      const collectionIndex = collections.value.findIndex((c) => c.id === collectionId)
      if (collectionIndex === -1) {
        return { success: false, message: '收藏集合不存在' }
      }

      // 检查壁纸是否有collections属性
      if (!favorites.value[wallpaperIndex].collections) {
        return { success: true, message: '壁纸不在任何收藏集合中' }
      }

      // 检查壁纸是否在该集合中
      if (!favorites.value[wallpaperIndex].collections.includes(collectionId)) {
        return { success: true, message: '壁纸不在该收藏集合中' }
      }

      // 从集合中移除
      favorites.value[wallpaperIndex].collections = favorites.value[
        wallpaperIndex
      ].collections.filter((id) => id !== collectionId)

      // 更新集合计数
      if (collections.value[collectionIndex].count > 0) {
        collections.value[collectionIndex].count -= 1
      }
      collections.value[collectionIndex].updated_at = new Date().toISOString()

      // 保存到本地存储
      storageService.set(FAVORITES_KEY, favorites.value)
      storageService.set('favorite_collections', collections.value)

      void syncFavoritesState()

      return { success: true }
    } catch (err) {
      console.error('从收藏集合中移除壁纸失败:', err)
      return { success: false, message: '从收藏集合中移除壁纸失败' }
    }
  }

  function compactFavoriteBackupEntry(item) {
    if (!item || typeof item !== 'object') return item
    return {
      id: item.id,
      favorited_at: item.favorited_at,
      collections: item.collections,
      resolution: item.resolution,
      thumbnail: item.thumbnail,
      thumbs: item.thumbs,
      tags: item.tags,
      category: item.category,
      purity: item.purity,
    }
  }

  // 创建备份
  function createBackup() {
    try {
      if (favorites.value.length === 0) return

      const compactBackup = favorites.value
        .slice(0, 600)
        .map(compactFavoriteBackupEntry)

      // 备份使用精简结构，失败时不打扰用户（主收藏列表更重要）
      const saved = storageService.set(FAVORITES_BACKUP_KEY, compactBackup, { silent: true })
      if (!saved) return false

      // 更新备份时间戳
      const now = new Date().toISOString()
      storageService.set(BACKUP_TIMESTAMP_KEY, now, { silent: true })
      lastBackupTime.value = new Date(now)

      return true
    } catch (err) {
      console.error('创建备份失败:', err)
      return false
    }
  }

  // 添加收藏
  function addFavorite(wallpaper) {
    try {
      const runtimeConfigStore = useRuntimeConfigStore()
      if (!runtimeConfigStore.canUse('favorite')) {
        const message = runtimeConfigStore.isBlocked
          ? runtimeConfigStore.blockReason
          : '收藏功能暂未开放'
        error.value = message
        notificationService.warning(message, {
          duration: 3500,
          position: 'top-right',
        })
        return false
      }

      // 检查是否已经收藏
      if (isFavorited.value(wallpaper.id)) {
        return false
      }

      // 添加收藏时间和初始化集合数组
      const favoriteData = {
        ...wallpaper,
        favorited_at: new Date().toISOString(),
        collections: [], // 初始化集合数组
      }

      // 添加到收藏列表
      favorites.value.unshift(favoriteData)

      // 保存到本地存储
      const saveResult = storageService.set(FAVORITES_KEY, favorites.value, {
        onQuotaExceeded: () => {
          const nextLength = Math.max(100, Math.floor(favorites.value.length * 0.85))
          favorites.value = favorites.value.slice(0, nextLength)
          return favorites.value
        },
      })
      storageService.remove(FAVORITES_CLEARED_MARKER_KEY)

      if (!saveResult) {
        notificationService.warning('收藏未能完整保存到本地，可能是浏览器存储空间已满', {
          duration: 7000,
          position: 'top-right',
        })
        return false
      }

      // 如果保存成功且收藏数量达到一定数量，创建备份
      if (saveResult && favorites.value.length % 5 === 0) {
        createBackup()
      }

      // 更新统计数据
      updateStatistics({ syncRemote: false })
      void syncFavoritesState()

      return true
    } catch (err) {
      console.error('添加收藏失败:', err)
      error.value = '添加收藏失败'
      return false
    }
  }

  // 移除收藏
  function removeFavorite(id) {
    try {
      // 从收藏列表中移除
      favorites.value = favorites.value.filter((item) => item.id !== id)

      // 保存到本地存储
      storageService.set(FAVORITES_KEY, favorites.value)
      // 仅当删空列表时写清空标记，防止备份修复把已删数据复活；普通删除不写标记
      if (favorites.value.length === 0) {
        storageService.set(FAVORITES_CLEARED_MARKER_KEY, {
          cleared_at: new Date().toISOString(),
        })
        storageService.set(FAVORITES_BACKUP_KEY, [])
      }

      // 更新统计数据
      updateStatistics({ syncRemote: false })

      // 更新集合计数
      updateCollectionCounts({ syncRemote: false })
      void syncFavoritesState()

      return true
    } catch (err) {
      console.error('移除收藏失败:', err)
      error.value = '移除收藏失败'
      return false
    }
  }

  // 清空收藏
  function clearFavorites() {
    try {
      // 在清空前创建一次备份
      if (favorites.value.length > 0) {
        // 创建特殊备份，使用不同的键名
        storageService.set('favorites_backup_before_clear', favorites.value)
      }

      // 清空收藏列表
      favorites.value = []

      // 保存到本地存储
      storageService.set(FAVORITES_KEY, favorites.value)
      // 用户主动清空：写标记并清空备份，阻止备份修复逻辑复活已清空的收藏
      storageService.set(FAVORITES_CLEARED_MARKER_KEY, {
        cleared_at: new Date().toISOString(),
      })
      storageService.set(FAVORITES_BACKUP_KEY, [])

      // 更新统计数据
      updateStatistics({ syncRemote: false })

      // 重置所有集合的计数
      collections.value.forEach((collection) => {
        collection.count = 0
        collection.updated_at = new Date().toISOString()
      })

      // 保存集合
      storageService.set('favorite_collections', collections.value)
      void syncFavoritesState()
      hasInitialized = true

      return true
    } catch (err) {
      console.error('清空收藏失败:', err)
      error.value = '清空收藏失败'
      return false
    }
  }

  // 更新所有集合的计数
  function updateCollectionCounts(options = {}) {
    try {
      const syncRemote = options.syncRemote === true
      // 重置所有集合的计数
      collections.value.forEach((collection) => {
        collection.count = 0
      })

      // 重新计算每个集合的计数
      favorites.value.forEach((item) => {
        if (item.collections && Array.isArray(item.collections)) {
          item.collections.forEach((collectionId) => {
            const collectionIndex = collections.value.findIndex((c) => c.id === collectionId)
            if (collectionIndex !== -1) {
              collections.value[collectionIndex].count =
                (collections.value[collectionIndex].count || 0) + 1
              collections.value[collectionIndex].updated_at = new Date().toISOString()
            }
          })
        }
      })

      // 保存集合
      storageService.set('favorite_collections', collections.value)
      if (syncRemote) {
        void syncFavoritesState()
      }

      return true
    } catch (err) {
      console.error('更新集合计数失败:', err)
      return false
    }
  }

  // 手动备份收藏数据
  function backupFavorites() {
    return createBackup()
  }

  // 从备份恢复收藏数据
  function restoreFromBackup() {
    try {
      isLoading.value = true
      error.value = null

      // 从备份加载收藏
      const backupFavorites = storageService.get(FAVORITES_BACKUP_KEY, [])

      if (!backupFavorites || backupFavorites.length === 0) {
        error.value = '没有可用的备份数据'
        isLoading.value = false
        return false
      }

      // 恢复收藏数据
      const { normalized, changed } = normalizeFavoritesList(backupFavorites)
      favorites.value = normalized

      // 保存到主存储
      storageService.set(FAVORITES_KEY, favorites.value)
      if (changed) {
        storageService.set(FAVORITES_KEY, normalized)
      }
      storageService.remove(FAVORITES_CLEARED_MARKER_KEY)

      updateStatistics({ syncRemote: false })
      updateCollectionCounts({ syncRemote: false })
      void syncFavoritesState()
      hasInitialized = true

      isLoading.value = false
      return true
    } catch (err) {
      console.error('从备份恢复失败:', err)
      error.value = '从备份恢复失败'
      isLoading.value = false
      return false
    }
  }

  // 获取最近收藏
  function getRecentFavorites(limit = 8) {
    return favorites.value.slice(0, limit)
  }

  // 导出收藏
  function exportFavorites(options = {}) {
    try {
      // 确定要导出的收藏
      let favoritesToExport = favorites.value
      let collectionsToExport = options.includeCollections ? collections.value : []

      // 如果指定了收藏夹ID，只导出该收藏夹中的壁纸
      if (options.collectionId) {
        favoritesToExport = favorites.value.filter(
          (item) =>
            Array.isArray(item.collections) && item.collections.includes(options.collectionId),
        )

        if (options.includeCollections) {
          collectionsToExport = collections.value
            .filter((collection) => collection.id === options.collectionId)
            .map((collection) => ({
              ...collection,
              count: favoritesToExport.length,
            }))
        }
      }

      // 创建导出数据
      const exportData = {
        favorites: favoritesToExport,
        collections: collectionsToExport,
        version: '1.0',
        exported_at: new Date().toISOString(),
      }

      // 转换为JSON字符串
      const jsonData = JSON.stringify(exportData, null, 2)

      // 创建Blob对象
      const blob = new Blob([jsonData], { type: 'application/json' })

      // 创建下载链接
      const url = URL.createObjectURL(blob)

      // 创建文件名
      let fileName = `wallhaven_pepe_favorites_${new Date().toISOString().slice(0, 10)}`

      // 如果是导出特定收藏夹，添加收藏夹名称到文件名
      if (options.collectionId && options.collectionName) {
        fileName += `_${options.collectionName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
      }

      fileName += '.json'

      // 创建a标签并触发下载
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()

      // 清理
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 0)

      return true
    } catch (err) {
      console.error('导出收藏失败:', err)
      error.value = '导出收藏失败'
      return false
    }
  }

  // 导入收藏
  function importFavorites(data, options = {}) {
    console.log('开始执行importFavorites函数', { options })

    try {
      // 验证数据格式
      if (!data) {
        console.error('导入数据为空')
        return { success: false, message: '导入数据为空' }
      }

      if (!data.favorites) {
        console.error('导入数据缺少favorites字段')
        return { success: false, message: '无效的收藏数据格式: 缺少favorites字段' }
      }

      if (!Array.isArray(data.favorites)) {
        console.error('favorites不是数组类型:', typeof data.favorites)
        return { success: false, message: '无效的收藏数据格式: favorites不是数组' }
      }

      console.log(`准备导入${data.favorites.length}个收藏项目`)

      // 如果选择替换模式，先清空现有收藏
      if (options.mode === 'replace') {
        console.log('使用替换模式，准备清空现有收藏')

        // 在清空前创建一次备份
        if (favorites.value.length > 0) {
          console.log(`创建备份，当前有${favorites.value.length}个收藏`)
          // 创建特殊备份，使用不同的键名
          storageService.set('favorites_backup_before_import', favorites.value)
        }

        // 清空收藏列表
        favorites.value = []
        console.log('现有收藏已清空')
      }

      // 导入收藏
      let importedCount = 0
      let skippedCount = 0
      let updatedCount = 0

      // 创建ID到现有收藏的映射，用于快速查找
      const existingFavorites = new Map()
      favorites.value.forEach((item) => {
        if (item.id) {
          existingFavorites.set(item.id, item)
        }
      })

      console.log(`现有收藏映射创建完成，共${existingFavorites.size}项`)

      // 处理每个导入的收藏
      data.favorites.forEach((item, index) => {
        try {
          // 确保item有id
          if (!item.id) {
            console.warn(`跳过第${index + 1}个项目: 缺少id`)
            skippedCount++
            return
          }

          // 检查是否已存在
          if (existingFavorites.has(item.id)) {
            // 如果已存在，根据选项决定是否更新
            if (options.mode === 'merge') {
              // 在合并模式下，保留现有收藏，但可能更新收藏夹信息
              const existingItem = existingFavorites.get(item.id)

              // 如果导入项有收藏夹信息，合并收藏夹信息
              if (
                item.collections &&
                Array.isArray(item.collections) &&
                item.collections.length > 0
              ) {
                // 确保现有项有collections数组
                if (!existingItem.collections) {
                  existingItem.collections = []
                }

                // 添加不存在的收藏夹ID
                let addedCollections = 0
                item.collections.forEach((collectionId) => {
                  if (!existingItem.collections.includes(collectionId)) {
                    existingItem.collections.push(collectionId)
                    addedCollections++
                  }
                })

                if (addedCollections > 0) {
                  updatedCount++
                  console.log(
                    `更新了收藏项目 ${item.id} 的收藏夹信息，添加了${addedCollections}个收藏夹`,
                  )
                }
              }
            } else {
              console.log(`跳过已存在的收藏项目: ${item.id}`)
            }
          } else {
            // 如果不存在，添加到收藏列表
            // 创建一个新对象，避免直接修改原始数据
            const newItem = normalizeFavoriteItem({ ...item })

            // 确保有收藏时间
            if (!newItem.favorited_at) {
              newItem.favorited_at = new Date().toISOString()
            }

            // 确保有collections数组
            if (!newItem.collections) {
              newItem.collections = []
            } else if (!Array.isArray(newItem.collections)) {
              console.warn(`收藏项目 ${newItem.id} 的collections不是数组，已重置`)
              newItem.collections = []
            }

            // 确保有必要的字段
            if (!newItem.thumbnail) {
              console.warn(`收藏项目 ${newItem.id} 缺少thumbnail字段`)
            }

            favorites.value.push(newItem)
            importedCount++

            if (importedCount % 10 === 0) {
              console.log(`已导入${importedCount}个收藏项目`)
            }
          }
        } catch (itemError) {
          console.error(`处理第${index + 1}个收藏项目时出错:`, itemError)
          skippedCount++
        }
      })

      console.log(
        `收藏项目处理完成: 导入${importedCount}个，更新${updatedCount}个，跳过${skippedCount}个`,
      )

      // 如果选择导入收藏夹结构，处理收藏夹
      let importedCollections = 0
      if (options.importCollections && data.collections && Array.isArray(data.collections)) {
        console.log(`准备导入${data.collections.length}个收藏夹`)

        // 创建ID到现有收藏夹的映射
        const existingCollections = new Map()
        collections.value.forEach((collection) => {
          if (collection.id) {
            existingCollections.set(collection.id, collection)
          }
        })

        console.log(`现有收藏夹映射创建完成，共${existingCollections.size}项`)

        // 处理每个导入的收藏夹
        data.collections.forEach((collection, index) => {
          try {
            // 确保collection有id
            if (!collection.id) {
              console.warn(`跳过第${index + 1}个收藏夹: 缺少id`)
              return
            }

            // 检查是否已存在
            if (!existingCollections.has(collection.id)) {
              // 如果不存在，添加到收藏夹列表
              // 创建一个新对象，避免直接修改原始数据
              const newCollection = { ...collection }

              // 确保有创建时间和更新时间
              if (!newCollection.created_at) {
                newCollection.created_at = new Date().toISOString()
              }
              if (!newCollection.updated_at) {
                newCollection.updated_at = new Date().toISOString()
              }

              // 确保有count属性
              if (typeof newCollection.count !== 'number') {
                newCollection.count = 0
              }

              // 确保有name属性
              if (!newCollection.name) {
                newCollection.name = `收藏夹 ${newCollection.id}`
              }

              // 确保有icon属性
              if (!newCollection.icon) {
                newCollection.icon = 'folder'
              }

              collections.value.push(newCollection)
              importedCollections++

              console.log(`导入收藏夹: ${newCollection.name} (${newCollection.id})`)
            } else {
              console.log(`跳过已存在的收藏夹: ${collection.id}`)
            }
          } catch (collectionError) {
            console.error(`处理第${index + 1}个收藏夹时出错:`, collectionError)
          }
        })

        console.log(`收藏夹处理完成: 导入${importedCollections}个`)

        // 保存收藏夹到本地存储
        try {
          storageService.set('favorite_collections', collections.value)
          console.log('收藏夹已保存到本地存储')
        } catch (saveError) {
          console.error('保存收藏夹到本地存储失败:', saveError)
          return {
            success: false,
            message: '保存收藏夹失败: ' + (saveError.message || '未知错误'),
          }
        }
      }

      // 保存收藏到本地存储
      try {
        const { normalized, changed } = normalizeFavoritesList(favorites.value)
        if (changed) {
          favorites.value = normalized
        }

        storageService.set(FAVORITES_KEY, favorites.value)
        if (favorites.value.length > 0) {
          storageService.remove(FAVORITES_CLEARED_MARKER_KEY)
        } else if (options.mode === 'replace') {
          storageService.set(FAVORITES_CLEARED_MARKER_KEY, {
            cleared_at: new Date().toISOString(),
          })
        }
        console.log('收藏已保存到本地存储')
      } catch (saveError) {
        console.error('保存收藏到本地存储失败:', saveError)
        return {
          success: false,
          message: '保存收藏失败: ' + (saveError.message || '未知错误'),
        }
      }

      // 更新统计数据
      try {
        updateStatistics({ syncRemote: false })
        console.log('统计数据已更新')
      } catch (statsError) {
        console.error('更新统计数据失败:', statsError)
      }

      // 更新集合计数
      try {
        updateCollectionCounts({ syncRemote: false })
        console.log('集合计数已更新')
      } catch (countError) {
        console.error('更新集合计数失败:', countError)
      }

      void syncFavoritesState()
      hasInitialized = true

      console.log('导入完成')

      return {
        success: true,
        importedCount,
        updatedCount,
        importedCollections,
        message: `成功导入 ${importedCount} 个收藏${importedCollections > 0 ? `和 ${importedCollections} 个收藏夹` : ''}`,
      }
    } catch (err) {
      console.error('导入收藏失败:', err)
      error.value = '导入收藏失败'
      return { success: false, message: err.message || '导入收藏失败' }
    }
  }

  // 批量将收藏夹中的壁纸移动到另一个收藏夹
  function moveCollectionItems(sourceCollectionId, targetCollectionId) {
    try {
      // 验证源收藏夹和目标收藏夹
      const sourceCollectionIndex = collections.value.findIndex((c) => c.id === sourceCollectionId)
      const targetCollectionIndex = collections.value.findIndex((c) => c.id === targetCollectionId)

      if (sourceCollectionIndex === -1) {
        return { success: false, message: '源收藏夹不存在' }
      }

      if (targetCollectionIndex === -1) {
        return { success: false, message: '目标收藏夹不存在' }
      }

      // 如果源收藏夹和目标收藏夹相同，不执行任何操作
      if (sourceCollectionId === targetCollectionId) {
        return { success: true, message: '源收藏夹和目标收藏夹相同', movedCount: 0 }
      }

      // 找出源收藏夹中的所有壁纸
      const wallpapersInSourceCollection = favorites.value.filter(
        (item) => item.collections && item.collections.includes(sourceCollectionId),
      )

      if (wallpapersInSourceCollection.length === 0) {
        return { success: true, message: '源收藏夹中没有壁纸', movedCount: 0 }
      }

      // 记录成功移动的壁纸数量
      let movedCount = 0
      let addedCount = 0

      // 遍历源收藏夹中的所有壁纸，将它们移动到目标收藏夹
      for (const wallpaper of wallpapersInSourceCollection) {
        if (!Array.isArray(wallpaper.collections)) {
          wallpaper.collections = []
        }

        if (!wallpaper.collections.includes(targetCollectionId)) {
          wallpaper.collections.push(targetCollectionId)
          addedCount++
        }

        wallpaper.collections = wallpaper.collections.filter((id) => id !== sourceCollectionId)
        movedCount++
      }

      // 更新收藏夹计数
      updateCollectionCounts({ syncRemote: false })
      updateStatistics({ syncRemote: false })

      // 保存到本地存储
      storageService.set(FAVORITES_KEY, favorites.value)
      void syncFavoritesState()

      return {
        success: true,
        message: `成功将 ${movedCount} 个壁纸从 "${collections.value[sourceCollectionIndex].name}" 移动到 "${collections.value[targetCollectionIndex].name}"${addedCount !== movedCount ? `，其中 ${addedCount} 个新加入目标集合` : ''}`,
        movedCount,
        addedCount,
      }
    } catch (err) {
      console.error('移动收藏夹壁纸失败:', err)
      return { success: false, message: '移动收藏夹壁纸失败: ' + (err.message || '未知错误') }
    }
  }

  return {
    // 状态
    favorites,
    isLoading,
    error,
    lastBackupTime,
    collections,
    selectedCollection,
    statistics,

    // 计算属性
    favoritesCount,
    isFavorited,
    collectionFavorites,
    collectionsCount,

    // 基本收藏功能
    initFavorites,
    reloadFavorites,
    repairFromBackupForSync,
    mergeCloudFavorites,
    syncFavoritesState,
    addFavorite,
    removeFavorite,
    clearFavorites,
    getRecentFavorites,

    // 备份与恢复
    backupFavorites,
    restoreFromBackup,

    // 导入导出功能
    exportFavorites,
    importFavorites,

    // 统计功能
    updateStatistics,

    // 集合管理
    createCollection,
    updateCollection,
    deleteCollection,
    selectCollection,
    clearSelectedCollection,
    addToCollection,
    removeFromCollection,
    updateCollectionCounts,
    moveCollectionItems,
  }
})
