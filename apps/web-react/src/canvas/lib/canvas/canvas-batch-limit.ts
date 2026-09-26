/** 画布批量生成（一次批量生成的节点/任务数）的平台硬上限，与服务端 settings.CanvasBatchHardMaxCount 一致。 */
export const CANVAS_BATCH_HARD_MAX_COUNT = 100;

/** 规范化后台下发的批量上限：非法或缺省时取硬上限，并限制在 1–硬上限之间。 */
export function normalizeCanvasBatchMaxCount(value: unknown): number {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric) || numeric < 1) return CANVAS_BATCH_HARD_MAX_COUNT;
    return Math.min(CANVAS_BATCH_HARD_MAX_COUNT, numeric);
}

/** 把批量数量收紧到后台上限以内（至少 1）。 */
export function clampCanvasBatchCount(value: unknown, fallback: number, max: number): number {
    const limit = normalizeCanvasBatchMaxCount(max);
    const numeric = Math.floor(Number(value));
    return Math.min(limit, Math.max(1, Number.isFinite(numeric) && numeric > 0 ? numeric : fallback));
}
