import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const account = {
  id: 'user-react-migration',
  email: 'creator@example.com',
  username: '星云创作者',
  bio: '专注品牌视觉、产品摄影与生成式设计工作流。',
  location: '上海 / Remote',
  websiteUrl: 'https://creator.example.com',
  requireCostConfirm: true,
  createdAt: '2026-01-18T09:30:00Z',
  role: 'user',
}

const checkinState = {
  enabled: true,
  campaignTitle: '连续签到领创作积分',
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
  totalCheckins: 18,
  claimedRewardCents: 0,
  alreadyChecked: false,
  balanceCents: 320,
  frozenCents: 0,
}

const routes = [
  { name: 'text-to-image-authenticated', path: '/text-to-image', root: '.t2i-page' },
  { name: 'assistant', path: '/assistant', root: '.assistant-workspace' },
  { name: 'feedback', path: '/feedback', root: '.feedback-page' },
  { name: 'check-in', path: '/check-in', root: '.ck' },
  { name: 'history', path: '/history', root: '.ch-page--history' },
  { name: 'wallet', path: '/wallet', root: '.wallet' },
  { name: 'account', path: '/account', root: '.account' },
  { name: 'notifications', path: '/notifications', root: '.nt-page' },
  { name: 'assets', path: '/assets', root: '.ml-page' },
  { name: 'submissions', path: '/submissions', root: '.ps-page' },
  { name: 'profile', path: '/profile', root: '.pp-page' },
  { name: 'incentives', path: '/incentive-plans', root: '.rewards-page' },
  { name: 'incentives-group', path: '/incentive-plans/group', root: '.group-page' },
  {
    name: 'incentives-membership',
    path: '/incentive-plans/membership',
    root: '.membership-page',
  },
  {
    name: 'incentives-failure',
    path: '/incentive-plans/failure',
    root: '.compensation-page',
  },
  {
    name: 'incentives-suggestion',
    path: '/incentive-plans/suggestion',
    root: '.suggestion-page',
  },
  { name: 'incentives-usage', path: '/incentive-plans/usage', root: '.usage-page' },
  {
    name: 'incentives-detail',
    path: '/incentive-plans/legacy-preview',
    root: '.detail-page',
  },
]

const textToImageModel = {
  id: 'image-pro',
  label: 'Image Pro',
  creditCost: 12,
  capabilities: ['textToImage'],
  aspectRatios: ['1:1', '16:9', '9:16'],
  resolutions: ['1K', '2K', '4K'],
  qualities: ['low', 'medium', 'high'],
  outputFormats: ['png', 'webp', 'jpeg'],
  moderationLevels: ['auto', 'low'],
  maxReferenceImages: 4,
  transparentBackground: true,
}

const growthState = {
  group: null,
  monthUnits: 36,
  failureClaims: 1,
  suggestion: { status: 'open' },
  rules: {
    groupEnabled: true,
    groupTargetMembers: 5,
    groupRewardCents: 120,
    failureBonusEnabled: true,
    failureBonusCents: 35,
    failureClaimsToday: 1,
    failureBonusDailyLimit: 3,
    monthDeliveredUnits: 36,
    suggestionRewardMaxCents: 500,
    usageMilestones: [
      { units: 10, rewardCents: 20, achieved: true },
      { units: 30, rewardCents: 60, achieved: true },
      { units: 50, rewardCents: 120, achieved: false },
      { units: 100, rewardCents: 300, achieved: false },
    ],
  },
}

const membershipPlans = {
  paymentEnabled: false,
  items: [
    {
      id: 'creator-monthly',
      code: 'creator-monthly',
      name: '创作者月度版',
      description: '稳定覆盖日常视觉创作',
      kind: 'subscription',
      priceCents: 6800,
      durationDays: 30,
      grantCents: 1000,
      bonusCents: 200,
      features: ['每月 1200 创作积分', '全平台创作工具通用', '优先任务队列'],
      recommended: true,
    },
    {
      id: 'points-pack',
      code: 'points-pack',
      name: '灵活积分包',
      description: '按需补充创作积分',
      kind: 'points',
      priceCents: 2800,
      grantCents: 400,
      bonusCents: 40,
      features: ['一次发放 440 创作积分', '长期有效'],
      recommended: false,
    },
  ],
}

