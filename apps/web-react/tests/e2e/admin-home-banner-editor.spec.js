import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an isolated admin dev server')
test.use({ timezoneId: 'Asia/Shanghai' })

const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'
const uploadPath = '/api/v1/admin/home-banners/images'
const imageURL = '/banner-editor-fixture/original.svg'
const newImageURL = '/banner-editor-fixture/new.svg'
const staleImageURL = '/banner-editor-fixture/stale.svg'
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="600" viewBox="0 0 1920 600"><rect width="1920" height="600" fill="#285044"/><rect width="160" height="600" fill="#f2be74"/><rect x="1760" width="160" height="600" fill="#d66b5c"/><circle cx="960" cy="300" r="180" fill="#a4cdb9"/></svg>'
const uploadFile = { name: 'original-banner.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4i8AAAAASUVORK5CYII=', 'base64') }
const banner = {
  id: 'banner-editor-one', title: '为每一个创作灵感准备的首页精选', subtitle: '从灵感到作品，在清晰的画面中展示创作故事。',
  imageUrl: imageURL, linkUrl: '/studio?source=home-banner&campaign=creative-editor-preview', buttonText: '探索创作',
  active: true, newTab: false, sortOrder: 2, durationMs: 7000,
  startsAt: '2026-09-09T02:15:00Z', endsAt: '2026-09-10T15:00:00Z',
}

async function mockEditor(page, { theme = 'light', initial = [banner], onUpload, beforeSave } = {}) {
  const writes = []
  const imageRequests = []
  let items = structuredClone(initial)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.addInitScript(value => localStorage.setItem('admin-theme', value), theme)
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, {
    admin: { id: 'admin', username: '管理员', email: 'admin@example.com', role: 'admin' },
  }))
  await page.route('**/banner-editor-fixture/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: image }))
  await page.route('**/api/v1/admin/home-banners**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === uploadPath) return onUpload ? onUpload(route) : fulfillJson(route, { url: newImageURL })
    if (request.method() === 'POST' || request.method() === 'PUT') {
      const payload = request.postDataJSON()
      writes.push(payload)
      await beforeSave?.(payload)
      const saved = { ...payload, id: path.endsWith('/home-banners') ? 'banner-editor-created' : path.split('/').at(-1) }
      items = [saved, ...items.filter(item => item.id !== saved.id)]
      return fulfillJson(route, saved)
    }
    return fulfillJson(route, { items })
  })
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path.startsWith('/api/v1/admin/') && /images|upload/.test(path)) imageRequests.push(path)
  })
  await page.goto(`${adminURL}/admin/home-banners`)
  return { writes, imageRequests, items: () => items }
}

async function openExisting(page) {
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.admin-dialog__copy > strong')).toHaveText('编辑轮播图')
  return dialog
}

