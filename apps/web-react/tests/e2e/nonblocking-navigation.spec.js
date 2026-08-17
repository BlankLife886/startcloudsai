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
    await expect(page.locator('.commerce-studio')).toBeVisible({ timeout: 1_500 })
  } finally {
    releaseRequests()
  }
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