const notificationItems = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    kind: 'trial_access',
    title: '体验资格审核通过',
    body: '你的文生图体验资格已通过，可领取 200 积分。',
    createdAt: '2026-08-11T09:30:00Z',
    readAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    kind: 'wallet_redeem',
    title: '兑换积分已到账',
    body: '兑换成功，260 积分已加入账户余额。',
    createdAt: '2026-08-11T08:15:00Z',
    readAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    kind: 'task_succeeded',
    title: '文生图任务已完成',
    body: '你的 2 张图片已经生成完成，可前往历史记录查看。',
    createdAt: '2026-08-10T16:40:00Z',
    readAt: '2026-08-10T16:45:00Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    kind: 'system_announcement',
    title: '创作服务维护完成',
    body: '图片生成与无限画布服务已恢复正常。',
    createdAt: '2026-08-10T10:05:00Z',
    readAt: '2026-08-10T10:10:00Z',
  },
]

const materialGroups = [
  { id: 'group-brand', name: '品牌资产', assetCount: 3 },
  { id: 'group-product', name: '产品图', assetCount: 2 },
]

const materialItems = [
  ['material-1', '品牌标志', '/sucai/home-intro-03.png', 'group-brand', 284000],
  ['material-2', '产品主视觉', '/sucai/ui-design-1785420316960.png', 'group-product', 628000],
  ['material-3', '角色设定', '/sucai/ultra-model-sheet-board-1785420340076.png', null, 914000],
  ['material-4', '游戏场景', '/sucai/game-character-1785420185589.webp', 'group-brand', 472000],
  ['material-5', '商品细节', '/sucai/home-intro-03.png', 'group-product', 356000],
  ['material-6', '活动背景', '/sucai/ui-design-1785420316960.png', 'group-brand', 518000],
].map(([id, title, url, groupId, sizeBytes]) => ({
  id,
  title,
  url,
  thumbnailUrl: url,
  groupId,
  sizeBytes,
  contentType: url.endsWith('.webp') ? 'image/webp' : 'image/png',
  createdAt: '2026-08-11T08:15:00Z',
}))

const submissionItems = [
  {
    id: 'submission-pending',
    taskId: 'task-pending',
    title: '夏日玻璃杯产品摄影',
    status: 'pending',
    coverUrl: '/sucai/home-intro-03.png',
    mediaUrls: ['/sucai/home-intro-03.png'],
    rejectReason: null,
    createdAt: '2026-08-11T08:15:00Z',
  },
  {
    id: 'submission-approved',
    taskId: 'task-approved',
    title: '深色数据仪表盘界面',
    status: 'approved',
    coverUrl: '/sucai/ui-design-1785420316960.png',
    mediaUrls: ['/sucai/ui-design-1785420316960.png'],
    rejectReason: null,
    createdAt: '2026-08-10T16:40:00Z',
  },
  {
    id: 'submission-rejected',
    taskId: 'task-rejected',
    title: '科幻角色设定',
    status: 'rejected',
    coverUrl: '/sucai/ultra-model-sheet-board-1785420340076.png',
    mediaUrls: ['/sucai/ultra-model-sheet-board-1785420340076.png'],
    rejectReason: '画面包含无法识别的文字，请修改后重新投稿。',
    createdAt: '2026-08-09T10:05:00Z',
  },
  {
    id: 'submission-removed',
    taskId: 'task-removed',
    title: '森林冒险游戏场景',
    status: 'removed',
    coverUrl: '/sucai/game-character-1785420185589.webp',
    mediaUrls: ['/sucai/game-character-1785420185589.webp'],
    rejectReason: null,
    createdAt: '2026-08-08T09:20:00Z',
  },
]

const walletState = {
  balanceCents: 1260,
  availableCents: 1260,
  frozenCents: 80,
  totalCents: 1340,
  normalBalanceCents: 1060,
  trialBalanceCents: 200,
  normalFrozenCents: 60,
  trialFrozenCents: 20,
  trialFeatureKey: 'text_to_image',
}

