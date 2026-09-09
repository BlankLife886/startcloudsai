import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { expect as playwrightExpect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const expect = playwrightExpect.configure({ timeout: Number(process.env.HOLO_E2E_WAIT_MS) || 8_000 })

const sampleRoot = fileURLToPath(new URL('../../public/holo-samples/astral-v1/', import.meta.url))
const artifactRoot = fileURLToPath(new URL('../../../../.artifacts/', import.meta.url))
const portraitPath = fileURLToPath(new URL('../../public/sucai/profile-hero-character.png', import.meta.url))
const stageName = '立体镭射样卡，移动鼠标或拖动查看，双击追光，方向键旋转，Home 键归正'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function openSample(page, { viewport = { width: 1440, height: 900 }, reducedMotion = 'reduce' } = {}) {
  await installVisualBaseline(page)
  // GSAP's ticker uses Date.now, so a fixed clock would freeze its real motion.
  await page.clock.setSystemTime(new Date('2026-08-11T04:00:00Z'))
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion })
  const errors = [], generationRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|WebGL|shader|GLSL/i.test(message.text())) errors.push(message.text())
  })
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/.*(?:tasks|uploads|image|background)/i.test(request.url())) generationRequests.push(request.url())
  })
  await page.goto('/holo-card/sample', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '星间旅人', exact: true })).toBeVisible()
  const stage = page.getByRole('group', { name: stageName, exact: true })
  await expect(stage).toHaveAttribute('data-sample-state', 'ready', { timeout: 20_000 })
  await expect(stage.locator('canvas')).toHaveCSS('transform', 'none')
  await expect(stage.locator('canvas')).toHaveCSS('opacity', '1')
  await page.evaluate(() => document.fonts.ready)
  return { stage, canvas: stage.locator('canvas'), errors, generationRequests }
}

async function bytesFromDownload(download) {
  expect(await download.failure()).toBeNull()
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function downloadFrom(page, button) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const download = await pending
  return { name: download.suggestedFilename(), bytes: await bytesFromDownload(download) }
}

async function artifact(testInfo, name, bytes, contentType = 'image/png') {
  await mkdir(artifactRoot, { recursive: true })
  const path = `${artifactRoot}/${name}`
  await writeFile(path, bytes)
  await testInfo.attach(name, { path, contentType })
}

async function pngStats(page, bytes) {
  return page.evaluate(async base64 => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    let transparent = 0, partial = 0, opaque = 0, solid = 0, edge = 0, maxAlpha = 0
    const bounds = { left: img.width, top: img.height, right: -1, bottom: -1 }
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const alpha = data[(y * img.width + x) * 4 + 3]
      if (!alpha) transparent++
      else if (alpha === 255) opaque++
      else partial++
      if (alpha >= 250) solid++
      if (alpha > 0 && alpha < 250) edge++
      maxAlpha = Math.max(maxAlpha, alpha)
      if (alpha > 16) {
        bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x)
        bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y)
      }
    }
    const pixels = img.width * img.height
    return { width: img.width, height: img.height, pixels, transparent, partial, opaque, solid, edge, maxAlpha,
      transparentRatio: transparent / pixels, partialRatio: partial / pixels, opaqueRatio: opaque / pixels, solidRatio: solid / pixels, bounds }
  }, bytes.toString('base64'))
}

async function inspectTextOverlap(page, subject, text) {
  return page.evaluate(async ([subject64, text64]) => {
    const decode = async base64 => {
      const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
      return { canvas, ctx, data: ctx.getImageData(0, 0, img.width, img.height).data }
    }
    const subject = await decode(subject64), text = await decode(text64)
    const { width, height } = subject.canvas
    if (text.canvas.width !== width || text.canvas.height !== height) throw new Error('Text and portrait dimensions differ')
    const mask = document.createElement('canvas'); mask.width = width; mask.height = height
    const ctx = mask.getContext('2d'), pixels = ctx.createImageData(width, height)
    const zones = { full: [0, 1], top: [0, .15], face: [.15, .45], bottom: [.78, .92] }
    const stats = Object.fromEntries(Object.keys(zones).map(name => [name, { pixels: 0, subject: 0, text: 0, overlap: 0, weightedOverlap: 0 }]))
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const sa = subject.data[offset + 3], ta = text.data[offset + 3]
      for (const [name, [from, to]] of Object.entries(zones)) if (y / height >= from && y / height < to) {
        const s = stats[name]; s.pixels++
        if (sa > 16) s.subject++
        if (ta > 16) s.text++
        if (sa > 16 && ta > 16) s.overlap++
        s.weightedOverlap += sa / 255 * ta / 255
      }
      pixels.data[offset] = ta > 16 && sa > 16 ? 255 : ta > 16 ? 56 : 0
      pixels.data[offset + 1] = ta > 16 && sa <= 16 ? 220 : sa > 16 && ta <= 16 ? 150 : 20
      pixels.data[offset + 2] = sa > 16 ? 200 : 40
      pixels.data[offset + 3] = sa > 16 || ta > 16 ? 255 : 25
    }
    for (const s of Object.values(stats)) {
      s.overlapPerSubject = s.subject ? s.overlap / s.subject : 0
      s.overlapPerText = s.text ? s.overlap / s.text : 0
      s.textCoverage = s.text / s.pixels
    }
    ctx.putImageData(pixels, 0, 0)
    return { stats, mask: mask.toDataURL('image/png').split(',')[1] }
  }, [subject.toString('base64'), text.toString('base64')])
}

