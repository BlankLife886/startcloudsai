export type HostedAgentRunScope = {
    readonly projectId: string;
    readonly controller: AbortController;
    runId: string;
};

const retiredHostedAgentRunIds = new Set<string>();
const RETIRED_RUN_LIMIT = 64;
const RUNNING_MESSAGE_STATUSES = new Set(["inProgress", "in_progress", "running", "started", "pending"]);
type HostedAgentRunStopper = (projectId: string, options?: { keepalive?: boolean }) => Promise<void>;
let hostedAgentRunStopper: HostedAgentRunStopper | null = null;

export function createHostedAgentRunScope(projectId: string, controller = new AbortController()): HostedAgentRunScope {
    return { projectId, controller, runId: "" };
}

export function isHostedAgentRunScopeActive(
    scope: HostedAgentRunScope,
    activeScope: HostedAgentRunScope | null,
    currentProjectId: string,
) {
    return activeScope === scope && !scope.controller.signal.aborted && Boolean(scope.projectId) && scope.projectId === currentProjectId;
}

export function bindHostedAgentRunId(
    scope: HostedAgentRunScope,
    runId: string,
    activeScope: HostedAgentRunScope | null,
    currentProjectId: string,
) {
    scope.runId = runId;
    return isHostedAgentRunScopeActive(scope, activeScope, currentProjectId);
}

export function retireHostedAgentRunId(runId: string) {
    if (!runId) return;
    retiredHostedAgentRunIds.add(runId);
    while (retiredHostedAgentRunIds.size > RETIRED_RUN_LIMIT) {
        retiredHostedAgentRunIds.delete(retiredHostedAgentRunIds.values().next().value!);
    }
}

export function isHostedAgentRunIdRetired(runId: string) {
    return Boolean(runId) && retiredHostedAgentRunIds.has(runId);
}

export function isHostedAgentStateForProject(stateProjectId: string, currentProjectId: string) {
    return Boolean(currentProjectId) && stateProjectId === currentProjectId;
}

export function registerHostedAgentRunStopper(stopper: HostedAgentRunStopper) {
    hostedAgentRunStopper = stopper;
    return () => {
        if (hostedAgentRunStopper === stopper) hostedAgentRunStopper = null;
    };
}

export function stopHostedAgentRunForCanvas(projectId: string, options?: { keepalive?: boolean }) {
    return hostedAgentRunStopper?.(projectId, options) || Promise.resolve();
}

export function settleHostedAgentMessagesOnStop<T extends { streamId?: string; text?: string; detail?: unknown }>(messages: T[], stoppedText: string): T[] {
    return messages.map((item) => {
        const detail = item.detail && typeof item.detail === "object" ? item.detail as Record<string, unknown> : null;
        const status = String(detail?.status || "");
        const runningDetail = Boolean(detail && RUNNING_MESSAGE_STATUSES.has(status));
        if (!item.streamId && !runningDetail) return item;
        return {
            ...item,
            ...(item.streamId ? { streamId: undefined, text: item.text || stoppedText } : {}),
            ...(runningDetail ? { detail: { ...detail, status: "interrupted" } } : {}),
        };
    });
}
