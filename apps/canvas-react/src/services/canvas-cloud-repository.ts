import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";

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
    const document = item.document as Partial<CanvasDocumentV3>;
    if (document.version !== 3 || !Array.isArray(document.nodes) || !Array.isArray(document.connections)) return null;
    return {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        revision: item.revision,
        nodes: document.nodes,
        connections: document.connections,
        chatSessions: Array.isArray(document.chatSessions) ? document.chatSessions : [],
        activeChatId: document.activeChatId || null,
        backgroundMode: document.backgroundMode || "lines",
        showImageInfo: Boolean(document.showImageInfo),
        viewport: document.viewport || { x: 0, y: 0, k: 1 },
    };
}

export async function listCloudCanvasProjects() {
    const response = await starcloudsRequest<{ items: CanvasProjectSummary[] }>("/canvas-projects");
    const details = await Promise.all(response.items.map((item) => starcloudsRequest<CanvasProjectResponse>(`/canvas-projects/${encodeURIComponent(item.id)}`)));
    return details.map(fromResponse).filter((item): item is CanvasProject => item !== null);
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
