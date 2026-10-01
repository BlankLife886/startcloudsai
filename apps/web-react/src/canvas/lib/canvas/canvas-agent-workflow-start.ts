export type AgentWorkflowStartDecision = {
    status: "started" | "canceled" | "rejected";
    error?: string;
    runId?: string;
};

export type AgentWorkflowStartResult = AgentWorkflowStartDecision & {
    requestId: string;
    workflowId?: string;
    configNodeIds: string[];
};

/** Keep the scheduler's start acknowledgement separate from its full execution. */
export function observeCanvasWorkflowStart(
    run: (onStartDecision: (decision: AgentWorkflowStartDecision) => void) => Promise<void>,
    fallback: () => AgentWorkflowStartDecision,
) {
    let acknowledged = false;
    let resolveDecision!: (decision: AgentWorkflowStartDecision) => void;
    const decision = new Promise<AgentWorkflowStartDecision>((resolve) => { resolveDecision = resolve; });
    const acknowledge = (value: AgentWorkflowStartDecision) => {
        if (acknowledged) return;
        acknowledged = true;
        resolveDecision(value);
    };
    // Defer invocation so synchronous throws follow the same rejection path.
    const completion = Promise.resolve().then(() => run(acknowledge));
    void completion.then(
        () => { if (!acknowledged) acknowledge(fallback()); },
        (error) => acknowledge({ status: "rejected", error: error instanceof Error ? error.message : "工作流启动失败" }),
    );
    return { decision, completion };
}
