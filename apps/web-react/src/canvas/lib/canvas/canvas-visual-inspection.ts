import { buildCanvasSidePanelWorkflowGroups } from "./canvas-workflow-groups.ts";
import { cloudDisplayKey, cloudFileUrl, cloudThumbnailKey, cloudThumbnailUrl, isLocalImageKey, storageKeyFromUrl } from "./canvas-preview-url.ts";
import type { CanvasAgentSnapshot } from "./canvas-agent-ops.ts";
import type { CanvasNodeData } from "../../types/canvas.ts";

const MAX_VISUAL_ITEMS = 12;
const MAX_MODEL_IMAGES = 4;
const FINGERPRINT_CONCURRENCY = 2;
const PERCEPTUAL_DUPLICATE_DISTANCE = 6;
const MAX_SIMILAR_PAIRS = 64;
const FINGERPRINT_CACHE_LIMIT = 128;
const FINGERPRINT_CACHE_TTL_MS = 2 * 60 * 1000;

const visualFingerprintCache = new Map<string, { createdAt: number; value: Promise<CanvasVisualFingerprint> }>();

export type CanvasVisualInspectionInput = {
    scope?: "auto" | "selection" | "workflow" | "recent";
    workflowId?: string;
    nodeIds?: string[];
    maxImages?: number;
    offset?: number;
};

export type CanvasVisualFingerprint = {
    exact?: string;
    perceptual?: string;
};

type CanvasVisualResource = {
    resourceId: string;
    nodeId: string;
    imageId: string;
    title: string;
    producerNodeId?: string;
    source: string;
    storageKey: string;
    thumbnailUrl: string;
    width: number;
    height: number;
    completedAt: string;
};

type FingerprintedVisualResource = CanvasVisualResource & CanvasVisualFingerprint;

export type CanvasVisualDuplicateGroup = {
    resourceIds: string[];
    nodeIds: string[];
    exact: true;
};

export type CanvasVisualSimilarPair = {
    leftResourceId: string;
    rightResourceId: string;
    leftNodeId: string;
    rightNodeId: string;
    similarity: number;
};

export function analyzeCanvasVisualFingerprints(items: Array<Pick<FingerprintedVisualResource, "resourceId" | "nodeId" | "exact" | "perceptual">>) {
    const exactBuckets = new Map<string, typeof items>();
    items.forEach((item) => {
        if (!item.exact) return;
        exactBuckets.set(item.exact, [...(exactBuckets.get(item.exact) || []), item]);
    });
    const exactDuplicateGroups: CanvasVisualDuplicateGroup[] = [...exactBuckets.values()]
        .filter((group) => group.length > 1)
        .map((group) => ({
            resourceIds: group.map((item) => item.resourceId),
            nodeIds: [...new Set(group.map((item) => item.nodeId))],
            exact: true,
        }));
    const exactPairs = new Set(exactDuplicateGroups.flatMap((group) => pairKeys(group.resourceIds)));
    const similarPairs: CanvasVisualSimilarPair[] = [];
    let similarPairsTruncated = false;
    similarScan:
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
        const left = items[leftIndex];
        if (!left.perceptual) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
            const right = items[rightIndex];
            if (!right.perceptual || exactPairs.has(pairKey(left.resourceId, right.resourceId))) continue;
            const distance = hammingHex(left.perceptual, right.perceptual);
            if (distance > PERCEPTUAL_DUPLICATE_DISTANCE) continue;
            if (similarPairs.length >= MAX_SIMILAR_PAIRS) {
                similarPairsTruncated = true;
                break similarScan;
            }
            similarPairs.push({
                leftResourceId: left.resourceId,
                rightResourceId: right.resourceId,
                leftNodeId: left.nodeId,
                rightNodeId: right.nodeId,
                similarity: Number((1 - distance / 64).toFixed(3)),
            });
        }
    }
    return { exactDuplicateGroups, similarPairs, similarPairsTruncated };
}

