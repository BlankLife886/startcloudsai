// Original code-native print design. The portrait is an existing PNG and is never edited here.
export const ASTRAL_SAMPLE = Object.freeze({
  title: '星间旅人', subtitle: '循光而行 · 万象入梦', name: 'ASTRAL TRAVELER', number: '001',
  collection: 'STARCLOUDS / PORTRAIT COLLECTION', edition: '001 / 001',
  width: 1024, height: 1536,
  assets: {
    subject: '/holo-samples/astral-v1/subject.png',
    background: '/holo-samples/astral-v1/background.png',
    effects: '/holo-samples/astral-v1/effects.png',
  },
});

function canvas() {
  const value = document.createElement('canvas');
  value.width = ASTRAL_SAMPLE.width; value.height = ASTRAL_SAMPLE.height;
  return value;
}

function star(ctx, x, y, radius, color, alpha = 1) {
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -radius);
  ctx.bezierCurveTo(radius * .16, -radius * .16, radius * .16, -radius * .16, radius, 0);
  ctx.bezierCurveTo(radius * .16, radius * .16, radius * .16, radius * .16, 0, radius);
  ctx.bezierCurveTo(-radius * .16, radius * .16, -radius * .16, radius * .16, -radius, 0);
  ctx.bezierCurveTo(-radius * .16, -radius * .16, -radius * .16, -radius * .16, 0, -radius);
  ctx.fill(); ctx.restore();
}

function seedRandom(seed) {
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
}

export function createAstralDesignLayers() {
  const background = canvas(), effects = canvas();
  const ctx = background.getContext('2d');
  const fx = effects.getContext('2d');
  const rand = seedRandom(1909);
  const ink = ctx.createLinearGradient(0, 0, 1024, 1536);
  ink.addColorStop(0, '#192638'); ink.addColorStop(.38, '#2d243d');
  ink.addColorStop(.74, '#192b35'); ink.addColorStop(1, '#101621');
  ctx.fillStyle = ink; ctx.fillRect(0, 0, 1024, 1536);

  // A restrained luminous medallion sits behind the portrait, without duplicating it.
  const halo = ctx.createRadialGradient(512, 472, 50, 512, 472, 465);
  halo.addColorStop(0, 'rgba(128,140,155,.18)'); halo.addColorStop(.58, 'rgba(101,113,129,.06)'); halo.addColorStop(1, 'rgba(50,60,80,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, 1024, 1050);

  ctx.strokeStyle = 'rgba(203,175,113,.38)'; ctx.lineWidth = 1.3;
  for (const r of [323, 337, 350]) { ctx.beginPath(); ctx.arc(512, 485, r, 0, Math.PI * 2); ctx.stroke(); }
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * Math.PI * 2;
    const outer = i % 8 === 0 ? 351 : 345;
    ctx.beginPath(); ctx.moveTo(512 + Math.cos(a) * 337, 485 + Math.sin(a) * 337);
    ctx.lineTo(512 + Math.cos(a) * outer, 485 + Math.sin(a) * outer); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(150,178,177,.15)'; ctx.lineWidth = 1;
  for (const [angle, rx, ry] of [[-.52, 415, 595], [.52, 415, 595]]) {
    ctx.beginPath(); ctx.ellipse(512, 702, rx, ry, angle, 0, Math.PI * 2); ctx.stroke();
  }
  // Decorative corner engravings and a quiet central field protect the subject's readability.
  ctx.strokeStyle = 'rgba(210,185,137,.48)'; ctx.lineWidth = 1.4;
  for (const [x, y, sx, sy] of [[64, 150, 1, 1], [960, 150, -1, 1], [64, 1386, 1, -1], [960, 1386, -1, -1]]) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
    ctx.beginPath(); ctx.moveTo(0, 126); ctx.lineTo(0, 0); ctx.lineTo(126, 0);
    ctx.moveTo(13, 104); ctx.lineTo(13, 13); ctx.lineTo(104, 13); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI / 2); ctx.stroke();
    star(ctx, 33, 33, 8, '#cdb888', .65); ctx.restore();
  }
  for (let i = 0; i < 470; i++) {
    const x = rand() * 1024, y = 160 + rand() * 1190;
    if (x > 250 && x < 774 && y > 240 && y < 1190) continue;
    ctx.globalAlpha = .1 + rand() * .35; ctx.fillStyle = i % 3 ? '#c1cad5' : '#d6c29a';
    ctx.beginPath(); ctx.arc(x, y, .45 + rand() * 1.35, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const backStars = [[116, 332, 10], [851, 240, 8], [883, 970, 11], [169, 1040, 8], [786, 1220, 7], [97, 728, 7]];
  for (const [x, y, radius] of backStars) star(ctx, x, y, radius, '#d5c6a6', .48);
  ctx.strokeStyle = 'rgba(210,185,137,.22)'; ctx.lineWidth = .9;
  ctx.beginPath(); ctx.moveTo(116, 332); ctx.lineTo(159, 498); ctx.lineTo(97, 728); ctx.lineTo(169, 1040); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(851, 240); ctx.lineTo(917, 564); ctx.lineTo(883, 970); ctx.lineTo(786, 1220); ctx.stroke();

  // Foreground is a transparent design plate, independent of both portrait and typography.
  const frontStars = [[160, 409, 16], [862, 388, 21], [112, 881, 15], [917, 819, 12], [238, 1122, 17], [806, 1090, 20], [383, 972, 9], [713, 254, 11]];
  for (const [x, y, radius] of frontStars) {
    const glow = fx.createRadialGradient(x, y, 0, x, y, radius * 3.5);
    glow.addColorStop(0, 'rgba(231,200,135,.2)'); glow.addColorStop(1, 'rgba(231,200,135,0)');
    fx.fillStyle = glow; fx.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8);
    star(fx, x, y, radius, '#edddb7', .85);
    star(fx, x, y, radius * .38, '#fff9e8');
  }
  for (let i = 0; i < 45; i++) {
    const x = rand() < .5 ? 85 + rand() * 180 : 755 + rand() * 180;
    const y = 260 + rand() * 900;
    fx.globalAlpha = .2 + rand() * .65; fx.fillStyle = '#e7d8b9';
    fx.beginPath(); fx.arc(x, y, .6 + rand() * 1.9, 0, Math.PI * 2); fx.fill();
  }
  fx.globalAlpha = 1;
  return { background, effects };
}
