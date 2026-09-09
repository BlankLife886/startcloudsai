import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const slides = [
  { id: 'one', title: '星空云绘', subtitle: '从一个想法，到一幅作品。', imageUrl: '/sucai/studio-cover-t2i.webp', linkUrl: '/text-to-image', buttonText: '开始创作', active: true, durationMs: 3000 },
  { id: 'two', title: 'AI 电商设计', subtitle: '让商品拥有自己的视觉语言。', imageUrl: '/sucai/studio-cover-ecom-create.webp', linkUrl: 'https://example.com/design', newTab: true, active: true, durationMs: 3000 },
]

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await page.clock.setSystemTime(new Date('2026-08-11T12:00:00+08:00'))
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: slides }))
})

async function expectDefaultHero(page) {
  const hero = page.locator('.home-hero')
  await expect(hero).toBeVisible()
  await expect(hero).toHaveAttribute('data-banners-source', 'default')
  await expect(page.locator('.home-banner')).toHaveCount(0)
  await expect(hero.locator('h1')).toHaveText('星空云绘')
  await expect(hero.locator('.home-hero__tagline')).toHaveText('让想象，成为作品。')
  await expect(hero.getByRole('link', { name: '进入创作台', exact: true })).toHaveAttribute('href', '/studio')
  await expect(hero.getByRole('link', { name: '探索全部工具', exact: true })).toHaveAttribute('href', '#home-directory')
  const image = hero.locator('img[src="/sucai/home-intro-03.png"]')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await expect(hero.locator('.home-launch')).toHaveCount(0)
}

const motionSlides = [
  ...slides,
  { ...slides[0], id: 'three', title: '第三张轮播' },
  { ...slides[1], id: 'four', title: '第四张轮播' },
]

async function expectSettledSlide(banner, id) {
  const active = banner.locator('.home-banner__slide.is-active')
  await expect(active).toHaveCount(1)
  await expect(active).toHaveAttribute('data-banner-slide', id)
  await expect(banner).toHaveAttribute('data-banner-transition', 'idle')
  await expect(banner.locator('canvas.home-banner__particles')).toHaveCount(0)
  await expect(active.locator('img')).toBeVisible()
  await expect.poll(() => active.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect.poll(() => banner.evaluate(root => {
    const nodes = root.querySelectorAll('.home-banner__slide, .home-banner__slide img, .home-hero__copy, .home-hero__copy h1, .home-hero__tagline, .home-hero__links')
    const transformsCleared = [...nodes].every(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).isIdentity)
    const visibleContent = root.querySelectorAll('.home-banner__slide.is-active, .home-hero__copy, .home-hero__copy h1, .home-hero__tagline, .home-hero__links')
    return transformsCleared && [...visibleContent].every(node => Number(getComputedStyle(node).opacity) === 1)
  })).toBe(true)
}

async function openAnimatedBanner(page, items = motionSlides) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner).toHaveAttribute('data-banners-source', 'configured')
  await expect(banner).toHaveAttribute('data-banner-motion', 'on')
  await expectSettledSlide(banner, items[0].id)
  await banner.hover()
  return banner
}

async function startMotionAudit(banner, sampleParticles = false) {
  await banner.evaluate((root, captureParticles) => {
    root.__homeBannerMotionAudit?.stop()
    const state = {
      activeIds: [], transitions: [root.getAttribute('data-banner-transition')], frames: [], particleSamples: [],
      particleDrawStart: window.__homeBannerParticleDraws?.length || 0,
    }
    const recordActive = () => {
      for (const slide of root.querySelectorAll('.home-banner__slide.is-active')) {
        const id = slide.getAttribute('data-banner-slide')
        if (state.activeIds.at(-1) !== id) state.activeIds.push(id)
      }
    }
    recordActive()
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.target === root && mutation.attributeName === 'data-banner-transition') {
          state.transitions.push(mutation.oldValue, root.getAttribute('data-banner-transition'))
        }
      }
      recordActive()
    })
    observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'data-banner-transition'] })
    let frameId
    let lastParticleSample = -Infinity
    const sample = () => {
      const visual = root.querySelector('.home-hero__visual').getBoundingClientRect()
      const images = Object.fromEntries([...root.querySelectorAll('[data-banner-slide]')].map(slide => {
        const rect = slide.querySelector('img').getBoundingClientRect()
        return [slide.getAttribute('data-banner-slide'), {
          offsetX: rect.x + rect.width / 2 - visual.x - visual.width / 2,
          offsetY: rect.y + rect.height / 2 - visual.y - visual.height / 2,
          scale: rect.width / visual.width,
          scaleY: rect.height / visual.height,
          rendered: rect.width > 0 && rect.height > 0,
          opacity: Number(getComputedStyle(slide).opacity),
        }]
      }))
      const progress = root.querySelector('[aria-current] .home-banner__progress')
      const particles = root.querySelector('canvas.home-banner__particles')
      state.frames.push({
        phase: root.getAttribute('data-banner-transition'),
        direction: root.getAttribute('data-banner-direction'),
        progress: progress ? new DOMMatrixReadOnly(getComputedStyle(progress).transform).a : null,
        canvasPresent: Boolean(particles),
        images,
      })
      if (captureParticles && particles && performance.now() - lastParticleSample >= 80) {
        lastParticleSample = performance.now()
        const gl = particles.getContext('webgl')
        const width = Math.min(128, particles.width)
        const height = Math.min(128, particles.height)
        if (gl && width && height) {
          const pixels = new Uint8Array(width * height * 4)
          gl.readPixels(Math.floor((particles.width - width) / 2), Math.floor((particles.height - height) / 2), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let covered = 0
          let visible = 0
          let alphaTotal = 0
          for (let offset = 3; offset < pixels.length; offset += 4) {
            if (pixels[offset] > 0) covered++
            if (pixels[offset] >= 32) visible++
            alphaTotal += pixels[offset]
          }
          state.particleSamples.push({
            coverage: covered / (width * height), count: Number(particles.dataset.particleCount), error: gl.getError(),
            meanAlpha: alphaTotal / (width * height * 255), visibleCoverage: visible / (width * height),
          })
        }
      }
      if (state.frames.length > 600) state.frames.shift()
      frameId = requestAnimationFrame(sample)
    }
    frameId = requestAnimationFrame(sample)
    root.__homeBannerMotionAudit = {
      state,
      stop() { observer.disconnect(); cancelAnimationFrame(frameId) },
    }
  }, sampleParticles)
}

