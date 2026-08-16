import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const account = {
  id: 'account-react-test',
  email: 'creator@example.com',
  username: '星云创作者',
}

const accountProfile = {
  ...account,
  bio: '专注品牌视觉、产品摄影与生成式设计工作流。',
  location: '上海 / Remote',
  websiteUrl: 'https://creator.example.com',
  requireCostConfirm: true,
  createdAt: '2026-01-18T09:30:00Z',
}

const checkinState = {
  enabled: true,
  today: '2026-08-11',
  todayChecked: false,
  todayRecord: null,
  currentStreak: 3,
  claimCycleDay: 4,
  claimRewardCents: 25,
  nextCycleDay: 4,
  nextRewardCents: 25,
  rewards: [10, 15, 20, 25, 30, 40, 80].map((rewardCents, index) => ({
    day: index + 1,
    rewardCents,
    milestone: index === 6,
  })),
  month: '2026-08',
  monthRecords: [
    { date: '2026-08-08', cycleDay: 1, rewardCents: 10 },
    { date: '2026-08-09', cycleDay: 2, rewardCents: 15 },
    { date: '2026-08-10', cycleDay: 3, rewardCents: 20 },
  ],
  monthRewardCents: 45,
}

const historyTask = (id, overrides = {}) => ({
  id,
  type: 't2i',
  status: 'succeeded',
  prompt: `历史作品 ${id}`,
  outputUrls: ['/sucai/home-intro-03.png'],
  originalUrls: ['/sucai/home-intro-03.png'],
  costCents: 12,
  createdAt: '2026-08-11T08:30:00Z',
  ...overrides,
})

const walletSnapshot = {
  balanceCents: 1260,
  availableCents: 1260,
  frozenCents: 80,
  totalCents: 1340,
  normalBalanceCents: 1060,
  trialBalanceCents: 200,
  normalFrozenCents: 60,
  trialFrozenCents: 20,
}

const walletEntry = (id, overrides = {}) => ({
  id,
  kind: 'grant',
  sourceType: 'daily_checkin',
  deltaCents: 25,
  balanceAfterCents: 1260,
  reason: '连续签到奖励',
  createdAt: '2026-08-11T08:20:00Z',
  ...overrides,
})

const notificationItem = (id, overrides = {}) => ({
  id,
  kind: 'wallet_redeem',
  title: '兑换积分已到账',
  body: '兑换成功，260 积分已加入账户余额。',
  createdAt: '2026-08-11T08:15:00Z',
  readAt: null,
  ...overrides,
})

const materialAsset = (id, overrides = {}) => ({
  id,
  title: `品牌素材 ${id}`,
  url: '/sucai/home-intro-03.png',
  thumbnailUrl: '/sucai/home-intro-03.png',
  fileKey: `materials/${id}.png`,
  thumbnailKey: `materials/${id}-thumb.png`,
  contentType: 'image/png',
  sizeBytes: 245760,
  groupId: null,
  createdAt: '2026-08-11T08:15:00Z',
  ...overrides,
})

const gallerySubmission = (id, overrides = {}) => ({
  id,
  taskId: `task-${id}`,
  title: `投稿作品 ${id}`,
  status: 'pending',
  coverUrl: '/sucai/home-intro-03.png',
  mediaUrls: ['/sucai/home-intro-03.png'],
  rejectReason: null,
  createdAt: '2026-08-11T08:15:00Z',
  ...overrides,
})

const profileOverview = {
  wallet: walletSnapshot,
  taskStats: { total: 18, succeeded: 12, failed: 3, running: 3 },
  taskStatsByType: { t2i: 8, ecommerce_design: 4, coloring: 3, game_art: 3 },
  assetCount: 6,
  submissionStats: { total: 7, pending: 2, approved: 4, rejected: 1, removed: 0 },
  unreadNotifications: 3,
  recentTasks: [],
}

