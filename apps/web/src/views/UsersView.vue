<script setup>
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import VirtualGrid from '@/components/common/VirtualGrid.vue'
import { useUsersPageMotion } from '@/features/users/composables/useUsersPageMotion'
import '@/features/users/styles/users-view.css'
import storageService from '@/services/storage'
import { useUserStore } from '@/stores/user'

const ACTIVE_SCOPE = storageService.getActiveScope()
const DIRECTORY_CACHE_KEY = `followed-authors-directory:v2:${ACTIVE_SCOPE}`
const VIEW_CACHE_KEY = `followed-authors-view:v2:${ACTIVE_SCOPE}`
const AVATAR_FAILURE_CACHE_KEY = `followed-authors-avatar-failures:v1:${ACTIVE_SCOPE}`
const DIRECTORY_CACHE_TTL = 15 * 60 * 1000
const AVATAR_FAILURE_TTL = 10 * 60 * 1000

const router = useRouter()
const userStore = useUserStore()
const pageRoot = ref(null)
const feedScrollRef = ref(null)
const pageReady = ref(false)

function readSessionJson(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function writeSessionJson(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable in private browsing. The page still works without view cache.
  }
}

function readDirectoryCache() {
  const cached = readSessionJson(DIRECTORY_CACHE_KEY, null)
  if (!cached || Date.now() - Number(cached.savedAt || 0) > DIRECTORY_CACHE_TTL) return []
  return Array.isArray(cached.authors) ? cached.authors : []
}

function readViewCache() {
  const cached = readSessionJson(VIEW_CACHE_KEY, {})
  return cached && typeof cached === 'object' ? cached : {}
}

function readAvatarFailures() {
  const cached = readSessionJson(AVATAR_FAILURE_CACHE_KEY, {})
  const now = Date.now()
  return new Set(
    Object.entries(cached)
      .filter(([, failedAt]) => now - Number(failedAt || 0) < AVATAR_FAILURE_TTL)
      .map(([url]) => url),
  )
}

const initialView = readViewCache()
const cachedAuthors = ref(readDirectoryCache())
const searchQuery = ref(String(initialView.searchQuery || ''))
const sortOrder = ref(initialView.sortOrder === 'desc' ? 'desc' : 'asc')
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const storeReady = ref(false)
const isLoading = ref(cachedAuthors.value.length === 0)
const failedAvatarUrls = ref(readAvatarFailures())

let resizeRaf = 0

const followedCollectionsList = computed(() => Object.values(userStore.followedCollections || {}))

function getUserTone(group) {
  const value = String(group || 'member').toLowerCase()
  if (value.includes('admin')) return 'danger'
  if (value.includes('moderator')) return 'warning'
  if (value.includes('developer')) return 'info'
  if (value.includes('pro')) return 'success'
  return 'neutral'
}

function toAuthorView(author) {
  const collection = author?.collection || {}
  const username = String(author?.username || '').trim()
  const group = String(collection.group || author?.group || 'User')
  return {
    username,
    avatarUrl: String(collection.avatar_url || author?.avatarUrl || '').trim(),
    group,
    tone: getUserTone(group),
    description: String(collection.description || author?.description || '').trim(),
    initials: username.slice(0, 2).toUpperCase() || '?',
    isUserFollowed: Boolean(author?.isUserFollowed),
    isCollectionFollowed: Boolean(author?.isCollectionFollowed),
  }
}

const storeAuthors = computed(() => {
  const map = new Map()

  for (const username of userStore.followedUsers) {
    const key = String(username || '').trim()
    if (!key) continue
    map.set(key, {
      username: key,
      isUserFollowed: true,
      isCollectionFollowed: false,
      collection: null,
    })
  }

  for (const collection of followedCollectionsList.value) {
    const username = String(collection?.username || '').trim()
    if (!username) continue
    const current = map.get(username) || {
      username,
      isUserFollowed: false,
      isCollectionFollowed: false,
      collection: null,
    }
    map.set(username, {
      ...current,
      isCollectionFollowed: true,
      collection,
    })
  }

  return [...map.values()].map(toAuthorView)
})

const authors = computed(() => (storeReady.value ? storeAuthors.value : cachedAuthors.value))

const filteredAuthors = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  const result = query
    ? authors.value.filter((author) =>
        [author.username, author.group, author.description].some((value) =>
          String(value || '')
            .toLocaleLowerCase()
            .includes(query),
        ),
      )
    : [...authors.value]

  return result.sort((a, b) => {
    const comparison = a.username.localeCompare(b.username, 'zh-CN', { sensitivity: 'base' })
    return sortOrder.value === 'asc' ? comparison : -comparison
  })
})