async function stableCanvas(canvas) {
  let previous = '', identical = 0, result
  await expect.poll(async () => {
    // Compare card RGBA pixels independently of the continuously moving atmosphere.
    result = Buffer.from((await canvas.evaluate(element => element.toDataURL('image/png'))).split(',')[1], 'base64')
    const value = hash(result); identical = value === previous ? identical + 1 : 0; previous = value
    return identical
  }, { timeout: 8_000, intervals: [120] }).toBeGreaterThanOrEqual(2)
  return result
}

async function difference(page, first, second) {
  return page.evaluate(async sources => {
    const images = await Promise.all(sources.map(async source => {
      const img = new Image(); img.src = `data:image/png;base64,${source}`; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
      return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data }
    }))
    const [a, b] = images
    if (a.width !== b.width || a.height !== b.height) throw new Error('Comparison dimensions changed')
    let changed = 0, totalDelta = 0, maxDelta = 0
    for (let i = 0; i < a.data.length; i += 4) {
      const delta = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      if (delta > 6) changed++
      totalDelta += delta; maxDelta = Math.max(maxDelta, delta)
    }
    return { changedPixels: changed, changedRatio: changed / (a.width * a.height), meanDelta: totalDelta / (a.width * a.height), maxDelta }
  }, [first.toString('base64'), second.toString('base64')])
}

async function activate(button) {
  // Keyboard activation keeps the pointer over the card, preserving its current angle.
  await expect(button).toBeVisible()
  await button.focus()
  await expect(button).toBeFocused()
  await button.press('Space')
}