async function finishMotionAudit(banner) {
  return banner.evaluate(root => {
    const audit = root.__homeBannerMotionAudit
    audit.stop()
    delete root.__homeBannerMotionAudit
    audit.state.particleDraws = (window.__homeBannerParticleDraws || []).slice(audit.state.particleDrawStart)
    return audit.state
  })
}

function expectFixedImageGeometry(audit, outgoing) {
  const transitioning = audit.frames.filter(frame => frame.phase === 'running')
  expect(transitioning.length).toBeGreaterThan(0)
  expect(audit.frames.every(frame => Object.values(frame.images).every(image => !image.rendered
    || (Math.abs(image.offsetX) < 0.5 && Math.abs(image.offsetY) < 0.5
      && Math.abs(image.scale - 1) < 0.001 && Math.abs(image.scaleY - 1) < 0.001))),
  'images should stay at their original position and size throughout the transition').toBe(true)
  expect(transitioning.some(frame => frame.images[outgoing]?.opacity > 0 && frame.images[outgoing]?.opacity < 1),
    'the outgoing image should visibly fade rather than disappear immediately').toBe(true)
}

function expectSparseParticles(audit, viewportWidth) {
  expect(audit.particleDraws.length, 'the particle renderer should issue real WebGL draws').toBeGreaterThan(0)
  expect(audit.particleDraws.every(draw => draw.mode === 0), 'particles should render as WebGL POINTS').toBe(true)
  const [minimum, maximum] = viewportWidth <= 800 ? [6000, 10000] : [18000, 28000]
  expect(audit.particleDraws.every(draw => draw.count >= minimum && draw.count <= maximum)).toBe(true)
  expect(audit.particleSamples.length).toBeGreaterThan(0)
  expect(audit.particleSamples.every(sample => sample.error === 0 && sample.count >= minimum && sample.count <= maximum)).toBe(true)
  const coverage = Math.max(...audit.particleSamples.map(sample => sample.coverage))
  const meanAlpha = Math.max(...audit.particleSamples.map(sample => sample.meanAlpha))
  const visibleCoverage = Math.max(...audit.particleSamples.map(sample => sample.visibleCoverage))
  expect(visibleCoverage, 'particles should cover a perceptible area, not just a few faint pixels').toBeGreaterThan(0.025)
  expect(meanAlpha, 'the particle layer should have enough opacity to be noticeable').toBeGreaterThan(0.01)
  expect(coverage, 'the particle layer should preserve a mostly transparent background').toBeLessThan(0.65)
}

function expectNoOverlap(first, second, description) {
  const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  expect(overlapWidth > 1 && overlapHeight > 1, description).toBe(false)
}

