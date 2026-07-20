import { expect, test } from '@playwright/test'
import { fulfillJson, mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

const authUser = {
  id: 'user_auth_flow_001',
  email: 'auth-flow@example.com',
  displayName: 'Auth Flow',
  role: 'user',
}

async function mockAuthApi(page, state) {
  await mockBootstrapConfig(page)
  await mockAuthConfig(page)

  await page.route('**/api/client/auth/me', async (route) => {
    await fulfillJson(route, {
      user: state.loggedIn ? authUser : null,
      csrfToken: state.loggedIn ? 'csrf-auth-flow' : '',
    })
  })

  await page.route('**/api/client/auth/login', async (route) => {
    state.loggedIn = true
    await fulfillJson(route, {
      user: authUser,
      token: 'token-auth-flow',
      csrfToken: 'csrf-auth-flow',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })
  })

  await page.route('**/api/client/auth/logout', async (route) => {
    state.loggedIn = false
    await fulfillJson(route, { loggedOut: true })
  })

  await page.route('**/api/client/business/**', async (route) => {
    state.businessRequests = (state.businessRequests || 0) + 1
    await fulfillJson(route, { summary: {}, plans: [], current: null, orders: [] })
  })
}

test.describe('User auth flow', () => {
  test('protected profile redirects to login and returns after sign-in', async ({ page }) => {
    const state = { loggedIn: false, businessRequests: 0 }
    await mockAuthApi(page, state)

    await page.goto('/profile')
    await expect(page).toHaveURL(/\/auth\/login\?redirect=(%2F|\/)profile/)

    await page.getByPlaceholder('邮箱').fill(authUser.email)
    await page.getByPlaceholder('密码').fill('Password123!')
    await Promise.all([page.waitForURL('**/profile'), page.locator('.auth-submit').click()])

    await expect(page.getByText(authUser.email).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /退出登录/ })).toBeVisible()
    expect(state.businessRequests).toBe(0)

    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('.profile-logout-btn').click()

    await page.goto('/profile')
    await expect(page).toHaveURL(/\/auth\/login\?redirect=(%2F|\/)profile/)
  })

  test('authenticated users leave login page through safe default redirect', async ({ page }) => {
    const state = { loggedIn: true }
    await mockAuthApi(page, state)

    await page.goto('/auth/login?redirect=https://example.com/steal')
    await expect(page).toHaveURL('/profile')
  })

  test('register page links back to login', async ({ page }) => {
    await mockAuthApi(page, { loggedIn: false })
    await page.goto('/auth/register')
    await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible()
    await page.getByRole('link', { name: '返回登录' }).click()
    await expect(page).toHaveURL('/auth/login')
  })
})
