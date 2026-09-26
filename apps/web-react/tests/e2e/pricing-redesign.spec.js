import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { expectPricingPageIsolated } from './helpers/pricingIsolation.js'
import { pricingFaqs, pricingFaqCategories } from '../../src/views/pricingFaqs.js'

const plans = [
  { id: 'pack', name: '创作积分包', kind: 'topup', priceCents: 20000, grantCents: 2000, bonusCents: 30, features: ['全平台创作工具通用', '失败或取消自动返还'] },
  { id: 'monthly', name: '专业创作者计划', kind: 'subscription', priceCents: 9900, dailyGrantCents: 100, durationDays: 30, recommended: true, features: ['全平台创作工具通用'] },
]
const imageModel = { id: 'gpt-image-2', name: 'GPT Image 2', pricePoints: 10 }
const rangeModel = { id: 'scene-range', name: 'Scene Range', pricePoints: 2 }
const chatModel = { id: 'chat-pro', name: 'Chat Pro', kind: 'chat', pricePoints: 2,
  reasoningEfforts: [{ id: 'low', label: '低', pricePoints: 1 }, { id: 'high', label: '高', pricePoints: 4 }] }

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: false }))
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, {
    aiModelCatalog: { publicModels: [imageModel] },
    features: {
      'ai.assistant': { enabled: true, config: { imageModels: [
        { ...imageModel, pricePoints: 5, standardPricePoints: 10, discountPricePoints: 5, workspacePriceOverridden: true },
        rangeModel,
        ...Array.from({ length: 5 }, (_, index) => ({
          id: 'image-' + index,
          name: 'Image ' + index,
          pricePoints: index === 1 ? 6 : 10,
          ...(index === 1 ? { standardPricePoints: 10, discountPricePoints: 6, description: '适合快速出图的通用模型。', resolutions: ['1K', '2K', '4K'] } : {}),
          maintenance: index === 0,
        })),
      ], textModels: [chatModel] } },
      'ai.wallpaperGeneration': { enabled: true, config: { publicModels: [
        { ...imageModel, pricePoints: 3, workspacePriceOverridden: true },
        { ...rangeModel, pricePoints: 8 },
      ] } },
    },
  }))
})

test('pricing FAQ covers the billing lifecycle and filters questions and answers', async ({ page }) => {
  expect(pricingFaqs.length).toBeGreaterThanOrEqual(30)
  expect(new Set(pricingFaqs.map(item => item.id)).size).toBe(pricingFaqs.length)
  for (const [category] of pricingFaqCategories) expect(pricingFaqs.filter(item => item.category === category).length).toBeGreaterThan(0)
  await page.goto('/pricing')
  const faq = page.locator('#pricing-faq')
  await faq.scrollIntoViewIfNeeded()
  await expect(faq.locator('.pp-faq__item')).toHaveCount(pricingFaqs.length)
  await faq.getByRole('button', { name: '退订与退款', exact: true }).click()
  await expect(faq.locator('.pp-faq__item')).toHaveCount(pricingFaqs.filter(item => item.category === 'refund').length)
  const search = faq.getByRole('searchbox', { name: '搜索购买与计费问题' })
  await search.fill('人工例外')
  await expect(faq.locator('.pp-faq__item')).toHaveCount(1)
  await faq.getByRole('button', { name: '只使用了少量订阅积分，还能退剩余部分吗？', exact: true }).click()
  const answer = faq.locator('.pp-faq__item.is-open')
  await expect(answer).toContainText('即使只用了1积分')
  await expect(answer).toContainText('不承诺全退')
  await expect(answer.getByRole('link', { name: '提交协商与核查需求' })).toHaveAttribute('href', '/feedback')
  await search.fill('不存在的问题xyz')
  await expect(faq.getByText('没有找到相关问题', { exact: true })).toBeVisible()
  await faq.getByRole('button', { name: '查看全部问题', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(faq.locator('.pp-faq__item')).toHaveCount(pricingFaqs.length)
  await search.fill('本轮积分不退回')
  await faq.getByRole('button', { name: '主动停止或取消任务，一定会退回积分吗？', exact: true }).click()
  await expect(faq.locator('.pp-faq__item.is-open')).toContainText('PPT/PSD')
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`detailed FAQ answers fit at ${viewport.width}px and collapsed links are not focusable`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/pricing')
    const faq = page.locator('#pricing-faq')
    await faq.getByRole('button', { name: '积分与消费', exact: true }).click()
    const question = faq.getByRole('button', { name: '同时有订阅积分和额度包积分，先扣哪一种？', exact: true })
    await question.click()
    const answer = faq.locator('.pp-faq__item.is-open .pp-faq__a')
    await expect(answer).toContainText('3,750积分')
    await expect(answer.getByRole('link')).toBeVisible()
    await expect.poll(() => answer.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    expect(await faq.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`pricing-faq-${viewport.width}.png`), fullPage: false })
    await question.click()
    const panel = page.locator('#' + await question.getAttribute('aria-controls'))
    await expect(panel).toHaveAttribute('inert', '')
    await expect(panel.locator('a')).toHaveAttribute('tabindex', '-1')
  })
}

