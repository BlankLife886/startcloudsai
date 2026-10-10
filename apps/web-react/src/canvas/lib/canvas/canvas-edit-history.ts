import type { CanvasConnection, CanvasNodeData } from "../../types/canvas";
export type CanvasHistoryGraph = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
const runtime = new Set(["status", "executionStatus", "generationStage", "cancelPolicy", "errorDetails", "taskId", "taskKind", "generationQueuedAt", "generationStartedAt", "generationCompletedAt", "generationDurationMs", "agentGenerationRequestId", "workflowOutputNodeIds", "inlineOutputNodeId", "workflowProducerNodeId", "localImageOperationCompletedCount", "deletedByHistory", "deletedAt", "deletionMessage"]);
const output = new Set(["content", "storageKey", "thumbnailKey", "thumbnailUrl", "images", "primaryImageId", "naturalWidth", "naturalHeight", "mimeType", "bytes", "durationMs"]);
const equal = (a: unknown, b: unknown) => a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

function outputArrived(before: CanvasNodeData, after: CanvasNodeData) {
    const a = before.metadata || {}, b = after.metadata || {};
    return Boolean(a.deletedByHistory || b.deletedByHistory || ((a.taskId || b.taskId || a.workflowProducerNodeId || b.workflowProducerNodeId || a.generationStartedAt || b.generationStartedAt) && (a.status === "loading" || b.status === "loading" || a.taskId !== b.taskId || a.generationStartedAt !== b.generationStartedAt || a.generationCompletedAt !== b.generationCompletedAt)));
}

function changedUserKeys(before: CanvasNodeData, after: CanvasNodeData) {
    const generating = outputArrived(before, after);
    const nodeKeys = ["title", "type", ...(!generating ? ["position", "width", "height"] : [])].filter(key => !equal((before as unknown as Record<string, unknown>)[key], (after as unknown as Record<string, unknown>)[key]));
    const a = before.metadata || {}, b = after.metadata || {};
    const derived = new Set(["count", "generationType", "model", "size", "resolution", "quality", "references", ...(a.workflowProducerNodeId || b.workflowProducerNodeId ? ["prompt", "localImageOperation", "localImageOperationParams", "hidden"] : [])]);
    const metadataKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !runtime.has(key) && !(generating && (output.has(key) || derived.has(key))) && !equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
    return { nodeKeys, metadataKeys };
}

function generatedAddition(node: CanvasNodeData, existing: Map<string, CanvasNodeData>) {
    return Boolean(node.metadata?.workflowProducerNodeId && existing.has(node.metadata.workflowProducerNodeId));
}

export function hasCanvasUserEdit(before: CanvasHistoryGraph, after: CanvasHistoryGraph) {
    if (before.nodes === after.nodes && before.connections === after.connections) return false;
    const old = new Map(before.nodes.map(node => [node.id, node]));
    const next = new Map(after.nodes.map(node => [node.id, node]));
    if (before.nodes.some(node => !next.has(node.id))) return true;
    for (const node of after.nodes) {
        const prior = old.get(node.id);
        if (!prior) { if (!generatedAddition(node, old)) return true; continue; }
        if (prior === node) continue;
        const keys = changedUserKeys(prior, node);
        if (keys.nodeKeys.length || keys.metadataKeys.length) return true;
    }
    const beforeEdges = new Set(before.connections.map(edge => edge.id));
    const afterEdges = new Set(after.connections.map(edge => edge.id));
    if (before.connections.some(edge => !afterEdges.has(edge.id))) return true;
    return after.connections.some(edge => !beforeEdges.has(edge.id) && ![edge.fromNodeId, edge.toNodeId].some(id => !old.has(id) && next.has(id) && generatedAddition(next.get(id)!, old)));
}

/** Apply the inverse user delta, preserving outputs and progress that arrived afterwards. */
export function applyCanvasHistoryDelta(target: CanvasHistoryGraph, baseline: CanvasHistoryGraph, current: CanvasHistoryGraph): CanvasHistoryGraph {
    const wanted = new Map(target.nodes.map(node => [node.id, node]));
    const base = new Map(baseline.nodes.map(node => [node.id, node]));
    const live = new Map(current.nodes.map(node => [node.id, node]));
    for (const [id, node] of base) {
        if (!wanted.has(id) && !generatedAddition(node, wanted)) live.delete(id);
    }
    for (const [id, node] of wanted) {
        const previous = base.get(id), present = live.get(id);
        if (!previous) { if (!present) live.set(id, node); continue; }
        if (!present) continue; // Do not resurrect a node deleted outside this transaction.
        const { nodeKeys, metadataKeys } = changedUserKeys(node, previous);
        if (!nodeKeys.length && !metadataKeys.length) continue;
        const next = { ...present, metadata: { ...present.metadata } };
        for (const key of nodeKeys) {
            if (equal((present as unknown as Record<string, unknown>)[key], (previous as unknown as Record<string, unknown>)[key])) (next as unknown as Record<string, unknown>)[key] = (node as unknown as Record<string, unknown>)[key];
        }
        for (const key of metadataKeys) {
            if (!equal((present.metadata as Record<string, unknown> | undefined)?.[key], (previous.metadata as Record<string, unknown> | undefined)?.[key])) continue;
            const value = (node.metadata as Record<string, unknown> | undefined)?.[key];
            if (value === undefined) delete (next.metadata as Record<string, unknown>)[key];
            else (next.metadata as Record<string, unknown>)[key] = value;
        }
        live.set(id, next);
    }
    const wantedEdges = new Map(target.connections.map(edge => [edge.id, edge]));
    const baseEdges = new Set(baseline.connections.map(edge => edge.id));
    const edges = new Map(current.connections.map(edge => [edge.id, edge]));
    for (const edge of baseline.connections) {
        if (!wantedEdges.has(edge.id) && ![edge.fromNodeId, edge.toNodeId].some(id => !wanted.has(id) && base.has(id) && generatedAddition(base.get(id)!, wanted))) edges.delete(edge.id);
    }
    for (const edge of target.connections) if (!baseEdges.has(edge.id)) edges.set(edge.id, edge);
    return { nodes: [...live.values()], connections: [...edges.values()].filter(edge => live.has(edge.fromNodeId) && live.has(edge.toNodeId)) };
}
