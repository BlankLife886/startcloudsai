<template>
  <h2 ref="containerRef" :class="`scroll-float overflow-hidden ${containerClassName}`">
    <span
      :class="`scroll-float-text inline-block text-center leading-relaxed font-black ${textClassName}`"
    >
      <span v-for="(char, index) in splitText" :key="index" class="inline-block char">
        {{ char === ' ' ? '\u00A0' : char }}
      </span>
    </span>
  </h2>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

interface Props {
  children: string
  scrollContainerRef?: { current: HTMLElement | null }
  containerClassName?: string
  textClassName?: string
  animationDuration?: number
  ease?: string
  scrollStart?: string
  scrollEnd?: string
  stagger?: number
}

const props = withDefaults(defineProps<Props>(), {
  containerClassName: '',
  textClassName: '',
  animationDuration: 1,
  ease: 'back.inOut(2)',
  scrollStart: 'center bottom+=50%',
  scrollEnd: 'bottom bottom-=40%',
  stagger: 0.03,
})

const containerRef = useTemplateRef<HTMLElement>('containerRef')
let scrollTriggerInstance: ScrollTrigger | null = null

const splitText = computed(() => {
  const text = typeof props.children === 'string' ? props.children : ''
  return text.split('')
})

function initializeAnimation() {
  const el = containerRef.value
  if (!el) return

  const scroller = props.scrollContainerRef?.current || window
  const charElements = el.querySelectorAll('.char')

  if (scrollTriggerInstance) {
    scrollTriggerInstance.kill()
  }

  const tl = gsap.fromTo(
    charElements,
    {
      willChange: 'opacity, transform',
      opacity: 0,
      yPercent: 120,
      scaleY: 2.3,
      scaleX: 0.7,
      transformOrigin: '50% 0%',
    },
    {
      duration: props.animationDuration,
      ease: props.ease,
      opacity: 1,
      yPercent: 0,
      scaleY: 1,
      scaleX: 1,
      stagger: props.stagger,
      scrollTrigger: {
        trigger: el,
        scroller,
        start: props.scrollStart,
        end: props.scrollEnd,
        scrub: true,
      },
    },
  )

  scrollTriggerInstance = tl.scrollTrigger || null
}

onMounted(() => {
  initializeAnimation()
})

onUnmounted(() => {
  if (scrollTriggerInstance) {
    scrollTriggerInstance.kill()
  }
})

watch(
  [
    () => props.children,
    () => props.scrollContainerRef,
    () => props.animationDuration,
    () => props.ease,
    () => props.scrollStart,
    () => props.scrollEnd,
    () => props.stagger,
  ],
  () => {
    initializeAnimation()
  },
  { deep: true },
)
</script>

<style scoped>
.scroll-float {
  margin: 0;
  text-align: center;
}

.scroll-float-text {
  font-size: clamp(1.6rem, 8vw, 10rem);
  letter-spacing: 0;
}
</style>
