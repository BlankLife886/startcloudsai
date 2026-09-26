import assert from 'node:assert/strict';
import test from 'node:test';
import { createParticleRenderScheduler, particleRenderQuality } from '../src/features/text-to-image/particleRenderScheduler.js';

function harness() {
  const callbacks = new Set();
  let clock = 0;
  const scheduler = createParticleRenderScheduler({ add: fn => callbacks.add(fn), remove: fn => callbacks.delete(fn) }, () => clock);
  const rows = [];
  return {
    scheduler, callbacks, rows,
    add(cost = 0) {
      const row = { frames: 0, elapsed: [] };
      const handle = scheduler.register({ configure: quality => { row.quality = quality; }, draw: delta => { row.frames++; row.elapsed.push(delta); clock += cost; } });
      rows.push(row); return handle;
    },
    tick(time) { for (const callback of callbacks) callback(time); },
  };
}

test('1, 4, 12 and 64 visible cards share fixed point and backing-pixel budgets', () => {
  for (const count of [1, 4, 12, 64]) {
    const quality = particleRenderQuality(count);
    assert.ok(quality.particles * count <= 8000);
    assert.ok(quality.pixels * count <= 2_000_000);
    assert.ok(quality.dpr <= 1.5);
  }
  assert.equal(particleRenderQuality(12).fps, 20);
});

test('twelve surfaces use one callback, stop completely when hidden, and resume without time jumps', () => {
  const h = harness();
  const handles = Array.from({ length: 12 }, () => h.add());
  handles.forEach(handle => handle.setActive(true));
  assert.equal(h.callbacks.size, 1);
  h.tick(0); h.tick(1 / 60); h.tick(0.05);
  assert.ok(h.rows.every(row => row.frames === 2));
  handles.forEach(handle => handle.setActive(false));
  assert.equal(h.callbacks.size, 0);
  h.tick(40);
  assert.ok(h.rows.every(row => row.frames === 2));
  handles[0].setActive(true);
  h.tick(80);
  assert.equal(h.rows[0].quality.particles, 2400);
  assert.ok(h.rows[0].elapsed.at(-1) <= 1 / 30);
  handles.forEach(handle => handle.destroy());
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.scheduler.snapshot().registered, 0);
  handles[0].setActive(true);
  assert.equal(h.callbacks.size, 0);
});

test('removing a surface returns its budget to remaining visible cards', () => {
  const h = harness();
  const handles = Array.from({ length: 8 }, () => h.add());
  handles.forEach(handle => handle.setActive(true));
  assert.ok(h.rows.every(row => row.quality.particles === 1000));
  handles.slice(4).forEach(handle => handle.destroy());
  assert.ok(h.rows.slice(0, 4).every(row => row.quality.particles === 2000));
  handles.forEach(handle => handle.destroy());
});

test('sustained expensive drawing reduces quality while quick frame spikes do not', () => {
  const h = harness();
  const handle = h.add(9);
  handle.setActive(true);
  for (let index = 0; index < 5; index++) h.tick(index * 0.05);
  assert.equal(h.scheduler.snapshot().pressure, 0);
  for (let index = 5; index < 14; index++) h.tick(index * 0.05);
  assert.equal(h.scheduler.snapshot().pressure, 1);
  assert.equal(h.rows[0].quality.fps, 20);
  assert.ok(h.rows[0].quality.particles < 2400);
  handle.destroy();
});
