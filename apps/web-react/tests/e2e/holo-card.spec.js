import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { expect as playwrightExpect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const expect = playwrightExpect.configure({ timeout: Number(process.env.HOLO_E2E_WAIT_MS) || 8_000 })

const user = { id: 'holo-e2e-user', email: 'holo-e2e@example.com', username: 'Holo E2E' }
const model = {
  id: 'gpt-image-2-fine', label: 'image2 Fine', status: 'available',
  transparentBackground: true, outputFormats: ['png'], qualities: ['high'],
  maxReferenceImages: 1, resolutions: ['2K', '4K'], aspectRatios: ['3:4', '1:1'],
}
const sourceUrl = '/api/v1/files/uploads/holo/source.png'
const subjectUrl = '/api/v1/files/generated/holo/subject.png'
const imageWidth = 1024
const imageHeight = 1280

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, content) {
  const body = Buffer.concat([Buffer.from(type), content])
  const chunk = Buffer.alloc(body.length + 8)
  chunk.writeUInt32BE(content.length)
  body.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(body), chunk.length - 4)
  return chunk
}

// These deterministic RGBA assets exercise actual browser decoding and alpha pixels.
function makePng(kind, width = imageWidth, height = imageHeight) {
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4
      const distance = Math.hypot((x - width * 0.5) / (width * 0.3), (y - height * 0.5) / (height * 0.4))
      const stripe = Math.floor((x + y) / 45) % 2
      const checker = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 ? 205 : 245
      rows[offset] = kind === 'checker' ? checker : stripe ? 228 : 42
      rows[offset + 1] = kind === 'checker' ? checker : Math.round(80 + y / height * 130)
      rows[offset + 2] = kind === 'checker' ? checker : stripe ? 58 : 210
      rows[offset + 3] = kind === 'empty' ? 0 : kind === 'transparent'
        ? Math.round(Math.max(0, Math.min(1, (1 - distance) * 70)) * 255) : 255
      if (kind === 'white' || kind.startsWith('lineart')) {
        const ink = kind !== 'white' && distance < 0.95 && (Math.abs(distance - 0.7) < 0.018
          || Math.abs(x - width * 0.5) < width * 0.009 || Math.abs(y - height * 0.5) < height * 0.007)
        rows[offset] = rows[offset + 1] = rows[offset + 2] = ink ? 0 : 255
        rows[offset + 3] = kind === 'lineart-transparent' && !ink ? 0 : 255
      }
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const sourcePng = makePng('opaque')
const subjectPng = makePng('transparent')
const checkerPng = makePng('checker')
const lineartPng = makePng('lineart-white')
const transparentLineartPng = makePng('lineart-transparent')

function completedTask(overrides = {}) {
  return {
    id: 'holo-created-1', type: 't2i', status: 'succeeded',
    params: { _source: 'holo_card', _kind: 'holo-card-subject', publicModelKey: model.id,
      sourceName: 'holo-source.png', sourceUrl },
    inputKeys: ['uploads/holo/source.png'],
    originalUrls: [subjectUrl], outputUrls: [subjectUrl],
    createdAt: '2026-08-11T04:00:00Z', finishedAt: '2026-08-11T04:00:05Z',
    ...overrides,
  }
}

async function installHoloMocks(page, { signedIn = true, output = subjectPng, history = [], models = [model], failure = '', serviceFailure = false } = {}) {
  await installVisualBaseline(page)
  // Keep dates deterministic while allowing GSAP's Date-based ticker to advance.
  await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
  await page.addInitScript(() => {
    // The production renderer discards its WebGL buffer after presentation.
    // Preserve the identical rendered pixels in this harness so canvas reads
    // can exclude animated DOM lighting and overlapping editor controls.
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, options, ...args) {
      return getContext.call(this, kind, /^webgl/.test(kind) ? { ...options, preserveDrawingBuffer: true } : options, ...args)
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const calls = { quotes: [], uploads: [], created: [], removals: [], reads: [], records: [...history], configReads: 0 }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|WebGL|shader|GLSL/i.test(message.text())) errors.push(message.text())
  })
  page.on('request', request => {
    if (/background[-_]remove|remove[-_]background|background-removal/i.test(request.url())) calls.removals.push(request.url())
  })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: signedIn ? user : null }))
  await page.route('**/api/v1/runtime-config', route => {
    calls.configReads++
    return serviceFailure ? fulfillJson(route, { error: 'Model service unavailable' }, 500) : fulfillJson(route, {
      routes: {}, blacklist: { blocked: false },
      features: { 'ai.wallpaperGeneration': { enabled: true, config: { publicModels: models } } },
    })
  })
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { availableCents: 1000, balanceCents: 1000 }))
  await page.route('**/api/v1/uploads', route => {
    calls.uploads.push(route.request())
    return fulfillJson(route, { key: 'uploads/holo/source.png', url: sourceUrl })
  })
  await page.route('**/api/v1/tasks**', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/quote')) {
      calls.quotes.push(request.postDataJSON())
      return fulfillJson(route, { unitPriceCents: 12, totalPriceCents: 12, count: 1 })
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      calls.created.push(body)
      const taskFailure = Array.isArray(failure) ? failure[calls.created.length - 1] : failure
      const task = completedTask({
        id: `holo-created-${calls.created.length}`,
        params: body.params,
        ...(taskFailure ? { status: 'failed', errorMessage: taskFailure, originalUrls: [], outputUrls: [] } : {}),
      })
      calls.records.push(task)
      return fulfillJson(route, { task: { ...task, status: 'queued' } })
    }
    calls.reads.push(url)
    const id = url.pathname.split('/').at(-1)
    if (id !== 'tasks') {
      return fulfillJson(route, { task: calls.records.find(record => record.id === id) || completedTask() })
    }
    if (serviceFailure) return fulfillJson(route, { error: 'History service unavailable' }, 500)
    const ids = url.searchParams.get('ids')?.split(',')
    return fulfillJson(route, { items: ids ? calls.records.filter(record => ids.includes(record.id)) : calls.records, nextCursor: null })
  })
  await page.route(`**${sourceUrl}`, route => route.fulfill({ contentType: 'image/png', body: sourcePng }))
  await page.route(`**${subjectUrl}`, route => route.fulfill({ contentType: 'image/png', body: output }))
  return { calls, errors }
}