const authorsCount = computed(() => authors.value.length)
const virtualMinColumnWidth = computed(() => (viewportWidth.value < 700 ? 260 : 292))
const virtualCardHeight = computed(() => (viewportWidth.value < 640 ? 266 : 250))

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}

function clearSearch() {
  searchQuery.value = ''
}

function openUserPage(username) {
  router.push({ name: 'user', params: { username } })
}

function removeUserFollow(username) {
  if (confirm(`确定要取消关注 ${username} 吗？`)) userStore.unfollowUser(username)
}

function removeCollectionFollow(username) {
  if (confirm(`确定要移除 ${username} 的合集收藏吗？`)) {
    userStore.unfollowCollection(username)
  }
}

function hasUsableAvatar(author) {
  return Boolean(author.avatarUrl && !failedAvatarUrls.value.has(author.avatarUrl))
}

function markAvatarFailed(url) {
  if (!url) return
  failedAvatarUrls.value = new Set([...failedAvatarUrls.value, url])
  const now = Date.now()
  writeSessionJson(
    AVATAR_FAILURE_CACHE_KEY,
    Object.fromEntries([...failedAvatarUrls.value].slice(-64).map((item) => [item, now])),
  )
}

function persistDirectoryCache(value = storeAuthors.value) {
  cachedAuthors.value = value
  writeSessionJson(DIRECTORY_CACHE_KEY, { savedAt: Date.now(), authors: value })
}

function persistViewCache() {
  writeSessionJson(VIEW_CACHE_KEY, {
    searchQuery: searchQuery.value,
    sortOrder: sortOrder.value,
    scrollTop: feedScrollRef.value?.scrollTop || 0,
  })
}

function handleResize() {
  if (resizeRaf) return
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0
    viewportWidth.value = window.innerWidth
  })
}

watch(
  storeAuthors,
  (value) => {
    if (storeReady.value) persistDirectoryCache(value)
  },
  { deep: true },
)

watch([searchQuery, sortOrder], persistViewCache)

useUsersPageMotion({
  pageRef: pageRoot,
  feedRef: feedScrollRef,
  ready: pageReady,
  filterKey: computed(() => `${searchQuery.value.trim()}::${sortOrder.value}`),
  loading: isLoading,
})

onBeforeMount(() => {
  document.documentElement.classList.add('users-gallery-page')
  userStore.initUserData()
  storeReady.value = true
  persistDirectoryCache(storeAuthors.value)
  if (cachedAuthors.value.length > 0) isLoading.value = false
})

onMounted(async () => {
  const loadingStartedAt = performance.now()

  if (isLoading.value) {
    const remaining = Math.max(0, 220 - (performance.now() - loadingStartedAt))
    if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining))
  }
  isLoading.value = false

  window.addEventListener('resize', handleResize, { passive: true })
  await nextTick()

  const cachedScrollTop = Math.max(0, Number(initialView.scrollTop || initialView.scrollY || 0))
  if (cachedScrollTop && feedScrollRef.value) {
    feedScrollRef.value.scrollTop = cachedScrollTop
  }

  pageReady.value = true
})

onBeforeUnmount(() => {
  persistViewCache()
  document.documentElement.classList.remove('users-gallery-page')
  window.removeEventListener('resize', handleResize)
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeRaf = 0
})
</script>

