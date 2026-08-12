/**
 * Visual QA for tile precision refine.
 *
 * Usage:
 *   npm run test:tile-precision-refine:visual
 *   TILE_REFINE_IMAGE=/path/to.png npm run test:tile-precision-refine:visual
 *   TILE_REFINE_MODE=identity npm run test:tile-precision-refine:visual
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(webRoot, '../..')
const outDir = path.resolve(repoRoot, '.artifacts/qa/tile-refine')

// 默认用页面内合成的干净仪表盘源图（历史 source.png 可能是旧 bug 的污染产物）。
const imagePath = process.env.TILE_REFINE_IMAGE
  ? path.resolve(process.env.TILE_REFINE_IMAGE)
  : ''
const mode = process.env.TILE_REFINE_MODE || 'divergent'

await mkdir(outDir, { recursive: true })

const server = await createServer({
  root: webRoot,
  optimizeDeps: { noDiscovery: true },
  server: {
    port: 5198,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [webRoot, outDir, ...(imagePath ? [path.dirname(imagePath)] : [])] },
  },
  logLevel: 'error',
})
await server.listen()

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

try {
  await page.goto('http://127.0.0.1:5198/scripts/tile-refine-visual.html', {
    waitUntil: 'networkidle',
    timeout: 60000,
  })
  await page.waitForFunction(() => Boolean(window.__tileRefineVisual?.run), null, {
    timeout: 30000,
  })

  // Serve local sample image through the vite origin; empty means synthetic source.
  const imageUrl = imagePath ? `/@fs${imagePath}` : ''
  const result = await page.evaluate(
    async ({ imageUrl: url, mode: runMode }) => window.__tileRefineVisual.run(url, { mode: runMode }),
    { imageUrl, mode },
  )

  assert.ok(result?.stitchedPngBase64, 'missing stitched image')
  assert.ok(result.width >= 2 && result.height >= 2, 'bad stitch size')

  const pngPath = path.join(outDir, `stitched-${mode}.png`)
  const metaPath = path.join(outDir, `stitched-${mode}.json`)
  await writeFile(pngPath, Buffer.from(result.stitchedPngBase64, 'base64'))
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        mode,
        imagePath: imagePath || 'synthetic',
        width: result.width,
        height: result.height,
        scale: result.scale,
        seamMae: result.seamMae,
        shifts: result.shifts,
        tiles: result.tiles,
        consoleErrors,
        writtenAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  assert.equal(result.sizeMatch, true, 'stitched size must equal source')
  assert.equal(result.scale, 1, 'hard paste must keep scale=1')

  // Identity: exact crop hard-paste must reconstruct the source with zero pixel error.
  if (mode === 'identity') {
    assert.equal(result.seamMae, 0, `identity MAE must be 0, got ${result.seamMae}`)
    assert.equal(result.maxDelta, 0, `identity maxDelta must be 0, got ${result.maxDelta}`)
  }

  // Divergent: align + fuse + hard paste; keep full-frame MAE bounded after correction.
  if (mode === 'divergent') {
    assert.ok(result.seamMae < 12, `divergent MAE too high: ${result.seamMae}`)
  }

  console.log(
    `test-tile-precision-refine-visual: ok mode=${mode} ${result.width}x${result.height} seamMae=${result.seamMae} -> ${pngPath}`,
  )
} finally {
  await browser.close()
  await server.close()
}
