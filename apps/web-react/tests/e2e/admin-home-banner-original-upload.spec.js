import { createHash } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'

test('banner upload preserves an original file above the former upload limits', async ({ page }) => {
  // A valid PNG with trailing bytes keeps this transport test deterministic.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6L1sAAAAASUVORK5CYII=', 'base64')
  const original = Buffer.concat([png, Buffer.alloc(16 * 1024 * 1024, 91)])
  const hash = value => createHash('sha256').update(value).digest('hex')
  const uploadedURL = '/api/v1/files/announcement-images/original-banner.png'
  let uploadedHash = ''
  let uploadedBytes = 0
  let saved = null
  let announcementUploads = 0
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, { admin: { id: 'admin', username: '管理员', email: 'admin@example.com', role: 'admin' } }))
  await page.route('**/api/v1/admin/announcements/images', route => {
    announcementUploads += 1
    return route.fulfill({ status: 500 })
  })
  await page.route('**/api/v1/admin/home-banners', route => {
    if (route.request().method() === 'POST') {
      saved = { ...route.request().postDataJSON(), id: 'original-banner' }
      return fulfillJson(route, saved)
    }
    return fulfillJson(route, { items: saved ? [saved] : [] })
  })
  await page.route('**/api/v1/admin/home-banners/images', route => {
    const request = route.request()
    const boundary = request.headers()['content-type'].split('boundary=')[1]
    const multipart = request.postDataBuffer()
    const start = multipart.indexOf(Buffer.from('\r\n\r\n')) + 4
    const end = multipart.lastIndexOf(Buffer.from(`\r\n--${boundary}--`))
    const received = multipart.subarray(start, end)
    uploadedHash = hash(received)
    uploadedBytes = received.length
    return fulfillJson(route, { key: 'announcement-images/original-banner.png', url: uploadedURL }, 201)
  })
  await page.route(`**${uploadedURL}`, route => route.fulfill({ contentType: 'image/png', body: png }))

  await page.goto(`${adminURL}/admin/home-banners`)
  await page.getByRole('button', { name: '新增轮播图', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('原图上传，保留原始尺寸、格式和画质。请客服自行处理好图片后上传。')).toBeVisible()
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'original-banner.png', mimeType: 'image/png', buffer: original })
  await expect(dialog.getByRole('textbox', { name: '图片地址', exact: true })).toHaveValue(uploadedURL)
  expect(uploadedBytes).toBe(original.length)
  expect(uploadedHash).toBe(hash(original))
  expect(announcementUploads).toBe(0)
  await dialog.getByLabel('标题', { exact: true }).fill('原图轮播')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => saved?.imageUrl).toBe(uploadedURL)
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('table').getByText('原图轮播', { exact: true })).toBeVisible()
})
