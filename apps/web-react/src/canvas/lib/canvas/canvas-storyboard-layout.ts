export type StoryboardLayoutCard = {
    width: number;
    height: number;
};

export type StoryboardLayoutMetrics = {
    sceneCount: number;
    columns: number;
    rows: number;
    gapX: number;
    gapY: number;
    captionHeight: number;
    groupPaddingX: number;
    groupHeaderHeight: number;
    groupFooterHeight: number;
    totalWidth: number;
    totalHeight: number;
    groupWidth: number;
    groupHeight: number;
};

/**
 * Keep storyboard geometry in one place so the frame, cards, and sequence
 * metadata cannot drift apart when the card ratio or shot count changes.
 */
export function storyboardLayoutMetrics(sceneCount: number, card: StoryboardLayoutCard, options: Partial<Pick<StoryboardLayoutMetrics, "gapX" | "gapY" | "captionHeight" | "groupPaddingX" | "groupHeaderHeight" | "groupFooterHeight">> = {}): StoryboardLayoutMetrics {
    const count = Math.min(100, Math.max(1, Math.floor(Number(sceneCount) || 1)));
    const gapX = options.gapX ?? 88;
    const gapY = options.gapY ?? 52;
    // Shot copy lives on the image node overlay; reserved caption lane is 0
    // for new boards. Callers may still pass a positive height for legacy layout.
    const captionHeight = options.captionHeight ?? 0;
    const groupPaddingX = options.groupPaddingX ?? 40;
    const groupHeaderHeight = options.groupHeaderHeight ?? 104;
    const groupFooterHeight = options.groupFooterHeight ?? 44;
    // A near-square grid keeps a large sequence readable while preserving a
    // single compact lane for one shot.
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / columns);
    const totalWidth = columns * card.width + (columns - 1) * gapX;
    const totalHeight = rows * (card.height + captionHeight) + (rows - 1) * gapY;
    return {
        sceneCount: count,
        columns,
        rows,
        gapX,
        gapY,
        captionHeight,
        groupPaddingX,
        groupHeaderHeight,
        groupFooterHeight,
        totalWidth,
        totalHeight,
        groupWidth: totalWidth + groupPaddingX * 2,
        groupHeight: totalHeight + groupHeaderHeight + groupFooterHeight,
    };
}

export function storyboardScenePosition(index: number, origin: { x: number; y: number }, card: StoryboardLayoutCard, metrics: StoryboardLayoutMetrics) {
    const column = Math.max(0, Math.floor(index)) % metrics.columns;
    const row = Math.floor(Math.max(0, Math.floor(index)) / metrics.columns);
    return {
        x: origin.x + column * (card.width + metrics.gapX),
        y: origin.y + row * (card.height + metrics.captionHeight + metrics.gapY),
        column,
        row,
    };
}

/**
 * Place shots using each card's own size so mixed aspect ratios don't sit in
 * oversized uniform cells. Rows still follow a near-square column count.
 */
export function storyboardPackedLayout(
    cards: readonly StoryboardLayoutCard[],
    options: { gapX?: number; gapY?: number; columns?: number } = {},
) {
    const count = Math.min(100, Math.max(0, cards.length));
    const gapX = options.gapX ?? 88;
    const gapY = options.gapY ?? 52;
    const columns = Math.min(4, Math.max(1, options.columns ?? Math.ceil(Math.sqrt(Math.max(1, count)))));
    const positions: Array<{ x: number; y: number; width: number; height: number; column: number; row: number }> = [];
    let cursorY = 0;
    let totalWidth = 0;
    for (let rowStart = 0; rowStart < count; rowStart += columns) {
        const rowCards = cards.slice(rowStart, rowStart + columns);
        const rowHeight = Math.max(...rowCards.map((card) => card.height), 1);
        let cursorX = 0;
        rowCards.forEach((card, column) => {
            positions.push({
                x: cursorX,
                y: cursorY,
                width: card.width,
                height: card.height,
                column,
                row: Math.floor(rowStart / columns),
            });
            cursorX += card.width + (column < rowCards.length - 1 ? gapX : 0);
        });
        totalWidth = Math.max(totalWidth, cursorX);
        cursorY += rowHeight + (rowStart + columns < count ? gapY : 0);
    }
    return {
        columns,
        rows: count ? Math.ceil(count / columns) : 0,
        gapX,
        gapY,
        totalWidth,
        totalHeight: cursorY,
        positions,
    };
}

export function storyboardSequenceLinks(sceneIds: readonly string[]) {
    return sceneIds.map((sceneId, index) => ({
        sceneId,
        previousSceneId: sceneIds[index - 1],
        nextSceneId: sceneIds[index + 1],
    }));
}
