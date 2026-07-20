<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRouter } from 'vue-router'

const props = defineProps({
  limit: {
    type: Number,
    default: 5,
  },
})

const emit = defineEmits(['preview-wallpaper'])

// 获取stores
const settingsStore = useSettingsStore()
const router = useRouter()

// 本地状态
const isLoading = ref(true)
const downloads = ref([])
const searchQuery = ref('')
const sortBy = ref('date')
const sortOrder = ref('desc')

// 计算属性 - 下载总数
const downloadCount = computed(() => {
  return settingsStore.settings.download_count || 0
})

// 计算属性 - 下载路径
const downloadPath = computed(() => {
  return settingsStore.settings.save_dir || '未设置'
})

// 计算属性 - 筛选和排序后的下载
const filteredDownloads = computed(() => {
  let result = [...downloads.value]

  // 搜索筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter(
      (item) =>
        item.id.toLowerCase().includes(query) ||
        (item.tags && item.tags.some((tag) => tag.toLowerCase().includes(query))),
    )
  }

  // 排序
  result.sort((a, b) => {
    let comparison = 0

    if (sortBy.value === 'date') {
      comparison = new Date(b.downloaded_at) - new Date(a.downloaded_at)
    } else if (sortBy.value === 'size') {
      comparison = b.file_size - a.file_size
    } else if (sortBy.value === 'resolution') {
      const getPixels = (res) => {
        const [width, height] = res.split('x').map(Number)
        return width * height
      }
      comparison = getPixels(b.resolution) - getPixels(a.resolution)
    }

    return sortOrder.value === 'asc' ? -comparison : comparison
  })

  // 限制数量
  return result.slice(0, props.limit)
})

// 计算属性 - 总下载大小
const totalDownloadSize = computed(() => {
  const total = downloads.value.reduce((sum, item) => sum + (item.file_size || 0), 0)
  return formatFileSize(total)
})

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 格式化日期
function formatDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 预览壁纸
function previewWallpaper(wallpaper) {
  emit('preview-wallpaper', wallpaper)
}

// 导航到壁纸详情页
function navigateToWallpaper(id) {
  router.push({ name: 'wallpaper', params: { id } })
}

// 导航到下载管理页面
function navigateToDownloads() {
  router.push({ name: 'downloads' })
}

// 设置排序
function setSorting(by) {
  if (sortBy.value === by) {
    // 如果已经按这个字段排序，则切换排序顺序
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    // 否则，设置新的排序字段，默认降序
    sortBy.value = by
    sortOrder.value = 'desc'
  }
}

// 组件挂载时初始化
onMounted(() => {
  // 从设置中获取下载历史
  const downloadHistory = settingsStore.settings.download_history || []
  downloads.value = downloadHistory
  isLoading.value = false
})
</script>

