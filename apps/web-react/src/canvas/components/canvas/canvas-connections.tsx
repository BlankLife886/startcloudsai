import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

const END_MARKER_ID = "canvas-edge-end";
const END_MARKER_ACTIVE_ID = "canvas-edge-end-active";

// Forward edges bend proportionally but stay within a calm range; edges that run backwards loop out wider so they do not cut through the nodes.
export function canvasCurvePathD(startX: number, startY: number, endX: number, endY: number) {
    const dx = endX - startX;
    const dy = Math.abs(endY - startY);
    const curvature = dx >= 24 ? Math.min(160, Math.max(40, dx * 0.5)) : Math.min(220, 80 + Math.abs(dx) * 0.35 + dy * 0.12);
    return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}

export function canvasConnectionPathD(from: CanvasNodeData, to: CanvasNodeData) {
    return canvasCurvePathD(from.position.x + from.width, from.position.y + from.height / 2, to.position.x, to.position.y + to.height / 2);
}

export function CanvasConnectionDefs() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <defs>
            <marker id={END_MARKER_ID} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="2.6" fill={theme.canvas.connection} />
            </marker>
            <marker id={END_MARKER_ACTIVE_ID} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse">
                <circle cx="5" cy="5" r="3.2" fill={theme.canvas.connectionActive} />
            </marker>
        </defs>
    );
}

export const ConnectionPath = memo(function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const pathD = canvasConnectionPathD(from, to);

    // Every visible path carries data-connection-path so drag and resize can rewrite its geometry directly.
    return (
        <g className={`canvas-edge${active ? " is-active" : ""}`} style={{ "--canvas-edge-hover": theme.canvas.connectionActive } as CSSProperties}>
            {active ? (
                <path
                    data-connection-path={connection.id}
                    d={pathD}
                    stroke={theme.canvas.connectionActive}
                    strokeOpacity={theme.scheme === "dark" ? 0.28 : 0.18}
                    strokeWidth="7"
                    strokeLinecap="round"
                    fill="none"
                    style={{ pointerEvents: "none" }}
                />
            ) : null}
            <path
                data-connection-path={connection.id}
                className="canvas-edge__line"
                d={pathD}
                stroke={active ? theme.canvas.connectionActive : theme.canvas.connection}
                strokeWidth={active ? 2.2 : 1.6}
                strokeLinecap="round"
                fill="none"
                markerEnd={`url(#${active ? END_MARKER_ACTIVE_ID : END_MARKER_ID})`}
                style={{ pointerEvents: "none" }}
            />
            {active ? (
                <path
                    data-connection-path={connection.id}
                    className="canvas-edge__flow"
                    d={pathD}
                    stroke="#ffffff"
                    strokeOpacity={theme.scheme === "dark" ? 0.55 : 0.85}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="1 14"
                    fill="none"
                    style={{ pointerEvents: "none" }}
                />
            ) : null}
            <path
                data-connection-id={connection.id}
                data-connection-path={connection.id}
                className="canvas-edge__hit"
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect(event, connection.id);
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event, connection.id);
                }}
            />
        </g>
    );
});

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const pathD = canvasCurvePathD(snappedStartX, snappedStartY, snappedEndX, snappedEndY);
    const snapped = Boolean(target);

    return (
        <g className="canvas-edge-draft">
            <path d={pathD} stroke={theme.canvas.connectionActive} strokeWidth={snapped ? 2 : 1.6} strokeLinecap="round" fill="none" strokeDasharray={snapped ? undefined : "5 6"} markerEnd={snapped ? `url(#${END_MARKER_ACTIVE_ID})` : undefined} />
            {!snapped ? <circle cx={handle.handleType === "source" ? snappedEndX : snappedStartX} cy={handle.handleType === "source" ? snappedEndY : snappedStartY} r="4" fill={theme.canvas.connectionActive} /> : null}
        </g>
    );
}