async function expectSpreadControls(banner, copy, links, viewportWidth) {
  const hero = await banner.boundingBox()
  await expect(banner.locator('.home-banner__counter')).not.toBeVisible()
  await expect(banner.locator('.home-banner__play')).toHaveCount(0)
  await expect(banner.getByRole('button', { name: /播放轮播|暂停轮播/ })).toHaveCount(0)
  const controls = {}
  for (const name of ['dots', 'previous', 'next']) {
    const control = banner.locator(`.home-banner__${name}`)
    await expect(control).toBeVisible()
    const bounds = await control.boundingBox()
    controls[name] = bounds
    expect(bounds.x, `${name} should fit within the hero's left edge`).toBeGreaterThanOrEqual(hero.x)
    expect(bounds.x + bounds.width, `${name} should fit within the hero's right edge`).toBeLessThanOrEqual(hero.x + hero.width)
    expect(bounds.y, `${name} should fit within the hero's top edge`).toBeGreaterThanOrEqual(hero.y)
    expect(bounds.y + bounds.height, `${name} should fit within the hero's bottom edge`).toBeLessThanOrEqual(hero.y + hero.height)
    expectNoOverlap(bounds, copy, `${name} should not overlap the copy`)
    expectNoOverlap(bounds, links, `${name} should not overlap the entry links`)
  }
  for (const [index, [name, bounds]] of Object.entries(controls).entries()) {
    for (const [otherName, otherBounds] of Object.entries(controls).slice(index + 1)) {
      expectNoOverlap(bounds, otherBounds, `${name} and ${otherName} should remain separate`)
    }
  }
  const centerY = hero.y + hero.height / 2
  for (const name of ['previous', 'next']) {
    expect(controls[name].y + controls[name].height / 2, `${name} should sit at the hero's vertical center`)
      .toBeCloseTo(centerY, 0)
  }
  expect(controls.previous.x - hero.x, 'the previous arrow should stay near the left edge').toBeLessThanOrEqual(controls.previous.width)
  expect(hero.x + hero.width - controls.next.x - controls.next.width, 'the next arrow should stay near the right edge')
    .toBeLessThanOrEqual(controls.next.width)
  const pagination = banner.locator('.home-banner__pagination')
  await expect(pagination).toBeVisible()
  await expect(pagination.locator('.home-banner__dots')).toHaveCount(1)
  const paginationBounds = await pagination.boundingBox()
  expect(paginationBounds.x + paginationBounds.width / 2, 'the pagination should be horizontally centered')
    .toBeCloseTo(hero.x + hero.width / 2, 0)
  expect(paginationBounds.width).toBeLessThanOrEqual(176)
  expect(controls.dots.width).toBeLessThanOrEqual(128)
  expectNoOverlap(paginationBounds, copy, 'the pagination should not overlap the copy')
  expectNoOverlap(paginationBounds, links, 'the pagination should not overlap the entry links')
  expect(controls.dots.x + controls.dots.width / 2, 'the indicators should remain centered inside the pagination')
    .toBeCloseTo(paginationBounds.x + paginationBounds.width / 2, 0)
  expect(controls.dots.x).toBeGreaterThanOrEqual(paginationBounds.x)
  expect(controls.dots.x + controls.dots.width).toBeLessThanOrEqual(paginationBounds.x + paginationBounds.width)
  expect(controls.dots.y).toBeGreaterThanOrEqual(paginationBounds.y)
  expect(controls.dots.y + controls.dots.height).toBeLessThanOrEqual(paginationBounds.y + paginationBounds.height)
  if (viewportWidth <= 800) {
    expect(paginationBounds.y + paginationBounds.height, 'the pagination should clear both content columns on smaller screens')
      .toBeLessThanOrEqual(Math.min(copy.y, links.y))
    expect(copy.y + copy.height - paginationBounds.y - paginationBounds.height, 'the pagination should use its lowered offset above the content bottom')
      .toBeCloseTo(viewportWidth <= 640 ? 116 : 156, 0)
  } else {
    expect(paginationBounds.y + paginationBounds.height, 'desktop pagination should meet the bottom edge')
      .toBeCloseTo(hero.y + hero.height, 0)
  }
}

async function expectCornerLayout(banner, viewportWidth) {
  const copy = banner.locator('.home-hero__copy')
  await expect(copy.locator('h1')).toHaveCount(1)
  await expect(copy.locator('.home-hero__tagline')).toHaveCount(1)
  await expect(copy.locator('.home-hero__links')).toHaveCount(0)
  const copyBounds = await copy.boundingBox()
  const links = await banner.locator('.home-hero__links').boundingBox()
  expect(copyBounds.x + copyBounds.width, 'copy should sit to the left of the entry links').toBeLessThanOrEqual(links.x)
  expect(copyBounds.y + copyBounds.height, 'copy and entry links should share their bottom edge')
    .toBeCloseTo(links.y + links.height, 0)
  await expectSpreadControls(banner, copyBounds, links, viewportWidth)

  const entries = await banner.locator('.home-hero__links > a').all()
  const entryBounds = await Promise.all(entries.map(entry => entry.boundingBox()))
  for (const bounds of entryBounds) {
    expect(bounds.width).toBeGreaterThanOrEqual(40)
    expect(bounds.height).toBeGreaterThanOrEqual(40)
  }
  if (viewportWidth <= 640) {
    expect(links.width).toBe(132)
    for (let index = 1; index < entryBounds.length; index++) {
      expect(entryBounds[index].x).toBeCloseTo(entryBounds[0].x, 0)
      expect(entryBounds[index].width).toBeCloseTo(entryBounds[0].width, 0)
      expect(entryBounds[index - 1].y + entryBounds[index - 1].height).toBeLessThan(entryBounds[index].y)
    }
  } else {
    for (let index = 1; index < entryBounds.length; index++) {
      expect(entryBounds[index].y).toBeCloseTo(entryBounds[0].y, 0)
      expect(entryBounds[index - 1].x + entryBounds[index - 1].width).toBeLessThan(entryBounds[index].x)
    }
  }
}

