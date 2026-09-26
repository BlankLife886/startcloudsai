import { useCallback, useEffect, useRef, useState } from "react";
import { ImageUp, RefreshCw, Sparkles, View } from "lucide-react";
import type { MeshBasicMaterial, SphereGeometry, Texture, WebGLRenderer } from "three";

import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";

type ThreeModule = typeof import("three");

let threePromise: Promise<ThreeModule> | undefined;
function loadThree() {
    threePromise ||= import("three");
    return threePromise;
}

const PANORAMA_SYSTEM_PROMPT =
    "A seamless 360-degree equirectangular panorama, 2:1 aspect ratio, full spherical VR photo, " +
    "horizontally wrapping seamlessly at the left and right edges, no visible seam, no distortion artifacts, " +
    "even horizon, no text, no watermark. Scene: ";

function PanoramaViewer({ src, ctx }: { src: string; ctx: CanvasNodeContext }) {
    const mountRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !src) return;

        let disposed = false;
        let frame = 0;
        let renderer: WebGLRenderer | null = null;
        let geometry: SphereGeometry | null = null;
        let material: MeshBasicMaterial | null = null;
        let texture: Texture | null = null;
        let resizeObserver: ResizeObserver | null = null;
        let cleanupEvents = () => undefined;
        setStatus("loading");

        void loadThree()
            .then((THREE) => {
                if (disposed || !mountRef.current) return;

                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(70, 1, 1, 1100);
                const target = new THREE.Vector3();
                const nextRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
                renderer = nextRenderer;
                nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                nextRenderer.setClearColor(0x000000, 1);

                const canvas = nextRenderer.domElement;
                canvas.style.width = "100%";
                canvas.style.height = "100%";
                canvas.style.display = "block";
                canvas.style.cursor = "grab";
                mount.appendChild(canvas);
                const maxTextureSide = Math.min(nextRenderer.capabilities.maxTextureSize || 4096, 4096);

                geometry = new THREE.SphereGeometry(500, 96, 64);
                geometry.scale(-1, 1, 1);
                material = new THREE.MeshBasicMaterial({ color: 0xffffff });
                scene.add(new THREE.Mesh(geometry, material));

                let longitude = 0;
                let latitude = 0;
                let fieldOfView = 70;
                let dragging = false;
                let startX = 0;
                let startY = 0;
                let startLongitude = 0;
                let startLatitude = 0;

                const handlePointerDown = (event: PointerEvent) => {
                    event.stopPropagation();
                    dragging = true;
                    startX = event.clientX;
                    startY = event.clientY;
                    startLongitude = longitude;
                    startLatitude = latitude;
                    canvas.style.cursor = "grabbing";
                    canvas.setPointerCapture(event.pointerId);
                };
                const handlePointerMove = (event: PointerEvent) => {
                    if (!dragging) return;
                    longitude = startLongitude - (event.clientX - startX) * 0.12;
                    latitude = Math.max(-84, Math.min(84, startLatitude + (event.clientY - startY) * 0.12));
                };
                const handlePointerUp = (event: PointerEvent) => {
                    dragging = false;
                    canvas.style.cursor = "grab";
                    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
                };
                const handleWheel = (event: WheelEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    fieldOfView = Math.max(38, Math.min(86, fieldOfView + event.deltaY * 0.035));
                };
                canvas.addEventListener("pointerdown", handlePointerDown);
                canvas.addEventListener("pointermove", handlePointerMove);
                canvas.addEventListener("pointerup", handlePointerUp);
                canvas.addEventListener("pointercancel", handlePointerUp);
                canvas.addEventListener("wheel", handleWheel, { passive: false });
                cleanupEvents = () => {
                    canvas.removeEventListener("pointerdown", handlePointerDown);
                    canvas.removeEventListener("pointermove", handlePointerMove);
                    canvas.removeEventListener("pointerup", handlePointerUp);
                    canvas.removeEventListener("pointercancel", handlePointerUp);
                    canvas.removeEventListener("wheel", handleWheel);
                };

                const resize = () => {
                    const activeRenderer = renderer;
                    const activeMount = mountRef.current;
                    if (!activeRenderer || !activeMount) return;
                    const width = Math.max(1, activeMount.clientWidth);
                    const height = Math.max(1, activeMount.clientHeight);
                    activeRenderer.setSize(width, height, false);
                    camera.aspect = width / height;
                    camera.updateProjectionMatrix();
                };
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(mount);
                resize();

                const render = () => {
                    if (disposed || !renderer) return;
                    if (!dragging) longitude += 0.02;
                    camera.fov = fieldOfView;
                    camera.updateProjectionMatrix();
                    const phi = THREE.MathUtils.degToRad(90 - latitude);
                    const theta = THREE.MathUtils.degToRad(longitude);
                    target.set(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
                    camera.lookAt(target);
                    renderer.render(scene, camera);
                    frame = requestAnimationFrame(render);
                };
                render();

                const image = new Image();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    if (disposed || !material) return;
                    try {
                        const width = image.naturalWidth || image.width;
                        const height = image.naturalHeight || image.height;
                        const scale = Math.min(1, maxTextureSide / width, maxTextureSide / height);
                        let source: HTMLImageElement | HTMLCanvasElement = image;
                        if (scale < 1) {
                            const reduced = document.createElement("canvas");
                            reduced.width = Math.max(1, Math.round(width * scale));
                            reduced.height = Math.max(1, Math.round(height * scale));
                            reduced.getContext("2d")?.drawImage(image, 0, 0, reduced.width, reduced.height);
                            source = reduced;
                        }
                        texture = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
                        texture.colorSpace = THREE.SRGBColorSpace;
                        texture.minFilter = THREE.LinearFilter;
                        texture.needsUpdate = true;
                        material.map = texture;
                        material.needsUpdate = true;
                        setStatus("ready");
                    } catch {
                        setStatus("error");
                    }
                };
                image.onerror = () => {
                    if (!disposed) setStatus("error");
                };
                image.src = src;
            })
            .catch(() => {
                if (!disposed) setStatus("error");
            });

        return () => {
            disposed = true;
            cleanupEvents();
            resizeObserver?.disconnect();
            if (frame) cancelAnimationFrame(frame);
            texture?.dispose();
            material?.dispose();
            geometry?.dispose();
            if (renderer) {
                renderer.domElement.remove();
                renderer.dispose();
                renderer.forceContextLoss();
            }
        };
    }, [src]);

    return (
        <div className="relative h-full w-full overflow-hidden rounded-2xl bg-black">
            <div ref={mountRef} data-canvas-no-zoom className="absolute inset-0" />
            {status !== "ready" ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center px-5 text-center text-[13px]" style={{ color: ctx.theme.node.placeholder, background: status === "error" ? "rgba(0,0,0,0.6)" : ctx.theme.node.fill }}>
                    {status === "error" ? "全景图读取失败，请使用 2:1 的 JPG 或 PNG 全景图" : "正在加载全景图..."}
                </div>
            ) : null}
        </div>
    );
}

