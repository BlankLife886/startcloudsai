import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasMiniMapRect = { id: string; type: string; x: number; y: number; width: number; height: number; node: CanvasNodeData };
export type CanvasMiniMap = { rects: CanvasMiniMapRect[]; paths: string[]; width: number; height: number };

const MAX_NODES = 160;
const MIN_SIDE = 3;

/**
 * Fits a canvas into a small box: every node becomes a rectangle at its relative position and size, every connection a
 * curve between the facing edges. Group frames come first so they sit behind their members.
 */
export function canvasMiniMapLayout(nodes: CanvasNodeData[], connections: CanvasConnection[], width: number, height: number, padding = 10): CanvasMiniMap {
    const drawn = nodes.filter((node) => node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).slice(0, MAX_NODES);
    if (!drawn.length) return { rects: [], paths: [], width, height };
    const minX = Math.min(...drawn.map((node) => node.position.x));
    const minY = Math.min(...drawn.map((node) => node.position.y));
    const maxX = Math.max(...drawn.map((node) => node.position.x + (node.width || 0)));
    const maxY = Math.max(...drawn.map((node) => node.position.y + (node.height || 0)));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    // Center the drawing in the box.
    const offsetX = (width - spanX * scale) / 2;
    const offsetY = (height - spanY * scale) / 2;
    const rects = drawn
        .map((node) => ({
            id: node.id,
            type: node.type,
            node,
            x: offsetX + (node.position.x - minX) * scale,
            y: offsetY + (node.position.y - minY) * scale,
            width: Math.max(MIN_SIDE, (node.width || 0) * scale),
            height: Math.max(MIN_SIDE, (node.height || 0) * scale),
        }))
        .sort((a, b) => Number(b.type === "group") - Number(a.type === "group"));
    const byId = new Map(rects.map((rect) => [rect.id, rect]));
    const paths = connections.flatMap((connection) => {
        const from = byId.get(connection.fromNodeId);
        const to = byId.get(connection.toNodeId);
        if (!from || !to) return [];
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const bend = Math.max(6, Math.abs(x2 - x1) * 0.45);
        return [`M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + bend).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - bend).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`];
    });
    return { rects, paths, width, height };
}
