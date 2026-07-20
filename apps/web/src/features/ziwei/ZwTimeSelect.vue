<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [Number, String], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '择时' },
  variant: { type: String, default: 'cinematic' },
  allowEmpty: { type: Boolean, default: false },
  emptyLabel: { type: String, default: '不看流时' },
})

const emit = defineEmits(['update:modelValue'])

const root = ref(null)
const open = ref(false)
const menuStyle = ref({})

const selected = computed(() =>
  props.options.find((item) => item.value === Number(props.modelValue)),
)

const displayText = computed(() => {
  if (selected.value) {
    return props.variant === 'console'
      ? `${selected.value.label}时 · ${selected.value.range}`
      : `${selected.value.label} · ${selected.value.range}`
  }
  return props.placeholder
})

const isPlaceholder = computed(
  () => props.modelValue === '' || props.modelValue === null || props.modelValue === undefined,
)

function updateMenuPosition() {
  const trigger = root.value?.querySelector('.zw-time-select__trigger')
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - 12
  const spaceAbove = rect.top - 12
  const openUp = spaceBelow < 200 && spaceAbove > spaceBelow
  const maxH = Math.max(160, Math.min(320, openUp ? spaceAbove : spaceBelow))
  menuStyle.value = {
    top: openUp ? `${rect.top - maxH - 8}px` : `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${maxH}px`,
  }
}

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function pick(value) {
  emit('update:modelValue', value)
  close()
}

function onDocumentPointer(event) {
  if (!root.value?.contains(event.target)) close()
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

watch(open, async (next) => {
  if (!next) return
  await nextTick()
  updateMenuPosition()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer)
  window.addEventListener('resize', updateMenuPosition)
  window.addEventListener('scroll', updateMenuPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer)
  window.removeEventListener('resize', updateMenuPosition)
  window.removeEventListener('scroll', updateMenuPosition, true)
})
</script>

<template>
  <div
    ref="root"
    class="zw-time-select"
    :class="[`zw-time-select--${variant}`, { 'is-open': open, 'is-placeholder': isPlaceholder }]"
  >
    <button
      type="button"
      class="zw-time-select__trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="zw-time-select__value">{{ displayText }}</span>
      <span class="zw-time-select__chev" aria-hidden="true">▾</span>
    </button>

    <Teleport to="body">
      <Transition name="zw-time-select-menu">
        <div
          v-if="open"
          class="zw-time-select__menu"
          :class="`zw-time-select__menu--${variant}`"
          :style="menuStyle"
          role="listbox"
        >
          <button
            v-if="allowEmpty"
            type="button"
            class="zw-time-select__option"
            :class="{ 'is-active': isPlaceholder }"
            role="option"
            :aria-selected="isPlaceholder"
            @click="pick('')"
          >
            <span class="zw-time-select__option-label">{{ emptyLabel }}</span>
          </button>
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="zw-time-select__option"
            :class="{ 'is-active': Number(modelValue) === option.value }"
            role="option"
            :aria-selected="Number(modelValue) === option.value"
            @click="pick(option.value)"
          >
            <span class="zw-time-select__option-label">{{ option.label }}</span>
            <span class="zw-time-select__option-range">{{ option.range }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style src="./zw-time-select.css"></style>
