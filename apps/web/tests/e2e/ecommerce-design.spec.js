import { expect, test } from '@playwright/test'

const USER = {
  id: 'e2e-user-1',
  email: 'e2e@example.com',
  username: 'E2E 用户',
  displayName: 'E2E 用户',
}

const IMAGE_MODEL = {
  id: 'e2e-image-model',
  publicModelKey: 'e2e-image-model',
  label: 'E2E 图片模型',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'],
  aspectRatios: ['1:1', '3:4', '4:5', '16:9', '9:16'],
  aspectRatiosByResolution: { '1K': ['1:1', '3:4', '4:5', '16:9', '9:16'] },
  qualities: ['low', 'medium', 'high'],
  resolutions: ['1K'],
  maxReferenceImages: 6,
  creditCost: 3,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await mockEcommerceApis(page)
})

test('desktop ecommerce workspace reaches the product library and recovers from an empty search', async ({
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/ecommerce-design?tool=listing')
  await expect(page.locator('.commerce-studio')).toBeVisible()
  await expect(page.locator('.commerce-workspace-title')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建任务' })).toHaveCount(0)
  await expect(page.locator('.settings-heading h2').first()).toBeVisible()

  await page.locator('.commerce-header__actions button').filter({ hasText: '商品库' }).click()
  await expect(page.locator('.commerce-products h2')).toHaveText('商品库')

  const search = page.getByRole('searchbox', { name: '搜索商品库' })
  await search.fill('不存在的商品')
  await expect(page.getByText('没有匹配的商品', { exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('English ecommerce workspace keeps labels in one locale', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'en'))
  await page.goto('/ecommerce-design?tool=listing')

  await expect(page.locator('.settings-heading h2').first()).toHaveText('Product images')
  await expect(page.getByRole('heading', { name: 'Generation settings' })).toBeVisible()
  await page
    .locator('.commerce-header__actions button')
    .filter({ hasText: 'Product library' })
    .click()
  await expect(page.locator('.commerce-products h2')).toHaveText('Product library')

  const search = page.getByRole('searchbox', { name: 'Search product library' })
  await search.fill('missing product')
  await expect(page.getByText('No matching products', { exact: true })).toBeVisible()
})

test('minimum desktop ecommerce workspace stays usable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/ecommerce-design?tool=listing')

  await expect(page.locator('.commerce-layout')).toBeVisible()
  await expect(page.locator('.commerce-settings')).toBeVisible()
  await expect(page.locator('.commerce-canvas')).toBeVisible()
  await expect(page.locator('.canvas-facts')).toHaveCount(0)
  await expect(
    page.locator('.settings-heading').filter({ hasText: '生成设置' }).locator(':scope > span'),
  ).toHaveCount(0)
  await expect(page.locator('.showcase-demo img')).toHaveAttribute('src', /listing-preview/)
  await expect(page.getByRole('button', { name: /从商品库选择/ })).toHaveCount(0)
  await expect(page.locator('.commerce-rail button')).toHaveCount(13)
  expect(
    await page.locator('.commerce-rail a, .commerce-rail button').evaluateAll((tabs) =>
      tabs.every((tab, index) => {
        if (index === 0) return true
        return tab.getBoundingClientRect().top >= tabs[index - 1].getBoundingClientRect().bottom
      }),
    ),
  ).toBe(true)
  await expect(page.locator('.commerce-rail')).toContainText('AI 商拍')
  await expect(page.locator('.commerce-rail')).toContainText('商品阴影')
  await expect(page.locator('.commerce-rail')).toContainText('清晰增强')
  await expect(page.getByText('更多工具', { exact: true })).toHaveCount(0)
  await expect(page.locator('.commerce-rail')).toHaveClass(/is-at-start/)
  const shootTab = page.locator('.commerce-rail button').filter({ hasText: 'AI 商拍' })
  await shootTab.hover()
  await page.waitForTimeout(80)
  expect(await shootTab.locator('.commerce-rail__icon').evaluate((icon) => icon.style.transform)).not.toBe('')
  const hoverStyles = await shootTab.evaluate((tab) => ({
    shadow: getComputedStyle(tab).boxShadow,
    labelWeight: getComputedStyle(tab.querySelector('.commerce-rail__label')).fontWeight,
    iconOpacity: Number.parseFloat(getComputedStyle(tab.querySelector('.commerce-rail__icon')).opacity),
  }))
  expect(hoverStyles.shadow).toBe('none')
  expect(hoverStyles.labelWeight).toBe('800')
  expect(hoverStyles.iconOpacity).toBeGreaterThan(0.28)
  expect(hoverStyles.iconOpacity).toBeLessThanOrEqual(0.42)
  await shootTab.click()
  await expect(page).toHaveURL(/tool=shoot/)
  expect(
    await page.locator('.commerce-rail__scroll').evaluate((scroll) => {
      const styles = getComputedStyle(scroll)
      return styles.overflowY === 'auto' && scroll.scrollHeight > scroll.clientHeight
    }),
  ).toBe(true)
  await page.locator('.commerce-rail__scroll').evaluate((scroll) => {
    scroll.scrollTop = scroll.scrollHeight
  })
  await expect(page.locator('.commerce-rail')).toHaveClass(/is-at-end/)
  expect(await page.locator('.showcase-demo img').evaluate((image) => image.naturalWidth > 0)).toBe(
    true,
  )
  await expect(page.locator('.mobile-pane-switch')).toBeHidden()

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(fitsViewport).toBe(true)
})

test('ecommerce workspace uses layered atelier surfaces in light and dark', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=listing')
  await expect(page.locator('.commerce-studio')).toBeVisible()
  await expect(page.locator('.commerce-atmosphere')).toBeVisible()
  await expect(page.locator('.commerce-header__brand')).toContainText('AI 电商')

  const surfaceTokens = async () =>
    page.evaluate(() => {
      const studio = document.querySelector('.commerce-studio')
      const styles = getComputedStyle(studio)
      return {
        canvas: styles.getPropertyValue('--commerce-canvas').trim(),
        accent: styles.getPropertyValue('--commerce-accent').trim(),
        settingsRadius: styles.getPropertyValue('--commerce-settings-radius').trim(),
        headerRadius: getComputedStyle(document.querySelector('.commerce-header')).borderRadius,
        railRadius: getComputedStyle(document.querySelector('.commerce-rail')).borderRadius,
        settingsRadiusComputed: getComputedStyle(document.querySelector('.commerce-settings'))
          .borderRadius,
        canvasRadius: getComputedStyle(document.querySelector('.commerce-canvas')).borderRadius,
        uploadRadius: getComputedStyle(document.querySelector('.product-upload')).borderRadius,
        hasAtmosphere: Boolean(document.querySelector('.commerce-atmosphere__glow')),
        stepCount: document.querySelectorAll('.showcase-demo__tag').length,
      }
    })

  expect(await surfaceTokens()).toEqual({
    canvas: '#f3f1f8',
    accent: '#6d5cff',
    settingsRadius: '20px',
    headerRadius: '18px',
    railRadius: '18px',
    settingsRadiusComputed: '20px',
    canvasRadius: '20px',
    uploadRadius: '20px',
    hasAtmosphere: true,
    stepCount: 5,
  })
  await page.evaluate(() => document.documentElement.classList.add('color-scheme-dark'))
  expect(await surfaceTokens()).toMatchObject({
    canvas: '#0c0a12',
    accent: '#8b7bff',
    settingsRadius: '20px',
    hasAtmosphere: true,
    stepCount: 5,
  })
})

test('desktop ecommerce layout stays aligned across common workspaces', async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080, name: '1920' },
    { width: 1440, height: 900, name: '1440' },
    { width: 1024, height: 768, name: '1024' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/ecommerce-design?tool=listing')
    await expect(page.locator('.commerce-settings')).toBeVisible()
    await expect(page.locator('.commerce-rail')).toBeVisible()
    await expect(page.locator('.commerce-canvas')).toBeVisible()

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector)?.getBoundingClientRect()
        return value
          ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom }
          : null
      }
      return {
        rail: rect('.commerce-rail'),
        settings: rect('.commerce-settings'),
        canvas: rect('.commerce-canvas'),
        showcase: rect('.canvas-showcase'),
        image: rect('.showcase-demo img'),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    expect(layout.settings).toBeTruthy()
    expect(layout.rail).toBeTruthy()
    expect(layout.canvas).toBeTruthy()
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1)
    expect(layout.settings.left - layout.rail.right).toBeGreaterThanOrEqual(4)
    expect(layout.settings.left - layout.rail.right).toBeLessThanOrEqual(10)
    expect(layout.canvas.left - layout.settings.right).toBeGreaterThanOrEqual(4)
    expect(layout.canvas.left - layout.settings.right).toBeLessThanOrEqual(12)
    expect(layout.showcase.left).toBeGreaterThanOrEqual(layout.canvas.left)
    expect(layout.showcase.right).toBeLessThanOrEqual(layout.canvas.right + 1)
    expect(layout.image.bottom).toBeLessThanOrEqual(layout.showcase.bottom + 1)
    if (viewport.width === 1024) {
      await expect(page.locator('.nav-mobile-toggle')).toBeVisible()
      await expect(page.locator('.main-nav')).toBeHidden()
      await page.locator('.nav-mobile-toggle').click()
      await expect(page.locator('.main-nav')).toBeVisible()
      await page.locator('.nav-mobile-toggle').click()
      await expect(page.locator('.main-nav')).toBeHidden()
    }
  }
})

