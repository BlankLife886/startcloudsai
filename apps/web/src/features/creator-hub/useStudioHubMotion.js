import { onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * 创作台动效：只做 transform / opacity，入场一次 + 滚动揭示。
 * 避开布局属性与持续重型循环，滚动时尽量少工作。
 */
export function useStudioHubMotion(rootRef) {
  let media = null

  onMounted(() => {
    const root = rootRef.value
    if (!root) return

    media = gsap.matchMedia()
    media.add(
      {
        reduce: '(prefers-reduced-motion: reduce)',
        motion: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        const { reduce } = context.conditions
        if (reduce) {
          gsap.set(
            root.querySelectorAll(
              '[data-studio-enter], [data-studio-reveal], [data-studio-tool], [data-studio-orb]',
            ),
            { clearProps: 'all' },
          )
          return
        }

        const ctx = gsap.context(() => {
          const enter = gsap.utils.toArray('[data-studio-enter]', root)
          const tools = gsap.utils.toArray('[data-studio-tool]', root)
          const reveals = gsap.utils.toArray('[data-studio-reveal]', root)
          const orbs = gsap.utils.toArray('[data-studio-orb]', root)

          if (enter.length) {
            gsap.from(enter, {
              autoAlpha: 0,
              y: 22,
              duration: 0.62,
              ease: 'power3.out',
              stagger: 0.07,
              clearProps: 'transform,opacity,visibility',
            })
          }

          if (tools.length) {
            gsap.from(tools, {
              autoAlpha: 0,
              y: 28,
              scale: 0.985,
              duration: 0.55,
              ease: 'power2.out',
              stagger: { each: 0.05, from: 'start' },
              delay: 0.12,
              clearProps: 'transform,opacity,visibility',
            })
          }

          reveals.forEach((el) => {
            gsap.from(el, {
              autoAlpha: 0,
              y: 36,
              duration: 0.7,
              ease: 'power3.out',
              clearProps: 'transform,opacity,visibility',
              scrollTrigger: {
                trigger: el,
                start: 'top 88%',
                once: true,
                fastScrollEnd: true,
              },
            })
          })

          // 少量氛围球：低频 yoyo，只动 transform
          orbs.forEach((orb, index) => {
            gsap.to(orb, {
              y: index % 2 === 0 ? -14 : 12,
              x: index % 2 === 0 ? 10 : -8,
              duration: 4.8 + index * 0.6,
              ease: 'sine.inOut',
              repeat: -1,
              yoyo: true,
              force3D: true,
            })
          })
        }, root)

        return () => ctx.revert()
      },
    )
  })

  onBeforeUnmount(() => {
    media?.revert()
    media = null
  })
}
