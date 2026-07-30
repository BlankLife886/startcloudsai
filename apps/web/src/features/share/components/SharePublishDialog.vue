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
                <i class="bi bi-broadcast-pin"></i>
              </span>
              <div>
                <small>COMMUNITY</small>
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
              <input
                v-model="form.title"
                maxlength="120"
                autocomplete="off"
                placeholder="输入作品标题"
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

            <div class="share-publish-review">
              <i class="bi bi-shield-check" aria-hidden="true"></i>
              <span>
                <strong>提交审核</strong>
                <small>审核通过后将展示在社区画廊</small>
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
              <i class="bi" :class="submitting ? 'bi-arrow-repeat spin' : 'bi-send-check'"></i>
              {{ submitting ? '提交中…' : '提交审核' }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.share-publish-backdrop {
  --share-accent: var(--primary-color, #4caf50);
  --share-accent-rgb: var(--primary-color-rgb, 76, 175, 80);
  --share-page: var(--background-color, var(--bg-color, #07080a));
  --share-surface: var(--card-bg-color, #181a1d);
  --share-border: var(--border-color, #35383d);
  --share-text: var(--text-color, #f2f4f5);
  --share-muted: var(--text-muted-color, #959ba0);
  position: fixed;
  inset: 0;
  z-index: 12100;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in srgb, var(--share-page) 74%, transparent);
  backdrop-filter: blur(10px) saturate(0.9);
}

.share-publish-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--share-border) 78%, var(--share-text) 9%);
  border-radius: 12px;
  background: color-mix(in srgb, var(--share-surface) 94%, var(--share-page));
  color: var(--share-text);
  box-shadow:
    0 28px 80px color-mix(in srgb, var(--share-page) 78%, transparent),
    0 0 0 1px #ffffff05;
}

.share-publish-dialog > header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 13px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--share-border) 72%, transparent);
  background: color-mix(in srgb, var(--share-surface) 88%, var(--share-page));
}

.share-publish-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
}

.share-publish-heading-icon {
  display: grid;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgba(var(--share-accent-rgb), 0.22);
  border-radius: 8px;
  background: rgba(var(--share-accent-rgb), 0.09);
  color: var(--share-accent);
  font-size: 16px;
}

.share-publish-heading > div {
  min-width: 0;
}

.share-publish-heading small {
  display: block;
  margin-bottom: 2px;
  color: color-mix(in srgb, var(--share-accent) 72%, var(--share-muted));
  font: 700 9px/1.2 monospace;
  letter-spacing: 0;
}

.share-publish-heading h2 {
  margin: 0;
  color: var(--share-text);
  font-size: 17px;
  line-height: 1.25;
  letter-spacing: 0;
}

.share-publish-close {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--share-muted);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
}

.share-publish-close:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--share-border) 76%, var(--share-text) 8%);
  background: color-mix(in srgb, var(--share-surface) 80%, var(--share-text) 6%);
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
  padding: 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgba(var(--share-accent-rgb), 0.28) transparent;
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
  color: color-mix(in srgb, var(--share-text) 88%, var(--share-muted));
  font-size: 11px;
  font-weight: 650;
}

.share-publish-field small,
.share-publish-category small {
  color: var(--share-muted);
  font-size: 9px;
  font-weight: 500;
}

.share-publish-field input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--share-border) 84%, var(--share-text) 7%);
  border-radius: 8px;
  outline: none;
  background: color-mix(in srgb, var(--share-surface) 82%, var(--share-page));
  color: var(--share-text);
  font-size: 13px;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.share-publish-field input::placeholder {
  color: color-mix(in srgb, var(--share-muted) 66%, transparent);
}

.share-publish-field input:focus {
  border-color: rgba(var(--share-accent-rgb), 0.58);
  background: color-mix(in srgb, var(--share-surface) 90%, var(--share-accent) 3%);
  box-shadow: 0 0 0 3px rgba(var(--share-accent-rgb), 0.11);
}

.share-publish-category {
  display: grid;
  min-width: 0;
  gap: 9px;
  margin: 0;
  padding: 0;
  border: 0;
}

.share-publish-category legend {
  width: 100%;
  margin-bottom: 9px;
  padding: 0;
}

