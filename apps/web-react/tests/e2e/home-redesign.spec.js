import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const runtimeConfig = {
  features: {
    'ai.infiniteCanvas': { enabled: true },
    'ai.assistant': { enabled: true },
    'ai.wallpaperGeneration': { enabled: true },
    'ai.ecommerceDesign': { enabled: true },
    'ai.mediaTools': {
      enabled: true,
      config: {
        tools: [{ id: 'image-upscale', name: '高清放大', modality: 'image', pricePoints: 6 }],
      },
    },
  },
  pageControls: {
    canvas: { status: 'normal' },
    assistant: { status: 'normal' },
    text_to_image: { status: 'normal' },
    illustration_coloring: { status: 'normal' },
    game_art: { status: 'normal' },
  },
}

const creationPageKeys = ['canvas', 'assistant', 'text_to_image', 'illustration_coloring', 'ui_design', 'model_sheet', 'game_art']
const commercePageKeys = ['ecommerce.tryon', 'ecommerce.shoot', 'ecommerce.campaign']
const toolPageKeys = ['media_tools', 'skills', 'psd_decompose', 'ai_tools', 'background_remove', 'image_compress', 'puzzle']

function removedPages(keys) {
  return Object.fromEntries(keys.map(key => [key, { status: 'removed', reason: '已下架' }]))
}

async function mockRuntime(page, overrides = {}) {
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, {
      ...runtimeConfig,
      ...overrides,
      features: { ...runtimeConfig.features, ...overrides.features },
      pageControls: { ...runtimeConfig.pageControls, ...overrides.pageControls },
    }),
  )
}

function expectNoOverlap(first, second, description) {
  const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  expect(overlapWidth > 1 && overlapHeight > 1, description).toBe(false)
}

async function expectCardsFillRows(container, selector) {
  const geometry = await container.evaluate((element, cardSelector) => {
    const bounds = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      left: bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      gap: parseFloat(style.columnGap) || 0,
      cards: [...element.querySelectorAll(cardSelector)].map(card => {
        const rect = card.getBoundingClientRect()
        return { top: rect.top, left: rect.left, right: rect.right }
      }),
    }
  }, selector)
  expect(geometry.cards.length).toBeGreaterThan(0)
  const rows = []
  for (const card of geometry.cards) {
    const row = rows.find(items => Math.abs(items[0].top - card.top) < 1)
    if (row) row.push(card)
    else rows.push([card])
  }
  for (const row of rows) {
    row.sort((first, second) => first.left - second.left)
    expect(row[0].left, 'each visible row should begin at the content edge').toBeCloseTo(geometry.left, 0)
    expect(row.at(-1).right, 'hidden entries should not leave an empty slot at the row end').toBeCloseTo(geometry.right, 0)
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index].left - row[index - 1].right, 'only the configured gap should separate entries')
        .toBeCloseTo(geometry.gap, 0)
    }
  }
}

async function visibleHeroControls(hero) {
  await expect(hero.locator('.home-banner__counter')).not.toBeVisible()
  await expect(hero.locator('.home-banner__play')).toHaveCount(0)
  await expect(hero.getByRole('button', { name: /播放轮播|暂停轮播/ })).toHaveCount(0)
  const controls = {}
  for (const name of ['pagination', 'dots', 'previous', 'next']) {
    const control = hero.locator(`.home-banner__${name}`)
    await expect(control).toBeVisible()
    controls[name] = await control.boundingBox()
  }
  return controls
}

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await mockRuntime(page)
  await page.route('**/api/v1/home-banners', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/pricing**', (route) =>
    fulfillJson(route, {
      taskPointPrices: { t2i: 8, infinite_canvas: 12, ecommerce_design: 10 },
      plans: [],
      paymentEnabled: false,
    }),
  )
})

