import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const project = { id: '4d193d5b-6bd4-4261-bceb-0f41b96c6d3b', title: '精确尺寸验证', revision: 1, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z' }
const exactModel = { id: 'exact-image', label: '精确尺寸模型', default: true, pricePoints: 2, supportsExactSize: true, exactSizeLimits: { minWidth: 256, maxWidth: 4096, minHeight: 256, maxHeight: 4096, step: 1 } }
const exactSettings = { model: 'starclouds::exact-image', size: '1:1', resolution: '1K', sizeMode: 'exact', exactWidth: '997', exactHeight: '613', quality: 'medium', count: 1 }

async function mockCanvas(page, { imageModel = exactModel } = {}) {
  await installVisualBaseline(page)
  // Canvas source modules also include /api/ in their path; serve those as modules.
  await page.route('**/src/**', route => route.continue())
  await page.addInitScript(() => {
    localStorage.removeItem('infinite-canvas:canvas_store')
    localStorage.removeItem('infinite-canvas:ai_config_store')
    indexedDB.deleteDatabase('infinite-canvas')
  })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'exact-user', email: 'exact@example.com', username: '画布测试' } }))
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, {
    features: { 'ai.infiniteCanvas': { enabled: true, config: { imageModels: [imageModel, { id: 'ratio-image', label: '比例尺寸模型', pricePoints: 2 }], textModels: [] } } },
  }))
  let document = { version: 3, nodes: [
    { id: 'exact-config', type: 'config', title: '图片配置', position: { x: 380, y: 140 }, width: 360, height: 414, metadata: { ...exactSettings, sizeMode: 'ratio', exactWidth: '', exactHeight: '', generationMode: 'image', composerContent: '一颗安静的星球' } },
    { id: 'exact-output', type: 'image', title: '生成结果', position: { x: 820, y: 140 }, width: 360, height: 300, metadata: {} },
  ], connections: [{ id: 'output-link', fromNodeId: 'exact-config', toNodeId: 'exact-output' }], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }
  let revision = 1
  await page.route('**/api/v1/canvas-projects', route => fulfillJson(route, { items: [project] }))
  await page.route(`**/api/v1/canvas-projects/${project.id}`, route => {
    if (route.request().method() === 'PATCH') {
      document = route.request().postDataJSON().document
      revision += 1
    }
    return fulfillJson(route, { ...project, revision, document })
  })
  return { document: () => document }
}

test('canvas exposes exact inputs by model, saves the values and clears them when switching to a ratio model', async ({ page }, testInfo) => {
  const state = await mockCanvas(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${project.id}`)
  const panel = page.locator('[data-node-id="exact-config"] .canvas-config-node')
  await panel.getByRole('button', { name: '精确宽高', exact: true }).click()
  const width = panel.getByRole('spinbutton', { name: '宽度（px）', exact: true })
  const height = panel.getByRole('spinbutton', { name: '高度（px）', exact: true })
  await width.fill('997')
  await height.fill('613')
  await expect(width).toHaveValue('997')
  await expect(height).toHaveValue('613')
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => state.document().nodes.find(node => node.id === 'exact-config').metadata.exactHeight).toBe('613')
  const panelBounds = await panel.boundingBox()
  const heightBounds = await height.boundingBox()
  expect(heightBounds.y + heightBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height)
  await page.screenshot({ path: testInfo.outputPath('canvas-exact-size.png') })
  await page.reload()
  await expect(width).toHaveValue('997')
  await expect(height).toHaveValue('613')
  await width.fill('50000')
  await expect(panel.getByRole('alert')).toContainText('宽度需在')
  await panel.getByRole('button', { name: /精确尺寸模型/ }).click()
  await page.locator('.canvas-anchor-popover').getByRole('button', { name: /比例尺寸模型/ }).click()
  await expect(width).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '精确宽高', exact: true })).toHaveCount(0)
  await expect.poll(() => state.document().nodes.find(node => node.id === 'exact-config').metadata.sizeMode).toBe('ratio')
  expect(state.document().nodes.find(node => node.id === 'exact-config').metadata).toMatchObject({ exactWidth: '', exactHeight: '' })
})

test('exact dimension inputs align native steps when the configured minimum is not a multiple', async ({ page }) => {
  await mockCanvas(page, { imageModel: { ...exactModel, exactSizeLimits: { minWidth: 700, maxWidth: 1000, minHeight: 700, maxHeight: 1000, step: 64 } } })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/canvas/${project.id}`)
  const panel = page.locator('[data-node-id="exact-config"] .canvas-config-node')
  await panel.getByRole('button', { name: '精确宽高', exact: true }).click()
  const width = panel.getByRole('spinbutton', { name: '宽度（px）', exact: true })
  const height = panel.getByRole('spinbutton', { name: '高度（px）', exact: true })
  await width.fill('896')
  await height.fill('896')
  for (const input of [width, height]) {
    await expect(input).toHaveAttribute('min', '704')
    await expect(input).toHaveAttribute('max', '960')
    expect(await input.evaluate(element => element.validity.valid)).toBe(true)
  }
  await width.press('ArrowUp')
  await expect(width).toHaveValue('960')
  await width.press('ArrowUp')
  await expect(width).toHaveValue('960')
  await width.press('ArrowDown')
  await expect(width).toHaveValue('896')
  await width.fill('900')
  await height.click()
  await expect(width).toHaveValue('900')
  expect(await width.evaluate(element => element.validity.stepMismatch)).toBe(true)
  await expect(panel.getByRole('alert')).toContainText('64 px 的整数倍')
})

