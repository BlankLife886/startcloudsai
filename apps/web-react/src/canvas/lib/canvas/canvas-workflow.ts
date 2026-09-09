import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { resolveCopiedCanvasNodeReferences } from "./canvas-node-copy.ts";
import { isCanvasExecutableNode } from "./canvas-operation-node.ts";
import { canvasWorkflowInputSignature, canvasWorkflowValueFingerprint } from "./canvas-workflow-signature.ts";
import { storageKeyFromUrl } from "./canvas-preview-url.ts";

export type CanvasWorkflowCompileError = "empty" | "cycle" | "invalid_connection";

export type CanvasWorkflowPlan = {
    inputSignature: string;
    nodeIds: string[];
    layers: string[][];
    dependencies: Map<string, Set<string>>;
};

export type CanvasWorkflowCheckpoint = {
    inputSignature?: string;
    outputFingerprints?: Record<string, string>;
    status: "running" | "failed";
    runId?: string;
    nodeIds: string[];
    completedNodeIds: string[];
    canceledNodeIds?: string[];
    currentNodeId?: string;
    errorNodeId?: string;
    errorMessage?: string;
    startedAt: string;
    updatedAt: string;
};

export type CanvasWorkflowCompileResult =
    | { ok: true; plan: CanvasWorkflowPlan }
    | { ok: false; reason: CanvasWorkflowCompileError; nodeIds: string[] };

export function canvasWorkflowCheckpointForStart(status: string, checkpoint: CanvasWorkflowCheckpoint | null) {
    return status === "success" || status === "canceled" ? null : checkpoint;
}

export async function waitForCanvasWorkflowStop(pending: Promise<unknown> | null | undefined) {
    if (pending) await pending;
}

export async function settleCanvasWorkflowTerminal(options: {
    persist: () => Promise<void>;
    release: () => void;
    present: () => void;
}) {
    let persistenceError: unknown;
    let persistenceFailed = false;
    options.release();
    options.present();
    try {
        await options.persist();
    } catch (error) {
        persistenceFailed = true;
        persistenceError = error;
    }
    return { persistenceFailed, persistenceError };
}

export type CanvasWorkflowNodeReadinessIssue = {
    reason: "dependency_incomplete" | "reference_missing" | "reference_empty";
    nodeId: string;
    relatedNodeId: string;
};

export type CanvasWorkflowNodeOutputIssue = {
    reason: "output_missing" | "output_failed" | "output_incomplete";
    nodeId: string;
    expected: number;
    actual: number;
    errorDetails?: string;
};

export function createCanvasWorkflowCheckpoint(plan: CanvasWorkflowPlan | string[], now = new Date().toISOString()): CanvasWorkflowCheckpoint {
    const nodeIds = Array.isArray(plan) ? plan : plan.nodeIds;
    return { status: "running", nodeIds: [...nodeIds], ...(!Array.isArray(plan) ? { inputSignature: plan.inputSignature } : {}), completedNodeIds: [], startedAt: now, updatedAt: now };
}

export function normalizeCanvasWorkflowCheckpoint(value: unknown): CanvasWorkflowCheckpoint | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if ((record.status !== "running" && record.status !== "failed") || !Array.isArray(record.nodeIds) || !Array.isArray(record.completedNodeIds)) return null;
    const nodeIds = record.nodeIds.filter((id): id is string => typeof id === "string" && Boolean(id));
    const validIds = new Set(nodeIds);
    if (!nodeIds.length || validIds.size !== nodeIds.length) return null;
    const completedNodeIds = record.completedNodeIds.filter((id): id is string => typeof id === "string" && validIds.has(id));
    const canceledNodeIds = Array.isArray(record.canceledNodeIds)
        ? record.canceledNodeIds.filter((id): id is string => typeof id === "string" && validIds.has(id) && !completedNodeIds.includes(id))
        : [];
    const currentNodeId = typeof record.currentNodeId === "string" && validIds.has(record.currentNodeId) ? record.currentNodeId : undefined;
    const errorNodeId = typeof record.errorNodeId === "string" && validIds.has(record.errorNodeId) ? record.errorNodeId : undefined;
    const now = new Date().toISOString();
    return {
        status: record.status,
        ...(typeof record.inputSignature === "string" ? { inputSignature: record.inputSignature } : {}),
        ...(record.outputFingerprints && typeof record.outputFingerprints === "object" && !Array.isArray(record.outputFingerprints)
            ? { outputFingerprints: Object.fromEntries(Object.entries(record.outputFingerprints).filter(([id, value]) => validIds.has(id) && typeof value === "string" && /^v1:[a-f0-9]{16}$/.test(value))) as Record<string, string> }
            : {}),
        ...(typeof record.runId === "string" && record.runId ? { runId: record.runId } : {}),
        nodeIds,
        completedNodeIds: [...new Set(completedNodeIds)],
        ...(canceledNodeIds.length ? { canceledNodeIds: [...new Set(canceledNodeIds)] } : {}),
        ...(currentNodeId ? { currentNodeId } : {}),
        ...(errorNodeId ? { errorNodeId } : {}),
        ...(typeof record.errorMessage === "string" && record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        startedAt: typeof record.startedAt === "string" ? record.startedAt : now,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
    };
}

