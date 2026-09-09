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
