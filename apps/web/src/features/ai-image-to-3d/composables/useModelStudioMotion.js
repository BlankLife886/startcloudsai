import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'

export function useModelStudioMotion({ rootRef, loading, modelPreviewUrl, previewLoading, error } = {}) {
  const prefersReducedMotion = ref(false)
  let context = null
  let mediaQuery = null
  let revealTween = null

  const readReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

  const scoped = (callback) => (context ? context.add(callback) : callback())

  const kill = () => {
    revealTween?.kill?.()
    revealTween = null
  }

  const entrance = () => {
    const root = rootRef?.value
    if (!root) return
    const items = root.querySelectorAll('[data-model-motion]')
    if (!items.length || prefersReducedMotion.value) {
      scoped(() => gsap.set(items, { clearProps: 'all', opacity: 1, y: 0 }))
      return
    }
    scoped(() => {
      gsap.fromTo(
        items,
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07, ease: 'power2.out', clearProps: 'transform' },
      )
    })
  }

  const syncLoading = (active) => {
    const root = rootRef?.value
    if (!root) return
    const viewport = root.querySelector('.model-studio-viewport')
    if (!viewport || prefersReducedMotion.value) return
    scoped(() => {
      gsap.to(viewport, {
        boxShadow: active
          ? '0 0 0 1px rgba(61, 232, 255, 0.2), 0 0 46px rgba(61, 232, 255, 0.12)'
          : '0 0 0 1px rgba(255, 255, 255, 0.02), 0 16px 38px rgba(0, 0, 0, 0.16)',
        duration: 0.45,
        ease: 'power2.out',
      })
    })
  }

  const revealResult = () => {
    const root = rootRef?.value
    const viewport = root?.querySelector('.model-studio-viewport')
    if (!viewport || !modelPreviewUrl?.value) return
    const target = viewport.querySelector('.model-viewport-canvas')
    if (!target || prefersReducedMotion.value) return
    kill()
    scoped(() => {
      revealTween = gsap.fromTo(
        target,
        { autoAlpha: 0, scale: 0.985 },
        { autoAlpha: 1, scale: 1, duration: 0.65, ease: 'power2.out', clearProps: 'transform' },
      )
    })
  }

  const onReducedMotionChange = (event) => {
    prefersReducedMotion.value = Boolean(event.matches)
    if (prefersReducedMotion.value) {
      kill()
      entrance()
    }
  }

  onMounted(() => {
    prefersReducedMotion.value = readReducedMotion()
    context = gsap.context(() => {}, rootRef?.value || undefined)
    if (typeof window !== 'undefined' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      mediaQuery.addEventListener?.('change', onReducedMotionChange)
    }
    entrance()
    watch(loading, syncLoading, { immediate: true })
    watch(modelPreviewUrl, (url, previous) => {
      if (url && url !== previous) revealResult()
    })
    watch(previewLoading, (active) => {
      if (!active && modelPreviewUrl?.value) revealResult()
    })
    watch(error, (value) => {
      if (!value) return
      const root = rootRef?.value
      const target = root?.querySelector('.model-viewport-error')
      if (!target || prefersReducedMotion.value) return
      scoped(() => gsap.fromTo(target, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.28, ease: 'power2.out' }))
    })
  })

  onBeforeUnmount(() => {
    kill()
    context?.revert?.()
    context = null
    mediaQuery?.removeEventListener?.('change', onReducedMotionChange)
  })

  return { prefersReducedMotion, entrance, revealResult, syncLoading }
}
