import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { gsap } from 'gsap'

export function useStudioMotion(rootRef, activeOutput) {
  let media = null

  onMounted(() => {
    if (!rootRef.value) return
    media = gsap.matchMedia()
    media.add(
      { reduceMotion: '(prefers-reduced-motion: reduce)', desktop: '(min-width: 901px)' },
      ({ conditions }) => {
        if (conditions.reduceMotion) return
        gsap.from('[data-studio-enter]', {
          autoAlpha: 0,
          y: conditions.desktop ? 22 : 12,
          duration: 0.72,
          ease: 'power3.out',
          stagger: 0.07,
          clearProps: 'transform,opacity,visibility',
        })
        const floatTargets = rootRef.value?.querySelectorAll('[data-studio-float]') || []
        if (floatTargets.length) {
          gsap.to(floatTargets, {
            y: -8,
            duration: 2.4,
            ease: 'sine.inOut',
            repeat: -1,
            yoyo: true,
          })
        }
      },
      rootRef.value,
    )
  })

  watch(activeOutput, async (value) => {
    if (!value || !rootRef.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    await nextTick()
    const target = rootRef.value.querySelector('[data-studio-output]')
    if (!target) return
    gsap.fromTo(
      target,
      { autoAlpha: 0, scale: 0.99 },
      { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'power2.out', overwrite: true },
    )
  })

  onBeforeUnmount(() => {
    if (rootRef.value) gsap.killTweensOf(rootRef.value.querySelectorAll('[data-studio-output]'))
    media?.revert()
  })
}
