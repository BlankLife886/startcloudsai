import type { CanvasConnection, CanvasNodeData } from "../../types/canvas";

const PREFIX = "startclouds-canvas:";
const MAX_CLIPBOARD_LENGTH = 16 * 1024 * 1024;
const MAX_CLIPBOARD_NODES = 20_000;

export type CanvasNodeClipboard = {
    version: 1;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

/** Copy groups as a subtree, including internal workflow outputs, in canvas order. */
export function createCanvasNodeClipboard(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: Set<string>): CanvasNodeClipboard | null {
    const children = new Map<string, string[]>();
    for (const node of nodes) {
        const owners = [node.metadata?.groupId, node.metadata?.hidden ? node.metadata?.workflowProducerNodeId : undefined];
        for (const owner of owners) {
            if (!owner) continue;
            const items = children.get(owner);
            if (items) items.push(node.id);
            else children.set(owner, [node.id]);
        }
    }
    const ids = new Set(selectedIds);
    const queue = [...ids];
    for (let i = 0; i < queue.length; i++) {
        for (const id of children.get(queue[i]) || []) {
            if (ids.has(id)) continue;
            ids.add(id);
            queue.push(id);
        }
    }
    const copied = nodes.filter((node) => ids.has(node.id));
    if (!copied.length) return null;
    return structuredClone({
        version: 1,
        nodes: copied,
        connections: connections.filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)),
    });
}

export function serializeCanvasNodeClipboard(clipboard: CanvasNodeClipboard) {
    const text = PREFIX + JSON.stringify(clipboard);
    if (text.length > MAX_CLIPBOARD_LENGTH || clipboard.nodes.length > MAX_CLIPBOARD_NODES) throw new Error("复制内容过大，请分批复制或导出画布");
    return text;
}

/** Ordinary text is not intercepted; invalid or legacy canvas payloads never become UUID text nodes. */
export function parseCanvasNodeClipboard(text: string): CanvasNodeClipboard | null {
    if (!text.startsWith(PREFIX)) return null;
    if (text.length > MAX_CLIPBOARD_LENGTH) throw new Error("画布剪贴板内容过大，请分批复制");
    let payload: CanvasNodeClipboard;
    try {
        payload = JSON.parse(text.slice(PREFIX.length));
    } catch {
        throw new Error("剪贴板中的画布内容已失效，请重新复制节点");
    }
    if (!payload || payload.version !== 1 || !Array.isArray(payload.nodes) || !payload.nodes.length || payload.nodes.length > MAX_CLIPBOARD_NODES || !Array.isArray(payload.connections)) throw new Error("无法读取画布剪贴板，请重新复制节点");
    const ids = new Set<string>();
    for (const node of payload.nodes) {
        if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id) || typeof node.type !== "string" || !node.type || typeof node.title !== "string" || !node.position || ![node.position.x, node.position.y, node.width, node.height].every((value) => typeof value === "number" && Number.isFinite(value)) || node.width <= 0 || node.height <= 0 || (node.metadata != null && (typeof node.metadata !== "object" || Array.isArray(node.metadata)))) throw new Error("剪贴板中的节点数据不完整，请重新复制");
        ids.add(node.id);
    }
    for (const edge of payload.connections) {
        if (!edge || typeof edge.id !== "string" || !ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) throw new Error("剪贴板中的连线数据不完整，请重新复制");
    }
    return payload;
}
