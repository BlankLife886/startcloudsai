import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeImage, CanvasNodeMetadata } from "@/types/canvas";
import { mergeCanvasAgentContinuations, type CanvasAgentContinuation } from "./canvas-agent-continuation.ts";

type CanvasProjectSnapshot = {
    id: string;
    title: string;
    revision?: number;
    updatedAt: string;
    /** Local changes that have not reached the cloud yet. */
    pendingSync?: boolean;
    /** The cloud document moved past the local copy; refetch and merge on open. */
    documentStale?: boolean;
};

export type CanvasCloudProjectSummary = {
    id: string;
    title: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

/** A completed cloud save only needs another pass when local edits are still pending. */
export function canvasProjectNeedsCloudRetry(project: Pick<CanvasProjectSnapshot, "pendingSync"> | null | undefined) {
    return project?.pendingSync === true;
}

/**
 * Merge the cloud project list (summaries only, no documents) with the locally
 * cached full projects:
 * - same revision on both sides: the local copy is authoritative (it may hold
 *   unsynced edits, reported via `localNewerIds` so the store can push them);
 * - cloud revision differs from the local one: keep the local document for now
 *   but mark it `documentStale` so the full document is fetched (and merged
 *   with any unsynced local edits) when the project is opened;
 * - cloud-only projects become placeholder entries via `createStub`; their
 *   documents are fetched lazily when the project is opened.
 * Local-only projects are intentionally not handled here (the store decides
 * whether they are new uploads or remote deletions).
 */
export function mergeCanvasProjectSnapshots<T extends CanvasProjectSnapshot>(summaries: CanvasCloudProjectSummary[], localProjects: T[], createStub: (summary: CanvasCloudProjectSummary) => T) {
    const localById = new Map(localProjects.map((project) => [project.id, project]));
    const localNewerIds: string[] = [];
    const projects = summaries.map((summary) => {
        const local = localById.get(summary.id);
        if (!local) return createStub(summary);
        if (local.revision === summary.revision) {
            if (local.pendingSync || local.updatedAt > summary.updatedAt) localNewerIds.push(local.id);
            return local;
        }
        return {
            ...local,
            title: local.pendingSync ? local.title : summary.title,
            updatedAt: summary.updatedAt > local.updatedAt ? summary.updatedAt : local.updatedAt,
            documentStale: true,
        };
    });
    return { projects, localNewerIds };
}

type CanvasProjectDocument = {
    title: string;
    revision?: number;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    graphSync?: CanvasGraphSyncState;
    agentContinuation?: CanvasAgentContinuation;
};

type CanvasGraphMembership = { generation: number; deleted: boolean };

/** Membership changes survive cloud saves so an older tab cannot resurrect a deletion. */
export type CanvasGraphSyncState = {
    version: 1;
    nodes: Record<string, CanvasGraphMembership>;
    /** Keyed by endpoints: reconnecting the same pair may create a different edge id. */
    connections: Record<string, CanvasGraphMembership>;
};

export function normalizeCanvasGraphSyncState(value: unknown): CanvasGraphSyncState | undefined {
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) return undefined;
    const normalize = (records: unknown): Record<string, CanvasGraphMembership> => {
        if (!records || typeof records !== "object" || Array.isArray(records)) return {};
        return Object.fromEntries(Object.entries(records).flatMap(([id, raw]) => {
            if (!id || !raw || typeof raw !== "object") return [];
            const { generation, deleted } = raw as Partial<CanvasGraphMembership>;
            if (!Number.isSafeInteger(generation) || Number(generation) < 1 || typeof deleted !== "boolean") return [];
            return [[id, { generation: Number(generation), deleted }]];
        }));
    };
    const record = value as Partial<CanvasGraphSyncState>;
    return { version: 1, nodes: normalize(record.nodes), connections: normalize(record.connections) };
}

function connectionMembershipKey(connection: CanvasConnection) {
    return JSON.stringify([connection.fromNodeId, connection.toNodeId]);
}

function mergeGraphMembership(left: Record<string, CanvasGraphMembership> = {}, right: Record<string, CanvasGraphMembership> = {}) {
    const merged = new Map(Object.entries(left));
    for (const [id, incoming] of Object.entries(right)) {
        const previous = merged.get(id);
        if (!previous || incoming.generation > previous.generation || (incoming.generation === previous.generation && incoming.deleted)) merged.set(id, incoming);
    }
    return Object.fromEntries(merged);
}

