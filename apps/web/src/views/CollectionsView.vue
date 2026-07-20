<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const searchQuery = ref('')
const sortBy = ref('date')
const sortOrder = ref('desc')
const isLoading = ref(false)

const collections = computed(() => {
  const collectionsArray = Object.values(userStore.followedCollections || {})
  let result = [...collectionsArray]

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter((item) => {
      return (
        item.username?.toLowerCase().includes(query) ||
        item.group?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
      )
    })
  }

  result.sort((a, b) => {
    if (sortBy.value === 'name') {
      const valueA = a.username || ''
      const valueB = b.username || ''
      return sortOrder.value === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA)
    }

    const dateA = new Date(a.followed_at || 0)
    const dateB = new Date(b.followed_at || 0)
    return sortOrder.value === 'asc' ? dateA - dateB : dateB - dateA
  })

  return result
})

const collectionsCount = computed(() => userStore.followedCollectionsCount)

function changeSorting(mode) {
  if (sortBy.value === mode) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortBy.value = mode
  sortOrder.value = 'desc'
}

function clearSearch() {
  searchQuery.value = ''
}

function openCollection(username) {
  router.push({ name: 'user', params: { username } })
}

function unfollowCollection(username) {
  if (confirm(`确定要移除 ${username} 的合集收藏吗？`)) {
    userStore.unfollowCollection(username)
  }
}

function formatDate(value) {
  if (!value) return '未知时间'
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getCollectionTone(group) {
  const value = (group || 'member').toLowerCase()
  if (value.includes('admin')) return 'danger'
  if (value.includes('moderator')) return 'warning'
  if (value.includes('developer')) return 'info'
  if (value.includes('pro')) return 'success'
  return 'neutral'
}

function getInitials(username) {
  return (username || '?').slice(0, 2).toUpperCase()
}

onMounted(() => {
  isLoading.value = true
  userStore.initUserData()
  isLoading.value = false
})
</script>

<template>
  <div class="collections-page">
    <section class="collections-hero">
      <h1 class="sr-only">收藏的合集</h1>

      <div class="hero-tools">
        <div class="toolbar-row">
          <div class="hero-counts">
            <div class="count-chip">
              <strong>{{ collectionsCount }}</strong>
              <span>合集</span>
            </div>
            <div class="count-chip ghost">
              <strong>{{ collections.length }}</strong>
              <span>当前</span>
            </div>
          </div>

          <label class="toolbar-search">
            <i class="bi bi-search"></i>
            <input v-model="searchQuery" type="text" placeholder="搜索用户名或分组" />
            <button v-if="searchQuery" type="button" class="search-clear" @click="clearSearch">
              <i class="bi bi-x-lg"></i>
            </button>
          </label>

          <div class="toolbar-buttons">
            <button
              class="toolbar-button"
              :class="{ active: sortBy === 'date' }"
              @click="changeSorting('date')"
            >
              <i class="bi bi-calendar2-week"></i>
              <span>按收藏时间</span>
            </button>
            <button
              class="toolbar-button"
              :class="{ active: sortBy === 'name' }"
              @click="changeSorting('name')"
            >
              <i class="bi bi-sort-alpha-down"></i>
              <span>按用户名</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="isLoading" class="state-panel">
      <div class="state-icon"><i class="bi bi-arrow-repeat spin"></i></div>
      <h2>正在加载合集</h2>
      <p>稍等一下，正在整理你收藏过的作者主页。</p>
    </section>

    <section v-else-if="collectionsCount === 0" class="state-panel">
      <div class="state-icon"><i class="bi bi-bookmark-heart"></i></div>
      <h2>这里还没有合集</h2>
      <p>浏览作者主页并加入收藏后，这里会成为你的作者速查表。</p>
      <router-link to="/search" class="state-action">
        <i class="bi bi-grid-3x3-gap"></i>
        <span>去浏览壁纸</span>
      </router-link>
    </section>

    <section v-else-if="collections.length === 0" class="state-panel">
      <div class="state-icon"><i class="bi bi-search"></i></div>
      <h2>没有找到匹配项</h2>
      <p>换个关键词试试，或者清空搜索回到完整合集列表。</p>
      <button class="state-action ghost" type="button" @click="clearSearch">
        <i class="bi bi-x-circle"></i>
        <span>清除搜索</span>
      </button>
    </section>

    <section v-else class="collections-grid">
      <article v-for="collection in collections" :key="collection.username" class="collection-card">
        <div class="collection-card-top">
          <div class="collection-avatar-shell">
            <img
              v-if="collection.avatar_url"
              :src="collection.avatar_url"
              :alt="collection.username"
              class="collection-avatar"
            />
            <div v-else class="collection-avatar fallback">
              {{ getInitials(collection.username) }}
            </div>
          </div>

          <div class="collection-main">
            <div class="collection-title-line">
              <h2>{{ collection.username }}</h2>
              <span class="group-badge" :data-tone="getCollectionTone(collection.group)">
                {{ collection.group || 'Member' }}
              </span>
            </div>
            <p class="collection-meta">收藏于 {{ formatDate(collection.followed_at) }}</p>
            <p v-if="collection.description" class="collection-description">
              {{ collection.description }}
            </p>
          </div>
        </div>

        <div class="collection-footer">
          <button
            class="card-button primary"
            type="button"
            @click="openCollection(collection.username)"
          >
            <i class="bi bi-box-arrow-up-right"></i>
            <span>打开合集</span>
          </button>
          <button
            class="card-button subtle"
            type="button"
            @click="unfollowCollection(collection.username)"
          >
            <i class="bi bi-bookmark-x"></i>
            <span>移除收藏</span>
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.collections-page {
  padding: 24px clamp(18px, 3vw, 34px) 44px;
  max-width: 100%;
  overflow-x: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.collections-hero {
  display: grid;
  gap: 14px;
}

.hero-tools {
  padding: 14px;
  border-radius: 15px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.035);
}

.toolbar-row {
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.toolbar-search {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.toolbar-search i {
  color: rgba(255, 255, 255, 0.62);
}

.toolbar-search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: #ffffff;
  min-height: 42px;
}

.toolbar-search input:focus {
  outline: none;
}

.toolbar-search input::placeholder {
  color: rgba(255, 255, 255, 0.42);
}

.search-clear {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}

.toolbar-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 0;
}

.toolbar-button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: none;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.84);
  background: rgba(255, 255, 255, 0.07);
  font-size: 0.84rem;
  font-weight: 680;
  white-space: nowrap;
}

