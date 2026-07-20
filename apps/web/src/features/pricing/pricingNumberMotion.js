import {
  animate,
  cancelAnimations,
  ANIME_EASE_ENTER,
  prefersReducedMotion,
} from '@/lib/anime'
import { clampUsd, formatUsd } from './pricingMoney.js'

export const OVERVIEW_NUMBER_BASE_DELAY = 380

export function formatAnimatedNumber(value = 0, format = 'integer') {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) {
    if (format === 'usd') return formatUsd(0)
    if (format === 'usd3') return '$0.000'
    if (format === 'percent') return '0%'
    if (format === 'percent1') return '0.0%'
    return '0'
  }
  if (format === 'usd') return formatUsd(clampUsd(num))
  if (format === 'usd3') return `$${clampUsd(num).toFixed(3)}`
  if (format === 'percent') return `${Math.round(num)}%`
  if (format === 'percent1') return `${Math.max(0, num).toFixed(1)}%`
  return String(Math.round(num))
}

export function overviewNumberDelay(extra = 0) {
  return OVERVIEW_NUMBER_BASE_DELAY + Number(extra || 0)
}

export function animateNumberValue(options = {}) {
  const {
    from = 0,
    to = 0,
    format = 'integer',
    duration = 1200,
    delay = 0,
    onUpdate,
    onComplete,
  } = options

  const target = Number(to) || 0
  const start = Number(from) || 0

  if (prefersReducedMotion()) {
    const finalText = formatAnimatedNumber(target, format)
    onUpdate?.(finalText)
    onComplete?.()
    return { cancel: () => {} }
  }

  const state = { value: start }
  const animation = animate(state, {
    value: { to: target },
    duration,
    delay,
    ease: ANIME_EASE_ENTER,
    onUpdate: () => {
      onUpdate?.(formatAnimatedNumber(state.value, format))
    },
    onComplete: () => {
      onUpdate?.(formatAnimatedNumber(target, format))
      onComplete?.()
    },
  })

  return {
    cancel: () => {
      cancelAnimations(state)
      animation?.cancel?.()
    },
  }
}