export async function inspectCanvasVisuals(snapshot: CanvasAgentSnapshot, input: CanvasVisualInspectionInput = {}) {
    const limit = Math.max(1, Math.min(MAX_VISUAL_ITEMS, Math.floor(Number(input.maxImages)) || MAX_VISUAL_ITEMS));
    const offset = Math.max(0, Math.floor(Number(input.offset)) || 0);
    const selectedNodeIds = uniqueStrings(input.nodeIds?.length ? input.nodeIds : snapshot.selectedNodeIds);
    const { nodeIds, resolvedFrom } = resolveVisualNodeScope(snapshot, { ...input, nodeIds: selectedNodeIds });
    const candidates = nodeIds
        .flatMap((nodeId) => visualResourcesForNode(snapshot.nodes.find((node) => node.id === nodeId)))
        .sort(compareVisualResources);
    if (!candidates.length) throw new Error("没有找到可检查的图片；请选中图片、图片上游节点或指定工作流");
    if (offset >= candidates.length) throw new Error(`图片检查起点 ${offset} 超出范围，当前只有 ${candidates.length} 张图片`);
    const resources = candidates.slice(offset, offset + limit);
    const fingerprinted = await mapLimit(resources, FINGERPRINT_CONCURRENCY, async (resource) => ({
        ...resource,
        ...(await cachedVisualFingerprint(resource)),
    }));
    const comparedItems = (await Promise.all(candidates.map(async (resource) => {
        const fingerprint = existingVisualFingerprint(resource);
        return fingerprint ? { ...resource, ...(await fingerprint) } : null;
    }))).filter((item): item is FingerprintedVisualResource => Boolean(item));
    const comparison = analyzeCanvasVisualFingerprints(comparedItems);
    const visionReferences = (await mapLimit(
        prioritizeModelVisuals(comparedItems, comparison).slice(0, MAX_MODEL_IMAGES),
        FINGERPRINT_CONCURRENCY,
        modelVisualReference,
    )).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const nextOffset = offset + fingerprinted.length < candidates.length ? offset + fingerprinted.length : undefined;
    return {
        scope: input.scope || "auto",
        resolvedFrom,
        selectedNodeIds,
        offset,
        total: candidates.length,
        inspected: fingerprinted.length,
        compared: comparedItems.length,
        truncated: nextOffset !== undefined,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        items: fingerprinted.map((item) => ({
            resourceId: item.resourceId,
            nodeId: item.nodeId,
            imageId: item.imageId,
            title: item.title,
            ...(item.producerNodeId ? { producerNodeId: item.producerNodeId } : {}),
            width: item.width,
            height: item.height,
            hasCloudImage: Boolean(cloudReferenceKey(item.storageKey)),
        })),
        ...comparison,
        visionReferences,
    };
}

async function modelVisualReference(item: FingerprintedVisualResource) {
    const cloudKey = cloudReferenceKey(item.storageKey);
    if (cloudKey) {
        return { nodeId: item.nodeId, imageId: item.imageId, resourceId: item.resourceId, title: item.title, fileKey: cloudKey };
    }
    try {
        const blob = await visualResourceBlob(item);
        if (!blob) return null;
        const { uploadCloudFile } = await import("../../services/starclouds-api.ts");
        const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
        const uploaded = await uploadCloudFile(blob, `canvas-agent-vision-${crypto.randomUUID()}.${extension}`);
        const fileKey = cloudReferenceKey(uploaded.key);
        if (!fileKey) return null;
        return {
            nodeId: item.nodeId,
            imageId: item.imageId,
            resourceId: item.resourceId,
            title: item.title,
            fileKey,
            temporaryKeys: [uploaded.key, uploaded.thumbnailKey, cloudThumbnailKey(uploaded.key), cloudDisplayKey(uploaded.key)].filter((key): key is string => Boolean(key)),
        };
    } catch {
        return null;
    }
}

async function cachedVisualFingerprint(resource: CanvasVisualResource) {
    const identity = resource.storageKey || resource.source;
    if (!identity) return {};
    pruneVisualFingerprintCache();
    let cached = visualFingerprintCache.get(identity);
    if (!cached) {
        cached = { createdAt: Date.now(), value: fingerprintVisualResource(resource).catch(() => identityFingerprint(resource)) };
        visualFingerprintCache.set(identity, cached);
    }
    return cached.value;
}

function existingVisualFingerprint(resource: CanvasVisualResource) {
    const identity = resource.storageKey || resource.source;
    if (!identity) return null;
    const cached = visualFingerprintCache.get(identity);
    if (!cached || Date.now() - cached.createdAt > FINGERPRINT_CACHE_TTL_MS) {
        if (cached) visualFingerprintCache.delete(identity);
        return null;
    }
    return cached.value;
}

