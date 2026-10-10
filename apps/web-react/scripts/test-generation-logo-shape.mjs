import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleLogoShape, logoPlacement } from '../src/features/text-to-image/generationLogoShape.js';

test('logo sampling ignores the dark background and transparent pixels', () => {
  const pixels = new Uint8ClampedArray(9 * 9 * 4);
  for (let index = 0; index < pixels.length; index += 4) pixels.set([8, 9, 24, 255], index);
  pixels.set([245, 220, 255, 255], (3 * 9 + 3) * 4);
  pixels.set([255, 255, 255, 0], (5 * 9 + 5) * 4);
  const shape = sampleLogoShape(pixels, 9, 9);
  assert.equal(shape.count, 1);
  assert.ok(Math.abs(shape.points[0] - 3.5 / 9) < 1e-6);
  assert.ok(Math.abs(shape.points[1] - 3.5 / 9) < 1e-6);
  assert.equal(shape.bytes, 24);
  assert.ok([...shape.points].every(Number.isFinite));
});

test('particle logo keeps the reference aspect ratio in both portrait and landscape cards', () => {
  for (const [width, height] of [[275, 488], [620, 348], [275, 125]]) {
    const box = logoPlacement(width, height, { width: 373, height: 297 });
    assert.ok(Math.abs(box.width / box.height - 373 / 297) < 1e-6);
    assert.ok(box.y >= 0);
    assert.ok(box.y + box.height < height * 0.9);
  }
});
