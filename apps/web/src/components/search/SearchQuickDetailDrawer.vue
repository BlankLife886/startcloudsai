<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import notificationService from '@/services/notification'
import { useUserStore } from '@/stores/user'
import { purityLabel, purityTone } from '@/utils/purity'
import { tagTone } from '@/utils/tagTone'
import { useAppearanceStore } from '@/stores/appearance'

const emit = defineEmits(['close', 'preview', 'similar', 'filter-color'])

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
  wallpaper: {
    type: Object,
    default: null,
  },
})

const router = useRouter()
const userStore = useUserStore()
const appearanceStore = useAppearanceStore()
const drawerRef = ref(null)
let previousBodyOverflow = ''

const tags = computed(() => {
  const t = props.wallpaper?.tags
  return Array.isArray(t) ? t : []
})

function tagClass(t) {
  return tagTone(t)
}

const authorLabel = computed(() => {
  const uploader = props.wallpaper?.uploader
  if (!uploader) return '未知'
  if (typeof uploader === 'string') return uploader.trim() || '未知'
  if (typeof uploader === 'object') {
    return String(uploader.username || uploader.name || uploader.id || '未知')
  }
  return String(uploader)
})

const authorUsername = computed(() =>
  String(authorLabel.value || '')
    .replace(/^@+/, '')
    .trim(),
)

const isAuthorFavorited = computed(() => {
  const username = authorUsername.value
  return !!username && username !== '未知' && userStore.isFollowing(username)
})

const purityText = computed(() => {
  const value = String(props.wallpaper?.purity || '').toLowerCase()
  return purityLabel(value)
})

const purityClass = computed(() => `qd-purity qd-purity--${purityTone(props.wallpaper?.purity)}`)

function tagLabel(t) {
  return typeof t === 'object' && t ? String(t.name || '') : String(t || '')
}

function isTagFavorited(t) {
  const name = tagLabel(t).trim()
  return !!name && userStore.isFollowingTag(name)
}

function tagSearch(t, e) {
  e.preventDefault()
  const name = tagLabel(t).trim()
  if (!name) return
  router.push({ name: 'search', query: { query: name } })
  emit('close')
}

function authorSearch(e) {
  e.preventDefault()
  const u = authorUsername.value
  if (!u) return
  router.push({ name: 'search', query: { query: `@${u}` } })
  emit('close')
}

function toggleAuthorFavorite(e) {
  e.preventDefault()
  const username = authorUsername.value
  if (!username || username === '未知') return

  if (userStore.isFollowing(username)) {
    userStore.unfollowUser(username)
    notificationService.info(`已取消收藏作者 ${username}`, {
      duration: 2600,
      position: 'top-right',
    })
    return
  }

  userStore.followUser(username)
  notificationService.success(`已收藏作者 ${username}`, {
    duration: 2600,
    position: 'top-right',
  })
}

function toggleTagFavorite(t, e) {
  e.preventDefault()
  e.stopPropagation()

  const name = tagLabel(t).trim()
  if (!name) return

  if (userStore.isFollowingTag(name)) {
    userStore.unfollowTag(name)
    notificationService.info(`已取消收藏标签 ${name}`, {
      duration: 2400,
      position: 'top-right',
    })
    return
  }

  const tagData = typeof t === 'object' && t ? { ...t } : {}
  userStore.followTag(name, tagData)
  notificationService.success(`已收藏标签 ${name}`, {
    duration: 2400,
    position: 'top-right',
  })
}

function colorClick(hex, e) {
  e.preventDefault()
  const h = String(hex).replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(h)) {
    emit('filter-color', h)
  }
  emit('close')
}

function onPreviewClick() {
  emit('preview')
  emit('close')
}

function onSimilarClick() {
  emit('similar')
  emit('close')
}

