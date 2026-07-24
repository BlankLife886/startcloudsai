import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveServerJobsPagination } from '../src/features/ai-wallpaper/domain/historyPagination.js'

test('initial refresh adopts the first page cursor', () => {
  assert.deepEqual(resolveServerJobsPagination({ nextCursor: 'page-2', hasMore: true }), {
    cursor: 'page-2',
    hasMore: true,
    pageDepth: 1,
  })
})

test('append advances the cursor and page depth', () => {
  assert.deepEqual(
    resolveServerJobsPagination({
      append: true,
      pageDepth: 1,
      currentCursor: 'page-2',
      currentHasMore: true,
      nextCursor: 'page-3',
      hasMore: true,
    }),
    { cursor: 'page-3', hasMore: true, pageDepth: 2 },
  )
})

test('realtime first-page refresh preserves an appended page boundary', () => {
  assert.deepEqual(
    resolveServerJobsPagination({
      pageDepth: 3,
      currentCursor: 'page-4',
      currentHasMore: true,
      nextCursor: 'page-2-new',
      hasMore: true,
    }),
    { cursor: 'page-4', hasMore: true, pageDepth: 3 },
  )
})

test('realtime refresh preserves an exhausted history', () => {
  assert.deepEqual(
    resolveServerJobsPagination({
      pageDepth: 4,
      currentCursor: '',
      currentHasMore: false,
      nextCursor: 'page-2-new',
      hasMore: true,
    }),
    { cursor: '', hasMore: false, pageDepth: 4 },
  )
})
