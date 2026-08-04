<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { getShareOverview } from '@/services/shareGallery'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  styleLabel: { type: String, default: '' },
  submitting: { type: Boolean, default: false },
  light: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'submit'])

const categories = ref([])
const categoriesLoading = ref(false)
let categoriesLoaded = false

const form = reactive({
  title: '',
  category: '',
})

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    form.title = props.title || props.styleLabel || 'AI 创作'
    form.category = ''
    if (!categoriesLoaded) {
      categoriesLoaded = true
      categoriesLoading.value = true
      const data = await getShareOverview().catch(() => null)
      if (Array.isArray(data?.categories) && data.categories.length) {
        categories.value = data.categories.map((item) => ({
          value: item.key,
          label: item.label,
        }))
      }
      categoriesLoading.value = false
    }
  },
  { immediate: true },
)

function submit() {
  if (props.submitting || !form.title.trim()) return
  emit('submit', {
    title: form.title.trim(),
    categoryId: form.category,
  })
}

function toggleCategory(value) {
  form.category = form.category === value ? '' : value
}

function close() {
  if (!props.submitting) emit('close')
}

function handleKeydown(event) {
  if (!props.open || props.submitting || event.key !== 'Escape') return
  event.preventDefault()
  close()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="share-publish">
      <div
        v-if="open"
        class="share-publish-backdrop"
        :class="{ 'is-light': light }"
        @click.self="close"
      >
        <section
          class="share-publish-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-publish-title"
        >
          <header>
            <div class="share-publish-heading">
              <span class="share-publish-heading-icon" aria-hidden="true">
                <i class="bi bi-stars"></i>
              </span>
              <div>
                <small>社区画廊</small>
                <h2 id="share-publish-title">发布作品</h2>
              </div>
            </div>
            <button
              type="button"
              class="share-publish-close"
              aria-label="关闭"
              :disabled="submitting"
              @click="close"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <form class="share-publish-body" @submit.prevent="submit">
            <label class="share-publish-field">
              <span>
                <strong>作品标题</strong>
                <small>{{ form.title.length }} / 120</small>
              </span>
              <textarea
                v-model="form.title"
                maxlength="120"
                rows="3"
                autocomplete="off"
                placeholder="给作品起个好记的名字，方便社区检索"
              />
            </label>

            <fieldset v-if="categoriesLoading || categories.length" class="share-publish-category">
              <legend>
                <strong>作品分类</strong>
                <small>可选</small>
              </legend>
              <div
                v-if="categoriesLoading"
                class="share-publish-category-loading"
                aria-label="正在加载分类"
              >
                <span v-for="index in 4" :key="index"></span>
              </div>
              <div v-else class="share-publish-category-options">
                <button
                  v-for="item in categories"
                  :key="item.value"
                  type="button"
                  :class="{ 'is-selected': form.category === item.value }"
                  :aria-pressed="form.category === item.value"
                  @click="toggleCategory(item.value)"
                >
                  {{ item.label }}
                </button>
              </div>
            </fieldset>

            <div class="share-publish-tip">
              <i class="bi bi-shield-check" aria-hidden="true"></i>
              <span>
                <strong>提交后进入审核</strong>
                <small>通过后将展示在社区画廊，其他创作者也能看到</small>
              </span>
            </div>
          </form>

          <footer>
            <button type="button" class="is-secondary" :disabled="submitting" @click="close">
              取消
            </button>
            <button
              type="button"
              class="is-primary"
              :disabled="submitting || !form.title.trim()"
              @click="submit"
            >
              <i class="bi" :class="submitting ? 'bi-arrow-repeat spin' : 'bi-send-fill'"></i>
              <span>{{ submitting ? '提交中…' : '提交审核' }}</span>
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.share-publish-backdrop {
  --share-accent: #6d5cff;
  --share-accent-2: #8b7bff;
  --share-accent-rgb: 109, 92, 255;
  --share-page: #09090c;
  --share-surface: #16151f;
  --share-surface-2: #1c1b28;
  --share-border: rgba(255, 255, 255, 0.1);
  --share-text: rgba(255, 255, 255, 0.96);
  --share-muted: rgba(255, 255, 255, 0.52);
  --share-faint: rgba(255, 255, 255, 0.36);
  position: fixed;
  inset: 0;
  z-index: 12100;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(5, 5, 10, 0.72);
  backdrop-filter: blur(12px) saturate(0.88);
  -webkit-backdrop-filter: blur(12px) saturate(0.88);
  color-scheme: dark;
}

.share-publish-backdrop,
.share-publish-backdrop * {
  box-sizing: border-box;
}

.share-publish-dialog {
  position: relative;
  width: min(500px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  background:
    radial-gradient(ellipse at 12% 0%, rgba(var(--share-accent-rgb), 0.18), transparent 42%),
    radial-gradient(ellipse at 88% 100%, rgba(139, 123, 255, 0.1), transparent 46%),
    linear-gradient(180deg, #1a1926 0%, var(--share-surface) 48%, #13121b 100%);
  color: var(--share-text);
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.share-publish-dialog > header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.share-publish-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.share-publish-heading-icon {
  display: grid;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(var(--share-accent-rgb), 0.32);
  border-radius: 12px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.16), transparent 55%),
    rgba(var(--share-accent-rgb), 0.16);
  color: var(--share-accent-2);
  font-size: 1.1rem;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.share-publish-heading > div {
  min-width: 0;
}

.share-publish-heading small {
  display: block;
  margin-bottom: 3px;
  color: rgba(var(--share-accent-rgb), 0.92);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.share-publish-heading h2 {
  margin: 0;
  color: var(--share-text);
  font-size: 1.2rem;
  font-weight: 720;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.share-publish-close {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--share-muted);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.share-publish-close:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: var(--share-text);
}

.share-publish-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.share-publish-body {
  display: grid;
  min-height: 0;
  gap: 18px;
  padding: 20px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.share-publish-field {
  display: grid;
  gap: 8px;
}

.share-publish-field > span,
.share-publish-category legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.share-publish-field strong,
.share-publish-category strong {
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.78rem;
  font-weight: 650;
}

.share-publish-field small,
.share-publish-category small {
  color: var(--share-faint);
  font-size: 0.7rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.share-publish-field textarea {
  width: 100%;
  min-height: 88px;
  resize: vertical;
  padding: 12px 13px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  outline: none;
  background: rgba(8, 8, 14, 0.45);
  color: var(--share-text);
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.45;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.share-publish-field textarea::placeholder {
  color: rgba(255, 255, 255, 0.32);
}

.share-publish-field textarea:focus {
  border-color: rgba(var(--share-accent-rgb), 0.55);
  background: rgba(var(--share-accent-rgb), 0.08);
  box-shadow: 0 0 0 3px rgba(var(--share-accent-rgb), 0.14);
}

.share-publish-category {
  display: grid;
  min-width: 0;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
}

.share-publish-category legend {
  width: 100%;
  margin-bottom: 0;
  padding: 0;
}

.share-publish-category-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.share-publish-category-options button {
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease,
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.share-publish-category-options button:hover {
  border-color: rgba(var(--share-accent-rgb), 0.4);
  color: var(--share-text);
  transform: translateY(-1px);
}

.share-publish-category-options button.is-selected {
  border-color: rgba(var(--share-accent-rgb), 0.55);
  background: rgba(var(--share-accent-rgb), 0.16);
  color: #efeaff;
  box-shadow: inset 0 0 0 1px rgba(var(--share-accent-rgb), 0.1);
}

.share-publish-category-loading {
  display: flex;
  gap: 8px;
}

.share-publish-category-loading span {
  width: 64px;
  height: 34px;
  border-radius: 999px;
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.04) 30%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0.04) 70%
  );
  background-size: 220% 100%;
  animation: share-publish-shimmer 1.4s ease-in-out infinite;
}

.share-publish-tip {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 13px;
  border: 1px solid rgba(var(--share-accent-rgb), 0.22);
  border-radius: 12px;
  background: rgba(var(--share-accent-rgb), 0.1);
}

.share-publish-tip > i {
  margin-top: 1px;
  color: var(--share-accent-2);
  font-size: 1.05rem;
}

.share-publish-tip > span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.share-publish-tip strong {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.82rem;
  font-weight: 650;
}

.share-publish-tip small {
  color: var(--share-muted);
  font-size: 0.74rem;
  line-height: 1.4;
}

.share-publish-dialog > footer {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 10, 16, 0.35);
}

.share-publish-dialog > footer button {
  min-width: 96px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border-radius: 999px;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.16s ease;
}

.share-publish-dialog > footer .is-secondary {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(255, 255, 255, 0.78);
}

.share-publish-dialog > footer .is-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--share-text);
}

.share-publish-dialog > footer .is-primary {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: linear-gradient(108deg, #4f3dff 0%, #6d5cff 52%, #8b5cf6 100%);
  color: #ffffff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 10px 24px rgba(79, 61, 255, 0.34);
}

.share-publish-dialog > footer .is-primary:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 14px 28px rgba(79, 61, 255, 0.42);
}

.share-publish-dialog > footer .is-primary:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}

.share-publish-dialog > footer button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  filter: none;
  transform: none;
}

