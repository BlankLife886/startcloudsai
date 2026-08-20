import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { isCanvasNodeTypeEnabled } from "@/constant/canvas";
import { layoutCanvasGraph } from "@/lib/canvas/canvas-graph-layout";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId?: string; toNodeId?: string; from?: string; to?: string }
    | { type: "create_generation_flow"; id?: string; prompt?: string; title?: string; x?: number; y?: number; position?: { x: number; y: number } }
    | { type: "create_graph"; nodes?: CanvasAgentGraphNode[]; edges?: CanvasAgentGraphEdge[]; x?: number; y?: number; position?: { x: number; y: number } }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string }
    | { type: "move_nodes"; items?: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> }
    | { type: "resize_node"; id: string; width?: number; height?: number; freeResize?: boolean };

export type CanvasAgentGraphNode = { key?: string; type?: CanvasNodeTypeId; title?: string; text?: string };
export type CanvasAgentGraphEdge = { from?: string; to?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

const FLOW_GAP = 72;
const GRAPH_ROW_GAP = 48;

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;
    const addedIds: string[] = [];
    const preferredIds = new Set(snapshot.selectedNodeIds);

    expandCanvasAgentOps(ops, snapshot).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = op.nodeType && isRegisteredNodeType(op.nodeType) ? op.nodeType : CanvasNodeType.Text;
            if (!isCanvasNodeTypeEnabled(nodeType)) return;
            const spec = getNodeSpec(nodeType);
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
            addedIds.push(node.id);
            preferredIds.add(node.id);
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            nodes = nodes.map((node) => (node.id === op.id ? { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } } : node));
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            connections = connectNodes(nodes, connections, op.fromNodeId || op.from, op.toNodeId || op.to, preferredIds, op.id);
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).map((id) => resolveNodeRef(id, nodes, preferredIds)).filter(Boolean);
        if (op.type === "move_nodes") {
            const items = new Map((op.items || []).filter((item) => item?.id).map((item) => [item.id, item]));
            nodes = nodes.map((node) => {
                const item = items.get(node.id);
                if (!item) return node;
                const x = Number.isFinite(item.x) ? Number(item.x) : node.position.x + (Number(item.dx) || 0);
                const y = Number.isFinite(item.y) ? Number(item.y) : node.position.y + (Number(item.dy) || 0);
                return { ...node, position: { x, y } };
            });
        }
        if (op.type === "resize_node" && op.id) {
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                return {
                    ...node,
                    width: Number(op.width) > 0 ? Number(op.width) : node.width,
                    height: Number(op.height) > 0 ? Number(op.height) : node.height,
                    metadata: op.freeResize ? { ...node.metadata, freeResize: true } : node.metadata,
                };
            });
        }
    });

    // A create_graph already carries its own edges; guessing extra links there
    // would corrupt multi-branch workflows.
    if (!(ops || []).some((op) => op?.type === "create_graph")) {
        connections = autoWireGenerationChain(nodes, connections, snapshot.selectedNodeIds, addedIds);
    }

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function expandCanvasAgentOps(ops: CanvasAgentOp[] | undefined, snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
    const expanded: CanvasAgentOp[] = [];
    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        if (op?.type === "create_generation_flow") {
            expanded.push(...generationFlowOps(op, snapshot, index));
            return;
        }
        if (op?.type === "create_graph") {
            expanded.push(...graphOps(op, snapshot, index));
            return;
        }
        if (op?.type) expanded.push(op);
    });
    return expanded;
}

