<template>
  <div ref="containerRef" class="masonry-root relative w-full" :style="containerStyle">
    <div
      v-for="item in visibleGrid"
      :key="item.id"
      :data-key="item.id"
      class="absolute box-content"
      :style="{ willChange: 'transform, width, height, opacity' }"
      @click="openUrl(item.url)"
      @mouseenter="(e) => handleMouseEnter(item.id, e.currentTarget as HTMLElement)"
      @mouseleave="(e) => handleMouseLeave(item.id, e.currentTarget as HTMLElement)"
    >
      <img
        :src="item.img"
        :alt="item.id"
        class="block w-full h-full object-cover rounded-[10px] shadow-[0px_10px_50px_-10px_rgba(0,0,0,0.2)] uppercase text-[10px] leading-[10px]"
        loading="lazy"
        decoding="async"
        draggable="false"
      />
      <div class="absolute inset-0 rounded-[10px] pointer-events-none">
        <div
          v-if="colorShiftOnHover"
          class="color-overlay absolute inset-0 rounded-[10px] bg-gradient-to-tr from-pink-500/50 to-sky-500/50 opacity-0 pointer-events-none"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { gsap } from 'gsap'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watchEffect } from 'vue'

interface Item {
  id: string
  img: string
  url: string
  width: number
  height: number
}

interface MasonryProps {
  items: Item[]
  revealProgress?: number
  ease?: string
  duration?: number
  stagger?: number
  animateFrom?: 'bottom' | 'top' | 'left' | 'right' | 'center' | 'random'
  scaleOnHover?: boolean
  hoverScale?: number
  blurToFocus?: boolean
  colorShiftOnHover?: boolean
}

const props = withDefaults(defineProps<MasonryProps>(), {
  ease: 'power3.out',
  duration: 0.6,
  stagger: 0.05,
  animateFrom: 'bottom',
  scaleOnHover: true,
  hoverScale: 0.95,
  blurToFocus: true,
  colorShiftOnHover: false,
  revealProgress: 1,
})

const useMedia = (queries: string[], values: number[], defaultValue: number) => {
  const get = () => values[queries.findIndex((query) => matchMedia(query).matches)] ?? defaultValue
  const value = ref<number>(get())

  onMounted(() => {
    const handler = () => {
      value.value = get()
    }
    const mediaQueries = queries.map((query) => matchMedia(query))
    mediaQueries.forEach((mq) => mq.addEventListener('change', handler))

    onUnmounted(() => {
      mediaQueries.forEach((mq) => mq.removeEventListener('change', handler))
    })
  })

  return value
}

const useMeasure = () => {
  const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
  const size = ref({ width: 0, height: 0 })
  let resizeObserver: ResizeObserver | null = null

  onMounted(() => {
    if (!containerRef.value) return

    resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      size.value = { width, height }
    })

    resizeObserver.observe(containerRef.value)
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
  })

  return [containerRef, size] as const
}

const columns = useMedia(
  ['(min-width:1500px)', '(min-width:1000px)', '(min-width:600px)', '(min-width:400px)'],
  [6, 6, 6, 6],
  6,
)

const [containerRef, size] = useMeasure()
const hasMounted = ref(false)

const grid = computed(() => {
  if (!size.value.width) return []
  const colHeights = new Array(columns.value).fill(0)
  const gap = 16
  const totalGaps = (columns.value - 1) * gap
  const columnWidth = (size.value.width - totalGaps) / columns.value

  return props.items.map((child) => {
    const col = colHeights.indexOf(Math.min(...colHeights))
    const x = col * (columnWidth + gap)
    const aspectRatio = child.width > 0 && child.height > 0 ? child.height / child.width : 16 / 9
    const height = columnWidth * aspectRatio
    const y = colHeights[col]
    colHeights[col] += height + gap
    return { ...child, x, y, w: columnWidth, h: height }
  })
})

