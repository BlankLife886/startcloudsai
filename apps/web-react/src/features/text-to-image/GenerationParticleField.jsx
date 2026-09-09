import { memo, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { createParticleRenderScheduler, particleRenderQuality } from "./particleRenderScheduler.js";
import { generationLogoShapeStats, loadGenerationLogoShape, logoPlacement } from "./generationLogoShape.js";
import "./GenerationParticleField.css";

gsap.registerPlugin(useGSAP);

const PROFILES = {
  waiting: { speed: 0, strength: 0.3, breath: 0 },
  generating: { speed: 0.85, strength: 1, breath: 1 },
};
const ALPHA_STEPS = 24;
const renderPool = createParticleRenderScheduler(gsap.ticker);
const glowCache = new Map();
export const particleRenderStats = () => ({ ...renderPool.snapshot(), logoShapeBytes: generationLogoShapeStats().bytes, logoShapePoints: generationLogoShapeStats().points });
const smooth = value => { const x = Math.min(1, Math.max(0, value)); return x * x * (3 - 2 * x); };

function breathAt(time) {
  const cycle = (time % 6.6) / 6.6;
  return cycle < 0.36 ? smooth(cycle / 0.36) : 1 - smooth((cycle - 0.36) / 0.64);
}

function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const context = sprite.getContext("2d");
  if (!context) return null;
  const glow = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, `${color}80`);
  glow.addColorStop(0.22, `${color}28`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, 32, 32);
  glowCache.set(color, sprite);
  if (glowCache.size > 16) glowCache.delete(glowCache.keys().next().value);
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
    return { u: random(), v: random(), depth, phase: random() * Math.PI * 2, color: Math.floor(random() * 4), strand: index % 4, spread: random() + random() + random() - 1.5, radius: 0.5 + Math.pow(depth, 1.6) * 1.1 };
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
    const buckets = Array.from({ length: 4 * ALPHA_STEPS }, () => []);
    const highlights = [];

    function readPalette() {
      light = page?.classList.contains("is-light") === true;
      const next = phaseRef.current === "waiting"
        ? light ? ["#828b9a", "#8c94a5", "#939dad", "#9ca4b3"] : ["#8c98af", "#94a0b9", "#8794ac", "#9ca8bf"]
        : mode === "particle-logo" ? light
          ? ["#397dc7", "#8559c8", "#1b8f9a", "#c15b93"]
          : ["#d4b6ff", "#bac9ff", "#b28aed", "#f0dfff"]
          : light ? ["#6954b3", "#4e75ad", "#3b899a", "#9868a8"] : ["#c9baff", "#b5deff", "#9ce2e4", "#f0dcff"];
      const changed = next.join() !== palette.join();
      if (changed) {
        palette = next;
        glows = palette.map(glowSprite);
      }
      return changed;
    }

    function draw(delta = 0, settle = false) {
      if (!allocated || !width || !height) return;
      const target = PROFILES[phaseRef.current];
      const blend = settle ? 1 : delta ? 1 - Math.exp(-delta * 2.4) : 0;
      for (const key of ["speed", "strength", "breath"]) profile[key] += (target[key] - profile[key]) * blend;
      clock += delta * profile.speed;
      breathClock += delta;
      const breath = breathAt(breathClock);
      const logoBox = logo ? logoPlacement(width, height, logo) : null;
      const luminance = 1 + (breath - 0.5) * 0.95 * profile.breath;
      const lightCos = Math.cos(clock * 0.4), lightSin = Math.sin(clock * 0.4);
      const logoTilt = Math.sin(clock * 0.18) * 0.008;
      const logoRadiusScale = logoBox ? Math.max(0.7, Math.min(1.35, logoBox.width / 280)) : 1;
      context.clearRect(0, 0, width, height);
      for (const bucket of buckets) bucket.length = 0;
      highlights.length = 0;
      const cols = Math.max(8, Math.round(width / 8));
      const rows = Math.ceil(pixels.length / cols);
      const seed = variant * 1.13;
      for (let index = 0; index < pixels.length; index++) {
        const p = pixels[index];
        let u = ((p.u + clock * 0.008 * (0.3 + p.depth * 0.7)) % 1) * 1.16 - 0.08;
        let v = ((p.v + clock * 0.004 * (0.3 + p.depth * 0.7)) % 1) * 1.16 - 0.08;
        let brightness, radius = p.radius;
        let color = p.color;
        if (mode === "particle-logo" && logoBox && logo.count) {
          if (index % 10 !== 0) {
            const point = Math.floor((index * 0.61803398875 % 1) * logo.count) * 6;
            const x = logo.points[point], y = logo.points[point + 1], depth = logo.points[point + 2];
            const shine = Math.max(0, logo.points[point + 3] * lightCos + logo.points[point + 4] * lightSin);
            const spread = (1 - breath) * (0.004 + p.depth * 0.012);
            u = (logoBox.x + x * logoBox.width) / width + Math.cos(p.phase + clock * 0.16) * spread;
            v = (logoBox.y + y * logoBox.height) / height + Math.sin(p.phase + clock * 0.14) * spread * width / height;
            u += logoTilt * (depth - 0.5);
            brightness = 0.48 + depth * 0.38 + shine * 0.18;
            radius = (0.42 + depth * 0.46 + p.depth * 0.22) * logoRadiusScale;
            color = light
              ? Math.min(3, Math.floor((x * 0.62 + y * 0.38) * 4))
              : depth > 0.72 || shine > 0.55 ? 3 : depth > 0.4 ? 0 : 2;
          } else {
            brightness = 0.09 + p.depth * 0.15;
            radius *= 0.7;
          }
        } else if (mode === "particle-stars") {
          u += Math.sin(clock * 0.13 + p.phase) * 0.025;
          v += Math.cos(clock * 0.09 + p.phase) * 0.015;
          brightness = 0.2 + Math.pow(0.5 + Math.sin(clock * 0.38 + p.phase) * 0.5, 2) * 0.58;
          radius *= 0.75 + p.depth * 0.5;
        } else if (mode === "particle-matrix") {
          u = (index % cols + 0.5) / cols;
          v = (Math.floor(index / cols) + 0.5) / Math.ceil(pixels.length / cols);
          brightness = 0.16 + Math.pow(0.5 + Math.sin(u * 7 + v * 4 - clock * 0.48) * 0.5, 3) * 0.62;
          radius = 0.55 + brightness * 0.65;
        } else {
          u += Math.sin(v * 10 + clock * 0.25 + seed) * 0.052 + Math.sin(v * 23 - clock * 0.17) * 0.018;
          const ridge = 0.32 + Math.sin(u * 5.3 + clock * 0.22 + seed) * 0.17;
          const second = 0.72 + Math.sin(u * 4.8 - clock * 0.18 + seed) * 0.16;
          const ribbonWidth = 0.055 + (1 - breath) * 0.045;
          if (p.strand) v = (p.strand === 3 ? second : ridge) + p.spread * ribbonWidth * 1.8;
          else v += Math.sin(u * 8 - clock * 0.21 + seed) * 0.04;
          const glow = Math.exp(-Math.pow((v - ridge) / ribbonWidth, 2)) + Math.exp(-Math.pow((v - second) / (ribbonWidth * 1.2), 2)) * 0.7;
          brightness = 0.16 + glow * 0.76 + Math.sin(clock * 0.35 + p.phase) * 0.025;
          radius += glow * 0.38;
        }
        const expansion = 1 - (breath - 0.5) * (0.065 + p.depth * 0.08) * profile.breath;
        u = 0.5 + (u - 0.5) * expansion;
        v = 0.46 + (v - 0.46) * expansion;
        radius *= 1 + (breath - 0.5) * 0.3 * profile.breath;
        const edge = smooth(Math.min(u, 1 - u, v, 1 - v) / 0.065);
        brightness *= profile.strength * edge * (0.78 + p.depth * 0.22);
        if (brightness < 0.012) continue;
        const alphaBin = Math.min(ALPHA_STEPS - 1, Math.floor(brightness * ALPHA_STEPS));
        buckets[color * ALPHA_STEPS + alphaBin].push(u * width, v * height, radius);
        if (highlights.length < quality.glows * 5 && p.depth > 0.9 && brightness > 0.4 && mode !== "particle-matrix") highlights.push(u * width, v * height, radius, color, brightness);
      }
      for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
        const bucket = buckets[bucketIndex];
        if (!bucket.length) continue;
        context.fillStyle = palette[Math.floor(bucketIndex / ALPHA_STEPS)];
        context.globalAlpha = Math.min(1, (0.055 + bucketIndex % ALPHA_STEPS / (ALPHA_STEPS - 1) * (light ? 0.88 : 0.94)) * luminance);
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
        const size = highlights[index + 2] * 10;
        context.globalAlpha = Math.min(1, highlights[index + 4] * 0.48 * luminance);
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