function PanoramaEmpty({ ctx }: { ctx: CanvasNodeContext }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleFile = useCallback(
        (file: File | undefined) => {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => ctx.updateMetadata({ content: String(reader.result || "") });
            reader.readAsDataURL(file);
        },
        [ctx],
    );

    const buttonStyle = { borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill, color: ctx.theme.node.text };
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3.5 rounded-2xl p-5" style={{ background: ctx.theme.node.fill }}>
            <View className="size-8" style={{ color: ctx.theme.node.placeholder }} />
            <div data-canvas-no-zoom className="flex flex-wrap justify-center gap-2.5" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold" style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
                    <ImageUp className="size-4" />
                    上传全景图
                </button>
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }} onClick={() => ctx.openPanel()}>
                    <Sparkles className="size-4" />
                    AI 生成
                </button>
            </div>
            <span className="text-center text-xs" style={{ color: ctx.theme.node.placeholder }}>支持 2:1 等距柱状全景图</span>
        </div>
    );
}

function PanoramaContent({ ctx }: { ctx: CanvasNodeContext }) {
    const ownSource = ctx.node.metadata?.content || "";
    const upstreamSource = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((content): content is string => Boolean(content));

    useEffect(() => {
        if (!ownSource && upstreamSource) ctx.updateMetadata({ content: upstreamSource });
    }, [ownSource, upstreamSource]);

    const source = ownSource || upstreamSource || "";
    return source ? <PanoramaViewer src={source} ctx={ctx} /> : <PanoramaEmpty ctx={ctx} />;
}

export const panoramaCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.panorama,
    name: "3D 全景节点",
    version: "1.1.0",
    description: "查看 360 度等距柱状全景图，支持上传、AI 生成与上游图片输入",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.panorama,
            title: "3D 全景",
            icon: <View className="size-5" />,
            description: "360 度全景查看器",
            defaultSize: { width: 480, height: 300 },
            defaultMetadata: {},
            minimapColor: "#0ea5e9",
            interactionToggle: true,
            useBuiltinPanel: { mode: "image", promptPrefix: PANORAMA_SYSTEM_PROMPT, writeBackToSelf: true },
            resource: (node) => (node.metadata?.content ? { kind: "image", url: node.metadata.content } : null),
            Content: PanoramaContent,
            toolbar: (ctx) => [
                {
                    id: "panorama-generate",
                    title: "用 AI 生成全景图",
                    label: "AI 生成",
                    icon: <Sparkles className="size-4" />,
                    onClick: () => ctx.openPanel(),
                },
                ...(ctx.node.metadata?.content
                    ? [
                          {
                              id: "panorama-reset",
                              title: "清空当前全景图并重新选择",
                              label: "换图",
                              icon: <RefreshCw className="size-4" />,
                              onClick: () => ctx.updateMetadata({ content: "", interactive: false }),
                          },
                      ]
                    : []),
            ],
        },
    ],
};
