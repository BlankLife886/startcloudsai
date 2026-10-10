import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { expect } from '@playwright/test'
import { fulfillJson } from './authMocks.js'
import { installVisualBaseline } from './visualBaseline.js'

const subjectPath = fileURLToPath(new URL('../../../public/holo-samples/astral-v1/subject.png', import.meta.url))
const sourceUrl = '/api/v1/files/uploads/holo-template/source.png'
const outputUrl = '/api/v1/files/generated/holo-template/subject.png'
const user = { id: 'template-e2e-user', username: 'Template user', email: 'template-e2e@example.com' }
const model = {
  id: 'template-image2-native', name: 'gpt-image-2', label: 'gpt-image-2', default: true,
  status: 'available', transparentBackground: true, outputFormats: [], qualities: ['high'],
  maxReferenceImages: 8, resolutions: ['1K'], aspectRatios: ['1:1', '2:3', '3:4'],
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, content) {
  const body = Buffer.concat([Buffer.from(type), content]), result = Buffer.alloc(body.length + 8)
  result.writeUInt32BE(content.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
  return result
}

function png(kind, width = 1024, height = 1024) {
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + x * 4 + 1
    let pixel = [0, 0, 0, 0]
    if (kind === 'opaque') pixel = [40 + Math.floor(x / width * 150), 85 + Math.floor(y / height * 110), Math.floor((x + y) / 64) % 2 ? 200 : 65, 255]
    if (kind === 'checker') {
      const value = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? 170 : 240
      pixel = [value, value, value, 255]
    }
    if (kind === 'lineart') {
      const line = x > width * .2 && x < width * .8 && y > height * .15 && y < height * .85
        && (Math.abs(x - width * .5) < 4 || Math.abs(y - height * .5) < 4)
      pixel = line ? [0, 0, 0, 255] : [255, 255, 255, 255]
    }
    if (kind === 'calibration') {
      const distance = Math.hypot(x - 512, y - 512)
      if (distance <= 130) pixel = [240, 32, 208, Math.round(Math.min(1, (130 - distance) / 4) * 255)]
      for (const [left, top, color] of [[220, 500, [255, 32, 32]], [780, 500, [32, 255, 32]],
        [260, 100, [32, 96, 255]], [780, 900, [32, 240, 240]]]) {
        if (x >= left && x < left + 24 && y >= top && y < top + 24) pixel = [...color, 255]
      }
      // The fitter must include alpha=1 strands, even though they barely show
      // over the template. These deliberately define the extreme bounds.
      if (x === 190 && y >= 80 && y < 901 || x === 833 && y === 944) pixel = [32, 220, 255, 1]
    }
    for (let channel = 0; channel < 4; channel++) rows[offset + channel] = pixel[channel]
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const opaquePng = png('opaque', 1024, 1536)
const squarePng = png('calibration')
const alphaBounds = { x: 190, y: 80, width: 644, height: 865 }

async function setup(page, { signedIn = true, viewport = { width: 1440, height: 900 } } = {}) {
  await installVisualBaseline(page)
  await page.clock.setSystemTime(new Date('2026-09-09T04:00:00Z'))
  await page.setViewportSize(viewport)
  const calls = { quotes: [], uploads: [], created: [], removals: [], errors: [] }
  page.on('pageerror', error => calls.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && /THREE|WebGL|shader|GLSL/i.test(message.text())) calls.errors.push(message.text()) })
  page.on('request', request => { if (/background[-_]remove|remove[-_]background|background-removal/i.test(request.url())) calls.removals.push(request.url()) })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: signedIn ? user : null }))
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, { features: {
    'ai.wallpaperGeneration': { enabled: true, config: { publicModels: [model] } },
  }, blacklist: { blocked: false }, routes: {} }))
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { availableCents: 1000, balanceCents: 1000 }))
  await page.route('**/api/v1/uploads', route => {
    calls.uploads.push(route.request())
    return fulfillJson(route, { key: 'uploads/holo-template/source.png', url: sourceUrl })
  })
  let task = null
  await page.route('**/api/v1/tasks**', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/quote')) {
      calls.quotes.push(request.postDataJSON())
      return fulfillJson(route, { unitPriceCents: 12, totalPriceCents: 12, count: 1 })
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); calls.created.push(body)
      task = { id: 'template-generated', type: 't2i', status: 'succeeded', params: body.params,
        inputKeys: body.inputKeys, originalUrls: [outputUrl], outputUrls: [outputUrl], createdAt: '2026-09-09T04:00:00Z' }
      return fulfillJson(route, { task: { ...task, status: 'queued' } })
    }
    if (url.pathname === '/api/v1/tasks') return fulfillJson(route, { items: task ? [task] : [], nextCursor: null })
    return fulfillJson(route, { task })
  })
  await page.route(`**${sourceUrl}`, route => route.fulfill({ contentType: 'image/png', body: opaquePng }))
  // This synthetic result checks adoption behavior, not model reconstruction quality.
  await page.route(`**${outputUrl}`, route => route.fulfill({ contentType: 'image/png', body: squarePng }))
  await page.route('**/src/features/holo-card/useCardMotion.js*', async route => {
    const response = await route.fetch(), source = await response.text()
    const marker = 'return { engineRef, controlsRef, state };'
    if (!source.includes(marker)) throw new Error('Read-only stage accessor needs updating')
    // Expose the existing UI stage ref for geometry assertions. Rendering,
    // inputs, callbacks, and settings are unchanged by this test-only response.
    const body = source.replace(marker, 'globalThis.__templateStageState = () => controlsRef.current?.getState();\n  globalThis.__templateTextPng = () => engineRef.current?.exportTextPng();\n  ' + marker)
    await route.fulfill({ response, body })
  })
  return calls
}

