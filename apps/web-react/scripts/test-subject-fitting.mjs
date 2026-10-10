import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCardLayer, fitSubject, hasNativeCardAspect, mergeAlphaBounds, normalizeArtworkRect, scanAlphaBounds } from '../src/features/holo-card/subject-fitting.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
const toSource = (mapping, x, y) => ({ x: x * mapping.uvScale.x + mapping.uvOffset.x, y: y * mapping.uvScale.y + mapping.uvOffset.y });

test('the authored 2:3 card keeps an exact identity UV at the default scale', () => {
  for (const framing of ['native', 'auto']) {
    const fit = fitSubject({ width: 1024, height: 1536, framing });
    assert.deepEqual(fit.uvScale, { x: 1, y: 1 });
    assert.deepEqual(fit.uvOffset, { x: 0, y: 0 });
    assert.deepEqual(fit.displayBounds, { x: 0, y: 0, width: 1, height: 1 });
    assert.equal(fit.strategy, 'native');
  }
  assert.equal(hasNativeCardAspect(2048, 3072), true);
  assert.equal(hasNativeCardAspect(1024, 1024), false);
});

test('alpha bounds retain alpha-one hair and do not treat white RGB as removable', () => {
  const pixels = new Uint8ClampedArray(20 * 30 * 4);
  pixels[(2 * 20 + 3) * 4 + 3] = 1;
  pixels[(27 * 20 + 18) * 4 + 3] = 127;
  const white = (12 * 20 + 10) * 4;
  pixels.set([255, 255, 255, 255], white);
  const original = pixels.slice();
  assert.deepEqual(scanAlphaBounds(pixels, 20, 30), { x: 3, y: 2, width: 16, height: 26 });
  assert.deepEqual(pixels, original);
  assert.deepEqual(scanAlphaBounds(new Uint8ClampedArray(20 * 30 * 4).fill(255), 20, 30), { x: 0, y: 0, width: 20, height: 30 });
  assert.equal(scanAlphaBounds(new Uint8ClampedArray(20 * 30 * 4), 20, 30), null);
});

test('native-resolution strip inspection has the same bounds as reading the full image', () => {
  const width = 7, height = 11, pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of [[5, 1, 1], [2, 5, 70], [6, 8, 130], [0, 10, 1]]) pixels[(y * width + x) * 4 + 3] = alpha;
  let combined = null;
  for (let top = 0; top < height; top += 3) {
    const rows = Math.min(3, height - top);
    const strip = pixels.subarray(top * width * 4, (top + rows) * width * 4);
    combined = mergeAlphaBounds(combined, scanAlphaBounds(strip, width, rows, top));
  }
  assert.deepEqual(combined, scanAlphaBounds(pixels, width, height));
  const before = { ...combined };
  mergeAlphaBounds(combined, { x: 0, y: 0, width: 7, height: 11 });
  assert.deepEqual(combined, before);
});

test('a square generated portrait fits the visible subject instead of the transparent square', () => {
  const alphaBounds = { x: 300, y: 70, width: 400, height: 870 };
  const fit = fitSubject({ width: 1024, height: 1024, framing: 'auto', alphaBounds });
  const whole = fitSubject({ width: 1024, height: 1024, framing: 'contain' });
  near(fit.displayBounds.height, .88);
  assert.ok(fit.displayBounds.height > whole.displayBounds.height * (870 / 1024) * 1.5);
  near(fit.displayBounds.width * 2 / (fit.displayBounds.height * 3), alphaBounds.width / alphaBounds.height);
  const { x, y, width, height } = fit.displayBounds;
  const bottomLeft = toSource(fit, x, y), topRight = toSource(fit, x + width, y + height);
  near(bottomLeft.x, alphaBounds.x / 1024);
  near(bottomLeft.y, 1 - (alphaBounds.y + alphaBounds.height) / 1024);
  near(topRight.x, (alphaBounds.x + alphaBounds.width) / 1024);
  near(topRight.y, 1 - alphaBounds.y / 1024);
});

test('contain preserves every source corner and the physical aspect for landscape and portrait photos', () => {
  for (const [width, height] of [[1600, 400], [400, 1600], [1024, 1024], [768, 1152]]) {
    const fit = fitSubject({ width, height, framing: 'contain' });
    const bounds = fit.displayBounds;
    const from = toSource(fit, bounds.x, bounds.y), to = toSource(fit, bounds.x + bounds.width, bounds.y + bounds.height);
    near(from.x, 0); near(from.y, 0); near(to.x, 1); near(to.y, 1);
    near(bounds.width * 2 / (bounds.height * 3), width / height);
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1);
  }
});

