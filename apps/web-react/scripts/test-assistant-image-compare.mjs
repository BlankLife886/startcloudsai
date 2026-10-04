import assert from 'node:assert/strict'
import test from 'node:test'

import { imageEditSources } from '../src/features/assistant/domain/assistantImageCompare.js'

const original = { id: 'ref-1', fileKey: 'uploads/ref-1.png', dataUrl: '/files/ref-1.png' }
const second = { id: 'ref-2', fileKey: 'uploads/ref-2.png', dataUrl: '/files/ref-2.png' }
const result = (n) => Array.from({ length: n }, (_, index) => ({ id: `out-${index}`, dataUrl: `/files/out-${index}.png` }))
const reply = (fields) => ({ id: 'reply', role: 'assistant', kind: 'image', status: 'complete', images: result(1), ...fields })

test('a direct image edit with one reference compares against it', () => {
  const messages = [{ id: 'u', role: 'user', referenceImages: [original] }, reply()]
  assert.deepEqual(imageEditSources(messages[1], messages), [original])
})

test('several references without a plan cannot be compared', () => {
  const messages = [{ id: 'u', role: 'user', referenceImages: [original, second] }, reply()]
  assert.deepEqual(imageEditSources(messages[1], messages), [])
})

test('only edit proposals offer a comparison', () => {
  const proposal = (action) => ({ id: 'p', role: 'assistant', kind: 'proposal', proposal: { action } })
  const run = (action) => [proposal(action), { id: 'u', role: 'user', proposalSourceMessageId: 'p', referenceImages: [original] }, reply()]
  assert.deepEqual(imageEditSources(run('edit')[2], run('edit')), [original])
  assert.deepEqual(imageEditSources(run('generate')[2], run('generate')), [], 'a reference used as style input is not an original')
})

test('per-image plans pair each result with its own reference', () => {
  const messages = [
    { id: 'p', role: 'assistant', kind: 'proposal', proposal: { action: 'edit' } },
    { id: 'u', role: 'user', proposalSourceMessageId: 'p', referenceImages: [original, second] },
    reply({ images: result(3), imagePlanItems: [{ referenceImageIds: ['ref-2'] }, { referencedImageIds: ['ref-1'] }, { referenceImageIds: ['ref-1', 'ref-2'] }] }),
  ]
  assert.deepEqual(imageEditSources(messages[2], messages), [second, original, null])
})

test('no user message, no references or a context reset means no comparison', () => {
  assert.deepEqual(imageEditSources(reply(), [reply()]), [])
  const reset = [{ id: 'u', role: 'user', referenceImages: [original] }, { id: 'd', kind: 'context-divider' }, reply()]
  assert.deepEqual(imageEditSources(reset[2], reset), [])
  assert.deepEqual(imageEditSources({ ...reply(), images: [] }, []), [])
})

test('deleted results are skipped', () => {
  const messages = [{ id: 'u', role: 'user', referenceImages: [original] }, reply({ images: [{ id: 'gone', deleted: true }] })]
  assert.deepEqual(imageEditSources(messages[1], messages), [null])
})
