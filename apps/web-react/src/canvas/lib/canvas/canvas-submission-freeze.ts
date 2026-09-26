/**
 * Every stop path settles the server tasks before it aborts the local requests,
 * so the refund is guaranteed and a rejected cancel can be confirmed again.
 * Generation requests waiting on a concurrency slot stay live for that whole
 * window, and the slots the cancels free up are exactly what lets them through:
 * they would create tasks that are missing from the cancel list already in
 * flight, so nothing would ever cancel them and the user would be billed for
 * work they stopped. A stop therefore freezes its nodes before it starts
 * cancelling, and thaws them once the stop settles.
 */
export function createCanvasSubmissionFreeze() {
    const frozen = new Set<string>();
    return {
        /**
         * Thaws only the ids this call actually froze, so two overlapping stops
         * cannot release each other's nodes back into submitting.
         */
        freeze(nodeIds: Iterable<string>) {
            const claimed = [...new Set(nodeIds)].filter((id) => id && !frozen.has(id));
            claimed.forEach((id) => frozen.add(id));
            return () => claimed.forEach((id) => frozen.delete(id));
        },
        /** Pass as onBeforeCreate: it runs after the slot is acquired, right before the task is created. */
        guard(...nodeIds: string[]) {
            return () => {
                if (nodeIds.some((id) => id && frozen.has(id))) throw new DOMException("Aborted", "AbortError");
            };
        },
        isFrozen(nodeId: string) {
            return frozen.has(nodeId);
        },
    };
}

export type CanvasSubmissionFreeze = ReturnType<typeof createCanvasSubmissionFreeze>;
