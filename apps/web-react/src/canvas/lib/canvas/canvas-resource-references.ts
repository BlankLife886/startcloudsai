import { cloudThumbnailUrl } from "@/lib/canvas/canvas-preview-url";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { createCanvasResourceIndex, type CanvasResourceIndex } from "./canvas-resource-index";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], index = createCanvasResourceIndex(nodes, connections)) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections, index), true);
}

/** Reuse unchanged references so editing one resource does not invalidate every node. */
export function buildCanvasNodeMentionReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], index: CanvasResourceIndex, previous = new Map<string, CanvasResourceReference[]>()) {
    let changed = previous.size !== nodes.length;
    const next = new Map<string, CanvasResourceReference[]>();
    for (const node of nodes) {
        const references = buildNodeMentionReferences(node, nodes, connections, index);
        const existing = previous.get(node.id);
        const equal = existing && existing.length === references.length && references.every((reference, i) => {
            const old = existing[i];
            return reference.id === old.id && reference.kind === old.kind && reference.label === old.label && reference.title === old.title && reference.previewUrl === old.previewUrl && reference.text === old.text && reference.active === old.active;
        });
        next.set(node.id, equal ? existing : references);
        if (!equal) changed = true;
    }
    return changed ? next : previous;
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
    return labelResourceNodes(nodes, true);
}

export async function resolveCanvasReferenceImages(references: CanvasResourceReference[], nodes: CanvasNodeData[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return Promise.all(references.filter((reference) => reference.kind === "image").map(async (reference) => {
        const node = nodesById.get(reference.nodeId);
        if (!node) throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: reference.title }));
        const metadata = node.metadata;
        const dataUrl = await imageToDataUrl({ storageKey: metadata?.storageKey, url: metadata?.content });
        if (!dataUrl.startsWith("data:image/")) throw new Error(i18n.t("agent.composer.mentions.imageReadFailed", { title: reference.title }));
        const meta = metadata?.naturalWidth && metadata.naturalHeight
            ? { width: metadata.naturalWidth, height: metadata.naturalHeight, mimeType: metadata.mimeType || dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" }
            : await readImageMeta(dataUrl);
        return {
            id: `canvas:${node.id}`,
            name: reference.title,
            type: metadata?.mimeType || meta.mimeType,
            size: metadata?.bytes || getDataUrlByteSize(dataUrl),
            width: meta.width,
            height: meta.height,
            url: reference.previewUrl || dataUrl,
            dataUrl,
        };
    }));
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index = createCanvasResourceIndex(nodes, connections)) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, index);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, index);
    if (ownInputs.length) return ownInputs;
    const node = index.nodesById.get(nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], index = createCanvasResourceIndex(nodes, connections)) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, index);
    const roots = configInputs.length ? configInputs : getContextResourceNodes(nodeId, index);
    return expandUpstreamResourceNodes(roots, index);
}

function expandUpstreamResourceNodes(roots: CanvasNodeData[], index: CanvasResourceIndex) {
    const seen = new Set<string>();
    const out: CanvasNodeData[] = [];
    const visit = (node: CanvasNodeData) => {
        if (seen.has(node.id)) return;
        seen.add(node.id);
        if (isResourceNode(node)) out.push(node);
        if (node.type !== CanvasNodeType.Text && node.type !== CanvasNodeType.Config) return;
        getContextResourceNodes(node.id, index).forEach(visit);
    };
    roots.forEach(visit);
    return out;
}

function getContextResourceNodes(nodeId: string, index: CanvasResourceIndex) {
    return (index.incoming.get(nodeId) || []).filter(isResourceNode);
}

function getConnectedConfigResourceNodes(nodeId: string, index: CanvasResourceIndex) {
    const config = index.outgoing.get(nodeId)?.find((node) => node.type === CanvasNodeType.Config);
    if (!config) return [];
    return getContextResourceNodes(config.id, index).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.thumbnailUrl || cloudThumbnailUrl(node.metadata?.storageKey || "") || cloudThumbnailUrl(node.metadata?.content || "") || undefined,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // Plugin nodes declare their input eligibility through definition.resource.
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