export function failCanvasWorkflowCheckpoint(checkpoint: CanvasWorkflowCheckpoint, nodeId: string, errorMessage: string, now = new Date().toISOString()): CanvasWorkflowCheckpoint {
    return {
        ...checkpoint,
        status: "failed",
        currentNodeId: nodeId,
        errorNodeId: nodeId,
        errorMessage,
        updatedAt: now,
    };
}

export type CanvasWorkflowRunProgress = {
    inputSignature?: string;
    nodeMetrics?: Array<{ nodeId: string; outputFingerprint?: string }>;
    id: string;
    nodeIds: string[];
    completedNodeIds: string[];
    canceledNodeIds?: string[];
    currentNodeId?: string | null;
    startedAt?: string;
    updatedAt?: string;
};

/** True when the user is retrying a node that already failed, not resuming in-flight work. */
export function isCanvasWorkflowFailureRetry(checkpoint: CanvasWorkflowCheckpoint, nodes: CanvasNodeData[]) {
    if (checkpoint.status === "failed" || Boolean(checkpoint.errorNodeId)) return true;
    const current = checkpoint.currentNodeId ? nodes.find((node) => node.id === checkpoint.currentNodeId) : undefined;
    return current?.metadata?.status === "error";
}

/** Drop the failed current node so reconcile will queue it again instead of treating the old error as terminal. */
export function beginCanvasWorkflowRetry(checkpoint: CanvasWorkflowCheckpoint, now = new Date().toISOString()): CanvasWorkflowCheckpoint {
    return {
        ...checkpoint,
        status: "running",
        currentNodeId: undefined,
        errorNodeId: undefined,
        errorMessage: undefined,
        updatedAt: now,
    };
}

export function mergeCanvasWorkflowRunProgress(checkpoint: CanvasWorkflowCheckpoint, run: CanvasWorkflowRunProgress, options: { resetCurrentNode?: boolean } = {}): CanvasWorkflowCheckpoint {
    const nodeIds = run.nodeIds.length ? run.nodeIds : checkpoint.nodeIds;
    const validIds = new Set(nodeIds);
    const completedNodeIds = [...new Set([...checkpoint.completedNodeIds, ...run.completedNodeIds])].filter((id) => validIds.has(id));
    const canceledNodeIds = [...new Set([...(checkpoint.canceledNodeIds || []), ...(run.canceledNodeIds || [])])].filter((id) => validIds.has(id) && !completedNodeIds.includes(id));
    const mergedCurrent = run.currentNodeId && validIds.has(run.currentNodeId) ? run.currentNodeId : checkpoint.currentNodeId;
    const currentNodeId = options.resetCurrentNode ? (checkpoint.currentNodeId && validIds.has(checkpoint.currentNodeId) ? checkpoint.currentNodeId : undefined) : mergedCurrent;
    return {
        ...checkpoint,
        status: "running",
        runId: run.id,
        inputSignature: run.inputSignature || checkpoint.inputSignature,
        outputFingerprints: {
            ...checkpoint.outputFingerprints,
            ...Object.fromEntries((run.nodeMetrics || []).filter((metric) => validIds.has(metric.nodeId) && metric.outputFingerprint).map((metric) => [metric.nodeId, metric.outputFingerprint!])),
        },
        nodeIds,
        completedNodeIds,
        ...(canceledNodeIds.length ? { canceledNodeIds } : { canceledNodeIds: undefined }),
        ...(currentNodeId ? { currentNodeId } : { currentNodeId: undefined }),
        errorNodeId: undefined,
        errorMessage: undefined,
        startedAt: run.startedAt || checkpoint.startedAt,
        updatedAt: run.updatedAt || checkpoint.updatedAt,
    };
}

