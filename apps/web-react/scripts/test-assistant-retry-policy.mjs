import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  markAssistantMessageLocal,
  mergePersistedAssistantMessage,
  resolveAssistantRetryIdentity,
} from '../src/features/assistant/domain/assistantRetryPolicy.js'

test('local messages are explicitly marked until a server message is received', () => {
  const original = { id: 'local-user', role: 'user', content: 'question' }
  const local = markAssistantMessageLocal(original)

  assert.notEqual(local, original)
  assert.equal(original.localOnly, undefined)
  assert.equal(local.localOnly, true)

  const persisted = mergePersistedAssistantMessage(local, {
    id: 'server-user',
    role: 'user',
    content: 'question',
    updatedAt: '2026-09-03T00:00:00.000Z',
  })
  assert.equal(persisted.id, 'server-user')
  assert.equal(persisted.localOnly, false)
  assert.equal(persisted.updatedAt, '2026-09-03T00:00:00.000Z')
})

test('an unpersisted turn retries as an idempotent create without a source id', () => {
  assert.deepEqual(
    resolveAssistantRetryIdentity(
      { id: 'local-user', localOnly: true },
      { id: 'local-assistant', localOnly: true },
    ),
    {
      sourceUserMessageId: '',
      retryAssistantMessageId: 'local-assistant',
    },
  )
})

test('a persisted turn keeps destructive regeneration semantics', () => {
  assert.deepEqual(
    resolveAssistantRetryIdentity(
      { id: 'persisted-user', localOnly: false },
      { id: 'persisted-assistant', localOnly: false },
    ),
    {
      sourceUserMessageId: 'persisted-user',
      retryAssistantMessageId: '',
    },
  )

  assert.deepEqual(
    resolveAssistantRetryIdentity(
      { id: 'persisted-user' },
      { id: 'retry-placeholder', localOnly: true },
    ),
    {
      sourceUserMessageId: 'persisted-user',
      retryAssistantMessageId: 'retry-placeholder',
    },
    'a repeated network retry should reuse its idempotency key without losing the persisted source',
  )
})

test('AssistantWorkspaceView applies local identity at creation and clears it on persistence', async () => {
  const view = (await Promise.all([
    readFile(new URL('../src/features/assistant/assistantWorkspaceCore.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url), 'utf8'),
  ])).join('\n')

  assert.match(view, /function createLocalAssistantPlaceholder\(options\)/)
  assert.ok(
    (view.match(/localOnly: true/g) || []).length >= 3,
    'each locally-created user-message path must be marked',
  )
  assert.match(view, /const retryIdentity = resolveAssistantRetryIdentity\(userMessage, target\)/)
  assert.match(view, /assistantMessage\.id = retryIdentity\.retryAssistantMessageId/)
  assert.match(view, /sourceUserMessageId: retryIdentity\.sourceUserMessageId/)
  assert.doesNotMatch(view, /sourceUserMessageId: userMessage\.id/)
  assert.match(view, /\.\.\.\(sourceUserMessageId \? \{ sourceUserMessageId \} : \{\}\)/)
  assert.match(view, /mergePersistedAssistantMessage\(message, persistedUser\)/)
  assert.match(view, /applyRunResult\(conversationId, assistantMessage\.id, created, userMessage\.id\)/)
  assert.match(view, /persisted \? \{ localOnly: false \} : \{\}/)
})
