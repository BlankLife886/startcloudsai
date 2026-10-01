import type { CanvasNodeData, Position } from "../../types/canvas";
import type { CanvasQueryRect } from "./canvas-spatial-index";

/** Preserve at least 480 screen pixels for editing on supported desktop widths. */
export function constrainCanvasPanelWidths(viewportWidth: number, leftWidth: number, rightWidth: number) {
    let left = leftWidth > 0 ? Math.min(480, Math.max(220, leftWidth)) : 0;
    let right = rightWidth > 0 ? Math.min(760, Math.max(360, rightWidth)) : 0;
    const available = Math.max((left ? 220 : 0) + (right ? 360 : 0), viewportWidth - 528);
    if (left + right > available && right) right = Math.max(360, available - left);
    if (left + right > available && left) left = Math.max(220, available - right);
    return { left, right };
}

export function canvasWorkspaceRect(size: { width: number; height: number }, leftWidth = 0, rightWidth = 0) {
    const left = leftWidth > 0 ? leftWidth + 24 : 20;
    const right = Math.max(left + 1, size.width - (rightWidth > 0 ? rightWidth + 24 : 20));
    const top = Math.min(76, size.height / 3);
    const bottom = Math.max(top + 1, size.height - 68);
    return { left, right, top, bottom, width: right - left, height: bottom - top, center: { x: (left + right) / 2, y: (top + bottom) / 2 } };
}

/** Prefer a nearby visible gap; when full, stagger duplicates instead of stacking them exactly. */
export function findCanvasInsertionCenter(center: Position, size: { width: number; height: number }, nodes: CanvasNodeData[], viewport?: CanvasQueryRect): Position {
    const obstacles = nodes.filter((node) => !node.metadata?.hidden && node.type !== "group");
    const fits = (point: Position) => {
        const left = point.x - size.width / 2;
        const top = point.y - size.height / 2;
        const right = left + size.width;
        const bottom = top + size.height;
        if (viewport && (left < viewport.left || top < viewport.top || right > viewport.right || bottom > viewport.bottom)) return false;
        return obstacles.every((node) => right + 20 <= node.position.x || left - 20 >= node.position.x + node.width || bottom + 20 <= node.position.y || top - 20 >= node.position.y + node.height);
    };
    if (fits(center)) return center;
    const stepX = size.width + 32;
    const stepY = size.height + 32;
    for (let ring = 1; ring <= 4; ring++) {
        for (const [x, y] of [[ring, 0], [0, ring], [-ring, 0], [0, -ring], [ring, ring], [-ring, ring], [ring, -ring], [-ring, -ring]]) {
            const point = { x: center.x + x * stepX, y: center.y + y * stepY };
            if (fits(point)) return point;
        }
    }
    for (let i = 0; i <= obstacles.length; i++) {
        const point = { x: center.x + i * 28, y: center.y + i * 28 };
        if (!obstacles.some((node) => Math.abs(node.position.x + node.width / 2 - point.x) < 2 && Math.abs(node.position.y + node.height / 2 - point.y) < 2)) return point;
    }
    return center;
}

/** Cubic Bézier curves lie inside the bounds of their endpoints and control points. */
export function canvasConnectionIntersectsRect(from: CanvasNodeData, to: CanvasNodeData, rect: CanvasQueryRect) {
    const startX = from.position.x + from.width;
    const endX = to.position.x;
    const startY = from.position.y + from.height / 2;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    return Math.min(startX, endX - curvature) <= rect.right && Math.max(startX + curvature, endX) >= rect.left && Math.min(startY, endY) <= rect.bottom && Math.max(startY, endY) >= rect.top;
}
