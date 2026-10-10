import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePagedList } from '../src/usePagedList.ts'
import { useClientPagination } from '../src/useClientPagination.ts'

function fixture(t, fetcher, params, options) {
  const scope = effectScope()
  t.after(() => scope.stop())
  return scope.run(() => usePagedList(fetcher, params, options))
}
const result = (n, last = 5) => ({ items: [n], nextCursor: n < last ? String(n + 1) : null, total: last })
test('cursor jumps commit only the destination and cached pages need one request', async t => {
  const calls = []
  const list = fixture(t, async cursor => { const n = Number(cursor || 1); calls.push(n); return result(n) })
  await list.reset()
  await list.goToPage(5)
  assert.equal(list.page.value, 5)
  assert.deepEqual(list.items.value, [5])
  const before = calls.length
  await list.goToPage(2)
  assert.equal(calls.length, before + 1)
  assert.equal(list.page.value, 2)
})
test('failed intermediate page keeps old data/page and retry reaches original target', async t => {
  let fail = true
  const list = fixture(t, async cursor => {
    const n = Number(cursor || 1)
    if (n === 3 && fail) throw Error('network failed')
    return result(n)
  })
  await list.reset()
  await list.goToPage(5)
  assert.equal(list.page.value, 1)
  assert.deepEqual(list.items.value, [1])
  assert.equal(list.error.value, 'network failed')
  assert.equal(list.loading.value, false)
  fail = false
  await list.retry()
  assert.equal(list.page.value, 5)
})
test('loading keeps the displayed page and blocks duplicate navigation', async t => {
  let release
  let calls = 0
  const list = fixture(t, async cursor => {
    calls++
    if (cursor) await new Promise(resolve => { release = resolve })
    return result(Number(cursor || 1))
  })
  await list.reset()
  const pending = list.next()
  assert.equal(list.page.value, 1)
  assert.equal(list.loading.value, true)
  await list.next()
  assert.equal(calls, 2)
  release()
  await pending
  assert.equal(list.page.value, 2)
})
test('filter reset supersedes an older request and invalidates cached cursors', async t => {
  let filter = 'old', release
  const list = fixture(t, async cursor => {
    const own = filter
    if (cursor) await new Promise(resolve => { release = resolve })
    return { items: [own], nextCursor: cursor ? null : 'next' }
  }, () => filter)
  await list.reset()
  const oldRequest = list.next()
  filter = 'new'
  await list.reset()
  release()
  await oldRequest
  assert.deepEqual(list.items.value, ['new'])
  assert.equal(list.page.value, 1)
})
test('deleting the last row falls back to a nonempty previous page', async t => {
  let deleted = false
  const list = fixture(t, async cursor => Number(cursor) === 2 && deleted
    ? { items: [], nextCursor: null, total: 1 } : result(Number(cursor || 1), 2))
  await list.reset()
  await list.next()
  deleted = true
  await list.refresh()
  assert.equal(list.page.value, 1)
  assert.deepEqual(list.items.value, [1])
})
test('unknown totals stay unknown and cursor cycles stop with a useful error', async t => {
  const list = fixture(t, async cursor => ({ items: [1], nextCursor: cursor || 'repeat', scopeTotal: 999 }))
  await list.reset()
  assert.equal(list.total.value, null)
  await list.next()
  assert.match(list.error.value, /游标未前进/)
  assert.equal(list.page.value, 1)
})
test('client pagination changes size, clamps after deletion, and rejects invalid input', t => {
  const scope = effectScope(); t.after(() => scope.stop())
  const source = ref(Array.from({ length: 65 }, (_, i) => i))
  const list = scope.run(() => useClientPagination(() => source.value, 12))
  list.goToPage(4)
  assert.equal(list.items.value[0], 36)
  list.setPageSize(20)
  assert.equal(list.page.value, 1)
  assert.equal(list.items.value.length, 20)
  list.goToPage(4)
  source.value = source.value.slice(0, 21)
  assert.equal(list.page.value, 2)
  assert.deepEqual(list.items.value, [20])
  list.goToPage(NaN); list.setPageSize(0)
  assert.equal(list.page.value, 2)
  assert.equal(list.pageSize.value, 20)
})
test('very distant unvisited cursor pages do not trigger a request storm', async t => {
  let calls = 0
  const list = fixture(t, async cursor => { calls++; return result(Number(cursor || 1), 10000) })
  await list.reset()
  await list.goToPage(5000)
  assert.equal(calls, 1)
  assert.equal(list.page.value, 1)
  assert.match(list.error.value, /缩小范围/)
})

test('seek jumps to a far page in one request and caches its start cursor', async t => {
  const cursorCalls = []
  const seekCalls = []
  const list = fixture(t,
    async cursor => { const n = Number(cursor || 1); cursorCalls.push(n); return result(n, 400) },
    undefined,
    { seek: async page => { seekCalls.push(page); return { ...result(page, 400), cursor: String(page) } } },
  )
  await list.reset()
  await list.goToPage(300)
  assert.deepEqual(seekCalls, [300])
  assert.deepEqual(cursorCalls, [1])
  assert.equal(list.page.value, 300)
  assert.deepEqual(list.items.value, [300])
  await list.next()
  assert.deepEqual(cursorCalls, [1, 301])
  await list.goToPage(300)
  assert.deepEqual(seekCalls, [300], 'visited page reuses cached start cursor')
  assert.deepEqual(cursorCalls, [1, 301, 300])
  await list.goToPage(2)
  assert.deepEqual(seekCalls, [300], 'adjacent page follows the cursor')
})
test('seek past the end does not cache a null start as the first page', async t => {
  const list = fixture(t,
    async cursor => result(Number(cursor || 1), 3),
    undefined,
    { seek: async () => ({ items: [], nextCursor: null, cursor: null }) },
  )
  await list.reset()
  await list.goToPage(9)
  assert.equal(list.page.value, 9)
  assert.deepEqual(list.items.value, [])
  await list.goToPage(1)
  assert.deepEqual(list.items.value, [1])
})

test('seek resolving null falls back to following cursors', async t => {
  const cursorCalls = []
  const list = fixture(t,
    async cursor => { const n = Number(cursor || 1); cursorCalls.push(n); return result(n) },
    undefined,
    { seek: async () => null },
  )
  await list.reset()
  await list.goToPage(4)
  assert.equal(list.page.value, 4)
  assert.deepEqual(list.items.value, [4])
  assert.deepEqual(cursorCalls, [1, 2, 3, 4])
})
