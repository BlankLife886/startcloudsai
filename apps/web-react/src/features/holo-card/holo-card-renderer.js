import * as THREE from 'three';
import { blendBodyFinish, createVisualTransition, FINISH_NAMES, PATTERN_NAMES, SHINE_STYLE_NAMES, visualPatternShader, visualWeights } from './visual-effects.js';

const CARD_WIDTH = 2;
const CARD_HEIGHT = 3;
const ART_WIDTH = 1.82;
const ART_HEIGHT = 2.32;
const ART_Y = 0.205;
const PARALLAX_FACTOR = 0.1;
const PARALLAX_LIMIT = 0.035;
const MAX_SUBJECT_SCALE = 1.2;

const vertexShader = `
  uniform vec2 uFilmScale;
  uniform vec2 uFilmOffset;
  varying vec2 vUv;
  varying vec2 vCardUv;
  varying vec3 vNormal;
  varying vec3 vEye;
  void main() {
    vUv = uv;
    vCardUv = uv * uFilmScale + uFilmOffset;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vEye = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const foilFunctions = `
  uniform float uStrength;
  uniform vec3 uView;
  varying vec2 vUv;
  varying vec2 vCardUv;
  varying vec3 vNormal;
  varying vec3 vEye;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  ${visualPatternShader}
  float roundedBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
  }
  float inside(vec2 uv) {
    return step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  }
  // Adapted from RuiC-card-skill (MIT); see public/licenses/ruic-card-skill.txt.
  vec2 parallax(float depth) {
    return clamp(uView.xy / max(abs(uView.z), 0.4) * depth * ${PARALLAX_FACTOR}, vec2(-${PARALLAX_LIMIT}), vec2(${PARALLAX_LIMIT}));
  }
  float foilAmount(float intensity) {
    return finishAmount() * uStrength * intensity;
  }
  vec3 film(vec2 uv) {
    float phase = uv.x * 0.85 + uv.y * 0.55 + uView.x * 1.5 - uView.y * 0.9;
    vec3 spectrum = 0.66 + 0.25 * cos(6.2831853 * (phase + vec3(0.0, 0.33, 0.67)));
    vec3 silver = vec3(dot(spectrum, vec3(0.2126, 0.7152, 0.0722)));
    float shift = (0.5 + 0.5 * sin(phase * 6.2831853)) * 0.7;
    shift += (0.5 + 0.5 * cos((phase + 0.25) * 6.2831853)) * 0.3;
    vec3 gold = mix(vec3(0.49, 0.25, 0.06), vec3(1.0, 0.81, 0.38), shift);
    vec3 pearl = mix(vec3(0.8, 0.82, 0.79), spectrum, 0.38);
    vec3 color = (spectrum * uFinishes[0] + silver * uFinishes[1] + gold * uFinishes[2] + pearl * uFinishes[3] + extendedFinishColor(uv, phase)) / max(finishAmount(), .0001);
    return patternTint(uv, color);
  }
  float sweep(vec2 uv) {
    float phase = uv.x * 0.72 + uv.y * 0.45 + uView.x * 1.2 + uView.y * 0.6;
    return materialBand(uv, patternBand(uv, pow(0.5 + 0.5 * sin(phase * 6.2831853), 10.0)));
  }
  float microFlakes(vec2 uv) {
    vec2 cell = uv * vec2(210.0, 315.0);
    float seed = hash(floor(cell));
    float footprint = max(fwidth(cell.x), fwidth(cell.y));
    float resolved = 1.0 - smoothstep(0.28, 0.85, footprint);
    float speck = 1.0 - smoothstep(0.08, 0.3 + footprint * 0.5, length(fract(cell) - 0.5));
    float glint = pow(0.5 + 0.5 * sin(seed * 30.0 + uView.x * 20.0 - uView.y * 14.0), 10.0);
    return step(0.991, seed) * speck * glint * resolved;
  }
  vec3 laminate(vec3 color, vec2 uv, float intensity) {
    vec3 foil = film(uv);
    float amount = foilAmount(intensity);
    float band = sweep(uv);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 light = normalize(vec3(-0.35, 0.7, 1.7));
    float gloss = pow(max(dot(reflect(-light, normal), normalize(vEye)), 0.0), 65.0 * materialGloss());
    // Low-energy linear-light coating preserves the underlying print and alpha edges.
    color *= 1.0 - amount * 0.18 * materialAbsorption() * (1.0 - foil) * (0.2 + band * 0.8);
    color += foil * amount * band * (0.007 + 0.023 * (1.0 - luminance));
    color += vec3(1.0, 0.99, 0.95) * amount * gloss * 0.047 * materialGloss();
    if (uPatterns[0] > 0.) color += foil * amount * microFlakes(uv) * 0.055 * uPatterns[0];
    if (uPatterns[1] > 0.) color += mix(foil, vec3(1., .98, .91), .42) * amount * starField(uv) * .19 * uPatterns[1];
    if (uPatterns[2] > 0.) color += foil * amount * auroraBand(uv) * .038 * uPatterns[2];
    float patterned = uPatterns[3] + uPatterns[4] + uPatterns[5] + uPatterns[6] + uPatterns[7] + uPatterns[8];
    color += foil * amount * band * .044 * patterned;
    color += mix(foil, vec3(1., .97, .88), .55) * amount * revealSweep(uv) * .16;
    return color;
  }
