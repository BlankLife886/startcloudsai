import { useLayoutEffect, useMemo, useState } from "react";
import { pendingBatchEntries } from "./submissionBatch.js";

export function showBatchRecovery(batch, submitting) {
  const remaining = pendingBatchEntries(batch);
  return remaining.length > 0 && (!submitting || remaining.some(entry => entry.error));
}

export function submissionStageState(tasks, latestBatchId, revealedBatchId) {
  const latest = latestBatchId ? tasks.filter(task => task.batchId === latestBatchId) : [];
  const resolved = latest.some(task => task.serverJobId || task.status !== "submitting");
  const show = Boolean(latest.length && (resolved || revealedBatchId === latestBatchId));
  return {
    focusBatchId: show ? latestBatchId : "",
    waiting: Boolean(latest.length && !show),
    tasks: tasks.filter(task => task.status !== "submitting" || task.batchId !== latestBatchId || show),
  };
}

// Brief network submissions stay on the button; the canvas changes once a batch
// is accepted, rejected, or has genuinely needed a visible submitting state.
export function useSubmissionStage(tasks, latestBatchId) {
  const [revealedBatchId, setRevealedBatchId] = useState("");
  const presentation = useMemo(() => submissionStageState(tasks, latestBatchId, revealedBatchId), [tasks, latestBatchId, revealedBatchId]);
  useLayoutEffect(() => {
    if (presentation.focusBatchId && presentation.focusBatchId !== revealedBatchId) {
      setRevealedBatchId(presentation.focusBatchId);
      return;
    }
    if (!presentation.waiting) return;
    const timer = window.setTimeout(() => setRevealedBatchId(latestBatchId), 200);
    return () => window.clearTimeout(timer);
  }, [latestBatchId, presentation.waiting, presentation.focusBatchId, revealedBatchId]);
  return presentation;
}
