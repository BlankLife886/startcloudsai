import { memo, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { createParticleRenderScheduler, particleRenderQuality } from "./particleRenderScheduler.js";
import { generationLogoShapeStats, loadGenerationLogoShape, logoPlacement } from "./generationLogoShape.js";
import "./GenerationParticleField.css";

gsap.registerPlugin(useGSAP);

const PROFILES = {
  waiting: { speed: 0, strength: 0.28, breath: 0 },
  generating: { speed: 0.62, strength: 1, breath: 1 },
};
const ALPHA_STEPS = 24;
const renderPool = createParticleRenderScheduler(gsap.ticker);
const glowCache = new Map();
export const particleRenderStats = () => ({ ...renderPool.snapshot(), logoShapeBytes: generationLogoShapeStats().bytes, logoShapePoints: generationLogoShapeStats().points });
const smooth = value => { const x = Math.min(1, Math.max(0, value)); return x * x * (3 - 2 * x); };

// Living breath: soft inhale, quiet crest, longer exhale + faint shimmer.
function breathAt(time) {
  const cycle = (time % 6.2) / 6.2;
  let primary;
  if (cycle < 0.36) primary = smooth(cycle / 0.36);
  else if (cycle < 0.46) primary = 1;
  else primary = 1 - smooth((cycle - 0.46) / 0.54);
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.92 + 0.4);
  return primary * 0.9 + shimmer * 0.1;
}

function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 56;
  const context = sprite.getContext("2d");
  if (!context) return null;
  const glow = context.createRadialGradient(28, 28, 0, 28, 28, 28);
  glow.addColorStop(0, "#ffffffd0");
  glow.addColorStop(0.1, `${color}b0`);
  glow.addColorStop(0.28, `${color}48`);
  glow.addColorStop(0.58, `${color}14`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, 56, 56);
  glowCache.set(color, sprite);
  if (glowCache.size > 28) glowCache.delete(glowCache.keys().next().value);
  return sprite;
}

function particleSeeds(count, variant) {
  let seed = 1731 + variant * 271;
  const random = () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => {
    const depth = random();
    return { u: random(), v: random(), depth, phase: random() * Math.PI * 2, color: Math.floor(random() * 10), strand: index % 4, spread: random() + random() + random() - 1.5, radius: 0.5 + Math.pow(depth, 1.6) * 1.1 };
  });
}

