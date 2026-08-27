import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { expectPricingPageIsolated } from './helpers/pricingIsolation.js'

const user = { id: 'react-canvas-user', email: 'canvas@example.com', username: '画布用户' }
const project = {
  id: '5da95f36-77d5-4d8f-9481-03dce9e917db',
  title: '品牌主视觉草稿',
  revision: 1,
  createdAt: '2026-08-12T08:00:00.000Z',
  updatedAt: '2026-08-12T08:10:00.000Z',
}

async function mockCanvasBase(page, { pendingProjects = false, nodes = [] } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('starclouds-locale', 'zh-CN')
    localStorage.removeItem('infinite-canvas:canvas_store')
    indexedDB.deleteDatabase('infinite-canvas')
  })
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {},
    features: {
      'ai.infiniteCanvas': {
        enabled: true,
        config: {
          imageModels: [{ id: 'canvas-image-model', label: '画布生图模型', default: true, pricePoints: 2, standardPricePoints: 3 }],
          textModels: [{ id: 'canvas-text-model', label: '画布文本模型', default: true, pricePoints: 1, standardPricePoints: 1 }],
        },
      },
    },
    aiModelCatalog: { providers: [], models: [], publicModels: [], featurePublicModels: [] }, blacklist: { blocked: false },
  }))
  await page.route('**/api/v1/canvas-projects', (route) => {
    if (pendingProjects) return new Promise(() => {})
    return fulfillJson(route, { items: [project] })
  })
  await page.route(`**/api/v1/canvas-projects/${project.id}`, (route) => fulfillJson(route, {
    ...project,
    document: { version: 3, nodes, connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } },
  }))
  await page.route('**/api/v1/prompts**', (route) => fulfillJson(route, { items: [], page: 1, pageSize: 20, total: 0, hasMore: false }))
}

