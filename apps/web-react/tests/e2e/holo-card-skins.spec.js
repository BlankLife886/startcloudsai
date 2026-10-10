import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  subjectPath, squarePng, opaquePng, png, hash, setup, stageState, readyCard, exportCard,
  picture, openEditor, closeEditor, rawSubject, noAI, artifact, pixelsEqual,
} from './helpers/holoTemplateHarness.js'

test.use({ video: 'off' })

const SKINS = [
  ['astral', '星间旅人'], ['anime', '霓光漫游'], ['pixel', '像素勇者'],
  ['monster', '精灵图鉴'], ['farm', '四季物语'], ['duel', '秘法决斗'],
]

async function skinsPanel(page) {
  const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
  if (!await editor.isVisible()) await page.getByRole('button', { name: '卡片皮肤', exact: true }).click()
  else await editor.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name: '皮肤', exact: true }).click()
  const panel = page.locator('#holo-panel-skins')
  await expect(panel).toBeVisible()
  return panel
}

async function fold(panel, title) {
  const details = panel.locator('details').filter({ has: panel.page().locator('summary').filter({ hasText: title }) })
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click()
  return details
}

async function readySkin(page, id) {
  await readyCard(page)
  await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-card-template', id)
  await expect.poll(async () => {
    const current = await stageState(page)
    return current?.designReady && current?.skinId === id && current?.requestedSkinId === id
  }).toBe(true)
  await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function selectSkin(page, id, wait = true) {
  const panel = await skinsPanel(page)
  const title = SKINS.find(([key]) => key === id)[1]
  await panel.getByRole('button', { name: `应用${title}皮肤`, exact: true }).click()
  await expect(panel.locator(`[data-card-skin="${id}"]`)).toHaveAttribute('aria-pressed', 'true')
  if (wait) await readySkin(page, id)
  return panel
}

async function face(page, back) {
  const stage = page.locator('.holo-card-stage')
  if (await stage.getAttribute('data-holo-face') !== (back ? 'back' : 'front')) {
    await page.getByRole('button', { name: back ? '翻转卡片' : '查看正面', exact: true }).click()
  }
  await expect(stage).toHaveAttribute('data-holo-face', back ? 'back' : 'front')
  await readyCard(page)
}

async function capture(page) {
  await readyCard(page)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return Buffer.from((await page.locator('.holo-card-stage canvas').evaluate(canvas => canvas.toDataURL('image/png'))).split(',')[1], 'base64')
}

async function newCard(page, options) {
  const calls = await setup(page, { signedIn: false, ...options })
  const subject = await readFile(subjectPath)
  await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
  await picture(page, 'original-character.png', subject)
  await readySkin(page, 'astral')
  await page.getByRole('button', { name: '静止预览', exact: true }).click()
  return { calls, subject }
}

async function compareSet(page, images) {
  return page.evaluate(async entries => {
    const decoded = await Promise.all(entries.map(async ([name, base64]) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 360
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, 240, 360)
      const pixels = ctx.getImageData(0, 0, 240, 360).data, gray = new Float32Array(240 * 360), edges = new Uint8Array(gray.length)
      for (let i = 0; i < gray.length; i++) gray[i] = pixels[i * 4] * .2126 + pixels[i * 4 + 1] * .7152 + pixels[i * 4 + 2] * .0722
      for (let y = 1; y < 359; y++) for (let x = 1; x < 239; x++) {
        const i = y * 240 + x
        edges[i] = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + 240] - gray[i - 240]) > 30 ? 1 : 0
      }
      return { name, pixels, edges }
    }))
    const result = []
    for (let a = 0; a < decoded.length; a++) for (let b = a + 1; b < decoded.length; b++) {
      let different = 0, edgeDifferences = 0
      const first = decoded[a], second = decoded[b]
      for (let i = 0; i < first.edges.length; i++) {
        const p = i * 4
        if (Math.abs(first.pixels[p] - second.pixels[p]) + Math.abs(first.pixels[p + 1] - second.pixels[p + 1]) + Math.abs(first.pixels[p + 2] - second.pixels[p + 2]) > 9) different++
        if (first.edges[i] !== second.edges[i]) edgeDifferences++
      }
      result.push({ first: first.name, second: second.name, changedRatio: different / first.edges.length, edgeDifferenceRatio: edgeDifferences / first.edges.length })
    }
    return result
  }, [...images].map(([name, image]) => [name, image.toString('base64')]))
}

