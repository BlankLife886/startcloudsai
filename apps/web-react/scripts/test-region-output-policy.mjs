import assert from 'node:assert/strict'
import {
  nearestRegionOutputRatio,
  normalizeRegionRecognitionTypes,
  regionNodeMatchesRecognitionTypes,
  resolveRegionImageRequestSize,
  resolveRegionSelectionRequestSize,
} from '../src/legacy-modules/features/design-workshop/regionOutputPolicy.js'

assert.deepEqual(normalizeRegionRecognitionTypes([]), [])
assert.deepEqual(normalizeRegionRecognitionTypes(['icon', 'icon', 'unknown', 'text']), [
  'icon',
  'text',
])

assert.equal(regionNodeMatchesRecognitionTypes({ type: 'text' }, []), false)
assert.equal(regionNodeMatchesRecognitionTypes({ type: 'text' }, ['text']), true)
assert.equal(regionNodeMatchesRecognitionTypes({ type: 'button' }, ['text']), true)
assert.equal(regionNodeMatchesRecognitionTypes({ type: 'icon' }, ['icon']), true)
assert.equal(regionNodeMatchesRecognitionTypes({ type: 'image' }, ['icon']), false)
assert.equal(regionNodeMatchesRecognitionTypes({ type: 'image' }, ['image']), true)

assert.equal(nearestRegionOutputRatio(1000, 1000), '1:1')
assert.equal(nearestRegionOutputRatio(1920, 1080), '16:9')
assert.equal(nearestRegionOutputRatio(2000, 1000), '16:9')
assert.equal(nearestRegionOutputRatio(1080, 1920), '9:16')
assert.equal(nearestRegionOutputRatio(1200, 900), '4:3')
assert.equal(nearestRegionOutputRatio(900, 1200), '3:4')
assert.equal(nearestRegionOutputRatio(1500, 1000), '3:2')
assert.equal(nearestRegionOutputRatio(1920, 1080, ['1:1']), '1:1')
assert.equal(nearestRegionOutputRatio(1080, 1920, ['1:1', '9:16']), '9:16')

assert.equal(resolveRegionImageRequestSize('16:9', '1K'), '1280x720')
assert.equal(resolveRegionImageRequestSize('9:16', '2K'), '1152x2048')
assert.equal(resolveRegionImageRequestSize('1:1', '1K'), '1024x1024')
assert.equal(resolveRegionImageRequestSize('1024x768', '1K'), '1024x768')
assert.equal(resolveRegionImageRequestSize('16:9', '1K').includes(':'), false)
assert.equal(resolveRegionImageRequestSize('invalid', '1K'), 'auto')

assert.equal(resolveRegionSelectionRequestSize(1310, 226), '1484x256')
assert.equal(resolveRegionSelectionRequestSize(1920, 1080), '1920x1080')
assert.equal(resolveRegionSelectionRequestSize(8000, 4000), '4096x2048')
assert.equal(resolveRegionSelectionRequestSize(200, 100), '512x256')

console.log('region output policy tests passed')
