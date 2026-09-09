import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const user = { id: 'holo-generation-user', email: 'holo-generation@example.com', username: 'Holo Generation' }
const sourceUrl = '/api/v1/files/uploads/holo-generation/source.png'
const subjectUrl = '/api/v1/files/generated/holo-generation/subject.png'
const goodModel = {
  id: 'gpt-image-2-fine', label: 'image2 精细线路', status: 'available', transparentBackground: true,
  outputFormats: ['png'], qualities: ['high'], maxReferenceImages: 1,
  resolutions: ['1K', '2K', '4K'], aspectRatios: ['3:4', '1:1'],
}
// This matches the public runtime shape of the default gpt-image-2 route:
// an opaque public ID, built-in format, 1K only, and a supported square canvas.
const builtinModel = {
  id: 'model-default-native-output', name: 'gpt-image-2', label: 'gpt-image-2', default: true,
  status: 'available', transparentBackground: true, outputFormats: [], qualities: ['low', 'medium', 'high'],
  maxReferenceImages: 8, resolutions: ['1K'],
  aspectRatios: ['auto', '16:9', '9:16', '1:1', '3:2', '2:3', '5:4', '4:5', '4:3', '3:4', '21:9', '9:21'],
}
const nonPngPath = fileURLToPath(new URL('../../public/sucai/studio-cover-game.webp', import.meta.url))
const unsupportedMessage = 'Image generation failed: transparent background is not supported for this model'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const callsByPage = new WeakMap()

// These cases validate forms, request boundaries, and PNG bytes; screenshots
// provide their artifacts without continuously recording WebGL frames.
test.use({ video: 'off' })

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
  return result
}

function makePng({ transparent = false, checker = false, width = 1024, height = 1280 } = {}) {
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4
    rows[offset] = Math.floor((x + y) / 55) % 2 ? 225 : 44
    rows[offset + 1] = Math.round(80 + y / height * 120)
    rows[offset + 2] = Math.floor((x + y) / 55) % 2 ? 68 : 205
    if (checker) rows[offset] = rows[offset + 1] = rows[offset + 2] = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? 180 : 240
    const edge = Math.min(x - width * .2, width * .8 - x, y - height * .15, height * .85 - y)
    rows[offset + 3] = transparent ? Math.round(Math.max(0, Math.min(1, edge / 3)) * 255) : 255
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const sourcePng = makePng()
const subjectPng = makePng({ transparent: true })
const squareSubjectPng = makePng({ transparent: true, height: 1024 })
const tallPng = makePng({ width: 900, height: 2100 })

function record(overrides = {}) {
  return {
    id: 'generation-completed', type: 't2i', status: 'succeeded',
    params: { _source: 'holo_card', _kind: 'holo-card-subject', publicModelKey: goodModel.id, sourceName: 'my-picture.png', sourceUrl },
    inputKeys: ['uploads/holo-generation/source.png'], originalUrls: [subjectUrl], outputUrls: [subjectUrl],
    createdAt: '2026-09-09T04:00:00Z', finishedAt: '2026-09-09T04:00:05Z', ...overrides,
  }
}

function failedRecord(overrides = {}) {
  return record({ id: 'generation-unsupported', status: 'failed', errorCode: 'upstream_error', errorMessage: unsupportedMessage,
    originalUrls: [], outputUrls: [], ...overrides })
}

async function mocks(page, { signedIn = true, models = [goodModel], history = [], controlledClock = false, holdHistory = false,
  output = subjectPng, outputType = 'image/png' } = {}) {
  if (controlledClock) await page.clock.install({ time: new Date('2026-09-09T04:00:00Z') })
  await installVisualBaseline(page)
  await page.clock.setSystemTime(new Date('2026-09-09T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls = { quotes: [], uploads: [], created: [], records: [...history], configReads: 0, abortedQuotes: 0,
    quoteMode: 'success', pendingQuotes: [], holdHistory, pendingHistory: [], errors: [], removals: [] }
  page.on('pageerror', error => calls.errors.push(error.message))
  page.on('requestfailed', request => { if (request.url().endsWith('/tasks/quote')) calls.abortedQuotes++ })
  page.on('request', request => { if (/background[-_]remove|remove[-_]background|background-removal/i.test(request.url())) calls.removals.push(request.url()) })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: signedIn ? user : null }))
  await page.route('**/api/v1/runtime-config', route => {
    calls.configReads++
    return fulfillJson(route, { routes: {}, blacklist: { blocked: false },
      features: { 'ai.wallpaperGeneration': { enabled: true, config: { publicModels: models } } } })
  })
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { availableCents: 1000, balanceCents: 1000 }))
  await page.route('**/api/v1/uploads', route => {
    calls.uploads.push(route.request())
    return fulfillJson(route, { key: 'uploads/holo-generation/source.png', url: sourceUrl })
  })
  await page.route('**/api/v1/tasks**', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/quote')) {
      calls.quotes.push(request.postDataJSON())
      if (calls.quoteMode === 'hang') { calls.pendingQuotes.push(route); return }
      if (calls.quoteMode === 'unavailable') return route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'quote_unavailable', error: '报价服务暂时不可用，请稍后重试' }) })
      return fulfillJson(route, { unitPriceCents: 12, totalPriceCents: 12, count: 1 })
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); calls.created.push(body)
      const task = record({ id: `generation-created-${calls.created.length}`, params: body.params })
      calls.records.push(task)
      return fulfillJson(route, { task: { ...task, status: 'queued' } })
    }
    if (url.pathname === '/api/v1/tasks') {
      const ids = url.searchParams.get('ids')?.split(',')
      if (!ids && calls.holdHistory) { calls.pendingHistory.push(route); return }
      return fulfillJson(route, { items: ids ? calls.records.filter(task => ids.includes(task.id)) : calls.records, nextCursor: null })
    }
    return fulfillJson(route, { task: calls.records.find(task => task.id === url.pathname.split('/').at(-1)) })
  })
  await page.route(`**${sourceUrl}`, route => route.fulfill({ contentType: 'image/png', body: sourcePng }))
  await page.route(`**${subjectUrl}`, route => route.fulfill({ contentType: outputType, body: output }))
  callsByPage.set(page, calls)
  return calls
}

