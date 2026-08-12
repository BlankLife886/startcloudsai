import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = {
  id: 'coloring-visual-user',
  email: 'coloring@example.com',
  username: '插画染色用户',
}

const visualImagePath = fileURLToPath(
  new URL('../../public/sucai/home-intro-03.png', import.meta.url),
)

const model = {
  id: 'coloring-visual-model',
  publicModelKey: 'coloring-visual-model',
  label: '插画高清染色',
  default: true,
  pricePoints: 4,
  capabilities: ['image.edit', 'imageToImage'],
}

const resultTask = {
  id: 'coloring-result-1',
  type: 'coloring',
  status: 'succeeded',
  prompt: '薄荷绿与珊瑚粉，暖色阴影，保持线稿清晰',
  params: {
    _kind: 'illustration-coloring',
    publicModelKey: model.publicModelKey,
    sourceUrl: '/sucai/home-intro-03.png',
    sourceUrls: ['/sucai/home-intro-03.png'],
    title: '森林精灵角色',
    customPrompt: '薄荷绿与珊瑚粉，暖色阴影，保持线稿清晰',
    outputSize: '2k',
    outputOrientation: 'source',
    outputWidth: 2048,
    outputHeight: 1365,
    variantIndex: 1,
    variantCount: 1,
  },
  outputUrls: ['/sucai/home-intro-03.png'],
  originalUrls: ['/sucai/home-intro-03.png'],
  thumbnailUrls: ['/sucai/home-intro-03.png'],
  createdAt: '2026-08-11T08:00:00.000Z',
  startedAt: '2026-08-11T08:00:05.000Z',
  finishedAt: '2026-08-11T08:00:46.000Z',
}

const queuedTask = {
  ...resultTask,
  id: 'coloring-queued-1',
  status: 'queued',
  outputUrls: [],
  originalUrls: [],
  thumbnailUrls: [],
  startedAt: '',
  finishedAt: '',
}

async function seedColoringHistory(page, task) {
  const item = {
    id: `coloring-${task.id}`,
    serverJobId: task.id,
    status: task.status === 'succeeded' ? 'completed' : task.status,
    title: task.params.title,
    styleId: 'coloring',
    styleLabel: '插画染色',
    customPrompt: task.params.customPrompt,
    sourceRemoteUrl: task.params.sourceUrl,
    sourcePreview: task.params.sourceUrl,
    sourceWidth: 1536,
    sourceHeight: 1024,
    sourceBytes: 428000,
    inputType: 'image/png',
    resultUrl: task.originalUrls[0] || '',
    outputs: task.originalUrls,
    outputSize: '2k',
    outputOrientation: 'source',
    requestedOutputWidth: 2048,
    requestedOutputHeight: 1365,
    publicModelKey: model.publicModelKey,
    variantIndex: 1,
    variantCount: 1,
    createdAt: task.createdAt,
    startedAt: task.startedAt ? Date.parse(task.startedAt) : 0,
    finishedAt: task.finishedAt ? Date.parse(task.finishedAt) : 0,
    updatedAt: task.finishedAt || task.createdAt,
  }
  await page.addInitScript(({ item, userId }) => {
    const value = JSON.stringify([item])
    const key = 'walleven_illustration_coloring_history_v2'
    localStorage.setItem(`walleven_guest_local_${key}`, value)
    localStorage.setItem(`walleven_user_${userId}_local_${key}`, value)
  }, { item, userId: user.id })
}

async function stabilizeColoring(page, rootSelector) {
  await stabilizeVisualPage(page, rootSelector)
  // Vue exposes developer-only diagnostics in dev mode. Production and the
  // React migration intentionally omit the execution log from the user UI.
  await page.addStyleTag({
    content: '[title="调试信息"], [title="调试"] { display: none !important; }',
  })
}

