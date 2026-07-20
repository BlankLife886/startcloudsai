<script setup>
import { onMounted, ref } from 'vue'
import { listShareItems } from '@/services/shareGallery'

const items = ref([])
const loading = ref(true)
const loadingMore = ref(false)
const cursor = ref(null)
const errorMessage = ref('')
const activeItem = ref(null)

async function loadPage({ append = false } = {}) {
  if (append) {
    if (!cursor.value || loadingMore.value) return
    loadingMore.value = true
  } else {
    loading.value = true
  }
  errorMessage.value = ''
  try {
    const { items: pageItems, nextCursor } = await listShareItems({
      limit: 24,
      cursor: append ? cursor.value : '',
    })
    items.value = append ? [...items.value, ...pageItems] : pageItems
    cursor.value = nextCursor
  } catch (error) {
    errorMessage.value = error?.message || '画廊读取失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function itemCover(item) {
  return item.coverUrl || item.mediaUrls?.[0] || ''
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

onMounted(() => loadPage())
</script>

<template>
  <div class="share-page">
    <header class="share-head">
      <p class="share-eyebrow">Community Gallery</p>
      <h1>共享画廊</h1>
      <p class="share-subtitle">创作者提交并通过审核的 AI 生成作品。</p>
    </header>

    <div v-if="loading" class="share-grid">
      <div v-for="n in 12" :key="n" class="share-skeleton"></div>
    </div>

    <template v-else>
      <p v-if="errorMessage" class="share-error">
        <i class="bi bi-exclamation-triangle"></i> {{ errorMessage }}
        <button type="button" @click="loadPage()">重试</button>
      </p>

      <div v-else-if="items.length" class="share-grid">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="share-card"
          @click="activeItem = item"
        >
          <img :src="itemCover(item)" :alt="item.title || 'AI 作品'" loading="lazy" />
          <span class="share-card-meta">
            <strong>{{ item.title || 'AI 作品' }}</strong>
            <small>
              <template v-if="item.author?.username">@{{ item.author.username }} · </template>
              {{ formatDate(item.createdAt) }}
            </small>
          </span>
        </button>
      </div>

      <div v-else class="share-empty">
        <i class="bi bi-images"></i>
        <p>画廊还没有作品，去工作台创作并投稿第一幅吧。</p>
        <RouterLink to="/text-to-image" class="share-btn">开始创作</RouterLink>
      </div>

      <div v-if="cursor" class="share-more">
        <button type="button" class="share-btn is-ghost" :disabled="loadingMore" @click="loadPage({ append: true })">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
    </template>

    <!-- 大图预览 -->
    <Teleport to="body">
      <div v-if="activeItem" class="share-lightbox" @click.self="activeItem = null">
        <div class="share-lightbox-panel">
          <header>
            <div>
              <strong>{{ activeItem.title || 'AI 作品' }}</strong>
              <small v-if="activeItem.author?.username">
                <img
                  v-if="activeItem.author?.avatarUrl"
                  :src="activeItem.author.avatarUrl"
                  alt=""
                  class="share-author-avatar"
                />
                @{{ activeItem.author.username }} · {{ formatDate(activeItem.createdAt) }}
              </small>
            </div>
            <button type="button" aria-label="关闭" @click="activeItem = null">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>
          <div class="share-lightbox-media">
            <img
              v-for="(url, index) in activeItem.mediaUrls?.length ? activeItem.mediaUrls : [itemCover(activeItem)]"
              :key="index"
              :src="url"
              :alt="`${activeItem.title || 'AI 作品'} ${index + 1}`"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.share-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: clamp(24px, 5vh, 48px) clamp(16px, 3vw, 32px) 80px;
  color: var(--text-color, #f0f0f0);
}

.share-head { text-align: center; margin-bottom: 34px; }

.share-eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(165, 180, 252, 0.8);
}

.share-head h1 { margin: 0 0 8px; font-size: clamp(28px, 4.4vw, 40px); }
.share-subtitle { margin: 0; color: rgba(203, 213, 225, 0.6); }

.share-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.share-card {
  position: relative;
  display: block;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  overflow: hidden;
  aspect-ratio: 4 / 3;
  background: rgba(15, 23, 42, 0.5);
  cursor: zoom-in;
}

.share-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.28s ease;
}

.share-card:hover img { transform: scale(1.05); }

.share-card-meta {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 28px 12px 10px;
  background: linear-gradient(transparent, rgba(2, 6, 23, 0.88));
  text-align: left;
}

.share-card-meta strong {
  max-width: 100%;
  font-size: 13.5px;
  color: #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-card-meta small { font-size: 11.5px; color: rgba(203, 213, 225, 0.68); }

.share-skeleton {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  background: linear-gradient(110deg, rgba(30, 41, 59, 0.6) 30%, rgba(51, 65, 85, 0.6) 50%, rgba(30, 41, 59, 0.6) 70%);
  background-size: 200% 100%;
  animation: share-skeleton-wave 1.4s ease infinite;
}

@keyframes share-skeleton-wave { to { background-position: -200% 0; } }

.share-error {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  padding: 40px 0;
  color: #fbbf24;
}

.share-error button {
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: 8px;
  padding: 4px 14px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.share-empty {
  display: grid;
  place-items: center;
  gap: 12px;
  padding: 70px 20px;
  border-radius: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.3);
  color: rgba(226, 232, 240, 0.6);
  text-align: center;
}

.share-empty i { font-size: 36px; }
.share-empty p { margin: 0; }

.share-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  color: #0b1020;
  background: linear-gradient(120deg, #a5b4fc, #67e8f9);
  cursor: pointer;
}

.share-btn.is-ghost {
  color: rgba(226, 232, 240, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: transparent;
}

.share-more { display: flex; justify-content: center; margin-top: 28px; }

.share-lightbox {
  position: fixed;
  inset: 0;
  z-index: 3600;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 6, 23, 0.82);
  backdrop-filter: blur(12px);
}

.share-lightbox-panel {
  width: min(920px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: #0f172a;
  padding: 18px 20px;
  color: #f1f5f9;
}

.share-lightbox-panel header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 14px;
}

.share-lightbox-panel header strong { display: block; font-size: 17px; }
.share-lightbox-panel header small {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: rgba(203, 213, 225, 0.62);
}

.share-author-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }

.share-lightbox-panel header button {
  border: none;
  background: transparent;
  color: rgba(226, 232, 240, 0.7);
  font-size: 16px;
  cursor: pointer;
}

.share-lightbox-media { display: grid; gap: 12px; }
.share-lightbox-media img { width: 100%; border-radius: 10px; }
</style>
