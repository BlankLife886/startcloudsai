import type { CanvasNodeData } from "@/types/canvas";
import { isCanvasExecutableNode } from "./canvas-operation-node.ts";

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    return normalizeConnectionBetween(first, second, firstHandleType);
}

export function normalizeConnectionBetween(first: CanvasNodeData | undefined, second: CanvasNodeData | undefined, firstHandleType: "source" | "target") {
    if (!first || !second || first.id === second.id) return null;
    if (first.type === "group" || second.type === "group") return null;
    if (isCanvasExecutableNode(first) && isCanvasExecutableNode(second)) return null;
    return firstHandleType === "source" ? { fromNodeId: first.id, toNodeId: second.id } : { fromNodeId: second.id, toNodeId: first.id };
}

/** Source node ids for a connection drag — multi-select expands beyond the handle node. */
export function connectionSourceNodeIds(handle: { nodeId: string; sourceNodeIds?: string[] } | null | undefined): string[] {
    if (!handle?.nodeId) return [];
    const ids = handle.sourceNodeIds?.length ? handle.sourceNodeIds : [handle.nodeId];
    return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

/** Ids of every connection with an endpoint on one of `nodeIds`, in either direction. */
export function canvasConnectionIdsTouchingNodes(
    connections: Array<{ id: string; fromNodeId: string; toNodeId: string }>,
    nodeIds: Set<string>,
): Set<string> {
    if (!nodeIds.size) return new Set();
    return new Set(
        connections.filter((conn) => nodeIds.has(conn.fromNodeId) || nodeIds.has(conn.toNodeId)).map((conn) => conn.id),
    );
}
