export type CanvasAgentDeliverableToolCall = {
    requestId: string;
    name: string;
    arguments: string;
};

export type CanvasAgentToolResultEnvelope = { result?: unknown; error?: string };

type CanvasAgentToolResultRecord = {
    envelope: CanvasAgentToolResultEnvelope;
    successful: boolean;
};

type CanvasAgentToolJournalEntry = { state: "executing" } | { state: "completed"; record: CanvasAgentToolResultRecord };

export type CanvasAgentToolJournal = {
    read: (key: string) => CanvasAgentToolJournalEntry | null;
    write: (key: string, entry: CanvasAgentToolJournalEntry) => void;
    remove: (key: string) => void;
};

export function createCanvasAgentToolJournal(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): CanvasAgentToolJournal {
    const name = (key: string) => `startclouds:canvas-tool-delivery:v1:${encodeURIComponent(key)}`;
    return {
        read: (key) => {
            const raw = storage.getItem(name(key));
            if (raw === null) return null;
            const entry = JSON.parse(raw) as CanvasAgentToolJournalEntry;
            if (entry?.state === "executing" || (entry?.state === "completed" && typeof entry.record?.successful === "boolean" && entry.record.envelope)) return entry;
            throw new Error("画布工具执行记录损坏，已暂停执行，请核对画布状态");
        },
        write: (key, entry) => storage.setItem(name(key), JSON.stringify(entry)),
        remove: (key) => storage.removeItem(name(key)),
    };
}

export type CanvasAgentToolDeliveryOutcome = {
    acknowledged: boolean;
    executed: boolean;
    successful: boolean;
};

export type CanvasAgentToolDeliveryOptions = {
    runId: string;
    execute: (call: CanvasAgentDeliverableToolCall) => Promise<unknown>;
    acknowledge: (call: CanvasAgentDeliverableToolCall, envelope: CanvasAgentToolResultEnvelope) => Promise<void>;
    isPending: (call: CanvasAgentDeliverableToolCall) => Promise<boolean>;
    withLock?: <T>(name: string, task: () => Promise<T>) => Promise<T | undefined>;
    resultCache?: Map<string, CanvasAgentToolResultRecord>;
    journal?: CanvasAgentToolJournal;
    acknowledgeAttempts?: number;
};

const MAX_CACHED_TOOL_RESULTS = 128;
const SYNTHETIC_COMPLETION_REQUEST_PREFIX = "completion:";

export async function canExecuteApprovedCanvasAgentTool(
    call: Pick<CanvasAgentDeliverableToolCall, "requestId">,
    runId: string,
    isPending: (runId: string, requestId: string) => Promise<boolean>,
) {
    if (call.requestId.startsWith(SYNTHETIC_COMPLETION_REQUEST_PREFIX)) return true;
    if (!runId) return false;
    return isPending(runId, call.requestId);
}

export function waitForCanvasAgentToolPaint(schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame) {
    return new Promise<void>((resolve) => {
        schedule(() => schedule(() => resolve()));
    });
}

/**
 * Coordinates one browser-side canvas tool execution. Results are cached by
 * run/request id, so a failed HTTP acknowledgement can be retried without
 * replaying the mutation. The optional lock spans the pending check, execution,
 * and acknowledgement to make a second browser tab an observer only.
 */
export function createCanvasAgentToolDelivery(options: CanvasAgentToolDeliveryOptions) {
    const cache = options.resultCache || new Map<string, CanvasAgentToolResultRecord>();
    const inFlight = new Map<string, Promise<CanvasAgentToolDeliveryOutcome | undefined>>();
    const acknowledgeAttempts = Math.max(1, options.acknowledgeAttempts || 2);

    const serve = (call: CanvasAgentDeliverableToolCall) => {
        const key = `${options.runId}\0${call.requestId}`;
        const existing = inFlight.get(key);
        if (existing) return existing;

        const run = async (): Promise<CanvasAgentToolDeliveryOutcome> => {
            if (!(await options.isPending(call))) {
                // A rejected claim may mean another executor still owns it.
                return { acknowledged: true, executed: false, successful: cache.get(key)?.successful || false };
            }
            let record = cache.get(key);
            let executed = false;
            if (!record) {
                const persisted = options.journal?.read(key);
                if (persisted?.state === "completed") {
                    record = persisted.record;
                } else if (persisted?.state === "executing") {
                    // A crash may fall between the mutation and its result write.
                    record = { envelope: { error: "此前工具可能已执行，但结果尚未确认。为避免重复操作或扣费，已停止自动重放，请先核对画布和任务记录。" }, successful: false };
                } else {
                    // Storage failures must occur before any side effect.
                    options.journal?.write(key, { state: "executing" });
                    executed = true;
                    try {
                        record = { envelope: { result: await options.execute(call) }, successful: true };
                    } catch (error) {
                        record = { envelope: { error: error instanceof Error ? error.message : "工具执行失败" }, successful: false };
                    }
                }
                options.journal?.write(key, { state: "completed", record });
                cache.set(key, record);
                while (cache.size > MAX_CACHED_TOOL_RESULTS) cache.delete(cache.keys().next().value as string);
            }

            for (let attempt = 0; attempt < acknowledgeAttempts; attempt += 1) {
                try {
                    await options.acknowledge(call, record.envelope);
                    options.journal?.remove(key);
                    return { acknowledged: true, executed, successful: record.successful };
                } catch {
                    // A later attempt or the next poll reuses the cached result.
                }
            }
            return { acknowledged: false, executed, successful: record.successful };
        };

        const task = options.withLock
            ? options.withLock(`startclouds:canvas-agent-tool:${options.runId}:${call.requestId}`, run)
            : run();
        const promise = task.finally(() => inFlight.delete(key));
        inFlight.set(key, promise);
        return promise;
    };

    return { serve };
}
