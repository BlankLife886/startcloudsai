import { requestCanvasAssistant, requestCanvasImages } from "@/services/canvas-task-api";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type RequestOptions = {
    signal?: AbortSignal;
    onCreated?: (taskId: string) => void | Promise<void>;
    onResolved?: (images: Array<{ id: string; dataUrl: string; storageKey?: string }>) => void | Promise<void>;
};

export function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    return requestCanvasImages(config, prompt, [], undefined, options);
}

export function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    return requestCanvasImages(config, prompt, references, mask, options);
}

export function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    return requestCanvasAssistant(messages, onDelta, { signal: options?.signal, onCreated: options?.onCreated }, config.model || config.textModel);
}
