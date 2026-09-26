import test from 'node:test';
import assert from 'node:assert/strict';
import { readCardGraphic } from '../src/features/holo-card/cardGraphicInput.js';
import { applyCardSkin, CARD_SKINS, resolveCardDesign } from '../src/features/holo-card/cardSkins.js';
import { FINISHES, PATTERNS, SHINE_STYLES, MOTION_STYLES } from '../src/features/holo-card/holoVisualCatalog.js';

function pngHeader(width, height) {
  const header = new Uint8Array(33); header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(header.buffer); view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, width); view.setUint32(20, height);
  return new Blob([header], { type: 'image/png' });
}

function decoder(t, { width = 256, height = 384, pixelAlpha = () => 0 } = {}) {
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls = { closed: 0, reads: 0, canvases: [] };
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width, height, close() { calls.closed++; } }) });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    let top = 0;
    const canvas = { width: 0, height: 0, getContext: () => ({
      clearRect() {}, drawImage(_bitmap, _x, y) { top = y; },
      getImageData(_x, _y, columns, rows) {
        calls.reads++;
        const data = new Uint8ClampedArray(columns * rows * 4);
        for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) data[(y * columns + x) * 4 + 3] = pixelAlpha(x, top + y);
        return { data };
      },
    }) };
    calls.canvases.push(canvas); return canvas;
  } } });
  t.after(() => {
    if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap); else delete globalThis.createImageBitmap;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  });
  return calls;
}

test('all whole-card skins preserve a user’s content and pose, with valid material defaults', () => {
  const source = { png: new Uint8Array([1, 2, 3]) };
  const previous = { title: '我的角色', description: '', attack: '0', source, paused: true, flipped: true, autoOrbit: true, exploded: true, frameDesign: 'farm', accentColor: '#123456', showFrame: false };
  for (const skin of CARD_SKINS) {
    const next = applyCardSkin(previous, skin.id);
    for (const key of ['title', 'description', 'attack', 'source', 'paused', 'flipped', 'autoOrbit', 'exploded']) assert.equal(next[key], previous[key]);
    assert.equal(next.skinId, skin.id); assert.equal(next.frameDesign, 'skin'); assert.equal(next.accentColor, ''); assert.equal(next.showFrame, true);
    for (const [key, catalog] of [['foil', FINISHES], ['pattern', PATTERNS], ['shineStyle', SHINE_STYLES], ['orbitStyle', MOTION_STYLES]]) assert.ok(catalog.some(item => item.id === next[key]), `${skin.id}/${key} is usable`);
  }
  assert.equal(previous.frameDesign, 'farm'); assert.equal(previous.showFrame, false);
});

test('mixed parts resolve to a shared safe artwork region and pixel display is reversible', () => {
  for (const frame of CARD_SKINS) for (const layout of CARD_SKINS) {
    const design = resolveCardDesign({ skinId: 'pixel', frameDesign: frame.id, layoutDesign: layout.id, artTreatment: 'natural' });
    assert.equal(design.frame.id, frame.id); assert.equal(design.layout.id, layout.id); assert.equal(design.background.id, 'pixel'); assert.equal(design.pixelated, false);
    const rect = design.artworkRect;
    for (const bounds of [frame.artworkRect, layout.artworkRect]) {
      assert.ok(rect.x >= bounds.x && rect.y >= bounds.y);
      assert.ok(rect.x + rect.width <= bounds.x + bounds.width + 1e-10 && rect.y + rect.height <= bounds.y + bounds.height + 1e-10);
    }
  }
  assert.equal(resolveCardDesign({ skinId: 'pixel' }).pixelated, true);
  assert.equal(resolveCardDesign({ skinId: 'missing' }).skin.id, 'astral');
});

test('small transparent decorations retain their original bytes and partial alpha without subject coverage restrictions', async t => {
  const calls = decoder(t, { pixelAlpha: (x, y) => x === 30 && y === 360 ? 128 : 0 });
  const blob = pngHeader(256, 384), before = new Uint8Array(await blob.arrayBuffer());
  const result = await readCardGraphic(blob, 'effects');
  assert.equal(result.visiblePixels, 1); assert.equal(result.transparentPixels, 256 * 384);
  assert.equal(calls.reads, 3); assert.equal(calls.closed, 2);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), before);
  assert.ok(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('opaque, empty, wrong-aspect and disguised overlays fail with an actionable error', async t => {
  let alpha = 255;
  const calls = decoder(t, { pixelAlpha: () => alpha });
  await assert.rejects(readCardGraphic(pngHeader(256, 384), 'frame'), /没有透明区域/);
  alpha = 0;
  await assert.rejects(readCardGraphic(pngHeader(256, 384), 'effects'), /完全透明/);
  await assert.rejects(readCardGraphic(new Blob(['fake PNG'], { type: 'image/png' }), 'frame'), /真实 PNG/);
  await assert.rejects(readCardGraphic(new Blob(['jpeg'], { type: 'image/jpeg' }), 'effects'), /透明区域的 PNG/);
  assert.equal(calls.closed, 4);
  assert.ok(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('back images accept ordinary photos while decorative overlays require a 2:3 canvas', async t => {
  const calls = decoder(t, { width: 512, height: 512 });
  assert.deepEqual(await readCardGraphic(new Blob(['jpeg'], { type: 'image/jpeg' }), 'back'), { width: 512, height: 512 });
  await assert.rejects(readCardGraphic(pngHeader(512, 512), 'frame'), /2:3/);
  assert.equal(calls.reads, 0); assert.equal(calls.closed, 2);
});

test('near-opaque pixels and off-center transparency cannot disguise a character-blocking frame', async t => {
  let kind = 'near-opaque';
  const calls = decoder(t, { pixelAlpha: (x, y) => kind === 'near-opaque' ? x === 0 && y === 0 ? 254 : 255
    : kind === 'off-center' ? y < 40 ? 0 : 255 : x < 20 || x > 236 || y < 20 || y > 364 ? 255 : 0 });
  const blob = pngHeader(256, 384);
  await assert.rejects(readCardGraphic(blob, 'frame'), /几乎完全不透明/);
  kind = 'off-center';
  await assert.rejects(readCardGraphic(blob, 'frame'), /盖住大部分人物/);
  kind = 'open-window';
  const result = await readCardGraphic(blob, 'frame');
  assert.ok(result.clearPixels > 256 * 384 * .7);
  assert.equal(calls.closed, 6);
  assert.ok(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});
