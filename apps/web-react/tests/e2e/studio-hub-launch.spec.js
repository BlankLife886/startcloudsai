import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { fulfillJson } from './helpers/authMocks.js'

const t2iModels = [
  {
    id: 'gpt-image-2',
    label: 'gpt-image-2',
    default: true,
    pricePoints: 3,
    standardPricePoints: 20,
    discountPricePoints: 3,
    resolutions: ['1K', '2K', '4K'],
    qualities: ['low', 'medium', 'high'],
    aspectRatios: ['1:1', '3:2', '16:9'],
  },
]

const assistantConfig = {
  conversationModels: [
    {
      model: 'chat-pro',
      label: 'Chat Pro',
      pricePoints: 8,
      standardPricePoints: 16,
      discountPricePoints: 8,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      reasoningEfforts: [
        { id: 'low', label: '低', pricePoints: 4, standardPricePoints: 8, discountPricePoints: 4 },
        { id: 'medium', label: '中', pricePoints: 8, standardPricePoints: 16, discountPricePoints: 8 },
        { id: 'high', label: '高', pricePoints: 16, standardPricePoints: 24 },
      ],
    },
  ],
  imageModels: [
    {
      model: 'image-pro',
      label: 'Image Pro',
      pricePoints: 12,
      standardPricePoints: 20,
      discountPricePoints: 12,
    },
  ],
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/v1/auth/session', (route) =>
    fulfillJson(route, {
      user: { id: 'studio-user', username: '创作台测试', role: 'user' },
    }),
  )
  await page.route('**/api/v1/me/wallet', (route) =>
    fulfillJson(route, { normalBalanceCents: 999, availableCents: 999 }),
  )
  await page.route('**/api/v1/pricing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { taskPointPrices: { t2i: 3 } } }),
    }),
  )
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, {
      features: {
        'ai.wallpaperGeneration': { enabled: true, config: { publicModels: t2iModels } },
        wallpaper: { enabled: true, config: { publicModels: t2iModels } },
      },
    }),
  )
  await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, assistantConfig))
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
  await expect(page.locator('.studio-bento__item')).toHaveCount(6)
  await expect(page.locator('.studio-bento__item.is-model')).toHaveAttribute('href', '/model-sheet')
  await expect(page.locator('.studio-bento__item.is-coloring')).toHaveAttribute('href', '/ai-illustration-coloring')
  await expect(page.locator('.studio-bento__item.is-ui')).toHaveAttribute('href', '/design-workshop')
  await expect(page.locator('.studio-bento__item.is-game')).toHaveAttribute('href', '/game-art')
  await expect(page.getByText('开发中', { exact: true })).toHaveCount(0)

  await composerTools.locator('.bi-stars').locator('..').click()
  await page.locator('.studio-composer__control.is-field.is-skill').click()
  const skillOptions = page.locator('.studio-composer__field-menu > button')
  await skillOptions.nth(2).click()
  await skillOptions.nth(4).click()

  await expect(page.locator('.studio-composer__field-menu')).toBeVisible()
  await expect(page.locator('.studio-composer__field-menu > button.is-selected')).toHaveCount(3)
  await expect(page.locator('.studio-composer__control.is-field.is-skill')).toContainText('3')
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

test('text-to-image models show points without auto matching', async ({ page }) => {
  await page.goto('/studio')
  await page.locator('.studio-composer__control.is-workflow').click()
  await page.locator('.studio-composer__tool-menu .bi-stars').locator('..').click()
  await expect(page.locator('.studio-composer__control.is-field.is-model')).toContainText('gpt-image-2')
  await expect(page.locator('.studio-composer__control.is-field.is-model')).toContainText('折扣 3积分')
  await page.locator('.studio-composer__control.is-field.is-model').click()
  const modelMenu = page.locator('.studio-composer__field-menu.is-model')
  await expect(modelMenu).toBeVisible()
  await expect(modelMenu).toContainText('gpt-image-2')
  await expect(modelMenu).toContainText('折扣 3 积分/张')
  await expect(modelMenu).toContainText('20 积分/张')
  await expect(modelMenu).not.toContainText('自动匹配')
})

