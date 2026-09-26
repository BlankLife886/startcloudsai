// Original illustrated scenery. These plates contain no character, type or UI;
// their encoded exports are loaded behind the user's untouched portrait.
const W = 1024, H = 1536, TAU = Math.PI * 2;
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function rgb(color) { return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)); }
function alpha(color, opacity) { return `rgba(${rgb(color).join(',')},${opacity})`; }
function mix(a, b, t) { return `rgb(${rgb(a).map((n, i) => Math.round(n + (rgb(b)[i] - n) * t)).join(',')})`; }
function gradient(ctx, stops, x = 0, y = 0, x2 = 0, y2 = H) {
  const value = ctx.createLinearGradient(x, y, x2, y2);
  stops.forEach(([at, color]) => value.addColorStop(at, color)); return value;
}
function fill(ctx, color) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); }
function ellipse(ctx, x, y, rx, ry, color, rotation = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, TAU); ctx.fillStyle = color; ctx.fill();
}
function line(ctx, points, color, width = 1) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
}
function shape(ctx, points, color) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function glow(ctx, x, y, rx, ry, color, strength) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  light.addColorStop(0, alpha(color, strength)); light.addColorStop(.42, alpha(color, strength * .35)); light.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = light; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
}
function hash(x, y, seed) { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed * 31; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; }
function noise(x, y, seed) {
  const a = Math.floor(x), b = Math.floor(y), u = x - a, v = y - b;
  const sx = u * u * (3 - 2 * u), sy = v * v * (3 - 2 * v);
  const p = hash(a, b, seed), q = hash(a + 1, b, seed), r = hash(a, b + 1, seed), s = hash(a + 1, b + 1, seed);
  return (p + (q - p) * sx) * (1 - sy) + (r + (s - r) * sx) * sy;
}
function fbm(x, y, seed) { return noise(x, y, seed) * .57 + noise(x * 2.07, y * 2.07, seed + 91) * .28 + noise(x * 4.13, y * 4.13, seed + 187) * .15; }
function atmosphere(ctx, seed, light, strength = .14) {
  const texture = document.createElement('canvas'); texture.width = 384; texture.height = 576;
  const layer = texture.getContext('2d'), pixels = layer.createImageData(384, 576), color = rgb(light);
  for (let y = 0; y < 576; y++) for (let x = 0; x < 384; x++) {
    const i = (y * 384 + x) * 4;
    const density = clamp((fbm(x / 74, y / 63, seed) - .24) * 1.8);
    pixels.data[i] = color[0]; pixels.data[i + 1] = color[1]; pixels.data[i + 2] = color[2]; pixels.data[i + 3] = density * strength * 255;
  }
  layer.putImageData(pixels, 0, 0); ctx.drawImage(texture, 0, 0, W, H); texture.width = 1; texture.height = 1;
}
function grain(ctx, seed, strength = 12) {
  const texture = document.createElement('canvas'); texture.width = 512; texture.height = 768;
  const layer = texture.getContext('2d'), image = layer.createImageData(512, 768), rand = rng(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const light = rand() > .5 ? 255 : 0; image.data[i] = light; image.data[i + 1] = light; image.data[i + 2] = light; image.data[i + 3] = rand() * strength;
  }
  layer.putImageData(image, 0, 0); ctx.drawImage(texture, 0, 0, W, H); texture.width = 1; texture.height = 1;
}
function stars(ctx, rand, count, color, bottom = 1000) {
  for (let i = 0; i < count; i++) {
    const x = rand() * W, y = rand() * bottom, r = .3 + rand() * 1.4;
    ellipse(ctx, x, y, r, r, alpha(color, .15 + rand() * .5));
    if (i % 37 === 0) { line(ctx, [[x - r * 3, y], [x + r * 3, y]], alpha(color, .34), .7); line(ctx, [[x, y - r * 4], [x, y + r * 4]], alpha(color, .4), .7); }
  }
}
function petal(ctx, x, y, size, color, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-size, -size * .7, -size * .25, -size * 1.8, 0, -size * 1.4);
  ctx.bezierCurveTo(size * .8, -size * 1.8, size, -size * .4, 0, 0); ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
