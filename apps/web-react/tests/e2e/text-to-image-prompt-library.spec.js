import { expect, test } from '@playwright/test'

const envelope = (data) => JSON.stringify({ success: true, data })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.removeItem('sc_auth_session_cache')
    localStorage.setItem('starclouds-locale', 'zh-CN')
  })
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ user: null }) }),
  )
  await page.route('**/api/v1/prompts/categories**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({ items: [{ id: 'cat-product', key: 'product', label: '产品摄影' }] }),
    }),
  )
})

test('text-to-image prompt library renders server prompts and fills the composer', async ({ page }) => {
  let engagement = null
  await page.route('**/api/v1/prompts/*/engagements', async (route) => {
    engagement = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({}) })
  })
  await page.route('**/api/v1/prompts?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({
        items: [
          {
            id: 't2i-server-prompt',
            title: '高端护肤品摄影',
            prompt: '透明玻璃精华瓶，柔和侧光，浅灰背景，高端商业产品摄影',
            taskType: 't2i',
            category: 'product',
            tags: ['产品'],
            coverUrl: '',
          },
        ],
        nextCursor: null,
        categoryCounts: { all: 1, product: 1 },
      }),
    }),
  )

  await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '提示词库' }).click()

  await expect(page.locator('.t2i-library-categories')).toContainText('24小时最新')
  await expect(page.locator('.t2i-library-categories')).toContainText('我的收藏')
  await expect(page.locator('.t2i-library-categories')).toContainText('全部')
  await expect(page.getByRole('button', { name: '更多' })).toBeVisible()
  await expect(page.getByLabel('提示词排序')).toHaveValue('recommended')
  await expect(page.getByText('高端护肤品摄影', { exact: true })).toBeVisible()
  await expect(page.locator('.t2i-page')).toHaveAttribute(
    'data-t2i-prompts-motion-state',
    'entered',
  )
  await expect(page.locator('.t2i-collection-card')).toContainText('透明玻璃精华瓶')
  await expect(page.locator('.t2i-collection-card')).toContainText('使用 0 次')
  await expect(page.locator('.t2i-collection-card .t2i-entry-actions button')).toHaveCount(3)
  await page.locator('.t2i-collection-card .t2i-entry-actions button').last().click()

  await expect(page.getByLabel('创作描述')).toHaveValue('透明玻璃精华瓶，柔和侧光，浅灰背景，高端商业产品摄影')
  await expect(page.getByRole('tab', { name: '提示词库' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => engagement).toEqual({ action: 'use', active: true })
})

test('text-to-image prompt library falls back to local presets when the server is empty', async ({ page }) => {
  await page.route('**/api/v1/prompts?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({ items: [], nextCursor: null, categoryCounts: { all: 0 } }),
    }),
  )

  await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '提示词库' }).click()

  await expect(page.locator('.t2i-collection-card')).toHaveCount(6)
  await expect(page.locator('.t2i-library-view')).toContainText('电影感光影')
  await expect(page.locator('.t2i-library-view')).toContainText('没有更多数据了')
})

test('text-to-image prompt library keeps Vue category and sorting request behavior', async ({ page }) => {
  const requests = []
  await page.route('**/api/v1/prompts?**', (route) => {
    const url = new URL(route.request().url())
    requests.push(Object.fromEntries(url.searchParams))
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({
        items: [{
          id: `prompt-${requests.length}`,
          title: '产品摄影提示词',
          prompt: '商业产品摄影，柔和棚拍光线',
          taskType: 't2i',
          category: 'product',
          tags: ['产品'],
          coverUrl: '',
        }],
        nextCursor: null,
        categoryCounts: { all: 1, product: 1 },
      }),
    })
  })

  await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '提示词库' }).click()
  await expect(page.getByText('产品摄影提示词', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('option', { name: '产品摄影' }).click()
  await expect.poll(() => requests.some((request) => request.category === 'product')).toBe(true)

  await page.getByLabel('提示词排序').selectOption('favorites')
  await expect.poll(() => requests.some((request) => (
    request.category === 'product' && request.sort === 'favorites'
  ))).toBe(true)
})

test('text-to-image prompt library automatically loads the next Vue-style cursor page', async ({ page }) => {
  const cursors = []
  await page.route('**/api/v1/prompts?**', (route) => {
    const url = new URL(route.request().url())
    const cursor = url.searchParams.get('cursor') || ''
    cursors.push(cursor)
    const secondPage = cursor === 'next-page'
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({
        items: [{
          id: secondPage ? 'page-two-prompt' : 'page-one-prompt',
          title: secondPage ? '第二页提示词' : '第一页提示词',
          prompt: secondPage ? '第二页内容' : '第一页内容',
          taskType: 't2i',
          category: 'product',
          tags: [],
          coverUrl: '',
        }],
        nextCursor: secondPage ? null : 'next-page',
        categoryCounts: { all: 2, product: 2 },
      }),
    })
  })

  await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '提示词库' }).click()

  await expect(page.getByText('第一页提示词', { exact: true })).toBeVisible()
  await expect(page.getByText('第二页提示词', { exact: true })).toBeVisible()
  await expect(page.locator('.t2i-page')).toHaveAttribute(
    'data-t2i-prompts-motion-state',
    'entered',
  )
  await expect.poll(() => cursors).toContain('next-page')
  await expect(page.locator('.t2i-library-view')).toContainText('没有更多数据了')
})
