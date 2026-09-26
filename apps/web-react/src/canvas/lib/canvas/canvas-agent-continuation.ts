import type { CanvasAgentSnapshot } from "./canvas-agent-ops.ts";
import type { CanvasNodeData } from "../../types/canvas.ts";

export type AgentContinuationStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "unknown";
export type AgentCanvasHistoryTransaction = { id: string; name: string; createdAt: string; before: CanvasAgentSnapshot; after: CanvasAgentSnapshot };
export type AgentCanvasCheckpoint = { id: string; name: string; createdAt: string; snapshot: CanvasAgentSnapshot };
export type AgentCanvasHistoryState = { past: AgentCanvasHistoryTransaction[]; future: AgentCanvasHistoryTransaction[]; checkpoints: AgentCanvasCheckpoint[] };
export type AgentTrackedTask = {
    status: AgentContinuationStatus;
    error?: string;
    taskIds: Array<{ id: string; kind: "image" | "assistant" }>;
    baselineTaskIds: string[];
    baselineStartedAt?: string;
    baselineCompletedAt?: string;
};
export type AgentGenerationRecord = { requestId: string; nodeIds: string[]; createdAt: string; updatedAt: string; tasks: Record<string, AgentTrackedTask> };
export type AgentWorkflowRecord = {
    requestId: string;
    workflowId?: string;
    configNodeIds: string[];
    createdAt: string;
    updatedAt: string;
    runId?: string;
    status: AgentContinuationStatus;
    completed: number;
    total: number;
    currentNodeId?: string;
    error?: string;
};
export type AgentRegenerationRecord = { batchId: string; sourceNodeIds: string[]; updatedAt: string; result?: { generationRequestId: string; createdBranches: number; items: Array<{ sourceNodeId: string; configNodeId: string; outputNodeId: string }> } };
type StoredTransaction = Omit<AgentCanvasHistoryTransaction, "before" | "after"> & { before: string; after: string };
type StoredCheckpoint = Omit<AgentCanvasCheckpoint, "snapshot"> & { snapshot: string };
export type CanvasAgentContinuation = {
    version: 1;
    ownerUserId: string | null;
    projectId: string;
    updatedAt: string;
    historyUpdatedAt: string;
    snapshots: Record<string, CanvasAgentSnapshot>;
    past: StoredTransaction[];
    future: StoredTransaction[];
    checkpoints: StoredCheckpoint[];
    generations: AgentGenerationRecord[];
    workflows: AgentWorkflowRecord[];
    regenerations: AgentRegenerationRecord[];
};

export const MAX_AGENT_CONTINUATION_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY = 20;
const MAX_CHECKPOINTS = 10;
const MAX_RUNS = 32;
const canonicalCache = new WeakMap<object, string>();

