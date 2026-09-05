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
	errorNodeId?: string | null;
	nodeMetrics: CanvasWorkflowNodeMetric[];
	totalCostCents: number;
    leaseExpiresAt?: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string | null;
};

export type CanvasWorkflowNodeMetric = {
	nodeId: string;
	title: string;
	status: "queued" | "running" | "succeeded" | "failed" | "canceled";
	startedAt?: string;
	finishedAt?: string;
	durationMs: number;
	costCents: number;
	errorMessage?: string;
};

export function getActiveCanvasWorkflowRun(projectId: string) {
    return starcloudsRequest<{ run: CanvasWorkflowRunRecord | null }>(`/canvas-projects/${encodeURIComponent(projectId)}/workflow-run`);
}

export function acquireCanvasWorkflowRun(
	projectId: string,
	ownerId: string,
	nodeIds: string[],
) {
	return starcloudsJson<{ run: CanvasWorkflowRunRecord; acquired: boolean }>(`/canvas-projects/${encodeURIComponent(projectId)}/workflow-runs`, "POST", {
		ownerId,
		nodeIds,
	});
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
		errorNodeId?: string;
		nodeMetrics?: CanvasWorkflowNodeMetric[];
		totalCostCents?: number;
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
