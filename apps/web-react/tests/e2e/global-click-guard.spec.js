import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }),
  )
  await page.route('**/api/v1/runtime-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ routes: {}, features: {}, blacklist: { blocked: false } }),
    }),
  )
  await page.goto('/pricing')
})

async function installFixture(page) {
  await page.evaluate(() => {
    const fixture = document.createElement('section')
    fixture.id = 'click-guard-fixture'
    fixture.innerHTML = `
      <button id="guarded">guarded</button>
      <button id="other">other</button>
      <button id="custom" data-click-guard-ms="40">custom</button>
      <div data-click-guard="off"><button id="repeat">repeat</button></div>
      <button id="toggle" aria-expanded="false">toggle</button>
      <button id="semantic">join</button>
      <div id="role-button" role="button" tabindex="0">role button</div>
    `
    document.body.appendChild(fixture)
    window.__clickGuardCounts = {}
    for (const control of fixture.querySelectorAll('button, [role="button"]')) {
      window.__clickGuardCounts[control.id] = 0
      control.addEventListener('click', () => { window.__clickGuardCounts[control.id] += 1 })
    }
    fixture.querySelector('#toggle').addEventListener('click', (event) => {
      event.currentTarget.setAttribute(
        'aria-expanded',
        event.currentTarget.getAttribute('aria-expanded') === 'true' ? 'false' : 'true',
      )
    })
    fixture.querySelector('#semantic').addEventListener('click', (event) => {
      event.currentTarget.textContent = event.currentTarget.textContent === 'join' ? 'invite' : 'join'
    })
  })
}

test('blocks rapid duplicate clicks per control without locking other buttons', async ({ page }) => {
  await installFixture(page)
  const result = await page.evaluate(() => {
    document.querySelector('#guarded').click()
    document.querySelector('#guarded').click()
    document.querySelector('#other').click()
    document.querySelector('#role-button').click()
    document.querySelector('#role-button').click()
    return window.__clickGuardCounts
  })

  expect(result.guarded).toBe(1)
  expect(result.other).toBe(1)
  expect(result['role-button']).toBe(1)
  await page.waitForTimeout(520)
  await page.locator('#guarded').click()
  await expect.poll(() => page.evaluate(() => window.__clickGuardCounts.guarded)).toBe(2)
})

test('supports explicit repeat controls and per-button delay overrides', async ({ page }) => {
  await installFixture(page)
  const immediate = await page.evaluate(() => {
    document.querySelector('#repeat').click()
    document.querySelector('#repeat').click()
    document.querySelector('#custom').click()
    document.querySelector('#custom').click()
    return { ...window.__clickGuardCounts }
  })

  expect(immediate.repeat).toBe(2)
  expect(immediate.custom).toBe(1)
  await page.waitForTimeout(50)
  await page.locator('#custom').click()
  await expect.poll(() => page.evaluate(() => window.__clickGuardCounts.custom)).toBe(2)
})

test('allows real toggle state changes and resets the guard when an interaction is cancelled', async ({ page }) => {
  await installFixture(page)
  const toggles = await page.evaluate(() => {
    document.querySelector('#toggle').click()
    document.querySelector('#toggle').click()
    return window.__clickGuardCounts.toggle
  })
  expect(toggles).toBe(2)

  const semanticChanges = await page.evaluate(() => {
    document.querySelector('#semantic').click()
    document.querySelector('#semantic').click()
    return window.__clickGuardCounts.semantic
  })
  expect(semanticChanges).toBe(2)

  await page.locator('#guarded').click()
  await page.keyboard.press('Escape')
  await page.locator('#guarded').click()
  await expect.poll(() => page.evaluate(() => window.__clickGuardCounts.guarded)).toBe(2)

  await page.locator('#other').click()
  await page.locator('#guarded').click()
  await expect.poll(() => page.evaluate(() => window.__clickGuardCounts.guarded)).toBe(3)
})