.share-publish-dialog > footer .spin {
  animation: share-publish-spin 0.9s linear infinite;
}

.share-publish-enter-active,
.share-publish-leave-active {
  transition: opacity 0.2s ease;
}

.share-publish-enter-active .share-publish-dialog,
.share-publish-leave-active .share-publish-dialog {
  transition:
    opacity 0.2s ease,
    transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}

.share-publish-enter-from,
.share-publish-leave-to,
.share-publish-enter-from .share-publish-dialog,
.share-publish-leave-to .share-publish-dialog {
  opacity: 0;
}

.share-publish-enter-from .share-publish-dialog,
.share-publish-leave-to .share-publish-dialog {
  transform: translateY(10px) scale(0.985);
}

@keyframes share-publish-shimmer {
  to {
    background-position: -120% 0;
  }
}

@keyframes share-publish-spin {
  to {
    transform: rotate(360deg);
  }
}



@media (prefers-reduced-motion: reduce) {
  .share-publish-enter-active,
  .share-publish-leave-active,
  .share-publish-enter-active .share-publish-dialog,
  .share-publish-leave-active .share-publish-dialog,
  .share-publish-category-options button,
  .share-publish-category-loading span,
  .share-publish-dialog > footer button,
  .share-publish-dialog > footer .spin {
    transition: none;
    animation: none;
  }
}