test('assistant creation types include Q&A and show model points plus reasoning', async ({
  page,
}) => {
  await page.goto('/studio')
  await page.locator('.studio-composer__control.is-field.is-skill').click()
  const skillMenu = page.locator('.studio-composer__field-menu.is-skill')
  await expect(skillMenu).toContainText('问答模式')
  await expect(skillMenu).toContainText('Agent 模式')
  await expect(skillMenu).toContainText('图片生成')
  await skillMenu.getByRole('option', { name: /^问答模式/ }).click()

  await expect(page.locator('.studio-composer__control.is-field.is-model')).toContainText('Chat Pro')
  await expect(page.locator('.studio-composer__control.is-field.is-model')).toContainText('折扣 4积分')
  await expect(page.locator('.studio-composer__control.is-field.is-reasoning')).toContainText('低')
  await page.locator('.studio-composer__control.is-field.is-model').click()
  const modelMenu = page.locator('.studio-composer__field-menu.is-model')
  await expect(modelMenu).toContainText('Chat Pro')
  await expect(modelMenu).toContainText('折扣 4 积分')
  await expect(modelMenu).toContainText('推理强度 3 档')
  await expect(modelMenu).not.toContainText('自动匹配')

  await page.locator('.studio-composer__control.is-field.is-reasoning').click()
  const reasoningMenu = page.locator('.studio-composer__field-menu.is-reasoning')
  await expect(reasoningMenu).toContainText('低')
  await expect(reasoningMenu).toContainText('中')
  await expect(reasoningMenu).toContainText('高')
  await expect(reasoningMenu).toContainText('折扣 4 积分')
})

test('assistant Q&A launch keeps chat mode and reasoning effort', async ({ page }) => {
  await page.goto('/studio')
  await page.locator('.studio-composer__control.is-field.is-skill').click()
  await page.locator('.studio-composer__field-menu.is-skill').getByRole('option', { name: /^问答模式/ }).click()
  await expect(page.locator('.studio-composer__control.is-field.is-model')).toContainText('Chat Pro')
  await expect(page.locator('.studio-composer__control.is-field.is-reasoning')).toContainText('低')
  await page.locator('.studio-composer__input').fill('只回答这个问题，不要生图')
  await page.locator('.studio-composer__submit').click()
  await expect(page.locator('.ai-cost-confirm-panel')).toBeVisible()
  await page.locator('.ai-cost-confirm-btn.primary').click()

  const pendingLaunch = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('starclouds:pending-prompt') || 'null'),
  )
  expect(pendingLaunch?.taskType).toBe('assistant')
  expect(pendingLaunch?.config).toMatchObject({
    skill: 'chat',
    mode: 'chat',
    model: 'chat-pro',
    reasoningEffort: 'low',
    autoStart: true,
    costConfirmed: true,
  })
})

test('assistant launch is marked to open a new conversation and execute immediately', async ({
  page,
}) => {
  await page.goto('/studio')
  await expect(page.locator('.studio-composer__control.is-field.is-model')).toContainText('Chat Pro')
  await expect(page.locator('.studio-composer__control.is-field.is-reasoning')).toContainText('低')
  await page.locator('.studio-composer__input').fill('帮我分析这个创意方向')
  await page.locator('.studio-composer__submit').click()
  await expect(page.locator('.ai-cost-confirm-panel')).toBeVisible()
  await page.locator('.ai-cost-confirm-btn.primary').click()

  const pendingLaunch = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('starclouds:pending-prompt') || 'null'),
  )
  expect(pendingLaunch?.taskType).toBe('assistant')
  expect(pendingLaunch?.config?.skill).toBe('agent')
  expect(pendingLaunch?.config?.model).toBe('chat-pro')
  expect(pendingLaunch?.config?.reasoningEffort).toBe('low')
  expect(pendingLaunch?.config?.autoStart).toBe(true)
  expect(pendingLaunch?.config?.costConfirmed).toBe(true)
})

test('assistant image mode exposes model-driven generation params and launches with them', async ({
  page,
}) => {
  await page.goto('/studio')
  await page.locator('.studio-composer__control.is-field.is-skill').click()
  await page.locator('.studio-composer__field-menu').getByRole('option', { name: /^图片生成/ }).click()

  await expect(page.locator('.studio-composer__control.is-field.is-ratio')).toBeVisible()
  await expect(page.locator('.studio-composer__control.is-field.is-resolution')).toBeVisible()
  await expect(page.locator('.studio-composer__control.is-field.is-count')).toBeVisible()

  await page.locator('.studio-composer__control.is-field.is-ratio').click()
  await page.locator('.studio-composer__field-menu.is-ratio').getByRole('option', { name: /16:9/ }).click()
  await page.locator('.studio-composer__control.is-field.is-resolution').click()
  await page.locator('.studio-composer__field-menu.is-resolution').getByRole('option', { name: '2K' }).click()
  await page.locator('.studio-composer__control.is-field.is-count').click()
  await page.locator('.studio-composer__field-menu.is-count').getByRole('option', { name: /3/ }).click()

  await page.locator('.studio-composer__input').fill('生成横版品牌主视觉')
  await page.locator('.studio-composer__submit').click()
  await expect(page.locator('.ai-cost-confirm-panel')).toBeVisible()
  await page.locator('.ai-cost-confirm-btn.primary').click()

  const pendingLaunch = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('starclouds:pending-prompt') || 'null'),
  )
  expect(pendingLaunch?.taskType).toBe('assistant')
  expect(pendingLaunch?.config).toMatchObject({
    skill: 'image',
    mode: 'image',
    ratio: '16:9',
    resolution: '2K',
    count: 3,
    quality: 'medium',
    autoStart: true,
    costConfirmed: true,
  })
})
