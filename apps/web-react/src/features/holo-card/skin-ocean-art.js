// An original underwater setting and a heart-cut sapphire pendant. All jewelry
// and scenery is separate from the user's character texture.
export function createOceanArtwork(h) {
  const { W, H, TAU, SERIF, MONO, rgba, mix, rounded, line, polygon, circle, star, gradient, glow, texture, tinyText } = h;
  const pearlWhite = '#efffff';

  function smoothLine(ctx, points, color, width = 1) {
    if (points.length < 2) return;
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length - 1; i++) {
      ctx.quadraticCurveTo(points[i][0], points[i][1], (points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2);
    }
    ctx.lineTo(...points.at(-1)); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
  }

  function lightShaft(ctx, x, targetX, endY, width, opacity) {
    ctx.save(); ctx.filter = 'blur(15px)';
    const light = ctx.createLinearGradient(x, 0, targetX, endY);
    light.addColorStop(0, `rgba(212,255,247,${opacity})`);
    light.addColorStop(.5, `rgba(158,238,237,${opacity * .36})`);
    light.addColorStop(1, 'rgba(158,238,237,0)');
    ctx.beginPath(); ctx.moveTo(x - 14, -50); ctx.lineTo(x + 14, -50);
    ctx.bezierCurveTo(x + width * .3, endY * .24, targetX + width * .52, endY * .64, targetX + width, endY);
    ctx.lineTo(targetX - width, endY); ctx.bezierCurveTo(targetX - width * .45, endY * .58, x - width * .12, endY * .22, x - 14, -50);
    ctx.fillStyle = light; ctx.fill(); ctx.restore();
  }

  function caustics(ctx, x, y, width, height, opacity, phase = 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    for (let row = -1; row < 9; row++) {
      const points = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, xx = x + t * width;
        const yy = y + row * height / 7 + Math.sin(t * 13.5 + row * 1.67 + phase) * height * .047 + Math.sin(t * 26 + row * .6) * height * .01;
        points.push([xx, yy]);
      }
      smoothLine(ctx, points, rgba('#affbe9', opacity), row % 3 ? 1.1 : 2.1);
    }
    for (let col = 0; col < 6; col++) {
      const points = [];
      for (let i = 0; i <= 13; i++) {
        const t = i / 13;
        points.push([x + col * width / 5 + Math.sin(t * 9 + col + phase) * width * .047, y + t * height]);
      }
      smoothLine(ctx, points, rgba('#befde8', opacity * .4), 1);
    }
    ctx.restore();
  }

  function pearl(ctx, x, y, radius, tint = '#d8ebea') {
    ctx.save(); ctx.shadowColor = 'rgba(0,20,47,.25)'; ctx.shadowBlur = radius * .65; ctx.shadowOffsetY = radius * .3;
    const color = ctx.createRadialGradient(x - radius * .33, y - radius * .4, radius * .02, x + radius * .12, y + radius * .17, radius * 1.05);
    color.addColorStop(0, '#ffffff'); color.addColorStop(.22, pearlWhite); color.addColorStop(.57, tint); color.addColorStop(.82, '#8cacbe'); color.addColorStop(1, '#456c8a');
    circle(ctx, x, y, radius, color); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    circle(ctx, x - radius * .3, y - radius * .38, radius * .13, 'rgba(255,255,255,.78)'); ctx.restore();
  }

  function bubble(ctx, x, y, radius) {
    circle(ctx, x, y, radius, rgba('#b8f9eb', .028), rgba('#c6fff0', .2), 1);
    ctx.beginPath(); ctx.arc(x, y, radius - 1.5, Math.PI * 1.12, Math.PI * 1.67);
    ctx.strokeStyle = 'rgba(229,255,253,.49)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.stroke();
  }

  function coral(ctx, x, y, length, angle, thickness, depth, color) {
    const endX = x + Math.cos(angle) * length, endY = y + Math.sin(angle) * length;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + Math.cos(angle + .15) * length * .3, y + Math.sin(angle + .15) * length * .3, x + Math.cos(angle - .08) * length * .7, y + Math.sin(angle - .08) * length * .7, endX, endY);
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.lineCap = 'round'; ctx.stroke();
    if (!depth) return;
    coral(ctx, endX, endY, length * .62, angle - .41, thickness * .64, depth - 1, color);
    coral(ctx, x + (endX - x) * .69, y + (endY - y) * .69, length * .64, angle + .57, thickness * .61, depth - 1, color);
  }

  function shell(ctx, x, y, scale, angle) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(0,28,50,.22)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 7;
    ctx.beginPath(); ctx.moveTo(0, 31);
    ctx.bezierCurveTo(-23, 15, -77, -4, -69, -32); ctx.bezierCurveTo(-75, -55, -46, -78, -27, -75);
    ctx.bezierCurveTo(-15, -96, 17, -96, 31, -74); ctx.bezierCurveTo(54, -75, 79, -50, 68, -27);
    ctx.bezierCurveTo(73, -5, 24, 17, 0, 31);
    ctx.fillStyle = gradient(ctx, ['#eef7e2', '#b8d5d4', '#d5c9d2', '#9cb8c5'], -49, -80, 50, 30); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    for (let i = -4; i <= 4; i++) {
      const xx = i * 14, yy = -82 + Math.abs(i) * 11;
      ctx.beginPath(); ctx.moveTo(0, 28); ctx.quadraticCurveTo(xx * .32, -29, xx, yy);
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,252,.51)' : 'rgba(66,110,132,.2)'; ctx.lineWidth = i % 2 ? 1.5 : 1; ctx.stroke();
    }
    ctx.restore();
  }

  function background(ctx, p, r) {
    const floor = Math.min(r.bottom - 80, H * .85);
    ctx.fillStyle = gradient(ctx, ['#174661', '#103a58', p.base, '#061f38'], 100, 0, 650, H); ctx.fillRect(0, 0, W, H);
    glow(ctx, W * .48, H * .4, 640, '#84bfcd', .065);
    glow(ctx, 170, -40, 510, '#96d2e2', .12);
    for (const beam of [[198, 357, H, 119, .085], [273, 575, H * .93, 46, .075], [585, 695, H, 94, .052], [762, 607, H * .82, 41, .043]]) lightShaft(ctx, ...beam);

    // The moving surface is a distant ceiling, not a flat pattern over the subject.
    for (let row = 0; row < 6; row++) {
      const points = [];
      for (let i = 0; i <= 25; i++) {
        const xx = i / 25 * W;
        points.push([xx, 35 + row * 23 + Math.sin(i * .53 + row * .6) * 8 + Math.sin(i * 1.2) * 2]);
      }
      smoothLine(ctx, points, rgba('#aedce7', .083 - row * .009), row % 3 ? 1 : 1.6);
    }
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, floor - 121);
    ctx.bezierCurveTo(222, floor - 188, 272, floor + 36, 512, floor + 13);
    ctx.bezierCurveTo(755, floor - 12, 857, floor - 176, W, floor - 91);
    ctx.lineTo(W, H); ctx.fillStyle = gradient(ctx, ['#16495b', '#103951', '#071f37'], 0, floor - 165, 0, H); ctx.fill();
    caustics(ctx, -18, floor - 326, 246, 396, .088, 1.1);
    caustics(ctx, W - 220, floor - 354, 257, 395, .078, 3.2);
    caustics(ctx, 211, floor + 38, 631, 208, .032, .5);

    coral(ctx, 55, floor + 22, 134, -1.64, 9, 3, '#155566');
    coral(ctx, W - 42, floor + 4, 125, -1.4, 9, 3, '#134a5b');
    coral(ctx, 101, floor - 20, 72, -1.66, 5, 3, rgba('#8bacb8', .52));
    coral(ctx, W - 78, floor - 25, 78, -1.42, 5, 3, rgba('#93b8c4', .48));
    coral(ctx, 157, floor + 16, 59, -1.79, 3.5, 2, rgba('#adb6c7', .3));
    ctx.save(); ctx.globalAlpha = .58;
    shell(ctx, 187, floor - 22, .52, -.17);
    shell(ctx, W - 151, floor - 3, .39, .25);
    pearl(ctx, W - 166, floor + 3, 6.7, '#c2dbe1'); ctx.restore();
    for (const item of [[127, H * .38, 6.3], [141, H * .347, 3.4], [W - 109, H * .52, 4.9]]) bubble(ctx, ...item);
    texture(ctx, 409, '#cce8f3', 1800, .018);

    // A continuous dusk falloff leaves the original full-card figure untouched
    // while letting the large silver-blue typography sit quietly over the sea.
    const dusk = ctx.createLinearGradient(0, 1000, 0, H);
    dusk.addColorStop(0, 'rgba(4,20,38,0)'); dusk.addColorStop(.24, 'rgba(4,20,38,.08)');
    dusk.addColorStop(.61, 'rgba(4,20,38,.38)'); dusk.addColorStop(1, 'rgba(4,20,38,.64)');
    ctx.fillStyle = dusk; ctx.fillRect(0, 1000, W, H - 1000);
  }

  const HEART = [
    [[0, -.43], [-.27, -.88], [-.92, -.89], [-.98, -.28]],
    [[-.98, -.28], [-1, .09], [-.57, .55], [0, .97]],
    [[0, .97], [.57, .55], [1, .09], [.98, -.28]],
    [[.98, -.28], [.92, -.89], [.27, -.88], [0, -.43]],
  ];
  function heartPath(ctx, x, y, radius) {
    ctx.beginPath(); ctx.moveTo(x, y - radius * .43);
    for (const [, a, b, end] of HEART) ctx.bezierCurveTo(x + a[0] * radius, y + a[1] * radius, x + b[0] * radius, y + b[1] * radius, x + end[0] * radius, y + end[1] * radius);
    ctx.closePath();
  }
  function cubic(points, t) {
    const a = 1 - t;
    return [0, 1].map(axis => a ** 3 * points[0][axis] + 3 * a * a * t * points[1][axis] + 3 * a * t * t * points[2][axis] + t ** 3 * points[3][axis]);
  }
  function diamond(ctx, x, y, radius, angle = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    circle(ctx, 0, 0, radius + 1.1, '#436c85', '#d1eef5', .65);
    polygon(ctx, [[0, -radius], [radius, 0], [0, radius], [-radius, 0]], '#d9f9fc');
    polygon(ctx, [[0, -radius], [0, 0], [-radius, 0]], '#ffffff');
    polygon(ctx, [[radius, 0], [0, radius], [0, 0]], '#79accc');
    polygon(ctx, [[-radius, 0], [0, radius], [0, 0]], '#accfdf');
    circle(ctx, -radius * .2, -radius * .25, Math.max(.45, radius * .17), '#ffffff'); ctx.restore();
  }
  function chain(ctx, points) {
    ctx.beginPath(); ctx.moveTo(...points[0]); ctx.bezierCurveTo(...points[1], ...points[2], ...points[3]);
    ctx.strokeStyle = 'rgba(0,26,55,.42)'; ctx.lineWidth = 5.3; ctx.stroke();
    ctx.strokeStyle = gradient(ctx, ['#d9edf5', '#86adbf', '#c8e5f0', '#628ba3'], points[0][0], 0, points[3][0], points[3][1]); ctx.lineWidth = 2.1; ctx.stroke();
    for (let i = 0; i <= 44; i++) {
      const t = i / 44, point = cubic(points, t), next = cubic(points, Math.min(1, t + .002));
      const angle = Math.atan2(next[1] - point[1], next[0] - point[0]) - Math.PI / 2;
      ctx.beginPath(); ctx.ellipse(point[0], point[1], 2.25, 4.6, angle, 0, TAU);
      ctx.strokeStyle = i % 3 ? '#b4d7e4' : '#e9fbff'; ctx.lineWidth = .9; ctx.stroke();
    }
  }

  function sapphireHeart(ctx, x, y, radius, p) {
    ctx.save(); ctx.shadowColor = 'rgba(0,13,40,.66)'; ctx.shadowBlur = 37; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 23;
    heartPath(ctx, x, y + 4, radius + 18);
    ctx.fillStyle = gradient(ctx, ['#eefcff', '#94c0d5', '#376585', '#d3eff5', '#5e91ad'], x - radius, y - radius, x + radius, y + radius); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    heartPath(ctx, x, y, radius + 4); ctx.fillStyle = '#06376f'; ctx.fill();
    heartPath(ctx, x, y, radius); ctx.save(); ctx.clip();
    ctx.fillStyle = gradient(ctx, ['#117ec5', '#054eaa', '#072c6a', '#02849f'], x - radius, y - radius, x + radius, y + radius);
    ctx.fillRect(x - radius * 1.1, y - radius, radius * 2.2, radius * 2.1);
    const facet = (points, first, second) => polygon(ctx, points.map(([xx, yy]) => [x + xx * radius, y + yy * radius]), gradient(ctx, [first, second], x - radius * .55, y - radius * .67, x + radius * .55, y + radius * .71));
    facet([[0, -.43], [-.49, -.78], [-.30, -.13]], '#acf3f6', '#258dd1');
    facet([[-.49, -.78], [-.98, -.28], [-.65, -.10], [-.30, -.13]], '#3fc2e5', '#065ea8');
    facet([[-.98, -.28], [-.98, .17], [-.50, .40], [-.65, -.10]], '#0867ac', '#0b367c');
    facet([[0, -.43], [.49, -.78], [.26, -.15]], '#449ccb', '#052765');
    facet([[.49, -.78], [.98, -.28], [.65, -.05], [.26, -.15]], '#3bd5e2', '#0a58a0');
    facet([[.98, -.28], [.98, .15], [.47, .41], [.65, -.05]], '#12629b', '#071e54');
    facet([[-.30, -.13], [0, -.33], [.26, -.15], [.42, .19], [0, .60], [-.44, .19]], '#168eda', '#06448f');
    facet([[-.65, -.10], [-.44, .19], [0, .60], [0, .94], [-.60, .49]], '#79d4ea', '#07347a');
    facet([[.65, -.05], [.42, .19], [0, .60], [0, .94], [.60, .49]], '#063b86', '#168cb1');
    facet([[-.44, .19], [-.08, .18], [0, .60]], '#259bd0', '#052f79');
    facet([[-.08, .18], [.42, .19], [0, .60]], '#a3e9f3', '#087abe');
    line(ctx, [[x - radius * .48, y - radius * .57], [x - radius * .30, y - radius * .15], [x - radius * .44, y + radius * .18]], 'rgba(219,254,255,.48)', 1.2);
    line(ctx, [[x + radius * .48, y - radius * .64], [x + radius * .66, y - radius * .06]], 'rgba(204,250,255,.63)', 1.1);
    glow(ctx, x - radius * .31, y - radius * .31, radius * .57, '#8ff3fd', .12);
    ctx.restore();

    heartPath(ctx, x, y, radius + 1.2); ctx.strokeStyle = 'rgba(222,254,255,.78)'; ctx.lineWidth = 1.6; ctx.stroke();
    // Individually cut silver-set diamonds follow the actual lobes and point.
    for (const segment of HEART) for (let i = 0; i < 11; i++) {
      const t = (i + .35) / 11, point = cubic(segment, t), next = cubic(segment, Math.min(1, t + .004));
      diamond(ctx, x + point[0] * (radius + 10), y + 2 + point[1] * (radius + 10), 4.3 + (i % 4 === 0 ? .3 : 0), Math.atan2(next[1] - point[1], next[0] - point[0]));
    }
    star(ctx, x - radius * .73, y - radius * .51, 16, '#e7f7ff', 4, .09);
    star(ctx, x + radius * .59, y + radius * .44, 7, 'rgba(225,255,255,.59)', 4, .08);
    ctx.restore();
  }

  function back(ctx, p) {
    ctx.fillStyle = gradient(ctx, ['#0c3654', p.base, '#051c34'], 0, 0, W, H); ctx.fillRect(0, 0, W, H);
    glow(ctx, 510, 745, 566, '#4a99bf', .12); glow(ctx, 100, 132, 427, '#73b7d4', .055);
    rounded(ctx, 22, 22, W - 44, H - 44, 20, '', rgba(p.border, .23), 1.3);
    caustics(ctx, -37, H - 374, W + 74, 369, .046, 1.6);
    texture(ctx, 857, '#cee7f3', 2000, .018);

    chain(ctx, [[168, -29], [196, 265], [339, 516], [492, 636]]);
    chain(ctx, [[857, -29], [829, 265], [686, 516], [532, 636]]);
    ctx.save(); ctx.shadowColor = 'rgba(0,16,41,.45)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
    ctx.beginPath(); ctx.ellipse(512, 652, 18, 33, 0, 0, TAU);
    ctx.fillStyle = gradient(ctx, ['#ffffff', '#b5d9e7', '#54839f', '#e6f8ff'], 494, 619, 530, 685); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.ellipse(512, 650, 10, 23, 0, 0, TAU); ctx.fillStyle = '#174b73'; ctx.fill();
    ctx.restore();
    sapphireHeart(ctx, 512, 806, 258, p);
    diamond(ctx, 512, 686, 8.7, 0);
    pearl(ctx, 744, 1124, 12, '#c8dce3'); pearl(ctx, 773, 1141, 5.6);
    tinyText(ctx, 'HEART OF THE OCEAN', 512, 1260, rgba('#ddf8ff', .77), { size: 21, family: SERIF });
    tinyText(ctx, 'STARCLOUDS / SAPPHIRE COLLECTION', 512, 1450, rgba('#a9d1e3', .53), { size: 13, family: MONO });
  }

  return { background, back };
}
