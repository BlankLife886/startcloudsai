type AgentRunActivityItem = {
    role: string;
    text: string;
    streamId?: string;
    detail?: unknown;
};

const ACTIVE_TOOL_STATUSES = new Set(["inprogress", "in_progress", "running", "started", "pending"]);

export function hasVisibleAgentRunActivity(messages: AgentRunActivityItem[]) {
    let turnStart = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index].role === "user") {
            turnStart = index;
            break;
        }
    }
    for (let index = turnStart + 1; index < messages.length; index++) {
        const item = messages[index];
        if (item.streamId && item.text.trim()) return true;
        if (item.role !== "tool" || !item.text.trim() || !item.detail || typeof item.detail !== "object") continue;
        const status = String((item.detail as { status?: unknown }).status || "").toLowerCase();
        if (ACTIVE_TOOL_STATUSES.has(status)) return true;
    }
    return false;
}
