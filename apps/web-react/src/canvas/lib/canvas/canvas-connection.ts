import type { CanvasNodeData } from "@/types/canvas";

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === "group" || second.type === "group") return null;
    if (first.type === "config" && second.type === "config") return null;
    return firstHandleType === "source" ? { fromNodeId: first.id, toNodeId: second.id } : { fromNodeId: second.id, toNodeId: first.id };
}
