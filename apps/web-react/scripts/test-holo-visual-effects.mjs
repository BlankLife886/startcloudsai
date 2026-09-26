import test from 'node:test';
import assert from 'node:assert/strict';
import { blendBodyFinish, createVisualTransition, FINISH_NAMES, PATTERN_NAMES, SHINE_STYLE_NAMES, visualWeights } from '../src/features/holo-card/visual-effects.js';

// A deterministic clock lets rapid retargets and late callbacks be checked without
// sleeping or depending on the browser's refresh rate.
function clock() {
  const scheduled = [];
  return {
    scheduled,
    animate(target, options) {
      const properties = Object.keys(options).filter((key) => typeof options[key] === 'number' && key !== 'duration');
      const from = Object.fromEntries(properties.map((key) => [key, target[key]]));
      const tween = {
        killed: false, options,
        kill() { this.killed = true; },
        progress(amount) {
          if (this.killed) return;
          for (const key of properties) target[key] = from[key] + (options[key] - from[key]) * amount;
          options.onUpdate?.();
          if (amount === 1) options.onComplete?.();
        },
      };
      scheduled.push(tween);
      return tween;
    },
  };
}

function signal(initial = {}) {
  const listeners = new Map();
  return {
    ...initial, listeners,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); },
  };
}

const total = (weights) => Object.values(weights).reduce((sum, weight) => sum + weight, 0);
const finishMix = (values) => ({ ...Object.fromEntries(FINISH_NAMES.map((name) => [name, 0])), ...values });
const patternMix = (values) => ({ ...Object.fromEntries(PATTERN_NAMES.map((name) => [name, 0])), ...values });

