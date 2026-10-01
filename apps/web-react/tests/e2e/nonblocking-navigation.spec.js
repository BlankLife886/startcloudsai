import { expect, test } from '@playwright/test'
import { fulfillJson, mockBootstrapConfig } from './helpers/authMocks.js'
import {
  isSmartCanvasTask,
  studioRouteForTask,
} from '../../src/legacy-modules/features/creator-hub/taskRoutes.js'

const CACHED_USER = {
  id: 'navigation-user',
  email: 'navigation@example.com',
  username: 'Navigation User',
}

test('private studio navigation does not wait for auth or trial APIs', async ({ page }) => {
  let releaseRequests
  const requestGate = new Promise((resolve) => {
    releaseRequests = resolve
  })

  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await mockBootstrapConfig(page)
  await page.route('**/api/v1/auth/session', async (route) => {
    await requestGate
    await fulfillJson(route, { user: CACHED_USER })
  })
  await page.route('**/api/v1/trial-access-campaign', async (route) => {
    await requestGate
    await fulfillJson(route, { campaign: null })
  })
  await page.route('**/api/v1/me/trial-access-application', async (route) => {
    await requestGate
    await fulfillJson(route, { application: null })
  })

  try {
    await page.goto('/')
    await page.evaluate((user) => {
      sessionStorage.setItem('sc_auth_session_cache', JSON.stringify({ user }))
    }, CACHED_USER)
    await page.goto('/ecommerce-design', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main.commerce-studio')).toBeVisible({ timeout: 1_500 })
  } finally {
    releaseRequests()
  }
})

test('slow lazy route shows navigation progress while keeping the current page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/v1/**', (route) => fulfillJson(route, {}))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, { routes: {}, features: {}, pageControls: {}, blacklist: { blocked: false } }),
  )
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: CACHED_USER }))
  await page.route('**/src/views/HistoryView.jsx*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await route.continue()
  })

  await page.goto('/studio')
  await expect(page.locator('.studio-hub')).toBeVisible()

  await page.locator('.main-nav a[href="/history"]').dispatchEvent('click')
  await expect(page.locator('.route-navigation-progress')).toBeVisible()
  await expect(page.locator('main.main-content')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.studio-hub')).toBeVisible()

  await expect(page).toHaveURL(/\/history$/)
  await expect(page.locator('.route-navigation-progress')).toHaveCount(0)
})

test('session and runtime config requests are shared across public routes', async ({ page }) => {
  let sessionRequests = 0
  let runtimeConfigRequests = 0
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/v1/**', (route) => fulfillJson(route, {}))
  await page.route('**/api/v1/auth/session', (route) => {
    sessionRequests += 1
    return fulfillJson(route, { user: CACHED_USER })
  })
  await page.route('**/api/v1/runtime-config', (route) => {
    runtimeConfigRequests += 1
    return fulfillJson(route, {
      routes: {},
      features: {},
      pageControls: {},
      aiModelCatalog: { providers: [], models: [], publicModels: [], featurePublicModels: [] },
      blacklist: { blocked: false },
    })
  })

  await page.goto('/')
  await expect(page.locator('.commercial-home')).toBeVisible()
  await page.locator('.main-nav a[href="/pricing"]').dispatchEvent('click')
  await expect(page.locator('.pp')).toBeVisible()
  await page.locator('.main-nav a[href="/share"]').dispatchEvent('click')
  await expect(page.locator('.community-page')).toBeVisible()

  expect(sessionRequests).toBe(1)
  expect(runtimeConfigRequests).toBe(1)
})

test('canvas tasks resolve back to smart canvas, including existing source-only tasks', async () => {
  const existingTask = { type: 't2i', params: { _source: 'react_canvas' } }
  const newTask = {
    type: 't2i',
    params: { _source: 'react_canvas', _kind: 'canvas-image-generation' },
  }
  const wallpaperTask = { type: 't2i', params: { _kind: 'image-generation' } }
  const routes = {
    existing: [isSmartCanvasTask(existingTask), studioRouteForTask(existingTask)],
    current: [isSmartCanvasTask(newTask), studioRouteForTask(newTask)],
    wallpaper: [isSmartCanvasTask(wallpaperTask), studioRouteForTask(wallpaperTask)],
    missing: [isSmartCanvasTask(null), studioRouteForTask(null)],
    nullParams: [
      isSmartCanvasTask({ type: 'ui_design', params: null }),
      studioRouteForTask({ type: 'ui_design', params: null }),
    ],
  }

  expect(routes).toEqual({
    existing: [true, '/canvas'],
    current: [true, '/canvas'],
    wallpaper: [false, '/text-to-image'],
    missing: [false, '/text-to-image'],
    nullParams: [false, '/design-workshop'],
  })
})