async function chooseVisiblePicture(page, { buffer = sourcePng, name = 'my-picture.png' } = {}) {
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '制作同款', exact: true }).click()
  await (await choosing).setFiles({ name, mimeType: 'image/png', buffer })
  await expect(page.locator('.holo-upload')).toContainText(name)
  await expect(page.getByRole('button', { name: '开始生成同款', exact: true })).toBeVisible()
}

async function layersFromCreation(page) {
  await openEditor(page, '图层')
  await page.getByRole('button', { name: '查看在线生成', exact: true }).click()
  await expect(page.getByRole('tabpanel', { name: '图层', exact: true })).toBeVisible()
}

async function openEditor(page, tab) {
  const dialog = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
  if (!await dialog.isVisible()) await page.getByRole('button', { name: tab === '记录' ? '生成记录' : `${tab}面板`, exact: true }).click()
  await dialog.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name: tab, exact: true }).click()
  return dialog
}

async function bytes(download) {
  expect(await download.failure()).toBeNull()
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function downloadedSubject(page) {
  await openEditor(page, '图层')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原始透明 PNG', exact: true }).click()
  return bytes(await pending)
}

function noGeneration(calls) {
  expect(calls.uploads).toHaveLength(0)
  expect(calls.created).toHaveLength(0)
  expect(calls.removals).toHaveLength(0)
  expect(calls.errors).toEqual([])
}

async function artifact(testInfo, name, body, contentType = 'image/png') {
  const path = testInfo.outputPath(name)
  await writeFile(path, body)
  await testInfo.attach(name, { path, contentType })
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const calls = callsByPage.get(page)
  if (!calls) return
  const summary = {
    quotes: calls.quotes, uploads: calls.uploads.length, created: calls.created, configReads: calls.configReads,
    abortedQuotes: calls.abortedQuotes, quoteMode: calls.quoteMode, errors: calls.errors,
    checkpoint: calls.checkpoint || '',
    status: await page.locator('.holo-status').textContent({ timeout: 1000 }).catch(() => ''),
    inlineError: await page.locator('.holo-inline-error').textContent({ timeout: 1000 }).catch(() => ''),
  }
  await artifact(testInfo, 'generation-request-state.json', JSON.stringify(summary, null, 2), 'application/json')
})