function blossomBranch(ctx, x, y, angle, length, depth, rand) {
  if (depth < 0 || length < 13) return;
  const endX = x + Math.cos(angle) * length, endY = y + Math.sin(angle) * length;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(angle + .2) * length * .6, y + Math.sin(angle + .2) * length * .6, endX, endY);
  ctx.lineWidth = Math.max(.7, depth * 1.1); ctx.strokeStyle = depth > 2 ? '#263047' : '#52516b'; ctx.stroke();
  if (depth <= 2) for (let k = 0; k < 5 + depth * 2; k++) {
    const px = endX + (rand() - .5) * 46, py = endY + (rand() - .5) * 40, size = 3.5 + rand() * 5;
    for (let p = 0; p < 5; p++) petal(ctx, px, py, size, ['#a277a1', '#d5aec9', '#b896b9', '#e8ccd8'][Math.floor(rand() * 4)], p / 5 * TAU + rand() * .1);
    ellipse(ctx, px, py, 1.2, 1.2, '#eed4ca');
  }
  if (depth > 0) {
    blossomBranch(ctx, endX, endY, angle - .38 - rand() * .2, length * .69, depth - 1, rand);
    blossomBranch(ctx, endX, endY, angle + .3 + rand() * .24, length * .73, depth - 1, rand);
  }
}
function anime(ctx) {
  const rand = rng(6812);
  fill(ctx, gradient(ctx, [[0, '#172039'], [.38, '#3a4065'], [.64, '#736581'], [.82, '#3d4564'], [1, '#152a40']]));
  glow(ctx, 727, 372, 500, 650, '#b9c2dc', .24);
  const moon = ctx.createRadialGradient(751, 342, 0, 751, 342, 182);
  moon.addColorStop(0, '#dbdfdd'); moon.addColorStop(.94, '#c4cdcf'); moon.addColorStop(1, alpha('#c4cdcf', 0));
  ellipse(ctx, 751, 342, 182, 182, moon); glow(ctx, 751, 342, 245, 245, '#d2cbdc', .12);
  ctx.save(); ctx.globalAlpha = .16;
  for (let i = 0; i < 90; i++) { const a = rand() * TAU, r = Math.sqrt(rand()) * 165; ellipse(ctx, 751 + Math.cos(a) * r, 342 + Math.sin(a) * r, 5 + rand() * 26, 2 + rand() * 17, '#8fa1b5'); }
  ctx.restore();
  atmosphere(ctx, 791, '#c2acd0', .21); stars(ctx, rand, 115, '#e4dbed', 860);
  // Wispy clouds pass in front of the moon, with soft lit edges.
  for (let i = 0; i < 24; i++) {
    const y = 330 + i * 15 + rand() * 12, x = 540 + Math.sin(i * .28) * 290;
    glow(ctx, x, y, 220 + rand() * 150, 10 + rand() * 10, i % 3 ? '#796e91' : '#d1bbd1', .06);
  }
  // Distant roofs sit low, so the portrait owns the entire open sky.
  for (let plane = 0; plane < 3; plane++) {
    const base = 1060 + plane * 105;
    for (let x = -50; x < W + 80;) {
      const width = 22 + rand() * 64, height = 28 + rand() * (plane ? 85 : 110), y = base - height;
      const color = ['#60657d', '#424e69', '#283b56'][plane];
      ctx.fillStyle = color; ctx.fillRect(x, y, width, H - y);
      const roof = rand() > .35; if (roof) shape(ctx, [[x - 8, y + 2], [x + width * .5, y - 18], [x + width + 8, y + 2]], color);
      line(ctx, [[x - 3, y], [x + width + 3, y]], alpha('#aab8c3', .24), 1);
      if (rand() > .7) line(ctx, [[x + width * .6, y], [x + width * .6, y - 18]], color, 1.5);
      for (let wx = x + 7; wx < x + width - 6; wx += 10) for (let wy = y + 14; wy < base; wy += 15) {
        if (rand() > .47) { ctx.fillStyle = alpha(rand() > .7 ? '#b3d7dc' : '#e6b58c', .15 + plane * .2); ctx.fillRect(wx, wy, 3 + plane, 5); }
      }
      x += width + 3 + rand() * 9;
    }
  }
  fill(ctx, gradient(ctx, [[0, '#10213900'], [.66, '#15264000'], [1, '#152640bb']]));
  blossomBranch(ctx, -40, 198, .22, 150, 5, rand);
  blossomBranch(ctx, W + 20, 570, -2.65, 123, 4, rand);
  for (let i = 0; i < 28; i++) { const x = rand() * W, y = 390 + rand() * 830; if (x > 300 && x < 780) continue; petal(ctx, x, y, 2 + rand() * 5, alpha('#e1c7dc', .5), rand() * TAU); }
  grain(ctx, 892, 11);
}

