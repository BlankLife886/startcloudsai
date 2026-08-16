import { nanoid } from "nanoid";

import { imageToDataUrl } from "@/services/image-storage";
import { StarcloudsApiError, starcloudsJson, starcloudsRequest, uploadCloudFile } from "@/services/starclouds-api";
import { getCanvasBackgroundRemovalTool } from "@/lib/canvas/canvas-background-removal-tool";
import { canvasImageRequestSize, coerceCanvasImageSettings } from "@/lib/canvas/canvas-image-model";
import { modelOptionMeta, modelOptionName, type AiConfig } from "@/stores/use-config-store";
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
    assistantMessage?: { content?: string };
};

function abortError() {
    return new DOMException("Aborted", "AbortError");
}

function wait(delay: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const timer = window.setTimeout(resolve, delay);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(abortError());
            },
            { once: true },
        );
    });
}

function cloudKey(reference: ReferenceImage) {
    const key = reference.storageKey || "";
    return key.startsWith("uploads/") || key.startsWith("tasks/") ? key : "";
}

async function ensureReferenceKey(reference: ReferenceImage) {
    const existing = cloudKey(reference);
    if (existing) return existing;
    const dataUrl = await imageToDataUrl(reference);
    const blob = await (await fetch(dataUrl)).blob();
    return (await uploadCloudFile(blob, reference.name || `canvas-reference-${nanoid()}.png`)).key;
}

export type CanvasTaskOptions = {
    signal?: AbortSignal;
    onCreated?: (taskId: string) => void;
    onResolved?: (images: Array<{ id: string; dataUrl: string; storageKey?: string }>) => void | Promise<void>;
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
    return options;
}

export async function requestCanvasBackgroundRemoval(reference: ReferenceImage, publicModelKey: string, options?: AbortSignal | CanvasTaskOptions): Promise<ReferenceImage> {
    const { signal, onCreated } = normalizeTaskOptions(options);
    const inputKey = await ensureReferenceKey(reference);
    const modelKey = publicModelKey.trim();
    if (!modelKey) throw new Error("背景移除工具暂不可用");
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
        idempotencyKey: crypto.randomUUID(),
    });
    onCreated?.(created.id);
    const task = await waitForTask(created.id, signal);
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

async function waitForTask(id: string, signal?: AbortSignal) {
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
        if (signal?.aborted) throw abortError();
        const poll = pollSignal(signal, 20_000);
        try {
            const task = await starcloudsRequest<CanvasTask>(`/tasks/${encodeURIComponent(id)}`, { signal: poll.signal });
            const status = taskStatus(task.status);
            if (taskSucceeded(status) && taskHasOutput(task)) return { ...task, status: "succeeded" as const };
            if (taskFailed(status)) throw new Error(task.errorMessage || (status.startsWith("cancel") ? "任务已取消" : "图片生成失败"));
        } catch (error) {
            if (signal?.aborted) throw abortError();
            if (error instanceof Error && (error.message.includes("图片生成失败") || error.message.includes("任务已取消"))) throw error;
            if (error instanceof StarcloudsApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
        } finally {
            poll.cleanup();
        }
        if (Date.now() >= deadline) throw new Error("图片仍在后台生成，请稍后重试");
        await wait(1500, signal);
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
        const dataUrl = urls[index] || (storageKey ? `/api/v1/files/${storageKey}` : "");
        return { id: nanoid(), dataUrl, storageKey };
    }).filter((image) => image.dataUrl || image.storageKey);
}

export async function requestCanvasImages(config: AiConfig, prompt: string, references: ReferenceImage[] = [], mask?: ReferenceImage, options?: AbortSignal | CanvasTaskOptions) {
    const { signal, onCreated, onResolved } = normalizeTaskOptions(options);
    const inputKeys = await Promise.all(references.slice(0, 4).map(ensureReferenceKey));
    const maskKey = mask ? await ensureReferenceKey(mask) : "";
    const count = Math.max(1, Math.min(4, Math.floor(Math.abs(Number(config.count)) || 1)));
    const created = await starcloudsJson<CanvasTask>("/tasks", "POST", {
        type: "t2i",
        prompt: prompt.trim(),
        params: {
            ...imageTaskParams(config),
            ...(maskKey ? { maskKey, maskBaseKey: inputKeys[0] } : {}),
        },
        inputKeys,
        count,
        idempotencyKey: crypto.randomUUID(),
    });
    onCreated?.(created.id);
    const task = await waitForTask(created.id, signal);
    const images = imagesFromCanvasTask(task);
    const settings = coerceCanvasImageSettings(modelOptionMeta(config, config.model), config);
    if (settings.background !== "transparent") return images;
    await onResolved?.(images);
    return Promise.all(images.map((image) => applyCanvasTransparentRemoval(image, signal)));
}

export async function applyCanvasTransparentRemoval(image: { id: string; dataUrl: string; storageKey?: string }, signal?: AbortSignal) {
    const removalTool = getCanvasBackgroundRemovalTool();
    if (!removalTool?.id) return image;
    const removed = await requestCanvasBackgroundRemoval(
        { id: image.id, name: "canvas-transparent.png", type: "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey },
        removalTool.id,
        { signal },
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

export async function requestCanvasAssistant(messages: Array<{ role: string; content: unknown }>, onDelta: (text: string) => void, signal?: AbortSignal, model = "") {
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
    });
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
        if (signal?.aborted) throw abortError();
        const current = await starcloudsRequest<CanvasAssistantResponse>(`/assistant/runs/${encodeURIComponent(created.run.id)}`, { signal });
        if (current.run.status === "succeeded") {
            const content = current.assistantMessage?.content?.trim() || "没有返回内容";
            onDelta(content);
            return content;
        }
        if (current.run.status === "failed" || current.run.status === "canceled") throw new Error(current.run.errorMessage || "画布对话任务失败");
        if (Date.now() >= deadline) throw new Error("画布对话任务仍在后台处理，请稍后重试");
        await wait(700, signal);
    }
}