function pruneVisualFingerprintCache() {
    const now = Date.now();
    visualFingerprintCache.forEach((cached, key) => {
        if (now - cached.createdAt > FINGERPRINT_CACHE_TTL_MS) visualFingerprintCache.delete(key);
    });
    while (visualFingerprintCache.size >= FINGERPRINT_CACHE_LIMIT) {
        const oldest = visualFingerprintCache.keys().next().value;
        if (!oldest) break;
        visualFingerprintCache.delete(oldest);
    }
}

function prioritizeModelVisuals(
    items: FingerprintedVisualResource[],
    comparison: ReturnType<typeof analyzeCanvasVisualFingerprints>,
) {
    const byResourceId = new Map(items.map((item) => [item.resourceId, item]));
    const orderedIds = [
        ...comparison.similarPairs.flatMap((pair) => [pair.leftResourceId, pair.rightResourceId]),
        ...comparison.exactDuplicateGroups.map((group) => group.resourceIds[0]),
        ...items.map((item) => item.resourceId),
    ];
    const seenResources = new Set<string>();
    const seenExact = new Set<string>();
    const selected: FingerprintedVisualResource[] = [];
    orderedIds.forEach((resourceId) => {
        const item = byResourceId.get(resourceId);
        if (!item || seenResources.has(resourceId)) return;
        seenResources.add(resourceId);
        if (item.exact && seenExact.has(item.exact)) return;
        if (item.exact) seenExact.add(item.exact);
        selected.push(item);
    });
    return selected;
}

function resolveVisualNodeScope(snapshot: CanvasAgentSnapshot, input: CanvasVisualInspectionInput & { nodeIds: string[] }) {
    const scope = input.scope || "auto";
    if (scope === "workflow") {
        const groups = buildCanvasSidePanelWorkflowGroups(snapshot.nodes, snapshot.connections).filter((group) => group.firstConfig);
        const group = input.workflowId ? groups.find((item) => item.id === input.workflowId) : groups.length === 1 ? groups[0] : null;
        if (!group) throw new Error(input.workflowId ? `没有找到工作流 ${input.workflowId}` : `当前有 ${groups.length} 个工作流，请指定 workflowId`);
        return { nodeIds: group.nodes.map((node) => node.id), resolvedFrom: "workflow" };
    }
    if (scope === "recent") {
        return { nodeIds: recentVisualNodeIds(snapshot.nodes), resolvedFrom: "recent_outputs" };
    }
    if (scope === "selection") {
        if (!input.nodeIds.length) throw new Error("当前没有选中节点");
        return { nodeIds: input.nodeIds, resolvedFrom: "selection" };
    }
    if (input.nodeIds.length) {
        return { nodeIds: downstreamNodeIds(input.nodeIds, snapshot.connections), resolvedFrom: "selection_downstream" };
    }
    return { nodeIds: recentVisualNodeIds(snapshot.nodes), resolvedFrom: "recent_outputs" };
}

function recentVisualNodeIds(nodes: CanvasNodeData[]) {
    const outputNodes = nodes.filter((node) => node.type === "image" && visualResourcesForNode(node).length && node.metadata?.workflowProducerNodeId);
    const candidates = outputNodes.length ? outputNodes : nodes.filter((node) => node.type === "image" && visualResourcesForNode(node).length);
    return [...candidates]
        .sort((left, right) => String(right.metadata?.generationCompletedAt || "").localeCompare(String(left.metadata?.generationCompletedAt || "")))
        .map((node) => node.id);
}

function downstreamNodeIds(seedIds: string[], connections: CanvasAgentSnapshot["connections"]) {
    const ordered = [...seedIds];
    const visited = new Set(ordered);
    for (let index = 0; index < ordered.length; index += 1) {
        const current = ordered[index];
        connections.forEach((connection) => {
            if (connection.fromNodeId !== current || visited.has(connection.toNodeId)) return;
            visited.add(connection.toNodeId);
            ordered.push(connection.toNodeId);
        });
    }
    return ordered;
}

function visualResourcesForNode(node: CanvasNodeData | undefined): CanvasVisualResource[] {
    if (!node || node.type !== "image") return [];
    const images = (node.metadata?.images || []).filter((image) => image.content || image.storageKey);
    if (images.length) {
        return images.map((image, index) => visualResource({
            node,
            imageId: image.id || `image-${index + 1}`,
            source: image.content,
            storageKey: image.storageKey,
            thumbnailUrl: image.thumbnailUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
        }));
    }
    if (!node.metadata?.content && !node.metadata?.storageKey) return [];
    return [visualResource({
        node,
        imageId: node.metadata?.primaryImageId || "primary",
        source: node.metadata?.content,
        storageKey: node.metadata?.storageKey,
        thumbnailUrl: node.metadata?.thumbnailUrl,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
    })];
}

