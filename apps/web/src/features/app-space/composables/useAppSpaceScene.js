import { gsap } from 'gsap'

/**
 * 应用空间动画引擎 — 卡片入场、磁吸、视差
 */
export function createAppSpaceScene(rootEl, { reducedMotion = false } = {}) {
  if (!rootEl || reducedMotion) {
    return { destroy: () => {}, setFilter: () => {} }
  }

  const hero = rootEl.querySelector('.app-space-hero')
  const cards = rootEl.querySelectorAll('.app-card')
  const orb = rootEl.querySelector('.app-space-orb')
  const cleanups = []
  let filterTween = null

  const intro = gsap.timeline({ defaults: { ease: 'power4.out' } })
  if (hero) {
    intro.from(hero.querySelectorAll('.app-space-kicker, .app-space-title, .app-space-lead'), {
      y: 32,
      opacity: 0,
      duration: 0.9,
      stagger: 0.1,
    })
  }
  intro.from(
    cards,
    {
      y: 48,
      opacity: 0,
      scale: 0.92,
      duration: 0.85,
      stagger: 0.07,
    },
    '-=0.35',
  )

  cards.forEach((card) => {
    const glow = card.querySelector('.app-card-glow')
    const icon = card.querySelector('.app-card-icon')
    let raf = 0
    let targetRx = 0
    let targetRy = 0
    let currentRx = 0
    let currentRy = 0

    function onMove(event) {
      const rect = card.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width - 0.5
      const y = (event.clientY - rect.top) / rect.height - 0.5
      targetRx = y * -10
      targetRy = x * 12
      if (glow) {
        glow.style.setProperty('--mx', `${(x + 0.5) * 100}%`)
        glow.style.setProperty('--my', `${(y + 0.5) * 100}%`)
      }
      cancelAnimationFrame(raf)
      const tick = () => {
        currentRx += (targetRx - currentRx) * 0.14
        currentRy += (targetRy - currentRy) * 0.14
        card.style.transform = `perspective(900px) rotateX(${currentRx}deg) rotateY(${currentRy}deg) translateY(-4px)`
        if (Math.abs(targetRx - currentRx) > 0.01 || Math.abs(targetRy - currentRy) > 0.01) {
          raf = requestAnimationFrame(tick)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    function onLeave() {
      targetRx = 0
      targetRy = 0
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        y: 0,
        duration: 0.55,
        ease: 'power3.out',
        transformPerspective: 900,
      })
    }

    function onEnter() {
      gsap.to(icon, { scale: 1.08, duration: 0.35, ease: 'back.out(2)' })
    }

    function onEnterBack() {
      gsap.to(icon, { scale: 1, duration: 0.35, ease: 'power2.out' })
    }

    card.addEventListener('mousemove', onMove)
    card.addEventListener('mouseleave', onLeave)
    card.addEventListener('mouseenter', onEnter)
    card.addEventListener('mouseleave', onEnterBack)
    cleanups.push(() => {
      cancelAnimationFrame(raf)
      card.removeEventListener('mousemove', onMove)
      card.removeEventListener('mouseleave', onLeave)
      card.removeEventListener('mouseenter', onEnter)
      card.removeEventListener('mouseleave', onEnterBack)
    })
  })

  function onRootMove(event) {
    if (!orb) return
    const rect = rootEl.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 28
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 18
    gsap.to(orb, { x, y, duration: 0.8, ease: 'power2.out' })
  }

  rootEl.addEventListener('mousemove', onRootMove)
  cleanups.push(() => rootEl.removeEventListener('mousemove', onRootMove))

  function setFilter(mode) {
    filterTween?.kill()
    const visible = mode === 'all' ? cards : [...cards].filter((c) => c.dataset.status === mode)
    const hidden = mode === 'all' ? [] : [...cards].filter((c) => c.dataset.status !== mode)
    filterTween = gsap.timeline()
    filterTween.to(visible, { opacity: 1, scale: 1, duration: 0.45, stagger: 0.04, ease: 'power2.out' }, 0)
    filterTween.to(hidden, { opacity: 0.18, scale: 0.94, duration: 0.35, ease: 'power2.in' }, 0)
  }

  return {
    setFilter,
    destroy() {
      filterTween?.kill()
      intro.kill()
      cleanups.forEach((fn) => fn())
    },
  }
}
