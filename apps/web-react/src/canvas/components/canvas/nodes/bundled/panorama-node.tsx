import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Camera, Compass, Grid2x2, ImageUp, Loader2, MapPin, Maximize2, Orbit, Plus, RefreshCw, RotateCcw, Share2, Sparkles, Undo2, View, Wand2, X } from "lucide-react";

import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";
import { DEFAULT_VIEW, directionShots, horizontalFov, isPanoramaShaped, pickLonLat, projectLonLat, rollHalf, type PanoramaMode, type PanoramaView } from "./panorama-math";
import { buildPanoramaSharePage, encodeSceneImage, fitsShareLimit, type SharedScene } from "./panorama-share";
import { loadPanoramaImage, PanoramaViewer, renderPanoramaImage, type PanoramaViewerHandle } from "./panorama-viewer";

const PANORAMA_SYSTEM_PROMPT =
    "A seamless 360-degree equirectangular panorama, 2:1 aspect ratio, full spherical VR photo, " +
    "horizontally wrapping seamlessly at the left and right edges, no visible seam, no distortion artifacts, " +
    "even horizon, no text, no watermark. Scene: ";
const EXTEND_PROMPT = `${PANORAMA_SYSTEM_PROMPT}extend the reference photo into a complete 360-degree surrounding scene, keeping its place, lighting, materials and style; the reference view becomes the front of the panorama.`;
const VARIANT_PROMPT = (change: string) => `${PANORAMA_SYSTEM_PROMPT}keep the exact spatial layout, geometry and composition of the reference panorama; only change the look to: ${change}.`;
const SEAM_PROMPT =
    "This is an equirectangular 360 panorama shifted by half a turn, so its wrap-around seam now runs vertically through the middle. " +
    "Repair only that vertical seam so the left and right halves join naturally (continuous lines, lighting and textures). Keep everything else exactly the same, same size and framing.";
const VARIANTS = ["清晨", "黄昏", "夜晚", "雨天", "雪景", "赛博朋克"];

const ACTION_EVENT = "panorama:action";
type PanoramaAction = "capture" | "split" | "planet" | "fullscreen" | "share";

const MODES: Array<{ id: PanoramaMode; label: string }> = [
    { id: "sphere", label: "球面" },
    { id: "flat", label: "平面" },
    { id: "planet", label: "小行星" },
];

// ---------------------------------------------------------------------------------------------------------------
// Helpers that turn renders into canvas nodes
// ---------------------------------------------------------------------------------------------------------------

async function uploadDataUrl(dataUrl: string) {
    const { uploadImage } = await import("@/services/image-storage");
    return uploadImage(dataUrl);
}

/** Uploads rendered images and places them as image nodes to the right of the panorama, connected to it. */
async function addImageNodes(ctx: CanvasNodeContext, items: Array<{ dataUrl: string; title: string }>, columns = items.length) {
    const uploads = await Promise.all(items.map((item) => uploadDataUrl(item.dataUrl)));
    const base = ctx.getNode(ctx.node.id) || ctx.node;
    const tile = 220;
    const gap = 24;
    const ops = uploads.flatMap((uploaded, index) => {
        const id = `pano-out-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`;
        const width = tile;
        const height = Math.round((tile * (uploaded.height || 1)) / (uploaded.width || 1));
        return [
            {
                type: "add_node" as const,
                id,
                nodeType: "image" as const,
                title: items[index].title,
                x: base.position.x + base.width + 96 + (index % columns) * (tile + gap),
                y: base.position.y + Math.floor(index / columns) * (height + gap + 20),
                width,
                height,
                metadata: { content: uploaded.url, storageKey: uploaded.storageKey, thumbnailUrl: uploaded.thumbnailUrl, thumbnailKey: uploaded.thumbnailKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType, status: "success" as const },
            },
            { type: "connect_nodes" as const, fromNodeId: base.id, toNodeId: id },
        ];
    });
    ctx.applyOps(ops);
}

function panoramaTitle(node: Pick<CanvasNodeData, "title">) {
    return node.title && node.title !== "3D 全景" ? node.title : "全景";
}

// ---------------------------------------------------------------------------------------------------------------
// The stage: viewer + overlay controls. Used on the canvas (compact) and in the full-screen view.
// ---------------------------------------------------------------------------------------------------------------

type StageProps = {
    ctx: CanvasNodeContext;
    /** The node whose image is shown (differs from ctx.node while walking a tour). */
    scene: CanvasNodeData;
    full?: boolean;
    interactive: boolean;
    onNavigate: (nodeId: string) => void;
    onBack?: () => void;
    backLabel?: string;
    onFullscreen?: () => void;
    busy: string;
    runAi: (label: string, task: () => Promise<void>) => void;
    registerActions?: (actions: Partial<Record<PanoramaAction, () => void>>) => void;
};