test('mobile ecommerce workspace keeps settings and canvas readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ecommerce-design?tool=listing')

  await expect(page.locator('.commerce-settings')).toBeVisible()
  await expect(page.locator('.mobile-tool-switch')).toBeVisible()
  await expect(page.locator('.mobile-tool-switch button')).toHaveCount(13)
  await expect(page.locator('.mobile-tool-switch')).toContainText('AI 商拍')
  await expect(page.locator('.mobile-tool-switch')).toContainText('清晰增强')
  await expect(page.locator('.generate-button')).toContainText('7张')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)

  await page.getByRole('tab', { name: '生成结果' }).click()
  await expect(page.locator('.canvas-showcase')).toBeVisible()
  await expect(page.locator('.showcase-demo img')).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
})

test('best-seller recreation supports an optional replacement product', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=clone')

  await expect(page.locator('.commerce-workspace-title')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '爆款参考与商品原图' })).toBeVisible()
  await expect(page.locator('.generate-meta')).toContainText('还需 1 张参考图')
  await expect(page.locator('.upload-role-guide')).toContainText('爆款参考必填')
  await expect(page.locator('.upload-role-guide')).toContainText('商品原图可选')
  await expect(page.getByRole('button', { name: /一键生成爆款图复刻/ })).toBeDisabled()
  await expect(page.getByLabel('选择文案语言')).toBeVisible()
  await expect(page.locator('.showcase-demo img')).toHaveAttribute('src', /clone-preview/)
  await expect(page.getByRole('button', { name: /从素材库选择/ })).toHaveCount(0)
  await expect(page.locator('.canvas-intro')).toContainText('上传爆款参考图')
})

