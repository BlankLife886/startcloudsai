<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import {
  fetchRuntimeAnnouncements,
  markAnnouncementDismissed,
  recordAnnouncementEvent,
  shouldShowAnnouncement,
} from '@/services/announcements'

const announcements = ref([])
const activeIndex = ref(0)
const slideIndex = ref(0)
const router = useRouter()
const appearanceStore = useAppearanceStore()
let carouselTimer = null
let realtimeReloadTimer = null
let previousBodyOverflow = ''

const activeAnnouncement = computed(() => announcements.value[activeIndex.value] || null)
const activeAssets = computed(() =>
  Array.isArray(activeAnnouncement.value?.assets)
    ? activeAnnouncement.value.assets.filter((asset) => asset?.url)
    : [],
)
const isModal = computed(() => {
  const placement = activeAnnouncement.value?.placement || 'modal'
  return placement === 'modal' || placement === 'carousel' || placement === 'list'
})
const isBanner = computed(() => activeAnnouncement.value?.placement === 'banner')
const canClose = computed(() => activeAnnouncement.value?.allowClose !== false)
const contentClass = computed(() => ({
  'is-image-left': activeAnnouncement.value?.layout === 'image_left',
  'is-image-right': activeAnnouncement.value?.layout === 'image_right',
  'is-grid': activeAnnouncement.value?.layout === 'grid',
  'is-carousel':
    activeAnnouncement.value?.layout === 'carousel' || activeAnnouncement.value?.carouselEnabled,
  'is-text-only':
    activeAnnouncement.value?.layout === 'text_only' || activeAssets.value.length === 0,
}))
const currentSlide = computed(() => activeAssets.value[slideIndex.value] || activeAssets.value[0])
const queueLabel = computed(() => {
  const total = announcements.value.length
  if (total <= 1) return ''
  return `${activeIndex.value + 1} / ${total}`
})

async function loadAnnouncements() {
  try {
    const list = await fetchRuntimeAnnouncements()
    announcements.value = list.filter(shouldShowAnnouncement)
    activeIndex.value = 0
    slideIndex.value = 0
    if (activeAnnouncement.value) {
      recordAnnouncementEvent(activeAnnouncement.value, 'impression')
      syncCarouselTimer()
    }
  } catch {
    announcements.value = []
  }
}

function dismissCurrent() {
  const item = activeAnnouncement.value
  if (!item || item.allowClose === false) return
  markAnnouncementDismissed(item)
  recordAnnouncementEvent(item, 'dismiss')
  showNext()
}

function handleCta() {
  const item = activeAnnouncement.value
  if (!item?.ctaUrl) return
  recordAnnouncementEvent(item, 'cta')
  markAnnouncementDismissed(item)

  const url = String(item.ctaUrl)
  if (url.startsWith('http')) {
    window.open(url, '_blank', 'noopener,noreferrer')
  } else if (url.startsWith('/')) {
    router.push(url).catch(() => {})
  } else {
    window.location.href = url
  }

  showNext()
}

function showNext() {
  clearCarouselTimer()
  if (activeIndex.value + 1 >= announcements.value.length) {
    announcements.value = []
    activeIndex.value = 0
    slideIndex.value = 0
    return
  }
  activeIndex.value += 1
  slideIndex.value = 0
  recordAnnouncementEvent(activeAnnouncement.value, 'impression')
  syncCarouselTimer()
}

function nextSlide() {
  if (activeAssets.value.length <= 1) return
  slideIndex.value = (slideIndex.value + 1) % activeAssets.value.length
}

function prevSlide() {
  if (activeAssets.value.length <= 1) return
  slideIndex.value = (slideIndex.value - 1 + activeAssets.value.length) % activeAssets.value.length
}

function goSlide(index) {
  if (index < 0 || index >= activeAssets.value.length) return
  slideIndex.value = index
  syncCarouselTimer()
}

function syncCarouselTimer() {
  clearCarouselTimer()
  const item = activeAnnouncement.value
  if (!item?.carouselEnabled || activeAssets.value.length <= 1) return
  const ms = Math.min(20000, Math.max(1500, Number(item.carouselIntervalMs || 4500)))
  carouselTimer = window.setInterval(nextSlide, ms)
}

function clearCarouselTimer() {
  if (!carouselTimer) return
  window.clearInterval(carouselTimer)
  carouselTimer = null
}