function canonical(value: unknown): string {
    if (value && typeof value === "object") {
        const cached = canonicalCache.get(value);
        if (cached !== undefined) return cached;
        const text = Array.isArray(value)
            ? `[${value.map((item) => canonical(item) || "null").join(",")}]`
            : `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
        canonicalCache.set(value, text);
        return text;
    }
    return JSON.stringify(value) || "";
}

/** Reference equality is only a fast path; persisted history must compare by content. */
export function canvasAgentHistoryMatches(current: CanvasAgentSnapshot, expected: CanvasAgentSnapshot) {
    return (current.nodes === expected.nodes || canonical(current.nodes) === canonical(expected.nodes))
        && (current.connections === expected.connections || canonical(current.connections) === canonical(expected.connections));
}

function snapshotKey(snapshot: CanvasAgentSnapshot) {
    const text = canonical(snapshot);
    let first = 2166136261;
    let second = 5381;
    for (let i = 0; i < text.length; i++) {
        first = Math.imul(first ^ text.charCodeAt(i), 16777619);
        second = Math.imul(second, 33) ^ text.charCodeAt(i);
    }
    return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}-${text.length}`;
}

function validSnapshot(value: unknown, projectId: string): value is CanvasAgentSnapshot {
    const item = value as CanvasAgentSnapshot | undefined;
    return Boolean(item && item.projectId === projectId && Array.isArray(item.nodes) && Array.isArray(item.connections) && Array.isArray(item.selectedNodeIds) && item.viewport && [item.viewport.x, item.viewport.y, item.viewport.k].every(Number.isFinite));
}

function collectSnapshotPool(value: CanvasAgentContinuation) {
    const ids = new Set([...value.past.flatMap((item) => [item.before, item.after]), ...value.future.flatMap((item) => [item.before, item.after]), ...value.checkpoints.map((item) => item.snapshot)]);
    value.snapshots = Object.fromEntries([...ids].filter((id) => value.snapshots[id]).map((id) => [id, value.snapshots[id]]));
}

function boundContinuation(source: CanvasAgentContinuation): CanvasAgentContinuation {
    const value = { ...source, past: source.past.slice(-MAX_HISTORY), future: source.future.slice(-MAX_HISTORY), checkpoints: source.checkpoints.slice(-MAX_CHECKPOINTS), generations: source.generations.slice(-MAX_RUNS), workflows: source.workflows.slice(-MAX_RUNS), regenerations: source.regenerations.slice(-MAX_RUNS) };
    collectSnapshotPool(value);
    while (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_AGENT_CONTINUATION_BYTES) {
        if (value.past.length) value.past.shift();
        else if (value.future.length) value.future.shift();
        else if (value.checkpoints.length > 1) value.checkpoints.shift();
        else throw new Error("当前画布的 Agent 检查点超过 4 MB，请减少内嵌素材或节点后重试；现有检查点未被覆盖");
        collectSnapshotPool(value);
    }
    return value;
}

export function packCanvasAgentContinuation(input: {
    ownerUserId: string | null; projectId: string; history: AgentCanvasHistoryState; historyUpdatedAt: string;
    generations: Iterable<AgentGenerationRecord>; workflows: Iterable<AgentWorkflowRecord>; regenerations: Iterable<AgentRegenerationRecord>; updatedAt?: string;
}): CanvasAgentContinuation {
    const snapshots: Record<string, CanvasAgentSnapshot> = {};
    const storeSnapshot = (snapshot: CanvasAgentSnapshot) => {
        let key = snapshotKey(snapshot);
        while (snapshots[key] && canonical(snapshots[key]) !== canonical(snapshot)) key += "-collision";
        snapshots[key] = snapshot;
        return key;
    };
    const transaction = ({ before, after, ...item }: AgentCanvasHistoryTransaction): StoredTransaction => ({ ...item, before: storeSnapshot(before), after: storeSnapshot(after) });
    return boundContinuation({
        version: 1, ownerUserId: input.ownerUserId, projectId: input.projectId, updatedAt: input.updatedAt || new Date().toISOString(), historyUpdatedAt: input.historyUpdatedAt,
        snapshots, past: input.history.past.map(transaction), future: input.history.future.map(transaction),
        checkpoints: input.history.checkpoints.map(({ snapshot, ...item }) => ({ ...item, snapshot: storeSnapshot(snapshot) })),
        generations: [...input.generations], workflows: [...input.workflows], regenerations: [...input.regenerations],
    });
}

export function normalizeCanvasAgentContinuation(value: unknown, scope?: { ownerUserId: string | null; projectId: string }): CanvasAgentContinuation | undefined {
    const data = value as CanvasAgentContinuation | undefined;
    if (!data || data.version !== 1 || typeof data.projectId !== "string" || (data.ownerUserId !== null && typeof data.ownerUserId !== "string") || !data.snapshots || typeof data.snapshots !== "object" || ![data.past, data.future, data.checkpoints, data.generations, data.workflows, data.regenerations].every(Array.isArray)) return undefined;
    if (scope && (scope.projectId !== data.projectId || scope.ownerUserId !== data.ownerUserId)) return undefined;
    const snapshots = Object.fromEntries(Object.entries(data.snapshots).filter(([, snapshot]) => validSnapshot(snapshot, data.projectId)));
    const transaction = (item: StoredTransaction) => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && snapshots[item.before] && snapshots[item.after]);
    try {
        return boundContinuation({ ...data, snapshots, updatedAt: String(data.updatedAt || ""), historyUpdatedAt: String(data.historyUpdatedAt || ""),
            past: data.past.filter(transaction), future: data.future.filter(transaction),
            checkpoints: data.checkpoints.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && snapshots[item.snapshot]),
            generations: data.generations.filter((item) => item && typeof item.requestId === "string" && Array.isArray(item.nodeIds) && item.tasks && item.nodeIds.every((id) => Boolean(item.tasks[id] && Array.isArray(item.tasks[id].taskIds) && Array.isArray(item.tasks[id].baselineTaskIds)))),
            workflows: data.workflows.filter((item) => item && typeof item.requestId === "string" && Array.isArray(item.configNodeIds)),
            regenerations: data.regenerations.filter((item) => item && typeof item.batchId === "string" && Array.isArray(item.sourceNodeIds)),
        });
    } catch { return undefined; }
}

