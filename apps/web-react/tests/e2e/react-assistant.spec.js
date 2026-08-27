import { expect, test } from '@playwright/test'
import { fulfillJson, mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

const account = {
  id: 'assistant-user',
  email: 'assistant@example.com',
  username: '助手测试用户',
  role: 'user',
  requireCostConfirm: false,
}

const assistantConfig = {
  conversationModels: [
    { model: 'chat-basic', label: 'Chat Basic', description: '日常对话', pricePoints: 3 },
    {
      model: 'chat-pro',
      label: 'Chat Pro',
      description: '复杂创作',
      pricePoints: 5,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      reasoningEfforts: [
        { id: 'low', label: '低', pricePoints: 3 },
        { id: 'medium', label: '中', pricePoints: 5 },
        { id: 'high', label: '高', pricePoints: 8 },
      ],
    },
  ],
  imageModels: [
    {
      model: 'image-basic',
      label: 'Image Basic',
      pricePoints: 12,
      aspectRatios: ['auto', '1:1', '16:9'],
      resolutions: ['1K', '2K'],
      qualities: ['low', 'medium'],
      maxReferenceImages: 4,
    },
    {
      model: 'image-pro',
      label: 'Image Pro',
      pricePoints: 20,
      aspectRatios: ['1:1', '16:9', '9:16'],
      resolutions: ['1K', '2K', '4K'],
      qualities: ['low', 'medium', 'high'],
      maxReferenceImages: 4,
    },
    {
      model: 'schema-image',
      label: 'Schema Only',
      pricePoints: 20,
      aspectRatios: ['auto', '1:1', '16:9'],
      resolutions: [],
      qualities: [],
      inputFields: ['prompt', 'aspect_ratio', 'img_urls', 'output_format'],
      maxReferenceImages: 10,
      maxImages: 4,
    },
  ],
}

function message(id, role, content, extra = {}) {
  return {
    id,
    role,
    content,
    kind: role === 'assistant' ? 'chat' : 'chat',
    status: 'complete',
    pending: false,
    createdAt: '2026-08-11T08:00:00Z',
    updatedAt: '2026-08-11T08:00:05Z',
    ...extra,
  }
}

function succeededRun(body, content = '已完成你的创作请求。') {
  return {
    run: {
      id: 'assistant-run-success',
      conversationId: body.conversationId,
      userMessageId: body.clientUserMessageId,
      assistantMessageId: body.clientAssistantMessageId,
      mode: body.mode,
      resolvedMode: body.mode === 'agent' ? 'chat' : body.mode,
      status: 'succeeded',
      stage: 'complete',
    },
    userMessage: message(body.clientUserMessageId, 'user', body.userMessageContent),
    assistantMessage: message(body.clientAssistantMessageId, 'assistant', content),
  }
}

async function mockAssistant(
  page,
  { user = account, conversations = [], runs = [], config = assistantConfig } = {},
) {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await mockBootstrapConfig(page)
  await mockAuthConfig(page)
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, { routes: {}, features: {}, pageLayout: {}, blacklist: { blocked: false } }),
  )
  await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, config))
  await page.route('**/api/v1/assistant/conversations**', (route) =>
    fulfillJson(route, { conversations }),
  )
  await page.route('**/api/v1/assistant/runs**', (route) => fulfillJson(route, { runs }))
}