.toolbar-button.active {
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.22);
}

.hero-counts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.count-chip {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  padding: 7px 11px;
  border-radius: 999px;
  color: #ffffff;
  background: rgba(13, 110, 253, 0.82);
}

.count-chip.ghost {
  background: rgba(255, 255, 255, 0.09);
}

.count-chip strong {
  font-size: 0.98rem;
  line-height: 1;
}

.count-chip span {
  font-size: 0.78rem;
  opacity: 0.88;
}

.state-panel {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 22px;
  padding: 40px 24px;
  border-radius: 18px;
  text-align: center;
  background: rgba(255, 255, 255, 0.04);
}

.state-icon {
  width: 82px;
  height: 82px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.14);
}

.state-icon i {
  font-size: 2.4rem;
}

.spin {
  animation: spin 1s linear infinite;
}

.state-panel h2 {
  margin: 0;
  color: #ffffff;
  font-size: 1.28rem;
  font-weight: 800;
}

.state-panel p {
  max-width: 440px;
  margin: 0;
  color: rgba(255, 255, 255, 0.66);
  line-height: 1.65;
}

.state-action {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  color: #ffffff;
  text-decoration: none;
  background: var(--primary-color);
  font-weight: 720;
}

.state-action.ghost {
  background: transparent;
  border: 1px solid rgba(var(--primary-color-rgb), 0.42);
  color: var(--primary-color);
}

.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
  margin-top: 22px;
}

.collection-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  min-height: 240px;
  padding: 20px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  transition:
    transform 0.18s ease,
    background 0.18s ease;
}

.collection-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.07);
}

.collection-card-top {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.collection-avatar-shell {
  flex: 0 0 auto;
}

.collection-avatar,
.collection-avatar.fallback {
  width: 62px;
  height: 62px;
  border-radius: 18px;
  object-fit: cover;
}

.collection-avatar.fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 800;
  background: linear-gradient(135deg, rgba(var(--primary-color-rgb), 0.4), rgba(13, 110, 253, 0.6));
}

.collection-main {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.collection-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.collection-title-line h2 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ffffff;
  font-size: 1.12rem;
  font-weight: 780;
}

.group-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 760;
}

.group-badge[data-tone='neutral'] {
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.09);
}

.group-badge[data-tone='success'] {
  color: #bbffcf;
  background: rgba(43, 169, 92, 0.22);
}

.group-badge[data-tone='warning'] {
  color: #ffe39a;
  background: rgba(255, 193, 7, 0.2);
}

.group-badge[data-tone='danger'] {
  color: #ffb3b8;
  background: rgba(220, 53, 69, 0.2);
}

.group-badge[data-tone='info'] {
  color: #a6e7ff;
  background: rgba(13, 202, 240, 0.2);
}

.collection-meta {
  margin: 8px 0 0;
  color: rgba(255, 255, 255, 0.56);
  font-size: 0.84rem;
}

.collection-description {
  margin: 0;
  color: rgba(255, 255, 255, 0.74);
  line-height: 1.65;
}

.collection-footer {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.card-button {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  font-weight: 720;
}

.card-button.primary {
  color: #ffffff;
  background: var(--primary-color);
}

.card-button.subtle {
  color: rgba(255, 255, 255, 0.84);
  background: rgba(255, 255, 255, 0.08);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .toolbar-row {
    grid-template-columns: 1fr;
  }

  .hero-counts,
  .toolbar-buttons {
    flex-wrap: wrap;
  }
}

@media (max-width: 1180px) {
  .toolbar-button {
    width: 42px;
    justify-content: center;
    padding: 0;
  }

  .toolbar-button span {
    display: none;
  }
}

@media (max-width: 640px) {
  .collections-page {
    padding: 16px 14px 32px;
  }

  .collections-hero {
    padding: 18px;
  }

  .hero-title-row {
    align-items: flex-start;
  }

  .collection-card {
    min-height: 0;
  }

  .collection-footer {
    flex-direction: column;
  }

  .card-button {
    width: 100%;
  }
}
</style>
