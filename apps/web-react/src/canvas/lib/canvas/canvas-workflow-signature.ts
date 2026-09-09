import type { CanvasConnection, CanvasNodeData } from "../../types/canvas.ts";

const SETTING_KEYS = ["composerContent", "prompt", "generationMode", "generationType", "model", "reasoningEffort", "size", "sizeMode", "exactWidth", "exactHeight", "resolution", "quality", "background", "count", "seconds", "videoSeconds", "vquality", "generateAudio", "videoGenerateAudio", "watermark", "videoWatermark", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "references", "localImageOperation", "localImageOperationParams", "imageAngleParams"];

function settings(value: unknown) {
    const record = (value || {}) as Record<string, unknown>;
    return Object.fromEntries(SETTING_KEYS.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
}

function digest(text: string) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
        left = Math.imul(left ^ text.charCodeAt(index), 0x01000193);
        right = Math.imul(right ^ text.charCodeAt(index), 0x5bd1e995);
    }
    return `v1:${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

export function canvasWorkflowValueFingerprint(value: unknown) {
    return digest(canonical(value));
}

/** Sign submitted inputs, not output pixels or execution/UI metadata. */
export function canvasWorkflowInputSignature(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeIds: string[], resolveSettings?: (node: CanvasNodeData) => unknown) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const executable = new Set(nodeIds);
    const incoming = new Map<string, string[]>();
    for (const connection of connections) {
        const list = incoming.get(connection.toNodeId) || [];
        list.push(connection.fromNodeId);
        incoming.set(connection.toNodeId, list);
    }
    const inputIds = (node: CanvasNodeData) => {
        const content = node.metadata?.composerContent ?? node.metadata?.prompt ?? node.metadata?.content ?? "";
        const mentions = [...content.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]);
        return [...new Set([...(incoming.get(node.id) || []), ...mentions])];
    };
    const resource = (id: string, visited: Set<string>): unknown => {
        const node = nodeById.get(id);
        if (!node || visited.has(id)) return { id, missing: !node };
        if (executable.has(id)) return { producer: id };
        const metadata = node.metadata || {};
        const producers = (incoming.get(id) || []).filter((source) => executable.has(source));
        if (producers.length) return { id, type: node.type, producers };
        const seen = new Set(visited).add(id);
        return {
            id, type: node.type,
            content: metadata.storageKey || metadata.content || "",
            composerContent: metadata.composerContent,
            primaryImageId: metadata.primaryImageId,
            images: metadata.images?.map((image) => ({ id: image.id, source: image.storageKey || image.content })),
            inputs: inputIds(node).map((source) => resource(source, seen)),
        };
    };
    return digest(canonical(nodeIds.map((id) => {
        const node = nodeById.get(id)!;
        const configured = settings(node.metadata);
        const resolved = resolveSettings ? settings(resolveSettings(node)) : undefined;
        if (node.metadata?.localImageOperation) {
            // Local operation output count is derived from its parameters and
            // written back during execution; it is not a user input setting.
            delete configured.count;
            if (resolved) delete resolved.count;
        }
        return { id, type: node.type, settings: configured, resolved, inputs: inputIds(node).map((source) => resource(source, new Set([id]))) };
    })));
}
