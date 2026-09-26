import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

const END_MARKER_ID = "canvas-edge-end";
const END_MARKER_HOT_ID = "canvas-edge-end-hot";
const HOT_FROM = "#8b6cff";
const HOT_TO = "#3d7bff";

// Forward edges bend proportionally but stay calm; edges that run backwards loop out wider so they do not cut through nodes.
// When one output feeds several nodes, the edges share a short horizontal trunk before fanning out.
export function canvasCurvePathD(startX: number, startY: number, endX: number, endY: number, trunk = 0) {
    const sx = startX + trunk;
    const back = endX < sx + 20;
    const curvature = back ? Math.min(220, 90 + Math.abs(sx - endX) * 0.3 + Math.abs(endY - startY) * 0.15) : Math.min(160, Math.max(40, Math.abs(endX - sx) * 0.45));
    return `M ${startX} ${startY}${trunk ? ` L ${sx} ${startY}` : ""} C ${sx + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}

export function canvasConnectionPathD(from: CanvasNodeData, to: CanvasNodeData, fanOut = 1) {
    const startX = from.position.x + from.width;
    const endX = to.position.x;
    const trunk = fanOut > 1 ? Math.min(36, Math.max(0, (endX - startX) * 0.25)) : 0;
    return canvasCurvePathD(startX, from.position.y + from.height / 2, endX, to.position.y + to.height / 2, trunk);
}

export function CanvasConnectionDefs() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <defs>
            <marker id={END_MARKER_ID} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="2.2" fill={theme.canvas.connection} fillOpacity={theme.scheme === "dark" ? 0.55 : 0.6} />
            </marker>
            <marker id={END_MARKER_HOT_ID} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse">
                <circle cx="5" cy="5" r="3" fill={HOT_TO} />
            </marker>
        </defs>
    );
}

export const ConnectionPath = memo(function ConnectionPath({
    connection,
    from,
    to,
    active,
    selected = false,
    dimmed = false,
    flowing = false,
    fanOut = 1,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    selected?: boolean;
    dimmed?: boolean;
    flowing?: boolean;
    fanOut?: number;
    onSelect: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const pathD = canvasConnectionPathD(from, to, fanOut);
    const hot = active || selected || flowing;
    const lineId = `canvas-edge-line-${connection.id}`;
    const gradientId = `canvas-edge-grad-${connection.id}`;
    const x1 = from.position.x + from.width;
    const y1 = from.position.y + from.height / 2;
    const x2 = to.position.x;
    const y2 = to.position.y + to.height / 2;
    const restOpacity = theme.scheme === "dark" ? 0.55 : 0.6;

    // Every visible path carries data-connection-path so drag and resize can rewrite its geometry directly.
    return (
        <g className={`canvas-edge${hot ? " is-hot" : ""}`} style={{ "--canvas-edge-hover": theme.canvas.connectionActive, opacity: dimmed && !hot ? 0.22 : 1, transition: "opacity .25s ease" } as CSSProperties}>
            {hot ? (
                <>
                    <defs>
                        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2 === x1 ? x1 + 1 : x2} y2={y2}>
                            <stop offset="0" stopColor={HOT_FROM} />
                            <stop offset="1" stopColor={HOT_TO} />
                        </linearGradient>
                    </defs>
                    <path data-connection-path={connection.id} d={pathD} stroke={`url(#${gradientId})`} strokeOpacity={theme.scheme === "dark" ? 0.26 : 0.16} strokeWidth="8" strokeLinecap="round" fill="none" style={{ pointerEvents: "none" }} />
                </>
            ) : null}
            <path
                id={lineId}
                data-connection-path={connection.id}
                className="canvas-edge__line"
                d={pathD}
                stroke={hot ? `url(#${gradientId})` : theme.canvas.connection}
                strokeOpacity={hot ? 1 : restOpacity}
                strokeWidth={hot ? 2 : 1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                markerEnd={`url(#${hot ? END_MARKER_HOT_ID : END_MARKER_ID})`}
                style={{ pointerEvents: "none" }}
            />
            {flowing || selected ? (
                <g className="canvas-edge__flow" style={{ pointerEvents: "none" }}>
                    <circle r="5" fill={HOT_FROM} fillOpacity="0.25">
                        <animateMotion dur="1.6s" repeatCount="indefinite">
                            <mpath href={`#${lineId}`} />
                        </animateMotion>
                    </circle>
                    <circle r="2.4" fill="#ffffff">
                        <animateMotion dur="1.6s" repeatCount="indefinite">
                            <mpath href={`#${lineId}`} />
                        </animateMotion>
                    </circle>
                    <circle r="2" fill="#ffffff" fillOpacity="0.8">
                        <animateMotion dur="1.6s" begin="0.8s" repeatCount="indefinite">
                            <mpath href={`#${lineId}`} />
                        </animateMotion>
                    </circle>
                </g>
            ) : null}
            <path
                data-connection-id={connection.id}
                data-connection-path={connection.id}
                className="canvas-edge__hit"
                d={pathD}
                stroke="transparent"
                strokeWidth="14"
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
    const tipX = handle.handleType === "source" ? snappedEndX : snappedStartX;
    const tipY = handle.handleType === "source" ? snappedEndY : snappedStartY;

    return (
        <g className="canvas-edge-draft">
            <defs>
                <linearGradient id="canvas-edge-draft-grad" gradientUnits="userSpaceOnUse" x1={snappedStartX} y1={snappedStartY} x2={snappedEndX === snappedStartX ? snappedStartX + 1 : snappedEndX} y2={snappedEndY}>
                    <stop offset="0" stopColor={HOT_FROM} />
                    <stop offset="1" stopColor={HOT_TO} />
                </linearGradient>
            </defs>
            <path d={pathD} stroke="url(#canvas-edge-draft-grad)" strokeOpacity="0.18" strokeWidth="8" strokeLinecap="round" fill="none" />
            <path d={pathD} stroke="url(#canvas-edge-draft-grad)" strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray={snapped ? undefined : "6 6"} />
            <circle cx={tipX} cy={tipY} r={snapped ? 5 : 4} fill="#ffffff" stroke={HOT_TO} strokeWidth="2" />
        </g>
    );
}