test('pricing header has centered artistic gradient type and stable capsule plan controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/pricing')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('选择适合你的创作方案')
  await expect(page.locator('.pp-hero__eyebrow')).toHaveCount(0)
  await expect(heading.locator('span')).toHaveText('创作方案')
  await expect(heading).toHaveCSS('font-family', /Songti SC/)
  await expect(heading).toHaveCSS('background-image', /linear-gradient/)
  await expect(heading.locator('span')).toHaveCSS('background-image', 'none')
  await expect(page.locator('.pp-hero__subtitle br')).toHaveCount(0)
  await expect(page.locator('.pp-hero__subtitle')).toHaveText('按需选择额度包或订阅方案，让创作预算更清晰。')
  await expect(page.locator('.pp-hero__subtitle')).toHaveCSS('white-space', 'nowrap')
  const subtitle = await page.locator('.pp-hero__subtitle').boundingBox()
  expect(subtitle.height).toBe(20)
  expect(subtitle.width).toBeLessThan(1280)
  const position = await heading.boundingBox()
  expect(Math.abs(position.x + position.width / 2 - 640)).toBeLessThan(1)
  const controls = page.getByRole('group', { name: '套餐类型', exact: true })
  const pack = controls.getByRole('button', { name: '额度包', exact: true })
  const subscription = controls.getByRole('button', { name: '订阅', exact: true })
  await expect(pack).toHaveAttribute('aria-pressed', 'true')
  await expect(controls).toHaveCSS('border-radius', '999px')
  await expect(controls.getByRole('switch')).toHaveCount(0)
  const initial = await controls.boundingBox()
  await subscription.press('Space')
  await expect(subscription).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/plan=subscription/)
  await expect(page.getByRole('heading', { name: '专业创作者计划' })).toBeVisible()
  const selected = await controls.boundingBox()
  expect(selected.width).toBe(initial.width)
  expect(selected.height).toBe(initial.height)
  await pack.press('Space')
  await expect(pack).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: '创作积分包', exact: true })).toBeVisible()
})

test('pricing top background fades out and follows the site theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/pricing')
  const root = page.locator('.pp-pricing')
  await expect(root).toHaveCSS('background-image', /linear-gradient.*rgb\(174, 223, 238\)/)
  await expect(root).toHaveCSS('background-size', '100% 440px, 100% 440px, 100% 440px')
  await expect(page.locator('.pp-plan').first()).toHaveCSS('background-image', 'none')
  await page.locator('label[title="切换暗色模式"]').click()
  await expect(root).toHaveClass(/is-dark/)
  await expect(root).toHaveCSS('background-image', /linear-gradient.*rgb\(22, 64, 80\)/)
  await expect(page.locator('.pp-plan').first()).toHaveCSS('background-image', 'none')
})

