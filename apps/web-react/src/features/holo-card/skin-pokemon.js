export function createPokemonDesign(h) {
  const { W, H, TAU, SANS, MONO, rgba, mix, random, pathRect, rounded, line, polygon, circle, star, gradient, glow, texture, clearWindow, fitText, paragraph, micro } = h;
  const INK = '#273647';

  function energy(ctx, x, y, radius, kind = 'electric', accent = '#f6cf45') {
    const tint = { electric: accent, water: '#81caec', grass: '#94c86e', fire: '#ef8a65', colorless: '#e3e8ef' }[kind] || accent;
    ctx.save(); ctx.translate(x, y); ctx.scale(radius, radius);
    circle(ctx, 0, .07, 1.03, '#8e825b');
    circle(ctx, 0, 0, 1, gradient(ctx, ['#fffbd4', tint, mix(tint, '#655432', .23)], -.8, -.9, .8, 1), '#726741', .055);
    circle(ctx, 0, 0, .88, '', rgba('#ffffff', .7), .045);
    if (kind === 'colorless') star(ctx, 0, 0, .67, INK, 6, .39);
    else if (kind === 'water') {
      ctx.beginPath(); ctx.moveTo(0, -.68); ctx.bezierCurveTo(.27, -.29, .59, .13, .38, .44);
      ctx.bezierCurveTo(.19, .74, -.3, .65, -.41, .29); ctx.bezierCurveTo(-.5, -.01, -.14, -.47, 0, -.68);
      ctx.fillStyle = '#214d74'; ctx.fill();
    } else if (kind === 'grass') {
      ctx.beginPath(); ctx.moveTo(.55, -.63); ctx.bezierCurveTo(-.48, -.64, -.66, .39, -.18, .58);
      ctx.bezierCurveTo(.32, .73, .64, -.13, .55, -.63); ctx.fillStyle = '#355c32'; ctx.fill();
      line(ctx, [[-.4, .65], [.32, -.38]], '#e2ecb7', .075);
    } else if (kind === 'fire') {
      polygon(ctx, [[.08, -.74], [.34, -.18], [.45, -.39], [.61, .28], [.24, .65], [-.24, .65], [-.58, .25], [-.25, -.32], [-.18, .07]], '#883e24');
    } else polygon(ctx, [[.08, -.73], [-.54, .1], [-.07, .07], [-.2, .76], [.58, -.23], [.11, -.18]], INK);
    ctx.restore();
  }

  function pokeball(ctx, x, y, radius, angle = -.17, castShadow = true) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    if (castShadow) {
      ctx.shadowColor = 'rgba(0,12,51,.48)'; ctx.shadowBlur = radius * .15; ctx.shadowOffsetY = radius * .09;
    }
    circle(ctx, 0, 0, radius * 1.035, '#101e39'); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    circle(ctx, 0, 0, radius, gradient(ctx, ['#e8f3ff', '#364e73', '#f5fdff'], -radius, -radius, radius, radius));
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, radius * .966, 0, TAU); ctx.clip();
    ctx.fillStyle = gradient(ctx, ['#ffaaa0', '#f74445', '#ba1a30'], -radius * .65, -radius, radius, radius * .1);
    ctx.fillRect(-radius, -radius, radius * 2, radius);
    ctx.fillStyle = gradient(ctx, ['#ffffff', '#e2edf9', '#91afce'], -radius * .65, 0, radius, radius);
    ctx.fillRect(-radius, 0, radius * 2, radius);
    const shade = ctx.createRadialGradient(-radius * .37, -radius * .47, radius * .05, 0, 0, radius);
    shade.addColorStop(0, 'rgba(255,255,255,.14)'); shade.addColorStop(.64, 'rgba(19,40,78,0)'); shade.addColorStop(1, 'rgba(11,28,63,.34)');
    circle(ctx, 0, 0, radius, shade);
    ctx.fillStyle = '#132036'; ctx.fillRect(-radius, -radius * .095, radius * 2, radius * .19);
    line(ctx, [[-radius, -radius * .093], [radius, -radius * .093]], rgba('#ffffff', .3), radius * .018);
    ctx.beginPath(); ctx.ellipse(-radius * .35, -radius * .57, radius * .31, radius * .13, -.25, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,.26)'; ctx.fill();
    ctx.restore();
    circle(ctx, 0, 0, radius * .302, '#102039');
    circle(ctx, 0, 0, radius * .251, gradient(ctx, ['#f9ffff', '#96aec9', '#f1f8ff'], -radius * .2, -radius * .2, radius * .2, radius * .2), '#567393', radius * .015);
    circle(ctx, 0, 0, radius * .194, gradient(ctx, ['#ffffff', '#f1f7fc', '#bdcfdf'], -radius * .13, -radius * .12, radius * .18, radius * .19), '#8aa1b8', radius * .012);
    ctx.beginPath(); ctx.arc(0, 0, radius * .99, Math.PI * 1.1, Math.PI * 1.78); ctx.strokeStyle = 'rgba(255,255,255,.63)'; ctx.lineWidth = radius * .023; ctx.stroke();
    circle(ctx, -radius * .055, -radius * .063, radius * .063, 'rgba(255,255,255,.73)'); ctx.restore();
  }

  function cloud(ctx, x, y, width, height, opacity = .85) {
    ctx.save(); ctx.globalAlpha = opacity;
    const mist = ctx.createRadialGradient(x, y - height * .2, height * .1, x, y, width * .57);
    mist.addColorStop(0, '#ffffff'); mist.addColorStop(.63, '#eafaff'); mist.addColorStop(1, 'rgba(224,247,255,0)');
    ctx.fillStyle = mist;
    for (const [dx, dy, rx, ry] of [[-.27, .1, .28, .38], [0, -.15, .27, .61], [.24, .06, .25, .41]]) {
      ctx.beginPath(); ctx.ellipse(x + width * dx, y + height * dy, width * rx, height * ry, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function background(ctx, p, r) {
    ctx.save();
    ctx.fillStyle = gradient(ctx, ['#2788d3', '#7dceed', '#d4f0eb', '#bfd987', '#74a658'], 0, 0, 0, H); ctx.fillRect(0, 0, W, H);
    glow(ctx, 786, 291, 409, '#fff6b8', .61); circle(ctx, 786, 291, 66, 'rgba(255,250,201,.73)');
    for (const [left, right] of [[53, 218], [359, 464], [660, 721]]) {
      polygon(ctx, [[776, 284], [819, 294], [right, H], [left, H]], gradient(ctx, ['rgba(255,255,220,.16)', 'rgba(255,255,220,0)'], 795, 290, left, H));
    }
    cloud(ctx, 124, 236, 344, 108, .7); cloud(ctx, 912, 495, 355, 89, .5);
    cloud(ctx, 305, 589, 406, 64, .26); cloud(ctx, 603, 155, 242, 57, .3);
    ctx.beginPath(); ctx.moveTo(0, 849); ctx.bezierCurveTo(127, 704, 265, 838, 400, 823);
    ctx.bezierCurveTo(583, 801, 685, 743, W, 850); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = '#8fc5b4'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 974); ctx.bezierCurveTo(205, 835, 422, 995, 615, 904);
    ctx.bezierCurveTo(812, 824, 921, 914, W, 940); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = gradient(ctx, ['#8fba67', '#b6cf7a', '#65a25b'], 0, 910, W, 1370); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 1148); ctx.bezierCurveTo(196, 985, 569, 1107, W, 1058);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = gradient(ctx, ['#acd070', '#81b159', '#43874f'], 0, 1040, 0, H); ctx.fill();
    ctx.beginPath(); ctx.moveTo(504, 968); ctx.bezierCurveTo(352, 1071, 775, 1165, 640, H);
    ctx.lineTo(969, H); ctx.bezierCurveTo(1004, 1190, 434, 1056, 528, 968); ctx.closePath();
    ctx.fillStyle = gradient(ctx, ['#e3dfac', '#ebe3b5', '#cbb78d'], 510, 970, 830, H); ctx.fill();
    const trees = [[-25, 1020, 203], [981, 967, 159], [144, 1034, 55], [844, 934, 44]];
    for (const [x, y, size] of trees) {
      rounded(ctx, x - size * .085, y - size * .37, size * .17, size * .8, 5, '#52784a');
      for (const [dx, dy, rr] of [[-.38, -.44, .47], [.3, -.57, .53], [0, -.87, .54]]) {
        circle(ctx, x + dx * size, y + dy * size, size * rr, gradient(ctx, ['#b2d582', '#5ba470', '#347b61'], x - size, y - size, x + size, y));
      }
      const leaves = random(Math.round(size * 11));
      for (let i = 0; i < 37; i++) {
        const angle = leaves() * TAU, reach = Math.sqrt(leaves()) * size * .7;
        circle(ctx, x + Math.cos(angle) * reach, y - size * .65 + Math.sin(angle) * reach * .6, 2 + leaves() * size * .036, rgba('#c9e89d', .27));
      }
    }
    const rand = random(25025);
    for (let i = 0; i < 264; i++) {
      const x = rand() * W, y = 1082 + Math.pow(rand(), .62) * 454, size = 3 + (y - 1080) * .025;
      line(ctx, [[x, y + size], [x - size * .18, y - size]], rgba(i % 3 ? '#376b44' : '#dfeba1', .32), 1.2);
      if (i % 7 === 0) {
        circle(ctx, x, y - size, size * .28, i % 2 ? '#fff9d6' : '#f6df85'); circle(ctx, x, y - size, size * .09, '#c79e45');
      }
    }
    glow(ctx, 734, 907, 267, '#fff4bd', .12);
    texture(ctx, 7125, '#ffffd7', 2200, .035);
    ctx.restore();
  }

  function frame(ctx, p, r) {
    ctx.save();
    rounded(ctx, 8, 8, W - 16, H - 16, 39, gradient(ctx, ['#fff69a', '#f6cc42', p.accent, '#d59b25', '#ffdf64'], 0, 0, W, H), '#9a711a', 4);
    rounded(ctx, 17, 17, W - 34, H - 34, 31, '', 'rgba(255,253,190,.82)', 2);
    rounded(ctx, 39, 39, W - 78, H - 78, 21, gradient(ctx, ['#fff8df', p.panel, '#f3e7bd'], 0, 40, 0, H - 40), '#b89a3f', 2.5);
    rounded(ctx, 45, 45, W - 90, H - 90, 17, '', 'rgba(255,255,244,.86)', 1.2);
    const foil = ctx.createLinearGradient(0, 0, W, H);
    for (const [at, color] of [[0, '#fbe698'], [.19, '#a4dcca'], [.38, '#c2b6e8'], [.57, '#ebbbc5'], [.76, '#c8deb6'], [1, '#f6d98c']]) foil.addColorStop(at, rgba(color, .2));
    rounded(ctx, 46, 46, W - 92, H - 92, 16, foil);
    texture(ctx, 92025, '#9c8b48', 3400, .042);
    rounded(ctx, r.x - 10, r.y - 10, r.width + 20, r.height + 20, 13, gradient(ctx, ['#846b30', '#e6cf81', '#81713e', '#f2de9e'], r.x, r.y, r.right, r.bottom));
    rounded(ctx, r.x - 7, r.y - 7, r.width + 14, r.height + 14, 11, '', '#fff3c0', 1.6);
    clearWindow(ctx, r);
    rounded(ctx, r.x - 2, r.y - 2, r.width + 4, r.height + 4, 9, '', 'rgba(241,250,249,.83)', 2);
    line(ctx, [[78, r.bottom + 51], [946, r.bottom + 51]], 'rgba(148,126,64,.29)', 1);
    line(ctx, [[80, H - 176], [944, H - 176]], 'rgba(128,119,74,.33)', 1.1);
    line(ctx, [[80, H - 104], [944, H - 104]], 'rgba(128,119,74,.24)', 1);
    for (const [x, y] of [[23, 95], [W - 24, 627], [24, H - 155], [W - 25, H - 54]]) star(ctx, x, y, 10, 'rgba(255,255,210,.73)', 4, .12);
    ctx.restore();
  }

  function effects(ctx, p, r) {
    ctx.save();
    for (const [x, y, size] of [[r.x + 13, r.y + 123, 13], [r.right - 15, r.y + 287, 10], [r.x + 23, r.bottom - 97, 8], [r.right - 24, r.bottom - 52, 15]]) {
      glow(ctx, x, y, size * 5, '#fff3b2', .12);
      star(ctx, x, y, size, 'rgba(255,255,235,.87)', 4, .12);
      circle(ctx, x + 14, y - 19, 2, rgba(p.secondary, .6));
    }
    for (const side of [-1, 1]) {
      const x = side < 0 ? r.x + 3 : r.right - 3;
      ctx.beginPath(); ctx.moveTo(x, r.bottom - 40); ctx.bezierCurveTo(x + side * 23, r.bottom - 74, x - side * 11, r.bottom - 121, x + side * 5, r.bottom - 166);
      ctx.strokeStyle = 'rgba(255,237,135,.44)'; ctx.lineWidth = 1.8; ctx.stroke();
    }
    ctx.restore();
  }

  function wordmark(ctx, y, inverted = false) {
    ctx.save(); ctx.translate(W / 2, y); if (inverted) ctx.rotate(Math.PI);
    ctx.font = `italic 900 126px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.strokeStyle = '#07245e'; ctx.lineWidth = 19;
    ctx.shadowColor = 'rgba(1,16,59,.6)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 7;
    ctx.strokeText('Pokémon', 0, 0, 716); ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#4974ac'; ctx.lineWidth = 10; ctx.strokeText('Pokémon', 0, 0, 716);
    ctx.fillStyle = gradient(ctx, ['#fff58b', '#ffe14b', '#edb622'], 0, -70, 0, 70); ctx.fillText('Pokémon', 0, 0, 716);
    ctx.restore();
  }

  function back(ctx, p, r) {
    ctx.save();
    rounded(ctx, 8, 8, W - 16, H - 16, 39, '#071b55', '#456bb9', 5);
    ctx.save(); pathRect(ctx, 21, 21, W - 42, H - 42, 28); ctx.clip();
    ctx.fillStyle = gradient(ctx, ['#0e2b82', '#1967bc', '#123c96', '#061956'], 70, 0, W - 70, H); ctx.fillRect(0, 0, W, H);
    glow(ctx, 531, 765, 659, '#85e2f6', .72); glow(ctx, 215, 597, 319, '#98e3ff', .23);
    for (let arm = 0; arm < 16; arm++) {
      ctx.beginPath();
      for (let j = 0; j <= 82; j++) {
        const t = j / 82, radius = 595 * (1 - t) + 23, angle = arm / 16 * TAU + t * TAU * .84;
        const x = 512 + Math.cos(angle) * radius, y = 768 + Math.sin(angle) * radius * 1.18;
        if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = arm % 2 ? 'rgba(224,250,255,.13)' : 'rgba(9,39,119,.28)'; ctx.lineWidth = arm % 2 ? 18 : 29; ctx.lineCap = 'round'; ctx.stroke();
    }
    const rand = random(15025);
    for (let i = 0; i < 52; i++) {
      const x = 60 + rand() * 904, y = 357 + rand() * 832;
      if (Math.hypot((x - 512), (y - 768)) < 281) continue;
      star(ctx, x, y, 2 + rand() * 8, rgba('#d5f7ff', .24 + rand() * .46), 4, .13);
    }
    texture(ctx, 24025, '#c2e8ff', 2100, .045);
    pokeball(ctx, 512, 769, 244, -.18);
    star(ctx, 671, 577, 19, 'rgba(255,255,255,.8)', 4, .12);
    wordmark(ctx, 274); wordmark(ctx, H - 272, true);
    ctx.restore();
    rounded(ctx, 29, 29, W - 58, H - 58, 21, '', 'rgba(161,205,249,.38)', 1.4);
    rounded(ctx, 43, 43, W - 86, H - 86, 14, '', 'rgba(5,30,84,.74)', 2);
    ctx.restore();
  }

  function typography(ctx, p, r, values = {}) {
    const v = (key, fallback = '') => String(values[key] ?? fallback);
    const attribute = v('element', '雷');
    const kind = /水|冰/.test(attribute) ? 'water' : /草|林/.test(attribute) ? 'grass' : /火/.test(attribute) ? 'fire' : 'electric';
    ctx.save();
    rounded(ctx, 81, 51, 88, 29, 12, '#e9dfbd', '#aa9b6b', .8);
    fitText(ctx, '基础', 125, 72, 69, 19, 16, '#5c634f', { family: SANS, align: 'center', weight: 700 });
    micro(ctx, v('collection', 'POKÉMON / COLLECTION'), 184, 73, 518, '#79744f');
    fitText(ctx, v('rarity', 'SAR'), 945, 74, 171, 18, 14, '#857140', { family: MONO, align: 'right', weight: 600 });
    fitText(ctx, v('title', v('name', '闪耀伙伴')), 81, 144, 610, 65, 30, INK, { family: SANS, weight: 800 });
    fitText(ctx, `HP ${v('power', '180')}`, 889, 141, 176, 41, 23, '#293746', { align: 'right', weight: 700 });
    energy(ctx, 940, 121, 24, kind, p.accent);
    micro(ctx, v('subtitle', 'SPECIAL ILLUSTRATION RARE'), 84, 173, 610, '#7c744f');
    micro(ctx, `${attribute} / LV.${v('level', '28')}`, 943, 173, 223, '#7c744f', 'right');
    pokeball(ctx, 91, r.bottom + 27, 10, 0, false);
    micro(ctx, `No.${v('number', '025')}  ·  ${v('name', 'MY PARTNER')}  ·  ${attribute}属性`, 114, r.bottom + 33, 600, '#776d4b');
    micro(ctx, v('edition', 'HOLO EDITION'), 940, r.bottom + 33, 198, '#867a50', 'right');
    energy(ctx, 100, r.bottom + 106, 17, kind, p.accent); energy(ctx, 141, r.bottom + 106, 17, 'colorless');
    fitText(ctx, v('ability', '十万伏特'), 188, r.bottom + 118, 556, 35, 23, INK, { weight: 750 });
    fitText(ctx, v('attack', '120'), 943, r.bottom + 119, 159, 43, 26, INK, { align: 'right', weight: 650 });
    paragraph(ctx, v('description'), 89, r.bottom + 148, 850, Math.max(44, H - 193 - r.bottom - 148), '#5b614e', { size: 23, minimum: 19, leading: 1.35 });
    micro(ctx, '弱点', 89, H - 136, 90, '#7c754f'); energy(ctx, 170, H - 143, 12, 'electric', p.accent);
    micro(ctx, '×2', 195, H - 136, 60, INK);
    micro(ctx, `防御 ${v('defense', '80')}`, 426, H - 136, 205, '#5e654f', 'center');
    micro(ctx, '撤退', 721, H - 136, 106, '#7c754f');
    energy(ctx, 813, H - 143, 12, 'colorless'); energy(ctx, 846, H - 143, 12, 'colorless');
    micro(ctx, `PARTNER / ${v('name', 'MY PARTNER')}`, 84, H - 67, 460, '#756c4f');
    micro(ctx, `${v('number', '025')} / ${v('edition', 'HOLO EDITION')}`, 912, H - 67, 339, '#756c4f', 'right', MONO);
    star(ctx, 942, H - 74, 11, '#997b2f', 5, .46);
    ctx.restore();
  }

  return { background, effects, frame, back, typography };
}
