import {
  animate,
  cancelAnimations,
  createScope,
  createTimeline,
  ms,
  prefersReducedMotion,
  set,
  ANIME_EASE_ENTER,
  ANIME_EASE_EXIT,
  ANIME_EASE_OVERSHOOT,
  ANIME_EASE_SMOOTH,
  stagger,
} from '@/lib/anime'

export {
  ANIME_EASE_ENTER as PC_EASE_ENTER,
  ANIME_EASE_EXIT as PC_EASE_EXIT,
  ANIME_EASE_OVERSHOOT as PC_EASE_OVERSHOOT,
} from '@/lib/anime'

const STAGGER_MS = 60
const SECTION_BLOCK_SELECTOR = [
  'article',
  '.pc-overview-stats > *',
  '.pc-overview-panel',
  '.pc-card',
  '.pc-sub-plans__main-tabs',
  '.pc-sub-plans__toggle',
  '.pc-sub-plans__grid > *',
  '.pc-models-grid > *',
  '.pc-keys-section > article',
  '.pc-keys-section > .pc-card',
  '.pc-usage > article',
  '.pc-wallet-premium',
  '.pc-wallet-grid > *',
  '.pc-referrals > article',
  '.pc-settings-grid > *',
  '.pc-docs-wrap > *',
].join(', ')

const CTA_SELECTOR = [
  '.pc-section-actions .pc-btn',
  '.pc-sub-plan__cta',
  '.pc-btn--primary',
  '.pc-sidenav-wallet__recharge',
].join(', ')

const SIDENAV_HOVER_SELECTOR = '.pc-sidenav-link, .pc-sidenav-foot-link'

function asTargetList(targets) {
  if (!targets) return []
  return Array.isArray(targets) ? targets.filter(Boolean) : [targets]
}

function collectSectionBlocks(section) {
  if (!section) return []
  const nodes = [...section.querySelectorAll(SECTION_BLOCK_SELECTOR)]
  const seen = new Set()
  return nodes.filter((node) => {
    if (seen.has(node)) return false
    seen.add(node)
    return true
  })
}

/** 在首帧前锁定起始态，避免 v-if 切换后闪一下（GSAP from 的等价做法） */
function prepareFadeUp(targets, fromY = 24, extra = {}) {
  const list = asTargetList(targets)
  if (!list.length) return
  cancelAnimations(list)
  set(list, { opacity: 0, translateY: fromY, ...extra })
}

function timelineFadeUp(timeline, targets, options = {}, position = 0) {
  const list = asTargetList(targets)
  if (!list.length) return
  prepareFadeUp(list, options.fromY ?? 24, options.prepareExtra ?? {})
  timeline.add(
    list,
    {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: options.duration ?? 320,
      delay: options.stagger ? stagger(options.stagger) : 0,
      ease: options.ease ?? ANIME_EASE_ENTER,
    },
    position,
  )
}

function animateSectionBlocks(timeline, section, position = 0) {
  const blocks = collectSectionBlocks(section)
  if (blocks.length) {
    timelineFadeUp(
      timeline,
      blocks,
      { fromY: 24, duration: 320, stagger: STAGGER_MS },
      position,
    )
  }

  const ctas = [...section.querySelectorAll(CTA_SELECTOR)]
  if (ctas.length) {
    prepareFadeUp(ctas, 8, { scale: 0.98 })
    timeline.add(
      ctas,
      {
        opacity: { to: 1 },
        translateY: { to: 0 },
        scale: { to: 1 },
        duration: 220,
        delay: stagger(50),
        ease: ANIME_EASE_OVERSHOOT,
      },
      position + ms(0.1),
    )
  }
}