async function installSampleHarness(page) {
  await page.route('**/__sample-relief-test', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#f5f3ee}#stage{height:100vh;width:100%}</style></head>
      <body><div id="stage"></div><script type="module">
      import { createSampleReliefRenderer } from '/src/features/holo-card/sample-relief-renderer.js';
      import { ASTRAL_SAMPLE } from '/src/features/holo-card/astral-design-layers.js';
      const host = document.getElementById('stage');
      window.sampleEngine = createSampleReliefRenderer(host, {
        onReady: ready => host.dataset.state = ready ? 'ready' : 'loading',
        onError: error => { host.dataset.state = 'error'; host.dataset.error = error; },
      });
      window.sampleEngine.setSettings({ ...ASTRAL_SAMPLE, foil: 'gold', foilStrength: .65, depth: 1 });
      await window.sampleEngine.setImages(ASTRAL_SAMPLE.assets);
      </script></body></html>`,
  }))
  await page.goto('/__sample-relief-test', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'ready')
}

test.describe('Astral relief sample', () => {
  test('sample is ready and exports intact real layers with true alpha and a 1600x2400 image', async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    const { canvas, errors, generationRequests } = await openSample(page)
    await stableCanvas(canvas)
    const image = await downloadFrom(page, '保存画面')
    expect(image.name).toBe('astral-front.png')
    const exported = await pngStats(page, image.bytes)
    expect([exported.width, exported.height]).toEqual([1600, 2400])
    expect(exported.opaqueRatio).toBeGreaterThan(.65)
    expect(exported.transparentRatio).toBeGreaterThan(.05)
    await artifact(testInfo, 'astral-sample-export-1600x2400.png', image.bytes)
    await artifact(testInfo, 'astral-sample-front-layout.png', await page.screenshot({ animations: 'disabled' }))

    await page.getByRole('button', { name: '作品信息', exact: true }).click()
    const pack = await downloadFrom(page, '下载分层素材')
    expect(pack.name).toBe('astral-relief-card-assets.zip')
    const files = unzipSync(pack.bytes)
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'background.png', 'card-config.json', 'effects.png', 'subject.png', 'text.png'])
    const stats = {}, hashes = {}
    for (const name of ['background', 'subject', 'effects']) {
      const bytes = Buffer.from(files[`${name}.png`]), original = await readFile(`${sampleRoot}/${name}.png`)
      expect(hash(bytes)).toBe(hash(original))
      hashes[name] = hash(bytes)
      stats[name] = await pngStats(page, bytes)
      expect([stats[name].width, stats[name].height]).toEqual([1024, 1536])
    }
    expect(hashes.subject).toBe(hash(await readFile(portraitPath)))
    expect(stats.background.opaqueRatio).toBe(1)
    expect(stats.subject.transparentRatio).toBeGreaterThan(.1)
    // The existing portrait's opaque-looking ink is alpha 250–252, preserved byte-for-byte.
    expect(stats.subject.solidRatio).toBeGreaterThan(.1)
    expect(stats.subject.edge).toBeGreaterThan(1_000)
    expect(stats.effects.transparentRatio).toBeGreaterThan(.8)
    expect(stats.effects.partial).toBeGreaterThan(1_000)
    const textPng = Buffer.from(files['text.png'])
    hashes.text = hash(textPng)
    stats.text = await pngStats(page, textPng)
    expect([stats.text.width, stats.text.height]).toEqual([1024, 1536])
    expect(stats.text.transparentRatio).toBeGreaterThan(.8)
    expect(stats.text.opaque + stats.text.partial).toBeGreaterThan(1_000)
    const overlap = await inspectTextOverlap(page, Buffer.from(files['subject.png']), textPng)
    expect(overlap.stats.face.text).toBe(0)
    expect(overlap.stats.full.overlapPerSubject).toBeLessThan(.1)
    const config = JSON.parse(strFromU8(files['card-config.json']))
    expect(config).toMatchObject({ version: 1, sourceMode: 'relief', canvas: { width: 1024, height: 1536 }, parameters: { foil: 'gold', foilStrength: .65, depth: 1 }, assets: { background: 'background.png', subject: 'subject.png', effects: 'effects.png', text: 'text.png' } })
    expect(config.provenance).toContain('未生成新的AI画作')
    await artifact(testInfo, 'astral-relief-card-assets.zip', pack.bytes, 'application/zip')
    await artifact(testInfo, 'astral-sample-text.png', textPng)
    await artifact(testInfo, 'astral-sample-text-subject-mask.png', Buffer.from(overlap.mask, 'base64'))
    await artifact(testInfo, 'astral-sample-assets-qa.json', Buffer.from(JSON.stringify({ stats, hashes, exported, overlap: overlap.stats, config }, null, 2)), 'application/json')
    if (process.env.UPDATE_SAMPLE_ARTIFACTS === '1') {
      await writeFile(`${sampleRoot}/text.png`, textPng)
      expect(hash(await readFile(`${sampleRoot}/text.png`))).toBe(hashes.text)
    }
    expect(generationRequests).toEqual([])
    expect(errors).toEqual([])
  })

  test('mouse tilt, reverse, foil and physical relief all change the rendered pixels', async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    const { stage, canvas, errors, generationRequests } = await openSample(page, { reducedMotion: 'no-preference' })
    await stage.press('Home')
    const front = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-front.png', await page.screenshot({ animations: 'allow' }))
    const box = await stage.boundingBox()
    await page.mouse.move(box.x + box.width * .09, box.y + box.height * .42)
    const left = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-left.png', await page.screenshot({ animations: 'allow' }))
    await page.mouse.move(box.x + box.width * .91, box.y + box.height * .58)
    const right = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-right.png', await page.screenshot({ animations: 'allow' }))
    const diffs = { frontToLeft: await difference(page, front, left), leftToRight: await difference(page, left, right) }
    expect(diffs.frontToLeft.changedRatio).toBeGreaterThan(.08)
    expect(diffs.leftToRight.changedRatio).toBeGreaterThan(.15)
    await activate(page.getByRole('button', { name: '镭射', exact: true }))
    const spectrum = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-spectrum.png', await page.screenshot({ animations: 'allow' }))
    diffs.goldToSpectrum = await difference(page, right, spectrum)
    expect(diffs.goldToSpectrum.changedRatio).toBeGreaterThan(.05)
    await activate(page.getByRole('button', { name: '光效设置', exact: true }))
    const gloss = page.getByRole('slider', { name: '样卡光泽', exact: true })
    await gloss.focus(); await gloss.press('Home')
    await expect(gloss).toHaveValue('0')
    const foilOff = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-foil-0.png', foilOff)
    await gloss.press('End')
    await expect(gloss).toHaveValue('1')
    const foilOn = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-foil-1.png', foilOn)
    diffs.foilOffToOn = await difference(page, foilOff, foilOn)
    expect(diffs.foilOffToOn.changedRatio).toBeGreaterThan(.08)
    await gloss.press('Escape')
    await activate(page.getByRole('button', { name: '切换为平面对照', exact: true }))
    const flat = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-flat.png', await page.screenshot({ animations: 'allow' }))
    await activate(page.getByRole('button', { name: '切换为浮雕层次', exact: true }))
    const relief = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-relief.png', await page.screenshot({ animations: 'allow' }))
    diffs.flatToRelief = await difference(page, flat, relief)
    expect(diffs.flatToRelief.changedRatio).toBeGreaterThan(.1)
    await activate(page.getByRole('button', { name: '翻转样卡', exact: true }))
    await expect(stage).toHaveAttribute('data-sample-face', 'back')
    const back = await stableCanvas(canvas)
    await artifact(testInfo, 'astral-sample-back.png', await page.screenshot({ animations: 'allow' }))
    diffs.frontToBack = await difference(page, relief, back)
    expect(diffs.frontToBack.changedRatio).toBeGreaterThan(.2)
    await artifact(testInfo, 'astral-sample-render-differences.json', Buffer.from(JSON.stringify(diffs, null, 2)), 'application/json')
    expect(generationRequests).toEqual([])
    expect(errors).toEqual([])
  })

  test('real mesh depths increase and collapse for the flat comparison', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 750, height: 900 })
    await installSampleHarness(page)
    const raised = await page.evaluate(() => window.sampleEngine.getState())
    expect(raised.ready).toBe(true)
    expect(raised.dimensions).toEqual({ width: 1024, height: 1536 })
    expect(raised.hasEffects).toBe(true)
    expect(raised.layerDepths.background).toBeLessThan(raised.layerDepths.subject)
    expect(raised.layerDepths.subject).toBeLessThan(raised.layerDepths.effects)
    expect(raised.layerDepths.effects).toBeLessThan(raised.layerDepths.text)
    expect(raised.layerDepths.text - raised.layerDepths.background).toBeGreaterThan(.2)
    await page.evaluate(() => { window.sampleEngine.setPose({ x: .85, y: -.25 }); window.sampleEngine.setSettings({ depth: 0 }) })
    await expect.poll(async () => {
      const { layerDepths } = await page.evaluate(() => window.sampleEngine.getState())
      return layerDepths.text - layerDepths.subject
    }).toBeLessThan(.003)
    const flat = await page.evaluate(() => window.sampleEngine.getState())
    expect(flat.layerDepths.text - flat.layerDepths.subject).toBeLessThan(.003)
    expect(flat.layerDepths.text - flat.layerDepths.background).toBeLessThan(.02)
    expect(flat.pose).toEqual({ x: .85, y: -.25, flip: 0 })
    await artifact(testInfo, 'astral-sample-physical-layers.json', Buffer.from(JSON.stringify({ raised, flat }, null, 2)), 'application/json')
  })

  test('scaled translucent color and thin edges retain their color over black and white', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 520, height: 780 })
    await installSampleHarness(page)
    await page.evaluate(async () => {
      const create = () => { const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536; return canvas }
      const portrait = create(), ctx = portrait.getContext('2d')
      const data = ctx.createImageData(1024, 1536)
      for (const [left, alpha] of [[100, 5], [430, 64], [760, 128]]) {
        for (let y = 400; y < 1100; y++) for (let x = left; x < left + 152; x++) {
          if (x >= left + 120 && x < left + 149) continue
          const offset = (y * 1024 + x) * 4
          data.data[offset] = 255; data.data[offset + 1] = 160; data.data[offset + 2] = 64; data.data[offset + 3] = alpha
        }
      }
      // Black RGB in every transparent padding pixel makes any unpremultiplied filtering fringe measurable.
      ctx.putImageData(data, 0, 0)
      window.sampleAlphaFixture = { subject: portrait.toDataURL('image/png') }
      for (const color of ['black', 'white']) {
        const background = create(), context = background.getContext('2d')
        context.fillStyle = color; context.fillRect(0, 0, 1024, 1536)
        window.sampleAlphaFixture[color] = background.toDataURL('image/png')
      }
      window.sampleEngine.setSettings({ title: '', subtitle: '', collection: '', edition: '', name: '', number: '', foil: 'original', foilStrength: 0, depth: 0 })
      window.sampleEngine.setPose({ x: 0, y: 0, flip: 0 })
      await window.sampleEngine.setImages({ subject: window.sampleAlphaFixture.subject, background: window.sampleAlphaFixture.black })
    })
    const canvas = page.locator('#stage canvas')
    const black = await stableCanvas(canvas)
    await page.evaluate(() => window.sampleEngine.setImages({ subject: window.sampleAlphaFixture.subject, background: window.sampleAlphaFixture.white }))
    const white = await stableCanvas(canvas)
    const report = await page.evaluate(async sources => {
      const decode = async base64 => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
        return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
      }
      const [dark, light] = await Promise.all(sources.map(decode))
      const result = []
      // The renderer uses an orthographic camera with 1.73 vertical half extent at this viewport.
      const scale = dark.height / 3.46
      for (const [left, alpha] of [[100, 5], [430, 64], [760, 128]]) for (const thin of [false, true]) {
        const center = dark.width / 2 + ((left + (thin ? 150.5 : 60)) / 1024 - .5) * 2 * scale
        const sums = [0, 0, 0]; let totalAlpha = 0, samples = 0
        for (let y = dark.height / 2 - 8; y < dark.height / 2 + 8; y++) for (let x = Math.floor(center) - 3; x <= Math.floor(center) + 3; x++) {
          const offset = (y * dark.width + x) * 4
          const observedAlpha = 1 - (light.data[offset] - dark.data[offset]) / 255
          if (observedAlpha < .002) continue
          totalAlpha += observedAlpha; samples++
          for (let channel = 0; channel < 3; channel++) sums[channel] += dark.data[offset + channel]
        }
        result.push({ inputAlpha: alpha / 255, thin, samples, totalAlpha, recoveredColor: sums.map(value => value / totalAlpha) })
      }
      return result
    }, [black.toString('base64'), white.toString('base64')])
    await artifact(testInfo, 'astral-sample-alpha-black.png', black)
    await artifact(testInfo, 'astral-sample-alpha-white.png', white)
    await artifact(testInfo, 'astral-sample-alpha-edge-qa.json', Buffer.from(JSON.stringify(report, null, 2)), 'application/json')
    for (const sample of report) {
      expect(sample.samples, JSON.stringify(sample)).toBeGreaterThan(0)
      for (const [index, expected] of [255, 160, 64].entries()) {
        expect(Math.abs(sample.recoveredColor[index] - expected), JSON.stringify(sample)).toBeLessThan(sample.inputAlpha < .03 ? 45 : 20)
      }
    }
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`card fits at ${viewport.width}x${viewport.height} and controls remain reachable`, async ({ page }, testInfo) => {
      const { stage, canvas, errors } = await openSample(page, { viewport })
      await stableCanvas(canvas)
      const box = await stage.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height)
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2)
      await expect(page.getByRole('textbox')).toHaveCount(0)
      await expect(page.getByRole('slider')).toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // Read WebGL alpha to ensure the card itself keeps a transparent margin on all four sides.
      const pixels = await canvas.evaluate(canvas => canvas.toDataURL('image/png'))
      const stats = await pngStats(page, Buffer.from(pixels.split(',')[1], 'base64'))
      expect(stats.bounds.left).toBeGreaterThan(3)
      expect(stats.bounds.top).toBeGreaterThan(3)
      expect(stats.bounds.right).toBeLessThan(stats.width - 4)
      expect(stats.bounds.bottom).toBeLessThan(stats.height - 4)
      const card = {
        x: box.x + stats.bounds.left / stats.width * box.width,
        y: box.y + stats.bounds.top / stats.height * box.height,
        right: box.x + stats.bounds.right / stats.width * box.width,
        bottom: box.y + stats.bounds.bottom / stats.height * box.height,
      }
      expect(card.bottom - card.y).toBeGreaterThan(viewport.height * (viewport.width < 760 ? .45 : .55))
      const buttons = page.locator('.holo-sample-page button')
      for (const button of await buttons.all()) {
        const bounds = await button.boundingBox()
        const overlap = Math.max(0, Math.min(card.right, bounds.x + bounds.width) - Math.max(card.x, bounds.x))
          * Math.max(0, Math.min(card.bottom, bounds.y + bounds.height) - Math.max(card.y, bounds.y))
        expect(overlap, await button.getAttribute('aria-label') || await button.innerText()).toBe(0)
        if (viewport.width >= 760) {
          expect(bounds.y + bounds.height, await button.innerText()).toBeLessThanOrEqual(viewport.height + 1)
          expect(bounds.y).toBeGreaterThanOrEqual(0)
        } else await button.scrollIntoViewIfNeeded()
        await expect(button).toBeInViewport()
        await expect(button).toBeEnabled()
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await artifact(testInfo, `astral-sample-layout-${viewport.width}x${viewport.height}.png`, await page.screenshot({ fullPage: true, animations: 'disabled' }))
      for (const [triggerName, title] of [['光效设置', '光效设置'], ['作品信息', '关于这张卡']]) {
        const trigger = page.getByRole('button', { name: triggerName, exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: title, exact: true })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('button', { name: '关闭面板', exact: true })).toBeFocused()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        const popup = await dialog.boundingBox()
        expect(popup.x).toBeGreaterThanOrEqual(0)
        expect(popup.x + popup.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(popup.y + popup.height).toBeLessThanOrEqual(viewport.height + 1)
        if (triggerName === '光效设置') await expect(dialog.getByRole('slider', { name: '样卡光泽', exact: true })).toBeEnabled()
        else await expect(dialog.getByRole('button', { name: '下载分层素材', exact: true })).toBeEnabled()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(trigger).toBeFocused()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      }
      expect(errors).toEqual([])
    })
  }

  test('reduced motion and pause stop pointer motion while explicit controls keep working', async ({ page }, testInfo) => {
    test.setTimeout(45_000)
    const { stage, canvas, errors } = await openSample(page)
    const box = await stage.boundingBox()
    const front = await stableCanvas(canvas)
    await page.mouse.move(box.x + box.width * .05, box.y + box.height * .05)
    expect(hash(await stableCanvas(canvas))).toBe(hash(front))
    await stage.press('ArrowRight')
    const keyboard = await stableCanvas(canvas)
    expect((await difference(page, front, keyboard)).changedRatio).toBeGreaterThan(.04)
    await activate(page.getByRole('button', { name: '光效设置', exact: true }))
    await expect(page.getByRole('dialog', { name: '光效设置', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const entries = [...document.querySelectorAll('[data-sample-enter], .holo-sample-popup')]
      window.samplePreferenceHidden = []
      window.samplePreferenceObserver = new MutationObserver(() => {
        for (const entry of entries) {
          if (!entry.isConnected) continue
          const style = getComputedStyle(entry)
          if (style.visibility === 'hidden' || Number(style.opacity) === 0) window.samplePreferenceHidden.push(entry.className)
        }
      })
      for (const entry of entries) window.samplePreferenceObserver.observe(entry, { attributes: true, attributeFilter: ['style', 'class'] })
    })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await activate(page.getByRole('button', { name: '静止样卡', exact: true }))
    await expect(page.getByRole('button', { name: '启用样卡交互', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '光效设置', exact: true })).toBeVisible()
    // Preference changes must not hide the open popup. Stop observing before
    // the explicit Escape action starts its intentional exit animation.
    expect(await page.evaluate(() => { window.samplePreferenceObserver.disconnect(); return window.samplePreferenceHidden })).toEqual([])
    await page.keyboard.press('Escape')
    const paused = await stableCanvas(canvas)
    await page.mouse.move(box.x + box.width * .95, box.y + box.height * .95)
    expect(hash(await stableCanvas(canvas))).toBe(hash(paused))
    await activate(page.getByRole('button', { name: '翻转样卡', exact: true }))
    await expect(stage).toHaveAttribute('data-sample-face', 'back')
    const back = await stableCanvas(canvas)
    expect((await difference(page, paused, back)).changedRatio).toBeGreaterThan(.2)
    await activate(page.getByRole('button', { name: '复位样卡', exact: true }))
    await expect(stage).toHaveAttribute('data-sample-face', 'front')
    await expect(page.getByRole('button', { name: '静止样卡', exact: true })).toBeVisible()
    await artifact(testInfo, 'astral-sample-accessibility.png', await page.screenshot({ animations: 'allow' }))
    expect(errors).toEqual([])
  })
})
