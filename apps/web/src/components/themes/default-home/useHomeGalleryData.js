/**
 * 首页馆藏数据：全部来自共享画廊 GET /api/gallery（cursor 分页取一页大样本），
 * 在前端切分给序厅拼贴 / 工坊配图 / 云端画廊 / 竖横展墙 / 随机星尘等展区。
 * 旧版的 Wallhaven 数据源已随后端下线，此文件是它的替代品。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listShareItems } from '@/services/shareGallery'

const HOME_GALLERY_LIMIT = 48

export function randomGallerySeed() {
  return Math.random().toString(16).slice(2, 8).padEnd(6, '0')
}

function normalizeGalleryItem(raw) {
  const cover = raw?.coverUrl || raw?.mediaUrls?.[0] || ''
  if (!raw?.id || !cover) return null
  return {
    id: String(raw.id),
    title: String(raw.title || '').trim() || 'AI 作品',
    cover,
    mediaUrls: Array.isArray(raw.mediaUrls) && raw.mediaUrls.length ? raw.mediaUrls : [cover],
    authorName: raw.author?.username || '社区创作者',
    authorAvatar: raw.author?.avatarUrl || '',
    createdAt: raw.createdAt || '',
  }
}

/** 从 start 开始环形取 count 件，列表内不重复（不足时有多少取多少）。 */
export function rotateSlice(list, start = 0, count = list.length) {
  const length = list.length
  if (!length) return []
  const offset = ((start % length) + length) % length
  const rotated = [...list.slice(offset), ...list.slice(0, offset)]
  return rotated.slice(0, Math.min(count, length))
}

/** 种子洗牌：同一种子结果稳定，换种子即换一批。 */
export function seededShuffle(list, seed = '') {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 16777619)
  }
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  const result = [...list]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

export function useHomeGalleryData() {
  const galleryItems = ref([])
  const isLoading = ref(true)
  const error = ref('')
  const hasMore = ref(false)
  let active = true
  let requestVersion = 0

  const galleryStats = computed(() => {
    const items = galleryItems.value
    return {
      works: items.length,
      creators: new Set(items.map((item) => item.authorName)).size,
    }
  })

  async function loadGallery() {
    const version = ++requestVersion
    isLoading.value = true
    error.value = ''
    try {
      const { items, nextCursor } = await listShareItems({ limit: HOME_GALLERY_LIMIT })
      if (!active || version !== requestVersion) return
      galleryItems.value = items.map(normalizeGalleryItem).filter(Boolean)
      hasMore.value = Boolean(nextCursor)
    } catch (loadError) {
      if (!active || version !== requestVersion) return
      console.warn('首页画廊馆藏读取失败:', loadError)
      error.value = loadError?.message || '馆藏暂时无法连接'
    } finally {
      if (active && version === requestVersion) isLoading.value = false
    }
  }

  onMounted(() => {
    active = true
    void loadGallery()
  })

  onBeforeUnmount(() => {
    active = false
    requestVersion += 1
  })

  return {
    galleryItems,
    galleryStats,
    isLoading,
    error,
    hasMore,
    reload: loadGallery,
  }
}
