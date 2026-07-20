<script setup>
// 最近生成结果是独立的回看入口，单独拆出来后，主面板就只剩壳和编排。
defineProps({
  history: { type: Array, default: () => [] },
})

const emit = defineEmits(['apply-history', 'download-history'])
</script>

<template>
  <section v-if="history.length" class="ai-history">
    <div class="ai-history-head">
      <span>最近生成</span>
      <small>{{ history.length }}/6</small>
    </div>
    <div class="ai-history-list">
      <button
        v-for="item in history"
        :key="item.id"
        type="button"
        class="ai-history-item"
        :title="`${item.taskLabel} ${item.ratio || ''} ${item.createdAt}`"
        @click="emit('apply-history', item)"
      >
        <img :src="item.url" :alt="item.taskLabel" />
        <span>{{ item.ratio || item.taskLabel }}</span>
        <i class="bi bi-download" @click.stop="emit('download-history', item)"></i>
      </button>
    </div>
  </section>
</template>

<style scoped>
.ai-history {
  display: grid;
  gap: 8px;
  padding-top: 2px;
}

.ai-history-head {
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.76);
  font-size: 0.76rem;
}

.ai-history-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.ai-history-item {
  position: relative;
  min-width: 0;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.ai-history-item img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}

.ai-history-item span {
  display: block;
  padding: 4px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.78);
}

.ai-history-item i {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.56);
  color: #fff;
  font-size: 0.72rem;
}
</style>
