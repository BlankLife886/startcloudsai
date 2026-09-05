import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assistantStreamEventIsTerminal,
  mergeAssistantMessageSnapshot,
  mergeAssistantStreamText,
} from '../src/features/assistant/domain/assistantStreamMerge.js'

test('non-terminal cumulative stream text only moves forward', () => {
  const current = 'The answer has already reached this longer checkpoint.'

  assert.equal(
    mergeAssistantStreamText(current, 'The answer has'),
    current,
    'a delayed shorter SSE or polling checkpoint must not truncate the answer',
  )
  assert.equal(
    mergeAssistantStreamText(current, 'x'.repeat(current.length)),
    current,
    'an equal-length revision is not authoritative while the run is active',
  )
  assert.equal(
    mergeAssistantStreamText(current, `${current} More text.`),
    `${current} More text.`,
    'a longer cumulative update should advance the visible answer',
  )
  assert.equal(mergeAssistantStreamText(current, ''), current)
  assert.equal(mergeAssistantStreamText(current, undefined), current)
})

test('stale snapshots retain longer text while still merging status and metadata', () => {
  const current = {
    id: 'message-1',
    content: 'A complete-looking streamed paragraph that is ahead of the database checkpoint.',
    reasoning: 'A longer streamed reasoning trace.',
    statusStage: 'answering',
    context: { estimatedInputTokens: 12 },
    localOnly: true,
  }
  const snapshot = {
    id: 'message-1',
    content: 'An older checkpoint.',
    reasoning: 'Older reasoning.',
    statusStage: 'using-tools',
    context: { estimatedInputTokens: 48 },
    usage: { inputTokens: 48 },
  }

  const merged = mergeAssistantMessageSnapshot(current, snapshot)
  assert.equal(merged.content, current.content)
  assert.equal(merged.reasoning, current.reasoning)
  assert.equal(merged.statusStage, 'using-tools')
  assert.deepEqual(merged.context, { estimatedInputTokens: 48 })
  assert.deepEqual(merged.usage, { inputTokens: 48 })
  assert.equal(merged.localOnly, true)
})

test('terminal server updates may authoritatively revise text while retaining other fields', () => {
  const current = {
    id: 'message-2',
    content: 'A much longer unedited streaming draft that the user saw while generation was active.',
    reasoning: 'Long provisional reasoning that can be finalized.',
    pending: true,
    localOnly: true,
  }
  const finalSnapshot = {
    id: 'message-2',
    content: 'Final edited answer.',
    reasoning: 'Final reasoning.',
    pending: false,
    statusStage: 'complete',
    usage: { outputTokens: 3 },
  }

  const merged = mergeAssistantMessageSnapshot(current, finalSnapshot, { authoritative: true })
  assert.equal(merged.content, finalSnapshot.content)
  assert.equal(merged.reasoning, finalSnapshot.reasoning)
  assert.equal(merged.pending, false)
  assert.equal(merged.statusStage, 'complete')
  assert.deepEqual(merged.usage, { outputTokens: 3 })
  assert.equal(merged.localOnly, true)

  assert.equal(assistantStreamEventIsTerminal({ done: true, status: 'succeeded' }), true)
  assert.equal(assistantStreamEventIsTerminal({ done: true, status: 'failed' }), true)
  assert.equal(assistantStreamEventIsTerminal({ done: false, status: 'succeeded' }), false)
  assert.equal(assistantStreamEventIsTerminal({ done: true, status: 'running' }), false)
})

test('AssistantWorkspaceView uses the merge policy for polling and SSE paths', async () => {
  const view = await readFile(new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url), 'utf8')

  assert.match(
    view,
    /mergeAssistantMessageSnapshot\(message, persisted, \{ authoritative: terminal \}\)/,
  )
  assert.match(view, /assistantStreamEventIsTerminal\(event\)/)
  assert.match(
    view,
    /mergeAssistantStreamText\(message\.content, event\?\.content, \{ authoritative: terminalEvent \}\)/,
  )
  assert.match(
    view,
    /mergeAssistantStreamText\(message\.reasoning, event\?\.reasoning, \{ authoritative: terminalEvent \}\)/,
  )
  assert.match(view, /\.\.\.mergedSnapshot/)
  assert.match(view, /event\?\.context \? \{ context: event\.context \}/)
  assert.match(view, /event\?\.stage \? \{ statusStage: event\.stage \}/)
})