`;

const baseFragmentShader = `
  uniform vec3 uBackground;
  ${foilFunctions}
  void main() {
    vec2 p = (vUv - 0.5) * vec2(2.0, 3.0);
    if (roundedBox(p, vec2(1.0, 1.5), 0.035) > 0.0) discard;
    float noise = hash(floor(vUv * 2200.0)) - 0.5;
    vec3 color = uBackground * (0.72 + vUv.y * 0.24) + noise * 0.012;
    color = laminate(color, vCardUv, 0.85);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const artFragmentShader = `
  uniform sampler2D uMap;
  uniform sampler2D uLineart;
  uniform vec2 uFit;
  uniform float uDepth;
  uniform float uHasLineart;
  uniform float uLineStrength;
  uniform float uGloss;
  ${foilFunctions}
  void main() {
    vec2 artUv = (vUv - 0.5 + parallax(uDepth)) / uFit + 0.5;
    if (inside(artUv) < 0.5) discard;
    vec4 art = texture2D(uMap, clamp(artUv, 0.0, 1.0));
    if (art.a < 0.003) discard;
    vec3 color = laminate(art.rgb, vCardUv, uGloss);
    if (uHasLineart > 0.5) {
      vec4 ink = texture2D(uLineart, clamp(artUv, 0.0, 1.0));
      float line = (1.0 - smoothstep(0.06, 0.65, dot(ink.rgb, vec3(0.2126, 0.7152, 0.0722)))) * ink.a;
      color += film(vCardUv) * sweep(vCardUv) * foilAmount(uLineStrength) * line * 0.035;
    }
    gl_FragColor = vec4(color, art.a);
    #include <colorspace_fragment>
  }
`;

const frameFragmentShader = `
  ${foilFunctions}
  void main() {
    vec2 p = (vUv - 0.5) * vec2(2.0, 3.0);
    float outer = roundedBox(p, vec2(1.0, 1.5), 0.035);
    float inner = roundedBox(p, vec2(0.975, 1.475), 0.022);
    if (outer > 0.0 || inner < 0.0) discard;
    float edge = smoothstep(-0.014, -0.002, outer);
    float brushed = hash(vec2(floor(vUv.x * 540.0), floor(vUv.y * 8.0))) * 0.025;
    vec3 metal = finishMetal(mix(vec3(0.51, 0.59, 0.64), vec3(0.64, 0.43, 0.15), uFinishes[2]));
    vec3 color = laminate(metal * (0.74 + edge * 0.5) + brushed, vCardUv, 1.0);
    float engravingPhase = vUv.x * 38. - vUv.y * 57.;
    float engraved = pow(.5 + .5 * sin(engravingPhase * 6.2831853), 7.) * (1. - smoothstep(.3, .9, fwidth(engravingPhase)));
    color += film(vCardUv) * foilAmount(.08) * engraved;
    color += vec3(.13, .12, .1) * foilAmount(1.) * edge * pow(sweep(vCardUv), 3.);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const backFragmentShader = `
  uniform sampler2D uMap;
  ${foilFunctions}
  void main() {
    vec2 p = (vUv - 0.5) * vec2(2.0, 3.0);
    if (roundedBox(p, vec2(1.0, 1.5), 0.035) > 0.0) discard;
    vec3 art = texture2D(uMap, vec2(1.0 - vUv.x, vUv.y)).rgb;
    gl_FragColor = vec4(laminate(art, vCardUv, 0.65), 1.0);
    #include <colorspace_fragment>
  }
`;

export function cardLocalParallax(view, depth) {
  const x = Number.isFinite(view?.x) ? view.x : 0;
  const y = Number.isFinite(view?.y) ? view.y : 0;
  const z = Number.isFinite(view?.z) ? view.z : 1;
  const length = Math.hypot(x, y, z) || 1;
  const denominator = Math.max(Math.abs(z / length), 0.4);
  const amount = range(depth, -0.56, 0.56, 0) * PARALLAX_FACTOR / denominator;
  return {
    x: range(x / length * amount, -PARALLAX_LIMIT, PARALLAX_LIMIT, 0),
    y: range(y / length * amount, -PARALLAX_LIMIT, PARALLAX_LIMIT, 0),
  };
}

export function containDimensions(width, height, maxWidth = ART_WIDTH, maxHeight = ART_HEIGHT) {
  if (!(width > 0) || !(height > 0)) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

export function cardCameraDistance(aspect, fov = 33) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return Math.max(3.55, 2.5 / safeAspect) / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
}

function roundedShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function drawFittedText(context, value, x, y, maxWidth, initialSize, maxLines, weight) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!text) return;
  const chars = Array.from(text);
  let lines = [];
  let size = initialSize;
  for (; size >= 18; size -= 2) {
    context.font = `${weight} ${size}px Inter, "PingFang SC", "Microsoft YaHei", sans-serif`;
    lines = [''];
    for (const char of chars) {
      const last = lines.length - 1;
      if (context.measureText(lines[last] + char).width > maxWidth && lines[last]) lines.push(char);
      else lines[last] += char;
    }
    if (lines.length <= maxLines) break;
  }
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = visible[maxLines - 1];
    while (last && context.measureText(`${last}...`).width > maxWidth) last = last.slice(0, -1);
    visible[maxLines - 1] = `${last}...`;
  }
  visible.forEach((line, index) => context.fillText(line, x, y + index * size * 1.2));
}

function createTitleTexture(title, subtitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const shade = ctx.createLinearGradient(0, 0, 0, canvas.height);
  shade.addColorStop(0, 'rgba(12, 17, 22, 0)');
  shade.addColorStop(0.22, 'rgba(12, 17, 22, 0.65)');
  shade.addColorStop(1, 'rgba(12, 17, 22, 0.94)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(214, 231, 229, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(70, 74);
  ctx.lineTo(1466, 74);
  ctx.stroke();
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f2f7f5';
  drawFittedText(ctx, title, 70, 105, 1396, 74, 2, 600);
  ctx.fillStyle = '#b6cac7';
  drawFittedText(ctx, subtitle, 72, 293, 1390, 34, 1, 400);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBackTexture(title, subtitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 2304;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.fillStyle = '#e7eeeb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#7c9089';
  ctx.lineWidth = 2;
  ctx.strokeRect(66, 66, 1404, 2172);
  ctx.strokeStyle = '#a6b7b0';
  ctx.lineWidth = 1;
  ctx.strokeRect(82, 82, 1372, 2140);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#465b53';
  ctx.font = '500 34px Inter, "PingFang SC", sans-serif';
  ctx.fillText('STARCLOUDS', 768, 192);
  ctx.strokeStyle = '#8ea29a';
  ctx.beginPath();
  ctx.moveTo(676, 330);
  ctx.lineTo(860, 330);
  ctx.moveTo(676, 1770);
  ctx.lineTo(860, 1770);
  ctx.stroke();
  ctx.fillStyle = '#364d44';
  ctx.font = '400 360px Georgia, "Times New Roman", serif';
  ctx.fillText('SC', 768, 784);
  ctx.fillStyle = '#72897e';
  ctx.font = '400 25px Inter, sans-serif';
  ctx.fillText('HOLOGRAPHIC EDITION', 768, 1230);
  ctx.fillStyle = '#32493f';
  drawFittedText(ctx, title || 'STARCLOUDS', 768, 1470, 1180, 76, 2, 500);
  ctx.fillStyle = '#61796d';
  drawFittedText(ctx, subtitle, 768, 1900, 1180, 38, 2, 400);
  ctx.font = '400 24px Inter, sans-serif';
  ctx.fillText('ART / LIGHT / DEPTH', 768, 2130);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createHoloCardRenderer(container, { onReady = () => {}, onError = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '立体镭射闪卡画布');
  canvas.setAttribute('role', 'img');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
  const card = new THREE.Group();
  scene.add(card);
  scene.add(new THREE.HemisphereLight(0xf3ffff, 0x343941, 2.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 4);
  keyLight.position.set(-3, 4, 6);
  scene.add(keyLight);
  const edgeLight = new THREE.DirectionalLight(0x8ce5dc, 2);
  edgeLight.position.set(3, -1, 2);
  scene.add(edgeLight);

  const viewUniform = { value: new THREE.Vector3(0, 0, 1) };
  const inverseCardMatrix = new THREE.Matrix4();
  const strengthUniform = { value: 0.6 };
  const commonUniforms = {
    uView: viewUniform, uStrength: strengthUniform,
    uFinishes: { value: visualWeights(FINISH_NAMES, 'pearl') },
    uPatterns: { value: visualWeights(PATTERN_NAMES, 'flow') },
    uShine: { value: -1 },
    uShineStyle: { value: 0 },
    uFilmScale: { value: new THREE.Vector2(1, 1) },
    uFilmOffset: { value: new THREE.Vector2(0, 0) },
  };
  const artworkUniforms = () => ({
    ...commonUniforms,
    uFilmScale: { value: new THREE.Vector2(ART_WIDTH / CARD_WIDTH, ART_HEIGHT / CARD_HEIGHT) },
    uFilmOffset: { value: new THREE.Vector2((1 - ART_WIDTH / CARD_WIDTH) / 2, (1 - ART_HEIGHT / CARD_HEIGHT) / 2 + ART_Y / CARD_HEIGHT) },
    uMap: { value: null },
    uLineart: { value: null },
    uHasLineart: { value: 0 },
    uLineStrength: { value: 0.15 },
    uFit: { value: new THREE.Vector2(1, 1) },
    uDepth: { value: 0 },
    uGloss: { value: 0.75 },
  });
  const plane = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
  const bodyGeometry = new THREE.ExtrudeGeometry(roundedShape(1.986, 2.986, 0.028), {
    depth: 0.037, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, steps: 1, curveSegments: 10,
  });
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x555d60, metalness: 0.85, roughness: 0.29 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.z = -0.05;
  card.add(body);

  const baseMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: baseFragmentShader,
    uniforms: { ...commonUniforms, uBackground: { value: new THREE.Color('#20332e') } },
  });
  const base = new THREE.Mesh(plane, baseMaterial);
  card.add(base);

  const backMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: backFragmentShader,
    uniforms: { ...commonUniforms, uMap: { value: createBackTexture('', '') } },
    side: THREE.BackSide,
  });
  const back = new THREE.Mesh(plane, backMaterial);
  back.position.z = -0.058;
  card.add(back);

  const artMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: artFragmentShader,
    uniforms: artworkUniforms(),
    transparent: true, depthWrite: false,
  });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(ART_WIDTH, ART_HEIGHT), artMaterial);
  art.visible = false;
  art.renderOrder = 2;
  art.position.y = ART_Y;
  card.add(art);

  const backgroundMaterial = artMaterial.clone();
  backgroundMaterial.uniforms = artworkUniforms();
  backgroundMaterial.uniforms.uGloss.value = 0.85;
  const background = new THREE.Mesh(art.geometry, backgroundMaterial);
  background.visible = false;
  background.position.set(0, ART_Y, 0.009);
  background.renderOrder = 1;
  card.add(background);

  const frameMaterial = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: frameFragmentShader, uniforms: commonUniforms,
    transparent: true, depthWrite: false,
  });
  const frame = new THREE.Mesh(plane, frameMaterial);
  frame.renderOrder = 3;
  card.add(frame);

  const titleMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.46), titleMaterial);
  titleMesh.position.y = -1.23;
  titleMesh.renderOrder = 4;
  card.add(titleMesh);

  let disposed = false;
  let visible = true;
  let motionAllowed = true;
  let contextLost = false;
  let frameRequest = 0;
  let loaded = false;
  let imageGeneration = 0;
  let settings = { foil: 'pearl', pattern: 'flow', shineStyle: 'sweep', exploded: false, foilStrength: .6, depth: .5 };
  let mode = 'original';
  let pose = { x: 0, y: 0, flip: 0 };
  let titleKey = '';
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const size = { width: 1, height: 1 };
  const textures = new Set();
  const bodyPalette = ['#687579', '#687579', '#997532', '#687579', '#687579', '#a66d65', '#759aa9', '#302d3f', '#929c88'].map((color) => new THREE.Color(color));
  const visuals = createVisualTransition({ initial: settings, onUpdate: applyVisualState });

  function applyVisualState(values) {
    if (disposed) return;
    FINISH_NAMES.forEach((_, index) => { commonUniforms.uFinishes.value[index] = values[`finish${index}`]; });
    PATTERN_NAMES.forEach((_, index) => { commonUniforms.uPatterns.value[index] = values[`pattern${index}`]; });
    commonUniforms.uShine.value = values.shine;
    commonUniforms.uShineStyle.value = values.shineStyle;
    strengthUniform.value = values.strength;
    blendBodyFinish(bodyMaterial, values, bodyPalette, .29, .85);
    updateDepth();
    fitCamera(size.width / size.height);
    requestRender();
  }

  function syncMotion() {
    visuals.setActive(motionAllowed && visible && !contextLost && !settings.paused);
  }

  function updateView() {
    card.updateMatrixWorld(true);
    camera.getWorldPosition(viewUniform.value);
    viewUniform.value.applyMatrix4(inverseCardMatrix.copy(card.matrixWorld).invert()).normalize();
  }

  function render(force = false) {
    if (disposed || contextLost || (!force && (!visible || document.hidden))) return;
    updateView();
    renderer.render(scene, camera);
  }

  function requestRender() {
    if (frameRequest || disposed || contextLost || !visible || document.hidden) return;
    frameRequest = requestAnimationFrame(() => {
      frameRequest = 0;
      render();
    });
  }

  function fitCamera(aspect) {
    camera.aspect = aspect;
    camera.position.set(0, 0, cardCameraDistance(aspect) + visuals.values.spread * .38);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  function resize() {
    if (disposed) return;
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    size.width = Math.max(1, Math.round(rect.width));
    size.height = Math.max(1, Math.round(rect.height));
    renderer.setSize(size.width, size.height, false);
    fitCamera(size.width / size.height);
    requestRender();
  }

  function setPose(nextPose = {}) {
    if (disposed) return;
    pose = {
      x: range(nextPose.x, -1, 1, 0),
      y: range(nextPose.y, -1, 1, 0),
      flip: Number.isFinite(nextPose.flip) ? nextPose.flip : 0,
    };
    const tilt = clamp(settings.tilt, 0.6);
    card.rotation.x = -pose.y * tilt * 0.42;
    card.rotation.y = pose.flip + pose.x * tilt * 0.48;
    card.rotation.z = -pose.x * pose.y * tilt * 0.018;
    requestRender();
  }

  function updateDepth() {
    const layered = mode === 'layered';
    const depth = layered ? clamp(visuals.values.depth, 0.5) : 0;
    const spread = visuals.values.spread;
    const subjectDepth = layered ? depth * 0.56 : 0;
    const backgroundDepth = layered ? range(settings.backgroundDepth, -0.5, 0, -0.2) : 0;
    artMaterial.uniforms.uDepth.value = subjectDepth;
    backgroundMaterial.uniforms.uDepth.value = backgroundDepth;
    // Inspection separates the existing authored planes without resampling their images.
    background.position.z = .009 + spread * .018;
    art.position.z = 0.024 + depth * 0.018 + spread * .14;
    frame.position.z = 0.05 + spread * .24;
    titleMesh.position.z = 0.055 + spread * .35;
    artMaterial.uniforms.uGloss.value = layered ? 0.55 : 0.75;
    artMaterial.uniforms.uLineStrength.value = clamp(settings.lineStrength, 0.15);

    const maxShift = Math.min(PARALLAX_LIMIT, Math.max(Math.abs(subjectDepth), Math.abs(backgroundDepth)) * PARALLAX_FACTOR / 0.4);
    const safeArea = 1 - 2 * (maxShift + 0.012);
    const subjectScale = range(settings.subjectScale, 0.75, MAX_SUBJECT_SCALE, 1);
    for (const [material, scale] of [[artMaterial, subjectScale], [backgroundMaterial, 1]]) {
      const texture = material.uniforms.uMap.value;
      if (!texture) continue;
      const dimensions = containDimensions(texture.image.width, texture.image.height);
      const fit = safeArea * (layered && material === artMaterial ? scale / MAX_SUBJECT_SCALE : 1);
      material.uniforms.uFit.value.set(dimensions.width / ART_WIDTH * fit, dimensions.height / ART_HEIGHT * fit);
    }
  }

  function setSettings(next) {
    if (disposed) return;
    settings = { ...settings, ...next };
    settings.foil = FINISH_NAMES.includes(settings.foil) ? settings.foil : 'pearl';
    settings.pattern = PATTERN_NAMES.includes(settings.pattern) ? settings.pattern : 'flow';
    settings.shineStyle = SHINE_STYLE_NAMES.includes(settings.shineStyle) ? settings.shineStyle : 'sweep';
    settings.depth = clamp(settings.depth, .5);
    settings.foilStrength = clamp(settings.foilStrength, .6);
    settings.exploded = Boolean(settings.exploded);
    syncMotion();
    visuals.setTargets(settings);
    if (/^#[0-9a-f]{6}$/i.test(settings.background || '')) baseMaterial.uniforms.uBackground.value.set(settings.background);
    const nextTitleKey = JSON.stringify([settings.title || '', settings.subtitle || '']);
    if (nextTitleKey !== titleKey) {
      titleKey = nextTitleKey;
      titleMaterial.map?.dispose();
      titleMaterial.map = createTitleTexture(settings.title, settings.subtitle);
      titleMaterial.needsUpdate = true;
      titleMesh.visible = Boolean(settings.title || settings.subtitle);
      backMaterial.uniforms.uMap.value?.dispose();
      backMaterial.uniforms.uMap.value = createBackTexture(settings.title, settings.subtitle);
    }
    updateDepth();
    setPose(pose);
  }

  function releaseTexture(texture) {
    if (!texture) return;
    textures.delete(texture);
    texture.dispose();
  }

  async function loadTexture(url) {
    if (!url) return null;
    const texture = await loader.loadAsync(url);
    if (disposed) {
      texture.dispose();
      return null;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    textures.add(texture);
    return texture;
  }

  function clearArtwork() {
    releaseTexture(artMaterial.uniforms.uMap.value);
    releaseTexture(artMaterial.uniforms.uLineart.value);
    releaseTexture(backgroundMaterial.uniforms.uMap.value);
    artMaterial.uniforms.uMap.value = null;
    artMaterial.uniforms.uLineart.value = null;
    artMaterial.uniforms.uHasLineart.value = 0;
    backgroundMaterial.uniforms.uMap.value = null;
    art.visible = false;
    background.visible = false;
    loaded = false;
  }

  async function setImages({ sourceUrl, subjectUrl, backgroundUrl, lineartUrl, mode: nextMode } = {}) {
    if (disposed) return;
    const generation = ++imageGeneration;
    loaded = false;
    onReady(false);
    const layered = nextMode === 'layered' && Boolean(subjectUrl);
    const imageUrl = layered ? subjectUrl : sourceUrl;
    if (!imageUrl) {
      clearArtwork();
      render();
      return;
    }
    // Each result is disposed independently, including partial or stale loads.
    const results = await Promise.allSettled([
      loadTexture(imageUrl),
      loadTexture(layered ? backgroundUrl : null),
      loadTexture(layered ? lineartUrl : null),
    ]);
    const newTextures = results.map((result) => result.status === 'fulfilled' ? result.value : null);
    if (disposed || generation !== imageGeneration || results.some((result) => result.status === 'rejected')) {
      newTextures.forEach(releaseTexture);
      if (!disposed && generation === imageGeneration) {
        clearArtwork();
        onError('图片或线稿无法载入预览，请重新上传本地图片。');
        render();
      }
      return;
    }
    const [artTexture, backgroundTexture, lineartTexture] = newTextures;
    const invalidSize = newTextures.some((texture) => texture && (!(texture.image.width > 0) || !(texture.image.height > 0)));
    const misalignedLineart = lineartTexture && (!artTexture || lineartTexture.image.width !== artTexture.image.width || lineartTexture.image.height !== artTexture.image.height);
    if (!artTexture || invalidSize || misalignedLineart) {
      newTextures.forEach(releaseTexture);
      clearArtwork();
      onError(misalignedLineart ? '线稿像素尺寸必须与透明主体完全一致，未载入不匹配的图层。' : '图片没有可用的像素尺寸，请重新上传。');
      render();
      return;
    }
    clearArtwork();
    artMaterial.uniforms.uMap.value = artTexture;
    artMaterial.uniforms.uLineart.value = lineartTexture;
    artMaterial.uniforms.uHasLineart.value = lineartTexture ? 1 : 0;
    backgroundMaterial.uniforms.uMap.value = backgroundTexture;
    mode = layered ? 'layered' : 'original';
    art.visible = Boolean(artTexture);
    background.visible = Boolean(backgroundTexture);
    loaded = Boolean(artTexture);
    updateDepth();
    render();
    onReady(loaded && !contextLost);
  }

  async function exportPng() {
    if (disposed || contextLost || !loaded) throw new Error('闪卡尚未就绪，请稍后重试。');
    const previousRatio = renderer.getPixelRatio();
    const snapshot = document.createElement('canvas');
    const exportScale = Math.min(1, renderer.capabilities.maxTextureSize / 2400);
    snapshot.width = Math.round(1600 * exportScale);
    snapshot.height = Math.round(2400 * exportScale);
    const context = snapshot.getContext('2d');
    if (!context) throw new Error('无法创建导出画布。');
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(snapshot.width, snapshot.height, false);
      fitCamera(snapshot.width / snapshot.height);
      render(true);
      context.drawImage(canvas, 0, 0);
    } finally {
      renderer.setPixelRatio(previousRatio);
      renderer.setSize(size.width, size.height, false);
      fitCamera(size.width / size.height);
      render();
    }
    return new Promise((resolve, reject) => snapshot.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('PNG 导出失败，请重试。')), 'image/png',
    ));
  }

  const onContextLost = (event) => {
    event.preventDefault();
    contextLost = true;
    syncMotion();
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    onReady(false);
    onError('图形渲染已中断，请刷新页面后重试。');
  };
  const onContextRestored = () => {
    contextLost = false;
    syncMotion();
    render();
    onReady(loaded);
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  return {
    setPose, setSettings, setImages, exportPng,
    shine() { return loaded && !contextLost && visuals.shine(); },
    setMotionAllowed(next) {
      motionAllowed = Boolean(next);
      syncMotion();
    },
    getState() {
      return {
        ready: loaded && !contextLost, pose: { ...pose }, pattern: settings.pattern,
        exploded: settings.exploded, ...visuals.snapshot(),
        layerDepths: { background: background.position.z, subject: art.position.z, frame: frame.position.z, text: titleMesh.position.z },
      };
    },
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      syncMotion();
      if (!visible && frameRequest) cancelAnimationFrame(frameRequest);
      if (!visible) frameRequest = 0;
      if (visible) requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      visuals.dispose();
      if (frameRequest) cancelAnimationFrame(frameRequest);
      imageGeneration += 1;
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      textures.forEach((texture) => texture.dispose());
      textures.clear();
      titleMaterial.map?.dispose();
      backMaterial.uniforms.uMap.value?.dispose();
      const geometries = new Set();
      const materials = new Set();
      card.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

function clamp(value, fallback) {
  return range(value, 0, 1, fallback);
}

function range(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
