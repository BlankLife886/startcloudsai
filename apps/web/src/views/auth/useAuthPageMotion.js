import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'

function shouldReduceMotion() {
  if (typeof window === 'undefined') return true
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 登录页进场：漫画分格 → 白三角 → 顶栏/文案 → 登录卡片
 */
export function useAuthPageMotion(pageRef) {
  let ctx = null
  let played = false

  function playIntro() {
    const root = pageRef?.value
    if (!root || played) return
    played = true

    const panels = root.querySelectorAll('.auth-manga__panel')
    const split = root.querySelector('.auth-split-white')
    const topbar = root.querySelectorAll('[data-auth-top]')
    const hero = root.querySelectorAll('[data-auth-hero]')
    const features = root.querySelectorAll('[data-auth-feature]')
    const card = root.querySelector('[data-auth-card]')
    const all = [...panels, split, ...topbar, ...hero, ...features, card].filter(Boolean)

    if (shouldReduceMotion()) {
      gsap.set(all, { clearProps: 'opacity,transform,filter,clipPath' })
      root.classList.add('is-ready')
      return
    }

    ctx?.revert()
    ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onStart: () => root.classList.add('is-ready'),
      })

      if (panels.length) {
        gsap.set(panels, { opacity: 0, scale: 1.04 })
        tl.to(
          panels,
          {
            opacity: 1,
            scale: 1,
            duration: 0.7,
            stagger: 0.07,
            ease: 'power2.out',
            clearProps: 'transform',
          },
          0,
        )
      }

      if (split) {
        gsap.set(split, { opacity: 0, xPercent: -12 })
        tl.to(
          split,
          {
            opacity: 1,
            xPercent: 0,
            duration: 0.65,
            ease: 'power3.out',
            clearProps: 'transform',
          },
          0.12,
        )
      }

      if (topbar.length) {
        gsap.set(topbar, { opacity: 0, y: -12 })
        tl.to(
          topbar,
          {
            opacity: 1,
            y: 0,
            duration: 0.45,
            stagger: 0.06,
            clearProps: 'transform',
          },
          0.28,
        )
      }

      if (hero.length) {
        gsap.set(hero, { opacity: 0, y: 18, filter: 'blur(6px)' })
        tl.to(
          hero,
          {
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: 0.58,
            stagger: 0.06,
            clearProps: 'filter,transform',
          },
          0.34,
        )
      }

      if (features.length) {
        gsap.set(features, { opacity: 0, x: -10 })
        tl.to(
          features,
          {
            opacity: 1,
            x: 0,
            duration: 0.42,
            stagger: 0.05,
            clearProps: 'transform',
          },
          0.48,
        )
      }

      if (card) {
        gsap.set(card, { opacity: 0, y: 28, scale: 0.97 })
        tl.to(
          card,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.62,
            ease: 'power3.out',
            clearProps: 'transform',
          },
          0.4,
        )
      }
    }, root)
  }

  onMounted(() => {
    nextTick(() => playIntro())
  })

  onBeforeUnmount(() => {
    ctx?.revert()
    ctx = null
  })
}
