import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [] }))
})

async function expectUncoveredHeroWithoutComposer(page) {
  const hero = page.locator('.home-hero')
  await expect(hero.locator('.home-launch, .home-silk-surface, [data-silk-state], form, textarea, canvas')).toHaveCount(0)
  await expect(hero.getByRole('textbox', { name: '创作提示词' })).toHaveCount(0)
  await expect(hero.getByRole('group', { name: '创作方式' })).toHaveCount(0)
  await expect(hero.getByRole('button', { name: '开始创作', exact: true })).toHaveCount(0)
  await expect(hero.getByRole('button', { name: /绸面动效/ })).toHaveCount(0)
  await expect(hero.locator('.home-hero__shade, .home-banner__shade, .home-hero__backdrop')).toHaveCount(0)

  const overlays = await hero.evaluate(root => {
    const layers = new Set([root])
    for (const image of root.querySelectorAll('.home-hero__image')) {
      for (let layer = image; layer && layer !== root.parentElement; layer = layer.parentElement) {
        layers.add(layer)
      }
    }
    return [...layers].flatMap(layer => {
      const style = getComputedStyle(layer)
      const issues = []
      for (const property of ['filter', 'backdrop-filter', '-webkit-backdrop-filter', 'mask-image']) {
        const value = style.getPropertyValue(property)
        if (value && value !== 'none') issues.push(`${layer.className}: ${property}: ${value}`)
      }
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = getComputedStyle(layer, pseudo)
        if (!['none', 'normal'].includes(pseudoStyle.content) && pseudoStyle.display !== 'none') {
          issues.push(`${layer.className}${pseudo}: ${pseudoStyle.content}`)
        }
      }
      return issues
    })
  })
  expect(overlays, 'the image and its layers should have no filters, masks or generated overlays').toEqual([])
}

for (const source of ['default', 'configured']) {
  for (const viewport of [
    { width: 1440, height: 900, scheme: 'light' },
    { width: 390, height: 844, scheme: 'dark' },
  ]) {
    test(`${source} hero has no composer or image overlay at ${viewport.width}px in ${viewport.scheme} mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript(scheme => localStorage.setItem('walleven-color-scheme', scheme), viewport.scheme)
      if (source === 'configured') {
        await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: [
          { id: 'one', title: '星空云绘', imageUrl: '/sucai/studio-cover-t2i.webp', linkUrl: '/text-to-image', buttonText: '开始创作', active: true },
          { id: 'two', title: 'AI 电商设计', imageUrl: '/sucai/studio-cover-ecom-create.webp', active: true },
        ] }))
      }
      await page.goto('/')
      const hero = page.locator('.home-hero')
      await expect(hero).toHaveAttribute('data-banners-source', source)
      await expect(hero.locator('h1')).toBeVisible()
      await expect.poll(() => hero.locator('.home-hero__image').first().evaluate(image =>
        image.complete && image.naturalWidth > 0,
      )).toBe(true)
      if (viewport.scheme === 'dark') await expect(page.locator('.home-catalog')).toHaveClass(/is-dark/)
      await expectUncoveredHeroWithoutComposer(page)
      if (source === 'configured') {
        await expect(hero.getByRole('link', { name: '开始创作', exact: true })).toHaveAttribute('href', '/text-to-image')
        await hero.getByRole('button', { name: '下一张', exact: true }).click()
        await expect(hero.locator('h1')).toHaveText('AI 电商设计')
        await expectUncoveredHeroWithoutComposer(page)
      }
      await page.screenshot({ path: testInfo.outputPath(`home-uncovered-${source}-${viewport.width}.png`) })
    })
  }
}
