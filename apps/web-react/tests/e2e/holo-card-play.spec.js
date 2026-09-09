import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect as playwrightExpect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const expect = playwrightExpect.configure({ timeout: Number(process.env.HOLO_E2E_WAIT_MS) || 8_000 })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function prepare(page, { reducedMotion = 'no-preference', viewport = { width: 1100, height: 900 } } = {}) {
  await installVisualBaseline(page)
  // GSAP reads Date.now: keep the date reproducible while real time advances.
  await page.clock.setSystemTime(new Date('2026-09-09T04:00:00Z'))
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion })
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, options, ...args) {
      return getContext.call(this, kind, /^webgl/.test(kind) ? { ...options, preserveDrawingBuffer: true } : options, ...args)
    }
  })
  const errors = [], paidRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|WebGL|shader|GLSL/i.test(message.text())) errors.push(message.text())
  })
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/.*(?:tasks|uploads|image|background)/i.test(request.url())) paidRequests.push(request.url())
  })
  return { errors, paidRequests }
}

async function artifact(testInfo, name, body, contentType = 'image/png') {
  const path = testInfo.outputPath(name)
  await writeFile(path, body)
  await testInfo.attach(name, { path, contentType })
  return path
}

async function capture(canvas) {
  return Buffer.from((await canvas.evaluate(element => element.toDataURL('image/png'))).split(',')[1], 'base64')
}

async function stable(canvas) {
  let previous = '', equal = 0, image
  await expect.poll(async () => {
    image = await capture(canvas)
    const next = hash(image)
    equal = next === previous ? equal + 1 : 0
    previous = next
    return equal
  }, { intervals: [120], timeout: 8_000 }).toBeGreaterThanOrEqual(2)
  return image
}

