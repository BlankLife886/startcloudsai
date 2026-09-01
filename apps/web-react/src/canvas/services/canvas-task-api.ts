import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { storageKeyFromUrl } from "@/lib/canvas/canvas-preview-url";
import { canvasImageRequestSize, canvasImageMaxCount, coerceCanvasImageSettings } from "@/lib/canvas/canvas-image-model";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { createCanvasAgentToolDelivery, type CanvasAgentToolResultEnvelope } from "@/lib/canvas/canvas-agent-tool-delivery";
import { compactCanvasSnapshot, resolveCanvasAgentCompletion } from "@/lib/canvas/canvas-hosted-agent";
import { uploadImage } from "@/services/image-storage";
import { StarcloudsApiError, starcloudsApiUrl, starcloudsFileUrl, starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";
import type { AgentChatItem, AgentMessageAttachment, AgentReasoningEffort } from "@/stores/use-agent-store";
import { modelOptionMeta, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { scheduleWalletRefresh } from "@react/legacy-modules/services/walletSync.js";
import type { ReferenceImage } from "@/types/image";

export type CanvasTask = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    outputKeys: string[];
    outputUrls: string[];
    originalUrls: string[];
	errorMessage?: string;
	generationStage?: "queued" | "preparing" | "upstream_generating" | "fetching_result" | "saving_result" | "completed" | "failed" | "canceled" | string;
	cancelPolicy?: {
		allowed?: boolean;
		mode?: string;
		upstreamSubmitted?: boolean;
		refunded?: boolean;
		message?: string;
	};
	costCents?: number;
	settledCostCents?: number;
};

export type CanvasAssistantResponse = {
	run: { id: string; status: CanvasTask["status"]; stage?: string; errorMessage?: string; costCents?: number; reservedCents?: number; cancelPolicy?: CanvasTask["cancelPolicy"] };
    assistantMessage?: {
        content?: string;
        canvasOps?: unknown;
        canvasOpsSummary?: string;
        reasoning?: string;
        reasoningTokens?: number;
        reasoningEffort?: string;
        statusStage?: string;
        pendingTool?: CanvasAgentToolCall;
    };
};

export const CANVAS_TASK_PROGRESS_EVENT = "starclouds:canvas-task-progress";

function publishCanvasTaskProgress(task: CanvasTask) {
	if (typeof window === "undefined" || !task?.id) return;
	window.dispatchEvent(new CustomEvent(CANVAS_TASK_PROGRESS_EVENT, { detail: task }));
}

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

/** Stop a queued or running task server-side and refresh all wallet consumers. */
export async function cancelCanvasTask(id: string, options?: { keepalive?: boolean; acknowledgeUpstream?: boolean }) {
    const task = await starcloudsRequest<CanvasTask>(`/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status: "canceled", acknowledgeUpstream: options?.acknowledgeUpstream === true }),
        keepalive: options?.keepalive,
    });
    scheduleWalletRefresh();
    return task;
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
    const aspectRatio = settings.size;
    const resolutionScale = settings.resolution;
    const outputSize = resolutionScale ? canvasImageRequestSize(aspectRatio, resolutionScale) : "";
    return {
        ...(aspectRatio ? { aspectRatio, requestedAspectRatio: aspectRatio } : {}),
        ...(resolutionScale ? { resolutionScale } : {}),
        ...(outputSize ? { size: outputSize, outputSize } : {}),
        ...(quality ? { quality } : {}),
        ...(settings.background === "transparent" ? { transparentBackground: true } : {}),
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
				publishCanvasTaskProgress(task);
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

export function getCanvasTaskRecord(id: string) {
	return starcloudsRequest<CanvasTask>(`/tasks/${encodeURIComponent(id)}`);
}

export function getCanvasAssistantRunRecord(id: string) {
	return starcloudsRequest<CanvasAssistantResponse>(`/assistant/runs/${encodeURIComponent(id)}`);
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
    const { signal, onCreated, idempotencyKey, onBeforeCreate } = normalizeTaskOptions(options);
    const inputKeys = await Promise.all(references.slice(0, 4).map(ensureReferenceKey));
    const maskKey = mask ? await ensureReferenceKey(mask) : "";
    if (signal?.aborted) throw abortError();
    const count = Math.max(1, Math.min(canvasImageMaxCount(modelOptionMeta(config, config.model)), Math.floor(Math.abs(Number(config.count)) || 1)));
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
    return images;
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

export async function requestCanvasAssistant(messages: Array<{ role: string; content: unknown }>, onDelta: (text: string) => void, options?: CanvasAssistantTaskOptions, model = "", reasoningEffort = "") {
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
        ...(reasoningEffort ? { reasoningEffort } : {}),
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

export type CanvasAgentToolCall = {
    requestId: string;
    name: string;
    arguments: string;
    stage?: string;
    title?: string;
    execution?: "browser" | "server";
    status?: "running" | "completed" | "failed";
    result?: unknown;
    error?: string;
};
export type CanvasAgentToolHandler = (call: CanvasAgentToolCall) => Promise<unknown>;

export type CanvasAgentTurnOptions = {
    projectId: string;
    conversationId?: string;
    model?: string;
    snapshot: CanvasAgentSnapshot;
    signal?: AbortSignal;
    onCreated?: (runId: string) => void | Promise<void>;
    onDelta?: (text: string) => void;
    onReasoning?: (reasoning: string) => void;
    onStage?: (stage: string) => void;
    onToolCall?: CanvasAgentToolHandler;
    referenceImages?: Array<{ id?: string; name?: string; dataUrl: string }>;
    reasoningEffort?: AgentReasoningEffort;
};

function hostedAgentConversationKey(projectId: string) {
    return `canvas-hosted-agent:${projectId}`;
}

function hostedAgentStorageGet(key: string) {
    try {
        const local = localStorage.getItem(key);
        if (local) return local;
        const session = sessionStorage.getItem(key);
        if (session) {
            try {
                localStorage.setItem(key, session);
                sessionStorage.removeItem(key);
            } catch {
                /* ignore quota */
            }
            return session;
        }
    } catch {
        /* ignore */
    }
    return "";
}

function hostedAgentStorageSet(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* ignore quota */
    }
    try {
        sessionStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

function hostedAgentStorageRemove(key: string) {
    try {
        localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
    try {
        sessionStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

export function readHostedAgentConversationId(projectId: string) {
    if (!projectId) return "";
    return hostedAgentStorageGet(hostedAgentConversationKey(projectId));
}

export function writeHostedAgentConversationId(projectId: string, conversationId: string) {
    if (!projectId || !conversationId) return;
    hostedAgentStorageSet(hostedAgentConversationKey(projectId), conversationId);
}

export function clearHostedAgentConversationId(projectId: string) {
    if (!projectId) return;
    hostedAgentStorageRemove(hostedAgentConversationKey(projectId));
}

export type CanvasAgentConversationMessage = {
    id: string;
    role?: string;
    content?: string;
    kind?: string;
    status?: string;
    pending?: boolean;
    error?: string;
    referenceImages?: Array<{ id?: string; name?: string; fileKey?: string; url?: string; thumbnailKey?: string; thumbnailUrl?: string }>;
    canvasOpsSummary?: string;
    reasoning?: string;
    reasoningTokens?: number;
    reasoningEffort?: string;
};

export type CanvasAgentConversation = {
    id: string;
    title?: string;
    workspace?: string;
    projectId?: string | null;
    createdAt?: string;
    updatedAt?: string;
    messages?: CanvasAgentConversationMessage[];
};

const HOSTED_USER_PROMPT_MARKERS = [
    "\n\n本轮聊天附件，可用 canvas_create_attachment_nodes 放到画布：",
    "\n\n本轮引用的当前画布素材：",
];

function displayHostedUserPrompt(content: string) {
    let text = content;
    for (const marker of HOSTED_USER_PROMPT_MARKERS) {
        const index = text.indexOf(marker);
        if (index >= 0) text = text.slice(0, index);
    }
    return text.trim();
}

function hostedAgentAttachment(image: NonNullable<CanvasAgentConversationMessage["referenceImages"]>[number], index: number): AgentMessageAttachment | null {
    const url = image.url || (image.fileKey ? starcloudsFileUrl(image.fileKey) : "") || image.thumbnailUrl || (image.thumbnailKey ? starcloudsFileUrl(image.thumbnailKey) : "");
    if (!url) return null;
    return { id: image.id || image.fileKey || `ref-${index}`, name: image.name || "image", url };
}

export function hostedAgentMessagesFromConversation(
    messages: CanvasAgentConversationMessage[] | undefined,
    titles: { assistant: string; reasoning: string; canvasOps: string },
): AgentChatItem[] {
    const items: AgentChatItem[] = [];
    for (const message of messages || []) {
        const kind = String(message.kind || "");
        if (kind === "context-divider") continue;
        const role = String(message.role || "");
        const content = String(message.content || "").trim();
        const error = String(message.error || "").trim();
        const failed = message.status === "failed" || Boolean(error);
        if (role === "user") {
            const attachments = (message.referenceImages || []).map(hostedAgentAttachment).filter((item): item is AgentMessageAttachment => Boolean(item));
            items.push({
                id: message.id,
                role: "user",
                text: displayHostedUserPrompt(content) || (attachments.length ? " " : content),
                attachments,
            });
            continue;
        }
        if (role !== "assistant") continue;
        if (message.pending || message.status === "queued" || message.status === "running") {
            items.push({
                id: message.id,
                role: "assistant",
                title: titles.assistant,
                text: error || content,
                streamId: message.id,
            });
            continue;
        }
        const reasoning = String(message.reasoning || "").trim();
        if (reasoning) {
            items.push({
                id: `${message.id}:reasoning`,
                role: "tool",
                title: titles.reasoning,
                text: reasoning,
                detail: {
                    kind: "reasoning",
                    status: "completed",
                    ...(message.reasoningEffort ? { effort: message.reasoningEffort } : {}),
                    ...(Number(message.reasoningTokens || 0) > 0 ? { tokens: Number(message.reasoningTokens) } : {}),
                },
            });
        }
        items.push({
            id: message.id,
            role: failed ? "error" : "assistant",
            title: failed ? undefined : titles.assistant,
            text: error || content,
        });
        const summary = String(message.canvasOpsSummary || "").trim();
        if (summary && !failed) {
            items.push({
                id: `${message.id}:ops`,
                role: "tool",
                title: titles.canvasOps,
                text: summary,
            });
        }
    }
    return items;
}

export function fetchCanvasAgentConversation(conversationId: string, signal?: AbortSignal, projectId = "") {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return starcloudsRequest<CanvasAgentConversation>(`/assistant/conversations/${encodeURIComponent(conversationId)}${query}`, { signal });
}

export function listActiveCanvasAgentRuns(signal?: AbortSignal) {
    return starcloudsRequest<{ runs?: Array<{ id: string; conversationId?: string; status?: string }> }>(
        `/assistant/runs?workspace=${encodeURIComponent("infinite_canvas")}`,
        { signal },
    ).then((data) => (Array.isArray(data.runs) ? data.runs : []));
}

export async function listCanvasAgentConversations(projectId: string, signal?: AbortSignal) {
    if (!projectId) return [];
    const data = await starcloudsRequest<{ conversations?: CanvasAgentConversation[] }>(
        `/assistant/conversations?workspace=${encodeURIComponent("infinite_canvas")}&projectId=${encodeURIComponent(projectId)}`,
        { signal },
    );
    return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function fetchLatestCanvasAgentConversation(projectId: string, signal?: AbortSignal) {
    const conversations = await listCanvasAgentConversations(projectId, signal);
    return conversations[0] || null;
}

export async function deleteCanvasAgentConversation(conversationId: string, cancelActive = false) {
    const query = cancelActive ? "?cancelActive=true" : "";
    await starcloudsRequest(`/assistant/conversations/${encodeURIComponent(conversationId)}${query}`, { method: "DELETE" });
}

function hostedConversationUnix(value?: string) {
    if (!value) return undefined;
    const time = Date.parse(value);
    return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

export function hostedAgentConversationPreview(conversation: CanvasAgentConversation) {
    const user = (conversation.messages || []).find((item) => item.role === "user");
    return displayHostedUserPrompt(String(user?.content || "")) || String(conversation.title || "").trim();
}

export function hostedAgentConversationThread(conversation: CanvasAgentConversation) {
    const preview = hostedAgentConversationPreview(conversation);
    return {
        id: conversation.id,
        name: preview || String(conversation.title || "").trim() || undefined,
        preview,
        createdAt: hostedConversationUnix(conversation.createdAt),
        updatedAt: hostedConversationUnix(conversation.updatedAt),
    };
}

const creatingHostedAgentConversations = new Map<string, Promise<CanvasAgentConversation>>();
let hostedAgentFreshProjectId = "";

export function createCanvasAgentConversation(projectId: string, prompt = "") {
    const pending = creatingHostedAgentConversations.get(projectId);
    if (pending) return pending;
    const task = starcloudsJson<CanvasAgentConversation>("/assistant/conversations", "POST", {
        title: prompt.slice(0, 42) || "画布 Agent",
        workspace: "infinite_canvas",
        projectId,
    }).then((conversation) => {
        writeHostedAgentConversationId(projectId, conversation.id);
        if (hostedAgentFreshProjectId === projectId) hostedAgentFreshProjectId = "";
        return conversation;
    }).finally(() => {
        creatingHostedAgentConversations.delete(projectId);
    });
    creatingHostedAgentConversations.set(projectId, task);
    return task;
}

export function beginHostedAgentConversation(projectId: string) {
    hostedAgentFreshProjectId = projectId;
    clearHostedAgentConversationId(projectId);
    return createCanvasAgentConversation(projectId);
}

async function ensureCanvasAgentConversation(projectId: string, prompt: string, conversationId = "") {
    const existing = conversationId || readHostedAgentConversationId(projectId);
    if (existing) return existing;
    if (hostedAgentFreshProjectId !== projectId) {
        const latest = await fetchLatestCanvasAgentConversation(projectId);
        if (latest?.id) {
            writeHostedAgentConversationId(projectId, latest.id);
            return latest.id;
        }
    }
    const conversation = await createCanvasAgentConversation(projectId, prompt);
    return conversation.id;
}

export async function cancelCanvasAssistantRun(runId: string, options?: { keepalive?: boolean; acknowledgeUpstream?: boolean }) {
	await starcloudsRequest(`/assistant/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status: "canceled", acknowledgeUpstream: options?.acknowledgeUpstream !== false }),
        keepalive: options?.keepalive,
	});
	scheduleWalletRefresh();
}

