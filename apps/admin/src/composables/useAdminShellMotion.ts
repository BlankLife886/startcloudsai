import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue'
import gsap from 'gsap'

const ASIDE_EXPANDED = 252
const ASIDE_COLLAPSED = 78

gsap.defaults({
  ease: 'power2.out',
  force3D: true,
  overwrite: 'auto',
})

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type QuickTo = (value: number) => gsap.core.Tween

type ItemMotion = {
  xTo: QuickTo
  scaleTo: QuickTo
  iconScaleTo: QuickTo | null
  hovering: boolean
  pressing: boolean
}

/**
 * 管理端壳层 GSAP 动效（平滑 / 性能优先）。
 * 侧栏 hover / 按压用 quickTo，只动 transform。
 */
export function useAdminShellMotion(opts: {
  root: Ref<HTMLElement | null>
  aside: Ref<HTMLElement | null>
  content: Ref<HTMLElement | null>
  collapsed: Ref<boolean>
  routePath: Ref<string>
}) {
  let ctx: gsap.Context | undefined
  let sidebarTween: gsap.core.Tween | undefined
  let pageTween: gsap.core.Tween | undefined
  let unbindSidebarPointer: (() => void) | undefined

  const itemMotion = new WeakMap<HTMLElement, ItemMotion>()

  function setAsideWidth(width: number, animate: boolean) {
    const aside = opts.aside.value
    if (!aside) return

    sidebarTween?.kill()
    if (!animate || prefersReducedMotion()) {
      gsap.set(aside, { width, clearProps: 'willChange' })
      return
    }

    aside.style.willChange = 'width'
    sidebarTween = gsap.to(aside, {
      width,
      duration: 0.32,
      ease: 'power2.inOut',
      onComplete: () => {
        aside.style.willChange = ''
        sidebarTween = undefined
      },
    })
  }

  function ensureItemMotion(el: HTMLElement): ItemMotion {
    let motion = itemMotion.get(el)
    if (motion) return motion

    gsap.set(el, { transformOrigin: '50% 50%' })
    const icon = el.querySelector<HTMLElement>('.nav-item__icon')
    if (icon) gsap.set(icon, { transformOrigin: '50% 50%' })

    motion = {
      xTo: gsap.quickTo(el, 'x', { duration: 0.22, ease: 'power2.out' }),
      scaleTo: gsap.quickTo(el, 'scale', { duration: 0.2, ease: 'power2.out' }),
      iconScaleTo: icon
        ? gsap.quickTo(icon, 'scale', { duration: 0.2, ease: 'power2.out' })
        : null,
      hovering: false,
      pressing: false,
    }
    itemMotion.set(el, motion)
    return motion
  }

  function applyItemRest(el: HTMLElement) {
    const motion = ensureItemMotion(el)
    const active = el.classList.contains('is-active')
    const collapsed = Boolean(
      opts.aside.value?.classList.contains('is-collapsed'),
    )
    const hoverX = collapsed ? 1 : 3
    if (motion.pressing) {
      motion.scaleTo(active ? 0.985 : 0.97)
      motion.xTo(active ? 0 : collapsed ? 0 : 1)
      motion.iconScaleTo?.(0.96)
      return
    }
    if (motion.hovering) {
      motion.scaleTo(active ? 1.015 : 1.02)
      motion.xTo(active ? 0 : hoverX)
      motion.iconScaleTo?.(1.1)
      return
    }
    motion.scaleTo(1)
    motion.xTo(0)
    motion.iconScaleTo?.(1)
  }

  function bindSidebarPointer(aside: HTMLElement) {
    if (prefersReducedMotion()) return () => undefined

    const interactive = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null
      return target.closest<HTMLElement>('.nav-item, .sidebar-toggle')
    }

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const el = interactive(event.target)
      const from = interactive(event.relatedTarget)
      if (!el || el === from) return
      const motion = ensureItemMotion(el)
      motion.hovering = true
      applyItemRest(el)
    }

    const onOut = (event: PointerEvent) => {
      const el = interactive(event.target)
      const to = interactive(event.relatedTarget)
      if (!el || el === to) return
      const motion = ensureItemMotion(el)
      motion.hovering = false
      motion.pressing = false
      applyItemRest(el)
    }

    const onDown = (event: PointerEvent) => {
      const el = interactive(event.target)
      if (!el) return
      const motion = ensureItemMotion(el)
      motion.pressing = true
      applyItemRest(el)
    }

    const onUp = (event: PointerEvent) => {
      const el = interactive(event.target)
      if (!el) return
      const motion = ensureItemMotion(el)
      motion.pressing = false
      // 轻弹一下再回到 hover/rest
      motion.scaleTo(motion.hovering ? 1.03 : 1.02)
      requestAnimationFrame(() => applyItemRest(el))
    }

    const onCancel = (event: PointerEvent) => {
      const el = interactive(event.target)
      if (!el) return
      const motion = ensureItemMotion(el)
      motion.pressing = false
      applyItemRest(el)
    }

    aside.addEventListener('pointerover', onOver)
    aside.addEventListener('pointerout', onOut)
    aside.addEventListener('pointerdown', onDown)
    aside.addEventListener('pointerup', onUp)
    aside.addEventListener('pointercancel', onCancel)

    return () => {
      aside.removeEventListener('pointerover', onOver)
      aside.removeEventListener('pointerout', onOut)
      aside.removeEventListener('pointerdown', onDown)
      aside.removeEventListener('pointerup', onUp)
      aside.removeEventListener('pointercancel', onCancel)
    }
  }

  onMounted(() => {
    const root = opts.root.value
    const aside = opts.aside.value
    if (!root) return

    setAsideWidth(
      opts.collapsed.value ? ASIDE_COLLAPSED : ASIDE_EXPANDED,
      false,
    )

    if (aside) unbindSidebarPointer = bindSidebarPointer(aside)

    if (prefersReducedMotion()) return

    ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: 'power2.out', force3D: true },
      })

      tl.from('.logo, .page-title', { autoAlpha: 0, y: -6, duration: 0.28 }, 0)
        .from(
          '.topbar-actions > *',
          {
            autoAlpha: 0,
            y: -6,
            duration: 0.26,
            stagger: 0.04,
            clearProps: 'transform',
          },
          0.04,
        )
        .from(
          '.nav-item',
          {
            autoAlpha: 0,
            x: -6,
            duration: 0.26,
            stagger: 0.018,
            clearProps: 'transform',
          },
          0.06,
        )
        .from('.aside-footer', { autoAlpha: 0, y: 6, duration: 0.24 }, 0.12)
    }, root)
  })

  onUnmounted(() => {
    unbindSidebarPointer?.()
    sidebarTween?.kill()
    pageTween?.kill()
    ctx?.revert()
  })

  function animateSidebar(collapsed: boolean) {
    setAsideWidth(collapsed ? ASIDE_COLLAPSED : ASIDE_EXPANDED, true)
  }

  async function animatePageEnter() {
    const el = opts.content.value
    if (!el || prefersReducedMotion()) return
    await nextTick()

    pageTween?.kill()
    el.style.willChange = 'transform, opacity'
    pageTween = gsap.fromTo(
      el,
      { autoAlpha: 0, y: 8 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.28,
        ease: 'power2.out',
        onComplete: () => {
          el.style.willChange = ''
          gsap.set(el, { clearProps: 'transform' })
          pageTween = undefined
        },
      },
    )
  }

  /** 顶栏等非侧栏按钮的轻量点击反馈 */
  function pulse(target: EventTarget | null) {
    const el =
      target instanceof Element
        ? target.closest<HTMLElement>('button, a')
        : null
    if (!el || prefersReducedMotion()) return

    const scaleTo = gsap.quickTo(el, 'scale', {
      duration: 0.2,
      ease: 'power2.out',
    })
    gsap.set(el, { transformOrigin: '50% 50%' })
    scaleTo(0.96)
    requestAnimationFrame(() => scaleTo(1))
  }

  watch(
    () => opts.routePath.value,
    () => {
      void animatePageEnter()
    },
  )

  return { animateSidebar, animatePageEnter, pulse }
}
