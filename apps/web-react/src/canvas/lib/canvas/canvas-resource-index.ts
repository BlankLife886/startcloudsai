import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../types/canvas";

/** A shared adjacency index for one immutable graph snapshot. Edge order is preserved. */
export function createCanvasResourceIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, CanvasNodeData[]>();
    const outgoing = new Map<string, CanvasNodeData[]>();
    for (const connection of connections) {
        const from = nodesById.get(connection.fromNodeId);
        const to = nodesById.get(connection.toNodeId);
        if (!from || !to) continue;
        const inputs = incoming.get(to.id);
        if (inputs) inputs.push(from);
        else incoming.set(to.id, [from]);
        const outputs = outgoing.get(from.id);
        if (outputs) outputs.push(to);
        else outgoing.set(from.id, [to]);
    }
    return { nodesById, incoming, outgoing };
}

export type CanvasResourceIndex = ReturnType<typeof createCanvasResourceIndex>;

/** Internal outputs belong to their producer even though they have no selectable card. */
export function collectCanvasOwnedOutputIds(nodes: CanvasNodeData[], selectedIds: Set<string>) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const outputs = new Map<string, Set<string>>();
    const add = (owner: string, id: string) => {
        if (!byId.get(id)?.metadata?.hidden) return;
        const ids = outputs.get(owner) || new Set<string>();
        ids.add(id);
        outputs.set(owner, ids);
    };
    for (const node of nodes) {
        if (node.metadata?.workflowProducerNodeId) add(node.metadata.workflowProducerNodeId, node.id);
        if (node.metadata?.inlineOutputNodeId) add(node.id, node.metadata.inlineOutputNodeId);
        node.metadata?.workflowOutputNodeIds?.forEach((id) => add(node.id, id));
    }
    const ids = new Set(selectedIds);
    const queue = [...ids];
    for (let i = 0; i < queue.length; i++) {
        for (const id of outputs.get(queue[i]) || []) {
            if (ids.has(id)) continue;
            ids.add(id);
            queue.push(id);
        }
    }
    return ids;
}

/**
 * Expand a canvas selection to the nodes that should move as one visual unit.
 * Storyboard shots are represented by an image and a caption node, so moving
 * either half must preserve their alignment. Group dragging keeps its existing
 * direct-child behavior; ordinary nodes remain untouched.
 */
export function collectCanvasDragNodeIds(nodes: CanvasNodeData[], selectedIds: Set<string>) {
    const ids = new Set(selectedIds);
    const selected = nodes.filter((node) => selectedIds.has(node.id));
    selected.forEach((node) => {
        if (node.type === CanvasNodeType.Group) {
            nodes.forEach((child) => {
                if (child.metadata?.groupId === node.id) ids.add(child.id);
            });
        }

        const storyboardId = node.metadata?.storyboardId;
        const sceneId = node.metadata?.storyboardSceneId;
        if (!storyboardId || !sceneId) return;
        nodes.forEach((peer) => {
            if (peer.type !== CanvasNodeType.Image && peer.type !== CanvasNodeType.Text) return;
            if (peer.metadata?.storyboardId === storyboardId && peer.metadata?.storyboardSceneId === sceneId) ids.add(peer.id);
        });
    });
    return ids;
}
