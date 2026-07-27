<script setup>
defineProps({
  activeTab: { type: String, default: 'presets' },
})

const emit = defineEmits(['update:activeTab'])

const tabs = [
  { id: 'presets', label: '预设' },
  { id: 'styles', label: '风格' },
  { id: 'pro', label: '调色' },
]
</script>

<template>
  <div class="filter-tabs">
    <button
      v-for="item in tabs"
      :key="item.id"
      type="button"
      class="filter-tab"
      :class="{ active: activeTab === item.id }"
      @click="emit('update:activeTab', item.id)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