export function createPricingMotion(rootRef) {
  let scope = null
  let introPlayed = false
  let activeTimeline = null
  let pressTarget = null
  let pressAnimation = null
  let sidenavHoveredLink = null
  let sidebarEl = null

  function root() {
    return rootRef.value || null
  }

  function stopTimeline() {
    if (!activeTimeline) return
    try {
      activeTimeline.revert()
    } catch {
      activeTimeline.cancel()
    }
    activeTimeline = null
  }

  function getSidenavHoverParts(link) {
    const iconWrap = link.querySelector('.pc-sidenav-link__icon')
    const iconGlyph = iconWrap?.querySelector('i') || link.querySelector('i')
    const label = link.querySelector('.pc-sidenav-link__label') || link.querySelector('span:not(.pc-sidenav-link__badge)')
    const badge = link.querySelector('.pc-sidenav-link__badge')
    return { iconWrap, iconGlyph, label, badge }
  }

  function resetSidenavHover(link, immediate = false) {
    if (!link) return
    const { iconWrap, iconGlyph, label, badge } = getSidenavHoverParts(link)
    const targets = [iconWrap, iconGlyph, label, badge].filter(Boolean)
    cancelAnimations(targets)

    const duration = immediate ? 0 : 200
    const ease = ANIME_EASE_SMOOTH
    if (iconWrap) {
      animate(iconWrap, { scale: { to: 1 }, translateY: { to: 0 }, duration, ease })
    }
    if (iconGlyph) {
      animate(iconGlyph, { translateX: { to: 0 }, rotate: { to: 0 }, duration, ease })
    }
    if (label) {
      animate(label, { translateX: { to: 0 }, opacity: { to: 1 }, duration, ease })
    }
    if (badge) {
      animate(badge, { scale: { to: 1 }, duration, ease })
    }
  }

  function playSidenavHoverIn(link) {
    if (!link || prefersReducedMotion()) return
    const isActive = link.classList.contains('is-active')
    const { iconWrap, iconGlyph, label, badge } = getSidenavHoverParts(link)
    const targets = [iconWrap, iconGlyph, label, badge].filter(Boolean)
    cancelAnimations(targets)

    if (iconWrap) {
      animate(iconWrap, {
        scale: { to: isActive ? 1.04 : 1.08 },
        translateY: { to: -1 },
        duration: 280,
        ease: ANIME_EASE_OVERSHOOT,
      })
    }

    if (iconGlyph) {
      animate(iconGlyph, {
        translateX: { to: 1 },
        rotate: { to: isActive ? 0 : -6 },
        duration: 260,
        ease: ANIME_EASE_OVERSHOOT,
      })
    }

    if (label) {
      animate(label, {
        translateX: { to: isActive ? 1 : 2 },
        opacity: { to: 1 },
        duration: 240,
        ease: ANIME_EASE_SMOOTH,
      })
    }

    if (badge) {
      animate(badge, {
        scale: { to: 1.08 },
        duration: 220,
        ease: ANIME_EASE_OVERSHOOT,
      })
    }
  }

  function onSidebarMouseOver(event) {
    if (prefersReducedMotion()) return
    const link = event.target.closest?.(SIDENAV_HOVER_SELECTOR)
    if (!link || !sidebarEl?.contains(link) || link === sidenavHoveredLink) return
    if (sidenavHoveredLink) resetSidenavHover(sidenavHoveredLink)
    sidenavHoveredLink = link
    playSidenavHoverIn(link)
  }

  function onSidebarMouseOut(event) {
    const link = event.target.closest?.(SIDENAV_HOVER_SELECTOR)
    if (!link || link !== sidenavHoveredLink) return
    const related = event.relatedTarget
    if (related && link.contains(related)) return
    resetSidenavHover(link)
    sidenavHoveredLink = null
  }

  function onPointerDown(event) {
    const el = event.target.closest?.(
      '.pc-btn, .pc-sidenav-link, .pc-sub-plan__cta, .pc-sub-plans__main-tab, .pc-mobile-nav button, .pc-sidenav-foot-link',
    )
    if (!el || el.disabled) return
    pressTarget = el
    pressAnimation?.cancel()
    pressAnimation = animate(el, {
      scale: { to: 0.97 },
      duration: 120,
      ease: ANIME_EASE_EXIT,
    })
  }

  function onPointerUp() {
    if (!pressTarget) return
    pressAnimation?.cancel()
    pressAnimation = animate(pressTarget, {
      scale: { to: 1 },
      duration: 180,
      ease: ANIME_EASE_OVERSHOOT,
    })
    pressTarget = null
  }

  return {
    mount() {
      const el = root()
      if (!el || prefersReducedMotion()) return
      scope?.revert()
      scope = createScope({ root: el })
      el.addEventListener('pointerdown', onPointerDown)
      el.addEventListener('pointerup', onPointerUp)
      el.addEventListener('pointercancel', onPointerUp)

      sidebarEl = el.querySelector('.pc-sidebar')
      sidebarEl?.addEventListener('mouseover', onSidebarMouseOver)
      sidebarEl?.addEventListener('mouseout', onSidebarMouseOut)
    },

    playPageIntro(options = {}) {
      const el = root()
      if (!el || introPlayed) return
      introPlayed = true

      if (prefersReducedMotion()) {
        el.classList.add('pricing-page--ready')
        return
      }

      const fromBoot = Boolean(options.fromBoot)

      stopTimeline()
      const sidebar = el.querySelector('.pc-sidebar')
      const mobileNav = el.querySelector('.pc-mobile-nav')
      const heading = el.querySelector('.pc-section-heading')
      const actions = el.querySelector('.pc-section-actions')
      const section = el.querySelector('.pc-section')

      const tl = createTimeline({
        defaults: { ease: ANIME_EASE_ENTER },
        onComplete: () => el.classList.add('pricing-page--ready'),
      })
      activeTimeline = tl

      if (!fromBoot) {
        if (sidebar) {
          prepareFadeUp(sidebar, 0, { translateX: -20 })
          tl.add(
            sidebar,
            {
              opacity: { to: 1 },
              translateX: { to: 0 },
              duration: 520,
            },
            0,
          )
        }
        if (mobileNav) {
          prepareFadeUp(mobileNav, -12)
          tl.add(
            mobileNav,
            {
              opacity: { to: 1 },
              translateY: { to: 0 },
              duration: 300,
            },
            ms(0.06),
          )
        }
      }

      const headingStart = fromBoot ? 0 : ms(0.14)
      const actionsStart = fromBoot ? ms(0.04) : ms(0.22)
      const sectionStart = fromBoot ? 0 : ms(0.2)
      const blocksStart = fromBoot ? ms(0.06) : ms(0.28)

      if (heading) {
        timelineFadeUp(
          tl,
          heading,
          {
            fromY: fromBoot ? 10 : 22,
            duration: fromBoot ? 240 : 360,
          },
          headingStart,
        )
      }
      if (actions) {
        timelineFadeUp(
          tl,
          actions,
          {
            fromY: fromBoot ? 8 : 16,
            duration: fromBoot ? 200 : 280,
          },
          actionsStart,
        )
      }
      if (section) {
        if (fromBoot) {
          prepareFadeUp(section, 0)
          tl.add(section, { opacity: { to: 1 }, duration: 260 }, sectionStart)
          const blocks = collectSectionBlocks(section)
          if (blocks.length) {
            timelineFadeUp(
              tl,
              blocks,
              { fromY: 10, duration: 220, stagger: 40 },
              blocksStart,
            )
          }
        } else {
          prepareFadeUp(section, 18)
          tl.add(
            section,
            {
              opacity: { to: 1 },
              translateY: { to: 0 },
              duration: 300,
            },
            sectionStart,
          )
          animateSectionBlocks(tl, section, blocksStart)
        }
      } else {
        el.classList.add('pricing-page--ready')
      }
    },

    playSectionTransition(options = {}) {
      const el = root()
      if (!el || prefersReducedMotion()) {
        options.onPrepared?.()
        return
      }

      stopTimeline()

      const heading = el.querySelector('.pc-section-heading')
      const section = el.querySelector('.pc-section')
      if (!section) {
        options.onPrepared?.()
        return
      }

      const blocks = collectSectionBlocks(section)
      const ctas = [...section.querySelectorAll(CTA_SELECTOR)]

      // 先用 inline 锁定起始态，再解除 CSS pending，避免切换 tab 时闪一帧
      prepareFadeUp(section, 20)
      if (heading) prepareFadeUp(heading, 16)
      if (blocks.length) prepareFadeUp(blocks, 24)
      if (ctas.length) prepareFadeUp(ctas, 8, { scale: 0.98 })
      options.onPrepared?.()

      const tl = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
      activeTimeline = tl

      tl.add(
        section,
        {
          opacity: { to: 1 },
          translateY: { to: 0 },
          duration: 280,
        },
        0,
      )

      if (heading) {
        tl.add(
          heading,
          {
            opacity: { to: 1 },
            translateY: { to: 0 },
            duration: 300,
          },
          ms(0.04),
        )
      }

      if (blocks.length) {
        tl.add(
          blocks,
          {
            opacity: { to: 1 },
            translateY: { to: 0 },
            duration: 320,
            delay: stagger(STAGGER_MS),
          },
          ms(0.08),
        )
      }

      if (ctas.length) {
        tl.add(
          ctas,
          {
            opacity: { to: 1 },
            translateY: { to: 0 },
            scale: { to: 1 },
            duration: 220,
            delay: stagger(50),
            ease: ANIME_EASE_OVERSHOOT,
          },
          ms(0.18),
        )
      }
    },

    dispose() {
      stopTimeline()
      pressAnimation?.cancel()
      pressAnimation = null
      pressTarget = null

      if (sidenavHoveredLink) {
        resetSidenavHover(sidenavHoveredLink, true)
        sidenavHoveredLink = null
      }

      const el = root()
      if (el) {
        el.removeEventListener('pointerdown', onPointerDown)
        el.removeEventListener('pointerup', onPointerUp)
        el.removeEventListener('pointercancel', onPointerUp)
      }
      sidebarEl?.removeEventListener('mouseover', onSidebarMouseOver)
      sidebarEl?.removeEventListener('mouseout', onSidebarMouseOut)
      sidebarEl = null
      scope?.revert()
      scope = null
    },
  }
}

export function animateCheckoutModalOpen(backdrop, panel) {
  if (!backdrop || !panel || prefersReducedMotion()) return
  cancelAnimations([backdrop, panel])
  prepareFadeUp(backdrop, 0)
  prepareFadeUp(panel, 28, { scale: 0.985 })
  animate(backdrop, {
    opacity: { to: 1 },
    duration: 180,
    ease: ANIME_EASE_SMOOTH,
  })
  animate(panel, {
    opacity: { to: 1 },
    translateY: { to: 0 },
    scale: { to: 1 },
    duration: 320,
    ease: ANIME_EASE_ENTER,
  })
}

export function animateCheckoutModalClose(backdrop, panel, onComplete) {
  if (!backdrop || !panel || prefersReducedMotion()) {
    onComplete?.()
    return
  }
  cancelAnimations([backdrop, panel])
  animate(panel, {
    opacity: { to: 0 },
    translateY: { to: 16 },
    scale: { to: 0.99 },
    duration: 200,
    ease: ANIME_EASE_EXIT,
  })
  animate(backdrop, {
    opacity: { to: 0 },
    duration: 180,
    ease: ANIME_EASE_EXIT,
    onComplete,
  })
}
