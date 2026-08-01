import { nextTick, onBeforeUnmount, watch } from 'vue'
import { gsap } from 'gsap'

/**
 * 个人中心总览：dock / 卡片入场 + 柱状条生长。
 * 仅 transform / opacity / scaleY，尊重 reduced-motion。
 */
export function useProfileDashboardMotion({ rootRef, activeTab }) {
  let media = null

  function kill() {
    media?.revert()
    media = null
  }

  async function play() {
    kill()
    await nextTick()
    const root = rootRef.value
    if (!root || activeTab.value !== 'dashboard') return

    media = gsap.matchMedia()
    media.add(
      {
        reduce: '(prefers-reduced-motion: reduce)',
        motion: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        const { reduce } = context.conditions
        const dock = root.querySelector('.pp-dock')
        // 英雄卡排除 scale 入场，避免改人物尺寸
        const cards = gsap.utils.toArray('.pp-bento-card:not(.is-hero)', root)
        const heroCard = root.querySelector('.pp-bento-card.is-hero')
        const heroFigure = root.querySelector('.pp-bento-hero-figure')
        const bars = gsap.utils.toArray('.pp-bento-bar > i', root)
        const rings = gsap.utils.toArray('.pp-bento-ring, .pp-bento-donut', root)

        if (reduce) {
          gsap.set([dock, ...cards, heroCard, ...bars, ...rings].filter(Boolean), {
            clearProps: 'all',
          })
          if (heroFigure) gsap.set(heroFigure, { clearProps: 'transform,opacity' })
          return
        }

        const ctx = gsap.context(() => {
          const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

          if (dock) {
            gsap.set(dock, { autoAlpha: 0, y: -12 })
            tl.to(dock, { autoAlpha: 1, y: 0, duration: 0.42 }, 0)
          }

          if (cards.length) {
            gsap.set(cards, { autoAlpha: 0, y: 24, scale: 0.975 })
            tl.to(
              cards,
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.55,
                stagger: { each: 0.055, from: 'start' },
                clearProps: 'transform',
              },
              0.06,
            )
          }

          if (heroCard) {
            gsap.set(heroCard, { autoAlpha: 0 })
            tl.to(heroCard, { autoAlpha: 1, duration: 0.5 }, 0.08)
          }

          if (bars.length) {
            gsap.set(bars, { scaleY: 0, transformOrigin: '50% 100%' })
            tl.to(
              bars,
              {
                scaleY: 1,
                duration: 0.65,
                stagger: 0.045,
                ease: 'power2.out',
              },
              0.26,
            )
          }

          if (rings.length) {
            gsap.set(rings, { scale: 0.88, autoAlpha: 0.35 })
            tl.to(
              rings,
              {
                scale: 1,
                autoAlpha: 1,
                duration: 0.5,
                stagger: 0.07,
                ease: 'back.out(1.35)',
                clearProps: 'transform',
              },
              0.2,
            )
          }

          // 人物立体：浮动 + 投影呼吸（不改 scale / 宽高，无指针跟转）
          if (heroFigure) {
            gsap.set(heroFigure, {
              transformPerspective: 920,
              transformOrigin: '50% 62%',
              force3D: true,
              rotateX: 0,
              rotateY: 0,
              y: 0,
            })

            gsap.fromTo(
              heroFigure,
              { autoAlpha: 0.5 },
              { autoAlpha: 1, duration: 0.55, ease: 'power2.out', delay: 0.12 },
            )

            gsap.to(heroFigure, {
              y: -6,
              rotateY: 3.5,
              rotateX: 1.6,
              duration: 3.4,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
            })
            gsap.to(heroFigure, {
              '--hero-shadow-y': '22px',
              '--hero-shadow-blur': '20px',
              '--hero-glow': 0.22,
              duration: 3.4,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
            })
          }
        }, root)

        return () => ctx.revert()
      },
    )
  }

  watch(
    () => activeTab.value,
    (tab) => {
      if (tab === 'dashboard') void play()
      else kill()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(kill)

  return { playDashboardMotion: play }
}
