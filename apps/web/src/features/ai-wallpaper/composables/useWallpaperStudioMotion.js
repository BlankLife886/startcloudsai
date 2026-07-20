import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'

/**
 * 壁纸工坊动效：入场 / 生成呼吸 / 出图揭示 / 时间线 stagger
 * 尊重 prefers-reduced-motion。
 */
export function useWallpaperStudioMotion({
  shellRef,
  stageRef,
  timelineRef,
  isRunning,
  resultRevealing,
  onRevealComplete,
} = {}) {
  const prefersReducedMotion = ref(false)
  let enterTween = null
  let breatheTween = null
  let revealTween = null
  let mediaQuery = null
  let context = null

  function readReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function killTweens() {
    enterTween?.kill?.()
    breatheTween?.kill?.()
    revealTween?.kill?.()
    enterTween = null
    breatheTween = null
    revealTween = null
  }

  function scoped(callback) {
    if (context) return context.add(callback)
    return callback()
  }

  function playEnter() {
    const root = shellRef?.value
    if (!root || prefersReducedMotion.value) {
      if (root) scoped(() => gsap.set(root.querySelectorAll('[data-motion]'), { clearProps: 'all', opacity: 1, y: 0 }))
      return
    }
    const parts = root.querySelectorAll('[data-motion]')
    if (!parts.length) return
    enterTween?.kill?.()
    scoped(() => {
      enterTween = gsap.fromTo(
        parts,
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: 0.55,
          stagger: 0.06,
          ease: 'power2.out',
          clearProps: 'transform',
        },
      )
    })
  }

  function syncBreathe(running) {
    const stage = stageRef?.value
    if (!stage) return
    breatheTween?.kill?.()
    breatheTween = null
    // Do not animate the whole stage: it changes the containing block for
    // images and the fixed prompt dock, making the page appear to jump or
    // stretch while a request is running. The status dot already communicates
    // progress without moving the layout.
    scoped(() => gsap.set(stage, { clearProps: 'boxShadow,filter,transform' }))
  }

  function playReveal() {
    const stage = stageRef?.value
    if (!stage) {
      onRevealComplete?.()
      return
    }
    const nextMedia = stage.querySelector('[data-reveal-target]')
    const holdover = stage.querySelector('[data-reveal-holdover]')
    revealTween?.kill?.()

    if (prefersReducedMotion.value || !nextMedia) {
      scoped(() => {
        if (holdover) gsap.set(holdover, { opacity: 0 })
        if (nextMedia) gsap.set(nextMedia, { opacity: 1, clearProps: 'clipPath' })
      })
      onRevealComplete?.()
      return
    }

    scoped(() => {
      const tl = gsap.timeline({
        onComplete: () => {
          onRevealComplete?.()
        },
      })
      if (holdover) {
        tl.fromTo(holdover, { opacity: 1 }, { opacity: 0, duration: 0.45, ease: 'power1.out' }, 0)
      }
      tl.fromTo(
        nextMedia,
        { opacity: 0.35, clipPath: 'inset(8% 8% 8% 8%)' },
        { opacity: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.62, ease: 'power2.out' },
        0,
      )
      revealTween = tl
    })
  }

  function playTimelineStagger() {
    const rail = timelineRef?.value
    if (!rail || prefersReducedMotion.value) return
    const items = rail.querySelectorAll('[data-timeline-item]')
    if (!items.length) return
    // This function is called after every polling update. Replaying a stagger
    // on all existing cards made completed results repeatedly jump. Keep the
    // cards stable; CSS handles the small hover transition.
    scoped(() => gsap.set(items, { clearProps: 'opacity,transform' }))
  }

  function onReducedMotionChange(event) {
    prefersReducedMotion.value = Boolean(event.matches)
    if (prefersReducedMotion.value) killTweens()
  }

  onMounted(() => {
    prefersReducedMotion.value = readReducedMotion()
    context = gsap.context(() => {}, shellRef?.value || undefined)
    if (typeof window !== 'undefined' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      mediaQuery.addEventListener?.('change', onReducedMotionChange)
    }
    playEnter()
    watch(isRunning, (running) => syncBreathe(running), { immediate: true })
    watch(resultRevealing, (revealing) => {
      if (revealing) playReveal()
    })
  })

  onBeforeUnmount(() => {
    killTweens()
    context?.revert?.()
    context = null
    mediaQuery?.removeEventListener?.('change', onReducedMotionChange)
  })

  return {
    prefersReducedMotion,
    playEnter,
    playReveal,
    playTimelineStagger,
    syncBreathe,
  }
}
