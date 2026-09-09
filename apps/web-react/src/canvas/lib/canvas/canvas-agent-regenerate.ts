import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeData } from "@/types/canvas";

export const MAX_CANVAS_AGENT_REGENERATION_SOURCES = 80;

export function resolveCanvasAgentRegenerationSourceIds(input: {
    replayIds?: string[];
    liveSelectedIds: string[];
    isValidSourceId: (id: string) => boolean;
}) {
    const uniqueIds = (ids: string[]) => [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
    const replayIds = uniqueIds(input.replayIds || []);
    const selectedIds = replayIds.length ? replayIds : uniqueIds(input.liveSelectedIds);
    return selectedIds.filter(input.isValidSourceId);
}

export type CanvasAgentRegenerationItem = {
    sourceNodeId: string;
    configNodeId: string;
    outputNodeId: string;
    created: boolean;
};

export function planCanvasAgentRegeneration(input: {
    nodes: CanvasNodeData[];
    sourceNodes: CanvasNodeData[];
    batchId: string;
    instruction: string;
    createId: (type: "config" | "image") => string;
    configSize: { width: number; height: number };
    imageSize: { width: number; height: number };
}) {
    const configSpec = input.configSize;
    const imageSpec = input.imageSize;
    const laneHeight = Math.max(configSpec.height, imageSpec.height);
    const configX = Math.max(...input.sourceNodes.map((node) => node.position.x + node.width)) + 96;
    const outputX = configX + configSpec.width + 96;
    const sortedSources = [...input.sourceNodes].sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x);
    const planned = new Map<string, CanvasAgentRegenerationItem & { y: number }>();
    let laneBottom = Number.NEGATIVE_INFINITY;

    sortedSources.forEach((source) => {
        const existingConfig = input.nodes.find((node) => node.type === "config" && node.metadata?.agentRequestId === input.batchId && node.metadata?.agentSourceNodeId === source.id);
        const existingOutput = input.nodes.find((node) => node.type === "image" && node.metadata?.agentRequestId === input.batchId && node.metadata?.agentSourceNodeId === source.id);
        const preferredY = source.position.y + source.height / 2 - laneHeight / 2;
        const y = Math.max(preferredY, laneBottom + 48);
        laneBottom = y + laneHeight;
        planned.set(source.id, {
            sourceNodeId: source.id,
            configNodeId: existingConfig?.id || input.createId("config"),
            outputNodeId: existingOutput?.id || input.createId("image"),
            y,
            created: !(existingConfig && existingOutput),
        });
    });

    const items = input.sourceNodes.map((source) => planned.get(source.id)!);
    const ops: CanvasAgentOp[] = [];
    items.forEach((item) => {
        if (!item.created) return;
        const source = input.nodes.find((node) => node.id === item.sourceNodeId)!;
        const sharedMetadata = { agentRequestId: input.batchId, agentBatchId: input.batchId, agentSourceNodeId: source.id };
        ops.push(
            {
                type: "add_node",
                id: item.configNodeId,
                nodeType: "config",
                title: `${source.title || "参考图"} · 重生成`,
                x: configX,
                y: item.y + (laneHeight - configSpec.height) / 2,
                metadata: { ...sharedMetadata, composerContent: input.instruction, prompt: input.instruction, generationMode: "image", count: 1, status: "idle" },
            },
            {
                type: "add_node",
                id: item.outputNodeId,
                nodeType: "image",
                title: `${source.title || "参考图"} · 新结果`,
                x: outputX,
                y: item.y + (laneHeight - imageSpec.height) / 2,
                metadata: { ...sharedMetadata, prompt: input.instruction, status: "idle", workflowProducerNodeId: item.configNodeId },
            },
            { type: "connect_nodes", fromNodeId: item.sourceNodeId, toNodeId: item.configNodeId },
            { type: "connect_nodes", fromNodeId: item.configNodeId, toNodeId: item.outputNodeId },
        );
    });
    ops.push({ type: "select_nodes", ids: items.map((item) => item.outputNodeId) });

    return {
        items: items.map(({ y: _y, ...item }) => item),
        ops,
        createdBranches: items.filter((item) => item.created).length,
    };
}
