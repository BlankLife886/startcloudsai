import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'

function shouldReduceMotion() {
  if (typeof window === 'undefined') return true
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Share 社区页动效：首屏入场、作品网格 stagger、详情弹层进出、收藏微反馈。
 * 尊重 prefers-reduced-motion 与 settings-no-animations。
 */
export function useSharePageMotion({
  pageRef,
  feedRef,
  detailRef,
  detailOpen,
  loading,
  items,
}) {
  const reduced = ref(true)
  let ctx = null
  let feedTween = null
  let detailTween = null
  let enterPlayed = false
  let feedPlayed = false
  let mediaQuery = null

  function syncReduced() {
    reduced.value = shouldReduceMotion()
  }

  function clearInline(targets) {
    if (!targets?.length) return
    gsap.set(targets, { clearProps: 'opacity,transform,filter,visibility' })
  }

  function playEnter() {
    const root = pageRef?.value
    if (!root || enterPlayed) return
    enterPlayed = true
    const parts = root.querySelectorAll('[data-share-motion]')
    if (!parts.length) return
    if (reduced.value) {
      clearInline(parts)
      return
    }
    ctx?.revert()
    ctx = gsap.context(() => {
      gsap.fromTo(
        parts,
        { opacity: 0, y: 18, filter: 'blur(4px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.62,
          stagger: 0.07,
          ease: 'power3.out',
          clearProps: 'filter,transform',
        },
      )
    }, root)
  }

  function playFeedStagger({ soft = false } = {}) {
    const feed = feedRef?.value
    if (!feed || loading?.value) return
    const cards = feed.querySelectorAll('.community-card:not(.is-skeleton)')
    if (!cards.length) return
    feedTween?.kill()
    if (reduced.value) {
      clearInline(cards)
      return
    }
    // 翻页/筛选：轻量同步淡入，避免长 stagger + scale 拖慢感知
    if (soft) {
      feedTween = gsap.fromTo(
        cards,
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.2,
          stagger: 0.008,
          ease: 'power2.out',
          clearProps: 'transform',
        },
      )
      return
    }
    feedTween = gsap.fromTo(
      cards,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.34,
        stagger: { each: 0.024, from: 'start' },
        ease: 'power2.out',
        clearProps: 'transform',
      },
    )
  }

  function playDetailEnter() {
    const el = detailRef?.value
    if (!el) return
    detailTween?.kill()
    const scrim = el.querySelector('.share-detail__scrim')
    const panel = el.querySelector('.share-detail__panel')
    if (reduced.value) {
      gsap.set([el, scrim, panel].filter(Boolean), { opacity: 1, clearProps: 'transform' })
      return
    }
    // 只动 opacity + translate，避免 scale + backdrop-filter 叠在一起掉帧
    if (panel) panel.style.willChange = 'transform, opacity'
    if (scrim) scrim.style.willChange = 'opacity'
    detailTween = gsap
      .timeline({
        defaults: { ease: 'power2.out' },
        onComplete: () => {
          if (panel) {
            panel.style.willChange = ''
            gsap.set(panel, { clearProps: 'transform' })
          }
          if (scrim) scrim.style.willChange = ''
        },
      })
      .fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.16 }, 0)
      .fromTo(
        panel,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.24 },
        0.02,
      )
  }

  async function playDetailLeave() {
    const el = detailRef?.value
    if (!el || reduced.value) return
    detailTween?.kill()
    const scrim = el.querySelector('.share-detail__scrim')
    const panel = el.querySelector('.share-detail__panel')
    if (panel) panel.style.willChange = 'transform, opacity'
    if (scrim) scrim.style.willChange = 'opacity'
    await new Promise((resolve) => {
      detailTween = gsap
        .timeline({
          defaults: { ease: 'power2.in' },
          onComplete: () => {
            if (panel) panel.style.willChange = ''
            if (scrim) scrim.style.willChange = ''
            resolve()
          },
        })
        .to(panel, { opacity: 0, y: 10, duration: 0.14 }, 0)
        .to(scrim, { opacity: 0, duration: 0.12 }, 0.02)
    })
  }

  function pulseFavorite(button) {
    if (!button || reduced.value) return
    gsap.fromTo(
      button,
      { scale: 1 },
      {
        scale: 1.18,
        duration: 0.16,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
        clearProps: 'transform',
      },
    )
  }

  watch(
    () => [loading?.value, items?.value?.length, items?.value?.[0]?.id],
    async ([isLoading]) => {
      if (isLoading) return
      await nextTick()
      const soft = feedPlayed
      feedPlayed = true
      playFeedStagger({ soft })
    },
  )

  watch(
    () => detailOpen?.value,
    async (open) => {
      if (!open) return
      await nextTick()
      playDetailEnter()
    },
  )

  onMounted(() => {
    syncReduced()
    if (typeof window !== 'undefined' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      mediaQuery.addEventListener?.('change', syncReduced)
    }
    nextTick(() => playEnter())
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener?.('change', syncReduced)
    feedTween?.kill()
    detailTween?.kill()
    ctx?.revert()
    feedTween = null
    detailTween = null
    ctx = null
  })

  return {
    playDetailLeave,
    pulseFavorite,
    reduced,
  }
}
