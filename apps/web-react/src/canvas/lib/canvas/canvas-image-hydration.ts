import type { CanvasNodeData, CanvasNodeImage, CanvasNodeMetadata } from "../../types/canvas.ts";

export function isUsableCanvasImageSource(value = "") {
    const source = value.trim();
    return /^(?:data:image\/|blob:|image:|https?:\/\/|\/|uploads\/|tasks\/)/i.test(source);
}

export function isUsableCanvasImageStorageKey(value = "") {
    const key = value.trim();
    return key.startsWith("image:") || key.startsWith("uploads/") || key.startsWith("tasks/") || key.startsWith("canvas-template-assets/");
}

export function normalizeHydratedCanvasImageMetadata(metadata: CanvasNodeMetadata = {}): CanvasNodeMetadata {
    const images = (metadata.images || []).filter(hasUsableImage);
    const hasContent = isUsableCanvasImageSource(metadata.content) || isUsableCanvasImageStorageKey(metadata.storageKey);
    if (hasContent) return images.length === (metadata.images || []).length ? metadata : { ...metadata, images };

    const {
        content: _content,
        storageKey: _storageKey,
        thumbnailUrl: _thumbnailUrl,
        thumbnailKey: _thumbnailKey,
        naturalWidth: _naturalWidth,
        naturalHeight: _naturalHeight,
        bytes: _bytes,
        mimeType: _mimeType,
        status,
        primaryImageId,
        ...rest
    } = metadata;
    if (images.length) {
        return {
            ...rest,
            ...(status ? { status } : {}),
            ...(images.some((image) => image.id === primaryImageId) ? { primaryImageId } : {}),
            images,
        };
    }
    return {
        ...rest,
        ...(status && status !== "success" ? { status } : {}),
        ...(metadata.images ? { images } : {}),
    };
}

export function repairMisappliedCanvasWorkflowOutputs(nodes: CanvasNodeData[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const repairs = new Map<string, CanvasNodeData>();
    for (const producer of nodes) {
        if (producer.type !== "config" || !producer.metadata?.content) continue;
        const mode = producer.metadata.generationMode || "image";
        const outputType = mode === "text" ? "text" : mode === "image" ? "image" : mode;
        const output = (producer.metadata.workflowOutputNodeIds || []).map((id) => nodeById.get(id)).find((node) => node?.type === outputType);
        if (!output || output.metadata?.content || output.metadata?.storageKey) continue;
        if (mode === "image" && !isUsableCanvasImageSource(producer.metadata.content) && !isUsableCanvasImageStorageKey(producer.metadata.storageKey)) continue;

        const {
            content,
            storageKey,
            thumbnailUrl,
            thumbnailKey,
            naturalWidth,
            naturalHeight,
            bytes,
            mimeType,
            images,
            primaryImageId,
            taskId: _taskId,
            taskKind: _taskKind,
            ...producerMetadata
        } = producer.metadata;
        repairs.set(producer.id, {
            ...producer,
            metadata: { ...producerMetadata, status: "success", errorDetails: undefined, executionStatus: "succeeded" },
        });
        repairs.set(output.id, {
            ...output,
            metadata: {
                ...output.metadata,
                content,
                ...(storageKey ? { storageKey } : {}),
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                ...(thumbnailKey ? { thumbnailKey } : {}),
                ...(naturalWidth ? { naturalWidth } : {}),
                ...(naturalHeight ? { naturalHeight } : {}),
                ...(bytes ? { bytes } : {}),
                ...(mimeType ? { mimeType } : {}),
                ...(images?.length ? { images } : {}),
                ...(primaryImageId ? { primaryImageId } : {}),
                status: "success",
                errorDetails: undefined,
                taskId: undefined,
                taskKind: undefined,
            },
        });
    }
    return repairs.size ? nodes.map((node) => repairs.get(node.id) || node) : nodes;
}

function hasUsableImage(image: CanvasNodeImage) {
    return Boolean(image.deletedByHistory) || Boolean(image.taskId && image.status === "loading") || isUsableCanvasImageSource(image.content) || isUsableCanvasImageStorageKey(image.storageKey);
}

// Retrying a failed generation config used to go through the output-node path, which wrote the generated image into
// the config itself and turned it into an image node. Such nodes keep their config id prefix and settings; put them
// back as configs and drop the image written into them.
const RETYPED_CONFIG_IMAGE_KEYS = ["content", "storageKey", "thumbnailUrl", "thumbnailKey", "images", "primaryImageId", "naturalWidth", "naturalHeight", "bytes", "mimeType", "loadedImageAspect", "taskId", "taskKind", "generationType", "cancelPolicy"] as const;

export function repairRetypedConfigNodes(nodes: CanvasNodeData[]) {
    let changed = false;
    const next = nodes.map((node) => {
        const metadata = node.metadata;
        if (node.type !== "image" || !node.id.startsWith("config-") || !metadata?.generationMode || metadata.composerContent === undefined) return node;
        changed = true;
        const restored: CanvasNodeMetadata = { ...metadata };
        RETYPED_CONFIG_IMAGE_KEYS.forEach((key) => delete restored[key]);
        return { ...node, type: "config", width: 360, height: 414, metadata: restored };
    });
    return changed ? next : nodes;
}
