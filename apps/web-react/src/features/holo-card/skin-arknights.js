export function createArknightsDesign(h) {
  const { W, H, SANS, MONO, rgba, random, pathRect, rounded, line, polygon,
    circle, gradient, glow, texture, clearWindow, fitText, paragraph, tinyText, micro } = h;
  const paper = '#e9e9e3', white = '#f4f4ed', black = '#171c22';

  function grid(ctx, step, color, bounds = { x: 0, y: 0, width: W, height: H }) {
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += step)
      line(ctx, [[x, bounds.y], [x, bounds.y + bounds.height]], color, .7);
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += step)
      line(ctx, [[bounds.x, y], [bounds.x + bounds.width, y]], color, .7);
  }

  function barcode(ctx, value, x, y, width, height, color) {
    let seed = 1909;
    for (const character of String(value)) seed = Math.imul(seed ^ character.codePointAt(0), 16777619) >>> 0;
    const rand = random(seed); ctx.fillStyle = color;
    for (let offset = 0; offset < width - 5;) {
      const bar = rand() > .68 ? 4 : rand() > .5 ? 2 : 1;
      ctx.fillRect(x + offset, y, bar, height - (rand() > .8 ? 6 : 0)); offset += bar + 2 + Math.floor(rand() * 3);
    }
  }

  function islandMark(ctx, x, y, scale, ink, ground) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    polygon(ctx, [[0, -246], [250, 190], [-250, 190]], '', ink, 9);
    polygon(ctx, [[-171, 111], [-132, 158], [130, 158], [174, 111]], ink);
    polygon(ctx, [[-32, 110], [-32, -111], [-13, -135], [13, -135], [32, -111], [32, 110]], ink);
    polygon(ctx, [[-108, 110], [-108, -20], [-76, -54], [-44, -20], [-44, 110]], ink);
    polygon(ctx, [[44, 110], [44, -53], [80, -84], [112, -53], [112, 110]], ink);
    for (const [xx, yy, height] of [[-17, -86, 103], [-89, -7, 61], [63, -43, 94]])
      rounded(ctx, xx, yy, 12, height, 0, ground);
    line(ctx, [[-138, 131], [139, 131]], ground, 5);
    line(ctx, [[-196, 206], [-99, 206]], ink, 3); line(ctx, [[99, 206], [196, 206]], ink, 3);
    ctx.restore();
  }

  function cityBlock(ctx, x, y, width, height, p, seed, pale = false) {
    const rand = random(seed), face = pale ? '#56646c' : '#283640', side = pale ? '#48565f' : '#17242e';
    polygon(ctx, [[x + 14, y], [x + width - 30, y], [x + width, y + 30], [x + width, y + height - 45],
      [x + width - 60, y + height], [x, y + height], [x, y + 17]], face);
    polygon(ctx, [[x + width - 30, y], [x + width + 24, y + 23], [x + width + 24, y + height - 68],
      [x + width - 60, y + height], [x + width, y + height - 45], [x + width, y + 30]], side);
    for (let floor = 28; floor < height - 30; floor += 26) {
      line(ctx, [[x + 11, y + floor], [x + width - 12, y + floor]], rgba('#c4d0d0', pale ? .08 : .12), 1);
      for (let col = 16; col < width - 22; col += 20) {
        const lit = rand() > .91;
        ctx.fillStyle = lit ? rgba(p.accent, .35 + rand() * .35) : rgba('#101b24', .48);
        ctx.fillRect(x + col, y + floor + 8, lit ? 8 : 9, 5);
      }
    }
    for (const offset of [.12, .72]) {
      const xx = x + width * offset;
      line(ctx, [[xx, y + 17], [xx, y + height - 12]], rgba('#b0bdc3', .2), 2);
      line(ctx, [[xx + 4, y + 17], [xx + 4, y + height - 12]], rgba('#0b1620', .7), 2);
    }
    line(ctx, [[x + 35, y], [x + 35, y - 51]], '#40505b', 3);
    line(ctx, [[x + 25, y - 36], [x + 73, y - 36]], '#40505b', 2);
    ctx.fillStyle = rgba(p.accent, .75); ctx.fillRect(x + 33, y - 54, 4, 4);
  }

  function mineral(ctx, x, y, width, height, lean, p) {
    polygon(ctx, [[x, y], [x + lean - width * .2, y - height], [x + lean + width * .24, y - height - 24],
      [x + width, y - height * .32], [x + width * .8, y + 12]], '#17212b');
    polygon(ctx, [[x, y], [x + lean - width * .2, y - height], [x + lean + 3, y - height * .9], [x + width * .36, y]], '#313d48');
    line(ctx, [[x + lean + width * .24, y - height - 24], [x + width * .51, y - 10]], rgba(p.secondary, .36), 1.2);
    line(ctx, [[x + width * .19, y - 22], [x + width * .3, y - height * .37]], rgba(p.accent, .18), 1);
  }

  function background(ctx, p, r) {
    ctx.save();
    ctx.fillStyle = gradient(ctx, ['#a4adae', '#69777f', '#35434e', '#17242d'], 0, 0, W * .2, H);
    ctx.fillRect(0, 0, W, H);
    const far = random(661);
    for (let i = 0; i < 24; i++) {
      const x = -45 + i * 48, top = 470 + far() * 240, width = 22 + far() * 46;
      ctx.fillStyle = rgba('#455762', .22 + far() * .14); ctx.fillRect(x, top, width, 620 - top + 330);
      line(ctx, [[x + width * .6, top], [x + width * .6, top - 17 - far() * 63]], rgba('#536670', .35), 1);
    }
    glow(ctx, W * .55, 450, 660, '#dae1de', .32);
    cityBlock(ctx, -56, 415, 225, 541, p, 73, true);
    cityBlock(ctx, 849, 349, 244, 660, p, 91, true);
    polygon(ctx, [[-60, 772], [198, 772], [265, 829], [250, 899], [-60, 907]], '#23313c');
    for (let i = 0; i < 6; i++) {
      const x = -8 + i * 41;
      line(ctx, [[x, 788], [x + 49, 884]], '#42505a', 5);
      line(ctx, [[x, 884], [x + 41, 788]], rgba('#819099', .26), 1.4);
    }
    cityBlock(ctx, -96, 673, 249, 507, p, 143);
    cityBlock(ctx, 888, 706, 206, 450, p, 299);
    line(ctx, [[83, 632], [311, 756], [835, 630], [987, 510]], rgba('#172833', .58), 1.7);
    line(ctx, [[83, 640], [311, 765], [835, 638], [987, 518]], rgba('#bec9c9', .16), .8);
    for (const x of [188, 829]) {
      line(ctx, [[x, 897], [x - 38, 1090], [x + 28, 1090], [x, 897]], '#23313a', 8);
      line(ctx, [[x - 23, 1015], [x + 14, 1015]], rgba('#8c9ca5', .24), 2);
    }
    ctx.fillStyle = gradient(ctx, [rgba('#b8c4c4', 0), rgba('#a2b2b7', .23), rgba('#a2b2b7', 0)], 0, 595, 0, 1120);
    ctx.fillRect(0, 595, W, 525);
    polygon(ctx, [[0, H], [0, 1190], [W * .47, 955], [W * .59, 955], [W, 1210], [W, H]], '#293942');
    for (const x of [-700, -130, 180, 860, 1190, 1700])
      line(ctx, [[W * .53, 955], [x, H]], rgba('#acb5b6', .12), 1.5);
    for (let y = 1000, gap = 20; y < H; y += gap, gap *= 1.27)
      line(ctx, [[0, y], [W, y]], rgba('#111e29', .34), 2);
    mineral(ctx, r.x + 10, r.bottom - 12, 61, 216, 16, p);
    mineral(ctx, r.x + 60, r.bottom + 10, 39, 141, 17, p);
    mineral(ctx, r.right - 80, r.bottom - 96, 48, 180, 35, p);
    glow(ctx, 214, 954, 68, p.accent, .11); glow(ctx, 843, 846, 42, p.accent, .1);
    texture(ctx, 671, '#e1e8e6', 3000, .04);
    ctx.restore();
  }

  function frame(ctx, p, r) {
    ctx.save();
    polygon(ctx, [[36, 14], [W - 48, 14], [W - 14, 48], [W - 14, H - 37], [W - 38, H - 14],
      [14, H - 14], [14, 36]], black, rgba('#b9c2c4', .55), 1.5);
    polygon(ctx, [[26, 28], [W - 59, 28], [W - 28, 59], [W - 28, H - 42], [W - 43, H - 28],
      [28, H - 28], [28, 160]], paper);
    rounded(ctx, 29, 28, W - 58, r.y - 48, 0, black);
    rounded(ctx, 29, r.y - 20, W - 58, 7, 0, p.accent);
    rounded(ctx, 29, r.y - 13, 44, r.height + 42, 0, '#20262d');
    rounded(ctx, W - 72, r.y - 13, 44, r.height + 42, 0, '#232a31');
    polygon(ctx, [[29, r.bottom + 14], [157, r.bottom + 14], [180, r.bottom + 36], [29, r.bottom + 36]], p.accent);
    polygon(ctx, [[W - 173, r.bottom + 13], [W - 29, r.bottom + 13], [W - 29, r.bottom + 106],
      [W - 173, r.bottom + 106]], black);
    rounded(ctx, 806, r.bottom + 125, 1, 153, 0, rgba(p.ink, .25));
    line(ctx, [[86, r.bottom + 90], [775, r.bottom + 90]], black, 2.6);
    line(ctx, [[87, H - 168], [W - 87, H - 168]], rgba(p.ink, .3), 1);
    rounded(ctx, 28, H - 118, W - 56, 90, 0, black);
    texture(ctx, 119, '#4a555a', 1900, .035, { x: 30, y: r.bottom + 37, width: W - 60, height: H - r.bottom - 158 });
    for (let y = r.y + 26; y < r.bottom - 9; y += 26) {
      const wide = Math.round((y - r.y - 26) / 26) % 4 === 0;
      line(ctx, [[W - 61, y], [W - (wide ? 43 : 51), y]], rgba(white, wide ? .65 : .28), 1);
    }
    for (const y of [r.y + 45, r.bottom - 39]) {
      circle(ctx, 50, y, 4.5, '#111820', rgba('#9aabad', .65), .8);
      line(ctx, [[47, y], [53, y]], rgba(white, .7), 1);
    }
    for (let i = 0; i < 5; i++) polygon(ctx, [[824 + i * 24, H - 128], [836 + i * 24, H - 128],
      [846 + i * 24, H - 118], [834 + i * 24, H - 118]], p.accent);
    clearWindow(ctx, r);
    ctx.clearRect(r.x, r.y, r.width, r.height);
    line(ctx, [[r.x - 5, r.y + 30], [r.x - 5, r.y - 5], [r.x + 61, r.y - 5]], '#c1c9c9', 2);
    line(ctx, [[r.right - 60, r.bottom + 5], [r.right + 5, r.bottom + 5], [r.right + 5, r.bottom - 29]], '#a6b5b7', 2);
    ctx.restore();
  }

  function effects(ctx, p, r) {
    ctx.save();
    for (const [x, y, sign] of [[r.x + 15, r.y + 53, 1], [r.right - 15, r.bottom - 48, -1]]) {
      line(ctx, [[x, y + sign * 17], [x, y], [x + sign * 17, y]], rgba(white, .58), 1);
      line(ctx, [[x + sign * 7, y + sign * 7], [x + sign * 7, y + sign * 10]], rgba(p.accent, .7), 1.5);
    }
    for (const [x, y, size] of [[r.right - 29, r.y + 258, 7], [r.x + 33, r.bottom - 175, 4]])
      polygon(ctx, [[x, y - size], [x + size, y], [x, y + size], [x - size, y]], '', rgba(p.secondary, .58), 1);
    ctx.restore();
  }

  function back(ctx, p, r) {
    ctx.save();
    ctx.fillStyle = gradient(ctx, ['#171e25', '#10161d', '#202830']); ctx.fillRect(0, 0, W, H);
    grid(ctx, 64, rgba('#a2b2bd', .065));
    texture(ctx, 381, white, 3900, .035);
    polygon(ctx, [[42, 24], [W - 72, 24], [W - 24, 72], [W - 24, H - 43], [W - 43, H - 24],
      [24, H - 24], [24, 43]], '', rgba('#b9c7cb', .42), 1);
    rounded(ctx, 57, 59, 8, 183, 0, p.accent);
    tinyText(ctx, 'RHODES ISLAND', 88, 116, white, { size: 39, family: SANS, align: 'left' });
    tinyText(ctx, 'OPERATOR / PERSONNEL ARCHIVE', 90, 154, '#89969e', { size: 16, family: MONO, align: 'left' });
    line(ctx, [[90, 189], [W - 90, 189]], rgba(white, .35), 1);
    tinyText(ctx, 'R / I', W - 88, 117, p.accent, { size: 20, family: MONO, align: 'right' });
    for (const [x, y, sign] of [[91, 341, 1], [W - 91, 1117, -1]])
      line(ctx, [[x, y + sign * 79], [x, y], [x + sign * 79, y]], rgba('#acbac1', .48), 1.4);
    islandMark(ctx, W / 2, 769, 1.18, '#d8e0dd', '#182029');
    tinyText(ctx, 'MOBILE OPERATIONS DIVISION', W / 2, 1090, '#b2bfc1', { size: 18, family: MONO });
    tinyText(ctx, 'SEARCH  /  SUPPORT  /  SURVIVE', W / 2, 1124, '#737f88', { size: 13, family: MONO });
    rounded(ctx, 90, H - 297, W - 180, 1, 0, rgba(white, .3));
    tinyText(ctx, 'OPERATOR RECORD', 91, H - 254, white, { size: 20, family: SANS, align: 'left' });
    tinyText(ctx, 'FIELD ISSUE / 02', W - 90, H - 254, p.accent, { size: 16, family: MONO, align: 'right' });
    barcode(ctx, 'RI / OPERATOR / COLLECTION', 91, H - 198, 338, 44, '#b5c0c2');
    tinyText(ctx, 'RI — ARCHIVE — 0009', 92, H - 128, '#8d9aa3', { size: 13, family: MONO, align: 'left' });
    for (let i = 0; i < 7; i++) polygon(ctx, [[700 + i * 29, H - 192], [711 + i * 29, H - 192],
      [735 + i * 29, H - 162], [724 + i * 29, H - 162]], rgba(p.accent, .74));
    tinyText(ctx, 'STARCLOUDS / PRIVATE COLLECTION', 91, H - 58, '#78858e', { size: 13, family: MONO, align: 'left' });
    tinyText(ctx, 'NO. 009', W - 91, H - 58, '#a5b1b8', { size: 13, family: MONO, align: 'right' });
    ctx.restore();
  }

  function typography(ctx, p, r, values = {}) {
    const v = key => String(values[key] ?? '');
    ctx.save(); pathRect(ctx, 22, 22, W - 44, H - 44, 0); ctx.clip();
    islandMark(ctx, 74, 99, .12, white, black);
    micro(ctx, v('collection'), 126, 59, 501, '#aebabc', 'left', MONO);
    micro(ctx, v('number'), 950, 59, 270, '#aebabc', 'right', MONO);
    fitText(ctx, v('title'), 122, 127, 619, 61, 30, white, { family: SANS, weight: 800 });
    micro(ctx, v('subtitle'), 125, 155, 616, '#a7b2b7', 'left', MONO);
    polygon(ctx, [[801, 79], [817, 97], [801, 115], [785, 97]], '', p.accent, 2);
    line(ctx, [[792, 105], [810, 88]], p.accent, 2.5);
    fitText(ctx, v('element'), 950, 108, 119, 27, 18, white, { family: SANS, align: 'right', weight: 700 });
    micro(ctx, v('rarity'), 950, 151, 186, p.accent, 'right', MONO);
    ctx.save(); ctx.translate(53, r.bottom - 88); ctx.rotate(-Math.PI / 2);
    const frameDesign = h.resolveCardDesign(values).frame;
    fitText(ctx, `FIELD OPERATOR  /  ${v('number')}`, 0, 0, r.height - 177, 15, 12, frameDesign.id === 'arknights' ? '#b7c2c3' : frameDesign.palette.ink, { family: MONO, weight: 500 });
    ctx.restore();
    micro(ctx, `OPERATOR  /  ${v('name')}`, 88, r.bottom + 35, 661, '#566069', 'left', MONO);
    fitText(ctx, v('ability'), 85, r.bottom + 76, 684, 34, 23, black, { family: SANS, weight: 800 });
    micro(ctx, 'DEPLOY COST', 925, r.bottom + 43, 102, '#aebbc0', 'right', MONO);
    fitText(ctx, v('power'), 925, r.bottom + 89, 116, 43, 28, p.accent, { family: MONO, align: 'right', weight: 700 });
    paragraph(ctx, v('description'), 88, r.bottom + 113, 669, 102, '#4b565e', { size: 26, minimum: 21, family: SANS, leading: 1.4 });
    micro(ctx, 'LEVEL', 927, r.bottom + 151, 102, '#5b666c', 'right', MONO);
    fitText(ctx, v('level'), 929, r.bottom + 213, 112, 64, 29, black, { family: MONO, align: 'right', weight: 800 });
    fitText(ctx, `ATK  ${v('attack')}`, 88, H - 135, 285, 25, 17, black, { family: MONO, weight: 700 });
    fitText(ctx, `DEF  ${v('defense')}`, 407, H - 135, 285, 25, 17, black, { family: MONO, weight: 700 });
    micro(ctx, v('edition'), 929, H - 135, 216, '#505b61', 'right', MONO);
    micro(ctx, v('name'), 84, H - 79, 554, white, 'left', MONO);
    micro(ctx, `${v('collection')}  /  ${v('edition')}`, 85, H - 51, 603, '#9ba7ad', 'left', MONO);
    barcode(ctx, v('number'), 773, H - 95, 155, 33, '#d6dddb');
    micro(ctx, v('number'), 929, H - 40, 202, '#a7b3b8', 'right', MONO);
    ctx.restore();
  }

  return { background, effects, frame, back, typography };
}
