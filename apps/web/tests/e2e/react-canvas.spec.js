import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const user = { id: 'react-canvas-user', email: 'canvas@example.com', username: '画布用户' }
const project = {
  id: '5da95f36-77d5-4d8f-9481-03dce9e917db',
  title: '品牌主视觉草稿',
  revision: 1,
  createdAt: '2026-08-12T08:00:00.000Z',
  updatedAt: '2026-08-12T08:10:00.000Z',
}

async function mockCanvasBase(page, { pendingProjects = false } = {}) {
  await page.addInitScript(() => {
    localStorage.removeItem('infinite-canvas:canvas_store')
    indexedDB.deleteDatabase('infinite-canvas')
  })
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {}, features: {}, aiModelCatalog: { providers: [], models: [], publicModels: [], featurePublicModels: [] }, blacklist: { blocked: false },
  }))
  await page.route('**/api/v1/canvas-projects', (route) => {
    if (pendingProjects) return new Promise(() => {})
    return fulfillJson(route, { items: [project] })
  })
  await page.route(`**/api/v1/canvas-projects/${project.id}`, (route) => fulfillJson(route, {
    ...project,
    document: { version: 3, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } },
  }))
  await page.route('**/api/v1/prompts**', (route) => fulfillJson(route, { items: [], page: 1, pageSize: 20, total: 0, hasMore: false }))
}

test.describe('React native canvas integration', () => {
  test('uses the native canvas root and keeps internal routes in the view query', async ({ page }) => {
    await mockCanvasBase(page)
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: '今天想在无限画布创作什么？' })).toBeVisible()
    await expect(page.locator('iframe[title="智能画布"]')).toHaveCount(0)
    await page.locator('.canvas-quick-start-card', { hasText: '提示词库' }).click()
    await expect(page).toHaveURL(/\/canvas\?view=%2Fprompts$/)
    await expect(page.getByRole('heading', { name: '提示词中心' })).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '提示词中心' })).toBeVisible()
    await page.getByRole('link', { name: '画布首页' }).click()
    await expect(page).toHaveURL(/\/canvas\?view=%2F$/)
  })

  test('opens a cloud project without leaving the host canvas route', async ({ page }) => {
    await mockCanvasBase(page)
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
    await page.getByText(project.title, { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/canvas\\?view=%2Fcanvas%2F${project.id}$`))
    await expect(page.getByRole('button', { name: project.title, exact: true })).toBeVisible()
  })

  test('a pending project request does not block main-site navigation', async ({ page }) => {
    await mockCanvasBase(page, { pendingProjects: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '今天想在无限画布创作什么？' })).toBeVisible()
    await page.locator('.site-header a[href="/pricing"]').click()
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 2_000 })
    await expect(page.locator('.pp')).toBeVisible()
    await expect(page.locator('body')).not.toHaveClass(/canvas-native-active/)
    await expect(page.locator('.canvas-native-mount')).toHaveCount(0)
  })
})
