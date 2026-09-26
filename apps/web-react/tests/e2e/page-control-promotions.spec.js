import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, {
    pageControls: {
      skills: { status: 'removed', reason: '模板调整' },
      updates: { status: 'removed', reason: '更新归档调整' },
      developer_api_docs: { status: 'maintenance', reason: '文档更新' },
    },
  }))
})

test('home banners hide removed internal targets while retaining slides and external links', async ({ page, baseURL }) => {
  const slides = [
    { id: 'relative', title: '模板调整中', linkUrl: '/skills?source=banner', visible: false },
    { id: 'absolute', title: '站内模板调整中', linkUrl: new URL('/skills?source=banner', baseURL).href, visible: false },
    { id: 'external', title: '外部模板资源', linkUrl: 'https://example.com/skills?source=banner', newTab: true, visible: true },
    { id: 'maintenance', title: 'API 文档更新中', linkUrl: '/developer-api/docs', visible: true },
  ].map(item => ({ ...item, imageUrl: '/sucai/studio-cover-t2i.webp', buttonText: '查看活动', active: true }))
  await page.route('**/api/v1/home-banners', route => fulfillJson(route, { items: slides }))
  await page.goto('/')
  const hero = page.locator('.home-hero')
  await expect(hero).toHaveAttribute('data-banners-source', 'configured')
  await expect(hero.locator('.home-banner__slide')).toHaveCount(slides.length)
  for (const [index, slide] of slides.entries()) {
    if (index) await hero.getByRole('button', { name: '下一张', exact: true }).click()
    await expect(hero.locator('h1')).toHaveText(slide.title)
    const cta = hero.locator('.home-banner__cta')
    if (slide.visible) {
      await expect(cta).toHaveAttribute('href', slide.linkUrl)
      if (slide.newTab) await expect(cta).toHaveAttribute('target', '_blank')
    } else {
      await expect(cta).toHaveCount(0)
      await expect(hero.getByRole('link', { name: '进入创作台', exact: true })).toHaveCount(0)
    }
    await expect(hero.locator('.home-launch')).toHaveCount(0)
  }
})

for (const presentation of [
  { name: 'banner', placement: 'banner', layout: 'text_only', selector: '.promo-banner' },
  { name: 'text modal', placement: 'modal', layout: 'text_only', selector: '.client-announcement-modal' },
  { name: 'poster modal', placement: 'modal', layout: 'image_top', selector: '.client-announcement-modal' },
]) {
  test(`${presentation.name} keeps announcement content and a way to close when its target is removed`, async ({ page, baseURL }) => {
    let item = {
      id: `${presentation.name}-removed`, title: '模板活动公告', body: '活动说明继续保留。',
      placement: presentation.placement, layout: presentation.layout,
      ctaText: '查看活动', ctaUrl: new URL('/skills?source=announcement', baseURL).href,
      allowClose: false, frequency: 'every_open',
    }
    await page.route('**/api/v1/announcements', route => fulfillJson(route, { items: [item] }))
    await page.goto('/')
    const announcement = page.locator(presentation.selector)
    await expect(announcement).toBeVisible()
    await expect(announcement).toContainText(item.title)
    await expect(announcement.getByRole('link', { name: '查看活动', exact: true })).toHaveCount(0)
    await expect(announcement.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
    if (presentation.placement === 'modal') {
      await expect(announcement.getByRole('button', { name: '关闭公告', exact: true })).toBeEnabled()
    }
    await announcement.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(announcement).toHaveCount(0)

    item = { ...item, id: `${presentation.name}-external`, ctaUrl: 'https://example.com/skills?source=announcement' }
    await page.reload()
    await expect(announcement).toBeVisible()
    await expect(announcement).toContainText(item.title)
    await expect(announcement.getByRole('link', { name: '查看活动', exact: true })).toHaveAttribute('href', item.ctaUrl)
    await expect(announcement.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0)
  })
}

test('release notices retain refresh while hiding the removed update page', async ({ page }) => {
  await page.route('**/api/v1/changelog/latest', route => fulfillJson(route, {
    id: 'fresh-release', version: 'v99', title: '有新的功能更新', publishedAt: '2099-01-01T00:00:00Z',
  }))
  await page.goto('/')
  const release = page.locator('.client-release-banner')
  await expect(release).toBeVisible()
  await expect(release).toContainText('有新的功能更新')
  await expect(release.getByRole('link', { name: '查看说明' })).toHaveCount(0)
  await expect(release.getByRole('button', { name: '刷新页面' })).toBeVisible()

  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, {
    pageControls: { updates: { status: 'maintenance', reason: '更新归档调整' } },
  }))
  await page.reload()
  await expect(release.getByRole('link', { name: '查看说明' })).toHaveAttribute('href', '/updates')
})
