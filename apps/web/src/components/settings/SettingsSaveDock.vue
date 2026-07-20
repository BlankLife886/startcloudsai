<script setup>
defineProps({
  isSaving: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['reset'])
</script>

<template>
  <div class="settings-save-dock" role="region" aria-label="设置保存操作">
    <div class="settings-save-dock-inner">
      <button
        type="button"
        class="footer-button muted"
        title="将所有设置恢复到默认值"
        @click="$emit('reset')"
      >
        恢复默认
      </button>
      <button
        type="submit"
        form="settings-main-form"
        class="footer-button primary"
        :disabled="isSaving"
        title="保存当前设置"
      >
        <i v-if="isSaving" class="bi bi-arrow-repeat spin"></i>
        <span>{{ isSaving ? '保存中...' : '保存设置' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.footer-button {
  min-width: 108px;
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border: none;
  border-radius: 0;
  color: #fff;
  font-weight: 760;
}

.footer-button.muted {
  background: #7d8791;
}

.footer-button.primary {
  background: var(--primary-color, #6a4fe0);
  color: #fff;
}

.settings-save-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2850;
  display: flex;
  justify-content: flex-end;
  padding: 0 14px calc(12px + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
}

.settings-save-dock-inner {
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: auto;
  max-width: calc(100vw - 28px);
  padding: 10px 12px;
  border-radius: 0;
  border: 1px solid var(--border-color, rgba(21, 26, 45, 0.12));
  background: color-mix(in srgb, var(--card-bg-color, #fff) 94%, transparent);
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.16);
}

@media (max-width: 680px) {
  .settings-save-dock-inner {
    flex-direction: column-reverse;
    align-items: stretch;
    width: calc(100vw - 28px);
  }

  .footer-button {
    width: 100%;
  }
}
</style>
