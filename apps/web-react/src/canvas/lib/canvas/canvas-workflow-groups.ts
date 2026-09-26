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

/** Nodes of one group in connection order (inputs before the configs they feed, configs before their outputs). */
export function orderCanvasWorkflowNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set(nodes.map((node) => node.id));
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map<string, string[]>();
    connections.forEach((connection) => {
        if (!ids.has(connection.fromNodeId) || !ids.has(connection.toNodeId) || connection.fromNodeId === connection.toNodeId) return;
        incoming.set(connection.toNodeId, (incoming.get(connection.toNodeId) || 0) + 1);
        outgoing.set(connection.fromNodeId, [...(outgoing.get(connection.fromNodeId) || []), connection.toNodeId]);
    });
    const position = new Map(nodes.map((node, index) => [node.id, index]));
    const ready = nodes.filter((node) => !incoming.get(node.id)).map((node) => node.id);
    const ordered: string[] = [];
    while (ready.length) {
        ready.sort((a, b) => position.get(a)! - position.get(b)!);
        const id = ready.shift()!;
        ordered.push(id);
        (outgoing.get(id) || []).forEach((next) => {
            const left = (incoming.get(next) || 0) - 1;
            incoming.set(next, left);
            if (left === 0) ready.push(next);
        });
    }
    // Cycles keep their original order after everything that could be sorted.
    nodes.forEach((node) => !ordered.includes(node.id) && ordered.push(node.id));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return ordered.map((id) => byId.get(id)!);
}

const GENERIC_TITLES = /^(generated image|generated video|prompt|image|text|video|audio|图片|文本|视频|音频|生成配置|批量配置|html|untitled)$/i;

function cleanTitle(value: string) {
    return value
        .replace(/@\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^\s*\d+\s*[|｜·.、]\s*/, "")
        .replace(/\s*·\s*\d+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

function shorten(value: string, max = 24) {
    const text = cleanTitle(value.split(/\n/)[0] || "");
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A readable name for a workflow: the user's own name, else what it produced, else its prompt, else its input text,
 * so several "生成配置" workflows can be told apart at a glance.
 */
export function canvasWorkflowDisplayName(group: CanvasSidePanelWorkflowGroup, connections: CanvasConnection[]) {
    const config = group.firstConfig;
    if (!config) return "";
    const custom = config.metadata?.workflowName?.trim();
    if (custom) return custom;
    const memberIds = new Set(group.nodes.map((node) => node.id));
    const downstream = new Set(connections.filter((connection) => connection.fromNodeId === config.id && memberIds.has(connection.toNodeId)).map((connection) => connection.toNodeId));
    const upstream = new Set(connections.filter((connection) => connection.toNodeId === config.id && memberIds.has(connection.fromNodeId)).map((connection) => connection.fromNodeId));
    const output = group.nodes
        .filter((node) => downstream.has(node.id) && !isCanvasExecutableNode(node))
        .map((node) => shorten(node.title || ""))
        .find((title) => title && !GENERIC_TITLES.test(title));
    if (output) return output;
    const prompt = shorten(config.metadata?.composerContent || config.metadata?.prompt || "");
    if (prompt) return prompt;
    const input = group.nodes
        .filter((node) => upstream.has(node.id) && node.type === "text")
        .map((node) => shorten(node.metadata?.content || ""))
        .find(Boolean);
    if (input) return input;
    return shorten(config.title || "") || "";
}