.share-publish-backdrop.is-light {
  --share-page: #f5f4fb;
  --share-surface: #ffffff;
  --share-surface-2: #f7f6ff;
  --share-border: rgba(28, 30, 43, 0.1);
  --share-text: rgba(20, 20, 32, 0.94);
  --share-muted: rgba(20, 20, 32, 0.55);
  --share-faint: rgba(20, 20, 32, 0.4);
  background: rgba(40, 38, 68, 0.34);
  color-scheme: light;
}

.share-publish-backdrop.is-light .share-publish-dialog {
  border-color: rgba(28, 30, 43, 0.1);
  background:
    radial-gradient(ellipse at 12% 0%, rgba(var(--share-accent-rgb), 0.1), transparent 42%),
    linear-gradient(180deg, #ffffff 0%, #f8f7ff 100%);
  box-shadow: 0 26px 76px rgba(48, 44, 78, 0.2);
}

.share-publish-backdrop.is-light .share-publish-heading small {
  color: #6d5cff;
}

.share-publish-backdrop.is-light .share-publish-heading h2,
.share-publish-backdrop.is-light .share-publish-field strong,
.share-publish-backdrop.is-light .share-publish-category strong,
.share-publish-backdrop.is-light .share-publish-tip strong {
  color: var(--share-text);
}

.share-publish-backdrop.is-light .share-publish-close:hover:not(:disabled) {
  border-color: rgba(28, 30, 43, 0.1);
  background: rgba(28, 30, 43, 0.05);
}

.share-publish-backdrop.is-light .share-publish-field textarea {
  border-color: rgba(28, 30, 43, 0.1);
  background: rgba(109, 92, 255, 0.04);
  color: var(--share-text);
}

.share-publish-backdrop.is-light .share-publish-field textarea::placeholder {
  color: rgba(20, 20, 32, 0.35);
}

.share-publish-backdrop.is-light .share-publish-category-options button {
  border-color: rgba(28, 30, 43, 0.1);
  background: rgba(28, 30, 43, 0.03);
  color: rgba(20, 20, 32, 0.7);
}

.share-publish-backdrop.is-light .share-publish-category-options button.is-selected {
  color: #4f3dff;
  background: rgba(109, 92, 255, 0.1);
}

.share-publish-backdrop.is-light .share-publish-tip {
  border-color: rgba(109, 92, 255, 0.18);
  background: rgba(109, 92, 255, 0.07);
}

.share-publish-backdrop.is-light .share-publish-dialog > footer {
  background: rgba(109, 92, 255, 0.04);
  border-top-color: rgba(28, 30, 43, 0.08);
}

.share-publish-backdrop.is-light .share-publish-dialog > footer .is-secondary {
  border-color: rgba(28, 30, 43, 0.12);
  color: rgba(20, 20, 32, 0.72);
}

.share-publish-backdrop.is-light .share-publish-category-loading span {
  background: linear-gradient(110deg, #eff0f4 30%, #e2e3e9 50%, #eff0f4 70%);
  background-size: 220% 100%;
}
</style>
