import { animate, createScope, createTimeline } from 'animejs'
import { remove, set, stagger } from 'animejs/utils'

/** 入场：快进入、慢停下（对应 GSAP power3.out） */
export const ANIME_EASE_ENTER = 'outCubic'
/** 退场：干脆（对应 GSAP power2.in） */
export const ANIME_EASE_EXIT = 'inQuad'
/** 按钮 / CTA：轻微 overshoot（对应 GSAP back.out(1.35)） */
export const ANIME_EASE_OVERSHOOT = 'outBack(1.35)'
/** 平滑过渡 */
export const ANIME_EASE_SMOOTH = 'outQuad'

/** @deprecated 保留旧导出名，供价格页过渡期间引用 */
export const PC_EASE_ENTER = ANIME_EASE_ENTER
export const PC_EASE_EXIT = ANIME_EASE_EXIT
export const PC_EASE_OVERSHOOT = ANIME_EASE_OVERSHOOT

export { animate, createScope, createTimeline, remove, set, stagger }

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** GSAP 秒 → Anime.js 毫秒 */
export function ms(seconds) {
  return Math.round(Number(seconds) * 1000)
}

export function cancelAnimations(targets) {
  if (!targets) return
  remove(targets)
}