async function stageState(page) { return page.evaluate(() => window.__templateStageState?.()) }

async function readyCard(page) {
  // Let the accepted file's blob URLs reach the stage effects before reading
  // readiness; the previous demo can remain ready during that React commit.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect.poll(async () => (await stageState(page))?.ready).toBe(true)
  const stage = page.locator('[role="group"]:has(> canvas)')
  await expect(stage).toHaveCount(1)
  await expect(stage.locator('canvas')).toHaveCSS('transform', 'none')
  await page.evaluate(() => document.fonts.ready)
  return stage
}

async function bytes(download) {
  expect(await download.failure()).toBeNull()
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function exportCard(page, label) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  const result = await bytes(await pending)
  expect([result.readUInt32BE(16), result.readUInt32BE(20)]).toEqual([1600, 2400])
  return result
}

async function picture(page, name, buffer) {
  const choosing = page.waitForEvent('filechooser')
  const guide = page.getByRole('button', { name: '制作同款', exact: true })
  const footer = page.getByRole('button', { name: '选图制作同款', exact: true })
  if (await guide.isVisible()) await guide.click()
  else if (await footer.isVisible()) await footer.click()
  else await page.getByRole('button', { name: '选择图片', exact: true }).click()
  await (await choosing).setFiles({ name, mimeType: 'image/png', buffer })
  await expect(page.locator('.holo-upload')).toContainText(name)
  await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeEnabled()
}

async function openEditor(page, name) {
  const dialog = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
  if (!await dialog.isVisible()) await page.getByRole('button', { name: name === '记录' ? '生成记录' : `${name}面板`, exact: true }).click()
  await dialog.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name, exact: true }).click()
  return dialog
}

async function closeEditor(page) {
  const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
  if (await editor.isVisible()) await page.getByRole('button', { name: '关闭编辑面板', exact: true }).click()
}

async function rawSubject(page) {
  await openEditor(page, '图层')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原始透明 PNG', exact: true }).click()
  return bytes(await pending)
}

function fourLayers(state) {
  expect(state.ready).toBe(true)
  expect(state.hasEffects).toBe(true)
  expect(state.sourceDimensions.background).toEqual({ width: 1024, height: 1536 })
  expect(state.sourceDimensions.effects).toEqual({ width: 1024, height: 1536 })
  expect(state.layerDepths.background).toBeCloseTo(.002, 5)
  expect(state.layerDepths.subject).toBeCloseTo(.114, 5)
  expect(state.layerDepths.effects).toBeCloseTo(.185, 5)
  expect(state.layerDepths.text).toBeCloseTo(.226, 5)
}

function noAI(calls) {
  expect(calls.quotes).toHaveLength(0)
  expect(calls.uploads).toHaveLength(0)
  expect(calls.created).toHaveLength(0)
  expect(calls.removals).toHaveLength(0)
  expect(calls.errors).toEqual([])
}

async function artifact(testInfo, name, data, contentType = 'image/png') {
  const path = testInfo.outputPath(name)
  await writeFile(path, data)
  await testInfo.attach(name, { path, contentType })
}

async function pixelsEqual(page, first, second) {
  return page.evaluate(async inputs => {
    const decoded = await Promise.all(inputs.map(async source => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
      return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data }
    }))
    const [a, b] = decoded
    if (a.width !== b.width || a.height !== b.height) throw new Error('Export dimensions differ')
    let changedPixels = 0, maxDelta = 0
    for (let i = 0; i < a.data.length; i += 4) {
      let delta = 0
      for (let c = 0; c < 4; c++) delta += Math.abs(a.data[i + c] - b.data[i + c])
      if (delta) changedPixels++
      maxDelta = Math.max(maxDelta, delta)
    }
    return { width: a.width, height: a.height, changedPixels, maxDelta }
  }, [first.toString('base64'), second.toString('base64')])
}

async function calibrationPixels(page, image) {
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const regions = Object.fromEntries(['circle', 'red', 'green', 'blue', 'cyan'].map(name => [name,
      { count: 0, left: canvas.width, right: -1, top: canvas.height, bottom: -1 }]))
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4, r = data[offset], g = data[offset + 1], b = data[offset + 2]
      const name = r > 210 && g < 65 && b > 150 ? 'circle'
        : r > 210 && g < 75 && b < 80 ? 'red' : g > 210 && r < 75 && b < 90 ? 'green'
          : b > 210 && r < 70 && g > 50 && g < 140 ? 'blue' : r < 80 && g > 190 && b > 190 ? 'cyan' : ''
      if (!name) continue
      const region = regions[name]; region.count++
      region.left = Math.min(region.left, x); region.right = Math.max(region.right, x)
      region.top = Math.min(region.top, y); region.bottom = Math.max(region.bottom, y)
    }
    return regions
  }, image.toString('base64'))
}

export { subjectPath, opaquePng, squarePng, alphaBounds, png, hash, setup, stageState, readyCard, bytes, exportCard, picture, openEditor, closeEditor, rawSubject, fourLayers, noAI, artifact, pixelsEqual, calibrationPixels }
