import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeServerMessages } from '../src/features/assistant/domain/assistantConversationRefresh.js'

test('a turn that finished elsewhere replaces the stale pending copy', () => {
  const current = [
    { id: 'u1', role: 'user', content: '这个月花了多少' },
    { id: 'a1', role: 'assistant', content: '', pending: true, statusStage: 'thinking' },
  ]
  const server = [
    { id: 'u1', role: 'user', content: '这个月花了多少' },
    { id: 'a1', role: 'assistant', content: '本月共消耗 240 积分。', pending: false, status: 'complete' },
  ]
  const merged = mergeServerMessages(current, server)
  assert.equal(merged[1].content, '本月共消耗 240 积分。')
  assert.equal(merged[1].pending, false)
})

test('a lagging running snapshot never shortens streamed text', () => {
  const current = [{ id: 'a1', role: 'assistant', content: '本月共消耗 240 积分，主要', pending: true }]
  const server = [{ id: 'a1', role: 'assistant', content: '本月', pending: true }]
  assert.equal(mergeServerMessages(current, server)[0].content, '本月共消耗 240 积分，主要')
})

test('keeps just-sent local turns and earlier loaded history', () => {
  const current = [
    { id: 'old', role: 'user', content: '更早的问题' },
    { id: 'u1', role: 'user', content: '问题' },
    { id: 'a1', role: 'assistant', content: '回答' },
    { id: 'u2', role: 'user', content: '新问题', localOnly: true },
    { id: 'a2', role: 'assistant', content: '', pending: true, localOnly: true },
  ]
  const server = [
    { id: 'u1', role: 'user', content: '问题' },
    { id: 'a1', role: 'assistant', content: '回答' },
  ]
  assert.deepEqual(mergeServerMessages(current, server).map((message) => message.id), ['old', 'u1', 'a1', 'u2', 'a2'])
})

test('messages deleted elsewhere disappear', () => {
  const current = [
    { id: 'u1', role: 'user', content: '问题', createdAt: '2026-10-01T08:00:00Z' },
    { id: 'a1', role: 'assistant', content: '回答', createdAt: '2026-10-01T08:00:05Z' },
  ]
  const now = Date.parse('2026-10-02T08:00:00Z')
  assert.deepEqual(mergeServerMessages(current, [], { now }), [])
  // A deletion is visible whenever the server still has a newer message.
  const withLater = [...current, { id: 'u2', role: 'user', content: '后来的问题', createdAt: '2026-10-01T09:00:00Z' }]
  const server = [
    { id: 'u1', role: 'user', content: '问题', createdAt: '2026-10-01T08:00:00Z' },
    { id: 'u2', role: 'user', content: '后来的问题', createdAt: '2026-10-01T09:00:00Z' },
  ]
  assert.deepEqual(mergeServerMessages(withLater, server, { now }).map((message) => message.id), ['u1', 'u2'])
})

test('a snapshot taken before a send does not drop the acknowledged turn', () => {
  const now = Date.parse('2026-10-02T08:00:10Z')
  const current = [
    { id: 'u1', role: 'user', content: '旧问题', createdAt: '2026-10-02T07:00:00Z' },
    { id: 'u2', role: 'user', content: '刚发的问题', createdAt: '2026-10-02T08:00:00Z' },
    { id: 'a2', role: 'assistant', content: '已完成', createdAt: '2026-10-02T08:00:01Z' },
  ]
  const stale = [{ id: 'u1', role: 'user', content: '旧问题', createdAt: '2026-10-02T07:00:00Z' }]
  assert.deepEqual(mergeServerMessages(current, stale, { now }).map((message) => message.id), ['u1', 'u2', 'a2'])
  assert.deepEqual(mergeServerMessages(current.slice(1), [], { now }).map((message) => message.id), ['u2', 'a2'])
})
