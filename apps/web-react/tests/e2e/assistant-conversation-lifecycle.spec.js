import { expect, test } from '@playwright/test'
import { fulfillJson, mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

// 对话数量管理：侧栏底部显示额度，满额新建时自动归档最旧的对话并提示，
// 可以手动归档、在“已归档”里恢复；置顶记在服务端。

const account = { id: 'lifecycle-user', email: 'life@example.com', username: '助手用户', role: 'user', requireCostConfirm: false }

const config = {
  conversationModels: [{ model: 'chat-basic', label: 'Chat Basic', pricePoints: 3 }],
  imageModels: [{ model: 'image-basic', label: 'Image Basic', pricePoints: 12, aspectRatios: ['auto', '1:1'], resolutions: ['1K'], qualities: ['low'], maxReferenceImages: 4 }],
}

function conversation(id, title, extra = {}) {
  return {
    id,
    title,
    workspace: 'assistant',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
    pinned: false,
    messages: [{ id: `${id}-m`, role: 'user', content: title, kind: 'chat', status: 'complete', createdAt: '2026-10-01T08:00:00Z' }],
    ...extra,
  }
}

const quota = (extra = {}) => ({ base: 3, planBonus: 0, limit: 3, used: 3, pinned: 1, archived: 0, dailyLimit: 100, createdToday: 2, archiveDays: 7, maxMessages: 0, ...extra })

test('conversation quota, archiving and restoring', async ({ page }) => {
  const pins = []
  const archived = []
  let restored = ''
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await mockBootstrapConfig(page)
  await mockAuthConfig(page)
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, { routes: {}, features: {}, pageLayout: {}, blacklist: { blocked: false } }))
  await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, config))
  await page.route('**/api/v1/assistant/runs?**', (route) => fulfillJson(route, { runs: [] }))
  await page.route('**/api/v1/assistant/conversation-quota', (route) => fulfillJson(route, { quota: quota({ used: 3, archived: 2 }) }))
  await page.route('**/api/v1/assistant/conversation-archive', (route) => fulfillJson(route, {
    archiveDays: 7,
    conversations: [
      { id: 'old-1', title: '最早的对话', archivedAt: '2026-10-03T08:00:00Z', deleteAt: new Date(Date.now() + 3 * 86400000 + 3600000).toISOString() },
    ],
  }))
  await page.route('**/api/v1/assistant/conversations**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/pin')) {
      pins.push({ id: url.pathname.split('/').at(-2), pinned: request.postDataJSON().pinned })
      return fulfillJson(route, { pinned: request.postDataJSON().pinned })
    }
    if (url.pathname.endsWith('/archive')) {
      archived.push(url.pathname.split('/').at(-2))
      return fulfillJson(route, { conversation: { id: 'c-2', title: '第二个对话' }, quota: quota({ used: 2, archived: 1 }), archived: [] })
    }
    if (url.pathname.endsWith('/restore')) {
      restored = url.pathname.split('/').at(-2)
      return fulfillJson(route, {
        conversation: conversation('old-1', '最早的对话'),
        quota: quota({ used: 3, archived: 1 }),
        archived: [{ id: 'c-3', title: '第三个对话', deleteAt: new Date(Date.now() + 7 * 86400000).toISOString() }],
      })
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/conversations')) {
      return fulfillJson(route, {
        ...conversation('c-new', '新对话', { messages: [] }),
        quota: quota({ used: 3, archived: 2, createdToday: 3 }),
        archived: [{ id: 'c-1', title: '第一个对话', deleteAt: new Date(Date.now() + 7 * 86400000).toISOString() }],
      }, 201)
    }
    if (url.pathname.endsWith('/conversations')) {
      return fulfillJson(route, {
        conversations: [conversation('c-3', '第三个对话', { pinned: true }), conversation('c-2', '第二个对话'), conversation('c-1', '第一个对话')],
        quota: quota(),
      })
    }
    return fulfillJson(route, { ...conversation(url.pathname.split('/').at(-1), '对话'), hasMoreMessages: false })
  })
  await page.route('**/api/v1/assistant/runs', (route) => {
    const body = route.request().postDataJSON()
    return fulfillJson(route, {
      run: { id: 'run-1', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
      userMessage: { id: body.clientUserMessageId, role: 'user', content: body.prompt, kind: 'chat', status: 'complete' },
      assistantMessage: { id: body.clientAssistantMessageId, role: 'assistant', content: '好的', kind: 'chat', status: 'complete' },
    }, 201)
  })

  await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
  const usage = page.locator('.sidebar-usage')
  await expect(usage).toContainText('对话 3/3')
  await expect(usage).toContainText('今日新建 2/100')

  // The server's pin is shown; unpinning goes to the server.
  const pinnedRow = page.locator('.conversation-row[data-conversation-id="c-3"]')
  await expect(pinnedRow).toHaveClass(/is-pinned/)
  await pinnedRow.hover()
  await pinnedRow.getByRole('button', { name: '更多' }).click()
  await pinnedRow.getByRole('menuitem', { name: '取消置顶' }).click()
  await expect.poll(() => pins).toEqual([{ id: 'c-3', pinned: false }])

  // Manual archive removes the row and says how long it is kept.
  const second = page.locator('.conversation-row[data-conversation-id="c-2"]')
  await second.hover()
  await second.getByRole('button', { name: '更多' }).click()
  await second.getByRole('menuitem', { name: '归档' }).click()
  await expect.poll(() => archived).toEqual(['c-2'])
  await expect(second).toHaveCount(0)
  await expect(page.locator('.app-toast').filter({ hasText: '7 天后自动删除' })).toHaveCount(1)
  await expect(usage).toContainText('对话 2/3')

  // Creating past the limit: the server archives the oldest and the sidebar follows.
  await page.locator('.sidebar-nav').getByRole('button', { name: '新对话' }).click()
  await page.getByLabel('消息输入').fill('新的问题')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.locator('.conversation-row[data-conversation-id="c-1"]')).toHaveCount(0)
  await expect(page.locator('.app-toast').filter({ hasText: '已自动归档「第一个对话」' })).toHaveCount(1)
  await expect(usage).toContainText('今日新建 3/100')

  // Archived panel lists what is left of the retention and restores.
  const nav = page.locator('.sidebar-nav')
  await expect(nav.getByRole('button', { name: /资产库/ })).toBeVisible()
  const navItems = await nav.locator('.sidebar-nav-item span:first-of-type').allTextContents()
  expect(navItems.indexOf('已归档')).toBe(navItems.indexOf('资产库') + 1)
  await expect(nav.getByRole('button', { name: /已归档/ })).toContainText('2')
  await page.screenshot({ path: 'test-results/sidebar-archived.png', clip: { x: 0, y: 0, width: 320, height: 420 } })
  await nav.getByRole('button', { name: /已归档/ }).click()
  const dialog = page.getByRole('dialog', { name: '已归档的对话' })
  await expect(dialog).toContainText('最早的对话')
  await expect(dialog).toContainText('3 天')
  // Restore and delete are always visible on every row and reachable by keyboard.
  await expect(dialog.getByRole('button', { name: '恢复' })).toBeVisible()
  await dialog.getByLabel('搜索已归档对话').focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '恢复' })).toBeFocused()
  await dialog.getByRole('button', { name: '恢复' }).click()
  await expect.poll(() => restored).toBe('old-1')
  await expect(page.locator('.conversation-row[data-conversation-id="old-1"]')).toHaveCount(1)
  await expect(page.locator('.conversation-row[data-conversation-id="c-3"]')).toHaveCount(0)

  // Deleting tells the user images go too.
  const restoredRow = page.locator('.conversation-row[data-conversation-id="old-1"]')
  await restoredRow.hover()
  await restoredRow.getByRole('button', { name: '更多' }).click()
  await restoredRow.getByRole('menuitem', { name: '删除' }).click()
  await expect(page.getByRole('dialog', { name: '删除这个对话？' })).toContainText('生成的图片会一并永久删除')
})