export function advanceCanvasWorkflowCheckpoint(checkpoint: CanvasWorkflowCheckpoint, nodeId: string, now = new Date().toISOString()): CanvasWorkflowCheckpoint {
    if (!checkpoint.nodeIds.includes(nodeId)) return checkpoint;
    return {
        ...checkpoint,
        completedNodeIds: [...new Set([...checkpoint.completedNodeIds, nodeId])],
        currentNodeId: undefined,
        updatedAt: now,
    };
}

/** Media must have a durable identity before a completed output is certified. */
export function canvasWorkflowNodeOutputFingerprint(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const producer = nodes.find((node) => node.id === nodeId);
    if (!producer) return null;
    const mode = producer.metadata?.generationMode || "image";
    const validation = validateCanvasWorkflowNodeOutputs({ nodeId, mode, expectedCount: Number(producer.metadata?.count) || 1, nodes, connections });
    if (!validation.ok) return null;
    const outputs = findWorkflowOutputNodes(nodeId, mode, nodes, connections);
    const source = (content = "", key = "") => key || storageKeyFromUrl(content) || (/^(?:data:|blob:)/.test(content) ? "" : content);
    const records = outputs.map((node) => {
        const metadata = node.metadata || {};
        if (mode === "text") return { id: node.id, type: node.type, text: metadata.content || "" };
        const images = (metadata.images || []).map((image) => ({ id: image.id, source: source(image.content, image.storageKey) }));
        const primary = images.find((image) => image.id === metadata.primaryImageId) || images[0];
        const direct = source(metadata.content, metadata.storageKey) || primary?.source || "";
        if (images.some((image) => !image.source) || (!images.length && !direct)) return null;
        return { id: node.id, type: node.type, source: direct, primaryImageId: primary?.id, images };
    });
    if (records.some((record) => !record)) return null;
    records.sort((left, right) => left!.id < right!.id ? -1 : left!.id > right!.id ? 1 : 0);
    return canvasWorkflowValueFingerprint(records);
}

export function completeCanvasWorkflowNode(checkpoint: CanvasWorkflowCheckpoint, nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], now = new Date().toISOString(), expectedFingerprint?: string) {
    const fingerprint = canvasWorkflowNodeOutputFingerprint(nodeId, nodes, connections);
    if (!fingerprint) throw new Error("节点产物尚未完整保存，不能记录为已完成");
    if (expectedFingerprint && fingerprint !== expectedFingerprint) throw new Error("节点产物在完成后已被修改，请重新运行工作流。");
    return { ...advanceCanvasWorkflowCheckpoint(checkpoint, nodeId, now), outputFingerprints: { ...checkpoint.outputFingerprints, [nodeId]: fingerprint } };
}

export function validateCanvasWorkflowCompletedOutputs(checkpoint: CanvasWorkflowCheckpoint, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    for (const nodeId of checkpoint.completedNodeIds) {
        const expected = checkpoint.outputFingerprints?.[nodeId];
        if (!expected) return { ok: false as const, nodeId, reason: "unverified" as const };
        if (canvasWorkflowNodeOutputFingerprint(nodeId, nodes, connections) !== expected) return { ok: false as const, nodeId, reason: "changed" as const };
    }
    return { ok: true as const };
}

function verifiedWorkflowOutput(checkpoint: CanvasWorkflowCheckpoint, nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return Boolean(checkpoint.outputFingerprints?.[nodeId] && canvasWorkflowNodeOutputFingerprint(nodeId, nodes, connections) === checkpoint.outputFingerprints[nodeId]);
}

