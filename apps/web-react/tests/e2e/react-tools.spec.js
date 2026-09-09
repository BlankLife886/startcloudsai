import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const fixtureImage = resolve(process.cwd(), 'tests/fixtures/starcloud-logo.png')

test.describe('React local image tools', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    process.env.REACT_MIGRATION !== '1',
    'Only runs against the isolated React migration app',
  )

  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
  })

  test('puzzle uploads locally and assigns the first image to the board', async ({ page }) => {
    await page.goto('/tools/puzzle', { waitUntil: 'domcontentloaded' })

    await page.locator('input[type="file"]').setInputFiles(fixtureImage)

    await expect(page.locator('.collage-cell img')).toHaveCount(1)
    await expect(page.locator('.collage-top-status')).toContainText('1/2 格')
    await expect(page.locator('.collage-top-btn.primary').first()).toBeEnabled()
  })

  test('puzzle stays within one viewport and scrolls long panels internally', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tools/puzzle', { waitUntil: 'domcontentloaded' })

    await expect
      .poll(() =>
        page.evaluate(() => ({
          viewport: window.innerHeight,
          document: document.documentElement.scrollHeight,
          panelClient: document.querySelector('.collage-side-body')?.clientHeight || 0,
          panelScroll: document.querySelector('.collage-side-body')?.scrollHeight || 0,
        })),
      )
      .toMatchObject({ viewport: 900, document: 900 })
    const desktopPanel = await page.locator('.collage-side-body').evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }))
    expect(desktopPanel.scroll).toBeGreaterThan(desktopPanel.client)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(() => ({
          viewport: window.innerHeight,
          document: document.documentElement.scrollHeight,
          workspace: document.querySelector('.collage-workspace')?.clientHeight || 0,
        })),
      )
      .toEqual({ viewport: 844, document: 844, workspace: 682 })
    await expect(page.locator('.collage-stage-wrap')).toBeVisible()
  })

  test('image compression uses the local worker and exposes a downloadable result', async ({
    page,
  }) => {
    await page.goto('/tools/image-compress', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles(fixtureImage)

    await page.getByRole('button', { name: '无损', exact: true }).click()
    await page.getByRole('button', { name: '开始压缩' }).click()

    await expect(page.locator('.ic-row')).toHaveClass(/is-done/, { timeout: 20_000 })
    await expect(page.locator('.ic-frame img[alt="压缩后结果"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '下载图片' })).toBeEnabled()
  })

  test('route navigation is immediate during image processing and releases local resources', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__reactToolCleanup = { revoked: [], terminated: 0 }
      const revoke = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = (url) => {
        window.__reactToolCleanup.revoked.push(url)
        return revoke(url)
      }
      const terminate = Worker.prototype.terminate
      Worker.prototype.terminate = function patchedTerminate(...args) {
        window.__reactToolCleanup.terminated += 1
        return terminate.apply(this, args)
      }
    })
    await page.goto('/tools/image-compress', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles(fixtureImage)
    const sourceUrl = await page.locator('.ic-row__thumb img').getAttribute('src')
    await page.getByRole('button', { name: '开始压缩' }).click()
    await expect(page.locator('.ic-row')).toHaveClass(/is-busy/)

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()

    await expect
      .poll(() =>
        page.evaluate(
          (url) => ({
            revoked: window.__reactToolCleanup.revoked.includes(url),
            terminated: window.__reactToolCleanup.terminated,
          }),
          sourceUrl,
        ),
      )
      .toMatchObject({ revoked: true })
  })
})
