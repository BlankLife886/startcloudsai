import type { CanvasAgentSnapshot } from "./canvas-agent-ops.ts";
import { canvasWorkflowNodeOutputFingerprint } from "./canvas-workflow.ts";

export function reviewCanvasOutputs(snapshot: CanvasAgentSnapshot, input: { nodeIds: string[]; offset?: number; requestId?: string; fingerprints?: Record<string, string> }) {
    const ids = new Set(input.nodeIds);
    const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
    const issues: string[] = [];
    const outputs = new Set<string>();
    for (const id of ids) {
        const node = byId.get(id);
        if (!node) { issues.push(`节点 ${id} 已不存在`); continue; }
        if (input.requestId && node.metadata?.agentGenerationRequestId !== input.requestId) issues.push(`${node.title} 已不属于本次生成，不能验收为原任务结果`);
        if (input.fingerprints?.[id] && canvasWorkflowNodeOutputFingerprint(id, snapshot.nodes, snapshot.connections) !== input.fingerprints[id]) issues.push(`${node.title} 的结果在运行结束后发生变化`);
        const produced = new Set([...(node.metadata?.workflowOutputNodeIds || []), ...(node.metadata?.inlineOutputNodeId ? [node.metadata.inlineOutputNodeId] : [])]);
        snapshot.nodes.forEach(item => { if (item.metadata?.workflowProducerNodeId === id) produced.add(item.id); });
        snapshot.connections.forEach(edge => { if (edge.fromNodeId === id && ["image", "text"].includes(byId.get(edge.toNodeId)?.type || "")) produced.add(edge.toNodeId); });
        if (!produced.size && ["image", "text"].includes(node.type)) produced.add(id);
        if (!produced.size) issues.push(`${node.title} 没有结果节点`);
        const actual = [...produced].reduce((count, id) => { const data = byId.get(id)?.metadata; return count + (data?.images?.length ? data.images.filter(image => image.status === "success" && (image.content || image.storageKey)).length : data?.content || data?.storageKey ? 1 : 0); }, 0);
        if (actual < Math.max(1, Number(node.metadata?.count) || 1)) issues.push(`${node.title} 的产物数量不足`);
        produced.forEach(id => outputs.add(id));
    }
    const items = [...outputs].flatMap((id): Array<{ id: string; type: string; title: string; text?: string; resourceId?: string }> => {
        const node = byId.get(id);
        if (!node) { issues.push(`结果节点 ${id} 缺失`); return []; }
        const metadata = node.metadata || {};
        if (metadata.status === "error" || metadata.status === "loading" || metadata.deletedByHistory || metadata.images?.some(image => image.status !== "success")) issues.push(`${node.title} 的结果未全部就绪或不可用`);
        if (!metadata.content && !metadata.storageKey && !metadata.images?.some(image => image.status === "success" && (image.content || image.storageKey))) issues.push(`${node.title} 没有生成内容`);
        if (node.type === "text") {
            const chars = Array.from(String(metadata.content || ""));
            const chunks = [];
            for (let start = 0; start < Math.max(chars.length, 1); start += 2000) chunks.push({ id, type: "text", title: `${node.title}（${start + 1}–${Math.min(start + 2000, chars.length)}）`, text: chars.slice(start, start + 2000).join("") });
            return chunks;
        }
        const images = (metadata.images || []).filter(image => image.content || image.storageKey);
        if (images.length) return images.map((image, index) => ({ id, type: "image", title: `${node.title} ${index + 1}`, resourceId: `${id}:${image.id || `image-${index + 1}`}` }));
        return [{ id, type: node.type, title: node.title, resourceId: node.type === "image" ? `${id}:${metadata.primaryImageId || "primary"}` : undefined }];
    });
    const offset = Math.max(0, Math.floor(input.offset || 0));
    const page = items.slice(offset, offset + 4);
    const nextOffset = offset + page.length < items.length ? offset + page.length : undefined;
    return { total: items.length, offset, items: page, issues, ...(nextOffset !== undefined ? { nextOffset } : {}), imageNodeIds: [...new Set(page.filter(item => item.type === "image").map(item => item.id))], imageResourceIds: page.flatMap(item => item.resourceId ? [item.resourceId] : []) };
}