test('configured banners share the top hero and retain their destination link', async ({ page }) => {
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner).toBeVisible()
  await expect(banner).toHaveClass(/home-hero/)
  await expect(banner).toHaveAttribute('data-banners-source', 'configured')
  await expect(page.locator('.home-hero')).toHaveCount(1)
  await expect(banner.getByText('星空云绘 · 精选', { exact: true })).toHaveCount(0)
  await expect(banner.locator('.home-banner__brand')).toHaveCount(0)
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await expect(banner.getByRole('button', { name: '下一张', exact: true })).toBeVisible()
  await expect(banner.locator('.home-launch')).toHaveCount(0)
  await expect(banner.getByRole('link', { name: '开始创作', exact: true })).toHaveAttribute('href', '/text-to-image')
})

test('configured banners preserve empty copy and hide all entry links without a destination', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
    { id: 'empty-copy', imageUrl: slides[0].imageUrl, buttonText: '不应显示的按钮' },
    { id: 'blank-copy', title: '  ', subtitle: '\t ', linkUrl: '\n  ', buttonText: '不应显示的按钮', imageUrl: slides[1].imageUrl },
    { id: 'text-only', title: '仅展示轮播介绍', subtitle: '这张轮播没有跳转地址。', linkUrl: '', imageUrl: slides[0].imageUrl },
  ] }))
  await page.goto('/')
  const hero = page.getByRole('region', { name: '首页精选' })
  await expect(hero).toHaveAttribute('data-banners-source', 'configured')
  for (const number of [1, 2]) {
    await expect(hero.locator('h1, .home-hero__tagline, .home-hero__links, .home-banner__cta')).toHaveCount(0)
    await expect(hero.locator('.home-hero__copy')).toBeEmpty()
    await expect(hero.getByRole('button', { name: `第 ${number} 张轮播图`, exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(hero.getByRole('button', { name: '上一张', exact: true })).toBeVisible()
    await expect(hero.getByRole('button', { name: '下一张', exact: true })).toBeVisible()
    await expect(hero.getByRole('button', { name: /播放轮播|暂停轮播/ })).toHaveCount(0)
    await expect(hero.locator('.home-banner__slide.is-active img')).toBeVisible()
    await expect(hero.locator('.home-banner__slide.is-active img')).toHaveCSS('filter', 'none')
    await expect(hero.getByText(/星空云绘|让想象，成为作品|第 [12] 张轮播图|不应显示的按钮/)).toHaveCount(0)
    await hero.getByRole('button', { name: '下一张', exact: true }).click()
  }
  await expect(hero.locator('h1')).toHaveText('仅展示轮播介绍')
  await expect(hero.locator('.home-hero__tagline')).toHaveText('这张轮播没有跳转地址。')
  await expect(hero.locator('.home-hero__links')).toHaveCount(0)
  await hero.getByRole('button', { name: '第 1 张轮播图', exact: true }).click()
  await expect(hero.locator('h1')).toHaveCount(0)
  await expect(hero.locator('.home-banner__counter')).toHaveText('01 / 03')
})

test('configured banner with empty copy keeps a valid destination on the right', async ({ page }, testInfo) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
    { ...slides[0], title: '', subtitle: ' ', buttonText: '  ' },
  ] }))
  await page.goto('/')
  const hero = page.getByRole('region', { name: '首页精选' })
  await expect(hero.locator('h1, .home-hero__tagline')).toHaveCount(0)
  await expect(hero.getByRole('link', { name: '查看详情', exact: true })).toHaveAttribute('href', '/text-to-image')
  await expect(hero.getByRole('link', { name: '探索全部工具', exact: true })).toBeVisible()
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const copy = await hero.locator('.home-hero__copy').boundingBox()
    const links = await hero.locator('.home-hero__links').boundingBox()
    expect(links.x).toBeGreaterThanOrEqual(width / 2)
    expect(copy.x + copy.width).toBeLessThanOrEqual(links.x)
    expect(links.x + links.width).toBeLessThanOrEqual(width)
    await hero.screenshot({ path: testInfo.outputPath(`empty-title-banner-${width}.png`) })
  }
})

test('configured banner title and subtitle are independently optional', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
    { ...slides[0], title: '', subtitle: '仅展示副标题' },
    { ...slides[1], title: '仅展示主标题', subtitle: '' },
  ] }))
  await page.goto('/')
  const hero = page.getByRole('region', { name: '首页精选' })
  await expect(hero.locator('h1')).toHaveCount(0)
  await expect(hero.locator('.home-hero__tagline')).toHaveText('仅展示副标题')
  await expect(hero.locator('.home-banner__cta')).toHaveText('开始创作')
  await hero.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(hero.locator('h1')).toHaveText('仅展示主标题')
  await expect(hero.locator('.home-hero__tagline')).toHaveCount(0)
  await expect(hero.locator('.home-banner__cta')).toHaveText('查看详情')
})

