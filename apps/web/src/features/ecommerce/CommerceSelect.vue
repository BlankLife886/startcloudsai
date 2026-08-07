<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '请选择' },
  ariaLabel: { type: String, default: '选择选项' },
})

const emit = defineEmits(['update:modelValue', 'change'])
const triggerRef = ref(null)
const menuRef = ref(null)
const open = ref(false)
const activeIndex = ref(-1)
const menuStyle = ref({})

const normalizedOptions = computed(() =>
  props.options.map((option) =>
    option && typeof option === 'object'
      ? { value: option.value, label: String(option.label ?? option.value ?? '') }
      : { value: option, label: String(option ?? '') },
  ),
)
const selectedIndex = computed(() =>
  normalizedOptions.value.findIndex((option) => option.value === props.modelValue),
)
const selectedOption = computed(() => normalizedOptions.value[selectedIndex.value] || null)

function updatePosition() {
  if (!open.value || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const gap = 7
  const viewportPadding = 10
  const estimatedHeight = Math.min(normalizedOptions.value.length * 36 + 10, 264)
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
  const spaceAbove = rect.top - viewportPadding
  const placeAbove = spaceBelow < Math.min(estimatedHeight, 180) && spaceAbove > spaceBelow
  const maxHeight = Math.max(110, Math.min(264, placeAbove ? spaceAbove - gap : spaceBelow - gap))
  menuStyle.value = {
    left: `${Math.min(rect.left, window.innerWidth - rect.width - viewportPadding)}px`,
    top: placeAbove ? `${Math.max(viewportPadding, rect.top - Math.min(estimatedHeight, maxHeight) - gap)}px` : `${rect.bottom + gap}px`,
    width: `${rect.width}px`,
    maxHeight: `${maxHeight}px`,
    transformOrigin: placeAbove ? 'bottom center' : 'top center',
  }
}

async function openMenu() {
  if (props.disabled || !normalizedOptions.value.length) return
  open.value = true
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
  await nextTick()
  updatePosition()
  menuRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
}

function closeMenu({ focus = false } = {}) {
  if (!open.value) return
  open.value = false
  if (focus) nextTick(() => triggerRef.value?.focus())
}

function toggleMenu() {
  if (open.value) closeMenu()
  else openMenu()
}

function choose(option) {
  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeMenu({ focus: true })
}

function moveActive(delta) {
  const count = normalizedOptions.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  nextTick(() =>
    menuRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }),
  )
}

function onTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) openMenu()
    else moveActive(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (!open.value) openMenu()
    else if (activeIndex.value >= 0) choose(normalizedOptions.value[activeIndex.value])
    return
  }
  if (event.key === 'Escape') closeMenu({ focus: true })
}

function onMenuKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' && activeIndex.value >= 0) {
    event.preventDefault()
    choose(normalizedOptions.value[activeIndex.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu({ focus: true })
  }
}

function onDocumentPointerDown(event) {
  if (!open.value) return
  if (triggerRef.value?.contains(event.target) || menuRef.value?.contains(event.target)) return
  closeMenu()
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMenu()
  },
)

document.addEventListener('pointerdown', onDocumentPointerDown, true)
window.addEventListener('resize', updatePosition)
window.addEventListener('scroll', updatePosition, true)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="commerce-select-trigger"
    :class="{ 'is-open': open, 'is-placeholder': !selectedOption }"
    :disabled="disabled"
    :aria-label="ariaLabel"
    aria-haspopup="listbox"
    :aria-expanded="open"
    @click="toggleMenu"
    @keydown="onTriggerKeydown"
  >
    <span>{{ selectedOption?.label || placeholder }}</span>
    <i class="bi bi-chevron-down" aria-hidden="true"></i>
  </button>

  <Teleport to="body">
    <Transition name="commerce-select-pop">
      <div
        v-if="open"
        ref="menuRef"
        class="commerce-select-menu"
        :style="menuStyle"
        role="listbox"
        :aria-label="ariaLabel"
        tabindex="-1"
        @keydown="onMenuKeydown"
      >
        <button
          v-for="(option, index) in normalizedOptions"
          :key="`${String(option.value)}-${index}`"
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          :class="{ selected: option.value === modelValue, active: index === activeIndex }"
          :data-active="index === activeIndex"
          @mouseenter="activeIndex = index"
          @click="choose(option)"
        >
          <span>{{ option.label }}</span>
          <i v-if="option.value === modelValue" class="bi bi-check2" aria-hidden="true"></i>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.commerce-select-trigger {
  display: grid;
  width: 100%;
  height: 36px;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 16px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  color: var(--commerce-ink, #151a2d);
  background: var(--commerce-soft, #f4f4f8);
  border: 1px solid transparent;
  border-radius: 9px;
  outline: none;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
    background 180ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}
.commerce-select-trigger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--commerce-soft, #f4f4f8) 72%, var(--commerce-panel, #fff));
  border-color: var(--commerce-line, #e4e3ec);
}
.commerce-select-trigger:focus-visible,
.commerce-select-trigger.is-open {
  border-color: var(--commerce-accent-line, #d9d1ff);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--commerce-accent, #6a4fe0) 11%, transparent);
}
.commerce-select-trigger:active:not(:disabled) {
  transform: scale(0.985);
}
.commerce-select-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
.commerce-select-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commerce-select-trigger > i {
  color: var(--commerce-muted, #79809a);
  font-size: 10px;
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.commerce-select-trigger.is-open > i {
  transform: rotate(180deg);
}
.commerce-select-menu {
  position: fixed;
  z-index: 5000;
  padding: 5px;
  overflow-y: auto;
  color: #151a2d;
  background: rgb(255 255 255 / 98%);
  border: 1px solid #e4e3ec;
  border-radius: 11px;
  box-shadow: 0 18px 48px rgb(31 26 61 / 18%);
  outline: none;
  backdrop-filter: blur(18px);
}
.commerce-select-menu button {
  display: grid;
  width: 100%;
  min-height: 34px;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 7px;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.commerce-select-menu button.active {
  background: #f4f2ff;
}
.commerce-select-menu button.selected {
  color: #563cc8;
  font-weight: 750;
}
.commerce-select-menu button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commerce-select-menu button i {
  justify-self: center;
  color: #6a4fe0;
}
.commerce-select-pop-enter-active,
.commerce-select-pop-leave-active {
  transition:
    opacity 170ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.commerce-select-pop-enter-from,
.commerce-select-pop-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.975);
}
:global(html.color-scheme-dark) .commerce-select-menu {
  color: #f1f1f5;
  background: rgb(28 28 34 / 98%);
  border-color: #3a3943;
  box-shadow: 0 20px 54px rgb(0 0 0 / 48%);
}
:global(html.color-scheme-dark) .commerce-select-menu button.active {
  background: #302944;
}
:global(html.color-scheme-dark) .commerce-select-menu button.selected {
  color: #c8bcff;
}
@media (prefers-reduced-motion: reduce) {
  .commerce-select-trigger,
  .commerce-select-trigger > i,
  .commerce-select-pop-enter-active,
  .commerce-select-pop-leave-active {
    transition-duration: 1ms;
  }
}
</style>
