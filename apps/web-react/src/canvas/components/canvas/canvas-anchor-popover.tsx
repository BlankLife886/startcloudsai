import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { floatingPanelStyle } from "./canvas-setting-controls";
import { CANVAS_OVERLAY_Z_INDEX, getCanvasPortalRoot } from "@/lib/canvas-portal";
import { type CanvasTheme } from "@/lib/canvas-theme";

export type AnchorPlacement = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

const openPopoverPanels: HTMLElement[] = [];

export function registerAnchorPopoverPanel(panel: HTMLElement) {
    openPopoverPanels.push(panel);
    return () => {
        const index = openPopoverPanels.indexOf(panel);
        if (index >= 0) openPopoverPanels.splice(index, 1);
    };
}

function isInsideNestedPopover(panel: HTMLElement | null, target: Node) {
    if (!panel) return false;
    const index = openPopoverPanels.indexOf(panel);
    return openPopoverPanels.slice(Math.max(0, index) + 1).some((item) => item.contains(target));
}

export function useAnchorPopover(onOpenChange?: (open: boolean) => void, controlledOpen?: boolean) {
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [internalOpen, setInternalOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const controlled = controlledOpen !== undefined;
    const open = controlled ? controlledOpen : internalOpen;

    const updateOpen = useCallback((next: boolean) => {
        if (!controlled) setInternalOpen(next);
        onOpenChangeRef.current?.(next);
    }, [controlled]);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (isInsideNestedPopover(panelRef.current, target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            updateOpen(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open, updateOpen]);

    return { buttonRef, panelRef, open, buttonRect, updateOpen };
}

export function AnchorPopoverTrigger({
    buttonRef,
    open,
    onToggle,
    fullWidth,
    className,
    style,
    title,
    children,
}: {
    buttonRef: RefObject<HTMLSpanElement | null>;
    open: boolean;
    onToggle: () => void;
    fullWidth?: boolean;
    className?: string;
    style?: CSSProperties;
    title?: string;
    children: ReactNode;
}) {
    return (
        <span ref={buttonRef} className={fullWidth ? "flex w-full min-w-0" : "inline-flex min-w-0"}>
            <button type="button" className={className} style={style} title={title} aria-expanded={open} onMouseDown={(event) => event.stopPropagation()} onClick={onToggle}>
                {children}
            </button>
        </span>
    );
}

/** Decide whether the panel should open above the trigger. */
export function shouldOpenAnchorPopoverAbove({
    preferTop,
    spaceAbove,
    spaceBelow,
    height,
    autoFlip,
}: {
    preferTop: boolean;
    spaceAbove: number;
    spaceBelow: number;
    height: number;
    autoFlip: boolean;
}) {
    if (!autoFlip) return preferTop;
    // Same rule as positionCanvasFloatingLayer: keep preferred side if it fits;
    // otherwise flip only when the other side has more room.
    if (preferTop) return spaceAbove >= height || spaceAbove > spaceBelow;
    return spaceBelow < height && spaceAbove > spaceBelow;
}

export function AnchorPopoverPanel({
    buttonRect,
    panelRef,
    placement = "topLeft",
    theme,
    width = 288,
    padding = 16,
    autoFlip = true,
    estimatedHeight = 320,
    className,
    children,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement?: AnchorPlacement;
    theme: CanvasTheme;
    width?: number;
    padding?: number;
    /** Prefer opening toward the side with enough room (up vs down). */
    autoFlip?: boolean;
    estimatedHeight?: number;
    className?: string;
    children: ReactNode;
}) {
    const gap = 8;
    const margin = 12;
    const [measuredHeight, setMeasuredHeight] = useState(0);
    const alignRight = placement.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const preferredLeft = alignCenter
        ? buttonRect.left + buttonRect.width / 2 - width / 2
        : alignRight
          ? buttonRect.right - width
          : buttonRect.left;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, preferredLeft));
    const preferTop = placement.startsWith("top");
    const spaceAbove = Math.max(0, buttonRect.top - margin - gap);
    const spaceBelow = Math.max(0, window.innerHeight - buttonRect.bottom - margin - gap);
    const height = measuredHeight > 0 ? measuredHeight : Math.max(120, estimatedHeight);
    const openAbove = shouldOpenAnchorPopoverAbove({
        preferTop,
        spaceAbove,
        spaceBelow,
        height,
        autoFlip,
    });
    const available = openAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, available);
    const style = {
        position: "fixed",
        zIndex: CANVAS_OVERLAY_Z_INDEX + 100 + openPopoverPanels.length,
        width,
        left,
        // Always anchor with `top` so measured height can flip without fighting `bottom`.
        top: openAbove ? Math.max(margin, buttonRect.top - gap - Math.min(height, maxHeight)) : buttonRect.bottom + gap,
        maxHeight,
        padding,
        overflowY: "auto",
        visibility: measuredHeight > 0 || !autoFlip ? "visible" : "hidden",
        ...floatingPanelStyle(theme),
    } as CSSProperties;

    return createPortal(
        <AnchorPopoverPanelRoot
            panelRef={panelRef}
            className={`canvas-float-menu canvas-anchor-popover${className ? ` ${className}` : ""}`}
            style={style}
            onMeasuredHeight={setMeasuredHeight}
        >
            {children}
        </AnchorPopoverPanelRoot>,
        getCanvasPortalRoot(),
    );
}

function AnchorPopoverPanelRoot({
    panelRef,
    className,
    style,
    onMeasuredHeight,
    children,
}: {
    panelRef: RefObject<HTMLDivElement | null>;
    className: string;
    style: CSSProperties;
    onMeasuredHeight: (height: number) => void;
    children: ReactNode;
}) {
    const lastHeightRef = useRef(0);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        return registerAnchorPopoverPanel(panel);
    }, [panelRef]);

    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const measure = () => {
            // scrollHeight is the natural content height even when maxHeight clamps the box.
            const next = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight));
            if (next <= 0 || Math.abs(next - lastHeightRef.current) < 1) return;
            lastHeightRef.current = next;
            onMeasuredHeight(next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(panel);
        return () => observer.disconnect();
    }, [onMeasuredHeight, panelRef]);

    return (
        <div
            ref={panelRef}
            className={className}
            style={style}
            data-placement={typeof style.top === "number" ? "anchored" : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}