function pixelNoise(ctx, rand, x, y, width, height, count, colors) {
  for (let i = 0; i < count; i++) { ctx.fillStyle = colors[Math.floor(rand() * colors.length)]; ctx.fillRect(Math.floor(x + rand() * width), Math.floor(y + rand() * height), rand() > .82 ? 2 : 1, 1); }
}
function pixelMountains(ctx, rand, top, color, variation) {
  const points = [[-10, 384]];
  for (let x = -10; x < 270; x += 4) points.push([x, Math.floor(top + Math.sin(x / 29) * variation + noise(x / 27, 3, 89) * variation)]);
  points.push([270, 384]); shape(ctx, points, color);
}
function pine(ctx, x, y, height, colors, rand) {
  ctx.fillStyle = colors[0]; ctx.fillRect(x - 1, y, 2, height);
  for (let level = 0; level < 7; level++) {
    const center = y + height * (.15 + level * .11), width = height * (.12 + level * .055);
    for (let row = 0; row < 5; row++) {
      ctx.fillStyle = colors[(row + level) % 3];
      ctx.fillRect(Math.round(x - width * row / 5), Math.round(center + row * 1.5), Math.round(width * row / 2.5) + 1, 2);
    }
  }
  for (let i = 0; i < 18; i++) { const py = y + rand() * height, ratio = (py - y) / height; ctx.fillStyle = colors[2]; ctx.fillRect(Math.round(x + (rand() - .5) * height * ratio * .45), Math.round(py), 1, 1); }
}
function castle(ctx, x, y, rand) {
  const stone = ['#3f496b', '#4c5477', '#576185', '#69708a'];
  const tower = (tx, ty, width, height) => {
    ctx.fillStyle = stone[0]; ctx.fillRect(tx, ty, width, height);
    ctx.fillStyle = stone[1]; ctx.fillRect(tx + 2, ty, width - 4, height);
    shape(ctx, [[tx - 2, ty], [tx + width / 2, ty - width * .95], [tx + width + 2, ty]], '#333a5c');
    line(ctx, [[tx - 1, ty], [tx + width, ty]], '#737b91', 1);
    for (let row = ty + 5; row < ty + height - 2; row += 7) for (let col = tx + 3; col < tx + width - 3; col += 5) {
      ctx.fillStyle = rand() > .84 ? '#c3b299' : '#303d5d'; ctx.fillRect(col, row, 2, 3);
    }
    pixelNoise(ctx, rand, tx, ty, width, height, 90, stone);
  };
  tower(x + 9, y + 13, 27, 49); tower(x, y + 23, 11, 40); tower(x + 35, y + 26, 13, 42);
  tower(x + 17, y - 5, 12, 27);
  ctx.fillStyle = '#af9297'; ctx.fillRect(x + 23, y - 22, 1, 11); shape(ctx, [[x + 24, y - 22], [x + 33, y - 19], [x + 24, y - 16]], '#9c7788');
}
function pixelScene(ctx) {
  const rand = rng(987);
  ctx.save(); ctx.scale(4, 4);
  ctx.fillStyle = gradient(ctx, [[0, '#182a47'], [.4, '#414766'], [.63, '#788392'], [1, '#243851']], 0, 0, 0, 384); ctx.fillRect(0, 0, 256, 384);
  for (let i = 0; i < 130; i++) { const x = Math.floor(rand() * 256), y = Math.floor(rand() * 180); ctx.fillStyle = ['#778ba4', '#b9c3bf', '#928baa'][i % 3]; ctx.fillRect(x, y, 1, 1); if (i % 31 === 0) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } }
  ellipse(ctx, 181, 67, 30, 30, '#c1c7be'); ellipse(ctx, 192, 62, 26, 27, '#293c58');
  for (let i = 0; i < 16; i++) { const y = 118 + i * 3; ctx.fillStyle = alpha('#8a92a0', .08); ctx.fillRect(Math.floor(35 + Math.sin(i * .25) * 50), y, 120, 1); }
  pixelMountains(ctx, rand, 175, '#4b6076', 14); pixelMountains(ctx, rand, 201, '#354e64', 17);
  castle(ctx, 25, 141, rand);
  pixelMountains(ctx, rand, 237, '#243e50', 14);
  for (let i = 0; i < 39; i++) { const x = Math.floor(rand() * 256), y = 231 + rand() * 26; pine(ctx, x, y - 22, 29 + rand() * 25, ['#263e50', '#2d4c5d', '#476472'], rand); }
  shape(ctx, [[118, 232], [125, 232], [139, 265], [111, 306], [139, 354], [209, 384], [128, 384], [84, 329], [116, 277], [126, 259]], '#527786');
  for (let i = 0; i < 360; i++) { const y = 247 + rand() * 137, x = 118 + Math.sin(y * .038) * (y - 218) * .21 + (rand() - .5) * (y - 225) * .15; ctx.fillStyle = i % 7 ? '#668d97' : '#9db4b1'; ctx.fillRect(Math.floor(x), Math.floor(y), 2 + Math.floor(rand() * 5), 1); }
  for (const [x, y, h] of [[4, 237, 122], [251, 251, 110], [21, 281, 98], [232, 284, 107]]) pine(ctx, x, y, h, ['#122c3b', '#234453', '#3c6370'], rand);
  for (let i = 0; i < 70; i++) { const x = rand() > .5 ? rand() * 66 : 190 + rand() * 66, y = 325 + rand() * 59; ctx.fillStyle = '#2c4e58'; ctx.fillRect(Math.floor(x), Math.floor(y), 3, 1); }
  for (const [x, y] of [[27, 314], [227, 345], [44, 358]]) { ctx.fillStyle = '#9b7ba7'; ctx.fillRect(x - 3, y - 2, 7, 3); ctx.fillStyle = '#bba2be'; ctx.fillRect(x - 1, y - 3, 3, 1); ctx.fillStyle = '#658590'; ctx.fillRect(x, y + 1, 1, 4); }
  ctx.restore();
  glow(ctx, 512, 735, 310, 530, '#93bcc3', .11);
}

