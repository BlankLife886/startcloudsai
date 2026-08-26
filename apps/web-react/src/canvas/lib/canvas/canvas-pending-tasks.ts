export type PendingCanvasTask = {
    nodeId: string;
    taskId: string;
    imageId?: string;
    kind: "image" | "assistant";
};

type PendingCanvasTaskNode = {
    id: string;
    type: string;
    metadata?: {
        status?: string;
        taskId?: string;
        taskKind?: "image" | "assistant";
        images?: Array<{ id: string; status: string; taskId?: string }>;
    };
};

export function pendingCanvasTasks(nodes: PendingCanvasTaskNode[]): PendingCanvasTask[] {
    const targets = new Map<string, { target: PendingCanvasTask; priority: number }>();
    const register = (target: PendingCanvasTask, priority: number) => {
        const key = `${target.kind}:${target.taskId}`;
        if ((targets.get(key)?.priority ?? -1) >= priority) return;
        targets.set(key, { target, priority });
    };
    for (const node of nodes) {
        for (const image of node.metadata?.images || []) {
            if (image.status === "loading" && image.taskId) {
                register({ nodeId: node.id, imageId: image.id, taskId: image.taskId, kind: "image" }, 3);
            }
        }
        if (node.metadata?.status === "loading" && node.metadata.taskId) {
            register({ nodeId: node.id, taskId: node.metadata.taskId, kind: node.metadata.taskKind || "image" }, node.type === "config" || node.type.startsWith("builtin:") ? 1 : 2);
        }
    }
    return [...targets.values()].map(({ target }) => target);
}
