import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { FINISHES } from './holoVisualCatalog.js'
import './holo-atmosphere.css'

gsap.registerPlugin(useGSAP)

const TONES = FINISHES.map(item => item.id)

// Deliberately fixed positions keep the atmosphere quiet and consistent across renders.
const DUST = [
  [9, 19, 1, 28, -8, 0.27],
  [18, 69, 1.5, 34, -17, 0.22],
  [24, 37, 1, 39, -3, 0.34],
  [33, 13, 1, 31, -22, 0.2],
  [42, 77, 1.5, 42, -11, 0.23],
  [51, 22, 1, 36, -26, 0.19],
  [63, 12, 1, 44, -7, 0.27],
  [71, 61, 1.5, 32, -19, 0.25],
  [83, 29, 1, 38, -29, 0.32],
  [91, 74, 1, 41, -14, 0.2],
  [13, 49, 1, 37, -24, 0.18],
  [29, 86, 1, 33, -6, 0.3],
  [38, 53, 1, 43, -31, 0.16],
  [47, 9, 1.5, 30, -16, 0.28],
  [57, 87, 1, 35, -4, 0.25],
  [68, 36, 1, 40, -21, 0.19],
  [77, 83, 1, 29, -12, 0.29],
  [88, 48, 1.5, 45, -33, 0.25],
  [6, 83, 1, 38, -18, 0.18],
  [22, 9, 1, 42, -28, 0.2],
  [74, 19, 1, 34, -9, 0.22],
  [95, 16, 1, 39, -25, 0.25],
]

function resolveTone(tone) {
  return TONES.includes(tone) ? tone : 'spectrum'
}

export function HoloAtmosphere({ paused = false, tone = 'spectrum' }) {
  const rootRef = useRef(null)
  const controlsRef = useRef(null)
  const initialToneRef = useRef(resolveTone(tone))
  const initialPausedRef = useRef(paused)

  useGSAP((_, contextSafe) => {
    const root = rootRef.current
    const surface = root?.parentElement
    if (!root || !surface) return undefined

    const field = root.querySelector('.holo-atmosphere__field')
    const palettes = [...root.querySelectorAll('.holo-atmosphere__palette')]
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
    let bounds = surface.getBoundingClientRect()
    let isPaused = initialPausedRef.current
    let isOnscreen = bounds.bottom > 0 && bounds.top < window.innerHeight
    let activeTone = initialToneRef.current
    let paletteTween = null
    let measureFrame = 0
    let disposed = false

    const xTo = gsap.quickTo(field, 'x', { duration: 1.65, ease: 'power3.out' })
    const yTo = gsap.quickTo(field, 'y', { duration: 1.65, ease: 'power3.out' })

    const canAnimate = () => !isPaused && !document.hidden && isOnscreen && !motionQuery.matches

    const syncPlayback = () => {
      const running = canAnimate()
      root.dataset.running = String(running)
      xTo.tween.paused(!running)
      yTo.tween.paused(!running)
      paletteTween?.paused(!running)
    }

    const updateTone = contextSafe((nextTone) => {
      const resolvedTone = resolveTone(nextTone)
      if (resolvedTone === activeTone) return
      activeTone = resolvedTone
      paletteTween?.kill()
      paletteTween = null

      const paletteState = {
        autoAlpha: (index) => TONES[index] === activeTone ? 1 : 0,
      }

      if (canAnimate()) {
        paletteTween = gsap.to(palettes, {
          ...paletteState,
          duration: 1.35,
          ease: 'sine.inOut',
          overwrite: true,
        })
      } else {
        // Explicit material changes still apply while paused, without a trailing fade.
        gsap.set(palettes, paletteState)
      }
    })

    const measure = () => {
      measureFrame = 0
      if (!disposed) bounds = surface.getBoundingClientRect()
    }

    const scheduleMeasure = () => {
      if (!measureFrame) measureFrame = window.requestAnimationFrame(measure)
    }

    const onPointerMove = (event) => {
      if (!canAnimate() || !pointerQuery.matches || event.pointerType === 'touch') return
      if (!bounds.width || !bounds.height) return
      const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2))
      const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2))
      xTo(x * -12)
      yTo(y * -9)
    }

    const onPointerLeave = () => {
      if (!canAnimate()) return
      xTo(0)
      yTo(0)
    }

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleMeasure)
      : null
    const intersectionObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
        if (!entry || disposed) return
        isOnscreen = entry.isIntersecting
        syncPlayback()
        if (isOnscreen) scheduleMeasure()
      })
      : null

    resizeObserver?.observe(surface)
    intersectionObserver?.observe(root)
    surface.addEventListener('pointerenter', scheduleMeasure, { passive: true })
    surface.addEventListener('pointermove', onPointerMove, { passive: true })
    surface.addEventListener('pointerleave', onPointerLeave, { passive: true })
    window.addEventListener('resize', scheduleMeasure, { passive: true })
    window.addEventListener('scroll', scheduleMeasure, { passive: true, capture: true })
    document.addEventListener('visibilitychange', syncPlayback)
    motionQuery.addEventListener('change', syncPlayback)

    controlsRef.current = {
      update(nextPaused, nextTone) {
        isPaused = nextPaused
        syncPlayback()
        updateTone(nextTone)
      },
    }
    syncPlayback()

    return () => {
      disposed = true
      controlsRef.current = null
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      if (measureFrame) window.cancelAnimationFrame(measureFrame)
      surface.removeEventListener('pointerenter', scheduleMeasure)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      document.removeEventListener('visibilitychange', syncPlayback)
      motionQuery.removeEventListener('change', syncPlayback)
    }
  }, { scope: rootRef })

  useGSAP(() => {
    controlsRef.current?.update(paused, tone)
  }, { scope: rootRef, dependencies: [paused, tone] })

  return (
    <div ref={rootRef} className="holo-atmosphere" aria-hidden="true" data-running="false">
      <div className="holo-atmosphere__field">
        {TONES.map((palette) => (
          <div
            key={palette}
            className={`holo-atmosphere__palette holo-atmosphere__palette--${palette}`}
            data-initial={palette === initialToneRef.current ? 'true' : 'false'}
          />
        ))}
      </div>
      <div className="holo-atmosphere__dust-field">
        {DUST.map(([x, y, size, duration, delay, opacity], index) => (
          <i
            key={index}
            className="holo-atmosphere__dust"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              opacity,
              '--dust-duration': `${duration}s`,
              '--dust-delay': `${delay}s`,
              '--dust-drift': `${index % 2 ? 8 : -8}px`,
            }}
          />
        ))}
      </div>
      <div className="holo-atmosphere__vignette" />
    </div>
  )
}
