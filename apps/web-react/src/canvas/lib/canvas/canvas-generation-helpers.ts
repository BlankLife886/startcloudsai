import { applyCanvasImageModelSettings, CANVAS_IMAGE_MAX_COUNT } from "@/lib/canvas/canvas-image-model";
import { defaultConfig, modelOptionMeta, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import { resultNodeSize } from "@/lib/canvas/canvas-node-size";
import { canonicalImageSrc, cloudFileUrl, cloudThumbnailUrl } from "@/lib/canvas/canvas-preview-url";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

function displayMediaSrc(storageKey?: string, content = "") {
    if (storageKey?.startsWith("uploads/") || storageKey?.startsWith("tasks/")) return cloudFileUrl(storageKey);
    if (content.startsWith("blob:")) return storageKey || "";
    return content;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            const images = node.metadata?.images || [];
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && (node.metadata?.storageKey || content)) {
                return { ...node, metadata: { ...node.metadata, content: displayMediaSrc(node.metadata?.storageKey, content) } };
            }
            if (node.type !== CanvasNodeType.Image) return node;
            const hydratedImages = await Promise.all(
                images.map(async (image) => {
                    if (image.content?.startsWith("data:image/")) {
                        const uploaded = await uploadImage(image.content);
                        return { ...image, content: uploaded.url, storageKey: uploaded.storageKey, thumbnailUrl: uploaded.thumbnailUrl, thumbnailKey: uploaded.thumbnailKey };
                    }
                    const nextContent = canonicalImageSrc({ src: image.content, storageKey: image.storageKey });
                    return { ...image, content: nextContent, thumbnailUrl: image.thumbnailUrl || cloudThumbnailUrl(image.storageKey || nextContent) || undefined };
                }),
            );
            if (content?.startsWith("data:image/")) return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)), images: hydratedImages } };
            const nextContent = canonicalImageSrc({ src: content, storageKey: node.metadata?.storageKey });
            if (!nextContent && !hydratedImages.length) return node;
            return { ...node, metadata: { ...node.metadata, content: nextContent, thumbnailUrl: node.metadata?.thumbnailUrl || cloudThumbnailUrl(node.metadata?.storageKey || nextContent) || undefined, images: hydratedImages } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        if (item.dataUrl?.startsWith("blob:")) return { ...item, dataUrl: canonicalImageSrc({ src: item.dataUrl, storageKey: item.storageKey }) };
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(CANVAS_IMAGE_MAX_COUNT, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const next = {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        resolution: node?.metadata?.resolution || config.resolution || defaultConfig.resolution,
        background: node?.metadata?.background ?? "",
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
    return mode === "image" ? applyCanvasImageModelSettings(next, modelOptionMeta(next, next.model)) : next;
}

export type PendingCanvasTask = {
    nodeId: string;
    taskId: string;
    imageId?: string;
    kind: "image" | "assistant";
};

function hasResumableTask(node: CanvasNodeData) {
    return Boolean(node.metadata?.taskId) || Boolean(node.metadata?.images?.some((image) => image.status === "loading" && image.taskId));
}

export function pendingCanvasTasks(nodes: CanvasNodeData[]): PendingCanvasTask[] {
    const targets: PendingCanvasTask[] = [];
    for (const node of nodes) {
        for (const image of node.metadata?.images || []) {
            if (image.status === "loading" && image.taskId) {
                targets.push({ nodeId: node.id, imageId: image.id, taskId: image.taskId, kind: "image" });
            }
        }
        if (node.metadata?.status === "loading" && node.metadata.taskId && !targets.some((target) => target.nodeId === node.id && target.taskId === node.metadata?.taskId)) {
            targets.push({ nodeId: node.id, taskId: node.metadata.taskId, kind: node.metadata.taskKind || "image" });
        }
    }
    return targets;
}

export function attachCanvasTaskId(node: CanvasNodeData, taskId: string, imageId?: string, taskKind: "image" | "assistant" = "image"): CanvasNodeData {
    const images = node.metadata?.images?.map((image) => (image.id === imageId ? { ...image, taskId } : image));
    const matchedImage = Boolean(imageId && images?.some((image) => image.id === imageId));
    return {
        ...node,
        metadata: {
            ...node.metadata,
            ...(matchedImage ? {} : { taskId, taskKind }),
            images,
        },
    };
}

export function applyUploadedImageToNode(node: CanvasNodeData, uploaded: UploadedImage, imageId?: string): CanvasNodeData {
    if (imageId && node.metadata?.images?.some((image) => image.id === imageId)) {
        const item: CanvasNodeImage = {
            id: imageId,
            status: "success",
            content: uploaded.url,
            storageKey: uploaded.storageKey,
            thumbnailUrl: uploaded.thumbnailUrl,
            thumbnailKey: uploaded.thumbnailKey,
            naturalWidth: uploaded.width,
            naturalHeight: uploaded.height,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType,
        };
        const images = node.metadata.images.map((image) => (image.id === imageId ? item : image));
        const stillLoading = images.some((image) => image.status === "loading");
        const hasSuccess = images.some((image) => image.status === "success");
        if (node.metadata.primaryImageId && node.metadata.primaryImageId !== imageId) {
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    images,
                    status: stillLoading ? "loading" : hasSuccess ? "success" : "error",
                    errorDetails: stillLoading || hasSuccess ? undefined : node.metadata.errorDetails,
                    taskId: stillLoading ? node.metadata.taskId : undefined,
                    taskKind: stillLoading ? node.metadata.taskKind : undefined,
                },
            };
        }
        const imageSize = resultNodeSize(node, uploaded.width, uploaded.height);
        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
        return {
            ...node,
            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
            ...imageSize,
            metadata: {
                ...node.metadata,
                ...imageMetadata(uploaded),
                images,
                primaryImageId: imageId,
                status: stillLoading ? "loading" : hasSuccess ? "success" : "error",
                errorDetails: stillLoading || hasSuccess ? undefined : node.metadata.errorDetails,
                taskId: stillLoading ? node.metadata.taskId : undefined,
                taskKind: stillLoading ? node.metadata.taskKind : undefined,
            },
        };
    }
    return {
        ...node,
        metadata: {
            ...node.metadata,
            ...imageMetadata(uploaded),
            taskId: undefined,
            taskKind: undefined,
            errorDetails: undefined,
        },
    };
}

