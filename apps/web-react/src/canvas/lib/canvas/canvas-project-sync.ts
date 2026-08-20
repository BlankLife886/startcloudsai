import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

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
};

function nodeHasOutput(node: CanvasNodeData) {
    const metadata = node.metadata;
    if (!metadata) return false;
    if (metadata.images?.some((image) => image.status === "success" && Boolean(image.content || image.storageKey))) return true;
    if (node.type === "text") return metadata.status === "success" && Boolean((metadata.content || "").trim());
    return metadata.status === "success" && Boolean(metadata.content || metadata.storageKey);
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
    };
    return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as Partial<CanvasNodeMetadata>;
}

function mergeCanvasNodes(local: CanvasNodeData, remote: CanvasNodeData): CanvasNodeData {
    const localHasOutput = nodeHasOutput(local);
    const remoteHasOutput = nodeHasOutput(remote);
    // Output fields go to the side that actually produced something; when both
    // sides have an output, the more recently completed one wins. Position,
    // size, and configuration always stay local.
    const preferRemoteOutput = remoteHasOutput && (!localHasOutput || nodeOutputTimestamp(remote) > nodeOutputTimestamp(local));
    if (!preferRemoteOutput) return local;
    return { ...local, metadata: { ...local.metadata, ...outputMetadata(remote.metadata) } };
}

/**
 * Node-level merge of two concurrently edited versions of the same canvas
 * document (multi-tab editing, or offline edits racing a remote save). This is
 * a pure function; both inputs are left untouched.
 *
 * Rules, keyed by node id:
 *  (a) nodes present locally (added or modified) are kept as-is;
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
    const remoteNodeById = new Map(remote.nodes.map((node) => [node.id, node]));
    const localNodeIds = new Set(local.nodes.map((node) => node.id));
    const nodes = [
        ...local.nodes.map((localNode) => {
            const remoteNode = remoteNodeById.get(localNode.id);
            return remoteNode ? mergeCanvasNodes(localNode, remoteNode) : localNode;
        }),
        ...remote.nodes.filter((node) => !localNodeIds.has(node.id)),
    ];

    const nodeIds = new Set(nodes.map((node) => node.id));
    const seenEndpoints = new Set<string>();
    const connections: CanvasConnection[] = [];
    for (const connection of [...local.connections, ...remote.connections]) {
        const endpoints = `${connection.fromNodeId}->${connection.toNodeId}`;
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
        revision: remote.revision,
        updatedAt: remote.updatedAt > local.updatedAt ? remote.updatedAt : local.updatedAt,
    };
}