async function difference(page, first, second) {
  return page.evaluate(async sources => {
    const decoded = await Promise.all(sources.map(async source => {
      const image = new Image()
      image.src = `data:image/png;base64,${source}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
    }))
    const [a, b] = decoded
    if (a.width !== b.width || a.height !== b.height) throw new Error('Render dimensions changed')
    let changedPixels = 0, maxDelta = 0, totalDelta = 0, painted = 0
    for (let i = 0; i < a.data.length; i += 4) {
      const delta = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
        + Math.abs(a.data[i + 2] - b.data[i + 2]) + Math.abs(a.data[i + 3] - b.data[i + 3])
      if (delta > 6) changedPixels++
      if (Math.max(a.data[i + 3], b.data[i + 3]) > 16) painted++
      maxDelta = Math.max(maxDelta, delta); totalDelta += delta
    }
    const pixels = a.width * a.height
    return { changedPixels, changedRatio: changedPixels / pixels, maxDelta, meanDelta: totalDelta / pixels, paintedRatio: painted / pixels }
  }, [first.toString('base64'), second.toString('base64')])
}

async function state(page) {
  return page.evaluate(() => window.playDriver.getState())
}

async function setSettings(page, values) {
  await page.evaluate(values => window.playDriver.setSettings(values), values)
}

async function finishAt(page, finish) {
  await expect.poll(async () => (await state(page)).finishWeights[finish]).toBeCloseTo(1, 5)
}

async function patternAt(page, pattern) {
  await expect.poll(async () => (await state(page)).patternWeights[pattern]).toBeCloseTo(1, 5)
}

async function elapsed(page, duration) {
  // This wait is an intentional animation observation window, not load readiness.
  await page.evaluate(duration => new Promise(resolve => setTimeout(resolve, duration)), duration)
}

async function rendererHarness(page, kind = 'sample') {
  const checks = await prepare(page)
  await page.route('**/__holo-play-renderer', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:100%;height:100%;background:#f5f2eb}body{display:grid;place-items:center}
      #stage{width:min(84vw,740px);height:90vh}</style></head><body><div id="stage"></div><script type="module">
      import { createHoloCardRenderer } from '/src/features/holo-card/holo-card-renderer.js';
      import { createSampleReliefRenderer } from '/src/features/holo-card/sample-relief-renderer.js';
      import { ASTRAL_SAMPLE } from '/src/features/holo-card/astral-design-layers.js';
      const host=document.getElementById('stage');
      const create=${kind === 'sample' ? 'createSampleReliefRenderer' : 'createHoloCardRenderer'};
      const engine=create(host,{
        onReady:ready=>{host.dataset.state=ready?'ready':'loading'},
        onError:error=>{host.dataset.state='error';host.dataset.error=error},
      });
      window.playDriver=engine;
      engine.setMotionAllowed(false);
      engine.setSettings({...ASTRAL_SAMPLE,foil:'gold',foilStrength:.85,pattern:'flow',depth:1,
        background:'#172b29',subjectScale:1,backgroundDepth:-.2,lineStrength:.4,tilt:.8,exploded:false});
      engine.setPose({x:.58,y:-.18,flip:0});
      await engine.setImages(${kind === 'sample' ? 'ASTRAL_SAMPLE.assets' : "{sourceUrl:ASTRAL_SAMPLE.assets.background,subjectUrl:ASTRAL_SAMPLE.assets.subject,backgroundUrl:ASTRAL_SAMPLE.assets.background,mode:'layered'}"});
      engine.setMotionAllowed(true);
      </script></body></html>`,
  }))
  await page.goto('/__holo-play-renderer', { waitUntil: 'domcontentloaded' })
  const stage = page.locator('#stage')
  await expect(stage).toHaveAttribute('data-state', 'ready', { timeout: 20_000 })
  const canvas = stage.locator('canvas')
  await stable(canvas)
  return { ...checks, stage, canvas }
}

async function stageHarness(page, { kind = 'sample', delaySubject = false, waitForReveal = true } = {}) {
  const checks = await prepare(page)
  if (delaySubject) await page.route('**/holo-samples/astral-v1/subject.png', async route => {
    await new Promise(resolve => setTimeout(resolve, 400))
    await route.continue()
  })
  await page.route('**/__holo-play-stage', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:100%;height:100%;background:#f5f2eb}#app{height:100%;display:grid;place-items:center}
      #stage-host{width:min(84vw,740px);height:90vh}</style></head><body><div id="app"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const reactModule=await import('/node_modules/.vite/deps/react.js');
      const reactDomModule=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {createElement,useState,useRef}=reactModule.default||reactModule;
      const {createRoot}=reactDomModule.default||reactDomModule;
      const {SampleReliefStage}=await import('/src/features/holo-card/SampleReliefStage.jsx');
      const {HoloCardStage}=await import('/src/features/holo-card/HoloCardStage.jsx');
      const {ASTRAL_SAMPLE}=await import('/src/features/holo-card/astral-design-layers.js');
      function App(){
        const [settings,setSettings]=useState({...ASTRAL_SAMPLE,foil:'gold',foilStrength:.85,pattern:'flow',depth:1,
          background:'#172b29',subjectScale:1,backgroundDepth:-.2,tilt:.8,autoOrbit:false,exploded:false,paused:false});
        const stageRef=useRef(null);
        window.playDriver={setSettings:next=>setSettings(current=>({...current,...next})),getState:()=>stageRef.current?.getState(),
          shine:()=>stageRef.current?.shine(),reset:()=>stageRef.current?.reset()};
        const props={settings,stageRef,onReady:ready=>{document.getElementById('app').dataset.ready=String(ready)}};
        return createElement('div',{id:'stage-host'},${kind === 'sample'
          ? 'createElement(SampleReliefStage,{...props,assets:ASTRAL_SAMPLE.assets})'
          : "createElement(HoloCardStage,{...props,sourceUrl:ASTRAL_SAMPLE.assets.background,subjectUrl:ASTRAL_SAMPLE.assets.subject,backgroundUrl:ASTRAL_SAMPLE.assets.background,mode:'layered'})"});
      }
      createRoot(document.getElementById('app')).render(createElement(App));
      </script></body></html>`,
  }))
  await page.goto('/__holo-play-stage', { waitUntil: 'domcontentloaded' })
  const stage = page.locator('#stage-host > div')
  await expect.poll(async () => {
    if (checks.errors.length) throw new Error(checks.errors.join('\n'))
    return stage.count()
  }).toBe(1)
  await expect(stage).toHaveAttribute(kind === 'sample' ? 'data-sample-state' : 'data-holo-state', 'ready', { timeout: 20_000 })
  const canvas = stage.locator('canvas')
  if (waitForReveal) {
    await expect(canvas).toHaveCSS('transform', 'none')
    await expect(canvas).toHaveCSS('opacity', '1')
    await stable(canvas)
  }
  return { ...checks, stage, canvas }
}

test.describe('Holo card visual play', () => {
  for (const kind of ['sample', 'workbench']) {
    test(`${kind} renders three distinct coating patterns on real layered artwork`, async ({ page }, testInfo) => {
      const { canvas, errors, paidRequests } = await rendererHarness(page, kind)
      await setSettings(page, { foil: 'spectrum', foilStrength: 1 })
      await finishAt(page, 'spectrum')
      const images = new Map()
      for (const pattern of ['flow', 'stardust', 'aurora']) {
        await setSettings(page, { pattern })
        await patternAt(page, pattern)
        const image = await stable(canvas)
        images.set(pattern, image)
        await artifact(testInfo, `${kind}-${pattern}.png`, image)
      }
      const report = {}
      for (const [first, second] of [['flow', 'stardust'], ['flow', 'aurora'], ['stardust', 'aurora']]) {
        const stats = await difference(page, images.get(first), images.get(second))
        expect(stats.paintedRatio).toBeGreaterThan(.3)
        expect(stats.changedRatio, `${first}/${second}: ${JSON.stringify(stats)}`).toBeGreaterThan(.01)
        report[`${first}/${second}`] = stats
      }
      await artifact(testInfo, `${kind}-patterns.json`, JSON.stringify(report, null, 2), 'application/json')
      expect(errors).toEqual([])
      expect(paidRequests).toEqual([])
    })

    test(`${kind} separates real layer planes and restores the identical closed render`, async ({ page }, testInfo) => {
      const { canvas, errors } = await rendererHarness(page, kind)
      const beforeState = await state(page)
      const before = await stable(canvas)
      await setSettings(page, { exploded: true })
      await expect.poll(async () => (await state(page)).layerDepths.text - beforeState.layerDepths.text).toBeGreaterThan(.25)
      const opened = await stable(canvas)
      const openedState = await state(page)
      expect(openedState.layerDepths.subject).toBeGreaterThan(beforeState.layerDepths.subject + .1)
      expect(openedState.layerDepths.text - openedState.layerDepths.subject).toBeGreaterThan(.15)
      const pixels = await difference(page, before, opened)
      expect(pixels.changedRatio).toBeGreaterThan(.05)
      await setSettings(page, { exploded: false })
      await expect.poll(async () => (await state(page)).layerDepths.text).toBeCloseTo(beforeState.layerDepths.text, 5)
      expect(hash(await stable(canvas))).toBe(hash(before))
      await artifact(testInfo, `${kind}-exploded.png`, opened)
      await artifact(testInfo, `${kind}-exploded.json`, JSON.stringify({ beforeState, openedState, pixels }, null, 2), 'application/json')
      expect(errors).toEqual([])
    })
  }

  test('material blends have visible middle frames and rapid retargeting converges from the live blend', async ({ page }, testInfo) => {
    const { canvas, errors } = await rendererHarness(page)
    const gold = await stable(canvas)
    const middle = await page.evaluate(async original => {
      window.playDriver.setSettings({ foil: 'spectrum' })
      const immediate = window.playDriver.getState()
      const start = Date.now(), observed = []
      let closest = null
      while (Date.now() - start < 2_000) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        const state = window.playDriver.getState()
        const weight = state.finishWeights.spectrum
        // A queued WebGL draw may follow the GSAP update on the next frame.
        // Inspect presented pixels instead of assuming 230 ms is painted.
        if (weight > .05 && weight < .95) {
          const image = document.querySelector('canvas').toDataURL('image/png').split(',')[1]
          observed.push({ weight, changed: image !== original })
          if (image !== original && (!closest || Math.abs(weight - .5) < Math.abs(closest.state.finishWeights.spectrum - .5))) {
            closest = { immediate, state, image }
          }
        }
        if (weight >= .95) break
      }
      if (!closest) throw new Error(`No painted material middle frame: ${JSON.stringify(observed)}`)
      return closest
    }, gold.toString('base64'))
    expect(middle.immediate.finishWeights.gold).toBeGreaterThan(.99)
    expect(middle.state.finishWeights.spectrum).toBeGreaterThan(.05)
    expect(middle.state.finishWeights.spectrum).toBeLessThan(.95)
    expect(middle.state.finishWeights.gold).toBeGreaterThan(.05)
    const middleImage = Buffer.from(middle.image, 'base64')
    await finishAt(page, 'spectrum')
    const spectrum = await stable(canvas)
    expect((await difference(page, gold, middleImage)).changedRatio).toBeGreaterThan(.01)
    expect((await difference(page, middleImage, spectrum)).changedRatio).toBeGreaterThan(.01)
    const retarget = await page.evaluate(async () => {
      window.playDriver.setSettings({ foil: 'pearl' })
      await new Promise(resolve => setTimeout(resolve, 180))
      const before = window.playDriver.getState()
      window.playDriver.setSettings({ foil: 'silver' })
      const after = window.playDriver.getState()
      await new Promise(resolve => setTimeout(resolve, 110))
      window.playDriver.setSettings({ foil: 'gold' })
      return { before, after }
    })
    expect(retarget.before.finishWeights.pearl).toBeGreaterThan(.01)
    for (const name of ['spectrum', 'silver', 'gold', 'pearl', 'original']) {
      expect(Math.abs(retarget.before.finishWeights[name] - retarget.after.finishWeights[name])).toBeLessThan(.005)
    }
    await finishAt(page, 'gold')
    expect((await state(page)).finishWeights).toEqual({ spectrum: 0, silver: 0, gold: 1, pearl: 0, original: 0, rose: 0, ice: 0, obsidian: 0, opal: 0 })
    expect(hash(await stable(canvas))).toBe(hash(gold))
    await artifact(testInfo, 'material-middle.png', middleImage)
    await artifact(testInfo, 'material-transition.json', JSON.stringify({ middle: middle.state, retarget }, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  test('a one-shot shine changes pixels mid-sweep and returns to an idle frame', async ({ page }, testInfo) => {
    const { canvas, errors } = await rendererHarness(page)
    const before = await stable(canvas)
    const middle = await page.evaluate(async () => {
      const accepted = window.playDriver.shine()
      await new Promise(resolve => setTimeout(resolve, 420))
      return { accepted, state: window.playDriver.getState(), image: document.querySelector('canvas').toDataURL('image/png').split(',')[1] }
    })
    expect(middle.accepted).toBe(true)
    expect(middle.state.shining).toBe(true)
    const image = Buffer.from(middle.image, 'base64')
    const pixels = await difference(page, before, image)
    expect(pixels.changedPixels).toBeGreaterThan(500)
    expect(pixels.maxDelta).toBeGreaterThan(15)
    await expect.poll(async () => (await state(page)).shining).toBe(false)
    expect(hash(await stable(canvas))).toBe(hash(before))
    await page.evaluate(() => window.playDriver.setMotionAllowed(false))
    expect(await page.evaluate(() => window.playDriver.shine())).toBe(false)
    expect(hash(await stable(canvas))).toBe(hash(before))
    await artifact(testInfo, 'shine-mid-sweep.png', image)
    await artifact(testInfo, 'shine-pixels.json', JSON.stringify(pixels, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  test('renderer motion gates settle finite transitions and keep paused frames still', async ({ page }) => {
    const { canvas, errors } = await rendererHarness(page)
    await setSettings(page, { foil: 'spectrum', pattern: 'aurora', exploded: true })
    await elapsed(page, 170)
    await page.evaluate(() => window.playDriver.setMotionAllowed(false))
    const stopped = await state(page)
    expect(stopped.motionAllowed).toBe(false)
    expect(stopped.finishWeights.spectrum).toBe(1)
    expect(stopped.patternWeights.aurora).toBe(1)
    const image = await stable(canvas)
    await elapsed(page, 420)
    expect(hash(await capture(canvas))).toBe(hash(image))
    await page.evaluate(() => window.playDriver.setMotionAllowed(true))
    await setSettings(page, { paused: true, foil: 'pearl', pattern: 'stardust', exploded: false })
    const paused = await state(page)
    expect(paused.finishWeights.pearl).toBe(1)
    expect(paused.patternWeights.stardust).toBe(1)
    expect(await page.evaluate(() => window.playDriver.shine())).toBe(false)
    const pausedFrame = await stable(canvas)
    await elapsed(page, 420)
    expect(hash(await capture(canvas))).toBe(hash(pausedFrame))
    expect(errors).toEqual([])
  })

  test('automatic orbit moves pixels and stops for pause, document visibility, and reduced motion', async ({ page }, testInfo) => {
    const { stage, canvas, errors } = await stageHarness(page)
    await setSettings(page, { autoOrbit: true })
    await expect(stage).toHaveAttribute('data-card-orbit', 'running')
    const first = await capture(canvas)
    await elapsed(page, 950)
    const moving = await capture(canvas)
    expect((await difference(page, first, moving)).changedRatio).toBeGreaterThan(.01)
    await setSettings(page, { paused: true })
    await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
    const pausedState = await state(page), paused = await stable(canvas)
    await elapsed(page, 450)
    expect((await state(page)).pose).toEqual(pausedState.pose)
    expect(hash(await capture(canvas))).toBe(hash(paused))
    await setSettings(page, { paused: false })
    await expect(stage).toHaveAttribute('data-card-orbit', 'running')
    // Dispatch the browser visibility contract in this isolated page only.
    await page.evaluate(() => {
      window.playDocumentHidden = true
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.playDocumentHidden })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
    const hidden = await state(page)
    await elapsed(page, 450)
    expect((await state(page)).pose).toEqual(hidden.pose)
    expect((await state(page)).motionAllowed).toBe(false)
    await page.evaluate(() => { window.playDocumentHidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    await expect(stage).toHaveAttribute('data-card-orbit', 'running')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(stage).toHaveAttribute('data-card-orbit', 'idle').catch(async error => {
      const flags = await page.evaluate(() => {
        const current = window.playDriver.getState()
        return { mediaReduced: matchMedia('(prefers-reduced-motion: reduce)').matches, hidden: document.hidden,
          reducedMotion: current.reducedMotion, motionAllowed: current.motionAllowed, orbitRunning: current.orbitRunning,
          pose: { x: current.pose.x, y: current.pose.y, flip: current.pose.flip } }
      })
      throw new Error(`${error.message}\nMotion flags: ${JSON.stringify(flags)}`)
    })
    const reduced = await state(page), reducedImage = await stable(canvas)
    await elapsed(page, 450)
    expect((await state(page)).pose).toEqual(reduced.pose)
    expect(hash(await capture(canvas))).toBe(hash(reducedImage))
    expect(await page.evaluate(() => window.playDriver.shine())).toBe(false)
    await artifact(testInfo, 'orbit-moving.png', moving)
    await artifact(testInfo, 'orbit-environment.json', JSON.stringify({ pausedState, hidden, reduced }, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  test('hover and dragging take over a touring card and leaving resumes orbit without a jump', async ({ page }, testInfo) => {
    const { stage, canvas, errors } = await stageHarness(page, { kind: 'workbench' })
    await setSettings(page, { autoOrbit: true })
    await expect(stage).toHaveAttribute('data-card-orbit', 'running')
    const box = await stage.boundingBox()
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4)
    await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
    const hovered = await stable(canvas)
    await page.mouse.down()
    await expect(stage).toHaveAttribute('data-holo-dragging', 'true')
    await page.mouse.move(box.x + box.width * .75, box.y + box.height * .6, { steps: 10 })
    const dragged = await stable(canvas)
    expect((await difference(page, hovered, dragged)).changedRatio).toBeGreaterThan(.05)
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-holo-dragging', 'false')
    const lastPose = (await state(page)).pose
    await page.mouse.move(5, 5)
    await expect(stage).toHaveAttribute('data-card-orbit', 'running')
    const resumed = (await state(page)).pose
    expect(Math.abs(resumed.x - lastPose.x) + Math.abs(resumed.y - lastPose.y)).toBeLessThan(.1)
    await elapsed(page, 950)
    const touring = await capture(canvas)
    expect((await difference(page, dragged, touring)).changedRatio).toBeGreaterThan(.05)
    await stage.press('ArrowRight')
    await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
    await stable(canvas)
    const keyboard = (await state(page)).pose
    await elapsed(page, 350)
    expect((await state(page)).pose).toEqual(keyboard)
    await artifact(testInfo, 'manual-drag.png', dragged)
    expect(errors).toEqual([])
  })

  test('ready artwork reveals once, clears temporary styles, and reduced motion remains visible', async ({ page }, testInfo) => {
    const { canvas, errors } = await stageHarness(page, { delaySubject: true, waitForReveal: false })
    const reveal = await canvas.evaluate(canvas => ({ opacity: Number(getComputedStyle(canvas).opacity), transform: getComputedStyle(canvas).transform }))
    expect(reveal.opacity).toBeLessThan(1)
    expect(reveal.transform).not.toBe('none')
    await expect(canvas).toHaveCSS('opacity', '1')
    await expect(canvas).toHaveCSS('transform', 'none')
    await expect(canvas).toHaveCSS('will-change', 'auto')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setSettings(page, { foil: 'spectrum', pattern: 'aurora' })
    await expect(canvas).toHaveCSS('opacity', '1')
    await expect(canvas).toHaveCSS('visibility', 'visible')
    await expect.poll(async () => (await state(page)).patternWeights.aurora).toBe(1)
    await artifact(testInfo, 'ready-reveal-state.json', JSON.stringify({ reveal, settled: await state(page) }, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  test('workbench play controls change the preview and respect original print and reduced motion', async ({ page }, testInfo) => {
    const { errors, paidRequests } = await prepare(page, { viewport: { width: 1440, height: 900 } })
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    const stage = page.locator('[data-card-template="astral"]')
    await expect(stage).toHaveAttribute('data-holo-state', 'ready', { timeout: 20_000 })
    const canvas = stage.locator('canvas')
    await expect(canvas).toHaveCSS('transform', 'none')
    await page.getByRole('button', { name: '视觉玩法', exact: true }).click()
    const pane = page.getByRole('tabpanel', { name: '玩法', exact: true })
    await expect(pane).toBeVisible()
    await pane.getByRole('tablist', { name: '风格库分类', exact: true }).getByRole('tab', { name: '纹理', exact: true }).click()
    const flow = await stable(canvas)
    await pane.getByRole('button', { name: '极光纹理', exact: true }).click()
    await expect(pane.getByRole('button', { name: '极光纹理', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const aurora = await stable(canvas)
    expect((await difference(page, flow, aurora)).changedRatio).toBeGreaterThan(.01)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(pane.getByRole('button', { name: '光影巡游', exact: true })).toBeDisabled()
    await expect(pane.getByRole('button', { name: '点亮卡片', exact: true })).toBeDisabled()
    const beforeExplode = await stable(canvas)
    await pane.getByRole('button', { name: '透视拆层', exact: true }).click()
    await expect(pane.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect((await difference(page, beforeExplode, await stable(canvas))).changedRatio).toBeGreaterThan(.05)
    await artifact(testInfo, 'workbench-play-panel.png', await page.screenshot({ animations: 'allow' }))
    await page.getByRole('button', { name: '原画', exact: true }).click()
    for (const name of ['流光纹理', '星砂纹理', '极光纹理', '点亮卡片']) {
      await expect(pane.getByRole('button', { name, exact: true })).toBeDisabled()
    }
    await expect(page.getByRole('button', { name: '导出 PNG', exact: true })).toBeDisabled()
    // Exercise actual React unmounts while GSAP owns a live repeating timeline.
    // A page reload would destroy the document and conceal cleanup recursion.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    for (let visit = 0; visit < 2; visit++) {
      await page.getByRole('link', { name: '样卡展厅', exact: true }).click()
      await expect(page).toHaveURL(/\/holo-card\/sample$/)
      await expect(page.locator('.sample-relief-stage')).toHaveAttribute('data-sample-state', 'ready')
      await page.getByRole('button', { name: '光效设置', exact: true }).click()
      await page.getByRole('button', { name: '光影巡游', exact: true }).click()
      await expect(page.locator('.sample-relief-stage')).toHaveAttribute('data-card-orbit', 'running')
      await page.getByRole('link', { name: '返回工作台', exact: true }).click()
      await expect(page).toHaveURL(/\/holo-card$/)
      await expect(page.locator('[data-card-template="astral"]')).toHaveAttribute('data-holo-state', 'ready')
    }
    expect(errors).toEqual([])
    expect(paidRequests).toEqual([])
  })

  test('sample play controls produce a recorded tour of patterns, shine, separated layers, and reverse', async ({ browser }, testInfo) => {
    test.setTimeout(60_000)
    const context = await browser.newContext({
      baseURL: process.env.WEB_BASE_URL || 'http://127.0.0.1:3106', viewport: { width: 1440, height: 900 },
      recordVideo: { dir: testInfo.outputPath('recording'), size: { width: 1440, height: 900 } },
    })
    const page = await context.newPage()
    const video = page.video()
    try {
      const { errors, paidRequests } = await prepare(page, { viewport: { width: 1440, height: 900 } })
      await page.goto('/holo-card/sample', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: '星间旅人', exact: true })).toBeVisible()
      const stage = page.locator('.sample-relief-stage'), canvas = stage.locator('canvas')
      await expect(stage).toHaveAttribute('data-sample-state', 'ready', { timeout: 20_000 })
      await expect(canvas).toHaveCSS('transform', 'none')
      await page.evaluate(() => document.fonts.ready)
      const box = await stage.boundingBox()
      await page.mouse.move(box.x + box.width * .17, box.y + box.height * .4, { steps: 28 })
      await elapsed(page, 1_000)
      await page.mouse.move(box.x + box.width * .85, box.y + box.height * .56, { steps: 40 })
      await elapsed(page, 1_000)
      await artifact(testInfo, 'sample-play-flow.png', await page.screenshot({ animations: 'allow' }))

      const lighting = page.getByRole('button', { name: '光效设置', exact: true })
      await lighting.click()
      let popup = page.getByRole('dialog', { name: '光效设置', exact: true })
      await expect(popup).toBeVisible()
      await popup.getByRole('tablist', { name: '风格库分类', exact: true }).getByRole('tab', { name: '纹理', exact: true }).click()
      await popup.getByRole('button', { name: '星砂纹理', exact: true }).click()
      await expect(popup.getByRole('button', { name: '星砂纹理', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await page.mouse.move(box.x + box.width * .18, box.y + box.height * .45, { steps: 30 })
      await elapsed(page, 1_100)
      await artifact(testInfo, 'sample-play-stardust.png', await page.screenshot({ animations: 'allow' }))

      await page.getByRole('button', { name: '镭射', exact: true }).click()
      await lighting.click()
      popup = page.getByRole('dialog', { name: '光效设置', exact: true })
      await popup.getByRole('tablist', { name: '风格库分类', exact: true }).getByRole('tab', { name: '纹理', exact: true }).click()
      await popup.getByRole('button', { name: '极光纹理', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await page.mouse.move(box.x + box.width * .85, box.y + box.height * .54, { steps: 40 })
      await elapsed(page, 1_000)
      await artifact(testInfo, 'sample-play-aurora.png', await page.screenshot({ animations: 'allow' }))

      await stage.dblclick({ position: { x: box.width * .65, y: box.height * .48 }, delay: 90 })
      await elapsed(page, 1_000)
      await lighting.click()
      popup = page.getByRole('dialog', { name: '光效设置', exact: true })
      await popup.getByRole('button', { name: '光影巡游', exact: true }).click()
      await expect(popup.getByRole('button', { name: '光影巡游', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await page.mouse.move(30, 100)
      await expect(stage).toHaveAttribute('data-card-orbit', 'running')
      await elapsed(page, 1_700)

      await lighting.click()
      popup = page.getByRole('dialog', { name: '光效设置', exact: true })
      await popup.getByRole('button', { name: '透视拆层', exact: true }).click()
      await expect(popup.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
      await elapsed(page, 1_300)
      await artifact(testInfo, 'sample-play-exploded.png', await page.screenshot({ animations: 'allow' }))

      await lighting.click()
      popup = page.getByRole('dialog', { name: '光效设置', exact: true })
      await popup.getByRole('button', { name: '光影巡游', exact: true }).click()
      await popup.getByRole('button', { name: '透视拆层', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await elapsed(page, 900)
      await page.getByRole('button', { name: '翻转样卡', exact: true }).click()
      await expect(stage).toHaveAttribute('data-sample-face', 'back')
      await elapsed(page, 1_150)
      await artifact(testInfo, 'sample-play-back.png', await page.screenshot({ animations: 'allow' }))
      await page.getByRole('button', { name: '复位样卡', exact: true }).click()
      await expect(stage).toHaveAttribute('data-sample-face', 'front')
      await elapsed(page, 1_150)
      expect(errors).toEqual([])
      expect(paidRequests).toEqual([])
    } finally {
      await context.close()
      const path = testInfo.outputPath('holo-card-play-demo.webm')
      await video.saveAs(path)
      await testInfo.attach('holo-card-play-demo.webm', { path, contentType: 'video/webm' })
    }
  })
})
