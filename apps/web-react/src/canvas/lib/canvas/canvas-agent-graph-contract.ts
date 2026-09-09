export type CanvasAgentGraphContractNode = {
    key: string;
    type: string;
    generationMode?: string;
};

export type CanvasAgentGraphContractEdge = { from: string; to: string };

const GENERATION_MODES = new Set(["text", "image", "video", "audio"]);

export function resolveCanvasAgentGraphModes(nodes: CanvasAgentGraphContractNode[], edges: CanvasAgentGraphContractEdge[]) {
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    for (const edge of edges) {
        const from = nodeByKey.get(edge.from);
        const to = nodeByKey.get(edge.to);
        if (from?.type === "config" && to?.type === "config") {
            throw new Error(`配置节点“${from.key}”不能直接连接配置节点“${to.key}”，请在两者之间加入输出资源节点`);
        }
        if (from?.type === "group" || to?.type === "group") throw new Error("组节点不能参与工作流连线");
    }

    const modes = new Map<string, "text" | "image" | "video" | "audio">();
    for (const node of nodes) {
        if (node.type !== "config") continue;
        const outputs = edges
            .filter((edge) => edge.from === node.key)
            .map((edge) => nodeByKey.get(edge.to))
            .filter((output): output is CanvasAgentGraphContractNode => Boolean(output && GENERATION_MODES.has(output.type)));
        const requestedMode = GENERATION_MODES.has(node.generationMode || "") ? node.generationMode : undefined;
        const mode = (requestedMode || outputs[0]?.type || "image") as "text" | "image" | "video" | "audio";
        if (!outputs.some((output) => output.type === mode)) {
            throw new Error(`配置节点“${node.key}”缺少与 ${mode} 模式匹配的 ${mode} 输出节点`);
        }
        modes.set(node.key, mode);
    }
    return modes;
}