for (const width of [1280, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`banner editor keeps a horizontal preview and reachable actions at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 })
      await mockEditor(page, { theme })
      const dialog = await openExisting(page)
      const form = dialog.locator('.banner-editor__form')
      const preview = dialog.locator('.banner-editor__preview')
      const original = preview.locator(':scope > img')
      await expect.poll(() => original.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
      expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(theme === 'dark')
      const bounds = await preview.boundingBox()
      expect(bounds.width / bounds.height).toBeCloseTo(16 / 5, 1)
      const dialogBounds = await dialog.boundingBox()
      expect(dialogBounds.x).toBeGreaterThanOrEqual(0)
      expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(width)
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await form.evaluate(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))).toBe(true)
      await form.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect(dialog.getByLabel('开始时间', { exact: true })).toBeInViewport()
      await expect(dialog.getByLabel('结束时间', { exact: true })).toBeInViewport()
      await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeInViewport()
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport()
      for (const label of ['排序', '播放时长（秒）', '开始时间', '结束时间']) {
        const field = dialog.getByLabel(label, { exact: true })
        const fieldBounds = await field.boundingBox()
        const formBounds = await form.boundingBox()
        expect(fieldBounds.x).toBeGreaterThanOrEqual(formBounds.x)
        expect(fieldBounds.x + fieldBounds.width).toBeLessThanOrEqual(formBounds.x + formBounds.width)
      }
      await dialog.getByRole('button', { name: '完整原图', exact: true }).click()
      await expect(original).toHaveCSS('object-fit', 'contain')
      await dialog.getByRole('button', { name: '首页效果', exact: true }).click()
      await expect(original).toHaveCSS('object-fit', 'cover')
      await page.screenshot({ path: testInfo.outputPath(`banner-editor-${width}-${theme}.png`) })
    })
  }
}

for (const failure of [
  { status: 405, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) },
  { status: 502, contentType: 'text/html', body: '<!doctype html><html><body>502 Bad Gateway</body></html>' },
]) {
  test(`banner upload shows a Chinese inline error for HTTP ${failure.status} without falling back`, async ({ page }) => {
    const state = await mockEditor(page, { onUpload: route => route.fulfill(failure) })
    const dialog = await openExisting(page)
    await dialog.locator('input[type="file"]').setInputFiles(uploadFile)
    const alert = dialog.locator('.banner-upload-error')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/上传|接口|服务/)
    await expect(alert).not.toContainText(/Unexpected token|<html|Method Not Allowed|Bad Gateway/)
    await expect(dialog.getByRole('textbox', { name: '图片地址', exact: true })).toHaveValue(imageURL)
    await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    expect(state.imageRequests).toEqual([uploadPath])
  })
}

test('canceling an upload aborts it and isolates its late response from the next editor', async ({ page }) => {
  await page.addInitScript(path => {
    const originalFetch = window.fetch
    window.__bannerUploadSignals = []
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, location.href).pathname === path) {
        window.__bannerUploadSignals.push(init?.signal)
        // Let the transport reply after cancellation to exercise the editor's session guard.
        return originalFetch(input, { ...init, signal: undefined })
      }
      return originalFetch(input, init)
    }
  }, uploadPath)
  const uploads = []
  await mockEditor(page, { onUpload: route => new Promise(resolve => {
    uploads.push({ release: async url => { await fulfillJson(route, { url }); resolve() } })
  }) })
  let dialog = await openExisting(page)
  await dialog.locator('input[type="file"]').setInputFiles(uploadFile)
  await expect.poll(() => uploads.length).toBe(1)
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__bannerUploadSignals[0]?.aborted)).toBe(true)
  await page.getByRole('button', { name: '新增轮播图', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.locator('.admin-dialog__copy > strong')).toHaveText('新增轮播图')
  await dialog.getByRole('textbox', { name: '图片地址', exact: true }).fill(newImageURL)
  await dialog.locator('input[type="file"]').setInputFiles(uploadFile)
  await expect.poll(() => uploads.length).toBe(2)
  const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === uploadPath)
  await uploads[0].release(staleImageURL)
  await (await staleResponse).finished()
  await expect(dialog.getByRole('textbox', { name: '图片地址', exact: true })).toHaveValue(newImageURL)
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await uploads[1].release(newImageURL)
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('textbox', { name: '图片地址', exact: true })).toHaveValue(newImageURL)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('seconds save as milliseconds while optional content and schedule stay intact and saving cannot be canceled', async ({ page }) => {
  let releaseSave
  const gate = new Promise(resolve => { releaseSave = resolve })
  const state = await mockEditor(page, { beforeSave: () => gate })
  const dialog = await openExisting(page)
  await dialog.getByLabel('标题', { exact: true }).clear()
  await dialog.getByLabel('副标题', { exact: true }).clear()
  await dialog.getByLabel('跳转地址', { exact: true }).clear()
  await dialog.getByLabel('按钮文字', { exact: true }).fill('保留的可选文案')
  await dialog.getByLabel('播放时长（秒）', { exact: true }).fill('9')
  await expect(dialog.locator('.banner-editor__copy')).toHaveCount(0)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(state.writes[0]).toMatchObject({ title: '', subtitle: '', linkUrl: '', buttonText: '保留的可选文案', durationMs: 9000, imageUrl: imageURL })
  expect(Date.parse(state.writes[0].startsAt)).toBe(Date.parse(banner.startsAt))
  expect(Date.parse(state.writes[0].endsAt)).toBe(Date.parse(banner.endsAt))
  releaseSave()
  await expect(dialog).not.toBeVisible()
})
