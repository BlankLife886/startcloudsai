import * as gsapModule from 'gsap';
import { FINISHES, PATTERNS, SHINE_STYLES } from './holoVisualCatalog.js';

// GSAP exposes its core through different wrappers in Node and Vite.
const gsap = gsapModule.gsap || gsapModule.default?.gsap || gsapModule.default;
export const FINISH_NAMES = Object.freeze(FINISHES.map(({ id }) => id));
export const PATTERN_NAMES = Object.freeze(PATTERNS.map(({ id }) => id));
export const SHINE_STYLE_NAMES = Object.freeze(SHINE_STYLES.map(({ id }) => id));

export function visualWeights(names, selected, fallback = names[0]) {
  const current = names.includes(selected) ? selected : fallback;
  return names.map((name) => name === current ? 1 : 0);
}

// All channels share a linear color blend, so the physical card edge follows the
// coating without snapping during multi-way material transitions.
export function blendBodyFinish(material, values, palette, roughness = .3, metalness = .85) {
  let red = 0, green = 0, blue = 0;
  for (let index = 0; index < FINISH_NAMES.length; index++) {
    const color = palette[index], weight = values[`finish${index}`];
    red += color.r * weight; green += color.g * weight; blue += color.b * weight;
  }
  material.color.setRGB(red, green, blue);
  material.roughness = roughness + values.finish5 * .1 - values.finish6 * .12 - values.finish7 * .18 + values.finish8 * .08;
  material.metalness = metalness + values.finish5 * .03 - values.finish6 * .36 - values.finish7 * .2 - values.finish8 * .43;
}