function leaf(ctx, x, y, size, color, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * .5, -size * .7, size * 1.4, -size * .45, size * 1.5, 0);
  ctx.bezierCurveTo(size, size * .42, size * .4, size * .6, 0, 0); ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
function forest(ctx) {
  const rand = rng(445);
  fill(ctx, gradient(ctx, [[0, '#27524c'], [.26, '#719b87'], [.58, '#9cba99'], [.80, '#45736b'], [1, '#153c3d']]));
  glow(ctx, 566, 292, 530, 670, '#f1deac', .58);
  // Pale distant trees dissolve into the center clearing.
  for (let i = 0; i < 27; i++) {
    const x = rand() * W, width = 4 + rand() * 23;
    ctx.fillStyle = alpha('#325b5a', .07 + Math.abs(x - 512) / 512 * .10); ctx.fillRect(x, 0, width, 1110);
  }
  atmosphere(ctx, 881, '#d6e1b4', .24);
  for (const [side, shift] of [[1, -90], [-1, W + 105]]) {
    ctx.save(); ctx.translate(shift, 0); ctx.scale(side, 1);
    ctx.beginPath(); ctx.moveTo(-60, H); ctx.bezierCurveTo(60, 1200, 145, 650, 75, 90); ctx.lineTo(195, -20);
    ctx.bezierCurveTo(175, 450, 275, 790, 175, 1110); ctx.bezierCurveTo(115, 1340, 190, 1440, 280, H); ctx.closePath();
    ctx.fillStyle = gradient(ctx, [[0, '#203d3c'], [.4, '#436150'], [.72, '#304f45'], [1, '#1e3c38']], 10, 0, 210, 0); ctx.fill();
    for (let i = 0; i < 26; i++) {
      const x = 70 + rand() * 103;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x - 22, 460, x + 67, 820, x - 26, H);
      ctx.strokeStyle = alpha(i % 3 ? '#152e30' : '#a1aa78', .12); ctx.lineWidth = 1 + rand() * 3; ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const y = 90 + i * 110;
      ctx.beginPath(); ctx.moveTo(115, y + 145); ctx.bezierCurveTo(165, y + 30, 262, y + 25, 348 + rand() * 60, y - 60);
      ctx.strokeStyle = '#38594c'; ctx.lineWidth = 20 - i * 2; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }
  // Layered foliage has visible individual leaves and dappled highlights.
  for (let i = 0; i < 3700; i++) {
    const x = rand() * W, y = rand() * H;
    const edge = Math.abs(x - 512) / 512, canopy = clamp(1 - y / 460);
    const field = fbm(x / 85, y / 74, 443);
    if (field + edge * .40 + canopy * .55 < .96 || y > 1200 && edge < .7) continue;
    const sun = clamp((1 - Math.abs(x - 530) / 660) * (1 - y / 1400));
    leaf(ctx, x, y, 6 + rand() * 18, mix('#244e44', '#b1bd80', sun * .7 + rand() * .16), rand() * TAU);
    if (i % 7 === 0) line(ctx, [[x, y], [x + 6, y - 2]], alpha('#d3d4a0', .23), .7);
  }
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (const [x, width] of [[390, 60], [570, 110], [760, 37]]) shape(ctx, [[x, 0], [x + width, 0], [x - 280 + width * 3, 1250], [x - 340, 1250]], gradient(ctx, [[0, '#e5d6a518'], [.7, '#d1dbaa08'], [1, '#cad8a600']]));
  ctx.restore();
  for (let i = 0; i < 600; i++) {
    const x = rand() * W, y = 1080 + rand() * 456;
    if (x > 280 && x < 740 && y < 1300) continue;
    leaf(ctx, x, y, 7 + rand() * 19, mix('#244a45', '#698565', rand() * .8), -Math.PI / 2 + (rand() - .5) * 2);
  }
  for (let i = 0; i < 90; i++) { const x = rand() * W, y = 260 + rand() * 1000; glow(ctx, x, y, 3 + rand() * 5, 3 + rand() * 5, '#ffedb4', .25); ellipse(ctx, x, y, .6 + rand(), .6 + rand(), alpha('#fff2bf', .6)); }
  glow(ctx, 500, 760, 410, 500, '#d6e1bc', .10); grain(ctx, 624, 13);
}

