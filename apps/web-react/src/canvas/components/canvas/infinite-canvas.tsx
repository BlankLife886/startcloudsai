import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { emitCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

export const CANVAS_VIEWPORT_LIVE_EVENT = "viewport:live";
export const MIN_CANVAS_SCALE = 0.05;
export const MAX_CANVAS_SCALE = 5;
const VIEWPORT_COMMIT_MS = 450;
const LOW_ZOOM = 0.14;
const GRID_BASE = 48;
let liveCanvasScale = 1;

export function getCanvasLiveScale(fallback = 1) {
    return Number.isFinite(liveCanvasScale) && liveCanvasScale > 0 ? liveCanvasScale : fallback;
}

export function wheelZoomFactor(deltaY: number, deltaMode: number, sensitivity = 0.0016) {
    let delta = deltaY;
    if (deltaMode === 1) delta *= 40;
    else if (deltaMode === 2) delta *= 800;
    return Math.exp(-delta * sensitivity);
}

export type CanvasViewportApi = {
    apply: (viewport: ViewportTransform, options?: { commit?: boolean; scheduleCommit?: boolean; mode?: "pan" | "zoom" }) => void;
    get: () => ViewportTransform;
};

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    viewportApiRef?: React.RefObject<CanvasViewportApi | null>;
    onViewportChange: (viewport: ViewportTransform) => void;
    onLiveViewport?: (viewport: ViewportTransform) => void;
    onViewportInteractionChange?: (busy: boolean) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

function clampScale(scale: number) {
    return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

function worldTransform(viewport: ViewportTransform) {
    return `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`;
}

function gridStep(zoom: number) {
    return zoom <= 0.18 ? 4 : zoom <= 0.32 ? 2 : 1;
}

function wrapOffset(value: number, size: number) {
    if (!Number.isFinite(size) || size <= 0) return 0;
    return ((value % size) + size) % size;
}

function paintViewport(world: HTMLElement | null, grid: HTMLElement | null, stage: HTMLElement | null, viewport: ViewportTransform) {
    liveCanvasScale = viewport.k;
    if (world) world.style.transform = worldTransform(viewport);
    if (grid) {
        const size = GRID_BASE * viewport.k * gridStep(viewport.k);
        grid.style.setProperty("--canvas-grid-size", `${size}px`);
        grid.style.setProperty("--canvas-grid-x", `${wrapOffset(viewport.x, size)}px`);
        grid.style.setProperty("--canvas-grid-y", `${wrapOffset(viewport.y, size)}px`);
    }
    stage?.classList.toggle("canvas-stage--low-zoom", viewport.k <= LOW_ZOOM);
}

export function InfiniteCanvas({
    containerRef,
    viewport,
    tool,
    backgroundMode = "lines",
    viewportApiRef,
    onViewportChange,
    onLiveViewport,
    onViewportInteractionChange,
    onCanvasMouseDown,
    onCanvasDeselect,
    onContextMenu,
    onDrop,
    children,
}: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const worldRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const liveRef = useRef(viewport);
    const interactingRef = useRef(false);
    const frameRef = useRef<number | null>(null);
    const commitTimerRef = useRef<number | null>(null);
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
        button: -1,
        pointerId: -1,
    });
    const suppressContextMenu = useRef(false);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isControlPressed, setIsControlPressed] = useState(false);
    const callbacksRef = useRef({ onViewportChange, onLiveViewport, onViewportInteractionChange, onCanvasDeselect });
    callbacksRef.current = { onViewportChange, onLiveViewport, onViewportInteractionChange, onCanvasDeselect };

    const paint = (next: ViewportTransform) => {
        paintViewport(worldRef.current, gridRef.current, containerRef.current, next);
    };

    const publish = (next: ViewportTransform) => {
        liveRef.current = next;
        paint(next);
        callbacksRef.current.onLiveViewport?.(next);
        emitCanvasEvent(CANVAS_VIEWPORT_LIVE_EVENT, next);
    };

    const setInteracting = (busy: boolean) => {
        const changed = interactingRef.current !== busy;
        interactingRef.current = busy;
        containerRef.current?.classList.toggle("canvas-stage--interacting", busy);
        if (changed) callbacksRef.current.onViewportInteractionChange?.(busy);
    };

    const commit = (next = liveRef.current) => {
        if (commitTimerRef.current) {
            window.clearTimeout(commitTimerRef.current);
            commitTimerRef.current = null;
        }
        liveRef.current = next;
        paint(next);
        callbacksRef.current.onLiveViewport?.(next);
        callbacksRef.current.onViewportChange(next);
        containerRef.current?.classList.remove("canvas-stage--zooming", "canvas-stage--panning");
        setInteracting(false);
    };

    const scheduleCommit = () => {
        if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(() => commit(liveRef.current), VIEWPORT_COMMIT_MS);
    };

    const apply = (next: ViewportTransform, options?: { commit?: boolean; scheduleCommit?: boolean; mode?: "pan" | "zoom" }) => {
        const viewportNext = { x: next.x, y: next.y, k: clampScale(next.k) };
        if (options?.commit) {
            commit(viewportNext);
            return;
        }
        setInteracting(true);
        if (options?.mode === "zoom") containerRef.current?.classList.add("canvas-stage--zooming");
        if (options?.mode === "pan") containerRef.current?.classList.add("canvas-stage--panning");
        publish(viewportNext);
        if (options?.scheduleCommit) scheduleCommit();
    };

    useLayoutEffect(() => {
        if (viewportApiRef) viewportApiRef.current = { apply, get: () => liveRef.current };
        return () => {
            if (viewportApiRef) viewportApiRef.current = null;
        };
    });

    useLayoutEffect(() => {
        if (interactingRef.current) return;
        liveRef.current = viewport;
        paint(viewport);
    }, [viewport]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") setIsControlPressed(true);
            if (event.code !== "Space") return;
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']")) return;
            event.preventDefault();
            setIsSpacePressed(true);
            containerRef.current?.classList.add("canvas-stage--space-panning");
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                const target = event.target instanceof Element ? event.target : null;
                if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']"))) event.preventDefault();
                setIsSpacePressed(false);
                containerRef.current?.classList.remove("canvas-stage--space-panning");
            }
            if (event.key === "Control") setIsControlPressed(false);
        };

        const handleBlur = () => {
            setIsSpacePressed(false);
            setIsControlPressed(false);
            if (panState.current.isPanning) {
                const moved = panState.current.hasMoved;
                panState.current.isPanning = false;
                if (moved) commit(liveRef.current);
                else setInteracting(false);
            }
            document.body.style.cursor = "";
            containerRef.current?.classList.remove("canvas-stage--space-panning", "canvas-stage--panning");
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, [containerRef]);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const temporaryTool = event.ctrlKey || isSpacePressed;
        const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
        const shouldPan = event.button === 1 || event.button === 2 || (event.button === 0 && activeTool === "pan");

        if (shouldPan) {
            if (event.button !== 2) event.preventDefault();
            if (event.button !== 2) event.currentTarget.setPointerCapture(event.pointerId);
            const current = liveRef.current;
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: current.x,
                initialY: current.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
                button: event.button,
                pointerId: event.pointerId,
            };
            if (event.button !== 2) {
                setInteracting(true);
                containerRef.current?.classList.add("canvas-stage--panning");
                document.body.style.cursor = "grabbing";
            }
            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;
            if (panState.current.pointerId >= 0 && event.pointerId !== panState.current.pointerId) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (!panState.current.hasMoved) {
                const slop = panState.current.button === 2 ? 8 : 3;
                if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return;
                panState.current.hasMoved = true;
                if (panState.current.button === 2) {
                    suppressContextMenu.current = true;
                    setInteracting(true);
                    containerRef.current?.classList.add("canvas-stage--panning");
                    document.body.style.cursor = "grabbing";
                    containerRef.current?.setPointerCapture(event.pointerId);
                }
            }

            const next = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: liveRef.current.k,
            };
            liveRef.current = next;
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                publish(liveRef.current);
            });
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;
            if (panState.current.pointerId >= 0 && event.pointerId !== panState.current.pointerId) return;
            const moved = panState.current.hasMoved;
            if (!moved && panState.current.startedOnBackground && panState.current.button !== 2) callbacksRef.current.onCanvasDeselect?.();
            if (panState.current.button === 2 && moved) suppressContextMenu.current = true;
            panState.current.isPanning = false;
            panState.current.hasMoved = false;
            panState.current.button = -1;
            panState.current.pointerId = -1;
            document.body.style.cursor = "";
            if (moved) commit(liveRef.current);
            else {
                containerRef.current?.classList.remove("canvas-stage--panning");
                setInteracting(false);
            }
        };

        const handleContextMenu = (event: MouseEvent) => {
            if (!suppressContextMenu.current && !(panState.current.button === 2 && panState.current.hasMoved)) return;
            event.preventDefault();
            suppressContextMenu.current = false;
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        window.addEventListener("contextmenu", handleContextMenu, true);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            window.removeEventListener("contextmenu", handleContextMenu, true);
            document.body.style.cursor = "";
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();

            const current = liveRef.current;
            const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
            const nextScale = clampScale(current.k * factor);
            const rect = container.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            const worldX = (mouseX - current.x) / current.k;
            const worldY = (mouseY - current.y) / current.k;
            const next = { x: mouseX - worldX * nextScale, y: mouseY - worldY * nextScale, k: nextScale };

            setInteracting(true);
            container.classList.add("canvas-stage--zooming");
            liveRef.current = next;
            if (!frameRef.current) {
                frameRef.current = requestAnimationFrame(() => {
                    frameRef.current = null;
                    publish(liveRef.current);
                });
            }
            scheduleCommit();
        };

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => container.removeEventListener("wheel", handleWheel);
    }, [containerRef]);

    const temporaryTool = isControlPressed || isSpacePressed;
    const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;

    return (
        <div
            ref={containerRef}
            className="canvas-stage relative h-full w-full select-none overflow-hidden"
            style={{ background: theme.canvas.background, cursor: activeTool === "pan" ? "grab" : undefined }}
            onPointerDown={handlePointerDown}
            onContextMenu={(event) => {
                if (suppressContextMenu.current || (panState.current.button === 2 && panState.current.hasMoved)) {
                    event.preventDefault();
                    event.stopPropagation();
                    suppressContextMenu.current = false;
                    return;
                }
                onContextMenu?.(event);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            {backgroundMode === "blank" ? null : <div ref={gridRef} className="canvas-grid pointer-events-none absolute inset-0 opacity-55" data-mode={backgroundMode} style={{ backgroundImage: backgroundMode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} 1.1px, transparent 1.3px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)` }} />}
            <div ref={worldRef} className="canvas-world absolute origin-top-left">
                {children}
            </div>
        </div>
    );
}
