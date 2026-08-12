import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user: null } }),
    }),
  )
  await page.route('**/api/v1/pricing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { taskPointPrices: { t2i: 3 } } }),
    }),
  )
})

test('composer only offers assistant and text-to-image while the tool wall stays intact', async ({
  page,
}) => {
  await page.goto('/studio')
  await page.locator('.studio-composer__control.is-workflow').click()

  const composerTools = page.locator('.studio-composer__tool-menu > button')
  await expect(composerTools).toHaveCount(2)
  await expect(composerTools.locator('.bi-chat-square-text-fill')).toHaveCount(1)
  await expect(composerTools.locator('.bi-stars')).toHaveCount(1)
  await expect(page.locator('.studio-bento__item')).toHaveCount(7)

  await composerTools.locator('.bi-stars').locator('..').click()
  await page.locator('.studio-composer__inline-field.is-skill').click()
  const skillOptions = page.locator('.studio-composer__field-menu > button')
  await skillOptions.nth(2).click()
  await skillOptions.nth(4).click()

  await expect(page.locator('.studio-composer__field-menu')).toBeVisible()
  await expect(page.locator('.studio-composer__field-menu > button.is-selected')).toHaveCount(3)
  await expect(page.locator('.studio-composer__inline-field.is-skill span')).toContainText('3')
})

test('composer uploads a reference image and calculates points before launch', async ({ page }) => {
  await page.route('**/api/v1/uploads', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          key: 'uploads/test/reference.png',
          url: '/api/v1/files/uploads/test/reference.png',
          thumbnailUrl: '/api/v1/files/uploads/test/reference-thumb.png',
        },
      }),
    }),
  )
  await page.route('**/api/v1/files/uploads/test/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )

  await page.goto('/studio')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.locator('.studio-composer__reference')).toHaveCount(1)

  await page.locator('.studio-composer__control.is-workflow').click()
  await page.locator('.studio-composer__tool-menu .bi-stars').locator('..').click()
  await page.locator('.studio-composer__input').fill('一张带有冷色灯光的产品主图')
  await page.locator('.studio-composer__submit').click()

  await expect(page.locator('.ai-cost-confirm-panel')).toBeVisible()
  await expect(page.locator('.ai-cost-confirm-total strong')).toContainText('3')
  await page.locator('.ai-cost-confirm-btn.primary').click()

  const pendingLaunch = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('starclouds:pending-prompt') || 'null'),
  )
  expect(pendingLaunch?.taskType).toBe('t2i')
  expect(pendingLaunch?.config?.autoStart).toBe(true)
  expect(pendingLaunch?.config?.costConfirmed).toBe(true)
  expect(pendingLaunch?.config?.referenceImages).toHaveLength(1)
})

test('assistant launch is marked to open a new conversation and execute immediately', async ({
  page,
}) => {
  await page.goto('/studio')
  await page.locator('.studio-composer__input').fill('帮我分析这个创意方向')
  await page.locator('.studio-composer__submit').click()
  await expect(page.locator('.ai-cost-confirm-panel')).toBeVisible()
  await page.locator('.ai-cost-confirm-btn.primary').click()

  const pendingLaunch = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('starclouds:pending-prompt') || 'null'),
  )
  expect(pendingLaunch?.taskType).toBe('assistant')
  expect(pendingLaunch?.config?.skill).toBe('agent')
  expect(pendingLaunch?.config?.autoStart).toBe(true)
  expect(pendingLaunch?.config?.costConfirmed).toBe(true)
})