async function chooseSource(page) {
  const upload = page.getByRole('button', { name: '选择图片', exact: true })
  await expect(upload).toBeEnabled()
  const choosing = page.waitForEvent('filechooser')
  await upload.click()
  await (await choosing).setFiles({ name: 'holo-source.png', mimeType: 'image/png', buffer: sourcePng })
  await expect(page.locator('.holo-upload')).toContainText('holo-source.png')
  await expect(page.locator('.holo-status')).toHaveText('版式已就绪 · 待分离主体')
}

async function openPanel(page, name) {
  const triggerName = { 设计: '设计面板', 图层: '图层面板', 记录: '生成记录' }[name]
  const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
  if (!await editor.isVisible()) await page.getByRole('button', { name: triggerName, exact: true }).click()
  await expect(editor).toBeVisible()
  const tab = page.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name, exact: true })
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  return page.getByRole('tabpanel', { name, exact: true })
}

async function closePanel(page) {
  const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
  if (await editor.isVisible()) await page.getByRole('button', { name: '关闭编辑面板', exact: true }).click()
  await expect(editor).toBeHidden()
}

async function openDetails(page, title) {
  const details = page.locator('.holo-details').filter({ has: page.locator('summary').filter({ hasText: title }) })
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click()
  await expect(details).toHaveAttribute('open', '')
  return details
}

async function readyCanvas(page) {
  await expect(page.locator('[data-holo-state], [data-sample-state]')).toHaveCount(1)
  const sample = page.locator('.sample-relief-stage')
  if (await sample.count()) {
    await expect(sample).toHaveAttribute('data-sample-state', 'ready')
    const canvas = sample.locator('canvas')
    await expect(canvas).toHaveCSS('transform', 'none')
    await expect(canvas).toHaveCSS('opacity', '1')
    return canvas
  }
  const preview = page.getByRole('group', { name: /^立体镭射闪卡预览/ })
  await expect(preview).toHaveAttribute('data-holo-state', 'ready')
  const canvas = preview.locator('canvas')
  await expect(canvas).toHaveCSS('transform', 'none')
  await expect(canvas).toHaveCSS('opacity', '1')
  return canvas
}

async function generateSubject(page) {
  await openPanel(page, '图层')
  await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
  await page.getByRole('alertdialog', { name: '确认生成透明主体？' })
    .getByRole('button', { name: '确认生成', exact: true }).click()
}

async function importSubject(page, name = 'verified-subject.png') {
  await openPanel(page, '图层')
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入透明 PNG', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: subjectPng })
  await expect(page.getByAltText('待验收透明主体')).toBeVisible()
  await page.getByRole('button', { name: '采用此图层', exact: true }).click()
  await expect(page.locator('#holo-tab-design')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('dialog', { name: '闪卡编辑', exact: true })).toBeHidden()
  await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
  return readyCanvas(page)
}

async function downloadedSubject(page) {
  await openPanel(page, '图层')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原始透明 PNG', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('image2-subject.png')
  expect(await download.failure()).toBeNull()
  return downloadBytes(download)
}

async function downloadBytes(download) {
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function imageHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function keepArtifact(testInfo, name, body, contentType) {
  const path = testInfo.outputPath(name)
  await writeFile(path, body)
  await testInfo.attach(name, { path, contentType })
}

async function stableCanvasImage(canvas) {
  let previous = ''
  let equalFrames = 0
  let image
  await expect.poll(async () => {
    // Read the card's actual RGBA buffer: the animated atmosphere behind its
    // transparent margin must not influence material or motion comparisons.
    image = Buffer.from((await canvas.evaluate(element => element.toDataURL('image/png'))).split(',')[1], 'base64')
    const hash = imageHash(image)
    equalFrames = hash === previous ? equalFrames + 1 : 0
    previous = hash
    return equalFrames
  }, { timeout: 6000, intervals: [120] }).toBeGreaterThanOrEqual(2)
  return image
}

async function assertPaintedCard(page, screenshot) {
  const stats = await page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const colors = new Set()
    let saturated = 0
    let samples = 0
    let warm = 0
    let cool = 0
    for (let index = 0; index < data.length; index += 4 * 16) {
      const [r, g, b] = data.subarray(index, index + 3)
      colors.add((r << 16) | (g << 8) | b)
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45) saturated++
      if (r - b > 60 && r - g > 20) warm++
      if (b - r > 60) cool++
      samples++
    }
    return { colors: colors.size, saturatedRatio: saturated / samples, warmRatio: warm / samples, coolRatio: cool / samples }
  }, screenshot.toString('base64'))
  expect(stats.colors).toBeGreaterThan(256)
  expect(stats.saturatedRatio).toBeGreaterThan(0.1)
  expect(stats.warmRatio).toBeGreaterThan(0.02)
  expect(stats.coolRatio).toBeGreaterThan(0.02)
  return stats
}

async function imagePixelDifference(page, before, after) {
  return page.evaluate(async ([first, second]) => {
    const decode = async source => {
      const image = new Image()
      image.src = `data:image/png;base64,${source}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height }
    }
    const left = await decode(first)
    const right = await decode(second)
    if (left.width !== right.width || left.height !== right.height) throw new Error('Canvas dimensions shifted')
    let changedPixels = 0
    let maxDelta = 0
    let totalDelta = 0
    for (let index = 0; index < left.data.length; index += 4) {
      const delta = Math.abs(left.data[index] - right.data[index])
        + Math.abs(left.data[index + 1] - right.data[index + 1])
        + Math.abs(left.data[index + 2] - right.data[index + 2])
      if (delta > 3) changedPixels++
      maxDelta = Math.max(maxDelta, delta)
      totalDelta += delta
    }
    const pixels = left.width * left.height
    return { changedPixels, changedRatio: changedPixels / pixels, maxDelta, meanDelta: totalDelta / pixels }
  }, [before.toString('base64'), after.toString('base64')])
}

async function installRendererHarness(page) {
  await page.route('**/__holo-renderer-test', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>html,body{margin:0;width:100%;height:100%;background:#f3f5f5}#stage{width:100%;height:100svh}</style>
      </head><body><div id="stage" role="group" aria-label="立体镭射闪卡预览"></div><script type="module">
      import { createHoloCardRenderer } from '/src/features/holo-card/holo-card-renderer.js';
      const host = document.getElementById('stage');
      try {
        const engine = createHoloCardRenderer(host, {
          onReady: ready => { host.dataset.holoState = ready ? 'ready' : 'loading'; },
          onError: message => { host.dataset.holoState = 'error'; host.dataset.holoError = message; },
        });
        window.__holoRenderer = engine;
        engine.setSettings({ title: 'FOIL TEST', subtitle: 'LOCAL / 001', foil: 'spectrum', foilStrength: 0.65,
          tilt: 0.75, depth: 0.5, background: '#174e4b', subjectScale: 1, backgroundDepth: -0.2, lineStrength: 0.4 });
        await engine.setImages({ sourceUrl: '${sourceUrl}', mode: 'original' });
      } catch (error) { host.dataset.holoState = 'error'; host.dataset.holoError = error.message; }
      </script></body></html>`,
  }))
}