test('generation, editing and workflow requests preserve exact pixels and reject invalid sizes before submission', async ({ page }) => {
  await mockCanvas(page)
  const requests = []
  await page.route('**/api/v1/tasks', route => {
    if (route.request().method() !== 'POST') return fulfillJson(route, { items: [] })
    requests.push(route.request().postDataJSON())
    return fulfillJson(route, { id: `size-task-${requests.length}`, status: 'queued' })
  })
  await page.route('**/api/v1/tasks/size-task-*', route => fulfillJson(route, { id: 'completed-size-task', status: 'succeeded', outputKeys: ['generated/exact.png'], outputUrls: [] }))
  await page.route('**/api/v1/tasks/*/events', route => route.fulfill({ status: 204 }))
  await page.goto('/canvas')
  const result = await page.evaluate(async (settings) => {
    const { fetchSiteModelCatalog } = await import('/src/canvas/services/site-model-catalog.ts')
    const { defaultConfig } = await import('/src/canvas/stores/use-config-store.ts')
    const { requestGeneration, requestEdit } = await import('/src/canvas/services/api/image.ts')
    const { buildGenerationConfig } = await import('/src/canvas/lib/canvas/canvas-generation-helpers.ts')
    const catalog = await fetchSiteModelCatalog()
    const config = { ...defaultConfig, ...settings, count: '1', imageModel: settings.model, channels: [catalog.channel] }
    await requestGeneration(config, '独立生图')
    await requestEdit(config, '参考图编辑', [{ id: 'reference', name: 'reference.png', type: 'image/png', dataUrl: '', storageKey: 'uploads/reference.png' }])
    await requestGeneration(buildGenerationConfig({ ...config, sizeMode: 'ratio', exactWidth: '', exactHeight: '' }, { metadata: settings }, 'image'), '工作流图片节点')
    await requestGeneration({ ...config, sizeMode: 'ratio' }, '旧比例模式')
    let error = ''
    try { await requestGeneration({ ...config, exactWidth: '50000' }, '不应提交') } catch (failure) { error = failure.message }
    return { error, capability: catalog.channel.models.find(model => model.name === 'exact-image') }
  }, exactSettings)
  expect(requests).toHaveLength(4)
  for (const request of requests.slice(0, 3)) {
    expect(request.params).toMatchObject({ sizeMode: 'exact', exactWidth: 997, exactHeight: 613, size: '997x613', outputSize: '997x613' })
    expect(request.params).not.toHaveProperty('aspectRatio')
    expect(request.params).not.toHaveProperty('resolutionScale')
  }
  expect(requests[1].inputKeys).toEqual(['uploads/reference.png'])
  expect(requests[3].params).toMatchObject({ aspectRatio: '1:1', resolutionScale: '1K', size: '1024x1024' })
  expect(requests[3].params).not.toHaveProperty('sizeMode')
  expect(requests[3].params).not.toHaveProperty('exactWidth')
  expect(result.error).toContain('宽度需在')
  expect(result.capability).toMatchObject({ supportsExactSize: true, exactSizeLimits: { step: 1, maxWidth: 4096 } })
})

