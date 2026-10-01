import assert from 'node:assert/strict';
import test from 'node:test';
import { generationButtonState } from '../src/features/text-to-image/generationButtonState.js';

test('ready button distinguishes a known cost, free generation and unknown pricing', () => {
  const normal = generationButtonState({ generationCost: 8, count: 4 });
  assert.equal(normal.points, 8); assert.equal(normal.count, 4); assert.equal(normal.disabled, false);
  assert.equal(generationButtonState({ generationCost: 0 }).points, 0);
  assert.equal(generationButtonState({ generationCost: null }).points, null);
});

test('retry displays only missing images using their saved price, independent of the current model', () => {
  const pendingBatch = { entries: [
    { task: { id: 'done' }, payload: { expectedUnitPriceCents: 2 } },
    { payload: { expectedUnitPriceCents: 2 } },
    { payload: { expectedUnitPriceCents: 2 } },
  ] };
  const state = generationButtonState({ generationCost: 400, count: 4, pendingBatch, hasPrompt: false, modelReady: false });
  assert.equal(state.state, 'retry'); assert.equal(state.points, 4); assert.equal(state.count, 2); assert.equal(state.disabled, false);
});

test('changed or incomplete retry prices are not presented as a known cost', () => {
  for (const entry of [
    { payload: { expectedUnitPriceCents: null } },
    { payload: { expectedUnitPriceCents: 2 }, error: { code: 'price_changed' } },
    { payload: { expectedUnitPriceCents: 2, input: { autoBackgroundRemovalEnabled: true } } },
  ]) assert.equal(generationButtonState({ generationCost: 99, pendingBatch: { entries: [entry] } }).points, null);
});

test('submission and recovery take precedence over an earlier queue-full response', () => {
  const pendingBatch = { entries: [{ payload: { expectedUnitPriceCents: 2 }, error: { code: 'user_task_limit' } }] };
  assert.equal(generationButtonState({ pendingBatch }).state, 'full');
  for (const submissionPhase of ['uploading', 'submitting', 'recovering']) {
    const result = generationButtonState({ pendingBatch, submitting: true, submissionPhase });
    assert.equal(result.state, submissionPhase); assert.equal(result.disabled, true); assert.equal(result.busy, true);
  }
});

test('existing running or queued work still allows the next batch', () => {
  for (const taskCounts of [{ running: 4 }, { queued: 4 }]) {
    const result = generationButtonState({ taskCounts, generationCost: 8, count: 4 });
    assert.equal(result.disabled, false); assert.equal(result.label, '继续生成'); assert.equal(result.points, 8);
  }
});

test('quote, confirmation and incomplete-input states match their allowed actions', () => {
  assert.equal(generationButtonState({ quoting: true }).state, 'quoting');
  assert.equal(generationButtonState({ quoting: true }).disabled, true);
  const confirmation = generationButtonState({ generationCost: 8, confirmation: { total: 6, count: 3 } });
  assert.equal(confirmation.state, 'confirming'); assert.equal(confirmation.points, 6); assert.equal(confirmation.disabled, true);
  assert.equal(generationButtonState({ hasPrompt: false }).state, 'empty');
  assert.equal(generationButtonState({ invalidSize: true }).disabled, true);
  assert.equal(generationButtonState({ authenticated: false, hasPrompt: false, modelReady: false }).disabled, false);
});