function Pill({ children, style, className = "" }: { children: ReactNode; style?: CSSProperties; className?: string }) {
    return (
        <div className={`pointer-events-auto flex items-center rounded-full text-[11px] font-medium text-white ${className}`} style={{ background: "rgba(10,10,16,.55)", backdropFilter: "blur(10px)", ...style }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            {children}
        </div>
    );
}

function RoundButton({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: ReactNode }) {
    return (
        <button type="button" title={title} aria-label={title} onClick={onClick} className="grid size-7 place-items-center rounded-full transition-colors" style={{ background: active ? "#fff" : "transparent", color: active ? "#111" : "#fff" }}>
            {children}
        </button>
    );
}

function PanoramaStage({ ctx, scene, full = false, interactive, onNavigate, onBack, backLabel, onFullscreen, busy, runAi, registerActions }: StageProps) {
    const viewerRef = useRef<PanoramaViewerHandle>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<PanoramaMode>("sphere");
    const [autoRotate, setAutoRotate] = useState(!full);
    const [view, setView] = useState<PanoramaView>(DEFAULT_VIEW);
    const [size, setSize] = useState({ width: 1, height: 1 });
    const [ready, setReady] = useState(false);
    const [placing, setPlacing] = useState(false);
    const [editingHotspot, setEditingHotspot] = useState<string | null>(null);
    const [aiOpen, setAiOpen] = useState(false);
    const [confirming, setConfirming] = useState<string | null>(null);
    const [customVariant, setCustomVariant] = useState("");
    const [renamingView, setRenamingView] = useState<string | null>(null);
    const src = scene.metadata?.content || "";
    const own = scene.id === ctx.node.id;
    const views = own ? ctx.node.metadata?.panoViews || [] : [];
    const hotspots = scene.metadata?.panoHotspots || [];
    const targets = useMemo(() => (own ? ctx.getDownstream().filter((node) => node.type === BUNDLED_CANVAS_NODE_TYPES.panorama && node.metadata?.content) : []), [ctx, own]);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setSize({ width: element.clientWidth || 1, height: element.clientHeight || 1 }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const source = () => viewerRef.current?.getSource();

    const capture = useCallback(async () => {
        const image = source();
        const handle = viewerRef.current;
        if (!image || !handle) return;
        const { width, height } = handle.getSize();
        const outWidth = 1600;
        const outHeight = Math.round((outWidth * height) / width);
        const dataUrl = await renderPanoramaImage(image, { mode: mode === "flat" ? "sphere" : mode, view: handle.getView(), planetFov: handle.getPlanetFov(), width: outWidth, height: outHeight, type: "image/jpeg", quality: 0.9 });
        await addImageNodes(ctx, [{ dataUrl, title: `${panoramaTitle(scene)} · 视角` }]);
    }, [ctx, mode, scene]);

    const split = useCallback(async () => {
        const image = source();
        if (!image) return;
        const shots = directionShots(false);
        const items = await Promise.all(shots.map(async (shot) => ({ title: `${panoramaTitle(scene)} · ${shot.name}`, dataUrl: await renderPanoramaImage(image, { mode: "sphere", view: { lon: shot.lon, lat: shot.lat, fov: 90 }, width: 1024, height: 1024, type: "image/jpeg", quality: 0.9 }) })));
        await addImageNodes(ctx, items, 2);
    }, [ctx, scene]);

    const planet = useCallback(async () => {
        const image = source();
        if (!image) return;
        const dataUrl = await renderPanoramaImage(image, { mode: "planet", view: { ...DEFAULT_VIEW, lon: viewerRef.current?.getView().lon || 0 }, planetFov: 270, width: 1600, height: 1600, type: "image/jpeg", quality: 0.92 });
        await addImageNodes(ctx, [{ dataUrl, title: `${panoramaTitle(scene)} · 小行星` }]);
    }, [ctx, scene]);

    useEffect(() => {
        registerActions?.({ capture: () => runAi("正在截取视角…", capture), split: () => runAi("正在拆成 4 个方向…", split), planet: () => runAi("正在生成小行星图…", planet) });
    }, [capture, planet, registerActions, runAi, split]);

    const addView = () => {
        const current = viewerRef.current?.getView() || DEFAULT_VIEW;
        const next = [...views, { id: `v-${Date.now().toString(36)}`, name: `视角 ${views.length + 1}`, lon: Math.round(current.lon * 10) / 10, lat: Math.round(current.lat * 10) / 10, fov: Math.round(current.fov) }];
        ctx.updateMetadata({ panoViews: next });
    };

    const handleClick = (x: number, y: number) => {
        if (mode === "flat") {
            const { width, height } = size;
            const aspect = width / height;
            const imageWidth = aspect > 2 ? height * 2 : width;
            const imageHeight = aspect > 2 ? height : width / 2;
            const u = (x - (width - imageWidth) / 2) / imageWidth;
            const v = (y - (height - imageHeight) / 2) / imageHeight;
            if (u < 0 || u > 1 || v < 0 || v > 1) return;
            viewerRef.current?.setView({ lon: (u - 0.5) * 360, lat: (0.5 - v) * 180 });
            setMode("sphere");
            return;
        }
        if (placing && mode === "sphere" && own) {
            const at = pickLonLat(viewerRef.current?.getView() || view, x, y, size.width, size.height);
            const used = new Set(hotspots.map((spot) => spot.targetNodeId));
            const target = targets.find((node) => !used.has(node.id));
            const id = `h-${Date.now().toString(36)}`;
            ctx.updateMetadata({ panoHotspots: [...hotspots, { id, lon: at.lon, lat: at.lat, label: target ? panoramaTitle(target) : "热点", targetNodeId: target?.id }] });
            setPlacing(false);
            setEditingHotspot(id);
        }
    };

    const updateHotspot = (id: string, patch: Partial<(typeof hotspots)[number]>) => ctx.updateMetadata({ panoHotspots: hotspots.map((spot) => (spot.id === id ? { ...spot, ...patch } : spot)) });

    const repairSeam = () =>
        runAi("AI 正在修复接缝…", async () => {
            const image = source();
            if (!image) return;
            const rolled = rollHalf(image).toDataURL("image/jpeg", 0.92);
            const result = await ctx.ai.generateImage(SEAM_PROMPT, { references: [rolled] });
            const fixed = result.images[0];
            if (!fixed) throw new Error("AI 没有返回图片");
            const back = rollHalf(await loadPanoramaImage(fixed)).toDataURL("image/jpeg", 0.92);
            const uploaded = await uploadDataUrl(back);
            ctx.updateMetadata({ panoPreviousContent: ctx.node.metadata?.content, panoPreviousStorageKey: ctx.node.metadata?.storageKey, content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height });
        });

    const makeVariant = (change: string) =>
        runAi(`AI 正在生成「${change}」版本…`, async () => {
            const result = await ctx.ai.generateImage(VARIANT_PROMPT(change), { references: [scene.metadata?.content || ""] });
            const image = result.images[0];
            if (!image) throw new Error("AI 没有返回图片");
            const uploaded = await uploadDataUrl(image);
            const base = ctx.getNode(ctx.node.id) || ctx.node;
            const id = `panorama-${Date.now().toString(36)}`;
            ctx.applyOps([
                { type: "add_node", id, nodeType: BUNDLED_CANVAS_NODE_TYPES.panorama, title: `${panoramaTitle(base)} · ${change}`, x: base.position.x, y: base.position.y + base.height + 72, width: base.width, height: base.height, metadata: { content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height } },
                { type: "connect_nodes", fromNodeId: base.id, toNodeId: id },
            ]);
        });

    const confirmThen = (key: string, action: () => void) => {
        if (confirming === key) {
            setConfirming(null);
            setAiOpen(false);
            action();
        } else setConfirming(key);
    };

    const hFov = horizontalFov(view.fov, size.width / size.height);
    const flatFrame = (() => {
        const aspect = size.width / size.height;
        const imageWidth = aspect > 2 ? size.height * 2 : size.width;
        const imageHeight = aspect > 2 ? size.height : size.width / 2;
        return {
            left: (size.width - imageWidth) / 2 + (0.5 + view.lon / 360) * imageWidth,
            top: (size.height - imageHeight) / 2 + (0.5 - view.lat / 180) * imageHeight,
            width: (Math.min(hFov, 360) / 360) * imageWidth,
            height: (view.fov / 180) * imageHeight,
        };
    })();
    // In "move" mode the node's content takes no pointer events, so CSS hover never fires; show the controls while the
    // node is selected or being interacted with instead.
    const controlsClass = full || ctx.isSelected || interactive ? "opacity-100 transition-opacity duration-200" : "pointer-events-none opacity-0 transition-opacity duration-200";

    return (
        <div ref={rootRef} className="group/pano relative h-full w-full overflow-hidden rounded-[inherit]">
            <PanoramaViewer
                ref={viewerRef}
                src={src}
                mode={mode}
                autoRotate={autoRotate && !placing}
                interactive={interactive}
                onViewChange={setView}
                onStatus={(status) => setReady(status === "ready")}
                onClick={handleClick}
                onUserInteract={() => setAutoRotate(false)}
            />

            {/* Hotspots (sphere view) */}
            {ready && mode === "sphere"
                ? hotspots.map((spot) => {
                      const at = projectLonLat(view, spot.lon, spot.lat, size.width, size.height);
                      if (!at) return null;
                      const target = spot.targetNodeId ? ctx.getNode(spot.targetNodeId) : null;
                      return (
                          <div key={spot.id} className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: at.x, top: at.y }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                              <button
                                  type="button"
                                  className="size-4 rounded-full bg-white"
                                  style={{ boxShadow: "0 0 0 5px rgba(255,255,255,.35), 0 2px 8px rgba(0,0,0,.4)" }}
                                  title={target ? `前往「${panoramaTitle(target)}」` : "编辑热点"}
                                  onClick={() => (target?.metadata?.content && editingHotspot !== spot.id ? onNavigate(target.id) : own && setEditingHotspot((current) => (current === spot.id ? null : spot.id)))}
                                  onContextMenu={(event) => {
                                      event.preventDefault();
                                      if (own) setEditingHotspot(spot.id);
                                  }}
                              />
                              <span className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] text-white" style={{ background: "rgba(0,0,0,.6)" }}>
                                  {spot.label}
                              </span>
                              {editingHotspot === spot.id && own ? (
                                  <div className="mt-1 flex w-[200px] flex-col gap-1.5 rounded-xl p-2 text-[11px]" style={{ background: "rgba(20,18,28,.94)", color: "#fff" }}>
                                      <input autoFocus defaultValue={spot.label} className="rounded-md px-2 py-1 text-[12px] text-black outline-none" onBlur={(event) => updateHotspot(spot.id, { label: event.target.value.trim() || "热点" })} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
                                      <select value={spot.targetNodeId || ""} onChange={(event) => updateHotspot(spot.id, { targetNodeId: event.target.value || undefined })} className="rounded-md px-1.5 py-1 text-[12px] text-black">
                                          <option value="">不跳转</option>
                                          {targets.map((node) => (
                                              <option key={node.id} value={node.id}>
                                                  前往「{panoramaTitle(node)}」
                                              </option>
                                          ))}
                                      </select>
                                      {!targets.length ? <span className="opacity-70">把这个全景连到另一个全景节点，就能跳转过去</span> : null}
                                      <div className="flex justify-between">
                                          <button type="button" className="text-[#ff8a8a]" onClick={() => (ctx.updateMetadata({ panoHotspots: hotspots.filter((item) => item.id !== spot.id) }), setEditingHotspot(null))}>
                                              删除
                                          </button>
                                          <button type="button" onClick={() => setEditingHotspot(null)}>
                                              完成
                                          </button>
                                      </div>
                                  </div>
                              ) : null}
                          </div>
                      );
                  })
                : null}

            {/* Current view frame (flat view) */}
            {ready && mode === "flat" ? <div className="pointer-events-none absolute rounded border-2 border-white/90" style={{ left: flatFrame.left - flatFrame.width / 2, top: flatFrame.top - flatFrame.height / 2, width: flatFrame.width, height: flatFrame.height, boxShadow: "0 0 0 9999px rgba(0,0,0,.25)" }} /> : null}

            {/* Top: badge / back, view modes */}
            <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-start gap-2">
                {onBack ? (
                    <Pill className="px-1">
                        <button type="button" className="flex items-center gap-1 px-2 py-1" onClick={onBack}>
                            <ArrowLeft className="size-3.5" />
                            {backLabel || "返回"}
                        </button>
                    </Pill>
                ) : (
                    <Pill className="gap-1 px-2 py-1">
                        <Orbit className="size-3.5" />
                        360°
                    </Pill>
                )}
                <span className="flex-1" />
                <Pill className={`gap-0.5 p-0.5 ${controlsClass}`}>
                    {MODES.map((item) => (
                        <button key={item.id} type="button" className="rounded-full px-2.5 py-1 transition-colors" style={mode === item.id ? { background: "#fff", color: "#111" } : undefined} onClick={() => setMode(item.id)}>
                            {item.label}
                        </button>
                    ))}
                </Pill>
            </div>

            {placing ? (
                <Pill className="absolute left-1/2 top-12 -translate-x-1/2 gap-2 px-3 py-1.5">
                    <MapPin className="size-3.5" />
                    点击画面放置热点
                    <button type="button" className="opacity-70" onClick={() => setPlacing(false)}>
                        取消
                    </button>
                </Pill>
            ) : null}

            {busy ? (
                <Pill className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 gap-2 px-3.5 py-2 text-[12px]">
                    <Loader2 className="size-4 animate-spin" />
                    {busy}
                </Pill>
            ) : null}

            {/* Bottom: compass, bookmarks, actions */}
            <div className={`pointer-events-none absolute inset-x-2.5 bottom-2.5 flex items-end gap-2 ${controlsClass}`}>
                {mode === "sphere" ? (
                    <Pill className="relative size-10 justify-center" style={{ borderRadius: 999 }}>
                        <span title={`朝向 ${Math.round(((view.lon % 360) + 360) % 360)}°`} className="relative grid size-10 place-items-center">
                            <Compass className="size-5 opacity-40" />
                            <span className="absolute left-1/2 top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-full rounded-full bg-[#ff6b6b]" style={{ transformOrigin: "50% 100%", transform: `translate(-50%, -100%) rotate(${-view.lon}deg)` }} />
                            <span className="absolute -top-[1px] text-[8px] font-bold">前</span>
                        </span>
                    </Pill>
                ) : null}
                <div className="flex min-w-0 flex-1 justify-center">
                    {own && (views.length || full || size.width > 360) ? (
                        <Pill className="max-w-full gap-1 overflow-x-auto p-1">
                            {views.slice(0, full ? 20 : 5).map((item) =>
                                renamingView === item.id ? (
                                    <input
                                        key={item.id}
                                        autoFocus
                                        defaultValue={item.name}
                                        className="w-20 rounded-full px-2 py-0.5 text-[11px] text-black outline-none"
                                        onBlur={(event) => {
                                            const name = event.target.value.trim();
                                            ctx.updateMetadata({ panoViews: views.map((view) => (view.id === item.id ? { ...view, name: name || view.name } : view)) });
                                            setRenamingView(null);
                                        }}
                                        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                                    />
                                ) : (
                                    <span key={item.id} className="group/view flex shrink-0 items-center rounded-full bg-white/15 hover:bg-white/25">
                                        <button type="button" className="px-2.5 py-1" title="转到这个视角（双击改名）" onClick={() => (setAutoRotate(false), setMode("sphere"), viewerRef.current?.setView({ lon: item.lon, lat: item.lat, fov: item.fov }))} onDoubleClick={() => setRenamingView(item.id)}>
                                            {item.name}
                                        </button>
                                        <button type="button" className="hidden pr-1.5 opacity-70 group-hover/view:block" title="删除这个视角" onClick={() => ctx.updateMetadata({ panoViews: views.filter((view) => view.id !== item.id) })}>
                                            <X className="size-3" />
                                        </button>
                                    </span>
                                ),
                            )}
                            <button type="button" className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 opacity-80 hover:opacity-100" title="把当前视角存成书签" onClick={addView}>
                                <Plus className="size-3" />
                                视角
                            </button>
                        </Pill>
                    ) : null}
                </div>
                <Pill className="gap-0.5 p-0.5">
                    <RoundButton title={autoRotate ? "停止自动旋转" : "自动旋转"} active={autoRotate} onClick={() => setAutoRotate((value) => !value)}>
                        <Orbit className="size-3.5" />
                    </RoundButton>
                    <RoundButton title="回到初始视角" onClick={() => viewerRef.current?.setView(DEFAULT_VIEW)}>
                        <RotateCcw className="size-3.5" />
                    </RoundButton>
                    {own ? (
                        <RoundButton title="放置热点" active={placing} onClick={() => (setMode("sphere"), setPlacing((value) => !value))}>
                            <MapPin className="size-3.5" />
                        </RoundButton>
                    ) : null}
                    <RoundButton title="截取当前视角，生成图片节点" onClick={() => runAi("正在截取视角…", capture)}>
                        <Camera className="size-3.5" />
                    </RoundButton>
                    {own ? (
                        <RoundButton title="AI 工具" active={aiOpen} onClick={() => (setAiOpen((value) => !value), setConfirming(null))}>
                            <Wand2 className="size-3.5" />
                        </RoundButton>
                    ) : null}
                    {onFullscreen ? (
                        <RoundButton title="全屏查看" onClick={onFullscreen}>
                            <Maximize2 className="size-3.5" />
                        </RoundButton>
                    ) : null}
                </Pill>
            </div>

            {aiOpen && own ? (
                <div className="pointer-events-auto absolute bottom-14 right-2.5 w-[250px] rounded-2xl p-3 text-[12px] text-white" style={{ background: "rgba(16,14,24,.94)", backdropFilter: "blur(12px)" }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <div className="mb-2 flex items-center gap-1.5 font-semibold">
                        <Sparkles className="size-3.5" />
                        AI 工具
                        <span className="ml-auto text-[10px] font-normal opacity-60">每次会消耗积分</span>
                    </div>
                    <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left" style={{ background: confirming === "seam" ? "#6d4aff" : "rgba(255,255,255,.08)" }} onClick={() => confirmThen("seam", repairSeam)}>
                        <Wand2 className="size-3.5" />
                        {confirming === "seam" ? "再点一次开始修复" : "修复左右接缝"}
                    </button>
                    {ctx.node.metadata?.panoPreviousContent ? (
                        <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left" style={{ background: "rgba(255,255,255,.08)" }} onClick={() => (ctx.updateMetadata({ content: ctx.node.metadata?.panoPreviousContent, storageKey: ctx.node.metadata?.panoPreviousStorageKey, panoPreviousContent: undefined, panoPreviousStorageKey: undefined }), setAiOpen(false))}>
                            <Undo2 className="size-3.5" />
                            撤销上次修复
                        </button>
                    ) : null}
                    <div className="mb-1.5 opacity-70">生成氛围变体（新节点）</div>
                    <div className="flex flex-wrap gap-1.5">
                        {VARIANTS.map((item) => (
                            <button key={item} type="button" className="rounded-full px-2.5 py-1" style={{ background: confirming === item ? "#6d4aff" : "rgba(255,255,255,.1)" }} onClick={() => confirmThen(item, () => makeVariant(item))}>
                                {confirming === item ? "确认生成" : item}
                            </button>
                        ))}
                    </div>
                    <form
                        className="mt-2 flex gap-1.5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const value = customVariant.trim();
                            if (!value) return;
                            confirmThen(`custom:${value}`, () => (makeVariant(value), setCustomVariant("")));
                        }}
                    >
                        <input value={customVariant} onChange={(event) => setCustomVariant(event.target.value)} placeholder="自定义，如：秋天落叶" className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px] text-black outline-none" />
                        <button type="submit" className="rounded-md px-2 py-1" style={{ background: confirming?.startsWith("custom:") ? "#6d4aff" : "rgba(255,255,255,.14)" }}>
                            {confirming?.startsWith("custom:") ? "确认" : "生成"}
                        </button>
                    </form>
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Full-screen view and sharing
// ---------------------------------------------------------------------------------------------------------------

async function sharePanoramaTour(ctx: CanvasNodeContext) {
    // The tour is this panorama plus every panorama reachable through hotspots (at most six).
    const ids: string[] = [];
    const queue = [ctx.node.id];
    while (queue.length && ids.length < 6) {
        const id = queue.shift()!;
        if (ids.includes(id)) continue;
        const node = id === ctx.node.id ? ctx.node : ctx.getNode(id);
        if (!node?.metadata?.content) continue;
        ids.push(id);
        (node.metadata.panoHotspots || []).forEach((spot) => spot.targetNodeId && queue.push(spot.targetNodeId));
    }
    const nodes = ids.map((id) => (id === ctx.node.id ? ctx.node : ctx.getNode(id)!));
    const images = await Promise.all(nodes.map((node) => loadPanoramaImage(node.metadata!.content!)));
    const build = (width: number, quality: number): SharedScene[] =>
        nodes.map((node, index) => ({
            id: node.id,
            title: panoramaTitle(node),
            image: encodeSceneImage(images[index], width, quality),
            hotspots: (node.metadata?.panoHotspots || []).map((spot) => ({ lon: spot.lon, lat: spot.lat, label: spot.label, target: spot.targetNodeId && ids.includes(spot.targetNodeId) ? spot.targetNodeId : undefined })),
        }));
    let scenes = build(nodes.length > 1 ? 2048 : 3072, 0.84);
    for (const [width, quality] of [[2048, 0.78], [1600, 0.72], [1280, 0.68]] as const) {
        if (fitsShareLimit(scenes)) break;
        scenes = build(width, quality);
    }
    if (!fitsShareLimit(scenes)) throw new Error("全景图太多或太大，无法放进一个分享链接");
    const { publishHtmlShare } = await import("@/services/html-share-api");
    const result = await publishHtmlShare({ html: buildPanoramaSharePage(panoramaTitle(ctx.node), scenes), title: panoramaTitle(ctx.node), shareId: ctx.node.metadata?.htmlShare?.id });
    ctx.updateMetadata({ htmlShare: { id: result.id, url: result.url, at: new Date().toISOString() } });
    await navigator.clipboard?.writeText(result.url).catch(() => undefined);
    return result.url;
}

function PanoramaFullscreen({ ctx, scene, onClose, onNavigate, onBack, backLabel, busy, runAi }: { ctx: CanvasNodeContext; scene: CanvasNodeData; onClose: () => void; onNavigate: (id: string) => void; onBack?: () => void; backLabel?: string; busy: string; runAi: StageProps["runAi"] }) {
    const [shareState, setShareState] = useState<{ status: "idle" | "busy" | "done" | "error"; text?: string }>({ status: "idle" });
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    const share = async () => {
        setShareState({ status: "busy" });
        try {
            const url = await sharePanoramaTour(ctx);
            setShareState({ status: "done", text: url });
        } catch (error) {
            setShareState({ status: "error", text: error instanceof Error ? error.message : "发布失败" });
        }
    };
    return createPortal(
        <div data-canvas-shortcuts-ignore="true" data-canvas-no-zoom="true" className="fixed inset-0 flex flex-col bg-black" style={{ zIndex: 5000, pointerEvents: "auto" }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="flex h-14 shrink-0 items-center gap-3 px-5 text-white">
                <View className="size-4 opacity-70" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{panoramaTitle(scene)}</span>
                {shareState.status === "done" || shareState.status === "error" ? (
                    <span className="max-w-[40vw] truncate text-[12px]" style={{ color: shareState.status === "error" ? "#ff8a8a" : "rgba(255,255,255,.75)" }}>
                        {shareState.status === "done" ? `链接已复制：${shareState.text}` : shareState.text}
                    </span>
                ) : null}
                <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/12 px-3 text-[13px] font-semibold hover:bg-white/20" disabled={shareState.status === "busy"} onClick={() => void share()} title="发布成任何人都能打开的 360° 链接（含热点漫游）">
                    <Share2 className="size-4" />
                    {shareState.status === "busy" ? "发布中…" : ctx.node.metadata?.htmlShare ? "更新分享" : "分享"}
                </button>
                <button type="button" className="grid size-8 place-items-center rounded-full bg-white/12 hover:bg-white/20" onClick={onClose} title="关闭 (Esc)">
                    <X className="size-4" />
                </button>
            </div>
            <div className="relative min-h-0 flex-1">
                <PanoramaStage ctx={ctx} scene={scene} full interactive onNavigate={onNavigate} onBack={onBack} backLabel={backLabel} busy={busy} runAi={runAi} />
            </div>
        </div>,
        getCanvasPortalRoot(),
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Node content
// ---------------------------------------------------------------------------------------------------------------

function PanoramaEmpty({ ctx, upstreamPhoto, runAi }: { ctx: CanvasNodeContext; upstreamPhoto?: CanvasNodeData; runAi: StageProps["runAi"] }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [confirmExtend, setConfirmExtend] = useState(false);
    const handleFile = (file: File | undefined) => {
        if (!file) return;
        // Panoramas are large: upload them instead of keeping the whole image inside the canvas document.
        runAi("正在上传全景图…", async () => {
            const { uploadImage } = await import("@/services/image-storage");
            const uploaded = await uploadImage(file);
            ctx.updateMetadata({ content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height });
        });
    };
    const extend = () =>
        runAi("AI 正在把图片扩展成 360° 全景…", async () => {
            const result = await ctx.ai.generateImage(EXTEND_PROMPT, { references: [upstreamPhoto?.metadata?.content || ""] });
            const image = result.images[0];
            if (!image) throw new Error("AI 没有返回图片");
            const uploaded = await uploadDataUrl(image);
            ctx.updateMetadata({ content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height });
        });
    const buttonStyle = { borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill, color: ctx.theme.node.text };
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3.5 rounded-2xl p-5" style={{ background: ctx.theme.node.fill }}>
            <View className="size-8" style={{ color: ctx.theme.node.placeholder }} />
            <div data-canvas-no-zoom className="flex flex-wrap justify-center gap-2.5" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
                {upstreamPhoto ? (
                    <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-white" style={{ background: confirmExtend ? "#6d4aff" : "linear-gradient(135deg,#8b6cff,#3d7bff)" }} onClick={() => (confirmExtend ? (setConfirmExtend(false), extend()) : setConfirmExtend(true))}>
                        <Sparkles className="size-4" />
                        {confirmExtend ? "会消耗积分，再点一次" : "把连接的图片扩展成 360°"}
                    </button>
                ) : null}
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold" style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
                    <ImageUp className="size-4" />
                    上传全景图
                </button>
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }} onClick={() => ctx.openPanel()}>
                    <Sparkles className="size-4" />
                    AI 生成
                </button>
            </div>
            <span className="text-center text-xs" style={{ color: ctx.theme.node.placeholder }}>
                {upstreamPhoto ? "已连接一张普通图片，可以 AI 扩展成全景" : "支持 2:1 等距柱状全景图"}
            </span>
        </div>
    );
}

function PanoramaContent({ ctx }: { ctx: CanvasNodeContext }) {
    const ownSource = ctx.node.metadata?.content || "";
    const upstreamImages = ctx.getUpstream().filter((node) => node.type === "image" && node.metadata?.content);
    // A connected image is shown directly only when it already is a panorama; a normal photo is offered for extension.
    const upstreamPanorama = upstreamImages.find((node) => isPanoramaShaped(node.metadata?.naturalWidth, node.metadata?.naturalHeight));
    const upstreamPhoto = upstreamPanorama ? undefined : upstreamImages[0];
    const [path, setPath] = useState<string[]>([]);
    const [fullscreen, setFullscreen] = useState(false);
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const actionsRef = useRef<Partial<Record<PanoramaAction, () => void>>>({});
    const nodeId = ctx.node.id;
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;

    useEffect(() => {
        if (!ownSource && upstreamPanorama?.metadata?.content) ctx.updateMetadata({ content: upstreamPanorama.metadata.content, storageKey: upstreamPanorama.metadata.storageKey, naturalWidth: upstreamPanorama.metadata.naturalWidth, naturalHeight: upstreamPanorama.metadata.naturalHeight });
    }, [ownSource, upstreamPanorama?.metadata?.content]);

    const runAi = useCallback((label: string, task: () => Promise<void>) => {
        setBusy(label);
        setError("");
        void task()
            .catch((cause) => setError(cause instanceof Error ? cause.message : "操作失败"))
            .finally(() => setBusy(""));
    }, []);

    // Older panoramas kept the uploaded file inline in the canvas; move it to cloud storage once.
    useEffect(() => {
        if (!ownSource.startsWith("data:")) return;
        let alive = true;
        void uploadDataUrl(ownSource)
            .then((uploaded) => alive && ctxRef.current.updateMetadata({ content: uploaded.url, storageKey: uploaded.storageKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height }))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [ownSource]);

    useEffect(
        () =>
            ctxRef.current.on(ACTION_EVENT, (payload) => {
                const { nodeId: target, action } = (payload || {}) as { nodeId?: string; action?: PanoramaAction };
                if (target !== nodeId || !action) return;
                if (action === "fullscreen") setFullscreen(true);
                else if (action === "share") runAi("正在发布分享链接…", async () => void (await sharePanoramaTour(ctxRef.current)));
                else actionsRef.current[action]?.();
            }),
        [nodeId, runAi],
    );

    if (!ownSource) return <PanoramaEmpty ctx={ctx} upstreamPhoto={upstreamPhoto} runAi={runAi} />;

    const sceneId = path[path.length - 1] || nodeId;
    const scene = sceneId === nodeId ? ctx.node : ctx.getNode(sceneId) || ctx.node;
    const previous = path.length ? path[path.length - 2] || nodeId : null;
    const previousNode = previous ? (previous === nodeId ? ctx.node : ctx.getNode(previous)) : null;
    const navigate = (id: string) => setPath((current) => [...current, id]);
    const back = previous ? () => setPath((current) => current.slice(0, -1)) : undefined;

    return (
        <div className="relative h-full w-full overflow-hidden rounded-[inherit]">
            <PanoramaStage
                key={scene.id}
                ctx={ctx}
                scene={scene}
                interactive={Boolean(ctx.node.metadata?.interactive)}
                onNavigate={navigate}
                onBack={back}
                backLabel={previousNode ? `返回「${panoramaTitle(previousNode)}」` : undefined}
                onFullscreen={() => setFullscreen(true)}
                busy={fullscreen ? "" : busy}
                runAi={runAi}
                registerActions={(actions) => (actionsRef.current = actions)}
            />
            {error ? (
                <div className="pointer-events-auto absolute inset-x-3 top-12 flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] text-white" style={{ background: "rgba(200,40,50,.9)" }} onMouseDown={(event) => event.stopPropagation()}>
                    <span className="min-w-0 flex-1">{error}</span>
                    <button type="button" onClick={() => setError("")}>
                        <X className="size-3.5" />
                    </button>
                </div>
            ) : null}
            {fullscreen ? <PanoramaFullscreen ctx={ctx} scene={scene} onClose={() => setFullscreen(false)} onNavigate={navigate} onBack={back} backLabel={previousNode ? `返回「${panoramaTitle(previousNode)}」` : undefined} busy={busy} runAi={runAi} /> : null}
        </div>
    );
}

export const panoramaCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.panorama,
    name: "3D 全景节点",
    version: "2.0.0",
    description: "360° 全景查看：球面 / 平面 / 小行星视图、视角书签、截图与拆镜头、AI 扩展与变体、热点漫游和分享",
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
            toolbar: (ctx) => {
                const has = Boolean(ctx.node.metadata?.content);
                const act = (action: PanoramaAction) => () => ctx.emit(ACTION_EVENT, { nodeId: ctx.node.id, action });
                return [
                    { id: "panorama-generate", title: "用 AI 生成全景图", label: "AI 生成", icon: <Sparkles className="size-4" />, onClick: () => ctx.openPanel() },
                    ...(has
                        ? [
                              { id: "panorama-capture", title: "截取当前视角，生成图片节点", label: "截视角", icon: <Camera className="size-4" />, onClick: act("capture") },
                              { id: "panorama-split", title: "按前、右、后、左拆成 4 张镜头图", label: "拆镜头", icon: <Grid2x2 className="size-4" />, onClick: act("split") },
                              { id: "panorama-planet", title: "导出小行星效果图", label: "小行星", icon: <Orbit className="size-4" />, onClick: act("planet") },
                              { id: "panorama-fullscreen", title: "全屏沉浸查看", label: "全屏", icon: <Maximize2 className="size-4" />, onClick: act("fullscreen") },
                              { id: "panorama-share", title: "发布成任何人都能打开的 360° 链接（含热点漫游）", label: "分享", icon: <Share2 className="size-4" />, onClick: act("share") },
                              { id: "panorama-reset", title: "清空当前全景图并重新选择", label: "换图", icon: <RefreshCw className="size-4" />, onClick: () => ctx.updateMetadata({ content: "", storageKey: undefined, interactive: false }) },
                          ]
                        : []),
                ];
            },
        },
    ],
};
