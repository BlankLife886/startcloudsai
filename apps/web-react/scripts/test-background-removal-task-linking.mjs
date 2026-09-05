import assert from 'node:assert/strict'
import {
  inheritBackgroundRemovalPresentation,
  isAutomaticBackgroundRemovalJob,
} from '../src/legacy-modules/features/ai-wallpaper/domain/backgroundRemovalTasks.js'

assert.equal(
  isAutomaticBackgroundRemovalJob({
    kind: 'wallpaper-background-remove',
    params: { _automatic: true, _parentTaskId: 'parent-1' },
  }),
  true,
)
assert.equal(
  isAutomaticBackgroundRemovalJob({
    kind: 'image-tool-background-remove',
    params: { _automatic: false, _parentTaskId: '' },
  }),
  false,
  '手动抠图任务不能混入文生图历史',
)

const linked = inheritBackgroundRemovalPresentation(
  {
    automaticBackgroundRemoval: true,
    parentOutputIndex: 0,
    aspectRatio: '16:9',
    outputs: ['cutout.png'],
  },
  {
    serverJobId: 'parent-1',
    originalOutputs: ['source.png'],
    aspectRatio: '1:1',
    actualOutputSize: '2048x2048',
    prompt: 'product photo',
  },
)

assert.equal(linked.sourcePreview, 'source.png')
assert.equal(linked.originalOutputUrl, 'source.png')
assert.equal(linked.aspectRatio, '1:1')
assert.equal(linked.actualOutputSize, '2048x2048')

console.log('background removal task linking checks passed')
