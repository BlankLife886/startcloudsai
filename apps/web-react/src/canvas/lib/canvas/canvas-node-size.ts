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
    if (node.metadata?.freeResize || node.metadata?.content) {
        return { width: node.width, height: node.height };
    }
    return cardSizeForMedia(mediaWidth, mediaHeight);
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
