import {
  cancelAnimations,
  createTimeline,
  ms,
  prefersReducedMotion,
  set,
  stagger,
  ANIME_EASE_ENTER,
} from '@/lib/anime'
import { nextTick, onBeforeUnmount, watch } from 'vue'

function canAnimate() {
  if (typeof window === 'undefined') return false
  if (prefersReducedMotion()) return false
  if (document.documentElement.classList.contains('settings-no-animations')) return false
  return true
}

function clearMotionProps(targets) {
  const list = Array.isArray(targets) ? targets : [...(targets || [])]
  if (!list.length) return
  cancelAnimations(list)
  set(list, { opacity: 1, translateY: 0 })
}

/**
 * 设置页轻量动效：壳层入场 + 分区切换软淡入
 */
export function useSettingsPageMotion({ pageRef, bodyRef, ready, tabKey }) {
  let introPlayed = false
  let panelTween = null
  let introTimeline = null

  function markReady() {
    const root = pageRef?.value
    if (root) root.classList.add('is-ready')
  }

  function playIntro() {
    const root = pageRef?.value
    if (!root || introPlayed) return
    introPlayed = true

    const parts = [...root.querySelectorAll('[data-settings-motion]')]
    if (!canAnimate() || !parts.length) {
      clearMotionProps(parts)
      markReady()
      return
    }

    cancelAnimations(parts)
    set(parts, { opacity: 0, translateY: 12 })
    markReady()

    introTimeline?.pause?.()
    introTimeline = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
    introTimeline.add(parts, {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: ms(0.38),
      delay: stagger(42),
    })
  }

  function playPanelReveal({ soft = false } = {}) {
    const body = bodyRef?.value
    if (!body) return

    const cards = [
      ...body.querySelectorAll(
        '.compact-settings-panel, .field-card, .cloud-sync-panel, .data-section-card, .settings-account-note',
      ),
    ].slice(0, 16)
    if (!cards.length) return

    cancelAnimations(cards)

    if (!canAnimate()) {
      clearMotionProps(cards)
      return
    }

    // 仅透明度，避免 transform 残留形成 stacking context 压住下拉
    set(cards, { opacity: 0, translateY: 0 })
    panelTween = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
    panelTween.add(cards, {
      opacity: { to: 1 },
      duration: ms(soft ? 0.18 : 0.28),
      delay: stagger(soft ? 10 : 20),
    })
  }

  watch(
    () => ready?.value,
    async (isReady) => {
      if (!isReady) return
      await nextTick()
      playIntro()
      playPanelReveal()
    },
    { immediate: true },
  )

  watch(
    () => tabKey?.value,
    async () => {
      if (!ready?.value) return
      await nextTick()
      playPanelReveal({ soft: true })
    },
  )

  onBeforeUnmount(() => {
    introTimeline?.pause?.()
    panelTween?.pause?.()
    introTimeline = null
    panelTween = null
  })

  return { playIntro, playPanelReveal }
}
