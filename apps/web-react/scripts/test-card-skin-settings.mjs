import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBack, drawFrontTypography, normalizeCardTextSettings } from '../src/features/holo-card/sample-relief-renderer.js';
import { drawCardSkinTypography } from '../src/features/holo-card/card-skin-art.js';
import { resolveCardDesign } from '../src/features/holo-card/cardSkins.js';

const optional = ['rarity', 'element', 'level', 'power', 'attack', 'defense', 'ability', 'description'];

function recordingCanvas() {
  const calls = [], stack = [];
  const context = { font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic' };
  const measure = text => {
    const size = Number(context.font.match(/([\d.]+)px/)?.[1]) || 10;
    return [...String(text)].reduce((sum, char) => sum + size * (/[^\x00-\x7f]/u.test(char) ? 1 : char === 'W' ? .95 : .6), 0);
  };
  Object.assign(context, {
    save() { stack.push({ font: context.font, textAlign: context.textAlign, textBaseline: context.textBaseline }); },
    restore() { Object.assign(context, stack.pop() || {}); },
    measureText(text) { return { width: measure(text) }; },
    fillText(text, x, y) { calls.push({ text: String(text), x, y, width: measure(text), font: context.font }); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  });
  const proxy = new Proxy(context, { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 1024, height: 1536, getContext: () => proxy, calls };
}

test('unset statistics stay absent through skin switches and the actual layout draws its own defaults', () => {
  const initial = normalizeCardTextSettings({ skinId: 'astral' });
  const monster = normalizeCardTextSettings({ ...initial, skinId: 'monster' });
  const mixed = normalizeCardTextSettings({ ...monster, skinId: 'farm', layoutDesign: 'duel' });
  for (const settings of [initial, monster, mixed]) {
    for (const key of optional) {
      assert.equal(settings[key], undefined);
      assert.equal(Object.hasOwn(settings, key), false);
    }
  }
  for (const settings of [monster, mixed]) {
    const design = resolveCardDesign(settings), canvas = recordingCanvas();
    assert.equal(drawCardSkinTypography(canvas, design.layout.id, settings), true);
    assert.ok(canvas.calls.some(call => call.text === design.layout.defaults.ability), `missing ${design.layout.id} default ability`);
  }
  const layout = resolveCardDesign(mixed);
  assert.notEqual(layout.layout.defaults.ability, layout.skin.defaults.ability);
});

test('explicit edits, blank strings and zero survive style changes without becoming defaults', () => {
  const supplied = Object.freeze({ skinId: 'astral', ability: '用户写的能力', description: '用户写的说明', attack: '', power: 0, level: 0, defense: 42 });
  const initial = normalizeCardTextSettings(supplied);
  const switched = normalizeCardTextSettings({ ...initial, skinId: 'monster', layoutDesign: 'farm' });
  assert.equal(switched.ability, supplied.ability);
  assert.equal(switched.description, supplied.description);
  assert.equal(switched.attack, '');
  assert.equal(switched.power, '0');
  assert.equal(switched.level, '0');
  assert.equal(switched.defense, '42');
  const canvas = recordingCanvas();
  drawCardSkinTypography(canvas, resolveCardDesign(switched).layout.id, switched);
  assert.ok(canvas.calls.some(call => call.text === supplied.ability));
  assert.equal(supplied.power, 0);
});

test('clearing an override to undefined restores inheritance while legacy text retains its established fallback', () => {
  const edited = normalizeCardTextSettings({ ability: '自定义', description: '说明' });
  const cleared = normalizeCardTextSettings({ ...edited, skinId: 'pixel', ability: undefined, description: null, title: undefined });
  assert.equal(Object.hasOwn(cleared, 'ability'), false);
  assert.equal(Object.hasOwn(cleared, 'description'), false);
  assert.equal(cleared.title, '星间旅人');
  assert.equal(cleared.name, 'ASTRAL TRAVELER');
  assert.equal(cleared.number, '001');
  assert.equal(cleared.collection, 'STARCLOUDS / PORTRAIT COLLECTION');
});

test('long ASCII identifiers stay within the front and back type areas', () => {
  const long = 'W'.repeat(64);
  const settings = normalizeCardTextSettings({ title: long, subtitle: long, name: long, number: long, collection: long, edition: long });
  for (const draw of [drawFrontTypography, drawBack]) {
    const canvas = recordingCanvas();
    draw(canvas, settings);
    assert.ok(canvas.calls.length > 100);
    for (const call of canvas.calls) {
      assert.ok(call.x >= 55.99 && call.x + call.width <= 968.01, `text escaped card: ${JSON.stringify(call)}`);
      assert.ok(call.y > 0 && call.y < 1536);
    }
  }
});

test('default front typography keeps its original size and position', () => {
  const canvas = recordingCanvas();
  drawFrontTypography(canvas, normalizeCardTextSettings());
  const title = canvas.calls.filter(call => call.y === 1298);
  assert.equal(title.map(call => call.text).join(''), '星间旅人');
  assert.ok(title.every(call => call.font.startsWith('500 113px')));
  assert.equal(title[0].x, 268);
  const name = canvas.calls.filter(call => call.y === 92 && call.font.startsWith('500 19px'));
  assert.equal(name.map(call => call.text).join(''), 'ASTRAL TRAVELER');
  assert.equal(name[0].x, 76);
});
