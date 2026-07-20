<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  collection: {
    type: Object,
    default: null,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'save'])

const name = ref('')
const description = ref('')
const icon = ref('folder')
const nameError = ref('')
const isSubmitting = ref(false)
const nameInput = ref(null)

const availableIcons = [
  { value: 'folder', label: '文件夹' },
  { value: 'heart', label: '心形' },
  { value: 'star', label: '星星' },
  { value: 'bookmark', label: '书签' },
  { value: 'image', label: '图片' },
  { value: 'collection', label: '集合' },
  { value: 'palette', label: '调色板' },
  { value: 'camera', label: '相机' },
  { value: 'tag', label: '标签' },
]

watch(
  () => props.collection,
  (newCollection) => {
    if (newCollection) {
      name.value = newCollection.name || ''
      description.value = newCollection.description || ''
      icon.value = newCollection.icon || 'folder'
    } else {
      resetForm()
    }
  },
  { immediate: true },
)

watch(
  () => props.show,
  async (newShow) => {
    if (!newShow) {
      window.removeEventListener('keydown', onKeydown)
      return
    }

    if (!props.isEdit) resetForm()
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    nameInput.value?.focus?.()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

function resetForm() {
  name.value = ''
  description.value = ''
  icon.value = 'folder'
  nameError.value = ''
  isSubmitting.value = false
}

function validateForm() {
  nameError.value = ''
  if (!name.value.trim()) {
    nameError.value = '请输入集合名称'
    nameInput.value?.focus?.()
    return false
  }
  return true
}

function saveCollection() {
  if (!validateForm() || isSubmitting.value) return

  isSubmitting.value = true
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim(),
    icon: icon.value,
  })
  isSubmitting.value = false
  emit('close')
}

