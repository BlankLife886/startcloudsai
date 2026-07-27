<script setup>
import { FILTER_PRESET_GROUPS, FILTER_PRESETS } from '@/features/filters/filterPresets'
import { ref, watch } from 'vue'

const props = defineProps({
  activeFilter: { type: String, default: 'none' },
  selectedPresetId: { default: null },
  customPresets: { type: Array, default: () => [] },
  resetToken: { type: Number, default: 0 },
})

const emit = defineEmits(['apply-preset', 'save-custom-preset', 'remove-custom-preset'])

const customPresetName = ref('')

watch(
  () => props.resetToken,
  () => {
    customPresetName.value = ''
  },
)

function presetsInGroup(groupId) {
  if (groupId === 'custom') return props.customPresets
  return FILTER_PRESETS.filter((p) => p.group === groupId)
}

function isPresetActive(preset) {
  if (props.selectedPresetId) return props.selectedPresetId === preset.id
  if (preset.legacyId) return props.activeFilter === preset.legacyId && preset.id !== 'none'
  return false
}

function saveCustomPreset() {
  emit('save-custom-preset', customPresetName.value)
  customPresetName.value = ''
}
</script>

<template>
  <div class="filter-tab-panel">
    <template v-for="group in FILTER_PRESET_GROUPS" :key="group.id">
      <section
        v-if="group.id !== 'custom' || customPresets.length > 0"
        class="filter-group-card"
      >
        <div class="filter-group-head">{{ group.label }}</div>
        <div class="filter-preset-grid">
          <button
            v-for="preset in presetsInGroup(group.id)"
            :key="preset.id"
            type="button"
            class="filter-preset-btn"
            :class="{ active: isPresetActive(preset) }"
            :title="preset.description || preset.label"
            @click="emit('apply-preset', preset.id)"
          >
            <span class="preset-label">{{ preset.label }}</span>
            <span
              v-if="group.id === 'custom'"
              class="custom-preset-delete-btn"
              title="删除"
              @click.stop="emit('remove-custom-preset', preset.id)"
            >
              <i class="bi bi-x"></i>
            </span>
          </button>
        </div>
      </section>
    </template>

    <section class="filter-group-card filter-group-card--save">
      <div class="filter-group-head">保存当前效果</div>
      <div class="custom-preset-row">
        <input
          v-model.trim="customPresetName"
          type="text"
          maxlength="24"
          class="custom-preset-input"
          placeholder="预设名称"
          @keydown.enter.prevent="saveCustomPreset"
        />
        <button type="button" class="custom-preset-save-btn" @click="saveCustomPreset">保存</button>
      </div>
    </section>
  </div>
</template>