test('capsule selection slides, can reverse, and stays aligned across themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // GSAP's ticker needs an advancing Date clock, unlike the static visual baseline.
  await page.clock.setSystemTime(new Date('2026-08-11T12:00:00+08:00'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/pricing')
  const controls = page.getByRole('group', { name: '套餐类型', exact: true })
  const pack = controls.getByRole('button', { name: '额度包', exact: true })
  const subscription = controls.getByRole('button', { name: '订阅', exact: true })
  const thumb = controls.locator('.pp-plan-thumb')
  await expect(controls).toHaveCSS('border-width', '0px')
  await expect(thumb).toHaveCSS('border-width', '0px')
  await expect(controls).toHaveCSS('backdrop-filter', 'blur(18px) saturate(1.3)')
  const origin = (await thumb.boundingBox()).x
  const destination = (await subscription.boundingBox()).x
  // Capture during the click; waiting for a remote assertion can miss the 300ms tween.
  await thumb.evaluate(el => {
    el.slideSamples = new Promise(resolve => {
      el.closest('[role="group"]').addEventListener('click', () => {
        const samples = []
        function sample() {
          samples.push(el.getBoundingClientRect().x)
          if (samples.length === 24) resolve(samples)
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, { once: true, capture: true })
    })
  })
  await subscription.click()
  const positions = await thumb.evaluate(el => el.slideSamples)
  await expect(subscription).toHaveAttribute('aria-pressed', 'true')
  expect(positions.some(x => x > origin + 1 && x < destination - 1), JSON.stringify({ origin, destination, positions })).toBe(true)
  await expect.poll(async () => Math.abs((await thumb.boundingBox()).x - destination)).toBeLessThan(1)
  await pack.click()
  await subscription.click()
  await pack.click()
  await expect.poll(async () => Math.abs((await thumb.boundingBox()).x - origin)).toBeLessThan(1)
  await page.locator('label[title="切换暗色模式"]').click()
  await expect(controls).toHaveCSS('background-color', 'rgba(24, 22, 32, 0.52)')
  await expect(pack).toHaveCSS('color', 'rgb(245, 238, 255)')
  await expect(thumb).toHaveCSS('background-image', /rgba\(113, 100, 142, 0.48\)/)
  await expect.poll(async () => Math.abs((await thumb.boundingBox()).x - (await pack.boundingBox()).x)).toBeLessThan(1)
})

test('capsule respects reduced motion and subscription deep links', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/pricing?plan=subscription')
  const controls = page.getByRole('group', { name: '套餐类型', exact: true })
  const thumb = controls.locator('.pp-plan-thumb')
  const subscription = controls.getByRole('button', { name: '订阅', exact: true })
  const pack = controls.getByRole('button', { name: '额度包', exact: true })
  await expect(subscription).toHaveAttribute('aria-pressed', 'true')
  expect(Math.abs((await thumb.boundingBox()).x - (await subscription.boundingBox()).x)).toBeLessThan(1)
  await pack.click()
  await expect(pack).toHaveAttribute('aria-pressed', 'true')
  expect(Math.abs((await thumb.boundingBox()).x - (await pack.boundingBox()).x)).toBeLessThan(1)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => document.documentElement.classList.add('settings-no-animations'))
  await subscription.click()
  await expect(subscription).toHaveAttribute('aria-pressed', 'true')
  expect(Math.abs((await thumb.boundingBox()).x - (await subscription.boundingBox()).x)).toBeLessThan(1)
})

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  test('pricing cards and floating scene prices ' + viewport.width, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/pricing')
    await expectPricingPageIsolated(page)
    await expect(page.locator('.pp-plan__quota')).toContainText('2,030')
    await expect(page.locator('.pp-plan button')).toBeDisabled()
    const positions = await page.evaluate(() => ({
      plans: document.querySelector('#pricing-plans').getBoundingClientRect().top,
      models: document.querySelector('#pricing-models').getBoundingClientRect().top,
    }))
    expect(positions.plans).toBeLessThan(positions.models)
    await expect(page.locator('.pp-workspaces, .pp-model-table, .pp-nav')).toHaveCount(0)
    const subscription = page.getByRole('group', { name: '套餐类型', exact: true }).getByRole('button', { name: '订阅', exact: true })
    await subscription.click()
    await expect(subscription).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: '专业创作者计划' })).toBeVisible()
    await expect(page.locator('.pp-plan')).toHaveClass(/is-popular/)

    await page.locator('#pricing-models').scrollIntoViewIfNeeded()
    await expect(page.locator('.pc-model[data-model-id="gpt-image-2"]')).toHaveCount(1)
    await expect(page.locator('.pc-model[data-model-id="gpt-image-2"] .pc-price > strong')).toHaveText('10')
    await expect(page.locator('.pc-model[data-model-id="scene-range"] .pc-price > strong')).toHaveText('2–8')
    await expect(page.getByRole('group', { name: '场景价格' })).toHaveCount(0)
    await expect(page.locator('#pricing-pay, .pp-access')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '常见问题', exact: true })).toBeVisible()
    await expect(page.locator('#pricing-faq')).toContainText('现在可以购买套餐吗？')
    await expect(page.locator('#pricing-faq-a-0')).toHaveAttribute('aria-hidden', 'false')
    await expect(page.getByText('支付渠道启用后，选择额度包或订阅方案，可使用支付宝或微信扫码支付。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '现在怎样获取积分？', exact: true }).click()
    await expect(page.locator('#pricing-faq-a-1')).toHaveAttribute('aria-hidden', 'false')
    await expect(page.locator('#pricing-faq-a-0')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('#pricing-faq-a-1')).toContainText('可以购买额度包，或购买订阅后按周期领取积分')
    const overflow = await page.locator('.pp-pricing').evaluate(root => ({
      page: document.documentElement.scrollWidth > innerWidth,
      elements: [...root.querySelectorAll('h1, h2, h3, button, .pc-model')]
        .filter(el => !el.classList.contains('visually-hidden') && !el.classList.contains('pp-faq__q') && el.scrollWidth > el.clientWidth + 1).map(el => el.className),
    }))
    expect(overflow).toEqual({ page: false, elements: [] })
  })
}

