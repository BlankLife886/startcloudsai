import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId } from "../../types/canvas.ts";

export type CanvasAgentNodePatch = Partial<CanvasNodeData> & {
    content?: string;
    composerContent?: string;
    prompt?: string;
};

export function mergeCanvasAgentNodeMetadata(
    current: CanvasNodeMetadata | undefined,
    patch: CanvasAgentNodePatch | undefined,
    metadata: CanvasNodeMetadata | undefined,
): CanvasNodeMetadata {
    const semanticMetadata: CanvasNodeMetadata = {};
    if (typeof patch?.content === "string") semanticMetadata.content = patch.content;
    if (typeof patch?.composerContent === "string") semanticMetadata.composerContent = patch.composerContent;
    if (typeof patch?.prompt === "string") semanticMetadata.prompt = patch.prompt;
    const patchMetadata = isRecord(patch?.metadata) ? patch.metadata : {};
    return { ...current, ...semanticMetadata, ...patchMetadata, ...(isRecord(metadata) ? metadata : {}) };
}

export function applyCanvasAgentNodeUpdate(
    node: CanvasNodeData,
    update: { title?: string; patch?: CanvasAgentNodePatch; metadata?: CanvasNodeMetadata },
): CanvasNodeData {
    const title = typeof update.title === "string"
        ? update.title
        : typeof update.patch?.title === "string"
          ? update.patch.title
          : node.title;
    const metadata = mergeCanvasAgentNodeMetadata(node.metadata, update.patch, update.metadata);
    if (title === node.title && recordsEqual(metadata, node.metadata || {})) return node;
    return { ...node, title, metadata };
}

export function canvasAgentGraphTextMetadata(type: CanvasNodeTypeId, text: string): CanvasNodeMetadata | undefined {
    return type === "text" && text ? { content: text, status: "success" } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.is(left[key], right[key]));
}
