import { expect } from '@playwright/test'
import { fulfillJson, mockAuthConfig, mockBootstrapConfig } from './authMocks.js'

const baselineRuntimeConfig = {
  savedAt: 1786406400000,
  config: {
    routes: {},
    features: {},
    pageLayout: {},
    blacklist: { blocked: false },
  },
}

export async function installVisualBaseline(page) {
  await page.clock.setFixedTime(new Date('2026-08-11T12:00:00+08:00'))
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.addInitScript((runtimeConfig) => {
    localStorage.setItem('starclouds-locale', 'zh-CN')
    localStorage.setItem('starclouds-appearance', 'light')
    sessionStorage.removeItem('sc_auth_session_cache')
    sessionStorage.setItem('walleven.runtime-config.v2', JSON.stringify(runtimeConfig))
  }, baselineRuntimeConfig)

  // Register the generic fallback first. Playwright evaluates the most recently
  // registered matching route first, so the explicit contracts below take priority.
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await mockBootstrapConfig(page)
  await mockAuthConfig(page)
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: null }))
  await page.route('**/api/v1/pricing**', (route) =>
    fulfillJson(route, {
      taskPointPrices: {},
      plans: [],
      paymentEnabled: false,
    }),
  )
}

export async function stabilizeVisualPage(page, rootSelector) {
  await expect(page.locator(rootSelector)).toBeVisible()
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
      input, textarea { caret-color: transparent !important; }
      #__vue-devtools-container__, #vue-inspector-container { display: none !important; }
    `,
  })

  await page.evaluate(async () => {
    await document.fonts?.ready
    const viewport = Math.max(1, window.innerHeight)
    const pageHeight = document.documentElement.scrollHeight
    for (let top = 0; top < pageHeight; top += viewport) {
      window.scrollTo(0, top)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    window.scrollTo(0, 0)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => window.setTimeout(resolve, 80))
    const pendingImages = [...document.images]
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
          }),
      )
    await Promise.race([
      Promise.allSettled(pendingImages),
      new Promise((resolve) => window.setTimeout(resolve, 4_000)),
    ])
    window.scrollTo(0, 0)
  })
}
