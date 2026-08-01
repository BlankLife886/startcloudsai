<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({ items: { type: Array, default: () => [] } })

const rootRef = ref(null)
const paused = ref(false)
let observer = null

function setPaused(value) {
  paused.value = value
}

function onVisibilityChange() {
  setPaused(document.hidden)
}

onMounted(() => {
  observer = new IntersectionObserver(([entry]) => setPaused(!(entry?.isIntersecting ?? false)), { rootMargin: '80px 0px', threshold: 0 })
  if (rootRef.value) observer.observe(rootRef.value)
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div
    ref="rootRef"
    class="capability-loop"
    :class="{ 'is-paused': paused }"
    role="region"
    aria-label="创作能力"
  >
    <div class="capability-loop__track">
      <ul v-for="copy in 2" :key="copy" :aria-hidden="copy === 2 ? 'true' : undefined">
        <li v-for="item in items" :key="`${copy}-${item.label}`">
          <i :class="item.icon" aria-hidden="true"></i>
          <span>{{ item.label }}</span>
          <small>{{ item.detail }}</small>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.capability-loop { position: relative; width: 100%; overflow: hidden; }
.capability-loop::before,
.capability-loop::after { position: absolute; top: 0; bottom: 0; z-index: 2; width: 56px; content: ''; pointer-events: none; }
.capability-loop::before { left: 0; background: linear-gradient(90deg, #080a09, transparent); }
.capability-loop::after { right: 0; background: linear-gradient(270deg, #080a09, transparent); }
.capability-loop__track { display: flex; width: max-content; animation: capability-loop-slide 38s linear infinite; will-change: transform; }
.capability-loop:hover .capability-loop__track,
.capability-loop:focus-within .capability-loop__track,
.capability-loop.is-paused .capability-loop__track { animation-play-state: paused; }
.capability-loop ul { display: flex; flex: none; align-items: center; gap: 50px; min-width: max-content; margin: 0; padding: 0 24px; list-style: none; }
.capability-loop li { display: grid; grid-template-columns: 30px auto; grid-template-rows: 21px 19px; align-items: center; min-width: 166px; color: #f1f3ef; }
.capability-loop li > i { grid-row: 1 / 3; color: #73f4d0; font-size: 22px; }
.capability-loop span { font-size: 14px; font-weight: 600; line-height: 21px; }
.capability-loop small { color: rgba(240, 243, 239, 0.62); font-size: 12px; line-height: 19px; }
@keyframes capability-loop-slide { to { transform: translate3d(-50%, 0, 0); } }

@media (max-width: 760px) {
  .capability-loop::before,
  .capability-loop::after { width: 32px; }
  .capability-loop ul { gap: 36px; padding-inline: 18px; }
  .capability-loop li { min-width: 150px; }
}

@media (prefers-reduced-motion: reduce) {
  .capability-loop { overflow-x: auto; scrollbar-width: none; }
  .capability-loop::-webkit-scrollbar { display: none; }
  .capability-loop::before,
  .capability-loop::after { display: none; }
  .capability-loop__track { width: 100%; animation: none; will-change: auto; }
  .capability-loop ul { width: 100%; min-width: 0; flex-wrap: wrap; justify-content: center; padding-block: 14px; }
  .capability-loop ul[aria-hidden='true'] { display: none; }
}

:global(html.settings-no-animations) .capability-loop { overflow-x: auto; }
:global(html.settings-no-animations) .capability-loop::before,
:global(html.settings-no-animations) .capability-loop::after { display: none; }
:global(html.settings-no-animations) .capability-loop__track { width: 100%; animation: none; will-change: auto; }
:global(html.settings-no-animations) .capability-loop ul { width: 100%; min-width: 0; flex-wrap: wrap; justify-content: center; padding-block: 14px; }
:global(html.settings-no-animations) .capability-loop ul[aria-hidden='true'] { display: none; }
</style>
