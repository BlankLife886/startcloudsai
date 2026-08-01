<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useLocaleStore } from '@/stores/locale'

const localeStore = useLocaleStore()
const open = ref(false)
const rootEl = ref(null)
const triggerEl = ref(null)

const current = computed(() => localeStore.option)

function close() {
  open.value = false
}

function toggle() {
  open.value = !open.value
}

function selectLocale(value) {
  localeStore.setLocale(value)
  close()
  nextTick(() => triggerEl.value?.focus())
}

function onDocumentPointerDown(event) {
  if (!open.value || !rootEl.value) return
  if (!rootEl.value.contains(event.target)) close()
}

function onKeydown(event) {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    triggerEl.value?.focus()
    return
  }

  const options = localeStore.options
  const index = options.findIndex((item) => item.value === localeStore.locale)
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const next = options[(index + 1) % options.length]
    localeStore.setLocale(next.value)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    const prev = options[(index - 1 + options.length) % options.length]
    localeStore.setLocale(prev.value)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    close()
  }
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="locale-switcher" :class="{ 'is-open': open }">
    <button
      ref="triggerEl"
      type="button"
      class="locale-switcher__trigger"
      title="语言 / Language / 語言"
      aria-label="语言 / Language / 語言"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="locale-switcher__face" aria-hidden="true">{{ current.short }}</span>
    </button>

    <Transition name="locale-menu">
      <ul
        v-if="open"
        class="locale-switcher__menu"
        role="listbox"
        aria-label="语言 / Language / 語言"
      >
        <li
          v-for="option in localeStore.options"
          :key="option.value"
          role="option"
          class="locale-switcher__option"
          :class="{ 'is-active': option.value === localeStore.locale }"
          :aria-selected="option.value === localeStore.locale"
          tabindex="-1"
          @click="selectLocale(option.value)"
        >
          <span class="locale-switcher__badge">{{ option.short }}</span>
          <span class="locale-switcher__label">{{ option.label }}</span>
          <i
            class="bi bi-check2 locale-switcher__check"
            :class="{ 'is-visible': option.value === localeStore.locale }"
            aria-hidden="true"
          ></i>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.locale-switcher {
  --locale-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
  --locale-accent: var(--nav-accent, #6d5cff);
  --locale-ink: var(--nav-heading, #17171f);
  --locale-muted: var(--nav-muted, #777785);
  --locale-text: var(--nav-text, #444451);
  --locale-line: var(--nav-line, rgba(21, 22, 31, 0.09));
  --locale-soft: var(--nav-accent-soft, rgba(109, 92, 255, 0.1));
  --locale-hover: var(--nav-hover, rgba(21, 22, 31, 0.055));
  --locale-panel: var(--nav-bg-solid, #ffffff);
  --locale-sans: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', system-ui,
    sans-serif;

  position: relative;
  flex: 0 0 auto;
  z-index: 20;
}

.locale-switcher__trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(242, 247, 255, 0.42);
  border-radius: 50%;
  color: #ffffff;
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.42), transparent 42%),
    linear-gradient(150deg, #8b7bff 0%, #6d5cff 48%, #5646e8 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -3px 6px rgba(49, 29, 162, 0.28),
    0 4px 10px rgba(91, 77, 255, 0.34),
    0 1px 2px rgba(28, 24, 58, 0.18);
  cursor: pointer;
  transition:
    transform 180ms var(--locale-ease),
    box-shadow 180ms var(--locale-ease),
    filter 180ms var(--locale-ease);
}

.locale-switcher__trigger::before {
  position: absolute;
  inset: 2px;
  z-index: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 120%, rgba(255, 255, 255, 0.16), transparent 55%);
  content: '';
  pointer-events: none;
}

.locale-switcher__trigger:hover,
.locale-switcher.is-open .locale-switcher__trigger {
  transform: scale(1.04);
  filter: saturate(1.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.68),
    inset 0 -3px 6px rgba(49, 29, 162, 0.22),
    0 8px 18px rgba(91, 77, 255, 0.42),
    0 0 0 3px rgba(109, 92, 255, 0.16);
}

.locale-switcher__trigger:active {
  transform: scale(0.96);
  box-shadow:
    inset 0 2px 5px rgba(45, 27, 151, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 3px 8px rgba(91, 77, 255, 0.28);
}

.locale-switcher__trigger:focus-visible {
  outline: 2px solid #9a7bff;
  outline-offset: 3px;
}

.locale-switcher__face {
  position: relative;
  z-index: 1;
  display: block;
  font-family: var(--locale-sans);
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1;
  text-shadow: 0 1px 1px rgba(40, 28, 120, 0.28);
}

.locale-switcher__menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 168px;
  margin: 0;
  padding: 5px;
  list-style: none;
  border: 1px solid var(--locale-line);
  border-radius: 14px;
  background: var(--locale-panel);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.65) inset,
    0 14px 36px rgba(28, 24, 58, 0.12);
  transform-origin: top right;
}

.locale-switcher__option {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 16px;
  align-items: center;
  column-gap: 8px;
  min-height: 34px;
  padding: 0 8px;
  border-radius: 9px;
  color: var(--locale-text);
  font-family: var(--locale-sans);
  cursor: pointer;
  transition:
    background 140ms var(--locale-ease),
    color 140ms var(--locale-ease);
}

.locale-switcher__option:hover {
  color: var(--locale-ink);
  background: var(--locale-hover);
}

.locale-switcher__option.is-active {
  color: var(--locale-ink);
  background: var(--locale-soft);
}

.locale-switcher__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 22px;
  border-radius: 7px;
  color: var(--locale-muted);
  background: color-mix(in srgb, var(--locale-muted) 10%, transparent);
  font-family: var(--locale-sans);
  font-size: 11px;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1;
}

.locale-switcher__option.is-active .locale-switcher__badge {
  color: var(--locale-accent);
  background: color-mix(in srgb, var(--locale-accent) 14%, transparent);
}

.locale-switcher__label {
  overflow: hidden;
  font-size: 13px;
  font-weight: 620;
  letter-spacing: 0;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.locale-switcher__check {
  justify-self: end;
  color: var(--locale-accent);
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transform: scale(0.86);
  transition:
    opacity 140ms var(--locale-ease),
    transform 140ms var(--locale-ease);
}

.locale-switcher__check.is-visible {
  opacity: 1;
  transform: scale(1);
}

.locale-menu-enter-active,
.locale-menu-leave-active {
  transition:
    opacity 160ms var(--locale-ease),
    transform 200ms var(--locale-ease);
}

.locale-menu-enter-from,
.locale-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.locale-menu-enter-to,
.locale-menu-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.msheet-header-actions .locale-switcher {
  --locale-ink: var(--ms-heading, var(--nav-heading));
  --locale-line: var(--ms-line, var(--nav-line));
  --locale-panel: var(--ms-card, var(--nav-bg-solid));
  --locale-soft: var(--ms-soft, var(--nav-accent-soft));
}

.msheet-header-actions .locale-switcher__menu {
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16);
}

@media (prefers-reduced-motion: reduce) {
  .locale-switcher__trigger,
  .locale-switcher__chevron,
  .locale-switcher__option,
  .locale-switcher__check,
  .locale-menu-enter-active,
  .locale-menu-leave-active {
    transition: none;
  }
}
</style>