test('custom listing structure reallocates an exact seven-image set', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=listing')
  await expect(page.locator('.shot-plan-section')).toContainText('7 张 · 首张后并行')
  await expect(page.locator('.shot-plan-section')).not.toContainText('顺序生成')
  await page.getByRole('button', { name: /自定义配置/ }).click()

  await expect(page.locator('.listing-count-config')).toContainText('已分配 7/7 张')
  await page.getByRole('button', { name: '减少场景图' }).click()
  await expect(page.locator('.listing-count-config')).toContainText('需要分配满 7 张')
  await page.getByRole('button', { name: '增加其他' }).click()
  await expect(page.locator('.listing-count-config')).toContainText('结构完整')
  await expect(page.locator('.shot-plan-list li')).toHaveCount(7)
})

test('AI product brief waits for confirmation and supports regeneration', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=listing')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'product.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })

  await page.getByRole('button', { name: 'AI 生成' }).click()
  const dialog = page.getByRole('dialog', { name: '生成商品名称和卖点' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '商品名称' })).toHaveValue('第一版商品名称')
  await expect(page.locator('.text-field input').first()).toHaveValue('')

  await dialog.getByRole('button', { name: '重新生成' }).click()
  await expect(dialog.getByRole('textbox', { name: '商品名称' })).toHaveValue('第二版商品名称')
  await dialog.getByRole('button', { name: '确认填入' }).click()

  await expect(page.locator('.text-field input').first()).toHaveValue('第二版商品名称')
  await expect(page.locator('.text-field textarea')).toHaveValue('第二版卖点一\n第二版卖点二')
})

