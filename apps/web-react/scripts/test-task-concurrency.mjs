import assert from 'node:assert/strict'
import test from 'node:test'

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type)
    this.detail = options.detail
  }
}

globalThis.window = new EventTarget()
globalThis.document = { hidden: false }
globalThis.CustomEvent = TestCustomEvent
globalThis.EventSource = undefined

const { createTask, waitForTask } = await import('../src/legacy-modules/services/tasksApi.js')

test('100 task waiters use one batch snapshot request', async () => {
  let batchCalls = 0
  let individualCalls = 0
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url), 'http://localhost')
    if (parsed.pathname === '/api/v1/tasks' && parsed.searchParams.has('ids')) {
      batchCalls += 1
      const ids = String(parsed.searchParams.get('ids') || '')
        .split(',')
        .filter(Boolean)
      assert.equal(ids.length, 100)
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            items: ids.map((id) => ({
              id,
              status: 'succeeded',
              outputKeys: [`tasks/${id}/0.png`],
              thumbnailKeys: [`tasks/${id}/thumb-0.webp`],
            })),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (parsed.pathname.startsWith('/api/v1/tasks/')) individualCalls += 1
    throw new Error(`unexpected request: ${parsed.pathname}`)
  }

  const ids = Array.from(
    { length: 100 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )
  const results = await Promise.all(ids.map((id) => waitForTask(id, { maxWaitMs: 5000 })))
  assert.equal(results.length, 100)
  assert.equal(batchCalls, 1)
  assert.equal(individualCalls, 0)
})

test('task submissions never exceed the global browser concurrency window', async () => {
  let active = 0
  let maxActive = 0
  let requests = 0
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), 'http://localhost')
    assert.equal(parsed.pathname, '/api/v1/tasks')
    assert.equal(options.method, 'POST')
    active += 1
    requests += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return new Response(
      JSON.stringify({
        success: true,
        data: { task: { id: `task-${requests}`, status: 'queued' } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      createTask({ type: 't2i', prompt: `task ${index}`, idempotencyKey: `idem-${index}` }),
    ),
  )
  assert.equal(requests, 30)
  assert.equal(maxActive, 6)
})

test('account task event resolves a waiter without an HTTP poll', async () => {
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    throw new Error('poll should not run after the realtime completion event')
  }
  const id = '10000000-0000-4000-8000-000000000001'
  const waiting = waitForTask(id, { maxWaitMs: 5000 })
  window.dispatchEvent(
    new CustomEvent('starclouds:task-update', {
      detail: {
        task: { id, status: 'succeeded', outputKeys: ['tasks/result.png'] },
        payload: { source: 'account-sse' },
      },
    }),
  )
  const task = await waiting
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(task.status, 'succeeded')
  assert.equal(requests, 0)
})

test('successful snapshot waits for output fields to become visible', async () => {
  let batchCalls = 0
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url), 'http://localhost')
    assert.equal(parsed.pathname, '/api/v1/tasks')
    batchCalls += 1
    const withOutput = batchCalls >= 2
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: '20000000-0000-4000-8000-000000000001',
              type: 'model_sheet',
              status: 'succeeded',
              outputKeys: withOutput ? ['tasks/model-sheet/result.png'] : [],
              originalUrls: withOutput ? ['/api/v1/files/tasks/model-sheet/result.png'] : [],
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  const task = await waitForTask('20000000-0000-4000-8000-000000000001', {
    intervalMs: 10,
    maxWaitMs: 3000,
  })
  assert.equal(batchCalls, 2)
  assert.equal(task.originalUrls.length, 1)
})

test('lost create response retries with the same idempotency key', async () => {
  const bodies = []
  globalThis.fetch = async (_url, options = {}) => {
    bodies.push(JSON.parse(String(options.body || '{}')))
    if (bodies.length === 1) throw new TypeError('connection reset after server commit')
    return new Response(
      JSON.stringify({
        success: true,
        data: { task: { id: 'recovered-task', status: 'queued' } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  const task = await createTask({
    type: 't2i',
    prompt: 'recover response',
    idempotencyKey: 'stable-idempotency-key',
  })
  assert.equal(task.id, 'recovered-task')
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].idempotencyKey, 'stable-idempotency-key')
  assert.deepEqual(bodies[1], bodies[0])
})
