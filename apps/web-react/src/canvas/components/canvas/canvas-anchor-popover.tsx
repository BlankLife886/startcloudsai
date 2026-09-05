import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { floatingPanelStyle } from "./canvas-setting-controls";
import { getCanvasPortalRoot } from "@/lib/canvas-portal";
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
    children,
}: {
    buttonRef: RefObject<HTMLSpanElement | null>;
    open: boolean;
    onToggle: () => void;
    fullWidth?: boolean;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
}) {
    return (
        <span ref={buttonRef} className={fullWidth ? "flex w-full min-w-0" : "inline-flex min-w-0"}>
            <button type="button" className={className} style={style} aria-expanded={open} onMouseDown={(event) => event.stopPropagation()} onClick={onToggle}>
                {children}
            </button>
        </span>
    );
}

export function AnchorPopoverPanel({
    buttonRect,
    panelRef,
    placement = "topLeft",
    theme,
    width = 288,
    padding = 16,
    children,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement?: AnchorPlacement;
    theme: CanvasTheme;
    width?: number;
    padding?: number;
    children: ReactNode;
}) {
    const gap = 8;
    const margin = 12;
    const alignRight = placement.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200 + openPopoverPanels.length,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(240, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(240, window.innerHeight - buttonRect.bottom - margin * 2) }),
        padding,
        overflowY: "auto",
        ...floatingPanelStyle(theme),
    } as CSSProperties;

    return createPortal(
        <AnchorPopoverPanelRoot panelRef={panelRef} className="canvas-float-menu canvas-anchor-popover" style={style}>
            {children}
        </AnchorPopoverPanelRoot>,
        getCanvasPortalRoot(),
    );
}

function AnchorPopoverPanelRoot({
    panelRef,
    className,
    style,
    children,
}: {
    panelRef: RefObject<HTMLDivElement | null>;
    className: string;
    style: CSSProperties;
    children: ReactNode;
}) {
    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        return registerAnchorPopoverPanel(panel);
    }, [panelRef]);

    return (
        <div
            ref={panelRef}
            className={className}
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}