function orchardTree(ctx, x, y, rand, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#6c6350'; ctx.fillRect(-2, 0, 5, 33); ctx.fillStyle = '#ac9871'; ctx.fillRect(-1, 3, 1, 26);
  line(ctx, [[0, 12], [-10, -2]], '#6c6350', 2); line(ctx, [[1, 8], [12, -5]], '#6c6350', 2);
  for (let i = 0; i < 360; i++) {
    const angle = rand() * TAU, radius = Math.sqrt(rand()), px = Math.cos(angle) * radius * 29, py = Math.sin(angle) * radius * 24 - 8;
    ctx.fillStyle = ['#69835d', '#7f965e', '#a9ac69', '#b5b76d', '#8b9d65'][Math.floor(clamp((-py + 12) / 40 + rand() * .35, 0, .99) * 5)];
    ctx.fillRect(Math.floor(px), Math.floor(py), 2 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
  }
  for (let i = 0; i < 13; i++) { const px = Math.floor((rand() - .5) * 40), py = Math.floor((rand() - .5) * 33 - 5); ctx.fillStyle = '#c09b67'; ctx.fillRect(px, py, 2, 2); ctx.fillStyle = '#e5bf7e'; ctx.fillRect(px, py, 1, 1); }
  ctx.restore();
}
function cottage(ctx, x, y, rand) {
  ctx.fillStyle = '#d6c394'; ctx.fillRect(x, y, 49, 35);
  ctx.fillStyle = '#a99d75'; ctx.fillRect(x + 36, y, 13, 35);
  shape(ctx, [[x - 6, y], [x + 18, y - 27], [x + 57, y - 2], [x + 38, y + 1]], '#956b56');
  shape(ctx, [[x - 6, y], [x + 18, y - 27], [x + 37, y]], '#ba8262');
  for (let row = 0; row < 5; row++) line(ctx, [[x - 2 + row * 4, y - row * 5], [x + 34 - row * 3, y - row * 5]], '#cd9a70', 1);
  ctx.fillStyle = '#735f4c'; ctx.fillRect(x + 17, y + 14, 10, 21);
  ctx.fillStyle = '#758775'; ctx.fillRect(x + 5, y + 10, 8, 10); ctx.fillRect(x + 33, y + 11, 8, 9);
  ctx.fillStyle = '#ead39a'; ctx.fillRect(x + 6, y + 11, 6, 5); ctx.fillRect(x + 34, y + 12, 6, 4);
  ctx.fillStyle = '#e4cf9c'; ctx.fillRect(x - 2, y + 34, 53, 3);
  ctx.fillStyle = '#987d66'; ctx.fillRect(x + 33, y - 18, 6, 13);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = alpha('#e0d3b7', .1 + rand() * .12); ctx.fillRect(x + 31 - i, y - 20 - i * 3, 4 + i, 2); }
}
function farm(ctx) {
  const rand = rng(9904); ctx.save(); ctx.scale(4, 4);
  ctx.fillStyle = gradient(ctx, [[0, '#729fae'], [.27, '#b1c9bb'], [.49, '#e6d9ac'], [.7, '#a1af7f'], [1, '#687f59']], 0, 0, 0, 384); ctx.fillRect(0, 0, 256, 384);
  ellipse(ctx, 183, 83, 26, 26, '#efdfb1');
  for (let row = 0; row < 35; row++) {
    const y = 58 + row * 2; ctx.fillStyle = alpha('#f7eccf', .12 + .08 * Math.sin(row * .2));
    ctx.fillRect(Math.floor(5 + Math.sin(row * .12) * 9), y, Math.floor(64 + Math.cos(row * .2) * 16), 1);
    if (row > 15) ctx.fillRect(181 + Math.floor(Math.sin(row * .2) * 8), y + 70, 85, 1);
  }
  pixelMountains(ctx, rand, 183, '#a0b6a1', 10); pixelMountains(ctx, rand, 199, '#849f8a', 13);
  shape(ctx, [[0, 229], [64, 216], [134, 236], [199, 227], [256, 219], [256, 384], [0, 384]], '#91a474');
  shape(ctx, [[0, 252], [51, 247], [116, 259], [184, 247], [256, 240], [256, 384], [0, 384]], '#91a26b');
  shape(ctx, [[134, 229], [139, 231], [125, 248], [143, 271], [176, 295], [194, 341], [241, 384], [209, 384], [172, 344], [160, 304], [128, 275], [111, 251]], '#9ab8aa');
  for (let i = 0; i < 330; i++) {
    const y = 237 + rand() * 147, x = 125 + (y - 242) * .62 + (rand() - .5) * 10;
    ctx.fillStyle = ['#c5ceaf', '#bad0b8', '#7c9f98'][i % 3]; ctx.fillRect(Math.floor(x), Math.floor(y), 1 + Math.floor(rand() * 6), 1);
  }
  cottage(ctx, 23, 233, rand);
  orchardTree(ctx, 13, 216, rand, 1.2); orchardTree(ctx, 247, 221, rand, 1.35);
  for (let row = 0; row < 7; row++) for (let col = 0; col < 12; col++) {
    const x = 8 + col * 7 + row * 2, y = 287 + row * 10 - col * 1.1;
    ctx.fillStyle = '#83945b'; ctx.fillRect(Math.round(x - 2), Math.round(y), 5, 2);
    ctx.fillStyle = '#b8b876'; ctx.fillRect(Math.round(x), Math.round(y - 4), 1, 6);
    ctx.fillStyle = '#d5c485'; ctx.fillRect(Math.round(x - 1), Math.round(y - 5), 3, 2);
  }
  for (let x = -4; x < 120; x += 13) { const y = 277 + x * .07; ctx.fillStyle = '#a89971'; ctx.fillRect(x, Math.round(y), 3, 15); ctx.fillStyle = '#dfc89b'; ctx.fillRect(x, Math.round(y), 1, 13); }
  line(ctx, [[0, 282], [118, 290]], '#c4b18a', 2); line(ctx, [[0, 287], [118, 295]], '#a3916c', 1);
  for (let i = 0; i < 1400; i++) {
    const x = rand() * 256, y = 306 + rand() * 78;
    if (x > 162 && x < 215 && y < 352) continue;
    ctx.fillStyle = ['#839667', '#a0aa71', '#b9b980', '#7e925f'][i % 4]; ctx.fillRect(Math.floor(x), Math.floor(y), 1, 2);
    if (i % 23 === 0) { ctx.fillStyle = i % 46 ? '#e4d4a1' : '#c4b89b'; ctx.fillRect(Math.floor(x - 1), Math.floor(y - 1), 3, 1); }
  }
  ctx.restore(); glow(ctx, 735, 382, 620, 740, '#f5dfa4', .10);
}