export function applyFailedCanvasTaskToNode(node: CanvasNodeData, errorDetails: string, imageId?: string): CanvasNodeData {
    if (imageId && node.metadata?.images?.some((image) => image.id === imageId)) {
        const images = node.metadata.images.map((image) => (image.id === imageId ? { ...image, status: "error" as const, errorDetails, taskId: undefined } : image));
        const stillLoading = images.some((image) => image.status === "loading");
        const hasSuccess = images.some((image) => image.status === "success") || Boolean(node.metadata.content);
        return {
            ...node,
            metadata: {
                ...node.metadata,
                images,
                status: stillLoading ? "loading" : hasSuccess ? "success" : "error",
                errorDetails: stillLoading || hasSuccess ? undefined : errorDetails,
                taskId: stillLoading ? node.metadata.taskId : undefined,
                taskKind: stillLoading ? node.metadata.taskKind : undefined,
            },
        };
    }
    return {
        ...node,
        metadata: {
            ...node.metadata,
            status: "error",
            errorDetails,
            taskId: undefined,
            taskKind: undefined,
        },
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    const interrupted = i18n.t("canvas.generation.interrupted");
    return nodes.map((node) => {
        const images = node.metadata?.images?.map((image) => (image.status === "loading" && !image.taskId ? { ...image, status: "error" as const, errorDetails: interrupted } : image));
        if (hasResumableTask(node)) {
            return images ? { ...node, metadata: { ...node.metadata, images } } : node;
        }
        if (node.metadata?.status !== "loading") {
            return images ? { ...node, metadata: { ...node.metadata, images } } : node;
        }
        const hasSuccess = Boolean(node.metadata.content) || Boolean(images?.some((image) => image.status === "success"));
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: hasSuccess ? ("success" as const) : ("error" as const),
                errorDetails: hasSuccess ? undefined : interrupted,
                images,
            },
        };
    });
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
