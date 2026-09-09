// Original paper-cut and jelly-sticker artwork. The uploaded character remains
// an independent texture; this module never paints or alters that image.
export function createDopamineDesign(h) {
  const { W, H, TAU, SANS, MONO, rgba, mix, rounded, line, polygon, circle, star, gradient, texture, clearWindow, fitText, paragraph, micro, tinyText } = h;
  const cream = '#fff7e9';

  function halftone(ctx, x, y, width, height, color, spacing = 15, radius = 2) {
    ctx.fillStyle = color;
    for (let row = 0, yy = y; yy < y + height; yy += spacing, row++) {
      for (let xx = x + row % 2 * spacing / 2; xx < x + width; xx += spacing) {
        ctx.beginPath(); ctx.arc(xx, yy, radius, 0, TAU); ctx.fill();
      }
    }
  }

  function jellyDisc(ctx, x, y, radius, color, outline = false) {
    ctx.save();
    ctx.shadowColor = 'rgba(40,34,63,.10)'; ctx.shadowBlur = 23; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 13;
    circle(ctx, x, y, radius, gradient(ctx, [mix(color, '#ffffff', .21), color, mix(color, '#34253e', .055)], x - radius, y - radius, x + radius, y + radius), outline ? '#fffdf8' : '', outline ? 10 : 1);
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.arc(x, y, radius - 14, Math.PI * 1.16, Math.PI * 1.67);
    ctx.strokeStyle = 'rgba(255,255,255,.52)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, radius - 7, Math.PI * .12, Math.PI * .37);
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  function stickerStar(ctx, x, y, radius, color, angle = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.shadowColor = 'rgba(40,34,63,.11)'; ctx.shadowBlur = 19; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 8;
    star(ctx, 0, 0, radius + 7, '#fffdf8', 5, .53);
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    star(ctx, 0, 0, radius, color, 5, .53);
    line(ctx, [[-radius * .18, -radius * .24], [0, -radius * .73], [radius * .16, -radius * .31]], 'rgba(255,255,255,.48)', 2);
    ctx.restore();
  }

  function sketchLoop(ctx, x, y, color) {
    ctx.save(); ctx.translate(x, y); ctx.beginPath();
    ctx.moveTo(0, 69); ctx.bezierCurveTo(67, 36, 73, -45, 28, -41);
    ctx.bezierCurveTo(-12, -37, -4, 21, 77, 16);
    ctx.bezierCurveTo(139, 12, 104, -61, 65, -71);
    ctx.strokeStyle = color; ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore();
  }

  function background(ctx, p, r) {
    ctx.fillStyle = gradient(ctx, ['#fff9ee', cream, '#fff0e3']); ctx.fillRect(0, 0, W, H);

    // Three cropped color fields surround a quiet central portrait space.
    jellyDisc(ctx, W + 46, r.y + 275, 402, p.secondary);
    jellyDisc(ctx, -88, r.bottom - 179, 328, p.base);
    ctx.save(); ctx.translate(W - 31, r.bottom + 98); ctx.rotate(-.28);
    rounded(ctx, -160, -253, 352, 530, 176, gradient(ctx, [mix(p.accent, '#ffffff', .12), p.accent], -140, -220, 150, 210));
    ctx.restore();

    // A printed screen inside the blue cutout gives it a material scale.
    ctx.save(); ctx.beginPath(); ctx.arc(W + 46, r.y + 275, 394, 0, TAU); ctx.clip();
    halftone(ctx, W - 254, r.y + 79, 298, 470, rgba('#fffaf2', .16), 17, 2.1);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(-88, r.bottom - 179, 320, 0, TAU); ctx.clip();
    halftone(ctx, 9, r.bottom - 261, 235, 235, rgba(p.border, .11), 15, 1.65);
    ctx.restore();

    sketchLoop(ctx, r.x + 13, r.y + 387, rgba(p.border, .34));
    line(ctx, [[r.x + 59, r.y + 433], [r.x + 77, r.y + 445], [r.x + 61, r.y + 452]], rgba(p.border, .34), 2);
    circle(ctx, r.x + 173, r.y + 261, 8, '', rgba(p.accent, .7), 2);
    star(ctx, r.x + 103, r.y + 147, 17, p.secondary, 4, .15);
    texture(ctx, 726, '#766575', 3400, .035);
  }

  function frame(ctx, p, r) {
    rounded(ctx, 10, 10, W - 20, H - 20, 30, cream);
    rounded(ctx, 22, 22, W - 44, H - 44, 21, '', rgba(p.border, .22), 1.5);
    texture(ctx, 338, '#877081', 2400, .032);

    // A small offset label and a folded corner make the stock feel collected.
    ctx.save(); ctx.translate(W - 116, r.bottom + 55); ctx.rotate(-.07);
    ctx.shadowColor = 'rgba(40,34,63,.10)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 4;
    rounded(ctx, -73, -30, 146, 60, 19, '#fffdf8');
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    rounded(ctx, -68, -25, 136, 50, 15, p.secondary);
    line(ctx, [[-48, -18], [28, -18]], 'rgba(255,255,255,.37)', 1.5);
    ctx.restore();

    polygon(ctx, [[W - 80, H - 24], [W - 24, H - 80], [W - 24, H - 24]], mix(p.base, '#ffffff', .13));
    line(ctx, [[W - 80, H - 24], [W - 24, H - 80]], rgba(p.border, .19), 1.2);
    line(ctx, [[82, r.bottom + 110], [158, r.bottom + 110]], p.accent, 4);
    halftone(ctx, 28, r.y + 49, 24, 164, rgba(p.secondary, .24), 10, 1.3);
    for (let i = 0; i < 3; i++) circle(ctx, W - 34, r.bottom - 192 + i * 13, 2, rgba(p.border, .31));
    line(ctx, [[83, 105], [105, 105]], p.secondary, 2);

    clearWindow(ctx, r);
    rounded(ctx, r.x - 3, r.y - 3, r.width + 6, r.height + 6, 10, '', rgba(p.border, .34), 2);
  }

  function effects(ctx, p, r) {
    // The clear center is deliberate: the character carries this composition.
    stickerStar(ctx, r.right - 7, r.y + 110, 19, p.base, .14);
    star(ctx, r.x + 3, r.bottom - 101, 21, rgba(p.accent, .89), 4, .19);
    star(ctx, r.x + 3, r.bottom - 101, 10, '#fffaf2', 4, .12);
    ctx.save(); ctx.translate(r.right - 13, r.bottom - 195); ctx.rotate(.27);
    rounded(ctx, -5, -19, 10, 38, 5, rgba(p.secondary, .8));
    ctx.restore();
    circle(ctx, r.x + 13, r.y + 204, 4, rgba(p.secondary, .78));
  }

  function smileSticker(ctx, x, y, radius, p) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.1);
    jellyDisc(ctx, 0, 0, radius, p.base, true);
    rounded(ctx, -66, -50, 15, 38, 8, p.ink);
    ctx.beginPath(); ctx.moveTo(38, -24); ctx.quadraticCurveTo(56, -43, 73, -24);
    ctx.strokeStyle = p.ink; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 13, 73, Math.PI * .15, Math.PI * .85);
    ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = rgba(p.accent, .26);
    ctx.beginPath(); ctx.ellipse(-103, 30, 23, 11, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(103, 30, 23, 11, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function back(ctx, p) {
    ctx.fillStyle = gradient(ctx, [cream, '#fff7f1', '#fff0e2']); ctx.fillRect(0, 0, W, H);
    rounded(ctx, 22, 22, W - 44, H - 44, 22, '', rgba(p.border, .18), 1.5);

    ctx.save(); ctx.translate(91, 205); ctx.rotate(-.22);
    rounded(ctx, -124, -247, 257, 924, 124, p.secondary); ctx.restore();
    ctx.save(); ctx.translate(W - 62, H - 185); ctx.rotate(.28);
    rounded(ctx, -131, -357, 284, 737, 141, p.accent); ctx.restore();
    halftone(ctx, 701, 230, 180, 184, rgba(p.border, .15), 15, 2);
    texture(ctx, 904, '#7c6f72', 3200, .036);

    ctx.save(); ctx.translate(697, 814); ctx.rotate(.21);
    ctx.shadowColor = 'rgba(40,34,63,.1)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
    rounded(ctx, -66, -156, 132, 312, 64, '#fffdf8');
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    rounded(ctx, -58, -148, 116, 296, 58, p.secondary);
    line(ctx, [[-36, -101], [-36, 56]], 'rgba(255,255,255,.41)', 3); ctx.restore();
    stickerStar(ctx, 675, 561, 116, p.accent, .17);
    smileSticker(ctx, 458, 775, 184, p);
    stickerStar(ctx, 321, 1018, 44, p.secondary, -.18);

    sketchLoop(ctx, 659, 1075, rgba(p.border, .4));
    circle(ctx, 363, 485, 13, '', rgba(p.border, .52), 2.4);
    star(ctx, 432, 427, 20, p.secondary, 4, .15);
    line(ctx, [[238, 631], [215, 621]], p.accent, 4);
    line(ctx, [[249, 600], [231, 580]], p.accent, 4);
    tinyText(ctx, 'STARCLOUDS', 512, 1420, rgba(p.ink, .59), { size: 17, family: MONO });
  }

  function typography(ctx, p, r, values = {}) {
    const v = (key, fallback = '') => String(values[key] ?? fallback);
    micro(ctx, v('collection'), 83, 64, 553, p.ink, 'left', MONO);
    micro(ctx, v('name'), 943, 64, 251, p.muted, 'right', MONO);
    micro(ctx, `${v('element')} · LV.${v('level', '1')}`, 119, 112, 456, p.muted, 'left', MONO);
    micro(ctx, v('edition'), 943, 112, 302, p.muted, 'right', MONO);

    fitText(ctx, v('title', '快乐超频'), 80, r.bottom + 90, 730, 76, 36, p.ink, { family: SANS, weight: 900 });
    fitText(ctx, v('rarity'), W - 116, r.bottom + 62, 107, 18, 12, '#fffaf1', { family: MONO, weight: 700, align: 'center' });
    micro(ctx, v('subtitle'), 84, r.bottom + 143, 854, p.secondary, 'left', MONO);
    fitText(ctx, v('ability'), 84, r.bottom + 190, 853, 25, 20, p.ink, { family: SANS, weight: 600 });
    paragraph(ctx, v('description'), 84, r.bottom + 212, 854, H - r.bottom - 277, p.muted, { size: 24, minimum: 20, family: SANS, leading: 1.4 });

    micro(ctx, `No.${v('number')} / ${v('edition')}`, 82, H - 29, 443, p.muted, 'left', MONO);
    micro(ctx, `HP ${v('power')} · ATK ${v('attack')} · DEF ${v('defense')}`, W - 82, H - 29, 356, p.muted, 'right', MONO);
  }

  return { background, effects, frame, back, typography };
}
