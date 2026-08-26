import { starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";

export type CanvasWorkflowRunRecord = {
    id: string;
    projectId: string;
    ownerId: string;
    status: "running" | "succeeded" | "failed" | "canceled";
    nodeIds: string[];
    completedNodeIds: string[];
    canceledNodeIds: string[];
    currentNodeId?: string | null;
    errorMessage?: string;
    leaseExpiresAt?: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string | null;
};

export function getActiveCanvasWorkflowRun(projectId: string) {
    return starcloudsRequest<{ run: CanvasWorkflowRunRecord | null }>(`/canvas-projects/${encodeURIComponent(projectId)}/workflow-run`);
}

export function acquireCanvasWorkflowRun(projectId: string, ownerId: string, nodeIds: string[]) {
    return starcloudsJson<{ run: CanvasWorkflowRunRecord; acquired: boolean }>(`/canvas-projects/${encodeURIComponent(projectId)}/workflow-runs`, "POST", { ownerId, nodeIds });
}

export function updateCanvasWorkflowRun(
    projectId: string,
    runId: string,
    input: {
        ownerId: string;
        status: CanvasWorkflowRunRecord["status"];
        completedNodeIds: string[];
        canceledNodeIds?: string[];
        currentNodeId?: string;
        errorMessage?: string;
    },
    options?: { keepalive?: boolean },
) {
    return starcloudsRequest<CanvasWorkflowRunRecord>(`/canvas-projects/${encodeURIComponent(projectId)}/workflow-runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        keepalive: options?.keepalive,
    });
}
