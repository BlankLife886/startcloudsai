export type AgentWorkflowState = {
    status: string;
    attemptId?: number;
    completed: number;
    total: number;
    currentNodeId?: string;
    errorMessage?: string;
    startedAt?: string;
};

export type AgentWorkflowExecution = {
    baselineAttemptId: number;
    settled: boolean;
    error?: string;
    finalState?: AgentWorkflowState;
};

export function canvasAgentWorkflowStatus(record: AgentWorkflowExecution, liveState: AgentWorkflowState) {
    const state = record.finalState || liveState;
    const started = Number(state.attemptId || 0) !== record.baselineAttemptId;
    const status = record.error ? "failed"
        : !started ? record.settled ? "canceled" : "queued"
        : state.status === "success" ? "succeeded"
        : state.status === "error" ? "failed"
        : state.status === "canceled" ? "canceled" : "running";
    return { status, started, state } as const;
}
