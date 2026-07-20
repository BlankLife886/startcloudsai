import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  fetchClientStateQuietly,
  getCloudSyncConflictStrategy,
  scheduleClientStatePushQuietly,
  shouldApplyRemoteClientState,
} from '@/services/clientState'
import storageService from '@/services/storage'

export const useUserStore = defineStore('user', () => {
  // 状态
  const followedUsers = ref([])
  const followedCollections = ref({})
  const followedTags = ref({})
  const isLoading = ref(false)
  const error = ref(null)

  // 计算属性
  const followedUsersCount = computed(() => followedUsers.value.length)
  const followedCollectionsCount = computed(() => Object.keys(followedCollections.value).length)
  const followedTagsCount = computed(() => Object.keys(followedTags.value).length)
  const isFollowing = computed(() => (username) => followedUsers.value.includes(username))
  const isFollowingCollection = computed(
    () => (username) => followedCollections.value[username] !== undefined,
  )
  const isFollowingTag = computed(() => (tagName) => {
    const key = normalizeTagKey(tagName)
    return !!key && followedTags.value[key] !== undefined
  })

  function normalizeTagKey(tagName) {
    return String(tagName || '')
      .trim()
      .toLowerCase()
  }

  function syncAuthorsState() {
    return scheduleClientStatePushQuietly('authors', () => ({
      followedUsers: followedUsers.value,
      followedCollections: followedCollections.value,
      updatedAt: new Date().toISOString(),
    }))
  }

  function syncTagsState() {
    return scheduleClientStatePushQuietly('tags', () => ({
      followedTags: followedTags.value,
      updatedAt: new Date().toISOString(),
    }))
  }

  function mergeFollowedUsers(remoteUsers = [], localUsers = []) {
    return Array.from(new Set([...remoteUsers, ...localUsers].map((item) => String(item || '').trim()).filter(Boolean)))
  }

  function mergeRecordMap(remoteMap = {}, localMap = {}) {
    return {
      ...(remoteMap && typeof remoteMap === 'object' && !Array.isArray(remoteMap) ? remoteMap : {}),
      ...(localMap && typeof localMap === 'object' && !Array.isArray(localMap) ? localMap : {}),
    }
  }

  async function mergeCloudUserData(options = {}) {
    const [authorsState, tagsState] = await Promise.all([
      fetchClientStateQuietly('authors'),
      fetchClientStateQuietly('tags'),
    ])
    const strategy = options.conflictStrategy || getCloudSyncConflictStrategy()
    if (authorsState?.payload) {
      const shouldApplyRemote =
        strategy === 'merge' ||
        (strategy !== 'local' &&
          (options.forceRemote || shouldApplyRemoteClientState('authors', authorsState.updatedAt)))
      if (shouldApplyRemote) {
        const payload = authorsState.payload || {}
        followedUsers.value =
          strategy === 'merge'
            ? mergeFollowedUsers(payload.followedUsers || [], followedUsers.value)
            : Array.isArray(payload.followedUsers)
              ? payload.followedUsers
              : []
        followedCollections.value =
          strategy === 'merge'
            ? mergeRecordMap(payload.followedCollections, followedCollections.value)
            : mergeRecordMap(payload.followedCollections, {})
        storageService.set('followed_users', followedUsers.value)
        storageService.set('followed_collections_data', followedCollections.value)
      }
    }

    if (tagsState?.payload) {
      const shouldApplyRemote =
        strategy === 'merge' ||
        (strategy !== 'local' &&
          (options.forceRemote || shouldApplyRemoteClientState('tags', tagsState.updatedAt)))
      if (shouldApplyRemote) {
        const payload = tagsState.payload || {}
        followedTags.value =
          strategy === 'merge'
            ? mergeRecordMap(payload.followedTags, followedTags.value)
            : mergeRecordMap(payload.followedTags, {})
        storageService.set('followed_tags_data', followedTags.value)
      }
    }

    await Promise.allSettled([syncAuthorsState(), syncTagsState()])
  }

  // 初始化用户数据
  function initUserData(options = {}) {
    try {
      isLoading.value = true
      error.value = null

      // 从本地存储加载关注的用户
      const storedFollowedUsers = storageService.get('followed_users', [])
      followedUsers.value = storedFollowedUsers

      // 从本地存储加载收藏的合集
      const storedFollowedCollections = storageService.get('followed_collections_data', {})
      followedCollections.value = storedFollowedCollections

      // 从本地存储加载收藏的标签
      const storedFollowedTags = storageService.get('followed_tags_data', {})
      followedTags.value =
        storedFollowedTags &&
        typeof storedFollowedTags === 'object' &&
        !Array.isArray(storedFollowedTags)
          ? storedFollowedTags
          : {}

      isLoading.value = false
      void mergeCloudUserData(options)
    } catch (err) {
      console.error('初始化用户数据失败:', err)
      error.value = '加载用户数据失败'
      isLoading.value = false
    }
  }

  // 关注用户
  function followUser(username) {
    try {
      // 检查是否已经关注
      if (isFollowing.value(username)) {
        return false
      }

      // 添加到关注列表
      followedUsers.value.push(username)

      // 保存到本地存储
      storageService.set('followed_users', followedUsers.value)
      void syncAuthorsState()

      return true
    } catch (err) {
      console.error('关注用户失败:', err)
      error.value = '关注用户失败'
      return false
    }
  }

  // 取消关注用户
  function unfollowUser(username) {
    try {
      // 从关注列表中移除
      followedUsers.value = followedUsers.value.filter((user) => user !== username)

      // 保存到本地存储
      storageService.set('followed_users', followedUsers.value)
      void syncAuthorsState()

      return true
    } catch (err) {
      console.error('取消关注用户失败:', err)
      error.value = '取消关注用户失败'
      return false
    }
  }

  // 收藏用户合集
  function followCollection(username, userData) {
    try {
      // 检查是否已经收藏
      if (isFollowingCollection.value(username)) {
        return false
      }

      // 添加收藏时间
      const collectionData = {
        ...userData,
        username,
        followed_at: new Date().toISOString(),
      }

      // 添加到收藏列表
      followedCollections.value[username] = collectionData

      // 保存到本地存储
      storageService.set('followed_collections_data', followedCollections.value)
      void syncAuthorsState()

      return true
    } catch (err) {
      console.error('收藏用户合集失败:', err)
      error.value = '收藏用户合集失败'
      return false
    }
  }

  // 取消收藏用户合集
  function unfollowCollection(username) {
    try {
      // 检查是否已经收藏
      if (!isFollowingCollection.value(username)) {
        return false
      }

      // 创建新对象，排除要删除的用户
      const newFollowedCollections = { ...followedCollections.value }
      delete newFollowedCollections[username]

      // 更新状态
      followedCollections.value = newFollowedCollections

      // 保存到本地存储
      storageService.set('followed_collections_data', followedCollections.value)
      void syncAuthorsState()

      return true
    } catch (err) {
      console.error('取消收藏用户合集失败:', err)
      error.value = '取消收藏用户合集失败'
      return false
    }
  }

  // 收藏标签
  function followTag(tagName, tagData = {}) {
    try {
      const key = normalizeTagKey(tagName)
      if (!key) {
        return false
      }

      if (isFollowingTag.value(tagName)) {
        return false
      }

      const tagInfo = {
        ...tagData,
        key,
        name: String(tagName).trim(),
        followed_at: new Date().toISOString(),
      }

      followedTags.value = {
        ...followedTags.value,
        [key]: tagInfo,
      }

      storageService.set('followed_tags_data', followedTags.value)
      void syncTagsState()

      return true
    } catch (err) {
      console.error('收藏标签失败:', err)
      error.value = '收藏标签失败'
      return false
    }
  }

  // 取消收藏标签
  function unfollowTag(tagName) {
    try {
      const key = normalizeTagKey(tagName)
      if (!key || !isFollowingTag.value(tagName)) {
        return false
      }

      const newFollowedTags = { ...followedTags.value }
      delete newFollowedTags[key]
      followedTags.value = newFollowedTags

      storageService.set('followed_tags_data', followedTags.value)
      void syncTagsState()

      return true
    } catch (err) {
      console.error('取消收藏标签失败:', err)
      error.value = '取消收藏标签失败'
      return false
    }
  }

  // 获取最近收藏的标签
  function getRecentFollowedTags(limit = 12) {
    const tagsArray = Object.values(followedTags.value)

    tagsArray.sort((a, b) => {
      return new Date(b.followed_at || 0) - new Date(a.followed_at || 0)
    })

    return tagsArray.slice(0, limit)
  }

  // 获取最近收藏的合集
  function getRecentFollowedCollections(limit = 8) {
    // 将对象转换为数组
    const collectionsArray = Object.values(followedCollections.value)

    // 按收藏时间排序
    collectionsArray.sort((a, b) => {
      return new Date(b.followed_at) - new Date(a.followed_at)
    })

    // 返回前limit个
    return collectionsArray.slice(0, limit)
  }

  return {
    followedUsers,
    followedCollections,
    followedTags,
    isLoading,
    error,
    followedUsersCount,
    followedCollectionsCount,
    followedTagsCount,
    isFollowing,
    isFollowingCollection,
    isFollowingTag,
    initUserData,
    mergeCloudUserData,
    syncAuthorsState,
    syncTagsState,
    followUser,
    unfollowUser,
    followCollection,
    unfollowCollection,
    followTag,
    unfollowTag,
    getRecentFollowedCollections,
    getRecentFollowedTags,
  }
})