test('unavailable exact models stop generation and replay without replacing the saved pixels', async ({ page }) => {
  await mockCanvas(page)
  const requests = []
  await page.route('**/api/v1/tasks', route => {
    if (route.request().method() === 'POST') requests.push(route.request().postDataJSON())
    return fulfillJson(route, {}, 422)
  })
  await page.goto('/canvas')
  const results = await page.evaluate(async (settings) => {
    const { fetchSiteModelCatalog } = await import('/src/canvas/services/site-model-catalog.ts')
    const { defaultConfig, modelOptionMeta, useConfigStore } = await import('/src/canvas/stores/use-config-store.ts')
    const { requestGeneration, requestEdit } = await import('/src/canvas/services/api/image.ts')
    const { buildGenerationConfig } = await import('/src/canvas/lib/canvas/canvas-generation-helpers.ts')
    const { applyCanvasImageModelSettings } = await import('/src/canvas/lib/canvas/canvas-image-model.ts')
    const { compileCanvasWorkflow } = await import('/src/canvas/lib/canvas/canvas-workflow.ts')
    const { preflightCanvasWorkflow } = await import('/src/canvas/lib/canvas/canvas-workflow-preflight.ts')
    const { registerBuiltinNodes } = await import('/src/canvas/components/canvas/nodes/builtin-nodes.tsx')
    registerBuiltinNodes()
    const catalog = await fetchSiteModelCatalog()
    const exact = catalog.channel.models.find(model => model.name === 'exact-image')
    const fallback = catalog.channel.models.find(model => model.name === 'ratio-image')
    const results = []
    for (const state of ['maintenance', 'missing']) {
      const channel = { ...catalog.channel, models: state === 'missing' ? [fallback] : [{ ...exact, status: 'maintenance', maintenance: true }, fallback] }
      const globalConfig = { ...defaultConfig, channels: [channel], imageModel: 'starclouds::ratio-image', model: 'starclouds::ratio-image' }
      const node = { id: 'saved-config', type: 'config', title: '已保存配置', position: { x: 0, y: 0 }, width: 360, height: 414, metadata: { ...settings, generationMode: 'image', composerContent: '一颗星球' } }
      const output = { id: 'saved-output', type: 'image', title: '输出', position: { x: 500, y: 0 }, width: 360, height: 300, metadata: {} }
      const connections = [{ id: 'saved-connection', fromNodeId: node.id, toNodeId: output.id }]
      const before = JSON.stringify(node.metadata)
      const generation = buildGenerationConfig(globalConfig, node, 'image')
      const retry = applyCanvasImageModelSettings({ ...globalConfig, ...settings, count: '1' }, modelOptionMeta(globalConfig, settings.model))
      const errors = []
      try { await requestGeneration(generation, '继续生成') } catch (error) { errors.push(error.message) }
      try { await requestEdit(retry, '重试编辑', []) } catch (error) { errors.push(error.message) }
      const compiled = compileCanvasWorkflow([node, output], connections)
      const preflight = preflightCanvasWorkflow({ plan: compiled.plan, nodes: [node, output], connections, effectiveConfig: globalConfig, isConfigReady: () => true })
      useConfigStore.setState({ config: { ...generation, imageModel: settings.model } })
      useConfigStore.getState().installSiteCatalog(channel, { image: fallback.name })
      const refreshed = useConfigStore.getState().config
      results.push({ state, errors, generation, retry, refreshed, preflight, unchanged: before === JSON.stringify(node.metadata) })
    }
    return results
  }, exactSettings)
  expect(requests).toHaveLength(0)
  for (const result of results) {
    expect(result.errors).toEqual(['所选精确尺寸模型暂不可用，请重新选择模型', '所选精确尺寸模型暂不可用，请重新选择模型'])
    for (const config of [result.generation, result.retry, result.refreshed]) {
      expect(config).toMatchObject({ model: 'starclouds::exact-image', sizeMode: 'exact', exactWidth: '997', exactHeight: '613' })
    }
    expect(result.preflight).toMatchObject({ ok: false, errorMessage: '所选精确尺寸模型暂不可用，请重新选择模型' })
    expect(result.unchanged).toBe(true)
  }
})

