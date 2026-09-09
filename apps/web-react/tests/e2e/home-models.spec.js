import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const models = Array.from({ length: 18 }, (_, index) => ({
  id: `home-model-${index + 1}`,
  name: `创作模型 ${String(index + 1).padStart(2, '0')} Pro`,
  provider: 'starclouds',
  modality: ['image', 'text', 'video', 'audio'][index % 4],
  enabled: true,
  isPublic: true,
}))
const canvasModel = { id: 'canvas-reasoning', label: '画布推理模型', enabled: true }
const runtimeConfig = {
  aiModelCatalog: { providers: [], models, publicModels: [], featurePublicModels: [] },
  features: {
    'ai.infiniteCanvas': { enabled: true, config: { textModels: [canvasModel] } },
    'ai.assistant': { enabled: true },
    'ai.wallpaperGeneration': { enabled: true },
  },
  pageControls: {},
}

async function mockRuntime(page, config = runtimeConfig) {
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, config))
}

async function openHomepage(page) {
  await Promise.all([
    page.waitForResponse('**/api/v1/runtime-config'),
    page.goto('/'),
  ])
  await expect(page.getByRole('heading', { name: 'AI 创作', exact: true })).toBeVisible()
}

function marqueeLocators(page) {
  const marquee = page.getByRole('region', { name: '当前可用模型', exact: true })
  return {
    marquee,
    viewport: marquee.locator('.home-model-marquee__viewport'),
    track: marquee.locator('.home-model-marquee__track'),
    groups: marquee.locator('.home-model-marquee__group'),
  }
}

async function offset(viewport) {
  return viewport.evaluate(element => {
    const track = element.querySelector('.home-model-marquee__track')
    return element.scrollLeft - new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
  })
}

async function expectPaused(viewport) {
  const positions = await viewport.evaluate(async element => {
    const track = element.querySelector('.home-model-marquee__track')
    const position = () => element.scrollLeft - new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
    // Let the observer/event handler settle before sampling multiple real frames.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const values = [position()]
    for (let sample = 0; sample < 3; sample += 1) {
      await new Promise(resolve => setTimeout(resolve, 80))
      values.push(position())
    }
    return values
  })
  expect(Math.max(...positions) - Math.min(...positions), 'the model strip should remain still').toBeLessThan(0.5)
}

async function expectMoving(viewport) {
  const start = await offset(viewport)
  await expect.poll(async () => Math.abs(await offset(viewport) - start))
    .toBeGreaterThan(3)
}

async function enableMotion(page) {
  // The visual baseline freezes Date.now; GSAP needs the clock to advance.
  await page.clock.setSystemTime(new Date('2026-08-11T12:00:00+08:00'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await mockRuntime(page)
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [] }))
})

test('current models appear once for assistive technology between the banner and AI creation', async ({ page }) => {
  await enableMotion(page)
  await openHomepage(page)
  const { marquee, viewport, groups } = marqueeLocators(page)
  await expect(marquee).toBeVisible()
  await expect(viewport).toHaveAttribute('tabindex', '0')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(1)).toHaveAttribute('aria-hidden', 'true')
  await expect(marquee.getByRole('list')).toHaveCount(1)
  await expect(marquee.getByRole('listitem')).toHaveCount(models.length + 1)
  const ids = await groups.first().locator('[data-model-id]')
    .evaluateAll(items => items.map(item => item.dataset.modelId))
  expect(ids).toEqual([...models.map(model => model.id), canvasModel.id])
  for (const model of models) {
    await expect(groups.first().locator(`[data-model-id="${model.id}"]`)).toContainText(model.name)
  }
  await expect(groups.first().locator(`[data-model-id="${canvasModel.id}"]`)).toContainText(canvasModel.label)
  expect(await marquee.evaluate(element => ({
    previousIsHero: element.previousElementSibling?.classList.contains('home-hero'),
    nextId: element.nextElementSibling?.id,
  }))).toEqual({ previousIsHero: true, nextId: 'home-directory' })
  await expect(page.locator('#home-creation .home-card[href="/canvas"]')).toBeVisible()
  await expect(page.locator('#home-creation .home-card[href="/assistant"]')).toBeVisible()
  await expect(marquee.locator('input, button')).toHaveCount(0)
})

test('model strip stays shallow and full width without expanding the page on desktop and mobile', async ({ page }, testInfo) => {
  await openHomepage(page)
  const { marquee, viewport } = marqueeLocators(page)
  for (const width of [1920, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 })
    await expect(marquee).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1)
    const bounds = await marquee.boundingBox()
    expect(bounds.x).toBeCloseTo(0, 0)
    expect(bounds.width).toBeCloseTo(width, 0)
    expect(bounds.height).toBe(width <= 640 ? 76 : 88)
    expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    const creation = await page.locator('#home-creation').boundingBox()
    expect(creation.y, 'the model strip must not cover the creation section')
      .toBeGreaterThanOrEqual(bounds.y + bounds.height)
    if (width === 1440 || width === 390) {
      await page.screenshot({ path: testInfo.outputPath(`home-model-strip-${width}.png`) })
    }
  }
})

