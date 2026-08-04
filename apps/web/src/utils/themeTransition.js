export function runThemeTransition(applyTheme, origin) {
  if (
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    applyTheme()
    return
  }

  const x = Number.isFinite(origin?.x) ? origin.x : window.innerWidth / 2
  const y = Number.isFinite(origin?.y) ? origin.y : window.innerHeight / 2
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const transition = document.startViewTransition(applyTheme)
  transition.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 400, easing: 'ease-in-out', fill: 'forwards', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => {})
}
