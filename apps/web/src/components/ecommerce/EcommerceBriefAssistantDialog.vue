<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  productName: { type: String, default: '' },
  sellingPoints: { type: String, default: '' },
  light: { type: Boolean, default: true },
})

const emit = defineEmits([
  'close',
  'regenerate',
  'confirm',
  'update:productName',
  'update:sellingPoints',
])
const closeButton = ref(null)

watch(
  () => props.open,
  (open) => {
    if (open) nextTick(() => closeButton.value?.focus())
  },
)

function close() {
  if (!props.busy) emit('close')
}

function handleKeydown(event) {
  if (event.key === 'Escape') close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="brief-dialog">
      <div
        v-if="open"
        class="brief-dialog__backdrop"
        :class="{ light }"
        @click.self="close"
        @keydown="handleKeydown"
      >
        <section
          class="brief-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-brief-title"
        >
          <header>
            <span><i class="bi bi-stars"></i></span>
            <div>
              <small>AI 商品识别</small>
              <h2 id="ecommerce-brief-title">生成商品名称和卖点</h2>
            </div>
            <button ref="closeButton" type="button" aria-label="关闭" :disabled="busy" @click="close">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div v-if="busy" class="brief-dialog__loading" role="status">
            <span><i class="bi bi-stars"></i></span>
            <strong>正在识别商品图片</strong>
            <small>AI 正在提取商品类型、可见特征与核心卖点</small>
          </div>

          <div v-else class="brief-dialog__content">
            <p v-if="error" class="brief-dialog__error" role="alert">
              <i class="bi bi-exclamation-circle"></i>{{ error }}
            </p>
            <template v-if="productName || sellingPoints">
              <label>
                <span>商品名称</span>
                <input
                  :value="productName"
                  maxlength="60"
                  @input="emit('update:productName', $event.target.value)"
                />
              </label>
              <label>
                <span>核心卖点</span>
                <textarea
                  :value="sellingPoints"
                  maxlength="1200"
                  @input="emit('update:sellingPoints', $event.target.value)"
                ></textarea>
                <small>{{ sellingPoints.length }}/1200</small>
              </label>
            </template>
          </div>

          <footer>
            <button
              type="button"
              class="brief-dialog__regenerate"
              :disabled="busy"
              @click="emit('regenerate')"
            >
              <i class="bi bi-arrow-repeat"></i>
              {{ productName || sellingPoints ? '重新生成' : '重试' }}
            </button>
            <button
              type="button"
              class="brief-dialog__confirm"
              :disabled="busy || !productName.trim() || !sellingPoints.trim()"
              @click="emit('confirm')"
            >
              <i class="bi bi-check-lg"></i>确认填入
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.brief-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(2 2 6 / 72%);
  backdrop-filter: blur(10px);
}
.brief-dialog {
  width: min(520px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  overflow: auto;
  color: #f1f1f5;
  background: #17171f;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 8px;
  box-shadow: 0 28px 80px rgb(0 0 0 / 55%);
}
.brief-dialog > header {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 11px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid rgb(255 255 255 / 9%);
}
.brief-dialog > header > span {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  color: #9ac1ff;
  background: #172a46;
  border-radius: 8px;
}
.brief-dialog h2 {
  margin: 2px 0 0;
  font-size: 16px;
}
.brief-dialog header small {
  color: #a5a4b1;
  font-size: 10px;
}
.brief-dialog header button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: #a5a4b1;
  background: transparent;
  border: 0;
  border-radius: 7px;
}
.brief-dialog__loading {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
.brief-dialog__loading > span {
  display: grid;
  width: 52px;
  height: 52px;
  margin-bottom: 14px;
  place-items: center;
  color: #9ac1ff;
  background: #172a46;
  border-radius: 8px;
  animation: brief-pulse 1.2s ease-in-out infinite;
}
.brief-dialog__loading strong {
  font-size: 14px;
}
.brief-dialog__loading small {
  margin-top: 6px;
  color: #a5a4b1;
  font-size: 10px;
}
.brief-dialog__content {
  display: grid;
  gap: 15px;
  padding: 18px;
}
.brief-dialog__content label {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.brief-dialog__content label > span {
  color: #c5c5ce;
  font-size: 11px;
  font-weight: 700;
}
.brief-dialog__content input,
.brief-dialog__content textarea {
  width: 100%;
  color: inherit;
  background: #222228;
  border: 1px solid #303039;
  border-radius: 7px;
  outline: none;
  font: inherit;
  font-size: 12px;
}
.brief-dialog__content input {
  height: 40px;
  padding: 0 12px;
}
.brief-dialog__content textarea {
  min-height: 180px;
  padding: 12px 12px 28px;
  resize: vertical;
  line-height: 1.65;
}
.brief-dialog__content label > small {
  position: absolute;
  right: 10px;
  bottom: 9px;
  color: #8d8d99;
  font-size: 9px;
}
.brief-dialog__error {
  margin: 0;
  padding: 10px 11px;
  color: #ffaaaa;
  background: rgb(233 95 103 / 10%);
  border-radius: 7px;
  font-size: 11px;
}
.brief-dialog__error i {
  margin-right: 6px;
}
.brief-dialog > footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding: 0 18px 18px;
}
.brief-dialog > footer button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 15px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
}
.brief-dialog__regenerate {
  color: #c5c5ce;
  background: #27272e;
}
.brief-dialog__confirm {
  color: #fff;
  background: #2f7ef7;
}
.brief-dialog > footer button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.brief-dialog__backdrop.light {
  background: rgb(48 49 62 / 30%);
}
.brief-dialog__backdrop.light .brief-dialog {
  color: #17191d;
  background: #fff;
  border-color: #e2e6ec;
  box-shadow: 0 26px 76px rgb(48 44 78 / 20%);
}
.brief-dialog__backdrop.light .brief-dialog > header {
  border-bottom-color: #e2e6ec;
}
.brief-dialog__backdrop.light .brief-dialog header button,
.brief-dialog__backdrop.light .brief-dialog header small {
  color: #737985;
}
.brief-dialog__backdrop.light .brief-dialog__content label > span {
  color: #555b66;
}
.brief-dialog__backdrop.light .brief-dialog__content input,
.brief-dialog__backdrop.light .brief-dialog__content textarea {
  color: #17191d;
  background: #f4f5f7;
  border-color: transparent;
}
.brief-dialog__backdrop.light .brief-dialog__regenerate {
  color: #555b66;
  background: #f0f2f5;
}
.brief-dialog-enter-active,
.brief-dialog-leave-active {
  transition: opacity 180ms ease;
}
.brief-dialog-enter-from,
.brief-dialog-leave-to {
  opacity: 0;
}
@keyframes brief-pulse {
  50% {
    transform: scale(1.06);
    opacity: 0.72;
  }
}
@media (max-width: 560px) {
  .brief-dialog__backdrop {
    padding: 10px;
  }
  .brief-dialog > footer {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
