import { mergeCanvasWorkflowRunProgress, type CanvasWorkflowCheckpoint } from "@/lib/canvas/canvas-workflow";
import type { CanvasWorkflowRunRecord } from "@/services/canvas-workflow-run-api";

const CANVAS_WORKFLOW_OWNER_PREFIX = "infinite-canvas:workflow-owner:";

/** Stable per-tab owner id for workflow browser locks / server leases. */
export function canvasWorkflowOwnerId(projectId: string) {
    const key = `${CANVAS_WORKFLOW_OWNER_PREFIX}${projectId}`;
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const ownerId = crypto.randomUUID();
    window.sessionStorage.setItem(key, ownerId);
    return ownerId;
}

export function mergeWorkflowRunCheckpoint(checkpoint: CanvasWorkflowCheckpoint, run: CanvasWorkflowRunRecord, options?: { resetCurrentNode?: boolean }) {
    return mergeCanvasWorkflowRunProgress(checkpoint, run, options);
}

/** Busy flags used by leave/beforeunload guards for workflow runs. */
export function isCanvasWorkflowBusy(status: string) {
    return status === "running" || status === "locked" || status === "paused";
}