const palette = computed(() => {
  const c = props.wallpaper?.colors
  if (!Array.isArray(c)) return []
  return c
    .slice(0, 8)
    .map((x) => (typeof x === 'string' ? x.replace(/^#/, '').toLowerCase() : ''))
    .filter((h) => /^[0-9a-f]{6}$/.test(h))
})

const heroImage = computed(() => {
  const wallpaper = props.wallpaper || {}
  return (
    wallpaper.raw_path ||
    wallpaper.path ||
    wallpaper.url ||
    wallpaper.full ||
    wallpaper.raw_thumbs?.original ||
    wallpaper.thumbs?.original ||
    wallpaper.raw_thumbs?.large ||
    wallpaper.thumbs?.large ||
    wallpaper.raw_thumbnail ||
    wallpaper.thumbnail ||
    ''
  )
})

function formatFileSize(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDate(value) {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '未知'
}

const categoryText = computed(() => {
  const value = String(props.wallpaper?.category || '').toLowerCase()
  const labels = {
    general: '常规',
    anime: '动漫',
    people: '人物',
  }
  return labels[value] || value || '未知'
})

const fileTypeText = computed(() => {
  const type = props.wallpaper?.file_type
  if (type)
    return String(type)
      .replace(/^image\//i, '')
      .toUpperCase()
  const path = String(props.wallpaper?.path || props.wallpaper?.url || '')
  const ext = path.split('.').pop()
  return ext && ext !== path ? ext.toUpperCase() : '未知'
})

const dimensionText = computed(() => {
  const x = props.wallpaper?.dimension_x
  const y = props.wallpaper?.dimension_y
  if (x && y) return `${x} x ${y}`
  return props.wallpaper?.resolution || '未知'
})

const summaryStats = computed(() => [
  { label: '分辨率', value: props.wallpaper?.resolution || '未知', icon: 'bi-aspect-ratio' },
  { label: '尺寸', value: dimensionText.value, icon: 'bi-layers' },
  {
    label: '文件',
    value: `${fileTypeText.value} · ${formatFileSize(props.wallpaper?.file_size)}`,
    icon: 'bi-file-earmark-image',
  },
  { label: '分类', value: categoryText.value, icon: 'bi-tags' },
  { label: '分级', value: purityText.value, icon: 'bi-shield-check' },
  { label: '浏览', value: formatNumber(props.wallpaper?.views), icon: 'bi-eye' },
  {
    label: '收藏',
    value: formatNumber(props.wallpaper?.favorites ?? props.wallpaper?.favorite_count),
    icon: 'bi-heart',
  },
  {
    label: '上传',
    value: formatDate(props.wallpaper?.created_at || props.wallpaper?.upload_time),
    icon: 'bi-calendar3',
  },
])

const detailStats = computed(() =>
  summaryStats.value.filter(
    (item) =>
      item.label !== '分辨率' &&
      item.label !== '尺寸' &&
      item.label !== '文件' &&
      item.label !== '分类' &&
      item.label !== '分级' &&
      item.label !== '浏览',
  ),
)
const hasWallpaperData = computed(() => !!props.wallpaper?.id)

function handleKeydown(event) {
  if (event.key === 'Escape') {
    emit('close')
  }
}

watch(
  () => [props.open, props.wallpaper?.id],
  () => {
    if (!props.open) return
    userStore.initUserData()
    requestAnimationFrame(() => {
      const body = document.querySelector('.qd-body')
      if (body) body.scrollTop = 0
    })
  },
)

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return

    if (open) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeydown)
      await nextTick()
      drawerRef.value?.focus?.()
      return
    }

    document.body.style.overflow = previousBodyOverflow
    window.removeEventListener('keydown', handleKeydown)
  },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = previousBodyOverflow
    window.removeEventListener('keydown', handleKeydown)
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="qd-fade">
      <div v-if="open" class="qd-backdrop" @click.self="emit('close')" />
    </Transition>
    <Transition name="qd-slide">
      <aside
        v-if="open && wallpaper"
        ref="drawerRef"
        class="qd-drawer" :class="{ 'is-scheme-dark': appearanceStore.isDark }"
        tabindex="-1"
        aria-label="壁纸快捷详情"
      >
        <header class="qd-head">
          <div class="qd-head-copy">
            <div class="qd-head-kicker">Quick Detail</div>
            <div class="qd-head-title-row">
              <h6 class="qd-head-title">#{{ wallpaper.id }}</h6>
              <span class="qd-badge qd-badge--soft">{{ categoryText }}</span>
              <span :class="purityClass">{{ purityText }}</span>
            </div>
          </div>
          <button type="button" class="qd-close" aria-label="关闭" @click="emit('close')">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>
        <div class="qd-body">
          <div v-if="loading" class="qd-state qd-state--loading">
            <span class="qd-spinner" aria-hidden="true"></span>
            <span>正在读取详情...</span>
          </div>
          <div v-else-if="error" class="qd-state qd-state--error">{{ error }}</div>
          <div v-else-if="!hasWallpaperData" class="qd-state">暂无可显示的详情</div>

          <template v-if="hasWallpaperData && !loading">
            <section class="qd-hero">
              <div
                class="qd-thumb-wrap"
                role="button"
                tabindex="0"
                aria-label="打开壁纸预览"
                @click="onPreviewClick"
                @keydown.enter.prevent="onPreviewClick"
                @keydown.space.prevent="onPreviewClick"
              >
                <img
                  v-if="heroImage"
                  :src="heroImage"
                  class="qd-thumb"
                  :alt="wallpaper.id"
                  loading="lazy"
                />
                <div v-else class="qd-thumb qd-thumb--empty">无预览</div>
                <div class="qd-thumb-scrim" aria-hidden="true"></div>
                <div class="qd-thumb-topline">
                  <span class="qd-mini-chip">
                    <i class="bi bi-file-earmark-image" aria-hidden="true"></i>
                    <span>{{ fileTypeText }} · {{ formatFileSize(wallpaper.file_size) }}</span>
                  </span>
                  <span class="qd-mini-chip">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                    <span>{{ formatNumber(wallpaper.views) }}</span>
                  </span>
                </div>
                <div class="qd-thumb-overlay">
                  <div class="qd-hero-copy">
                    <span class="qd-hero-label">Wallpaper</span>
                    <strong>{{ wallpaper.resolution || dimensionText }}</strong>
                  </div>
                  <button type="button" class="qd-hero-preview" @click.stop="onPreviewClick">
                    <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
                    <span>预览</span>
                  </button>
                </div>
              </div>
            </section>

            <section class="qd-action-strip" aria-label="快捷操作">
              <button type="button" class="qd-action" @click="onSimilarClick">
                <i class="bi bi-shuffle" aria-hidden="true"></i>
                <span>找相似</span>
              </button>
              <a
                class="qd-action"
                :href="`https://wallhaven.cc/w/${wallpaper.id}`"
                target="_blank"
                rel="noopener noreferrer"
                @click="emit('close')"
              >
                <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                <span>原站</span>
              </a>
            </section>

            <section class="qd-panel qd-panel--author">
              <div class="qd-section-title">
                <i class="bi bi-person-heart" aria-hidden="true"></i>
                <span>作者</span>
              </div>
              <div class="qd-author-card">
                <a href="#" class="qd-author-link" @click="authorSearch">{{ authorLabel }}</a>
                <button
                  type="button"
                  class="qd-fav-btn"
                  :class="{ active: isAuthorFavorited }"
                  :title="isAuthorFavorited ? '取消收藏作者' : '收藏作者'"
                  :aria-pressed="isAuthorFavorited"
                  @click="toggleAuthorFavorite"
                >
                  <i
                    class="bi"
                    :class="isAuthorFavorited ? 'bi-bookmark-heart-fill' : 'bi-bookmark-heart'"
                    aria-hidden="true"
                  ></i>
                  <span>{{ isAuthorFavorited ? '已收藏' : '收藏' }}</span>
                </button>
              </div>
            </section>

            <section class="qd-panel">
              <div class="qd-section-title">
                <i class="bi bi-tags" aria-hidden="true"></i>
                <span>标签</span>
              </div>
              <div v-if="tags.length" class="qd-tags">
                <span
                  v-for="(t, i) in tags.slice(0, 32)"
                  :key="`qd-t-${i}`"
                  class="qd-tag-wrap"
                  :class="tagClass(t)"
                >
                  <a href="#" class="qd-tag-label" @click="tagSearch(t, $event)">
                    {{ tagLabel(t) }}
                  </a>
                  <button
                    type="button"
                    class="qd-tag-fav"
                    :class="{ active: isTagFavorited(t) }"
                    :title="isTagFavorited(t) ? '取消收藏标签' : '收藏标签'"
                    :aria-pressed="isTagFavorited(t)"
                    @click="toggleTagFavorite(t, $event)"
                  >
                    <i
                      class="bi"
                      :class="isTagFavorited(t) ? 'bi-bookmark-fill' : 'bi-bookmark'"
                      aria-hidden="true"
                    ></i>
                  </button>
                </span>
              </div>
              <div v-else class="qd-muted">暂无</div>
            </section>

            <section v-if="palette.length" class="qd-panel">
              <div class="qd-section-title">
                <i class="bi bi-palette" aria-hidden="true"></i>
                <span>主色</span>
              </div>
              <div class="qd-colors">
                <button
                  v-for="(h, i) in palette"
                  :key="`qd-c-${i}`"
                  type="button"
                  class="qd-swatch"
                  :style="{ backgroundColor: `#${h}` }"
                  :title="`筛选 #${h}`"
                  @click="colorClick(h, $event)"
                >
                  <span>#{{ h }}</span>
                </button>
              </div>
            </section>

            <section class="qd-panel">
              <div class="qd-section-title">
                <i class="bi bi-info-circle" aria-hidden="true"></i>
                <span>更多信息</span>
              </div>
              <dl class="qd-detail-list">
                <div v-for="item in detailStats" :key="item.label" class="qd-detail-row">
                  <dt>
                    <i :class="['bi', item.icon]" aria-hidden="true"></i>
                    <span>{{ item.label }}</span>
                  </dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>
            </section>
          </template>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.qd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 8000;
  background: rgba(13, 15, 24, 0.55);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.qd-drawer {
  --qd-ink: #18203b;
  --qd-muted: #79809a;
  --qd-accent: #6a4fe0;
  --qd-active: #151a2d;
  --qd-surface: #f7f7ff;
  --qd-panel: #fff;
  --qd-line: rgba(21, 26, 45, 0.12);
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: clamp(520px, 50vw, 760px);
  z-index: 8010;
  background: var(--qd-surface);
  border-left: 1px solid var(--qd-line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
  color: var(--qd-ink);
  box-shadow: -6px 0 0 rgba(106, 79, 224, 0.35);
}

.qd-drawer.is-scheme-dark {
  --qd-ink: #e8eaf4;
  --qd-muted: #9aa1b8;
  --qd-accent: #a08bff;
  --qd-active: #f0ecff;
  --qd-surface: #0d0f18;
  --qd-panel: #161824;
  --qd-line: rgba(160, 139, 255, 0.22);
  box-shadow: -6px 0 0 rgba(106, 79, 224, 0.45);
}

.qd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 3;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--qd-line);
  background: var(--qd-panel);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.qd-head-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.qd-head-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.qd-head-title {
  margin: 0;
  min-width: 0;
  font-size: 1.05rem;
  font-weight: 780;
  line-height: 1.2;
  color: var(--qd-ink);
  word-break: break-all;
}

.qd-head-kicker {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--qd-muted);
}

.qd-badge,
.qd-purity,
.qd-mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 25px;
  padding: 0 9px;
  border-radius: 0;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.qd-badge--soft {
  border: 0;
  box-shadow: inset 0 0 0 1px var(--qd-line);
  background: transparent;
  color: var(--qd-muted);
}

.qd-close {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--qd-ink);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--qd-line);
  transition:
    background 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}

