import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Mesh, ShaderMaterial, Texture, WebGLRenderer } from "three";

import { clampLat, DEFAULT_PLANET_FOV, DEFAULT_VIEW, FOV_RANGE, normalizeLon, PLANET_FOV_RANGE, type PanoramaMode, type PanoramaView } from "./panorama-math";

type ThreeModule = typeof import("three");
let threePromise: Promise<ThreeModule> | undefined;
export function loadThree() {
    threePromise ||= import("three");
    return threePromise;
}

// One full-screen quad; the fragment shader turns each pixel into a ray and samples the equirectangular image.
// Mode 0 = rectilinear (normal 360 view), 1 = the whole image flat, 2 = stereographic "little planet".
export const PANORAMA_VERTEX = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export const PANORAMA_FRAGMENT = `
precision highp float;
uniform sampler2D map; uniform float lon; uniform float lat; uniform float fov; uniform float planetFov; uniform float aspect; uniform int mode;
varying vec2 vUv;
const float PI = 3.141592653589793;
vec4 sampleDir(vec3 d){ float u = 0.5 + atan(d.x, -d.z) / (2.0 * PI); float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI; return texture2D(map, vec2(u, v)); }
void main(){
  vec2 p = vUv * 2.0 - 1.0; p.x *= aspect;
  if (mode == 1) {
    vec2 uv = vUv;
    if (aspect > 2.0) uv.x = (vUv.x - 0.5) * aspect / 2.0 + 0.5; else uv.y = (vUv.y - 0.5) * 2.0 / aspect + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.06, 0.06, 0.08, 1.0); return; }
    gl_FragColor = texture2D(map, uv); return;
  }
  vec3 d;
  if (mode == 2) {
    float c = 2.0 * atan(length(p) * tan(radians(planetFov) / 4.0));
    float a = atan(p.y, p.x) + radians(lon);
    d = vec3(sin(c) * cos(a), -cos(c), sin(c) * sin(a));
  } else {
    float f = 1.0 / tan(radians(fov) / 2.0);
    d = normalize(vec3(p.x, p.y, -f));
    float b = radians(lat);
    d = vec3(d.x, d.y * cos(b) - d.z * sin(b), d.y * sin(b) + d.z * cos(b));
    float l = radians(lon);
    d = vec3(d.x * cos(l) - d.z * sin(l), d.y, d.x * sin(l) + d.z * cos(l));
  }
  gl_FragColor = sampleDir(d);
}`;

const MODE_INDEX: Record<PanoramaMode, number> = { sphere: 0, flat: 1, planet: 2 };
const MAX_TEXTURE_SIDE = 4096;

export type PanoramaSource = HTMLImageElement | HTMLCanvasElement;

/** Loads a panorama image, scaled down to what a GPU texture can hold. */
export function loadPanoramaImage(src: string) {
    return new Promise<PanoramaSource>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            const scale = Math.min(1, MAX_TEXTURE_SIDE / width, MAX_TEXTURE_SIDE / height);
            if (scale >= 1) return resolve(image);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas);
        };
        image.onerror = () => reject(new Error("全景图读取失败"));
        image.src = src;
    });
}

function makeMaterial(THREE: ThreeModule, texture: Texture) {
    return new THREE.ShaderMaterial({
        uniforms: {
            map: { value: texture },
            lon: { value: 0 },
            lat: { value: 0 },
            fov: { value: DEFAULT_VIEW.fov },
            planetFov: { value: DEFAULT_PLANET_FOV },
            aspect: { value: 1 },
            mode: { value: 0 },
        },
        vertexShader: PANORAMA_VERTEX,
        fragmentShader: PANORAMA_FRAGMENT,
        depthTest: false,
        depthWrite: false,
    });
}

