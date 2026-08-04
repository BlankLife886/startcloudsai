import { requestCanvasAssistant, requestCanvasImages } from "@/services/canvas-task-api";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type RequestOptions = { signal?: AbortSignal };

export function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    return requestCanvasImages(config, prompt, [], undefined, options?.signal);
}

export function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    return requestCanvasImages(config, prompt, references, mask, options?.signal);
}

export function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    return requestCanvasAssistant(messages, onDelta, options?.signal, config.model || config.textModel);
}