function archPath(ctx, x, y, width, height) {
  ctx.beginPath(); ctx.moveTo(x, y + height); ctx.lineTo(x, y + width * .7);
  ctx.bezierCurveTo(x, y + width * .32, x + width * .23, y + width * .08, x + width / 2, y);
  ctx.bezierCurveTo(x + width * .77, y + width * .08, x + width, y + width * .32, x + width, y + width * .7);
  ctx.lineTo(x + width, y + height);
}
function duel(ctx) {
  const rand = rng(899);
  fill(ctx, gradient(ctx, [[0, '#171a2b'], [.42, '#514665'], [.72, '#302b45'], [1, '#141a2c']]));
  glow(ctx, 512, 562, 540, 740, '#a6a0c8', .24);
  for (let plane = 0; plane < 4; plane++) {
    const x = 188 - plane * 49, y = 220 - plane * 71, width = 648 + plane * 98, height = 820 + plane * 82;
    archPath(ctx, x, y, width, height); ctx.strokeStyle = ['#81748e', '#584b66', '#3e374f', '#2b293c'][plane]; ctx.lineWidth = 9 + plane * 8; ctx.stroke();
    archPath(ctx, x - 8, y - 5, width + 16, height + 6); ctx.strokeStyle = alpha('#c1ac87', .28); ctx.lineWidth = 1.5; ctx.stroke();
  }
  // Slender carved columns have a directional bevel and worn inlay.
  for (const x of [76, 912]) {
    const side = x < 512 ? 1 : -1;
    ctx.fillStyle = gradient(ctx, [[0, '#252738'], [.20, '#454054'], [.46, '#736376'], [.58, '#514457'], [1, '#242537']], x, 0, x + 46, 0); ctx.fillRect(x, 255, 46, 990);
    for (let i = 0; i < 7; i++) line(ctx, [[x + 4 + i * 6, 270], [x + 4 + i * 6, 1240]], alpha(i % 2 ? '#c0ac89' : '#121723', .15), 1);
    for (const y of [249, 265, 1192, 1210, 1240]) { ctx.fillStyle = '#635666'; ctx.fillRect(x - 9, y, 64, 6); line(ctx, [[x - 9, y], [x + 55, y]], '#a4907e', 1); }
    for (let i = 0; i < 30; i++) {
      const y = 297 + i * 27;
      line(ctx, [[x + 23, y], [x + 23 + side * 10, y + 10], [x + 23, y + 20]], alpha('#b5a080', .23), 1);
    }
  }
  ctx.save(); archPath(ctx, 300, 276, 424, 670); ctx.closePath(); ctx.clip();
  fill(ctx, gradient(ctx, [[0, '#b4a4c429'], [.38, '#a79ec61a'], [1, '#40385500']]));
  for (let i = 0; i < 13; i++) line(ctx, [[320 + i * 32, 285], [320 + i * 32, 1080]], alpha('#c5b3cb', .13), 1.4);
  for (let row = 0; row < 18; row++) for (let col = 0; col < 13; col++) {
    const x = 308 + col * 32, y = 322 + row * 34;
    if ((row + col) % 3) continue;
    shape(ctx, [[x, y], [x + 16, y - 12], [x + 32, y], [x + 16, y + 12]], alpha(['#ad97bd', '#b6b3c7', '#cca77a'][col % 3], .06 + rand() * .12));
  }
  ctx.restore();
  atmosphere(ctx, 90, '#bcb0cf', .1);
  shape(ctx, [[0, 1110], [1024, 1110], [1024, 1536], [0, 1536]], gradient(ctx, [[0, '#3a334a'], [1, '#171d2d']], 0, 1090, 0, H));
  for (let i = -8; i < 9; i++) line(ctx, [[512 + i * 32, 1100], [512 + i * 152, H]], alpha('#b19d87', .10), 1);
  for (let i = 0; i < 10; i++) { const y = 1100 + i * i * 5; line(ctx, [[0, y], [W, y]], alpha('#b19d87', .08), 1); }
  for (const radius of [100, 116, 182, 188, 216, 231]) {
    ctx.beginPath(); ctx.ellipse(512, 1165, radius * 1.55, radius * .37, 0, 0, TAU); ctx.strokeStyle = alpha('#c8b49a', .12 + rand() * .08); ctx.lineWidth = radius === 182 ? 2 : 1; ctx.stroke();
  }
  for (let i = 0; i < 72; i++) {
    const angle = i / 72 * TAU; const radius = 202;
    line(ctx, [[512 + Math.cos(angle) * radius * 1.55, 1165 + Math.sin(angle) * radius * .37], [512 + Math.cos(angle) * (radius + (i % 6 ? 5 : 13)) * 1.55, 1165 + Math.sin(angle) * (radius + (i % 6 ? 5 : 13)) * .37]], alpha('#c8b49a', .22), 1);
  }
  glow(ctx, 500, 804, 285, 640, '#b7aecf', .13); glow(ctx, 505, 1144, 380, 56, '#aba0ca', .13);
  stars(ctx, rand, 190, '#d8c9b0', 1190); grain(ctx, 891, 13);
}

export function createCardSkinScene(id) {
  const painters = { anime, pixel: pixelScene, monster: forest, farm, duel };
  if (!painters[id]) throw new Error(`Unknown card scene: ${id}`);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  painters[id](ctx);
  // A quiet edge anchors the real card rim without introducing a printed frame.
  const vignette = ctx.createRadialGradient(512, 650, 320, 512, 730, 1050);
  vignette.addColorStop(0, '#06162300'); vignette.addColorStop(.72, '#06162308'); vignette.addColorStop(1, '#06162380'); fill(ctx, vignette);
  return canvas;
}
