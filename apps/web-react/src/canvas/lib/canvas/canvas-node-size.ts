import type { CanvasNodeData } from "../../types/canvas.ts";

export const CANVAS_CARD_WIDTH = 360;
export const CANVAS_CARD_MIN_HEIGHT = 200;
export const CANVAS_CARD_MAX_HEIGHT = 480;

export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

/** AI.F-style tool card: fixed width, height follows media aspect. */
export function cardSizeForMedia(width: number, height: number, cardWidth = CANVAS_CARD_WIDTH) {
    if (width <= 0 || height <= 0) {
        return { width: cardWidth, height: Math.round(cardWidth * 0.75) };
    }
    const ratio = width / height;
    let nextWidth = cardWidth;
    let nextHeight = cardWidth / ratio;
    if (nextHeight > CANVAS_CARD_MAX_HEIGHT) {
        nextHeight = CANVAS_CARD_MAX_HEIGHT;
        nextWidth = nextHeight * ratio;
    }
    return {
        width: Math.round(nextWidth),
        height: Math.round(nextHeight),
    };
}

export function resultNodeSize(
    node: { width: number; height: number; metadata?: { freeResize?: boolean; content?: string } },
    mediaWidth: number,
    mediaHeight: number,
) {
    if (node.metadata?.freeResize) {
        return { width: node.width, height: node.height };
    }
    if (node.metadata?.content && mediaWidth > 0 && mediaHeight > 0) {
        return { width: node.width, height: node.width * mediaHeight / mediaWidth };
    }
    return cardSizeForMedia(mediaWidth, mediaHeight);
}

/** Locked image frames follow the selected image, including previously saved frames. */
export function imageFrameSource(node: CanvasNodeData) {
    const images = node.metadata?.images || [];
    const primary = images.find((image) => image.id === node.metadata?.primaryImageId) || images[0];
    return primary?.storageKey || primary?.content || node.metadata?.storageKey || node.metadata?.content || "";
}

function storyboardFrameRatio(node: CanvasNodeData) {
    if (!node.metadata?.storyboardSceneId) return 0;
    const value = node.metadata.storyboardAspectRatio || node.metadata.size;
    const match = typeof value === "string" ? value.match(/^(\d+(?:\.\d+)?)[/:](\d+(?:\.\d+)?)$/) : null;
    if (!match) return 0;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 0;
}

export function imageFrameRatio(node: CanvasNodeData) {
    // Storyboard cards are laid out against the user-selected frame ratio.
    // Generated providers can return a slightly different pixel ratio; using
    // that decoded ratio here would make one card taller than its caption lane.
    const storyboardRatio = storyboardFrameRatio(node);
    if (storyboardRatio) return storyboardRatio;
    const measured = node.metadata?.loadedImageAspect;
    if (measured?.source === imageFrameSource(node) && Number.isFinite(measured.ratio) && measured.ratio > 0) return measured.ratio;
    const images = node.metadata?.images || [];
    const primary = images.find((image) => image.id === node.metadata?.primaryImageId) || images[0];
    const width = primary?.naturalWidth || node.metadata?.naturalWidth || 0;
    const height = primary?.naturalHeight || node.metadata?.naturalHeight || 0;
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 0;
}

export function fitLockedImageNode(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== "image" || node.metadata?.freeResize || node.metadata?.storyboardSceneId) return node;
    const ratio = imageFrameRatio(node);
    if (!ratio) return node;
    const nextHeight = node.width / ratio;
    if (Math.abs(node.height - nextHeight) < 0.5) return node;
    return { ...node, height: nextHeight, position: { ...node.position, y: node.position.y + (node.height - nextHeight) / 2 } };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}
