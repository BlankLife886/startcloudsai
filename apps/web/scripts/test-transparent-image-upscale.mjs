import assert from 'node:assert/strict'
import { resolveAdaptiveSharpening } from '../src/features/ai-wallpaper/services/localImageQualityAnalysis.js'
import { refineTransparentImageData } from '../src/features/ai-wallpaper/services/transparentEdgeRefinement.js'

const width = 5
const height = 5
const pixels = new Uint8ClampedArray(width * height * 4)
for (let y = 0; y < height; y += 1) {
  for (let x = 2; x < width; x += 1) {
    const offset = (y * width + x) * 4
    pixels[offset] = 220
    pixels[offset + 1] = 36
    pixels[offset + 2] = 48
    pixels[offset + 3] = 255
  }
}

const refinement = refineTransparentImageData(pixels, width, height)
assert.ok(refinement.changedPixels > 0, 'hard Alpha edge should be reconstructed')
const outsideEdge = (2 * width + 1) * 4
const insideEdge = (2 * width + 2) * 4
assert.ok(pixels[outsideEdge + 3] > 0 && pixels[outsideEdge + 3] < 255)
assert.ok(pixels[insideEdge + 3] > 0 && pixels[insideEdge + 3] < 255)
assert.ok(pixels[outsideEdge] > pixels[outsideEdge + 1], 'new edge RGB should inherit logo colour')

assert.deepEqual(
  resolveAdaptiveSharpening('8K', {
    profile: 'transparent-graphic',
    hasTransparency: true,
  }),
  { unsharpAmount: 0, unsharpRadius: 0.5, unsharpThreshold: 0 },
)
assert.ok(
  resolveAdaptiveSharpening('4K', {
    profile: 'balanced',
    sharpness: 0.5,
    noise: 0.1,
    contrast: 0.5,
  }).unsharpAmount > 0,
  'opaque photos should retain adaptive sharpening',
)

console.log('transparent image upscale tests passed')
