import * as THREE from 'three';
import { blendBodyFinish, createVisualTransition, FINISH_NAMES, PATTERN_NAMES, SHINE_STYLE_NAMES, visualPatternShader, visualWeights } from './visual-effects.js';
import { fitCardLayer, fitSubject, hasNativeCardAspect, mergeAlphaBounds, scanAlphaBounds, SUBJECT_FRAMING_MODES } from './subject-fitting.js';
import { resolveCardDesign } from './cardSkins.js';
import { drawCardSkinTextBacking, drawCardSkinTypography } from './card-skin-art.js';

// The card-local foil and independent relief stack are adapted from
// RuiC-card-skill (MIT). Attribution: public/licenses/ruic-card-skill.txt.
// Unlike a parallax texture, every authored layer occupies a real Z plane.
const WIDTH = 2;
const HEIGHT = 3;
const DEFAULTS = {
  foil: 'spectrum', foilStrength: 0.65, depth: 1, paused: false, pattern: 'flow', shineStyle: 'sweep', exploded: false,
  subjectFraming: 'native', subjectScale: 1, tilt: .55, lineStrength: .15,
  skinId: 'astral', backgroundDesign: 'skin', frameDesign: 'skin', layoutDesign: 'skin', effectsDesign: 'skin', backDesign: 'skin',
  accentColor: '', artTreatment: 'skin', showFrame: true, showEffects: true, showText: true,
  title: '星间旅人', subtitle: '循光而行 · 万象入梦',
  collection: 'STARCLOUDS / PORTRAIT COLLECTION', edition: '001 / 001', name: 'ASTRAL TRAVELER', number: '001',
};
const DESIGN_PARTS = ['background', 'frame', 'layout', 'effects', 'back'];
const TEXT_FIELDS = ['title', 'subtitle', 'collection', 'edition', 'name', 'number', 'rarity', 'element', 'level', 'power', 'attack', 'defense', 'ability', 'description'];
const designTextureKey = (design) => JSON.stringify([design.skin.id, ...DESIGN_PARTS.map((part) => design[part].id), design.accentColor]);
const BODY_SURFACES = {
  astral: { roughness: .3, metalness: .84 }, anime: { roughness: .26, metalness: .78 },
  pixel: { roughness: .63, metalness: .12 }, monster: { roughness: .39, metalness: .45 },
  farm: { roughness: .72, metalness: .06 }, duel: { roughness: .48, metalness: .68 },
  dopamine: { roughness: .24, metalness: .3 }, pokemon: { roughness: .30, metalness: .62 }, arknights: { roughness: .6, metalness: .28 },
  ocean: { roughness: .23, metalness: .72 },
};