<template>
  <main ref="pageRoot" class="users-page" :class="{ 'is-ready': pageReady }">
    <div class="users-atmosphere" aria-hidden="true"></div>

    <header class="users-toolbar" data-users-motion>
      <div class="users-toolbar__lead">
        <h1>关注作者</h1>
        <div class="users-stats" aria-label="关注统计">
          <div>
            <strong>{{ authorsCount }}</strong>
            <span>全部</span>
          </div>
          <div>
            <strong>{{ userStore.followedUsersCount }}</strong>
            <span>已关注</span>
          </div>
          <div>
            <strong>{{ userStore.followedCollectionsCount }}</strong>
            <span>合集</span>
          </div>
          <div>
            <strong>{{ filteredAuthors.length }}</strong>
            <span>当前结果</span>
          </div>
        </div>
      </div>

      <label class="users-search">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="搜索作者、身份或简介"
          aria-label="搜索关注作者"
        />
        <button
          v-if="searchQuery"
          type="button"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </label>

      <button class="users-sort-btn" type="button" @click="toggleSortOrder">
        <i
          class="bi"
          :class="sortOrder === 'asc' ? 'bi-sort-alpha-down' : 'bi-sort-alpha-up'"
          aria-hidden="true"
        ></i>
        <span>{{ sortOrder === 'asc' ? 'A 到 Z' : 'Z 到 A' }}</span>
      </button>
    </header>

    <section class="users-body" data-users-motion>
      <div ref="feedScrollRef" class="users-feed">
        <div v-if="isLoading" class="users-skeleton-grid" aria-label="正在加载关注作者" aria-busy="true">
          <article v-for="index in 8" :key="index" class="user-skeleton-card" aria-hidden="true">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-copy"><i></i><i></i><i></i></div>
            <div class="skeleton-pills"><i></i><i></i></div>
            <div class="skeleton-actions"><i></i><i></i></div>
          </article>
        </div>

        <div v-else-if="authorsCount === 0" class="users-empty">
          <i class="bi bi-person-plus" aria-hidden="true"></i>
          <strong>还没有关注任何作者</strong>
          <span>在作者主页点击关注或收藏合集后，这里会成为你的固定回访清单。</span>
          <router-link to="/search">
            <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
            <span>去逛壁纸</span>
          </router-link>
        </div>

        <div v-else-if="filteredAuthors.length === 0" class="users-empty">
          <i class="bi bi-search-heart" aria-hidden="true"></i>
          <strong>没有匹配到关注作者</strong>
          <span>换个关键词再找找，或者清空搜索查看完整列表。</span>
          <button class="is-ghost" type="button" @click="clearSearch">
            <i class="bi bi-x-circle" aria-hidden="true"></i>
            <span>清除搜索</span>
          </button>
        </div>

        <VirtualGrid
          v-else
          class="users-grid"
          :items="filteredAuthors"
          item-key="username"
          :min-column-width="virtualMinColumnWidth"
          :min-columns="1"
          :max-columns="5"
          :item-height="virtualCardHeight"
          :gap="16"
          :overscan-rows="3"
          :scroll-root="feedScrollRef"
          aria-label="关注作者列表"
        >
          <template #default="{ item: author, index }">
            <article class="user-card" role="listitem">
              <div class="user-card__top">
                <div class="avatar-shell">
                  <AuthenticatedImage
                    v-if="hasUsableAvatar(author)"
                    :src="author.avatarUrl"
                    :alt="`${author.username} 的头像`"
                    class="user-avatar"
                    :loading="index < 4 ? 'eager' : 'lazy'"
                    :fetchpriority="index === 0 ? 'high' : 'auto'"
                    root-margin="520px 0px"
                    :max-dimension="160"
                    :retry-count="1"
                    :unload-delay="4000"
                    @error="markAvatarFailed(author.avatarUrl)"
                  />
                  <div v-else class="user-avatar is-fallback">{{ author.initials }}</div>
                  <i class="avatar-status" aria-hidden="true"></i>
                </div>

                <div class="user-main">
                  <div class="user-title-line">
                    <h2 :title="author.username">{{ author.username }}</h2>
                    <span class="group-badge" :data-tone="author.tone">{{ author.group }}</span>
                  </div>
                  <p class="user-description">
                    {{ author.description || '这位作者暂时没有留下简介，去主页看看最新收藏。' }}
                  </p>
                </div>
              </div>

              <div class="author-status-row">
                <span v-if="author.isUserFollowed" class="author-status-pill">
                  <i class="bi bi-person-check" aria-hidden="true"></i>已关注作者
                </span>
                <span v-if="author.isCollectionFollowed" class="author-status-pill">
                  <i class="bi bi-bookmark-check" aria-hidden="true"></i>已收藏合集
                </span>
              </div>

              <footer class="user-footer">
                <button
                  class="card-button"
                  type="button"
                  @click="openUserPage(author.username)"
                >
                  <i class="bi bi-person-square" aria-hidden="true"></i><span>打开主页</span>
                </button>
                <div class="secondary-actions">
                  <button
                    v-if="author.isUserFollowed"
                    class="icon-card-button"
                    type="button"
                    :aria-label="`取消关注 ${author.username}`"
                    title="取消关注作者"
                    @click="removeUserFollow(author.username)"
                  >
                    <i class="bi bi-person-dash" aria-hidden="true"></i>
                  </button>
                  <button
                    v-if="author.isCollectionFollowed"
                    class="icon-card-button"
                    type="button"
                    :aria-label="`移除 ${author.username} 的合集收藏`"
                    title="移除合集收藏"
                    @click="removeCollectionFollow(author.username)"
                  >
                    <i class="bi bi-bookmark-x" aria-hidden="true"></i>
                  </button>
                </div>
              </footer>
            </article>
          </template>
        </VirtualGrid>
      </div>
    </section>
  </main>
</template>
