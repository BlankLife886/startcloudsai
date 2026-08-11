import { expect, test } from '@playwright/test'

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  username: '小云',
  avatarUrl: '/api/v1/files/uploads/xiaoyun.png',
}

const rules = {
  groupEnabled: true,
  groupCampaignKey: 'launch-2026',
  groupTargetMembers: 3,
  groupRewardCents: 30,
  groupDurationHours: 48,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((currentUser) => {
    sessionStorage.setItem('sc_auth_session_cache', JSON.stringify({ user: currentUser }))
    localStorage.setItem('starclouds-locale', 'zh-CN')
  }, user)
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user } }),
    }),
  )
})

test('offers separate create and invite-code join paths', async ({ page }) => {
  await page.route('**/api/v1/me/growth', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { rules, group: null, programs: [] } }),
    }),
  )

  await page.goto('/incentive-plans/group?code=AB12CD34EF')

  await expect(page.getByRole('button', { name: '发起拼团' })).toBeVisible()
  await expect(page.getByLabel('好友邀请码')).toHaveValue('AB12CD34EF')
  await expect(page.getByRole('button', { name: '加入' })).toBeEnabled()
  await expect(page.getByText('一期一团')).toBeVisible()
})

test('shows the invite code, real members and mobile actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/v1/me/growth', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          rules,
          programs: [],
          group: {
            id: '22222222-2222-4222-8222-222222222222',
            code: 'ZX98YU76TR',
            ownerId: user.id,
            status: 'active',
            targetMembers: 3,
            memberCount: 2,
            rewardCents: 30,
            expiresAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            members: [
              { userId: user.id, username: '小云', avatarUrl: user.avatarUrl, role: 'owner' },
              {
                userId: '33333333-3333-4333-8333-333333333333',
                username: '设计师阿林',
                avatarUrl: null,
                role: 'member',
              },
            ],
          },
        },
      }),
    }),
  )
  await page.route('**/api/v1/files/uploads/xiaoyun.png', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#f26022"/></svg>',
    }),
  )

  await page.goto('/incentive-plans/group')

  await expect(page.getByText('ZX98YU76TR')).toBeVisible()
  await expect(page.getByText('小云', { exact: true })).toBeVisible()
  await expect(page.getByText('设计师阿林', { exact: true })).toBeVisible()
  await expect(page.locator('.member-avatar img')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '复制码' })).toBeVisible()
  await expect(page.getByRole('button', { name: '邀请好友' })).toBeVisible()
})