.qd-close:hover,
.qd-close:focus-visible {
  color: var(--qd-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
  outline: none;
}

.qd-drawer.is-scheme-dark .qd-close:hover,
.qd-drawer.is-scheme-dark .qd-close:focus-visible {
  background: rgba(106, 79, 224, 0.16);
  color: #c4b5ff;
}

.qd-purity {
  border: 0;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 35%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.qd-purity--safe { color: #39b36c; }
.qd-purity--warn { color: #d48a2a; }
.qd-purity--danger { color: #d95b5b; }
.qd-purity--neutral { color: var(--qd-muted); }

.qd-body {
  flex: 1;
  overflow: auto;
  padding: 16px 18px 22px;
  scrollbar-gutter: stable;
}

.qd-state {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 0;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--qd-line);
  background: var(--qd-panel);
  color: var(--qd-muted);
  font-size: 0.84rem;
}

.qd-state--loading {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.qd-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(106, 79, 224, 0.2);
  border-top-color: var(--qd-accent);
  border-radius: 0;
  animation: qd-spin 0.75s linear infinite;
}

.qd-state--error {
  color: #d95b5b;
}

.qd-hero {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.qd-thumb-wrap {
  position: relative;
  border-radius: 0;
  overflow: hidden;
  background: var(--qd-panel);
  border: 0;
  box-shadow:
    inset 0 0 0 1px var(--qd-line),
    4px 4px 0 rgba(106, 79, 224, 0.35);
  cursor: pointer;
}

.qd-thumb {
  width: 100%;
  display: block;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  transform: none;
  transition: opacity 0.2s ease;
}

.qd-thumb-wrap:hover .qd-thumb {
  transform: none;
  opacity: 0.96;
}

.qd-thumb-wrap:focus-visible {
  outline: 2px solid rgba(106, 79, 224, 0.65);
  outline-offset: 2px;
}

.qd-thumb--empty {
  display: grid;
  place-items: center;
  min-height: 260px;
  color: var(--qd-muted);
}

.qd-thumb-scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(21, 26, 45, 0.18), transparent 34%),
    linear-gradient(0deg, rgba(21, 26, 45, 0.62), transparent 46%);
  pointer-events: none;
}

.qd-thumb-topline {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  pointer-events: none;
}

.qd-thumb-overlay {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 14px;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
}

.qd-mini-chip {
  border: 0;
  background: rgba(247, 247, 255, 0.94);
  color: #18203b;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow:
    inset 0 0 0 1px rgba(21, 26, 45, 0.12),
    2px 2px 0 rgba(106, 79, 224, 0.55);
}

.qd-hero-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.qd-hero-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.72);
  text-transform: uppercase;
}

.qd-hero-copy strong {
  font-size: clamp(1.08rem, 2vw, 1.42rem);
  line-height: 1.1;
  font-weight: 780;
}

.qd-hero-preview {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: #151a2d;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 750;
  cursor: pointer;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
  transition: background 0.14s ease;
}

.qd-hero-preview:hover,
.qd-hero-preview:focus-visible {
  background: #6a4fe0;
  outline: none;
}

.qd-action-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}

