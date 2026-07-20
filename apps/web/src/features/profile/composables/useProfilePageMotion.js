import { nextTick, onBeforeUnmount, watch } from 'vue'
import { gsap } from 'gsap'

function shouldReduceMotion() {
  if (typeof window === 'undefined') return true
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 个人中心动效：首屏入场、切 Tab、网格 stagger。
 * 对齐 Share 页；尊重 prefers-reduced-motion / settings-no-animations。
 */
export function useProfilePageMotion({ pageRef, ready }) {
  let ctx = null
  let sectionTween = null
  let introPlayed = false

  function reduced() {
    return shouldReduceMotion()
  }

  function clearInline(targets) {
    if (!targets?.length) return
    gsap.set(targets, { clearProps: 'opacity,transform,filter,visibility' })
  }

  function playIntro() {
    const root = pageRef?.value
    if (!root || introPlayed) return
    introPlayed = true
    root.classList.add('is-ready')

    const rail = root.querySelectorAll('[data-pf-rail]')
    const parts = root.querySelectorAll('[data-pf-motion]')
    const shots = root.querySelectorAll('[data-pf-shot]')
    const all = [...rail, ...parts, ...shots]

    if (reduced()) {
      clearInline(all)
      return
    }

    ctx?.revert()
    ctx = gsap.context(() => {
      if (rail.length) {
        gsap.fromTo(
          rail,
          { opacity: 0, x: -14 },
          {
            opacity: 1,
            x: 0,
            duration: 0.55,
            stagger: 0.05,
            ease: 'power3.out',
            clearProps: 'transform',
          },
        )
      }
      if (parts.length) {
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
            delay: 0.08,
            clearProps: 'filter,transform',
          },
        )
      }
      if (shots.length) {
        gsap.fromTo(
          shots,
          { opacity: 0, y: 12 },
          {
            opacity: 1,
            y: 0,
            duration: 0.36,
            stagger: 0.03,
            ease: 'power2.out',
            delay: 0.18,
            clearProps: 'transform',
          },
        )
      }
    }, root)
  }

  function playSection({ soft = false } = {}) {
    const root = pageRef?.value
    if (!root) return
    const body = root.querySelector('.profile-console__body')
    if (!body) return

    const parts = body.querySelectorAll('[data-pf-motion]')
    const shots = body.querySelectorAll('[data-pf-shot]')
    const cards = body.querySelectorAll(
      '.profile-continue__card, .profile-hub-stat, .profile-hub-service, .profile-hub-link, .activity-sample-grid > button, .recommendation-strip > button, .collections-craft__card, .profile-coloring-history__card, .activity-craft__row, .download-craft__row',
    )

    sectionTween?.kill()
    const targets = [...parts, ...shots, ...cards]
    if (!targets.length) return

    if (reduced()) {
      clearInline(targets)
      return
    }

    if (soft) {
      sectionTween = gsap.fromTo(
        targets,
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.22,
          stagger: 0.012,
          ease: 'power2.out',
          clearProps: 'transform',
        },
      )
      return
    }

    sectionTween = gsap.fromTo(
      targets,
      { opacity: 0, y: 16, filter: 'blur(3px)' },
      {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 0.42,
        stagger: 0.04,
        ease: 'power3.out',
        clearProps: 'filter,transform',
      },
    )
  }

  watch(
    () => ready?.value,
    async (isReady) => {
      if (!isReady) return
      await nextTick()
      playIntro()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    sectionTween?.kill()
    ctx?.revert()
    sectionTween = null
    ctx = null
  })

  return { playSection, playIntro }
}
