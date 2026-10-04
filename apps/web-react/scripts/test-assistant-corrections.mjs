import assert from 'node:assert/strict'
import test from 'node:test'

import { ASSISTANT_CORRECTIONS, assistantCorrectionActions } from '../src/features/assistant/domain/assistantCorrections.js'

const last = { isLastAssistant: true, generating: false, proposalExecuted: false, autoApproved: false }
const reply = (fields) => ({ role: 'assistant', status: 'complete', pending: false, ...fields })

test('a proposal offers "only asking", a text answer offers drawing and searching', () => {
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'proposal', proposal: {} }), last), ['just_asking'])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'chat' }), last), ['draw_it', 'search_web'])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'agent', webSearches: [{ query: '金价' }] }), last), ['draw_it'])
})

test('nothing is offered where a correction would be wrong or confusing', () => {
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'chat' }), { ...last, isLastAssistant: false }), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'chat' }), { ...last, generating: true }), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'chat', pending: true }), last), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'chat', status: 'failed' }), last), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'image' }), last), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'proposal', proposal: {} }), { ...last, proposalExecuted: true }), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'proposal', proposal: {} }), { ...last, autoApproved: true }), [])
  assert.deepEqual(assistantCorrectionActions(reply({ kind: 'proposal', proposal: { dismissed: true } }), last), [])
  assert.deepEqual(assistantCorrectionActions({ role: 'user', kind: 'chat', status: 'complete' }, last), [])
})

test('only asking always runs in 问答 and drawing in Agent, matching the server', () => {
  assert.equal(ASSISTANT_CORRECTIONS.just_asking.mode, 'chat')
  assert.equal(ASSISTANT_CORRECTIONS.draw_it.mode, 'agent')
  assert.equal(ASSISTANT_CORRECTIONS.search_web.mode, '')
})