test('node replay, workflow signatures and Agent plans retain exact settings independently from ratio defaults', async ({ page }) => {
  await mockCanvas(page)
  await page.goto('/canvas')
  const result = await page.evaluate(async (settings) => {
    const { fetchSiteModelCatalog } = await import('/src/canvas/services/site-model-catalog.ts')
    const { defaultConfig, migrateConfigStore, useConfigStore } = await import('/src/canvas/stores/use-config-store.ts')
    const { buildGenerationConfig } = await import('/src/canvas/lib/canvas/canvas-generation-helpers.ts')
    const { buildImageGenerationMetadata } = await import('/src/canvas/lib/canvas/canvas-node-factory.ts')
    const { canvasImageSizeParams } = await import('/src/canvas/lib/canvas/canvas-image-model.ts')
    const { compileCanvasWorkflow } = await import('/src/canvas/lib/canvas/canvas-workflow.ts')
    const { preflightCanvasWorkflow } = await import('/src/canvas/lib/canvas/canvas-workflow-preflight.ts')
    const { applyCanvasAgentOps } = await import('/src/canvas/lib/canvas/canvas-agent-ops.ts')
    const { compactCanvasSnapshot } = await import('/src/canvas/lib/canvas/canvas-hosted-agent.ts')
    const { registerBuiltinNodes } = await import('/src/canvas/components/canvas/nodes/builtin-nodes.tsx')
    registerBuiltinNodes()
    const catalog = await fetchSiteModelCatalog()
    const config = { ...defaultConfig, ...settings, count: '1', imageModel: settings.model, channels: [catalog.channel] }
    const saved = buildImageGenerationMetadata('edit', config, 1, [])
    const replay = buildGenerationConfig({ ...config, sizeMode: 'ratio', exactWidth: '', exactHeight: '' }, { metadata: saved }, 'image')
    const legacy = buildGenerationConfig(config, { metadata: { size: '3:2', resolution: '2K' } }, 'image')
    const blank = { projectId: 'test', title: 'test', nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }
    const graph = applyCanvasAgentOps(blank, [{ type: 'create_graph', nodes: [{ key: 'config', type: 'config', composerContent: '星空', ...settings }, { key: 'output', type: 'image' }], edges: [{ from: 'config', to: 'output' }] }])
    const node = graph.nodes.find(node => node.type === 'config')
    const plan = compileCanvasWorkflow(graph.nodes, graph.connections)
    const changed = compileCanvasWorkflow(graph.nodes.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, exactWidth: '998' } } : item), graph.connections)
    const invalidNodes = graph.nodes.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, exactWidth: '50000' } } : item)
    const preflight = preflightCanvasWorkflow({ plan: plan.plan, nodes: invalidNodes, connections: graph.connections, effectiveConfig: config, isConfigReady: () => true })
    useConfigStore.setState({ config })
    useConfigStore.getState().updateConfig('model', 'starclouds::ratio-image')
    const switched = useConfigStore.getState().config
    return {
      saved, replay: canvasImageSizeParams(catalog.channel.models[0], replay), legacyMode: legacy.sizeMode,
      graphMetadata: node.metadata, snapshot: compactCanvasSnapshot(graph).nodes.find(item => item.id === node.id),
      signature: plan.plan.inputSignature, changedSignature: changed.plan.inputSignature, preflight,
      switched: { sizeMode: switched.sizeMode, exactWidth: switched.exactWidth, exactHeight: switched.exactHeight },
      migrated: migrateConfigStore({ config: { size: '16:9' } }, 2).config.sizeMode,
    }
  }, exactSettings)
  expect(result.saved).toMatchObject({ sizeMode: 'exact', exactWidth: '997', exactHeight: '613' })
  expect(result.replay).toMatchObject({ size: '997x613', sizeMode: 'exact', exactWidth: 997, exactHeight: 613 })
  expect(result.legacyMode).toBe('ratio')
  expect(result.graphMetadata).toMatchObject({ sizeMode: 'exact', exactWidth: '997', exactHeight: '613' })
  expect(result.snapshot).toMatchObject({ sizeMode: 'exact', exactWidth: '997', exactHeight: '613' })
  expect(result.signature).toBeTruthy()
  expect(result.changedSignature).not.toBe(result.signature)
  expect(result.preflight).toMatchObject({ ok: false, reason: 'invalid_image_size' })
  expect(result.switched).toEqual({ sizeMode: 'ratio', exactWidth: '', exactHeight: '' })
  expect(result.migrated).toBe('ratio')
})