function generationFlowOps(op: Extract<CanvasAgentOp, { type: "create_generation_flow" }>, snapshot: CanvasAgentSnapshot, index: number): CanvasAgentOp[] {
    const origin = op.position || { x: op.x ?? flowOriginX(snapshot) + index * 40, y: op.y ?? flowOriginY(snapshot) };
    const prompt = String(op.prompt || "").trim();
    const textId = `text-${nanoid(6)}`;
    const configId = `config-${nanoid(6)}`;
    const imageId = `image-${nanoid(6)}`;
    const textSpec = getNodeSpec(CanvasNodeType.Text);
    const configSpec = getNodeSpec(CanvasNodeType.Config);
    const imageSpec = getNodeSpec(CanvasNodeType.Image);
    const configX = origin.x + textSpec.width + FLOW_GAP;
    const imageX = configX + configSpec.width + FLOW_GAP;
    return [
        { type: "add_node", id: textId, nodeType: CanvasNodeType.Text, title: op.title || textSpec.title, x: origin.x, y: origin.y, metadata: { content: prompt, status: "success" } },
        { type: "add_node", id: configId, nodeType: CanvasNodeType.Config, title: configSpec.title, x: configX, y: origin.y },
        { type: "add_node", id: imageId, nodeType: CanvasNodeType.Image, title: imageSpec.title, x: imageX, y: origin.y },
        { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
        { type: "connect_nodes", fromNodeId: configId, toNodeId: imageId },
    ];
}

function graphOps(op: Extract<CanvasAgentOp, { type: "create_graph" }>, snapshot: CanvasAgentSnapshot, index: number): CanvasAgentOp[] {
    const plans = (op.nodes || [])
        .map((node, order) => {
            const type = node?.type && isRegisteredNodeType(node.type) ? node.type : CanvasNodeType.Text;
            const spec = getNodeSpec(type);
            return { key: String(node?.key || `n${order + 1}`).trim() || `n${order + 1}`, type, spec, title: node?.title, text: String(node?.text || "").trim() };
        })
        .filter((plan) => isCanvasNodeTypeEnabled(plan.type));
    if (!plans.length) return [];

    const ids = new Map(plans.map((plan) => [plan.key, `${plan.type}-${nanoid(6)}`]));
    const origin = op.position || { x: op.x ?? flowOriginX(snapshot) + index * 40, y: op.y ?? flowOriginY(snapshot) };
    const { positions, edges } = layoutCanvasGraph(
        plans.map((plan) => ({ key: plan.key, width: plan.spec.width, height: plan.spec.height })),
        (op.edges || []).map((edge) => ({ from: String(edge?.from || "").trim(), to: String(edge?.to || "").trim() })),
        { originX: origin.x, originY: origin.y, columnGap: FLOW_GAP, rowGap: GRAPH_ROW_GAP },
    );

    const ops: CanvasAgentOp[] = plans.map((plan) => ({
        type: "add_node",
        id: ids.get(plan.key),
        nodeType: plan.type,
        title: plan.title || plan.spec.title,
        x: positions.get(plan.key)?.x ?? origin.x,
        y: positions.get(plan.key)?.y ?? origin.y,
        ...(plan.text ? { metadata: { content: plan.text, status: "success" } } : {}),
    }));
    edges.forEach((edge) => {
        ops.push({ type: "connect_nodes", fromNodeId: ids.get(edge.from), toNodeId: ids.get(edge.to) });
    });
    return ops;
}

function flowOriginX(snapshot: CanvasAgentSnapshot) {
    if (!snapshot.nodes.length) return Math.round((-snapshot.viewport.x + 80) / (snapshot.viewport.k || 1));
    return Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + FLOW_GAP;
}

function flowOriginY(snapshot: CanvasAgentSnapshot) {
    if (!snapshot.nodes.length) return Math.round((-snapshot.viewport.y + 80) / (snapshot.viewport.k || 1));
    return snapshot.nodes[0]?.position.y || 0;
}

function connectNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], fromRef: string | undefined, toRef: string | undefined, preferredIds: Set<string>, id?: string) {
    const fromNodeId = resolveNodeRef(fromRef, nodes, preferredIds);
    const toNodeId = resolveNodeRef(toRef, nodes, preferredIds, fromNodeId);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return connections;
    if (connections.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId)) return connections;
    return [...connections, { id: id || nanoid(), fromNodeId, toNodeId }];
}

function resolveNodeRef(ref: string | undefined, nodes: CanvasNodeData[], preferredIds: Set<string>, excludeId = "") {
    const value = String(ref || "").trim();
    if (!value) return "";
    const pool = nodes.filter((node) => node.id !== excludeId);
    if (pool.some((node) => node.id === value)) return value;
    const ranked = [...pool].sort((left, right) => Number(preferredIds.has(right.id)) - Number(preferredIds.has(left.id)));
    const byTitle = ranked.find((node) => node.title === value || node.title.includes(value) || value.includes(node.title));
    if (byTitle) return byTitle.id;
    const byType = ranked.find((node) => node.type === value);
    return byType?.id || "";
}

function autoWireGenerationChain(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: string[], addedIds: string[]) {
    if (!addedIds.length) return connections;
    const added = new Set(addedIds);
    const pool = nodes.filter((node) => added.has(node.id) || selectedIds.includes(node.id));
    const pick = (type: string) => {
        const matches = pool.filter((node) => node.type === type).sort((left, right) => left.position.x - right.position.x);
        return matches.find((node) => selectedIds.includes(node.id)) || matches.find((node) => added.has(node.id)) || matches[0];
    };
    const chain = [pick("text"), pick("config"), pick("image")].filter((node): node is CanvasNodeData => Boolean(node));
    if (chain.length < 2) return connections;
    let next = connections;
    for (let index = 0; index < chain.length - 1; index += 1) {
        next = connectNodes(nodes, next, chain[index].id, chain[index + 1].id, new Set(addedIds));
    }
    return next;
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}
