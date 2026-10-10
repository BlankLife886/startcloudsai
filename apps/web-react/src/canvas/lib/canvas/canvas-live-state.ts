/** Scheduler reads must observe committed graph data before React paints the next frame. */
export function commitCanvasArray<T>(ref: { current: T[] }, update: T[] | ((current: T[]) => T[]), publish: (value: T[]) => void) {
    const next = typeof update === "function" ? update(ref.current) : update;
    ref.current = next;
    publish(next);
    return next;
}
