<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  text: {
    type: String,
    default: '',
  },
  as: {
    type: String,
    default: 'div',
  },
  startDelay: {
    type: Number,
    default: 0,
  },
  delayStep: {
    type: Number,
    default: 0.03,
  },
  lineDelay: {
    type: Number,
    default: 0.1,
  },
})

const isVisible = ref(false)

const lines = computed(() =>
  String(props.text || '')
    .split('\n')
    .map((line) => Array.from(line || '')),
)

function charStyle(lineIndex, charIndex) {
  return {
    '--bit-split-delay': `${props.startDelay + lineIndex * props.lineDelay + charIndex * props.delayStep}s`,
  }
}

onMounted(() => {
  requestAnimationFrame(() => {
    isVisible.value = true
  })
})
</script>

<template>
  <component :is="as" class="bit-split-text" :class="{ 'is-visible': isVisible }">
    <span v-for="(line, lineIndex) in lines" :key="lineIndex" class="bit-split-line">
      <span
        v-for="(char, charIndex) in line"
        :key="`${lineIndex}-${charIndex}`"
        class="bit-split-char"
        :style="charStyle(lineIndex, charIndex)"
      >
        {{ char === ' ' ? '\u00a0' : char }}
      </span>
    </span>
  </component>
</template>

<style scoped>
.bit-split-text {
  display: inline-flex;
  flex-direction: column;
  gap: 0.08em;
}

.bit-split-line {
  display: inline-flex;
  flex-wrap: wrap;
}

.bit-split-char {
  display: inline-block;
  opacity: 0;
  transform: translate3d(0, 0.72em, 0) scale(0.96);
  filter: blur(10px);
  transition:
    opacity 0.7s ease,
    transform 0.7s cubic-bezier(0.2, 0.9, 0.2, 1),
    filter 0.7s ease;
  transition-delay: var(--bit-split-delay, 0s);
  will-change: transform, opacity, filter;
}

.bit-split-text.is-visible .bit-split-char {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  filter: blur(0);
}

@media (prefers-reduced-motion: reduce) {
  .bit-split-char {
    opacity: 1;
    transform: none;
    filter: none;
    transition: none;
  }
}
</style>
