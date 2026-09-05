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
                return { acknowledged: true, executed: false, successful: cache.get(key)?.successful || false };
            }
            let record = cache.get(key);
            let executed = false;
            if (!record) {
                executed = true;
                try {
                    record = { envelope: { result: await options.execute(call) }, successful: true };
                } catch (error) {
                    record = { envelope: { error: error instanceof Error ? error.message : "工具执行失败" }, successful: false };
                }
                cache.set(key, record);
                while (cache.size > MAX_CACHED_TOOL_RESULTS) cache.delete(cache.keys().next().value as string);
            }

            for (let attempt = 0; attempt < acknowledgeAttempts; attempt += 1) {
                try {
                    await options.acknowledge(call, record.envelope);
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