export function reconcileCanvasWorkflowCheckpoint(checkpoint: CanvasWorkflowCheckpoint, nodes: CanvasNodeData[], interruptedError: string, connections: CanvasConnection[] = [], retryableErrors: string[] = []) {
    const currentNodeId = checkpoint.currentNodeId;
    if (!currentNodeId || checkpoint.completedNodeIds.includes(currentNodeId)) return { ok: true as const, checkpoint };
    const current = nodes.find((node) => node.id === currentNodeId);
    if (!current) return { ok: false as const, reason: "missing" as const, nodeId: currentNodeId, checkpoint };
    if (current.metadata?.status === "success") {
        const outputValidation = validateCanvasWorkflowNodeOutputs({
            nodeId: currentNodeId,
            mode: current.metadata?.generationMode || "image",
            expectedCount: Number(current.metadata?.count) || 1,
            nodes,
            connections,
        });
        if (!outputValidation.ok) return { ok: false as const, reason: "failed" as const, nodeId: currentNodeId, checkpoint };
        return { ok: true as const, checkpoint: verifiedWorkflowOutput(checkpoint, currentNodeId, nodes, connections) ? advanceCanvasWorkflowCheckpoint(checkpoint, currentNodeId) : checkpoint };
    }
    const errorDetails = current.metadata?.errorDetails;
    const retryable = errorDetails === interruptedError || retryableErrors.includes(errorDetails || "");
    if (current.metadata?.status === "error" && errorDetails && !retryable) {
        return { ok: false as const, reason: "failed" as const, nodeId: currentNodeId, checkpoint };
    }
    return { ok: true as const, checkpoint };
}

export function workflowPlanMatchesCheckpoint(plan: CanvasWorkflowPlan, checkpoint: CanvasWorkflowCheckpoint) {
    return Boolean(checkpoint.inputSignature && checkpoint.inputSignature === plan.inputSignature) && plan.nodeIds.length === checkpoint.nodeIds.length && plan.nodeIds.every((nodeId, index) => checkpoint.nodeIds[index] === nodeId);
}

export function reconcileCanvasWorkflowFailureOutput(checkpoint: CanvasWorkflowCheckpoint, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const failedNodeId = checkpoint.status === "failed" ? checkpoint.errorNodeId || checkpoint.currentNodeId : undefined;
    if (!failedNodeId) return checkpoint;
    const node = nodes.find((item) => item.id === failedNodeId);
    if (!node) return checkpoint;
    const validation = validateCanvasWorkflowNodeOutputs({
        nodeId: failedNodeId,
        mode: node.metadata?.generationMode || "image",
        expectedCount: Number(node.metadata?.count) || 1,
        nodes,
        connections,
    });
    if (!validation.ok || !verifiedWorkflowOutput(checkpoint, failedNodeId, nodes, connections)) return checkpoint;
    return {
        ...advanceCanvasWorkflowCheckpoint(checkpoint, failedNodeId),
        status: "running" as const,
        currentNodeId: undefined,
        errorNodeId: undefined,
        errorMessage: undefined,
    };
}

/** Adopt valid persisted outputs only while recovering an interrupted run. A fresh run must regenerate them. */
export function reconcileCanvasWorkflowOutputs(
    checkpoint: CanvasWorkflowCheckpoint,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    options: { recoverPersistedOutputs: boolean },
) {
    if (!options.recoverPersistedOutputs) return checkpoint;
    let next = checkpoint;
    for (const nodeId of checkpoint.nodeIds) {
        if (next.completedNodeIds.includes(nodeId)) continue;
        const node = nodes.find((item) => item.id === nodeId);
        if (!node || node.metadata?.status !== "success") continue;
        const validation = validateCanvasWorkflowNodeOutputs({
            nodeId,
            mode: node.metadata?.generationMode || "image",
            expectedCount: Number(node.metadata?.count) || 1,
            nodes,
            connections,
        });
        if (validation.ok && verifiedWorkflowOutput(checkpoint, nodeId, nodes, connections)) next = advanceCanvasWorkflowCheckpoint(next, nodeId);
    }
    return next;
}

export function findRunnableCanvasWorkflowNodeIds(options: {
    pendingNodeIds: Iterable<string>;
    completedNodeIds: Set<string>;
    blockedNodeIds?: Set<string>;
    dependencies: Map<string, Set<string>>;
}) {
    const blocked = options.blockedNodeIds || new Set<string>();
    return [...options.pendingNodeIds].filter((nodeId) => {
        const dependencies = options.dependencies.get(nodeId) || new Set<string>();
        return ![...dependencies].some((dependencyId) => blocked.has(dependencyId)) && [...dependencies].every((dependencyId) => options.completedNodeIds.has(dependencyId));
    });
}