test('floating prices support keyboard, dark theme, maintenance and model variants', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/pricing')
  await expect(page.locator('.pc-model')).toHaveCount(8)
  await expect(page.getByRole('button', { name: /查看全部模型|收起模型/ })).toHaveCount(0)
  const rows = await page.locator('.pc-model').evaluateAll((nodes) => {
    const tops = nodes.map((card) => ({
      top: Math.round(card.getBoundingClientRect().top),
      head: card.querySelector('.pc-model__head').getBoundingClientRect().top,
      desc: card.querySelector('.pc-model__desc').getBoundingClientRect().top,
      resolutions: card.querySelector('.pc-model__resolutions').getBoundingClientRect().top,
      meta: card.querySelector('.pc-model__meta').getBoundingClientRect().top,
      height: card.getBoundingClientRect().height,
    }))
    const groups = new Map()
    for (const card of tops) {
      if (!groups.has(card.top)) groups.set(card.top, [])
      groups.get(card.top).push(card)
    }
    return [...groups.values()]
  })
  for (const row of rows) {
    for (const key of ['head', 'desc', 'resolutions', 'meta', 'height']) {
      expect(Math.max(...row.map((card) => card[key])) - Math.min(...row.map((card) => card[key])), key).toBeLessThan(1)
    }
  }
  const discounted = page.locator('.pc-model[data-model-id="image-1"]')
  await expect(discounted.locator('.pc-model__desc')).toHaveText('适合快速出图的通用模型。')
  await expect(discounted.locator('.pc-price > em')).toHaveText('折扣')
  await expect(discounted.locator('.pc-price > strong')).toHaveText('6')
  await expect(discounted.locator('.pc-price > del')).toContainText('10')
  await expect(discounted.locator('.pc-model__resolutions li')).toHaveText(['1K', '2K', '4K'])
  await expect(page.locator('.pc-model__note')).toHaveCount(0)
  const maintenance = page.locator('.pc-model[data-model-id="image-0"]')
  await expect(maintenance).toContainText('维护中')
  await expect(maintenance.locator('.pc-price-unavailable')).toHaveText('—')
  await page.locator('label[title="切换暗色模式"]').click()
  await expect(page.locator('.pp-pricing')).toHaveClass(/is-dark/)
  await page.getByRole('group', { name: '模型类型' }).getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.locator('.pc-model')).toHaveCount(1)
  await page.locator('.pc-model').getByRole('button', { name: '价格明细', exact: true }).press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Chat Pro价格明细', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.pc-variants')).toContainText('低')
  await expect(dialog.locator('.pc-variants')).toContainText('高')
  await expect(page.locator('.pc-popover.is-dark:visible .ant-popover-container')).toHaveCSS('background-color', 'rgb(30, 26, 37)')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.getByRole('group', { name: '模型类型' }).getByRole('button', { name: '工具', exact: true }).click()
  await expect(page.getByText('暂无此类模型', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '创作单价', exact: true })).toHaveCount(0)
})