const profileOverview = {
  wallet: walletState,
  taskStats: { total: 18, succeeded: 12, failed: 3, running: 3 },
  taskStatsByType: { t2i: 8, ecommerce_design: 4, coloring: 3, game_art: 3 },
  assetCount: materialItems.length,
  submissionStats: { total: 7, pending: 2, approved: 4, rejected: 1, removed: 0 },
  unreadNotifications: 2,
  recentTasks: [],
}

const walletEntries = [
  {
    id: 'ledger-1',
    kind: 'grant',
    sourceType: 'daily_checkin',
    deltaCents: 25,
    balanceAfterCents: 1260,
    reason: '连续签到奖励',
    createdAt: '2026-08-11T08:20:00Z',
  },
  {
    id: 'ledger-2',
    kind: 'task_settle',
    deltaCents: 0,
    balanceAfterCents: 1235,
    createdAt: '2026-08-11T07:15:00Z',
    creditBucket: 'mixed',
    task: {
      id: 'wallet-task-success',
      type: 't2i',
      status: 'succeeded',
      modelName: 'Star Image Pro',
      count: 2,
      costPoints: 40,
      settledCostPoints: 36,
    },
  },
  {
    id: 'ledger-3',
    kind: 'task_freeze',
    deltaCents: -30,
    balanceAfterCents: 1271,
    createdAt: '2026-08-10T12:30:00Z',
    creditBucket: 'trial',
    task: {
      id: 'wallet-task-running',
      type: 'ui_design',
      status: 'running',
      modelName: 'Design Vision',
      count: 1,
      costPoints: 30,
    },
  },
  {
    id: 'ledger-4',
    kind: 'task_release',
    deltaCents: 18,
    balanceAfterCents: 1301,
    createdAt: '2026-08-10T09:05:00Z',
    task: {
      id: 'wallet-task-failed',
      type: 'coloring',
      status: 'failed',
      costPoints: 18,
    },
  },
]

const historyTasks = [
  ['history-1', 't2i', '夏日玻璃杯产品摄影', '/sucai/home-intro-03.png', '1:1'],
  ['history-2', 'ui_design', '深色数据仪表盘界面', '/sucai/ui-design-1785420316960.png', '16:9'],
  [
    'history-3',
    'model_sheet',
    '科幻角色三视图设定',
    '/sucai/ultra-model-sheet-board-1785420340076.png',
    '4:3',
  ],
  ['history-4', 'game_art', '森林冒险游戏场景', '/sucai/game-character-1785420185589.webp', '3:4'],
].map(([id, type, prompt, url, aspectRatio], index) => ({
  id,
  type,
  status: 'succeeded',
  prompt,
  outputUrls: [url],
  originalUrls: [url],
  aspectRatio,
  costCents: 10 + index,
  createdAt: `2026-08-${String(11 - index).padStart(2, '0')}T08:30:00Z`,
}))

