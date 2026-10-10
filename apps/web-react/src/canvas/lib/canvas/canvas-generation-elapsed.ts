import { useEffect, useState } from "react";

export function formatGenerationDuration(value: number) {
    const seconds = Math.max(0, Math.round(value / 1_000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function generationElapsedMs(startedAt: string | undefined, completedDurationMs: number | undefined, running: boolean) {
    if (running && startedAt) {
        const start = new Date(startedAt).getTime();
        if (Number.isNaN(start)) return Math.max(0, completedDurationMs || 0);
        return Math.max(0, Date.now() - start);
    }
    return Math.max(0, completedDurationMs || 0);
}

export function useGenerationElapsed(startedAt: string | undefined, completedDurationMs: number | undefined, running: boolean) {
    const [elapsed, setElapsed] = useState(() => generationElapsedMs(startedAt, completedDurationMs, running));
    useEffect(() => {
        setElapsed(generationElapsedMs(startedAt, completedDurationMs, running));
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsed(generationElapsedMs(startedAt, completedDurationMs, running)), 1_000);
        return () => window.clearInterval(timer);
    }, [completedDurationMs, running, startedAt]);
    return elapsed;
}