.qd-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--qd-ink);
  font-size: 0.82rem;
  font-weight: 720;
  text-decoration: none;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--qd-line);
  transition:
    background 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}

.qd-action i {
  font-size: 0.86rem;
}

.qd-action:hover,
.qd-action:focus-visible {
  color: var(--qd-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
  outline: none;
}

.qd-action--primary {
  background: var(--qd-active);
  color: #fff;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.qd-drawer.is-scheme-dark .qd-action--primary {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 3px 3px 0 rgba(180, 160, 255, 0.5);
}

.qd-action--primary:hover,
.qd-action--primary:focus-visible {
  color: #fff;
  background: #6a4fe0;
}

.qd-drawer.is-scheme-dark .qd-action--primary:hover,
.qd-drawer.is-scheme-dark .qd-action--primary:focus-visible {
  color: #151a2d;
  background: #fff;
}

.qd-panel {
  margin-bottom: 12px;
  border: 0;
  border-radius: 0;
  padding: 13px;
  background: var(--qd-panel);
  box-shadow: inset 0 0 0 1px var(--qd-line);
}

.qd-panel--author {
  padding-bottom: 12px;
}

.qd-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 11px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--qd-muted);
}

.qd-section-title i {
  font-size: 0.84rem;
  color: var(--qd-accent);
}