test('all finish choices have one normalized basis, including an effect-free original', () => {
  assert.equal(FINISH_NAMES.length, 9);
  assert.equal(PATTERN_NAMES.length, 9);
  assert.deepEqual(FINISH_NAMES.slice(0, 5), ['spectrum', 'silver', 'gold', 'pearl', 'original']);
  assert.deepEqual(PATTERN_NAMES.slice(0, 3), ['flow', 'stardust', 'aurora']);
  assert.deepEqual(SHINE_STYLE_NAMES, ['sweep', 'halo', 'comet', 'cross']);
  for (const finish of FINISH_NAMES) {
    const weights = visualWeights(FINISH_NAMES, finish);
    assert.equal(weights.reduce((sum, weight) => sum + weight, 0), 1);
    assert.equal(weights[FINISH_NAMES.indexOf(finish)], 1);
  }
  assert.deepEqual(visualWeights(PATTERN_NAMES, 'unknown'), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('rapid material retargets start from the current mix and ignore stale completion', () => {
  const timer = clock();
  const transition = createVisualTransition({ initial: { foil: 'spectrum' }, animate: timer.animate });
  transition.setTargets({ foil: 'gold' });
  const first = timer.scheduled.at(-1);
  first.progress(.35);
  const current = transition.snapshot().finishWeights;
  assert.deepEqual(current, finishMix({ spectrum: .65, gold: .35 }));
  transition.setTargets({ foil: 'silver' });
  assert.equal(first.killed, true);
  assert.deepEqual(transition.snapshot().finishWeights, current);
  first.options.onComplete();
  assert.deepEqual(transition.snapshot().finishWeights, current);
  const second = timer.scheduled.at(-1);
  second.progress(.5);
  assert.ok(Math.abs(total(transition.snapshot().finishWeights) - 1) < 1e-9);
  assert.ok(transition.snapshot().finishWeights.silver > 0);
  second.progress(1);
  assert.deepEqual(transition.snapshot().finishWeights, finishMix({ silver: 1 }));
  transition.dispose();
});

test('pattern transitions and relief retarget independently; unrelated changes retain selection', () => {
  const timer = clock();
  const transition = createVisualTransition({ initial: { depth: 0 }, animate: timer.animate });
  transition.setTargets({ pattern: 'stardust', exploded: true });
  const pattern = timer.scheduled[0], relief = timer.scheduled[1];
  pattern.progress(.4); relief.progress(.6);
  assert.equal(transition.values.spread, .6);
  assert.equal(transition.values.depth, 0);
  transition.setTargets({ pattern: 'aurora', exploded: false });
  assert.equal(pattern.killed, true);
  assert.equal(relief.killed, true);
  timer.scheduled.at(-2).progress(1); timer.scheduled.at(-1).progress(1);
  transition.setTargets({ foilStrength: .8 });
  timer.scheduled.at(-1).progress(1);
  assert.deepEqual(transition.snapshot().patternWeights, patternMix({ aurora: 1 }));
  assert.equal(transition.values.spread, 0);
  assert.equal(transition.values.strength, .8);
  transition.dispose();
});

test('pause settles the requested blend and cancels shine instead of accumulating animation', () => {
  const timer = clock();
  const transition = createVisualTransition({ animate: timer.animate });
  transition.setTargets({ foil: 'original', pattern: 'aurora', depth: 1.5, exploded: true });
  for (const tween of timer.scheduled) tween.progress(.2);
  assert.equal(transition.shine(), true);
  transition.setActive(false);
  assert.ok(timer.scheduled.every((tween) => tween.killed));
  assert.equal(transition.snapshot().finishWeights.original, 1);
  assert.equal(transition.snapshot().patternWeights.aurora, 1);
  assert.equal(transition.values.depth, 1.5);
  assert.equal(transition.values.spread, 1);
  assert.equal(transition.values.shine, -1);
  assert.equal(transition.snapshot().shining, false);
  const count = timer.scheduled.length;
  transition.setTargets({ foil: 'gold' });
  assert.equal(transition.snapshot().finishWeights.gold, 1);
  assert.equal(transition.shine(), false);
  transition.setActive(true);
  assert.equal(timer.scheduled.length, count);
  transition.dispose();
});

test('hidden documents and reduced motion have no running transitions, listeners clean up', () => {
  const timer = clock(), query = signal({ matches: true }), doc = signal({ hidden: false });
  let updates = 0;
  const transition = createVisualTransition({ animate: timer.animate, motionQuery: query, visibilityDocument: doc, onUpdate: () => updates++ });
  transition.setTargets({ foil: 'gold', pattern: 'stardust' });
  assert.equal(timer.scheduled.length, 0);
  assert.equal(transition.snapshot().finishWeights.gold, 1);
  query.matches = false; query.emit('change');
  transition.setTargets({ foil: 'silver' });
  timer.scheduled.at(-1).progress(.3);
  doc.hidden = true; doc.emit('visibilitychange');
  assert.equal(timer.scheduled.at(-1).killed, true);
  assert.equal(transition.snapshot().finishWeights.silver, 1);
  const hiddenUpdates = updates;
  doc.hidden = false; doc.emit('visibilitychange');
  assert.ok(updates > hiddenUpdates, 'restoring visibility requests the settled frame');
  transition.dispose();
  assert.equal(query.listeners.size + doc.listeners.size, 0);
  const disposedUpdates = updates;
  transition.setTargets({ foil: 'gold' });
  assert.equal(transition.shine(), false);
  assert.equal(updates, disposedUpdates);
});

test('shine retriggers safely and stops after one finite sweep; diagnostic weights cannot be mutated', () => {
  const timer = clock();
  const transition = createVisualTransition({ animate: timer.animate });
  transition.shine();
  const first = timer.scheduled.at(-1);
  first.progress(.7);
  transition.shine();
  assert.equal(first.killed, true);
  assert.equal(transition.values.shine, 0);
  first.options.onComplete();
  assert.equal(transition.snapshot().shining, true);
  timer.scheduled.at(-1).progress(1);
  assert.equal(transition.snapshot().shining, false);
  assert.equal(transition.values.shine, -1);
  assert.throws(() => { transition.snapshot().finishWeights.pearl = 0; }, TypeError);
  transition.dispose();
});

test('all nine channels remain normalized through repeated interrupted changes and return to original', () => {
  const timer = clock();
  const transition = createVisualTransition({ initial: { foil: 'original' }, animate: timer.animate });
  for (let index = 0; index < 27; index++) {
    const before = transition.snapshot();
    transition.setTargets({ foil: FINISH_NAMES[index % 9], pattern: PATTERN_NAMES[(index * 4) % 9] });
    assert.deepEqual(transition.snapshot().finishWeights, before.finishWeights, 'retarget cannot jump the visible mixture');
    assert.deepEqual(transition.snapshot().patternWeights, before.patternWeights);
    for (const tween of timer.scheduled) tween.progress(.31);
    for (const weights of [transition.snapshot().finishWeights, transition.snapshot().patternWeights]) {
      assert.ok(Math.abs(total(weights) - 1) < 1e-9);
      assert.ok(Object.values(weights).every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1));
    }
  }
  transition.setTargets({ foil: 'original', pattern: 'diffraction' });
  transition.setActive(false);
  assert.deepEqual(transition.snapshot().finishWeights, finishMix({ original: 1 }));
  assert.deepEqual(transition.snapshot().patternWeights, patternMix({ diffraction: 1 }));
  assert.equal(1 - transition.values.finish4, 0);
  transition.dispose();
});

test('shine style is latched per trigger, rapid changes and pause never leave an orphaned light', () => {
  const timer = clock();
  const transition = createVisualTransition({ animate: timer.animate });
  assert.equal(transition.snapshot().shineStyle, 'sweep');
  for (let index = 0; index < SHINE_STYLE_NAMES.length; index++) {
    const style = SHINE_STYLE_NAMES[index];
    transition.setTargets({ shineStyle: style });
    assert.equal(transition.shine(), true);
    const tween = timer.scheduled.at(-1);
    assert.ok(tween.options.duration > 0 && tween.options.duration < 1.2);
    tween.progress(.4);
    const next = SHINE_STYLE_NAMES[(index + 1) % SHINE_STYLE_NAMES.length];
    transition.setTargets({ shineStyle: next });
    assert.equal(transition.snapshot().activeShineStyle, style);
    assert.equal(transition.snapshot().shineStyle, next);
    assert.equal(transition.snapshot().shineProgress, .4);
    transition.shine();
    assert.equal(tween.killed, true);
    assert.equal(transition.snapshot().activeShineStyle, next);
    tween.options.onComplete();
    assert.equal(transition.snapshot().shining, true);
    assert.equal(transition.snapshot().shineProgress, 0);
    timer.scheduled.at(-1).progress(1);
    assert.equal(transition.snapshot().shineProgress, -1);
  }
  transition.shine();
  transition.setActive(false);
  assert.equal(transition.snapshot().shining, false);
  assert.equal(transition.snapshot().shineProgress, -1);
  transition.setActive(true);
  transition.shine();
  transition.dispose();
  assert.equal(timer.scheduled.at(-1).killed, true);
  assert.equal(transition.snapshot().shining, false);
  assert.equal(transition.snapshot().shineProgress, -1);
});

test('the physical edge mixes colors continuously and every finish keeps plausible surface parameters', () => {
  const palette = FINISH_NAMES.map((_, index) => ({ r: .1 + index / 20, g: .2 + index / 25, b: .3 + index / 30 }));
  const material = { color: { setRGB(r, g, b) { Object.assign(this, { r, g, b }); } } };
  const timer = clock();
  const transition = createVisualTransition({ initial: { foil: 'original' }, animate: timer.animate });
  for (const finish of FINISH_NAMES) {
    transition.setTargets({ foil: finish });
    for (const tween of timer.scheduled) tween.progress(.43);
    blendBodyFinish(material, transition.values, palette);
    assert.ok(material.roughness > .1 && material.roughness < .5);
    assert.ok(material.metalness >= .4 && material.metalness < 1);
    for (const channel of ['r', 'g', 'b']) {
      assert.ok(material.color[channel] >= palette[0][channel] && material.color[channel] <= palette.at(-1)[channel]);
    }
  }
  transition.dispose();
});
