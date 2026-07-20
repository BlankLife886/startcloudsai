import assert from 'node:assert/strict'
import {
  formatOutputSize,
  resolveTaskOutputSizeFields,
} from '../src/features/ai-wallpaper/domain/outputSizeMetadata.js'

const upstreamJob = {
  input: {
    outputSize: '2352x3520',
    resolutionScale: '8K',
  },
}

assert.deepEqual(resolveTaskOutputSizeFields(upstreamJob), {
  upstreamOutputSize: '2352x3520',
  upscaleTargetSize: '',
  originalOutputSize: '',
  actualOutputSize: '',
  outputSize: '2352x3520',
})

const refreshed = resolveTaskOutputSizeFields(upstreamJob, {
  outputSize: '5136x7680',
  upstreamOutputSize: '2352x3520',
  originalOutputSize: '2352x3520',
  actualOutputSize: '5136x7680',
  upscaleTargetSize: '5136x7680',
})
assert.equal(refreshed.upstreamOutputSize, '2352x3520')
assert.equal(refreshed.actualOutputSize, '5136x7680')
assert.equal(refreshed.outputSize, '5136x7680', '远程刷新不能覆盖本地 8K 真实尺寸')

const migratedLegacyTask = resolveTaskOutputSizeFields(upstreamJob, {
  outputSize: '2352x3520',
  originalOutputSize: '2352x3520',
  actualOutputSize: '5136x7680',
})
assert.equal(migratedLegacyTask.upstreamOutputSize, '2352x3520')
assert.equal(migratedLegacyTask.outputSize, '5136x7680')
assert.equal(formatOutputSize(migratedLegacyTask.outputSize), '5136×7680')

console.log('wallpaper output size metadata contract: ok')
