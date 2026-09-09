import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

function remapNodeReferences(value: string | undefined, idMap: Map<string, string>) {
    if (!value) return value;
    return value.replace(/@\[node:([^\]]+)\]/g, (token, nodeId: string) => {
        const mappedId = idMap.get(nodeId);
        return mappedId ? `@[node:${mappedId}]` : token;
    });
}

function copyBaseTitle(value: string) {
    return value.replace(/(?: Copy)+$/g, "").trim();
}

/** Repair references left behind by canvas copies created before ID remapping was supported. */
export function resolveCopiedCanvasNodeReferences(nodeId: string, value: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const incomingIds = new Set(connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId));
    if (!incomingIds.size || !value.includes("@[node:")) return value;
    const incomingNodes = nodes.filter((node) => incomingIds.has(node.id));
    return value.replace(/@\[node:([^\]]+)\]/g, (token, referenceId: string) => {
        if (incomingIds.has(referenceId)) return token;
        const reference = nodes.find((node) => node.id === referenceId);
        if (!reference) return token;
        const candidates = incomingNodes.filter((node) => node.type === reference.type && copyBaseTitle(node.title) === copyBaseTitle(reference.title));
        return candidates.length === 1 ? `@[node:${candidates[0].id}]` : token;
    });
}

/** Remove runtime ownership from a copied node and remap relationships copied with it. */
export function copyCanvasNodeMetadata(metadata: CanvasNodeMetadata | undefined, idMap: Map<string, string>): CanvasNodeMetadata | undefined {
    if (!metadata) return undefined;
    const {
        taskId: _taskId,
        taskKind: _taskKind,
        executionStatus: _executionStatus,
        generationQueuedAt: _generationQueuedAt,
        generationStartedAt: _generationStartedAt,
        generationCompletedAt: _generationCompletedAt,
        generationDurationMs: _generationDurationMs,
        workflowOutputNodeIds,
        workflowProducerNodeId,
        ...copy
    } = metadata;
    const remappedOutputIds = workflowOutputNodeIds?.flatMap((nodeId) => {
        const mappedId = idMap.get(nodeId);
        return mappedId ? [mappedId] : [];
    });
    const remappedProducerId = workflowProducerNodeId ? idMap.get(workflowProducerNodeId) : undefined;
    const next: CanvasNodeMetadata = {
        ...copy,
        composerContent: remapNodeReferences(copy.composerContent, idMap),
        prompt: remapNodeReferences(copy.prompt, idMap),
        images: copy.images?.map(({ taskId: _imageTaskId, ...image }) => ({ ...image })),
        ...(remappedOutputIds?.length ? { workflowOutputNodeIds: remappedOutputIds } : {}),
        ...(remappedProducerId ? { workflowProducerNodeId: remappedProducerId } : {}),
    };
    if (next.status === "loading") {
        next.status = next.content || next.storageKey || next.images?.some((image) => image.content || image.storageKey) ? "success" : "idle";
        next.errorDetails = undefined;
    }
    return next;
}
