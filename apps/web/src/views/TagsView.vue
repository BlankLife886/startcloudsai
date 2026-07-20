<script setup>
import { useTagsPageMotion } from '@/features/tags/composables/useTagsPageMotion'
import '@/features/tags/styles/tags-view.css'
import { useUserStore } from '@/stores/user'
import { tagCategoryLabel } from '@/utils/tagTone'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const userStore = useUserStore()

const pageRoot = ref(null)
const feedScrollRef = ref(null)
const pageReady = ref(false)
const searchQuery = ref('')
const sortBy = ref('date')
const sortOrder = ref('desc')
const isLoading = ref(false)

const categoryLabels = {
  general: '常规',
  anime: '动漫',
  people: '人物',
  photography: '摄影',
  artists: '艺术家',
  'art & design': '艺术设计',
  art: '艺术',
  digital: '数字创作',
  clothing: '服饰',
  colors: '颜色',
  color: '颜色',
  vehicles: '载具',
  vehicle: '载具',
  animals: '动物',
  animal: '动物',
}

const tags = computed(() => {
  const raw = Object.values(userStore.followedTags || {})
  let result = [...raw]

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter((tag) => {
      const name = String(tag.name || '').toLowerCase()
      const category = String(tag.category || '').toLowerCase()
      const alias = Array.isArray(tag.alias) ? tag.alias.join(' ').toLowerCase() : ''
      return name.includes(query) || category.includes(query) || alias.includes(query)
    })
  }

  result.sort((a, b) => {
    if (sortBy.value === 'name') {
      const nameA = String(a.name || '')
      const nameB = String(b.name || '')
      return sortOrder.value === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA)
    }

    const dateA = new Date(a.followed_at || 0)
    const dateB = new Date(b.followed_at || 0)
    return sortOrder.value === 'asc' ? dateA - dateB : dateB - dateA
  })

  return result
})

const tagsCount = computed(() => userStore.followedTagsCount)

function tagName(tag) {
  return String(tag.name || tag.key || '').trim()
}

function tagCategory(tag) {
  const raw = tagCategoryLabel(tag)
  return categoryLabels[raw] || raw || '未分类'
}

function changeSorting(mode) {
  if (sortBy.value === mode) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortBy.value = mode
  sortOrder.value = mode === 'name' ? 'asc' : 'desc'
}

function clearSearch() {
  searchQuery.value = ''
}

function openTag(tag) {
  const name = tagName(tag)
  if (!name) return
  router.push({ name: 'search', query: { query: name } })
}

function removeTag(tag) {
  const name = tagName(tag)
  if (!name) return
  if (!confirm(`确定要移除标签「${name}」吗？`)) return
  userStore.unfollowTag(name)
}

function formatDate(value) {
  if (!value) return '未知时间'
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function browseWallpapers() {
  router.push({ path: '/search' })
}

useTagsPageMotion({
  pageRef: pageRoot,
  feedRef: feedScrollRef,
  ready: pageReady,
  filterKey: computed(() => `${searchQuery.value.trim()}::${sortBy.value}::${sortOrder.value}`),
  loading: isLoading,
})

onBeforeMount(() => {
  document.documentElement.classList.add('tags-gallery-page')
  userStore.initUserData()
})

onMounted(async () => {
  isLoading.value = true
  userStore.initUserData()
  await nextTick()
  isLoading.value = false
  pageReady.value = true
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('tags-gallery-page')
})
</script>

<template>
  <main ref="pageRoot" class="tags-page" :class="{ 'is-ready': pageReady }">
    <div class="tags-atmosphere" aria-hidden="true"></div>

    <header class="tags-toolbar" data-tags-motion>
      <div class="tags-toolbar__lead">
        <h1>收藏标签</h1>
        <div class="tags-stats" aria-label="标签统计">
          <div class="tags-stat-chip">
            <strong>{{ tagsCount }}</strong>
            <span>标签</span>
          </div>
          <div class="tags-stat-chip">
            <strong>{{ tags.length }}</strong>
            <span>当前</span>
          </div>
        </div>
      </div>

      <label class="tags-search">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="搜索标签或分类"
          aria-label="搜索收藏标签"
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

      <div class="tags-toolbar__sorts" role="group" aria-label="排序">
        <button
          class="tags-sort-btn"
          type="button"
          :class="{ 'is-active': sortBy === 'date' }"
          @click="changeSorting('date')"
        >
          <i class="bi bi-calendar2-week" aria-hidden="true"></i>
          <span>按收藏时间</span>
        </button>
        <button
          class="tags-sort-btn"
          type="button"
          :class="{ 'is-active': sortBy === 'name' }"
          @click="changeSorting('name')"
        >
          <i class="bi bi-sort-alpha-down" aria-hidden="true"></i>
          <span>按名称</span>
        </button>
      </div>
    </header>

    <section class="tags-body" data-tags-motion>
      <div ref="feedScrollRef" class="tags-feed">
        <div
          v-if="isLoading"
          class="tags-skeleton-grid"
          aria-label="正在加载标签"
          aria-busy="true"
        >
          <div v-for="index in 8" :key="index" class="tags-skeleton-card" aria-hidden="true"></div>
        </div>

        <div v-else-if="tagsCount === 0" class="tags-empty">
          <i class="bi bi-tags" aria-hidden="true"></i>
          <strong>还没有收藏标签</strong>
          <span>在半屏详情里点击标签右侧的书签按钮后，这里会成为你的标签速查表。</span>
          <button type="button" @click="browseWallpapers">
            <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
            <span>去浏览壁纸</span>
          </button>
        </div>

        <div v-else-if="tags.length === 0" class="tags-empty">
          <i class="bi bi-search-heart" aria-hidden="true"></i>
          <strong>没有匹配到标签</strong>
          <span>换个关键词试试，或者清空搜索查看完整收藏标签。</span>
          <button class="is-ghost" type="button" @click="clearSearch">
            <i class="bi bi-x-circle" aria-hidden="true"></i>
            <span>清除搜索</span>
          </button>
        </div>

        <div v-else class="tags-grid">
          <article v-for="tag in tags" :key="tag.key || tag.name" class="tag-card">
            <button class="tag-main" type="button" @click="openTag(tag)">
              <span class="tag-icon" aria-hidden="true"><i class="bi bi-tag-fill"></i></span>
              <span class="tag-copy">
                <strong>{{ tagName(tag) }}</strong>
                <small>{{ tagCategory(tag) }} · 收藏于 {{ formatDate(tag.followed_at) }}</small>
              </span>
            </button>

            <button
              class="tag-remove"
              type="button"
              :title="`移除 ${tagName(tag)}`"
              @click="removeTag(tag)"
            >
              <i class="bi bi-bookmark-x" aria-hidden="true"></i>
              <span>移除</span>
            </button>
          </article>
        </div>
      </div>
    </section>
  </main>
</template>
