import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import { useTaskAutoRefresh } from '../src/useTaskAutoRefresh.ts'

function setup(t, saved) {
  t.mock.timers.enable({ apis: ['setInterval'] })
  function stubGlobal(key, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    })
  }
  const storage = new Map(saved ? [['admin.tasks.autoRefresh', JSON.stringify(saved)]] : [])
  stubGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  })
  stubGlobal('document', { visibilityState: 'visible' })
  let refreshes = 0
  let ticks = 0
  let busy = false
  const scope = effectScope()
  const controls = scope.run(() => useTaskAutoRefresh(() => refreshes++, () => ticks++, () => !busy))
  t.after(() => scope.stop())
  return { ...controls, scope, storage, get refreshes() { return refreshes }, get ticks() { return ticks }, setBusy(value) { busy = value } }
}

test('turning auto off immediately stops polling and the elapsed clock', t => {
  const state = setup(t)
  t.mock.timers.tick(15000)
  assert.equal(state.refreshes, 1)
  assert.ok(state.ticks > 0)
  state.autoRefresh.value = false
  const stoppedTicks = state.ticks
  t.mock.timers.tick(60000)
  assert.equal(state.refreshes, 1)
  assert.equal(state.ticks, stoppedTicks)
})

test('changing the interval replaces the existing timer', t => {
  const state = setup(t)
  t.mock.timers.tick(5000)
  state.refreshIntervalSeconds.value = 30
  t.mock.timers.tick(29999)
  assert.equal(state.refreshes, 0)
  t.mock.timers.tick(1)
  assert.equal(state.refreshes, 1)
})

test('saved manual mode survives remount and editing the interval does not enable it', t => {
  const state = setup(t, { enabled: false, intervalSeconds: 60 })
  assert.equal(state.refreshIntervalSeconds.value, 60)
  state.refreshIntervalSeconds.value = 10
  t.mock.timers.tick(60000)
  assert.equal(state.refreshes, 0)
  assert.equal(state.ticks, 0)
  assert.deepEqual(JSON.parse(state.storage.get('admin.tasks.autoRefresh')), { enabled: false, intervalSeconds: 10 })
  state.autoRefresh.value = true
  t.mock.timers.tick(10000)
  assert.equal(state.refreshes, 1)
})

test('hidden pages and busy requests do not poll; disposal clears both timers', t => {
  const state = setup(t)
  document.visibilityState = 'hidden'
  t.mock.timers.tick(15000)
  assert.equal(state.refreshes, 0)
  assert.equal(state.ticks, 0)
  document.visibilityState = 'visible'
  state.setBusy(true)
  t.mock.timers.tick(15000)
  assert.equal(state.refreshes, 0)
  state.setBusy(false)
  t.mock.timers.tick(15000)
  assert.equal(state.refreshes, 1)
  state.scope.stop()
  const ticks = state.ticks
  t.mock.timers.tick(60000)
  assert.equal(state.refreshes, 1)
  assert.equal(state.ticks, ticks)
})

test('invalid intervals fall back to a safe default', t => {
  const state = setup(t, { intervalSeconds: 0 })
  assert.equal(state.refreshIntervalSeconds.value, 15)
  state.refreshIntervalSeconds.value = NaN
  assert.equal(state.refreshIntervalSeconds.value, 15)
  t.mock.timers.tick(15000)
  assert.equal(state.refreshes, 1)
})
