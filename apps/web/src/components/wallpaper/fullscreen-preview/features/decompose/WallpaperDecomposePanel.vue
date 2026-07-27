<script setup>
import { computed } from 'vue'

// 分解面板：左下角极简布局，仅网格切换、预览网格、下载。
const props = defineProps({
  show: { type: Boolean, default: false },
  decomposedTiles: { type: Array, default: () => [] },
  transitionTiles: { type: Array, default: () => [] },
  decomposeGridSize: { type: Number, default: 3 },
  isSwitching: { type: Boolean, default: false },
  layoutMode: { type: String, default: 'landscape' },
  sourceAspectRatio: { type: String, default: '16 / 9' },
})

const emit = defineEmits(['set-grid-size', 'toggle-tile', 'download', 'cancel'])

const selectedTileCount = computed(
  () => props.decomposedTiles.filter((tile) => tile.selected).length,
)

const canDownload = computed(() => selectedTileCount.value > 0)

const displayTiles = computed(() => {
  if (props.isSwitching && props.transitionTiles.length) {
    return props.transitionTiles
  }
  return props.decomposedTiles
})

const isPortrait = computed(() => props.layoutMode === 'portrait')

const panelClass = computed(() => ({
  'decompose-panel--landscape': !isPortrait.value,
  'decompose-panel--portrait': isPortrait.value,
}))

const gridFrameStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.decomposeGridSize}, 1fr)`,
  gridTemplateRows: `repeat(${props.decomposeGridSize}, 1fr)`,
  '--source-aspect': props.sourceAspectRatio,
}))
</script>

<template>
  <Transition name="decompose-panel">
    <aside v-if="show" class="decompose-panel" :class="panelClass" aria-label="分解预览">
      <div class="decompose-grid-size-switch" role="group" aria-label="网格密度">
        <button
          v-for="size in [2, 3, 4]"
          :key="size"
          type="button"
          class="decompose-size-btn"
          :class="{ active: decomposeGridSize === size }"
          :aria-pressed="decomposeGridSize === size"
          @click="emit('set-grid-size', size)"
        >
          {{ size }}×{{ size }}
        </button>
      </div>

      <div
        class="decompose-grid-frame"
        :class="{ switching: isSwitching }"
        :style="gridFrameStyle"
      >
        <button
          v-for="tile in displayTiles"
          :key="tile.id"
          type="button"
          class="decompose-tile"
          :class="{
            selected: tile.selected && !isSwitching,
            'decompose-tile--preview': isSwitching,
          }"
          :aria-pressed="!!tile.selected"
          :aria-label="`分块 ${tile.index}${tile.selected ? '，已选中' : ''}`"
          :disabled="isSwitching"
          @click="emit('toggle-tile', tile.id)"
        >
          <img :src="tile.dataUrl" :alt="`分块 ${tile.index}`" loading="lazy" draggable="false" />
          <span v-if="tile.selected && !isSwitching" class="decompose-tile-check" aria-hidden="true">
            <i class="bi bi-check-lg"></i>
          </span>
          <span v-if="!tile.selected && !isSwitching" class="decompose-tile-dim" aria-hidden="true"></span>
        </button>
      </div>

      <div class="decompose-footer">
        <button
          type="button"
          class="decompose-download-btn"
          :disabled="!canDownload"
          @click="emit('download')"
        >
          <i class="bi bi-download" aria-hidden="true"></i>
          下载已选
          <span v-if="selectedTileCount > 0" class="decompose-download-count">{{ selectedTileCount }}</span>
        </button>
        <button type="button" class="decompose-cancel-btn" @click="emit('cancel')">
          取消分解
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.decompose-panel {
  position: absolute;
  left: 20px;
  bottom: 20px;
  z-index: 85;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(34, 36, 40, 0.82) 0%, rgba(18, 19, 22, 0.9) 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
  color: #fff;
}

.decompose-panel--landscape {
  width: min(400px, calc(100vw - 40px));
}

.decompose-panel--portrait {
  width: min(228px, calc(100vw - 40px));
}

.decompose-grid-size-switch {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.decompose-size-btn {
  flex: 1;
  border: none;
  border-radius: 999px;
  min-height: 28px;
  background: transparent;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.76rem;
  font-weight: 650;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.decompose-size-btn.active {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.decompose-grid-frame {
  display: grid;
  gap: 0;
  width: 100%;
  aspect-ratio: var(--source-aspect, 16 / 9);
  overflow: hidden;
  border-radius: 10px;
  line-height: 0;
  transition: opacity 0.16s ease;
}

.decompose-panel--landscape .decompose-grid-frame {
  max-height: min(240px, 34vh);
}

.decompose-panel--portrait .decompose-grid-frame {
  max-height: min(360px, 46vh);
}

.decompose-grid-frame.switching {
  opacity: 0.78;
}

.decompose-tile {
  position: relative;
  min-width: 0;
  min-height: 0;
  border: none;
  padding: 0;
  margin: 0;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  line-height: 0;
}

.decompose-tile img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: fill;
}

.decompose-tile--preview {
  pointer-events: none;
}

.decompose-tile.selected {
  box-shadow: inset 0 0 0 2px rgba(152, 228, 175, 0.88);
  z-index: 1;
}

.decompose-tile-dim {
  position: absolute;
  inset: 0;
  background: rgba(8, 10, 14, 0.46);
  pointer-events: none;
}

.decompose-tile-check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(
    180deg,
    rgba(152, 228, 175, 0.96),
    rgba(118, 204, 146, 0.92)
  );
  color: #102313;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  font-size: 0.78rem;
  pointer-events: none;
}

.decompose-tile:focus-visible {
  outline: 2px solid rgba(152, 228, 175, 0.85);
  outline-offset: -2px;
  z-index: 2;
}

.decompose-footer {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.decompose-download-btn {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--primary-color, #4caf50);
  border-radius: 12px;
  min-height: 36px;
  background: var(--primary-color, #4caf50);
  color: var(--default-on-primary, #fff);
  font-size: 0.8rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.decompose-cancel-btn {
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  min-height: 36px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.8rem;
  font-weight: 650;
  transition: background-color 0.16s ease;
}

.decompose-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.11);
}

.decompose-download-btn:hover:not(:disabled) {
  background: var(--default-primary-variant, #388e3c);
  border-color: var(--default-primary-variant, #388e3c);
}

.decompose-download-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  filter: none;
}

.decompose-download-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  font-size: 0.7rem;
  font-weight: 800;
}

.decompose-panel-enter-active,
.decompose-panel-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.decompose-panel-enter-from,
.decompose-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 768px) {
  .decompose-panel {
    left: 12px;
    bottom: 12px;
    padding: 8px;
    border-radius: 14px;
  }

  .decompose-panel--landscape {
    width: min(320px, calc(100vw - 24px));
  }

  .decompose-panel--portrait {
    width: min(200px, calc(100vw - 24px));
  }

  .decompose-panel--landscape .decompose-grid-frame {
    max-height: min(200px, 30vh);
  }

  .decompose-panel--portrait .decompose-grid-frame {
    max-height: min(280px, 40vh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .decompose-panel-enter-active,
  .decompose-panel-leave-active,
  .decompose-grid-frame {
    transition: none !important;
  }
}
</style>
