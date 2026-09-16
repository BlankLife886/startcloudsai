import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId } from "../../types/canvas.ts";
import { isCanvasGenerationModeEnabled } from "@/constant/canvas";
import { storageKeyFromUrl } from "./canvas-preview-url.ts";

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
    if (metadata.generationMode && !isCanvasGenerationModeEnabled(metadata.generationMode)) {
        metadata.generationMode = "image";
    }
    if (node.type === "image" && metadata.content !== node.metadata?.content) {
        const previousKey = node.metadata?.storageKey || storageKeyFromUrl(node.metadata?.content || "");
        const sameFile = previousKey && storageKeyFromUrl(metadata.content || "") === previousKey;
        if (!sameFile) {
            // Replacing pixels must not keep a different image's identity.
            // Hydration bypasses this user/Agent edit path; same-file URL
            // changes above remain harmless display updates.
            if (metadata.storageKey === node.metadata?.storageKey) delete metadata.storageKey;
            if (metadata.images === node.metadata?.images) {
                delete metadata.images;
                delete metadata.primaryImageId;
            }
            if (metadata.thumbnailUrl === node.metadata?.thumbnailUrl) delete metadata.thumbnailUrl;
            if (metadata.thumbnailKey === node.metadata?.thumbnailKey) delete metadata.thumbnailKey;
        }
    }
    if (title === node.title && recordsEqual(metadata, node.metadata || {})) return node;
    return { ...node, title, metadata };
}

export function canvasAgentGraphTextMetadata(type: CanvasNodeTypeId, text: string): CanvasNodeMetadata | undefined {
    return type === "text" && text ? { content: text, status: "success" } : undefined;
}

/**
 * Generation clamps `count` to the model capability, while workflow certification
 * reads the stored `count`. An Agent-written count above the cap therefore makes a
 * fully successful node fail as "outputs incomplete", so clamp it on the way in.
 * `maxCountForNode` returns null when the model catalog cannot answer yet.
 */
export function clampCanvasAgentImageCounts(
    nodes: CanvasNodeData[],
    maxCountForNode: (node: CanvasNodeData) => number | null,
): CanvasNodeData[] {
    let changed = false;
    const next = nodes.map((node) => {
        const requested = Math.floor(Number(node.metadata?.count));
        if (!Number.isFinite(requested) || requested < 1) return node;
        const max = maxCountForNode(node);
        if (!max || !Number.isFinite(max) || requested <= max) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, count: max } };
    });
    return changed ? next : nodes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.is(left[key], right[key]));
}