test.describe('React native canvas integration', () => {
  test('uses the native canvas root without an embedded route bridge', async ({ page }) => {
    const canvasRequests = []
    const promptRequests = []
    page.on('request', (request) => canvasRequests.push(request.url()))
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/prompts')) promptRequests.push(request.url())
    })
    await mockCanvasBase(page)
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '开始使用' })).toBeVisible()
    await expect(page.getByRole('button', { name: '打开画布' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '今天想在无限画布创作什么？' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '画布创作需求' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '画布首页' })).toHaveCount(0)
    await expect(page.locator('iframe[title="无限画布"]')).toHaveCount(0)
    await expect(page.locator('.canvas-native-view > .canvas-native-mount')).toHaveCount(1)
    await expect(page.locator('.canvas-overlay-root')).toHaveCount(1)
    await expect(page.locator('.canvas-native-route-entry')).toHaveAttribute('data-canvas-route-motion', 'home')
    await expect(page.locator('.canvas-home-pattern')).toHaveAttribute('data-canvas-home-motion-state', 'entered')
    await expect(page.locator('.canvas-home-pattern')).toHaveAttribute('data-canvas-card-motion-state', 'entered')
    await expect(page.locator('[data-canvas-entry-item]')).toHaveCount(4)
    const canvasSurface = await page.locator('.canvas-native-route-entry').evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, opacity: style.opacity, visibility: style.visibility }
    })
    expect(canvasSurface.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(canvasSurface.opacity).toBe('1')
    expect(canvasSurface.visibility).toBe('visible')
    await expect(page.getByText('快速开始', { exact: true })).toHaveCount(0)
    await expect(page.getByText('沉淀每一次好结果', { exact: true })).toHaveCount(0)
    await expect(page.locator('.canvas-quick-start-card')).toHaveCount(0)
    for (const name of ['视频创作台', '提示词库', '快捷配置', 'GitHub']) {
      await expect(page.getByLabel(name, { exact: true })).toHaveCount(0)
    }
    await expect(page.getByTitle(/查看版本更新/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: '我的资产' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '配置页面' })).toHaveCount(0)
    await expect(page.locator('.canvas-floating-sidebar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /智能助手/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '文档' })).toHaveCount(0)
    expect(canvasRequests.filter((url) => url.includes(':3104') || url.includes('/canvas-app/'))).toEqual([])
    expect(promptRequests).toEqual([])
  })

  test('keeps the current page visible until the canvas route bundle is ready', async ({ page }) => {
    await mockCanvasBase(page)
    let releaseCanvasRoute
    const canvasRouteBlocked = new Promise((resolve) => {
      releaseCanvasRoute = resolve
    })
    await page.route('**/src/canvas/native-index-route.tsx**', async (route) => {
      await canvasRouteBlocked
      await route.continue()
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.commercial-home')).toBeVisible()

    await page.locator('.site-header a[href="/canvas"]').dispatchEvent('click')
    await page.waitForTimeout(300)

    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.commercial-home')).toBeVisible()
    await expect(page.locator('.main-content')).not.toBeEmpty()

    releaseCanvasRoute()
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
  })

  for (const removedView of ['/image', '/video', '/prompts']) {
    test(`rejects removed canvas route ${removedView}`, async ({ page }) => {
      await mockCanvasBase(page)
      await page.goto(`/canvas?view=${encodeURIComponent(removedView)}`, { waitUntil: 'domcontentloaded' })

      await expect(page).toHaveURL(/\/canvas$/)
      await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    })
  }

  test('does not reserve canvas space for the removed floating sidebar', async ({ page }) => {
    await mockCanvasBase(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.canvas-floating-sidebar')).toHaveCount(0)
    const content = page.locator('.canvas-app-content > *').first()
    await expect(content).toBeVisible()
    expect(await content.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe('0px')
  })

  test('does not expose the removed WebDAV configuration', async ({ page }) => {
    await mockCanvasBase(page)
    await page.addInitScript(() => {
      localStorage.setItem('infinite-canvas:ai_config_store', JSON.stringify({
        state: {
          config: {},
          webdav: { url: 'https://dav.example.com', username: 'legacy-user', password: 'legacy-password', directory: 'canvas' },
        },
        version: 0,
      }))
    })
    await page.goto('/canvas/config', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('默认模型', { exact: true })).toBeVisible()
    await expect(page.getByText('本站模型', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByTitle('画布生图模型')).toBeVisible()
    await expect(page.getByTitle('画布文本模型')).toBeVisible()
    await expect(page.getByText('WebDAV', { exact: false })).toHaveCount(0)
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('infinite-canvas:ai_config_store'))).not.toContain('legacy-password')
  })

  test('opens a cloud project on the native canvas route', async ({ page }) => {
    await mockCanvasBase(page)
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
    await page.getByText(project.title, { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/canvas/${project.id}$`))
    await expect(page.locator('.canvas-native-route-entry')).toHaveAttribute('data-canvas-route-motion', 'fade')
    await expect(page.locator('.canvas-native-route-entry')).toHaveAttribute('data-canvas-route-motion-state', 'entered')
    await expect(page.getByRole('button', { name: project.title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: '打开画布菜单' }).click()
    await expect(page.getByRole('menuitem', { name: '主页' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: '文档' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: '我的画布' })).toBeVisible()
  })

  test('closes side-panel node actions on outside click and keeps only one menu open', async ({ page }) => {
    await mockCanvasBase(page, {
      nodes: [
        { id: 'text-node-1', type: 'text', title: '文案节点一', position: { x: 100, y: 100 }, width: 320, height: 220, metadata: { content: '第一段文案' } },
        { id: 'image-node-2', type: 'image', title: '图片节点二', position: { x: 500, y: 100 }, width: 320, height: 220, metadata: { content: '/sucai/home-intro-02.png' } },
      ],
    })
    await page.goto(`/canvas/${project.id}`, { waitUntil: 'domcontentloaded' })

    await page.locator('[data-node-id="image-node-2"] [data-canvas-node-shell]').click({ button: 'right', position: { x: 12, y: 12 } })
    const nodeToolbar = page.locator('[data-canvas-node-toolbar]')
    await expect(nodeToolbar).toBeVisible()
    await expect(nodeToolbar.getByRole('button', { name: '复制', exact: true })).toHaveCount(0)
    await expect(nodeToolbar.getByRole('button', { name: '信息', exact: true })).toHaveCount(0)

    const triggers = page.locator('.canvas-node-actions-trigger')
    const popover = page.locator('.canvas-anchor-popover')
    const workflowSlot = page.locator('[data-canvas-topbar-actions] > .canvas-workflow-control-slot')
    await expect(workflowSlot).toContainText('运行工作流')
    const toolbar = page.locator('.canvas-editor-chrome.thin-scrollbar')
    const [toolbarBox, lastToolbarItemBox, workflowBox, chromeBox] = await Promise.all([
      toolbar.boundingBox(),
      toolbar.locator(':scope > :last-child').boundingBox(),
      workflowSlot.boundingBox(),
      page.locator('[data-canvas-topbar-actions] > div.canvas-chrome-cluster').boundingBox(),
    ])
    expect(toolbarBox.x + toolbarBox.width - (lastToolbarItemBox.x + lastToolbarItemBox.width)).toBeLessThanOrEqual(12)
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(workflowBox.x)
    expect(workflowBox.x + workflowBox.width).toBeLessThanOrEqual(chromeBox.x)
    await expect(triggers).toHaveCount(2)

    await triggers.nth(0).click()
    await expect(popover).toHaveCount(1)
    await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'true')

    await page.getByPlaceholder('搜索节点').click()
    await expect(popover).toHaveCount(0)
    await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'false')

    await triggers.nth(1).click()
    await triggers.nth(0).click()
    await expect(popover).toHaveCount(1)
    await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'true')
    await expect(triggers.nth(1)).toHaveAttribute('aria-expanded', 'false')
    await expect(popover.getByRole('button', { name: '信息', exact: true })).toHaveCount(0)
    await expect(popover.getByRole('button', { name: '复制', exact: true })).toHaveCount(0)

    await page.locator('.canvas-side-panel-select').click()
    const exportSelected = page.getByRole('button', { name: '导出选中', exact: true })
    await expect(exportSelected).toBeVisible()
    await expect(exportSelected).toHaveText('')
  })

  test('keeps the canvas Agent empty state concise', async ({ page }) => {
    await mockCanvasBase(page)
    await page.goto(`/canvas/${project.id}`, { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: '打开 Agent' }).click()
    await expect(page.getByText('描述你想创建或修改的画布内容。', { exact: true })).toBeVisible()
    await expect(page.getByText('从一句话改画布', { exact: true })).toHaveCount(0)
    await expect(page.locator('.canvas-agent-suggestion')).toHaveCount(0)
  })

  test('honors reduced motion without hiding the canvas surface', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockCanvasBase(page)
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })

    const home = page.locator('.canvas-home-pattern')
    await expect(home).toHaveAttribute('data-canvas-home-motion-state', 'entered')
    await expect(home).toHaveAttribute('data-canvas-card-motion-state', 'entered')
    await expect(page.locator('[data-canvas-entry-item]').first()).toHaveCSS('transform', 'none')
    await expect(page.locator('.canvas-native-route-entry')).toHaveCSS('visibility', 'visible')
  })

  test('a pending project request does not block main-site navigation', async ({ page }) => {
    await mockCanvasBase(page, { pendingProjects: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    await page.locator('.site-header a[href="/pricing"]').click()
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 2_000 })
    await expectPricingPageIsolated(page)
    await expect(page.locator('.canvas-native-mount')).toHaveCount(0)
  })
})
