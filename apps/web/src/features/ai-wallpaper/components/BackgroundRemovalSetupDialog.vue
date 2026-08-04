<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  light: { type: Boolean, default: false },
})

const emit = defineEmits(['cancel', 'choose'])
const noButtonRef = ref(null)

function handleKeydown(event) {
  if (!props.open || event.key !== 'Escape') return
  event.preventDefault()
  emit('cancel')
}

watch(
  () => props.open,
  (open) => {
    if (open) nextTick(() => noButtonRef.value?.focus())
  },
)

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="background-setup">
      <div
        v-if="open"
        class="background-setup__backdrop"
        :class="{ 'is-light': light }"
        @click.self="emit('cancel')"
      >
        <section
          class="background-setup__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="background-setup-title"
          aria-describedby="background-setup-description"
        >
          <span class="background-setup__icon" aria-hidden="true">
            <i class="bi bi-person-bounding-box"></i>
          </span>
          <div class="background-setup__copy">
            <h2 id="background-setup-title">使用纯色背景生成？</h2>
            <p id="background-setup-description">纯色背景通常能让主体边缘识别更准确。</p>
          </div>
          <button
            type="button"
            class="background-setup__close"
            aria-label="关闭"
            title="关闭"
            @click="emit('cancel')"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
          <footer>
            <button
              ref="noButtonRef"
              type="button"
              class="is-secondary"
              @click="emit('choose', false)"
            >
              否，保持原提示词
            </button>
            <button type="button" class="is-primary" @click="emit('choose', true)">
              <i class="bi bi-check2" aria-hidden="true"></i>
              是，使用纯色背景
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.background-setup__backdrop {
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

.background-setup__dialog {
  position: relative;
  width: min(420px, 100%);
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 14px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 16px;
  background: #17171f;
  color: rgba(255, 255, 255, 0.94);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
}

.background-setup__icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(126, 108, 255, 0.16);
  color: #b7aeff;
  font-size: 1.2rem;
}

.background-setup__copy {
  min-width: 0;
  padding-right: 28px;
}

.background-setup__copy h2 {
  margin: 2px 0 7px;
  font-size: 1.02rem;
}

.background-setup__copy p {
  margin: 0;
  color: rgba(255, 255, 255, 0.56);
  font-size: 0.82rem;
  line-height: 1.55;
}

.background-setup__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
}

.background-setup__close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.background-setup__dialog footer {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 6px;
}

.background-setup__dialog footer button {
  min-height: 38px;
  padding: 0 15px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.background-setup__dialog .is-secondary {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.72);
}

.background-setup__dialog .is-primary {
  border-color: rgba(126, 108, 255, 0.45);
  background: #7e6cff;
  color: #fff;
}

.background-setup__backdrop.is-light {
  background: rgba(28, 33, 48, 0.38);
}

.background-setup__backdrop.is-light .background-setup__dialog {
  border-color: rgba(37, 45, 70, 0.14);
  background: #fff;
  color: #20253a;
  box-shadow: 0 28px 80px rgba(40, 47, 72, 0.2);
}

.background-setup__backdrop.is-light .background-setup__copy p {
  color: rgba(32, 37, 58, 0.62);
}

.background-setup__backdrop.is-light .background-setup__close {
  color: rgba(32, 37, 58, 0.5);
}

.background-setup__backdrop.is-light .background-setup__dialog .is-secondary {
  border-color: rgba(37, 45, 70, 0.12);
  background: rgba(37, 45, 70, 0.05);
  color: #4a526f;
}

.background-setup-enter-active,
.background-setup-leave-active {
  transition: opacity 180ms ease;
}

.background-setup-enter-active .background-setup__dialog,
.background-setup-leave-active .background-setup__dialog {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.background-setup-enter-from,
.background-setup-leave-to {
  opacity: 0;
}

.background-setup-enter-from .background-setup__dialog,
.background-setup-leave-to .background-setup__dialog {
  transform: translateY(10px) scale(0.97);
}
</style>
