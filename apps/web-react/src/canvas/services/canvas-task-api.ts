import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { storageKeyFromUrl } from "@/lib/canvas/canvas-preview-url";
import { getCanvasBackgroundRemovalTool } from "@/lib/canvas/canvas-background-removal-tool";
import { canvasImageRequestSize, coerceCanvasImageSettings } from "@/lib/canvas/canvas-image-model";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { compactCanvasSnapshot, resolveCanvasAgentCompletion } from "@/lib/canvas/canvas-hosted-agent";
import { uploadImage } from "@/services/image-storage";
import { StarcloudsApiError, starcloudsApiUrl, starcloudsFileUrl, starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";
import type { AgentReasoningEffort } from "@/stores/use-agent-store";
import { modelOptionMeta, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { scheduleWalletRefresh } from "@react/legacy-modules/services/walletSync.js";
import type { ReferenceImage } from "@/types/image";

type CanvasTask = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    outputKeys: string[];
    outputUrls: string[];
    originalUrls: string[];
    errorMessage?: string;
};

type CanvasAssistantResponse = {
    run: { id: string; status: CanvasTask["status"]; errorMessage?: string };
    assistantMessage?: { content?: string; canvasOps?: unknown; canvasOpsSummary?: string; reasoning?: string; reasoningTokens?: number; reasoningEffort?: string };
};

export type CanvasAssistantTaskOptions = {
    signal?: AbortSignal;
    onCreated?: (runId: string) => void | Promise<void>;
};

function abortError() {
    return new DOMException("Aborted", "AbortError");
}

class CanvasTerminalTaskError extends Error {}

function wait(delay: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, delay);
        const onAbort = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(abortError());
        };
        signal?.addEventListener("abort", onAbort);
        if (signal?.aborted) onAbort();
    });
}

// ---------------------------------------------------------------------------
// Idempotency keys
//
// Canvas task submissions must be deterministic so that automatic retries and
// reconnect replays of the same logical generation never create (and bill) a
// second task. The backend deduplicates on (userId, idempotencyKey).
//
// - Workflow node execution:  canvas:${runId}:${nodeId}:${imageIndex}
// - Manual node generation:   canvas:${projectId}:${nodeId}:${nonce}:${imageIndex}
//   The nonce is created once per explicit user click and reused for the
//   whole generation; a new explicit click creates a new nonce.
// - Derived background removal reuses the parent key with a ":bg:N" suffix.

export function canvasWorkflowTaskKey(runId: string, nodeId: string, imageIndexOrId: number | string) {
    return `canvas:${runId}:${nodeId}:${imageIndexOrId}`;
}

export function canvasManualTaskKey(projectId: string, nodeId: string, nonce: string, imageIndexOrId?: number | string) {
    const base = `canvas:${projectId}:${nodeId}:${nonce}`;
    return imageIndexOrId === undefined ? base : `${base}:${imageIndexOrId}`;
}

export function createCanvasTaskNonce() {
    return nanoid(10);
}

// ---------------------------------------------------------------------------
// Concurrency gate
//
// At most CANVAS_TASK_CONCURRENCY canvas tasks may be in flight (submitted and
// not yet terminal) at any moment, so a large workflow wave queues instead of
// stampeding the backend with dozens of simultaneous submissions and streams.

const CANVAS_TASK_CONCURRENCY = 6;

type CanvasTaskGateWaiter = {
    resolve: () => void;
    signal?: AbortSignal;
    onAbort?: () => void;
};

let activeCanvasTaskCount = 0;
const canvasTaskGateWaiters: CanvasTaskGateWaiter[] = [];

function releaseCanvasTaskSlot() {
    activeCanvasTaskCount = Math.max(0, activeCanvasTaskCount - 1);
    const waiter = canvasTaskGateWaiters.shift();
    if (!waiter) return;
    activeCanvasTaskCount += 1;
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
}

