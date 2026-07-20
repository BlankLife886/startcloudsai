import { expect, test } from '@playwright/test'
import { mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787/api'
const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3103'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

test.describe('Walleven smoke', () => {
  test('public API is alive', async ({ request }) => {
    const health = await request.get(`${API_BASE_URL}/health`)
    await expect(health).toBeOK()
    const healthJson = await health.json()
    expect(healthJson.success).toBe(true)
    expect(healthJson.data?.storage?.d1).toBe(true)

    const config = await request.get(`${API_BASE_URL}/public/config`)
    await expect(config).toBeOK()
    const configJson = await config.json()
    expect(configJson.success).toBe(true)
    expect(configJson.data?.config?.siteHome).toBeTruthy()
  })

  test('web core pages render', async ({ page }) => {
    await mockBootstrapConfig(page)
    await mockAuthConfig(page)

    await page.goto('/')
    await expect(page).toHaveTitle(/WALLHAVENDL|首页/)
    await expect(page.locator('#app')).toBeVisible()
    await expect(page.getByText(/WALLHAVENDL/i).first()).toBeVisible()

    await page.goto('/auth/login')
    await expect(page).toHaveTitle(/账号登录|WALLHAVENDL/)
    await expect(page.locator('.auth-submit')).toBeVisible()

    await page.route('**/api/client/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: 'smoke-user',
              email: 'smoke@example.com',
              displayName: 'Smoke',
              role: 'user',
            },
            csrfToken: 'smoke-csrf',
          },
        }),
      })
    })

    await page.goto('/settings')
    await expect(page).toHaveTitle(/设置中心|WALLHAVENDL/)
    await expect(page.getByRole('button', { name: /基础与账号/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /首页内容/ })).toHaveCount(0)
    await expect(page.getByText('NSFW')).toBeVisible()
  })

  test('user action tracking stays silent when disabled by runtime config', async ({ page }) => {
    let trackingRequests = 0
    await mockAuthConfig(page)
    await page.route('**/api/client/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id: 'smoke-user',
              email: 'smoke@example.com',
              displayName: 'Smoke',
              role: 'user',
            },
            csrfToken: 'smoke-csrf',
          },
        }),
      })
    })
    await page.route('**/api/client/bootstrap/config**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            config: {
              version: 'e2e-user-action-log-disabled',
              endpoints: { apiBaseUrl: '/api', openAiBaseUrl: '/api/openai' },
              routes: {
                '/': { enabled: true },
                '/settings': { enabled: true },
                '/access-limited': { enabled: true },
              },
              features: {
                download: { enabled: true },
                favorite: { enabled: true },
                history: { enabled: true },
                sync: { enabled: true },
                filters: { enabled: true },
                userActionLog: { enabled: false },
                'ai.optimize': { enabled: false },
                'ai.imageToModel': { enabled: false },
              },
              pageLayout: {
                settings: {
                  general: { enabled: true },
                  browsing: { enabled: true },
                  visuals: { enabled: true },
                  download: { enabled: true },
                  ai: { enabled: false },
                  data: { enabled: true },
                  performance: { enabled: true },
                },
              },
              limits: { dailyAiJobs: 20, maxUploadMb: 10, providerPayloadMaxMb: 4 },
              aiModelCatalog: {
                providers: [],
                models: [],
                publicModels: [],
                featurePublicModels: [],
                updatedAt: '',
              },
              userOverrides: {},
              blacklist: { blocked: false, reason: '', scope: {}, endsAt: '' },
            },
          },
        }),
      })
    })
    await page.route('**/api/client/tracking/user-actions', async (route) => {
      trackingRequests += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { recorded: false } }),
      })
    })

    await page.goto('/settings')
    await expect(page.getByRole('button', { name: /基础与账号/ })).toBeVisible()
    await page.getByRole('button', { name: /视觉与预览/ }).click()
    await page.waitForTimeout(4500)

    expect(trackingRequests).toBe(0)
  })

  test('admin login and admin secret status work through browser', async ({ page, request }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      'Set ADMIN_EMAIL and ADMIN_PASSWORD to run admin login smoke test',
    )

    const login = await request.post(`${API_BASE_URL}/admin/login`, {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
    })
    await expect(login).toBeOK()
    const loginJson = await login.json()
    expect(loginJson.success).toBe(true)
    const csrfToken = loginJson.data?.csrfToken
    expect(csrfToken).toBeTruthy()

    const secretList = await request.get(`${API_BASE_URL}/admin/secrets`)
    await expect(secretList).toBeOK()
    const secretJson = await secretList.json()
    expect(secretJson.success).toBe(true)
    expect(Array.isArray(secretJson.data?.secrets)).toBe(true)

    await page.goto('/settings')
    await expect(page.getByRole('button', { name: /基础与账号/ })).toBeVisible()
    await expect(page.getByText(/保存到后端|后端已保存|未保存到后端/).first()).toBeVisible()
  })

  test('admin app shell responds', async ({ page }) => {
    await page.goto(ADMIN_BASE_URL)
    await expect(page.locator('#app')).toBeVisible()
    await expect(page).toHaveTitle(/vue-pure-admin|Walleven|后台/i)
  })
})
