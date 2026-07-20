<script setup>
import { computed, ref, watch } from 'vue'
import { normalizeUploaderUsername } from '@/utils/wallhaven'
import { useRouter } from 'vue-router'
import { useHistoryStore } from '@/stores/history'
import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import { getBestWallpaperSource } from '@/services/aiWallpaper'

const props = defineProps({
  historyItem: {
    type: Object,
    required: true,
  },
  show: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'remove'])

const router = useRouter()
const historyStore = useHistoryStore()
const displaySrc = ref('')
const imageLoading = ref(false)
let resolveToken = 0

const formattedDate = computed(() => {
  if (!props.historyItem || !props.historyItem.viewed_at) return ''

  const date = new Date(props.historyItem.viewed_at)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const formattedTime = computed(() => {
  if (!props.historyItem?.viewed_at) return ''
  return new Date(props.historyItem.viewed_at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
})

const tags = computed(() => {
  if (!props.historyItem || !props.historyItem.tags) return []

  return props.historyItem.tags
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter(Boolean)
})

const metaFacts = computed(() => {
  const item = props.historyItem || {}
  const rows = []
  if (item.resolution) rows.push({ label: '分辨率', value: item.resolution })
  if (item.category) rows.push({ label: '分类', value: item.category })
  if (item.file_size) rows.push({ label: '大小', value: item.file_size })
  if (item.source) rows.push({ label: '来源', value: item.source })
  return rows
})

function pickImageSrc(item = {}) {
  const raw =
    getBestWallpaperSource(item) ||
    item?.thumbs?.original ||
    item?.thumbs?.large ||
    item?.thumbnail ||
    ''
  return proxyWallhavenImageUrl(raw)
}

function hasFullImage(item = {}) {
  return Boolean(item.path || item.image_url || item.url)
}

async function resolveDisplayImage(item) {
  const token = ++resolveToken
  if (!item) {
    displaySrc.value = ''
    return
  }

  displaySrc.value = pickImageSrc(item)
  if (hasFullImage(item) || !item.id) return

  imageLoading.value = true
  try {
    const response = await wallpaperApi.getWallpaper(item.id)
    if (token !== resolveToken) return
    if (response?.success && response.image) {
      displaySrc.value = pickImageSrc({ ...item, ...response.image })
    }
  } catch {
    // keep current preview source
  } finally {
    if (token === resolveToken) imageLoading.value = false
  }
}

watch(
  () => [props.show, props.historyItem?.id, props.historyItem?.path, props.historyItem?.url],
  ([open]) => {
    if (!open) {
      resolveToken += 1
      displaySrc.value = ''
      imageLoading.value = false
      return
    }
    void resolveDisplayImage(props.historyItem)
  },
  { immediate: true },
)

function closeDetail() {
  emit('close')
}

function removeHistoryItem() {
  if (confirm('确定要从历史记录中移除此项吗？')) {
    historyStore.removeHistory(props.historyItem.id)
    emit('remove', props.historyItem.id)
    closeDetail()
  }
}

function viewWallpaperDetails() {
  router.push({ name: 'wallpaper', params: { id: props.historyItem.id } })
  closeDetail()
}

function viewUploader() {
  const u = normalizeUploaderUsername(props.historyItem.uploader)
  if (u) {
    router.push({ name: 'user', params: { username: u } })
    closeDetail()
  }
}

function searchTag(tag) {
  router.push({
    name: 'search',
    query: { query: tag },
  })
  closeDetail()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="history-detail-modal">
      <div
        v-if="show"
        class="history-detail-backdrop"
        role="presentation"
        @click="closeDetail"
      >
        <div
          class="history-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-detail-title"
          @click.stop
        >
          <button
            type="button"
            class="history-detail-close"
            title="关闭"
            @click="closeDetail"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>

          <button
            class="history-detail-visual"
            type="button"
            title="查看壁纸详情"
            @click="viewWallpaperDetails"
          >
            <img
              v-if="displaySrc"
              :src="displaySrc"
              :alt="historyItem.id"
              decoding="async"
              fetchpriority="high"
            />
            <div
              v-if="imageLoading"
              class="history-detail-visual__loading"
              aria-hidden="true"
            >
              <span class="spinner-border spinner-border-sm"></span>
            </div>
            <div class="history-detail-visual__frame" aria-hidden="true"></div>
            <span class="history-detail-visual__mark">History</span>
          </button>

          <div class="history-detail-content">
            <div class="history-detail-spine" aria-hidden="true">
              <span>Record</span>
              <i></i>
              <em>View</em>
            </div>

            <div class="history-detail-main">
              <header class="history-detail-top">
                <div>
                  <em id="history-detail-title">历史记录</em>
                  <h2>{{ historyItem.id }}</h2>
                  <p>
                    <template v-if="formattedDate">浏览于 {{ formattedDate }}</template>
                    <template v-if="formattedTime"> · {{ formattedTime }}</template>
                  </p>
                </div>
              </header>

              <div v-if="metaFacts.length" class="history-detail-facts">
                <div v-for="fact in metaFacts" :key="fact.label">
                  <strong>{{ fact.value }}</strong>
                  <span>{{ fact.label }}</span>
                </div>
              </div>

              <div v-if="historyItem.uploader" class="history-detail-author">
                <span aria-hidden="true">{{ String(historyItem.uploader).slice(0, 1) }}</span>
                <div>
                  <strong>
                    <button type="button" class="history-detail-link" @click="viewUploader">
                      {{ historyItem.uploader }}
                    </button>
                  </strong>
                  <small>上传者</small>
                </div>
              </div>

              <div v-if="tags.length" class="history-detail-tags">
                <button
                  v-for="tag in tags"
                  :key="tag"
                  type="button"
                  class="history-detail-tag"
                  @click="searchTag(tag)"
                >
                  {{ tag }}
                </button>
              </div>

              <footer class="history-detail-footer">
                <button type="button" class="history-detail-btn danger" @click="removeHistoryItem">
                  <i class="bi bi-trash3" aria-hidden="true"></i>
                  <span>移除记录</span>
                </button>
                <button
                  type="button"
                  class="history-detail-btn primary"
                  @click="viewWallpaperDetails"
                >
                  <i class="bi bi-eye" aria-hidden="true"></i>
                  <span>查看详情</span>
                </button>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.history-detail-backdrop {
  --hd-ink: #151a2d;
  --hd-muted: #79809a;
  --hd-accent: #6a4fe0;
  --hd-active: #151a2d;
  --hd-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
  --hd-surface: #f7f6fb;
  --hd-line: rgba(21, 26, 45, 0.12);

  position: fixed;
  inset: 0;
  z-index: 12000;
  display: grid;
  place-items: center;
  padding: 28px;
  background:
    radial-gradient(circle at 20% 10%, rgba(106, 79, 224, 0.18), transparent 34%),
    rgba(12, 14, 24, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.history-detail-modal {
  position: relative;
  width: min(1080px, 96vw);
  height: min(720px, 90vh);
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.86fr);
  overflow: hidden;
  border-radius: 0;
  color: var(--hd-ink);
  background: var(--hd-surface);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    12px 12px 0 rgba(106, 79, 224, 0.28),
    0 18px 48px rgba(8, 10, 20, 0.28);
  will-change: transform, opacity;
}

.history-detail-close {
  position: absolute;
  z-index: 4;
  top: 14px;
  right: 14px;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(21, 26, 45, 0.14);
  border-radius: 0;
  color: var(--hd-ink);
  background: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.history-detail-close:hover {
  color: #fff;
  border-color: transparent;
  background: #151a2d;
}

.history-detail-visual {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 0;
  border: 0;
  cursor: pointer;
  background:
    radial-gradient(circle at 30% 18%, rgba(163, 149, 255, 0.16), transparent 42%),
    linear-gradient(165deg, #1a1c2a 0%, #12141f 100%);
}

.history-detail-visual img {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: transform 0.55s var(--hd-ease);
}

.history-detail-visual:hover img {
  transform: scale(1.015);
}

.history-detail-visual__loading {
  position: absolute;
  z-index: 3;
  right: 20px;
  top: 20px;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgba(21, 26, 45, 0.55);
  pointer-events: none;
}

.history-detail-visual__frame {
  position: absolute;
  inset: 14px;
  z-index: 2;
  border: 1px solid rgba(255, 255, 255, 0.16);
  pointer-events: none;
}

.history-detail-visual__mark {
  position: absolute;
  z-index: 2;
  left: 24px;
  bottom: 22px;
  color: rgba(255, 255, 255, 0.42);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  pointer-events: none;
}

.history-detail-content {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 14px;
  padding: 22px 22px 18px 10px;
  overflow: hidden;
  background: linear-gradient(180deg, #fbfaff 0%, #f4f3f9 100%);
}

.history-detail-spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  color: rgba(21, 26, 45, 0.38);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}

.history-detail-spine i {
  flex: 1;
  width: 1px;
  margin: 12px 0;
  background: linear-gradient(180deg, transparent, rgba(106, 79, 224, 0.55), transparent);
}

.history-detail-spine em {
  font-style: normal;
  color: var(--hd-accent);
}

.history-detail-main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  padding-right: 4px;
}

.history-detail-top em {
  display: block;
  margin-bottom: 8px;
  color: var(--hd-accent);
  font-style: normal;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.history-detail-top h2 {
  margin: 0;
  color: var(--hd-ink);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: clamp(1.35rem, 2vw, 1.7rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.15;
  word-break: break-all;
}

.history-detail-top p {
  margin: 10px 0 0;
  color: var(--hd-muted);
  font-size: 0.86rem;
  line-height: 1.55;
}

.history-detail-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
  padding: 14px 0;
  border-top: 1px solid var(--hd-line);
  border-bottom: 1px solid var(--hd-line);
}

.history-detail-facts div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.history-detail-facts strong {
  color: var(--hd-ink);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  word-break: break-word;
}

.history-detail-facts span {
  color: var(--hd-muted);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.history-detail-author {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.history-detail-author > span {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--hd-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.65);
  font-family: 'Songti SC', 'Noto Serif SC', serif;
  font-size: 1rem;
  font-weight: 700;
}

.history-detail-author > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.history-detail-author strong {
  min-width: 0;
}

.history-detail-author small {
  color: var(--hd-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

.history-detail-link {
  padding: 0;
  border: 0;
  color: var(--hd-ink);
  background: transparent;
  font: inherit;
  font-weight: 750;
  text-align: left;
  cursor: pointer;
}

.history-detail-link:hover {
  color: var(--hd-accent);
}

.history-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.history-detail-tag {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  color: #5a6178;
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.12);
  font-size: 0.76rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.history-detail-tag:hover {
  color: #fff;
  background: #151a2d;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.55);
}

.history-detail-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: auto;
  padding-top: 8px;
}

.history-detail-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: none;
  border-radius: 0;
  font-size: 0.86rem;
  font-weight: 750;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.history-detail-btn.primary {
  color: #fff;
  background: var(--hd-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.history-detail-btn.primary:hover {
  background: #1f2740;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.85);
  transform: translate(-1px, -1px);
}

.history-detail-btn.danger {
  color: #c45d70;
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(196, 93, 112, 0.45);
}

.history-detail-btn.danger:hover {
  color: #fff;
  background: #c45d70;
  box-shadow: 3px 3px 0 rgba(196, 93, 112, 0.35);
}

.history-detail-modal-enter-active,
.history-detail-modal-leave-active {
  transition: opacity 0.18s var(--hd-ease);
}

.history-detail-modal-enter-active .history-detail-modal,
.history-detail-modal-leave-active .history-detail-modal {
  transition:
    opacity 0.2s var(--hd-ease),
    transform 0.2s var(--hd-ease);
}

.history-detail-modal-enter-from,
.history-detail-modal-leave-to {
  opacity: 0;
}

.history-detail-modal-enter-from .history-detail-modal {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}

.history-detail-modal-leave-to .history-detail-modal {
  opacity: 0;
  transform: translateY(8px) scale(0.99);
}

@media (max-width: 900px) {
  .history-detail-modal {
    width: min(560px, 96vw);
    height: auto;
    max-height: min(860px, 92vh);
    grid-template-columns: 1fr;
  }

  .history-detail-visual {
    min-height: 240px;
    max-height: 320px;
  }

  .history-detail-content {
    padding: 18px 16px 16px 8px;
  }
}

@media (max-width: 576px) {
  .history-detail-backdrop {
    padding: 12px;
    align-items: flex-end;
  }

  .history-detail-modal {
    width: 100%;
    max-height: calc(100dvh - 24px);
  }

  .history-detail-facts {
    grid-template-columns: 1fr;
  }

  .history-detail-footer {
    flex-direction: column-reverse;
  }

  .history-detail-btn {
    width: 100%;
  }
}

html.color-scheme-dark .history-detail-backdrop {
  --hd-ink: #f0f1f8;
  --hd-muted: #9aa1b8;
  --hd-accent: #cfc7ff;
  --hd-active: #cfc7ff;
  --hd-surface: #141622;
  --hd-line: rgba(232, 233, 242, 0.12);
  background:
    radial-gradient(circle at 20% 10%, rgba(106, 79, 224, 0.22), transparent 34%),
    rgba(6, 8, 14, 0.78);
}

html.color-scheme-dark .history-detail-modal {
  box-shadow:
    0 0 0 1px rgba(207, 199, 255, 0.12),
    12px 12px 0 rgba(106, 79, 224, 0.32),
    0 18px 48px rgba(0, 0, 0, 0.45);
}

html.color-scheme-dark .history-detail-content {
  background: linear-gradient(180deg, #171926 0%, #12141f 100%);
}

html.color-scheme-dark .history-detail-spine {
  color: rgba(232, 233, 242, 0.38);
}

html.color-scheme-dark .history-detail-close {
  color: #f0f1f8;
  border-color: rgba(232, 233, 242, 0.16);
  background: rgba(22, 25, 37, 0.92);
}

html.color-scheme-dark .history-detail-close:hover {
  color: #151a2d;
  background: #cfc7ff;
}

html.color-scheme-dark .history-detail-author > span {
  color: #151a2d;
  background: #cfc7ff;
  box-shadow: 3px 3px 0 rgba(133, 104, 247, 0.45);
}

html.color-scheme-dark .history-detail-tag {
  color: #b8bdd0;
  box-shadow: inset 0 0 0 1px rgba(232, 233, 242, 0.14);
}

html.color-scheme-dark .history-detail-tag:hover {
  color: #151a2d;
  background: #cfc7ff;
  box-shadow: 3px 3px 0 rgba(133, 104, 247, 0.45);
}

html.color-scheme-dark .history-detail-btn.primary {
  color: #151a2d;
  background: #cfc7ff;
  box-shadow: 3px 3px 0 rgba(133, 104, 247, 0.45);
}

html.color-scheme-dark .history-detail-btn.primary:hover {
  background: #ddd7ff;
  box-shadow: 4px 4px 0 rgba(133, 104, 247, 0.55);
}

html.color-scheme-dark .history-detail-btn.danger {
  color: #f0a0ac;
  box-shadow: inset 0 0 0 1px rgba(240, 160, 172, 0.4);
}

html.color-scheme-dark .history-detail-btn.danger:hover {
  color: #151a2d;
  background: #f0a0ac;
  box-shadow: 3px 3px 0 rgba(196, 93, 112, 0.35);
}
</style>