test.describe('React authenticated account pages', () => {
  test.skip(
    process.env.REACT_MIGRATION !== '1',
    'Only runs against the isolated React migration app',
  )

  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
  })

  test('account pages remain accessible to anonymous users and prompt only on action', async ({
    page,
  }) => {
    await page.goto('/feedback?category=billing', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/feedback\?category=billing$/)
    await expect(page.locator('.feedback-page')).toBeVisible()
    await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '提交反馈' }).click()
    await expect(page.locator('.auth-required-dialog')).toBeVisible()
    await expect(page.locator('.auth-required-dialog')).toContainText('问题反馈')
    await expect(page).toHaveURL(/\/feedback\?category=billing$/)
  })

  test('feedback loads and submits through the existing API contract', async ({ page }) => {
    let submittedBody = null
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, { balanceCents: 90 }))
    await page.route('**/api/v1/me/feedback**', async (route) => {
      if (route.request().method() === 'POST') {
        submittedBody = route.request().postDataJSON()
        await fulfillJson(route, {
          id: 'feedback-new',
          ...submittedBody,
          status: 'open',
          adopted: false,
          createdAt: '2026-08-11T08:30:00Z',
        })
        return
      }
      await fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.goto('/feedback', { waitUntil: 'domcontentloaded' })

    await page.getByPlaceholder('用一句话概括你遇到的问题').fill('批量生成任务显示异常')
    await page
      .getByPlaceholder('请说明操作步骤、预期结果和实际结果。如有错误提示，也请一并填写。')
      .fill('进入任务页面后，已经成功的任务没有显示生成图片。')
    await page.getByRole('button', { name: '提交反馈' }).click()

    await expect(page.locator('.feedback-item')).toHaveCount(1)
    await expect(page.locator('.feedback-item')).toContainText('批量生成任务显示异常')
    expect(submittedBody).toEqual({
      category: 'bug',
      title: '批量生成任务显示异常',
      content: '进入任务页面后，已经成功的任务没有显示生成图片。',
    })
  })

  test('daily check-in claims once and updates the dashboard state', async ({ page }) => {
    let claimCount = 0
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/checkin', async (route) => {
      if (route.request().method() === 'POST') {
        claimCount += 1
        await fulfillJson(route, {
          ...checkinState,
          todayChecked: true,
          todayRecord: { date: '2026-08-11', cycleDay: 4, rewardCents: 25 },
          currentStreak: 4,
          nextCycleDay: 5,
          nextRewardCents: 30,
          monthRecords: [
            ...checkinState.monthRecords,
            { date: '2026-08-11', cycleDay: 4, rewardCents: 25 },
          ],
          monthRewardCents: 70,
          claimedRewardCents: 25,
          balanceCents: 345,
        })
        return
      }
      await fulfillJson(route, checkinState)
    })
    await page.goto('/check-in', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /立即签到/ }).click()

    await expect(page.getByRole('button', { name: /今日已签到/ })).toBeDisabled()
    await expect(page.locator('.ck-stats')).toContainText('4天')
    await expect(page.locator('.ck-calendar')).toContainText('已签到 4 天')
    expect(claimCount).toBe(1)
  })

  test('a pending check-in request does not block client-side navigation', async ({ page }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/checkin', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, checkinState).catch(() => null)
    })
    await page.goto('/check-in', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('history paginates, marks user-deleted output, and deletes a task', async ({ page }) => {
    const deletedIds = []
    let cursorRequests = 0
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/tasks**', async (route) => {
      const url = new URL(route.request().url())
      const taskId = url.pathname.match(/\/tasks\/([^/]+)$/)?.[1]
      if (route.request().method() === 'DELETE' && taskId) {
        deletedIds.push(taskId)
        await fulfillJson(route, {})
        return
      }
      if (url.searchParams.get('cursor')) {
        cursorRequests += 1
        await fulfillJson(route, {
          items: [historyTask('history-page-2', { type: 'coloring' })],
          nextCursor: null,
        })
        return
      }
      await fulfillJson(route, {
        items: [
          historyTask('history-delete'),
          historyTask('history-user-deleted', {
            outputUrls: [],
            originalUrls: [],
            thumbnailKeys: [],
            deletionActor: 'user',
            deletedAt: '2026-08-11T09:00:00Z',
            deletedOutputCount: 1,
          }),
        ],
        nextCursor: 'history-next-page',
      })
    })
    await page.goto('/history', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.ch-card__placeholder.is-user-deleted')).toContainText(
      '产物已被用户删除',
    )
    await expect(page.locator('.ch-history-masonry__item')).toHaveCount(3)
    await expect(page.locator('.ch-page--history')).toHaveAttribute(
      'data-history-content-motion-state',
      'entered',
    )
    await page.getByRole('button', { name: '表格布局' }).click()
    await expect(page.locator('.ch-history-table tbody tr')).toHaveCount(3)
    await expect(page.locator('.ch-page--history')).toHaveAttribute(
      'data-history-content-motion-state',
      'entered',
    )
    const tableLayout = await page.locator('.ch-history-table-wrap').evaluate((wrapper) => {
      const preview = wrapper.querySelector('.ch-table-preview .authenticated-image')
      const actions = wrapper.querySelector('.ch-table-actions')
      return {
        wrapperWidth: wrapper.getBoundingClientRect().width,
        tableWidth: wrapper.querySelector('table').getBoundingClientRect().width,
        previewPosition: preview ? getComputedStyle(preview).position : '',
        previewWidth: preview?.getBoundingClientRect().width || 0,
        actionsRight: actions?.getBoundingClientRect().right || 0,
        wrapperRight: wrapper.getBoundingClientRect().right,
      }
    })
    expect(tableLayout.tableWidth).toBeLessThanOrEqual(tableLayout.wrapperWidth + 1)
    expect(tableLayout.previewPosition).toBe('relative')
    expect(tableLayout.previewWidth).toBeGreaterThanOrEqual(50)
    expect(tableLayout.actionsRight).toBeLessThanOrEqual(tableLayout.wrapperRight + 1)
    await page.getByRole('button', { name: '4 列布局' }).click()
    await expect(page.locator('.ch-history-masonry__item')).toHaveCount(3)
    await expect(page.locator('.ch-page--history')).toHaveAttribute(
      'data-history-content-motion-state',
      'entered',
    )
    expect(cursorRequests).toBe(1)

    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    const previewTrigger = page
      .locator('.ch-history-masonry__item')
      .filter({ hasText: 'history-delete' })
      .locator('.ch-card__media')
    await previewTrigger.click()
    const previewLayer = page.locator('.ch-preview-layer')
    await expect(page.getByRole('dialog', { name: '历史记录图片预览' })).toBeVisible()
    await expect(previewLayer).toHaveAttribute('data-dialog-motion-state', 'entered')
    await previewLayer.evaluate((node) => {
      window.__historyPreviewMotionStates = [node.dataset.dialogMotionState]
      new MutationObserver(() => {
        window.__historyPreviewMotionStates.push(node.dataset.dialogMotionState)
      }).observe(node, { attributes: true, attributeFilter: ['data-dialog-motion-state'] })
    })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(previewLayer).toHaveCount(0)
    expect(await page.evaluate(() => window.__historyPreviewMotionStates)).toContain('exiting')

    await page.getByRole('button', { name: '清空全部' }).click()
    const clearDialog = page.getByRole('alertdialog')
    await expect(clearDialog).toContainText('删除全部历史记录？')
    await expect(page.locator('.delete-confirm__backdrop')).toHaveAttribute(
      'data-dialog-motion-state',
      'entered',
    )
    await page.locator('.delete-confirm__backdrop').evaluate((node) => {
      window.__historyClearMotionStates = [node.dataset.dialogMotionState]
      new MutationObserver(() => {
        window.__historyClearMotionStates.push(node.dataset.dialogMotionState)
      }).observe(node, { attributes: true, attributeFilter: ['data-dialog-motion-state'] })
    })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(clearDialog).toHaveCount(0)
    expect(await page.evaluate(() => window.__historyClearMotionStates)).toContain('exiting')

    await page
      .locator('.ch-history-masonry__item')
      .filter({ hasText: 'history-delete' })
      .getByTitle('删除')
      .click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(
      page.locator('.ch-history-masonry__item').filter({ hasText: 'history-delete' }),
    ).toHaveCount(0)
    expect(deletedIds).toEqual(['history-delete'])
  })

  test('history table becomes a stable mobile list without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: account }),
    )
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, {
        items: [
          historyTask('history-mobile', {
            prompt:
              '一段用于验证小屏列表布局不会挤压操作按钮和作品缩略图的较长历史提示词',
          }),
        ],
        nextCursor: null,
      }),
    )
    await page.goto('/history', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '表格布局' }).click()

    const row = page.locator('.ch-history-table tbody tr').first()
    await expect(row).toBeVisible()
    const layout = await row.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const actions = node.querySelector('.ch-table-actions')?.getBoundingClientRect()
      const prompt = node.querySelector('.is-prompt')?.getBoundingClientRect()
      return {
        rowLeft: rect.left,
        rowRight: rect.right,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        actionsLeft: actions?.left || 0,
        actionsRight: actions?.right || 0,
        promptRight: prompt?.right || 0,
      }
    })
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.rowLeft).toBeGreaterThanOrEqual(0)
    expect(layout.rowRight).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.promptRight).toBeLessThanOrEqual(layout.actionsLeft)
    expect(layout.actionsRight).toBeLessThanOrEqual(layout.rowRight)
  })

  test('a pending history request does not block client-side navigation', async ({ page }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/tasks**', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, { items: [], nextCursor: null }).catch(() => null)
    })
    await page.goto('/history', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('wallet filters entries and follows cursor pagination in both directions', async ({
    page,
  }) => {
    const ledgerCursors = []
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet**', (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.endsWith('/entries')) return fulfillJson(route, walletSnapshot)
      const cursor = url.searchParams.get('cursor') || ''
      ledgerCursors.push(cursor)
      if (cursor === 'wallet-page-2') {
        return fulfillJson(route, {
          items: [walletEntry('ledger-refund', { kind: 'task_release', deltaCents: 18 })],
          nextCursor: null,
        })
      }
      return fulfillJson(route, {
        items: [
          walletEntry('ledger-income'),
          walletEntry('ledger-spend', { kind: 'admin_adjust', deltaCents: -12 }),
        ],
        nextCursor: 'wallet-page-2',
      })
    })
    await page.route('**/api/v1/me/trial-access-application', (route) =>
      fulfillJson(route, { application: null }),
    )
    await page.goto('/wallet', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.wallet-ledger__list > li')).toHaveCount(2)
    await page.getByRole('tab', { name: /消费/ }).click()
    await expect(page.locator('.wallet-ledger__list > li')).toHaveCount(1)
    await page.getByRole('tab', { name: /全部/ }).click()
    await page.getByRole('button', { name: '下一页' }).click()
    await expect(page.locator('.wallet-pager__meta')).toContainText('第 2 页')
    await page.getByRole('button', { name: '上一页' }).click()
    await expect(page.locator('.wallet-pager__meta')).toContainText('第 1 页')
    expect(ledgerCursors.filter(Boolean)).toEqual(['wallet-page-2'])
    expect(ledgerCursors.at(-1)).toBe('')
  })

  test('wallet redeems an uppercase code and synchronizes the header balance', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    let currentWallet = { ...walletSnapshot }
    let redemptionBody = null
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/redemptions')) {
        redemptionBody = route.request().postDataJSON()
        currentWallet = { ...currentWallet, balanceCents: 1520, availableCents: 1520 }
        await new Promise((resolve) => setTimeout(resolve, 150))
        await fulfillJson(route, { ...currentWallet, grantCents: 260 })
        return
      }
      if (url.pathname.endsWith('/entries')) {
        await fulfillJson(route, { items: [], nextCursor: null })
        return
      }
      await fulfillJson(route, currentWallet)
    })
    await page.route('**/api/v1/me/trial-access-application', (route) =>
      fulfillJson(route, { application: null }),
    )
    await page.goto('/wallet', { waitUntil: 'domcontentloaded' })

    await page.locator('.wallet-aside__cta').getByRole('button', { name: '兑换' }).click()
    await expect(page.locator('.redeem-dialog-layer')).toHaveAttribute(
      'data-dialog-motion-state',
      'entered',
    )
    await expect(page.getByRole('textbox', { name: '兑换码' })).toBeFocused()
    await page.getByRole('textbox', { name: '兑换码' }).fill('sc-abcd-1234-efgh')
    await page.getByRole('button', { name: '立即兑换' }).click()

    await expect(page.getByRole('button', { name: '兑换中…' })).toBeDisabled()
    await expect(page.locator('.redeem-dialog-layer')).toHaveAttribute(
      'data-dialog-motion-state',
      'exiting',
    )
    await expect(page.locator('.redeem-dialog')).toHaveCount(0)
    await expect(page.locator('.wallet-aside__amount strong')).toHaveText('1,520')
    await expect(page.locator('.account-cluster__value')).toHaveText('1,520')
    expect(redemptionBody).toEqual({ code: 'SC-ABCD-1234-EFGH' })
  })

  test('wallet claims an approved trial reward once', async ({ page }) => {
    let currentWallet = {
      ...walletSnapshot,
      balanceCents: 1060,
      availableCents: 1060,
      trialBalanceCents: 0,
    }
    let rewardClaimed = false
    let claimCount = 0
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet**', (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.endsWith('/entries')) return fulfillJson(route, { items: [], nextCursor: null })
      return fulfillJson(route, currentWallet)
    })
    await page.route('**/api/v1/me/trial-access-application**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.endsWith('/reward')) {
        claimCount += 1
        rewardClaimed = true
        currentWallet = {
          ...currentWallet,
          balanceCents: 1260,
          availableCents: 1260,
          trialBalanceCents: 200,
        }
        await fulfillJson(route, { ...currentWallet, grantCents: 200 })
        return
      }
      await fulfillJson(route, {
        application: {
          status: 'approved',
          rewardStatus: rewardClaimed ? 'redeemed' : 'active',
          rewardCents: 200,
          feature: { key: 'text_to_image', label: '文生图' },
        },
      })
    })
    await page.goto('/wallet', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: '领取 200 积分' }).click()
    await expect(page.locator('.wallet-trial')).toContainText('已领取')
    await expect(page.locator('.wallet-aside__amount strong')).toHaveText('1,260')
    expect(claimCount).toBe(1)
  })

  test('a pending wallet request does not block client-side navigation', async ({ page }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet**', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, walletSnapshot).catch(() => null)
    })
    await page.route('**/api/v1/me/trial-access-application', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, { application: null }).catch(() => null)
    })
    await page.goto('/wallet', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('account validates and saves trimmed profile fields and cost preference', async ({
    page,
  }) => {
    const patches = []
    let currentUser = { ...accountProfile }
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: currentUser }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/profile', async (route) => {
      const body = route.request().postDataJSON()
      patches.push(body)
      currentUser = { ...currentUser, ...body }
      await fulfillJson(route, { user: currentUser })
    })
    await page.goto('/account', { waitUntil: 'domcontentloaded' })

    await page.getByPlaceholder('展示名称').fill('  新的创作者  ')
    await page.getByPlaceholder('上海 / Remote').fill('  深圳  ')
    await page.getByPlaceholder('https://example.com').fill('creator.example.com')
    await expect(page.locator('.account-error')).toContainText('请输入完整的')
    await expect(page.getByRole('button', { name: '保存资料' })).toBeDisabled()

    await page.getByPlaceholder('https://example.com').fill('  https://new.example.com  ')
    await page.getByRole('button', { name: '保存资料' }).click()
    await expect(page.locator('.account-top__meta')).toContainText('资料已同步')
    expect(patches[0]).toEqual({
      username: '新的创作者',
      bio: accountProfile.bio,
      location: '深圳',
      websiteUrl: 'https://new.example.com',
    })

    await page.locator('.account-switch').click()
    await expect(page.getByRole('checkbox', { name: '生成前费用确认' })).not.toBeChecked()
    expect(patches[1]).toEqual({ requireCostConfirm: false })
  })

  test('account crops and uploads an avatar before saving its URL', async ({ page }) => {
    let uploadContentType = ''
    let avatarPatch = null
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/uploads', async (route) => {
      uploadContentType = route.request().headers()['content-type'] || ''
      await fulfillJson(route, {
        key: 'avatars/new-avatar.jpg',
        url: '/api/v1/files/avatars/new-avatar.jpg',
      })
    })
    await page.route('**/api/v1/me/profile', async (route) => {
      avatarPatch = route.request().postDataJSON()
      await fulfillJson(route, { user: { ...accountProfile, ...avatarPatch } })
    })
    await page.goto('/account', { waitUntil: 'domcontentloaded' })

    await page.locator('.account-avatar__input').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAABeK7cBAAAADUlEQVR42mNk+M/wHwAF/gL+WRhKAAAAAElFTkSuQmCC',
        'base64',
      ),
    })

    await expect(page.locator('.account-avatar__preview img')).toHaveAttribute(
      'src',
      '/api/v1/files/avatars/new-avatar.jpg',
    )
    expect(uploadContentType).toContain('multipart/form-data')
    expect(avatarPatch).toEqual({ avatarUrl: '/api/v1/files/avatars/new-avatar.jpg' })
  })

  test('a pending account save does not block client-side navigation', async ({ page }) => {
    let markSaveStarted
    const saveStarted = new Promise((resolve) => {
      markSaveStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/profile', async (route) => {
      markSaveStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, { user: accountProfile }).catch(() => null)
    })
    await page.goto('/account', { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('展示名称').fill('等待保存的昵称')
    await page.getByRole('button', { name: '保存资料' }).click()
    await saveStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('notifications append a cursor page and mark all messages as read', async ({ page }) => {
    const patchBodies = []
    let cursorRequests = 0
    const firstPage = [
      notificationItem('10000000-0000-4000-8000-000000000001'),
      notificationItem('10000000-0000-4000-8000-000000000002', {
        kind: 'task_succeeded',
        title: '任务已完成',
        body: '你的图片已经生成完成。',
      }),
    ]
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/notifications**', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBodies.push(route.request().postDataJSON())
        await fulfillJson(route, {})
        return
      }
      const url = new URL(route.request().url())
      if (url.searchParams.get('cursor')) {
        cursorRequests += 1
        await fulfillJson(route, {
          items: [
            notificationItem('10000000-0000-4000-8000-000000000003', {
              readAt: '2026-08-11T09:00:00Z',
            }),
          ],
          nextCursor: null,
          unread: 2,
        })
        return
      }
      await fulfillJson(route, { items: firstPage, nextCursor: 'notification-next', unread: 2 })
    })
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.nt-item')).toHaveCount(3)
    expect(cursorRequests).toBe(1)
    await expect(page.locator('.nav-notify__badge')).toHaveText('2')
    await page.getByRole('button', { name: '全部已读' }).click()
    await expect(page.locator('.nt-item.is-unread')).toHaveCount(0)
    await expect(page.locator('.nav-notify__badge')).toHaveCount(0)
    expect(patchBodies).toEqual([{}])
  })

  test('notification day header does not cover the first row and stays below the app header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 2048, height: 1152 })
    const items = Array.from({ length: 20 }, (_, index) =>
      notificationItem(`10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, {
        kind: 'task_failed',
        title: '任务失败',
        body: `你的「t2i-${index + 1}」任务执行失败，费用已退回。`,
        createdAt: `2026-08-11T10:${String(54 - index).padStart(2, '0')}:00Z`,
      }),
    )
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/notifications**', (route) =>
      fulfillJson(route, { items, nextCursor: null, unread: items.length }),
    )
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' })

    const board = page.locator('.nt-board')
    const dayHeader = page.locator('.nt-day__head').first()
    const firstItem = page.locator('.nt-item').first()
    await expect(firstItem).toBeVisible()

    const initial = await Promise.all([
      board.boundingBox(),
      dayHeader.boundingBox(),
      firstItem.boundingBox(),
    ])
    expect(initial.every(Boolean)).toBe(true)
    expect(initial[1].y - initial[0].y).toBeLessThan(12)
    expect(initial[2].y).toBeGreaterThanOrEqual(initial[1].y + initial[1].height - 1)

    await page.evaluate(() => window.scrollTo(0, 360))
    await expect
      .poll(async () => {
        const position = await dayHeader.evaluate((element) => ({
          actual: element.getBoundingClientRect().top,
          expected: Number.parseFloat(getComputedStyle(element).top),
        }))
        return Math.abs(position.actual - position.expected)
      })
      .toBeLessThan(2)
  })

  test('opening a trial notification marks only that item and preserves the current route', async ({
    page,
  }) => {
    const trialId = '10000000-0000-4000-8000-000000000010'
    let patchBody = null
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/trial-access-campaign', (route) =>
      fulfillJson(route, {
        campaign: {
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
        },
      }),
    )
    await page.route('**/api/v1/me/trial-access-application', (route) =>
      fulfillJson(route, { application: null }),
    )
    await page.route('**/api/v1/me/notifications**', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON()
        await fulfillJson(route, {})
        return
      }
      await fulfillJson(route, {
        items: [
          notificationItem(trialId, {
            kind: 'trial_access',
            title: '体验资格审核通过',
            body: '可领取 200 积分。',
          }),
          notificationItem('10000000-0000-4000-8000-000000000011'),
        ],
        nextCursor: null,
        unread: 2,
      })
    })
    await page.goto('/notifications?source=inbox', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /查看体验资格/ }).click()
    await expect(page).toHaveURL(/\/notifications\?source=inbox$/)
    await expect(page.getByRole('dialog', { name: '限量功能体验计划' })).toBeVisible()
    await expect(page.locator('.nt-item').filter({ hasText: '体验资格审核通过' })).not.toHaveClass(
      /is-unread/,
    )
    await expect(page.locator('.nav-notify__badge')).toHaveText('1')
    expect(patchBody).toEqual({ ids: [trialId] })
  })

  test('a pending notifications request does not block client-side navigation', async ({
    page,
  }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/notifications**', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, { items: [], nextCursor: null, unread: 0 }).catch(() => null)
    })
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('materials paginate, preview the original, edit metadata, and delete an asset', async ({
    page,
  }) => {
    const group = { id: 'group-brand', name: '品牌资产', assetCount: 1 }
    const firstPage = [
      materialAsset('asset-logo'),
      materialAsset('asset-packaging', { groupId: group.id }),
    ]
    let updateBody = null
    const deletedIds = []
    let cursorRequests = 0
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/asset-groups**', (route) =>
      fulfillJson(route, {
        items: [group],
        ungroupedCount: 2,
        totalAssetCount: 3,
      }),
    )
    await page.route('**/api/v1/me/assets**', async (route) => {
      const url = new URL(route.request().url())
      const id = url.pathname.match(/\/assets\/([^/]+)$/)?.[1]
      if (route.request().method() === 'PATCH' && id) {
        updateBody = route.request().postDataJSON()
        await fulfillJson(route, {
          ...firstPage.find((asset) => asset.id === id),
          ...updateBody,
        })
        return
      }
      if (route.request().method() === 'DELETE' && id) {
        deletedIds.push(id)
        await fulfillJson(route, {})
        return
      }
      if (url.searchParams.get('cursor')) {
        cursorRequests += 1
        await fulfillJson(route, {
          items: [materialAsset('asset-page-2')],
          nextCursor: null,
        })
        return
      }
      await fulfillJson(route, { items: firstPage, nextCursor: 'materials-page-2' })
    })
    await page.goto('/assets', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.ml-card')).toHaveCount(2)
    await expect(page.locator('.ml-page')).toHaveAttribute(
      'data-assets-content-motion-state',
      'entered',
    )
    await page.getByRole('button', { name: '加载更多' }).click()
    await expect(page.locator('.ml-card')).toHaveCount(3)
    await expect(page.locator('.ml-page')).toHaveAttribute(
      'data-assets-content-motion-state',
      'entered',
    )
    expect(cursorRequests).toBe(1)

    await page.locator('.ml-card').first().locator('.ml-card__cover').click()
    await expect(page.locator('.ml-lightbox')).toBeVisible()
    await expect(page.locator('.ml-lightbox img[alt="品牌素材 asset-logo"]')).toHaveAttribute(
      'src',
      /home-intro-03\.png/,
    )
    await page.locator('.ml-lightbox__close').click()

    const logoCard = page.locator('.ml-card').filter({ hasText: '品牌素材 asset-logo' })
    await logoCard.hover()
    await logoCard.getByTitle('编辑').click()
    await page.getByPlaceholder('资产标题').fill('新版品牌标志')
    await page.locator('.ml-edit__form select').selectOption(group.id)
    await page.locator('.ml-edit__form').getByRole('button', { name: '保存' }).click()
    await expect(page.locator('.ml-card').filter({ hasText: '新版品牌标志' })).toBeVisible()
    expect(updateBody).toEqual({ title: '新版品牌标志', groupId: group.id })

    const pageTwoCard = page.locator('.ml-card').filter({ hasText: '品牌素材 asset-page-2' })
    await pageTwoCard.hover()
    await pageTwoCard.getByTitle('删除').click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(pageTwoCard).toHaveCount(0)
    expect(deletedIds).toEqual(['asset-page-2'])
  })

  test('legacy materials route redirects to the global assets page', async ({ page }) => {
    await page.goto('/materials', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/assets$/)
  })

  test('materials create a group and upload an image into it', async ({ page }) => {
    let groupItems = []
    let totalAssetCount = 0
    let createGroupBody = null
    let createAssetBody = null
    let uploadCount = 0
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/uploads', async (route) => {
      uploadCount += 1
      await fulfillJson(route, {
        key: 'materials/uploaded.png',
        thumbnailKey: 'materials/uploaded-thumb.png',
        contentType: 'image/png',
      })
    })
    await page.route('**/api/v1/me/asset-groups**', async (route) => {
      if (route.request().method() === 'POST') {
        createGroupBody = route.request().postDataJSON()
        const group = { id: 'group-products', name: createGroupBody.name, assetCount: 0 }
        groupItems = [group]
        await fulfillJson(route, group)
        return
      }
      await fulfillJson(route, {
        items: groupItems,
        ungroupedCount: 0,
        totalAssetCount,
      })
    })
    await page.route('**/api/v1/me/assets**', async (route) => {
      if (route.request().method() === 'POST') {
        createAssetBody = route.request().postDataJSON()
        totalAssetCount += 1
        groupItems = groupItems.map((group) => ({ ...group, assetCount: 1 }))
        await fulfillJson(
          route,
          materialAsset('asset-uploaded', {
            title: createAssetBody.title,
            groupId: createAssetBody.groupId,
          }),
        )
        return
      }
      await fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.goto('/assets', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /新建分组/ }).click()
    await page.getByRole('textbox', { name: '新建分组名称' }).fill('产品图')
    await page.getByRole('button', { name: '创建' }).click()
    await expect(page.getByRole('button', { name: /产品图/ })).toHaveClass(/is-active/)
    expect(createGroupBody).toEqual({ name: '产品图' })

    await page.getByRole('button', { name: /添加资产/ }).click()
    await page.locator('input[type="file"]').setInputFiles({
      name: '产品主图.png',
      mimeType: 'image/png',
      buffer: Buffer.from('material-image'),
    })
    await page.getByRole('button', { name: /上传到「产品图」/ }).click()
    await expect(page.locator('.ml-card').filter({ hasText: '产品主图' })).toBeVisible()
    expect(uploadCount).toBe(1)
    expect(createAssetBody).toEqual({
      title: '产品主图',
      fileKey: 'materials/uploaded.png',
      thumbnailKey: 'materials/uploaded-thumb.png',
      contentType: 'image/png',
      groupId: 'group-products',
    })
  })

  test('pending material requests do not block client-side navigation', async ({ page }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/asset-groups**', (route) =>
      fulfillJson(route, { items: [], ungroupedCount: 0, totalAssetCount: 0 }),
    )
    await page.route('**/api/v1/me/assets**', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, { items: [], nextCursor: null }).catch(() => null)
    })
    await page.goto('/assets', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('submissions show review states, append a cursor page, and delete an item', async ({
    page,
  }) => {
    const deletedIds = []
    let cursorRequests = 0
    const firstPage = [
      gallerySubmission('pending'),
      gallerySubmission('approved', { status: 'approved' }),
      gallerySubmission('rejected', {
        status: 'rejected',
        rejectReason: '画面包含无法识别的文字',
      }),
    ]
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/gallery/submissions**', async (route) => {
      const url = new URL(route.request().url())
      const id = url.pathname.match(/\/submissions\/([^/]+)$/)?.[1]
      if (route.request().method() === 'DELETE' && id) {
        deletedIds.push(id)
        await fulfillJson(route, {})
        return
      }
      if (url.searchParams.get('cursor')) {
        cursorRequests += 1
        await fulfillJson(route, {
          items: [gallerySubmission('removed', { status: 'removed' })],
          nextCursor: null,
        })
        return
      }
      await fulfillJson(route, { items: firstPage, nextCursor: 'submissions-page-2' })
    })
    await page.goto('/submissions', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.ps-submission-list > li')).toHaveCount(3)
    await expect(page.locator('.ps-submission__status')).toHaveText(['审核中', '已通过', '已拒绝'])
    await expect(page.locator('.ps-submission__reason')).toContainText(
      '原因：画面包含无法识别的文字',
    )
    await page.getByRole('button', { name: '加载更多' }).click()
    await expect(page.locator('.ps-submission-list > li')).toHaveCount(4)
    await expect(page.locator('.ps-submission__status').last()).toHaveText('已下架')
    expect(cursorRequests).toBe(1)

    const rejected = page
      .locator('.ps-submission-list > li')
      .filter({ hasText: '投稿作品 rejected' })
    await rejected.getByTitle('撤回/删除').click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(rejected).toHaveCount(0)
    expect(deletedIds).toEqual(['rejected'])
  })

  test('pending submission requests do not block client-side navigation', async ({ page }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/gallery/submissions**', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, { items: [], nextCursor: null }).catch(() => null)
    })
    await page.goto('/submissions', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('profile renders overview data and saves the cost confirmation preference', async ({
    page,
  }) => {
    let profileBody = null
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/overview', (route) => fulfillJson(route, profileOverview))
    await page.route('**/api/v1/me/profile', async (route) => {
      profileBody = route.request().postDataJSON()
      await fulfillJson(route, { user: { ...accountProfile, ...profileBody } })
    })
    await page.goto('/profile', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.pp-soft-event')).toContainText('星云创作者')
    await expect(page.locator('.pp-soft-event')).toContainText('累计任务 18')
    await expect(page.locator('.pp-soft-performance')).toContainText('成功率 80%')
    await expect(page.locator('.pp-soft-stats')).toContainText('过审投稿')
    const preference = page.locator('.pp-soft-switch input')
    await expect(preference).toBeChecked()
    await preference.uncheck()
    await expect(preference).not.toBeChecked()
    expect(profileBody).toEqual({ requireCostConfirm: false })

    await page.getByRole('button', { name: '查看投稿' }).click()
    await expect(page).toHaveURL(/\/submissions$/)
  })

  test('profile redirects legacy tabs and pending overview requests do not block navigation', async ({
    page,
  }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) =>
      fulfillJson(route, { user: accountProfile }),
    )
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/overview', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, profileOverview).catch(() => null)
    })
    await page.goto('/profile', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)

    await page.goto('/profile?tab=materials', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/assets$/)
  })

  test('incentive group joins, shares, and creates through the existing growth contract', async ({
    page,
  }) => {
    let group = null
    const groupRequests = []
    await page.addInitScript(() => {
      window.__sharedGrowthInvite = null
      navigator.share = async (payload) => {
        window.__sharedGrowthInvite = payload
      }
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/growth**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'POST') {
        groupRequests.push({ path: url.pathname, body: route.request().postDataJSON() })
        group = {
          code: url.pathname.endsWith('/join') ? 'INVITE88' : 'CREATED9',
          memberCount: url.pathname.endsWith('/join') ? 2 : 1,
          targetMembers: 5,
          rewardCents: 120,
          status: 'forming',
        }
        await fulfillJson(route, { group })
        return
      }
      await fulfillJson(route, {
        group,
        rules: { groupEnabled: true, groupTargetMembers: 5, groupRewardCents: 120 },
      })
    })

    await page.goto('/incentive-plans/group?code=invite88', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /加入好友拼团/ }).click()
    await expect(page.getByRole('button', { name: /邀请好友/ })).toBeVisible()
    expect(groupRequests[0]).toEqual({
      path: '/api/v1/me/growth/groups/join',
      body: { code: 'INVITE88' },
    })

    await page.getByRole('button', { name: /邀请好友/ }).click()
    await expect
      .poll(() => page.evaluate(() => window.__sharedGrowthInvite?.url || ''))
      .toContain('code=INVITE88')

    group = null
    await page.goto('/incentive-plans/group', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /发起拼团/ }).click()
    await expect(page.getByRole('button', { name: /邀请好友/ })).toBeVisible()
    expect(groupRequests[1]).toEqual({ path: '/api/v1/me/growth/groups', body: {} })
  })

  test('suggestion adoption submits the exact feedback payload and clears the form', async ({
    page,
  }) => {
    let submittedBody = null
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/growth', (route) =>
      fulfillJson(route, { rules: { suggestionRewardMaxCents: 500 } }),
    )
    await page.route('**/api/v1/me/feedback', async (route) => {
      submittedBody = route.request().postDataJSON()
      await fulfillJson(route, { id: 'suggestion-created', ...submittedBody })
    })
    await page.goto('/incentive-plans/suggestion', { waitUntil: 'domcontentloaded' })

    await page.getByPlaceholder('请简要概括你的建议（不超过 50 字）').fill('增加批量任务筛选能力')
    await page
      .getByPlaceholder('请详细描述你的建议，包括问题、场景、方案与预期价值（不少于 20 字）')
      .fill('希望可以按任务状态和创建日期批量筛选，方便快速定位失败任务并重新执行。')
    await page.locator('.suggestion-form select').selectOption('experience')
    await page.getByRole('button', { name: '提交产品建议' }).click()

    expect(submittedBody).toEqual({
      category: 'suggestion',
      title: '增加批量任务筛选能力',
      content:
        '建议类型：体验优化\n\n希望可以按任务状态和创建日期批量筛选，方便快速定位失败任务并重新执行。',
      pageUrl: '/incentive-plans/suggestion',
    })
    await expect(page.getByPlaceholder('请简要概括你的建议（不超过 50 字）')).toHaveValue('')
  })

  test('membership actions, dynamic detail fallback, and milestone redirect are preserved', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/growth', (route) =>
      fulfillJson(route, {
        group: null,
        rules: { groupEnabled: true, groupTargetMembers: 5, groupRewardCents: 120 },
      }),
    )
    await page.route('**/api/v1/trial-access-campaign', (route) =>
      fulfillJson(route, {
        campaign: {
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
        },
      }),
    )
    await page.route('**/api/v1/me/trial-access-application', (route) =>
      fulfillJson(route, { application: null }),
    )
    await page.route('**/api/v1/plans', (route) =>
      fulfillJson(route, {
        paymentEnabled: false,
        items: [
          {
            id: 'creator-monthly',
            name: '创作者月度版',
            kind: 'subscription',
            priceCents: 6800,
            durationDays: 30,
            grantCents: 1000,
            bonusCents: 200,
          },
        ],
      }),
    )
    await page.goto('/incentive-plans/membership', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('会员方案对比').getByRole('button', { name: '申请体验' }).click()
    await expect(page).toHaveURL(/\/pricing$/)
    await expect(page.getByRole('dialog', { name: '限量功能体验计划' })).toBeVisible()
    await page.getByRole('button', { name: '关闭体验资格弹窗' }).click()

    await page.goto('/incentive-plans/legacy-preview', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.detail-page')).toHaveAttribute('data-tone', 'coral')
    await expect(page.locator('.detail-copy')).toContainText('好友拼团')

    await page.goto('/incentive-plans/milestone', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/incentive-plans\/usage$/)
  })

  test('a pending growth request does not block client-side navigation', async ({ page }) => {
    let markRequestStarted
    const requestStarted = new Promise((resolve) => {
      markRequestStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/growth', async (route) => {
      markRequestStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, {}).catch(() => null)
    })
    await page.goto('/incentive-plans', { waitUntil: 'domcontentloaded' })
    await requestStarted

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('incentive route styles are replaced during client-side navigation', async ({ page }) => {
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, walletSnapshot))
    await page.route('**/api/v1/me/growth', (route) =>
      fulfillJson(route, {
        rules: {
          groupEnabled: true,
          groupTargetMembers: 5,
          groupRewardCents: 120,
          failureBonusCents: 35,
          failureBonusDailyLimit: 3,
          usageMilestones: [],
        },
      }),
    )
    await page.route('**/api/v1/plans', (route) =>
      fulfillJson(route, { paymentEnabled: false, items: [] }),
    )
    const styleCount = (selector) =>
      page.evaluate(
        (needle) =>
          [...document.querySelectorAll('style')].filter((style) =>
            style.textContent.includes(needle),
          ).length,
        selector,
      )

    await page.goto('/incentive-plans/membership', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.membership-page')).toBeVisible()
    await expect.poll(() => styleCount('.membership-page')).toBe(1)

    await page.getByRole('button', { name: '返回' }).click()
    await page.locator('.benefit-card').filter({ hasText: '失败补偿' }).click()
    await expect(page.locator('.compensation-page')).toBeVisible()
    await expect.poll(() => styleCount('.membership-page')).toBe(0)
    await expect.poll(() => styleCount('.compensation-page')).toBe(1)

    await page.getByRole('button', { name: '返回' }).click()
    await page.locator('.benefit-card').filter({ hasText: '会员计划' }).click()
    await expect(page.locator('.membership-page')).toBeVisible()
    await expect.poll(() => styleCount('.compensation-page')).toBe(0)
    await expect.poll(() => styleCount('.membership-page')).toBe(1)
  })
})