function acquireCanvasTaskSlot(signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (activeCanvasTaskCount < CANVAS_TASK_CONCURRENCY) {
        activeCanvasTaskCount += 1;
        return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
        const waiter: CanvasTaskGateWaiter = { resolve, signal };
        canvasTaskGateWaiters.push(waiter);
        if (!signal) return;
        waiter.onAbort = () => {
            const index = canvasTaskGateWaiters.indexOf(waiter);
            if (index >= 0) canvasTaskGateWaiters.splice(index, 1);
            reject(abortError());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        if (signal.aborted) waiter.onAbort();
    });
}

async function withCanvasTaskSlot<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    await acquireCanvasTaskSlot(signal);
    try {
        return await run();
    } finally {
        releaseCanvasTaskSlot();
    }
}

/** Cancel a queued task server-side. The backend exposes this as PATCH /tasks/:id { status: "canceled" } and rejects tasks that already started. */
export function cancelCanvasTask(id: string) {
    return starcloudsJson<CanvasTask>(`/tasks/${encodeURIComponent(id)}`, "PATCH", { status: "canceled" });
}

function cloudKey(reference: ReferenceImage) {
    const key = reference.storageKey || "";
    return key.startsWith("uploads/") || key.startsWith("tasks/") ? key : "";
}

async function ensureReferenceKey(reference: ReferenceImage) {
    const existing = cloudKey(reference) || storageKeyFromUrl(reference.dataUrl || "");
    if (existing && (existing.startsWith("uploads/") || existing.startsWith("tasks/"))) return existing;
    const uploaded = await uploadImage(reference.storageKey || reference.dataUrl);
    if (!uploaded.storageKey.startsWith("uploads/") && !uploaded.storageKey.startsWith("tasks/")) throw new Error(i18n.t("common.imageReadFailed"));
    return uploaded.storageKey;
}

export type CanvasTaskOptions = {
    signal?: AbortSignal;
    onCreated?: (taskId: string) => void | Promise<void>;
    onResolved?: (images: Array<{ id: string; dataUrl: string; storageKey?: string }>) => void | Promise<void>;
    /** Deterministic idempotency key; falls back to a random key when omitted. */
    idempotencyKey?: string;
    /** Runs after a concurrency slot is acquired and before the task is submitted; throw an AbortError to skip submission (e.g. the workflow run was stopped while queued). */
    onBeforeCreate?: () => void;
};

function taskStatus(value: string | undefined) {
    return String(value || "").toLowerCase();
}

function taskSucceeded(status: string) {
    return status === "succeeded" || status === "success" || status === "completed";
}

function taskFailed(status: string) {
    return status === "failed" || status === "canceled" || status === "cancelled";
}

function taskHasOutput(task: CanvasTask) {
    return Boolean((task.originalUrls?.length || task.outputUrls?.length || task.outputKeys?.length));
}

function pollSignal(signal: AbortSignal | undefined, ms: number) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ms);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    return {
        signal: controller.signal,
        cleanup() {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        },
    };
}

function normalizeTaskOptions(options?: AbortSignal | CanvasTaskOptions): CanvasTaskOptions {
    if (!options) return {};
    if (typeof AbortSignal !== "undefined" && options instanceof AbortSignal) return { signal: options };
    return options as CanvasTaskOptions;
}

export async function requestCanvasBackgroundRemoval(reference: ReferenceImage, publicModelKey: string, options?: AbortSignal | CanvasTaskOptions): Promise<ReferenceImage> {
    const { signal, onCreated, idempotencyKey, onBeforeCreate } = normalizeTaskOptions(options);
    const inputKey = await ensureReferenceKey(reference);
    const modelKey = publicModelKey.trim();
    if (!modelKey) throw new Error("背景移除工具暂不可用");
    const task = await withCanvasTaskSlot(signal, async () => {
        if (signal?.aborted) throw abortError();
        onBeforeCreate?.();
        const created = await starcloudsJson<CanvasTask>("/tasks", "POST", {
            type: "background_remove",
            prompt: "移除图片背景",
            params: {
                publicModelKey: modelKey,
                _kind: "canvas-background-remove",
                _source: "react_canvas",
            },
            inputKeys: [inputKey],
            count: 1,
            idempotencyKey: idempotencyKey || crypto.randomUUID(),
        });
        scheduleWalletRefresh();
        await onCreated?.(created.id);
        return waitForTask(created.id, signal);
    });
    const [image] = imagesFromCanvasTask(task);
    return {
        id: nanoid(),
        name: `${reference.name || "image"}-no-background.png`,
        type: "image/png",
        dataUrl: image.dataUrl,
        storageKey: image.storageKey,
    };
}

