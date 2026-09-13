export type CanvasFloatingRect = { left: number; top: number; right: number; bottom: number };
export type CanvasFloatingPlacement = "top" | "bottom" | "bottom-start";

/** Floating controls use screen pixels even when their anchor is in the canvas world. */
export function positionCanvasFloatingLayer({
    anchor,
    bounds,
    width,
    height,
    placement = "bottom",
    gap = 12,
    margin = 12,
    avoid,
    avoidEdges = true,
}: {
    anchor: CanvasFloatingRect;
    bounds: CanvasFloatingRect;
    width: number;
    height: number;
    placement?: CanvasFloatingPlacement;
    gap?: number;
    margin?: number;
    avoid?: CanvasFloatingRect;
    avoidEdges?: boolean;
}) {
    if (!avoidEdges) return {
        left: placement === "bottom-start" ? anchor.left : (anchor.left + anchor.right - width) / 2,
        top: placement === "top" ? anchor.top - gap - height : anchor.bottom + gap,
        maxWidth: Math.max(0, bounds.right - bounds.left),
        maxHeight: Math.max(0, bounds.bottom - bounds.top),
        side: placement === "top" ? "top" as const : "bottom" as const,
    };
    const insetX = Math.min(margin, Math.max(0, (bounds.right - bounds.left) / 2));
    const insetY = Math.min(margin, Math.max(0, (bounds.bottom - bounds.top) / 2));
    const leftEdge = bounds.left + insetX;
    const topEdge = bounds.top + insetY;
    const rightEdge = bounds.right - insetX;
    const bottomEdge = bounds.bottom - insetY;
    const maxWidth = Math.max(0, rightEdge - leftEdge);
    const maxHeight = Math.max(0, bottomEdge - topEdge);
    const panelWidth = Math.min(Math.max(0, width), maxWidth);
    const panelHeight = Math.min(Math.max(0, height), maxHeight);
    const above = anchor.top - gap - topEdge;
    const below = bottomEdge - anchor.bottom - gap;
    const preferTop = placement === "top";
    const useTop = preferTop ? above >= panelHeight || above > below : below < panelHeight && above > below;
    const preferredLeft = placement === "bottom-start" ? anchor.left : (anchor.left + anchor.right - panelWidth) / 2;
    const preferredTop = useTop ? anchor.top - gap - panelHeight : anchor.bottom + gap;

    const clamp = (left: number, top: number) => ({
        left: Math.max(leftEdge, Math.min(rightEdge - panelWidth, left)),
        top: Math.max(topEdge, Math.min(bottomEdge - panelHeight, top)),
    });
    let position = clamp(preferredLeft, preferredTop);
    if (avoid) {
        const overlaps = (candidate: typeof position) => candidate.left < avoid.right && candidate.left + panelWidth > avoid.left && candidate.top < avoid.bottom && candidate.top + panelHeight > avoid.top;
        if (overlaps(position)) {
            const candidates = [
                clamp(position.left, avoid.top - gap - panelHeight),
                clamp(position.left, avoid.bottom + gap),
                clamp(avoid.left - gap - panelWidth, position.top),
                clamp(avoid.right + gap, position.top),
            ].filter((candidate) => !overlaps(candidate));
            candidates.sort((a, b) => Math.hypot(a.left - position.left, a.top - position.top) - Math.hypot(b.left - position.left, b.top - position.top));
            position = candidates[0] || position;
        }
    }

    return {
        ...position,
        maxWidth,
        maxHeight,
        side: useTop ? "top" as const : "bottom" as const,
    };
}