test('plan comparisons align prices, credits and actions before benefits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/plans', route => fulfillJson(route, { paymentEnabled: false, items: [
    plans[0],
    { ...plans[0], id: 'plus', name: '进阶创作积分包', priceCents: 99000, grantCents: 10000, description: '适合持续创作与团队项目，一次性发放创作积分。'.repeat(6), features: ['全平台创作工具通用'], recommended: true },
    { ...plans[0], id: 'large', name: '专业项目与批量创作积分包', priceCents: 199000, grantCents: 20000, description: '更高的创作额度。' },
  ] }))
  await page.goto('/pricing')
  await expect(page.locator('.pp-plan')).toHaveCount(3)
  const cards = await page.locator('.pp-plan').evaluateAll(nodes => nodes.map(card => ({
    price: card.querySelector('.pp-plan__price').getBoundingClientRect().top,
    quota: card.querySelector('.pp-plan__quota').getBoundingClientRect().top,
    button: card.querySelector('button').getBoundingClientRect().top,
    benefits: card.querySelector('.pp-plan__benefits').getBoundingClientRect().top,
  })))
  for (const key of ['price', 'quota', 'button']) {
    expect(Math.max(...cards.map(card => card[key])) - Math.min(...cards.map(card => card[key]))).toBeLessThan(1)
  }
  for (const card of cards) {
    expect(card.price).toBeLessThan(card.button)
    expect(card.button).toBeLessThan(card.benefits)
  }
  const featured = page.locator('.pp-plan.is-popular')
  const ribbon = featured.locator('.pp-plan__ribbon')
  await expect(ribbon.locator('b')).toHaveText('推荐方案')
  await expect(ribbon).toHaveCSS('height', '44px')
  await expect(page.locator('.pp-plan').first()).toHaveCSS('border-radius', '24px')
  await expect(ribbon).toHaveCSS('border-top-left-radius', '24px')
  await expect(featured).toHaveCSS('border-left-width', '6px')
  expect(await featured.evaluate(el => getComputedStyle(el, '::before').borderTopLeftRadius)).toBe('18px')
  await expect(featured.locator('.pp-plan__benefits')).toHaveCSS('border-bottom-left-radius', '18px')
  await expect(featured).toHaveCSS('border-left-color', 'rgb(122, 100, 224)')
  await expect(featured).toHaveCSS('background-image', 'none')
  await expect(featured.locator('.pp-plan__description')).toHaveCSS('-webkit-line-clamp', '1')
  const ribbonBox = await ribbon.boundingBox()
  const cardBox = await featured.boundingBox()
  expect(ribbonBox.y).toBeLessThan(cardBox.y + 8)
  expect(ribbonBox.y + ribbonBox.height).toBeGreaterThan(cardBox.y)
  expect((await featured.boundingBox()).width).toBeGreaterThan((await page.locator('.pp-plan').first().boundingBox()).width)
  await expect(featured.locator('.pp-plan__purchase button')).toHaveCSS('background-image', /rgb\(122, 108, 245\)/)
  await page.locator('label[title="切换暗色模式"]').click()
  await expect(featured).toHaveCSS('border-left-color', 'rgb(122, 100, 224)')
  await expect(featured.locator('.pp-plan__benefits')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.pp-wallet')).toHaveCount(0)
  await expect(page.locator('#pricing-pay, .pp-access')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '常见问题', exact: true })).toBeVisible()
})