function imageTaskParams(config: AiConfig) {
    const settings = coerceCanvasImageSettings(modelOptionMeta(config, config.model), config);
    const quality = settings.quality === "standard" ? "medium" : settings.quality === "hd" ? "high" : settings.quality;
    const aspectRatio = settings.size || "auto";
    const resolutionScale = settings.resolution || "1K";
    const outputSize = canvasImageRequestSize(aspectRatio, resolutionScale);
    const removalTool = settings.background === "transparent" ? getCanvasBackgroundRemovalTool() : null;
    return {
        aspectRatio,
        requestedAspectRatio: aspectRatio,
        resolutionScale,
        ...(outputSize ? { size: outputSize, outputSize } : {}),
        ...(quality ? { quality } : {}),
        ...(settings.background === "transparent" && !removalTool?.id ? { transparentBackground: true } : {}),
        ...(config.model ? { publicModelKey: modelOptionName(config.model) } : {}),
        _kind: "canvas-image-generation",
        _source: "react_canvas",
    };
}

const TASK_POLL_BASE_MS = 2_000;
const TASK_POLL_MAX_MS = 15_000;

type CanvasTaskStream = {
    readonly active: boolean;
    takeSnapshot: () => CanvasTask | null;
    nextEvent: () => Promise<void>;
    close: () => void;
};

/**
 * Subscribe to GET /tasks/:id/events. The server pushes `data: {task, stage,
 * done}` snapshots and closes the stream when the task is terminal or its push
 * infrastructure is unavailable; the caller then falls back to polling.
 */
function openCanvasTaskStream(id: string): CanvasTaskStream | null {
    if (typeof EventSource === "undefined") return null;
    let source: EventSource;
    try {
        source = new EventSource(starcloudsApiUrl(`/tasks/${encodeURIComponent(id)}/events`), { withCredentials: true });
    } catch {
        return null;
    }
    let active = true;
    let snapshot: CanvasTask | null = null;
    let wake: (() => void) | null = null;
    const notify = () => {
        const current = wake;
        wake = null;
        current?.();
    };
    source.onmessage = (event) => {
        try {
            const payload = JSON.parse(String(event.data)) as { task?: CanvasTask };
            if (payload && typeof payload === "object" && payload.task) snapshot = payload.task;
        } catch {
            // Ignore malformed frames; polling remains the source of truth.
        }
        notify();
    };
    source.onerror = () => {
        // Errored or disconnected streams fall back to polling permanently.
        active = false;
        source.close();
        notify();
    };
    return {
        get active() {
            return active;
        },
        takeSnapshot: () => {
            const current = snapshot;
            snapshot = null;
            return current;
        },
        nextEvent: () =>
            new Promise<void>((resolve) => {
                if (!active || snapshot) return resolve();
                wake = resolve;
            }),
        close: () => {
            active = false;
            wake = null;
            source.close();
        },
    };
}

/**
 * Wait for a task to reach a terminal state. Prefers server-sent events from
 * /tasks/:id/events; when the stream is unavailable or drops, falls back to
 * polling GET /tasks/:id with exponential backoff (2s start, x1.5, 15s cap).
 * Request failures (network errors / 5xx) retry on the same backoff schedule.
 */