test('homepage omits decorative English labels and section numbering', async ({ page }) => {
  for (const path of ['/', '/?previewBanners=1']) {
    await page.goto(path)
    const home = page.locator('.commercial-home')
    await expect(home.locator('.home-hero__eyebrow, .home-kicker, .home-section__kind')).toHaveCount(0)
    await expect(home).not.toContainText(/STARCLOUDS AI|CREATIVE STUDIO|THE CREATIVE TOOLKIT|A LITTLE INSPIRATION|COMING NEXT|01 \/ CREATE|02 \/ COMMERCE|03 \/ TOOLS/)
    await expect(home.getByText('你的创作，从这里开始', { exact: true })).toHaveCount(0)
    await expect(home.locator('.home-hero__links')).toBeVisible()
    await expect(home.locator('.home-ideas')).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: '下一张', exact: true })).toBeVisible()
})

test('homepage retains a usable branded hero without promotional banners', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('.home-hero')
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('星空云绘')
  await expect(hero.locator('.home-hero__image')).toHaveAttribute('src', '/sucai/home-intro-03.png')
  await expect.poll(() => hero.locator('.home-hero__image').evaluate((image) =>
    image.complete && image.naturalWidth > 0,
  )).toBe(true)
  await expect(page.locator('.home-banner')).toHaveCount(0)
  await expect(hero.locator('.home-hero__links')).toBeVisible()
  await expect(page.locator('.home-card[href="/canvas"]')).toBeVisible()
  await expect(page.locator('.home-compact[href="/skills"]')).toBeVisible()
  await expect(page.locator('.home-compact[href="/psd-decompose"]')).toBeVisible()
  await expect(page.locator('.commercial-home footer')).toBeVisible()
})

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
]) {
  test(`homepage copy and links fit a ${viewport.width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('.home-hero')).toBeVisible()
    await expect(page.locator('.home-hero h1')).toBeVisible()
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth,
    )).toBeLessThanOrEqual(1)

    for (const selector of ['.home-hero', '.home-hero__visual', '.home-hero__links', '.home-directory']) {
      const bounds = await page.locator(selector).boundingBox()
      expect(bounds, `${selector} should have measurable bounds`).not.toBeNull()
      expect(bounds.x, `${selector} should fit the left edge`).toBeGreaterThanOrEqual(-1)
      expect(bounds.x + bounds.width, `${selector} should fit the right edge`)
        .toBeLessThanOrEqual(viewport.width + 1)
    }

    const hero = await page.locator('.home-hero').boundingBox()
    const visual = await page.locator('.home-hero__visual').boundingBox()
    expect(hero.y, 'the hero should start behind the navbar').toBeCloseTo(0, 0)
    expect(visual, 'the image should fill the entire hero').toEqual(hero)
    expect(visual.width, 'the banner image should fill the viewport width').toBe(viewport.width)
    if (viewport.width === 1920) expect(visual.height).toBe(600)
    if (viewport.width === 1440) expect(visual.height).toBe(560)
    for (const selector of ['.home-hero__copy', '.home-hero h1', '.home-hero__tagline', '.home-hero__links']) {
      const bounds = await page.locator(selector).boundingBox()
      expect(bounds.x, `${selector} should fit within the image's left edge`).toBeGreaterThanOrEqual(visual.x)
      expect(bounds.x + bounds.width, `${selector} should fit within the image's right edge`)
        .toBeLessThanOrEqual(visual.x + visual.width)
      expect(bounds.y, `${selector} should fit within the image's top edge`).toBeGreaterThanOrEqual(visual.y)
      expect(bounds.y + bounds.height, `${selector} should fit within the image's bottom edge`)
        .toBeLessThanOrEqual(visual.y + visual.height)
    }
    const copy = page.locator('.home-hero__copy')
    await expect(copy.locator('h1')).toHaveCount(1)
    await expect(copy.locator('.home-hero__tagline')).toHaveCount(1)
    await expect(copy.locator('.home-hero__links')).toHaveCount(0)
    const copyBounds = await copy.boundingBox()
    const links = await page.locator('.home-hero__links').boundingBox()
    expect(copyBounds.x + copyBounds.width, 'copy should sit to the left of the entry links').toBeLessThanOrEqual(links.x)
    expect(copyBounds.y + copyBounds.height, 'copy and entry links should share their bottom edge')
      .toBeCloseTo(links.y + links.height, 0)
    if (viewport.width <= 640) expect(links.width).toBe(132)

    expect(hero.y + hero.height, 'the first viewport should reveal content after the hero')
      .toBeLessThan(viewport.height)
    await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`), fullPage: true })
  })
}

test('tool sections remain visible without filtering controls or totals', async ({ page }, testInfo) => {
  await page.goto('/')
  const directory = page.locator('.home-directory')
  await expect(directory.locator('.home-directory__controls, .home-directory__total, .home-directory__empty')).toHaveCount(0)
  await expect(page.getByRole('group', { name: '工具分类' })).toHaveCount(0)
  await expect(page.getByLabel('搜索创作工具', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重置筛选', exact: true })).toHaveCount(0)
  await expect(page.locator('#home-creation')).toBeVisible()
  await expect(page.locator('#home-commerce')).toBeVisible()
  await expect(page.locator('#home-tools')).toBeVisible()
  await expect(page.locator('.home-compact[href="/psd-decompose"]')).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const content = await directory.boundingBox()
    const creation = await page.locator('#home-creation').boundingBox()
    expect(creation.y - content.y).toBeGreaterThanOrEqual(0)
    expect(creation.y - content.y).toBeLessThanOrEqual(48)
    await directory.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`tool-sections-${width}.png`) })
  }
})

test('runtime media entries, prices and existing tool destinations are preserved', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home-card[href="/text-to-image"]')).toContainText('8 积分')
  await expect(page.locator('.home-card[href="/canvas"]')).toContainText('12 积分')
  await expect(page.locator('.home-card[href="/ecommerce-design?tool=tryon"]')).toBeVisible()
  await expect(page.locator('.home-card[href="/ecommerce-design?tool=shoot"]')).toBeVisible()
  await expect(page.locator('.home-compact[href="/tools/image-upscale"]')).toContainText('高清放大')
  await expect(page.locator('.home-compact[href="/tools/image-upscale"]')).toContainText('6 积分')
  await page.locator('.home-compact[href="/tools/image-compress"]').click()
  await expect(page).toHaveURL(/\/tools\/image-compress$/)
})

test('removed and unavailable tools remain restricted in the catalog', async ({ page }) => {
  await mockRuntime(page, {
    features: { 'ai.wallpaperGeneration': { enabled: false } },
    pageControls: {
      canvas: { status: 'removed', reason: '已下架' },
      assistant: { status: 'removed', reason: '已下架' },
      ui_design: { status: 'maintenance', reason: '模型升级中' },
      game_art: { status: 'developing', reason: '开发中' },
    },
  })
  await page.goto('/')
  await expect(page.locator('.home-card[href="/canvas"]')).toHaveCount(0)
  await expect(page.locator('.home-card[href="/assistant"]')).toHaveCount(0)
  for (const href of ['/text-to-image', '/design-workshop', '/game-art']) {
    const card = page.locator(`.home-card[href="${href}"]`)
    await expect(card.locator('.home-card__status')).toBeVisible()
    await expect(card.locator('.home-card__price')).toHaveCount(0)
  }
  await expect(page.locator('.home-card[href="/design-workshop"]')).toContainText('模型升级中')
})

test('remaining creation and commerce entries fill the layout when earlier entries are removed', async ({ page }) => {
  await mockRuntime(page, {
    pageControls: removedPages(['canvas', 'assistant', 'illustration_coloring', 'ecommerce.tryon']),
  })
  await page.goto('/')
  const creation = page.locator('#home-creation')
  const commerce = page.locator('#home-commerce')
  await expect(creation.locator('.home-card')).toHaveCount(4)
  await expect(creation.locator('.home-card.is-featured')).toHaveAttribute('href', '/text-to-image')
  await expect(creation.locator('.home-creation-support .home-card')).toHaveCount(3)
  await expect(commerce.locator('.home-card')).toHaveCount(2)
  await expect(commerce.locator('.home-card[href="/ecommerce-design?tool=tryon"]')).toHaveCount(0)
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expectCardsFillRows(creation.locator('.home-creation-support'), '.home-card')
    await expectCardsFillRows(commerce.locator('.home-card-grid'), '.home-card')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  }
})

test('a single remaining entry occupies its section without empty companion slots', async ({ page }) => {
  await mockRuntime(page, {
    pageControls: removedPages([
      ...creationPageKeys.filter(key => key !== 'text_to_image'),
      ...commercePageKeys.filter(key => key !== 'ecommerce.shoot'),
      ...toolPageKeys.filter(key => key !== 'image_compress'),
    ]),
  })
  await page.goto('/')
  await expect(page.locator('#home-creation .home-card')).toHaveCount(1)
  await expect(page.locator('#home-creation .home-card.is-featured')).toHaveAttribute('href', '/text-to-image')
  await expect(page.locator('.home-creation-support')).toHaveCount(0)
  await expect(page.locator('#home-commerce .home-card')).toHaveCount(1)
  await expect(page.locator('#home-tools .home-compact')).toHaveCount(1)
  await expect(page.locator('#home-tools .home-compact')).toHaveAttribute('href', '/tools/image-compress')
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expectCardsFillRows(page.locator('.home-creation-layout'), '.home-card')
    await expectCardsFillRows(page.locator('#home-commerce .home-card-grid'), '.home-card')
    await expectCardsFillRows(page.locator('.home-compact-grid'), '.home-compact')
  }
})

test('removing every catalog entry leaves no empty sections or directory gap', async ({ page }) => {
  await mockRuntime(page, { pageControls: removedPages([...creationPageKeys, ...commercePageKeys, ...toolPageKeys]) })
  await page.goto('/')
  const directory = page.locator('#home-directory')
  await expect(directory).toHaveCount(1)
  await expect(page.locator('#home-creation, #home-commerce, #home-tools')).toHaveCount(0)
  await expect(directory.locator('.home-card, .home-compact, .home-creation-layout, .home-compact-grid')).toHaveCount(0)
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await directory.evaluate(element => element.getBoundingClientRect().height), 'empty catalog padding should collapse')
      .toBeLessThanOrEqual(1)
  }
  await expect(page.locator('.home-hero')).toBeVisible()
  await expect(page.locator('.home-upcoming')).toBeVisible()
  await expect(page.locator('.home-footer')).toBeVisible()
})

test('homepage removes inspiration and keeps a minimal footer brand', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.home-ideas')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '下一份灵感，正在发生' })).toHaveCount(0)
  const brand = page.locator('.home-footer__brand')
  await expect(brand).toHaveText('星空云绘')
  await expect(brand.locator('img')).toHaveAttribute('src', '/brand/starcloud-logo.svg')
  await expect(brand.locator('p, svg')).toHaveCount(0)
  await expect.poll(() => brand.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const tools = await page.locator('#home-tools').boundingBox()
    const news = await page.locator('.home-news').boundingBox()
    expect(news.y - tools.y - tools.height).toBeLessThan(100)
    await brand.scrollIntoViewIfNeeded()
    expect(await brand.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`minimal-footer-${width}.png`) })
  }
})

test('the homepage remains readable in dark mode with reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('walleven-color-scheme', 'dark'))
  await page.reload()
  const home = page.locator('.commercial-home')
  await expect(home).toHaveClass(/is-dark/)
  await expect(page.locator('.home-hero h1')).toBeVisible()
  await expect.poll(() => page.locator('.home-hero h1').evaluate((heading) =>
    Number(getComputedStyle(heading).opacity),
  )).toBe(1)
  await expect(page.locator('#home-creation')).toBeVisible()
  await expect(page.locator('#home-commerce')).toBeVisible()
  await expect(page.locator('#home-tools')).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth,
  )).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('home-dark-mobile.png'), fullPage: true })
})

test('catalog sections stay static on scroll, hover and after returning to the homepage', async ({ page }) => {
  // GSAP's ticker needs Date.now to advance, unlike static screenshot fixtures.
  await page.clock.setSystemTime(new Date('2026-08-11T12:00:00+08:00'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect.poll(() => page.locator('.home-hero h1').evaluate((heading) =>
    Number(getComputedStyle(heading).opacity),
  )).toBe(1)
  const directory = page.locator('#home-directory')
  await expect(page.locator('.commercial-home')).toHaveCSS('opacity', '1')
  await expect(directory).toHaveCSS('transform', 'none')
  await page.evaluate(() => document.documentElement.classList.add('settings-no-animations'))
  await expect(page.locator('.commercial-home')).toHaveAttribute('data-motion', 'off')
  await page.evaluate(() => document.documentElement.classList.remove('settings-no-animations'))
  await expect(page.locator('.commercial-home')).toHaveAttribute('data-motion', 'on')
  await expect(page.locator('.commercial-home')).toHaveCSS('opacity', '1')
  await expect(directory).toHaveCSS('transform', 'none')
  await expect(directory.locator('[data-home-reveal]')).toHaveCount(0)
  await expect(directory.locator('button, [aria-roledescription="carousel"]')).toHaveCount(0)
  for (const id of ['creation', 'commerce', 'tools']) {
    const section = page.locator(`#home-${id}`)
    await expect(section).toHaveClass(new RegExp(`home-section--${id}`))
    await section.scrollIntoViewIfNeeded()
    const movingFrames = await section.evaluate(async element => {
      let moving = 0
      for (let frame = 0; frame < 16; frame += 1) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        const cards = [...element.querySelectorAll('.home-card, .home-compact')]
        if (cards.some(card => {
          const style = getComputedStyle(card)
          return style.transform !== 'none' || Number(style.opacity) !== 1
        })) moving += 1
      }
      return moving
    })
    expect(movingFrames, `${id} entries should be visible and stationary throughout scrolling`).toBe(0)
    const card = section.locator('.home-card, .home-compact').first()
    await card.hover()
    await expect(card).toHaveCSS('transform', 'none')
    const image = card.locator('.home-card__media img')
    if (await image.count()) await expect(image).toHaveCSS('transform', 'none')
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await directory.locator('.home-creation-layout, .home-creation-support, .home-card-grid, .home-compact-grid')
      .evaluateAll(elements => elements.map(element => ({
        overflow: element.scrollWidth - element.clientWidth,
        scrollable: ['auto', 'scroll'].includes(getComputedStyle(element).overflowX),
        snap: getComputedStyle(element).scrollSnapType,
      })))
    expect(layout.every(item => item.overflow <= 1 && !item.scrollable && item.snap === 'none')).toBe(true)
  }
  const tools = page.locator('#home-tools')
  await tools.scrollIntoViewIfNeeded()
  await expect(tools.getByRole('heading')).toBeVisible()
  const link = page.locator('.home-compact[href="/tools/image-compress"]')
  await expect.poll(() => link.evaluate((element) =>
    Number(getComputedStyle(element).opacity),
  )).toBe(1)
  await link.click()
  await expect(page).toHaveURL(/\/tools\/image-compress$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.locator('.home-hero h1').evaluate((heading) =>
    Number(getComputedStyle(heading).opacity),
  )).toBe(1)
  await page.locator('#home-creation').scrollIntoViewIfNeeded()
  await expect(page.locator('.home-card[href="/canvas"]')).toBeVisible()
  await expect(page.locator('.home-card[href="/canvas"]')).toHaveCSS('transform', 'none')
  await expect(page.locator('#home-directory [data-home-reveal]')).toHaveCount(0)
})