test('home banner navigation, links, keyboard and stable edge-to-edge layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner).toBeVisible()
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await expect(banner.locator('.home-banner__cta')).toHaveAttribute('href', '/text-to-image')
  const bounds = await banner.boundingBox()
  expect(bounds.y).toBeCloseTo(0, 0)
  expect(bounds.x).toBeCloseTo(0, 0)
  expect(bounds.width).toBe(1280)
  const visual = await banner.locator('.home-hero__visual').boundingBox()
  expect(visual).toEqual(bounds)
  expect(bounds.height).toBe(560)
  await expect(banner.locator('.home-banner__slide.is-active img')).toHaveCSS('object-fit', 'cover')
  await expect(banner.locator('.home-banner__slide.is-active img')).toHaveCSS('filter', 'none')
  await expect.poll(() => banner.locator('.home-banner__slide.is-active img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('home-banner-desktop.png') })
  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(banner.locator('h1')).toHaveText('AI 电商设计')
  await expect(banner.locator('.home-banner__cta')).toHaveAttribute('href', 'https://example.com/design')
  await expect(banner.locator('.home-banner__cta')).toHaveAttribute('target', '_blank')
  await expect(banner.locator('.home-banner__cta')).toHaveAttribute('rel', /noopener/)
  await banner.getByRole('button', { name: '下一张', exact: true }).press('ArrowLeft')
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await banner.getByRole('button', { name: '第 2 张：AI 电商设计' }).click()
  await expect(banner.locator('h1')).toHaveText('AI 电商设计')
  expect((await banner.boundingBox()).height).toBeCloseTo(bounds.height, 0)

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport)
    await page.screenshot({ path: testInfo.outputPath(`home-banner-${viewport.width}.png`) })
    const viewportBounds = await banner.boundingBox()
    expect(viewportBounds.y).toBeCloseTo(0, 0)
    expect(viewportBounds.width).toBe(viewport.width)
    const viewportVisual = await banner.locator('.home-hero__visual').boundingBox()
    expect(viewportVisual).toEqual(viewportBounds)
    if (viewport.width === 1920) expect(viewportVisual.height).toBe(600)
    if (viewport.width === 1440) expect(viewportVisual.height).toBe(560)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
    for (const selector of ['.home-hero__copy', 'h1', '.home-hero__tagline', '.home-hero__links']) {
      const controlBounds = await banner.locator(selector).boundingBox()
      expect(controlBounds.x).toBeGreaterThanOrEqual(viewportVisual.x)
      expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(viewportVisual.x + viewportVisual.width)
      expect(controlBounds.y).toBeGreaterThanOrEqual(viewportVisual.y)
      expect(controlBounds.y + controlBounds.height).toBeLessThanOrEqual(viewportVisual.y + viewportVisual.height)
    }
    await expectCornerLayout(banner, viewport.width)
  }
})

test('long banner copy fits a short mobile viewport without covering controls', async ({ page }, testInfo) => {
  const title = '从创意灵感到商业作品的一站式智能视觉创作'
  const buttonText = '探索品牌视觉、电商海报与无限画布创作'
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
    { ...slides[0], title, buttonText },
    slides[1],
  ] }))
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner.locator('h1')).toHaveText(title)
  await expect(banner.locator('.home-banner__cta')).toHaveText(buttonText)
  await expectCornerLayout(banner, 320)
  const heroBounds = await banner.boundingBox()
  for (const selector of ['.home-hero__copy', '.home-hero__links']) {
    const bounds = await banner.locator(selector).boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(heroBounds.x)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(heroBounds.x + heroBounds.width)
    expect(bounds.y).toBeGreaterThanOrEqual(heroBounds.y)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(heroBounds.y + heroBounds.height)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.screenshot({ path: testInfo.outputPath('home-banner-long-copy-320.png') })
})

test('empty banners retain the default hero image', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [] }))
  const response = page.waitForResponse('**/api/v1/home-banners')
  await page.goto('/')
  expect((await response).status()).toBe(200)
  await expectDefaultHero(page)
})

test('a failed banner request retains the default hero image', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, {}, 500))
  const response = page.waitForResponse('**/api/v1/home-banners')
  await page.goto('/')
  expect((await response).status()).toBe(500)
  await expectDefaultHero(page)
})

test('a single configured banner has no unnecessary carousel controls', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [slides[0]] }))
  await page.goto('/')
  await expect(page.locator('.home-banner')).toBeVisible()
  await expect(page.locator('.home-hero')).toHaveAttribute('data-banners-source', 'configured')
  await expect(page.locator('.home-banner__controls')).toHaveCount(0)
  await expect(page.locator('.home-banner__cta')).toHaveAttribute('href', '/text-to-image')
})

test('a broken banner image falls back to the default hero', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [{ ...slides[0], imageUrl: '/missing-banner.webp' }] }))
  await page.route('**/missing-banner.webp', route => route.fulfill({ status: 404, body: '' }))
  const imageResponse = page.waitForResponse('**/missing-banner.webp')
  await page.goto('/')
  expect((await imageResponse).status()).toBe(404)
  await expectDefaultHero(page)
})

