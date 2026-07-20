<script setup>
import { useFavoritesStore } from '@/stores/favorites'
import { useAppearanceStore } from '@/stores/appearance'
import notificationService from '@/services/notification'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  /** 要写入收藏并加入合集的壁纸列表 */
  wallpapers: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close'])

const favoritesStore = useFavoritesStore()
const appearanceStore = useAppearanceStore()
const collectionId = ref('')

const sortedCollections = computed(() =>
  [...favoritesStore.collections].sort(
    (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
  ),
)

watch(
  () => props.show,
  (open) => {
    if (open && sortedCollections.value.length) {
      collectionId.value = sortedCollections.value[0].id
    }
  },
)

function close() {
  emit('close', false)
}

function confirm() {
  if (!collectionId.value) {
    notificationService.warning('请选择一个收藏夹', { duration: 3000, position: 'top-right' })
    return
  }
  const list = props.wallpapers || []
  let addedFav = 0
  let linked = 0
  for (const w of list) {
    if (!w?.id) continue
    if (!favoritesStore.isFavorited(w.id)) {
      if (favoritesStore.addFavorite(w)) addedFav += 1
    }
    const r = favoritesStore.addToCollection(w.id, collectionId.value)
    if (r.success) linked += 1
  }
  notificationService.success(`已加入合集：新增收藏 ${addedFav} 张，写入合集 ${linked} 条`, {
    duration: 4500,
    position: 'top-right',
  })
  emit('close', true)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="bulk-col-backdrop"
      :class="{ 'is-scheme-dark': appearanceStore.isDark }"
      @click.self="close"
    >
      <div
        class="bulk-col-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-col-title"
        @click.stop
      >
        <header class="bulk-col-header">
          <div class="bulk-col-heading">
            <span class="bulk-col-icon" aria-hidden="true"><i class="bi bi-folder-symlink"></i></span>
            <h6 id="bulk-col-title">批量加入收藏夹</h6>
          </div>
          <button type="button" class="bulk-col-close" aria-label="关闭" @click="close">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="bulk-col-body">
          <p class="bulk-col-lead">
            将已选的 {{ wallpapers.length }} 张写入收藏，并加入下方选中的合集（已在合集中的会跳过重复）。
          </p>

          <div v-if="!sortedCollections.length" class="bulk-col-empty">
            暂无收藏夹，请先到「收藏」页创建合集后再试。
          </div>

          <label v-else class="bulk-col-field">
            <span>选择合集</span>
            <select v-model="collectionId">
              <option v-for="c in sortedCollections" :key="c.id" :value="c.id">
                {{ c.name }}（{{ c.count || 0 }}）
              </option>
            </select>
          </label>
        </div>

        <footer class="bulk-col-footer">
          <button type="button" class="bulk-col-btn" @click="close">取消</button>
          <button
            type="button"
            class="bulk-col-btn is-primary"
            :disabled="!sortedCollections.length"
            @click="confirm"
          >
            确定
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bulk-col-backdrop {
  --bc-ink: #18203b;
  --bc-muted: #79809a;
  --bc-accent: #6a4fe0;
  --bc-active: #151a2d;
  --bc-surface: #fff;
  --bc-page: #f7f7ff;
  --bc-line: rgba(21, 26, 45, 0.12);
  position: fixed;
  inset: 0;
  z-index: 240;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(13, 15, 24, 0.55);
  color: var(--bc-ink);
}

.bulk-col-backdrop.is-scheme-dark {
  --bc-ink: #e8eaf4;
  --bc-muted: #9aa1b8;
  --bc-accent: #a08bff;
  --bc-active: #f0ecff;
  --bc-surface: #161824;
  --bc-page: #0d0f18;
  --bc-line: rgba(160, 139, 255, 0.22);
}

.bulk-col-panel {
  width: min(420px, calc(100vw - 32px));
  background: var(--bc-surface);
  border-radius: 0;
  box-shadow:
    inset 0 0 0 1px var(--bc-line),
    6px 6px 0 rgba(106, 79, 224, 0.55);
}

.bulk-col-backdrop.is-scheme-dark .bulk-col-panel {
  box-shadow:
    inset 0 0 0 1px var(--bc-line),
    6px 6px 0 rgba(106, 79, 224, 0.4);
}

.bulk-col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--bc-line);
  background: var(--bc-page);
}

.bulk-col-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.bulk-col-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--bc-active);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75);
}

.bulk-col-backdrop.is-scheme-dark .bulk-col-icon {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 2px 2px 0 rgba(180, 160, 255, 0.5);
}

.bulk-col-heading h6 {
  margin: 0;
  font-size: 1rem;
  font-weight: 780;
  color: var(--bc-ink);
}

.bulk-col-close {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--bc-ink);
  box-shadow: inset 0 0 0 1px var(--bc-line);
  cursor: pointer;
}

.bulk-col-close:hover {
  color: var(--bc-accent);
  background: rgba(106, 79, 224, 0.08);
}

.bulk-col-body {
  padding: 16px;
}

.bulk-col-lead {
  margin: 0 0 14px;
  color: var(--bc-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.bulk-col-empty {
  padding: 12px;
  color: #a15d12;
  background: rgba(212, 138, 42, 0.1);
  box-shadow: inset 0 0 0 1px rgba(212, 138, 42, 0.35);
  font-size: 0.82rem;
}

.bulk-col-field {
  display: grid;
  gap: 6px;
}

.bulk-col-field > span {
  color: var(--bc-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bulk-col-field select {
  min-height: 40px;
  border: 0;
  border-radius: 0;
  padding: 0 12px;
  background: var(--bc-page);
  color: var(--bc-ink);
  box-shadow: inset 0 0 0 1px var(--bc-line);
  font: inherit;
}

.bulk-col-field select:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.55);
}

.bulk-col-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--bc-line);
}

.bulk-col-btn {
  min-width: 84px;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--bc-ink);
  box-shadow: inset 0 0 0 1px var(--bc-line);
  font-size: 0.86rem;
  font-weight: 720;
  cursor: pointer;
}

.bulk-col-btn:hover:not(:disabled) {
  color: var(--bc-accent);
  background: rgba(106, 79, 224, 0.08);
}

.bulk-col-btn.is-primary {
  color: #fff;
  background: var(--bc-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.bulk-col-backdrop.is-scheme-dark .bulk-col-btn.is-primary {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 3px 3px 0 rgba(180, 160, 255, 0.5);
}

.bulk-col-btn.is-primary:hover:not(:disabled) {
  background: #6a4fe0;
  color: #fff;
}

.bulk-col-backdrop.is-scheme-dark .bulk-col-btn.is-primary:hover:not(:disabled) {
  background: #fff;
  color: #151a2d;
}

.bulk-col-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