test('fashion try-on separates garment, model, and scene choices', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=tryon')

  await expect(page.locator('.upload-role-guide')).toContainText('服装必填')
  await expect(page.locator('.upload-role-guide')).toContainText('模特可选')
  expect(
    await page
      .locator('.upload-role-guide > span')
      .evaluateAll((roles) => roles.every((role) => getComputedStyle(role).borderRadius === '20px')),
    ).toBe(true)
  await expect(page.locator('.choice-chip-grid button')).toHaveCount(7)
  await expect(page.getByRole('button', { name: /纯色棚拍/ })).toHaveClass(/active/)
  await expect(page.getByLabel('选择模特人群')).toBeVisible()
  await expect(page.locator('.showcase-demo img')).toHaveAttribute('src', /tryon-preview/)
  await expect(page.getByRole('button', { name: /从素材库选择/ })).toHaveCount(0)
  await expect(page.locator('.canvas-intro')).toContainText('上传服装')
})

test('detail page exposes the complete commerce module catalog', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail')
  await expect(page.locator('.module-grid label')).toHaveCount(15)
  await expect(page.getByText('品牌故事图', { exact: true })).toBeVisible()
  await expect(page.getByText('售后保障图', { exact: true })).toBeVisible()
  await expect(page.locator('.showcase-demo img')).toHaveAttribute('src', /detail-preview/)
})

test('continuous optimization stays compact until the user opens it', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail&seedResult=1')

  const panel = page.locator('.revision-panel')
  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveClass(/open/)
  await expect(page.getByLabel('选择调整方向')).toBeHidden()

  await page.getByRole('button', { name: '展开连续优化' }).click()
  await expect(panel).toHaveClass(/open/)
  await expect(page.getByLabel('选择调整方向')).toBeVisible()

  await page.getByRole('button', { name: '收起连续优化' }).click()
  await expect(panel).not.toHaveClass(/open/)
})

test('product library loads a product into the current task', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail')
  await page.locator('.commerce-header__actions button').filter({ hasText: '商品库' }).click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toBeVisible()

  await page.locator('.commerce-product-card__actions .is-primary').click()
  await expect(page.getByText('当前商品', { exact: true })).toBeVisible()
  await expect(page.locator('.upload-grid figure')).toHaveCount(1)
})

test('product deletion stays inside an accessible confirmation dialog', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail')
  await page.locator('.commerce-header__actions button').filter({ hasText: '商品库' }).click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toBeVisible()

  await page.locator('[aria-label="删除商品"]').click()
  const dialog = page.locator('[role="alertdialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[aria-label="取消删除"]')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator('.commerce-delete-dialog__danger')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.locator('[aria-label="取消删除"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[aria-label="删除商品"]')).toBeFocused()

  await page.locator('[aria-label="删除商品"]').click()
  await page.locator('.commerce-delete-dialog__danger').click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toHaveCount(0)
})

test('product library archives and restores a product', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail')
  await page.locator('.commerce-header__actions button').filter({ hasText: '商品库' }).click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '归档商品' }).click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '已归档' }).click()
  await expect(page.locator('.commerce-product-card strong')).toContainText('延迟返回的测试商品')
  await expect(page.locator('.commerce-product-card em')).toHaveText('已归档')

  await page.getByRole('button', { name: '恢复商品' }).click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '使用中' }).click()
  await expect(page.getByText('延迟返回的测试商品', { exact: true })).toBeVisible()
})

