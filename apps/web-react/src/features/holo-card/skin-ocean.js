import { createOceanArtwork } from './skin-ocean-art.js';

export function createOceanDesign(h) {
  const { W, H, SANS, SERIF, rgba, rounded, line, circle, star, gradient, glow } = h;

  function trackedText(ctx, value, x, y, gap, align, width, size, color, family = SANS, weight = 500) {
    const characters = [...String(value ?? '')];
    const font = actual => weight + ' ' + actual + 'px ' + family;
    let actual = size, spacing = gap;
    const measure = letters => letters.reduce((sum, letter) => sum + ctx.measureText(letter).width, 0) + Math.max(0, letters.length - 1) * spacing;
    ctx.font = font(actual);
    while (measure(characters) > width && actual > 12) {
      actual--; spacing = gap * actual / size; ctx.font = font(actual);
    }
    if (measure(characters) > width) {
      while (characters.length && measure([...characters, '…']) > width) characters.pop();
      if (characters.length) characters.push('…');
    }
    const measured = measure(characters);
    let offset = x - (align === 'center' ? measured / 2 : align === 'right' ? measured : 0);
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (const character of characters) {
      ctx.fillText(character, offset, y); offset += ctx.measureText(character).width + spacing;
    }
  }

  function title(ctx, value, color) {
    const characters = [...String(value ?? '').slice(0, 64)];
    if (characters.length <= 18) {
      trackedText(ctx, characters.join(''), 512, 1298, 12, 'center', 870, 113, color, SERIF);
      return;
    }
    let size = 62, lines = [];
    for (; size >= 24; size -= 2) {
      ctx.font = '500 ' + size + 'px ' + SERIF; lines = [''];
      for (const character of characters) {
        const candidate = lines.at(-1) + character;
        if (lines.at(-1) && ctx.measureText(candidate).width + Math.max(0, [...candidate].length - 1) * 2 > 870) lines.push(character);
        else lines[lines.length - 1] = candidate;
      }
      if (lines.length <= 2) break;
    }
    lines.forEach((text, index) => trackedText(ctx, text, 512, 1298 - (lines.length - 1 - index) * size * 1.13, 2, 'center', 870, size, color, SERIF));
  }

  function tideCorner(ctx, x, y, sx, sy, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
    ctx.beginPath(); ctx.moveTo(0, 79); ctx.bezierCurveTo(3, 56, 32, 49, 34, 27);
    ctx.bezierCurveTo(34, 6, 10, 12, 17, 26); ctx.bezierCurveTo(22, 37, 43, 31, 66, 1);
    ctx.strokeStyle = rgba(color, .52); ctx.lineWidth = 1.15; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 79); ctx.bezierCurveTo(11, 57, 51, 43, 69, 7);
    ctx.strokeStyle = rgba(color, .23); ctx.lineWidth = .8; ctx.stroke();
    circle(ctx, 12, 9, 1.6, rgba('#e8fbff', .65)); ctx.restore();
  }

  function frame(ctx, p, r) {
    ctx.save();
    // Direct strokes on transparency keep the original full-bleed composition.
    rounded(ctx, 12, 12, W - 24, H - 24, 27, '', gradient(ctx,
      [rgba('#efffff', .8), rgba(p.border, .57), rgba('#609cb8', .46), rgba('#dff6fa', .7)], 0, 0, W, H), 1.9);
    rounded(ctx, 25, 25, W - 50, H - 50, 17, '', rgba(p.border, .32), 1);
    tideCorner(ctx, 42, 43, 1, 1, p.border);
    tideCorner(ctx, W - 42, H - 43, -1, -1, p.border);
    for (const [x, y] of [[15, 309], [W - 14, 1001]]) {
      star(ctx, x, y, 6, rgba('#edffff', .75), 4, .1);
      line(ctx, [[x, y - 26], [x, y - 10]], rgba(p.secondary, .26), .7);
    }
    ctx.restore();
  }

  function bubble(ctx, x, y, radius) {
    circle(ctx, x, y, radius, 'rgba(213,246,255,.035)', 'rgba(176,230,247,.31)', .8);
    ctx.beginPath(); ctx.arc(x, y, radius * .78, Math.PI * 1.06, Math.PI * 1.57);
    ctx.strokeStyle = 'rgba(240,255,255,.71)'; ctx.lineWidth = .9; ctx.stroke();
    circle(ctx, x - radius * .29, y - radius * .31, Math.max(.7, radius * .12), 'rgba(250,255,255,.65)');
  }

  function effects(ctx, p, r) {
    ctx.save();
    for (const [x, y, radius] of [[40, 324, 5], [W - 41, 475, 7], [45, 934, 4.3], [W - 43, 1117, 5.5]]) {
      bubble(ctx, x, y, radius); bubble(ctx, x + (x < W / 2 ? 7 : -7), y - 27, radius * .35);
    }
    for (const [x, y, radius] of [[35, 238, 7], [W - 34, 613, 6], [38, 1038, 5], [W - 36, 1199, 8]]) {
      glow(ctx, x, y, radius * 5, p.secondary, .036);
      star(ctx, x, y, radius, 'rgba(230,254,255,.8)', 4, .1);
    }
    ctx.restore();
  }

  function typography(ctx, p, r, values = {}) {
    const v = (key, fallback = '') => String(values[key] ?? fallback);
    ctx.save();
    trackedText(ctx, v('name', 'TIDAL DREAMER'), 76, 92, 6.5, 'left', 720, 19, p.muted);
    trackedText(ctx, 'NO. ' + v('number', '010'), 948, 92, 3, 'right', 130, 18, p.muted, SANS, 400);
    line(ctx, [[76, 118], [948, 118]], rgba(p.border, .36), 1);
    ctx.shadowColor = 'rgba(2,22,43,.8)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    const ink = gradient(ctx, ['#f5fcff', p.ink, '#b9e0ed'], 0, 1210, 0, 1410);
    title(ctx, v('title', '海洋之心'), ink);
    ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    trackedText(ctx, v('subtitle', 'WHERE THE LIGHT MEETS THE DEEP'), 512, 1354, 3, 'center', 872, 23, '#d4e9f1', SERIF, 400);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    line(ctx, [[76, 1412], [948, 1412]], rgba(p.border, .41), 1);
    trackedText(ctx, v('collection', 'OCEAN / JEWEL COLLECTION'), 76, 1451, 3.4, 'left', 652, 15, p.muted);
    trackedText(ctx, v('edition', 'SAPPHIRE EDITION'), 948, 1451, 2.5, 'right', 180, 15, p.muted);
    ctx.restore();
  }

  return { ...createOceanArtwork(h), frame, effects, typography };
}
