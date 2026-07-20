<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFavoritesStore } from '@/stores/favorites'
import { proxyWallhavenImageUrl } from '@/services/api'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'select'])

const router = useRouter()
const favoritesStore = useFavoritesStore()
const query = ref('')
const ready = ref(false)
const selectedCollectionId = ref('all')
const visibleCount = ref(120)

const collectionTabs = computed(() => favoritesStore.collections || [])

const favoriteItems = computed(() => {
  const list = Array.isArray(favoritesStore.favorites) ? favoritesStore.favorites : []
  const scoped =
    selectedCollectionId.value === 'all'
      ? list
      : list.filter(
          (item) =>
            Array.isArray(item.collections) &&
            item.collections.includes(selectedCollectionId.value),
        )
  const keyword = String(query.value || '').trim().toLowerCase()
  if (!keyword) return scoped
  return scoped.filter((item) => {
    const haystack = [
      item.id,
      item.resolution,
      item.category,
      item.purity,
      ...(Array.isArray(item.tags) ? item.tags.map((tag) => tag?.name || tag) : []),
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ')
    return haystack.includes(keyword)
  })
})
const visibleFavoriteItems = computed(() => favoriteItems.value.slice(0, visibleCount.value))

function thumbUrl(wallpaper = {}) {
  const raw =
    wallpaper.raw_thumbs?.large ||
    wallpaper.thumbs?.large ||
    wallpaper.raw_thumbnail ||
    wallpaper.thumbnail ||
    wallpaper.raw_thumbs?.original ||
    wallpaper.thumbs?.original ||
    wallpaper.raw_path ||
    wallpaper.path ||
    ''
  const value = String(raw || '').trim()
  if (!value) return ''
  return proxyWallhavenImageUrl(value)
}

function metaText(wallpaper = {}) {
  return [wallpaper.resolution, wallpaper.category, wallpaper.purity].filter(Boolean).join(' · ')
}

function pick(item) {
  emit('select', item)
}

function close() {
  emit('close')
}

function goFavorites() {
  close()
  router.push('/favorites')
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    query.value = ''
    selectedCollectionId.value = 'all'
    visibleCount.value = 120
    ready.value = false
    await favoritesStore.initFavorites().catch(() => null)
    ready.value = true
  },
)

watch([query, selectedCollectionId], () => {
  visibleCount.value = 120
})

onMounted(async () => {
  if (!props.open) return
  await favoritesStore.initFavorites().catch(() => null)
  ready.value = true
})
</script>

<template>
  <Teleport to="body">
    <section
      v-if="open"
      class="coloring-fav-layer"
      @click.self="close"
      @keydown.esc.prevent="close"
    >
      <div class="coloring-fav-modal" role="dialog" aria-modal="true" aria-label="从收藏选择线稿">
        <header class="coloring-fav-head">
          <div>
            <span>收藏壁纸</span>
            <strong>选择线稿来源</strong>
          </div>
          <button type="button" class="coloring-fav-close" title="关闭" @click="close">
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <div class="coloring-fav-toolbar">
          <label class="coloring-fav-search">
            <i class="bi bi-search"></i>
            <input
              v-model="query"
              type="search"
              placeholder="搜索 ID、分辨率、标签…"
              autocomplete="off"
            />
          </label>
          <small>{{ favoriteItems.length }} / {{ favoritesStore.favoritesCount }} 张</small>
        </div>

        <nav v-if="collectionTabs.length" class="coloring-fav-collections" aria-label="收藏夹筛选">
          <button type="button" :class="{ 'is-active': selectedCollectionId === 'all' }" @click="selectedCollectionId = 'all'"><i class="bi bi-grid"></i>全部收藏 <span>{{ favoritesStore.favoritesCount }}</span></button>
          <button v-for="collection in collectionTabs" :key="collection.id" type="button" :class="{ 'is-active': selectedCollectionId === collection.id }" @click="selectedCollectionId = collection.id"><i class="bi bi-folder"></i>{{ collection.name }} <span>{{ collection.count || 0 }}</span></button>
        </nav>

        <div v-if="!ready" class="coloring-fav-empty">
          <i class="bi bi-arrow-repeat spin"></i>
          <p>正在加载收藏…</p>
        </div>

        <div v-else-if="!favoriteItems.length" class="coloring-fav-empty">
          <i class="bi bi-heart"></i>
          <strong>{{ query ? '没有匹配的收藏' : '还没有收藏壁纸' }}</strong>
          <p>{{ query ? '试试换个关键词' : '先去收藏页挑几张，再回来选作线稿' }}</p>
          <button v-if="!query" type="button" class="coloring-fav-link" @click="goFavorites">
            去收藏页
          </button>
        </div>

        <div v-else class="coloring-fav-grid">
          <button
            v-for="item in visibleFavoriteItems"
            :key="item.id || thumbUrl(item)"
            type="button"
            class="coloring-fav-card"
            @click="pick(item)"
          >
            <img
              v-if="thumbUrl(item)"
              :src="thumbUrl(item)"
              :alt="item.id || '收藏壁纸'"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            />
            <div v-else class="coloring-fav-fallback">
              <i class="bi bi-image"></i>
            </div>
            <span>{{ item.id || 'Wallpaper' }}</span>
            <small v-if="metaText(item)">{{ metaText(item) }}</small>
          </button>
        </div>
        <button v-if="visibleFavoriteItems.length < favoriteItems.length" type="button" class="coloring-fav-more" @click="visibleCount += 120">再显示 {{ Math.min(120, favoriteItems.length - visibleFavoriteItems.length) }} 张</button>
      </div>
    </section>
  </Teleport>
</template>