const assistantConversation = {
  id: 'visual-assistant-conversation',
  title: '品牌夏季主视觉创作',
  createdAt: '2026-08-11T08:00:00Z',
  updatedAt: '2026-08-11T08:10:00Z',
  messages: [
    {
      id: 'visual-assistant-user-1',
      role: 'user',
      kind: 'chat',
      content: '为夏季饮品品牌设计一组清爽、克制的主视觉。',
      status: 'complete',
      pending: false,
      createdAt: '2026-08-11T08:00:00Z',
      updatedAt: '2026-08-11T08:00:00Z',
    },
    {
      id: 'visual-assistant-reply-1',
      role: 'assistant',
      kind: 'chat',
      content: '可以从透明玻璃、冷凝水和大面积留白入手，保持产品主体清晰，并用少量高饱和色建立夏日感。',
      status: 'complete',
      statusStage: 'complete',
      pending: false,
      createdAt: '2026-08-11T08:00:04Z',
      updatedAt: '2026-08-11T08:00:04Z',
    },
    {
      id: 'visual-assistant-user-2',
      role: 'user',
      kind: 'chat',
      content: '按这个方向生成两张横版方案。',
      referenceImages: [
        {
          id: 'visual-reference',
          name: '商品参考图',
          dataUrl: '/sucai/home-intro-03.png',
          thumbnailUrl: '/sucai/home-intro-03.png',
          fileKey: 'uploads/visual-reference.png',
        },
      ],
      status: 'complete',
      pending: false,
      createdAt: '2026-08-11T08:05:00Z',
      updatedAt: '2026-08-11T08:05:00Z',
    },
    {
      id: 'visual-assistant-reply-2',
      role: 'assistant',
      kind: 'image',
      content: '',
      model: 'image-pro',
      ratio: '16:9',
      requestRatio: '16:9',
      resolution: '1K',
      count: 2,
      images: [
        { id: 'visual-output-1', dataUrl: '/sucai/home-intro-02.png', revisedPrompt: '夏季饮品品牌主视觉方案一' },
        { id: 'visual-output-2', dataUrl: '/sucai/home-intro-03.png', revisedPrompt: '夏季饮品品牌主视觉方案二' },
      ],
      status: 'complete',
      statusStage: 'complete',
      pending: false,
      createdAt: '2026-08-11T08:10:00Z',
      updatedAt: '2026-08-11T08:10:00Z',
    },
  ],
}

