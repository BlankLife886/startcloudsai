<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  heading: { type: String, default: '删除这条历史记录？' },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认删除' },
  busyLabel: { type: String, default: '删除中…' },
})

const emit = defineEmits(['close', 'confirm'])
const cancelButtonRef = ref(null)

function close() {
  if (!props.busy) emit('close')
}

function handleKeydown(event) {
  if (!props.open || event.key !== 'Escape') return
  event.preventDefault()
  close()
}

watch(
  () => props.open,
  (open) => {
    if (open) nextTick(() => cancelButtonRef.value?.focus())
  },
)

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="delete-confirm">
      <div v-if="open" class="delete-confirm__backdrop" @click.self="close">
        <section
          class="delete-confirm__dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          aria-describedby="delete-confirm-description"
        >
          <div class="delete-confirm__icon" aria-hidden="true">
            <i class="bi bi-trash3"></i>
          </div>
          <div class="delete-confirm__copy">
            <h2 id="delete-confirm-title">{{ heading }}</h2>
            <p id="delete-confirm-description">
              <template v-if="description">{{ description }}</template>
              <template v-else>
                删除后将无法恢复<span v-if="title">：“{{ title }}”</span>
              </template>
            </p>
          </div>
          <footer class="delete-confirm__actions">
            <button
              ref="cancelButtonRef"
              type="button"
              class="is-cancel"
              :disabled="busy"
              @click="close"
            >
              取消
            </button>
            <button
              type="button"
              class="is-confirm"
              :disabled="busy"
              @click="emit('confirm')"
            >
              <i v-if="busy" class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
              {{ busy ? busyLabel : confirmLabel }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.delete-confirm__backdrop {
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 2, 6, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.delete-confirm__dialog {
  width: min(100%, 400px);
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 14px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  background: #17171f;
  color: rgba(255, 255, 255, 0.94);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
}

.delete-confirm__icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: rgba(255, 104, 104, 0.12);
  color: #ff9a9a;
  font-size: 1.2rem;
}

.delete-confirm__copy {
  min-width: 0;
}

.delete-confirm__copy h2 {
  margin: 2px 0 7px;
  font-size: 1.02rem;
}

.delete-confirm__copy p {
  margin: 0;
  color: rgba(255, 255, 255, 0.54);
  font-size: 0.82rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.delete-confirm__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 4px;
}

.delete-confirm__actions button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}

.delete-confirm__actions button:disabled {
  opacity: 0.52;
  cursor: wait;
}

.delete-confirm__actions .is-cancel {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.72);
}

.delete-confirm__actions .is-confirm {
  border-color: rgba(255, 110, 110, 0.38);
  background: #e95f67;
  color: #fff;
}

.delete-confirm__actions .spin {
  display: inline-block;
  margin-right: 6px;
  animation: delete-confirm-spin 0.9s linear infinite;
}

.delete-confirm-enter-active,
.delete-confirm-leave-active {
  transition: opacity 180ms ease;
}

.delete-confirm-enter-active .delete-confirm__dialog,
.delete-confirm-leave-active .delete-confirm__dialog {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.delete-confirm-enter-from,
.delete-confirm-leave-to {
  opacity: 0;
}

.delete-confirm-enter-from .delete-confirm__dialog,
.delete-confirm-leave-to .delete-confirm__dialog {
  transform: translateY(10px) scale(0.97);
}

@keyframes delete-confirm-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .delete-confirm-enter-active,
  .delete-confirm-leave-active,
  .delete-confirm-enter-active .delete-confirm__dialog,
  .delete-confirm-leave-active .delete-confirm__dialog {
    transition: none;
  }

  .delete-confirm__actions .spin {
    animation: none;
  }
}
</style>
