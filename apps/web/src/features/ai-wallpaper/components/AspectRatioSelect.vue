<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '比例' },
  placeholder: { type: String, default: '请选择' },
  showRatioIcons: { type: Boolean, default: true },
  useOptionLabel: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const triggerRef = ref(null)
const menuRef = ref(null)
const menuStyle = ref({})

const selectedOption = computed(
  () => props.options.find((option) => option.value === props.modelValue) || null,
)

function optionText(option) {
  if (!option) return ''
  return String(props.useOptionLabel ? option.label || option.value : option.value)
}

const selectedLabel = computed(
  () => optionText(selectedOption.value) || String(props.modelValue || '') || props.placeholder,
)

function ratioNumbers(value) {
  const [rawWidth, rawHeight] = String(value || '')
    .split(':')
    .map(Number)
  return {
    width: Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1,
    height: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1,
  }
}

function ratioIconClass(value) {
  const { width, height } = ratioNumbers(value)
  if (width === height) return 'is-square'
  return width > height ? 'is-landscape' : 'is-portrait'
}

function ratioIconStyle(value) {
  const { width, height } = ratioNumbers(value)
  return { aspectRatio: `${width} / ${height}` }
}

function updateMenuPosition() {
  const trigger = triggerRef.value
  if (!trigger || typeof window === 'undefined') return

  const rect = trigger.getBoundingClientRect()
  const viewportPadding = 12
  const menuWidth = Math.max(184, rect.width)
  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding),
  )
  const availableHeight = Math.max(96, rect.top - viewportPadding - 10)

  menuStyle.value = {
    left: `${Math.round(left)}px`,
    bottom: `${Math.round(window.innerHeight - rect.top + 8)}px`,
    width: `${Math.round(menuWidth)}px`,
    maxHeight: `${Math.min(360, Math.round(availableHeight))}px`,
  }
}

async function toggleMenu() {
  if (open.value) {
    open.value = false
    return
  }

  updateMenuPosition()
  open.value = true
  await nextTick()
  menuRef.value
    ?.querySelector('[aria-selected="true"]')
    ?.scrollIntoView({ block: 'nearest' })
}

function selectOption(value) {
  emit('update:modelValue', value)
  open.value = false
  nextTick(() => triggerRef.value?.focus())
}

function onDocumentPointerDown(event) {
  if (!open.value) return
  if (triggerRef.value?.contains(event.target) || menuRef.value?.contains(event.target)) return
  open.value = false
}

function onDocumentKeydown(event) {
  if (!open.value || event.key !== 'Escape') return
  event.preventDefault()
  open.value = false
  triggerRef.value?.focus()
}

function onViewportChange() {
  if (open.value) updateMenuPosition()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('resize', onViewportChange, { passive: true })
  window.addEventListener('scroll', onViewportChange, { passive: true, capture: true })
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})

watch(
  () => props.options.length,
  () => {
    if (open.value) nextTick(updateMenuPosition)
  },
)
</script>

<template>
  <div class="ratio-select" :class="{ 'is-open': open }">
    <button
      ref="triggerRef"
      type="button"
      class="ratio-select__trigger"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleMenu"
    >
      <span class="ratio-select__value">{{ selectedLabel }}</span>
      <i class="bi bi-chevron-down" aria-hidden="true"></i>
    </button>

    <Teleport to="body">
      <Transition name="ratio-popover">
        <div
          v-if="open"
          ref="menuRef"
          class="ratio-select__menu"
          :class="{ 'is-plain': !showRatioIcons }"
          :style="menuStyle"
          role="listbox"
          :aria-label="ariaLabel"
        >
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="ratio-select__option"
            :class="{
              'is-selected': option.value === modelValue,
              'has-icon': !showRatioIcons && option.icon,
            }"
            role="option"
            :aria-selected="option.value === modelValue"
            @click="selectOption(option.value)"
          >
            <span v-if="showRatioIcons" class="ratio-select__icon" aria-hidden="true">
              <span
                :class="ratioIconClass(option.value)"
                :style="ratioIconStyle(option.value)"
              ></span>
            </span>
            <i
              v-else-if="option.icon"
              class="ratio-select__option-glyph bi"
              :class="option.icon"
              aria-hidden="true"
            ></i>
            <span>{{ optionText(option) }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ratio-select {
  position: relative;
  min-width: 0;
}

.ratio-select__trigger {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: #1a1a22;
  color: rgba(255, 255, 255, 0.96);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.ratio-select__trigger:hover {
  border-color: rgba(255, 255, 255, 0.18);
}

.ratio-select__trigger:focus-visible,
.ratio-select.is-open .ratio-select__trigger {
  border-color: #6d5cff;
  box-shadow: 0 0 0 3px rgba(109, 92, 255, 0.22);
  background: #17171e;
}

.ratio-select__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ratio-select__trigger i {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.8rem;
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ratio-select.is-open .ratio-select__trigger i {
  transform: rotate(180deg);
}

.ratio-select__menu {
  position: fixed;
  z-index: 1300;
  display: grid;
  gap: 2px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: #242429;
  box-shadow: 0 22px 55px rgba(0, 0, 0, 0.5);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
  scrollbar-width: thin;
  transform-origin: bottom left;
}

.ratio-select__menu::-webkit-scrollbar {
  width: 6px;
}

.ratio-select__menu::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.ratio-select__option {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  font: inherit;
  font-size: 1rem;
  text-align: left;
  cursor: pointer;
  transition:
    color 140ms ease,
    background-color 140ms ease;
}

.ratio-select__menu.is-plain .ratio-select__option {
  grid-template-columns: minmax(0, 1fr);
  min-height: 42px;
  padding-inline: 12px;
}

.ratio-select__menu.is-plain .ratio-select__option.has-icon {
  grid-template-columns: 24px minmax(0, 1fr);
}

.ratio-select__option-glyph {
  color: rgba(139, 123, 255, 0.92);
  font-size: 1rem;
  text-align: center;
}

.ratio-select__option:hover,
.ratio-select__option:focus-visible {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
  outline: none;
}

.ratio-select__option.is-selected {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}

.ratio-select__icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
}

.ratio-select__icon > span {
  display: block;
  border: 2px solid currentColor;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.92);
}

.ratio-select__icon > .is-square {
  width: 22px;
  height: 22px;
}

.ratio-select__icon > .is-landscape {
  width: 24px;
  height: auto;
}

.ratio-select__icon > .is-portrait {
  width: auto;
  height: 24px;
}

.ratio-popover-enter-active,
.ratio-popover-leave-active {
  transition:
    opacity 210ms ease,
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ratio-popover-enter-from,
.ratio-popover-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .ratio-select__trigger,
  .ratio-select__trigger i,
  .ratio-select__option,
  .ratio-popover-enter-active,
  .ratio-popover-leave-active {
    transition: none;
  }
}
</style>
