import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { useThemeStore } from "@/stores/use-theme-store";
import { type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { CANVAS_VIEWPORT_LIVE_EVENT, type CanvasViewportApi } from "./infinite-canvas";

const MAP_H = 118;
const PAD = 12;
const MAX_NODES = 240;
const MAX_EDGES = 120;
const EMPTY_WORLD = { minX: -1600, minY: -1200, maxX: 1600, maxY: 1200 };

function worldView(viewport: ViewportTransform, size: { width: number; height: number }) {
    return {
        x: -viewport.x / viewport.k,
        y: -viewport.y / viewport.k,
        w: size.width / viewport.k,
        h: size.height / viewport.k,
    };
}

function pickNodes(nodes: CanvasNodeData[]) {
    if (nodes.length <= MAX_NODES) return nodes;
    return [...nodes].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, MAX_NODES);
}

function nodeBounds(nodes: CanvasNodeData[]) {
    if (!nodes.length) return EMPTY_WORLD;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.width);
        maxY = Math.max(maxY, node.position.y + node.height);
    }
    const padX = Math.max((maxX - minX) * 0.12, 180);
    const padY = Math.max((maxY - minY) * 0.12, 180);
    return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
}

export function Minimap({
    active,
    nodes,
    connections = [],
    viewport,
    viewportSize,
    viewportApiRef,
}: {
    active: boolean;
    nodes: CanvasNodeData[];
    connections?: CanvasConnection[];
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    viewportApiRef: RefObject<CanvasViewportApi | null>;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<HTMLCanvasElement | null>(null);
    const dragging = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const moveFrame = useRef(0);
    const wheelTimer = useRef(0);
    const viewportRef = useRef(viewport);
    const sizeRef = useRef(viewportSize);
    viewportRef.current = viewport;
    sizeRef.current = viewportSize;

    const visibleNodes = useMemo(() => pickNodes(nodes), [nodes]);
    const nodeMap = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
    const bounds = useMemo(() => nodeBounds(visibleNodes), [visibleNodes]);

    const layoutRef = useRef({ minX: 0, minY: 0, scale: 1, ox: 0, oy: 0, width: 256 });

    const syncLayout = useCallback((width: number) => {
        const worldW = Math.max(bounds.maxX - bounds.minX, 1);
        const worldH = Math.max(bounds.maxY - bounds.minY, 1);
        const innerW = Math.max(width - PAD * 2, 1);
        const innerH = MAP_H - PAD * 2;
        const scale = Math.min(innerW / worldW, innerH / worldH);
        layoutRef.current = {
            minX: bounds.minX,
            minY: bounds.minY,
            scale,
            ox: PAD + (innerW - worldW * scale) / 2,
            oy: PAD + (innerH - worldH * scale) / 2,
            width,
        };
    }, [bounds]);

    const toMap = (x: number, y: number) => {
        const { minX, minY, scale, ox, oy } = layoutRef.current;
        return { x: (x - minX) * scale + ox, y: (y - minY) * scale + oy };
    };

    const toWorld = (mx: number, my: number) => {
        const { minX, minY, scale, ox, oy } = layoutRef.current;
        return { x: (mx - ox) / scale + minX, y: (my - oy) / scale + minY };
    };

    const liveViewport = () => viewportApiRef.current?.get() || viewportRef.current;

    const applyLive = (next: ViewportTransform, mode: "pan" | "zoom", commit = false) => {
        const api = viewportApiRef.current;
        if (!api) return;
        if (commit) {
            api.apply(next, { commit: true });
            return;
        }
        api.apply(next, { mode, scheduleCommit: mode === "zoom" });
    };

    const rebuildScene = useCallback(() => {
        const width = layoutRef.current.width;
        if (width < 8) return;
        const dpr = window.devicePixelRatio || 1;
        const scene = sceneRef.current || document.createElement("canvas");
        sceneRef.current = scene;
        scene.width = Math.round(width * dpr);
        scene.height = Math.round(MAP_H * dpr);
        const ctx = scene.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, MAP_H);
        const isLight = theme.canvas.background.startsWith("#f");
        ctx.fillStyle = isLight ? "#ebe7f4" : "#0d0c14";
        ctx.fillRect(0, 0, width, MAP_H);

        ctx.lineWidth = 0.7;
        ctx.strokeStyle = isLight ? "rgba(72,64,96,.12)" : "rgba(230,224,255,.1)";
        ctx.lineCap = "round";
        connections.slice(0, MAX_EDGES).forEach((connection) => {
            const from = nodeMap.get(connection.fromNodeId);
            const to = nodeMap.get(connection.toNodeId);
            if (!from || !to) return;
            const a = toMap(from.position.x + from.width, from.position.y + from.height / 2);
            const b = toMap(to.position.x, to.position.y + to.height / 2);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.bezierCurveTo(a.x + 14, a.y, b.x - 14, b.y, b.x, b.y);
            ctx.stroke();
        });

        visibleNodes.forEach((node) => {
            const p = toMap(node.position.x, node.position.y);
            const w = Math.max(node.width * layoutRef.current.scale, 2.5);
            const h = Math.max(node.height * layoutRef.current.scale, 2);
            const r = Math.min(2, w / 2, h / 2);
            ctx.beginPath();
            ctx.roundRect(p.x, p.y, w, h, r);
            if (node.type === "group") {
                ctx.strokeStyle = isLight ? "rgba(72,64,96,.28)" : "rgba(230,224,255,.28)";
                ctx.lineWidth = 1;
                ctx.stroke();
                return;
            }
            ctx.fillStyle = isLight ? "rgba(72,64,96,.22)" : "rgba(230,224,255,.2)";
            ctx.fill();
        });
    }, [connections, nodeMap, theme, visibleNodes]);

    const paint = useCallback((live = liveViewport()) => {
        const canvas = canvasRef.current;
        const scene = sceneRef.current;
        const ctx = canvas?.getContext("2d", { alpha: false, desynchronized: true });
        if (!canvas || !ctx || !scene) return;
        const width = layoutRef.current.width;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(MAP_H * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(MAP_H * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(scene, 0, 0, width, MAP_H);

        const view = worldView(live, sizeRef.current);
        const p1 = toMap(view.x, view.y);
        const p2 = toMap(view.x + view.w, view.y + view.h);
        const vx = p1.x;
        const vy = p1.y;
        const vw = Math.max(p2.x - p1.x, 10);
        const vh = Math.max(p2.y - p1.y, 8);
        ctx.fillStyle = `${theme.canvas.connectionActive}14`;
        ctx.strokeStyle = theme.canvas.connectionActive;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.roundRect(vx, vy, vw, vh, 3);
        ctx.fill();
        ctx.stroke();
    }, [theme]);

    const refresh = useCallback(() => {
        const width = wrapRef.current?.clientWidth || 0;
        if (width < 8) return;
        syncLayout(width);
        rebuildScene();
        paint();
    }, [paint, rebuildScene, syncLayout]);

    useEffect(() => {
        if (!active) return;
        refresh();
        const wrap = wrapRef.current;
        if (!wrap) return;
        const observer = new ResizeObserver(() => refresh());
        observer.observe(wrap);
        return () => {
            observer.disconnect();
            if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
            window.clearTimeout(wheelTimer.current);
        };
    }, [active, refresh]);

    useEffect(() => {
        if (!active) return;
        let frame = 0;
        const stop = onCanvasEvent(CANVAS_VIEWPORT_LIVE_EVENT, (payload) => {
            const live = payload as ViewportTransform | undefined;
            if (!live) return;
            viewportRef.current = live;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => paint(live));
        });
        return () => {
            cancelAnimationFrame(frame);
            stop();
        };
    }, [active, paint]);

    const mapPoint = (clientX: number, clientY: number) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return toWorld(clientX - rect.left, clientY - rect.top);
    };

    const viewRectOnMap = (live: ViewportTransform) => {
        const view = worldView(live, sizeRef.current);
        const p1 = toMap(view.x, view.y);
        const p2 = toMap(view.x + view.w, view.y + view.h);
        return { x: p1.x, y: p1.y, w: Math.max(p2.x - p1.x, 10), h: Math.max(p2.y - p1.y, 8) };
    };

    const centerOn = (world: { x: number; y: number }, mode: "pan" | "zoom", commit = false) => {
        const current = liveViewport();
        const size = sizeRef.current;
        applyLive(
            {
                x: size.width / 2 - world.x * current.k,
                y: size.height / 2 - world.y * current.k,
                k: current.k,
            },
            mode,
            commit,
        );
    };

    const moveTo = (clientX: number, clientY: number, commit = false) => {
        const world = mapPoint(clientX, clientY);
        if (!world) return;
        centerOn({ x: world.x - dragOffset.current.x, y: world.y - dragOffset.current.y }, "pan", commit);
    };

    return (
        <div
            ref={wrapRef}
            className="canvas-nav-map-surface relative h-full w-full"
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const live = liveViewport();
                const box = viewRectOnMap(live);
                const mx = event.clientX - rect.left;
                const my = event.clientY - rect.top;
                const hitPad = 6;
                const inside = mx >= box.x - hitPad && mx <= box.x + box.w + hitPad && my >= box.y - hitPad && my <= box.y + box.h + hitPad;
                const world = toWorld(mx, my);
                const view = worldView(live, sizeRef.current);
                dragOffset.current = inside
                    ? { x: world.x - (view.x + view.w / 2), y: world.y - (view.y + view.h / 2) }
                    : { x: 0, y: 0 };
                dragging.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                moveTo(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
                if (!dragging.current) return;
                const { clientX, clientY } = event;
                if (moveFrame.current) return;
                moveFrame.current = requestAnimationFrame(() => {
                    moveFrame.current = 0;
                    moveTo(clientX, clientY);
                });
            }}
            onPointerUp={(event) => {
                if (!dragging.current) return;
                dragging.current = false;
                if (moveFrame.current) {
                    cancelAnimationFrame(moveFrame.current);
                    moveFrame.current = 0;
                }
                moveTo(event.clientX, event.clientY, true);
            }}
            onPointerCancel={() => {
                dragging.current = false;
                applyLive(liveViewport(), "pan", true);
            }}
            onWheel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const current = liveViewport();
                const nextK = Math.min(5, Math.max(0.05, current.k * Math.exp(-event.deltaY * 0.0016)));
                const world = mapPoint(event.clientX, event.clientY);
                if (!world) return;
                const size = sizeRef.current;
                applyLive({ x: size.width / 2 - world.x * nextK, y: size.height / 2 - world.y * nextK, k: nextK }, "zoom");
                window.clearTimeout(wheelTimer.current);
                wheelTimer.current = window.setTimeout(() => applyLive(liveViewport(), "zoom", true), 160);
            }}
        >
            <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" height={MAP_H} />
        </div>
    );
}