export function unpackCanvasAgentHistory(value?: CanvasAgentContinuation): AgentCanvasHistoryState {
    if (!value) return { past: [], future: [], checkpoints: [] };
    const transaction = (item: StoredTransaction): AgentCanvasHistoryTransaction => ({ ...item, before: value.snapshots[item.before], after: value.snapshots[item.after] });
    return { past: value.past.map(transaction), future: value.future.map(transaction), checkpoints: value.checkpoints.map((item) => ({ ...item, snapshot: value.snapshots[item.snapshot] })) };
}

export function canvasAgentContinuationNodes(value: unknown): CanvasNodeData[] {
    const data = value as CanvasAgentContinuation | undefined;
    return data?.version === 1 && data.snapshots ? Object.values(data.snapshots).flatMap((snapshot) => Array.isArray(snapshot?.nodes) ? snapshot.nodes : []) : [];
}

export function mergeCanvasAgentContinuations(local: unknown, remote: unknown): CanvasAgentContinuation | undefined {
    const left = normalizeCanvasAgentContinuation(local);
    const right = normalizeCanvasAgentContinuation(remote);
    if (!left || !right) return left || right;
    if (left.ownerUserId !== right.ownerUserId || left.projectId !== right.projectId) return left;
    const merge = <T extends { updatedAt?: string; createdAt?: string }>(a: T[], b: T[], id: (item: T) => string): T[] => {
        const items = new Map(a.map((item) => [id(item), item]));
        b.forEach((item) => {
            const prior = items.get(id(item));
            if (!prior || String(item.updatedAt || item.createdAt) > String(prior.updatedAt || prior.createdAt)) items.set(id(item), item);
        });
        return [...items.values()].sort((a, b) => String(a.updatedAt || a.createdAt).localeCompare(String(b.updatedAt || b.createdAt)));
    };
    const latestHistory = right.historyUpdatedAt > left.historyUpdatedAt ? right : left;
    return boundContinuation({ ...latestHistory, updatedAt: left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt,
        snapshots: { ...right.snapshots, ...left.snapshots },
        checkpoints: merge(left.checkpoints, right.checkpoints, (item) => item.id),
        generations: merge(left.generations, right.generations, (item) => item.requestId),
        workflows: merge(left.workflows, right.workflows, (item) => item.requestId),
        regenerations: merge(left.regenerations, right.regenerations, (item) => item.batchId),
    });
}

export function canvasAgentStatusIsTerminal(status: AgentContinuationStatus) {
    return status === "succeeded" || status === "failed" || status === "canceled";
}