.qd-author-link {
  min-width: 0;
  font-size: 0.94rem;
  font-weight: 740;
  color: var(--qd-ink);
  text-decoration: none;
  word-break: break-word;
}

.qd-author-link:hover {
  color: var(--qd-accent);
  text-decoration: none;
}

.qd-author-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 11px;
  border-radius: 0;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--qd-line);
}

.qd-fav-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--qd-muted);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--qd-line);
  transition:
    background 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}

.qd-fav-btn:hover,
.qd-fav-btn.active {
  color: #fff;
  background: var(--qd-active);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75);
}

.qd-drawer.is-scheme-dark .qd-fav-btn:hover,
.qd-drawer.is-scheme-dark .qd-fav-btn.active {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 2px 2px 0 rgba(180, 160, 255, 0.5);
}

.qd-muted {
  color: var(--qd-muted);
  font-size: 0.82rem;
}

.qd-colors {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.qd-swatch {
  position: relative;
  display: flex;
  align-items: end;
  justify-content: start;
  min-width: 0;
  height: 46px;
  border-radius: 0;
  border: 0;
  padding: 7px;
  cursor: pointer;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.22);
  transition: box-shadow 0.14s ease, transform 0.14s ease;
}

.qd-swatch::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 70%;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.36), transparent);
}

