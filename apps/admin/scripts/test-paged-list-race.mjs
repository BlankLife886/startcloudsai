import test from 'node:test';
import assert from 'node:assert/strict';
import { usePagedList } from '../src/usePagedList.ts';

test('older results cannot replace a newer financial filter result', async () => {
  const pending = [];
  const list = usePagedList(() => new Promise(resolve => pending.push(resolve)));
  const first = list.reset();
  const second = list.reset();
  pending[1]({ items: [{ id: 'latest' }], total: 1 });
  await second;
  pending[0]({ items: [{ id: 'stale' }], total: 100 });
  await first;
  assert.equal(list.items.value[0].id, 'latest');
  assert.equal(list.total.value, 1);
});

test('completion of an old request cannot clear the active loading state', async () => {
  const pending = [];
  const list = usePagedList(() => new Promise(resolve => pending.push(resolve)));
  const first = list.reset(), second = list.reset();
  pending[0]({ items: [] }); await first;
  assert.equal(list.loading.value, true);
  pending[1]({ items: [] }); await second;
  assert.equal(list.loading.value, false);
});