function relatedGenerationNodes(nodeId: string, nodes: CanvasNodeData[]) {
    const source = nodes.find((node) => node.id === nodeId);
    const outputs = new Set(source?.metadata?.workflowOutputNodeIds || []);
    return nodes.filter((node) => node.id === nodeId || outputs.has(node.id) || node.metadata?.workflowProducerNodeId === nodeId);
}

function taskIdentities(nodes: CanvasNodeData[]) {
    const tasks = new Map<string, { id: string; kind: "image" | "assistant" }>();
    nodes.forEach((node) => {
        if (node.metadata?.taskId) tasks.set(node.metadata.taskId, { id: node.metadata.taskId, kind: node.metadata.taskKind || "image" });
        node.metadata?.images?.forEach((image) => { if (image.taskId) tasks.set(image.taskId, { id: image.taskId, kind: "image" }); });
    });
    return [...tasks.values()];
}

export function createAgentGenerationRecord(requestId: string, nodeIds: string[], nodes: CanvasNodeData[]): AgentGenerationRecord {
    const now = new Date().toISOString();
    return { requestId, nodeIds, createdAt: now, updatedAt: now, tasks: Object.fromEntries(nodeIds.map((nodeId) => {
        const source = nodes.find((node) => node.id === nodeId);
        return [nodeId, { status: "queued", taskIds: [], baselineTaskIds: taskIdentities(relatedGenerationNodes(nodeId, nodes)).map((task) => task.id), baselineStartedAt: source?.metadata?.generationStartedAt, baselineCompletedAt: source?.metadata?.generationCompletedAt }];
    })) };
}

/** Capture exact task IDs while the source/output still belongs to this request. */
export function reconcileAgentGenerationRecord(record: AgentGenerationRecord, nodes: CanvasNodeData[], recovered = false): AgentGenerationRecord {
    let changed = false;
    const tasks = { ...record.tasks };
    for (const nodeId of record.nodeIds) {
        const prior = record.tasks[nodeId];
        if (canvasAgentStatusIsTerminal(prior.status)) continue;
        const allRelated = relatedGenerationNodes(nodeId, nodes);
        const ownsSource = allRelated.some((node) => node.id === nodeId && node.metadata?.agentGenerationRequestId === record.requestId);
        const related = allRelated.filter((node) => ownsSource || node.metadata?.agentGenerationRequestId === record.requestId);
        const discovered = taskIdentities(related).filter((task) => !prior.baselineTaskIds.includes(task.id));
        const taskIds = [...new Map([...prior.taskIds, ...discovered].map((task) => [task.id, task])).values()];
        const source = related.find((node) => node.id === nodeId);
        const finished = source?.metadata?.generationCompletedAt;
        const started = source?.metadata?.generationStartedAt;
        const freshCompletion = Boolean(finished && finished !== prior.baselineCompletedAt && finished >= record.createdAt);
        let status: AgentContinuationStatus = prior.status;
        let error = prior.error;
        if (freshCompletion && source?.metadata?.executionStatus === "succeeded") { status = "succeeded"; error = undefined; }
        else if (freshCompletion && source?.metadata?.executionStatus === "canceled") { status = "canceled"; error = undefined; }
        else if (freshCompletion && (source?.metadata?.executionStatus === "failed" || source?.metadata?.status === "error")) { status = "failed"; error = source.metadata.errorDetails || "生成失败"; }
        else if (recovered && !taskIds.length) { status = "unknown"; error = "刷新前未记录到已提交的任务，无法确认是否启动；没有自动重新生成"; }
        else if (taskIds.length && (prior.status === "unknown" || (started && started !== prior.baselineStartedAt))) { status = "running"; error = undefined; }
        if (status !== prior.status || error !== prior.error || taskIds.length !== prior.taskIds.length) {
            tasks[nodeId] = { ...prior, taskIds, status, error };
            changed = true;
        }
    }
    return changed ? { ...record, tasks, updatedAt: new Date().toISOString() } : record;
}