.qd-swatch span {
  position: relative;
  z-index: 1;
  color: #fff;
  font-size: 0.68rem;
  font-weight: 720;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.42);
}

.qd-swatch:hover,
.qd-swatch:focus-visible {
  transform: translate(-1px, -1px);
  box-shadow:
    inset 0 0 0 1px rgba(106, 79, 224, 0.55),
    2px 2px 0 rgba(106, 79, 224, 0.65);
  outline: none;
}

.qd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.qd-tag-wrap {
  display: inline-flex;
  align-items: stretch;
  min-width: 0;
  max-width: 100%;
  font-size: 0.74rem;
  line-height: 1.25;
  border-radius: 0;
  border: 0;
  background: transparent;
  color: var(--qd-ink);
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--qd-line);
  transition:
    background 0.14s ease,
    box-shadow 0.14s ease,
    color 0.14s ease;
}

.qd-tag-wrap:hover {
  color: var(--qd-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
}

.qd-tag-label {
  min-width: 0;
  padding: 5px 8px 5px 9px;
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qd-tag-label:hover {
  color: inherit;
  text-decoration: none;
}

.qd-tag-fav {
  flex: 0 0 auto;
  width: 24px;
  min-height: 100%;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 1px solid var(--qd-line);
  background: transparent;
  color: inherit;
  opacity: 0.72;
  cursor: pointer;
}

.qd-tag-fav:hover,
.qd-tag-fav.active {
  opacity: 1;
  background: rgba(106, 79, 224, 0.1);
}

.qd-tag-wrap.tag-general,
.qd-tag-wrap.tag-anime,
.qd-tag-wrap.tag-people,
.qd-tag-wrap.tag-photography,
.qd-tag-wrap.tag-artists,
.qd-tag-wrap.tag-digital,
.qd-tag-wrap.tag-clothing,
.qd-tag-wrap.tag-colors,
.qd-tag-wrap.tag-vehicles,
.qd-tag-wrap.tag-animals,
.qd-tag-wrap.tag-nature,
.qd-tag-wrap.tag-sketchy,
.qd-tag-wrap.tag-other {
  background: transparent;
  color: var(--qd-ink);
}

.qd-detail-list {
  display: grid;
  gap: 2px;
  margin: 0;
}

.qd-detail-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.42fr) minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 9px 0;
  border-top: 1px solid var(--qd-line);
}

.qd-detail-row:first-child {
  border-top: 0;
  padding-top: 0;
}

.qd-detail-row:last-child {
  padding-bottom: 0;
}

.qd-detail-row dt {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--qd-muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.qd-detail-row dd {
  margin: 0;
  color: var(--qd-ink);
  font-size: 0.82rem;
  font-weight: 680;
  line-height: 1.35;
  text-align: right;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .qd-drawer {
    width: 100vw;
    border-left: 0;
    box-shadow: none;
  }
}

@media (max-width: 520px) {
  .qd-head {
    padding: 15px 14px 12px;
  }

  .qd-body {
    padding: 12px 14px 18px;
  }

  .qd-action-strip,
  .qd-colors {
    grid-template-columns: 1fr;
  }

  .qd-thumb {
    aspect-ratio: 4 / 3;
  }

  .qd-author-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .qd-detail-row {
    grid-template-columns: 1fr;
  }

  .qd-detail-row dd {
    text-align: left;
  }
}

.qd-fade-enter-active,
.qd-fade-leave-active {
  transition: opacity 0.18s ease;
}
.qd-fade-enter-from,
.qd-fade-leave-to {
  opacity: 0;
}

.qd-slide-enter-active,
.qd-slide-leave-active {
  transition: transform 0.2s ease;
}
.qd-slide-enter-from,
.qd-slide-leave-to {
  transform: translateX(100%);
}

@keyframes qd-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
