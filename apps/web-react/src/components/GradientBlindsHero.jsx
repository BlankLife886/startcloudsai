import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import "@react/legacy-styles/generated/features/home-commercial/components/GradientBlindsHero.css";

const MAX_COLORS = 8;

function hexToRgb(hex) {
  const value = hex.replace("#", "").padEnd(6, "0");
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function prepareStops(stops) {
  const base = (stops.length ? stops : ["#FF9FFC", "#27FF64"]).slice(
    0,
    MAX_COLORS,
  );
  if (base.length === 1) base.push(base[0]);
  const count = Math.max(2, Math.min(MAX_COLORS, base.length));
  while (base.length < MAX_COLORS) base.push(base[base.length - 1]);
  return { colors: base.map(hexToRgb), count };
}

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = `
#ifdef GL_ES
precision mediump float;
#endif
uniform vec3 iResolution;
uniform vec2 iMouse;
uniform float iTime;
uniform float uAngle;
uniform float uNoise;
uniform float uBlindCount;
uniform float uSpotlightRadius;
uniform float uSpotlightSoftness;
uniform float uSpotlightOpacity;
uniform float uMirror;
uniform float uDistort;
uniform float uShineFlip;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform vec3 uColor5;
uniform vec3 uColor6;
uniform vec3 uColor7;
uniform int uColorCount;
varying vec2 vUv;

float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
vec2 rotate2D(vec2 p, float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c) * p; }
vec3 getGradientColor(float t){
  float tt = clamp(t, 0.0, 1.0); int count = uColorCount; if (count < 2) count = 2;
  float scaled = tt * float(count - 1); float seg = floor(scaled); float f = fract(scaled);
  if (seg < 1.0) return mix(uColor0, uColor1, f);
  if (seg < 2.0 && count > 2) return mix(uColor1, uColor2, f);
  if (seg < 3.0 && count > 3) return mix(uColor2, uColor3, f);
  if (seg < 4.0 && count > 4) return mix(uColor3, uColor4, f);
  if (seg < 5.0 && count > 5) return mix(uColor4, uColor5, f);
  if (seg < 6.0 && count > 6) return mix(uColor5, uColor6, f);
  if (seg < 7.0 && count > 7) return mix(uColor6, uColor7, f);
  if (count > 7) return uColor7; if (count > 6) return uColor6; if (count > 5) return uColor5;
  if (count > 4) return uColor4; if (count > 3) return uColor3; if (count > 2) return uColor2; return uColor1;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv0 = fragCoord.xy / iResolution.xy; float aspect = iResolution.x / iResolution.y;
  vec2 p = uv0 * 2.0 - 1.0; p.x *= aspect; vec2 pr = rotate2D(p, uAngle); pr.x /= aspect; vec2 uv = pr * 0.5 + 0.5;
  vec2 uvMod = uv;
  if (uDistort > 0.0) { float a = uvMod.y * 6.0; float b = uvMod.x * 6.0; float w = 0.01 * uDistort; uvMod.x += sin(a) * w; uvMod.y += cos(b) * w; }
  float t = uvMod.x; if (uMirror > 0.5) t = 1.0 - abs(1.0 - 2.0 * fract(t)); vec3 base = getGradientColor(t);
  vec2 offset = vec2(iMouse.x / iResolution.x, iMouse.y / iResolution.y); float d = length(uv0 - offset);
  float r = max(uSpotlightRadius, 1e-4); float dn = d / r; float spot = (1.0 - 2.0 * pow(dn, uSpotlightSoftness)) * uSpotlightOpacity;
  vec3 cir = vec3(spot); float stripe = fract(uvMod.x * max(uBlindCount, 1.0)); if (uShineFlip > 0.5) stripe = 1.0 - stripe;
  vec3 col = cir + base - vec3(stripe); col += (rand(gl_FragCoord.xy + iTime) - 0.5) * uNoise; fragColor = vec4(col, 1.0);
}
void main(){ vec4 color; mainImage(color, vUv * iResolution.xy); gl_FragColor = color; }
`;

export function GradientBlindsHero({
  gradientColors,
  angle = 20,
  noise = 0.5,
  blindCount = 16,
  blindMinWidth = 60,
  spotlightRadius = 0.5,
  mouseDampening = 0.15,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      document.documentElement.classList.contains("settings-no-animations") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return undefined;
    const renderer = new Renderer({
      dpr: window.devicePixelRatio || 1,
      alpha: true,
      antialias: true,
    });
    const gl = renderer.gl;
    const canvas = gl.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);
    const prepared = prepareStops(gradientColors);
    const uniforms = {
      iResolution: {
        value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1],
      },
      iMouse: { value: [0, 0] },
      iTime: { value: 0 },
      uAngle: { value: (angle * Math.PI) / 180 },
      uNoise: { value: noise },
      uBlindCount: { value: blindCount },
      uSpotlightRadius: { value: spotlightRadius },
      uSpotlightSoftness: { value: 1 },
      uSpotlightOpacity: { value: 1 },
      uMirror: { value: 0 },
      uDistort: { value: 0 },
      uShineFlip: { value: 0 },
      uColorCount: { value: prepared.count },
      ...Object.fromEntries(
        prepared.colors.map((color, index) => [
          `uColor${index}`,
          { value: color },
        ]),
      ),
    };
    const program = new Program(gl, { vertex, fragment, uniforms });
    const geometry = new Triangle(gl);
    const mesh = new Mesh(gl, { geometry, program });
    const target = [0, 0];
    let frame = 0;
    let lastTime = 0;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      uniforms.iResolution.value = [
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        1,
      ];
      uniforms.uBlindCount.value = Math.max(
        1,
        Math.min(blindCount, Math.floor(rect.width / blindMinWidth)),
      );
      if (!target[0] && !target[1]) {
        target[0] = gl.drawingBufferWidth / 2;
        target[1] = gl.drawingBufferHeight / 2;
        uniforms.iMouse.value = [...target];
      }
    };
    const onPointerMove = (event) => {
      const rect = container.getBoundingClientRect();
      const scale = renderer.dpr || 1;
      target[0] = (event.clientX - rect.left) * scale;
      target[1] = (rect.height - (event.clientY - rect.top)) * scale;
    };
    const render = (time) => {
      frame = requestAnimationFrame(render);
      uniforms.iTime.value = time * 0.001;
      if (!lastTime) lastTime = time;
      const factor = Math.min(
        1,
        1 -
          Math.exp(
            -((time - lastTime) / 1000) / Math.max(0.0001, mouseDampening),
          ),
      );
      lastTime = time;
      uniforms.iMouse.value[0] +=
        (target[0] - uniforms.iMouse.value[0]) * factor;
      uniforms.iMouse.value[1] +=
        (target[1] - uniforms.iMouse.value[1]) * factor;
      renderer.render({ scene: mesh });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      if (canvas.parentElement === container) container.removeChild(canvas);
      program.remove?.();
      geometry.remove?.();
      mesh.remove?.();
      renderer.destroy?.();
    };
  }, [
    angle,
    blindCount,
    blindMinWidth,
    gradientColors,
    mouseDampening,
    noise,
    spotlightRadius,
  ]);

  return (
    <div
      ref={containerRef}
      className="gradient-blinds-hero"
      aria-hidden="true"
      style={{ mixBlendMode: "lighten" }}
    />
  );
}
