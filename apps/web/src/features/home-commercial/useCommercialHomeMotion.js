import { onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

function settingsDisableMotion() {
  return document.documentElement.classList.contains('settings-no-animations')
}

export function useCommercialHomeMotion(rootRef) {
  let media = null

  onMounted(() => {
    const root = rootRef.value
    if (!root) return

    media = gsap.matchMedia()
    media.add(
      {
        desktop: '(min-width: 961px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const { desktop, reduceMotion } = context.conditions
        const disabled = reduceMotion || settingsDisableMotion()
        const revealNodes = gsap.utils.toArray('[data-commercial-reveal]', root)
        const heroNodes = gsap.utils.toArray('[data-commercial-hero]', root)
        const narrativeWords = gsap.utils.toArray('[data-commercial-word]', root)
        const floatChars = gsap.utils.toArray('[data-commercial-float-char]', root)
        const narrativeRoot = root.querySelector('[data-commercial-narrative]')
        const floatRoot = root.querySelector('[data-commercial-float]')
        const gallerySection = root.querySelector('[data-commercial-gallery-section]')
        const galleryTarget = root.querySelector('[data-commercial-parallax="gallery"]')
        const heroTitle = root.querySelector('[data-commercial-hero="title"]')
        const heroCopy = gsap.utils.toArray('[data-commercial-hero="copy"]', root)
        const heroActions = root.querySelector('[data-commercial-hero="actions"]')
        const heroProof = root.querySelector('[data-commercial-hero="proof"]')
        const heroGallery = root.querySelector('[data-commercial-hero="gallery"]')

        if (disabled) {
          gsap.set([...revealNodes, ...heroNodes, ...narrativeWords, ...floatChars], {
            autoAlpha: 1,
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            clearProps: 'transform,visibility,opacity,willChange',
          })
          return undefined
        }

        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
        if (heroTitle) {
          intro.fromTo(heroTitle, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.76 })
        }
        if (heroCopy.length) {
          intro.fromTo(heroCopy, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.56, stagger: 0.07 }, '-=0.34')
        }
        const actionNodes = [heroActions, heroProof].filter(Boolean)
        if (actionNodes.length) {
          intro.fromTo(actionNodes, { autoAlpha: 0, y: 15 }, { autoAlpha: 1, y: 0, duration: 0.52, stagger: 0.08 }, '-=0.28')
        }
        if (heroGallery) {
          intro.fromTo(
            heroGallery,
            { autoAlpha: 0, x: desktop ? 40 : 0, y: desktop ? 14 : 24, scale: 0.975 },
            {
              autoAlpha: 1,
              x: 0,
              y: 0,
              scale: 1,
              duration: 0.82,
              clearProps: 'transform,visibility,willChange',
            },
            '-=0.58',
          )
        }

        revealNodes.forEach((node, index) => {
          gsap.fromTo(
            node,
            { autoAlpha: 0, y: 25 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.62,
              delay: (index % 4) * 0.035,
              ease: 'power3.out',
              clearProps: 'transform,visibility,willChange',
              scrollTrigger: { trigger: node, start: 'top 90%', once: true },
            },
          )
        })

        if (narrativeWords.length && narrativeRoot) {
          gsap.fromTo(
            narrativeWords,
            { autoAlpha: 0.38, y: 6 },
            {
              autoAlpha: 1,
              y: 0,
              ease: 'none',
              stagger: 0.035,
              scrollTrigger: {
                trigger: narrativeRoot,
                start: 'top 86%',
                end: 'bottom 62%',
                scrub: 0.68,
              },
            },
          )
        }

        if (floatChars.length && floatRoot) {
          gsap.fromTo(
            floatChars,
            {
              autoAlpha: 0,
              yPercent: 82,
              scaleY: 1.32,
              scaleX: 0.92,
              transformOrigin: '50% 0%',
            },
            {
              autoAlpha: 1,
              yPercent: 0,
              scaleY: 1,
              scaleX: 1,
              ease: 'back.out(1.24)',
              stagger: 0.025,
              scrollTrigger: {
                trigger: floatRoot,
                start: 'top 92%',
                end: 'bottom 68%',
                scrub: 0.72,
              },
            },
          )
        }

        if (desktop && gallerySection && galleryTarget) {
          gsap.fromTo(
            galleryTarget,
            { y: -10 },
            {
              y: 14,
              ease: 'none',
              scrollTrigger: {
                trigger: gallerySection,
                start: 'top bottom',
                end: 'bottom top',
                scrub: 0.9,
              },
            },
          )
        }

        return () => intro.kill()
      },
      root,
    )

    requestAnimationFrame(() => ScrollTrigger.refresh())
  })

  onBeforeUnmount(() => {
    media?.revert()
    media = null
  })
}