async function contactSheet(page, fronts, backs) {
  return Buffer.from(await page.evaluate(async entries => {
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 860
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eeeef0'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (const [index, entry] of entries.entries()) {
      const image = new Image(); image.src = `data:image/png;base64,${entry.image}`; await image.decode()
      const x = index % 6 * 256, y = Math.floor(index / 6) * 430
      ctx.fillStyle = '#252532'; ctx.font = '15px sans-serif'; ctx.fillText(entry.name, x + 12, y + 24)
      const scale = Math.min(240 / image.width, 360 / image.height)
      ctx.drawImage(image, x + 128 - image.width * scale / 2, y + 38 + (360 - image.height * scale) / 2, image.width * scale, image.height * scale)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, [...fronts, ...backs].map(([name, image]) => ({ name, image: image.toString('base64') }))), 'base64')
}

async function textLayer(page) {
  return Buffer.from(await page.evaluate(async () => {
    const blob = await window.__templateTextPng()
    return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob) })
  }), 'base64')
}

async function alphaStats(page, image) {
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let signature = 2166136261, count = 0
    const bounds = { left: canvas.width, right: -1, top: canvas.height, bottom: -1 }
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const a = data[(y * canvas.width + x) * 4 + 3]
      signature = Math.imul(signature ^ a, 16777619) >>> 0
      if (a > 8) { count++; bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x); bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y) }
    }
    return { signature, count, bounds, width: canvas.width, height: canvas.height }
  }, image.toString('base64'))
}

async function typographyReadability(page, image, artworkRect, original) {
  return page.evaluate(async ({ base64, artworkRect, baseline }) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let baselinePixels = null
    if (baseline) {
      const original = new Image(); original.src = `data:image/png;base64,${baseline}`; await original.decode()
      if (original.width !== canvas.width || original.height !== canvas.height) throw new Error('Text canvas dimensions changed')
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(original, 0, 0)
      baselinePixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const scan = (left, top, width, height) => {
      const result = { pixels: 0, nontransparent: 0, changedFromOriginal: 0, solid: 0, bright: 0, dark: 0, brightLight: 0, darkLight: 0 }
      for (let y = Math.ceil(top * canvas.height); y < Math.floor((top + height) * canvas.height); y++) {
        for (let x = Math.ceil(left * canvas.width); x < Math.floor((left + width) * canvas.width); x++) {
          const i = (y * canvas.width + x) * 4; result.pixels++
          if (data[i + 3] > 0) result.nontransparent++
          if (baselinePixels && [0, 1, 2, 3].some(channel => data[i + channel] !== baselinePixels[i + channel])) result.changedFromOriginal++
          if (data[i + 3] < 250) continue
          result.solid++
          const rgb = [data[i], data[i + 1], data[i + 2]].map(v => {
            const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
          })
          const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
          if (luminance > .5) { result.bright++; result.brightLight += luminance }
          if (luminance < .12) { result.dark++; result.darkLight += luminance }
        }
      }
      return { ...result, brightRatio: result.bright / result.pixels,
        contrast: result.bright && result.dark ? (result.brightLight / result.bright + .05) / (result.darkLight / result.dark + .05) : 0 }
    }
    return {
      // A small inset excludes the existing decorative window stroke.
      artwork: scan(artworkRect.x + .012, artworkRect.y + .008, artworkRect.width - .024, artworkRect.height - .016),
      header: scan(75 / 1024, 54 / 1536, 870 / 1024, Math.max(30 / 1536, artworkRect.y - 74 / 1536)),
      description: scan(79 / 1024, artworkRect.y + artworkRect.height + 40 / 1536, 861 / 1024,
        Math.max(40 / 1536, 1 - artworkRect.y - artworkRect.height - 180 / 1536)),
    }
  }, { base64: image.toString('base64'), artworkRect, baseline: original?.toString('base64') })
}