test.describe('Illustration coloring Vue to React visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.illustrationColoring': {
            enabled: true,
            config: { publicModels: [model] },
          },
        },
        aiModelCatalog: {
          providers: [],
          models: [],
          publicModels: [model],
          featurePublicModels: [model],
        },
        blacklist: { blocked: false },
      }),
    )
    await page.route('**/api/v1/me/wallet', (route) =>
      fulfillJson(route, { availablePoints: 120, balancePoints: 120 }),
    )
    await page.route('**/api/v1/tasks**', (route) => {
      const url = new URL(route.request().url())
      const task = new URL(page.url()).searchParams.get('visualState')
      if (route.request().method() !== 'GET') return fulfillJson(route, { task: resultTask })
      if (/\/tasks\/[^/?]+$/.test(url.pathname)) {
        return fulfillJson(route, { task: task === 'queued' ? queuedTask : resultTask })
      }
      return fulfillJson(route, {
        items: task === 'result' ? [resultTask] : task === 'queued' ? [queuedTask] : [],
        nextCursor: null,
      })
    })
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, { key: 'uploads/visual/line-art.png', url: '/sucai/home-intro-02.png' }),
    )
    await page.route('**/*home-intro-03.png', (route) =>
      route.fulfill({ path: visualImagePath, contentType: 'image/png' }),
    )
  })

  test('empty desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })
    await stabilizeColoring(page, '.coloring-studio')
    await expect(page).toHaveScreenshot('coloring-empty-desktop.png', { fullPage: true })
  })

  test('empty mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })
    await stabilizeColoring(page, '.coloring-studio')
    await expect(page).toHaveScreenshot('coloring-empty-mobile.png', { fullPage: true })
  })

  test('result desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await seedColoringHistory(page, resultTask)
    await page.goto('/ai-illustration-coloring?visualState=result', { waitUntil: 'domcontentloaded' })
    await stabilizeColoring(page, '.coloring-board')
    await expect(page.locator('.coloring-frame.is-result img')).toBeVisible()
    await expect(page).toHaveScreenshot('coloring-result-desktop.png', {
      fullPage: true,
      mask: [
        page.locator('.coloring-frame-body'),
        page.locator('.coloring-source-thumb'),
        page.locator('.coloring-history-thumb'),
      ],
    })
  })

  test('settings dialog desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })
    await page.getByTitle('设置').click()
    await stabilizeColoring(page, '.coloring-settings-panel')
    await expect(page).toHaveScreenshot('coloring-settings-desktop.png', { fullPage: true })
  })

  test('library drawer desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await seedColoringHistory(page, resultTask)
    await page.goto('/ai-illustration-coloring?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '资产库' }).click()
    await expect.poll(() =>
      page.locator('.coloring-library-image img').evaluate((image) => image.naturalWidth),
    ).toBeGreaterThan(0)
    await stabilizeColoring(page, '.coloring-library-drawer')
    await expect(page).toHaveScreenshot('coloring-library-desktop.png', {
      fullPage: true,
      mask: [page.locator('.coloring-library-image img')],
    })
  })

  test('queued task does not show generation elapsed time', async ({ page }) => {
    await seedColoringHistory(page, queuedTask)
    await page.goto('/ai-illustration-coloring?visualState=queued', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.coloring-frame.is-result')).toContainText('排队中')
    await expect(page.locator('.coloring-frame.is-result')).not.toContainText(/\d+:\d{2}/)
  })

  test('fullscreen result keeps the toolbar, reference panel, and history rail', async ({ page }) => {
    await seedColoringHistory(page, resultTask)
    await page.goto('/ai-illustration-coloring?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByTitle(/全屏.*预览/).click()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true)
    await expect(page.locator('.coloring-stage-shell.is-fullscreen')).toBeVisible()
    await expect(page.locator('.coloring-stage-shell.is-fullscreen .coloring-stage-toolbar')).toBeVisible()
    await expect(page.locator('.coloring-stage-shell.is-fullscreen .coloring-ref-float')).toBeVisible()
    await expect(page.locator('.coloring-stage-shell.is-fullscreen .coloring-history-rail')).toBeVisible()
    await page.getByTitle('退出全屏').click()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
  })

  test('route navigation is not blocked by pending media and APIs', async ({ page }) => {
    await page.route('**/api/v1/tasks**', () => new Promise(() => {}))
    await page.route('**/sucai/home-intro-03.png', () => new Promise(() => {}))
    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => history.pushState({}, '', '/pricing'))
    await page.dispatchEvent('body', 'popstate')
    await expect(page).toHaveURL(/\/pricing$/)
  })
})
