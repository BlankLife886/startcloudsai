import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsageModel, niceTicks } from '../src/features/profile-usage/usageStats.js';

const today = new Date(2026, 8, 24);
const stats = {
  days: [
    { date: '2026-09-24', creations: 2, images: 5, points: 40, durationSeconds: 300 },
    { date: '2026-08-01', creations: 1, images: 1, points: 10, durationSeconds: 60 },
    { date: '2024-12-31', creations: 3, images: 6, points: 30, durationSeconds: 90 },
  ],
  weekdayHour: Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => (day === 3 && hour === 21 ? 4 : day === 0 && hour === 9 ? 1 : 0))),
};

test('fills the last 30 days and keeps today last', () => {
  const model = buildUsageModel(stats, today);
  assert.equal(model.daily.length, 30);
  assert.equal(model.daily.at(-1).key, '2026-09-24');
  assert.equal(model.daily.at(-1).images, 5);
  assert.equal(model.daily[0].key, '2026-08-26');
  assert.equal(model.recentDuration, 300);
});

test('rolls days up into months and every year since the first record', () => {
  const model = buildUsageModel(stats, today);
  assert.equal(model.monthly.length, 12);
  assert.equal(model.monthly.at(-1).key, '2026-09');
  assert.equal(model.monthly.find((m) => m.key === '2026-08').points, 10);
  assert.deepEqual(model.yearly.map((y) => [y.key, y.creations]), [['2024', 3], ['2025', 0], ['2026', 3]]);
  assert.deepEqual(model.totals, { creations: 6, images: 12, points: 80, durationSeconds: 450 });
});

test('orders the heatmap Monday first and finds the peak hour', () => {
  const model = buildUsageModel(stats, today);
  assert.equal(model.heatmap[0].label, '周一');
  assert.equal(model.heatmap.at(-1).label, '周日');
  assert.equal(model.heatmap.at(-1).hours[9], 1);
  assert.equal(model.peakHour, 21);
  assert.equal(model.heatMax, 4);
});

test('empty stats render as no activity', () => {
  const model = buildUsageModel(null, today);
  assert.equal(model.hasActivity, false);
  assert.equal(model.peakHour, -1);
  assert.equal(model.yearly.length, 1);
});

test('integer axis ticks', () => {
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(1234), [0, 500, 1000, 1500]);
});