test('an empty model catalog leaves no strip or empty section above AI creation', async ({ page }) => {
  await mockRuntime(page, { ...runtimeConfig, aiModelCatalog: { models: [] }, features: {} })
  await openHomepage(page)
  await expect(page.locator('.home-model-marquee')).toHaveCount(0)
  expect(await page.locator('.home-hero').evaluate(element => element.nextElementSibling?.id))
    .toBe('home-directory')
  await expect(page.locator('#home-creation .home-card[href="/canvas"]')).toBeVisible()
})

test('autoscroll pauses on hover, focus and offscreen while drag and keyboard browsing remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await enableMotion(page)
  await openHomepage(page)
  const { marquee, viewport } = marqueeLocators(page)
  await expect(marquee).toHaveAttribute('data-motion', 'on')
  await page.mouse.move(0, 999)
  await expectMoving(viewport)

  await viewport.hover()
  await expectPaused(viewport)
  await page.mouse.move(0, 999)
  await viewport.focus()
  await expectPaused(viewport)
  const beforeKeyboard = await offset(viewport)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => await offset(viewport) - beforeKeyboard).toBeGreaterThan(30)
  await expectPaused(viewport)
  const afterRight = await offset(viewport)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => afterRight - await offset(viewport)).toBeGreaterThan(30)

  const bounds = await viewport.boundingBox()
  const beforeDrag = await offset(viewport)
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.6 - 180, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs(await offset(viewport) - beforeDrag)).toBeGreaterThan(100)
  await expectPaused(viewport)

  await viewport.evaluate(element => element.blur())
  await page.mouse.move(0, 999)
  await expectMoving(viewport)
  await page.locator('.home-footer').scrollIntoViewIfNeeded()
  await expect(marquee).not.toBeInViewport()
  await expectPaused(viewport)
  await marquee.scrollIntoViewIfNeeded()
  await expectMoving(viewport)
})

for (const setting of ['system preference', 'site setting']) {
  test(`${setting} disables automatic scrolling and preserves a single natively scrollable model list`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    if (setting === 'site setting') await enableMotion(page)
    await openHomepage(page)
    const { marquee, viewport, groups } = marqueeLocators(page)
    if (setting === 'site setting') {
      await expect(marquee).toHaveAttribute('data-motion', 'on')
      await viewport.focus()
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await expectPaused(viewport)
      const browsedOffset = await offset(viewport)
      expect(browsedOffset).toBeGreaterThan(300)
      await page.evaluate(() => document.documentElement.classList.add('settings-no-animations'))
      await expect(marquee).toHaveAttribute('data-motion', 'off')
      await expect.poll(async () => Math.abs(await offset(viewport) - browsedOffset), {
        message: 'disabling animation should preserve the models currently being viewed',
      }).toBeLessThanOrEqual(1)
    }
    await expect(marquee).toHaveAttribute('data-motion', 'off')
    await expect(groups.nth(1)).toBeHidden()
    await expect(marquee.getByRole('listitem')).toHaveCount(models.length + 1)
    await expectPaused(viewport)
    expect(await viewport.evaluate(element => getComputedStyle(element).overflowX)).toMatch(/auto|scroll/)
    await viewport.focus()
    const beforeNativeKeyboard = await viewport.evaluate(element => element.scrollLeft)
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => await viewport.evaluate(element => element.scrollLeft) - beforeNativeKeyboard)
      .toBeGreaterThan(30)
    // The last model remains reachable without enabling animation.
    await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth })
    await expect(groups.first().locator(`[data-model-id="${canvasModel.id}"]`)).toBeInViewport()
    await expectPaused(viewport)

    if (setting === 'site setting') {
      const nativeOffset = await offset(viewport)
      await viewport.hover()
      await viewport.evaluate(element => element.blur())
      await page.evaluate(() => document.documentElement.classList.remove('settings-no-animations'))
      await expect(marquee).toHaveAttribute('data-motion', 'on')
      await expect.poll(async () => Math.abs(await offset(viewport) - nativeOffset), {
        message: 'restoring animation should keep the position reached with native scrolling',
      }).toBeLessThanOrEqual(1)
      // No new pointerenter fires while the pointer remains inside during the switch.
      await expectPaused(viewport)
      await page.mouse.move(0, 0)
      await expectMoving(viewport)
    }
  })
}
