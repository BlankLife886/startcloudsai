import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SKINS, resolveCardDesign } from '../src/features/holo-card/cardSkins.js';
import { createCardSkinCanvases, drawCardSkinTextBacking, drawCardSkinTypography } from '../src/features/holo-card/card-skin-art.js';

// A conservative font-metric/drawing recorder checks layout and canvas lifetime.
// Actual raster appearance is separately reviewed in browser contact sheets.
function recordingCanvas(width = 1024, height = 1536) {
  const commands = [], text = [], stack = [];
  let state = { font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', transform: [1, 0, 0, 1, 0, 0] };
  const multiply = ([a, b, c, d, e, f]) => {
    const [A, B, C, D, E, F] = state.transform;
    state.transform = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  };
  const fontSize = () => Number(state.font.match(/([\d.]+)px/)?.[1]) || 10;
  const measure = value => Array.from(String(value)).reduce((sum, letter) => sum + (/[\u3400-\u9fff]/u.test(letter) ? 1 : /\s/u.test(letter) ? .32 : /Menlo|monospace/.test(state.font) ? .62 : .56), 0) * fontSize();
  const context = new Proxy({
    save() { stack.push({ ...state }); }, restore() { state = stack.pop() || state; },
    translate(x, y) { multiply([1, 0, 0, 1, x, y]); },
    scale(x, y) { multiply([x, 0, 0, y, 0, 0]); },
    rotate(angle) { multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]); },
    setTransform(a, b, c, d, e, f) { state.transform = [a, b, c, d, e, f]; },
    measureText(value) { return { width: measure(value) }; },
    fillText(value, x, y) {
      const size = fontSize(), width = measure(value);
      const left = x - (state.textAlign === 'right' ? width : state.textAlign === 'center' ? width / 2 : 0);
      const top = state.textBaseline === 'top' ? y : y - size * .8;
      const [a, b, c, d, e, f] = state.transform;
      const corners = [[left, top], [left + width, top], [left, top + size], [left + width, top + size]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
      text.push({ value: String(value), left: Math.min(...corners.map(p => p[0])), right: Math.max(...corners.map(p => p[0])),
        top: Math.min(...corners.map(p => p[1])), bottom: Math.max(...corners.map(p => p[1])), size });
    },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in state) return state[key];
      return (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(key)} received a non-finite coordinate`);
        commands.push({ operation: key, args, composite: state.globalCompositeOperation });
      };
    },
    set(_target, key, value) { state[key] = value; return true; },
  });
  return { width, height, commands, text, getContext: () => context };
}

function canvasDocument(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: name => {
    assert.equal(name, 'canvas'); return recordingCanvas();
  } } });
  t.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
}
const sources = canvas => [canvas, ...canvas.commands.filter(command => command.operation === 'drawImage').flatMap(command => sources(command.args[0]))];

test('all designed skins create four complete, separate layers at card and thumbnail resolutions', t => {
  canvasDocument(t);
  for (const skin of CARD_SKINS.filter(skin => skin.id !== 'astral')) for (const [width, height] of [[1024, 1536], [192, 288]]) {
    const layers = createCardSkinCanvases(skin.id, { width, height, accentColor: '#a3d4e5' });
    assert.equal(new Set(Object.values(layers)).size, 4);
    for (const [role, canvas] of Object.entries(layers)) {
      assert.equal(canvas.width, width); assert.equal(canvas.height, height);
      assert.ok(sources(canvas).some(source => source.commands.length > 3), `${skin.id}/${role} contains a drawing`);
    }
    if (!skin.fullArt) assert.ok(sources(layers.frame).some(source => source.commands.some(command => command.operation === 'fill' && command.composite === 'destination-out')), `${skin.id} has a genuinely erased artwork window`);
  }
  assert.deepEqual(createCardSkinCanvases('astral'), { background: null, effects: null, frame: null, back: null });
  assert.equal(drawCardSkinTypography(null, 'astral', {}), false);
});

test('default and long Chinese typography stays inside the card and clear of the character area', () => {
  for (const skin of CARD_SKINS.filter(skin => skin.id !== 'astral')) for (const stress of [false, true]) {
    const canvas = recordingCanvas();
    const settings = stress ? {
      ...skin.defaults, title: '完整的长中文角色名称和收藏卡片标题'.repeat(5),
      subtitle: 'THE COMPLETE LONG CHARACTER SUBTITLE '.repeat(5),
      collection: '完整的收藏系列名称'.repeat(8), edition: '特别典藏发行纪念版'.repeat(8),
      name: '完整的角色名称'.repeat(8), number: '1234567890'.repeat(5),
      rarity: '极其稀有的收藏级别'.repeat(6), element: '光属性与森林属性'.repeat(6),
      ability: '完整的角色专属能力名称'.repeat(8), description: '这是用来验证中文自动缩字和换行的完整技能说明，所有文字都必须留在各自的信息区域。'.repeat(10),
      power: '12345678901234567890', attack: '12345678901234567890', defense: '12345678901234567890',
    } : skin.defaults;
    assert.equal(drawCardSkinTypography(canvas, skin.id, settings), true);
    const r = skin.fullArt ? { x: .2, y: .15, width: .6, height: .55 } : skin.artworkRect;
    const rect = { left: r.x * 1024, top: r.y * 1536, right: (r.x + r.width) * 1024, bottom: (r.y + r.height) * 1536 };
    for (const text of canvas.text) {
      assert.ok(text.left >= 20 && text.right <= 1004, `${skin.id}: horizontal overflow: ${text.value}`);
      assert.ok(text.top >= 20 && text.bottom <= 1516, `${skin.id}: vertical overflow: ${text.value}`);
      const overlapsArt = text.left < rect.right && text.right > rect.left && text.top < rect.bottom && text.bottom > rect.top;
      assert.equal(overlapsArt, false, `${skin.id}: typography overlays the subject window: ${text.value}`);
    }
    for (let i = 0; i < canvas.text.length; i++) for (let j = i + 1; j < canvas.text.length; j++) {
      const a = canvas.text[i], b = canvas.text[j];
      const overlaps = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      assert.equal(overlaps, false, `${skin.id}: overlapping labels ${a.value} / ${b.value}`);
    }
  }
});

test('numeric levels remain user-authored outside the duel star decoration', () => {
  const pixel = recordingCanvas(), monster = recordingCanvas();
  drawCardSkinTypography(pixel, 'pixel', { ...CARD_SKINS.find(skin => skin.id === 'pixel').defaults, level: '32' });
  drawCardSkinTypography(monster, 'monster', { ...CARD_SKINS.find(skin => skin.id === 'monster').defaults, level: '24' });
  assert.ok(pixel.text.some(text => text.value === 'LV 32'));
  assert.ok(monster.text.some(text => text.value.includes('LV.24')));
});

test('mixed layouts add their paper behind existing glyphs while leaving the subject window and outer rails clear', t => {
  canvasDocument(t);
  for (const skin of CARD_SKINS.filter(skin => skin.id !== 'astral')) {
    const settings = { ...skin.defaults, skinId: 'anime', frameDesign: skin.id === 'anime' ? 'monster' : 'anime', layoutDesign: skin.id };
    const canvas = recordingCanvas();
    drawCardSkinTypography(canvas, skin.id, settings);
    const existingText = canvas.text.map(item => ({ ...item }));
    const offset = canvas.commands.length;
    assert.equal(drawCardSkinTextBacking(canvas, skin.id, settings), true);
    assert.deepEqual(canvas.text, existingText, 'backing does not redraw or replace user glyphs');
    const commands = canvas.commands.slice(offset);
    assert.ok(commands.some(command => command.operation === (skin.fullArt ? 'fill' : 'drawImage') && command.composite === 'destination-over'));
    assert.equal(commands.some(command => command.composite === 'destination-out'), false, 'frame window erasure remains isolated on its temporary surface');
    const areas = commands.filter(command => command.operation === 'rect').map(command => command.args);
    assert.equal(areas.length, 2);
    const r = resolveCardDesign(settings).artworkRect;
    for (const [x, y, width, height] of areas) {
      assert.equal(x, 50); assert.equal(x + width, 974, 'the chosen frame keeps its side rails');
      assert.ok(y + height <= r.y * 1536 || y >= (r.y + r.height) * 1536, 'backing is outside the actual subject window');
    }
    if (!skin.fullArt) {
      const source = commands.find(command => command.operation === 'drawImage').args[0];
      assert.equal(source.width, 1); assert.equal(source.height, 1, 'temporary raster memory is released after compositing');
    }
  }
});

test('Astral typography can use a dark mixed-layout backing without covering the anime subject window', () => {
  const settings = { skinId: 'anime', layoutDesign: 'astral' };
  const canvas = recordingCanvas();
  assert.equal(drawCardSkinTextBacking(canvas, 'astral', settings), true);
  const areas = canvas.commands.filter(command => command.operation === 'rect').map(command => command.args);
  assert.equal(areas.length, 2);
  const rect = resolveCardDesign(settings).artworkRect;
  assert.deepEqual(areas[0].slice(0, 3), [50, 50, 924]);
  assert.ok(areas[0][1] + areas[0][3] < rect.y * 1536, 'the header backing adapts to the taller photo window');
  assert.ok(areas[1][1] > (rect.y + rect.height) * 1536);
  for (const [x, y, width, height] of areas) {
    assert.ok([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0);
    assert.ok(x >= 20 && x + width <= 1004 && y >= 20 && y + height <= 1516);
    assert.ok(y + height <= rect.y * 1536 || y >= (rect.y + rect.height) * 1536, 'backing does not cover the resolved subject window');
  }
  assert.ok(canvas.commands.some(command => command.operation === 'fill' && command.composite === 'destination-over'));
  assert.equal(canvas.commands.some(command => command.composite === 'destination-out'), false);
  const hiddenFrame = recordingCanvas();
  assert.equal(drawCardSkinTextBacking(hiddenFrame, 'astral', { ...settings, showFrame: false }), false);
  assert.equal(hiddenFrame.commands.length, 0, 'hiding the frame retains the original full-canvas artwork');
});