type CanvasAgentStreamPayload = {
    content?: string;
    reasoning?: string;
    done?: boolean;
    status?: string;
    kind?: string;
    stage?: string;
    tool?: CanvasAgentToolCall;
};

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
    await starcloudsJson(`/assistant/runs/${encodeURIComponent(runId)}/tool-results`, "POST", {
        requestId,
        executorId: currentCanvasAgentExecutorId(),
        ...payload,
    });
}

const CANVAS_AGENT_EXECUTOR_KEY = "startclouds:canvas-agent-executor";
let canvasAgentExecutorId = "";

function currentCanvasAgentExecutorId() {
    if (canvasAgentExecutorId) return canvasAgentExecutorId;
    try {
        canvasAgentExecutorId = sessionStorage.getItem(CANVAS_AGENT_EXECUTOR_KEY) || "";
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
    if (!canvasAgentExecutorId) {
        canvasAgentExecutorId = `canvas-${nanoid(20)}`;
        try {
            sessionStorage.setItem(CANVAS_AGENT_EXECUTOR_KEY, canvasAgentExecutorId);
        } catch {
            // The in-memory identifier still protects this page lifetime.
        }
    }
    return canvasAgentExecutorId;
}

export async function claimCanvasAgentTool(runId: string, requestId: string) {
    if (!runId || !requestId) return false;
    const result = await starcloudsJson<{ claimed?: boolean }>(`/assistant/runs/${encodeURIComponent(runId)}/tool-claims`, "POST", {
        requestId,
        executorId: currentCanvasAgentExecutorId(),
    });
    return result.claimed === true;
}

const canvasAgentToolResultCache = new Map<string, { envelope: CanvasAgentToolResultEnvelope; successful: boolean }>();

async function withCanvasAgentToolLock<T>(name: string, task: () => Promise<T>): Promise<T | undefined> {
    if (typeof navigator === "undefined" || !navigator.locks?.request) return task();
    return navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => (lock ? task() : undefined));
}