export function findCanvasWorkflowCancellationClosure(nodeId: string, pendingNodeIds: Iterable<string>, dependencies: Map<string, Set<string>>) {
    const pending = new Set(pendingNodeIds);
    const canceled = new Set<string>(pending.has(nodeId) ? [nodeId] : []);
    let changed = true;
    while (changed) {
        changed = false;
        for (const pendingId of pending) {
            if (canceled.has(pendingId)) continue;
            if (![...(dependencies.get(pendingId) || [])].some((dependencyId) => canceled.has(dependencyId))) continue;
            canceled.add(pendingId);
            changed = true;
        }
    }
    return canceled;
}

export function validateCanvasWorkflowNodeReadiness(options: {
    nodeId: string;
    nodes: CanvasNodeData[];
    connections?: CanvasConnection[];
    dependencies: Set<string>;
    completedNodeIds: Set<string>;
    allowPendingDependencies?: boolean;
}): { ok: true } | { ok: false; issue: CanvasWorkflowNodeReadinessIssue } {
    const { nodeId, nodes, dependencies, completedNodeIds, allowPendingDependencies = false } = options;
    for (const dependencyId of dependencies) {
        if (!completedNodeIds.has(dependencyId) && !allowPendingDependencies) {
            return { ok: false, issue: { reason: "dependency_incomplete", nodeId, relatedNodeId: dependencyId } };
        }
    }

    const node = nodes.find((item) => item.id === nodeId);
    const composerContent = resolveCopiedCanvasNodeReferences(nodeId, node?.metadata?.composerContent ?? node?.metadata?.prompt ?? "", nodes, options.connections || []);
    const referenceIds = [...composerContent.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]);
    for (const referenceId of new Set(referenceIds)) {
        const reference = nodes.find((item) => item.id === referenceId);
        if (!reference) return { ok: false, issue: { reason: "reference_missing", nodeId, relatedNodeId: referenceId } };
        if (workflowResourceReady(reference)) continue;
        const producerId = reference.metadata?.workflowProducerNodeId;
        if (allowPendingDependencies && producerId && dependencies.has(producerId) && !completedNodeIds.has(producerId)) continue;
        return { ok: false, issue: { reason: "reference_empty", nodeId, relatedNodeId: referenceId } };
    }
    return { ok: true };
}

export function validateCanvasWorkflowNodeOutputs(options: {
    nodeId: string;
    mode: string;
    expectedCount: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
}): { ok: true } | { ok: false; issue: CanvasWorkflowNodeOutputIssue } {
    const { nodeId, mode, nodes, connections } = options;
    const expected = Math.max(1, Math.floor(options.expectedCount || 1));
    const outputType = mode === "text" ? "text" : mode === "video" ? "video" : mode === "audio" ? "audio" : "image";
    const outputs = findWorkflowOutputNodes(nodeId, outputType, nodes, connections);
    if (!outputs.length) return { ok: false, issue: { reason: "output_missing", nodeId, expected, actual: 0 } };

    const actual = outputs.reduce((count, output) => count + workflowOutputSuccessCount(output), 0);
    const errorDetails = [nodes.find((item) => item.id === nodeId), ...outputs]
        .flatMap((item) => [item?.metadata?.errorDetails, ...(item?.metadata?.images || []).map((image) => image.errorDetails)])
        .find((value): value is string => Boolean(value?.trim()));
    if (actual < expected) {
        return { ok: false, issue: { reason: errorDetails ? "output_failed" : "output_incomplete", nodeId, expected, actual, ...(errorDetails ? { errorDetails } : {}) } };
    }
    return { ok: true };
}

function workflowResourceReady(node: CanvasNodeData) {
    if (node.type === "text") return Boolean((node.metadata?.content || node.metadata?.prompt || "").trim());
    if (node.metadata?.content || node.metadata?.storageKey) return true;
    return Boolean(node.metadata?.images?.some((image) => image.status === "success" && Boolean(image.content || image.storageKey)));
}

function workflowOutputSuccessCount(node: CanvasNodeData) {
    if (node.type === "text") return node.metadata?.status === "success" && (node.metadata?.content || "").trim() ? 1 : 0;
    const successfulImages = (node.metadata?.images || []).filter((image) => image.status === "success" && Boolean(image.content || image.storageKey)).length;
    if (successfulImages) return successfulImages;
    if (node.metadata?.status === "error") return 0;
    return node.metadata?.content || node.metadata?.storageKey ? 1 : 0;
}