const visibleGrid = computed(() => {
  if (!grid.value.length) return []

  const progress = Math.min(Math.max(props.revealProgress, 0), 1)
  const sortedRows = [...new Set(grid.value.map((item) => item.y))].sort((a, b) => a - b)
  const visibleRowCount = Math.max(1, Math.ceil(sortedRows.length * progress))
  const maxVisibleY = sortedRows[Math.max(0, visibleRowCount - 1)]
  return grid.value.filter((item) => item.y <= maxVisibleY)
})

const containerStyle = computed(() => {
  if (!visibleGrid.value.length) {
    return { minHeight: '320px' }
  }

  const bottomEdge = Math.max(...visibleGrid.value.map((item) => item.y + item.h))
  return {
    height: `${Math.ceil(bottomEdge)}px`,
  }
})

const openUrl = (url: string) => {
  window.open(url, '_blank', 'noopener')
}

interface GridItem extends Item {
  x: number
  y: number
  w: number
  h: number
}

const getInitialPosition = (item: GridItem) => {
  const containerRect = containerRef.value?.getBoundingClientRect()
  if (!containerRect) return { x: item.x, y: item.y }

  let direction = props.animateFrom
  if (props.animateFrom === 'random') {
    const directions = ['top', 'bottom', 'left', 'right']
    direction = directions[
      Math.floor(Math.random() * directions.length)
    ] as MasonryProps['animateFrom']
  }

  switch (direction) {
    case 'top':
      return { x: item.x, y: -200 }
    case 'bottom':
      return { x: item.x, y: window.innerHeight + 200 }
    case 'left':
      return { x: -200, y: item.y }
    case 'right':
      return { x: window.innerWidth + 200, y: item.y }
    case 'center':
      return {
        x: containerRect.width / 2 - item.w / 2,
        y: containerRect.height / 2 - item.h / 2,
      }
    default:
      return { x: item.x, y: item.y + 100 }
  }
}

const handleMouseEnter = (id: string, element: HTMLElement) => {
  if (props.scaleOnHover) {
    gsap.to(`[data-key="${id}"]`, {
      scale: props.hoverScale,
      duration: 0.3,
      ease: 'power2.out',
    })
  }
  if (props.colorShiftOnHover) {
    const overlay = element.querySelector('.color-overlay') as HTMLElement | null
    if (overlay) gsap.to(overlay, { opacity: 0.3, duration: 0.3 })
  }
}

const handleMouseLeave = (id: string, element: HTMLElement) => {
  if (props.scaleOnHover) {
    gsap.to(`[data-key="${id}"]`, {
      scale: 1,
      duration: 0.3,
      ease: 'power2.out',
    })
  }
  if (props.colorShiftOnHover) {
    const overlay = element.querySelector('.color-overlay') as HTMLElement | null
    if (overlay) gsap.to(overlay, { opacity: 0, duration: 0.3 })
  }
}

watchEffect(() => {
  const currentGrid = visibleGrid.value
  void props.items.length
  void columns.value
  void size.value.width

  if (!currentGrid.length) return

  nextTick(() => {
    currentGrid.forEach((item, index) => {
      const selector = `[data-key="${item.id}"]`
      const animProps = { x: item.x, y: item.y, width: item.w, height: item.h }

      if (!hasMounted.value) {
        const start = getInitialPosition(item)
        gsap.fromTo(
          selector,
          {
            opacity: 0,
            x: start.x,
            y: start.y,
            width: item.w,
            height: item.h,
            ...(props.blurToFocus && { filter: 'blur(10px)' }),
          },
          {
            opacity: 1,
            ...animProps,
            ...(props.blurToFocus && { filter: 'blur(0px)' }),
            duration: props.duration,
            ease: props.ease,
            delay: index * props.stagger,
          },
        )
      } else {
        gsap.to(selector, {
          ...animProps,
          duration: props.duration,
          ease: props.ease,
          overwrite: 'auto',
        })
      }
    })

    hasMounted.value = true
  })
})
</script>