<template>
  <section class="download-craft" aria-label="下载历史">
    <header class="download-craft__head">
      <div class="download-craft__title-block">
        <span class="download-craft__kicker">Downloads</span>
        <h3 class="download-craft__title">下载历史</h3>
      </div>
      <button type="button" class="download-craft__cta" @click="navigateToDownloads">
        查看全部
      </button>
    </header>

    <div class="download-craft__stats">
      <div class="download-craft__stat">
        <strong>{{ downloadCount }}</strong>
        <span>总下载</span>
      </div>
      <div class="download-craft__stat">
        <strong>{{ totalDownloadSize }}</strong>
        <span>总大小</span>
      </div>
      <div class="download-craft__stat download-craft__stat--path">
        <span>下载路径</span>
        <strong class="download-craft__path">{{ downloadPath }}</strong>
      </div>
    </div>

    <div class="download-craft__toolbar">
      <label class="download-craft__search">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          type="search"
          placeholder="搜索下载记录…"
          v-model="searchQuery"
          aria-label="搜索下载记录"
        />
      </label>
      <div class="download-craft__sorts" role="group" aria-label="排序">
        <button
          type="button"
          class="download-craft__sort"
          :class="{ 'is-active': sortBy === 'date' }"
          @click="setSorting('date')"
        >
          <i
            class="bi"
            :class="sortBy === 'date' && sortOrder === 'desc' ? 'bi-sort-down' : 'bi-sort-up'"
            aria-hidden="true"
          ></i>
          日期
        </button>
        <button
          type="button"
          class="download-craft__sort"
          :class="{ 'is-active': sortBy === 'size' }"
          @click="setSorting('size')"
        >
          <i
            class="bi"
            :class="sortBy === 'size' && sortOrder === 'desc' ? 'bi-sort-down' : 'bi-sort-up'"
            aria-hidden="true"
          ></i>
          大小
        </button>
        <button
          type="button"
          class="download-craft__sort"
          :class="{ 'is-active': sortBy === 'resolution' }"
          @click="setSorting('resolution')"
        >
          <i
            class="bi"
            :class="
              sortBy === 'resolution' && sortOrder === 'desc' ? 'bi-sort-down' : 'bi-sort-up'
            "
            aria-hidden="true"
          ></i>
          分辨率
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="download-craft__state">
      <span class="download-craft__spinner" aria-hidden="true"></span>
      <p>加载下载历史…</p>
    </div>

    <div v-else-if="downloads.length === 0" class="download-craft__empty">
      <i class="bi bi-cloud-download" aria-hidden="true"></i>
      <p>还没有下载过壁纸</p>
      <small>找到喜欢的画面后，一键保存到本地。</small>
      <router-link to="/search" class="download-craft__cta">浏览壁纸</router-link>
    </div>

    <div v-else-if="filteredDownloads.length === 0" class="download-craft__empty">
      <i class="bi bi-search" aria-hidden="true"></i>
      <p>没有找到匹配的下载记录</p>
      <small>试试其他关键词，或清空搜索。</small>
      <button type="button" class="download-craft__cta download-craft__cta--ghost" @click="searchQuery = ''">
        清空搜索
      </button>
    </div>

    <ul v-else class="download-craft__list">
      <li v-for="download in filteredDownloads" :key="download.id" class="download-craft__row">
        <button
          type="button"
          class="download-craft__thumb"
          @click="previewWallpaper(download)"
        >
          <img :src="download.thumbnail || download.thumbs?.small" :alt="download.id || '下载预览'" />
        </button>

        <div class="download-craft__info">
          <button
            type="button"
            class="download-craft__id"
            @click="navigateToWallpaper(download.id)"
          >
            {{ download.id }}
          </button>
          <div class="download-craft__meta">
            <span>{{ download.resolution }}</span>
            <span>{{ formatFileSize(download.file_size) }}</span>
            <span>{{ formatDate(download.downloaded_at) }}</span>
          </div>
          <div v-if="download.tags && download.tags.length" class="download-craft__tags">
            <span
              v-for="(tag, index) in download.tags.slice(0, 3)"
              :key="index"
              class="download-craft__tag"
            >
              {{ tag }}
            </span>
            <span v-if="download.tags.length > 3" class="download-craft__tag download-craft__tag--more">
              +{{ download.tags.length - 3 }}
            </span>
          </div>
        </div>

        <button
          type="button"
          class="download-craft__action"
          title="查看详情"
          @click="navigateToWallpaper(download.id)"
        >
          <i class="bi bi-arrow-right" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.download-craft {
  --dc-ink: var(--pf-ink, #151a2d);
  --dc-accent: var(--pf-accent, #6a4fe0);
  --dc-accent-soft: var(--pf-accent-soft, rgba(106, 79, 224, 0.1));
  --dc-line: var(--pf-line, rgba(21, 26, 45, 0.1));
  --dc-line-strong: var(--pf-line-strong, rgba(106, 79, 224, 0.4));
  --dc-card: var(--pf-card, #ffffff);
  --dc-heading: var(--pf-heading, #151a2d);
  --dc-text: var(--pf-text, #3a4258);
  --dc-muted: var(--pf-muted, #79809a);
  --dc-subtle: var(--pf-subtle, #8a91a5);
  --dc-song: var(--pf-song, 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif);
  --dc-mono: var(--pf-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  --dc-stamp: var(--pf-stamp, 4px 4px 0 rgba(106, 79, 224, 0.18));
  --dc-stamp-soft: var(--pf-stamp-soft, 3px 3px 0 rgba(106, 79, 224, 0.12));
  --dc-ease: var(--pf-ease, cubic-bezier(0.22, 0.8, 0.24, 1));

  display: grid;
  gap: 14px;
  padding: 16px;
  background: var(--dc-card);
  color: var(--dc-text);
  box-shadow:
    inset 0 0 0 1px var(--dc-line),
    var(--dc-stamp-soft);
}

.download-craft__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.download-craft__kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--dc-accent);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.download-craft__title {
  margin: 0;
  font-family: var(--dc-song);
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--dc-heading);
  line-height: 1.2;
}

.download-craft__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  background: var(--dc-ink);
  color: #fff;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--dc-stamp);
  transition:
    transform 0.16s var(--dc-ease),
    background 0.16s var(--dc-ease);
}

.download-craft__cta:hover {
  transform: translate(-1px, -1px);
  background: var(--dc-accent);
  color: #fff;
}

.download-craft__cta--ghost {
  background: transparent;
  color: var(--dc-heading);
  box-shadow: inset 0 0 0 1px var(--dc-line);
}

html.color-scheme-dark .download-craft__cta:not(.download-craft__cta--ghost) {
  background: var(--dc-accent);
  color: var(--pf-on-accent, #12101c);
}

.download-craft__stats {
  display: grid;
  grid-template-columns: minmax(90px, 0.7fr) minmax(90px, 0.7fr) minmax(0, 1.6fr);
  gap: 8px;
}

.download-craft__stat {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px;
  background: var(--pf-card-soft, rgba(106, 79, 224, 0.06));
  box-shadow: inset 0 0 0 1px var(--dc-line);
}

.download-craft__stat strong {
  font-family: var(--dc-mono);
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--dc-heading);
  word-break: break-all;
}

.download-craft__stat span {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dc-subtle);
}

.download-craft__stat--path {
  grid-template-rows: auto 1fr;
}

.download-craft__path {
  font-size: 0.78rem !important;
  font-weight: 650 !important;
  line-height: 1.4;
  color: var(--dc-text) !important;
}

.download-craft__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.download-craft__search {
  flex: 1;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  background: transparent;
  color: var(--dc-muted);
  box-shadow: inset 0 0 0 1px var(--dc-line);
}

.download-craft__search i {
  color: var(--dc-accent);
  font-size: 0.85rem;
}

.download-craft__search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--dc-heading);
  font: inherit;
  font-size: 0.84rem;
}

.download-craft__search input::placeholder {
  color: var(--dc-subtle);
}

.download-craft__sorts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.download-craft__sort {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--dc-muted);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--dc-line);
  transition:
    background 0.16s var(--dc-ease),
    color 0.16s var(--dc-ease),
    box-shadow 0.16s var(--dc-ease);
}

