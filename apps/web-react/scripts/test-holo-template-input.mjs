import test from 'node:test';
import assert from 'node:assert/strict';
import { readCardImage } from '../src/features/holo-card/holoCardImages.js';
import { ASTRAL_TEMPLATE_SETTINGS } from '../src/features/holo-card/holoTemplates.js';
import { ASTRAL_SAMPLE } from '../src/features/holo-card/astral-design-layers.js';

// Keep native decoding at the browser boundary; the production quality gate
// consumes the actual RGBA buffers below. The header exercises the PNG preflight.
function pngFile(width, height) {
  const header = new Uint8Array(33);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(header.buffer);
  view.setUint32(8, 13); view.setUint32(12, 0x49484452);
  view.setUint32(16, width); view.setUint32(20, height);
  header[24] = 8; header[25] = 6;
  return new Blob([header], { type: 'image/png' });
}

function subjectPixels(width, height, alpha = 255) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = height / 4; y < height * 3 / 4; y++) for (let x = width / 4; x < width * 3 / 4; x++) {
    const index = (y * width + x) * 4;
    pixels[index] = 120; pixels[index + 1] = 190; pixels[index + 2] = 205; pixels[index + 3] = alpha;
  }
  return pixels;
}

function browserPixels(t, { width = 1024, height = 1024, pixels, readError = null }) {
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls = { decoded: [], closed: 0, reads: 0, canvases: [] };
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (blob, options) => {
    calls.decoded.push({ blob, options });
    return { width, height, close: () => calls.closed++ };
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = { width: 0, height: 0, getContext: () => ({
        drawImage() {},
        getImageData() { calls.reads++; if (readError) throw readError; return { data: pixels }; },
      }) };
      calls.canvases.push(canvas);
      return canvas;
    },
  } });
  t.after(() => {
    if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap);
    else delete globalThis.createImageBitmap;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  return calls;
}

test('the shared astral settings retain the authored identity and the gallery finish', () => {
  for (const key of ['title', 'subtitle', 'name', 'number', 'collection', 'edition']) {
    assert.equal(ASTRAL_TEMPLATE_SETTINGS[key], ASTRAL_SAMPLE[key]);
  }
  assert.equal(ASTRAL_TEMPLATE_SETTINGS.foil, 'gold');
  assert.equal(ASTRAL_TEMPLATE_SETTINGS.foilStrength, .65);
  assert.equal(ASTRAL_TEMPLATE_SETTINGS.depth, 1);
  assert.equal(Object.isFrozen(ASTRAL_TEMPLATE_SETTINGS), true);
  assert.equal(Object.hasOwn(ASTRAL_TEMPLATE_SETTINGS, 'assets'), false, 'template parameters never replace the user image');
});

test('detectAlpha recognizes a high-resolution transparent PNG once without changing its source bytes', async (t) => {
  const width = 1024, height = 1024, pixels = subjectPixels(width, height);
  for (let x = width / 4; x < width * 3 / 4; x++) pixels[(height / 4 * width + x) * 4 + 3] = 128;
  const originalPixels = pixels.slice();
  const file = pngFile(width, height), originalBytes = new Uint8Array(await file.arrayBuffer());
  const calls = browserPixels(t, { width, height, pixels });
  const result = await readCardImage(file, { detectAlpha: true });
  assert.equal(result.width, width); assert.equal(result.height, height);
  assert.ok(result.alphaStats.transparentRatio > .7);
  assert.ok(result.alphaStats.partialRatio > 0, 'semi-transparent edge pixels remain intact');
  assert.equal(result.alphaStats.width, width);
  assert.equal(calls.decoded.length, 1);
  assert.equal(calls.decoded[0].blob, file);
  assert.equal(calls.decoded[0].options.premultiplyAlpha, 'none');
  assert.equal(calls.reads, 1); assert.equal(calls.closed, 1);
  assert.deepEqual(pixels, originalPixels);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), originalBytes);
  assert.ok(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('opaque or nearly invisible images remain ordinary originals instead of becoming fake subject layers', async (t) => {
  const width = 1024, height = 1024;
  const opaque = new Uint8ClampedArray(width * height * 4).fill(255);
  const calls = browserPixels(t, { width, height, pixels: opaque });
  const result = await readCardImage(pngFile(width, height), { detectAlpha: true });
  assert.deepEqual(result, { width, height });
  assert.equal(calls.closed, 1);
  opaque.set(subjectPixels(width, height, 9));
  assert.deepEqual(await readCardImage(pngFile(width, height), { detectAlpha: true }), { width, height });
  assert.equal(calls.closed, 2);
});

test('optional recognition enforces the existing resolution and clear-border gates', async (t) => {
  const width = 512, height = 512;
  const calls = browserPixels(t, { width, height, pixels: subjectPixels(width, height) });
  assert.deepEqual(await readCardImage(pngFile(width, height), { detectAlpha: true }), { width, height });
  assert.equal(calls.closed, 1);
});

test('a transparent hole inside an opaque border does not pass the subject gate', async (t) => {
  const width = 1024, height = 1024;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = height / 4; y < height * 3 / 4; y++) for (let x = width / 4; x < width * 3 / 4; x++) pixels[(y * width + x) * 4 + 3] = 0;
  browserPixels(t, { width, height, pixels });
  assert.deepEqual(await readCardImage(pngFile(width, height), { detectAlpha: true }), { width, height });
});

test('strict subject imports keep rejecting opaque PNGs even when optional detection is enabled', async (t) => {
  const width = 1024, height = 1024;
  const calls = browserPixels(t, { width, height, pixels: new Uint8ClampedArray(width * height * 4).fill(255) });
  await assert.rejects(readCardImage(pngFile(width, height), { strictAlpha: true, detectAlpha: true }), /真实透明区域/);
  assert.equal(calls.closed, 1);
  assert.ok(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('JPEG inputs skip alpha probing and unrequested PNG detection retains the old dimensions-only result', async (t) => {
  const width = 1024, height = 1024;
  const calls = browserPixels(t, { width, height, pixels: subjectPixels(width, height) });
  assert.deepEqual(await readCardImage(new Blob(['jpeg'], { type: 'image/jpeg' }), { detectAlpha: true }), { width, height });
  assert.deepEqual(await readCardImage(pngFile(width, height)), { width, height });
  assert.equal(calls.decoded.length, 2); assert.equal(calls.reads, 0); assert.equal(calls.closed, 2);
});

test('optional canvas failures fall back to an original; strict and lineart checks retain their errors and cleanup', async (t) => {
  const width = 1024, height = 1024;
  const calls = browserPixels(t, { width, height, readError: new Error('pixel-read-unavailable') });
  const file = pngFile(width, height);
  assert.deepEqual(await readCardImage(file, { detectAlpha: true }), { width, height });
  await assert.rejects(readCardImage(file, { strictAlpha: true }), /pixel-read-unavailable/);
  await assert.rejects(readCardImage(file, { detectAlpha: true, registeredTo: { width, height } }), /pixel-read-unavailable/);
  assert.equal(calls.closed, 3);
  assert.ok(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});
