import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect as playwrightExpect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const expect = playwrightExpect.configure({ timeout: Number(process.env.HOLO_E2E_WAIT_MS) || 8_000 })
const FINISHES = ['spectrum', 'silver', 'gold', 'pearl', 'original', 'rose', 'ice', 'obsidian', 'opal']
const PATTERNS = ['flow', 'stardust', 'aurora', 'prism', 'ripple', 'guilloche', 'silk', 'nebula', 'diffraction']
const SHINES = ['sweep', 'halo', 'comet', 'cross']
const ORBITS = ['orbit', 'sway', 'figure8', 'float']
const FINISH_LABELS = ['光谱', '银箔', '金箔', '珠光', '原画', '玫瑰金', '冰晶', '曜石', '欧泊']
const PATTERN_LABELS = ['流光', '星砂', '极光', '碎钻', '水波', '雕纹', '织光', '星云', '光栅']
const portraitPath = fileURLToPath(new URL('../../public/holo-samples/astral-v1/subject.png', import.meta.url))
const sourcePath = fileURLToPath(new URL('../../public/holo-samples/astral-v1/background.png', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function prepare(page, { viewport = { width: 1100, height: 900 }, reducedMotion = 'no-preference' } = {}) {
  await installVisualBaseline(page)
  await page.clock.setSystemTime(new Date('2026-09-09T04:00:00Z'))
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion })
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, options, ...args) {
      return getContext.call(this, kind, /^webgl/.test(kind) ? { ...options, preserveDrawingBuffer: true } : options, ...args)
    }
    window.libraryDrawCount = 0
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawArrays', 'drawElements']) {
        const draw = prototype[name]
        prototype[name] = function (...args) { window.libraryDrawCount++; return draw.apply(this, args) }
      }
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
  let prior = '', identical = 0, image
  await expect.poll(async () => {
    image = await capture(canvas)
    const next = hash(image)
    identical = next === prior ? identical + 1 : 0
    prior = next
    return identical
  }, { intervals: [120], timeout: 8_000 }).toBeGreaterThanOrEqual(2)
  return image
}

async function alphaSignature(canvas) {
  return canvas.evaluate(element => {
    const copy = document.createElement('canvas'); copy.width = element.width; copy.height = element.height
    const context = copy.getContext('2d', { willReadFrequently: true }); context.drawImage(element, 0, 0)
    const { data } = context.getImageData(0, 0, copy.width, copy.height)
    let signature = 2166136261
    for (let index = 3; index < data.length; index += 4) signature = Math.imul(signature ^ data[index], 16777619) >>> 0
    return { width: copy.width, height: copy.height, signature }
  })
}

// Decode each real render once, then compare all pairs, including alpha.
async function imagePairs(page, images) {
  return page.evaluate(async sources => {
    const decoded = await Promise.all(sources.map(async ([name, base64]) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
      return { name, width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
    }))
    const comparisons = []
    for (let a = 0; a < decoded.length; a++) for (let b = a + 1; b < decoded.length; b++) {
      const first = decoded[a], second = decoded[b]
      if (first.width !== second.width || first.height !== second.height) throw new Error('Comparison canvas size changed')
      let changedPixels = 0, maxDelta = 0, painted = 0
      for (let index = 0; index < first.data.length; index += 4) {
        let delta = 0
        for (let channel = 0; channel < 4; channel++) delta += Math.abs(first.data[index + channel] - second.data[index + channel])
        if (delta > 6) changedPixels++
        if (Math.max(first.data[index + 3], second.data[index + 3]) > 16) painted++
        maxDelta = Math.max(maxDelta, delta)
      }
      const pixels = first.width * first.height
      comparisons.push({ first: first.name, second: second.name, changedPixels, changedRatio: changedPixels / pixels,
        paintedRatio: painted / pixels, maxDelta })
    }
    return comparisons
  }, [...images].map(([name, bytes]) => [name, bytes.toString('base64')]))
}

async function difference(page, first, second) {
  return (await imagePairs(page, new Map([['first', first], ['second', second]])))[0]
}

async function state(page) { return page.evaluate(() => window.libraryDriver.getState()) }
async function settings(page, next) { await page.evaluate(next => window.libraryDriver.setSettings(next), next) }
async function elapsed(page, milliseconds) {
  await page.evaluate(milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), milliseconds)
}