export function normalizeCardTextSettings(input = {}) {
  const normalized = { ...input };
  for (const key of TEXT_FIELDS) {
    const value = normalized[key];
    if (value == null) {
      // New fields inherit from the active layout at draw time. Persisting a
      // skin's fallback here would turn it into an unintended user override.
      if (Object.hasOwn(DEFAULTS, key)) normalized[key] = DEFAULTS[key];
      else delete normalized[key];
    } else normalized[key] = String(value).slice(0, key === 'description' ? 1000 : key === 'ability' ? 120 : 64);
  }
  return normalized;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const foilShader = `
  varying vec2 vUv;
  uniform vec3 uView;
  uniform float uStrength;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  ${visualPatternShader}
  float roundedBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
  }
  float cardDistance(vec2 uv, float inset) {
    return roundedBox((uv - .5) * vec2(2., 3.), vec2(1., 1.5) - inset, max(.009, .045 - inset));
  }
  vec3 linearColor(vec3 srgb) {
    return mix(pow((max(srgb, 0.) + .055) / 1.055, vec3(2.4)), srgb / 12.92, step(srgb, vec3(.04045)));
  }
  float coating() { return finishAmount() * uStrength; }
  vec3 film(vec2 uv) {
    float phase = uv.x * .83 + uv.y * .57 + uView.x * 1.42 - uView.y * .96;
    vec3 rainbow = .59 + .39 * cos(6.2831853 * (phase + vec3(0., .3333, .6667)));
    float glint = .5 + .5 * sin(phase * 6.2831853);
    vec3 gold = mix(vec3(.57, .32, .08), vec3(1., .88, .52), glint);
    vec3 silver = mix(vec3(.49, .56, .61), vec3(.95, .98, 1.), .5 + .5 * cos(phase * 6.2831853));
    vec3 pearl = mix(vec3(.88, .86, .81), rainbow, .35);
    vec3 color = (rainbow * uFinishes[0] + silver * uFinishes[1] + gold * uFinishes[2] + pearl * uFinishes[3] + extendedFinishColor(uv, phase)) / max(finishAmount(), .0001);
    return patternTint(uv, color);
  }
  float sweep(vec2 uv) {
    float phase = uv.x * .78 + uv.y * .40 + uView.x * 1.31 + uView.y * .69;
    return materialBand(uv, patternBand(uv, pow(.5 + .5 * sin(phase * 6.2831853), 17.)));
  }
  float microFoil(vec2 uv) {
    vec2 cells = uv * vec2(260., 390.);
    vec2 id = floor(cells);
    float seed = hash(id);
    float footprint = max(fwidth(cells.x), fwidth(cells.y));
    float resolved = 1. - smoothstep(.75, 1.8, footprint);
    float dotShape = 1. - smoothstep(.03, .21 + footprint * .3, length(fract(cells) - .5));
    float facing = pow(.5 + .5 * sin(seed * 45. + uView.x * 24. - uView.y * 18.), 22.);
    return step(.991, seed) * dotShape * facing * resolved;
  }
  vec3 laminate(vec3 print, vec2 uv, float intensity) {
    float amount = coating() * intensity;
    float band = sweep(uv);
    vec3 foil = film(uv);
    float lum = dot(print, vec3(.2126, .7152, .0722));
    // A narrow angle-dependent coating; keep the black point and fine print.
    vec3 color = print * (1. - amount * .16 * materialAbsorption() * (1. - foil) * (.12 + band * .88));
    color += foil * amount * band * (.075 + .105 * (1. - lum));
    if (uPatterns[0] > 0.) {
      float hairline = pow(.5 + .5 * sin((uv.x * .78 + uv.y * .4 + uView.x * 1.31 + uView.y * .69 + .025) * 6.2831853), 85. * materialGloss());
      color += mix(foil, vec3(1., .97, .89), .45) * amount * hairline * .045 * materialGloss() * uPatterns[0];
      color += foil * amount * microFoil(uv) * .38 * uPatterns[0];
    }
    if (uPatterns[1] > 0.) color += mix(foil, vec3(1., .98, .91), .48) * amount * starField(uv) * .38 * uPatterns[1];
    if (uPatterns[2] > 0.) color += foil * amount * auroraBand(uv) * .043 * uPatterns[2];
    float patterned = uPatterns[3] + uPatterns[4] + uPatterns[5] + uPatterns[6] + uPatterns[7] + uPatterns[8];
    color += foil * amount * band * .022 * patterned;
    color += mix(foil, vec3(1., .97, .88), .55) * amount * revealSweep(uv) * .25;
    return clamp(color, 0., 1.);
  }
`;

const artFragmentShader = `${foilShader}
  uniform sampler2D uMap, uLine;
  uniform vec2 uTexel, uMapScale, uMapOffset, uPixelStep;
  uniform vec3 uBackFill;
  uniform float uHasLine, uRole, uGloss, uLineStrength, uPixelated, uFillBack;
  void main() {
    if (cardDistance(vUv, 0.) > 0.) discard;
    vec2 artUv = vUv * uMapScale + uMapOffset;
    if (min(artUv.x, artUv.y) < 0. || max(artUv.x, artUv.y) > 1.) discard;
    vec4 art = texture2D(uMap, artUv);
    bool filledBack = uRole > 3.5 && uRole < 4.5 && uFillBack > .5;
    if (art.a < .003 && !filledBack) discard;
    // Filter the premultiplied texture to keep transparent padding from
    // darkening hair. Restore its straight color before applying the coating.
    vec3 color = art.rgb / max(art.a, .003);
    vec2 colorUv = artUv;
    if (uRole > .5 && uRole < 1.5 && uPixelated > .5) {
      colorUv = clamp((floor(artUv / uPixelStep) + .5) * uPixelStep, uTexel * .5, 1. - uTexel * .5);
      vec4 pixel = texture2D(uMap, colorUv);
      // Quantize color only. Native alpha and fine transparent edges remain intact;
      // a transparent grid center falls back to the original straight color.
      if (pixel.a >= .003) color = pixel.rgb / pixel.a;
    }
    float outputAlpha = art.a;
    if (filledBack) {
      color = color * art.a + uBackFill * (1. - art.a);
      outputAlpha = 1.;
    }
    if (uRole < .5) {
      // The quiet foot of the art provides contrast for the independent type plane.
      float foot = 1. - smoothstep(.03, .28, vUv.y);
      float head = smoothstep(.87, 1., vUv.y);
      color *= 1. - foot * .35 - head * .1;
    }
    color = laminate(color, vUv, uGloss);
    if (uRole > .5 && uRole < 1.5) {
      float inner = min(min(texture2D(uMap, artUv + vec2(uTexel.x, 0.)).a,
        texture2D(uMap, artUv - vec2(uTexel.x, 0.)).a),
        min(texture2D(uMap, artUv + vec2(0., uTexel.y)).a,
        texture2D(uMap, artUv - vec2(0., uTexel.y)).a));
      float edge = max(0., art.a - inner);
      vec4 ink = texture2D(uLine, colorUv);
      float line = (1. - smoothstep(.08, .7, dot(ink.rgb / max(ink.a, .003), vec3(.2126, .7152, .0722)))) * ink.a * uHasLine;
      color += film(vUv) * sweep(vUv) * coating() * (line * uLineStrength + edge * .14);
    }
    if (uRole > 1.5 && uRole < 2.5) color += film(vUv) * sweep(vUv) * coating() * .055;
    gl_FragColor = vec4(linearColor(clamp(color, 0., 1.)), outputAlpha);
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
  }
`;

const frameFragmentShader = `${foilShader}
  void main() {
    float outside = cardDistance(vUv, .010);
    float ring1 = 1. - smoothstep(.0004, .0025, abs(outside));
    float ring2 = 1. - smoothstep(.0002, .0018, abs(cardDistance(vUv, .033)));
    float alpha = max(ring1, ring2 * .73);
    if (alpha < .003) discard;
    float brushed = hash(vec2(floor(vUv.x * 540.), floor(vUv.y * 8.))) * .026;
    vec3 metal = finishMetal(mix(vec3(.64, .52, .30), vec3(.62, .67, .71), uFinishes[1] * .8)) + brushed;
    vec3 color = laminate(metal, vUv, 1.4);
    float engravedPhase = vUv.x * 36. - vUv.y * 54.;
    float engraving = pow(.5 + .5 * cos(engravedPhase * 6.2831853), 8.) * (1. - smoothstep(.3, .9, fwidth(engravedPhase)));
    color += (vec3(.19, .14, .065) * sweep(vUv) + film(vUv) * engraving * .10) * coating();
    gl_FragColor = vec4(linearColor(clamp(color, 0., 1.)), alpha);
    #include <colorspace_fragment>
  }
`;

const shadowFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform vec2 uTexel, uMapScale, uMapOffset;
  uniform float uOpacity;
  void main() {
    vec2 offset = uTexel * 5.;
    vec2 artUv = vUv * uMapScale + uMapOffset;
    if (min(artUv.x, artUv.y) < 0. || max(artUv.x, artUv.y) > 1.) discard;
    float alpha = texture2D(uMap, artUv).a * .36;
    alpha += texture2D(uMap, artUv + offset).a * .16;
    alpha += texture2D(uMap, artUv - offset).a * .16;
    alpha += texture2D(uMap, artUv + vec2(offset.x, -offset.y)).a * .16;
    alpha += texture2D(uMap, artUv + vec2(-offset.x, offset.y)).a * .16;
    if (alpha < .003) discard;
    gl_FragColor = vec4(.004, .012, .009, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

function bounded(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function makeCanvas(width = 1024, height = 1536) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function trackedText(ctx, text, x, y, tracking, align = 'left') {
  const characters = [...String(text)];
  const width = characters.reduce((sum, character) => sum + ctx.measureText(character).width, 0)
    + Math.max(0, characters.length - 1) * tracking;
  let offset = x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
  for (const character of characters) {
    ctx.fillText(character, offset, y);
    offset += ctx.measureText(character).width + tracking;
  }
}

function trackedTextWithin(ctx, value, x, y, tracking, align, maxWidth) {
  const text = String(value ?? '');
  const widthAt = (text, gap) => [...text].reduce((sum, character) => sum + ctx.measureText(character).width, 0) + Math.max(0, [...text].length - 1) * gap;
  if (widthAt(text, tracking) <= maxWidth) {
    trackedText(ctx, text, x, y, tracking, align);
    return;
  }
  ctx.save();
  const font = ctx.font, originalSize = Number(font.match(/([\d.]+)px/)?.[1]) || 16;
  let size = originalSize, gap = tracking;
  while (widthAt(text, gap) > maxWidth && size > 12) {
    size -= 1;
    gap = tracking * size / originalSize;
    ctx.font = font.replace(/[\d.]+px/, `${size}px`);
  }
  let fitted = text;
  if (widthAt(fitted, gap) > maxWidth) {
    const characters = [...text];
    while (characters.length && widthAt(`${characters.join('')}…`, gap) > maxWidth) characters.pop();
    fitted = characters.length ? `${characters.join('')}…` : '';
  }
  trackedText(ctx, fitted, x, y, gap, align);
  ctx.restore();
}

export function drawFrontTypography(canvas, settings) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(canvas.width / 1024, canvas.height / 1536);
  const gold = ctx.createLinearGradient(0, 1050, 0, 1470);
  gold.addColorStop(0, '#fff0c9');
  gold.addColorStop(.56, '#ddc48e');
  gold.addColorStop(1, '#aa8951');
  ctx.fillStyle = '#decda8';
  ctx.font = '500 19px Arial, sans-serif';
  trackedTextWithin(ctx, settings.name, 76, 92, 6.5, 'left', 720);
  ctx.font = '400 18px Arial, sans-serif';
  trackedTextWithin(ctx, `NO. ${settings.number}`, 948, 92, 3, 'right', 130);
  ctx.strokeStyle = 'rgba(207, 181, 120, .48)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(76, 118);
  ctx.lineTo(948, 118);
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.shadowColor = 'rgba(3, 17, 14, .8)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  const title = String(settings.title).slice(0, 64);
  let titleSize = 113;
  const titleFont = (size) => `500 ${size}px "Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif`;
  ctx.font = titleFont(titleSize);
  while (ctx.measureText(title).width + Math.max(0, [...title].length - 1) * 12 > 870 && titleSize > 44) {
    titleSize -= 2;
    ctx.font = titleFont(titleSize);
  }
  if ([...title].length <= 18) trackedText(ctx, title, 512, 1298, 12, 'center');
  else {
    let lines = [];
    for (titleSize = 64; titleSize >= 18; titleSize -= 2) {
      ctx.font = titleFont(titleSize);
      lines = [''];
      for (const character of [...title]) {
        const current = lines.at(-1), candidate = current + character;
        if (current && ctx.measureText(candidate).width + Math.max(0, [...candidate].length - 1) * 2 > 870) lines.push(character);
        else lines[lines.length - 1] = candidate;
      }
      if (lines.length <= 2) break;
    }
    lines.forEach((line, index) => trackedText(ctx, line, 512, 1298 - (lines.length - 1 - index) * titleSize * 1.13, 2, 'center'));
  }
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.font = '400 23px "Songti SC", "STSong", "Noto Serif CJK SC", serif';
  ctx.fillStyle = '#dfd7bc';
  trackedTextWithin(ctx, String(settings.subtitle).slice(0, 64), 512, 1354, 3, 'center', 872);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(207, 181, 120, .52)';
  ctx.beginPath();
  ctx.moveTo(76, 1412);
  ctx.lineTo(948, 1412);
  ctx.stroke();
  ctx.fillStyle = '#b4a584';
  ctx.font = '500 15px Arial, sans-serif';
  trackedTextWithin(ctx, settings.collection, 76, 1451, 3.4, 'left', 652);
  trackedTextWithin(ctx, settings.edition, 948, 1451, 2.5, 'right', 180);
  ctx.restore();
}

export function drawBack(canvas, settings) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(canvas.width / 1024, canvas.height / 1536);
  const background = ctx.createRadialGradient(510, 660, 20, 512, 768, 960);
  background.addColorStop(0, '#183e35');
  background.addColorStop(.6, '#0a2420');
  background.addColorStop(1, '#061814');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, 1536);
  ctx.lineWidth = 1;
  // Fine geometric engraving belongs to the designed reverse, not to the art.
  ctx.strokeStyle = 'rgba(158, 139, 88, .08)';
  for (let i = -1536; i < 1100; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 1536, 1536);
    ctx.moveTo(i, 1536);
    ctx.lineTo(i + 1536, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(186, 159, 93, .55)';
  ctx.strokeRect(56, 56, 912, 1424);
  ctx.strokeStyle = 'rgba(186, 159, 93, .22)';
  ctx.strokeRect(68, 68, 888, 1400);
  ctx.save();
  ctx.translate(512, 670);
  for (const [radius, opacity] of [[221, .2], [205, .65], [197, .3], [162, .32]]) {
    ctx.strokeStyle = `rgba(204, 177, 108, ${opacity})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 96; i += 1) {
    const angle = i / 96 * Math.PI * 2;
    const inner = i % 8 === 0 ? 211 : 217;
    ctx.strokeStyle = i % 8 === 0 ? '#a68d50' : 'rgba(184, 157, 90, .35)';
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * 226, Math.sin(angle) * 226);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i += 1) {
    ctx.save();
    ctx.rotate(i / 12 * Math.PI * 2);
    ctx.strokeStyle = 'rgba(201, 170, 99, .22)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 92, 187, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const bronze = ctx.createLinearGradient(-90, -130, 110, 145);
  bronze.addColorStop(0, '#ebd5a1');
  bronze.addColorStop(.5, '#b4934f');
  bronze.addColorStop(1, '#755e31');
  ctx.fillStyle = bronze;
  ctx.beginPath();
  ctx.arc(0, 0, 103, -.5 * Math.PI, .5 * Math.PI);
  ctx.bezierCurveTo(-28, 103, -48, 20, 0, -103);
  ctx.fill();
  ctx.strokeStyle = '#ccb279';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-82, -65);
  ctx.lineTo(-69, -17);
  ctx.lineTo(-20, -4);
  ctx.lineTo(-69, 9);
  ctx.lineTo(-82, 57);
  ctx.lineTo(-95, 9);
  ctx.lineTo(-144, -4);
  ctx.lineTo(-95, -17);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  ctx.font = '500 22px Arial, sans-serif';
  ctx.fillStyle = '#bda571';
  trackedTextWithin(ctx, settings.collection, 512, 243, 6, 'center', 872);
  ctx.font = '500 45px Georgia, serif';
  ctx.fillStyle = '#e0c99b';
  trackedTextWithin(ctx, settings.name, 512, 1045, 7, 'center', 872);
  ctx.font = '400 27px "Songti SC", "STSong", "Noto Serif CJK SC", serif';
  ctx.fillStyle = '#b8aa88';
  trackedTextWithin(ctx, settings.title, 512, 1106, 8, 'center', 872);
  ctx.fillStyle = '#93835e';
  ctx.font = '400 16px Arial, sans-serif';
  trackedTextWithin(ctx, `${settings.edition}  /  ${settings.number}`, 512, 1369, 3, 'center', 872);
  ctx.restore();
}

function roundedShape() {
  const shape = new THREE.Shape();
  const x = -WIDTH / 2;
  const y = -HEIGHT / 2;
  const r = .045;
  shape.moveTo(x + r, y);
  shape.lineTo(x + WIDTH - r, y);
  shape.quadraticCurveTo(x + WIDTH, y, x + WIDTH, y + r);
  shape.lineTo(x + WIDTH, y + HEIGHT - r);
  shape.quadraticCurveTo(x + WIDTH, y + HEIGHT, x + WIDTH - r, y + HEIGHT);
  shape.lineTo(x + r, y + HEIGHT);
  shape.quadraticCurveTo(x, y + HEIGHT, x, y + HEIGHT - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function textureFromCanvas(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = 4;
  return texture;
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('未能导出 PNG，请重试。')), 'image/png');
    } catch {
      reject(new Error('图片不允许跨域导出，请使用本站素材或本地图片。'));
    }
  });
}

async function readSubjectBounds(image, width, height, isCurrent) {
  const strip = makeCanvas(width, Math.min(128, height));
  const context = strip.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法读取主体透明范围，请重新上传本地图片。');
  let bounds = null, sinceYield = 0;
  try {
    for (let top = 0; top < height; top += strip.height) {
      if (!isCurrent()) return undefined;
      const rows = Math.min(strip.height, height - top);
      context.clearRect(0, 0, strip.width, strip.height);
      context.drawImage(image, 0, top, width, rows, 0, 0, width, rows);
      const pixels = context.getImageData(0, 0, width, rows).data;
      bounds = mergeAlphaBounds(bounds, scanAlphaBounds(pixels, width, rows, top));
      sinceYield += width * rows;
      if (sinceYield >= 1024 * 1024 && top + rows < height) {
        sinceYield = 0;
        // Native-resolution inspection stays interruptible during large uploads.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch {
    throw new Error('无法读取主体透明范围，请重新上传本地图片。');
  } finally {
    strip.width = 1;
    strip.height = 1;
  }
  if (!isCurrent()) return undefined;
  if (!bounds) throw new Error('主体图片没有可见像素，请重新上传。');
  return bounds;
}

export function createSampleReliefRenderer(container, { onReady, onError } = {}) {
  let disposed = false;
  let visible = true;
  let motionAllowed = true;
  let contextLost = false;
  let ready = false;
  let assetsReady = false;
  let shaderFailed = false;
  let generation = 0;
  let frame = 0;
  let exporting = false;
  let sourceTextures = [];
  let dimensions = null;
  let currentAssets = null;
  let framing = null;
  let framingRevision = 0;
  const viewport = { width: 1, height: 1 };
  let settings = { ...DEFAULTS };
  let requestedDesign = resolveCardDesign(settings);
  let renderedDesign = requestedDesign;
  let renderedDesignKey = designTextureKey(renderedDesign);
  let renderedTextSettings = { ...settings };
  let visuals;
  const pose = { x: 0, y: 0, flip: 0 };
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.2, 1.2, 1.8, -1.8, .1, 40);
  camera.position.set(0, 0, 8);
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  scene.add(new THREE.AmbientLight(0xffefcf, 2));
  const keyLight = new THREE.DirectionalLight(0xffe7be, 3.5);
  keyLight.position.set(-3, 5, 6);
  scene.add(keyLight);
  const edgeLight = new THREE.DirectionalLight(0xbce8df, 1.5);
  edgeLight.position.set(4, -1, -3);
  scene.add(edgeLight);
  const plane = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  const bodyGeometry = new THREE.ExtrudeGeometry(roundedShape(), {
    depth: .040, bevelEnabled: true, bevelThickness: .004, bevelSize: .003, bevelSegments: 3, curveSegments: 16,
  });
  bodyGeometry.translate(0, 0, -.047);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#706044', metalness: .84, roughness: .3 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  root.add(body);
  const emptyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  emptyTexture.needsUpdate = true;
  const shared = {
    uView: { value: new THREE.Vector3(0, 0, 1) },
    uFinishes: { value: visualWeights(FINISH_NAMES, settings.foil) },
    uPatterns: { value: visualWeights(PATTERN_NAMES, settings.pattern) },
    uShine: { value: -1 },
    uShineStyle: { value: 0 },
    uStrength: { value: settings.foilStrength },
  };
  const materials = [];
  const makeArt = (role, gloss, z, transparent = true) => {
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader: artFragmentShader,
      uniforms: {
        ...shared, uMap: { value: emptyTexture }, uLine: { value: emptyTexture },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1536) },
        uMapScale: { value: new THREE.Vector2(1, 1) }, uMapOffset: { value: new THREE.Vector2(0, 0) },
        uPixelStep: { value: new THREE.Vector2(1 / 128, 1 / 192) }, uPixelated: { value: 0 },
        uFillBack: { value: 0 }, uBackFill: { value: new THREE.Color('#061814').convertLinearToSRGB() },
        uLineStrength: { value: settings.lineStrength },
        uRole: { value: role }, uGloss: { value: gloss }, uHasLine: { value: 0 },
      },
      transparent, depthWrite: !transparent, side: THREE.FrontSide, premultipliedAlpha: true,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(plane, material);
    mesh.position.z = z;
    mesh.renderOrder = role + 2;
    root.add(mesh);
    return mesh;
  };
  const background = makeArt(0, 1, .002, false);
  const subject = makeArt(1, .56, .114);
  const effects = makeArt(2, .95, .185);
  effects.visible = false;
  const text = makeArt(3, .76, .236);
  const frameOverlay = makeArt(5, 1.05, .2055);
  frameOverlay.renderOrder = 4.5;
  frameOverlay.visible = false;
  const back = makeArt(4, .78, -.052, false);
  back.rotation.y = Math.PI;
  back.renderOrder = 0;
  const frameMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: frameFragmentShader, uniforms: shared,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  materials.push(frameMaterial);
  const frontFrame = new THREE.Mesh(plane, frameMaterial);
  frontFrame.position.z = .014;
  frontFrame.renderOrder = 1;
  root.add(frontFrame);
  const backFrame = new THREE.Mesh(plane, frameMaterial);
  backFrame.position.z = -.053;
  backFrame.rotation.y = Math.PI;
  backFrame.renderOrder = 1;
  root.add(backFrame);
  const shadowMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: shadowFragmentShader,
    uniforms: {
      uMap: { value: emptyTexture }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1536) }, uOpacity: { value: .18 },
      uMapScale: subject.material.uniforms.uMapScale, uMapOffset: subject.material.uniforms.uMapOffset,
    },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  materials.push(shadowMaterial);
  const subjectShadow = new THREE.Mesh(plane, shadowMaterial);
  subjectShadow.position.set(.012, -.020, .006);
  subjectShadow.renderOrder = 2;
  root.add(subjectShadow);
  const textCanvas = makeCanvas();
  const backCanvas = makeCanvas();
  const textTexture = textureFromCanvas(textCanvas);
  const backTexture = textureFromCanvas(backCanvas);
  text.material.uniforms.uMap.value = textTexture;
  back.material.uniforms.uMap.value = backTexture;
  const inverse = new THREE.Quaternion();
  const setReady = (value) => {
    if (ready === value) return;
    ready = value;
    onReady?.(value);
  };
  const fail = (message) => {
    setReady(false);
    onError?.(message);
  };
  const updatePose = () => {
    const tilt = settings.tilt / .55;
    root.rotation.set(-pose.y * .38 * tilt, pose.x * .48 * tilt + pose.flip, 0, 'YXZ');
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(inverse).invert();
    shared.uView.value.set(0, 0, 1).applyQuaternion(inverse).normalize();
  };
  const render = () => {
    frame = 0;
    if (disposed || !visible || document.hidden || contextLost || exporting) return;
    try {
      renderer.render(scene, camera);
      if (shaderFailed) fail('当前设备无法显示样卡材质，请更新浏览器后重试。');
    } catch {
      fail('3D 预览暂时中断，请重新打开样卡。');
    }
  };
  const requestRender = () => {
    if (!frame && !disposed && visible && !document.hidden && !contextLost && !exporting) frame = requestAnimationFrame(render);
  };
  const fitCamera = (width, height, exportMode = false) => {
    const aspect = width / Math.max(1, height);
    const spread = visuals?.values.spread || 0;
    const farthestPlane = text.position.z;
    // Enclose the actual separated stack through a full turn, including narrow screens.
    const halfWidth = Math.max(exportMode ? 1.1 : 1.16, Math.hypot(1, farthestPlane) + .075 * spread);
    const halfHeight = Math.max((exportMode ? 1.65 : 1.73) + spread * .055, Math.hypot(1.5, farthestPlane) + .025 * spread, halfWidth / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };
  const resize = () => {
    if (disposed || exporting) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    viewport.width = width;
    viewport.height = height;
    renderer.setSize(width, height, false);
    fitCamera(width, height);
    requestRender();
  };
  const typography = () => {
    if (!drawCardSkinTypography(textCanvas, renderedDesign.layout.id, renderedTextSettings)) drawFrontTypography(textCanvas, renderedTextSettings);
    if (renderedDesign.layout.id !== renderedDesign.frame.id) drawCardSkinTextBacking(textCanvas, renderedDesign.layout.id, renderedTextSettings);
    // Imported backs are independent textures; the legacy canvas remains available
    // when the user returns to the original card back.
    drawBack(backCanvas, renderedTextSettings);
    textTexture.needsUpdate = true;
    backTexture.needsUpdate = true;
  };
  const applyVisibility = () => {
    const textures = currentAssets?.textures || {};
    const showFrame = settings.showFrame !== false;
    frameOverlay.visible = showFrame && Boolean(textures.frame);
    frontFrame.visible = showFrame && renderedDesign.frame.id === 'astral' && !textures.frame;
    backFrame.visible = showFrame && renderedDesign.back.id === 'astral' && !textures.back;
    effects.visible = settings.showEffects !== false && Boolean(textures.effects);
    text.visible = settings.showText !== false;
    subject.material.uniforms.uPixelated.value = renderedDesign.pixelated ? 1 : 0;
  };
  const applyMap = (mesh, mapping) => {
    mesh.material.uniforms.uMapScale.value.set(mapping.uvScale.x, mapping.uvScale.y);
    mesh.material.uniforms.uMapOffset.value.set(mapping.uvOffset.x, mapping.uvOffset.y);
  };
  const applyFraming = () => {
    if (!currentAssets) return;
    const source = currentAssets.sourceDimensions.subject;
    framing = fitSubject({ ...source, framing: settings.subjectFraming, subjectScale: settings.subjectScale, alphaBounds: currentAssets.alphaBounds, artworkRect: renderedDesign.artworkRect });
    applyMap(subject, framing);
    const backdrop = currentAssets.sourceDimensions.background;
    applyMap(background, fitCardLayer(backdrop.width, backdrop.height, 'cover'));
    const front = currentAssets.sourceDimensions.effects;
    if (front) applyMap(effects, fitCardLayer(front.width, front.height, 'contain'));
    const overlay = currentAssets.sourceDimensions.frame;
    if (overlay) applyMap(frameOverlay, fitCardLayer(overlay.width, overlay.height, 'contain'));
    const reverse = currentAssets.sourceDimensions.back;
    applyMap(back, reverse ? fitCardLayer(reverse.width, reverse.height, 'cover') : fitCardLayer(1024, 1536));
    const canvasSize = settings.subjectFraming === 'native' ? source : { width: 1024, height: 1536 };
    dimensions = { ...canvasSize };
    if (textCanvas.width !== canvasSize.width || textCanvas.height !== canvasSize.height) {
      textCanvas.width = canvasSize.width;
      textCanvas.height = canvasSize.height;
      backCanvas.width = canvasSize.width;
      backCanvas.height = canvasSize.height;
      typography();
    }
  };
  const ensureSubjectBounds = async (record, isCurrent) => {
    const { width, height } = record.sourceDimensions.subject;
    if (settings.subjectFraming === 'auto' && !hasNativeCardAspect(width, height) && record.alphaBounds === undefined) {
      const bounds = await readSubjectBounds(record.textures.subject.image, width, height, isCurrent);
      if (bounds !== undefined) record.alphaBounds = bounds;
    }
  };
  const refreshFraming = async () => {
    if (!currentAssets || !assetsReady || disposed) return;
    const record = currentAssets, revision = ++framingRevision;
    const isCurrent = () => !disposed && assetsReady && currentAssets === record && revision === framingRevision;
    try {
      const source = record.sourceDimensions.subject;
      if (settings.subjectFraming === 'auto' && !hasNativeCardAspect(source.width, source.height) && record.alphaBounds === undefined) {
        setReady(false);
        await ensureSubjectBounds(record, isCurrent);
      }
      if (!isCurrent()) return;
      applyFraming();
      setReady(assetsReady && !contextLost && !shaderFailed);
      requestRender();
    } catch (error) {
      if (isCurrent()) fail(error.message || '主体画面适配失败，请重新上传。');
    }
  };
  const installAssets = (record) => {
    const { textures, sourceDimensions } = record;
    for (const [key, mesh] of Object.entries({ subject, background, effects, frame: frameOverlay })) {
      const texture = textures[key];
      mesh.material.uniforms.uMap.value = texture || emptyTexture;
      const size = sourceDimensions[key];
      if (size) mesh.material.uniforms.uTexel.value.set(1 / size.width, 1 / size.height);
    }
    subject.material.uniforms.uLine.value = textures.lineart || emptyTexture;
    subject.material.uniforms.uHasLine.value = textures.lineart ? 1 : 0;
    const block = Math.max(1, Math.round(Math.max(sourceDimensions.subject.width, sourceDimensions.subject.height) / 128));
    subject.material.uniforms.uPixelStep.value.set(block / sourceDimensions.subject.width, block / sourceDimensions.subject.height);
    back.material.uniforms.uMap.value = textures.back || backTexture;
    back.material.uniforms.uFillBack.value = textures.back ? 1 : 0;
    back.material.uniforms.uBackFill.value.set(renderedDesign.back.palette.base).convertLinearToSRGB();
    if (sourceDimensions.back) back.material.uniforms.uTexel.value.set(1 / sourceDimensions.back.width, 1 / sourceDimensions.back.height);
    shadowMaterial.uniforms.uMap.value = textures.subject;
    shadowMaterial.uniforms.uTexel.value.set(1 / sourceDimensions.subject.width, 1 / sourceDimensions.subject.height);
    applyFraming();
    typography();
    applyVisibility();
  };
  const updateDepth = () => {
    const depth = visuals?.values.depth ?? settings.depth;
    const spread = visuals?.values.spread || 0;
    const relief = depth * (1 + 1.6 * spread) + (1 - Math.min(1, depth)) * spread;
    subject.position.z = .014 + .10 * relief;
    effects.position.z = .015 + .17 * relief;
    text.position.z = .016 + .21 * relief;
    frameOverlay.position.z = (effects.position.z + text.position.z) / 2;
    subjectShadow.position.x = .012 * Math.min(2, relief);
    subjectShadow.position.y = -.020 * Math.min(2, relief);
    shadowMaterial.uniforms.uOpacity.value = .18 * Math.min(1, relief) * (1 - spread * .55);
  };
  const bodyPalette = ['#706044', '#706044', '#706044', '#706044', '#706044', '#a66d65', '#759aa9', '#302d3f', '#929c88'].map((color) => new THREE.Color(color));
  bodyPalette[1].lerp(new THREE.Color('#687579'), .8);
  const bodyTint = new THREE.Color();
  const applySkinBody = (values) => {
    const surface = BODY_SURFACES[renderedDesign.skin.id] || BODY_SURFACES.astral;
    blendBodyFinish(bodyMaterial, values, bodyPalette, surface.roughness, surface.metalness);
    if (renderedDesign.skin.id !== 'astral' || renderedDesign.accentColor) {
      bodyTint.set(renderedDesign.accentColor || renderedDesign.skin.palette.border);
      bodyMaterial.color.lerp(bodyTint, .72);
      bodyMaterial.roughness = Math.max(.06, Math.min(.95, bodyMaterial.roughness));
      bodyMaterial.metalness = Math.max(0, Math.min(1, bodyMaterial.metalness));
    }
  };
  visuals = createVisualTransition({
    initial: settings,
    onUpdate(values) {
      if (disposed) return;
      FINISH_NAMES.forEach((_, index) => { shared.uFinishes.value[index] = values[`finish${index}`]; });
      PATTERN_NAMES.forEach((_, index) => { shared.uPatterns.value[index] = values[`pattern${index}`]; });
      shared.uStrength.value = values.strength;
      shared.uShine.value = values.shine;
      shared.uShineStyle.value = values.shineStyle;
      applySkinBody(values);
      updateDepth();
      if (!exporting) fitCamera(viewport.width, viewport.height);
      requestRender();
    },
  });
  const syncMotion = () => visuals.setActive(motionAllowed && visible && !contextLost && !settings.paused);
  renderer.debug.onShaderError = () => { shaderFailed = true; };
  const lost = (event) => {
    event.preventDefault();
    contextLost = true;
    syncMotion();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    fail('3D 预览已暂停；显卡连接恢复后会自动重试。');
  };
  const restored = () => {
    if (disposed) return;
    contextLost = false;
    syncMotion();
    shaderFailed = false;
    try {
      renderer.compile(scene, camera);
      setReady(assetsReady && !shaderFailed);
      requestRender();
    } catch {
      fail('3D 预览未能恢复，请重新打开样卡。');
    }
  };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  renderer.domElement.addEventListener('webglcontextrestored', restored);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  typography();
  updateDepth();
  updatePose();
  resize();

  return {
    async setImages(assets = {}) {
      if (disposed) return false;
      const version = ++generation;
      const ticketDesignKey = designTextureKey(requestedDesign);
      framingRevision += 1;
      assetsReady = false;
      setReady(false);
      // Keep the previous complete card visible during replacement; it cannot export
      // until this version validates, and the first load still starts hidden.
      requestRender();
      // Local blob URLs arrive after the source selection. This intermediate
      // empty state cancels older work without reporting a failed card.
      if (!assets.subject) return false;
      if (!assets.background) {
        fail('卡片素材尚未就绪，需要主体和背景图。');
        return false;
      }
      const entries = Object.entries({ subject: assets.subject, background: assets.background, effects: assets.effects, lineart: assets.lineart, frame: assets.frame, back: assets.back }).filter(([, url]) => Boolean(url));
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      const loaded = await Promise.allSettled(entries.map(([, url]) => loader.loadAsync(url)));
      const successful = loaded.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      if (disposed || version !== generation || ticketDesignKey !== designTextureKey(requestedDesign)) {
        successful.forEach((texture) => texture.dispose());
        return false;
      }
      if (loaded.some((result) => result.status === 'rejected')) {
        successful.forEach((texture) => texture.dispose());
        fail('样卡图层加载失败，请检查素材后重试。');
        return false;
      }
      const previousAssets = currentAssets;
      const previousDesign = renderedDesign, previousDesignKey = renderedDesignKey, previousTextSettings = renderedTextSettings;
      let nextAssets;
      try {
        const textures = Object.fromEntries(entries.map(([key], index) => [key, loaded[index].value]));
        const sourceDimensions = {};
        for (const [key, texture] of Object.entries(textures)) {
          const imageWidth = texture.image.naturalWidth || texture.image.width;
          const imageHeight = texture.image.naturalHeight || texture.image.height;
          if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth < 1 || imageHeight < 1) throw new Error('卡片图片尺寸无效。');
          sourceDimensions[key] = { width: imageWidth, height: imageHeight };
          texture.colorSpace = THREE.NoColorSpace;
          texture.premultiplyAlpha = true;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
          texture.needsUpdate = true;
        }
        const source = sourceDimensions.subject, line = sourceDimensions.lineart;
        if (line && (source.width !== line.width || source.height !== line.height)) {
          throw new Error('线稿像素尺寸必须与透明主体完全一致，未载入不匹配的图层。');
        }
        nextAssets = { textures, sourceDimensions, alphaBounds: undefined, designKey: ticketDesignKey };
        const isCurrent = () => !disposed && version === generation && ticketDesignKey === designTextureKey(requestedDesign);
        await ensureSubjectBounds(nextAssets, isCurrent);
        if (!isCurrent()) {
          successful.forEach((texture) => texture.dispose());
          return false;
        }
        renderedDesign = requestedDesign;
        renderedDesignKey = ticketDesignKey;
        renderedTextSettings = { ...settings };
        currentAssets = nextAssets;
        installAssets(nextAssets);
        applySkinBody(visuals.values);
        updateDepth();
        root.visible = true;
        shaderFailed = false;
        renderer.compile(scene, camera);
        if (shaderFailed) throw new Error('当前设备无法显示样卡材质，请更新浏览器后重试。');
        const previous = sourceTextures;
        sourceTextures = successful;
        previous.forEach((texture) => texture.dispose());
        assetsReady = true;
        setReady(!contextLost);
        requestRender();
        return !contextLost;
      } catch (error) {
        successful.forEach((texture) => texture.dispose());
        if (disposed || version !== generation) return false;
        if (currentAssets === nextAssets) {
          currentAssets = previousAssets;
          renderedDesign = previousDesign;
          renderedDesignKey = previousDesignKey;
          renderedTextSettings = previousTextSettings;
          if (previousAssets) {
            try { installAssets(previousAssets); applySkinBody(visuals.values); } catch { root.visible = false; }
          } else {
            root.visible = false;
            framing = null;
            dimensions = null;
            for (const mesh of [subject, background, effects, frameOverlay]) mesh.material.uniforms.uMap.value = emptyTexture;
            subject.material.uniforms.uLine.value = emptyTexture;
            subject.material.uniforms.uHasLine.value = 0;
            shadowMaterial.uniforms.uMap.value = emptyTexture;
            effects.visible = false;
            frameOverlay.visible = false;
            back.material.uniforms.uMap.value = backTexture;
            back.material.uniforms.uFillBack.value = 0;
          }
        }
        fail(error.message || '样卡加载失败。');
        requestRender();
        return false;
      }
    },
    setPose(next = {}) {
      if (disposed) return;
      pose.x = bounded(next.x, -1, 1, pose.x);
      pose.y = bounded(next.y, -1, 1, pose.y);
      pose.flip = bounded(next.flip, -Math.PI * 20, Math.PI * 20, pose.flip);
      updatePose();
      requestRender();
    },
    setSettings(next = {}) {
      if (disposed) return;
      const old = settings;
      const oldDesignKey = designTextureKey(requestedDesign);
      const oldArtworkRect = renderedDesign.artworkRect;
      settings = {
        ...settings, ...next,
        foil: FINISH_NAMES.includes(next.foil) ? next.foil : settings.foil,
        pattern: PATTERN_NAMES.includes(next.pattern) ? next.pattern : settings.pattern,
        shineStyle: SHINE_STYLE_NAMES.includes(next.shineStyle) ? next.shineStyle : settings.shineStyle,
        foilStrength: bounded(next.foilStrength, 0, 1, settings.foilStrength),
        depth: bounded(next.depth, 0, 2, settings.depth),
        subjectFraming: SUBJECT_FRAMING_MODES.includes(next.subjectFraming) ? next.subjectFraming : settings.subjectFraming,
        subjectScale: bounded(next.subjectScale, .75, 1.2, settings.subjectScale),
        tilt: bounded(next.tilt, 0, 1, settings.tilt),
        lineStrength: bounded(next.lineStrength, 0, 1, settings.lineStrength),
        exploded: next.exploded === undefined ? settings.exploded : Boolean(next.exploded),
      };
      requestedDesign = resolveCardDesign(settings);
      settings = normalizeCardTextSettings(settings);
      const nextDesignKey = designTextureKey(requestedDesign);
      if (nextDesignKey !== oldDesignKey) {
        // Wait for one matching asset ticket before committing a new layout/skin.
        // The previous complete design remains visible, with all exports disabled.
        generation += 1;
        framingRevision += 1;
        assetsReady = false;
        setReady(false);
      }
      const designMatches = nextDesignKey === renderedDesignKey;
      if (designMatches) renderedDesign = requestedDesign;
      syncMotion();
      visuals.setTargets(settings);
      if (designMatches && (TEXT_FIELDS.some((key) => old[key] !== settings[key]) || old.showFrame !== settings.showFrame)) {
        renderedTextSettings = { ...settings };
        typography();
      }
      subject.material.uniforms.uLineStrength.value = settings.lineStrength;
      if (designMatches && (old.subjectFraming !== settings.subjectFraming || old.subjectScale !== settings.subjectScale
        || ['x', 'y', 'width', 'height'].some((key) => oldArtworkRect[key] !== renderedDesign.artworkRect[key]))) void refreshFraming();
      applyVisibility();
      updateDepth();
      updatePose();
      requestRender();
    },
    setVisible(next) {
      visible = Boolean(next);
      syncMotion();
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (visible) requestRender();
    },
    setMotionAllowed(next) {
      motionAllowed = Boolean(next);
      syncMotion();
    },
    shine() { return ready && !contextLost && visuals.shine(); },
    async exportPng() {
      if (disposed || !ready || contextLost) throw new Error('样卡尚未就绪，暂时无法导出。');
      if (exporting) throw new Error('正在导出，请稍候。');
      exporting = true;
      const version = generation;
      const pixelRatio = renderer.getPixelRatio();
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(1600, 2400, false);
        fitCamera(1600, 2400, true);
        renderer.render(scene, camera);
        const blob = await canvasPng(renderer.domElement);
        if (disposed || contextLost || version !== generation) throw new Error('样卡已变化，请重新导出。');
        return blob;
      } finally {
        exporting = false;
        if (!disposed) {
          renderer.setPixelRatio(pixelRatio);
          resize();
        }
      }
    },
    async exportTextPng() {
      if (disposed || !ready) throw new Error('样卡尚未就绪，暂时无法导出文字层。');
      const version = generation;
      const blob = await canvasPng(textCanvas);
      if (disposed || !ready || version !== generation) throw new Error('卡片设计已变化，请重新导出文字层。');
      return blob;
    },
    getState() {
      return {
        ready, dimensions: dimensions ? { ...dimensions } : null, pose: { ...pose },
        skinId: renderedDesign.skin.id, requestedSkinId: requestedDesign.skin.id,
        design: Object.fromEntries(DESIGN_PARTS.map((part) => [part, renderedDesign[part].id])),
        designReady: assetsReady && renderedDesignKey === designTextureKey(requestedDesign),
        pixelated: subject.material.uniforms.uPixelated.value > .5,
        sourceDimensions: currentAssets ? Object.fromEntries(Object.entries(currentAssets.sourceDimensions).map(([key, size]) => [key, { ...size }])) : null,
        framing: framing ? { ...framing, uvScale: { ...framing.uvScale }, uvOffset: { ...framing.uvOffset }, sourceBounds: { ...framing.sourceBounds }, displayBounds: { ...framing.displayBounds }, artworkRect: { ...framing.artworkRect } } : null,
        layerDepths: { background: background.position.z, subject: subject.position.z, effects: effects.position.z, text: text.position.z },
        auxiliaryLayerDepths: { frame: frameOverlay.position.z, back: back.position.z },
        layerVisibility: { background: background.visible, subject: subject.visible, effects: effects.visible, text: text.visible, frame: frameOverlay.visible || frontFrame.visible, back: back.visible },
        hasFrame: Boolean(currentAssets?.textures.frame), hasBack: Boolean(currentAssets?.textures.back),
        hasEffects: effects.visible, pattern: settings.pattern, exploded: settings.exploded, ...visuals.snapshot(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      visuals.dispose();
      generation += 1;
      framingRevision += 1;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.domElement.removeEventListener('webglcontextrestored', restored);
      sourceTextures.forEach((texture) => texture.dispose());
      textTexture.dispose();
      backTexture.dispose();
      emptyTexture.dispose();
      materials.forEach((material) => material.dispose());
      bodyMaterial.dispose();
      bodyGeometry.dispose();
      plane.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
