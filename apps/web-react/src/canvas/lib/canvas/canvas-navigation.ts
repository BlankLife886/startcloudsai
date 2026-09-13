import type { CanvasNodeData, ViewportTransform } from "../../types/canvas";
import { canvasWorkspaceRect } from "./canvas-workspace-geometry";

/** Standard wheel/trackpad scrolling pans; Ctrl/Meta+wheel and native pinch zoom. */
export function canvasWheelIntent(event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (event.ctrlKey || event.metaKey) return { kind: "zoom" as const, dx: 0, dy: event.deltaY };
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 640 : 1;
    return { kind: "pan" as const, dx: (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit, dy: (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit };
}

export function fitCanvasContent(nodes: CanvasNodeData[], size: { width: number; height: number }, leftWidth = 0, rightWidth = 0): ViewportTransform {
    const area = canvasWorkspaceRect(size, leftWidth, rightWidth);
    const visible = nodes.filter((node) => !node.metadata?.hidden);
    if (!visible.length) return { x: area.center.x, y: area.center.y, k: 1 };
    const left = Math.min(...visible.map(n => n.position.x));
    const top = Math.min(...visible.map(n => n.position.y));
    const right = Math.max(...visible.map(n => n.position.x + n.width));
    const bottom = Math.max(...visible.map(n => n.position.y + n.height));
    const k = Math.max(0.05, Math.min(1, Math.max(1, area.width - 64) / Math.max(1, right - left), Math.max(1, area.height - 64) / Math.max(1, bottom - top)));
    return { x: area.center.x - (left + right) / 2 * k, y: area.center.y - (top + bottom) / 2 * k, k };
}