test.describe('Holo card creation and generation recovery', () => {
  test('a visible template preview can choose effects and export without AI', async ({ page }, testInfo) => {
    const calls = await mocks(page, { signedIn: false })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '换上你的人物，制作同款', exact: true })).toBeVisible()
    await chooseVisiblePicture(page)
    await expect(page.getByRole('heading', { name: '再分离主体，就有示例层次', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '视觉玩法', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: '玩法', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '月下冰晶搭配', exact: true }).click()
    await expect(page.getByRole('button', { name: '月下冰晶搭配', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '关闭编辑面板', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存当前预览', exact: true })).toBeEnabled()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '保存当前预览', exact: true }).click()
    const download = await pending, png = await bytes(download)
    expect(download.suggestedFilename()).toBe('starclouds-holo-card.png')
    expect(png.subarray(0, 8)).toEqual(sourcePng.subarray(0, 8))
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1600, 2400])
    await artifact(testInfo, 'local-card-creation.png', await page.screenshot())
    expect(calls.quotes).toHaveLength(0)
    noGeneration(calls)
  })

  test('a blocked first 1K model cannot override the valid 2K portrait quote and alpha workflow', async ({ page }) => {
    const normalizedModel = { ...goodModel, status: 'AVAILABLE', outputFormats: ['PNG'], qualities: ['HIGH'],
      maxReferenceImages: '1', resolutions: ['1k', '2k', '4k'] }
    const calls = await mocks(page, { models: [
      { ...goodModel, id: 'gpt-image-2-blocked', label: 'image2 仅支持 JPEG', outputFormats: ['jpeg'], resolutions: ['1K'] },
      normalizedModel,
    ] })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseVisiblePicture(page)
    await layersFromCreation(page)
    await expect(page.locator('.holo-generation-summary')).toContainText('1536 × 2048')
    await page.locator('summary').filter({ hasText: '生成设置' }).click()
    const model = page.getByRole('combobox', { name: '模型', exact: true })
    const resolution = page.getByRole('combobox', { name: '分辨率', exact: true })
    await expect(model).toHaveValue(goodModel.id)
    await expect(model.locator('option').first()).toHaveJSProperty('disabled', true)
    await expect(resolution).toHaveValue('2K')
    await expect(resolution.locator('option[value="1K"]')).toHaveJSProperty('disabled', true)
    await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })
    await expect(dialog).toContainText('12 积分')
    expect(calls.quotes).toHaveLength(1)
    expect(calls.quotes[0]).toMatchObject({ type: 't2i', count: 1, inputKeys: [], params: {
      publicModelKey: goodModel.id, resolutionScale: '2K', aspectRatio: '3:4', size: '1536x2048',
      quality: 'high', outputFormat: 'png', inputFidelity: 'high', strictAlphaOutput: true,
      transparentBackground: true, transparentPngEnabled: true, autoBackgroundRemovalEnabled: false,
    } })
    expect(calls.quotes[0].params.sourceUrl).toBeUndefined()
    noGeneration(calls)
    await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    expect(calls.uploads).toHaveLength(1)
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]).toMatchObject({ expectedUnitPriceCents: 12, count: 1,
      inputKeys: ['uploads/holo-generation/source.png'], params: { sourceUrl, strictAlphaOutput: true, autoBackgroundRemovalEnabled: false } })
    expect(calls.created[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
    const downloaded = await downloadedSubject(page)
    expect(hash(downloaded)).toBe(hash(subjectPng))
    expect(downloaded).toEqual(subjectPng)
    expect(calls.removals).toHaveLength(0)
    expect(calls.errors).toEqual([])
  })

  test('the default 1K built-in format route stays selected and preserves strict alpha through adoption', async ({ page }, testInfo) => {
    const calls = await mocks(page, {
      models: [builtinModel, { ...goodModel, default: false }], output: squareSubjectPng,
      history: [failedRecord({ id: 'other-route-unsupported' })],
    })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseVisiblePicture(page)
    await layersFromCreation(page)
    await expect(page.locator('.holo-generation-summary')).toContainText('1024 × 1024')
    await expect(page.locator('.holo-generation-unavailable')).toHaveCount(0)
    await page.locator('summary').filter({ hasText: '生成设置' }).click()
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(builtinModel.id)
    const resolution = page.getByRole('combobox', { name: '分辨率', exact: true })
    await expect(resolution).toHaveValue('1K')
    await expect(resolution.locator('option[value="1K"]')).toHaveJSProperty('disabled', false)
    await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })
    await expect(dialog).toContainText('12 积分')
    expect(calls.quotes).toHaveLength(1)
    expect(calls.quotes[0]).toMatchObject({ type: 't2i', count: 1, inputKeys: [], params: {
      publicModelKey: builtinModel.id, resolutionScale: '1K', aspectRatio: '1:1', size: '1024x1024', outputSize: '1024x1024',
      quality: 'high', inputFidelity: 'high', strictAlphaOutput: true, transparentBackground: true,
      transparentPngEnabled: true, autoBackgroundRemovalEnabled: false,
    } })
    expect(calls.quotes[0].params).not.toHaveProperty('outputFormat')
    expect(calls.quotes[0].params).not.toHaveProperty('output_format')
    noGeneration(calls)
    await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
    const candidate = page.getByAltText('待验收透明主体')
    await expect(candidate).toBeVisible()
    await expect(candidate).toHaveJSProperty('naturalWidth', 1024)
    await expect(candidate).toHaveJSProperty('naturalHeight', 1024)
    expect(calls.uploads).toHaveLength(1)
    // The portrait reference is uploaded unchanged; square fitting is requested
    // through transparent padding, not by resampling or cropping the input.
    expect(calls.uploads[0].postDataBuffer().includes(sourcePng)).toBe(true)
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]).toMatchObject({ expectedUnitPriceCents: 12, count: 1,
      params: { publicModelKey: builtinModel.id, resolutionScale: '1K', aspectRatio: '1:1', size: '1024x1024',
        strictAlphaOutput: true, quality: 'high', inputFidelity: 'high', transparentBackground: true, autoBackgroundRemovalEnabled: false } })
    expect(calls.created[0].params).not.toHaveProperty('outputFormat')
    expect(calls.created[0].params).not.toHaveProperty('output_format')
    expect(calls.created[0].prompt).toContain('transparent margins')
    expect(calls.created[0].prompt).toContain('cropping or stretching')
    await expect(page.getByRole('button', { name: '下载原始透明 PNG', exact: true })).toHaveCount(0)
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'original')
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
    const downloaded = await downloadedSubject(page)
    expect(downloaded).toEqual(squareSubjectPng)
    expect(hash(downloaded)).toBe(hash(squareSubjectPng))
    expect(calls.quotes).toHaveLength(1)
    expect(calls.created).toHaveLength(1)
    expect(calls.removals).toHaveLength(0)
    expect(calls.errors).toEqual([])
    await artifact(testInfo, 'builtin-output-request.json', JSON.stringify({ quote: calls.quotes[0], task: calls.created[0],
      sourceHash: hash(sourcePng), returnedAlphaHash: hash(downloaded) }, null, 2), 'application/json')
  })

  for (const kind of ['non-PNG WebP', 'opaque checkerboard PNG']) {
    test(`the built-in format route rejects ${kind} without another generation or background removal`, async ({ page }) => {
      const output = kind === 'non-PNG WebP' ? await readFile(nonPngPath) : makePng({ checker: true, height: 1024 })
      const calls = await mocks(page, { models: [builtinModel], output, outputType: kind === 'non-PNG WebP' ? 'image/webp' : 'image/png' })
      await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
      await chooseVisiblePicture(page)
      await layersFromCreation(page)
      await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })
      await expect(dialog).toContainText('12 积分')
      noGeneration(calls)
      await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
      await expect(page.locator('.holo-error')).toContainText(kind === 'non-PNG WebP'
        ? '透明主体必须是真实 PNG 文件' : '未检测到足够的真实透明区域')
      await expect(page.getByRole('button', { name: '采用此图层', exact: true })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '透明主体', exact: true })).toHaveCount(0)
      await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'original')
      expect(calls.created[0].params).not.toHaveProperty('outputFormat')
      expect(calls.created[0].params.strictAlphaOutput).toBe(true)
      expect(calls.created[0].params.quality).toBe('high')
      expect(calls.created[0].params.autoBackgroundRemovalEnabled).toBe(false)
      expect(calls.quotes).toHaveLength(1)
      expect(calls.uploads).toHaveLength(1)
      expect(calls.created).toHaveLength(1)
      expect(calls.removals).toHaveLength(0)
      expect(calls.errors).toEqual([])
    })
  }

  test('a 9:21 reference selects a legal 4K plan before quoting', async ({ page }) => {
    const calls = await mocks(page, { models: [{ ...goodModel, aspectRatios: ['9:21'] }] })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseVisiblePicture(page, { buffer: tallPng, name: 'tall-picture.png' })
    await layersFromCreation(page)
    await expect(page.locator('.holo-generation-summary')).toContainText('1648 × 3840')
    await page.locator('summary').filter({ hasText: '生成设置' }).click()
    const resolution = page.getByRole('combobox', { name: '分辨率', exact: true })
    await expect(resolution).toHaveValue('4K')
    await expect(resolution.locator('option[value="1K"]')).toHaveJSProperty('disabled', true)
    await expect(resolution.locator('option[value="2K"]')).toHaveJSProperty('disabled', true)
    await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })
    await expect(dialog).toContainText('12 积分')
    expect(calls.quotes[0].params).toMatchObject({ resolutionScale: '4K', aspectRatio: '9:21', size: '1648x3840', strictAlphaOutput: true })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    noGeneration(calls)
  })

  for (const quoteMode of ['unavailable', 'hang']) {
    test(`quote ${quoteMode} releases the form and only an explicit retry can show a new price`, async ({ page }) => {
      const calls = await mocks(page, { controlledClock: quoteMode === 'hang' })
      calls.quoteMode = quoteMode
      calls.checkpoint = 'configuration mocked'
      await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
      calls.checkpoint = 'page loaded'
      await chooseVisiblePicture(page)
      calls.checkpoint = 'picture selected'
      await layersFromCreation(page)
      calls.checkpoint = 'generation form visible'
      const generate = page.getByRole('button', { name: '生成精细主体', exact: true })
      await generate.click()
      calls.checkpoint = 'initial quote requested'
      await expect.poll(() => calls.quotes.length).toBe(1)
      if (quoteMode === 'hang') {
        await expect(generate).toBeDisabled()
        await page.clock.fastForward(20_100)
        await expect(page.locator('.holo-inline-error')).toContainText('读取报价超时')
        await expect.poll(() => calls.abortedQuotes).toBe(1)
      } else await expect(page.locator('.holo-inline-error')).toContainText('报价服务暂时不可用')
      calls.checkpoint = 'quote error shown'
      await expect(generate).toBeEnabled()
      await expect(page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })).toHaveCount(0)
      expect(calls.quotes).toHaveLength(1)
      noGeneration(calls)
      calls.quoteMode = 'success'
      // Acknowledge the visible error before retrying. This is a separate user
      // action and respects the site's 500 ms same-button double-click guard.
      await page.getByRole('button', { name: '关闭错误', exact: true }).click()
      calls.checkpoint = 'quote error acknowledged'
      await expect(page.locator('.holo-inline-error')).toHaveCount(0)
      await generate.click()
      calls.checkpoint = 'explicit retry clicked'
      await expect.poll(() => calls.quotes.length).toBe(2)
      const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })
      await expect(dialog).toContainText('12 积分')
      calls.checkpoint = 'retry price confirmed'
      expect(calls.quotes).toHaveLength(2)
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(generate).toBeEnabled()
      noGeneration(calls)
    })
  }

  test('an unsupported history response arriving after the quote blocks the final confirmation', async ({ page }) => {
    const calls = await mocks(page, { history: [failedRecord()], holdHistory: true })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await chooseVisiblePicture(page)
    await layersFromCreation(page)
    await page.getByRole('button', { name: '生成精细主体', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: '确认生成透明主体？', exact: true })
    await expect(dialog).toContainText('12 积分')
    await expect(page.locator('.holo-quick-tools button[aria-label="选择图片"]')).toBeDisabled()
    await expect.poll(() => calls.pendingHistory.length).toBeGreaterThan(0)
    calls.holdHistory = false
    const historyReplies = await Promise.allSettled(calls.pendingHistory.map(route => fulfillJson(route, { items: calls.records, nextCursor: null })))
    expect(historyReplies.some(result => result.status === 'fulfilled')).toBe(true)
    await expect(page.locator('.holo-generation-unavailable')).toContainText('拒绝了本次请求的透明背景参数')
    await dialog.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: '生成精细主体', exact: true })).toBeDisabled()
    expect(calls.quotes).toHaveLength(1)
    noGeneration(calls)
  })

  test('unsupported failed history recovers the source, explains the block, and requires an explicit recheck', async ({ page }, testInfo) => {
    const failed = failedRecord()
    const calls = await mocks(page, { history: [failed] })
    await page.goto(`/holo-card?task=${failed.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.holo-status')).toHaveText('版式已就绪 · 待分离主体')
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'original')
    await openEditor(page, '图层')
    await expect(page.locator('.holo-inline-error')).toContainText('拒绝了本次透明背景参数')
    await expect(page.locator('.holo-generation-unavailable')).toContainText('拒绝了本次请求的透明背景参数')
    await expect(page.getByRole('button', { name: '生成精细主体', exact: true })).toBeDisabled()
    await page.locator('summary').filter({ hasText: '查看原始错误' }).click()
    await expect(page.locator('.holo-inline-error')).toContainText(unsupportedMessage)
    await expect(page.getByRole('button', { name: '用当前图片继续制卡', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '导入透明 PNG 继续', exact: true })).toBeEnabled()
    const reads = calls.configReads
    await page.getByRole('button', { name: '更换线路后重新检查', exact: true }).click()
    await expect.poll(() => calls.configReads).toBeGreaterThan(reads)
    await expect(page.getByRole('button', { name: '生成精细主体', exact: true })).toBeEnabled()
    expect(calls.quotes).toHaveLength(0)
    noGeneration(calls)
    const choosing = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入透明 PNG 继续', exact: true }).click()
    await (await choosing).setFiles({ name: 'existing-subject.png', mimeType: 'image/png', buffer: subjectPng })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    await artifact(testInfo, 'failed-generation-recovery.png', await page.screenshot())
    noGeneration(calls)
  })

  test('successful history requires adoption and later failed recovery cannot replace an adopted work', async ({ page }) => {
    const completed = record({ params: { ...record().params, sourceName: 'adopted-picture.png' } })
    const failed = failedRecord({ params: { ...record().params, sourceName: 'other-failed-picture.png' } })
    const calls = await mocks(page, { history: [completed, failed] })
    await page.goto(`/holo-card?task=${completed.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await expect(page.getByRole('tab', { name: '原图', exact: true })).toHaveCount(0)
    await expect(page.locator('.holo-upload')).not.toContainText('adopted-picture.png')
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    await expect(page.locator('.holo-upload')).toContainText('adopted-picture.png')
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    await openEditor(page, '记录')
    await page.locator('.holo-history').getByRole('button', { name: /other-failed-picture\.png/ }).click()
    await openEditor(page, '图层')
    await expect(page.locator('.holo-inline-error')).toContainText('拒绝了本次透明背景参数')
    await expect(page.locator('.holo-status')).toHaveText('同款已完成')
    await expect(page.locator('.holo-upload')).toContainText('adopted-picture.png')
    await expect(page.locator('.holo-upload')).not.toContainText('other-failed-picture.png')
    await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-mode', 'layered')
    expect(await downloadedSubject(page)).toEqual(subjectPng)
    expect(calls.quotes).toHaveLength(0)
    noGeneration(calls)
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`help and creation instructions stay usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      const calls = await mocks(page, { signedIn: false })
      await page.setViewportSize(viewport)
      await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
      const guide = page.getByRole('complementary', { name: '制卡步骤', exact: true })
      await expect(guide).toBeVisible()
      await expect(guide).toContainText('选人物')
      await expect(guide).toContainText('准备主体')
      await expect(guide).toContainText('同款完成')
      const guideBox = await guide.boundingBox()
      expect(guideBox.x).toBeGreaterThanOrEqual(0)
      expect(guideBox.x + guideBox.width).toBeLessThanOrEqual(viewport.width)
      expect(guideBox.y).toBeGreaterThanOrEqual(0)
      expect(guideBox.y + guideBox.height).toBeLessThanOrEqual(viewport.height)
      await page.getByRole('button', { name: '使用说明', exact: true }).click()
      const help = page.getByRole('dialog', { name: '把示例换成你的人物', exact: true })
      await expect(help).toBeVisible()
      const box = await help.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      await expect(help.getByRole('button', { name: '关闭使用说明', exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(help.getByRole('button', { name: '选择图片开始', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(help.getByRole('button', { name: '关闭使用说明', exact: true })).toBeFocused()
      await artifact(testInfo, `creation-help-${viewport.width}.png`, await page.screenshot())
      const choosing = page.waitForEvent('filechooser')
      await help.getByRole('button', { name: '选择图片开始', exact: true }).click()
      await (await choosing).setFiles({ name: 'help-picture.png', mimeType: 'image/png', buffer: sourcePng })
      await expect(help).toBeHidden()
      await expect(page.locator('.holo-upload')).toContainText('help-picture.png')
      await expect(page.getByRole('button', { name: '开始生成同款', exact: true })).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(calls.quotes).toHaveLength(0)
      noGeneration(calls)
    })
  }
})