test.describe('React assistant workspace contract', () => {
  test.describe.configure({ mode: 'serial' })
  test('new conversation remains a draft until the first send', async ({ page }) => {
    let createCount = 0
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', async (route) => {
      if (route.request().method() === 'POST') createCount += 1
      await fulfillJson(route, { conversations: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: '新对话' }).click()
    await expect(page.getByText('暂无记录')).toBeVisible()
    expect(createCount).toBe(0)
  })

  test('first send creates a conversation and uses the assistant run contract', async ({ page }) => {
    let conversationBody = null
    let runBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', async (route) => {
      if (route.request().method() === 'POST') {
        conversationBody = route.request().postDataJSON()
        await fulfillJson(route, {
          id: 'conversation-new',
          title: '新对话',
          messages: [],
          createdAt: '2026-08-11T08:00:00Z',
          updatedAt: '2026-08-11T08:00:00Z',
        }, 201)
        return
      }
      await fulfillJson(route, { conversations: [] })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() === 'POST') {
        runBody = route.request().postDataJSON()
        await fulfillJson(route, succeededRun(runBody), 201)
        return
      }
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByLabel('消息输入').fill('请帮我设计一个简洁的品牌图标')
    await page.getByRole('button', { name: '发送' }).click()

    await expect(page.locator('.message--assistant')).toContainText('已完成你的创作请求。')
    expect(conversationBody).toEqual({ title: '新对话', workspace: 'assistant' })
    expect(runBody).toMatchObject({
      conversationId: 'conversation-new',
      prompt: '请帮我设计一个简洁的品牌图标',
      userMessageContent: '请帮我设计一个简洁的品牌图标',
      mode: 'chat',
      referenceImages: [],
      model: 'chat-basic',
      count: 1,
      serviceKey: 'assistant_image',
    })
    for (const field of ['ratio', 'resolution', 'requestSize', 'width', 'height', 'quality']) {
      expect(runBody).not.toHaveProperty(field)
    }
    expect(runBody.clientUserMessageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(runBody.clientAssistantMessageId).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('agent confirmation reserves only the reasoning cost and saves the preference', async ({ page }) => {
    let profileBody = null
    let runBody = null
    await mockAssistant(page, { user: { ...account, requireCostConfirm: true } })
    await page.route('**/api/v1/me/wallet', (route) =>
      fulfillJson(route, { availableCents: 3, balanceCents: 3 }),
    )
    await page.route('**/api/v1/me/profile', async (route) => {
      if (route.request().method() === 'PATCH') profileBody = route.request().postDataJSON()
      await fulfillJson(route, { user: { ...account, requireCostConfirm: false } })
    })
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'cost-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: 'Agent 模式' }).click()
    await page.getByLabel('消息输入').fill('生成两张主视觉')
    await page.getByRole('button', { name: '发送' }).click()
    const dialog = page.getByRole('dialog', { name: '确认本轮费用' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.ai-cost-confirm-total')).toContainText('3 积分')
    await expect(dialog).toContainText('执行生图时另行确认图片费用')
    await expect(dialog).toContainText('预留后余额')
    await dialog.getByText('不再每次确认').click()
    await dialog.getByRole('button', { name: '确认', exact: true }).click()

    await expect(page.locator('.message--assistant')).toContainText('已完成你的创作请求。')
    await expect.poll(() => profileBody).not.toBeNull()
    expect(runBody).toMatchObject({ mode: 'agent', model: 'chat-basic' })
    expect(profileBody).toEqual({ requireCostConfirm: false })
  })

  test('image mode sends selected model capabilities, dimensions, count, and uploaded keys', async ({ page }) => {
    let runBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, {
        key: 'uploads/assistant/reference.png',
        url: '/api/v1/files/uploads/assistant/reference.png',
        thumbnailUrl: '/sucai/home-intro-03.png',
      }),
    )
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'image-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: '图片生成' }).click()
    await page.getByRole('button', { name: /Image Basic/ }).click()
    await page.locator('.image-model-menu').getByRole('button', { name: /Image Pro/ }).click()
    await page.locator('.image-settings-button').click()
    await page.locator('.ratio-options').getByRole('button', { name: '16:9' }).click()
    await page.locator('.image-resolution-options button').nth(1).click()
    await page.getByRole('button', { name: '中', exact: true }).click()
    await page.locator('.image-count-options').getByRole('button', { name: '3', exact: true }).click()
    await page.locator('input.reference-file-input').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from('reference-image'),
    })
    await expect(page.locator('.reference-card')).toHaveCount(1)
    await expect(page.locator('.composer-attachment-inline')).toBeVisible()
    await page.getByLabel('消息输入').fill('生成横版品牌主视觉')
    await page.locator('.send-button').click()
    await expect(page.locator('.message--assistant')).toContainText(/Done|已完成/)

    expect(runBody).toMatchObject({
      mode: 'image',
      model: 'image-pro',
      ratio: '16:9',
      resolution: '2K',
      count: 3,
      requestSize: '2048x1152',
      width: 2048,
      height: 1152,
      quality: 'medium',
      referenceImages: [
        {
          name: 'reference.png',
          dataUrl: '/api/v1/files/uploads/assistant/reference.png',
          thumbnailUrl: '/sucai/home-intro-03.png',
          fileKey: 'uploads/assistant/reference.png',
        },
      ],
    })
  })

  test('schema-only image model hides and omits unsupported parameters', async ({ page }) => {
    let runBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'schema-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: '图片生成' }).click()
    await page.getByRole('button', { name: /Image Basic/ }).click()
    await page.locator('.image-model-menu').getByRole('button', { name: /Schema Only/ }).click()
    await page.locator('.image-settings-button').click()

    await expect(page.getByText('选择比例', { exact: true })).toBeVisible()
    await expect(page.getByText('选择分辨率', { exact: true })).toHaveCount(0)
    await expect(page.getByText('选择质量', { exact: true })).toHaveCount(0)
    await expect(page.getByText('尺寸', { exact: true })).toHaveCount(0)

    await page.getByLabel('消息输入').fill('生成一个品牌图标')
    await page.getByRole('button', { name: '发送' }).click()
    await expect.poll(() => runBody).not.toBeNull()
    expect(runBody).toMatchObject({ mode: 'image', model: 'schema-image', ratio: 'auto', count: 2 })
    for (const field of ['resolution', 'requestSize', 'width', 'height', 'quality']) {
      expect(runBody).not.toHaveProperty(field)
    }
  })

  test('image preferences balance dynamic model capability options', async ({ page }) => {
    await mockAssistant(page, {
      config: {
        ...assistantConfig,
        imageModels: [
          {
            model: 'image-dynamic',
            label: 'Image Dynamic',
            pricePoints: 20,
            aspectRatios: ['auto', '16:9', '9:16', '1:1', '3:2'],
            resolutions: ['1K'],
            qualities: ['low', 'medium', 'high'],
            maxReferenceImages: 4,
            maxImages: 16,
          },
        ],
      },
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: '图片生成' }).click()
    await page.locator('.image-settings-button').click()

    const panel = page.locator('.image-mode-preferences')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.ratio-options button')).toHaveCount(5)
    await expect(panel.locator('.image-count-options').first().locator('button')).toHaveCount(16)

    const layout = await panel.evaluate((element) => {
      const columns = (selector) =>
        getComputedStyle(element.querySelector(selector))
          .gridTemplateColumns.split(/\s+/)
          .filter(Boolean).length
      const countButtons = Array.from(
        element.querySelectorAll('.preferences-split .image-count-options button'),
      )
      const rowSizes = Array.from(
        countButtons.reduce((rows, button) => {
          const top = Math.round(button.getBoundingClientRect().top)
          rows.set(top, (rows.get(top) || 0) + 1)
          return rows
        }, new Map()).values(),
      )
      const rect = element.getBoundingClientRect()
      return {
        ratioColumns: columns('.ratio-options'),
        resolutionColumns: columns('.image-resolution-options'),
        countColumns: columns('.preferences-split .image-count-options'),
        qualityColumns: columns(':scope > .preferences-block:last-child .image-count-options'),
        countRows: rowSizes,
        panelTop: rect.top,
        panelBottom: rect.bottom,
        viewportHeight: window.innerHeight,
      }
    })

    expect(layout).toMatchObject({
      ratioColumns: 5,
      resolutionColumns: 1,
      countColumns: 8,
      qualityColumns: 3,
      countRows: [8, 8],
    })
    expect(layout.panelTop).toBeGreaterThanOrEqual(0)
    expect(layout.panelBottom).toBeLessThanOrEqual(layout.viewportHeight)
  })

  test('greeting in image mode sends a chat turn instead of generating images', async ({ page }) => {
    let runBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'greeting-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: '图片生成' }).click()
    await page.locator('.image-settings-button').click()
    await page.locator('.image-count-options').getByRole('button', { name: '4', exact: true }).click()
    await page.getByLabel('消息输入').fill('你好')
    await page.locator('.send-button').click()

    await expect(page.getByText('这句话不像画面描述，已按对话回复，不会生成图片')).toBeVisible()
    await expect(page.locator('.message--assistant')).toContainText(/Done|已完成/)
    expect(runBody).toMatchObject({
      mode: 'chat',
      model: 'chat-basic',
      count: 1,
    })
  })

  test('rejects PSD attachments while keeping the message input usable', async ({ page }) => {
    let assistantFileUploads = 0
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/files', async (route) => {
      if (route.request().method() === 'POST') assistantFileUploads += 1
      await fulfillJson(route, { files: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    const fileInput = page.locator('input.reference-file-input')
    await expect(fileInput).not.toHaveAttribute('accept', /psd|photoshop/i)
    await fileInput.setInputFiles({
      name: 'homepage-layout.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      buffer: Buffer.from('8BPS'),
    })
    await expect(page.locator('.reference-card, .reference-document-card')).toHaveCount(0)
    await page.getByLabel('消息输入').fill('继续处理普通问题')
    await expect(page.getByLabel('消息输入')).toHaveValue('继续处理普通问题')
    expect(assistantFileUploads).toBe(0)
  })

  test('blocks image-to-PSD conversion before cost confirmation or task creation', async ({ page }) => {
    let runCreates = 0
    await mockAssistant(page, { user: { ...account, requireCostConfirm: true } })
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, {
        key: 'uploads/assistant/source.png',
        url: '/api/v1/files/uploads/assistant/source.png',
        thumbnailUrl: '/sucai/home-intro-03.png',
      }),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() === 'POST') runCreates += 1
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.locator('input.reference-file-input').setInputFiles({
      name: 'source.png', mimeType: 'image/png', buffer: Buffer.from('source-image'),
    })
    await expect(page.locator('.reference-card')).toHaveCount(1)
    await page.getByLabel('消息输入').fill('把这张图片转换为 PSD')
    await page.locator('.send-button').click()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toHaveCount(0)
    await expect(page.locator('.message--user, .message--assistant')).toHaveCount(0)
    expect(runCreates).toBe(0)
  })

  test('keeps keyboard send guards aligned with the send button', async ({ page }) => {
    let conversationCreates = 0
    let runCreates = 0
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', async (route) => {
      if (route.request().method() === 'POST') conversationCreates += 1
      await fulfillJson(route, { conversations: [] })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() === 'POST') runCreates += 1
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    const input = page.getByLabel('消息输入')
    await input.fill('第一行')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('第一行\n')
    expect(runCreates).toBe(0)

    await input.dispatchEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
    })
    await expect(input).toHaveValue('第一行\n')
    expect(runCreates).toBe(0)

    await input.fill('x'.repeat(12001))
    await expect(page.locator('.send-button')).toBeDisabled()
    await expect(page.locator('.draft-counter')).toHaveClass(/is-over/)
    await input.press('Enter')
    await page.waitForTimeout(100)
    await expect(input).toHaveValue('x'.repeat(12001))
    expect(conversationCreates).toBe(0)
    expect(runCreates).toBe(0)
  })

  test('does not send or detach a document while it is still parsing', async ({ page }) => {
    let conversationCreates = 0
    let runCreates = 0
    const processingFile = {
      id: 'processing-document',
      name: 'research-notes.md',
      contentType: 'text/markdown',
      sizeBytes: 2048,
      status: 'processing',
      pageCount: 0,
      charCount: 0,
      segmentCount: 0,
    }
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/files**', (route) =>
      fulfillJson(route, { file: processingFile }, route.request().method() === 'POST' ? 201 : 200),
    )
    await page.route('**/api/v1/assistant/conversations', async (route) => {
      if (route.request().method() === 'POST') conversationCreates += 1
      await fulfillJson(route, { conversations: [] })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() === 'POST') runCreates += 1
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    const input = page.getByLabel('消息输入')
    await page.locator('input.reference-file-input').setInputFiles({
      name: 'research-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Research'),
    })
    await expect(page.locator('.reference-document-card.is-processing')).toHaveCount(1)
    await input.fill('分析这份文档')
    await expect(page.locator('.send-button')).toBeDisabled()
    await input.press('Enter')
    await page.waitForTimeout(100)

    await expect(input).toHaveValue('分析这份文档')
    await expect(page.locator('.reference-document-card.is-processing')).toHaveCount(1)
    await expect(page.locator('.message--user, .message--assistant')).toHaveCount(0)
    expect(conversationCreates).toBe(0)
    expect(runCreates).toBe(0)
  })

  test('document attachments stay above the editable message area on desktop and mobile', async ({ page }) => {
    let uploadCount = 0
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/files', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { files: [] })
        return
      }
      uploadCount += 1
      await fulfillJson(route, {
        file: {
          id: `attachment-${uploadCount}`,
          name: uploadCount === 1 ? 'product-brief.pdf' : 'notes.md',
          contentType: uploadCount === 1 ? 'application/pdf' : 'text/markdown',
          sizeBytes: uploadCount === 1 ? 4096 : 1024,
          status: 'ready',
          pageCount: 1,
          charCount: 120,
          segmentCount: 1,
        },
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    const input = page.getByLabel('消息输入')
    const pastePrevented = await input.evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['%PDF'], 'product-brief.pdf', { type: 'application/pdf' }))
      transfer.items.add(new File(['# Notes'], 'notes.md', { type: 'text/markdown' }))
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(pastePrevented).toBe(true)
    await expect(page.locator('.reference-document-card')).toHaveCount(2)
    await input.fill('请结合产品简报和笔记给出修改建议')
    await expect(input).toHaveValue('请结合产品简报和笔记给出修改建议')

    const assertNoOverlap = async () => {
      const dockBox = await page.locator('.reference-dock').boundingBox()
      const inputBox = await input.boundingBox()
      const composerBox = await page.locator('.assistant-composer').boundingBox()
      expect(dockBox).not.toBeNull()
      expect(inputBox).not.toBeNull()
      expect(composerBox).not.toBeNull()
      expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(inputBox.y + 1)
      expect(inputBox.x).toBeGreaterThanOrEqual(composerBox.x)
      expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(composerBox.x + composerBox.width + 1)
    }

    await assertNoOverlap()
    await page.screenshot({ path: '/tmp/startcloudsai-assistant-attachments-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await assertNoOverlap()
    await page.screenshot({ path: '/tmp/startcloudsai-assistant-attachments-mobile.png', fullPage: true })
  })

  test('selects and deletes an existing conversation', async ({ page }) => {
    const deleted = []
    const conversations = [
      { id: 'conversation-one', title: '第一个对话', messages: [message('u1', 'user', '第一条内容')], updatedAt: '2026-08-11T08:00:00Z' },
      { id: 'conversation-two', title: '第二个对话', messages: [message('u2', 'user', '第二条内容')], updatedAt: '2026-08-10T08:00:00Z' },
    ]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/conversations/**', async (route) => {
      if (route.request().method() === 'DELETE') deleted.push(route.request().url())
      await fulfillJson(route, {})
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /第二个对话/ }).click()
    await expect(page.locator('.message--user')).toContainText('第二条内容')
    const row = page.locator('[data-conversation-id="conversation-two"]')
    await row.getByRole('button', { name: '更多' }).click()
    await row.getByRole('menuitem', { name: '删除' }).click()
    const dialog = page.getByRole('dialog', { name: '删除这个对话？' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeInViewport()
    await dialog.getByRole('button', { name: '删除', exact: true }).click()

    await expect(page.locator('[data-conversation-id="conversation-two"]')).toHaveCount(0)
    expect(deleted).toEqual([expect.stringMatching(/\/assistant\/conversations\/conversation-two$/)])
  })

  test('stops an active run and settles the pending message', async ({ page }) => {
    let patchBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'running-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs**', async (route) => {
      const method = route.request().method()
      const url = new URL(route.request().url())
      if (method === 'POST') {
        const body = route.request().postDataJSON()
        await fulfillJson(route, {
          run: { id: 'run-active', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, status: 'running', stage: 'thinking', mode: 'agent' },
          assistantMessage: message(body.clientAssistantMessageId, 'assistant', '', { status: 'running', pending: true }),
        }, 201)
        return
      }
      if (method === 'PATCH') {
        patchBody = route.request().postDataJSON()
        await fulfillJson(route, { run: { id: 'run-active', status: 'canceled' }, canceled: true })
        return
      }
      if (url.pathname.endsWith('/run-active')) {
        await fulfillJson(route, {
          run: { id: 'run-active', conversationId: 'running-conversation', status: 'running', stage: 'thinking', mode: 'agent' },
          assistantMessage: { status: 'running', pending: true, content: '' },
        })
        return
      }
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByLabel('消息输入').fill('执行一个长任务')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByRole('button', { name: '停止生成' }).click()
    await expect(page.getByRole('dialog', { name: '停止本次生成？' })).toContainText('主动停止后，本轮已预留的积分不会退还')
    await page.getByRole('button', { name: '确认停止' }).click()

    await expect(page.locator('.message--assistant')).toContainText('你已主动停止生成')
    expect(patchBody).toEqual({ status: 'canceled' })
  })

  test('restores a running task after refresh', async ({ page }) => {
    const conversations = [{
      id: 'resume-conversation',
      title: '恢复中的对话',
      updatedAt: '2026-08-11T08:00:00Z',
      messages: [
        message('resume-user', 'user', '继续之前的任务'),
        message('resume-assistant', 'assistant', '', { status: 'running', pending: true, statusStage: 'thinking' }),
      ],
    }]
    const runs = [{ id: 'resume-run', conversationId: 'resume-conversation', assistantMessageId: 'resume-assistant', status: 'running', stage: 'thinking', mode: 'agent' }]
    await mockAssistant(page, { conversations, runs })
    await page.route('**/api/v1/assistant/runs/resume-run', (route) =>
      fulfillJson(route, {
        run: { ...runs[0], status: 'succeeded', stage: 'complete', resolvedMode: 'chat' },
        assistantMessage: message('resume-assistant', 'assistant', '任务刷新后已恢复完成。'),
      }),
    )
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message--assistant')).toContainText('任务刷新后已恢复完成。')
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  })

  test('generated images open in the full preview viewer', async ({ page }) => {
    const conversations = [{
      id: 'preview-conversation',
      title: '图片预览对话',
      updatedAt: '2026-08-11T08:00:00Z',
      messages: [
        message('preview-user', 'user', '生成两张预览图'),
        message('preview-assistant', 'assistant', '', {
          kind: 'image',
          images: [
            { id: 'preview-one', dataUrl: '/sucai/home-intro-02.png', revisedPrompt: '预览图一' },
            { id: 'preview-two', dataUrl: '/sucai/home-intro-03.png', revisedPrompt: '预览图二' },
          ],
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.generated-image-preview').first().click()
    const viewer = page.locator('.wallpaper-fullscreen-preview')
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('1 / 2')
    await viewer.getByRole('button', { name: '下一张' }).click()
    await expect(viewer).toContainText('2 / 2')
    await viewer.getByRole('button', { name: '放大图片' }).click()
    await expect(viewer.locator('output')).toHaveText('125%')
    await viewer.getByRole('button', { name: '关闭预览' }).click()
    await expect(viewer).toHaveCount(0)
  })

  test('shared preview exposes assistant actions and submits a painted region edit', async ({ page }) => {
    let runBody = null
    const uploads = []
    const conversations = [{
      id: 'region-edit-conversation',
      title: '局部编辑测试',
      updatedAt: '2026-08-11T08:00:00Z',
      messages: [
        message('region-edit-user', 'user', '把杯子改成绿色'),
        message('region-edit-assistant', 'assistant', '', {
          kind: 'image',
          runId: 'region-edit-source-run',
          prompt: '一只放在桌面的白色杯子',
          model: 'image-pro',
          ratio: '1:1',
          resolution: '1K',
          images: [{
            id: 'region-edit-image',
            fileKey: 'tasks/assistant-user/assistant/source/1.png',
            dataUrl: '/sucai/home-intro-03.png',
            revisedPrompt: '一只放在桌面的白色杯子',
          }],
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/uploads', async (route) => {
      const index = uploads.length
      uploads.push(route.request().postDataBuffer())
      await fulfillJson(route, {
        key: `uploads/assistant/region-${index + 1}.png`,
        url: `/api/v1/files/uploads/assistant/region-${index + 1}.png`,
        thumbnailUrl: `/api/v1/files/uploads/assistant/region-${index + 1}.png`,
      })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '收起侧栏' }).click()

    await page.locator('.generated-image-preview').click()
    const viewer = page.locator('.wallpaper-fullscreen-preview')
    await expect(viewer).toBeVisible()
    for (const name of ['局部编辑', '复制提示词', '收藏到资产', '发布作品', '删除图片']) {
      await expect(viewer.getByRole('button', { name })).toBeVisible()
    }
    await viewer.getByRole('button', { name: '复制提示词' }).click()
    await expect(page.locator('.app-toast')).toContainText('提示词已复制')
    await viewer.getByRole('button', { name: '局部编辑' }).click()

    const editor = page.getByRole('dialog', { name: '图片局部编辑' })
    await expect(editor).toBeVisible()
    const canvas = editor.getByLabel('涂抹编辑区域')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.45)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.55, { steps: 8 })
    await page.mouse.up()
    await editor.getByPlaceholder('描述选中区域需要变成什么').fill('把杯子改成绿色磨砂陶瓷')
    await editor.getByRole('button', { name: '生成局部编辑' }).click()

    await expect.poll(() => uploads.length).toBe(2)
    await expect.poll(() => runBody).not.toBeNull()
    expect(runBody).toMatchObject({
      mode: 'image',
      count: 1,
      parentOutputUrl: '/sucai/home-intro-03.png',
      maskBaseImage: { fileKey: 'tasks/assistant-user/assistant/source/1.png' },
    })
    const regionKeys = new Set([
      runBody.maskImage?.fileKey,
      runBody.referenceImages?.[0]?.fileKey,
    ])
    expect(regionKeys).toEqual(new Set([
      'uploads/assistant/region-1.png',
      'uploads/assistant/region-2.png',
    ]))
    expect(runBody.maskRect).toMatch(/^\d+,\d+,\d+,\d+$/)
    await expect(editor).toHaveCount(0)
  })

  test('assistant preview favorites, publishes, and deletes the current image', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    let assetBody = null
    let publishBody = null
    let deletePath = ''
    const conversations = [{
      id: 'image-actions-conversation',
      title: '图片操作测试',
      updatedAt: '2026-08-11T08:00:00Z',
      messages: [
        message('image-actions-user', 'user', '生成海报'),
        message('image-actions-assistant', 'assistant', '', {
          kind: 'image',
          runId: '6a38abeb-6fb5-4f27-af68-77f2d81e2301',
          prompt: '极简绿色品牌海报',
          images: [{
            id: 'image-actions-result',
            fileKey: 'tasks/assistant-user/assistant/actions/1.png',
            dataUrl: '/sucai/home-intro-03.png',
            revisedPrompt: '极简绿色品牌海报',
          }],
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/uploads', (route) => fulfillJson(route, {
      key: 'uploads/assistant-user/original/favorite.png',
      thumbnailKey: 'uploads/assistant-user/thumbs/favorite.jpg',
      url: '/api/v1/files/uploads/assistant-user/original/favorite.png',
      contentType: 'image/png',
    }))
    await page.route('**/api/v1/me/assets', async (route) => {
      if (route.request().method() === 'POST') assetBody = route.request().postDataJSON()
      await fulfillJson(route, { id: 'favorite-asset', title: '极简绿色品牌海报' }, 201)
    })
    await page.route('**/api/v1/gallery/submissions', async (route) => {
      if (route.request().method() === 'POST') publishBody = route.request().postDataJSON()
      await fulfillJson(route, { id: 'assistant-submission', status: 'pending' }, 201)
    })
    await page.route('**/api/v1/assistant/messages/*/images/*', async (route) => {
      if (route.request().method() === 'DELETE') deletePath = new URL(route.request().url()).pathname
      await fulfillJson(route, { messageDeleted: true })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '收起侧栏' }).click()

    await page.locator('.generated-image-preview').click()
    let viewer = page.locator('.wallpaper-fullscreen-preview')
    await viewer.getByRole('button', { name: '收藏到资产' }).click()
    await expect.poll(() => assetBody).not.toBeNull()
    expect(assetBody).toMatchObject({
      title: '极简绿色品牌海报',
      fileKey: 'uploads/assistant-user/original/favorite.png',
      thumbnailKey: 'uploads/assistant-user/thumbs/favorite.jpg',
    })
    await expect(page.locator('.app-toast')).toContainText('已收藏到我的资产')

    await viewer.getByRole('button', { name: '发布作品' }).click()
    const publishDialog = page.getByRole('dialog', { name: '发布作品' })
    await expect(publishDialog).toBeVisible()
    await publishDialog.getByRole('button', { name: '提交审核' }).click()
    await expect.poll(() => publishBody).not.toBeNull()
    expect(publishBody).toMatchObject({
      taskId: '6a38abeb-6fb5-4f27-af68-77f2d81e2301',
      title: '极简绿色品牌海报',
    })

    await page.locator('.generated-image-preview').click()
    viewer = page.locator('.wallpaper-fullscreen-preview')
    await viewer.getByRole('button', { name: '删除图片' }).click()
    const deleteDialog = page.getByRole('alertdialog', { name: '删除这张图片？' })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: '确认删除' }).click()
    await expect.poll(() => deletePath).toBe('/api/v1/assistant/messages/image-actions-assistant/images/image-actions-result')
    await expect(page.locator('.generated-image-preview')).toHaveCount(0)
  })

  test('studio pending prompt starts a new conversation with saved launch settings', async ({ page }) => {
    let runBody = null
    await page.addInitScript(() => {
      localStorage.setItem('starclouds:pending-prompt', JSON.stringify({
        version: 2,
        taskType: 'assistant',
        prompt: '从创作台启动的任务',
        at: Date.now(),
        config: {
          autoStart: true,
          costConfirmed: true,
          model: 'chat-pro',
          count: 3,
          referenceImages: [{ id: 'studio-reference', name: '商品参考图', dataUrl: '/sucai/home-intro-03.png', fileKey: 'uploads/studio-reference.png' }],
        },
      }))
    })
    await mockAssistant(page, {
      conversations: [{ id: 'old-conversation', title: '旧对话', messages: [message('old-user', 'user', '旧内容')] }],
    })
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'studio-new-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message--assistant')).toContainText('已完成你的创作请求。')
    expect(runBody).toMatchObject({
      conversationId: 'studio-new-conversation',
      prompt: '从创作台启动的任务',
      model: 'chat-pro',
      count: 1,
      referenceImages: [{ name: '商品参考图', dataUrl: '/sucai/home-intro-03.png', fileKey: 'uploads/studio-reference.png' }],
    })
    expect(await page.evaluate(() => localStorage.getItem('starclouds:pending-prompt'))).toBeNull()
  })

  test('studio pending prompt keeps Q&A mode and reasoning effort', async ({ page }) => {
    let runBody = null
    await page.addInitScript(() => {
      localStorage.setItem('starclouds:pending-prompt', JSON.stringify({
        version: 2,
        taskType: 'assistant',
        prompt: '只回答，不要生图',
        at: Date.now(),
        config: {
          autoStart: true,
          costConfirmed: true,
          skill: 'chat',
          mode: 'chat',
          model: 'chat-pro',
          reasoningEffort: 'high',
        },
      }))
    })
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'studio-chat-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message--assistant')).toContainText('已完成你的创作请求。')
    await expect(page.locator('.agent-mode-button')).toContainText('问答模式')
    expect(runBody).toMatchObject({
      conversationId: 'studio-chat-conversation',
      prompt: '只回答，不要生图',
      model: 'chat-pro',
      mode: 'chat',
      reasoningEffort: 'high',
    })
  })

  test('pending assistant requests do not block client-side navigation', async ({ page }) => {
    let markStarted
    const started = new Promise((resolve) => { markStarted = resolve })
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/config', async (route) => {
      markStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, assistantConfig).catch(() => null)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await started

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('quotes an assistant reply and sends the exact quote payload', async ({ page }) => {
    let runBody = null
    const conversations = [{
      id: 'quote-conversation',
      title: '引用测试',
      messages: [
        message('quote-user', 'user', '原始问题'),
        message('quote-assistant', 'assistant', '这是一段可引用的回答'),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: '引用', exact: true }).click()
    await expect(page.locator('.composer-quote')).toContainText('[回复] 这是一段可引用的回答')
    await page.getByLabel('消息输入').fill('继续解释')
    await page.getByRole('button', { name: '发送' }).click()

    expect(runBody.quoted).toEqual({
      id: 'quote-assistant',
      kind: '回复',
      content: '这是一段可引用的回答',
    })
    await expect(page.locator('.sent-quote').last()).toContainText('这是一段可引用的回答')
  })

  test('shows token usage and generation timing on completed answers', async ({ page }) => {
    const conversations = [{
      id: 'usage-conversation',
      title: '用量测试',
      messages: [
        message('usage-user', 'user', '写一段介绍'),
        message('usage-assistant', 'assistant', '这是完成的回答。', {
          usage: {
            inputTokens: 3812,
            outputTokens: 1204,
            firstTokenMs: 620,
            durationMs: 12400,
          },
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message-status-metrics')).toContainText('消耗 1.2K')
    await expect(page.locator('.message-status-metrics')).toContainText('输入 3.8K')
    await expect(page.locator('.message-status-metrics')).toContainText('首字 0.6s')
    await expect(page.locator('.message-meta')).toContainText('以上内容由 AI 生成')
    await expect(page.locator('.message-meta-duration')).toHaveText('12.4s')
  })

  test('estimates token usage on completed answers without backend usage', async ({ page }) => {
    const conversations = [{
      id: 'usage-fallback-conversation',
      title: '用量回退',
      messages: [
        message('fallback-user', 'user', '写一段介绍'),
        message('fallback-assistant', 'assistant', '你好世界', {
          context: { estimatedInputTokens: 800, inputBudgetTokens: 32000, usagePercent: 3, includedMessages: 2 },
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message-status-metrics')).toContainText('消耗 4')
    await expect(page.locator('.message-status-metrics')).toContainText('输入 800')
    await expect(page.locator('.message-meta-duration')).toHaveText('5s')
  })

  test('shows collapsible reasoning on completed answers', async ({ page }) => {
    const conversations = [{
      id: 'reasoning-conversation',
      title: '思考过程',
      messages: [
        message('reasoning-user', 'user', '分析这件事'),
        message('reasoning-assistant', 'assistant', '这是完成的回答。', {
          reasoning: '先确认目标，再给出可执行的结论。',
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.assistant-reasoning')).toContainText('思考过程')
    await page.locator('.assistant-reasoning summary').click()
    await expect(page.locator('.assistant-reasoning-body')).toHaveText('先确认目标，再给出可执行的结论。')
  })

  test('renders fenced code as a dark editor card with copy', async ({ page }) => {
    const conversations = [{
      id: 'code-conversation',
      title: '代码测试',
      messages: [
        message('code-user', 'user', '写一个任务管理器'),
        message('code-assistant', 'assistant', '```python\ntasks = []\n\ndef show_tasks():\n    if not tasks:\n        print("当前没有任务")\n```'),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    const block = page.locator('.assistant-code')
    await expect(block.locator('.assistant-code-lang')).toHaveText('Python')
    await expect(block.locator('.assistant-code-src')).toContainText('def show_tasks()')
    await expect(block.locator('.hljs-keyword').first()).toBeVisible()
    await page.getByRole('button', { name: '复制代码' }).click()
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible()
  })

  test('edits the latest user turn and retries from the question', async ({ page }) => {
    const runBodies = []
    const conversations = [{
      id: 'edit-conversation',
      title: '编辑测试',
      messages: [
        message('edit-user', 'user', '旧问题'),
        message('edit-assistant', 'assistant', '旧回答', { model: 'chat-basic', requestedMode: 'chat' }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      const body = route.request().postDataJSON()
      runBodies.push(body)
      await fulfillJson(route, succeededRun(body, '编辑后回答'), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.message--user').hover()
    await page.getByRole('button', { name: '编辑问题' }).click()
    await page.getByLabel('编辑问题').fill('修改后的问题')
    await page.locator('.user-message-editor').getByRole('button', { name: '发送' }).click()
    await expect(page.locator('.message--assistant')).toContainText('编辑后回答')
    expect(runBodies[0]).toMatchObject({
      prompt: '修改后的问题',
      userMessageContent: '修改后的问题',
      sourceUserMessageId: 'edit-user',
      clientUserMessageId: 'edit-user',
    })

    await page.locator('.message--user').hover()
    await page.getByRole('button', { name: '重试' }).click()
    await expect.poll(() => runBodies.length).toBe(2)
    expect(runBodies.at(-1)).toMatchObject({
      prompt: '修改后的问题',
      sourceUserMessageId: 'edit-user',
    })
    expect(runBodies.at(-1).clientAssistantMessageId).not.toBe(runBodies[0].clientAssistantMessageId)
  })

  test('regenerates the latest reply and exposes functional more actions', async ({ page }) => {
    let retryBody = null
    let deletedUrl = ''
    const conversations = [{
      id: 'actions-conversation',
      title: '操作测试',
      messages: [
        message('actions-user', 'user', '再回答一次'),
        message('actions-assistant', 'assistant', '第一版回答', { model: 'chat-pro', requestedMode: 'chat' }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      retryBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(retryBody, '重新生成的回答'), 201)
    })
    await page.route('**/api/v1/assistant/messages/**', async (route) => {
      deletedUrl = route.request().url()
      await fulfillJson(route, {})
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: '重新生成' }).click()
    await expect(page.locator('.message--assistant')).toContainText('重新生成的回答')
    expect(retryBody).toMatchObject({ sourceUserMessageId: 'actions-user' })
    expect(retryBody.clientAssistantMessageId).not.toBe('actions-assistant')
    expect(retryBody.clientAssistantMessageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(retryBody.idempotencyKey).toBe(retryBody.clientAssistantMessageId)

    await page.getByRole('button', { name: '更多操作' }).click()
    await expect(page.locator('.message-more-menu')).toBeVisible()
    await expect(page.locator('.message-more-menu')).toContainText('下载 Markdown')
    await page.locator('.message-more-menu').getByRole('button', { name: '删除' }).click()
    await expect(page.locator('.message--assistant')).toHaveCount(0)
    expect(deletedUrl).toMatch(new RegExp(`/assistant/messages/${retryBody.clientAssistantMessageId}$`))
  })

  test('renders and executes an editable agent image proposal', async ({ page }) => {
    let runBody = null
    const proposal = {
      action: 'generate',
      prompt: '一张极简品牌主视觉',
      reason: '根据品牌信息生成主视觉。',
      planningSummary: '已整理图片生成方案。',
      model: 'image-pro',
      ratio: '16:9',
      resolution: '2K',
      count: 2,
      quality: 'medium',
      referenceImages: [{ id: 'proposal-ref', name: '参考图', dataUrl: '/sucai/home-intro-03.png', fileKey: 'uploads/proposal-ref.png' }],
    }
    const conversations = [{
      id: 'proposal-conversation',
      title: '方案测试',
      messages: [
        message('proposal-user', 'user', '帮我生成品牌主视觉'),
        message('proposal-assistant', 'assistant', '已整理方案', { kind: 'proposal', proposal }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.agent-proposal')).toContainText('图片生成方案')
    await page.locator('.agent-proposal-prompt-preview').click()
    await page.locator('.agent-proposal-prompt-dialog textarea').fill('修改后的横版品牌主视觉')
    await page.locator('.agent-proposal-prompt-dialog').getByRole('button', { name: '完成' }).click()
    await page.locator('.agent-proposal').getByLabel('生成数量').click()
    await page.locator('.agent-proposal-menu').getByRole('option', { name: '3 张' }).click()
    await page.getByRole('button', { name: '开始生成' }).click()
    await expect(page.locator('.message--user').last()).toContainText('执行这个创作方案')
    expect(runBody).toMatchObject({
      mode: 'image',
      prompt: '修改后的横版品牌主视觉',
      proposalSourceMessageId: 'proposal-assistant',
      model: 'image-pro',
      ratio: '16:9',
      resolution: '2K',
      count: 3,
      requestSize: '2048x1152',
      width: 2048,
      height: 1152,
    })
  })

  test('shows image failure recovery instead of an endless loading tile', async ({ page }) => {
    let imageRequests = 0
    const conversations = [{
      id: 'broken-image-conversation',
      title: '坏图测试',
      messages: [
        message('broken-user', 'user', '生成图片'),
        message('broken-assistant', 'assistant', '', { kind: 'image', images: [{ dataUrl: '/broken-assistant-image.png' }] }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/broken-assistant-image.png**', async (route) => {
      imageRequests += 1
      await route.fulfill({ status: 500, body: '' })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('图片加载失败')).toBeVisible()
    await page.getByRole('button', { name: '重新加载' }).click()
    await expect.poll(() => imageRequests).toBeGreaterThan(1)
  })

  test('keeps long-thread scrolling, collapsed sidebar preview, assets, and context clearing usable', async ({ page }) => {
    const messages = []
    for (let index = 0; index < 36; index += 1) {
      messages.push(message(`long-user-${index}`, 'user', `第 ${index + 1} 个问题`, { createdAt: `2026-08-11T08:${String(index).padStart(2, '0')}:00Z` }))
      messages.push(message(`long-assistant-${index}`, 'assistant', `第 ${index + 1} 个回答`, {
        images: index === 35 ? [{ dataUrl: '/sucai/home-intro-03.png', name: '会话资产' }] : [],
        context: index === 35 ? {
          estimatedInputTokens: 4200,
          inputBudgetTokens: 10000,
          usagePercent: 42,
          includedMessages: 64,
          compactedMessages: 8,
        } : undefined,
      }))
    }
    const conversations = [{ id: 'long-conversation', title: '长对话', messages }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/conversations/long-conversation/context-boundaries', (route) =>
      fulfillJson(route, message('context-boundary', 'system', '', { kind: 'context-divider' }), 201),
    )
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message--assistant')).toHaveCount(12)
    await expect(page.locator('.composer-context-row .assistant-context-meter')).toContainText('42%')
    await page.locator('.assistant-messages').evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
    await expect(page.getByRole('button', { name: '回到底部' })).toBeVisible()
    await page.getByRole('button', { name: '回到底部' }).click()
    await expect(page.getByRole('button', { name: '回到底部' })).toHaveCount(0)
    await expect(page.locator('.conversation-minimap')).toBeVisible()

    await page.getByRole('button', { name: '收起侧栏' }).click()
    await page.locator('[data-conversation-id="long-conversation"] .conversation-select').hover()
    await expect(page.locator('.assistant-conversation-peek')).toContainText('长对话')

    await page.getByRole('button', { name: '资产库' }).click()
    await page.locator('.asset-image-grid button').first().click()
    await expect(page.locator('.reference-card')).toHaveCount(1)
    await page.getByRole('button', { name: '关闭资产库' }).click()
    await page.getByRole('button', { name: '清除上文并保留可见历史' }).click()
    await expect(page.getByText('已从这里开始新的上下文')).toBeVisible()
    await expect(page.locator('.composer-context-row .assistant-context-meter')).toContainText('--')
  })

  test('searches current conversation history from the thread topbar', async ({ page }) => {
    const conversations = [{
      id: 'search-conversation',
      title: '用三句话介绍你能帮我做什么',
      messages: [
        message('search-user-1', 'user', '用三句话介绍你能帮我做什么'),
        message('search-assistant-1', 'assistant', '我可以帮你写文案、生成图片，并整理创作思路。'),
        message('search-user-2', 'user', '再给一个品牌口号'),
        message('search-assistant-2', 'assistant', '星空云绘，把想象画成可见的作品。'),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.active-conversation-title')).toHaveCount(0)
    const search = page.getByLabel('搜索对话历史')
    await search.fill('品牌口号')
    await expect(page.locator('.thread-search-count')).toContainText('1')
    await expect(page.locator('.message.is-search-current')).toContainText('再给一个品牌口号')

    await search.fill('你')
    await expect(page.locator('.thread-search-count')).toContainText('2')
    await expect(page.locator('.message.is-search-current')).toContainText('用三句话介绍你能帮我做什么')
    await page.getByRole('button', { name: '下一条匹配' }).click()
    await expect(page.locator('.message.is-search-current')).toContainText('我可以帮你写文案')
    await page.getByRole('button', { name: '上一条匹配' }).click()
    await expect(page.locator('.message.is-search-current')).toContainText('用三句话介绍你能帮我做什么')
  })

  test('all-assets tab includes personal library images', async ({ page }) => {
    const conversations = [{
      id: 'asset-conversation',
      title: '资产对话',
      messages: [
        message('asset-user', 'user', '生成图片'),
        message('asset-assistant', 'assistant', '', { images: [{ dataUrl: '/sucai/home-intro-03.png', name: '会话资产' }] }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/me/assets**', (route) =>
      fulfillJson(route, {
        items: [{
          id: 'library-asset-1',
          title: '素材库封面',
          url: '/api/v1/files/library-original.png',
          thumbnailUrl: '/sucai/home-intro-01.png',
        }],
        nextCursor: null,
      }),
    )
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '资产库' }).click()
    await expect(page.getByRole('tab', { name: '全部资产' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.asset-image-grid button')).toHaveCount(2)
    await expect(page.locator('.asset-image-grid button').first()).toHaveAttribute('title', '添加 素材库封面 到参考图')
    await page.getByRole('tab', { name: '会话资产' }).click()
    await expect(page.locator('.asset-image-grid button')).toHaveCount(1)
    await expect(page.locator('.asset-image-grid button')).toHaveAttribute('title', '添加 会话资产 到参考图')
  })

  test('asset library lists conversation documents as file assets', async ({ page }) => {
    const conversations = [{
      id: 'file-asset-conversation',
      title: '文档资产',
      messages: [
        message('file-asset-user', 'user', '分析这份简报', {
          attachments: [{
            id: 'brief-pdf',
            name: '产品简报.pdf',
            contentType: 'application/pdf',
            sizeBytes: 4096,
            status: 'ready',
            pageCount: 3,
          }],
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '资产库' }).click()
    await page.getByRole('tab', { name: '文件' }).click()
    await expect(page.locator('.asset-library-footer')).toContainText('1 个文件资产')
    await page.locator('.asset-file-row').click()
    await expect(page.locator('.reference-document-card')).toContainText('产品简报.pdf')
    await expect(page.locator('.asset-file-row')).toHaveAttribute('aria-pressed', 'true')
  })

  test('asset library lists generated output files for download', async ({ page }) => {
    const conversations = [{
      id: 'output-asset-conversation',
      title: '输出文件',
      messages: [
        message('output-asset-user', 'user', '导出一份说明'),
        message('output-asset-assistant', 'assistant', '已生成说明文档。', {
          artifacts: [{
            id: 'brief-md',
            name: '产品说明.md',
            format: 'md',
            contentType: 'text/markdown',
            sizeBytes: 2048,
            downloadUrl: '/api/v1/files/uploads/user/original/brief.md?download=1&name=产品说明.md',
          }],
        }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('link', { name: '产品说明.md' })).toBeVisible()
    await page.getByRole('button', { name: '资产库' }).click()
    await page.getByRole('tab', { name: '文件' }).click()
    await expect(page.locator('.asset-library-footer')).toContainText('1 个文件资产')
    await expect(page.locator('.asset-file-row')).toContainText('产品说明.md')
    await expect(page.locator('.asset-file-row')).toContainText('输出')
    await expect(page.locator('.asset-file-row')).toHaveAttribute('title', '下载 产品说明.md')
  })

  test('asset library can add multiple nested file-key images', async ({ page }) => {
    const conversations = [{
      id: 'multi-asset-conversation',
      title: '多图资产',
      messages: [message('multi-asset-user', 'user', '添加参考图')],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/config', (route) =>
      fulfillJson(route, {
        ...assistantConfig,
        imageModels: assistantConfig.imageModels.map((item) => ({ ...item, maxReferenceImages: 6 })),
      }),
    )
    await page.route('**/api/v1/me/assets**', (route) =>
      fulfillJson(route, {
        items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => ({
          id: `library-asset-${id}`,
          title: `封面${index + 1}`,
          url: `/api/v1/files/uploads/user/original/${id}.png`,
          thumbnailUrl: `/sucai/home-intro-0${(index % 3) + 1}.png`,
        })),
        nextCursor: null,
      }),
    )
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '资产库' }).click()
    await page.locator('.asset-image-grid button').nth(0).click()
    await page.locator('.asset-image-grid button').nth(1).click()
    await expect(page.locator('.reference-card')).toHaveCount(2)
    await expect(page.locator('.asset-image-grid button').nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.asset-image-grid button').nth(1)).toHaveAttribute('aria-pressed', 'true')
    for (let index = 2; index < 6; index += 1) {
      await page.locator('.asset-image-grid button').nth(index).click()
    }
    await expect(page.locator('.reference-card')).toHaveCount(6)
    await expect(page.locator('.asset-limit-notice')).toHaveCount(0)
    await page.locator('.asset-image-grid button').nth(6).click()
    await expect(page.locator('.reference-card')).toHaveCount(6)
    await expect(page.locator('.app-toast.is-warning')).toContainText('最多 6 张')
    await page.locator('.asset-image-grid button').nth(0).click()
    await expect(page.locator('.reference-card')).toHaveCount(5)
    await expect(page.locator('.asset-image-grid button').nth(0)).toHaveAttribute('aria-pressed', 'false')
  })

  test('keeps runs isolated when two conversations generate concurrently', async ({ page }) => {
    const postBodies = []
    const conversations = [
      { id: 'parallel-one', title: '并发对话一', messages: [message('parallel-one-old', 'user', '对话一旧消息')] },
      { id: 'parallel-two', title: '并发对话二', messages: [message('parallel-two-old', 'user', '对话二旧消息')] },
    ]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/runs**', async (route) => {
      const method = route.request().method()
      const url = new URL(route.request().url())
      if (method === 'POST' && url.pathname.endsWith('/assistant/runs')) {
        const body = route.request().postDataJSON()
        postBodies.push(body)
        await fulfillJson(route, {
          run: { id: `run-${body.conversationId}`, conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, status: 'running', stage: 'thinking', mode: body.mode },
          assistantMessage: message(body.clientAssistantMessageId, 'assistant', '', { status: 'running', pending: true }),
        }, 201)
        return
      }
      if (method === 'GET' && /\/assistant\/runs\/run-/.test(url.pathname)) {
        const conversationId = url.pathname.endsWith('parallel-one') ? 'parallel-one' : 'parallel-two'
        const body = postBodies.find((item) => item.conversationId === conversationId)
        await fulfillJson(route, {
          run: { id: `run-${conversationId}`, conversationId, assistantMessageId: body?.clientAssistantMessageId, status: 'running', stage: 'thinking', mode: 'agent' },
          assistantMessage: message(body?.clientAssistantMessageId, 'assistant', '', { status: 'running', pending: true }),
        })
        return
      }
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByLabel('消息输入').fill('对话一的新任务')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
    await page.locator('[data-conversation-id="parallel-two"] .conversation-select').click()
    await page.getByLabel('消息输入').fill('对话二的新任务')
    await page.getByRole('button', { name: '发送' }).click()

    await expect.poll(() => postBodies.length).toBe(2)
    await expect(page.locator('.conversation-run-indicator')).toHaveCount(2)
    expect(postBodies.map((item) => item.conversationId).sort()).toEqual(['parallel-one', 'parallel-two'])
  })

  test('renders SSE text immediately and then settles to the authoritative result', async ({ page }) => {
    await page.addInitScript(() => {
      window.EventSource = class FakeEventSource {
        constructor(url) {
          if (String(url).includes('/assistant/runs/')) {
            window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({
              content: 'SSE 增量回答',
              reasoning: '先拆开问题，再组织成可直接阅读的回答。',
              kind: 'chat',
              stage: 'answering',
              context: {
                policyVersion: 'assistant-context-v2',
                estimatedInputTokens: 3200,
                inputBudgetTokens: 7600,
                usagePercent: 42,
                includedMessages: 18,
                compactedMessages: 12,
                omittedMessages: 0,
              },
            }) }), 120)
          }
        }
        addEventListener() {}
        removeEventListener() {}
        close() {}
      }
    })
    let polls = 0
    let sseAssistantId = ''
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', (route) =>
      fulfillJson(route, { id: 'sse-conversation', title: '新对话', messages: [] }, 201),
    )
    await page.route('**/api/v1/assistant/runs**', async (route) => {
      const method = route.request().method()
      const url = new URL(route.request().url())
      if (method === 'POST' && url.pathname.endsWith('/assistant/runs')) {
        const body = route.request().postDataJSON()
        sseAssistantId = body.clientAssistantMessageId
        await fulfillJson(route, {
          run: { id: 'sse-run', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, status: 'running', stage: 'thinking', mode: 'agent' },
          assistantMessage: message(body.clientAssistantMessageId, 'assistant', '', { status: 'running', pending: true }),
        }, 201)
        return
      }
      if (method === 'GET' && url.pathname.endsWith('/sse-run')) {
        polls += 1
        const terminal = polls > 2
        await fulfillJson(route, {
          run: { id: 'sse-run', conversationId: 'sse-conversation', assistantMessageId: sseAssistantId, status: terminal ? 'succeeded' : 'running', stage: terminal ? 'complete' : 'answering', resolvedMode: 'chat' },
          assistantMessage: message(sseAssistantId, 'assistant', terminal ? '服务端最终回答' : '', {
            status: terminal ? 'complete' : 'running',
            pending: !terminal,
            reasoning: '先拆开问题，再组织成可直接阅读的回答。',
          }),
        })
        return
      }
      await fulfillJson(route, { runs: [] })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('测试流式回答')
    await page.getByRole('button', { name: '发送' }).click()

    await expect(page.locator('.message--assistant')).toContainText('SSE 增量回答')
    await expect(page.locator('.assistant-reasoning')).toContainText('正在思考')
    await expect(page.locator('.assistant-reasoning-body')).toContainText('先拆开问题，再组织成可直接阅读的回答。')
    await expect(page.locator('.composer-context-row .assistant-context-meter')).toContainText('42%')
    const topbarLayout = await page.locator('.assistant-topbar').evaluate((element) => {
      const boxes = [...element.children].map((child) => child.getBoundingClientRect())
      return boxes.map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom }))
    })
    expect(topbarLayout).toHaveLength(2)
    expect(topbarLayout[0].right).toBeLessThanOrEqual(topbarLayout[1].left + 1)
    expect(Math.max(...topbarLayout.map((box) => box.top)) - Math.min(...topbarLayout.map((box) => box.top))).toBeLessThan(20)
    await expect(page.locator('.message--assistant')).toContainText('服务端最终回答')
    await expect(page.locator('.assistant-reasoning')).toContainText('思考过程')
    await page.locator('.assistant-reasoning summary').click()
    await expect(page.locator('.assistant-reasoning-body')).toContainText('先拆开问题，再组织成可直接阅读的回答。')
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
    await page.locator('.message--assistant .message-status-toggle').click()
    await expect(page.locator('.message--assistant .message-context-stats')).toContainText('18 条近期消息')
    await expect(page.locator('.message--assistant .message-context-stats')).toContainText('12 条已压缩')
  })

  test('provides model search when the configured model list is long', async ({ page }) => {
    const models = Array.from({ length: 8 }, (_, index) => ({ model: `chat-${index + 1}`, label: `Chat Model ${index + 1}`, description: `模型 ${index + 1}`, pricePoints: index + 1 }))
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, { ...assistantConfig, conversationModels: models }))
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /Chat Model 1/ }).click()
    await page.getByPlaceholder('搜索模型名称').fill('Model 8')
    await expect(page.locator('.model-menu-options > button')).toHaveCount(1)
    await expect(page.locator('.model-menu-options')).toContainText('Chat Model 8')
  })

  test('restores and persists the scoped composer workspace state', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('starclouds-assistant-workspace:user:assistant-user', JSON.stringify({
        activeId: '',
        draft: '恢复的图片草稿',
        creationType: 'image',
        generationRatio: '16:9',
        generationModel: 'image-pro',
        generationResolution: '2K',
        generationCount: 3,
        customImageWidth: 2048,
        customImageHeight: 1152,
      }))
    })
    await mockAssistant(page)
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.getByLabel('消息输入')).toHaveValue('恢复的图片草稿')
    await expect(page.getByRole('button', { name: /图片生成/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Image Pro/ })).toBeVisible()
    await expect(page.locator('.image-settings-button')).toContainText('16:9 | 2K | 3')

    await page.getByLabel('消息输入').fill('新的持久化草稿')
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('starclouds-assistant-workspace:user:assistant-user') || '{}').draft)).toBe('新的持久化草稿')
  })

  test('infers the recent visual context and image count from the prompt', async ({ page }) => {
    let runBody = null
    const recentImage = { id: 'recent-image', name: '最近生成图', dataUrl: '/sucai/home-intro-03.png', fileKey: 'tasks/recent-image.png' }
    const conversations = [{
      id: 'visual-context-conversation',
      title: '视觉上下文',
      messages: [
        message('visual-old-user', 'user', '生成一张商品图'),
        message('visual-old-assistant', 'assistant', '', { kind: 'image', images: [recentImage] }),
      ],
    }]
    await mockAssistant(page, { conversations })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { runs: [] })
        return
      }
      runBody = route.request().postDataJSON()
      await fulfillJson(route, succeededRun(runBody), 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: 'Agent 模式' }).click()
    await page.getByLabel('消息输入').fill('把这张图的背景改成白色，生成3张')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.locator('.message--assistant').last()).toContainText('已完成你的创作请求。')
    expect(runBody.count).toBe(3)
    expect(runBody.mode).toBe('agent')
    expect(runBody.referenceImages).toEqual([{
      name: '最近生成图',
      dataUrl: '/sucai/home-intro-03.png',
      fileKey: 'tasks/recent-image.png',
    }])
  })

  test('migrates legacy local conversations into cloud history once', async ({ page }) => {
    let imported = null
    let didImport = false
    const legacyConversation = {
      id: 'legacy-conversation',
      title: '旧本地对话',
      messages: [message('legacy-user', 'user', '需要迁移的旧内容')],
    }
    await page.addInitScript((conversation) => {
      localStorage.setItem('starclouds-assistant:user:assistant-user', JSON.stringify([conversation]))
    }, legacyConversation)
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations', async (route) => {
      await fulfillJson(route, { conversations: didImport ? [legacyConversation] : [] })
    })
    await page.route('**/api/v1/assistant/conversation-imports', async (route) => {
      imported = route.request().postDataJSON()
      didImport = true
      await fulfillJson(route, { imported: 1 }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.message--user')).toContainText('需要迁移的旧内容')
    await expect.poll(() => imported).not.toBeNull()
    expect(imported).toMatchObject({ conversations: [legacyConversation] })
    expect(await page.evaluate(() => localStorage.getItem('starclouds-assistant:user:assistant-user'))).toBeNull()
  })
})
