import { nanoid } from "nanoid";

import { imageToDataUrl } from "@/services/image-storage";
import { starcloudsJson, starcloudsRequest, uploadCloudFile } from "@/services/starclouds-api";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
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

export async function requestCanvasBackgroundRemoval(reference: ReferenceImage, publicModelKey: string, signal?: AbortSignal): Promise<ReferenceImage> {
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
    const task = await waitForTask(created.id, signal);
    const dataUrl = task.originalUrls[0] || task.outputUrls[0];
    if (!dataUrl) throw new Error("任务已完成，但没有返回图片");
    return {
        id: nanoid(),
        name: `${reference.name || "image"}-no-background.png`,
        type: "image/png",
        dataUrl,
        storageKey: task.outputKeys[0],
    };
}

function imageTaskParams(config: AiConfig) {
    const size = String(config.size || "auto");
    const quality = config.quality === "standard" ? "medium" : config.quality === "hd" ? "high" : config.quality;
    return {
        ...(size.includes(":") ? { aspectRatio: size } : size !== "auto" ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(config.background === "transparent" ? { transparentBackground: true } : {}),
        ...(config.model ? { publicModelKey: modelOptionName(config.model) } : {}),
        _source: "react_canvas",
    };
}

async function waitForTask(id: string, signal?: AbortSignal) {
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
        if (signal?.aborted) throw abortError();
        const task = await starcloudsRequest<CanvasTask>(`/tasks/${encodeURIComponent(id)}`, { signal });
        if (task.status === "succeeded") return task;
        if (task.status === "failed" || task.status === "canceled") throw new Error(task.errorMessage || (task.status === "canceled" ? "任务已取消" : "图片生成失败"));
        if (Date.now() >= deadline) throw new Error("图片仍在后台生成，请稍后重试");
        await wait(1500, signal);
    }
}

export async function requestCanvasImages(config: AiConfig, prompt: string, references: ReferenceImage[] = [], mask?: ReferenceImage, signal?: AbortSignal) {
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
    const task = await waitForTask(created.id, signal);
    const urls = task.originalUrls.length ? task.originalUrls : task.outputUrls;
    if (!urls.length) throw new Error("任务已完成，但没有返回图片");
    return urls.map((dataUrl, index) => ({ id: nanoid(), dataUrl, storageKey: task.outputKeys[index] }));
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

export async function requestCanvasAssistant(messages: Array<{ role: string; content: unknown }>, onDelta: (text: string) => void, signal?: AbortSignal, model = "") {
    const prompt = flattenMessages(messages).slice(-12_000);
    const conversation = await starcloudsJson<{ id: string }>("/assistant/conversations", "POST", { title: prompt.slice(0, 42) || "画布助手" });
    const created = await starcloudsJson<CanvasAssistantResponse>("/assistant/runs", "POST", {
        conversationId: conversation.id,
        prompt,
        mode: "chat",
        ...(model ? { model: modelOptionName(model) } : {}),
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
        if (current.run.status === "failed" || current.run.status === "canceled") throw new Error(current.run.errorMessage || "助手任务失败");
        if (Date.now() >= deadline) throw new Error("助手仍在后台处理，请稍后重试");
        await wait(700, signal);
    }
}
