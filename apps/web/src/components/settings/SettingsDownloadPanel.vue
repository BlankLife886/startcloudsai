<script setup>
defineProps({
  formData: {
    type: Object,
    required: true,
  },
  toggleTools: {
    type: Array,
    default: () => [],
  },
})
</script>

<template>
  <section class="settings-panel settings-console__section">
    <div class="settings-console__stack">
      <div class="compact-settings-panel">
        <div class="compact-panel-head">
          <strong>下载行为</strong>
        </div>
        <div class="tool-chip-grid">
          <label v-for="tool in toggleTools" :key="tool.key" class="tool-chip">
            <input v-model="formData[tool.key]" type="checkbox" />
            <span :title="tool.tooltip">
              <i class="bi" :class="tool.icon"></i> {{ tool.label }}
            </span>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