for (const width of [1440, 768, 390, 320]) {
  test(`promotion badge stays legible above its light beam at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/v1/plans', route => fulfillJson(route, { paymentEnabled: false, items: [
      ...(width >= 1100 ? [plans[0]] : []),
      { ...plans[0], id: 'hot', recommended: true, badge: '热卖/限时' },
      ...(width >= 1100 ? [{ ...plans[0], id: 'large' }] : []),
    ] }))
    await page.goto('/pricing')
    const card = page.locator('.pp-plan.is-popular')
    const flag = card.locator('.pp-plan__ribbon-flag')
    await expect(flag.locator('b')).toHaveText('热卖 / 限时')
    await expect(flag).toHaveCSS('height', '36px')
    await expect(flag).toHaveCSS('isolation', 'isolate')
    const backing = await flag.evaluate(el => {
      const style = getComputedStyle(el, '::before')
      return { transform: style.transform, mask: style.maskImage, background: style.backgroundColor, zIndex: style.zIndex }
    })
    expect(backing.transform).toBe('none')
    expect(backing.mask).toContain('data:image/svg+xml')
    expect(backing.background).toBe('rgb(122, 100, 224)')
    expect(backing.zIndex).toBe('-1')
    const silhouette = await flag.evaluate(async el => {
      const source = getComputedStyle(el, '::before').maskImage.slice(5, -2)
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 40
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, 200, 40)
      const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3]
      return {
        leftFlare: alpha(12, 17),
        leftInset: alpha(12, 23),
        rightFlare: alpha(187, 17),
        rightInset: alpha(187, 23),
        body: alpha(100, 23),
      }
    })
    expect(silhouette).toEqual({ leftFlare: 255, leftInset: 0, rightFlare: 255, rightInset: 0, body: 255 })
    expect(await flag.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none')
    const geometry = await flag.evaluate(el => {
      const rect = el.getBoundingClientRect()
      const cardRect = el.closest('.pp-plan').getBoundingClientRect()
      const text = el.querySelector('b')
      return {
        centered: Math.abs(rect.x + rect.width / 2 - cardRect.x - cardRect.width / 2) < 1,
        fits: text.scrollWidth <= text.clientWidth,
        inside: rect.left >= cardRect.left && rect.right <= cardRect.right,
        overlapsArt: rect.bottom > el.closest('.pp-plan').querySelector('.pp-plan__mark').getBoundingClientRect().top,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
    expect(geometry).toEqual({ centered: true, fits: true, inside: true, overlapsArt: false, pageOverflow: false })
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('promotion-light.png') })
    // The global theme control is only exposed in the desktop header.
    if (width < 1100) await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('label[title="切换暗色模式"]').click()
    await expect(page.locator('.pp-pricing')).toHaveClass(/is-dark/)
    await page.setViewportSize({ width, height: 900 })
    await expect(flag.locator('b')).toHaveCSS('color', 'rgb(255, 255, 255)')
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('promotion-dark.png') })
  })
}

test('long promotion labels stay within the badge and keep their full tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const badge = '热卖 / 限时优惠创作者专享套餐'
  await page.route('**/api/v1/plans', route => fulfillJson(route, { paymentEnabled: false, items: [
    { ...plans[0], recommended: true, badge },
  ] }))
  await page.goto('/pricing')
  await expect(page.locator('.pp-plan__ribbon')).toHaveAttribute('title', badge)
  await expect(page.locator('.pp-plan__ribbon-flag > b')).toHaveCSS('text-overflow', 'ellipsis')
  expect(await page.locator('.pp-plan__ribbon-flag').evaluate(el => {
    const rect = el.getBoundingClientRect()
    const cardRect = el.closest('.pp-plan').getBoundingClientRect()
    return rect.left >= cardRect.left && rect.right <= cardRect.right
  })).toBe(true)
})

test('pricing request failure keeps preview and empty states usable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.route('**/api/v1/plans', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, {}))
  await page.goto('/pricing')
  await expect(page.locator('.pp-note')).toContainText('已显示预览方案')
  await expect(page.locator('.pp-plan button')).toBeEnabled()
  await expect(page.locator('#pricing-models .pp-empty')).toBeVisible()
  await page.getByRole('group', { name: '套餐类型', exact: true }).getByRole('button', { name: '订阅', exact: true }).click()
  await expect(page.locator('.pp-plan button:disabled')).toHaveCount(2)
  await expect(page.locator('.pp-plan.is-loading')).toHaveCount(0)
})

for (const [status, message] of [['pending', '你有一笔未支付订单'], ['uncertain', '你有一笔支付结果待核实的订单'], ['paid', '你有一笔正在确认到账的订单']]) {
  test(`plan selection warns about an existing ${status} order before checkout`, async ({ page }) => {
    await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'pricing-user', email: 'pricing@example.com' } }))
    await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: true, paymentMethods: ['alipay'] }))
    await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: new URL(route.request().url()).searchParams.get('status') === status ? [{ id: 'existing', planId: 'monthly', planName: '专业创作者计划', amountCents: 9900, status }] : [] }))
    let creates = 0
    await page.route('**/api/v1/orders', route => { creates++; return fulfillJson(route, {}) })
    await page.goto('/pricing')
    await page.getByRole('button', { name: '选择此方案', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '请先处理现有订单', exact: true })
    await expect(dialog).toContainText(message)
    await expect(dialog).toContainText('专业创作者计划')
    await expect(dialog).toContainText('¥99.00')
    await expect(dialog.getByRole('radiogroup')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '使用支付宝支付' })).toHaveCount(0)
    expect(creates).toBe(0)
    await dialog.getByRole('link', { name: '查看我的订单' }).click()
    await expect(page).toHaveURL(/\/orders$/)
  })
}

test('plan selection can retry a failed order check and still reuse the same plan', async ({ page }) => {
  await page.route('**/api/v1/orders/existing', route => fulfillJson(route, { id: 'existing', planId: 'pack', status: 'pending', paymentMethod: 'alipay', payUrl: 'https://example.com/pay', amountCents: 20000 }))
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'pricing-user', email: 'pricing@example.com' } }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: true, paymentMethods: ['alipay'] }))
  let failCheck = true
  await page.route('**/api/v1/orders?*', route => failCheck
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) })
    : fulfillJson(route, { items: new URL(route.request().url()).searchParams.get('status') === 'pending' ? [{ id: 'existing', planId: 'pack', status: 'pending' }] : [] }))
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('暂时无法确认')
  await expect(dialog.getByRole('radiogroup')).toHaveCount(0)
  failCheck = false
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click()
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('closing an in-flight order check does not reopen the checkout', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'pricing-user', email: 'pricing@example.com' } }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: true, paymentMethods: ['alipay'] }))
  let release
  const blocked = new Promise(resolve => { release = resolve })
  await page.route('**/api/v1/orders?*', async route => { await blocked; await fulfillJson(route, { items: [] }).catch(() => {}) })
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('正在检查未支付订单')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  release()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('checkout conflict explains the single unpaid order rule and links to orders', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'pricing-user', email: 'pricing@example.com', username: '创作者' } }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: true, paymentMethods: ['alipay'] }))
  await page.route('**/api/v1/orders', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'user_unsettled_order', error: '你已有一笔待处理订单，请先在我的订单中处理' }) }))
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '使用支付宝支付', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('已有一笔待处理订单')
  await expect(dialog.getByRole('link', { name: '查看我的订单' })).toHaveAttribute('href', '/orders')
  await dialog.getByRole('link', { name: '查看我的订单' }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('plan keyboard selection and enabled checkout keep their existing behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'pricing-user', email: 'pricing@example.com', username: '创作者' } }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: true, paymentMethods: ['alipay'] }))
  await page.goto('/pricing')
  const tab = page.getByRole('group', { name: '套餐类型', exact: true }).getByRole('button', { name: '额度包', exact: true })
  await tab.press('ArrowRight')
  await expect(page.getByRole('group', { name: '套餐类型', exact: true }).getByRole('button', { name: '订阅', exact: true })).toBeFocused()
  await expect(page.locator('.pp-plan__price')).toContainText('/ 30 天')
  await expect(page.locator('.pp-plan__quota strong')).toHaveText('100')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '专业创作者计划', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toContainText('星空云绘收银台')
  await expect(dialog).toContainText('¥99.00')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).not.toBeVisible()
})
