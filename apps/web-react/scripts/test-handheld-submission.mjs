import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareHandheldSubmission } from '../src/features/ecommerce/handheld/handheldSubmission.js'

test('handheld retries reuse the same request and uploaded input keys after response loss', () => {
  const file = { name: 'product.png' }
  const input = { scope: 'user-a', roleFiles: [{ role: 'product_front', file }], modelId: 'image', spec: { shots: ['hero'] } }
  const first = prepareHandheldSubmission(null, input, () => 'stable-key')
  first.payload = { idempotencyKey: first.idempotencyKey, spec: { inputs: [{ key: 'uploads/user-a/product' }] } }
  const retry = prepareHandheldSubmission(first, { ...input, roleFiles: [...input.roleFiles] }, () => { throw new Error('generated a second key') })
  assert.equal(retry, first)
  assert.equal(retry.payload.spec.inputs[0].key, 'uploads/user-a/product')
})

test('changed account, input image, parameters or acknowledged submission gets a new request', () => {
  const file = { name: 'product.png' }
  const input = { scope: 'user-a', roleFiles: [{ role: 'product_front', file }], modelId: 'image', spec: { shots: ['hero'] } }
  const first = prepareHandheldSubmission(null, input, () => 'first')
  for (const changed of [
    { ...input, scope: 'user-b' },
    { ...input, modelId: 'other' },
    { ...input, spec: { shots: ['detail'] } },
    { ...input, roleFiles: [{ role: 'product_front', file: { name: 'product.png' } }] },
  ]) {
    const next = prepareHandheldSubmission(first, changed, () => 'next')
    assert.equal(next.idempotencyKey, 'next')
    assert.equal(next.payload, null)
  }
  assert.equal(prepareHandheldSubmission(null, input, () => 'after-success').idempotencyKey, 'after-success')
})
