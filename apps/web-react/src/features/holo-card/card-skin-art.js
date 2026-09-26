import { getCardSkin, resolveCardDesign } from './cardSkins.js';
import { createDopamineDesign } from './skin-dopamine.js';
import { createPokemonDesign } from './skin-pokemon.js';
import { createArknightsDesign } from './skin-arknights.js';
import { createOceanDesign } from './skin-ocean.js';

const W = 1024, H = 1536, TAU = Math.PI * 2;
const SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const SERIF = '"Songti SC", "Noto Serif CJK SC", Georgia, serif';
const MONO = '"SFMono-Regular", Menlo, "PingFang SC", monospace';
const validHex = value => /^#[\da-f]{6}$/i.test(String(value));
function rgba(color, opacity) {
  const s = validHex(color) ? color.slice(1) : 'ffffff';
  return `rgba(${parseInt(s.slice(0, 2), 16)},${parseInt(s.slice(2, 4), 16)},${parseInt(s.slice(4, 6), 16)},${opacity})`;
}
function mix(a, b, amount) {
  const x = validHex(a) ? a.slice(1) : '000000', y = validHex(b) ? b.slice(1) : 'ffffff';
  return `#${[0, 2, 4].map(i => Math.round(parseInt(x.slice(i, i + 2), 16) * (1 - amount) + parseInt(y.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('')}`;
}
const palette = (skin, accent) => ({ ...skin.palette, accent: validHex(accent) ? accent : skin.palette.accent });
function artRect(skin) {
  const r = skin.artworkRect;
  return { x: r.x * W, y: r.y * H, width: r.width * W, height: r.height * H, right: (r.x + r.width) * W, bottom: (r.y + r.height) * H };
}
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function pathRect(ctx, x, y, width, height, radius = 0) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function rounded(ctx, x, y, width, height, radius, fill, stroke = '', weight = 1) {
  pathRect(ctx, x, y, width, height, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = weight; ctx.stroke(); }
}
function line(ctx, points, color, weight = 1) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.stroke();
}
function polygon(ctx, points, fill, stroke = '', weight = 1) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = weight; ctx.stroke(); }
}
function circle(ctx, x, y, radius, fill, stroke = '', weight = 1) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = weight; ctx.stroke(); }
}
function star(ctx, x, y, radius, fill, points = 4, ratio = .2) {
  polygon(ctx, Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / points, r = i % 2 ? radius * ratio : radius;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r];
  }), fill);
}
function gradient(ctx, colors, x = 0, y = 0, x2 = W, y2 = H) {
  const value = ctx.createLinearGradient(x, y, x2, y2);
  colors.forEach((color, i) => value.addColorStop(i / Math.max(1, colors.length - 1), color)); return value;
}
function glow(ctx, x, y, radius, color, opacity) {
  const value = ctx.createRadialGradient(x, y, 0, x, y, radius);
  value.addColorStop(0, rgba(color, opacity)); value.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = value; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function texture(ctx, seed, color, count = 1200, opacity = .055, bounds = { x: 0, y: 0, width: W, height: H }) {
  const rand = random(seed); ctx.fillStyle = rgba(color, opacity);
  for (let i = 0; i < count; i++) ctx.fillRect(bounds.x + rand() * bounds.width, bounds.y + rand() * bounds.height, 1 + rand() * 2, .6 + rand());
}
function pixelRect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, Math.max(4, Math.round(width / 4) * 4), Math.max(4, Math.round(height / 4) * 4));
}
function steppedRect(ctx, x, y, width, height, fill, stroke = '', weight = 4, notch = 12) {
  polygon(ctx, [[x + notch, y], [x + width - notch, y], [x + width - notch, y + notch], [x + width, y + notch], [x + width, y + height - notch], [x + width - notch, y + height - notch], [x + width - notch, y + height], [x + notch, y + height], [x + notch, y + height - notch], [x, y + height - notch], [x, y + notch], [x + notch, y + notch]], fill, stroke, weight);
}
function clearWindow(ctx, r, pixelated = false) {
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  if (pixelated) steppedRect(ctx, r.x, r.y, r.width, r.height, '#000000', '', 0, 8);
  else rounded(ctx, r.x, r.y, r.width, r.height, 8, '#000000');
  ctx.restore();
}
function silverEdge(ctx, r, color, pixelated = false) {
  if (pixelated) steppedRect(ctx, r.x - 5, r.y - 5, r.width + 10, r.height + 10, '', rgba(color, .78), 4, 12);
  else rounded(ctx, r.x - 3, r.y - 3, r.width + 6, r.height + 6, 10, '', rgba(color, .75), 1.7);
}
function tinyText(ctx, value, x, y, color, { size = 15, family = SANS, align = 'center' } = {}) {
  ctx.font = `500 ${size}px ${family}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(value, x, y);
}
function petal(ctx, x, y, radius, angle, color, opacity = .72) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(0, -radius);
  ctx.bezierCurveTo(radius, -radius * .6, radius * .7, radius * .5, 0, radius);
  ctx.bezierCurveTo(-radius * .7, radius * .5, -radius, -radius * .6, 0, -radius);
  ctx.fillStyle = rgba(color, opacity); ctx.fill(); ctx.restore();
}
function blossom(ctx, x, y, radius, color, center = '#dcc492') {
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * TAU;
    petal(ctx, x + Math.sin(angle) * radius * .56, y + Math.cos(angle) * radius * .56, radius * .6, -angle, color, .6);
  }
  circle(ctx, x, y, Math.max(1.2, radius * .13), center);
}
function sprig(ctx, x, y, length, angle, stem, bloom, dried = false) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-9, -length * .28, 14, -length * .67, 0, -length);
  ctx.strokeStyle = rgba(stem, .6); ctx.lineWidth = dried ? 1.7 : 1.2; ctx.stroke();
  for (let i = 1; i <= 5; i++) {
    const yy = -length * (.12 + i * .12), sign = i % 2 ? 1 : -1;
    line(ctx, [[0, yy], [sign * 14, yy - 17]], rgba(stem, .5), 1.1);
    petal(ctx, sign * 15, yy - 20, dried ? 6 : 8, sign * .6, stem, dried ? .45 : .22);
    if (i === 2 || i === 5) blossom(ctx, sign * 18, yy - 25, dried ? 7 : 10, bloom);
  }
  blossom(ctx, 0, -length, dried ? 8 : 12, bloom); ctx.restore();
}
function engravedCorner(ctx, x, y, sx, sy, color, length = 112) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
  line(ctx, [[0, length], [0, 0], [length, 0]], rgba(color, .6), 1.4);
  ctx.beginPath(); ctx.moveTo(8, length - 16); ctx.bezierCurveTo(36, length - 38, 1, 27, 37, 36);
  ctx.bezierCurveTo(64, 43, 38, 76, 25, 55); ctx.bezierCurveTo(8, 30, 76, 41, length - 17, 8);
  ctx.strokeStyle = rgba(color, .67); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(15, 72); ctx.bezierCurveTo(41, 64, 38, 20, 68, 15); ctx.strokeStyle = rgba(color, .3); ctx.stroke();
  for (const [xx, yy] of [[12, 12], [24, 49], [50, 24]]) circle(ctx, xx, yy, 1.8, rgba(color, .72));
  ctx.restore();
}
function gem(ctx, x, y, radius, color, pixelated = false) {
  const points = [[x, y - radius], [x + radius * .67, y - radius * .32], [x + radius * .6, y + radius * .5], [x, y + radius], [x - radius * .6, y + radius * .5], [x - radius * .67, y - radius * .32]];
  polygon(ctx, points, mix(color, '#17243a', .35), rgba('#fff0d0', .58), pixelated ? 3 : 1.1);
  polygon(ctx, [[x, y - radius], [x, y + radius * .65], [x - radius * .67, y - radius * .32]], mix(color, '#ffffff', .15));
  polygon(ctx, [[x, y - radius], [x + radius * .67, y - radius * .32], [x + radius * .6, y + radius * .5]], rgba('#ffffff', .2));
  if (pixelated) pixelRect(ctx, x - 4, y - radius * .5, 4, radius * .65, '#f8efd4');
  else line(ctx, [[x - radius * .22, y - radius * .52], [x - radius * .22, y + radius * .12]], rgba('#ffffff', .72), 1.1);
}

// The finished scene is supplied by the skin catalog. These low-contrast bases
// keep the card usable while a scene is unavailable, without competing with it.
function fallbackBackground(ctx, p) {
  ctx.fillStyle = gradient(ctx, [mix(p.base, p.secondary, .17), p.base, mix(p.base, '#080d18', .25)]); ctx.fillRect(0, 0, W, H);
  glow(ctx, W * .67, H * .33, 670, p.secondary, .13);
  texture(ctx, 32, p.ink, 1400, .026);
}
function animeFrame(ctx, p, r) {
  rounded(ctx, 10, 10, W - 20, H - 20, 28, gradient(ctx, [p.base, p.panel, '#1b213b']));
  rounded(ctx, 22, 22, W - 44, H - 44, 19, '', rgba(p.border, .48), 1.7);
  texture(ctx, 215, '#ebe5f5', 2100, .036);
  glow(ctx, 892, r.bottom + 145, 240, p.accent, .065);
  sprig(ctx, 28, 214, 148, -.16, p.border, p.accent);
  sprig(ctx, 992, H - 48, 112, .06, p.border, p.accent);
  polygon(ctx, [[W - 82, 22], [W - 24, 22], [W - 24, 80]], gradient(ctx, [rgba(p.border, .34), rgba(p.accent, .18), rgba(p.secondary, .42)], W - 82, 22, W - 24, 80));
  polygon(ctx, [[22, H - 78], [22, H - 24], [76, H - 24]], rgba(p.secondary, .16));
  clearWindow(ctx, r); silverEdge(ctx, r, p.border);
}
function animeEffects(ctx, p, r) {
  for (const [x, y, angle, size] of [[r.x + 7, r.y + 109, -.5, 9], [r.right - 9, r.y + r.height * .36, .8, 6], [r.right - 11, r.bottom - 73, -.4, 8]]) {
    petal(ctx, x, y, size, angle, p.accent, .56); glow(ctx, x, y, size * 6, p.secondary, .035);
  }
  for (const [x, y] of [[r.x + 2, r.bottom - 60], [r.right - 4, r.y + 64]]) star(ctx, x, y, 9, rgba('#f6f0ff', .78), 4, .1);
}
function pixelFrame(ctx, p, r) {
  steppedRect(ctx, 12, 12, W - 24, H - 24, p.panel, '#090f21', 8, 16);
  steppedRect(ctx, 24, 24, W - 48, H - 48, '', rgba(p.border, .58), 4, 12);
  steppedRect(ctx, 32, 32, W - 64, H - 64, '', rgba(p.accent, .22), 4, 8);
  const rand = random(113);
  for (let y = 60; y < H - 40; y += 44) for (const x of [20, W - 28]) {
    pixelRect(ctx, x, y, 8, 8, rgba(p.border, .25));
    if (rand() > .6) pixelRect(ctx, x, y + 12, 4, 16, rgba('#f2dbad', .18));
  }
  for (const [x, y] of [[44, 45], [W - 44, 45], [44, H - 45], [W - 44, H - 45]]) gem(ctx, x, y, 12, p.secondary, true);
  for (let i = 0; i < 15; i++) pixelRect(ctx, 88 + i * 61, H - 79, 8, 4, rgba(p.accent, .2));
  texture(ctx, 491, '#ead8b0', 1200, .035);
  clearWindow(ctx, r, true); silverEdge(ctx, r, mix(p.border, p.accent, .35), true);
}
function pixelEffects(ctx, p, r) {
  for (const [x, y, size] of [[r.x + 4, r.y + 116, 8], [r.right - 8, r.bottom - 91, 12], [r.right - 12, r.y + r.height * .45, 4]]) {
    pixelRect(ctx, x - size, y, size * 2 + 4, 4, rgba(p.accent, .62)); pixelRect(ctx, x, y - size, 4, size * 2 + 4, rgba(p.accent, .62));
  }
}
function monsterFrame(ctx, p, r) {
  rounded(ctx, 10, 10, W - 20, H - 20, 31, gradient(ctx, ['#eee8d2', p.panel, '#e7e4cf']));
  rounded(ctx, 18, 18, W - 36, H - 36, 24, '', mix(p.border, '#775f3c', .22), 4.5);
  rounded(ctx, 28, 28, W - 56, H - 56, 18, '', rgba('#fff9e5', .84), 1.5);
  texture(ctx, 608, '#927e50', 2200, .035);
  line(ctx, [[73, H - 105], [W - 73, H - 105]], rgba(p.border, .34), 1);
  for (const [x, y, sx, sy] of [[39, 40, 1, 1], [W - 39, H - 40, -1, -1]]) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
    line(ctx, [[0, 43], [0, 0], [43, 0]], rgba(p.border, .78), 1.5); circle(ctx, 10, 10, 2, p.accent); ctx.restore();
  }
  clearWindow(ctx, r); silverEdge(ctx, r, p.border);
}
function monsterEffects(ctx, p, r) {
  for (const [x, y, angle] of [[r.x + 6, r.bottom - 86, -.5], [r.right - 12, r.y + 105, .7]]) {
    petal(ctx, x, y, 8, angle, p.secondary, .48); star(ctx, x + 7, y - 21, 6, rgba('#fff7dc', .78), 4, .15);
  }
  circle(ctx, r.right - 4, r.bottom - 92, 2, rgba('#fcf2cf', .7));
}
function woodGrain(ctx, p, bounds, seed) {
  const rand = random(seed); ctx.save(); pathRect(ctx, bounds.x, bounds.y, bounds.width, bounds.height, 0); ctx.clip();
  ctx.fillStyle = gradient(ctx, [mix(p.border, '#d5b08b', .18), p.border, mix(p.border, '#372c28', .16)], bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height); ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  for (let i = 0; i < 60; i++) {
    const x = bounds.x + rand() * bounds.width, y = bounds.y + rand() * bounds.height;
    line(ctx, [[x, y], [x + (rand() - .5) * 12, y + 36 + rand() * 170]], rgba(i % 2 ? '#493126' : '#ebc699', .16), 1 + i % 2);
  }
  ctx.restore();
}
function farmFrame(ctx, p, r) {
  steppedRect(ctx, 12, 12, W - 24, H - 24, p.panel, '', 0, 12);
  for (const bounds of [{ x: 16, y: 16, width: 22, height: H - 32 }, { x: W - 38, y: 16, width: 22, height: H - 32 }, { x: 16, y: 16, width: W - 32, height: 22 }, { x: 16, y: H - 38, width: W - 32, height: 22 }]) woodGrain(ctx, p, bounds, 109 + bounds.x);
  for (const [x, y] of [[26, 27], [W - 27, 27], [26, H - 27], [W - 27, H - 27]]) { pixelRect(ctx, x - 2, y - 2, 4, 4, '#d6c3a2'); }
  texture(ctx, 719, '#8d7554', 2600, .041);
  sprig(ctx, W - 89, H - 114, 152, -.15, '#9c916d', '#c9af89', true);
  ctx.save(); ctx.translate(917, 83); ctx.rotate(-.15);
  circle(ctx, 0, 0, 32, '', rgba(p.accent, .45), 1.5); circle(ctx, 0, 0, 26, '', rgba(p.accent, .25), 1);
  sprig(ctx, 0, 14, 28, .1, '#9b8a62', '#9b8a62', true);
  for (let i = 0; i < 3; i++) line(ctx, [[-57, -9 + i * 9], [-33, -9 + i * 9]], rgba(p.accent, .3), 1.5);
  ctx.restore();
  clearWindow(ctx, r, true); silverEdge(ctx, r, '#c5b48c', true);
}
function farmEffects(ctx, p, r) {
  for (const [x, y] of [[r.x + 5, r.y + 157], [r.right - 7, r.bottom - 137]]) {
    pixelRect(ctx, x, y, 4, 4, rgba('#fff0c8', .7)); pixelRect(ctx, x + 8, y - 12, 4, 4, rgba(p.secondary, .62));
  }
  petal(ctx, r.right - 5, r.y + 85, 7, -.4, p.secondary, .45);
}
function duelFrame(ctx, p, r) {
  rounded(ctx, 10, 10, W - 20, H - 20, 24, gradient(ctx, ['#282335', p.base, '#191923']));
  rounded(ctx, 20, 20, W - 40, H - 40, 16, '', rgba(p.border, .72), 2.1);
  texture(ctx, 881, '#d6bb92', 2400, .035);
  for (const [x, y, sx, sy] of [[34, 35, 1, 1], [W - 34, 35, -1, 1], [34, H - 35, 1, -1], [W - 34, H - 35, -1, -1]]) engravedCorner(ctx, x, y, sx, sy, p.accent, 132);
  rounded(ctx, 73, r.bottom + 22, W - 146, H - r.bottom - 98, 4, gradient(ctx, ['#e5ddc5', p.panel, '#dacfaf']), rgba(p.border, .45), 1.4);
  texture(ctx, 341, '#816946', 750, .053, { x: 76, y: r.bottom + 24, width: W - 152, height: H - r.bottom - 104 });
  line(ctx, [[91, H - 135], [W - 91, H - 135]], rgba('#8d7552', .3), 1);
  clearWindow(ctx, r); silverEdge(ctx, r, p.border);
}
function duelEffects(ctx, p, r) {
  for (const [x, y, radius] of [[r.x + 3, r.y + 46, 8], [r.right - 3, r.bottom - 53, 11]]) {
    glow(ctx, x, y, 35, p.secondary, .05); star(ctx, x, y, radius, rgba('#e4d2b2', .7), 4, .12);
  }
  circle(ctx, r.right - 8, r.y + 119, 1.7, p.accent);
}

function backPaper(ctx, p, seed, base = p.base) {
  ctx.fillStyle = gradient(ctx, [mix(base, p.secondary, .045), base, mix(base, '#080c14', .1)]); ctx.fillRect(0, 0, W, H);
  texture(ctx, seed, '#efe6d0', 4300, .032);
  texture(ctx, seed + 71, '#05090e', 1600, .07);
  rounded(ctx, 22, 22, W - 44, H - 44, 18, '', rgba(p.border, .47), 1.5);
}
function quietBackCaption(ctx, title, p, family = SANS) {
  tinyText(ctx, title, 512, 1029, rgba(p.ink, .67), { size: 18, family });
  tinyText(ctx, 'STARCLOUDS  /  PRIVATE COLLECTION', 512, 1451, rgba(p.muted, .58), { size: 13, family });
}
function animeBack(ctx, p) {
  backPaper(ctx, p, 822);
  for (const [x, y, sx, sy] of [[37, 38, 1, 1], [W - 37, H - 38, -1, -1]]) engravedCorner(ctx, x, y, sx, sy, p.border, 102);
  glow(ctx, 512, 740, 270, p.accent, .047);
  ctx.save(); ctx.translate(512, 746);
  ctx.beginPath(); ctx.ellipse(0, 0, 125, 170, .24, .3, Math.PI * 1.88); ctx.strokeStyle = rgba(p.border, .5); ctx.lineWidth = 1.25; ctx.stroke();
  sprig(ctx, -43, 112, 218, .22, p.border, p.accent);
  sprig(ctx, 37, 100, 185, -.23, p.border, p.accent);
  blossom(ctx, 4, -30, 31, '#d7bad6'); star(ctx, 2, -113, 9, rgba('#dce9f6', .75), 4, .1);
  circle(ctx, 111, -114, 2, rgba(p.secondary, .62)); ctx.restore();
  quietBackCaption(ctx, 'NIGHT BLOOM', p, SERIF);
}
function pixelBack(ctx, p) {
  backPaper(ctx, p, 529);
  steppedRect(ctx, 34, 34, W - 68, H - 68, '', rgba(p.border, .4), 4, 12);
  for (const [x, y] of [[53, 54], [W - 53, 54], [53, H - 54], [W - 53, H - 54]]) gem(ctx, x, y, 10, p.secondary, true);
  for (let i = 0; i < 36; i++) {
    const angle = i / 36 * TAU;
    if (i % 3) pixelRect(ctx, 512 + Math.cos(angle) * 124, 734 + Math.sin(angle) * 174, 4, 4, rgba(p.accent, .3));
  }
  const tower = '#46516c';
  steppedRect(ctx, 449, 641, 128, 212, '', rgba(tower, .8), 4, 16);
  pixelRect(ctx, 465, 619, 16, 40, tower); pixelRect(ctx, 504, 611, 16, 44, tower); pixelRect(ctx, 544, 619, 16, 40, tower);
  gem(ctx, 512, 736, 48, p.secondary, true);
  line(ctx, [[427, 879], [597, 879]], rgba(p.accent, .54), 4);
  pixelRect(ctx, 502, 565, 24, 4, p.accent); pixelRect(ctx, 514, 553, 4, 28, p.accent);
  quietBackCaption(ctx, 'THE WAYFARER’S ARCHIVE', p, MONO);
}
function monsterBack(ctx, p) {
  backPaper(ctx, p, 319, '#254f49');
  const gold = '#d2b988';
  rounded(ctx, 34, 34, W - 68, H - 68, 12, '', rgba(gold, .42), 1);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU;
    circle(ctx, 512 + Math.cos(a) * 141, 750 + Math.sin(a) * 173, 1.5, rgba(gold, .43));
  }
  ctx.save(); ctx.translate(512, 752);
  ctx.beginPath(); ctx.ellipse(0, 0, 112, 146, 0, 0, TAU); ctx.strokeStyle = rgba(gold, .69); ctx.lineWidth = 1.4; ctx.stroke();
  sprig(ctx, -22, 91, 169, .15, '#a8c5af', '#cfc496');
  sprig(ctx, 23, 86, 143, -.22, '#a8c5af', '#cfc496');
  gem(ctx, 0, -23, 25, '#a3c8b6');
  line(ctx, [[-49, 114], [49, 114]], rgba(gold, .62), 1.3); ctx.restore();
  quietBackCaption(ctx, 'WONDER ATLAS', { ...p, ink: '#e8dcba', muted: '#a9bdb0' }, SERIF);
}
function farmBack(ctx, p) {
  backPaper(ctx, p, 710, '#655647');
  const rand = random(85);
  for (let i = 0; i < 92; i++) {
    const x = 35 + rand() * 954, y = 20 + rand() * 1496;
    line(ctx, [[x, y], [x + (rand() - .5) * 9, y + 25 + rand() * 100]], rgba('#c9b494', .065), 1.5);
  }
  steppedRect(ctx, 357, 568, 310, 372, '#e5d5b2', '', 0, 8);
  for (let x = 364; x < 665; x += 14) for (const y of [568, 940]) circle(ctx, x, y, 3, '#655647');
  for (let y = 579; y < 934; y += 14) for (const x of [357, 667]) circle(ctx, x, y, 3, '#655647');
  rounded(ctx, 380, 590, 264, 326, 0, '', rgba('#9b8864', .6), 2);
  sprig(ctx, 505, 849, 173, -.13, '#88946c', '#b89c6e', true);
  sprig(ctx, 526, 836, 135, .28, '#8f9167', '#c4aa79', true);
  tinyText(ctx, 'SPRING / I', 512, 889, '#958063', { size: 15, family: MONO });
  quietBackCaption(ctx, 'VALLEY MEMORIES', { ...p, ink: '#ddccaa', muted: '#b3a486' }, MONO);
}
function duelBack(ctx, p) {
  backPaper(ctx, p, 482, '#211d2a');
  for (const [x, y, sx, sy] of [[38, 40, 1, 1], [W - 38, 40, -1, 1], [38, H - 40, 1, -1], [W - 38, H - 40, -1, -1]]) engravedCorner(ctx, x, y, sx, sy, p.accent, 166);
  ctx.save(); ctx.translate(512, 750);
  for (let i = 0; i < 6; i++) {
    ctx.save(); ctx.rotate(i / 6 * TAU); ctx.beginPath(); ctx.moveTo(0, -33);
    ctx.bezierCurveTo(48, -65, 63, -123, 0, -151); ctx.bezierCurveTo(-63, -123, -48, -65, 0, -33);
    ctx.strokeStyle = rgba(p.accent, .57); ctx.lineWidth = 1.3; ctx.stroke();
    line(ctx, [[0, -82], [0, -137]], rgba(p.accent, .25), .8); circle(ctx, 0, -170, 1.5, rgba(p.accent, .67)); ctx.restore();
  }
  gem(ctx, 0, 0, 38, p.secondary); ctx.restore();
  quietBackCaption(ctx, 'ARCANA', { ...p, ink: '#c5b291', muted: '#8f7f70' }, SERIF);
}

const DRAWING = { W, H, TAU, SANS, SERIF, MONO, rgba, mix, random, pathRect, rounded, line, polygon, circle, star,
  gradient, glow, texture, pixelRect, steppedRect, clearWindow, silverEdge, tinyText, petal, blossom, sprig, engravedCorner,
  gem, fitText, paragraph, micro, title, getCardSkin, resolveCardDesign };
const STYLE_PACK = {
  dopamine: createDopamineDesign(DRAWING), pokemon: createPokemonDesign(DRAWING), arknights: createArknightsDesign(DRAWING),
  ocean: createOceanDesign(DRAWING),
};
const PAINTERS = {
  anime: [fallbackBackground, animeEffects, animeFrame, animeBack],
  pixel: [fallbackBackground, pixelEffects, pixelFrame, pixelBack],
  monster: [fallbackBackground, monsterEffects, monsterFrame, monsterBack],
  farm: [fallbackBackground, farmEffects, farmFrame, farmBack],
  duel: [fallbackBackground, duelEffects, duelFrame, duelBack],
  ...Object.fromEntries(Object.entries(STYLE_PACK).map(([id, design]) => [id, [design.background, design.effects, design.frame, design.back]])),
};
function paintCanvas(width, height, pixelated, draw) {
  const source = document.createElement('canvas'); source.width = pixelated ? 512 : width; source.height = pixelated ? 768 : height;
  const ctx = source.getContext('2d'); if (!ctx) throw new Error('无法创建卡面画布');
  ctx.scale(source.width / W, source.height / H); draw(ctx);
  if (source.width === width && source.height === height) return source;
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const target = output.getContext('2d'); if (!target) throw new Error('无法创建卡面画布');
  target.imageSmoothingEnabled = false; target.drawImage(source, 0, 0, width, height); source.width = 1; source.height = 1; return output;
}
export function createCardSkinCanvases(id, { accentColor = '', width = W, height = H } = {}) {
  const skin = getCardSkin(id);
  if (!skin || skin.id === 'astral' || !PAINTERS[skin.id]) return { background: null, effects: null, frame: null, back: null };
  const p = palette(skin, accentColor), r = artRect(skin), w = Math.max(1, Math.round(Number(width) || W)), h = Math.max(1, Math.round(Number(height) || H));
  return Object.fromEntries(['background', 'effects', 'frame', 'back'].map((role, i) => [role, paintCanvas(w, h, skin.pixelated, ctx => PAINTERS[skin.id][i](ctx, p, r))]));
}

function ellipsis(ctx, value, width) {
  const text = String(value ?? ''); if (ctx.measureText(text).width <= width) return text;
  const letters = Array.from(text);
  while (letters.length && ctx.measureText(`${letters.join('')}…`).width > width) letters.pop();
  return letters.length ? `${letters.join('')}…` : '';
}
function fitText(ctx, value, x, y, width, size, minimum, color, { family = SANS, weight = 500, align = 'left' } = {}) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' '); let actual = size;
  do { ctx.font = `${weight} ${actual}px ${family}`; if (ctx.measureText(text).width <= width) break; actual--; } while (actual >= minimum);
  ctx.font = `${weight} ${Math.max(minimum, actual)}px ${family}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(ellipsis(ctx, text, width), x, y);
}
function wrap(ctx, value, width) {
  const lines = [];
  for (const paragraph of String(value ?? '').split(/\r?\n/)) {
    let line = '';
    for (const token of paragraph.match(/[\u3400-\u9fff]|[^\S\n]+|[^\s\u3400-\u9fff]+/gu) || ['']) {
      if (ctx.measureText(line + token).width <= width) { line += token; continue; }
      if (line.trim()) lines.push(line.trimEnd()); line = token.trimStart();
      if (ctx.measureText(line).width > width) {
        const letters = Array.from(line); line = '';
        for (const letter of letters) { if (line && ctx.measureText(line + letter).width > width) { lines.push(line); line = ''; } line += letter; }
      }
    }
    if (line || !paragraph) lines.push(line.trimEnd());
  }
  return lines;
}
function paragraph(ctx, value, x, y, width, height, color, { size = 24, minimum = 20, family = SANS, leading = 1.4 } = {}) {
  let actual = size, lines, count;
  while (actual >= minimum) {
    ctx.font = `400 ${actual}px ${family}`; lines = wrap(ctx, value, width); count = Math.max(1, Math.floor(height / (actual * leading)));
    if (lines.length <= count || actual === minimum) break; actual--;
  }
  const truncated = lines.length > count; lines = lines.slice(0, count);
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(ellipsis(ctx, `${line}${truncated && i === count - 1 ? '…' : ''}`, width), x, y + i * actual * leading));
  ctx.textBaseline = 'alphabetic';
}
function micro(ctx, value, x, y, width, color, align = 'left', family = SANS) { fitText(ctx, value, x, y, width, 16, 12, color, { family, align, weight: 500 }); }
function title(ctx, value, x, y, width, size, color, family = SERIF) { fitText(ctx, value, x, y, width, size, 34, color, { family, weight: 600 }); }