const numeric = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Interruptible finite transitions. There is no idle ticker or render loop here. */
export function createVisualTransition({
  initial = {}, onUpdate = () => {}, animate = (target, options) => gsap.to(target, options),
  motionQuery = typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)'),
  visibilityDocument = typeof document === 'undefined' ? null : document,
} = {}) {
  const values = {
    strength: numeric(initial.foilStrength, 0, 1, .6),
    depth: numeric(initial.depth, 0, 2, .5),
    spread: initial.exploded ? 1 : 0,
    shine: -1,
    shineStyle: Math.max(0, SHINE_STYLE_NAMES.indexOf(initial.shineStyle)),
  };
  visualWeights(FINISH_NAMES, initial.foil, 'pearl').forEach((weight, index) => { values[`finish${index}`] = weight; });
  visualWeights(PATTERN_NAMES, initial.pattern).forEach((weight, index) => { values[`pattern${index}`] = weight; });
  const target = { ...values };
  let selectedFinish = FINISH_NAMES.includes(initial.foil) ? initial.foil : 'pearl';
  let selectedPattern = PATTERN_NAMES.includes(initial.pattern) ? initial.pattern : 'flow';
  let selectedShineStyle = SHINE_STYLE_NAMES[values.shineStyle];
  const tweens = new Map();
  let active = true;
  let disposed = false;
  let shining = false;
  const allowed = () => active && !disposed && !motionQuery?.matches && !visibilityDocument?.hidden;
  const publish = () => { if (!disposed) onUpdate(values); };

  function kill(channel) {
    tweens.get(channel)?.kill();
    tweens.delete(channel);
  }

  function settle() {
    for (const tween of tweens.values()) tween.kill();
    tweens.clear();
    Object.assign(values, target, { shine: -1 });
    shining = false;
    publish();
  }

  function transition(channel, next, duration) {
    if (Object.keys(next).every((key) => target[key] === next[key])) return;
    kill(channel);
    Object.assign(target, next);
    if (!allowed()) {
      Object.assign(values, next);
      publish();
      return;
    }
    // gsap.to starts at the currently displayed blend after a rapid retarget.
    const tween = animate(values, {
      ...next, duration, ease: 'power2.inOut', overwrite: false,
      onUpdate: publish,
      onComplete() {
        if (disposed || tweens.get(channel) !== tween) return;
        tweens.delete(channel);
        Object.assign(values, next);
        publish();
      },
    });
    tweens.set(channel, tween);
  }

  const preferenceChanged = () => {
    if (!allowed()) settle();
    else publish();
  };
  motionQuery?.addEventListener?.('change', preferenceChanged);
  if (!motionQuery?.addEventListener) motionQuery?.addListener?.(preferenceChanged);
  visibilityDocument?.addEventListener?.('visibilitychange', preferenceChanged);

  return {
    values,
    setTargets(next = {}) {
      if (disposed) return;
      if (FINISH_NAMES.includes(next.foil)) selectedFinish = next.foil;
      if (PATTERN_NAMES.includes(next.pattern)) selectedPattern = next.pattern;
      if (SHINE_STYLE_NAMES.includes(next.shineStyle) && selectedShineStyle !== next.shineStyle) {
        selectedShineStyle = next.shineStyle;
        target.shineStyle = SHINE_STYLE_NAMES.indexOf(selectedShineStyle);
        // A style choice applies on the next trigger, preserving an in-flight shape.
        if (!shining) {
          values.shineStyle = target.shineStyle;
          publish();
        }
      }
      const finish = visualWeights(FINISH_NAMES, selectedFinish);
      const pattern = visualWeights(PATTERN_NAMES, selectedPattern);
      transition('finish', Object.fromEntries(finish.map((weight, index) => [`finish${index}`, weight])), .56);
      transition('pattern', Object.fromEntries(pattern.map((weight, index) => [`pattern${index}`, weight])), .66);
      transition('strength', { strength: numeric(next.foilStrength, 0, 1, target.strength) }, .42);
      transition('relief', { depth: numeric(next.depth, 0, 2, target.depth), spread: next.exploded === undefined ? target.spread : next.exploded ? 1 : 0 }, .82);
    },
    setActive(next) {
      if (disposed) return;
      const wasActive = active;
      active = Boolean(next);
      if (!allowed() && (wasActive || tweens.size || shining)) settle();
    },
    shine() {
      if (!allowed()) return false;
      kill('shine');
      values.shine = 0;
      values.shineStyle = target.shineStyle;
      shining = true;
      publish();
      const tween = animate(values, {
        shine: 1, duration: selectedShineStyle === 'sweep' ? .86 : 1.02, ease: 'power1.inOut', overwrite: false,
        onUpdate: publish,
        onComplete() {
          if (disposed || tweens.get('shine') !== tween) return;
          tweens.delete('shine');
          values.shine = -1;
          values.shineStyle = target.shineStyle;
          shining = false;
          publish();
        },
      });
      tweens.set('shine', tween);
      return true;
    },
    snapshot() {
      return {
        finishWeights: Object.freeze(Object.fromEntries(FINISH_NAMES.map((name, index) => [name, values[`finish${index}`]]))),
        patternWeights: Object.freeze(Object.fromEntries(PATTERN_NAMES.map((name, index) => [name, values[`pattern${index}`]]))),
        shining, shineStyle: selectedShineStyle, activeShineStyle: SHINE_STYLE_NAMES[values.shineStyle],
        shineProgress: values.shine, motionAllowed: allowed(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      shining = false;
      values.shine = -1;
      for (const tween of tweens.values()) tween.kill();
      tweens.clear();
      motionQuery?.removeEventListener?.('change', preferenceChanged);
      if (!motionQuery?.removeEventListener) motionQuery?.removeListener?.(preferenceChanged);
      visibilityDocument?.removeEventListener?.('visibilitychange', preferenceChanged);
    },
  };
}

/** Additional coating families share card UVs, so registered image layers stay aligned. */
export const visualPatternShader = `
  uniform float uFinishes[${FINISH_NAMES.length}];
  uniform float uPatterns[${PATTERN_NAMES.length}];
  uniform float uShine;
  uniform float uShineStyle;

  float finishAmount() { return 1. - uFinishes[4]; }

  float filteredRidge(float phase, float width) {
    float footprint = max(fwidth(phase), .001);
    float distanceToLine = abs(fract(phase + .5) - .5);
    return (1. - smoothstep(width, width + footprint, distanceToLine))
      * (1. - smoothstep(.25, .7, footprint));
  }

  float cloudNoise(vec2 p) {
    vec2 cell = floor(p), fraction = fract(p);
    vec2 blend = fraction * fraction * (3. - 2. * fraction);
    return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), blend.x),
      mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1., 1.)), blend.x), blend.y);
  }

  float nebulaCloud(vec2 uv) {
    vec2 p = uv * vec2(3.6, 5.4) + uView.xy * vec2(.27, -.23);
    // Two bounded noise octaves give a soft mineral/cloud structure without a loop.
    return cloudNoise(p) * .66 + cloudNoise(p * 2.1 + 11.3) * .34;
  }

  float prismFacets(vec2 uv) {
    vec2 cell = uv * vec2(13., 19.5);
    vec2 id = floor(cell), local = fract(cell);
    float diagonal = local.x - local.y;
    float aa = max(fwidth(diagonal), .005);
    float triangle = smoothstep(-aa, aa, diagonal);
    float seed = mix(hash(id + 3.1), hash(id + 13.7), triangle);
    float facing = .5 + .5 * sin(seed * 12.5 + uView.x * 12. - uView.y * 8.);
    float edge = 1. - smoothstep(.012, .025 + aa, abs(diagonal));
    return (.07 + pow(facing, 5.) * .8 + edge * .1) * (1. - smoothstep(.65, 1.5, length(fwidth(cell))));
  }

  float rippleBand(vec2 uv) {
    vec2 p = (uv - vec2(.48, .53)) * vec2(1., 1.5) + uView.xy * .035;
    float phase = length(p) * 12. - uView.x * 1.7 + uView.y * .9;
    float wave = .5 + .5 * cos(phase * 6.2831853);
    return pow(wave, 5.) * (1. - smoothstep(.22, .7, fwidth(phase)));
  }

  float guillocheLines(vec2 uv) {
    vec2 p = (uv - .5) * vec2(1., 1.5);
    float radius = length(p);
    float angle = atan(p.y, p.x + .00001);
    float phase = radius * 23. + sin(angle * 8.) * .52 + uView.x * .43 - uView.y * .24;
    float crossed = radius * 19. - sin(angle * 8. + .55) * .67;
    return min(1., filteredRidge(phase, .055) + filteredRidge(crossed, .043) * .6)
      * smoothstep(.022, .07, radius);
  }

  float silkSheen(vec2 uv) {
    float weave = uv.x + sin(uv.y * 5.7 + uView.x * 1.4) * .085;
    float fiber = filteredRidge(weave * 92. + uv.y * 3.1, .1);
    float sheen = pow(.5 + .5 * sin(weave * 9. + uView.x * 5.3 - uView.y * 2.7), 4.);
    return sheen * (.38 + fiber * .62);
  }

  float diffractionBand(vec2 uv) {
    float diagonal = uv.x * .82 + uv.y * .55 + uView.x * .043 - uView.y * .027;
    float grating = filteredRidge(diagonal * 66., .16);
    float envelope = .22 + .78 * pow(.5 + .5 * sin(uv.y * 5.4 + uView.x * 3.8), 4.);
    return grating * envelope;
  }

  // Derivative-aware star disks stay quiet when the physical flakes become subpixel.
  float starField(vec2 uv) {
    vec2 cells = uv * vec2(72., 108.);
    vec2 id = floor(cells);
    float seed = hash(id + 7.);
    vec2 center = vec2(hash(id + 13.), hash(id + 29.)) * .5 + .25;
    vec2 local = fract(cells) - center;
    float aa = max(length(fwidth(cells)), .018);
    float visible = 1. - smoothstep(.95, 2., aa);
    float disk = 1. - smoothstep(.036, .055 + aa * .65, length(local));
    float turn = .5 + .5 * sin(seed * 37. + uView.x * 19. - uView.y * 13.);
    float glint = pow(turn, 12.);
    float cross = (1. - smoothstep(.012, .024 + aa * .45, min(abs(local.x), abs(local.y))))
      * (1. - smoothstep(.03, .23, max(abs(local.x), abs(local.y))));
    return step(.81, seed) * visible * (disk * (.28 + glint * .72) + cross * glint * .22);
  }

  float auroraPhase(vec2 uv) {
    float curve = sin(uv.y * 5.4 + uView.x * 1.6) * .19;
    curve += sin(uv.y * 10.5 - uv.x * 1.7 + uView.y * 2.1) * .045;
    return (uv.x + curve + uv.y * .21 + uView.x * .43 - uView.y * .24) * 3.4;
  }

  float auroraBand(vec2 uv) {
    float phase = auroraPhase(uv);
    float wave = .5 + .5 * cos(phase * 6.2831853);
    float resolved = 1. - smoothstep(.12, .48, fwidth(phase));
    return pow(wave, 5.) * resolved;
  }

  float patternBand(vec2 uv, float flow) {
    float result = flow * uPatterns[0];
    // Uniform branches skip inactive families; every active contribution still fades
    // continuously with its weight, including interrupted multi-family transitions.
    if (uPatterns[1] > 0.) result += (.12 + starField(uv) * .88) * uPatterns[1];
    if (uPatterns[2] > 0.) result += auroraBand(uv) * uPatterns[2];
    if (uPatterns[3] > 0.) result += prismFacets(uv) * uPatterns[3];
    if (uPatterns[4] > 0.) result += rippleBand(uv) * uPatterns[4];
    if (uPatterns[5] > 0.) result += guillocheLines(uv) * uPatterns[5];
    if (uPatterns[6] > 0.) result += silkSheen(uv) * uPatterns[6];
    if (uPatterns[7] > 0.) result += smoothstep(.35, .78, nebulaCloud(uv)) * .8 * uPatterns[7];
    if (uPatterns[8] > 0.) result += diffractionBand(uv) * uPatterns[8];
    return result;
  }

  vec3 patternTint(vec2 uv, vec3 flow) {
    // Metallic finishes retain their own pigment; the spectral finish carries most color.
    float chroma = uFinishes[0] + uFinishes[3] * .4 + uFinishes[6] * .25 + uFinishes[8] * .75;
    vec3 color = flow;
    if (uPatterns[2] > 0.) {
      vec3 aurora = .60 + .36 * cos(6.2831853 * (auroraPhase(uv) * .22 + vec3(.02, .28, .53)));
      color += (aurora - flow) * chroma * .82 * uPatterns[2];
    }
    if (uPatterns[3] > 0.) {
      float seed = hash(floor(uv * vec2(13., 19.5)) + 3.1);
      vec3 prism = .59 + .37 * cos(6.2831853 * (seed + uView.x * .33 + vec3(0., .34, .67)));
      color += (prism - flow) * chroma * .72 * uPatterns[3];
    }
    if (uPatterns[7] > 0.) {
      vec3 nebula = mix(vec3(.22, .76, .81), vec3(.81, .35, .88), nebulaCloud(uv));
      color += (nebula - flow) * chroma * .78 * uPatterns[7];
    }
    if (uPatterns[8] > 0.) {
      float phase = (uv.x * .82 + uv.y * .55) * 6.8 + uView.x * 1.3;
      vec3 diffraction = .55 + .42 * cos(6.2831853 * (phase + vec3(0., .333, .667)));
      color += (diffraction - flow) * chroma * .86 * uPatterns[8];
    }
    return color;
  }

  vec3 extendedFinishColor(vec2 uv, float phase) {
    vec3 color = vec3(0.);
    if (uFinishes[5] > 0.) {
      float copper = .5 + .5 * sin((uv.x * .44 + uv.y * .93 + uView.x * .83 - uView.y * 1.6) * 6.2831853);
      color += mix(vec3(.57, .24, .22), vec3(1., .82, .72), copper) * uFinishes[5];
    }
    if (uFinishes[6] > 0.) {
      float split = .5 + .5 * cos(phase * 9.4 + uv.x * 7.);
      color += mix(vec3(.3, .67, .9), vec3(.91, .99, 1.), split) * uFinishes[6];
    }
    if (uFinishes[7] > 0.) {
      float mirror = pow(.5 + .5 * sin(phase * 6.2831853), 9.);
      color += mix(vec3(.10, .11, .19), vec3(.49, .40, .77), mirror) * uFinishes[7];
    }
    if (uFinishes[8] > 0.) {
      float mineral = nebulaCloud(uv * 1.7);
      vec3 fire = .62 + .35 * cos(6.2831853 * (mineral * 2.1 + uView.x * .9 - uView.y * .7 + vec3(0., .28, .61)));
      color += mix(vec3(.87, .89, .81), fire, .73) * uFinishes[8];
    }
    return color;
  }

  float materialBand(vec2 uv, float baseBand) {
    float result = baseBand * (uFinishes[0] + uFinishes[1] + uFinishes[2] + uFinishes[3]);
    if (uFinishes[5] > 0.) result += (baseBand * .72 + silkSheen(uv) * .28) * uFinishes[5];
    if (uFinishes[6] > 0.) result += (pow(baseBand, 2.) * .77 + prismFacets(uv) * .23) * uFinishes[6];
    if (uFinishes[7] > 0.) result += pow(baseBand, 3.2) * .83 * uFinishes[7];
    if (uFinishes[8] > 0.) result += (baseBand * .52 + smoothstep(.5, .83, nebulaCloud(uv * 1.7)) * .48) * uFinishes[8];
    return result / max(finishAmount(), .0001);
  }

  float materialGloss() {
    return 1. - uFinishes[5] * .28 + uFinishes[6] * .43 + uFinishes[7] * .82 - uFinishes[8] * .24;
  }

  float materialAbsorption() {
    return 1. + uFinishes[5] * .09 - uFinishes[6] * .24 + uFinishes[7] * .68 - uFinishes[8] * .14;
  }

  vec3 finishMetal(vec3 metal) {
    float legacy = 1. - uFinishes[5] - uFinishes[6] - uFinishes[7] - uFinishes[8];
    return metal * legacy + vec3(.72, .43, .38) * uFinishes[5] + vec3(.57, .76, .85) * uFinishes[6]
      + vec3(.17, .17, .25) * uFinishes[7] + vec3(.73, .75, .66) * uFinishes[8];
  }

  float revealSweep(vec2 uv) {
    if (uShine < 0.) return 0.;
    float progress = clamp(uShine, 0., 1.);
    float envelope = smoothstep(0., .10, uShine) * (1. - smoothstep(.88, 1., uShine));
    float light = 0.;
    if (uShineStyle < .5) {
      float position = mix(-.35, 1.9, progress);
      float delta = uv.x * .76 + uv.y * .62 - position;
      float width = .027 + fwidth(delta);
      light = exp(-delta * delta / (width * width));
    } else if (uShineStyle < 1.5) {
      vec2 p = (uv - .5 - uView.xy * .06) * vec2(1., 1.5);
      float radius = length(p);
      float delta = radius - mix(.035, 1.02, progress);
      float width = .018 + fwidth(radius);
      light = exp(-delta * delta / (width * width));
      float echo = radius - mix(.025, .87, progress);
      light += exp(-echo * echo / (width * width)) * .18;
    } else if (uShineStyle < 2.5) {
      vec2 head = mix(vec2(-.10, -.16), vec2(1.12, 1.18), progress);
      vec2 p = (uv - head) * vec2(1., 1.5);
      vec2 direction = normalize(vec2(1.22, 2.01));
      float along = dot(p, direction), side = dot(p, vec2(-direction.y, direction.x));
      float width = .014 + max(0., -along) * .07 + length(fwidth(p));
      float tail = exp(-side * side / (width * width)) * exp(min(0., along) * 5.8) * (1. - smoothstep(-.01, .025, along));
      float core = exp(-dot(p, p) / .0022);
      light = min(1.15, core + tail * .72);
    } else {
      vec2 p = (uv - vec2(.5, .53)) * vec2(1., 1.5);
      float angle = mix(-.23, .23, progress), c = cos(angle), s = sin(angle);
      p = mat2(c, -s, s, c) * p;
      float width = .010 + length(fwidth(p));
      float reach = .10 + .52 * sin(progress * 3.14159265);
      float vertical = exp(-p.x * p.x / (width * width)) * exp(-abs(p.y) / reach * 2.6);
      float horizontal = exp(-p.y * p.y / (width * width)) * exp(-abs(p.x) / reach * 2.6);
      light = min(1.1, vertical + horizontal);
    }
    return light * envelope;
  }
`;
