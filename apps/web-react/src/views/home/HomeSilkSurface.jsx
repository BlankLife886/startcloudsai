import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
precision highp float;
uniform float uTime;
uniform float uAspect;
uniform float uDark;
varying vec2 vUv;

float fabric(vec2 p) {
  float drift = sin(p.x * 0.65 + p.y * 2.1 + uTime * 0.22) * 0.48;
  drift += sin(p.y * 3.2 - uTime * 0.16) * 0.26;
  float fold = p.x * 4.4 + p.y * 2.4 + drift * 2.0;
  return sin(fold) * 0.18 + sin(fold * 2.13 + uTime * 0.17) * 0.026;
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float height = fabric(p);
  float dx = (fabric(p + vec2(0.015, 0.0)) - height) / 0.015;
  float dy = (fabric(p + vec2(0.0, 0.015)) - height) / 0.015;
  vec3 normal = normalize(vec3(-dx, -dy, 0.85));
  vec3 light = normalize(vec3(-0.45, 0.65, 0.8));
  float diffuse = clamp(dot(normal, light), 0.0, 1.0);
  float sheen = pow(diffuse, 14.0);
  vec3 shadow = mix(vec3(0.69, 0.62, 0.80), vec3(0.085, 0.067, 0.145), uDark);
  vec3 pearl = mix(vec3(0.95, 0.92, 0.98), vec3(0.34, 0.25, 0.47), uDark);
  vec3 shine = mix(vec3(1.0, 0.99, 1.0), vec3(0.70, 0.60, 0.83), uDark);
  vec3 color = mix(shadow, pearl, 0.24 + diffuse * 0.72);
  color = mix(color, shine, sheen * 0.65);
  float weave = sin(gl_FragCoord.x * 1.5 + gl_FragCoord.y * 0.7) * 0.0015;
  gl_FragColor = vec4(color + weave, 1.0);
}
`;

export function HomeSilkSurface({ paused = false, dark = false }) {
  const hostRef = useRef(null);
  const surfaceRef = useRef(null);

  useGSAP(() => {
    const host = hostRef.current;
    const canvas = document.createElement("canvas");
    const attributes = { alpha: false, depth: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" };
    let renderer;
    let program;
    let geometry;
    let gl;
    try {
      gl = canvas.getContext("webgl", attributes);
      if (!gl) return;
      renderer = new Renderer({ ...attributes, canvas, webgl: 1, dpr: Math.min(window.devicePixelRatio || 1, 1.5) });
      program = new Program(gl, { vertex, fragment, uniforms: {
        uTime: { value: 0 }, uAspect: { value: 4 }, uDark: { value: dark ? 1 : 0 },
      } });
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) throw new Error("Silk shader unavailable");
      geometry = new Triangle(gl);
    } catch {
      program?.remove();
      geometry?.remove();
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return;
    }

    host.appendChild(canvas);
    const mesh = new Mesh(gl, { geometry, program });
    let visible = false;
    let locallyPaused = paused;
    let lost = false;
    let lastDraw = -Infinity;
    const draw = (force = false) => {
      if (lost) return;
      const now = performance.now();
      if (!force && now - lastDraw < 1000 / 30) return;
      renderer.render({ scene: mesh });
      lastDraw = now;
    };
    const drift = gsap.to(program.uniforms.uTime, {
      value: 12, duration: 28, repeat: -1, yoyo: true, ease: "sine.inOut", paused: true,
      onUpdate: () => draw(),
    });
    const sync = () => {
      const running = visible && !locallyPaused && !document.hidden && !lost;
      if (running) drift.play();
      else drift.pause();
      host.dataset.silkState = lost ? "fallback" : running ? "running" : "paused";
    };
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      program.uniforms.uAspect.value = width / height;
      draw(true);
    };
    const onContextLost = event => {
      event.preventDefault();
      lost = true;
      canvas.style.opacity = "0";
      sync();
    };
    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    resizeObserver.observe(host);
    visibilityObserver.observe(host);
    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", sync);
    surfaceRef.current = {
      update(nextPaused, nextDark) {
        locallyPaused = nextPaused;
        program.uniforms.uDark.value = nextDark ? 1 : 0;
        draw(true);
        sync();
      },
    };
    resize();
    sync();
    return () => {
      surfaceRef.current = null;
      drift.kill();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", sync);
      geometry.remove();
      program.remove();
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, { scope: hostRef });

  useEffect(() => surfaceRef.current?.update(paused, dark), [paused, dark]);

  return <div ref={hostRef} className="home-silk-surface" data-silk-state="fallback" aria-hidden="true" />;
}