test('hidden, future, expired and unsafe-image banners are not displayed', async ({ page }) => {
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
    { ...slides[1], id: 'hidden', title: '隐藏轮播', active: false },
    { ...slides[1], id: 'future', title: '未来轮播', startsAt: '2026-08-12T00:00:00+08:00' },
    { ...slides[1], id: 'expired', title: '过期轮播', endsAt: '2026-08-10T00:00:00+08:00' },
    { ...slides[1], id: 'unsafe', title: '无效轮播', imageUrl: 'javascript:alert(1)' },
    slides[0],
  ] }))
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await expect(banner.locator('.home-banner__slide')).toHaveCount(1)
  await expect(banner.locator('.home-banner__controls')).toHaveCount(0)
  await expect(banner.getByText(/隐藏轮播|未来轮播|过期轮播|无效轮播/)).toHaveCount(0)
})

test('development preview shows three local demo slides without changing banner data', async ({ page }) => {
  const bannerWrites = []
  page.on('request', request => {
    if (request.url().includes('/home-banners') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      bannerWrites.push(`${request.method()} ${request.url()}`)
    }
  })
  await page.goto('/?previewBanners=1')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner).toHaveAttribute('data-banners-source', 'preview')
  await expect(banner.locator('.home-banner__slide')).toHaveCount(3)
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(banner.locator('h1')).toHaveText('AI 电商设计')
  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(banner.locator('h1')).toHaveText('无限画布')
  await expect.poll(() => banner.locator('.home-banner__slide.is-active img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await expect(banner.locator('.home-launch')).toHaveCount(0)
  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  expect(bannerWrites).toEqual([])

  await page.goto('/')
  await expect(page.locator('.home-hero')).toHaveAttribute('data-banners-source', 'configured')
  await expect(page.locator('.home-banner__slide')).toHaveCount(2)
})

test('autoplay advances without playback buttons and pauses while hovered', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await expect(banner).toHaveAttribute('data-banner-motion', 'on')
  await expect(banner.getByRole('button', { name: /播放轮播|暂停轮播/ })).toHaveCount(0)
  await startMotionAudit(banner)
  await page.mouse.move(0, 899)
  const progress = () => banner.locator('[aria-current] .home-banner__progress').evaluate(element =>
    new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
  )
  await expect.poll(progress).toBeGreaterThan(0.15)
  await expect(banner).toHaveAttribute('data-banner-transition', 'running', { timeout: 6000 })
  await expect(banner.locator('h1')).toHaveText('AI 电商设计', { timeout: 6000 })
  await expectSettledSlide(banner, 'two')
  const audit = await finishMotionAudit(banner)
  const movingFrames = audit.frames.filter(frame => frame.phase === 'running')
  expect(movingFrames.length).toBeGreaterThan(2)
  expect(movingFrames.slice(2).every(frame => frame.progress === 0), 'autoplay should not count down while the images are moving').toBe(true)
  await expect.poll(progress).toBeGreaterThan(0.05)
  await banner.hover()
  await expect.poll(progress).toBe(0)
  await page.waitForTimeout(3300)
  await expect(banner.locator('h1')).toHaveText('AI 电商设计')
  expect(await progress()).toBe(0)
  await page.mouse.move(0, 899)
  await expect(banner.locator('h1')).toHaveText('星空云绘', { timeout: 6000 })
})

