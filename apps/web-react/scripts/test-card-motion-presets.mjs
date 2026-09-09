import test from 'node:test';
import assert from 'node:assert/strict';
import * as gsapModule from 'gsap';
import { CARD_MOTION_DURATIONS, cardMotionStyle, createCardMotionTour, sampleCardMotion } from '../src/features/holo-card/cardMotionPresets.js';

const gsap = gsapModule.gsap || gsapModule.default?.gsap || gsapModule.default;
const TAU = Math.PI * 2;
const styles = Object.keys(CARD_MOTION_DURATIONS);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const copy = (pose) => ({ x: pose.x, y: pose.y, flip: pose.flip });

function fixture(t, initial = { x: -.75, y: .58, flip: Math.PI }) {
  const pose = { ...initial };
  const context = gsap.context(() => {});
  let timeline, controller, updates = 0;
  context.add(() => {
    timeline = gsap.timeline({ paused: true });
    controller = createCardMotionTour({ timeline, pose, onUpdate: () => updates++ });
  });
  const start = context.add(null, (style) => controller.start(style));
  t.after(() => { controller.dispose(); context.revert(); gsap.ticker.sleep(); });
  return { pose, timeline, context, controller, start, updates: () => updates };
}

test('all paths close without a seam, remain inside tilt limits, and preserve the chosen face', () => {
  assert.equal(CARD_MOTION_DURATIONS.orbit, 12);
  for (const style of styles) {
    const start = sampleCardMotion(style, 0), end = sampleCardMotion(style, TAU);
    assert.ok(distance(start, end) < 1e-12, `${style} closes`);
    const epsilon = 1e-5;
    const before = sampleCardMotion(style, TAU - epsilon), after = sampleCardMotion(style, epsilon);
    assert.ok(Math.abs((end.x - before.x) - (after.x - start.x)) < 1e-8, `${style} tangent x`);
    assert.ok(Math.abs((end.y - before.y) - (after.y - start.y)) < 1e-8, `${style} tangent y`);
    for (let i = -720; i <= 720; i++) {
      const pose = sampleCardMotion(style, i / 180 * Math.PI);
      assert.ok(Number.isFinite(pose.x) && Math.abs(pose.x) < 1);
      assert.ok(Number.isFinite(pose.y) && Math.abs(pose.y) < 1);
      assert.equal(Object.hasOwn(pose, 'flip'), false);
    }
  }
  for (const input of [undefined, null, 'unknown', 'constructor', {}, Symbol('orbit')]) {
    assert.equal(cardMotionStyle(input), 'orbit');
  }
  assert.ok(Number.isFinite(sampleCardMotion('float', Infinity).y));
});

test('motion families have visibly different geometry instead of only different speeds', () => {
  const paths = Object.fromEntries(styles.map((style) => [style,
    Array.from({ length: 361 }, (_, i) => sampleCardMotion(style, i / 360 * TAU)),
  ]));
  const span = (style, axis) => Math.max(...paths[style].map((p) => p[axis])) - Math.min(...paths[style].map((p) => p[axis]));
  assert.ok(span('sway', 'x') > 1.5 && span('sway', 'y') < .1, 'sway has a broad horizontal arc');
  assert.ok(span('float', 'y') > 2 * span('float', 'x'), 'float emphasizes slow vertical tilt');
  assert.ok(CARD_MOTION_DURATIONS.float > CARD_MOTION_DURATIONS.orbit);
  const area = (points) => points.slice(1).reduce((sum, point, i) => sum + points[i].x * point.y - point.x * points[i].y, 0) / 2;
  const firstLobe = area(paths.figure8.slice(0, 181)), secondLobe = area(paths.figure8.slice(180));
  assert.ok(firstLobe * secondLobe < 0 && Math.abs(firstLobe) > .1 && Math.abs(secondLobe) > .1, 'figure-eight has two opposite winding lobes');
  for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) {
    const delta = paths[styles[i]].reduce((sum, point, index) => sum + distance(point, paths[styles[j]][index]) ** 2, 0);
    assert.ok(Math.sqrt(delta / 361) > .12, `${styles[i]} and ${styles[j]} are distinct`);
  }
});

test('rapid path changes reuse one GSAP timeline and enter from the actual displayed pose', (t) => {
  const { pose, timeline, start } = fixture(t);
  const initial = copy(pose);
  start('orbit');
  assert.deepEqual(copy(pose), initial);
  timeline.totalTime(2, false);
  for (let i = 0; i < 40; i++) {
    const current = copy(pose);
    start(styles[(i + 1) % styles.length]);
    assert.deepEqual(copy(pose), current, 'retarget has no position jump');
    timeline.totalTime(.001, false);
    assert.ok(distance(pose, current) < .0001, 'retarget eases into the new path');
    timeline.totalTime(.25, false);
    assert.equal(pose.flip, Math.PI, 'tour never flips the selected back face');
    const children = timeline.getChildren(false, true, false);
    assert.equal(children.length, 2);
    assert.equal(children.filter((child) => child.repeat() === -1).length, 1, 'only one repeating phase exists');
    assert.equal(gsap.globalTimeline.getChildren(false, false, true).filter((item) => item === timeline).length, 1);
  }
});

test('each running timeline repeats seamlessly after its entrance blend', (t) => {
  const { pose, timeline, start } = fixture(t);
  for (const style of styles) {
    start(style);
    const duration = CARD_MOTION_DURATIONS[style];
    timeline.totalTime(duration - .0001, false);
    const before = copy(pose);
    timeline.totalTime(duration + .0001, false);
    assert.ok(distance(pose, before) < .0002, `${style} loop does not replay its entrance`);
  }
});

test('manual takeover and disposal prevent stale callbacks from moving a card', (t) => {
  const { pose, timeline, controller, start, context, updates } = fixture(t);
  start('sway');
  timeline.totalTime(.7, false);
  const oldUpdate = timeline.getChildren(false, true, false)[0].vars.onUpdate;
  controller.stop();
  const frozen = copy(pose), stoppedUpdates = updates();
  assert.equal(timeline.paused(), true);
  assert.equal(controller.isRunning(), false);
  oldUpdate();
  assert.deepEqual(copy(pose), frozen);
  assert.equal(updates(), stoppedUpdates);
  pose.x = .4; pose.y = -.3;
  const manual = copy(pose);
  start('float');
  assert.deepEqual(copy(pose), manual, 'resume uses the manually chosen pose');
  oldUpdate();
  assert.deepEqual(copy(pose), manual, 'old path callbacks cannot overwrite a resumed tour');
  timeline.totalTime(3, false);
  controller.dispose();
  const finalPose = copy(pose), finalUpdates = updates();
  oldUpdate();
  assert.equal(controller.start('orbit'), false);
  assert.deepEqual(copy(pose), finalPose);
  assert.equal(updates(), finalUpdates);
  assert.equal(timeline.parent, null);
  assert.doesNotThrow(() => context.getTweens(), 'no nested GSAP context cycle');
  context.revert();
  assert.equal(context.data.length, 0);
});
