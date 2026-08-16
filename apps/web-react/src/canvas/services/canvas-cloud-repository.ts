import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { StarcloudsApiError, starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasDocumentV3 = Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport"> & {
    version: 3;
};

type CanvasProjectResponse = {
    id: string;
    title: string;
    document: CanvasDocumentV3 | Record<string, unknown>;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

type CanvasProjectSummary = Omit<CanvasProjectResponse, "document">;

type LegacyCanvasDocument = {
    version?: number;
    nodes?: unknown;
    edges?: unknown;
    connections?: unknown;
    viewport?: unknown;
};

function readString(record: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
    return "";
}

function normalizeConnections(value: unknown): CanvasConnection[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const fromNodeId = readString(record, "fromNodeId", "source", "from");
        const toNodeId = readString(record, "toNodeId", "target", "to");
        if (!fromNodeId || !toNodeId) return [];
        return [
            {
                id: readString(record, "id") || `legacy-connection-${index + 1}`,
                fromNodeId,
                toNodeId,
            },
        ];
    });
}

function normalizeViewport(value: unknown): ViewportTransform {
    if (!value || typeof value !== "object") return { x: 0, y: 0, k: 1 };
    const record = value as Record<string, unknown>;
    const number = (candidate: unknown, fallback: number) => (typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback);
    return {
        x: number(record.x, 0),
        y: number(record.y, 0),
        k: number(record.k ?? record.zoom, 1),
    };
}

function projectDocument(project: CanvasProject): CanvasDocumentV3 {
    return {
        version: 3,
        nodes: project.nodes,
        connections: project.connections,
        chatSessions: project.chatSessions,
        activeChatId: project.activeChatId,
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport,
    };
}

function fromResponse(item: CanvasProjectResponse): CanvasProject | null {
    const document = item.document as Partial<CanvasDocumentV3> & LegacyCanvasDocument;
    if (![1, 2, 3].includes(document.version || 0) || !Array.isArray(document.nodes)) return null;
    const nodes = document.nodes as CanvasNodeData[];
    const connections = normalizeConnections(document.version === 3 ? document.connections : document.edges);
    return {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        revision: item.revision,
        nodes,
        connections,
        chatSessions: Array.isArray(document.chatSessions) ? document.chatSessions : [],
        activeChatId: document.activeChatId || null,
        backgroundMode: document.backgroundMode || "lines",
        showImageInfo: Boolean(document.showImageInfo),
        viewport: normalizeViewport(document.viewport),
    };
}

async function loadCloudCanvasProjectSummary(item: CanvasProjectSummary) {
    try {
        return fromResponse(await starcloudsRequest<CanvasProjectResponse>(`/canvas-projects/${encodeURIComponent(item.id)}`));
    } catch (error) {
        // A project can disappear between the summary and detail requests.
        // Keep the rest of the project list usable, but surface real outages.
        if (error instanceof StarcloudsApiError && error.status === 404) return null;
        throw error;
    }
}

export async function listCloudCanvasProjects() {
    const response = await starcloudsRequest<{ items: CanvasProjectSummary[] }>("/canvas-projects");
    const details: Array<CanvasProject | null> = [];
    const batchSize = 8;
    for (let offset = 0; offset < response.items.length; offset += batchSize) {
        const batch = response.items.slice(offset, offset + batchSize);
        details.push(...(await Promise.all(batch.map(loadCloudCanvasProjectSummary))));
    }
    return details.filter((item): item is CanvasProject => item !== null);
}

export async function getCloudCanvasProject(id: string) {
    return fromResponse(await starcloudsRequest<CanvasProjectResponse>(`/canvas-projects/${encodeURIComponent(id)}`));
}

export async function createCloudCanvasProject(project: CanvasProject) {
    const response = await starcloudsJson<CanvasProjectResponse>("/canvas-projects", "POST", {
        id: project.id,
        title: project.title,
        document: projectDocument(project),
    });
    return fromResponse(response);
}

export async function updateCloudCanvasProject(project: CanvasProject) {
    if (!project.revision) return createCloudCanvasProject(project);
    const response = await starcloudsJson<CanvasProjectResponse>(`/canvas-projects/${encodeURIComponent(project.id)}`, "PATCH", {
        title: project.title,
        document: projectDocument(project),
        revision: project.revision,
    });
    return fromResponse(response);
}

export function deleteCloudCanvasProject(id: string) {
    return starcloudsRequest<void>(`/canvas-projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