/** Only an actual membership transition creates a new generation; ordinary edits never revive a deleted entity. */
function trackGraphMembership(before: Set<string>, after: Set<string>, previous: Record<string, CanvasGraphMembership> = {}) {
    const states = new Map(Object.entries(previous));
    for (const id of new Set([...before, ...after])) {
        if (before.has(id) === after.has(id)) continue;
        states.set(id, { generation: (states.get(id)?.generation || 0) + 1, deleted: !after.has(id) });
    }
    return Object.fromEntries(states);
}

/** Called by the store for user edits, including undo/restore snapshots. Both inputs stay immutable. */
export function trackCanvasProjectGraphChanges<T extends Pick<CanvasProjectDocument, "nodes" | "connections" | "graphSync">>(before: T, after: T): T {
    if (before.nodes === after.nodes && before.connections === after.connections) return after;
    const previousNodeIds = new Set(before.nodes.map((node) => node.id));
    const nodeIds = new Set(after.nodes.map((node) => node.id));
    const connections = after.connections.filter((connection) => nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId));
    const previousEndpoints = new Set(before.connections.map(connectionMembershipKey));
    const nextEndpoints = new Set(connections.map(connectionMembershipKey));
    const sameMembers = (left: Set<string>, right: Set<string>) => left.size === right.size && [...left].every((id) => right.has(id));
    if (sameMembers(previousNodeIds, nodeIds) && sameMembers(previousEndpoints, nextEndpoints)) return connections.length === after.connections.length ? after : { ...after, connections };
    const previous = normalizeCanvasGraphSyncState(before.graphSync);
    return {
        ...after,
        connections: connections.length === after.connections.length ? after.connections : connections,
        graphSync: {
            version: 1,
            nodes: trackGraphMembership(previousNodeIds, nodeIds, previous?.nodes),
            connections: trackGraphMembership(previousEndpoints, nextEndpoints, previous?.connections),
        },
    };
}

/** Rebase page edits against their pre-merge baseline, not the already-merged store. */
export function rebaseCanvasProjectGraph<T extends CanvasProjectDocument>(before: T, currentGraph: Pick<CanvasProjectDocument, "nodes" | "connections">, merged: T): T {
    if (currentGraph.nodes === before.nodes && currentGraph.connections === before.connections) return merged;
    const local = trackCanvasProjectGraphChanges(before, { ...before, nodes: currentGraph.nodes, connections: currentGraph.connections });
    return mergeCanvasProjectDocuments(local, merged);
}

function nodeHasOutput(node: CanvasNodeData) {
    const metadata = node.metadata;
    if (!metadata) return false;
    if (metadata.images?.some((image) => image.status === "success" && Boolean(image.content || image.storageKey))) return true;
    if (node.type === "text") return metadata.status === "success" && Boolean((metadata.content || "").trim());
    return metadata.status === "success" && Boolean(metadata.content || metadata.storageKey);
}

function nodeHasDeletedMedia(node: CanvasNodeData) {
    return Boolean(node.metadata?.deletedByHistory || node.metadata?.images?.some((image) => image.deletedByHistory));
}

function nodeOutputTimestamp(node: CanvasNodeData) {
    return node.metadata?.generationCompletedAt || node.metadata?.generationStartedAt || "";
}

