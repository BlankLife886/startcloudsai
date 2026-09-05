import { expect } from '@playwright/test'

export async function expectPricingPageIsolated(page) {
  await expect(page.locator('.pp')).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/starclouds-hosted|canvas-entry/)
  await expect(page.locator('body')).not.toHaveClass(/canvas-native-active/)

  const shell = page.locator('.pp .pp-hero .pp-shell').first()
  await expect(shell).toBeVisible()
  const styles = await shell.evaluate((el) => {
    const computed = getComputedStyle(el)
    return {
      display: computed.display,
      overflowY: computed.overflowY,
      marginLeft: computed.marginLeft,
    }
  })
  expect(styles.display, 'profile .pp-shell grid must not leak into pricing').not.toBe(
    'grid',
  )
  expect(
    styles.overflowY,
    'profile .pp-shell overflow must not leak into pricing',
  ).not.toBe('hidden')
  expect(
    Number.parseFloat(styles.marginLeft),
    'pricing shell must stay centered, not full-bleed like profile',
  ).toBeGreaterThan(0)

  const pageOverflow = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overflowY,
    body: getComputedStyle(document.body).overflowY,
  }))
  expect(pageOverflow.html, 'canvas html overflow:hidden must not leak').not.toBe(
    'hidden',
  )
  expect(pageOverflow.body, 'canvas body overflow:hidden must not leak').not.toBe(
    'hidden',
  )
}