/** Compile generation-config nodes into a stable, dependency-ordered execution plan. */
export function compileCanvasWorkflow(nodes: CanvasNodeData[], connections: CanvasConnection[], options: { configNodeIds?: Iterable<string>; resolveSettings?: (node: CanvasNodeData) => unknown } = {}): CanvasWorkflowCompileResult {
    const scopedConfigIds = options.configNodeIds ? new Set(options.configNodeIds) : null;
    const executableNodes = nodes.filter((node) => isCanvasExecutableNode(node) && (!scopedConfigIds || scopedConfigIds.has(node.id)));
    if (!executableNodes.length) return { ok: false, reason: "empty", nodeIds: [] };

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const connection of connections) {
        if (!nodeById.has(connection.fromNodeId) || !nodeById.has(connection.toNodeId)) continue;
        const sources = incoming.get(connection.toNodeId) || [];
        sources.push(connection.fromNodeId);
        incoming.set(connection.toNodeId, sources);
    }

    const executableIds = new Set(executableNodes.map((node) => node.id));
    const invalidConfigIds = connections.flatMap((connection) => executableIds.has(connection.fromNodeId) && executableIds.has(connection.toNodeId) ? [connection.fromNodeId, connection.toNodeId] : []);
    if (invalidConfigIds.length) return { ok: false, reason: "invalid_connection", nodeIds: [...new Set(invalidConfigIds)] };
    const dependencies = new Map<string, Set<string>>();
    for (const node of executableNodes) {
        dependencies.set(node.id, findConfigDependencies(node.id, executableIds, nodeById, incoming));
    }

    const remaining = new Map([...dependencies].map(([nodeId, deps]) => [nodeId, new Set(deps)]));
    const orderIndex = new Map(executableNodes.map((node, index) => [node.id, index]));
    const layers: string[][] = [];

    while (remaining.size) {
        const ready = [...remaining]
            .filter(([, deps]) => deps.size === 0)
            .map(([nodeId]) => nodeId)
            .sort((a, b) => (orderIndex.get(a) || 0) - (orderIndex.get(b) || 0));
        if (!ready.length) return { ok: false, reason: "cycle", nodeIds: [...remaining.keys()] };
        layers.push(ready);
        ready.forEach((nodeId) => remaining.delete(nodeId));
        remaining.forEach((deps) => ready.forEach((nodeId) => deps.delete(nodeId)));
    }

    const nodeIds = layers.flat();
    return { ok: true, plan: { nodeIds, layers, dependencies, inputSignature: canvasWorkflowInputSignature(nodes, connections, nodeIds, options.resolveSettings) } };
}

export function findWorkflowOutputNodes(producerNodeId: string, outputType: string, nodes: CanvasNodeData[], connections: CanvasConnection[] = []) {
    const producer = nodes.find((node) => node.id === producerNodeId);
    const connectedOutputIds = new Set(connections.filter((connection) => connection.fromNodeId === producerNodeId).map((connection) => connection.toNodeId));
    const connected = nodes.filter((node) => node.type === outputType && connectedOutputIds.has(node.id));
    // A copied config can still carry its source node's persisted output IDs. A
    // connection the user created on the copy is the current source of truth.
    if (connected.length) return connected;
    const explicitIds = producer?.metadata?.workflowOutputNodeIds || [];
    const explicit = explicitIds
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node): node is CanvasNodeData => Boolean(node && node.type === outputType));
    if (explicit.length) return explicit;
    const attributed = nodes.filter((node) => node.type === outputType && node.metadata?.workflowProducerNodeId === producerNodeId);
    if (attributed.length) return attributed;
    return [];
}

function findConfigDependencies(nodeId: string, executableIds: Set<string>, nodeById: Map<string, CanvasNodeData>, incoming: Map<string, string[]>) {
    const dependencies = new Set<string>();
    const visited = new Set<string>([nodeId]);
    const queue = [...(incoming.get(nodeId) || [])];

    while (queue.length) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        if (!nodeById.has(currentId)) continue;
        if (executableIds.has(currentId)) {
            dependencies.add(currentId);
            continue;
        }
        queue.push(...(incoming.get(currentId) || []));
    }

    return dependencies;
}