test.describe('Vue authenticated migration visual contract @visual @account', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.wallpaperGeneration': {
            enabled: true,
            config: { creditCost: 12, publicModels: [textToImageModel] },
          },
        },
        pageLayout: {},
        blacklist: { blocked: false },
      }),
    )
    await page.route('**/api/v1/assistant/config', (route) =>
      fulfillJson(route, {
        chatModel: 'chat-pro',
        imageModel: 'image-pro',
        conversationModels: [
          {
            model: 'chat-pro',
            label: 'Chat Pro',
            source: 'configured',
            description: '通用创作与视觉分析模型',
            pricePoints: 3,
          },
        ],
        imageModels: [textToImageModel],
      }),
    )
    await page.route('**/api/v1/assistant/conversations**', (route) =>
      fulfillJson(route, { conversations: [] }),
    )
    await page.route('**/api/v1/assistant/runs**', (route) =>
      fulfillJson(route, { runs: [] }),
    )
    await page.route('**/api/v1/me/feedback**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )
    await page.route('**/api/v1/me/checkin', (route) => fulfillJson(route, checkinState))
    await page.route('**/api/v1/tasks**', (route) => {
      const taskType = new URL(route.request().url()).searchParams.get('type')
      return fulfillJson(route, {
        items: taskType === 't2i' ? [] : historyTasks,
        nextCursor: null,
      })
    })
    await page.route('**/api/v1/me/wallet**', (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.endsWith('/entries')) {
        return fulfillJson(route, { items: walletEntries, nextCursor: 'wallet-next-page' })
      }
      return fulfillJson(route, walletState)
    })
    await page.route('**/api/v1/me/trial-access-application', (route) =>
      fulfillJson(route, {
        application: {
          id: 'trial-wallet-application',
          status: 'approved',
          rewardStatus: 'active',
          rewardCents: 200,
          feature: { key: 'text_to_image', label: '文生图' },
        },
      }),
    )
    await page.route('**/api/v1/me/notifications**', (route) => {
      if (route.request().method() === 'PATCH') return fulfillJson(route, {})
      return fulfillJson(route, { items: notificationItems, nextCursor: null, unread: 2 })
    })
    await page.route('**/api/v1/me/overview', (route) => fulfillJson(route, profileOverview))
    await page.route('**/api/v1/me/growth', (route) => fulfillJson(route, growthState))
    await page.route('**/api/v1/plans', (route) => fulfillJson(route, membershipPlans))
    await page.route('**/api/v1/me/asset-groups**', (route) =>
      fulfillJson(route, {
        items: materialGroups,
        ungroupedCount: 1,
        totalAssetCount: materialItems.length,
      }),
    )
    await page.route('**/api/v1/me/assets**', (route) =>
      fulfillJson(route, { items: materialItems, nextCursor: null }),
    )
    await page.route('**/api/v1/me/gallery/submissions**', (route) =>
      fulfillJson(route, { items: submissionItems, nextCursor: null }),
    )
  })

  for (const route of routes) {
    test(`${route.name} page`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await stabilizeVisualPage(page, route.root)
      if (route.name === 'notifications') {
        const [dayHeader, firstItem] = await Promise.all([
          page.locator('.nt-day__head').first().boundingBox(),
          page.locator('.nt-item').first().boundingBox(),
        ])
        expect(dayHeader).not.toBeNull()
        expect(firstItem).not.toBeNull()
        expect(firstItem.y).toBeGreaterThanOrEqual(dayHeader.y + dayHeader.height - 1)
      }
      await expect(page).toHaveScreenshot(`${route.name}.png`, { fullPage: true })
    })
  }

  test('text-to-image expanded frame controls', async ({ page }) => {
    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.t2i-page')
    await page.getByRole('button', { name: /画面/ }).click()
    await expect(page.getByRole('region', { name: '画面参数' })).toBeVisible()
    await expect(page).toHaveScreenshot('text-to-image-frame-controls.png', { fullPage: true })
  })

  test('text-to-image generated stage', async ({ page }) => {
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, {
        items: [
          {
            id: 'visual-t2i-output',
            type: 't2i',
            status: 'succeeded',
            prompt: '主画布圆角视觉检查',
            params: { aspectRatio: '1:1', resolutionScale: '1K', imageQuality: 'medium' },
            originalUrls: ['/sucai/home-intro-02.png'],
            thumbnailUrls: ['/sucai/home-intro-02.png'],
            createdAt: '2026-08-11T08:00:00Z',
            finishedAt: '2026-08-11T08:00:04Z',
          },
        ],
        nextCursor: null,
      }),
    )
    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.t2i-page')
    const stageFrame = page.locator('.t2i-stage-frame')
    await expect(stageFrame).toHaveCSS('border-radius', '22px')
    await expect(stageFrame).toHaveCSS('overflow', 'hidden')
    await expect(page).toHaveScreenshot('text-to-image-generated-stage.png', { fullPage: true })
  })

  test('text-to-image cost confirmation dialog', async ({ page }) => {
    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.t2i-page')
    await page.getByRole('button', { name: '立即生成' }).click()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toBeVisible()
    await expect(page).toHaveScreenshot('text-to-image-cost-confirmation.png', { fullPage: true })
  })

  test('assistant existing conversation', async ({ page }) => {
    await page.route('**/api/v1/assistant/conversations**', (route) =>
      fulfillJson(route, { conversations: [assistantConversation] }),
    )
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.assistant-workspace')
    await expect(page.locator('.message--assistant')).toHaveCount(2)
    await expect(page.locator('.generated-images img')).toHaveCount(2)
    await expect(page).toHaveScreenshot('assistant-conversation.png', { fullPage: true })
  })

  test('assistant model popover', async ({ page }) => {
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.assistant-workspace')
    await page.locator('.image-model-button').evaluate((button) => button.click())
    await expect(page.locator('.image-model-menu')).toBeVisible()
    await expect(page).toHaveScreenshot('assistant-model-popover.png', { fullPage: true })
  })

  test('assistant image settings popover', async ({ page }) => {
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.assistant-workspace')
    await page.locator('.agent-mode-button').evaluate((button) => button.click())
    await page.locator('.creation-type-menu').getByRole('button', { name: /图片生成/ }).evaluate((button) => button.click())
    await page.locator('.image-settings-button').evaluate((button) => button.click())
    await expect(page.locator('.image-mode-preferences')).toBeVisible()
    await expect(page).toHaveScreenshot('assistant-image-settings.png', { fullPage: true })
  })

  test('assistant cost confirmation dialog', async ({ page }) => {
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.assistant-workspace')
    await page.getByLabel('消息输入').fill('生成一张极简品牌主视觉')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toBeVisible()
    await expect(page).toHaveScreenshot('assistant-cost-confirmation.png', { fullPage: true })
  })
})
