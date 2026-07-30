<script setup>
defineProps({
  items: { type: Array, default: () => [] },
})
</script>

<template>
  <div class="capability-loop" aria-label="创作能力">
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
.capability-loop {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.capability-loop::before,
.capability-loop::after {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 72px;
  content: '';
  pointer-events: none;
}

.capability-loop::before {
  left: 0;
  background: linear-gradient(90deg, #080a09, transparent);
}

.capability-loop::after {
  right: 0;
  background: linear-gradient(270deg, #080a09, transparent);
}

.capability-loop__track {
  display: flex;
  width: max-content;
  animation: capability-loop-slide 32s linear infinite;
  will-change: transform;
}

.capability-loop:hover .capability-loop__track {
  animation-play-state: paused;
}

.capability-loop ul {
  display: flex;
  flex: none;
  align-items: center;
  gap: 60px;
  min-width: max-content;
  margin: 0;
  padding: 0 26px;
  list-style: none;
}

.capability-loop li {
  display: grid;
  grid-template-columns: 30px auto;
  grid-template-rows: 20px 18px;
  align-items: center;
  min-width: 170px;
  color: #f1f3ef;
}

.capability-loop li > i {
  grid-row: 1 / 3;
  color: #73f4d0;
  font-size: 22px;
}

.capability-loop span {
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.capability-loop small {
  color: rgba(240, 243, 239, 0.48);
  font-size: 11px;
  line-height: 18px;
}

@keyframes capability-loop-slide {
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .capability-loop__track {
    animation: none;
    will-change: auto;
  }
}

:global(html.settings-no-animations) .capability-loop__track {
  animation: none;
  will-change: auto;
}
</style>