async function section(scope, name) {
  const tab = scope.getByRole('tablist', { name: '风格库分类', exact: true }).getByRole('tab', { name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  return scope.getByRole('tabpanel', { name, exact: true })
}

async function openLighting(page) {
  const popup = page.getByRole('dialog', { name: '光效设置', exact: true })
  if (!await popup.isVisible()) await page.getByRole('button', { name: '光效设置', exact: true }).click()
  await expect(popup).toBeVisible()
  return popup
}

async function downloadBytes(download) {
  expect(await download.failure()).toBeNull()
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function normalized(weights, names) {
  expect(Object.keys(weights).sort()).toEqual([...names].sort())
  expect(Object.values(weights).every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
  expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5)
}

async function rendererHarness(page, kind) {
  const checks = await prepare(page)
  await page.route('**/__holo-library-renderer', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:100%;height:100%;background:#f5f2eb}body{display:grid;place-items:center}
      #stage{width:min(84vw,740px);height:90vh}</style></head><body><div id="stage"></div><script type="module">
      import {createHoloCardRenderer} from '/src/features/holo-card/holo-card-renderer.js';
      import {createSampleReliefRenderer} from '/src/features/holo-card/sample-relief-renderer.js';
      import {ASTRAL_SAMPLE} from '/src/features/holo-card/astral-design-layers.js';
      const host=document.getElementById('stage');
      const create=${kind === 'sample' ? 'createSampleReliefRenderer' : 'createHoloCardRenderer'};
      const driver=create(host,{onReady:ready=>{host.dataset.state=ready?'ready':'loading'},
        onError:error=>{host.dataset.state='error';host.dataset.error=error}});
      window.libraryDriver=driver;
      driver.setMotionAllowed(false);
      driver.setSettings({...ASTRAL_SAMPLE,foil:'spectrum',foilStrength:1,pattern:'flow',depth:1,shineStyle:'sweep',
        background:'#172b29',subjectScale:1,backgroundDepth:-.2,lineStrength:.4,tilt:.8,exploded:false});
      driver.setPose({x:.58,y:-.18,flip:0});
      await driver.setImages(${kind === 'sample' ? 'ASTRAL_SAMPLE.assets' : "{sourceUrl:ASTRAL_SAMPLE.assets.background,subjectUrl:ASTRAL_SAMPLE.assets.subject,backgroundUrl:ASTRAL_SAMPLE.assets.background,mode:'layered'}"});
      driver.setMotionAllowed(true);
      </script></body></html>`,
  }))
  await page.goto('/__holo-library-renderer', { waitUntil: 'domcontentloaded' })
  const stage = page.locator('#stage'), canvas = stage.locator('canvas')
  await expect(stage).toHaveAttribute('data-state', 'ready', { timeout: 20_000 })
  await stable(canvas)
  return { ...checks, stage, canvas }
}

async function stageHarness(page) {
  const checks = await prepare(page)
  await page.route('**/__holo-library-stage', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:100%;height:100%;background:#f5f2eb}#app{height:100%;display:grid;place-items:center}
      #stage-host{width:min(84vw,740px);height:90vh}</style></head><body><div id="app"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const reactModule=await import('/node_modules/.vite/deps/react.js');
      const reactDomModule=await import('/node_modules/.vite/deps/react-dom_client.js');
      const gsapModule=await import('/node_modules/.vite/deps/gsap.js');
      const {createElement,useState,useRef}=reactModule.default||reactModule;
      const {createRoot}=reactDomModule.default||reactDomModule;
      const gsap=gsapModule.gsap||gsapModule.default?.gsap||gsapModule.default;
      const {SampleReliefStage}=await import('/src/features/holo-card/SampleReliefStage.jsx');
      const {ASTRAL_SAMPLE}=await import('/src/features/holo-card/astral-design-layers.js');
      function App({orbitStyle}){
        const [settings,setSettings]=useState({...ASTRAL_SAMPLE,foil:'gold',foilStrength:.85,pattern:'flow',depth:1,
          orbitStyle,autoOrbit:false,exploded:false,paused:false});
        const stageRef=useRef(null);
        window.libraryDriver={setSettings:next=>setSettings(current=>({...current,...next})),getState:()=>stageRef.current?.getState()};
        return createElement('div',{id:'stage-host'},createElement(SampleReliefStage,{settings,stageRef,assets:ASTRAL_SAMPLE.assets}));
      }
      let root;
      window.libraryApp={
        mount(orbitStyle){root=createRoot(document.getElementById('app'));root.render(createElement(App,{orbitStyle}))},
        unmount(){root.unmount()},
        activeTweens(){return gsap.globalTimeline.getChildren(true,true,true).filter(tween=>tween.isActive()).length},
      };
      window.libraryApp.mount('orbit');
      </script></body></html>`,
  }))
  await page.goto('/__holo-library-stage', { waitUntil: 'domcontentloaded' })
  const stage = page.locator('.sample-relief-stage'), canvas = stage.locator('canvas')
  await expect.poll(async () => {
    if (checks.errors.length) throw new Error(checks.errors.join('\n'))
    return stage.count()
  }).toBe(1)
  await expect(stage).toHaveAttribute('data-sample-state', 'ready', { timeout: 20_000 })
  await expect(canvas).toHaveCSS('transform', 'none')
  await stable(canvas)
  return { ...checks, stage, canvas }
}

test.describe('Holo material and motion library', () => {
  for (const kind of ['sample', 'workbench']) {
    test(`${kind} renders all nine material finishes as distinct real image pixels`, async ({ page }, testInfo) => {
      test.setTimeout(45_000)
      const { canvas, errors, paidRequests } = await rendererHarness(page, kind)
      await page.evaluate(() => window.libraryDriver.setMotionAllowed(false))
      const images = new Map()
      for (const foil of FINISHES) {
        await settings(page, { foil })
        const current = await state(page)
        normalized(current.finishWeights, FINISHES)
        expect(current.finishWeights[foil]).toBe(1)
        const image = await stable(canvas)
        images.set(foil, image)
        if (['rose', 'ice', 'obsidian', 'opal'].includes(foil)) await artifact(testInfo, `${kind}-${foil}.png`, image)
      }
      expect(new Set([...images.values()].map(hash)).size).toBe(9)
      const comparisons = await imagePairs(page, images)
      for (const comparison of comparisons) {
        expect(comparison.paintedRatio).toBeGreaterThan(.3)
        if (['rose', 'ice', 'obsidian', 'opal'].some(name => [comparison.first, comparison.second].includes(name))) {
          expect(comparison.changedRatio, JSON.stringify(comparison)).toBeGreaterThan(.005)
        }
      }
      await artifact(testInfo, `${kind}-materials.json`, JSON.stringify(comparisons, null, 2), 'application/json')
      expect(errors).toEqual([])
      expect(paidRequests).toEqual([])
    })

    test(`${kind} renders all nine foil textures without aliasing their visible patterns`, async ({ page }, testInfo) => {
      test.setTimeout(45_000)
      const { canvas, errors } = await rendererHarness(page, kind)
      await page.evaluate(() => window.libraryDriver.setMotionAllowed(false))
      const images = new Map()
      for (const pattern of PATTERNS) {
        await settings(page, { pattern })
        const current = await state(page)
        normalized(current.patternWeights, PATTERNS)
        expect(current.patternWeights[pattern]).toBe(1)
        const image = await stable(canvas)
        images.set(pattern, image)
        await artifact(testInfo, `${kind}-${pattern}.png`, image)
      }
      expect(new Set([...images.values()].map(hash)).size).toBe(9)
      const comparisons = await imagePairs(page, images)
      for (const comparison of comparisons) expect(comparison.changedRatio, JSON.stringify(comparison)).toBeGreaterThan(.005)
      await artifact(testInfo, `${kind}-textures.json`, JSON.stringify(comparisons, null, 2), 'application/json')
      expect(errors).toEqual([])
    })

    test(`${kind} displays four distinct one-shot light shapes and clears every effect`, async ({ page }, testInfo) => {
      test.setTimeout(45_000)
      const { canvas, errors } = await rendererHarness(page, kind)
      const resting = await stable(canvas), images = new Map(), samples = []
      for (const shineStyle of SHINES) {
        await settings(page, { shineStyle })
        expect((await state(page)).shineStyle).toBe(shineStyle)
        const middle = await page.evaluate(async () => {
          const accepted = window.libraryDriver.shine()
          const start = Date.now()
          const observed = []
          let closest = null
          while (Date.now() - start < 2_000) {
            await new Promise(resolve => requestAnimationFrame(resolve))
            const current = window.libraryDriver.getState()
            observed.push({ elapsed: Date.now() - start, progress: current.shineProgress, shining: current.shining, allowed: current.motionAllowed })
            // Software WebGL may skip a narrow progress interval. Keep the
            // actual presented frame closest to the midpoint, without changing
            // the visible-pixel or return-to-idle assertions below.
            if (current.shining && current.shineProgress > .25 && current.shineProgress < .8
              && (!closest || Math.abs(current.shineProgress - .5) < Math.abs(closest.current.shineProgress - .5))) {
              closest = { accepted, current, image: document.querySelector('canvas').toDataURL('image/png').split(',')[1] }
            }
            if (closest && (!current.shining || current.shineProgress > .65)) return closest
          }
          throw new Error(`No visible middle frame was exposed: ${JSON.stringify({ accepted, observed })}`)
        })
        expect(middle.accepted).toBe(true)
        const image = Buffer.from(middle.image, 'base64')
        const pixels = await difference(page, resting, image)
        expect(pixels.changedPixels, JSON.stringify(pixels)).toBeGreaterThan(500)
        expect(pixels.maxDelta).toBeGreaterThan(15)
        images.set(shineStyle, image)
        samples.push({ shineStyle, progress: middle.current.shineProgress, pixels })
        await expect.poll(async () => (await state(page)).shining).toBe(false)
        expect((await state(page)).shineProgress).toBeLessThanOrEqual(0)
        expect(hash(await stable(canvas))).toBe(hash(resting))
        await artifact(testInfo, `${kind}-shine-${shineStyle}.png`, image)
      }
      const comparisons = await imagePairs(page, images)
      for (const comparison of comparisons) expect(comparison.changedRatio, JSON.stringify(comparison)).toBeGreaterThan(.002)
      await artifact(testInfo, `${kind}-shine-shapes.json`, JSON.stringify({ samples, comparisons }, null, 2), 'application/json')
      expect(errors).toEqual([])
    })
  }

  test('nine-dimensional finish and texture blends remain normalized through continuous rapid retargeting', async ({ page }, testInfo) => {
    const { canvas, errors } = await rendererHarness(page, 'sample')
    const transitions = FINISHES.map((foil, index) => ({ foil, pattern: PATTERNS[(index + 3) % PATTERNS.length] }))
    const samples = await page.evaluate(async transitions => {
      const results = []
      for (const next of transitions) {
        const before = window.libraryDriver.getState()
        window.libraryDriver.setSettings(next)
        const after = window.libraryDriver.getState()
        await new Promise(resolve => setTimeout(resolve, 105))
        results.push({ next, before, after, middle: window.libraryDriver.getState() })
      }
      return results
    }, transitions)
    for (const sample of samples) {
      for (const snapshot of [sample.before, sample.after, sample.middle]) {
        normalized(snapshot.finishWeights, FINISHES)
        normalized(snapshot.patternWeights, PATTERNS)
      }
      for (const [key, names] of [['finishWeights', FINISHES], ['patternWeights', PATTERNS]]) {
        for (const name of names) expect(Math.abs(sample.before[key][name] - sample.after[key][name])).toBeLessThan(.005)
      }
    }
    expect(samples.some(sample => Object.values(sample.middle.finishWeights).filter(weight => weight > .01 && weight < .99).length >= 2)).toBe(true)
    expect(samples.some(sample => Object.values(sample.middle.patternWeights).filter(weight => weight > .01 && weight < .99).length >= 2)).toBe(true)
    const last = transitions.at(-1)
    await expect.poll(async () => (await state(page)).finishWeights[last.foil]).toBeCloseTo(1, 5)
    await expect.poll(async () => (await state(page)).patternWeights[last.pattern]).toBeCloseTo(1, 5)
    const settled = await state(page)
    expect(settled.finishWeights).toEqual(Object.fromEntries(FINISHES.map(name => [name, name === last.foil ? 1 : 0])))
    expect(settled.patternWeights).toEqual(Object.fromEntries(PATTERNS.map(name => [name, name === last.pattern ? 1 : 0])))
    await stable(canvas)
    await artifact(testInfo, 'library-retargeting.json', JSON.stringify({ samples, settled }, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  test('four orbit paths move distinct poses and stop on pause, reduced motion, and unmount', async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    const { stage, canvas, errors } = await stageHarness(page)
    const traces = {}
    for (const orbitStyle of ORBITS) {
      if (orbitStyle !== 'orbit') {
        await page.evaluate(orbitStyle => window.libraryApp.mount(orbitStyle), orbitStyle)
        await expect(stage).toHaveAttribute('data-sample-state', 'ready')
        await expect(canvas).toHaveCSS('transform', 'none')
      }
      await settings(page, { autoOrbit: true, orbitStyle })
      await expect(stage).toHaveAttribute('data-card-orbit', 'running')
      expect((await state(page)).orbitStyle).toBe(orbitStyle)
      const before = await capture(canvas), poses = []
      for (let index = 0; index < 5; index++) { await elapsed(page, 350); poses.push((await state(page)).pose) }
      const moved = await capture(canvas)
      expect((await difference(page, before, moved)).changedPixels).toBeGreaterThan(500)
      expect(poses.every(pose => Math.abs(pose.x) <= 1 && Math.abs(pose.y) <= 1)).toBe(true)
      await settings(page, { paused: true })
      await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
      const paused = await state(page), still = await stable(canvas)
      await elapsed(page, 220)
      expect((await state(page)).pose).toEqual(paused.pose)
      expect(hash(await capture(canvas))).toBe(hash(still))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await settings(page, { paused: false })
      await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
      const reduced = (await state(page)).pose
      await elapsed(page, 220)
      expect((await state(page)).pose).toEqual(reduced)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect(stage).toHaveAttribute('data-card-orbit', 'running')
      await page.evaluate(() => window.libraryApp.unmount())
      await expect(stage).toHaveCount(0)
      const drawCount = await page.evaluate(() => window.libraryDrawCount)
      await elapsed(page, 220)
      expect(await page.evaluate(() => window.libraryDrawCount)).toBe(drawCount)
      expect(await page.evaluate(() => window.libraryApp.activeTweens())).toBe(0)
      traces[orbitStyle] = poses
      await artifact(testInfo, `library-orbit-${orbitStyle}.png`, moved)
    }
    for (let first = 0; first < ORBITS.length; first++) for (let second = first + 1; second < ORBITS.length; second++) {
      const a = traces[ORBITS[first]], b = traces[ORBITS[second]]
      const separation = a.reduce((sum, pose, index) => sum + Math.abs(pose.x - b[index].x) + Math.abs(pose.y - b[index].y), 0)
      expect(separation, `${ORBITS[first]}/${ORBITS[second]}`).toBeGreaterThan(.05)
    }
    await artifact(testInfo, 'library-orbit-paths.json', JSON.stringify(traces, null, 2), 'application/json')
    expect(errors).toEqual([])
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`complete gallery and workbench libraries remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      test.setTimeout(75_000)
      const { errors, paidRequests } = await prepare(page, { viewport, reducedMotion: 'reduce' })
      for (const route of ['sample', 'workbench']) {
        await page.goto(route === 'sample' ? '/holo-card/sample' : '/holo-card', { waitUntil: 'domcontentloaded' })
        const stage = page.locator(route === 'sample' ? '.sample-relief-stage' : '[data-card-template="astral"]')
        await expect(stage).toHaveAttribute(route === 'sample' ? 'data-sample-state' : 'data-holo-state', 'ready', { timeout: 20_000 })
        const dock = page.getByRole('group', { name: route === 'sample' ? '样卡材质' : '镭射材质', exact: true })
        expect(await dock.getByRole('button').count()).toBeLessThanOrEqual(6)
        for (const button of await dock.getByRole('button').all()) await expect(button).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
        let scope
        if (route === 'sample') scope = await openLighting(page)
        else {
          await page.getByRole('button', { name: '视觉玩法', exact: true }).click()
          scope = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
        }
        const close = scope.getByRole('button', { name: route === 'sample' ? '关闭面板' : '关闭编辑面板', exact: true })
        const tabs = scope.getByRole('tablist', { name: '风格库分类', exact: true })
        await expect(tabs.getByRole('tab')).toHaveText(['灵感', '材质', '纹理', '动态'])
        await tabs.getByRole('tab', { name: '灵感', exact: true }).focus()
        await page.keyboard.press('End')
        await expect(tabs.getByRole('tab', { name: '动态', exact: true })).toBeFocused()
        await expect(tabs.getByRole('tab', { name: '动态', exact: true })).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('Home')
        await expect(tabs.getByRole('tab', { name: '灵感', exact: true })).toBeFocused()
        const presets = scope.getByRole('group', { name: '灵感搭配', exact: true }).getByRole('button')
        await expect(presets).toHaveCount(8)
        for (const button of await presets.all()) {
          await button.scrollIntoViewIfNeeded()
          await expect(button).toBeInViewport()
          await expect(button).toBeEnabled()
        }
        await expect(close).toBeInViewport()
        await section(scope, '材质')
        await expect(scope.getByRole('group', { name: '全部材质', exact: true }).getByRole('button')).toHaveCount(9)
        for (const label of FINISH_LABELS) {
          const button = scope.getByRole('button', { name: `${label}材质`, exact: true })
          await button.scrollIntoViewIfNeeded()
          await expect(button).toBeInViewport()
          await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
        }
        await artifact(testInfo, `${route}-library-materials-${viewport.width}.png`, await page.screenshot({ animations: 'allow' }))
        await section(scope, '纹理')
        await expect(scope.getByRole('group', { name: '视觉纹理', exact: true }).getByRole('button')).toHaveCount(9)
        for (const label of PATTERN_LABELS) {
          const button = scope.getByRole('button', { name: `${label}纹理`, exact: true })
          await button.scrollIntoViewIfNeeded()
          await expect(button).toBeInViewport()
          await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
        }
        await section(scope, '动态')
        for (const label of ['环绕', '摇曳', '蝶舞', '悬浮']) {
          const button = scope.getByRole('button', { name: `${label}轨迹`, exact: true })
          await button.scrollIntoViewIfNeeded()
          await expect(button).toBeInViewport()
          await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
        }
        for (const label of ['掠光', '光环', '彗星', '星芒']) {
          const button = scope.getByRole('button', { name: `${label}光效`, exact: true })
          await button.scrollIntoViewIfNeeded()
          await expect(button).toBeInViewport()
          await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
        }
        await expect(scope.getByRole('button', { name: '光影巡游', exact: true })).toBeDisabled()
        await expect(scope.getByRole('button', { name: '光影巡游', exact: true })).toHaveAttribute('aria-pressed', 'false')
        await expect(scope.getByRole('button', { name: '点亮卡片', exact: true })).toBeDisabled()
        await expect(close).toBeInViewport()
        const bounds = await scope.boundingBox()
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
        await artifact(testInfo, `${route}-library-motion-${viewport.width}.png`, await page.screenshot({ animations: 'allow' }))
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await scope.getByRole('button', { name: '透视拆层', exact: true }).click()
        await expect(scope.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await scope.getByRole('button', { name: '蝶舞轨迹', exact: true }).click()
        await expect(scope.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'false')
        await expect(scope.getByRole('button', { name: '光影巡游', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(stage).toHaveAttribute('data-card-orbit', 'running')
        await scope.getByRole('button', { name: '光影巡游', exact: true }).click()
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await close.click()
        await expect(scope).toBeHidden()
      }
      expect(errors).toEqual([])
      expect(paidRequests).toEqual([])
    })
  }

  test('a preset applies its complete look atomically and preserves artwork, text, depth, pause, and reverse', async ({ page }, testInfo) => {
    test.setTimeout(45_000)
    const { errors, paidRequests } = await prepare(page, { viewport: { width: 1440, height: 900 } })
    const original = await readFile(portraitPath)
    await page.goto('/holo-card', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '选择图片', exact: true })).toBeEnabled()
    await page.getByLabel('上传原图', { exact: true }).setInputFiles(sourcePath)
    await expect(page.locator('.holo-status')).toHaveText('版式已就绪 · 待分离主体')
    await page.getByLabel('导入透明主体', { exact: true }).setInputFiles(portraitPath)
    await expect(page.getByAltText('待验收透明主体')).toBeVisible()
    await page.getByRole('button', { name: '采用此图层', exact: true }).click()
    const stage = page.locator('.holo-card-stage')
    await expect(stage).toHaveAttribute('data-holo-state', 'ready')
    await page.getByRole('button', { name: '设计面板', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true })
    await editor.locator('summary').filter({ hasText: '卡面文字' }).click()
    await page.getByRole('textbox', { name: '卡片名称', exact: true }).fill('保留的卡片名称')
    await page.getByRole('textbox', { name: '副标题', exact: true }).fill('ORIGINAL / PRESERVED')
    await editor.locator('summary').filter({ hasText: '细节调节' }).click()
    await page.getByRole('slider', { name: '图层深度', exact: true }).press('End')
    await expect(page.getByRole('slider', { name: '图层深度', exact: true })).toHaveValue('1')
    await page.getByRole('button', { name: '关闭编辑面板', exact: true }).click()
    await page.getByRole('button', { name: '静止预览', exact: true }).click()
    await page.getByRole('button', { name: '翻转卡片', exact: true }).click()
    await expect(stage).toHaveAttribute('data-holo-face', 'back')
    await page.getByRole('button', { name: '视觉玩法', exact: true }).click()
    await section(editor, '灵感')
    await editor.getByRole('button', { name: '透视拆层', exact: true }).click()
    await expect(editor.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const beforeSelection = await editor.locator('.holo-library-selection').textContent()
    await page.evaluate(() => {
      const node = document.querySelector('.holo-library-selection')
      window.libraryPresetSelections = []
      window.libraryPresetObserver = new MutationObserver(() => window.libraryPresetSelections.push(node.textContent))
      window.libraryPresetObserver.observe(node, { childList: true, characterData: true, subtree: true })
    })
    await editor.getByRole('button', { name: '月下冰晶搭配', exact: true }).click()
    await expect(editor.getByRole('button', { name: '月下冰晶搭配', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const afterSelection = await editor.locator('.holo-library-selection').textContent()
    const selections = await page.evaluate(() => { window.libraryPresetObserver.disconnect(); return window.libraryPresetSelections })
    expect(selections.length).toBeGreaterThan(0)
    expect(selections.every(value => value === beforeSelection || value === afterSelection)).toBe(true)
    expect(afterSelection).toContain('冰晶')
    expect(afterSelection).toContain('碎钻')
    expect(afterSelection).toContain('月下冰晶')
    await expect(editor.getByRole('button', { name: '光影巡游', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(editor.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '启用鼠标交互', exact: true })).toBeVisible()
    await expect(stage).toHaveAttribute('data-holo-face', 'back')
    await section(editor, '动态')
    await expect(editor.getByRole('button', { name: '悬浮轨迹', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(editor.getByRole('button', { name: '掠光光效', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await editor.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name: '设计', exact: true }).click()
    await expect(page.getByRole('slider', { name: '镭射强度', exact: true })).toHaveValue('0.64')
    await expect(page.getByRole('textbox', { name: '卡片名称', exact: true })).toHaveValue('保留的卡片名称')
    await expect(page.getByRole('textbox', { name: '副标题', exact: true })).toHaveValue('ORIGINAL / PRESERVED')
    await expect(page.getByRole('slider', { name: '图层深度', exact: true })).toHaveValue('1')
    await editor.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name: '图层', exact: true }).click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载原始透明 PNG', exact: true }).click()
    const download = await downloading
    const returned = await downloadBytes(download)
    expect(hash(returned)).toBe(hash(original))
    expect(returned).toEqual(original)
    await editor.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name: '设计', exact: true }).click()
    await page.getByRole('button', { name: '原图闪卡', exact: true }).click()
    await expect(stage).toHaveAttribute('data-holo-mode', 'original')
    await editor.getByRole('tablist', { name: '编辑面板', exact: true }).getByRole('tab', { name: '玩法', exact: true }).click()
    await expect(editor.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(editor.getByRole('button', { name: '透视拆层', exact: true })).toBeDisabled()
    await artifact(testInfo, 'preset-preserved-artwork.json', JSON.stringify({ beforeSelection, afterSelection, selections,
      subjectHash: hash(returned), title: '保留的卡片名称', subtitle: 'ORIGINAL / PRESERVED', depth: 1, paused: true, flipped: true }, null, 2), 'application/json')
    expect(errors).toEqual([])
    expect(paidRequests).toEqual([])
  })

  test('a dragged card keeps its angle when editing controls take focus and returns to rest over open space', async ({ page }, testInfo) => {
    const { errors, paidRequests } = await prepare(page, { viewport: { width: 1440, height: 900 } })
    await page.goto('/holo-card/sample', { waitUntil: 'domcontentloaded' })
    const stage = page.locator('.sample-relief-stage'), canvas = stage.locator('canvas')
    await expect(stage).toHaveAttribute('data-sample-state', 'ready', { timeout: 20_000 })
    await expect(canvas).toHaveCSS('transform', 'none')
    await stage.press('Home')
    await stable(canvas)
    const neutralAlpha = await alphaSignature(canvas)
    const box = await stage.boundingBox()
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
    await page.mouse.down()
    await expect(stage).toBeFocused()
    await page.mouse.move(box.x + box.width * .79, box.y + box.height * .46, { steps: 8 })
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-sample-dragging', 'false')
    const tilted = await stable(canvas), tiltedAlpha = await alphaSignature(canvas)
    expect(tiltedAlpha).not.toEqual(neutralAlpha)
    const popup = await openLighting(page)
    await expect(stage).not.toBeFocused()
    expect(hash(await stable(canvas))).toBe(hash(tilted))
    await section(popup, '纹理')
    expect(hash(await stable(canvas))).toBe(hash(tilted))
    const gloss = popup.getByRole('slider', { name: '样卡光泽', exact: true })
    await gloss.focus()
    await gloss.press('End')
    const adjusted = await stable(canvas)
    expect((await difference(page, tilted, adjusted)).changedPixels).toBeGreaterThan(500)
    // Changing the coating can change RGB, while the unchanged alpha silhouette
    // proves that focusing the editor did not rotate or recenter the card.
    expect(await alphaSignature(canvas)).toEqual(tiltedAlpha)
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await page.mouse.move(box.x + box.width * .72, box.y + box.height * .5)
    await stable(canvas)
    await page.mouse.move(12, 100)
    await stable(canvas)
    expect(await alphaSignature(canvas)).toEqual(neutralAlpha)
    await artifact(testInfo, 'drag-edit-angle-preserved.png', adjusted)
    await artifact(testInfo, 'drag-edit-angle-alpha.json', JSON.stringify({ neutralAlpha, tiltedAlpha }, null, 2), 'application/json')
    expect(errors).toEqual([])
    expect(paidRequests).toEqual([])
  })

  test('new finishes and inspiration looks produce a real recorded gallery demonstration', async ({ browser }, testInfo) => {
    test.setTimeout(90_000)
    const context = await browser.newContext({
      baseURL: process.env.WEB_BASE_URL || 'http://127.0.0.1:3106', viewport: { width: 1440, height: 900 },
      recordVideo: { dir: testInfo.outputPath('recording'), size: { width: 1440, height: 900 } },
    })
    const page = await context.newPage(), video = page.video()
    try {
      const { errors, paidRequests } = await prepare(page, { viewport: { width: 1440, height: 900 } })
      await page.goto('/holo-card/sample', { waitUntil: 'domcontentloaded' })
      const stage = page.locator('.sample-relief-stage'), canvas = stage.locator('canvas')
      await expect(stage).toHaveAttribute('data-sample-state', 'ready', { timeout: 20_000 })
      await expect(canvas).toHaveCSS('transform', 'none')
      await page.evaluate(() => document.fonts.ready)
      const box = await stage.boundingBox()
      await page.mouse.move(box.x + box.width * .2, box.y + box.height * .45, { steps: 30 })
      await elapsed(page, 800)
      for (const [preset, id, side] of [
        ['蔷薇鎏金', 'rose-silk', .83], ['月下冰晶', 'frost', .2],
        ['黑曜典藏', 'nocturne', .83], ['幻彩欧泊', 'opal-tide', .2],
      ]) {
        const popup = await openLighting(page)
        await section(popup, '灵感')
        await popup.getByRole('button', { name: `${preset}搭配`, exact: true }).click()
        await expect(popup.getByRole('button', { name: `${preset}搭配`, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await page.keyboard.press('Escape')
        await expect(popup).toHaveCount(0)
        await page.mouse.move(box.x + box.width * side, box.y + box.height * .52, { steps: 38 })
        await elapsed(page, 1_100)
        await artifact(testInfo, `library-look-${id}.png`, await page.screenshot({ animations: 'allow' }))
      }

      for (const [label, id] of [['彗星', 'comet'], ['星芒', 'cross']]) {
        const popup = await openLighting(page)
        await section(popup, '动态')
        await popup.getByRole('button', { name: `${label}光效`, exact: true }).click()
        await popup.getByRole('button', { name: '点亮卡片', exact: true }).click()
        await page.keyboard.press('Escape')
        await expect(popup).toHaveCount(0)
        await elapsed(page, 250)
        await artifact(testInfo, `library-live-${id}.png`, await page.screenshot({ animations: 'allow' }))
        await elapsed(page, 700)
      }
      for (const [label, id] of [['蝶舞', 'figure8'], ['悬浮', 'float']]) {
        const popup = await openLighting(page)
        await section(popup, '动态')
        await popup.getByRole('button', { name: `${label}轨迹`, exact: true }).click()
        await expect(popup.getByRole('button', { name: `${label}轨迹`, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await page.keyboard.press('Escape')
        await expect(popup).toHaveCount(0)
        await page.mouse.move(25, 100)
        await expect(stage).toHaveAttribute('data-card-orbit', 'running')
        await elapsed(page, 1_700)
        await artifact(testInfo, `library-live-${id}.png`, await page.screenshot({ animations: 'allow' }))
      }
      const popup = await openLighting(page)
      await popup.getByRole('button', { name: '透视拆层', exact: true }).click()
      await expect(popup.getByRole('button', { name: '透视拆层', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
      await expect(stage).toHaveAttribute('data-card-orbit', 'idle')
      await elapsed(page, 1_200)
      await artifact(testInfo, 'library-opal-exploded.png', await page.screenshot({ animations: 'allow' }))
      await page.getByRole('button', { name: '复位样卡', exact: true }).click()
      await elapsed(page, 1_000)
      expect(errors).toEqual([])
      expect(paidRequests).toEqual([])
    } finally {
      await context.close()
      const path = testInfo.outputPath('holo-card-library-demo.webm')
      await video.saveAs(path)
      await testInfo.attach('holo-card-library-demo.webm', { path, contentType: 'video/webm' })
    }
  })
})
