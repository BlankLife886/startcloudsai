import {
  animate,
  cancelAnimations,
  createTimeline,
  ms,
  prefersReducedMotion,
  set,
  stagger,
  ANIME_EASE_ENTER,
  ANIME_EASE_SMOOTH,
} from '@/lib/anime'

export function canAnimateZw() {
  if (prefersReducedMotion()) return false
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('settings-no-animations')) {
    return false
  }
  return true
}

/** 从 cinematic 跃迁后，主界面带轻微景深浮现 */
export function animateZwPageBootFromCinematic(root) {
  if (!root || !canAnimateZw()) return

  const targets = [
    root.querySelector('.zw-topbar'),
    root.querySelector('.zw-sidebar'),
    root.querySelector('.zw-workbench'),
  ].filter(Boolean)

  cancelAnimations(targets)
  set(targets, { opacity: 0, translateY: 18 })

  createTimeline()
    .add(targets, {
      opacity: [0, 1],
      translateY: [18, 0],
      duration: ms(0.52),
      ease: ANIME_EASE_ENTER,
      delay: stagger(70),
      onComplete: () => {
        targets.forEach((el) => {
          el.style.opacity = ''
          el.style.transform = ''
        })
      },
    })
}

export function animateZwPageBoot(root) {
  if (!root || !canAnimateZw()) return

  const targets = [
    root.querySelector('.zw-topbar'),
    root.querySelector('.zw-sidebar'),
    root.querySelector('.zw-workbench'),
  ].filter(Boolean)

  cancelAnimations(targets)
  set(targets, { opacity: 0, translateY: 12 })

  createTimeline()
    .add(targets, {
      opacity: [0, 1],
      translateY: [12, 0],
      duration: ms(0.38),
      ease: ANIME_EASE_ENTER,
      delay: stagger(50),
      onComplete: () => {
        targets.forEach((el) => {
          el.style.opacity = ''
          el.style.transform = ''
        })
      },
    })
}

/** 进入控制台：可选轻动画，否则立即显示（避免黑屏） */
export function revealZwConsoleShell(root, { animate = true } = {}) {
  if (!root) return

  const targets = [
    root.querySelector('.zw-topbar'),
    root.querySelector('.zw-sidebar'),
    root.querySelector('.zw-workbench'),
  ].filter(Boolean)

  cancelAnimations(targets)

  if (!animate || !canAnimateZw()) {
    targets.forEach((el) => {
      el.style.opacity = ''
      el.style.transform = ''
    })
    return
  }

  animateZwPageBoot(root)
}

/** cinematic 路径：星宿命盘从奇点逐宫亮起 */
export function animateZwCinematicChartReveal(chartRoot) {
  if (!chartRoot || !canAnimateZw()) return

  const svg = chartRoot.querySelector('.zw-chart-svg')
  const isStarfield = svg?.classList.contains('zw-chart-svg--starfield')
  const palaces = [...chartRoot.querySelectorAll('.zw-svg-palace')]
  const stars = [...chartRoot.querySelectorAll('.zw-svg-star')]
  const nodes = [...chartRoot.querySelectorAll('.zw-svg-node, .zw-svg-center-node')]
  const sfsz = chartRoot.querySelector('.zw-svg-sfsz__line')
  const centerText = [...chartRoot.querySelectorAll('.zw-svg-center--starfield text')]

  cancelAnimations([chartRoot, svg, ...palaces, ...stars, ...nodes, sfsz, ...centerText].filter(Boolean))
  set(chartRoot, { opacity: 0, scale: isStarfield ? 0.82 : 0.72 })
  set(svg, { opacity: 0, scale: isStarfield ? 0.9 : 0.88 })
  set(palaces, { opacity: 0, scale: isStarfield ? 0.7 : 0.82 })
  set(stars, { opacity: 0, scale: 0.2 })
  set(nodes, { opacity: 0, scale: 0 })
  if (sfsz) set(sfsz, { opacity: 0 })
  set(centerText, { opacity: 0 })

  const tl = createTimeline()
  tl.add(chartRoot, {
    opacity: [0, 1],
    scale: [isStarfield ? 0.82 : 0.72, 1],
    duration: ms(isStarfield ? 1.15 : 1.05),
    ease: ANIME_EASE_ENTER,
  })
  tl.add(
    svg,
    {
      opacity: [0, 1],
      scale: [isStarfield ? 0.9 : 0.88, 1],
      duration: ms(isStarfield ? 1 : 0.95),
      ease: ANIME_EASE_ENTER,
    },
    0,
  )
  tl.add(
    nodes,
    {
      opacity: [0, 1],
      scale: [0, 1],
      duration: ms(0.55),
      ease: ANIME_EASE_SMOOTH,
      delay: stagger(isStarfield ? 65 : 40, { from: 'center' }),
    },
    isStarfield ? 180 : 120,
  )
  tl.add(
    stars,
    {
      opacity: [0, 1],
      scale: [0.2, 1],
      duration: ms(0.62),
      ease: ANIME_EASE_SMOOTH,
      delay: stagger(isStarfield ? 22 : 18, { from: 'center' }),
    },
    isStarfield ? 260 : 280,
  )
  tl.add(
    palaces,
    {
      opacity: [0, 1],
      scale: [isStarfield ? 0.7 : 0.82, 1],
      duration: ms(isStarfield ? 0.78 : 0.72),
      ease: ANIME_EASE_ENTER,
      delay: stagger(isStarfield ? 50 : 55, { from: 'center' }),
    },
    120,
  )
  if (sfsz) {
    tl.add(
      sfsz,
      {
        opacity: [0, 0.75],
        duration: ms(0.45),
        ease: ANIME_EASE_SMOOTH,
      },
      isStarfield ? 520 : 320,
    )
  }
  if (centerText.length) {
    tl.add(
      centerText,
      {
        opacity: [0, 1],
        duration: ms(0.55),
        ease: ANIME_EASE_ENTER,
        delay: stagger(80),
      },
      480,
    )
  }
}