function visualResource(input: { node: CanvasNodeData; imageId: string; source?: string; storageKey?: string; thumbnailUrl?: string; width?: number; height?: number }): CanvasVisualResource {
    const storageKey = input.storageKey || storageKeyFromUrl(input.source || "");
    const source = input.source || cloudFileUrl(storageKey);
    return {
        resourceId: `${input.node.id}:${input.imageId}`,
        nodeId: input.node.id,
        imageId: input.imageId,
        title: input.node.title,
        ...(input.node.metadata?.workflowProducerNodeId ? { producerNodeId: input.node.metadata.workflowProducerNodeId } : {}),
        source,
        storageKey,
        thumbnailUrl: input.thumbnailUrl || cloudThumbnailUrl(storageKey) || source,
        width: Math.max(0, Number(input.width) || Number(input.node.metadata?.naturalWidth) || 0),
        height: Math.max(0, Number(input.height) || Number(input.node.metadata?.naturalHeight) || 0),
        completedAt: input.node.metadata?.generationCompletedAt || "",
    };
}

async function fingerprintVisualResource(resource: CanvasVisualResource): Promise<CanvasVisualFingerprint> {
    const blob = await visualResourceBlob(resource);
    if (!blob) return identityFingerprint(resource);
    const [exact, perceptual] = await Promise.all([sha256(blob), differenceHash(blob)]);
    return { exact, perceptual };
}

function identityFingerprint(resource: CanvasVisualResource): CanvasVisualFingerprint {
    const identity = resource.storageKey || resource.source;
    return identity ? { exact: `identity:${identity}` } : {};
}

async function visualResourceBlob(resource: CanvasVisualResource) {
    if (isLocalImageKey(resource.storageKey)) {
        const { getImageBlob } = await import("../../services/image-storage.ts");
        return getImageBlob(resource.storageKey);
    }
    const source = resource.thumbnailUrl || resource.source || cloudFileUrl(resource.storageKey);
    if (!source) return null;
    const response = await fetch(source, { credentials: source.startsWith("blob:") ? "omit" : "include" });
    if (!response.ok) return null;
    return response.blob();
}

async function sha256(blob: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function differenceHash(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        bitmap.close();
        return "";
    }
    context.drawImage(bitmap, 0, 0, 9, 8);
    bitmap.close();
    const pixels = context.getImageData(0, 0, 9, 8).data;
    let low = 0;
    let high = 0;
    let index = 0;
    for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
            const left = grayscale(pixels, (y * 9 + x) * 4);
            const right = grayscale(pixels, (y * 9 + x + 1) * 4);
            if (left > right) {
                if (index < 32) low = (low | (1 << index)) >>> 0;
                else high = (high | (1 << (index - 32))) >>> 0;
            }
            index += 1;
        }
    }
    canvas.width = 0;
    canvas.height = 0;
    return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

function grayscale(pixels: Uint8ClampedArray, index: number) {
    return pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
}

function compareVisualResources(left: CanvasVisualResource, right: CanvasVisualResource) {
    const time = right.completedAt.localeCompare(left.completedAt);
    return time || left.nodeId.localeCompare(right.nodeId) || left.imageId.localeCompare(right.imageId);
}

function hammingHex(left: string, right: string) {
    if (left.length !== right.length || !left) return Number.POSITIVE_INFINITY;
    let count = 0;
    for (let index = 0; index < left.length; index += 1) {
        let bits = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
        while (bits) {
            count += bits & 1;
            bits >>>= 1;
        }
    }
    return count;
}

function pairKeys(values: string[]) {
    const keys: string[] = [];
    for (let left = 0; left < values.length; left += 1) {
        for (let right = left + 1; right < values.length; right += 1) keys.push(pairKey(values[left], values[right]));
    }
    return keys;
}

function pairKey(left: string, right: string) {
    return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

function cloudReferenceKey(value: string) {
    const key = storageKeyFromUrl(value) || value;
    return key.startsWith("uploads/") || key.startsWith("tasks/") || key.startsWith("canvas-template-assets/") ? key : "";
}

function uniqueStrings(values: string[] | undefined) {
    return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

async function mapLimit<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await task(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
