<script setup>
defineProps({
  tagBuckets: {
    type: Array,
    default: () => [],
  },
  colorBuckets: {
    type: Array,
    default: () => [],
  },
})

defineEmits(['pick-tag', 'pick-color'])
</script>

<template>
  <div v-if="tagBuckets.length || colorBuckets.length" class="aggregates-panel">
    <div v-if="tagBuckets.length" class="agg-row">
      <span class="agg-label">本页热门标签</span>
      <div class="agg-grow">
        <div class="agg-tags">
          <button
            v-for="t in tagBuckets"
            :key="t.name"
            type="button"
            class="agg-chip"
            @click="$emit('pick-tag', t.name)"
          >
            {{ t.name }}
            <span class="agg-count">{{ t.count }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="colorBuckets.length" class="agg-row">
      <span class="agg-label">主色</span>
      <div class="agg-grow agg-grow--colors">
        <div class="agg-colors">
          <button
            v-for="c in colorBuckets"
            :key="c.hex"
            type="button"
            class="color-dot"
            :title="`#${c.hex} · ${c.count}`"
            :style="{ backgroundColor: `#${c.hex}` }"
            @click="$emit('pick-color', c.hex)"
          >
            <span class="visually-hidden">筛选 #{{ c.hex }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aggregates-panel {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  background: color-mix(in srgb, var(--card-bg-color) 97%, var(--text-color) 2%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agg-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 12px;
  width: 100%;
}

.agg-label {
  flex: 0 0 auto;
  width: 5.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--text-color) 58%, transparent);
  padding-top: 0.28rem;
}

.agg-grow {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  justify-content: flex-start;
}

/* 主色圆点较少时，在右侧区域内居中，避免大块空白挤在右边 */
.agg-grow--colors {
  justify-content: center;
}

.agg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
}

.agg-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 12px;
  font-size: 0.78rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  background: color-mix(in srgb, var(--card-bg-color) 100%, transparent);
  color: var(--text-color);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.agg-chip:hover {
  border-color: color-mix(in srgb, var(--primary-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--primary-color) 12%, var(--card-bg-color));
}

.agg-count {
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.agg-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: center;
  max-width: 100%;
}

.color-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  padding: 0;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.color-dot:hover {
  transform: scale(1.06);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

@media (max-width: 576px) {
  .agg-label {
    width: 100%;
    padding-top: 0;
  }

  .agg-grow--colors {
    justify-content: flex-start;
  }

  .agg-colors {
    justify-content: flex-start;
  }
}
</style>