export async function waitForCanvasAgentRun(
    runId: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
    onToolCall?: CanvasAgentToolHandler,
    onReasoning?: (reasoning: string) => void,
    onStage?: (stage: string) => void,
): Promise<CanvasAgentTurnResult> {
    const deadline = Date.now() + 20 * 60 * 1000;
    let pollDelay = 700;
    const countedToolCalls = new Set<string>();
    let executedTools = 0;
    let canvasOpsApplied = false;
    let lastReasoning = "";
    let lastStage = "";
    const emitReasoning = (value: string | undefined) => {
        const reasoning = String(value || "").trim();
        if (!reasoning || reasoning === lastReasoning) return;
        lastReasoning = reasoning;
        onReasoning?.(reasoning);
    };
    const emitStage = (value: string | undefined) => {
        const stage = String(value || "").trim();
        if (!stage || stage === lastStage) return;
        lastStage = stage;
        onStage?.(stage);
    };
    const delivery = onToolCall
        ? createCanvasAgentToolDelivery({
            runId,
            execute: async (call) => {
                const result = await onToolCall(call);
                if (!countedToolCalls.has(call.requestId)) {
                    countedToolCalls.add(call.requestId);
                    executedTools += 1;
                    if (call.name === "canvas_apply_ops") canvasOpsApplied = true;
                }
                return result;
            },
            acknowledge: (_call, envelope) => postCanvasAgentToolResult(runId, _call.requestId, envelope),
            isPending: (call) => claimCanvasAgentTool(runId, call.requestId),
            withLock: withCanvasAgentToolLock,
            resultCache: canvasAgentToolResultCache,
        })
        : null;
    const serveToolCall = (call: CanvasAgentToolCall) => {
        if (!call?.requestId || !call.name) return;
        emitStage(call.stage || "tool");
        if (call.execution === "server") {
            if (!onToolCall) return;
            void onToolCall(call).then(() => {
                if (call.status === "completed" && !countedToolCalls.has(call.requestId)) {
                    countedToolCalls.add(call.requestId);
                    executedTools += 1;
                }
            }).catch(() => undefined);
            return;
        }
        if (!delivery) return;
        void delivery.serve(call).catch(() => undefined);
    };
    const stream = openCanvasAssistantRunStream(runId, (payload) => {
        if (payload.content) onDelta(payload.content);
        emitReasoning(payload.reasoning);
        emitStage(payload.stage);
        if (payload.tool) serveToolCall(payload.tool);
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
                emitStage(current.assistantMessage?.statusStage || current.run.stage);
                if (current.assistantMessage?.pendingTool) serveToolCall(current.assistantMessage.pendingTool);
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
            // Each GET has its own timeout. That timeout aborts only the current
            // request and must not be reported as an interrupted Agent turn.
            const pollTimedOut = error instanceof DOMException && error.name === "AbortError";
            if (!pollTimedOut) {
                if (error instanceof StarcloudsApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
                if (!(error instanceof StarcloudsApiError) && !(error instanceof TypeError)) throw error;
            }
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
            ...(options.model ? { model: modelOptionName(options.model) } : {}),
            ...(options.referenceImages?.length ? { referenceImages: options.referenceImages.slice(0, 4) } : {}),
            count: 1,
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
    return waitForCanvasAgentRun(created.run.id, options.onDelta || (() => undefined), options.signal, options.onToolCall, options.onReasoning, options.onStage);
}
