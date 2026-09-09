import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantImageBatchLimit, constrainAssistantImageModels } from '../src/features/assistant/domain/assistantImageLimits.js'

test('new image batches obey model, route, global and account limits together', () => {
  assert.equal(assistantImageBatchLimit({ maxImages: 8, imageBatchLimit: 3 }, { imageBatchLimit: 6, concurrency: { imageLimit: 4 } }), 3)
  assert.equal(assistantImageBatchLimit({ maxImages: 8, imageBatchLimit: 6 }, { imageBatchLimit: 6, concurrency: { imageLimit: 2 } }), 2)
  assert.equal(assistantImageBatchLimit({ maxImages: 2 }, { imageBatchLimit: 6, concurrency: { imageLimit: 4 } }), 2)
})

test('legacy configuration remains usable without inventing a larger limit', () => {
  assert.equal(assistantImageBatchLimit({ maxImages: 8 }, { concurrency: { limit: 3 } }), 3)
  assert.equal(assistantImageBatchLimit({ maxImages: 8 }), 8)
  assert.equal(assistantImageBatchLimit(undefined), 4)
})

test('unavailable image capacity removes the model only from new request options', () => {
  const model = Object.freeze({ model: 'a', maxImages: 8, imageBatchLimit: 0 })
  assert.deepEqual(constrainAssistantImageModels([model]), [])
  assert.equal(model.maxImages, 8)
})

test('switching models or account capacity never mutates historical model metadata', () => {
  const models = [Object.freeze({ model: 'a', maxImages: 8 }), Object.freeze({ model: 'b', maxImages: 2 })]
  const first = constrainAssistantImageModels(models, { concurrency: { imageLimit: 4 } })
  const second = constrainAssistantImageModels(models, { concurrency: { imageLimit: 1 } })
  assert.deepEqual(first.map(model => model.maxImages), [4, 2])
  assert.deepEqual(second.map(model => model.maxImages), [1, 1])
  assert.deepEqual(models.map(model => model.maxImages), [8, 2])
})