test('product editor warns before discarding unsaved changes', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail')
  await page.locator('.commerce-header__actions button').filter({ hasText: '商品库' }).click()
  await expect(page.locator('.commerce-products h2')).toHaveText('商品库')
  await page.locator('.commerce-products__header .commerce-products__primary').click()
  await page.locator('.commerce-product-editor__fields input').first().fill('未保存商品')

  await page.locator('.commerce-products__header .commerce-products__icon-button').last().click()
  await expect(page.locator('[role="alertdialog"]')).toBeVisible()
  await page.locator('.commerce-delete-dialog__danger').click()
  await expect(page.locator('.commerce-product-editor')).toHaveCount(0)
})

test('history loading exposes a retryable error instead of an empty state', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail&failHistory=1')
  await page.locator('.commerce-header__actions button').filter({ hasText: '电商历史' }).click()

  const historyError = page.locator('.workspace-library__inline-error')
  await expect(historyError).toContainText('历史记录读取失败')
  await historyError.locator('button').click()
  await expect(page.locator('.workspace-empty')).toBeVisible()
  await expect(historyError).toHaveCount(0)
})

test('ecommerce history exposes deletion and removes the record', async ({ page }) => {
  await page.goto('/ecommerce-design?tool=detail&seedResult=1')
  await page.locator('.commerce-header__actions button').filter({ hasText: '电商历史' }).click()

  await expect(page.locator('.asset-card')).toHaveCount(1)
  await page.getByRole('button', { name: '删除A+ 详情历史记录' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('如果其他结果由它继续生成，也会一并删除')
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.asset-card')).toHaveCount(0)
  await expect(page.locator('.workspace-empty')).toBeVisible()
})

test('generated result controls remain keyboard-accessible after loading history', async ({
  page,
}) => {
  await page.goto('/ecommerce-design?tool=detail&seedResult=1')
  await expect(page.locator('.result-workspace')).toBeVisible()
  await expect(page.locator('.result-image-tools')).toHaveCount(0)
  await expect(page.locator('.result-image-card img')).toHaveCSS('object-fit', 'contain')
  const resultFitsCanvas = await page.evaluate(() => {
    const stage = document.querySelector('.result-stage.is-single')
    const card = stage?.querySelector('.result-image-card')
    if (!stage || !card) return false
    const stageRect = stage.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return (
      cardRect.top >= stageRect.top &&
      cardRect.left >= stageRect.left &&
      cardRect.right <= stageRect.right &&
      cardRect.bottom <= stageRect.bottom &&
      stage.scrollHeight <= stage.clientHeight + 1
    )
  })
  expect(resultFitsCanvas).toBe(true)
  await expect(page.getByRole('button', { name: '放大查看当前结果' })).toBeVisible()
  await expect(page.getByRole('button', { name: '局部编辑当前结果' })).toBeVisible()

  const deleteButton = page.locator('.result-delete')
  await expect(deleteButton).toHaveCount(1)
  await deleteButton.focus()
  await expect(deleteButton).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.result-workspace')).toHaveCount(0)
})

async function mockEcommerceApis(page) {
  let failedHistoryRequests = 0
  let productStatus = 'active'
  let productBriefAttempts = 0
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === '/api/v1/auth/session') {
      await fulfill(route, { user: USER })
      return
    }
    if (path === '/api/v1/runtime-config') {
      await fulfill(route, {
        routes: {},
        features: {
          'ai.ecommerceDesign': {
            enabled: true,
            config: { publicModels: [IMAGE_MODEL] },
          },
        },
        aiModelCatalog: {
          providers: [],
          models: [],
          publicModels: [IMAGE_MODEL],
          featurePublicModels: [IMAGE_MODEL],
          updatedAt: 'e2e',
        },
        blacklist: { blocked: false, reason: '' },
      })
      return
    }
    if (path === '/api/v1/pricing') {
      await fulfill(route, { taskPointPrices: { ecommerce_design: 3 } })
      return
    }
    if (path === '/api/v1/uploads' && request.method() === 'POST') {
      await fulfill(route, {
        key: 'uploads/e2e-user-1/product.png',
        url: '/api/v1/files/mock-product.png',
      })
      return
    }
    if (path === '/api/v1/commerce/product-briefs' && request.method() === 'POST') {
      productBriefAttempts += 1
      await fulfill(route, {
        productName: productBriefAttempts === 1 ? '第一版商品名称' : '第二版商品名称',
        sellingPoints:
          productBriefAttempts === 1 ? '第一版卖点一\n第一版卖点二' : '第二版卖点一\n第二版卖点二',
      })
      return
    }
    if (path === '/api/v1/files/mock-product.png') {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      return
    }
    if (path === '/api/v1/commerce/products/e2e-product-1' && request.method() === 'PATCH') {
      const payload = request.postDataJSON() || {}
      productStatus = payload.status || productStatus
      await fulfill(route, {
        id: 'e2e-product-1',
        title: '延迟返回的测试商品',
        status: productStatus,
        sellingPoints: '真实卖点',
        assets: [
          {
            id: 'e2e-asset-1',
            title: '商品正面',
            url: '/api/v1/files/mock-product.png',
            thumbnailUrl: '/api/v1/files/mock-product.png',
          },
        ],
        assetIds: ['e2e-asset-1'],
        protectedElements: [],
      })
      return
    }
    if (path === '/api/v1/commerce/products') {
      const query = url.searchParams.get('q') || ''
      if (!query) {
        await new Promise((resolve) => setTimeout(resolve, 350))
        await fulfill(route, {
          items:
            url.searchParams.get('status') === productStatus || !url.searchParams.get('status')
              ? [
                  {
                    id: 'e2e-product-1',
                    title: '延迟返回的测试商品',
                    status: productStatus,
                    sellingPoints: '真实卖点',
                    assets: [
                      {
                        id: 'e2e-asset-1',
                        title: '商品正面',
                        url: '/api/v1/files/mock-product.png',
                        thumbnailUrl: '/api/v1/files/mock-product.png',
                      },
                    ],
                    assetIds: ['e2e-asset-1'],
                    protectedElements: [],
                  },
                ]
              : [],
          nextCursor: null,
        })
      } else {
        await fulfill(route, { items: [], nextCursor: null })
      }
      return
    }
    if (path === '/api/v1/tasks') {
      if (new URL(page.url()).searchParams.get('seedResult') === '1') {
        await fulfill(route, {
          items: [
            {
              id: 'e2e-result-task-1',
              type: 'ecommerce_design',
              status: 'succeeded',
              prompt: '测试电商结果',
              params: {
                _kind: 'ui-design-ecommerce-detail-generation',
                aspectRatio: '3:4',
                batchId: 'e2e-result-batch-1',
                batchIndex: 0,
                batchSize: 1,
                batchCreatedAt: '2026-01-01T00:00:00.000Z',
              },
              count: 1,
              originalUrls: ['/api/v1/files/mock-product.png'],
              outputUrls: ['/api/v1/files/mock-product.png'],
              createdAt: '2026-01-01T00:00:00.000Z',
              finishedAt: '2026-01-01T00:01:00.000Z',
            },
          ],
          nextCursor: null,
        })
        return
      }
      const shouldFail =
        new URL(page.url()).searchParams.get('failHistory') === '1' && failedHistoryRequests < 6
      if (shouldFail) {
        failedHistoryRequests += 1
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'history unavailable' }),
        })
        return
      }
      await fulfill(route, { items: [], nextCursor: null })
      return
    }
    if (path === '/api/v1/tasks/e2e-result-task-1' && request.method() === 'DELETE') {
      if (url.searchParams.get('cascade') !== 'true') {
        await route.fulfill({ status: 409, contentType: 'application/json', body: '{}' })
        return
      }
      await fulfill(route, { deletedTaskIds: ['e2e-result-task-1'] })
      return
    }
    if (path === '/api/v1/me/assets') {
      await fulfill(route, { items: [], nextCursor: null })
      return
    }
    if (path === '/api/v1/me/asset-groups') {
      await fulfill(route, { items: [], ungroupedCount: 0, totalAssetCount: 0 })
      return
    }
    await fulfill(route, {})
  })
}

async function fulfill(route, data) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  })
}
