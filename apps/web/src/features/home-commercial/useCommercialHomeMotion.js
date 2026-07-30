import { onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)
ScrollTrigger.config({ ignoreMobileResize: true })

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
        const revealNodes = gsap.utils.toArray('[data-commercial-reveal]')
        const heroNodes = gsap.utils.toArray('[data-commercial-hero]')
        const narrativeWords = gsap.utils.toArray('[data-commercial-word]')
        const floatChars = gsap.utils.toArray('[data-commercial-float-char]')
        const narrativeRoot = root.querySelector('[data-commercial-narrative]')
        const floatRoot = root.querySelector('[data-commercial-float]')
        const gallerySection = root.querySelector('[data-commercial-gallery-section]')
        const galleryTarget = root.querySelector('[data-commercial-parallax="gallery"]')

        if (disabled) {
          gsap.set([...revealNodes, ...heroNodes, ...narrativeWords, ...floatChars], {
            autoAlpha: 1,
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            clearProps: 'transform,visibility,opacity',
          })
          return undefined
        }

        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
        intro
          .fromTo(
            '[data-commercial-hero="eyebrow"]',
            { autoAlpha: 0, y: 14 },
            { autoAlpha: 1, y: 0, duration: 0.52 },
          )
          .fromTo(
            '[data-commercial-hero="title"]',
            { autoAlpha: 0, y: 38 },
            { autoAlpha: 1, y: 0, duration: 0.82 },
            '-=0.28',
          )
          .fromTo(
            '[data-commercial-hero="copy"]',
            { autoAlpha: 0, y: 24 },
            { autoAlpha: 1, y: 0, duration: 0.64 },
            '-=0.42',
          )
          .fromTo(
            '[data-commercial-hero="actions"], [data-commercial-hero="proof"]',
            { autoAlpha: 0, y: 18 },
            { autoAlpha: 1, y: 0, duration: 0.56, stagger: 0.09 },
            '-=0.38',
          )
          .fromTo(
            '[data-commercial-hero="gallery"]',
            { autoAlpha: 0, x: desktop ? 56 : 0, y: desktop ? 0 : 30, scale: 0.96 },
            { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.9 },
            '-=0.72',
          )

        gsap.set(revealNodes, { autoAlpha: 0, y: 34 })
        ScrollTrigger.batch(revealNodes, {
          start: 'top 90%',
          once: true,
          interval: 0.08,
          onEnter(batch) {
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              duration: 0.68,
              stagger: 0.055,
              ease: 'power3.out',
              clearProps: 'transform,visibility',
            })
          },
        })

        if (narrativeWords.length && narrativeRoot) {
          gsap.fromTo(
            narrativeWords,
            { autoAlpha: 0.16, y: 10 },
            {
              autoAlpha: 1,
              y: 0,
              ease: 'none',
              stagger: 0.045,
              scrollTrigger: {
                trigger: narrativeRoot,
                start: 'top 84%',
                end: 'bottom 58%',
                scrub: 0.7,
              },
            },
          )
        }

        if (floatChars.length && floatRoot) {
          gsap.fromTo(
            floatChars,
            {
              autoAlpha: 0,
              yPercent: 112,
              scaleY: 1.75,
              scaleX: 0.82,
              transformOrigin: '50% 0%',
            },
            {
              autoAlpha: 1,
              yPercent: 0,
              scaleY: 1,
              scaleX: 1,
              ease: 'back.out(1.7)',
              stagger: 0.028,
              scrollTrigger: {
                trigger: floatRoot,
                start: 'top 92%',
                end: 'bottom 66%',
                scrub: 0.8,
              },
            },
          )
        }

        if (desktop && gallerySection && galleryTarget) {
          gsap.fromTo(
            galleryTarget,
            { y: -16 },
            {
              y: 20,
              ease: 'none',
              scrollTrigger: {
                trigger: gallerySection,
                start: 'top bottom',
                end: 'bottom top',
                scrub: 1,
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
