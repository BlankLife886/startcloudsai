/**
 * Idempotency keys for canvas task submissions.
 *
 * - Workflow node execution:  canvas:${runId}:${nodeId}:${imageIndex}
 * - Manual node generation:   canvas:${projectId}:${nodeId}:${nonce}:${imageIndex}
 *   The nonce is created once per explicit user click and reused for the whole
 *   generation; a new explicit click creates a new nonce.
 *
 * A key must be stable across a crash-resume of the same run, so the server
 * replays the original task instead of billing a second one.
 */

/** The server rejects an idempotency key longer than this, with a 422. */
export const MAX_CANVAS_TASK_KEY_LENGTH = 128;

/** Stable 53-bit digest (cyrb53) so a resumed run still derives the same key. */
function taskKeyDigest(value: string) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let index = 0; index < value.length; index += 1) {
        const char = value.charCodeAt(index);
        h1 = Math.imul(h1 ^ char, 2654435761);
        h2 = Math.imul(h2 ^ char, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Composed identifiers can outgrow the server limit — a storyboard shot inside a
 * workflow reached 136 characters and failed every shot with a 422. Fold an
 * over-long key into a digest of itself so it still deduplicates a replay
 * instead of being rejected outright.
 */
export function boundedCanvasTaskKey(key: string) {
    if (key.length <= MAX_CANVAS_TASK_KEY_LENGTH) return key;
    const digest = `~${taskKeyDigest(key)}`;
    return `${key.slice(0, MAX_CANVAS_TASK_KEY_LENGTH - digest.length)}${digest}`;
}

export function canvasWorkflowTaskKey(runId: string, nodeId: string, imageIndexOrId: number | string) {
    return boundedCanvasTaskKey(`canvas:${runId}:${nodeId}:${imageIndexOrId}`);
}

export function canvasManualTaskKey(projectId: string, nodeId: string, nonce: string, imageIndexOrId?: number | string) {
    const base = `canvas:${projectId}:${nodeId}:${nonce}`;
    return boundedCanvasTaskKey(imageIndexOrId === undefined ? base : `${base}:${imageIndexOrId}`);
}
