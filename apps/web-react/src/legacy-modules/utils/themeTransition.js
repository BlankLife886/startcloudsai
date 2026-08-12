let pendingTransition = null
let appliedTheme = null
let flushPromise = null

function applyImmediately(applyTheme) {
  try {
    applyTheme()
  } catch {
    // Theme changes are cosmetic and must never take down the application.
  }
}

function flushThemeTransition() {
  const request = pendingTransition
  pendingTransition = null
  if (!request || request.theme === appliedTheme) return
  applyImmediately(request.applyTheme)
  appliedTheme = request.theme
}

export function runThemeTransition(applyTheme, theme) {
  pendingTransition = { applyTheme, theme }
  if (!flushPromise) {
    flushPromise = Promise.resolve()
      .then(flushThemeTransition)
      .finally(() => {
        flushPromise = null
        if (pendingTransition)
          runThemeTransition(pendingTransition.applyTheme, pendingTransition.theme)
      })
  }
  return flushPromise
}
