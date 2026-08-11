import { expect, test } from '@playwright/test'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const publicRouteBaselines = [
  { name: 'home', path: '/', root: '.commercial-home' },
  { name: 'prompts', path: '/prompts', root: '.ch-page--prompts' },
  { name: 'studio', path: '/studio', root: '.studio-hub' },
  { name: 'text-to-image', path: '/text-to-image', root: '.auth-required-dialog' },
  { name: 'pricing', path: '/pricing', root: '.pp' },
  { name: 'share', path: '/share', root: '.community-page' },
  { name: 'puzzle', path: '/tools/puzzle', root: '.collage-studio-page' },
  { name: 'image-compress', path: '/tools/image-compress', root: '.ic' },
  { name: 'auth', path: '/auth', root: '.auth-page' },
  { name: 'updates', path: '/updates', root: '.updates-page' },
  { name: 'app-space', path: '/app-space', root: '.app-space-page' },
  { name: 'access-limited', path: '/access-limited', root: '.limited-shell' },
  { name: 'not-found', path: '/react-migration-not-found', root: '.not-found-container' },
]

test.describe('Vue migration visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
  })

  for (const route of publicRouteBaselines) {
    test(`${route.name} page`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await stabilizeVisualPage(page, route.root)

      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
      })
    })
  }
})
