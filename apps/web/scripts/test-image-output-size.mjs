import assert from 'node:assert/strict'
import {
  GPT_IMAGE_OUTPUT_LIMITS,
  normalizeGptImageOutputSize,
} from '../src/services/aiImageOutputSize.js'

const cases = [
  { input: [778, 1024], expected: [784, 1024] },
  { input: [1556, 2048], expected: [1552, 2048] },
  { input: [2335, 3072], expected: [2336, 3072] },
  { input: [2918, 3840], expected: [2512, 3296] },
  { input: [2432, 3200], expected: [2432, 3200] },
  { input: [2160, 3840], expected: [2160, 3840] },
  { input: [3840, 3840], expected: [2880, 2880] },
]

for (const { input, expected } of cases) {
  const result = normalizeGptImageOutputSize(...input)
  assert.deepEqual([result.width, result.height], expected)

  const longEdge = Math.max(result.width, result.height)
  const shortEdge = Math.min(result.width, result.height)
  const pixels = result.width * result.height
  assert.equal(result.width % GPT_IMAGE_OUTPUT_LIMITS.step, 0)
  assert.equal(result.height % GPT_IMAGE_OUTPUT_LIMITS.step, 0)
  assert.ok(longEdge <= GPT_IMAGE_OUTPUT_LIMITS.maxEdge)
  assert.ok(longEdge / shortEdge <= GPT_IMAGE_OUTPUT_LIMITS.maxAspectRatio)
  assert.ok(pixels >= GPT_IMAGE_OUTPUT_LIMITS.minPixels)
  assert.ok(pixels <= GPT_IMAGE_OUTPUT_LIMITS.maxPixels)
}

console.log(`image output size tests passed (${cases.length} cases)`)
