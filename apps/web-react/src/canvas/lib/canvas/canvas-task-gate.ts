/**
 * 画布任务提交闸门：同时在途（已提交、未结束）的任务按「张数」占用名额，名额上限取用户实际的
 * 出图并发额度（服务端同样按张计），让一大波工作流排在前端而不是一次性冲到后端。
 * 单个任务张数超过上限时按上限占用，保证总能提交；等待者严格按先后顺序放行，避免大任务饿死。
 */
export const CANVAS_TASK_FALLBACK_CONCURRENCY = 6;
export const CANVAS_TASK_HARD_MAX_CONCURRENCY = 100;

export function normalizeCanvasTaskConcurrency(value: unknown): number {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric) || numeric < 1) return CANVAS_TASK_FALLBACK_CONCURRENCY;
    return Math.min(CANVAS_TASK_HARD_MAX_CONCURRENCY, numeric);
}

type Waiter = {
    units: number;
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
};

export function createCanvasTaskGate(options: { limit?: number; abortError: () => unknown }) {
    let limit = normalizeCanvasTaskConcurrency(options.limit ?? CANVAS_TASK_FALLBACK_CONCURRENCY);
    let activeUnits = 0;
    const waiters: Waiter[] = [];

    const unitsFor = (requested: unknown) => Math.min(limit, Math.max(1, Math.floor(Number(requested)) || 1));

    const pump = () => {
        while (waiters.length) {
            const next = waiters[0];
            const units = Math.min(limit, next.units);
            // 空闲时即使超过上限也放行一个，避免上限被调小后队首永远等不到。
            if (activeUnits > 0 && activeUnits + units > limit) return;
            waiters.shift();
            activeUnits += units;
            next.units = units;
            if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
            next.resolve();
        }
    };

    const acquire = (requestedUnits: unknown, signal?: AbortSignal): Promise<number> => {
        if (signal?.aborted) return Promise.reject(options.abortError());
        const units = unitsFor(requestedUnits);
        if (!waiters.length && (activeUnits === 0 || activeUnits + units <= limit)) {
            activeUnits += units;
            return Promise.resolve(units);
        }
        return new Promise<number>((resolve, reject) => {
            const waiter: Waiter = { units, resolve: () => resolve(waiter.units), reject, signal };
            waiters.push(waiter);
            if (!signal) return;
            waiter.onAbort = () => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                reject(options.abortError());
                pump();
            };
            signal.addEventListener("abort", waiter.onAbort, { once: true });
            if (signal.aborted) waiter.onAbort();
        });
    };

    const release = (units: number) => {
        activeUnits = Math.max(0, activeUnits - Math.max(0, units));
        pump();
    };

    return {
        acquire,
        release,
        setLimit(next: unknown) {
            limit = normalizeCanvasTaskConcurrency(next);
            pump();
        },
        snapshot: () => ({ limit, activeUnits, waiting: waiters.length }),
    };
}