.share-publish-category-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.share-publish-category-options button {
  min-height: 32px;
  padding: 6px 11px;
  border: 1px solid color-mix(in srgb, var(--share-border) 84%, var(--share-text) 6%);
  border-radius: 7px;
  background: color-mix(in srgb, var(--share-surface) 84%, var(--share-page));
  color: color-mix(in srgb, var(--share-text) 68%, var(--share-muted));
  font-size: 10px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease,
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.share-publish-category-options button:hover {
  border-color: rgba(var(--share-accent-rgb), 0.38);
  color: var(--share-text);
  transform: translateY(-1px);
}

.share-publish-category-options button.is-selected {
  border-color: rgba(var(--share-accent-rgb), 0.5);
  background: rgba(var(--share-accent-rgb), 0.12);
  color: color-mix(in srgb, var(--share-accent) 56%, var(--share-text));
  box-shadow: inset 0 0 0 1px rgba(var(--share-accent-rgb), 0.06);
}

.share-publish-category-loading {
  display: flex;
  gap: 7px;
}

.share-publish-category-loading span {
  width: 62px;
  height: 32px;
  border-radius: 7px;
  background: linear-gradient(110deg, #ffffff08 30%, #ffffff12 50%, #ffffff08 70%);
  background-size: 220% 100%;
  animation: share-publish-shimmer 1.4s ease-in-out infinite;
}

.share-publish-review {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 15px;
  border-top: 1px solid color-mix(in srgb, var(--share-border) 66%, transparent);
}

.share-publish-review > i {
  color: color-mix(in srgb, var(--share-accent) 74%, var(--share-muted));
  font-size: 17px;
}

.share-publish-review > span {
  display: grid;
  gap: 2px;
}

.share-publish-review strong {
  color: color-mix(in srgb, var(--share-text) 84%, var(--share-muted));
  font-size: 11px;
}

.share-publish-review small {
  color: var(--share-muted);
  font-size: 9px;
}

.share-publish-dialog > footer {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 16px;
  border-top: 1px solid color-mix(in srgb, var(--share-border) 72%, transparent);
  background: color-mix(in srgb, var(--share-surface) 88%, var(--share-page));
}

.share-publish-dialog > footer button {
  min-width: 88px;
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.share-publish-dialog > footer .is-secondary {
  border: 1px solid color-mix(in srgb, var(--share-border) 80%, var(--share-text) 8%);
  background: transparent;
  color: color-mix(in srgb, var(--share-text) 72%, var(--share-muted));
}

.share-publish-dialog > footer .is-secondary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--share-surface) 80%, var(--share-text) 5%);
  color: var(--share-text);
}

.share-publish-dialog > footer .is-primary {
  border: 1px solid color-mix(in srgb, var(--share-accent) 82%, var(--share-text) 12%);
  background: var(--share-accent);
  color: color-mix(in srgb, var(--share-page) 88%, #000);
  box-shadow: 0 7px 18px rgba(var(--share-accent-rgb), 0.18);
}

.share-publish-dialog > footer .is-primary:hover:not(:disabled) {
  box-shadow: 0 9px 22px rgba(var(--share-accent-rgb), 0.25);
  transform: translateY(-1px);
}

.share-publish-dialog > footer button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.share-publish-dialog > footer i {
  margin-right: 6px;
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

@media (max-width: 560px) {
  .share-publish-backdrop {
    padding: 10px;
  }

  .share-publish-dialog {
    width: min(100%, 520px);
    max-height: calc(100vh - 20px);
  }

  .share-publish-dialog > header {
    padding: 12px 14px;
  }

  .share-publish-body {
    padding: 18px 16px;
  }

  .share-publish-dialog > footer {
    padding: 12px 14px;
  }

  .share-publish-dialog > footer button {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .share-publish-enter-active,
  .share-publish-leave-active,
  .share-publish-enter-active .share-publish-dialog,
  .share-publish-leave-active .share-publish-dialog,
  .share-publish-category-options button,
  .share-publish-category-loading span,
  .share-publish-dialog > footer button {
    transition: none;
    animation: none;
  }
}

.share-publish-backdrop.is-light {
  --share-page: #f3f4f8;
  --share-surface: #ffffff;
  --share-border: #dfe1e8;
  --share-text: #242531;
  --share-muted: #777a87;
  background: rgba(48, 49, 62, 0.3);
  color-scheme: light;
}

.share-publish-backdrop.is-light .share-publish-dialog {
  box-shadow: 0 26px 76px rgba(48, 44, 78, 0.2);
}

.share-publish-backdrop.is-light .share-publish-category-loading span {
  background: linear-gradient(110deg, #eff0f4 30%, #e2e3e9 50%, #eff0f4 70%);
  background-size: 220% 100%;
}
</style>