/** 仅淡入容器；不要对 SVG 内 <g> 做 scale，否则会缩到左上角 */
export function animateZwChartReveal(chartRoot) {
  if (!chartRoot || !canAnimateZw()) return

  cancelAnimations(chartRoot)
  set(chartRoot, { opacity: 0 })

  animate(chartRoot, {
    opacity: [0, 1],
    duration: ms(0.35),
    ease: ANIME_EASE_ENTER,
  })
}

/** 中宫三方四正折线：轻量描边绘制 */
export function animateZwSanfangPath(chartRoot) {
  if (!chartRoot) return

  const path = chartRoot.querySelector('.zw-svg-sfsz__line')
  if (!path) return

  if (!canAnimateZw()) {
    path.style.strokeDasharray = ''
    path.style.strokeDashoffset = ''
    path.style.opacity = ''
    return
  }

  const length = path.getTotalLength()
  cancelAnimations(path)
  path.style.strokeDasharray = `${length}`
  path.style.strokeDashoffset = `${length}`
  path.style.opacity = '0.55'

  animate(path, {
    strokeDashoffset: [length, 0],
    opacity: [0.55, 0.85],
    duration: ms(0.32),
    ease: ANIME_EASE_SMOOTH,
    onComplete: () => {
      path.style.strokeDasharray = ''
      path.style.strokeDashoffset = ''
      path.style.opacity = ''
    },
  })
}

export function animateZwReadContent(bodyEl) {
  if (!bodyEl || !canAnimateZw()) return

  const blocks = [...bodyEl.querySelectorAll('.zw-block, .zw-table__row')]
  if (!blocks.length) return

  cancelAnimations(blocks)
  set(blocks, { opacity: 0, translateY: 10 })

  animate(blocks, {
    opacity: [0, 1],
    translateY: [10, 0],
    duration: ms(0.32),
    ease: ANIME_EASE_ENTER,
    delay: stagger(35),
  })
}

export function animateZwPalaceHeadline(headlineEl) {
  if (!headlineEl || !canAnimateZw()) return

  cancelAnimations(headlineEl)
  set(headlineEl, { opacity: 0 })

  animate(headlineEl, {
    opacity: [0, 1],
    duration: ms(0.24),
    ease: ANIME_EASE_ENTER,
  })
}

export function animateZwSubmitPulse(buttonEl) {
  if (!buttonEl || !canAnimateZw()) return

  cancelAnimations(buttonEl)
  animate(buttonEl, {
    opacity: [1, 0.88, 1],
    duration: ms(0.24),
    ease: ANIME_EASE_SMOOTH,
  })
}
