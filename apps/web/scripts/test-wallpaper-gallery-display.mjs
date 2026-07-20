import assert from 'node:assert/strict'
import {
  normalizeVisibleDisplayPositions,
  uniqueTaskOutputs,
} from '../src/features/ai-wallpaper/domain/galleryDisplay.js'

assert.deepEqual(
  uniqueTaskOutputs({ outputs: ['https://img.test/one.png', 'https://img.test/one.png', ''] }),
  ['https://img.test/one.png'],
  '单任务重复结果 URL 必须只显示一次',
)

const singleVisible = normalizeVisibleDisplayPositions([
  {
    kind: 'image',
    task: { id: 'single-task' },
    index: 0,
    batchIndex: 0,
    total: 2,
  },
])
assert.equal(singleVisible[0].total, 1, '实际只有一张图时不得保留 1/2 角标')

const twoVisible = normalizeVisibleDisplayPositions([
  { kind: 'image', task: { id: 'two-task' }, index: 0, total: 2 },
  { kind: 'image', task: { id: 'two-task' }, index: 1, total: 2 },
])
assert.deepEqual(
  twoVisible.map(({ batchIndex, total }) => [batchIndex, total]),
  [
    [0, 2],
    [1, 2],
  ],
)

const partialBatch = normalizeVisibleDisplayPositions([
  {
    kind: 'image',
    task: { id: 'batch-child-1', batchId: 'batch-1', batchIndex: 0 },
    index: 0,
    total: 2,
  },
])
assert.equal(partialBatch[0].total, 1, '同批只有一个可见结果时不得显示 1/2')

console.log('wallpaper gallery display contract: ok')