test('homepage uses the studio palette and rounded card styles', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.commercial-home')).toHaveCSS('background-color', 'rgb(245, 242, 251)')
  await expect(page.locator('.home-hero h1')).toHaveCSS('font-weight', '700')
  await expect(page.locator('.home-card').first()).toHaveCSS('border-radius', '24px')
  await expect(page.locator('#home-tools')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.home-compact').first()).toHaveCSS('border-radius', '14px')
  const card = await page.locator('.home-card').first().boundingBox()
  const copy = await page.locator('.home-card__body').first().boundingBox()
  expect(copy.y + copy.height, 'the image-card copy should share its bottom edge').toBeCloseTo(card.y + card.height, 0)
  expect(copy.x).toBeGreaterThanOrEqual(card.x)
  expect(copy.x + copy.width).toBeLessThanOrEqual(card.x + card.width)
  expect(copy.y).toBeGreaterThan(card.y)
  const toolArt = page.locator('.home-compact .home-tool-art')
  await expect(toolArt).toHaveCount(0)
})

test('homepage image reaches the viewport top behind the navbar', async ({ page }, testInfo) => {
  await page.addInitScript(() => document.documentElement.style.setProperty('--app-page-content-top-gap', '48px'))
  await page.goto('/')
  const home = page.locator('.home-catalog')
  await expect(home).toHaveCSS('background-image', 'none')
  await expect(home).toHaveCSS('padding-top', '0px')
  const navbar = page.locator('.site-header')
  await expect(navbar).toHaveClass(/is-home-overlay/)
  await expect(navbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  for (const [width, height] of [[1920, 1080], [1440, 900], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(async () => Math.abs((await page.locator('.home-hero').boundingBox()).y)).toBeLessThan(1)
    const header = await navbar.boundingBox()
    const visual = await page.locator('.home-hero__visual').boundingBox()
    const image = await page.locator('.home-hero__image').boundingBox()
    const heading = await page.locator('.home-hero h1').boundingBox()
    expect(heading.y).toBeGreaterThan(header.y + header.height)
    expect(visual.y).toBeCloseTo(header.y, 0)
    expect(visual.y + visual.height).toBeGreaterThan(header.y + header.height)
    expect(image.y).toBeCloseTo(visual.y, 0)
    expect(image.height).toBeCloseTo(visual.height, 1)
    await expect(page.locator('.home-hero__image')).toHaveCSS('object-fit', 'cover')
    await expect(page.locator('.home-hero__image')).toHaveCSS('filter', 'none')
    await expect(page.locator('.home-hero__image')).toHaveCSS('transform', 'none')
    if (width === 390) {
      await page.getByRole('button', { name: '打开主导航', exact: true }).click()
      await expect(navbar).toHaveClass(/is-home-overlay/)
      await expect(navbar).toHaveClass(/is-dark/)
      await page.getByRole('button', { name: '关闭主导航', exact: true }).click()
    }
    await page.screenshot({ path: testInfo.outputPath(`home-overlay-${width}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('label[title="切换暗色模式"]').click()
  await expect(home).toHaveClass(/is-dark/)
  await expect(home).toHaveCSS('background-image', 'none')
  await page.locator('#home-creation').scrollIntoViewIfNeeded()
  await expect(navbar).not.toHaveClass(/is-home-overlay/)
  await expect(navbar).toHaveClass(/is-scrolled/)
  await page.locator('.home-compact[href="/tools/image-compress"]').click()
  await expect(page).toHaveURL(/\/tools\/image-compress$/)
  await expect(navbar).not.toHaveClass(/is-home-overlay/)
})

test('long compact tool names and prices never overlap', async ({ page }) => {
  await mockRuntime(page, { features: { 'ai.mediaTools': { enabled: true, config: { tools: [
    { id: 'long-upscale', name: '超高清多场景智能图像增强工具', pricePoints: 1234567 },
  ] } } } })
  await page.goto('/')
  const card = page.locator('.home-compact[href="/tools/long-upscale"]')
  for (const width of [1440, 1024, 768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await card.evaluate(el => {
      const title = el.querySelector('strong').getBoundingClientRect()
      const price = el.querySelector('.home-card__price').getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      return {
        overlaps: Math.min(title.right, price.right) > Math.max(title.left, price.left) + 1
          && Math.min(title.bottom, price.bottom) > Math.max(title.top, price.top) + 1,
        fits: title.left >= rect.left && title.right <= rect.right && price.right <= rect.right,
      }
    })
    expect(geometry).toEqual({ overlaps: false, fits: true })
  }
})

test('card titles, descriptions and vector icons stay crisp and aligned', async ({ page }, testInfo) => {
  await page.goto('/')
  const cards = page.locator('.home-card')
  await expect(cards.first()).toBeVisible()
  await expect(page.locator('.home-card__icon')).toHaveCount(0)
  await expect(page.locator('.home-compact__icon > i')).toHaveCount(0)
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await cards.evaluateAll(nodes => nodes.map(card => {
      const inside = rect => rect.left >= box.left - 1 && rect.right <= box.right + 1
        && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
      const overlaps = (first, second) => Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1
        && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1
      const title = card.querySelector('.home-card__heading strong')
      const arrow = card.querySelector('.home-card__arrow')
      const description = card.querySelector('.home-card__description')
      const badge = card.querySelector('.home-card__price, .home-card__status')
      const box = card.getBoundingClientRect()
      const headingBox = title.getBoundingClientRect()
      const arrowBox = arrow?.getBoundingClientRect()
      const descriptionBox = description.getBoundingClientRect()
      const badgeBox = badge?.getBoundingClientRect()
      return {
        href: card.getAttribute('href'),
        fits: title.scrollWidth <= title.clientWidth + 1 && inside(headingBox) && inside(descriptionBox)
          && (!badgeBox || inside(badgeBox)),
        aligned: !arrowBox?.width || Math.abs(arrowBox.top + arrowBox.height / 2 - headingBox.top - headingBox.height / 2) < 1,
        copySeparated: !overlaps(headingBox, descriptionBox),
        badgeSeparated: !badgeBox || (!overlaps(badgeBox, headingBox) && !overlaps(badgeBox, descriptionBox)
          && (!arrowBox?.width || !overlaps(badgeBox, arrowBox))),
        stroke: arrow?.querySelector('svg').getAttribute('stroke-width') || '1.75',
      }
    }))
    for (const card of geometry) {
      expect(card, `${card.href} copy, arrow and price should stay separate at ${width}px`).toMatchObject({
        fits: true, aligned: true, copySeparated: true, badgeSeparated: true, stroke: '1.75',
      })
    }
    await page.locator('#home-creation').scrollIntoViewIfNeeded()
    if (width === 1440 || width === 390) {
      await page.screenshot({ path: testInfo.outputPath(`card-details-${width}.png`) })
    }
  }
})

test('unavailable image cards keep their status but do not show an action arrow', async ({ page }) => {
  await mockRuntime(page, { pageControls: { game_art: { status: 'developing', reason: '开发中' } } })
  await page.goto('/')
  const card = page.locator('.home-card[href="/game-art"]')
  await expect(card.locator('.home-card__status svg')).toHaveCount(1)
  await expect(card.locator('.home-card__icon')).toHaveCount(0)
  await expect(card.locator('.home-card__arrow')).toHaveCount(0)
  await expect(card.locator('.home-card__price')).toHaveCount(0)
})

test('failed covers retain readable cards and their destinations', async ({ page }) => {
  await page.route('**/sucai/canvas-hero.webp', route => route.fulfill({ status: 404, body: '' }))
  await page.route('**/sucai/studio-cover-game.webp', route => route.fulfill({ status: 404, body: '' }))
  await page.goto('/')
  for (const [href, title] of [['/canvas', '无限画布'], ['/game-art', '游戏设计']]) {
    const card = page.locator(`.home-card[href="${href}"]`)
    await card.scrollIntoViewIfNeeded()
    await expect(card.locator('.home-cover-fallback')).toBeVisible()
    await expect(card.locator('strong')).toHaveText(title)
    await expect(card).toHaveAttribute('href', href)
  }
})

test('maintenance explanations stay within their image cards', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const reason = '模型资源正在升级维护，请稍后再试。'.repeat(10)
  await mockRuntime(page, { pageControls: { ui_design: { status: 'maintenance', reason } } })
  await page.goto('/')
  const card = page.locator('.home-card[href="/design-workshop"]')
  await expect(card.locator('.home-card__body small')).toHaveAttribute('title', reason)
  await expect(card.locator('.home-card__body small')).toHaveCSS('-webkit-line-clamp', '2')
  expect(await card.evaluate(el => el.querySelector('.home-card__body').getBoundingClientRect().top
    > el.querySelector('.home-card__status').getBoundingClientRect().bottom)).toBe(true)
})

test('long and short carousel copy keep navigation controls in place', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
    { id: 'short-copy', title: '星空云绘', subtitle: '让想象成为作品。', imageUrl: '/sucai/home-intro-03.png' },
    { id: 'long-copy', title: '从每一个天马行空的想法开始探索你的无限创意可能', subtitle: '从图像、设计到商品视觉，每一种创意都有新的表达。'.repeat(3), imageUrl: '/sucai/studio-cover-ecom-create.webp', linkUrl: '/studio', buttonText: '进入创作台' },
  ] }))
  await page.goto('/')
  const hero = page.locator('.home-hero')
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('button', { name: '第 1 张：星空云绘', exact: true }).click()
    const before = await visibleHeroControls(hero)
    const heroBefore = await hero.boundingBox()
    await page.getByRole('button', { name: '下一张', exact: true }).click()
    const after = await visibleHeroControls(hero)
    const heroAfter = await hero.boundingBox()
    expect(heroAfter.height).toBe(heroBefore.height)
    const copy = await page.locator('.home-hero__copy').boundingBox()
    const links = await page.locator('.home-hero__links').boundingBox()
    expect(copy.x + copy.width).toBeLessThanOrEqual(links.x)
    expect(copy.y + copy.height).toBeCloseTo(links.y + links.height, 0)
    for (const [name, bounds] of Object.entries(after)) {
      expect(bounds.x, `${name} should keep its horizontal position when the slide changes`).toBeCloseTo(before[name].x, 0)
      expect(bounds.y, `${name} should keep its vertical position when the slide changes`).toBeCloseTo(before[name].y, 0)
      expect(bounds.height).toBe(before[name].height)
      expect(bounds.x).toBeGreaterThanOrEqual(heroAfter.x)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(heroAfter.x + heroAfter.width)
      expect(bounds.y).toBeGreaterThanOrEqual(heroAfter.y)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(heroAfter.y + heroAfter.height)
      expectNoOverlap(bounds, copy, `${name} should not overlap long copy`)
      expectNoOverlap(bounds, links, `${name} should not overlap the entry links`)
    }
    expect(after.pagination.x + after.pagination.width / 2).toBeCloseTo(heroAfter.x + heroAfter.width / 2, 0)
    expect(after.dots.x + after.dots.width / 2).toBeCloseTo(after.pagination.x + after.pagination.width / 2, 0)
    if (width <= 800) {
      expect(after.pagination.y + after.pagination.height).toBeLessThanOrEqual(Math.min(copy.y, links.y))
      expect(copy.y + copy.height - after.pagination.y - after.pagination.height).toBeCloseTo(width <= 640 ? 116 : 156, 0)
    } else {
      expect(after.pagination.y + after.pagination.height).toBeCloseTo(heroAfter.y + heroAfter.height, 0)
    }
  }
})
