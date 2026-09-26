import { useCallback, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";

import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import { onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { positionCanvasFloatingLayer, type CanvasFloatingPlacement, type CanvasFloatingRect } from "@/lib/canvas/canvas-floating-geometry";
import { CANVAS_VIEWPORT_LIVE_EVENT } from "./infinite-canvas";

type CanvasFloatingLayerProps = HTMLAttributes<HTMLDivElement> & {
    anchorRef?: RefObject<HTMLElement | null>;
    getAnchorElement?: () => HTMLElement | null;
    point?: { x: number; y: number };
    panelRef?: RefObject<HTMLDivElement | null>;
    placement?: CanvasFloatingPlacement;
    gap?: number;
    width?: number;
    avoidSelector?: string;
};

function canvasFloatingBounds(anchor: HTMLElement | null): CanvasFloatingRect {
    const stage = anchor?.closest(".canvas-stage") || document.querySelector(".canvas-stage");
    const rect = stage?.getBoundingClientRect();
    return {
        left: Math.max(0, rect?.left ?? 0),
        top: Math.max(0, rect?.top ?? 0),
        right: Math.min(window.innerWidth, rect?.right ?? window.innerWidth),
        bottom: Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight),
    };
}

/** Only mounted controls observe the viewport; positioning does not rerender the canvas. */
export function CanvasFloatingLayer({ anchorRef, getAnchorElement, point, panelRef, placement = "bottom", gap = 12, width, avoidSelector, style, children, onMouseDown, onPointerDown, onClick, ...props }: CanvasFloatingLayerProps) {
    const layerRef = useRef<HTMLDivElement | null>(null);
    const inputsRef = useRef({ anchorRef, getAnchorElement, point, placement, gap, avoidSelector });
    inputsRef.current = { anchorRef, getAnchorElement, point, placement, gap, avoidSelector };
    const scheduleRef = useRef<() => void>(() => undefined);
    const setRef = useCallback((element: HTMLDivElement | null) => {
        layerRef.current = element;
        if (panelRef) panelRef.current = element;
    }, [panelRef]);

    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        let frame: number | null = null;
        const anchorElement = () => inputsRef.current.anchorRef?.current || inputsRef.current.getAnchorElement?.() || null;
        const position = () => {
            frame = null;
            const inputs = inputsRef.current;
            const element = anchorElement();
            const rect = inputs.point
                ? { left: inputs.point.x, right: inputs.point.x, top: inputs.point.y, bottom: inputs.point.y }
                : element?.getBoundingClientRect();
            if (!rect || (element && !element.isConnected)) {
                layer.style.visibility = "hidden";
                return;
            }
            const bounds = canvasFloatingBounds(element);
            // Constrain before measuring so wrapped content uses its actual screen height.
            const limits = positionCanvasFloatingLayer({ anchor: rect, bounds, width: 0, height: 0 });
            layer.style.maxWidth = `${limits.maxWidth}px`;
            layer.style.maxHeight = `${limits.maxHeight}px`;
            const avoided = inputs.avoidSelector ? document.querySelector<HTMLElement>(inputs.avoidSelector) : null;
            const next = positionCanvasFloatingLayer({ anchor: rect, bounds, width: layer.offsetWidth, height: layer.offsetHeight, placement: inputs.placement, gap: inputs.gap, avoid: avoided?.getBoundingClientRect(), avoidEdges: false });
            layer.style.left = `${next.left}px`;
            layer.style.top = `${next.top}px`;
            layer.style.visibility = "visible";
            layer.dataset.placement = next.side;
        };
        const schedule = () => {
            if (frame === null) frame = requestAnimationFrame(position);
        };
        scheduleRef.current = schedule;
        position();
        const resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(layer);
        const anchor = anchorElement();
        const mutationObserver = new MutationObserver(schedule);
        if (anchor) {
            resizeObserver.observe(anchor);
            mutationObserver.observe(anchor, { attributes: true, attributeFilter: ["style"] });
        }
        const stopViewport = onCanvasEvent(CANVAS_VIEWPORT_LIVE_EVENT, schedule);
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        return () => {
            scheduleRef.current = () => undefined;
            if (frame !== null) cancelAnimationFrame(frame);
            stopViewport();
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
        };
    }, []);

    useLayoutEffect(() => scheduleRef.current());

    return createPortal(
        <div
            {...props}
            ref={setRef}
            data-canvas-floating-layer
            data-canvas-shortcuts-ignore
            data-canvas-no-zoom
            style={{ ...style, position: "fixed", left: 0, top: 0, width, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100vh - 24px)", overflow: "auto", overscrollBehavior: "contain", pointerEvents: "auto", visibility: "hidden", zIndex: style?.zIndex ?? 100 } as CSSProperties}
            onMouseDown={(event) => { onMouseDown?.(event); event.stopPropagation(); }}
            onPointerDown={(event) => { onPointerDown?.(event); event.stopPropagation(); }}
            onClick={(event) => { onClick?.(event); event.stopPropagation(); }}
        >
            {children}
        </div>,
        getCanvasPortalRoot(),
    );
}