for (const motion of [
  { name: 'system reduced motion', preference: 'reduce', disabled: false },
  { name: 'disabled site animations', preference: 'no-preference', disabled: true },
]) {
  test(`${motion.name} stops automatic progress but retains manual navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ reducedMotion: motion.preference })
    await page.goto('/')
    const banner = page.getByRole('region', { name: '首页精选' })
    await expect(banner.locator('h1')).toHaveText('星空云绘')
    if (motion.disabled) {
      await page.evaluate(() => document.documentElement.classList.add('settings-no-animations'))
    }
    await expect(banner).toHaveAttribute('data-banner-motion', 'off')
    await page.mouse.move(0, 899)
    await expect(banner.getByRole('button', { name: /播放轮播|暂停轮播/ })).toHaveCount(0)
    const progress = banner.locator('[aria-current] .home-banner__progress')
    await expect.poll(() => progress.evaluate(element =>
      new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
    )).toBe(0)
    await page.waitForTimeout(3300)
    await expect(banner.locator('h1')).toHaveText('星空云绘')
    await startMotionAudit(banner)
    await banner.getByRole('button', { name: '下一张', exact: true }).click()
    await expect(banner.locator('h1')).toHaveText('AI 电商设计')
    await expectSettledSlide(banner, 'two')
    await banner.getByRole('button', { name: '上一张', exact: true }).click()
    await expect(banner.locator('h1')).toHaveText('星空云绘')
    await expectSettledSlide(banner, 'one')
    const audit = await finishMotionAudit(banner)
    expect(audit.transitions).not.toContain('running')
    expect(audit.frames.every(frame => Object.values(frame.images).every(image =>
      !image.rendered || (Math.abs(image.offsetX) < 0.5 && Math.abs(image.scale - 1) < 0.001),
    )), 'manual navigation should stay still when motion is disabled').toBe(true)
  })
}

test('mobile carousel ignores vertical scrolling and supports horizontal swipes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  async function swipe(target, start, end) {
    await target.evaluate((element, points) => {
      const touchAt = ([clientX, clientY]) => new Touch({ identifier: 1, target: element, clientX, clientY })
      const first = touchAt(points.start)
      const last = touchAt(points.end)
      element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [first], changedTouches: [first] }))
      element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [last] }))
    }, { start, end })
  }
  await swipe(banner, [220, 200], [145, 410])
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await swipe(banner, [220, 200], [90, 212])
  await expect(banner.locator('h1')).toHaveText('AI 电商设计')
  for (const button of await banner.locator('.home-banner__previous, .home-banner__next').all()) {
    const bounds = await button.boundingBox()
    expect(bounds.width).toBeGreaterThanOrEqual(40)
    expect(bounds.height).toBeGreaterThanOrEqual(40)
  }
  const dot = await banner.locator('.home-banner__dots button').first().boundingBox()
  expect(dot.width).toBeGreaterThanOrEqual(40)
  expect(dot.height).toBeGreaterThanOrEqual(40)
})

test('focusing a banner link pauses autoplay until focus leaves the hero', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const banner = page.getByRole('region', { name: '首页精选' })
  const link = banner.locator('.home-banner__cta')
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await expect(link).toBeVisible()
  await link.focus()
  await expect(link).toBeFocused()
  await page.mouse.move(0, 899)
  await page.waitForTimeout(3300)
  await expect(banner.locator('h1')).toHaveText('星空云绘')
  await expect(link).toBeFocused()
  await link.blur()
  await expect(banner.locator('h1')).toHaveText('AI 电商设计', { timeout: 6000 })
})

test('particle transitions draw sparse points while keeping images fixed and clean up afterward', async ({ page }) => {
  await page.addInitScript(() => {
    window.__homeBannerParticleDraws = []
    const prototype = window.WebGLRenderingContext?.prototype
    if (!prototype) return
    const drawArrays = prototype.drawArrays
    prototype.drawArrays = function (mode, first, count) {
      const result = drawArrays.call(this, mode, first, count)
      if (this.canvas.classList.contains('home-banner__particles')) {
        window.__homeBannerParticleDraws.push({ mode, count })
      }
      return result
    }
  })
  const banner = await openAnimatedBanner(page, slides)
  await expect.poll(() => banner.locator('[data-banner-slide="two"] img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await expectSettledSlide(banner, 'one')
    await banner.hover()
    await startMotionAudit(banner, true)
    await banner.getByRole('button', { name: '下一张', exact: true }).click()
    await expect(banner).toHaveAttribute('data-banner-transition', 'running')
    await expect(banner).toHaveAttribute('data-banner-direction', 'next')
    await expectSettledSlide(banner, 'two')
    const forward = await finishMotionAudit(banner)
    expectFixedImageGeometry(forward, 'one')
    expectSparseParticles(forward, viewport.width)
    await expect(banner.locator('h1')).toHaveText('AI 电商设计')
    await expect(banner.locator('.home-banner__cta')).toHaveAttribute('href', slides[1].linkUrl)

    await startMotionAudit(banner, true)
    await banner.getByRole('button', { name: '上一张', exact: true }).click()
    await expect(banner).toHaveAttribute('data-banner-transition', 'running')
    await expect(banner).toHaveAttribute('data-banner-direction', 'previous')
    await expectSettledSlide(banner, 'one')
    const backward = await finishMotionAudit(banner)
    expectFixedImageGeometry(backward, 'two')
    expectSparseParticles(backward, viewport.width)
    await expect(banner.locator('h1')).toHaveText('星空云绘')
    await expect(banner.locator('.home-banner__cta')).toHaveAttribute('href', slides[0].linkUrl)
  }
})

test('unavailable WebGL falls back to a gentle crossfade without moving images or leaving a canvas', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).toLowerCase().includes('webgl')) return null
      return getContext.call(this, type, ...args)
    }
  })
  const banner = await openAnimatedBanner(page, slides)
  await expect.poll(() => banner.locator('[data-banner-slide="two"] img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await startMotionAudit(banner)
  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expect(banner).toHaveAttribute('data-banner-transition', 'running')
  await expect(banner.locator('canvas.home-banner__particles')).toHaveCount(0)
  await expectSettledSlide(banner, 'two')
  const audit = await finishMotionAudit(banner)
  expectFixedImageGeometry(audit, 'one')
  expect(audit.frames.every(frame => !frame.canvasPresent), 'the fallback should not create a particle canvas').toBe(true)
  await expect(banner.locator('h1')).toHaveText('AI 电商设计')
  await banner.getByRole('button', { name: '上一张', exact: true }).click()
  await expectSettledSlide(banner, 'one')
})

test('rapid navigation accumulates requests and only visits the latest queued target', async ({ page }) => {
  const banner = await openAnimatedBanner(page)
  await expect.poll(() => banner.locator('.home-banner__slide img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  await startMotionAudit(banner)
  const next = banner.getByRole('button', { name: '下一张', exact: true })
  await next.click()
  await expect(banner).toHaveAttribute('data-banner-transition', 'running')
  expect(await next.isEnabled(), 'navigation should remain available while an image is moving').toBe(true)
  await next.click()
  await next.click()
  await banner.getByRole('button', { name: '上一张', exact: true }).click()
  await expectSettledSlide(banner, 'three')
  await expect(banner.locator('h1')).toHaveText('第三张轮播')
  const audit = await finishMotionAudit(banner)
  expect(audit.transitions).toContain('running')
  expect(audit.activeIds).not.toContain('four')
})

for (const setting of ['system preference', 'site setting']) {
  test(`disabling motion through the ${setting} finishes the latest target and allows further navigation`, async ({ page }) => {
    const banner = await openAnimatedBanner(page)
    await expect.poll(() => banner.locator('.home-banner__slide img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    const next = banner.getByRole('button', { name: '下一张', exact: true })
    await next.click()
    await expect(banner).toHaveAttribute('data-banner-transition', 'running')
    expect(await next.isEnabled()).toBe(true)
    await next.click()
    if (setting === 'system preference') await page.emulateMedia({ reducedMotion: 'reduce' })
    else await page.evaluate(() => document.documentElement.classList.add('settings-no-animations'))
    await expect(banner).toHaveAttribute('data-banner-motion', 'off')
    await expectSettledSlide(banner, 'three')
    await expect(banner.locator('h1')).toHaveText('第三张轮播')
    await next.click()
    await expectSettledSlide(banner, 'four')

    if (setting === 'system preference') await page.emulateMedia({ reducedMotion: 'no-preference' })
    else await page.evaluate(() => document.documentElement.classList.remove('settings-no-animations'))
    await expect(banner).toHaveAttribute('data-banner-motion', 'on')
    await banner.getByRole('button', { name: '上一张', exact: true }).click()
    await expect(banner).toHaveAttribute('data-banner-transition', 'running')
    await expect(banner).toHaveAttribute('data-banner-direction', 'previous')
    await expectSettledSlide(banner, 'three')
  })
}

test('a delayed target keeps the current image and its late load cannot replace a newer choice', async ({ page }) => {
  let pendingImage
  await page.route('**/sucai/test-delayed-banner.webp', route => { pendingImage = route })
  const items = [slides[0], { ...slides[1], imageUrl: '/sucai/test-delayed-banner.webp' }, motionSlides[2]]
  const banner = await openAnimatedBanner(page, items)
  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expect.poll(() => Boolean(pendingImage)).toBe(true)
  await page.waitForTimeout(150)
  await expect(banner).toHaveAttribute('data-banner-transition', 'running')
  await expect(banner.locator('canvas.home-banner__particles')).toHaveCount(0)
  await expect(banner.locator('[data-banner-slide="one"]')).toHaveCSS('opacity', '1')
  await expect(banner.locator('[data-banner-slide="two"]')).toHaveCSS('opacity', '0')
  const firstImage = banner.locator('[data-banner-slide="one"] img')
  await expect(firstImage).toBeVisible()
  await expect(firstImage).toHaveCSS('filter', 'none')

  await banner.getByRole('button', { name: '下一张', exact: true }).click()
  await expectSettledSlide(banner, 'three')
  const imageResponse = await page.request.get(new URL(slides[1].imageUrl, page.url()).href)
  expect(imageResponse.ok()).toBe(true)
  await pendingImage.fulfill({ response: imageResponse })
  await expect.poll(() => banner.locator('[data-banner-slide="two"] img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expectSettledSlide(banner, 'three')
  await banner.getByRole('button', { name: '上一张', exact: true }).click()
  await expect(banner).toHaveAttribute('data-banner-transition', 'running')
  await expectSettledSlide(banner, 'two')
})

test('a queued image failure cancels the transition cleanly and remaining slides still work', async ({ page }) => {
  let failedImage
  await page.route('**/sucai/test-failed-transition.webp', route => { failedImage = route })
  const items = motionSlides.map(slide => slide.id === 'three' ? { ...slide, imageUrl: '/sucai/test-failed-transition.webp' } : slide)
  const banner = await openAnimatedBanner(page, items)
  await expect.poll(() => banner.locator('[data-banner-slide="two"] img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  const next = banner.getByRole('button', { name: '下一张', exact: true })
  await next.click()
  await expect(banner).toHaveAttribute('data-banner-transition', 'running')
  expect(await next.isEnabled()).toBe(true)
  await next.click()
  await expect.poll(() => Boolean(failedImage)).toBe(true)
  await failedImage.fulfill({ status: 404, body: '' })
  await expect(banner.locator('[data-banner-slide="three"]')).toHaveCount(0)
  await expect(banner).toHaveAttribute('data-banners-source', 'configured')
  await expect(banner).toHaveAttribute('data-banner-transition', 'idle')
  const active = banner.locator('.home-banner__slide.is-active')
  await expect(active).toHaveCount(1)
  const currentId = await active.getAttribute('data-banner-slide')
  const remainingIds = ['one', 'two', 'four']
  expect(remainingIds).toContain(currentId)
  await expectSettledSlide(banner, currentId)
  const nextId = remainingIds[(remainingIds.indexOf(currentId) + 1) % remainingIds.length]
  await next.click()
  await expectSettledSlide(banner, nextId)
})