/** Output/result fields adopted wholesale from the winning side of a node conflict. */
function outputMetadata(metadata: CanvasNodeMetadata = {}): Partial<CanvasNodeMetadata> {
    const next: Partial<CanvasNodeMetadata> = {
        content: metadata.content,
        status: metadata.status,
        errorDetails: metadata.errorDetails,
        deletedByHistory: metadata.deletedByHistory,
        deletedAt: metadata.deletedAt,
        deletionMessage: metadata.deletionMessage,
        storageKey: metadata.storageKey,
        thumbnailUrl: metadata.thumbnailUrl,
        thumbnailKey: metadata.thumbnailKey,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        durationMs: metadata.durationMs,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        images: metadata.images,
        primaryImageId: metadata.primaryImageId,
        taskId: metadata.taskId,
        taskKind: metadata.taskKind,
        generationStartedAt: metadata.generationStartedAt,
        generationCompletedAt: metadata.generationCompletedAt,
        generationDurationMs: metadata.generationDurationMs,
        // Storyboard output identity is part of the durable result, not merely
        // local editor state. Preserve it when a newer cloud output wins a
        // multi-tab merge so retries and shot-level provenance remain intact.
        storyboardId: metadata.storyboardId,
        storyboardSceneId: metadata.storyboardSceneId,
        storyboardIndex: metadata.storyboardIndex,
        storyboardTitle: metadata.storyboardTitle,
        storyboardSummary: metadata.storyboardSummary,
        storyboardShotType: metadata.storyboardShotType,
        storyboardStatus: metadata.storyboardStatus,
        storyboardNeedsRegeneration: metadata.storyboardNeedsRegeneration,
        storyboardScript: metadata.storyboardScript,
        storyboardPlanJson: metadata.storyboardPlanJson,
        storyboardSceneCount: metadata.storyboardSceneCount,
        storyboardAspectRatio: metadata.storyboardAspectRatio,
        storyboardSourceNodeId: metadata.storyboardSourceNodeId,
        storyboardSourceNodeIds: metadata.storyboardSourceNodeIds,
        storyboardContinuity: metadata.storyboardContinuity,
        storyboardPrompt: metadata.storyboardPrompt,
        storyboardGlobalStyle: metadata.storyboardGlobalStyle,
        storyboardPlanSource: metadata.storyboardPlanSource,
        storyboardStyle: metadata.storyboardStyle,
        storyboardConsistency: metadata.storyboardConsistency,
        storyboardAnchorReference: metadata.storyboardAnchorReference,
        storyboardAnchorSceneId: metadata.storyboardAnchorSceneId,
    };
    return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as Partial<CanvasNodeMetadata>;
}

function mergeCanvasNodes(local: CanvasNodeData, remote: CanvasNodeData): CanvasNodeData {
    const localHasOutput = nodeHasOutput(local);
    const remoteHasOutput = nodeHasOutput(remote);
    // Output fields go to the side that actually produced something; when both
    // sides have an output, the more recently completed one wins. Position,
    // size, and configuration always stay local.
    const preferRemoteOutput = nodeHasDeletedMedia(remote) || (remoteHasOutput && (!localHasOutput || nodeOutputTimestamp(remote) > nodeOutputTimestamp(local)));
    if (!preferRemoteOutput) return local;
    const metadata = { ...local.metadata, ...outputMetadata(remote.metadata) };
    if (remoteHasOutput) {
        // A newer completed output must retire any local task identity and
        // running state. Without explicit clearing, Object spread keeps a
        // stale local taskId after a remote tab has already finished the shot.
        metadata.taskId = remote.metadata?.taskId;
        metadata.taskKind = remote.metadata?.taskKind;
        metadata.executionStatus = remote.metadata?.executionStatus;
        metadata.generationStage = remote.metadata?.generationStage;
        metadata.cancelPolicy = remote.metadata?.cancelPolicy;
    }
    if (nodeHasDeletedMedia(remote)) {
        metadata.content = remote.metadata?.content;
        metadata.storageKey = remote.metadata?.storageKey;
        metadata.thumbnailUrl = remote.metadata?.thumbnailUrl;
        metadata.thumbnailKey = remote.metadata?.thumbnailKey;
        metadata.taskId = remote.metadata?.taskId;
    }
    return { ...local, metadata };
}

function canvasMediaValueMatches(value: string | undefined, keys: Set<string>) {
    if (!value) return false;
    for (const key of keys) {
        if (value === key || value.includes(key)) return true;
    }
    return false;
}

function canvasImageReferencesKeys(image: CanvasNodeImage, keys: Set<string>) {
    return [image.content, image.storageKey, image.thumbnailUrl, image.thumbnailKey].some((value) => canvasMediaValueMatches(value, keys));
}

export function markCanvasProjectMediaDeleted<T extends CanvasProjectDocument>(project: T, removedKeys: string[], deletedAt: string): T {
    const keys = new Set(removedKeys.map((key) => String(key || "").trim()).filter(Boolean));
    if (!keys.size) return project;
    let projectChanged = false;
    const nodes = project.nodes.map((node) => {
        const metadata = node.metadata;
        if (!metadata) return node;
        const images = metadata.images?.map((image) => {
            if (!canvasImageReferencesKeys(image, keys)) return image;
            projectChanged = true;
            return {
                ...image,
                content: "",
                storageKey: "",
                thumbnailUrl: undefined,
                thumbnailKey: undefined,
                taskId: undefined,
                status: "error" as const,
                errorDetails: "该图片已被删除",
                deletedByHistory: true,
                deletedAt,
                deletionMessage: "该图片已被删除",
            };
        });
        const directMatch = [metadata.content, metadata.storageKey, metadata.thumbnailUrl, metadata.thumbnailKey]
            .some((value) => canvasMediaValueMatches(value, keys));
        const imagesChanged = Boolean(images?.some((image, index) => image !== metadata.images?.[index]));
        if (!directMatch && !imagesChanged) return node;
        projectChanged = true;
        return {
            ...node,
            metadata: {
                ...metadata,
                ...(directMatch ? {
                    content: undefined,
                    storageKey: undefined,
                    thumbnailUrl: undefined,
                    thumbnailKey: undefined,
                    taskId: undefined,
                    status: "error" as const,
                    errorDetails: "该图片已被删除",
                    deletedByHistory: true,
                    deletedAt,
                    deletionMessage: "该图片已被删除",
                } : {}),
                images,
            },
        };
    });
    return projectChanged ? { ...project, nodes, updatedAt: deletedAt } : project;
}

