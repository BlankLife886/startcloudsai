/** 明暗主题切换：documentElement 挂 .dark（自定义令牌 + Element dark css-vars 共用），localStorage 持久化；支持圆形扩散过渡 */
import { nextTick, ref } from 'vue'

const STORAGE_KEY = 'admin-theme'
const TRANSITION_MS = 520

export const isDark = ref(false)

let transitioning = false

type ThemeOrigin = Pick<MouseEvent, 'clientX' | 'clientY'>

type ViewTransitionLike = {
  ready: Promise<void>
  finished: Promise<void>
}

function apply(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light')
  } catch {
    // 写入失败不影响本次会话
  }
}

function resolveOrigin(origin?: ThemeOrigin | Event): { x: number; y: number } {
  if (origin && 'clientX' in origin && typeof origin.clientX === 'number') {
    return { x: origin.clientX, y: origin.clientY }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function startViewTransition(
  update: () => void | Promise<void>,
): ViewTransitionLike | null {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => ViewTransitionLike
  }
  if (typeof doc.startViewTransition !== 'function') return null
  return doc.startViewTransition(update)
}

export function initTheme() {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    // 隐私模式等场景读取失败时按默认 light
  }
  apply(saved === 'dark')
}

/** 切换主题；传入点击事件时从点击点做圆形扩散 */
export async function toggleTheme(origin?: ThemeOrigin | Event) {
  if (transitioning) return

  const nextDark = !isDark.value
  const root = document.documentElement

  if (prefersReducedMotion()) {
    apply(nextDark)
    persist()
    return
  }

  const { x, y } = resolveOrigin(origin)
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )

  transitioning = true
  root.dataset.themeTransition = nextDark ? 'to-dark' : 'to-light'

  try {
    const transition = startViewTransition(async () => {
      apply(nextDark)
      persist()
      await nextTick()
    })

    if (!transition) {
      apply(nextDark)
      persist()
      return
    }

    await transition.ready

    root.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: TRANSITION_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
        pseudoElement: '::view-transition-new(root)',
      },
    )

    await transition.finished
  } catch {
    if (isDark.value !== nextDark) {
      apply(nextDark)
      persist()
    }
  } finally {
    delete root.dataset.themeTransition
    transitioning = false
  }
}
