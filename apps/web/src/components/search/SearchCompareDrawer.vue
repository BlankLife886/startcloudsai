<script setup>
import { guessWallpaperFileType, ratioLabelFromResolution } from '@/utils/compareWallpaper'
import { useFavoritesStore } from '@/stores/favorites'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  items: {
    type: Array,
    default: () => [],
  },
})

defineEmits(['close', 'remove', 'clear'])

const favoritesStore = useFavoritesStore()

function favCount(w) {
  const n = Number(w?.favorites ?? w?.favorite_count)
  return Number.isFinite(n) && n >= 0 ? String(n) : '—'
}

function isFav(id) {
  return favoritesStore.isFavorited(String(id))
}

function colorStrip(w) {
  const colors = Array.isArray(w?.colors) ? w.colors : []
  return colors.slice(0, 6).map((c) => (String(c).startsWith('#') ? String(c) : `#${c}`))
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="compare-backdrop" @click.self="$emit('close')" />
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="open" class="compare-drawer" aria-label="壁纸对比">
        <header class="drawer-head">
          <h6 class="mb-0">对比</h6>
          <div class="head-actions">
            <button
              v-if="items.length"
              type="button"
              class="btn btn-link btn-sm text-danger py-0"
              @click="$emit('clear')"
            >
              清空
            </button>
            <button type="button" class="btn btn-close" aria-label="关闭" @click="$emit('close')" />
          </div>
        </header>
        <div class="drawer-body">
          <p v-if="!items.length" class="text-muted small px-3">
            多选后点「对比」，或批量栏里添加（最多 4 张）。
          </p>
          <div v-else class="compare-grid">
            <article v-for="w in items" :key="w.id" class="compare-cell">
              <button
                type="button"
                class="btn-remove"
                :aria-label="`移除 ${w.id}`"
                @click="$emit('remove', w.id)"
              >
                <i class="bi bi-x-lg" />
              </button>
              <div class="compare-thumb-wrap">
                <img
                  :src="w.thumbnail || w.path"
                  :alt="`壁纸 ${w.id}`"
                  class="compare-thumb"
                  loading="lazy"
                />
              </div>
              <div class="compare-meta">
                <div class="meta-row meta-title">
                  <span class="id-text">{{ w.id }}</span>
                  <span v-if="isFav(w.id)" class="badge text-bg-danger mini-badge" title="已收藏"
                    >♥</span
                  >
                </div>
                <dl class="meta-dl">
                  <div class="meta-pair">
                    <dt>分辨率</dt>
                    <dd>{{ w.resolution || '—' }}</dd>
                  </div>
                  <div class="meta-pair">
                    <dt>比例</dt>
                    <dd>{{ ratioLabelFromResolution(w.resolution) }}</dd>
                  </div>
                  <div class="meta-pair">
                    <dt>类型</dt>
                    <dd>{{ guessWallpaperFileType(w) }}</dd>
                  </div>
                  <div class="meta-pair">
                    <dt>收藏数</dt>
                    <dd>{{ favCount(w) }}</dd>
                  </div>
                </dl>
                <div v-if="colorStrip(w).length" class="palette" aria-label="色板">
                  <span
                    v-for="(hex, i) in colorStrip(w)"
                    :key="`${w.id}-c-${i}`"
                    class="swatch"
                    :style="{ backgroundColor: hex }"
                  />
                </div>
              </div>
            </article>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.compare-backdrop {
  position: fixed;
  inset: 0;
  z-index: 5200;
  background: rgba(0, 0, 0, 0.35);
}

.compare-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(100vw, 440px);
  z-index: 5210;
  background: var(--card-bg-color);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.15);
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-body {
  flex: 1;
  overflow: auto;
  padding: 12px 0 24px;
}

.compare-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 12px;
}

.compare-cell {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--card-bg-color) 94%, var(--text-color) 3%);
}

.compare-thumb-wrap {
  width: 100%;
  aspect-ratio: 16 / 10;
  background: color-mix(in srgb, var(--text-color) 6%, var(--card-bg-color));
}

.compare-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.compare-meta {
  padding: 8px 10px 10px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.id-text {
  font-size: 0.82rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mini-badge {
  font-size: 0.65rem;
  padding: 0.1rem 0.35rem;
}

.meta-dl {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
  font-size: 0.76rem;
}

.meta-pair {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-pair dt {
  margin: 0;
  color: color-mix(in srgb, var(--text-color) 55%, transparent);
  font-weight: 500;
}

.meta-pair dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
}

.btn-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75rem;
}
.btn-remove:hover {
  background: rgba(0, 0, 0, 0.72);
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.22s ease;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
</style>
