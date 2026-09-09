import type { CanvasLocalImageOperation, CanvasNodeData } from "../../types/canvas.ts";

export const CanvasOperationNodeType = {
    Crop: "builtin:crop",
    Split: "builtin:split",
    Upscale: "builtin:upscale",
    Angle: "builtin:angle",
    ReversePrompt: "builtin:reverse-prompt",
} as const;

export type CanvasOperationNodeTypeId = (typeof CanvasOperationNodeType)[keyof typeof CanvasOperationNodeType];

const OPERATION_NODE_TYPES = new Set<string>(Object.values(CanvasOperationNodeType));

export function isCanvasOperationNodeType(type: unknown): type is CanvasOperationNodeTypeId {
    return typeof type === "string" && OPERATION_NODE_TYPES.has(type);
}

export function isCanvasExecutableNode(node: Pick<CanvasNodeData, "type" | "metadata"> | null | undefined) {
    return Boolean(node && (node.type === "config" || isCanvasOperationNodeType(node.type)));
}

export function canvasNodeTypeForLocalImageOperation(operation: CanvasLocalImageOperation): CanvasOperationNodeTypeId {
    if (operation === "crop") return CanvasOperationNodeType.Crop;
    if (operation === "split") return CanvasOperationNodeType.Split;
    return CanvasOperationNodeType.Upscale;
}
