<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  as: {
    type: String,
    default: 'div',
  },
  interactive: {
    type: Boolean,
    default: true,
  },
  glow: {
    type: String,
    default: 'rgba(149, 255, 116, 0.22)',
  },
})

const cardEl = ref(null)
const spotlight = ref({ x: '50%', y: '50%', rotateX: '0deg', rotateY: '0deg' })

const spotlightStyle = computed(() => ({
  '--bit-spotlight-x': spotlight.value.x,
  '--bit-spotlight-y': spotlight.value.y,
  '--bit-spotlight-glow': props.glow,
  '--bit-spotlight-rotate-x': spotlight.value.rotateX,
  '--bit-spotlight-rotate-y': spotlight.value.rotateY,
}))

function handlePointerMove(event) {
  if (!props.interactive || !cardEl.value) return

  const rect = cardEl.value.getBoundingClientRect()
  const relativeX = event.clientX - rect.left
  const relativeY = event.clientY - rect.top
  const ratioX = rect.width > 0 ? relativeX / rect.width : 0.5
  const ratioY = rect.height > 0 ? relativeY / rect.height : 0.5

  spotlight.value = {
    x: `${Math.max(0, Math.min(100, ratioX * 100))}%`,
    y: `${Math.max(0, Math.min(100, ratioY * 100))}%`,
    rotateX: `${(0.5 - ratioY) * 6}deg`,
    rotateY: `${(ratioX - 0.5) * 8}deg`,
  }
}

function handlePointerLeave() {
  spotlight.value = {
    x: '50%',
    y: '50%',
    rotateX: '0deg',
    rotateY: '0deg',
  }
}
</script>

<template>
  <component
    :is="as"
    ref="cardEl"
    class="bit-spotlight-card"
    :class="{ 'is-interactive': interactive }"
    :style="spotlightStyle"
    @pointermove="handlePointerMove"
    @pointerleave="handlePointerLeave"
  >
    <slot />
  </component>
</template>

<style scoped>
.bit-spotlight-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02)),
    rgba(10, 14, 12, 0.78);
}

.bit-spotlight-card::before,
.bit-spotlight-card::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bit-spotlight-card::before {
  background: radial-gradient(
    circle at var(--bit-spotlight-x, 50%) var(--bit-spotlight-y, 50%),
    var(--bit-spotlight-glow, rgba(149, 255, 116, 0.22)),
    transparent 42%
  );
  opacity: 0;
  transition: opacity 0.26s ease;
}

.bit-spotlight-card::after {
  inset: 1px;
  border-radius: inherit;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.bit-spotlight-card.is-interactive {
  transform: perspective(1100px) rotateX(var(--bit-spotlight-rotate-x, 0deg))
    rotateY(var(--bit-spotlight-rotate-y, 0deg));
  transform-style: preserve-3d;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;
}

.bit-spotlight-card.is-interactive:hover {
  border-color: rgba(149, 255, 116, 0.18);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
}

.bit-spotlight-card.is-interactive:hover::before {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .bit-spotlight-card,
  .bit-spotlight-card.is-interactive {
    transform: none !important;
    transition: none !important;
  }

  .bit-spotlight-card::before {
    display: none;
  }
}
</style>
