import { expect, test } from '@playwright/test'

const campaign = {
  id: '0ce6c089-5701-43a5-a53f-89b314e1853f',
  title: '限量功能体验计划',
  status: 'active',
  enabled: true,
  expired: false,
  full: false,
  capacity: 100,
  displayApplied: 8,
  remaining: 92,
  nextPosition: 9,
  expiresAt: '2026-09-11T02:43:12.107849Z',
  features: [
    {
      key: 'text_to_image',
      label: '文生图',
      icon: 'bi-stars',
      route: '/text-to-image',
    },
  ],
}

function envelope(data) {
  return JSON.stringify({ success: true, data })
}

async function installRoutes(page, { currentCampaign = campaign, user = null } = {}) {
  await page.addInitScript((sessionUser) => {
    if (sessionUser) sessionStorage.setItem('sc_auth_session_cache', JSON.stringify({ user: sessionUser }))
    else sessionStorage.removeItem('sc_auth_session_cache')
  }, user)
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: envelope({}) }),
  )
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ user }) }),
  )
  await page.route('**/api/v1/trial-access-campaign', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({ campaign: currentCampaign }),
    }),
  )
}

test('active admin campaign exposes the user entry and opens its details', async ({ page }) => {
  await installRoutes(page)
  await page.goto('/')

  const entry = page.getByRole('button', { name: '申请体验' })
  await expect(entry).toBeVisible()
  await entry.click()

  const dialog = page.getByRole('dialog', { name: campaign.title })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('剩余 92 名')
  await expect(dialog).toContainText('文生图')
  await expect(dialog).toContainText('请先登录账号')
})

test('closed campaign does not leave a stale entry in the navigation', async ({ page }) => {
  await installRoutes(page, { currentCampaign: null })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '申请体验' })).toHaveCount(0)
})

test('trial query opens the same dialog and is consumed without changing the page', async ({ page }) => {
  await installRoutes(page)
  await page.goto('/pricing?source=inbox&trial=apply')

  await expect(page.getByRole('dialog', { name: campaign.title })).toBeVisible()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/pricing')
  await expect.poll(() => new URL(page.url()).search).toBe('?source=inbox')
})

test('authenticated user can submit an application from the restored entry', async ({ page }) => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    username: '体验测试用户',
  }
  let submittedBody = null
  await installRoutes(page, { user })
  await page.route('**/api/v1/me/trial-access-application', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ application: null }) }),
  )
  await page.route('**/api/v1/me/trial-access-applications', async (route) => {
    submittedBody = route.request().postDataJSON()
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: envelope({
        application: {
          id: '22222222-2222-4222-8222-222222222222',
          status: 'pending',
          occupation: submittedBody.occupation,
          reason: submittedBody.reason,
          features: campaign.features,
        },
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '申请体验' }).click()
  await page.getByRole('button', { name: 'UI 设计师' }).click()
  await page.getByPlaceholder('请说明你想创作什么，以及准备如何使用平台…').fill('希望测试真实文生图工作流并完成商业设计素材。')
  await page.getByRole('button', { name: /提交申请/ }).click()

  await expect(page.getByRole('heading', { name: '申请审核中' })).toBeVisible()
  expect(submittedBody).toEqual({
    occupation: 'UI 设计师',
    reason: '希望测试真实文生图工作流并完成商业设计素材。',
  })
})