.download-craft__sort:hover {
  color: var(--dc-heading);
  background: var(--dc-accent-soft);
}

.download-craft__sort.is-active {
  background: var(--dc-ink);
  color: #fff;
  box-shadow: var(--dc-stamp);
}

html.color-scheme-dark .download-craft__sort.is-active {
  background: var(--dc-accent);
  color: var(--pf-on-accent, #12101c);
}

.download-craft__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.download-craft__row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  box-shadow: inset 0 0 0 1px var(--dc-line);
  transition:
    background 0.16s var(--dc-ease),
    box-shadow 0.16s var(--dc-ease),
    transform 0.16s var(--dc-ease);
}

.download-craft__row:hover {
  background: var(--dc-accent-soft);
  transform: translate(-1px, -1px);
  box-shadow:
    inset 0 0 0 1px var(--dc-line-strong),
    var(--dc-stamp-soft);
}

.download-craft__thumb {
  width: 64px;
  height: 64px;
  padding: 0;
  border: none;
  border-radius: 0;
  overflow: hidden;
  cursor: pointer;
  background: var(--pf-card-mute, rgba(106, 79, 224, 0.035));
  box-shadow: inset 0 0 0 1px var(--dc-line);
}

.download-craft__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.download-craft__info {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.download-craft__id {
  justify-self: start;
  padding: 0;
  border: none;
  background: none;
  color: var(--dc-accent);
  font: inherit;
  font-family: var(--dc-mono);
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.download-craft__id:hover {
  color: var(--dc-heading);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.download-craft__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-family: var(--dc-mono);
  font-size: 0.72rem;
  color: var(--dc-subtle);
}

.download-craft__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.download-craft__tag {
  padding: 2px 6px;
  font-size: 0.7rem;
  font-weight: 650;
  color: var(--dc-muted);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--dc-line);
}

.download-craft__tag--more {
  color: var(--dc-accent);
  background: var(--dc-accent-soft);
  box-shadow: none;
}

.download-craft__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--dc-card);
  color: var(--dc-heading);
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px var(--dc-line),
    2px 2px 0 rgba(106, 79, 224, 0.12);
  transition:
    transform 0.16s var(--dc-ease),
    box-shadow 0.16s var(--dc-ease),
    background 0.16s var(--dc-ease);
}

.download-craft__action:hover {
  background: var(--dc-accent);
  color: #fff;
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.22);
}

.download-craft__state,
.download-craft__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
  color: var(--dc-muted);
  box-shadow: inset 0 0 0 1px var(--dc-line);
}

.download-craft__state p,
.download-craft__empty p {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
  color: var(--dc-heading);
}

.download-craft__empty i {
  font-size: 1.8rem;
  color: var(--dc-accent);
}

.download-craft__empty small {
  font-size: 0.8rem;
}

.download-craft__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--dc-line);
  border-top-color: var(--dc-accent);
  border-radius: 0;
  animation: download-craft-spin 0.7s linear infinite;
}

@keyframes download-craft-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .download-craft__stats {
    grid-template-columns: 1fr 1fr;
  }

  .download-craft__stat--path {
    grid-column: 1 / -1;
  }
}

@media (max-width: 520px) {
  .download-craft__row {
    grid-template-columns: 52px minmax(0, 1fr) auto;
  }

  .download-craft__thumb {
    width: 52px;
    height: 52px;
  }
}
</style>