/**
 * Node-level merge of two concurrently edited versions of the same canvas
 * document (multi-tab editing, or offline edits racing a remote save). This is
 * a pure function; both inputs are left untouched.
 *
 * Rules, keyed by node id:
 *  (a) the newest recorded membership change wins; deletion wins a tie;
 *      undoing a deletion records a newer, explicit restoration;
 *  (b) nodes that only exist remotely are merged in (they may carry images
 *      generated in another tab that a blind overwrite would destroy);
 *  (c) nodes present on both sides keep local position/size/config fields,
 *      while image/output fields come from whichever side has a finished
 *      output — if both have one, the more recently completed side wins;
 *  (d) connections are rebuilt as the union of both sides, de-duplicated by
 *      endpoints and filtered to nodes that exist after the merge.
 * Chat sessions are unioned by id with the local version preferred. The
 * merged document adopts the remote revision so it can be saved on top of it.
 */
export function mergeCanvasProjectDocuments<T extends CanvasProjectDocument>(local: T, remote: CanvasProjectDocument): T {
    const localSync = normalizeCanvasGraphSyncState(local.graphSync);
    const remoteSync = normalizeCanvasGraphSyncState(remote.graphSync);
    const graphSync: CanvasGraphSyncState = {
        version: 1,
        nodes: mergeGraphMembership(localSync?.nodes, remoteSync?.nodes),
        connections: mergeGraphMembership(localSync?.connections, remoteSync?.connections),
    };
    const remoteNodeById = new Map(remote.nodes.map((node) => [node.id, node]));
    const localNodeIds = new Set(local.nodes.map((node) => node.id));
    const nodes = [
        ...local.nodes.map((localNode) => {
            const remoteNode = remoteNodeById.get(localNode.id);
            if (!remoteNode) return localNode;
            // A restoration starts a new lifetime. Do not replace its restored
            // content/configuration with output from an obsolete lifetime.
            const localGeneration = localSync?.nodes[localNode.id]?.generation || 0;
            const remoteGeneration = remoteSync?.nodes[localNode.id]?.generation || 0;
            if (localGeneration !== remoteGeneration) return localGeneration > remoteGeneration ? localNode : remoteNode;
            return mergeCanvasNodes(localNode, remoteNode);
        }),
        ...remote.nodes.filter((node) => !localNodeIds.has(node.id)),
    ].filter((node) => !graphSync.nodes[node.id]?.deleted);

    const nodeIds = new Set(nodes.map((node) => node.id));
    const seenEndpoints = new Set<string>();
    const connections: CanvasConnection[] = [];
    for (const connection of [...local.connections, ...remote.connections]) {
        const endpoints = connectionMembershipKey(connection);
        if (graphSync.connections[endpoints]?.deleted) continue;
        if (seenEndpoints.has(endpoints) || !nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) continue;
        seenEndpoints.add(endpoints);
        connections.push(connection);
    }

    const localSessionIds = new Set(local.chatSessions.map((session) => session.id));
    const chatSessions = [...local.chatSessions, ...remote.chatSessions.filter((session) => !localSessionIds.has(session.id))];

    return {
        ...local,
        nodes,
        connections,
        chatSessions,
        ...(localSync || remoteSync ? { graphSync } : {}),
        ...((local.agentContinuation || remote.agentContinuation) ? { agentContinuation: mergeCanvasAgentContinuations(local.agentContinuation, remote.agentContinuation) } : {}),
        revision: remote.revision,
        updatedAt: remote.updatedAt > local.updatedAt ? remote.updatedAt : local.updatedAt,
    };
}