export function drawCardSkinTypography(canvas, id, settings = {}) {
  const skin = getCardSkin(id); if (!skin || skin.id === 'astral' || !PAINTERS[skin.id]) return false;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建卡片文字');
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.scale(canvas.width / W, canvas.height / H);
  pathRect(ctx, 20, 20, W - 40, H - 40, 18); ctx.clip();
  const p = palette(skin, settings.accentColor), r = artRect(skin), defaults = skin.defaults || {};
  if (STYLE_PACK[skin.id]) {
    STYLE_PACK[skin.id].typography(ctx, p, r, { ...defaults, skinId: skin.id, ...settings });
    ctx.restore(); return true;
  }
  const v = (key, fallback = '') => String(settings[key] ?? defaults[key] ?? fallback);
  const name = v('title', '无题'), subtitle = v('subtitle'), ability = v('ability'), description = v('description'), level = v('level', '1');
  const microColor = skin.id === 'duel' ? '#b4a18b' : p.muted;

  if (skin.id === 'anime') {
    micro(ctx, v('collection'), 65, 44, 558, p.muted);
    micro(ctx, v('name'), 958, 44, 280, p.muted, 'right');
    title(ctx, name, 68, r.bottom + 71, 700, 64, p.ink);
    micro(ctx, v('rarity'), 956, r.bottom + 66, 120, p.border, 'right');
    micro(ctx, subtitle, 71, r.bottom + 112, 858, p.muted);
    fitText(ctx, ability, 71, r.bottom + 144, 515, 24, 20, p.ink, { weight: 500 });
    micro(ctx, `HP ${v('power')} · ATK ${v('attack')} · DEF ${v('defense')}`, 955, r.bottom + 144, 300, p.muted, 'right');
    paragraph(ctx, description, 71, r.bottom + 160, 868, H - 50 - r.bottom - 160, p.muted, { size: 24, minimum: 20, leading: 1.38 });
  } else if (skin.id === 'pixel') {
    micro(ctx, v('collection'), 80, 56, 515, p.muted, 'left', MONO);
    micro(ctx, `${v('rarity')} / ${v('element')}`, 941, 56, 290, p.accent, 'right', MONO);
    title(ctx, name, 80, 114, 702, 56, p.ink, MONO);
    micro(ctx, `LV ${level}`, 940, 114, 122, p.accent, 'right', MONO);
    fitText(ctx, ability, 80, r.bottom + 63, 864, 26, 20, p.ink, { family: MONO, weight: 600 });
    micro(ctx, subtitle, 81, r.bottom + 99, 852, p.muted, 'left', MONO);
    paragraph(ctx, description, 81, r.bottom + 122, 850, H - 155 - r.bottom - 122, p.muted, { size: 24, minimum: 20, family: MONO });
    micro(ctx, `HP ${v('power')}    ATK ${v('attack')}    DEF ${v('defense')}`, 82, H - 95, 850, p.accent, 'left', MONO);
  } else if (skin.id === 'monster') {
    micro(ctx, v('collection'), 76, 62, 580, p.muted);
    micro(ctx, v('rarity'), 945, 62, 200, '#8b7851', 'right');
    title(ctx, name, 75, 123, 551, 54, p.ink, SANS);
    fitText(ctx, `HP ${v('power')}`, 902, 122, 204, 26, 20, p.ink, { align: 'right', weight: 600 });
    circle(ctx, 945, 109, 17, rgba(p.accent, .13), rgba(p.border, .85), 1.2); star(ctx, 945, 109, 8, p.accent, 6, .53);
    micro(ctx, subtitle, 77, 155, 580, p.muted);
    micro(ctx, `${v('element')} · LV.${level}`, 944, 155, 230, p.muted, 'right');
    fitText(ctx, ability, 79, r.bottom + 64, 643, 26, 20, p.ink, { weight: 600 });
    fitText(ctx, v('attack'), 944, r.bottom + 64, 149, 26, 20, p.ink, { align: 'right', weight: 600 });
    paragraph(ctx, description, 79, r.bottom + 91, 861, H - 157 - r.bottom - 91, '#69775f', { size: 24, minimum: 20 });
    micro(ctx, `${v('element')}属性  ·  防御 ${v('defense')}  ·  ${v('rarity')}`, 80, H - 76, 850, p.muted);
  } else if (skin.id === 'farm') {
    micro(ctx, `${v('collection')}  /  ${v('name')}`, 77, 54, 744, p.muted, 'left', MONO);
    micro(ctx, `${v('element')}  ·  LV ${level}  ·  ${v('rarity')}`, 77, 103, 695, p.ink, 'left', MONO);
    title(ctx, name, 78, r.bottom + 79, 785, 62, p.ink);
    micro(ctx, subtitle, 81, r.bottom + 115, 787, p.muted, 'left', MONO);
    fitText(ctx, ability, 81, r.bottom + 151, 785, 24, 20, p.ink, { family: SERIF, weight: 600 });
    paragraph(ctx, description, 81, r.bottom + 167, 785, H - 89 - r.bottom - 167, '#8c7b65', { size: 24, minimum: 20, family: SERIF });
    micro(ctx, `收成 ${v('power')}    耕作 ${v('attack')}    活力 ${v('defense')}`, 81, H - 64, 783, p.muted, 'left', MONO);
  } else {
    micro(ctx, v('collection'), 88, 59, 682, '#a99a8b');
    micro(ctx, v('rarity'), 945, 59, 128, p.accent, 'right');
    title(ctx, name, 88, 136, 727, 56, '#dbc599');
    gem(ctx, 920, 115, 24, p.secondary);
    micro(ctx, subtitle, 91, 177, 751, '#a9a0b3');
    micro(ctx, `${v('element')} / LV.${level}`, 91, 221, 350, '#bca78b');
    const count = Math.max(1, Math.min(12, parseInt(level, 10) || 1));
    for (let i = 0; i < count; i++) star(ctx, 928 - i * 31, 216, 9, '#d8bd88', 5, .43);
    micro(ctx, `【${v('element')} / ${v('rarity')}】`, 94, r.bottom + 48, 805, '#8e7957');
    fitText(ctx, ability, 94, r.bottom + 80, 820, 26, 20, p.ink, { family: SERIF, weight: 600 });
    paragraph(ctx, description, 95, r.bottom + 101, 829, H - 167 - r.bottom - 101, '#8a7a62', { size: 24, minimum: 20, family: SERIF });
    micro(ctx, `PWR ${v('power')}`, 96, H - 109, 188, '#806d51');
    fitText(ctx, `ATK / ${v('attack')}    DEF / ${v('defense')}`, 929, H - 109, 567, 24, 18, p.ink, { family: SERIF, weight: 500, align: 'right' });
  }

  const footerY = H - 27;
  micro(ctx, `No.${v('number')}  ·  ${v('edition')}`, 73, footerY, 453, microColor, 'left', skin.pixelated ? MONO : SANS);
  micro(ctx, skin.id === 'anime' ? `${v('element')} · LV ${level}` : v('name'), W - 73, footerY, 343, microColor, 'right', skin.pixelated ? MONO : SANS);
  ctx.restore(); return true;
}