function lockBodyScroll(lock) {
  if (typeof document === 'undefined') return
  if (lock) {
    if (document.body.dataset.announcementScrollLock === '1') return
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.dataset.announcementScrollLock = '1'
    return
  }
  if (document.body.dataset.announcementScrollLock !== '1') return
  document.body.style.overflow = previousBodyOverflow
  delete document.body.dataset.announcementScrollLock
  previousBodyOverflow = ''
}

function handleKeydown(event) {
  if (event.key !== 'Escape') return
  if (!activeAnnouncement.value || !isModal.value) return
  dismissCurrent()
}

function handleAnnouncementUpdated() {
  window.clearTimeout(realtimeReloadTimer)
  realtimeReloadTimer = window.setTimeout(() => void loadAnnouncements(), 250)
}

watch(
  () => Boolean(activeAnnouncement.value && isModal.value),
  (open) => {
    lockBodyScroll(open)
  },
)

onMounted(() => {
  void loadAnnouncements()
  window.addEventListener('walleven:announcement-updated', handleAnnouncementUpdated)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  clearCarouselTimer()
  window.clearTimeout(realtimeReloadTimer)
  window.removeEventListener('walleven:announcement-updated', handleAnnouncementUpdated)
  window.removeEventListener('keydown', handleKeydown)
  lockBodyScroll(false)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="activeAnnouncement && isBanner"
      class="announcement-banner"
      :class="{ 'is-dark': appearanceStore.isDark }"
      role="status"
    >
      <img
        v-if="activeAnnouncement.decorImageUrl"
        class="announcement-banner__decor"
        :src="activeAnnouncement.decorImageUrl"
        alt=""
      />
      <div class="announcement-banner__text">
        <em>公告</em>
        <strong>{{ activeAnnouncement.title }}</strong>
        <span v-if="activeAnnouncement.content">{{ activeAnnouncement.content }}</span>
      </div>
      <div class="announcement-banner__actions">
        <button
          v-if="activeAnnouncement.ctaText && activeAnnouncement.ctaUrl"
          class="announcement-banner__cta"
          type="button"
          @click="handleCta"
        >
          {{ activeAnnouncement.ctaText }}
        </button>
        <button
          v-if="canClose"
          class="announcement-banner__close"
          type="button"
          aria-label="关闭公告"
          @click="dismissCurrent"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div
      v-if="activeAnnouncement && isModal"
      class="announcement-layer"
      :class="{ 'is-dark': appearanceStore.isDark }"
    >
      <div
        class="announcement-backdrop"
        :class="{ 'is-static': !canClose }"
        @click="canClose ? dismissCurrent() : undefined"
      ></div>

      <section
        class="announcement-panel"
        :class="contentClass"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'announcement-title'"
        @click.stop
      >
        <img
          v-if="activeAnnouncement.decorImageUrl"
          class="announcement-panel__watermark"
          :src="activeAnnouncement.decorImageUrl"
          alt=""
        />

        <button
          v-if="canClose"
          class="announcement-panel__close"
          type="button"
          aria-label="关闭公告"
          @click="dismissCurrent"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>

        <div v-if="activeAssets.length" class="announcement-media">
          <template v-if="contentClass['is-grid']">
            <img
              v-for="asset in activeAssets"
              :key="asset.url"
              :src="asset.url"
              :alt="asset.alt || activeAnnouncement.title"
            />
          </template>
          <template v-else>
            <img :src="currentSlide.url" :alt="currentSlide.alt || activeAnnouncement.title" />
            <div v-if="activeAssets.length > 1" class="announcement-slider">
              <button type="button" aria-label="上一张" @click="prevSlide">
                <i class="bi bi-chevron-left" aria-hidden="true"></i>
              </button>
              <div class="announcement-slider__dots" role="tablist" aria-label="公告图片">
                <button
                  v-for="(asset, index) in activeAssets"
                  :key="asset.url"
                  type="button"
                  role="tab"
                  :class="{ active: index === slideIndex }"
                  :aria-selected="index === slideIndex"
                  :aria-label="`第 ${index + 1} 张`"
                  @click="goSlide(index)"
                ></button>
              </div>
              <button type="button" aria-label="下一张" @click="nextSlide">
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
          </template>
        </div>

        <div class="announcement-copy">
          <div class="announcement-copy__meta">
            <span class="announcement-kicker">公告</span>
            <span v-if="queueLabel" class="announcement-queue">{{ queueLabel }}</span>
          </div>
          <h3 id="announcement-title">{{ activeAnnouncement.title }}</h3>
          <p v-if="activeAnnouncement.content" class="announcement-content">
            {{ activeAnnouncement.content }}
          </p>
          <div class="announcement-actions">
            <button
              v-if="activeAnnouncement.ctaText && activeAnnouncement.ctaUrl"
              class="announcement-primary"
              type="button"
              @click="handleCta"
            >
              {{ activeAnnouncement.ctaText }}
            </button>
            <button
              v-if="canClose"
              class="announcement-secondary"
              type="button"
              @click="dismissCurrent"
            >
              {{ activeAnnouncement.closeText || '我知道了' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.announcement-layer,
.announcement-banner {
  --an-bg: #fbfaff;
  --an-ink: #18203b;
  --an-muted: #79809a;
  --an-line: rgba(21, 26, 45, 0.12);
  --an-accent: #6a4fe0;
  --an-accent-soft: rgba(106, 79, 224, 0.14);
  --an-surface: #ffffff;
  --an-media: #eceef6;
  --an-on-primary: #ffffff;
  --an-primary: #151a2d;
  --an-shadow: 8px 8px 0 rgba(106, 79, 224, 0.18);
  --an-song: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --an-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --an-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
}

.announcement-layer.is-dark,
.announcement-banner.is-dark {
  --an-bg: #12141f;
  --an-ink: #eceaf7;
  --an-muted: #9a96b0;
  --an-line: rgba(255, 255, 255, 0.12);
  --an-accent: #b4a4ff;
  --an-accent-soft: rgba(181, 163, 255, 0.22);
  --an-surface: #151826;
  --an-media: #0d0f18;
  --an-on-primary: #12101c;
  --an-primary: #eceaf7;
  --an-shadow: 8px 8px 0 rgba(106, 79, 224, 0.28);
}

.announcement-layer {
  position: fixed;
  z-index: 2147483000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(24px, calc(var(--app-header-offset, 80px) + 12px)) 24px 24px;
}

.announcement-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(18, 20, 35, 0.46);
  backdrop-filter: blur(6px);
  cursor: pointer;
}

.announcement-backdrop.is-static {
  cursor: default;
}

.announcement-layer.is-dark .announcement-backdrop {
  background: rgba(4, 5, 10, 0.72);
}

.announcement-panel {
  position: relative;
  z-index: 1;
  display: grid;
  width: min(720px, 100%);
  max-height: min(78vh, 720px);
  overflow: hidden;
  grid-template-columns: 1fr;
  border: 1px solid var(--an-line);
  border-radius: 0;
  background: var(--an-surface);
  color: var(--an-ink);
  box-shadow: var(--an-shadow);
}

.announcement-panel.is-image-left,
.announcement-panel.is-image-right {
  width: min(880px, 100%);
  grid-template-columns: minmax(280px, 0.9fr) minmax(320px, 1fr);
}

.announcement-panel.is-image-right .announcement-media {
  order: 2;
}

.announcement-panel.is-text-only {
  width: min(560px, 100%);
}

.announcement-panel__watermark {
  position: absolute;
  right: -24px;
  top: -28px;
  width: 132px;
  height: 132px;
  object-fit: contain;
  opacity: 0.14;
  pointer-events: none;
}

.announcement-panel__close,
.announcement-banner__close {
  display: grid;
  place-items: center;
  border: 1px solid var(--an-line);
  border-radius: 0;
  background: var(--an-bg);
  color: var(--an-ink);
  cursor: pointer;
  transition:
    color 0.16s var(--an-ease),
    border-color 0.16s var(--an-ease),
    background 0.16s var(--an-ease);
}

.announcement-panel__close:hover,
.announcement-banner__close:hover {
  color: var(--an-accent);
  border-color: color-mix(in srgb, var(--an-accent) 40%, var(--an-line));
}

.announcement-panel__close {
  position: absolute;
  z-index: 3;
  top: 12px;
  right: 12px;
  width: 34px;
  height: 34px;
  font-size: 0.85rem;
}

.announcement-media {
  position: relative;
  min-height: 260px;
  max-height: min(48vh, 420px);
  overflow: hidden;
  background: var(--an-media);
  border-bottom: 1px solid var(--an-line);
}

.announcement-panel.is-image-left .announcement-media,
.announcement-panel.is-image-right .announcement-media {
  border-bottom: 0;
  border-right: 1px solid var(--an-line);
  max-height: none;
  min-height: 100%;
}

.announcement-panel.is-image-right .announcement-media {
  border-right: 0;
  border-left: 1px solid var(--an-line);
}

.announcement-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.announcement-panel.is-grid .announcement-media {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid var(--an-line);
}

.announcement-panel.is-grid .announcement-media img {
  min-height: 128px;
  border: 1px solid var(--an-line);
}

.announcement-slider {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.announcement-slider button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 0;
  background: rgba(18, 20, 35, 0.58);
  color: #fff;
  cursor: pointer;
}

.announcement-slider__dots {
  display: flex;
  flex: 1;
  justify-content: center;
  gap: 6px;
}

.announcement-slider__dots button {
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.38);
}

.announcement-slider__dots button.active {
  background: #fff;
  box-shadow: 0 0 0 2px rgba(106, 79, 224, 0.55);
}

.announcement-copy {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 28px;
  background:
    radial-gradient(circle at 100% 0%, var(--an-accent-soft), transparent 42%),
    var(--an-surface);
}

.announcement-copy__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.announcement-kicker,
.announcement-queue {
  color: var(--an-accent);
  font-family: var(--an-mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.announcement-queue {
  color: var(--an-muted);
}

.announcement-copy h3 {
  margin: 0;
  color: var(--an-ink);
  font-family: var(--an-song);
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.3;
  word-break: break-word;
}

.announcement-content {
  margin: 0;
  color: var(--an-muted);
  font-size: 0.94rem;
  line-height: 1.75;
  white-space: pre-line;
  word-break: break-word;
}

.announcement-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: auto;
  padding-top: 8px;
}

.announcement-primary,
.announcement-secondary,
.announcement-banner__cta {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 0;
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  transition:
    color 0.16s var(--an-ease),
    background 0.16s var(--an-ease),
    border-color 0.16s var(--an-ease),
    box-shadow 0.16s var(--an-ease),
    transform 0.16s var(--an-ease);
}

.announcement-primary,
.announcement-banner__cta {
  border: 1px solid transparent;
  color: var(--an-on-primary);
  background: var(--an-primary);
  box-shadow: 4px 4px 0 var(--an-accent-soft);
}

.announcement-primary:hover,
.announcement-banner__cta:hover {
  transform: translate(-1px, -1px);
  box-shadow: 6px 6px 0 var(--an-accent-soft);
}

.announcement-secondary {
  border: 1px solid var(--an-line);
  background: transparent;
  color: var(--an-ink);
}

.announcement-secondary:hover {
  color: var(--an-accent);
  border-color: color-mix(in srgb, var(--an-accent) 40%, var(--an-line));
}

.announcement-banner {
  position: fixed;
  z-index: 2147483000;
  left: 50%;
  top: calc(var(--app-header-offset, 82px) + 12px);
  display: flex;
  width: min(920px, calc(100vw - 24px));
  align-items: center;
  gap: 14px;
  transform: translateX(-50%);
  border: 1px solid var(--an-line);
  border-radius: 0;
  background: var(--an-surface);
  color: var(--an-ink);
  padding: 12px 14px;
  box-shadow: var(--an-shadow);
}

.announcement-banner__decor {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  object-fit: cover;
  border: 1px solid var(--an-line);
}

.announcement-banner__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.announcement-banner__text em {
  color: var(--an-accent);
  font-family: var(--an-mono);
  font-size: 0.62rem;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.announcement-banner__text strong {
  color: var(--an-ink);
  font-family: var(--an-song);
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.25;
}

.announcement-banner__text span {
  overflow: hidden;
  color: var(--an-muted);
  font-size: 0.84rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-banner__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.announcement-banner__close {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  font-size: 0.8rem;
}

@media (max-width: 720px) {
  .announcement-layer {
    align-items: end;
    padding: 14px;
  }

  .announcement-panel,
  .announcement-panel.is-image-left,
  .announcement-panel.is-image-right {
    width: 100%;
    max-height: 86vh;
    grid-template-columns: 1fr;
  }

  .announcement-panel.is-image-left .announcement-media,
  .announcement-panel.is-image-right .announcement-media {
    order: 0;
    border-right: 0;
    border-left: 0;
    border-bottom: 1px solid var(--an-line);
    min-height: 180px;
    max-height: 34vh;
  }

  .announcement-media {
    min-height: 180px;
    max-height: 34vh;
  }

  .announcement-media img {
    min-height: 180px;
  }

  .announcement-copy {
    padding: 22px;
  }

  .announcement-copy h3 {
    font-size: 1.22rem;
  }

  .announcement-actions {
    flex-direction: column;
  }

  .announcement-primary,
  .announcement-secondary {
    width: 100%;
  }

  .announcement-banner {
    top: calc(var(--app-header-offset, 56px) + 10px);
    align-items: flex-start;
  }

  .announcement-banner__text span {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .announcement-banner__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