async function waitForTask(id: string, signal?: AbortSignal) {
    const deadline = Date.now() + 20 * 60 * 1000;
    let pollDelay = TASK_POLL_BASE_MS;
    let emptySuccessCount = 0;
    const stream = openCanvasTaskStream(id);
    try {
        for (;;) {
            if (signal?.aborted) throw abortError();
            let task = stream?.takeSnapshot() || null;
            let requestFailed = false;
            if (!task) {
                const poll = pollSignal(signal, 20_000);
                try {
                    task = await starcloudsRequest<CanvasTask>(`/tasks/${encodeURIComponent(id)}`, { signal: poll.signal });
                } catch (error) {
                    if (signal?.aborted) throw abortError();
                    if (error instanceof StarcloudsApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
                    requestFailed = true;
                } finally {
                    poll.cleanup();
                }
            }
            if (task) {
                const status = taskStatus(task.status);
                if (taskSucceeded(status) && taskHasOutput(task)) {
                    scheduleWalletRefresh();
                    return { ...task, status: "succeeded" as const };
                }
                if (taskSucceeded(status)) {
                    emptySuccessCount += 1;
                    if (emptySuccessCount >= 3) {
                        scheduleWalletRefresh();
                        throw new Error("任务已完成，但没有返回图片");
                    }
                } else {
                    emptySuccessCount = 0;
                }
                if (taskFailed(status)) {
                    scheduleWalletRefresh();
                    if (status.startsWith("cancel")) throw abortError();
                    throw new CanvasTerminalTaskError(task.errorMessage || "图片生成失败");
                }
            }
            if (Date.now() >= deadline) throw new Error("图片仍在后台生成，请稍后重试");
            if (stream?.active && !requestFailed) {
                await Promise.race([stream.nextEvent(), wait(TASK_POLL_MAX_MS, signal)]);
            } else {
                await wait(pollDelay, signal);
                pollDelay = Math.min(Math.round(pollDelay * 1.5), TASK_POLL_MAX_MS);
            }
        }
    } finally {
        stream?.close();
    }
}

export function waitForCanvasTask(id: string, signal?: AbortSignal) {
    return waitForTask(id, signal);
}

export function imagesFromCanvasTask(task: CanvasTask) {
    const urls = (task.originalUrls?.length ? task.originalUrls : task.outputUrls) || [];
    const keys = task.outputKeys || [];
    const count = Math.max(urls.length, keys.length);
    if (!count) throw new Error("任务已完成，但没有返回图片");
    return Array.from({ length: count }, (_, index) => {
        const storageKey = keys[index] || "";
        const dataUrl = urls[index] || (storageKey ? starcloudsFileUrl(storageKey) : "");
        return { id: nanoid(), dataUrl, storageKey };
    }).filter((image) => image.dataUrl || image.storageKey);
}

export async function requestCanvasImages(config: AiConfig, prompt: string, references: ReferenceImage[] = [], mask?: ReferenceImage, options?: AbortSignal | CanvasTaskOptions) {
    const { signal, onCreated, onResolved, idempotencyKey, onBeforeCreate } = normalizeTaskOptions(options);
    const inputKeys = await Promise.all(references.slice(0, 4).map(ensureReferenceKey));
    const maskKey = mask ? await ensureReferenceKey(mask) : "";
    if (signal?.aborted) throw abortError();
    const count = Math.max(1, Math.min(4, Math.floor(Math.abs(Number(config.count)) || 1)));
    const task = await withCanvasTaskSlot(signal, async () => {
        if (signal?.aborted) throw abortError();
        onBeforeCreate?.();
        const created = await starcloudsJson<CanvasTask>("/tasks", "POST", {
            type: "t2i",
            prompt: prompt.trim(),
            params: {
                ...imageTaskParams(config),
                ...(maskKey ? { maskKey, maskBaseKey: inputKeys[0] } : {}),
            },
            inputKeys,
            count,
            idempotencyKey: idempotencyKey || crypto.randomUUID(),
        });
        scheduleWalletRefresh();
        await onCreated?.(created.id);
        return waitForTask(created.id, signal);
    });
    const images = imagesFromCanvasTask(task);
    const settings = coerceCanvasImageSettings(modelOptionMeta(config, config.model), config);
    if (settings.background !== "transparent") return images;
    await onResolved?.(images);
    return Promise.all(images.map((image, index) => applyCanvasTransparentRemoval(image, signal, idempotencyKey ? `${idempotencyKey}:bg:${index}` : undefined)));
}

export async function applyCanvasTransparentRemoval(image: { id: string; dataUrl: string; storageKey?: string }, signal?: AbortSignal, idempotencyKey?: string) {
    const removalTool = getCanvasBackgroundRemovalTool();
    if (!removalTool?.id) return image;
    const removed = await requestCanvasBackgroundRemoval(
        { id: image.id, name: "canvas-transparent.png", type: "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey },
        removalTool.id,
        { signal, idempotencyKey },
    );
    return { id: image.id, dataUrl: removed.dataUrl, storageKey: removed.storageKey };
}

function flattenMessages(messages: Array<{ role: string; content: unknown }>) {
    return messages
        .map((message) => {
            if (typeof message.content === "string") return `${message.role}: ${message.content}`;
            if (!Array.isArray(message.content)) return "";
            const text = message.content
                .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text || "") : ""))
                .filter(Boolean)
                .join("\n");
            return text ? `${message.role}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
}

function collectMessageReferenceImages(messages: Array<{ role: string; content: unknown }>) {
    const images: Array<{ dataUrl: string; name: string }> = [];
    const seen = new Set<string>();
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const item of message.content) {
            if (!item || typeof item !== "object" || !("image_url" in item)) continue;
            const url = String((item as { image_url?: { url?: string } }).image_url?.url || "").trim();
            if (!url || seen.has(url)) continue;
            seen.add(url);
            images.push({ dataUrl: url, name: `image-${images.length + 1}.png` });
        }
    }
    return images.slice(0, 4);
}

export async function waitForCanvasAssistantRun(runId: string, onDelta: (text: string) => void, signal?: AbortSignal) {
    const deadline = Date.now() + 20 * 60 * 1000;
    let pollDelay = 700;
    for (;;) {
        if (signal?.aborted) throw abortError();
        try {
            const poll = pollSignal(signal, 20_000);
            try {
                const current = await starcloudsRequest<CanvasAssistantResponse>(`/assistant/runs/${encodeURIComponent(runId)}`, { signal: poll.signal });
                if (current.run.status === "succeeded") {
                    scheduleWalletRefresh();
                    const content = current.assistantMessage?.content?.trim() || "没有返回内容";
                    onDelta(content);
                    return content;
                }
                if (current.run.status === "canceled") {
                    scheduleWalletRefresh();
                    throw abortError();
                }
                if (current.run.status === "failed") {
                    scheduleWalletRefresh();
                    throw new Error(current.run.errorMessage || "画布对话任务失败");
                }
                pollDelay = 700;
            } finally {
                poll.cleanup();
            }
        } catch (error) {
            if (signal?.aborted) throw abortError();
            if (error instanceof StarcloudsApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
            if (!(error instanceof StarcloudsApiError) && !(error instanceof TypeError)) throw error;
        }
        if (Date.now() >= deadline) throw new Error("画布对话任务仍在后台处理，请稍后重试");
        await wait(pollDelay, signal);
        pollDelay = Math.min(Math.round(pollDelay * 1.5), TASK_POLL_MAX_MS);
    }
}

export async function requestCanvasAssistant(messages: Array<{ role: string; content: unknown }>, onDelta: (text: string) => void, options?: CanvasAssistantTaskOptions, model = "") {
    const prompt = flattenMessages(messages).slice(-12_000);
    const referenceImages = collectMessageReferenceImages(messages);
    const conversation = await starcloudsJson<{ id: string }>("/assistant/conversations", "POST", {
        title: prompt.slice(0, 42) || "画布助手",
        workspace: "infinite_canvas",
    });
    const created = await starcloudsJson<CanvasAssistantResponse>("/assistant/runs", "POST", {
        conversationId: conversation.id,
        prompt,
        mode: "chat",
        workspace: "infinite_canvas",
        ...(model ? { model: modelOptionName(model) } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        count: 1,
        requestSize: "auto",
        quality: "high",
        idempotencyKey: crypto.randomUUID(),
    });
    scheduleWalletRefresh();
    await options?.onCreated?.(created.run.id);
    return waitForCanvasAssistantRun(created.run.id, onDelta, options?.signal);
}

export type CanvasAgentTurnResult = {
    text: string;
    ops: CanvasAgentOp[];
    summary?: string;
    executedTools?: number;
    reasoning?: string;
    reasoningTokens?: number;
    reasoningEffort?: string;
};

export type CanvasAgentToolCall = { requestId: string; name: string; arguments: string };
export type CanvasAgentToolHandler = (call: CanvasAgentToolCall) => Promise<unknown>;

export type CanvasAgentTurnOptions = {
    projectId: string;
    conversationId?: string;
    snapshot: CanvasAgentSnapshot;
    signal?: AbortSignal;
    onCreated?: (runId: string) => void | Promise<void>;
    onDelta?: (text: string) => void;
    onReasoning?: (reasoning: string) => void;
    onToolCall?: CanvasAgentToolHandler;
    referenceImages?: Array<{ id?: string; name?: string; dataUrl: string }>;
    reasoningEffort?: AgentReasoningEffort;
};

function hostedAgentConversationKey(projectId: string) {
    return `canvas-hosted-agent:${projectId}`;
}

export function readHostedAgentConversationId(projectId: string) {
    try {
        return sessionStorage.getItem(hostedAgentConversationKey(projectId)) || "";
    } catch {
        return "";
    }
}

export function writeHostedAgentConversationId(projectId: string, conversationId: string) {
    try {
        sessionStorage.setItem(hostedAgentConversationKey(projectId), conversationId);
    } catch {
        /* ignore quota */
    }
}

export function clearHostedAgentConversationId(projectId: string) {
    try {
        sessionStorage.removeItem(hostedAgentConversationKey(projectId));
    } catch {
        /* ignore */
    }
}

async function ensureCanvasAgentConversation(projectId: string, prompt: string, conversationId = "") {
    const existing = conversationId || readHostedAgentConversationId(projectId);
    if (existing) return existing;
    const conversation = await starcloudsJson<{ id: string }>("/assistant/conversations", "POST", {
        title: prompt.slice(0, 42) || "画布 Agent",
        workspace: "infinite_canvas",
    });
    writeHostedAgentConversationId(projectId, conversation.id);
    return conversation.id;
}

export async function cancelCanvasAssistantRun(runId: string) {
    await starcloudsJson(`/assistant/runs/${encodeURIComponent(runId)}`, "PATCH", { status: "canceled" });
}

type CanvasAgentStreamPayload = { content?: string; reasoning?: string; done?: boolean; status?: string; tool?: CanvasAgentToolCall };

function openCanvasAssistantRunStream(runId: string, onEvent: (payload: CanvasAgentStreamPayload) => void) {
    try {
        const source = new EventSource(starcloudsApiUrl(`/assistant/runs/${encodeURIComponent(runId)}/events`), { withCredentials: true });
        source.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data) as CanvasAgentStreamPayload;
                onEvent(payload);
                if (payload?.done) source.close();
            } catch {
                /* ignore malformed stream frames */
            }
        };
        return source;
    } catch {
        return null;
    }
}

export async function postCanvasAgentToolResult(runId: string, requestId: string, payload: { result?: unknown; error?: string }) {
    await starcloudsJson(`/assistant/runs/${encodeURIComponent(runId)}/tool-results`, "POST", { requestId, ...payload });
}

export async function waitForCanvasAgentRun(runId: string, onDelta: (text: string) => void, signal?: AbortSignal, onToolCall?: CanvasAgentToolHandler, onReasoning?: (reasoning: string) => void): Promise<CanvasAgentTurnResult> {
    const deadline = Date.now() + 20 * 60 * 1000;
    let pollDelay = 700;
    // The worker blocks on each tool result, so a duplicated SSE frame must not
    // trigger a second execution of the same mutation.
    const servedToolCalls = new Set<string>();
    let executedTools = 0;
    let canvasOpsApplied = false;
    let lastReasoning = "";
    const emitReasoning = (value: string | undefined) => {
        const reasoning = String(value || "").trim();
        if (!reasoning || reasoning === lastReasoning) return;
        lastReasoning = reasoning;
        onReasoning?.(reasoning);
    };
    const serveToolCall = async (call: CanvasAgentToolCall) => {
        if (!onToolCall || !call?.requestId || servedToolCalls.has(call.requestId)) return;
        servedToolCalls.add(call.requestId);
        try {
            const result = await onToolCall(call);
            executedTools += 1;
            if (call.name === "canvas_apply_ops") canvasOpsApplied = true;
            await postCanvasAgentToolResult(runId, call.requestId, { result });
        } catch (error) {
            await postCanvasAgentToolResult(runId, call.requestId, { error: error instanceof Error ? error.message : "工具执行失败" }).catch(() => undefined);
        }
    };
    const stream = openCanvasAssistantRunStream(runId, (payload) => {
        if (payload.content) onDelta(payload.content);
        emitReasoning(payload.reasoning);
        if (payload.tool) void serveToolCall(payload.tool);
    });
    const closeStream = () => {
        stream?.close();
    };
    signal?.addEventListener("abort", closeStream, { once: true });
    try {
    for (;;) {
        if (signal?.aborted) throw abortError();
        try {
            const poll = pollSignal(signal, 20_000);
            try {
                const current = await starcloudsRequest<CanvasAssistantResponse>(`/assistant/runs/${encodeURIComponent(runId)}`, { signal: poll.signal });
                const content = current.assistantMessage?.content?.trim() || "";
                if (content) onDelta(content);
                emitReasoning(current.assistantMessage?.reasoning);
                if (current.run.status === "succeeded") {
                    scheduleWalletRefresh();
                    const { ops, summary } = resolveCanvasAgentCompletion({
                        content,
                        canvasOps: current.assistantMessage?.canvasOps,
                        canvasOpsSummary: current.assistantMessage?.canvasOpsSummary,
                        executedTools,
                        canvasOpsApplied,
                    });
                    return {
                        text: ops.length ? summary || "已准备画布操作。" : content || "没有返回内容",
                        ops,
                        summary,
                        executedTools,
                        reasoning: lastReasoning || undefined,
                        reasoningTokens: Number(current.assistantMessage?.reasoningTokens || 0) || undefined,
                        reasoningEffort: current.assistantMessage?.reasoningEffort,
                    };
                }
                if (current.run.status === "canceled") {
                    scheduleWalletRefresh();
                    throw abortError();
                }
                if (current.run.status === "failed") {
                    scheduleWalletRefresh();
                    throw new Error(current.run.errorMessage || "画布 Agent 任务失败");
                }
                pollDelay = 700;
            } finally {
                poll.cleanup();
            }
        } catch (error) {
            if (signal?.aborted) throw abortError();
            if (error instanceof StarcloudsApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
            if (!(error instanceof StarcloudsApiError) && !(error instanceof TypeError)) throw error;
        }
        if (Date.now() >= deadline) throw new Error("画布 Agent 仍在后台处理，请稍后重试");
        await wait(pollDelay, signal);
        pollDelay = Math.min(Math.round(pollDelay * 1.5), TASK_POLL_MAX_MS);
    }
    } finally {
        signal?.removeEventListener("abort", closeStream);
        closeStream();
    }
}

export async function requestCanvasAgentTurn(prompt: string, options: CanvasAgentTurnOptions) {
    const snapshot = compactCanvasSnapshot(options.snapshot);
    const start = async (conversationId: string) =>
        starcloudsJson<CanvasAssistantResponse>("/assistant/runs", "POST", {
            conversationId,
            prompt,
            mode: "agent",
            workspace: "infinite_canvas",
            canvasSnapshot: snapshot,
            ...(options.referenceImages?.length ? { referenceImages: options.referenceImages.slice(0, 4) } : {}),
            count: 1,
            requestSize: "auto",
            quality: "high",
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
            idempotencyKey: crypto.randomUUID(),
        });
    let conversationId = await ensureCanvasAgentConversation(options.projectId, prompt, options.conversationId);
    let created: CanvasAssistantResponse;
    try {
        created = await start(conversationId);
    } catch (error) {
        if (!(error instanceof StarcloudsApiError) || error.status !== 404) throw error;
        clearHostedAgentConversationId(options.projectId);
        conversationId = await ensureCanvasAgentConversation(options.projectId, prompt);
        created = await start(conversationId);
    }
    scheduleWalletRefresh();
    await options.onCreated?.(created.run.id);
    return waitForCanvasAgentRun(created.run.id, options.onDelta || (() => undefined), options.signal, options.onToolCall, options.onReasoning);
}