test.describe('Holo card workflow', () => {
  test('immersive workbench keeps editing optional and restores focus from popovers and pure view', async ({ page }, testInfo) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    const canvas = await readyCanvas(page)
    const firstBounds = await canvas.boundingBox()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('slider')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '闪卡编辑', exact: true })).toBeHidden()
    await expect(page.getByRole('link', { name: '返回工具', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '样卡展厅', exact: true })).toBeVisible()
    for (const [triggerName, tabName] of [['设计面板', '设计'], ['图层面板', '图层'], ['生成记录', '记录']]) {
      const trigger = page.getByRole('button', { name: triggerName, exact: true })
      await trigger.click()
      const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
      await expect(editor).toBeVisible()
      await expect(editor).toBeFocused()
      await expect(editor).not.toHaveAttribute('inert', '')
      await expect(editor.getByRole('tab', { name: tabName, exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('textbox', { name: /卡片名称|副标题|主体要求/ })).toHaveCount(0)
      expect(await canvas.boundingBox()).toEqual(firstBounds)
      await editor.press('Escape')
      await expect(editor).toBeHidden()
      await expect(page.locator('.holo-editor')).toHaveAttribute('inert', '')
      await expect(trigger).toBeFocused()
    }
    await openPanel(page, '设计')
    await openDetails(page, '卡面文字')
    await expect(page.getByRole('textbox', { name: '卡片名称', exact: true })).toBeVisible()
    await closePanel(page)
    await expect(page.getByRole('button', { name: '设计面板', exact: true })).toBeFocused()
    const sample = page.locator('[data-card-template="astral"]')
    await page.getByRole('button', { name: '金箔', exact: true }).click()
    await expect(page.getByRole('button', { name: '金箔', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '翻转卡片', exact: true }).click()
    await expect(sample).toHaveAttribute('data-holo-face', 'back')
    await page.getByRole('button', { name: '静止预览', exact: true }).click()
    await expect(page.getByRole('button', { name: '启用鼠标交互', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '隐藏工具', exact: true }).click()
    await expect(page.getByRole('button', { name: '显示工具', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '创作工具', exact: true })).toBeHidden()
    await expect(page.getByRole('group', { name: '镭射材质', exact: true })).toBeHidden()
    await expect(canvas).toBeVisible()
    await keepArtifact(testInfo, 'holo-immersive-pure-view.png', await page.screenshot({ fullPage: true }), 'image/png')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('navigation', { name: '创作工具', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '显示工具', exact: true })).toHaveCount(0)
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('public original-image preview stays local and never calls background removal', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '闪光卡', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '卡片模式', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '预览视图', exact: true }).getByRole('tab')).toHaveText(['闪卡'])
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeDisabled()
    await chooseSource(page)
    await readyCanvas(page)
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'original')
    await expect(page.getByRole('group', { name: '卡片模式', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '预览视图', exact: true }).getByRole('tab')).toHaveText(['闪卡', '原图'])
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 PNG', exact: true }).click()
    const download = await downloadPromise
    const exported = await downloadBytes(download)
    expect(download.suggestedFilename()).toBe('starclouds-holo-card.png')
    expect(exported.subarray(0, 8)).toEqual(sourcePng.subarray(0, 8))
    expect(exported.readUInt32BE(16)).toBe(1600)
    expect(exported.readUInt32BE(20)).toBe(2400)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('image2 generation needs cost confirmation and manual approval of true alpha', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, {
      models: [{ ...model, id: 'other-model', label: 'Other Model' }, model],
    })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    await openPanel(page, '图层')
    await openDetails(page, '生成设置')
    await expect(page.getByRole('combobox', { name: '模型', exact: true }).locator('option')).toHaveText(['image2 Fine'])
    await page.getByRole('textbox', { name: /^主体要求/ }).fill('Preserve all fine metal wires')
    await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？' })
    await expect(dialog).toContainText('12 积分')
    expect(calls.quotes).toHaveLength(1)
    expect(calls.quotes[0].inputKeys).toEqual([])
    expect(calls.quotes[0].params.sourceUrl).toBeUndefined()
    expect(calls.uploads).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await expect(page).toHaveURL(/\/holo-card\?task=holo-created-1$/)
    expect(calls.uploads).toHaveLength(1)
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]).toMatchObject({
      type: 't2i', count: 1, expectedUnitPriceCents: 12, inputKeys: ['uploads/holo/source.png'],
      params: {
        _source: 'holo_card', _kind: 'holo-card-subject', publicModelKey: model.id,
        quality: 'high', inputFidelity: 'high', outputFormat: 'png', strictAlphaOutput: true,
        transparentBackground: true, transparentPngEnabled: true, autoBackgroundRemovalEnabled: false,
        resolutionScale: '2K', aspectRatio: '3:4', size: '1536x2048', outputSize: '1536x2048',
        sourceUrl, sourceName: 'holo-source.png',
      },
    })
    expect(calls.created[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls.created[0].prompt).toContain('Preserve all fine metal wires')
    await expect(page.getByRole('group', { name: '卡片模式', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toHaveCount(0)
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'original')
    await page.getByRole('combobox', { name: '预览缩放', exact: true }).selectOption('1')
    const subjectImage = page.getByAltText('待验收透明主体')
    await expect(subjectImage).toHaveCSS('width', `${imageWidth}px`)
    await expect(subjectImage).toHaveCSS('height', `${imageHeight}px`)
    await page.getByRole('button', { name: '黑底', exact: true }).click()
    await expect(page.getByLabel('原尺寸图层检查')).toHaveCSS('background-color', 'rgb(17, 17, 17)')
    await page.getByRole('button', { name: '白底', exact: true }).click()
    await expect(page.getByLabel('原尺寸图层检查')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.getByRole('button', { name: '棋盘底', exact: true }).click()
    await expect(page.getByRole('button', { name: '棋盘底', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '闪卡编辑', exact: true })).toBeHidden()
    await openPanel(page, '设计')
    await expect(page.getByRole('button', { name: '分层闪卡', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await readyCanvas(page)
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    expect(calls.created).toHaveLength(1)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  for (const [name, output] of [['opaque PNG', sourcePng], ['painted checkerboard PNG', checkerPng]]) {
    test(`rejects generated ${name} without resubmitting a paid generation`, async ({ page }) => {
      const { calls, errors } = await installHoloMocks(page, { output })
      await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
      await chooseSource(page)
      await generateSubject(page)
      await expect(page.locator('.holo-error')).toContainText('未检测到足够的真实透明区域')
      await expect(page.getByRole('tab', { name: '透明主体', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
      await expect(page.getByRole('group', { name: '卡片模式', exact: true })).toHaveCount(0)
      const readCount = calls.reads.length
      await page.getByRole('button', { name: '重新同步', exact: true }).click()
      await expect.poll(() => calls.reads.length).toBeGreaterThan(readCount)
      await expect(page.locator('.holo-error')).toContainText('未检测到足够的真实透明区域')
      expect(calls.created).toHaveLength(1)
      expect(calls.uploads).toHaveLength(1)
      expect(calls.quotes).toHaveLength(1)
      expect(calls.removals).toHaveLength(0)
      expect(errors).toEqual([])
    })
  }

  test('validates imported PNG bytes, minimum pixels, and actual transparency locally', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await openPanel(page, '图层')
    const input = page.getByLabel('导入透明主体', { exact: true })
    for (const [name, buffer, message] of [
      ['renamed.png', Buffer.from('RIFF fake WEBP data'), '透明主体必须是真实 PNG 文件'],
      ['opaque.png', sourcePng, '未检测到足够的真实透明区域'],
      ['checker.png', checkerPng, '未检测到足够的真实透明区域'],
      ['empty.png', makePng('empty'), '图片接近全透明，未检测到有效主体'],
      ['too-small.png', makePng('transparent', 512, 768), '透明主体短边至少需要 1024 像素'],
    ]) {
      await input.setInputFiles({ name, mimeType: 'image/png', buffer })
      await expect(page.locator('.holo-error')).toContainText(message)
      await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
      await expect(page.getByRole('group', { name: '卡片模式', exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: '关闭错误', exact: true }).click()
    }
    await input.setInputFiles({ name: 'verified-subject.png', mimeType: 'image/png', buffer: subjectPng })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await readyCanvas(page)
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('failed tasks and explicit resync never automatically create another paid task', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { failure: 'Native alpha output is unavailable' })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    await generateSubject(page)
    await expect(page.locator('.holo-error')).toContainText('Native alpha output is unavailable')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openPanel(page, '图层')
    await expect(page.locator('.holo-error')).toContainText('Native alpha output is unavailable')
    const readCount = calls.reads.length
    await page.getByRole('button', { name: '重新同步', exact: true }).click()
    await expect.poll(() => calls.reads.length).toBeGreaterThan(readCount)
    await expect(page.locator('.holo-error')).toContainText('Native alpha output is unavailable')
    await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
    expect(calls.created).toHaveLength(1)
    expect(calls.uploads).toHaveLength(1)
    expect(calls.quotes).toHaveLength(1)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('URL recovery and filtered history revalidate alpha and require fresh approval', async ({ page }) => {
    const first = completedTask()
    const second = completedTask({ id: 'holo-history-2', params: { ...first.params, sourceName: 'second-original.png' } })
    const unrelated = completedTask({ id: 'other-task', params: { _source: 'react_canvas', _kind: 'canvas-image', sourceName: 'unrelated.png' } })
    const { calls, errors } = await installHoloMocks(page, { history: [first, second, unrelated] })
    await page.goto('/holo-card?task=holo-created-1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await openPanel(page, '记录')
    await expect(page.locator('.holo-history')).not.toContainText('unrelated.png')
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '原图', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await readyCanvas(page)
    await openPanel(page, '记录')
    await page.locator('.holo-history').getByRole('button', { name: /second-original\.png/ }).click()
    await expect(page).toHaveURL(/\?task=holo-history-2$/)
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await openPanel(page, '图层')
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toBeEnabled()
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
    await expect(page.locator('#holo-panel-design .holo-upload')).toContainText('holo-source.png')
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await expect(page.getByRole('tab', { name: '原图', exact: true })).toHaveCount(0)
    await expect(page.locator('.holo-upload')).not.toContainText('second-original.png')
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await readyCanvas(page)
    await expect(page.locator('.holo-upload')).toContainText('second-original.png')
    expect(calls.reads.some(url => url.searchParams.get('source') === 'holo_card')).toBe(true)
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('paid transparent output remains recoverable when the original image is missing', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { history: [completedTask()] })
    await page.route(`**${sourceUrl}`, route => route.fulfill({ status: 404, body: 'Original removed' }))
    await page.goto('/holo-card?task=holo-created-1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await openPanel(page, '图层')
    await expect(page.locator('.holo-source-warning')).toContainText('原图暂时无法恢复')
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await readyCanvas(page)
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('blocks image2 routes without native transparent output while keeping original preview usable', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { models: [{ ...model, transparentBackground: false }] })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    await readyCanvas(page)
    await openPanel(page, '图层')
    await expect(page.getByText('该线路未开放原生透明输出', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '生成精细主体', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
    expect(calls.quotes).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('first-load API failures stay in their panels and never interrupt local preview', async ({ page }, testInfo) => {
    const { calls, errors } = await installHoloMocks(page, { serviceFailure: true })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await readyCanvas(page)
    await expect.poll(() => calls.configReads).toBeGreaterThan(0)
    await expect.poll(() => calls.reads.filter(url => url.pathname.endsWith('/tasks')).length).toBeGreaterThan(0)
    await expect(page.locator('.holo-status')).toHaveText('示例同款')
    await expect(page.locator('.holo-workspace').getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '闪卡编辑', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeDisabled()
    await expect(page.getByRole('tablist', { name: '预览视图', exact: true }).getByRole('tab')).toHaveText(['闪卡'])
    await keepArtifact(testInfo, 'holo-api-unavailable-first-view.png', await page.screenshot({ fullPage: true }), 'image/png')
    await chooseSource(page)
    const canvas = await readyCanvas(page)
    await assertPaintedCard(page, await stableCanvasImage(canvas))
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
    await openPanel(page, '图层')
    await expect(page.getByText('暂时无法连接 image2 服务', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '生成精细主体', exact: true })).toBeDisabled()
    const configReads = calls.configReads
    await page.getByRole('button', { name: '重试连接模型', exact: true }).click()
    await expect.poll(() => calls.configReads).toBeGreaterThan(configReads)
    const history = await openPanel(page, '记录')
    await expect(history.getByRole('alert')).toBeVisible()
    await openPanel(page, '设计')
    await expect(page.locator('.holo-workspace').getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('refreshing history never rereads the selected task or clears the adopted artwork', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { history: [completedTask()] })
    await page.goto('/holo-card?task=holo-created-1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    const canvas = await readyCanvas(page)
    const adopted = await stableCanvasImage(canvas)
    const history = await openPanel(page, '记录')
    await expect(history.getByRole('button', { name: /holo-source\.png/ })).toBeEnabled()
    const taskReads = () => calls.reads.filter(url => url.pathname.endsWith('/holo-created-1')).length
    const listReads = () => calls.reads.filter(url => url.pathname.endsWith('/tasks')).length
    const previousTaskReads = taskReads()
    const previousListReads = listReads()
    await page.getByRole('button', { name: '刷新任务', exact: true }).click()
    await expect.poll(listReads).toBeGreaterThan(previousListReads)
    await expect(page.getByRole('button', { name: '刷新任务', exact: true })).toBeEnabled()
    expect(taskReads()).toBe(previousTaskReads)
    await expect(page.getByRole('tab', { name: '透明主体', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    await expect(page.locator('.holo-status')).toHaveText('同款已完成')
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
    expect(imageHash(await stableCanvasImage(canvas))).toBe(imageHash(adopted))
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('a failed regeneration preserves the previously adopted subject and never retries payment', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { failure: ['', 'Second image2 generation failed'] })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    await openPanel(page, '设计')
    await openDetails(page, '卡面文字')
    await page.getByRole('textbox', { name: '卡片名称', exact: true }).fill('My finished card')
    await generateSubject(page)
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    const canvas = await readyCanvas(page)
    const adopted = await stableCanvasImage(canvas)
    await generateSubject(page)
    await expect(page.locator('.holo-error')).toContainText('Second image2 generation failed')
    await expect(page).toHaveURL(/\?task=holo-created-2$/)
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
    await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    await page.getByRole('button', { name: '重新同步', exact: true }).click()
    await expect(page.locator('.holo-error')).toContainText('Second image2 generation failed')
    await openPanel(page, '设计')
    await expect(page.getByRole('textbox', { name: '卡片名称', exact: true })).toHaveValue('My finished card')
    await expect(page.getByRole('button', { name: '分层闪卡', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(imageHash(await stableCanvasImage(canvas))).toBe(imageHash(adopted))
    expect(calls.created).toHaveLength(2)
    expect(calls.uploads).toHaveLength(2)
    expect(calls.quotes).toHaveLength(2)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('a new candidate can be compared and declined without changing the adopted card or lineart', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    const canvas = await importSubject(page)
    await openPanel(page, '图层')
    await openDetails(page, '轮廓线稿')
    await page.getByLabel('上传对齐线稿', { exact: true }).setInputFiles({ name: 'adopted-lineart.png', mimeType: 'image/png', buffer: transparentLineartPng })
    await readyCanvas(page)
    const adopted = await stableCanvasImage(canvas)
    const candidatePng = makePng('transparent', 1280, 1024)
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入透明 PNG', exact: true }).click()
    await (await chooserPromise).setFiles({ name: 'new-candidate.png', mimeType: 'image/png', buffer: candidatePng })
    const candidate = page.getByAltText('待验收透明主体')
    await expect(candidate).toBeVisible()
    await expect.poll(() => candidate.evaluate(image => image.naturalWidth)).toBe(1280)
    await expect(page.getByRole('tab', { name: '线稿', exact: true })).toBeEnabled()
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    await page.getByRole('tab', { name: '已采用主体', exact: true }).click()
    const applied = page.getByAltText('已采用透明主体')
    await expect(applied).toBeVisible()
    await expect.poll(() => applied.evaluate(image => image.naturalWidth)).toBe(imageWidth)
    await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: '透明主体', exact: true }).click()
    await page.getByRole('combobox', { name: '预览缩放', exact: true }).selectOption('4')
    await expect(candidate).toHaveCSS('width', '5120px')
    await page.getByRole('button', { name: '暂不采用', exact: true }).click()
    await readyCanvas(page)
    await expect(page.locator('.holo-status')).toHaveText('同款已完成')
    await expect(page.getByRole('tab', { name: '已采用主体', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '线稿', exact: true })).toBeEnabled()
    expect(imageHash(await stableCanvasImage(canvas))).toBe(imageHash(adopted))
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('exporting during candidate inspection saves the current card and leaves the candidate unapproved', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    await readyCanvas(page)
    const exportCard = async () => {
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出 PNG', exact: true }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe('starclouds-holo-card.png')
      return downloadBytes(download)
    }
    const originalCard = await exportCard()
    await openPanel(page, '图层')
    await page.getByLabel('导入透明主体', { exact: true }).setInputFiles({ name: 'unapproved.png', mimeType: 'image/png', buffer: subjectPng })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
    const exported = await exportCard()
    expect(exported).toEqual(originalCard)
    expect(exported.readUInt32BE(16)).toBe(1600)
    expect(exported.readUInt32BE(20)).toBe(2400)
    await expect(page.getByRole('tab', { name: '闪卡', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.holo-status')).toHaveText('主体待验收')
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'original')
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: '透明主体', exact: true }).click()
    await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toBeEnabled()
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('dark workspace presents the real sample without treating it as adopted user artwork', async ({ page }, testInfo) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => {
      localStorage.setItem('starclouds-appearance', 'dark')
      localStorage.setItem('walleven-color-scheme', 'dark')
    })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.holo-workspace')).toHaveClass(/is-dark/)
    const canvas = await readyCanvas(page)
    await stableCanvasImage(canvas)
    await expect(page.locator('.holo-status')).toHaveText('示例同款')
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeDisabled()
    await expect(page.getByRole('group', { name: '卡片模式', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '预览视图', exact: true }).getByRole('tab')).toHaveText(['闪卡'])
    await keepArtifact(testInfo, 'holo-desktop-dark-1440.png', await page.screenshot({ fullPage: true }), 'image/png')
    expect(calls.created).toHaveLength(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.quotes).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('all five foil materials change rendered pixels and original print disables foil strength', async ({ page }, testInfo) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    const canvas = await readyCanvas(page)
    await openPanel(page, '设计')
    const strength = page.getByRole('slider', { name: '镭射强度', exact: true })
    await strength.press('End')
    const images = new Map()
    for (const name of ['原画', '珠光', '金箔', '银箔', '光谱']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
      if (name === '原画') await expect(strength).toBeDisabled()
      else await expect(strength).toBeEnabled()
      const image = await stableCanvasImage(canvas)
      await assertPaintedCard(page, image)
      images.set(name, image)
    }
    expect(new Set([...images.values()].map(imageHash)).size).toBe(5)
    const differences = {}
    for (const [name, image] of images) {
      if (name === '原画') continue
      differences[name] = await imagePixelDifference(page, images.get('原画'), image)
      expect(differences[name].changedRatio, name).toBeGreaterThan(0.005)
    }
    await keepArtifact(testInfo, 'holo-original-print.png', images.get('原画'), 'image/png')
    await keepArtifact(testInfo, 'holo-pearl.png', images.get('珠光'), 'image/png')
    await keepArtifact(testInfo, 'holo-gold.png', images.get('金箔'), 'image/png')
    await keepArtifact(testInfo, 'holo-material-pixels.json', JSON.stringify(differences, null, 2), 'application/json')
    expect(calls.uploads).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(errors).toEqual([])
  })

  for (const reducedMotion of ['no-preference', 'reduce']) {
    test(`card front and back render differently and reset restores front with motion ${reducedMotion}`, async ({ page }, testInfo) => {
      const { errors } = await installHoloMocks(page, { signedIn: false })
      await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
      await page.emulateMedia({ reducedMotion })
      await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
      await chooseSource(page)
      const canvas = await readyCanvas(page)
      const stage = page.locator('.holo-card-stage')
      const front = await stableCanvasImage(canvas)
      await expect(stage).toHaveAttribute('data-holo-face', 'front')
      await page.getByRole('button', { name: '翻转卡片', exact: true }).click()
      await expect(stage).toHaveAttribute('data-holo-face', 'back')
      await expect(page.getByRole('button', { name: '查看正面', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const immediate = reducedMotion === 'reduce' ? Buffer.from((await canvas.evaluate(element => element.toDataURL('image/png'))).split(',')[1], 'base64') : null
      const back = await stableCanvasImage(canvas)
      const difference = await imagePixelDifference(page, front, back)
      expect(difference.changedRatio).toBeGreaterThan(0.1)
      if (immediate) expect(imageHash(immediate)).toBe(imageHash(back))
      await page.getByRole('button', { name: '复位角度', exact: true }).click()
      await expect(stage).toHaveAttribute('data-holo-face', 'front')
      expect(imageHash(await stableCanvasImage(canvas))).toBe(imageHash(front))
      await keepArtifact(testInfo, `holo-back-${reducedMotion}.png`, back, 'image/png')
      await keepArtifact(testInfo, `holo-flip-${reducedMotion}.json`, JSON.stringify(difference, null, 2), 'application/json')
      expect(errors).toEqual([])
    })
  }

  test('pointer dragging captures the card, changes its render, and ends on release', async ({ page }, testInfo) => {
    const { errors } = await installHoloMocks(page, { signedIn: false })
    await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseSource(page)
    const canvas = await readyCanvas(page)
    await canvas.scrollIntoViewIfNeeded()
    const stage = page.locator('.holo-card-stage')
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    const before = await stableCanvasImage(canvas)
    await page.mouse.down()
    await expect(stage).toHaveAttribute('data-holo-dragging', 'true')
    await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.25, { steps: 8 })
    const dragged = await stableCanvasImage(canvas)
    expect((await imagePixelDifference(page, before, dragged)).changedRatio).toBeGreaterThan(0.05)
    await page.mouse.move(bounds.x + bounds.width + 15, bounds.y + bounds.height * 0.25)
    await expect(stage).toHaveAttribute('data-holo-dragging', 'true')
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-holo-dragging', 'false')
    await page.getByRole('button', { name: '复位角度', exact: true }).click()
    expect(imageHash(await stableCanvasImage(canvas))).toBe(imageHash(before))
    await keepArtifact(testInfo, 'holo-dragged.png', dragged, 'image/png')
    expect(errors).toEqual([])
  })

  test('lineart requires approved, matching sparse black contours and resets when artwork changes', async ({ page }) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    const input = page.getByLabel('上传对齐线稿', { exact: true })
    const tab = page.getByRole('tab', { name: '线稿', exact: true })
    const strength = page.getByRole('slider', { name: '轮廓光泽', exact: true })
    await openPanel(page, '图层')
    await expect(page.locator('summary').filter({ hasText: '轮廓线稿' })).toHaveCount(0)
    await input.setInputFiles({ name: 'no-subject.png', mimeType: 'image/png', buffer: lineartPng })
    await expect(page.locator('.holo-error')).toContainText('请先确认透明主体')
    await importSubject(page)
    await openPanel(page, '图层')
    await openDetails(page, '轮廓线稿')
    for (const [name, buffer, message] of [
      ['wrong-size.png', makePng('lineart-white', 800, 1000), '线稿画布尺寸必须与透明主体完全一致'],
      ['colored.png', sourcePng, '线稿需为稀疏黑色轮廓'],
      ['blank-white.png', makePng('white'), '线稿需为稀疏黑色轮廓'],
      ['blank-transparent.png', makePng('empty'), '线稿需为稀疏黑色轮廓'],
    ]) {
      await input.setInputFiles({ name, mimeType: 'image/png', buffer })
      await expect(page.locator('.holo-error')).toContainText(message)
      await expect(tab).toHaveCount(0)
      await expect(strength).toHaveCount(0)
      await page.getByRole('button', { name: '关闭错误', exact: true }).click()
    }
    await input.setInputFiles({ name: 'white-lineart.png', mimeType: 'image/png', buffer: lineartPng })
    await expect(tab).toBeEnabled()
    await expect(strength).toBeEnabled()
    await tab.click()
    await expect(page.getByAltText('对齐线稿图层')).toBeVisible()
    await importSubject(page, 'replacement-subject.png')
    await expect(tab).toHaveCount(0)
    await expect(strength).toHaveCount(0)
    await expect(page.getByAltText('white-lineart.png', { exact: true })).toHaveCount(0)
    await openPanel(page, '图层')
    await openDetails(page, '轮廓线稿')
    await input.setInputFiles({ name: 'transparent-lineart.png', mimeType: 'image/png', buffer: transparentLineartPng })
    await expect(tab).toBeEnabled()
    await expect(strength).toBeEnabled()
    await readyCanvas(page)
    await chooseSource(page)
    await expect(tab).toHaveCount(0)
    await expect(strength).toHaveCount(0)
    await expect(page.getByAltText('transparent-lineart.png', { exact: true })).toHaveCount(0)
    expect(calls.uploads).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(calls.removals).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('registered lineart gloss changes actual pixels and original print removes the effect', async ({ page }, testInfo) => {
    const { errors } = await installHoloMocks(page, { signedIn: false })
    await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    const canvas = await importSubject(page)
    await openPanel(page, '图层')
    await openDetails(page, '轮廓线稿')
    await page.getByLabel('上传对齐线稿', { exact: true }).setInputFiles({ name: 'registered-lineart.png', mimeType: 'image/png', buffer: transparentLineartPng })
    await readyCanvas(page)
    await openPanel(page, '设计')
    await page.getByRole('slider', { name: '镭射强度', exact: true }).press('End')
    await expect(page.getByRole('slider', { name: '镭射强度', exact: true })).toHaveValue('1')
    await closePanel(page)
    // Place the registered contours inside the angle-dependent reflection band.
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.5)
    await stableCanvasImage(canvas)
    await page.getByRole('button', { name: '静止预览', exact: true }).click()
    await openPanel(page, '图层')
    await openDetails(page, '轮廓线稿')
    const strength = page.getByRole('slider', { name: '轮廓光泽', exact: true })
    await expect(strength).toBeEnabled()
    await strength.press('Home')
    await expect(strength).toHaveValue('0')
    await canvas.scrollIntoViewIfNeeded()
    const withoutLines = await stableCanvasImage(canvas)
    await strength.press('End')
    await expect(strength).toHaveValue('1')
    await canvas.scrollIntoViewIfNeeded()
    const withLines = await stableCanvasImage(canvas)
    const difference = await imagePixelDifference(page, withoutLines, withLines)
    await keepArtifact(testInfo, 'holo-lineart-without-gloss.png', withoutLines, 'image/png')
    await keepArtifact(testInfo, 'holo-lineart-gloss.png', withLines, 'image/png')
    await keepArtifact(testInfo, 'holo-lineart-pixels.json', JSON.stringify(difference, null, 2), 'application/json')
    expect(difference.changedPixels, JSON.stringify(difference)).toBeGreaterThan(30)
    expect(difference.maxDelta).toBeGreaterThan(3)
    await openPanel(page, '设计')
    await page.getByRole('button', { name: '原画', exact: true }).click()
    await openPanel(page, '图层')
    await expect(strength).toBeDisabled()
    const originalWithLines = await stableCanvasImage(canvas)
    await page.getByRole('button', { name: '移除线稿', exact: true }).click()
    await readyCanvas(page)
    await canvas.scrollIntoViewIfNeeded()
    expect(imageHash(await stableCanvasImage(canvas))).toBe(imageHash(originalWithLines))
    expect(errors).toEqual([])
  })

  test('subject scale and negative background depth change independent layer pixels', async ({ page }, testInfo) => {
    const { calls, errors } = await installHoloMocks(page, { signedIn: false })
    await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await openPanel(page, '设计')
    await openDetails(page, '细节调节')
    await expect(page.getByRole('slider', { name: '主体比例', exact: true })).toHaveCount(0)
    await expect(page.getByRole('slider', { name: '背景景深', exact: true })).toHaveCount(0)
    const canvas = await importSubject(page)
    await openPanel(page, '图层')
    await page.getByLabel('上传独立背景', { exact: true }).setInputFiles({ name: 'independent-background.png', mimeType: 'image/png', buffer: checkerPng })
    await readyCanvas(page)
    await openPanel(page, '设计')
    await openDetails(page, '细节调节')
    await page.getByRole('button', { name: '原画', exact: true }).click()
    await closePanel(page)
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.5)
    await stableCanvasImage(canvas)
    await page.getByRole('button', { name: '静止预览', exact: true }).click()
    await openPanel(page, '设计')
    await openDetails(page, '细节调节')
    const scale = page.getByRole('slider', { name: '主体比例', exact: true })
    const depth = page.getByRole('slider', { name: '背景景深', exact: true })
    await scale.press('Home')
    await expect(scale).toHaveValue('0.75')
    const small = await stableCanvasImage(canvas)
    await scale.press('End')
    await expect(scale).toHaveValue('1.2')
    const large = await stableCanvasImage(canvas)
    const scaled = await imagePixelDifference(page, small, large)
    expect(scaled.changedRatio).toBeGreaterThan(0.005)
    await depth.press('Home')
    await expect(depth).toHaveValue('-0.5')
    const recessed = await stableCanvasImage(canvas)
    await depth.press('End')
    await expect(depth).toHaveValue('0')
    const flat = await stableCanvasImage(canvas)
    const shifted = await imagePixelDifference(page, recessed, flat)
    expect(shifted.changedRatio).toBeGreaterThan(0.005)
    await keepArtifact(testInfo, 'holo-layer-scale.png', large, 'image/png')
    await keepArtifact(testInfo, 'holo-layer-depth.png', recessed, 'image/png')
    await keepArtifact(testInfo, 'holo-layer-pixels.json', JSON.stringify({ scaled, shifted }, null, 2), 'application/json')
    expect(calls.uploads).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('standalone renderer frames a painted interactive card in a 390x844 container', async ({ page }, testInfo) => {
    const { errors } = await installHoloMocks(page, { signedIn: false })
    await page.setViewportSize({ width: 390, height: 844 })
    await installRendererHarness(page)
    await page.goto('/__holo-renderer-test', { waitUntil: 'domcontentloaded' })
    const canvas = await readyCanvas(page)
    const bounds = await canvas.boundingBox()
    expect(bounds).toMatchObject({ x: 0, y: 0, width: 390, height: 844 })
    const initial = await stableCanvasImage(canvas)
    await assertPaintedCard(page, initial)
    await page.evaluate(() => window.__holoRenderer.setPose({ x: 0.8, y: 0.6, flip: 0 }))
    const tilted = await stableCanvasImage(canvas)
    expect((await imagePixelDifference(page, initial, tilted)).changedRatio).toBeGreaterThan(0.05)
    const framing = await page.evaluate(async source => {
      const image = new Image()
      image.src = `data:image/png;base64,${source}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, image.width, image.height)
      const bounds = { left: image.width, right: 0, top: image.height, bottom: 0 }
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4
          if (data[index + 3] < 16) continue
          bounds.left = Math.min(bounds.left, x)
          bounds.right = Math.max(bounds.right, x)
          bounds.top = Math.min(bounds.top, y)
          bounds.bottom = Math.max(bounds.bottom, y)
        }
      }
      return bounds
    }, tilted.toString('base64'))
    expect(framing.left).toBeGreaterThan(10)
    expect(framing.right).toBeLessThan(380)
    expect(framing.top).toBeGreaterThan(10)
    expect(framing.bottom).toBeLessThan(834)
    expect(await canvas.evaluate(element => element.getContext('webgl2')?.getError())).toBe(0)
    await keepArtifact(testInfo, 'holo-narrow-390.png', initial, 'image/png')
    await keepArtifact(testInfo, 'holo-narrow-390-tilted.png', tilted, 'image/png')
    await keepArtifact(testInfo, 'holo-narrow-framing.json', JSON.stringify(framing, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  test('a missing lineart texture reports failure, blocks export, and recovers on replacement', async ({ page }) => {
    const { errors } = await installHoloMocks(page, { signedIn: false })
    await page.route('**/holo-missing-lineart.png', route => route.fulfill({ status: 404, body: 'Missing lineart' }))
    await installRendererHarness(page)
    await page.goto('/__holo-renderer-test', { waitUntil: 'domcontentloaded' })
    await readyCanvas(page)
    await page.evaluate(async ({ sourceUrl, subjectUrl }) => {
      await window.__holoRenderer.setImages({ sourceUrl, subjectUrl, lineartUrl: '/holo-missing-lineart.png', mode: 'layered' })
    }, { sourceUrl, subjectUrl })
    const stage = page.getByRole('group', { name: /^立体镭射闪卡预览/ })
    await expect(stage).toHaveAttribute('data-holo-state', 'error')
    await expect(stage).toHaveAttribute('data-holo-error', /图片或线稿无法载入预览/)
    const exportError = await page.evaluate(async () => {
      try { await window.__holoRenderer.exportPng(); return '' }
      catch (error) { return error.message }
    })
    expect(exportError).toContain('闪卡尚未就绪')
    await page.evaluate(async subjectUrl => {
      await window.__holoRenderer.setImages({ subjectUrl, mode: 'layered' })
    }, subjectUrl)
    const canvas = await readyCanvas(page)
    await assertPaintedCard(page, await stableCanvasImage(canvas))
    expect(errors).toEqual([])
  })

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    test(`WebGL renders and responds to pointer, pause, and reduced motion at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      const { errors } = await installHoloMocks(page, { signedIn: false })
      await page.setViewportSize(viewport)
      await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
      await chooseSource(page)
      const canvas = await readyCanvas(page)
      await canvas.scrollIntoViewIfNeeded()
      const bounds = await canvas.boundingBox()
      expect(bounds.width).toBeGreaterThan(400)
      expect(bounds.height).toBeGreaterThanOrEqual(360)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
      await expect(page.getByRole('dialog', { name: '闪卡编辑', exact: true })).toBeHidden()
      await expect(page.getByRole('textbox')).toHaveCount(0)
      await expect(page.getByRole('slider')).toHaveCount(0)
      expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(3)
      const documentBounds = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
      }))
      expect(documentBounds.width).toBeLessThanOrEqual(viewport.width)
      expect(documentBounds.bodyWidth).toBeLessThanOrEqual(viewport.width)
      expect(documentBounds.height).toBeLessThanOrEqual(viewport.height)
      expect(documentBounds.bodyHeight).toBeLessThanOrEqual(viewport.height)
      await openPanel(page, '设计')
      await openDetails(page, '卡面文字')
      await openDetails(page, '细节调节')
      const designPanel = page.getByRole('tabpanel', { name: '设计', exact: true })
      await designPanel.evaluate(element => element.scrollTo(0, 0))
      const panelBounds = await designPanel.boundingBox()
      await page.mouse.move(panelBounds.x + panelBounds.width / 2, panelBounds.y + panelBounds.height / 2)
      await page.mouse.wheel(0, 700)
      await expect.poll(() => designPanel.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      expect(await canvas.boundingBox()).toEqual(bounds)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
      await designPanel.evaluate(element => element.scrollTo(0, 0))
      await closePanel(page)
      const initial = await stableCanvasImage(canvas)
      const pixels = await assertPaintedCard(page, initial)
      const glError = await canvas.evaluate(element => element.getContext('webgl2')?.getError())
      expect(glError).toBe(0)
      await keepArtifact(testInfo, `holo-workspace-${viewport.width}.png`, await page.screenshot({ fullPage: true }), 'image/png')
      await keepArtifact(testInfo, `holo-${viewport.width}-initial.png`, initial, 'image/png')
      await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.25)
      const moved = await stableCanvasImage(canvas)
      expect(imageHash(moved)).not.toBe(imageHash(initial))
      await keepArtifact(testInfo, `holo-${viewport.width}-tilted.png`, moved, 'image/png')
      await page.getByRole('button', { name: '静止预览', exact: true }).click()
      const paused = await stableCanvasImage(canvas)
      const pausedBounds = await canvas.boundingBox()
      await page.mouse.move(pausedBounds.x + pausedBounds.width * 0.2, pausedBounds.y + pausedBounds.height * 0.6)
      const pausedAfterMove = await stableCanvasImage(canvas)
      expect(imageHash(pausedAfterMove)).toBe(imageHash(paused))
      await page.getByRole('button', { name: '启用鼠标交互', exact: true }).click()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const reduced = await stableCanvasImage(canvas)
      const reducedBounds = await canvas.boundingBox()
      await page.mouse.move(reducedBounds.x + reducedBounds.width * 0.15, reducedBounds.y + reducedBounds.height * 0.3)
      const reducedAfterMove = await stableCanvasImage(canvas)
      expect(imageHash(reducedAfterMove)).toBe(imageHash(reduced))
      await keepArtifact(testInfo, `holo-${viewport.width}-pixels.json`, JSON.stringify({
        viewport, bounds, pixels, glError,
        hashes: {
          initial: imageHash(initial), tilted: imageHash(moved),
          paused: imageHash(paused), pausedAfterMove: imageHash(pausedAfterMove),
          reduced: imageHash(reduced), reducedAfterMove: imageHash(reducedAfterMove),
        },
      }, null, 2), 'application/json')
      await expect(page.locator('.holo-stage-error')).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }
})