// Matching skins keep the original path. Mixed layouts composite a quiet piece
// of their own stock behind the type, without ever erasing glyphs or artwork.
export function drawCardSkinTextBacking(canvas, id, settings = {}) {
  const skin = getCardSkin(id); if (!skin || (skin.id !== 'astral' && !PAINTERS[skin.id])) return false;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建卡片文字底板');
  const p = palette(skin, settings.accentColor);
  let areas;
  if (skin.fullArt) {
    const art = resolveCardDesign(settings).artworkRect;
    const topEnd = Math.min(130, art.y * H - 12), bottomStart = Math.max(1120, (art.y + art.height) * H + 12);
    areas = [[50, 50, W - 100, topEnd - 50], [50, bottomStart, W - 100, 1490 - bottomStart]];
  } else {
    const r = artRect(skin);
    areas = [[50, 30, W - 100, r.y - 40], [50, r.bottom + 10, W - 100, H - r.bottom - 20]];
  }
  areas = areas.filter(([, , width, height]) => width > 0 && height > 0); if (!areas.length) return false;
  const backing = skin.fullArt ? null : paintCanvas(canvas.width, canvas.height, skin.pixelated, panel => PAINTERS[skin.id][2](panel, p, artRect(skin)));
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(canvas.width / W, canvas.height / H);
    ctx.beginPath(); areas.forEach(([x, y, width, height]) => ctx.rect(x, y, width, height)); ctx.clip(); ctx.globalCompositeOperation = 'destination-over';
    if (backing) ctx.drawImage(backing, 0, 0, W, H);
    else areas.forEach(([x, y, width, height]) => rounded(ctx, x, y, width, height, 12, p.panel));
  } finally { ctx.restore(); if (backing) { backing.width = 1; backing.height = 1; } }
  return true;
}