test('auto scaling retains the full visible subject at both ends of the supported scale', () => {
  for (const alphaBounds of [{ x: 0, y: 0, width: 1024, height: 1024 }, { x: 500, y: 0, width: 20, height: 1024 }, { x: 0, y: 510, width: 1024, height: 10 }]) {
    for (const subjectScale of [-1, .75, 1, 1.2, 10, NaN]) {
      const fit = fitSubject({ width: 1024, height: 1024, framing: 'auto', subjectScale, alphaBounds });
      const bounds = fit.displayBounds;
      assert.ok(bounds.x >= .0099 && bounds.y >= .0599);
      assert.ok(bounds.x + bounds.width <= .9901 && bounds.y + bounds.height <= .9801);
      assert.ok(fit.requestedScale >= .75 && fit.requestedScale <= 1.2);
      assert.ok(Number.isFinite(fit.uvScale.x) && Number.isFinite(fit.uvScale.y));
    }
  }
});

test('cover backgrounds fill the card with a centered crop and preserve source pixel proportions', () => {
  for (const [width, height] of [[1600, 900], [900, 1600], [1024, 1536], [4096, 1024]]) {
    const fit = fitCardLayer(width, height);
    assert.ok(fit.uvScale.x <= 1 && fit.uvScale.y <= 1);
    near(width * fit.uvScale.x / (height * fit.uvScale.y), 2 / 3);
    assert.deepEqual(toSource(fit, .5, .5), { x: .5, y: .5 });
  }
  assert.deepEqual(fitCardLayer(1024, 1536), { uvScale: { x: 1, y: 1 }, uvOffset: { x: 0, y: 0 } });
});

test('invalid dimensions and incomplete alpha scans fail instead of hiding or cropping the subject', () => {
  for (const [width, height] of [[0, 10], [10, Infinity], [10.5, 20]]) assert.throws(() => fitSubject({ width, height }));
  assert.throws(() => scanAlphaBounds(new Uint8ClampedArray(10), 10, 10));
  assert.throws(() => fitSubject({ width: 1024, height: 1024, framing: 'auto' }));
  assert.throws(() => fitSubject({ width: 1024, height: 1024, framing: 'auto', alphaBounds: { x: 1000, y: 0, width: 40, height: 100 } }));
});

test('authored 2:3 images fit inside a skin window with no stretch or implicit crop', () => {
  const artworkRect = { x: .09, y: .19, width: .82, height: .43 };
  for (const framing of ['native', 'auto', 'contain']) {
    const fit = fitSubject({ width: 1024, height: 1536, framing, artworkRect });
    const visible = fit.displayBounds;
    assert.notDeepEqual(fit.uvScale, { x: 1, y: 1 });
    near(visible.width * 2 / (visible.height * 3), 2 / 3);
    assert.ok(visible.x >= artworkRect.x);
    assert.ok(visible.x + visible.width <= artworkRect.x + artworkRect.width);
    assert.ok(visible.y >= 1 - artworkRect.y - artworkRect.height);
    assert.ok(visible.y + visible.height <= 1 - artworkRect.y);
    const first = toSource(fit, visible.x, visible.y), last = toSource(fit, visible.x + visible.width, visible.y + visible.height);
    near(first.x, 0); near(first.y, 0); near(last.x, 1); near(last.y, 1);
  }
});

test('asymmetric windows keep fine alpha bounds fully visible, including at maximum scale', () => {
  const artworkRect = { x: .12, y: .24, width: .62, height: .37 };
  const alphaBounds = { x: 135, y: 35, width: 803, height: 959 };
  const fit = fitSubject({ width: 1024, height: 1024, framing: 'auto', subjectScale: 1.2, alphaBounds, artworkRect });
  const visible = fit.displayBounds;
  near(visible.x + visible.width / 2, artworkRect.x + artworkRect.width / 2);
  near(visible.y + visible.height / 2, 1 - artworkRect.y - artworkRect.height / 2);
  const first = toSource(fit, visible.x, visible.y), last = toSource(fit, visible.x + visible.width, visible.y + visible.height);
  near(first.x, alphaBounds.x / 1024);
  near(first.y, 1 - (alphaBounds.y + alphaBounds.height) / 1024);
  near(last.x, (alphaBounds.x + alphaBounds.width) / 1024);
  near(last.y, 1 - alphaBounds.y / 1024);
  assert.ok(visible.x >= artworkRect.x && visible.x + visible.width <= artworkRect.x + artworkRect.width);
  assert.ok(visible.y >= 1 - artworkRect.y - artworkRect.height && visible.y + visible.height <= 1 - artworkRect.y);
  assert.throws(() => normalizeArtworkRect({ x: .9, y: 0, width: .4, height: .5 }));
  assert.throws(() => normalizeArtworkRect({ x: 0, y: 0, width: 1, height: 0 }));
});