async function graphic(page, kind) {
  const base64 = await page.evaluate(kind => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536
    const ctx = canvas.getContext('2d')
    if (kind === 'frame') { ctx.strokeStyle = '#23ffaf'; ctx.lineWidth = 42; ctx.strokeRect(21, 21, 982, 1494); ctx.strokeStyle = '#8c39ff'; ctx.lineWidth = 10; ctx.strokeRect(68, 68, 888, 1400) }
    else { ctx.fillStyle = '#ff42d8'; for (const [x, y] of [[140, 390], [850, 980]]) { ctx.fillRect(x - 2, y - 17, 4, 34); ctx.fillRect(x - 17, y - 2, 34, 4) } }
    return canvas.toDataURL('image/png').split(',')[1]
  }, kind)
  return Buffer.from(base64, 'base64')
}

async function uploadGraphic(page, label, filename, buffer) {
  const panel = await skinsPanel(page); await fold(panel, '自备素材')
  const choosing = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: `上传${label}`, exact: true }).click()
  await (await choosing).setFiles({ name: filename, mimeType: 'image/png', buffer })
  return panel
}

test.describe('Complete editable card skins', () => {
  test('the same untouched character produces six distinct fronts and backs while user state survives', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const { calls, subject } = await newCard(page)
    let panel = await skinsPanel(page); await fold(panel, '卡面文字')
    await panel.getByRole('textbox', { name: '卡片名称', exact: true }).fill('属于我的收藏卡')
    await closeEditor(page)
    await face(page, true)
    const fronts = new Map(), backs = new Map(), states = {}
    for (const [id, title] of SKINS) {
      panel = await selectSkin(page, id)
      await expect(page.locator('.holo-card-stage')).toHaveAttribute('data-holo-face', 'back')
      expect((await stageState(page)).paused).toBe(true)
      expect((await stageState(page)).autoOrbit).toBe(false)
      await fold(panel, '卡面文字')
      await expect(panel.getByRole('textbox', { name: '卡片名称', exact: true })).toHaveValue('属于我的收藏卡')
      await closeEditor(page)
      backs.set(`${id}-back`, await capture(page))
      await face(page, false)
      fronts.set(`${id}-front`, await capture(page))
      states[id] = await stageState(page)
      expect(states[id].skinId).toBe(id)
      if (id !== 'astral') {
        expect(states[id].hasFrame).toBe(true); expect(states[id].hasBack).toBe(true)
        expect(states[id].auxiliaryLayerDepths.frame).toBeGreaterThan(states[id].layerDepths.effects)
        expect(states[id].auxiliaryLayerDepths.frame).toBeLessThan(states[id].layerDepths.text)
      }
      await artifact(testInfo, `${id}-front.png`, fronts.get(`${id}-front`))
      await artifact(testInfo, `${id}-back.png`, backs.get(`${id}-back`))
      await face(page, true)
    }
    expect(new Set(Object.values(states).map(state => JSON.stringify(state.framing.artworkRect))).size).toBe(6)
    const frontPairs = await compareSet(page, fronts), backPairs = await compareSet(page, backs)
    for (const pair of [...frontPairs, ...backPairs]) {
      expect(pair.changedRatio, JSON.stringify(pair)).toBeGreaterThan(.02)
      expect(pair.edgeDifferenceRatio, JSON.stringify(pair)).toBeGreaterThan(.005)
    }
    await selectSkin(page, 'astral'); await closeEditor(page)
    expect((await pixelsEqual(page, backs.get('astral-back'), await capture(page))).changedPixels).toBe(0)
    await face(page, false)
    expect((await pixelsEqual(page, fronts.get('astral-front'), await capture(page))).changedPixels).toBe(0)
    expect(await rawSubject(page)).toEqual(subject)
    await artifact(testInfo, 'six-skins-contact-sheet.png', await contactSheet(page, fronts, backs))
    await artifact(testInfo, 'six-skins-differences.json', JSON.stringify({ states, frontPairs, backPairs, subjectHash: hash(subject) }, null, 2), 'application/json')
    noAI(calls)
  })

  test('background frame typography effects and reverse designs mix independently and layer switches affect pixels', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const { calls, subject } = await newCard(page)
    const initialText = await textLayer(page)
    const expected = { background: 'astral', frame: 'astral', layout: 'astral', effects: 'astral', back: 'astral' }, report = []
    for (const [label, part, id] of [['背景', 'background', 'farm'], ['卡框', 'frame', 'monster'],
      ['文字排版', 'layout', 'duel'], ['前景装饰', 'effects', 'anime'], ['卡背', 'back', 'pixel']]) {
      await closeEditor(page); await face(page, part === 'back')
      const before = await capture(page)
      const panel = await skinsPanel(page); await fold(panel, '自由混搭')
      await panel.getByRole('combobox', { name: label, exact: true }).selectOption(id)
      expected[part] = id
      await expect.poll(async () => (await stageState(page)).design).toEqual(expected)
      await readySkin(page, 'astral'); await closeEditor(page)
      const pixels = await pixelsEqual(page, before, await capture(page))
      expect(pixels.changedPixels, part).toBeGreaterThan(100)
      report.push({ part, expected: { ...expected }, pixels })
    }
    await face(page, false)
    for (const [label, key] of [['显示卡框', 'frame'], ['显示前景装饰', 'effects'], ['显示文字', 'text']]) {
      const panel = await skinsPanel(page); await fold(panel, '自由混搭')
      await panel.getByRole('checkbox', { name: label, exact: true }).uncheck()
      await expect.poll(async () => (await stageState(page)).layerVisibility[key]).toBe(false)
      await readySkin(page, 'astral'); const hidden = await capture(page)
      await panel.getByRole('checkbox', { name: label, exact: true }).check()
      await expect.poll(async () => (await stageState(page)).layerVisibility[key]).toBe(true)
      await readySkin(page, 'astral')
      expect((await pixelsEqual(page, hidden, await capture(page))).changedPixels, label).toBeGreaterThan(100)
    }
    const panel = await skinsPanel(page); await fold(panel, '自由混搭')
    await panel.getByRole('combobox', { name: '卡框', exact: true }).selectOption('anime')
    await panel.getByRole('combobox', { name: '文字排版', exact: true }).selectOption('monster')
    await readySkin(page, 'astral')
    const mixed = await textLayer(page)
    const readability = await typographyReadability(page, mixed, (await stageState(page)).framing.artworkRect)
    expect(readability.artwork.nontransparent, 'mixed text backing must leave the character window clear').toBe(0)
    for (const [region, stats] of Object.entries({ header: readability.header, description: readability.description })) {
      expect(stats.brightRatio, `${region} needs a solid light panel below dark text`).toBeGreaterThan(.7)
      expect(stats.dark, `${region} still contains real dark glyphs`).toBeGreaterThan(100)
      expect(stats.contrast, `${region} light-paper/dark-ink contrast`).toBeGreaterThan(4.5)
    }
    await artifact(testInfo, 'anime-frame-monster-text-layer.png', mixed)
    await closeEditor(page)
    await artifact(testInfo, 'anime-frame-monster-layout.png', await capture(page))
    await skinsPanel(page); await fold(panel, '自由混搭')
    await panel.getByRole('combobox', { name: '文字排版', exact: true }).selectOption('astral')
    await readySkin(page, 'astral')
    const astralMixed = await textLayer(page)
    const astralReadability = await typographyReadability(page, astralMixed, (await stageState(page)).framing.artworkRect, initialText)
    expect(astralReadability.artwork.nontransparent, 'the resolved Astral typography window must remain fully transparent').toBe(0)
    expect(astralReadability.artwork.changedFromOriginal, 'astral backing must not add pixels to the resolved character window').toBe(0)
    await artifact(testInfo, 'anime-frame-astral-text-layer.png', astralMixed)
    await panel.getByRole('checkbox', { name: '显示卡框', exact: true }).uncheck()
    await readySkin(page, 'astral')
    expect((await stageState(page)).framing.artworkRect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect((await pixelsEqual(page, initialText, await textLayer(page))).changedPixels,
      'hiding the frame clears both backing panels and restores the untouched astral text layer').toBe(0)
    await artifact(testInfo, 'mixed-text-readability.json', JSON.stringify({ monster: readability, astral: astralReadability }, null, 2), 'application/json')
    expect(await rawSubject(page)).toEqual(subject)
    await artifact(testInfo, 'independent-design-parts.json', JSON.stringify(report, null, 2), 'application/json')
    noAI(calls)
  })

  test('custom transparent frame and effects enforce canvas and alpha rules while preserving uploaded bytes', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const { calls } = await newCard(page)
    await selectSkin(page, 'anime')
    const frame = await graphic(page, 'frame'), effects = await graphic(page, 'effects')
    let panel = await uploadGraphic(page, '卡框', 'my-frame.png', frame)
    await readySkin(page, 'anime')
    await expect(panel.getByRole('button', { name: '使用我的卡框', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const customFrame = await capture(page)
    for (const [name, invalid, error] of [['opaque-frame.png', opaquePng, '透明'], ['square-frame.png', squarePng, '2:3']]) {
      await uploadGraphic(page, '卡框', name, invalid)
      await expect(page.locator('.holo-error')).toContainText(error)
      await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeEnabled()
      expect((await pixelsEqual(page, customFrame, await capture(page))).changedPixels).toBe(0)
      await page.getByRole('button', { name: '关闭错误', exact: true }).click()
    }
    await uploadGraphic(page, '前景装饰', 'opaque-effects.png', opaquePng)
    await expect(page.locator('.holo-error')).toContainText('透明')
    await page.getByRole('button', { name: '关闭错误', exact: true }).click()
    panel = await uploadGraphic(page, '前景装饰', 'sparse-effects.png', effects)
    await readySkin(page, 'anime')
    await expect(panel.getByRole('button', { name: '使用我的前景装饰', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const background = png('opaque', 900, 600), back = png('checker', 1200, 800)
    await uploadGraphic(page, '背景', 'my-background.png', background); await readySkin(page, 'anime')
    panel = await uploadGraphic(page, '卡背', 'my-reverse.png', back); await readySkin(page, 'anime')
    expect((await stageState(page)).sourceDimensions.back).toEqual({ width: 1200, height: 800 })
    for (const [label, original] of [['卡框', frame], ['前景装饰', effects], ['背景', background], ['卡背', back]]) {
      const image = panel.getByRole('button', { name: `上传${label}`, exact: true }).locator('img')
      const data = await image.evaluate(async img => Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())))
      expect(Buffer.from(data)).toEqual(original)
    }
    await panel.getByRole('button', { name: '恢复皮肤卡框', exact: true }).click(); await readySkin(page, 'anime')
    await expect(panel.getByRole('button', { name: '使用我的卡框', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await panel.getByRole('button', { name: '使用我的卡框', exact: true }).click(); await readySkin(page, 'anime')
    await artifact(testInfo, 'custom-design-parts.png', await capture(page))
    noAI(calls)
  })

  test('long Chinese copy and edited values change the actual text layer without overflowing the card', async ({ page }, testInfo) => {
    const { calls } = await newCard(page)
    let panel = await selectSkin(page, 'pixel'); await fold(panel, '卡面文字')
    const before = await textLayer(page)
    const values = { '卡片名称': '穿越星海奔赴山川的勇者与伙伴共同谱写属于我们的收藏篇章', '副标题': '记录每一束光与每一次冒险',
      '角色名称': '我的专属角色', '编号': '0088', '系列': '原创收藏系列', '版本': '纪念版', '稀有度': 'UR', '属性': '风',
      '等级': '32', '生命值': '9999', '攻击': '8765', '防御': '7654', '技能名称': '星海穿行', '卡片描述': '这是用于验证长中文排版的完整说明。'.repeat(9) }
    for (const [name, value] of Object.entries(values)) await panel.getByRole('textbox', { name, exact: true }).fill(value)
    await readySkin(page, 'pixel')
    const edited = await textLayer(page), state = await alphaStats(page, edited)
    expect((await pixelsEqual(page, before, edited)).changedPixels).toBeGreaterThan(1000)
    expect(state.count).toBeGreaterThan(1000)
    expect(state.bounds.left).toBeGreaterThanOrEqual(18)
    expect(state.bounds.top).toBeGreaterThanOrEqual(18)
    expect(state.bounds.right).toBeLessThanOrEqual(state.width - 18)
    expect(state.bounds.bottom).toBeLessThanOrEqual(state.height - 18)
    await panel.getByRole('textbox', { name: '等级', exact: true }).fill('48')
    await readySkin(page, 'pixel')
    expect((await pixelsEqual(page, edited, await textLayer(page))).changedPixels).toBeGreaterThan(20)
    await artifact(testInfo, 'long-chinese-text-layer.png', edited)
    await artifact(testInfo, 'long-chinese-card.png', await capture(page))
    noAI(calls)
  })

  test('pixel treatment is reversible and changes RGB without altering the character alpha or source bytes', async ({ page }, testInfo) => {
    const { calls, subject } = await newCard(page)
    const panel = await selectSkin(page, 'pixel'); await fold(panel, '自由混搭')
    const treatment = panel.getByRole('combobox', { name: '角色画风', exact: true })
    await expect.poll(async () => (await stageState(page)).pixelated).toBe(true)
    const pixel = await capture(page), alpha = await alphaStats(page, pixel)
    await treatment.selectOption('natural'); await readySkin(page, 'pixel')
    expect((await stageState(page)).pixelated).toBe(false)
    const natural = await capture(page)
    expect((await pixelsEqual(page, pixel, natural)).changedPixels).toBeGreaterThan(500)
    expect((await alphaStats(page, natural)).signature).toBe(alpha.signature)
    await treatment.selectOption('pixel'); await readySkin(page, 'pixel')
    expect((await pixelsEqual(page, pixel, await capture(page))).changedPixels).toBe(0)
    expect(await rawSubject(page)).toEqual(subject)
    await artifact(testInfo, 'pixel-treatment.png', pixel)
    await artifact(testInfo, 'natural-treatment.png', natural)
    noAI(calls)
  })

  test('rapid skin and source replacement exports only the final complete design and no-op actions stay ready', async ({ page }) => {
    test.setTimeout(60_000)
    const { calls } = await newCard(page)
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        const delay = !this.isConnected && this.width === 1024 && this.height === 1536 ? 700 : 0
        return original.call(this, blob => delay ? setTimeout(() => callback(blob), delay) : callback(blob), ...args)
      }
    })
    await selectSkin(page, 'anime', false)
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeDisabled()
    await selectSkin(page, 'monster', false)
    await selectSkin(page, 'duel', false)
    await picture(page, 'final-square-source.png', squarePng)
    await readySkin(page, 'duel')
    const final = await stageState(page)
    expect(final.skinId).toBe('duel')
    expect(final.design).toEqual({ background: 'duel', frame: 'duel', layout: 'duel', effects: 'duel', back: 'duel' })
    expect(final.sourceDimensions.subject).toEqual({ width: 1024, height: 1024 })
    expect(await rawSubject(page)).toEqual(squarePng)
    await selectSkin(page, 'duel')
    const panel = await skinsPanel(page); await fold(panel, '专属配色')
    await panel.getByRole('button', { name: '恢复皮肤原色', exact: true }).click()
    await readySkin(page, 'duel')
    await closeEditor(page)
    await exportCard(page, '导出 PNG')
    noAI(calls)
  })

  test('all six skins remain selectable on mobile while the complete stage and save action stay usable', async ({ page }, testInfo) => {
    test.setTimeout(75_000)
    const { calls } = await newCard(page, { viewport: { width: 390, height: 844 } })
    for (const [id] of SKINS) {
      const panel = await skinsPanel(page), tile = panel.locator(`[data-card-skin="${id}"]`)
      await tile.scrollIntoViewIfNeeded(); await expect(tile).toBeInViewport()
      await tile.click(); await readySkin(page, id)
      const bounds = await panel.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      await expect(page.getByRole('button', { name: '关闭编辑面板', exact: true })).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    }
    await artifact(testInfo, 'mobile-skin-library.png', await page.screenshot())
    await closeEditor(page)
    const stage = await readyCard(page), bounds = await stage.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
    await expect(page.getByRole('button', { name: '导出同款闪卡', exact: true })).toBeInViewport()
    await exportCard(page, '导出 PNG')
    await artifact(testInfo, 'mobile-complete-skin.png', await page.screenshot())
    noAI(calls)
  })
})
