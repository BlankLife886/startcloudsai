import assert from 'node:assert/strict'
import {
  attachNaturalBounds,
  clampBounds,
  containedContentBox,
  fitAnalysisViewport,
  naturalBoundsForNode,
  normalizeCropElementItems,
  projectBounds,
  projectContainerRegionToContent,
  referenceNeedsRasterization,
  sourcePixelBoundsForRegion,
} from '../src/legacy-modules/features/design-workshop/regionGeometry.js'
import { parseCropElementResponse } from '../src/legacy-modules/features/design-workshop/cropElementResponse.js'

const analysis = { width: 1920, height: 1080 }
const source = { width: 3840, height: 2160 }

assert.deepEqual(fitAnalysisViewport(source), {
  width: 1920,
  height: 1080,
  background: '#ffffff',
})
assert.equal(referenceNeedsRasterization(source, analysis), true)
assert.equal(referenceNeedsRasterization(analysis, analysis), false)

const reportedDesign = { width: 2646, height: 1366 }
const reportedAnalysis = fitAnalysisViewport(reportedDesign)
assert.deepEqual(reportedAnalysis, { width: 1920, height: 991, background: '#ffffff' })
assert.deepEqual(
  projectBounds({ x: 1600, y: 400, width: 320, height: 120 }, reportedDesign, reportedAnalysis, {
    integer: true,
  }),
  { x: 1161, y: 290, width: 232, height: 87 },
)

assert.deepEqual(
  projectBounds({ x: 240, y: 135, width: 480, height: 270 }, analysis, source, {
    integer: true,
  }),
  { x: 480, y: 270, width: 960, height: 540 },
)

assert.deepEqual(
  clampBounds({ x: 3839.6, y: -20, width: 100, height: 2200 }, source, { integer: true }),
  { x: 3839, y: 0, width: 1, height: 2160 },
)

assert.deepEqual(
  naturalBoundsForNode(
    {
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      naturalBounds: { x: 201, y: 202, width: 403, height: 244 },
    },
    analysis,
    source,
  ),
  { x: 201, y: 202, width: 403, height: 244 },
)

const [node] = attachNaturalBounds(
  [{ id: 'button', x: 120, y: 80, width: 220, height: 64 }],
  analysis,
  source,
)
assert.deepEqual(node.naturalBounds, { x: 240, y: 160, width: 440, height: 128 })
assert.equal(node.coordinateSpace, 'source-pixels')

assert.deepEqual(containedContentBox({ width: 1600, height: 900 }, { width: 1200, height: 1200 }), {
  x: 350,
  y: 0,
  width: 900,
  height: 900,
})
const projectedContentRegion = projectContainerRegionToContent(
  { x: 0.125, y: 0.2, width: 0.5, height: 0.4 },
  { width: 1600, height: 900 },
  { width: 1200, height: 1200 },
)
assert.equal(projectedContentRegion.x, 0)
assert.ok(Math.abs(projectedContentRegion.y - 0.2) < 1e-9)
assert.ok(Math.abs(projectedContentRegion.width - 13 / 18) < 1e-9)
assert.ok(Math.abs(projectedContentRegion.height - 0.4) < 1e-9)
assert.deepEqual(
  sourcePixelBoundsForRegion(
    { x: 0.1, y: 0.2, width: 0.333, height: 0.444 },
    { width: 1000, height: 500 },
  ),
  { x: 100, y: 100, width: 333, height: 222 },
)