function closeModal() {
  emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="collection-modal">
      <div
        v-if="show"
        class="collection-modal-backdrop"
        @click="closeModal"
      >
        <div
          class="collection-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-modal-title"
          @click.stop
        >
          <header class="modal-header">
            <div class="modal-heading">
              <span class="modal-heading-icon" aria-hidden="true">
                <i class="bi" :class="isEdit ? 'bi-pencil-square' : 'bi-folder-plus'"></i>
              </span>
              <h5 id="collection-modal-title" class="modal-title">
                {{ isEdit ? '编辑集合' : '创建新集合' }}
              </h5>
            </div>
            <button type="button" class="modal-close" title="关闭" @click="closeModal">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="modal-body">
            <form class="collection-form" @submit.prevent="saveCollection">
              <div class="form-block">
                <label for="collection-name" class="form-label">集合名称</label>
                <input
                  id="collection-name"
                  ref="nameInput"
                  v-model="name"
                  type="text"
                  class="form-control"
                  :class="{ 'is-invalid': nameError }"
                  placeholder="输入集合名称"
                  maxlength="50"
                  required
                  autocomplete="off"
                />
                <div v-if="nameError" class="invalid-feedback">{{ nameError }}</div>
                <small class="form-meta">
                  <span>必填，最多 50 个字符</span>
                  <span>{{ name.length }}/50</span>
                </small>
              </div>

              <div class="form-block">
                <label for="collection-description" class="form-label">描述（可选）</label>
                <textarea
                  id="collection-description"
                  v-model="description"
                  class="form-control form-control--area"
                  placeholder="输入集合描述"
                  rows="3"
                  maxlength="160"
                ></textarea>
                <small class="form-meta justify-end">
                  <span>{{ description.length }}/160</span>
                </small>
              </div>

              <div class="form-block">
                <label class="form-label">图标</label>
                <div class="icon-selector" role="listbox" aria-label="选择集合图标">
                  <button
                    v-for="iconOption in availableIcons"
                    :key="iconOption.value"
                    type="button"
                    class="icon-option"
                    :class="{ selected: icon === iconOption.value }"
                    role="option"
                    :aria-selected="icon === iconOption.value"
                    :title="iconOption.label"
                    @click="icon = iconOption.value"
                  >
                    <i class="bi" :class="`bi-${iconOption.value}`"></i>
                    <span class="icon-label">{{ iconOption.label }}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          <footer class="modal-footer">
            <button type="button" class="modal-btn ghost" @click="closeModal">取消</button>
            <button
              type="button"
              class="modal-btn primary"
              :disabled="isSubmitting"
              @click="saveCollection"
            >
              {{ isEdit ? '更新' : '创建' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.collection-modal-backdrop {
  --cm-ink: #18203b;
  --cm-muted: #79809a;
  --cm-accent: #6a4fe0;
  --cm-active: #151a2d;
  --cm-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
  --cm-surface: #ffffff;
  --cm-field: rgba(21, 26, 45, 0.04);
  --cm-line: rgba(21, 26, 45, 0.12);

  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(12, 14, 22, 0.48);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.collection-modal {
  position: relative;
  width: min(520px, 100%);
  max-height: min(720px, calc(100dvh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 0;
  color: var(--cm-ink);
  background: var(--cm-surface);
  box-shadow:
    0 0 0 1px rgba(21, 26, 45, 0.1),
    8px 8px 0 rgba(106, 79, 224, 0.28);
  will-change: transform, opacity;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--cm-line);
}

.modal-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.modal-heading-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: #fff;
  background: var(--cm-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.7);
  font-size: 1rem;
}

.modal-title {
  margin: 0;
  color: var(--cm-ink);
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.03em;
}

.modal-close {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: none;
  border-radius: 0;
  color: var(--cm-muted);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--cm-line);
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.modal-close:hover {
  color: var(--cm-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
}

.modal-body {
  padding: 14px 16px 8px;
  overflow-y: auto;
}

.collection-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-block {
  margin: 0;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  color: var(--cm-ink);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.form-control {
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: none;
  border-radius: 0;
  color: var(--cm-ink) !important;
  background: var(--cm-field) !important;
  box-shadow: inset 0 0 0 1px var(--cm-line);
  caret-color: var(--cm-ink);
  font-size: 0.9rem;
  transition: box-shadow 0.16s ease, background 0.16s ease;
}

.form-control:focus {
  outline: none;
  background: rgba(106, 79, 224, 0.06) !important;
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.55);
}

.form-control::placeholder {
  color: var(--cm-muted) !important;
  opacity: 0.85;
}

.form-control--area {
  min-height: 88px;
  resize: vertical;
}

.form-control.is-invalid {
  box-shadow: inset 0 0 0 1px rgba(212, 90, 106, 0.65);
}

.invalid-feedback {
  display: block;
  margin-top: 6px;
  color: #c45d70;
  font-size: 0.78rem;
  font-weight: 650;
}

.form-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  color: var(--cm-muted);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
}

.form-meta.justify-end {
  justify-content: flex-end;
}

.icon-selector {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
}

.icon-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 72px;
  padding: 8px 6px;
  border: none;
  border-radius: 0;
  color: var(--cm-ink);
  background: var(--cm-field);
  box-shadow: inset 0 0 0 1px var(--cm-line);
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.icon-option:hover {
  color: var(--cm-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
}

.icon-option.selected {
  color: #fff;
  background: var(--cm-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.icon-option i {
  font-size: 1.2rem;
}

.icon-label {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--cm-line);
}

.modal-btn {
  min-width: 92px;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border: none;
  border-radius: 0;
  font-size: 0.86rem;
  font-weight: 750;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.modal-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.modal-btn.ghost {
  color: var(--cm-ink);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--cm-line);
}

.modal-btn.ghost:hover {
  color: var(--cm-accent);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.45);
}

.modal-btn.primary {
  color: #fff;
  background: var(--cm-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.modal-btn.primary:hover:not(:disabled) {
  background: #1f2740;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.85);
  transform: translate(-1px, -1px);
}

.modal-btn.primary:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.65);
}

/* 快且丝滑：遮罩淡入 + 面板短位移缩放 */
.collection-modal-enter-active,
.collection-modal-leave-active {
  transition: opacity 0.18s var(--cm-ease, cubic-bezier(0.22, 0.8, 0.24, 1));
}

.collection-modal-enter-active .collection-modal,
.collection-modal-leave-active .collection-modal {
  transition:
    opacity 0.2s var(--cm-ease, cubic-bezier(0.22, 0.8, 0.24, 1)),
    transform 0.2s var(--cm-ease, cubic-bezier(0.22, 0.8, 0.24, 1));
}

.collection-modal-enter-from,
.collection-modal-leave-to {
  opacity: 0;
}

.collection-modal-enter-from .collection-modal {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}

.collection-modal-leave-to .collection-modal {
  opacity: 0;
  transform: translateY(6px) scale(0.985);
}

@media (prefers-reduced-motion: reduce) {
  .collection-modal-enter-active,
  .collection-modal-leave-active,
  .collection-modal-enter-active .collection-modal,
  .collection-modal-leave-active .collection-modal {
    transition: none !important;
  }
}

html.settings-no-animations .collection-modal-enter-active,
html.settings-no-animations .collection-modal-leave-active,
html.settings-no-animations .collection-modal-enter-active .collection-modal,
html.settings-no-animations .collection-modal-leave-active .collection-modal {
  transition: none !important;
}

html.color-scheme-dark .collection-modal-backdrop {
  --cm-ink: #eceaf7;
  --cm-muted: #9a96b0;
  --cm-accent: #b5a3ff;
  --cm-active: #f0ecff;
  --cm-surface: #161824;
  --cm-field: rgba(255, 255, 255, 0.05);
  --cm-line: rgba(255, 255, 255, 0.12);
  background: rgba(4, 6, 12, 0.62);
}

html.color-scheme-dark .collection-modal {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    8px 8px 0 rgba(133, 104, 247, 0.28);
}

html.color-scheme-dark .modal-heading-icon {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 3px 3px 0 rgba(180, 160, 255, 0.5);
}

html.color-scheme-dark .icon-option.selected,
html.color-scheme-dark .modal-btn.primary {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 3px 3px 0 rgba(180, 160, 255, 0.5);
}

html.color-scheme-dark .modal-btn.primary:hover:not(:disabled) {
  background: #fff;
  box-shadow: 4px 4px 0 rgba(180, 160, 255, 0.62);
}

html.color-scheme-dark .invalid-feedback {
  color: #ff9aa6;
}

@media (max-width: 640px) {
  .collection-modal-backdrop {
    padding: 12px;
    align-items: flex-end;
  }

  .collection-modal {
    width: 100%;
    max-height: calc(100dvh - 24px);
  }

  .collection-modal-enter-from .collection-modal {
    transform: translateY(16px) scale(1);
  }

  .collection-modal-leave-to .collection-modal {
    transform: translateY(10px) scale(1);
  }

  .icon-selector {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
