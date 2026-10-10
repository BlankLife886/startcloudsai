import { normalizeCanvasWorkflowCheckpoint } from "./canvas-workflow.ts";
import type { CanvasWorkflowRunRecord } from "../../services/canvas-workflow-run-api";

/** Recovery needs the server's input version and completed-output proofs, not only its counters. */
export function canvasCheckpointFromRun(run: CanvasWorkflowRunRecord) {
    return normalizeCanvasWorkflowCheckpoint({
        status: run.status === "failed" ? "failed" : "running",
        runId: run.id,
        inputSignature: run.inputSignature,
        outputFingerprints: Object.fromEntries((run.nodeMetrics || []).filter(item => item.outputFingerprint).map(item => [item.nodeId, item.outputFingerprint])),
        nodeIds: run.nodeIds, completedNodeIds: run.completedNodeIds, canceledNodeIds: run.canceledNodeIds,
        currentNodeId: run.currentNodeId || undefined, errorNodeId: run.errorNodeId || undefined, errorMessage: run.errorMessage,
        startedAt: run.startedAt, updatedAt: run.updatedAt,
    });
}

export function canvasRecoveryAttemptKey(run: CanvasWorkflowRunRecord) {
    return `${run.id}:${run.inputSignature || ""}:${run.leaseExpiresAt || "expired"}`;
}

export function isFinishedCanvasTaskError(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "task_already_finished");
}