function makeTexture(THREE: ThreeModule, source: PanoramaSource) {
    const texture = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

/** Renders one view of a panorama into an image, at any size (screenshots, direction shots, little planet). */
export async function renderPanoramaImage(source: PanoramaSource, options: { mode: PanoramaMode; view: PanoramaView; planetFov?: number; width: number; height: number; type?: string; quality?: number }) {
    const THREE = await loadThree();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(options.width, options.height, false);
    const texture = makeTexture(THREE, source);
    const material = makeMaterial(THREE, texture);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    material.uniforms.lon.value = options.view.lon;
    material.uniforms.lat.value = options.view.lat;
    material.uniforms.fov.value = options.view.fov;
    material.uniforms.planetFov.value = options.planetFov ?? DEFAULT_PLANET_FOV;
    material.uniforms.aspect.value = options.width / options.height;
    material.uniforms.mode.value = MODE_INDEX[options.mode];
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL(options.type || "image/png", options.quality);
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    return url;
}

export type PanoramaViewerHandle = {
    getView: () => PanoramaView;
    getPlanetFov: () => number;
    setView: (view: Partial<PanoramaView>, animate?: boolean) => void;
    getSource: () => PanoramaSource | null;
    getSize: () => { width: number; height: number };
};

type Props = {
    src: string;
    mode: PanoramaMode;
    autoRotate: boolean;
    /** Pointer input drives the view (off while the node is in "move" mode). */
    interactive: boolean;
    initialView?: PanoramaView;
    onViewChange?: (view: PanoramaView) => void;
    onStatus?: (status: "loading" | "ready" | "error") => void;
    /** A click (not a drag) in the view, in element pixels. */
    onClick?: (x: number, y: number) => void;
    onUserInteract?: () => void;
};

export const PanoramaViewer = forwardRef<PanoramaViewerHandle, Props>(function PanoramaViewer({ src, mode, autoRotate, interactive, initialView, onViewChange, onStatus, onClick, onUserInteract }, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const state = useRef({ view: { ...(initialView || DEFAULT_VIEW) }, planetFov: DEFAULT_PLANET_FOV, target: null as PanoramaView | null, mode, autoRotate, source: null as PanoramaSource | null, width: 1, height: 1, lastReport: 0 });
    state.current.mode = mode;
    state.current.autoRotate = autoRotate;
    const callbacks = useRef({ onViewChange, onStatus, onClick, onUserInteract });
    callbacks.current = { onViewChange, onStatus, onClick, onUserInteract };

    useImperativeHandle(ref, () => ({
        getView: () => ({ ...state.current.view }),
        getPlanetFov: () => state.current.planetFov,
        setView: (view, animate = true) => {
            const next = { ...state.current.view, ...view };
            if (animate) state.current.target = next;
            else {
                state.current.view = next;
                state.current.target = null;
            }
        },
        getSource: () => state.current.source,
        getSize: () => ({ width: state.current.width, height: state.current.height }),
    }));

    useEffect(() => {
        callbacks.current.onStatus?.(status);
    }, [status]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !src) return;
        let disposed = false;
        let frame = 0;
        let renderer: WebGLRenderer | null = null;
        let mesh: Mesh | null = null;
        let material: ShaderMaterial | null = null;
        let texture: Texture | null = null;
        let observer: ResizeObserver | null = null;
        let cleanupEvents = () => undefined;
        setStatus("loading");

        void Promise.all([loadThree(), loadPanoramaImage(src)])
            .then(([THREE, source]) => {
                if (disposed || !mountRef.current) return;
                state.current.source = source;
                const nextRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
                renderer = nextRenderer;
                nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                const canvas = nextRenderer.domElement;
                Object.assign(canvas.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
                mount.appendChild(canvas);
                texture = makeTexture(THREE, source);
                material = makeMaterial(THREE, texture);
                const scene = new THREE.Scene();
                mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
                scene.add(mesh);
                const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

                let drag: { x: number; y: number; view: PanoramaView; moved: boolean } | null = null;
                const onDown = (event: PointerEvent) => {
                    event.stopPropagation();
                    drag = { x: event.clientX, y: event.clientY, view: { ...state.current.view }, moved: false };
                    state.current.target = null;
                    try {
                        canvas.setPointerCapture(event.pointerId);
                    } catch {
                        // Synthetic or already-released pointers cannot be captured; dragging still works without it.
                    }
                    canvas.style.cursor = "grabbing";
                    callbacks.current.onUserInteract?.();
                };
                const onMove = (event: PointerEvent) => {
                    if (!drag) return;
                    const dx = event.clientX - drag.x;
                    const dy = event.clientY - drag.y;
                    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
                    const perPixel = state.current.mode === "planet" ? 0.3 : drag.view.fov / Math.max(1, state.current.height);
                    state.current.view = {
                        ...state.current.view,
                        lon: normalizeLon(drag.view.lon - dx * perPixel),
                        lat: state.current.mode === "planet" ? drag.view.lat : clampLat(drag.view.lat + dy * perPixel),
                    };
                };
                const onUp = (event: PointerEvent) => {
                    if (drag && !drag.moved) {
                        const rect = canvas.getBoundingClientRect();
                        // Clicks are reported in element pixels (the node can be scaled by the canvas zoom).
                        callbacks.current.onClick?.(((event.clientX - rect.left) / rect.width) * state.current.width, ((event.clientY - rect.top) / rect.height) * state.current.height);
                    }
                    drag = null;
                    canvas.style.cursor = "grab";
                    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
                };
                const onWheel = (event: WheelEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    state.current.target = null;
                    if (state.current.mode === "planet") state.current.planetFov = Math.max(PLANET_FOV_RANGE.min, Math.min(PLANET_FOV_RANGE.max, state.current.planetFov + event.deltaY * 0.12));
                    else state.current.view = { ...state.current.view, fov: Math.max(FOV_RANGE.min, Math.min(FOV_RANGE.max, state.current.view.fov + event.deltaY * 0.04)) };
                };
                canvas.addEventListener("pointerdown", onDown);
                canvas.addEventListener("pointermove", onMove);
                canvas.addEventListener("pointerup", onUp);
                canvas.addEventListener("pointercancel", onUp);
                canvas.addEventListener("wheel", onWheel, { passive: false });
                cleanupEvents = () => {
                    canvas.removeEventListener("pointerdown", onDown);
                    canvas.removeEventListener("pointermove", onMove);
                    canvas.removeEventListener("pointerup", onUp);
                    canvas.removeEventListener("pointercancel", onUp);
                    canvas.removeEventListener("wheel", onWheel);
                };

                const resize = () => {
                    const element = mountRef.current;
                    if (!element || !renderer) return;
                    state.current.width = Math.max(1, element.clientWidth);
                    state.current.height = Math.max(1, element.clientHeight);
                    renderer.setSize(state.current.width, state.current.height, false);
                };
                observer = new ResizeObserver(resize);
                observer.observe(mount);
                resize();

                const render = (time: number) => {
                    if (disposed || !renderer || !material) return;
                    const s = state.current;
                    if (s.target) {
                        // Ease toward a bookmark / reset along the shortest way round.
                        const dLon = normalizeLon(s.target.lon - s.view.lon);
                        const next = { lon: normalizeLon(s.view.lon + dLon * 0.14), lat: s.view.lat + (s.target.lat - s.view.lat) * 0.14, fov: s.view.fov + (s.target.fov - s.view.fov) * 0.14 };
                        const done = Math.abs(dLon) < 0.05 && Math.abs(s.target.lat - s.view.lat) < 0.05 && Math.abs(s.target.fov - s.view.fov) < 0.05;
                        s.view = done ? { ...s.target } : next;
                        if (done) s.target = null;
                    } else if (s.autoRotate && !drag && s.mode !== "flat") {
                        s.view = { ...s.view, lon: normalizeLon(s.view.lon + 0.03) };
                    }
                    const u = material.uniforms;
                    u.lon.value = s.view.lon;
                    u.lat.value = s.view.lat;
                    u.fov.value = s.view.fov;
                    u.planetFov.value = s.planetFov;
                    u.aspect.value = s.width / s.height;
                    u.mode.value = MODE_INDEX[s.mode];
                    canvas.style.cursor = s.mode === "flat" ? "crosshair" : drag ? "grabbing" : "grab";
                    renderer.render(scene, camera);
                    // The compass, hotspots and the flat-view frame follow the view at ~30fps.
                    if (time - s.lastReport > 33) {
                        s.lastReport = time;
                        callbacks.current.onViewChange?.({ ...s.view });
                    }
                    frame = requestAnimationFrame(render);
                };
                frame = requestAnimationFrame(render);
                setStatus("ready");
            })
            .catch(() => {
                if (!disposed) setStatus("error");
            });

        return () => {
            disposed = true;
            cancelAnimationFrame(frame);
            cleanupEvents();
            observer?.disconnect();
            mesh?.geometry.dispose();
            material?.dispose();
            texture?.dispose();
            if (renderer) {
                renderer.domElement.remove();
                renderer.dispose();
                renderer.forceContextLoss();
            }
            state.current.source = null;
        };
    }, [src]);

    return (
        <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-black">
            <div ref={mountRef} className="absolute inset-0" style={{ pointerEvents: interactive ? "auto" : "none" }} />
            {status !== "ready" ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center px-5 text-center text-[13px] text-white/70" style={{ background: status === "error" ? "rgba(0,0,0,.7)" : "rgba(0,0,0,.35)" }}>
                    {status === "error" ? "全景图读取失败，请使用 2:1 的 JPG 或 PNG 全景图" : "正在加载全景图…"}
                </div>
            ) : null}
        </div>
    );
});
