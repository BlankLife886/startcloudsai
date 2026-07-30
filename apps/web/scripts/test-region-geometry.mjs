import assert from 'node:assert/strict'
import {
  attachNaturalBounds,
  clampBounds,
  fitAnalysisViewport,
  naturalBoundsForNode,
  projectBounds,
  referenceNeedsRasterization,
} from '../src/features/design-workshop/regionGeometry.js'

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
  projectBounds(
    { x: 1600, y: 400, width: 320, height: 120 },
    reportedDesign,
    reportedAnalysis,
    { integer: true },
  ),
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

console.log('region geometry tests passed')