export const GenerationParticleField = memo(function GenerationParticleField({ state, variant = 0, mode = "particle-logo" }) {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const phase = state === "waiting" ? "waiting" : "generating";
  const phaseRef = useRef(phase);

  useGSAP(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const page = canvas.closest(".t2i-page");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0, height = 0, pixels = [], inView = false, allocated = false, renderedFrames = 0;
    let logo = null, disposed = false;
    let clock = variant * 9.4, breathClock = variant * 0.65, light = true;
    let quality = { ...particleRenderQuality(1), particles: 400, pixels: 150_000, dpr: 1, glows: 0 };
    canvas.width = canvas.height = 1;
    let palette = [], glows = [];
    const profile = { ...PROFILES[phaseRef.current] };
    let buckets = Array.from({ length: 10 * ALPHA_STEPS }, () => []);
    const highlights = [];

    function readPalette() {
      light = page?.classList.contains("is-light") === true;
      // Pearl prism: neighboring stops stay close so bands melt instead of striping.
      const prismLight = ["#d889a3", "#d99880", "#c9ad72", "#8fb08c", "#6eabb4", "#6e99c6", "#7f8ecc", "#9686c6", "#b484b6", "#c888aa"];
      const prismDark = ["#ff9db8", "#ffb498", "#ffe4a8", "#9ae8c4", "#8ad8ea", "#8ec8ff", "#a8b6ff", "#c2b2ff", "#e0acf0", "#f0aad0"];
      const next = phaseRef.current === "waiting"
        ? light
          ? ["#8b93a3", "#939bab", "#9aa3b2", "#a3abb8"]
          : ["#8a94a8", "#939db2", "#8490a5", "#9aa5b8"]
        : light ? prismLight : prismDark;
      const changed = next.join() !== palette.join();
      if (changed) {
        palette = next;
        glows = palette.map(glowSprite);
        const size = Math.max(1, palette.length) * ALPHA_STEPS;
        if (buckets.length !== size) buckets = Array.from({ length: size }, () => []);
      }
      return changed;
    }

    function draw(delta = 0, settle = false) {
      if (!allocated || !width || !height) return;
      const target = PROFILES[phaseRef.current];
      const blend = settle ? 1 : delta ? 1 - Math.exp(-delta * 2.1) : 0;
      for (const key of ["speed", "strength", "breath"]) profile[key] += (target[key] - profile[key]) * blend;
      clock += delta * profile.speed;
      breathClock += delta;
      const breath = breathAt(breathClock);
      const breathLift = (breath - 0.5) * profile.breath;
      const logoBox = logo ? logoPlacement(width, height, logo) : null;
      const luminance = 1 + breathLift * 0.26;
      const lightCos = Math.cos(clock * 0.34), lightSin = Math.sin(clock * 0.34);
      const logoTilt = Math.sin(clock * 0.15) * 0.006;
      const logoRadiusScale = logoBox ? Math.max(0.7, Math.min(1.35, logoBox.width / 280)) : 1;
      const hueDrift = clock * 0.012 + breath * 0.028;
      context.clearRect(0, 0, width, height);
      for (const bucket of buckets) bucket.length = 0;
      highlights.length = 0;
      const cols = Math.max(8, Math.round(width / 8));
      const seed = variant * 1.13;
      const glowBudget = Math.max(quality.glows * 5, mode === "particle-logo" ? 36 : 0);
      for (let index = 0; index < pixels.length; index++) {
        const p = pixels[index];
        // Stagger breath per particle so the silhouette ripples instead of scaling as a plate.
        const local = breathAt(breathClock + p.phase * 0.55);
        const localLift = (local - 0.5) * profile.breath;
        let u = ((p.u + clock * 0.008 * (0.3 + p.depth * 0.7)) % 1) * 1.16 - 0.08;
        let v = ((p.v + clock * 0.004 * (0.3 + p.depth * 0.7)) % 1) * 1.16 - 0.08;
        let brightness, radius = p.radius;
        let color = p.color;
        if (mode === "particle-logo" && logoBox && logo.count) {
          if (index % 12 !== 0) {
            const point = Math.floor((index * 0.61803398875 % 1) * logo.count) * 6;
            const x = logo.points[point], y = logo.points[point + 1], depth = logo.points[point + 2];
            const shine = Math.max(0, logo.points[point + 3] * lightCos + logo.points[point + 4] * lightSin);
            const spread = (1 - local) * (0.005 + p.depth * 0.014);
            u = (logoBox.x + x * logoBox.width) / width + Math.cos(p.phase + clock * 0.14) * spread;
            v = (logoBox.y + y * logoBox.height) / height + Math.sin(p.phase + clock * 0.12) * spread * width / height;
            u += logoTilt * (depth - 0.5);
            brightness = 0.44 + depth * 0.34 + shine * 0.22 + localLift * 0.06;
            radius = (0.38 + depth * 0.5 + p.depth * 0.22) * logoRadiusScale * (1 + localLift * 0.1);
            const hues = Math.max(1, palette.length);
            const angle = (Math.atan2(y - 0.5, x - 0.5) / (Math.PI * 2) + 1 + hueDrift) % 1;
            const radial = Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 1.4);
            // Slight phase dither softens hard color seams.
            const spectrum = (angle * 0.74 + radial * 0.2 + depth * 0.06 + p.phase * 0.015) % 1;
            color = Math.min(hues - 1, Math.floor(spectrum * hues));
          } else {
            brightness = 0.05 + p.depth * 0.1;
            radius *= 0.55;
            color = Math.min(Math.max(0, palette.length - 1), p.color % Math.max(1, palette.length));
          }
        } else if (mode === "particle-stars") {
          u += Math.sin(clock * 0.13 + p.phase) * 0.025;
          v += Math.cos(clock * 0.09 + p.phase) * 0.015;
          brightness = 0.2 + Math.pow(0.5 + Math.sin(clock * 0.38 + p.phase) * 0.5, 2) * 0.58;
          radius *= 0.75 + p.depth * 0.5;
          color = Math.min(Math.max(0, palette.length - 1), Math.floor(((p.u + hueDrift * 0.35 + p.phase * 0.05) % 1) * palette.length));
        } else if (mode === "particle-matrix") {
          u = (index % cols + 0.5) / cols;
          v = (Math.floor(index / cols) + 0.5) / Math.ceil(pixels.length / cols);
          brightness = 0.16 + Math.pow(0.5 + Math.sin(u * 7 + v * 4 - clock * 0.48) * 0.5, 3) * 0.62;
          radius = 0.55 + brightness * 0.65;
          color = Math.min(Math.max(0, palette.length - 1), Math.floor(((u + v * 0.35 + hueDrift * 0.2) % 1) * palette.length));
        } else {
          u += Math.sin(v * 10 + clock * 0.25 + seed) * 0.052 + Math.sin(v * 23 - clock * 0.17) * 0.018;
          const ridge = 0.32 + Math.sin(u * 5.3 + clock * 0.22 + seed) * 0.17;
          const second = 0.72 + Math.sin(u * 4.8 - clock * 0.18 + seed) * 0.16;
          const ribbonWidth = 0.055 + (1 - local) * 0.04;
          if (p.strand) v = (p.strand === 3 ? second : ridge) + p.spread * ribbonWidth * 1.8;
          else v += Math.sin(u * 8 - clock * 0.21 + seed) * 0.04;
          const glow = Math.exp(-Math.pow((v - ridge) / ribbonWidth, 2)) + Math.exp(-Math.pow((v - second) / (ribbonWidth * 1.2), 2)) * 0.7;
          brightness = 0.16 + glow * 0.76 + Math.sin(clock * 0.35 + p.phase) * 0.025;
          radius += glow * 0.38;
          color = Math.min(Math.max(0, palette.length - 1), Math.floor(((u + hueDrift * 0.25) % 1) * palette.length));
        }
        const expansion = 1 - localLift * (0.08 + p.depth * 0.1);
        u = 0.5 + (u - 0.5) * expansion;
        v = 0.46 + (v - 0.46) * expansion;
        radius *= 1 + localLift * 0.36;
        const edge = smooth(Math.min(u, 1 - u, v, 1 - v) / 0.07);
        brightness *= profile.strength * edge * (0.8 + p.depth * 0.2);
        if (brightness < 0.014 || !palette.length) continue;
        color = ((color % palette.length) + palette.length) % palette.length;
        const alphaBin = Math.min(ALPHA_STEPS - 1, Math.floor(brightness * ALPHA_STEPS));
        buckets[color * ALPHA_STEPS + alphaBin].push(u * width, v * height, radius);
        if (highlights.length < glowBudget && p.depth > 0.78 && brightness > 0.4 && mode !== "particle-matrix") {
          highlights.push(u * width, v * height, radius, color, brightness);
        }
      }
      for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
        const bucket = buckets[bucketIndex];
        if (!bucket.length) continue;
        context.fillStyle = palette[Math.floor(bucketIndex / ALPHA_STEPS)];
        const tone = bucketIndex % ALPHA_STEPS / (ALPHA_STEPS - 1);
        context.globalAlpha = Math.min(1, (0.04 + tone * (light ? 0.78 : 0.88)) * luminance);
        context.beginPath();
        for (let index = 0; index < bucket.length; index += 3) {
          const x = bucket[index], y = bucket[index + 1], radius = bucket[index + 2];
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        }
        context.fill();
      }
      for (let index = 0; index < highlights.length; index += 5) {
        const sprite = glows[highlights[index + 3]];
        if (!sprite) continue;
        const size = highlights[index + 2] * (12.5 + breathLift * 2.8);
        context.globalAlpha = Math.min(1, highlights[index + 4] * (0.34 + breath * 0.1) * luminance);
        context.drawImage(sprite, highlights[index] - size / 2, highlights[index + 1] - size / 2, size, size);
      }
      context.globalAlpha = 1;
    }

    function allocate() {
      if (!inView || document.hidden || !width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, quality.dpr, Math.sqrt(quality.pixels / Math.max(1, width * height)));
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      const count = Math.min(quality.particles, Math.max(180, Math.round(width * height / 55)));
      if (allocated && canvas.width === pixelWidth && canvas.height === pixelHeight && pixels.length === count) return;
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      if (pixels.length !== count) pixels = particleSeeds(count, variant);
      allocated = true;
      draw();
    }

    const renderHandle = renderPool.register({
      draw: delta => { draw(delta); renderedFrames++; },
      configure: next => { quality = next; allocate(); },
      metrics: () => ({ particles: pixels.length, canvasPixels: allocated ? canvas.width * canvas.height : 0, frames: renderedFrames }),
    });

    function sync() {
      const colorsChanged = readPalette();
      const visible = width > 0 && height > 0 && inView && !document.hidden;
      const play = visible && !reduce.matches
        && !document.documentElement.classList.contains("settings-no-animations") && phaseRef.current !== "waiting";
      renderHandle.setActive(play);
      canvas.dataset.motion = play ? "playing" : "paused";
      if (!visible) {
        if (allocated) { canvas.width = canvas.height = 1; pixels = []; allocated = false; }
        return;
      }
      allocate();
      if (!play) draw(0, phaseRef.current === "waiting" || reduce.matches);
      else if (colorsChanged) draw();
    }

    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      sync();
    });
    resize.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
    visibility.observe(canvas);
    const preferences = new MutationObserver(sync);
    preferences.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    if (page) preferences.observe(page, { attributes: true, attributeFilter: ["class"] });
    reduce.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    engine.current = { sync };
    readPalette();
    if (mode === "particle-logo") loadGenerationLogoShape().then(shape => {
      if (disposed || !shape) return;
      logo = shape;
      draw();
    });
    return () => {
      disposed = true;
      engine.current = null;
      renderHandle.destroy();
      canvas.width = canvas.height = 1;
      resize.disconnect(); visibility.disconnect(); preferences.disconnect();
      reduce.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, { scope: canvasRef, dependencies: [variant, mode], revertOnUpdate: true });

  useEffect(() => { phaseRef.current = phase; engine.current?.sync(); }, [phase]);

  return <div className={`t2i-particle-field phase-${phase} mode-${mode}`} aria-hidden="true"><canvas ref={canvasRef} className="t2i-particle-canvas" /><div className="t2i-particle-vignette" /></div>;
});
