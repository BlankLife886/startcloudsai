import assert from 'node:assert/strict'
import test from 'node:test'

import { createRunSync, pollDelay } from '../src/features/assistant-v2/domain/runSync.js'
import {
  activeRunFor,
  conversationHasWork,
  initialState,
  reducer,
} from '../src/features/assistant-v2/domain/v2State.js'

function startTurn(state, extra = {}) {
  return reducer(state, {
    type: 'turn/started',
    conversationId: 'c1',
    userMessageId: 'u1',
    assistantMessageId: 'a1',
    prompt: '这个月花了多少',
    ...extra,
  })
}

const running = { id: 'r1', conversationId: 'c1', assistantMessageId: 'a1', userMessageId: 'u1', status: 'running', stage: 'thinking' }

test('a rejected turn removes the optimistic pair so nothing is stuck pending', () => {
  let state = startTurn(initialState)
  assert.equal(state.threads.c1.messages.length, 2)
  state = reducer(state, { type: 'turn/rejected', conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1' })
  assert.equal(state.threads.c1.messages.length, 0)
  assert.equal(conversationHasWork(state, 'c1'), false)
})

test('streamed text only moves forward until the authoritative terminal snapshot', () => {
  let state = startTurn(initialState)
  state = reducer(state, { type: 'run/updated', run: running, assistantMessage: { id: 'a1', role: 'assistant', status: 'running', content: '' } })
  state = reducer(state, { type: 'run/streamed', conversationId: 'c1', assistantMessageId: 'a1', event: { content: '本月共消耗 240 积分' } })
  // A lagging poll snapshot must not truncate the streamed text.
  state = reducer(state, { type: 'run/updated', run: running, assistantMessage: { id: 'a1', role: 'assistant', status: 'running', content: '本月' } })
  assert.equal(state.threads.c1.messages[1].content, '本月共消耗 240 积分')
  assert.ok(activeRunFor(state, 'c1'))

  const done = { ...running, status: 'succeeded' }
  state = reducer(state, {
    type: 'run/updated',
    run: done,
    assistantMessage: { id: 'a1', role: 'assistant', status: 'complete', content: '本月共消耗 240 积分。', metadata: { dataViews: [{ view: 'stats' }] } },
  })
  const message = state.threads.c1.messages[1]
  assert.equal(message.content, '本月共消耗 240 积分。')
  assert.equal(message.pending, false)
  assert.equal(message.dataViews.length, 1)
  assert.equal(activeRunFor(state, 'c1'), null)
  assert.equal(conversationHasWork(state, 'c1'), false)
})

test('server reconciliation clears runs this tab never saw finish', () => {
  let state = reducer(initialState, { type: 'run/updated', run: running })
  assert.equal(conversationHasWork(state, 'c1'), true)
  state = reducer(state, { type: 'runs/reconciled', runs: [] })
  assert.equal(conversationHasWork(state, 'c1'), false)
})

test('tool events build a timeline on the pending message', () => {
  let state = startTurn(initialState)
  state = reducer(state, { type: 'run/updated', run: running, assistantMessage: { id: 'a1', role: 'assistant', status: 'running' } })
  state = reducer(state, {
    type: 'run/streamed', conversationId: 'c1', assistantMessageId: 'a1',
    event: { tool: { requestId: 't1', name: 'my_stats_query', status: 'running', execution: 'server' } },
  })
  state = reducer(state, {
    type: 'run/streamed', conversationId: 'c1', assistantMessageId: 'a1',
    event: { tool: { requestId: 't1', name: 'my_stats_query', status: 'completed', execution: 'server' } },
  })
  const steps = state.threads.c1.messages[1].toolSteps
  assert.equal(steps.length, 1)
  assert.equal(steps[0].status, 'completed')
})

test('poll delay slows down for long runs and backs off on failures but never stops', () => {
  assert.equal(pollDelay(0), 1500)
  assert.equal(pollDelay(10 * 60 * 1000), 8000)
  assert.ok(pollDelay(0, 2) > 1500)
  assert.ok(pollDelay(0, 50) <= 20000)
})

function fakeTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id },
    clearTimeout(id) { pending.delete(id) },
    async runAll() {
      const jobs = [...pending.values()]
      pending.clear()
      for (const job of jobs) await job.fn()
    },
    get size() { return pending.size },
  }
}

test('run sync polls to completion, keeps retrying through network errors, and closes the stream', async () => {
  const timers = fakeTimers()
  const actions = []
  const responses = [
    () => { throw Object.assign(new Error('offline'), { status: 0 }) },
    () => ({ run: { ...running, stage: 'answering' } }),
    () => ({ run: { ...running, status: 'succeeded' }, assistantMessage: { id: 'a1', role: 'assistant', status: 'complete', content: 'done' } }),
  ]
  let closed = 0
  const sync = createRunSync({
    api: {
      getRun: async () => responses.shift()(),
      openStream: () => ({ close: () => { closed += 1 } }),
    },
    dispatch: (action) => actions.push(action),
    timers,
  })
  sync.track(running)
  assert.equal(sync.isTracking('r1'), true)
  sync.track(running) // duplicate tracking is ignored
  assert.equal(sync.size(), 1)
  await timers.runAll() // network error: retried, not dropped
  assert.equal(sync.isTracking('r1'), true)
  await timers.runAll()
  await timers.runAll()
  assert.equal(sync.isTracking('r1'), false)
  assert.equal(closed, 1)
  assert.equal(timers.size, 0)
  assert.equal(actions.at(-1).run.status, 'succeeded')
})

test('run sync stops on 4xx and reports the run as lost', async () => {
  const timers = fakeTimers()
  const actions = []
  const sync = createRunSync({
    api: { getRun: async () => { throw Object.assign(new Error('gone'), { status: 404 }) } },
    dispatch: (action) => actions.push(action),
    timers,
  })
  sync.track({ ...running, status: 'queued' })
  await timers.runAll()
  assert.equal(sync.isTracking('r1'), false)
  assert.equal(actions[0].type, 'runs/lost')
})

test('a stale empty thread snapshot does not wipe a turn this tab just sent', () => {
  let state = startTurn(initialState)
  state = reducer(state, { type: 'run/updated', run: { ...running, status: 'succeeded' }, assistantMessage: { id: 'a1', role: 'assistant', status: 'complete', content: '完成' } })
  state = reducer(state, { type: 'thread/loaded', conversationId: 'c1', messages: [], hasMore: false })
  assert.deepEqual(state.threads.c1.messages.map((message) => message.id), ['u1', 'a1'])
  // Once the server returns them, the server copy wins.
  state = reducer(state, { type: 'thread/loaded', conversationId: 'c1', messages: [
    { id: 'u1', role: 'user', content: '这个月花了多少' },
    { id: 'a1', role: 'assistant', content: '完成。', status: 'complete' },
  ] })
  assert.equal(state.threads.c1.messages.length, 2)
  assert.equal(state.threads.c1.messages[1].content, '完成。')
})