const normalizedCropItems = normalizeCropElementItems(
  [
    { id: 'grid', x: 250, y: 100, width: 500, height: 200 },
    { id: 'corners', boundingBox: { left: 100, top: 200, right: 300, bottom: 500 } },
    { id: 'edge', x: 975, y: 900, width: 100, height: 200 },
  ],
  {
    viewport: { width: 800, height: 400 },
    coordinateSpace: { width: 1000, height: 1000, unit: 'normalized' },
  },
)
assert.deepEqual(
  normalizedCropItems.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [
    { id: 'grid', x: 200, y: 40, width: 400, height: 80 },
    { id: 'corners', x: 80, y: 80, width: 160, height: 120 },
    { id: 'edge', x: 780, y: 360, width: 20, height: 40 },
  ],
)
assert.deepEqual(
  normalizeCropElementItems(
    [{ id: 'percent', bounds: { x: '10%', y: '20%', width: '25%', height: '30%' } }],
    { viewport: { width: 800, height: 400 } },
  ).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [{ id: 'percent', x: 80, y: 80, width: 200, height: 120 }],
)
assert.deepEqual(
  normalizeCropElementItems([{ id: 'unit', bbox: [0.1, 0.2, 0.3, 0.4] }], {
    viewport: { width: 1000, height: 500 },
  }).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [{ id: 'unit', x: 100, y: 100, width: 300, height: 200 }],
)
assert.deepEqual(
  normalizeCropElementItems(
    [{ id: 'unit-with-reported-viewport', x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    {
      viewport: { width: 1000, height: 500 },
      reportedViewport: { width: 1000, height: 500 },
    },
  ).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [{ id: 'unit-with-reported-viewport', x: 100, y: 100, width: 300, height: 200 }],
)
assert.deepEqual(
  normalizeCropElementItems(
    [{ id: 'unit-despite-grid-metadata', x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    {
      viewport: { width: 1000, height: 500 },
      coordinateSpace: { width: 1000, height: 1000, unit: 'normalized' },
    },
  ).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [{ id: 'unit-despite-grid-metadata', x: 100, y: 100, width: 300, height: 200 }],
)
assert.deepEqual(
  normalizeCropElementItems(
    [
      {
        id: 'percent-corners',
        box_2d: ['20%', '10%', '60%', '50%'],
        boxFormat: 'yxyx',
      },
    ],
    {
      viewport: { width: 800, height: 400 },
      reportedViewport: { width: 800, height: 400 },
    },
  ).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [{ id: 'percent-corners', x: 80, y: 80, width: 320, height: 160 }],
)
assert.deepEqual(
  normalizeCropElementItems(
    [
      {
        id: 'pixels-as-strings',
        bounds: { x: '10px', y: '20px', width: '30px', height: '40px' },
      },
    ],
    { viewport: { width: 800, height: 400 } },
  ).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  [{ id: 'pixels-as-strings', x: 10, y: 20, width: 30, height: 40 }],
)

const cropNode = (id, x = 10) => ({
  id,
  name: id,
  type: 'image',
  x,
  y: 20,
  width: 30,
  height: 40,
  text: '',
})
const coordinateSpace = { width: 1000, height: 1000, unit: 'normalized' }

assert.deepEqual(
  parseCropElementResponse(
    `分析如下：{"coordinateSpace":{"width":1000,"height":1000,"unit":"normalized"},"nodes":[${JSON.stringify(cropNode('prefix'))}]} 完成。`,
  ).items.map((item) => item.id),
  ['prefix'],
)
assert.deepEqual(
  parseCropElementResponse(
    `:::writing{variant="standard" id="result"}\n${JSON.stringify({ coordinateSpace, nodes: [cropNode('wrapped')] })}\n:::`,
  ).items.map((item) => item.id),
  ['wrapped'],
)
const truncatedCropResponse = `{"coordinateSpace":{"width":1000,"height":1000,"unit":"normalized"},"nodes":[${JSON.stringify(cropNode('first'))},${JSON.stringify(cropNode('second', 60))},{"id":"unfinished"`
const recoveredCrop = parseCropElementResponse(truncatedCropResponse)
assert.deepEqual(
  recoveredCrop.items.map((item) => item.id),
  ['first', 'second'],
)
assert.equal(recoveredCrop.partial, true)
assert.deepEqual(recoveredCrop.coordinateSpace, coordinateSpace)
assert.throws(
  () =>
    parseCropElementResponse(
      '{"coordinateSpace":{"width":1000,"height":1000,"unit":"normalized"},"nodes":[',
    ),
  /响应不完整/,
)
assert.deepEqual(
  parseCropElementResponse(
    JSON.stringify({ data: { result: { elements: [cropNode('nested')] } }, coordinateSpace }),
  ).items.map((item) => item.id),
  ['nested'],
)
assert.throws(
  () =>
    parseCropElementResponse(JSON.stringify({ nodes: [cropNode('rejected')] }), () => {
      throw new Error('元素被合并成整块区域了，需要拆成多个可点选元素')
    }),
  /元素被合并成整块区域了/,
)

console.log('region geometry tests passed')
