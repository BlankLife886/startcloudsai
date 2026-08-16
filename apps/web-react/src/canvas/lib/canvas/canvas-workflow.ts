import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasWorkflowCompileError = "empty" | "cycle";

export type CanvasWorkflowPlan = {
    nodeIds: string[];
    layers: string[][];
    dependencies: Map<string, Set<string>>;
};

export type CanvasWorkflowCompileResult =
    | { ok: true; plan: CanvasWorkflowPlan }
    | { ok: false; reason: CanvasWorkflowCompileError; nodeIds: string[] };

/** Compile generation-config nodes into a stable, dependency-ordered execution plan. */
export function compileCanvasWorkflow(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasWorkflowCompileResult {
    const executableNodes = nodes.filter((node) => node.type === "config");
    if (!executableNodes.length) return { ok: false, reason: "empty", nodeIds: [] };

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const connection of connections) {
        if (!nodeById.has(connection.fromNodeId) || !nodeById.has(connection.toNodeId)) continue;
        const sources = incoming.get(connection.toNodeId) || [];
        sources.push(connection.fromNodeId);
        incoming.set(connection.toNodeId, sources);
    }

    const executableIds = new Set(executableNodes.map((node) => node.id));
    const dependencies = new Map<string, Set<string>>();
    for (const node of executableNodes) {
        dependencies.set(node.id, findConfigDependencies(node.id, executableIds, nodeById, incoming));
    }

    const remaining = new Map([...dependencies].map(([nodeId, deps]) => [nodeId, new Set(deps)]));
    const orderIndex = new Map(executableNodes.map((node, index) => [node.id, index]));
    const layers: string[][] = [];

    while (remaining.size) {
        const ready = [...remaining]
            .filter(([, deps]) => deps.size === 0)
            .map(([nodeId]) => nodeId)
            .sort((a, b) => (orderIndex.get(a) || 0) - (orderIndex.get(b) || 0));
        if (!ready.length) return { ok: false, reason: "cycle", nodeIds: [...remaining.keys()] };
        layers.push(ready);
        ready.forEach((nodeId) => remaining.delete(nodeId));
        remaining.forEach((deps) => ready.forEach((nodeId) => deps.delete(nodeId)));
    }

    return { ok: true, plan: { nodeIds: layers.flat(), layers, dependencies } };
}

export function findWorkflowOutputNodes(producerNodeId: string, outputType: string, nodes: CanvasNodeData[], connections: CanvasConnection[] = []) {
    const producer = nodes.find((node) => node.id === producerNodeId);
    const explicitIds = producer?.metadata?.workflowOutputNodeIds || [];
    const explicit = explicitIds
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node): node is CanvasNodeData => Boolean(node && node.type === outputType));
    if (explicit.length) return explicit;
    const attributed = nodes.filter((node) => node.type === outputType && node.metadata?.workflowProducerNodeId === producerNodeId);
    if (attributed.length) return attributed;
    const outputIds = new Set(connections.filter((connection) => connection.fromNodeId === producerNodeId).map((connection) => connection.toNodeId));
    return nodes.filter((node) => node.type === outputType && outputIds.has(node.id));
}

function findConfigDependencies(nodeId: string, executableIds: Set<string>, nodeById: Map<string, CanvasNodeData>, incoming: Map<string, string[]>) {
    const dependencies = new Set<string>();
    const visited = new Set<string>([nodeId]);
    const queue = [...(incoming.get(nodeId) || [])];

    while (queue.length) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        if (!nodeById.has(currentId)) continue;
        if (executableIds.has(currentId)) {
            dependencies.add(currentId);
            continue;
        }
        queue.push(...(incoming.get(currentId) || []));
    }

    return dependencies;
}
