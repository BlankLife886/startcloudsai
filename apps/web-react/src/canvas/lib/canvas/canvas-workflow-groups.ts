import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { isCanvasExecutableNode } from "./canvas-operation-node.ts";

export type CanvasSidePanelWorkflowGroup = {
    id: string;
    nodes: CanvasNodeData[];
    firstConfig?: CanvasNodeData;
};

/** Group connected generation branches while keeping unconnected resources together. */
export function buildCanvasSidePanelWorkflowGroups(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasSidePanelWorkflowGroup[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]));
    connections.forEach((connection) => {
        if (!nodeById.has(connection.fromNodeId) || !nodeById.has(connection.toNodeId)) return;
        adjacent.get(connection.fromNodeId)?.add(connection.toNodeId);
        adjacent.get(connection.toNodeId)?.add(connection.fromNodeId);
    });

    const visited = new Set<string>();
    const workflowGroups: CanvasSidePanelWorkflowGroup[] = [];
    const standaloneNodes: CanvasNodeData[] = [];
    for (const root of nodes) {
        if (visited.has(root.id)) continue;
        const pending = [root.id];
        const componentIds = new Set<string>();
        while (pending.length) {
            const nodeId = pending.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);
            componentIds.add(nodeId);
            adjacent.get(nodeId)?.forEach((relatedId) => {
                if (!visited.has(relatedId)) pending.push(relatedId);
            });
        }
        const component = nodes.filter((node) => componentIds.has(node.id));
        const firstConfig = component.find((node) => isCanvasExecutableNode(node));
        if (firstConfig) workflowGroups.push({ id: `workflow:${firstConfig.id}`, nodes: component, firstConfig });
        else standaloneNodes.push(...component);
    }

    return standaloneNodes.length ? [...workflowGroups, { id: "standalone", nodes: standaloneNodes }] : workflowGroups;
}

export function canvasWorkflowNodeIds(nodes: CanvasNodeData[], connections: CanvasConnection[], workflowId: string) {
    return buildCanvasSidePanelWorkflowGroups(nodes, connections).find((group) => group.id === workflowId)?.nodes.map((node) => node.id) || [];
}
