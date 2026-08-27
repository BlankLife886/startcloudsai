import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { isCanvasNodeTypeEnabled } from "@/constant/canvas";
import { validCanvasAgentOps } from "./canvas-agent-op-validation.js";
import { arrangeCanvasNodes, layoutCanvasGraph } from "@/lib/canvas/canvas-graph-layout";
import { applyCanvasAgentNodeUpdate, canvasAgentGraphTextMetadata, type CanvasAgentNodePatch } from "@/lib/canvas/canvas-agent-node-metadata";
import { resolveCanvasAgentGraphModes } from "@/lib/canvas/canvas-agent-graph-contract";
import { canvasWorkflowNodeIds } from "@/lib/canvas/canvas-workflow-groups";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; title?: string; patch?: CanvasAgentNodePatch; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId?: string; toNodeId?: string; from?: string; to?: string }
    | { type: "create_generation_flow"; id?: string; prompt?: string; title?: string; x?: number; y?: number; position?: { x: number; y: number } }
    | { type: "create_graph"; nodes?: CanvasAgentGraphNode[]; edges?: CanvasAgentGraphEdge[]; x?: number; y?: number; position?: { x: number; y: number } }
    | { type: "arrange_nodes"; scope?: "all" | "selection" | "workflow"; workflowId?: string; direction?: "LR" | "TB" }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string }
    | { type: "move_nodes"; items?: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> }
    | { type: "resize_node"; id: string; width?: number; height?: number; freeResize?: boolean };

export type CanvasAgentGraphNode = { key?: string; type?: CanvasNodeTypeId; title?: string; text?: string; composerContent?: string; generationMode?: "text" | "image" | "video" | "audio" };
export type CanvasAgentGraphEdge = { from?: string; to?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

export type CanvasAgentApplyReport = {
    requested: number;
    accepted: number;
    applied: number;
    rejected: number;
    errors: string[];
};

export type CanvasAgentApplyResult = CanvasAgentSnapshot & { agentReport: CanvasAgentApplyReport };

const FLOW_GAP = 72;
const GRAPH_ROW_GAP = 48;
const MAX_CANVAS_COORDINATE = 1_000_000;
const MIN_AGENT_NODE_SIZE = 80;
const MAX_AGENT_NODE_SIZE = 4_096;

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
    const validated = validCanvasAgentOps(snapshot, ops);
    const appliedSources = new Set<number>();
    const errors: string[] = [];
    let expandedIndex = 0;

    const applyExpandedOp = ({ op, sourceIndex }: { op: CanvasAgentOp; sourceIndex: number }) => {
        const index = expandedIndex++;
        if (!op?.type) return;
        let changed = false;
        if (op.type === "add_node") {
            const nodeType = op.nodeType && isRegisteredNodeType(op.nodeType) ? op.nodeType : CanvasNodeType.Text;
            if (!isCanvasNodeTypeEnabled(nodeType)) return;
            const spec = getNodeSpec(nodeType);
            const requestedPosition = op.position || { x: op.x, y: op.y };
            const id = cleanId(op.id) || `${nodeType}-${nanoid(8)}`;
            if (nodes.some((node) => node.id === id)) return;
            const node: CanvasNodeData = {
                id,
                type: nodeType,
                title: op.title || spec.title,
                position: { x: boundedCoordinate(requestedPosition.x, index * 36), y: boundedCoordinate(requestedPosition.y, index * 36) },
                width: boundedNodeSize(op.width, spec.width),
                height: boundedNodeSize(op.height, spec.height),
                metadata: { ...spec.metadata, ...op.metadata },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
            changed = true;
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                const updated = applyCanvasAgentNodeUpdate(node, op);
                if (updated === node) return node;
                changed = true;
                return updated;
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            const nextNodes = nodes.filter((node) => !ids.has(node.id));
            const nextConnections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            const nextSelectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
            changed = nextNodes.length !== nodes.length || nextConnections.length !== connections.length || nextSelectedNodeIds.length !== selectedNodeIds.length;
            nodes = nextNodes;
            connections = nextConnections;
            selectedNodeIds = nextSelectedNodeIds;
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            const nextConnections = connections.filter((conn) => !ids.has(conn.id));
            changed = nextConnections.length !== connections.length;
            connections = nextConnections;
        }
        if (op.type === "connect_nodes") {
            const nextConnections = connectNodes(nodes, connections, op.fromNodeId || op.from, op.toNodeId || op.to, op.id);
            changed = nextConnections !== connections;
            connections = nextConnections;
        }
        if (op.type === "set_viewport" && isFiniteViewport(op.viewport)) {
            const nextViewport = { x: boundedCoordinate(op.viewport.x, viewport.x), y: boundedCoordinate(op.viewport.y, viewport.y), k: Math.min(Math.max(Number(op.viewport.k), 0.05), 5) };
            changed = nextViewport.x !== viewport.x || nextViewport.y !== viewport.y || nextViewport.k !== viewport.k;
            viewport = nextViewport;
        }
        if (op.type === "select_nodes") {
            const nextSelectedNodeIds = uniqueIds(op.ids || []).filter((id) => nodes.some((node) => node.id === id));
            changed = !canvasAgentStringArrayEqual(nextSelectedNodeIds, selectedNodeIds);
            selectedNodeIds = nextSelectedNodeIds;
        }
        if (op.type === "arrange_nodes") {
            try {
                let selectedKeys = selectedNodeIds;
                if (op.scope === "workflow") {
                    selectedKeys = canvasWorkflowNodeIds(nodes, connections, op.workflowId || "");
                    if (!selectedKeys.length) throw new Error(`工作流不存在：${op.workflowId || "未指定"}`);
                }
                const scopedLayout = op.scope === "selection" || op.scope === "workflow";
                const arranged = arrangeCanvasNodes(
                    nodes.map((node) => ({
                        key: node.id,
                        x: node.position.x,
                        y: node.position.y,
                        width: node.width,
                        height: node.height,
                        groupKey: node.metadata?.groupId,
                        isGroup: node.type === CanvasNodeType.Group,
                    })),
                    connections.map((connection) => ({ from: connection.fromNodeId, to: connection.toNodeId })),
                    {
                        scope: scopedLayout ? "selection" : "all",
                        selectedKeys,
                        direction: op.direction === "TB" ? "TB" : "LR",
                        columnGap: FLOW_GAP,
                        rowGap: GRAPH_ROW_GAP,
                    },
                );
                const dimensions = new Map(nodes.map((node) => [node.id, { width: node.width, height: node.height }]));
                const positions = fitCanvasAgentPositions(arranged.positions, dimensions);
                if (scopedLayout && canvasAgentPositionsOverlapFixedNodes(positions, nodes)) {
                    throw new Error("选中节点在画布边界内没有可用的不重叠布局空间");
                }
                nodes = nodes.map((node) => {
                    const position = positions.get(node.id);
                    if (!position || (position.x === node.position.x && position.y === node.position.y)) return node;
                    changed = true;
                    return { ...node, position };
                });
            } catch (error) {
                errors.push(error instanceof Error ? error.message : "画布布局失败");
            }
        }
        if (op.type === "move_nodes") {
            const items = new Map((op.items || []).filter((item) => item?.id).map((item) => [item.id, item]));
            nodes = nodes.map((node) => {
                const item = items.get(node.id);
                if (!item) return node;
                const x = typeof item.x === "number" && Number.isFinite(item.x) ? item.x : node.position.x + finiteOr(item.dx, 0);
                const y = typeof item.y === "number" && Number.isFinite(item.y) ? item.y : node.position.y + finiteOr(item.dy, 0);
                const position = { x: boundedCoordinate(x, node.position.x), y: boundedCoordinate(y, node.position.y) };
                if (position.x === node.position.x && position.y === node.position.y) return node;
                changed = true;
                return { ...node, position };
            });
        }
        if (op.type === "resize_node" && op.id) {
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                const width = boundedNodeSize(op.width, node.width);
                const height = boundedNodeSize(op.height, node.height);
                const metadata = op.freeResize && !node.metadata?.freeResize ? { ...node.metadata, freeResize: true } : node.metadata;
                if (width === node.width && height === node.height && metadata === node.metadata) return node;
                changed = true;
                return {
                    ...node,
                    width,
                    height,
                    metadata,
                };
            });
        }
        if (changed || op.type === "run_generation") appliedSources.add(sourceIndex);
    };

    validated.ops.forEach((sourceOp, sourceIndex) => {
        const liveSnapshot = { ...snapshot, nodes, connections, selectedNodeIds, viewport };
        const expansion = expandCanvasAgentOps([sourceOp], liveSnapshot, sourceIndex);
        errors.push(...expansion.errors);
        expansion.ops.forEach(applyExpandedOp);
    });

    return {
        ...snapshot,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        agentReport: {
            requested: Array.isArray(ops) ? ops.length : 0,
            accepted: validated.ops.length,
            applied: appliedSources.size,
            rejected: validated.rejected,
            errors: [...new Set(errors)],
        },
    } satisfies CanvasAgentApplyResult;
}

function expandCanvasAgentOps(ops: CanvasAgentOp[] | undefined, snapshot: CanvasAgentSnapshot, sourceOffset = 0): { ops: Array<{ op: CanvasAgentOp; sourceIndex: number }>; errors: string[] } {
    const expanded: Array<{ op: CanvasAgentOp; sourceIndex: number }> = [];
    const errors: string[] = [];
    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        const sourceIndex = sourceOffset + index;
        try {
            if (op?.type === "create_generation_flow") {
                expanded.push(...generationFlowOps(op, snapshot, sourceIndex).map((item) => ({ op: item, sourceIndex })));
                return;
            }
            if (op?.type === "create_graph") {
                expanded.push(...graphOps(op, snapshot, sourceIndex).map((item) => ({ op: item, sourceIndex })));
                return;
            }
            if (op?.type) expanded.push({ op, sourceIndex });
        } catch (error) {
            errors.push(error instanceof Error ? error.message : "画布操作展开失败");
        }
    });
    return { ops: expanded, errors };
}

function generationFlowOps(op: Extract<CanvasAgentOp, { type: "create_generation_flow" }>, snapshot: CanvasAgentSnapshot, index: number): CanvasAgentOp[] {
    const origin = op.position || { x: op.x ?? flowOriginX(snapshot) + index * 40, y: op.y ?? flowOriginY(snapshot) };
    return graphOps({
        type: "create_graph",
        position: origin,
        nodes: [
            { key: "prompt", type: CanvasNodeType.Text, title: op.title, text: String(op.prompt || "").trim() },
            { key: "config", type: CanvasNodeType.Config },
            { key: "result", type: CanvasNodeType.Image },
        ],
        edges: [{ from: "prompt", to: "config" }, { from: "config", to: "result" }],
    }, snapshot, index);
}

function graphOps(op: Extract<CanvasAgentOp, { type: "create_graph" }>, snapshot: CanvasAgentSnapshot, index: number): CanvasAgentOp[] {
    const plans = (op.nodes || [])
        .map((node, order) => {
            const type = node?.type && isRegisteredNodeType(node.type) ? node.type : CanvasNodeType.Text;
            const spec = getNodeSpec(type);
            return { key: String(node?.key || `n${order + 1}`).trim() || `n${order + 1}`, type, spec, title: node?.title, text: String(node?.text || "").trim(), composerContent: String(node?.composerContent || "").trim(), generationMode: node?.generationMode };
        })
        .filter((plan) => isCanvasNodeTypeEnabled(plan.type));
    if (!plans.length) return [];

    const ids = new Map(plans.map((plan) => [plan.key, `${plan.type}-${nanoid(6)}`]));
    const origin = op.position || { x: op.x ?? flowOriginX(snapshot) + index * 40, y: op.y ?? flowOriginY(snapshot) };
    const requestedEdges = (op.edges || []).map((edge) => ({ from: String(edge?.from || "").trim(), to: String(edge?.to || "").trim() }));
    const graphKeys = new Set(ids.keys());
    const internalRequestedEdges = requestedEdges.filter((edge) => graphKeys.has(edge.from) && graphKeys.has(edge.to));
    const { positions: rawPositions, edges: internalEdges } = layoutCanvasGraph(
        plans.map((plan) => ({ key: plan.key, width: plan.spec.width, height: plan.spec.height })),
        internalRequestedEdges,
        { originX: origin.x, originY: origin.y, columnGap: FLOW_GAP, rowGap: GRAPH_ROW_GAP },
    );
    const generationModes = resolveCanvasAgentGraphModes(plans, internalEdges);
    const positions = placeCanvasAgentGraph(rawPositions, plans, snapshot);

    const ops: CanvasAgentOp[] = plans.map((plan) => {
        const graphTextMetadata = canvasAgentGraphTextMetadata(plan.type, plan.text);
        const metadata = plan.type === CanvasNodeType.Config
            ? { ...(plan.composerContent ? { composerContent: plan.composerContent } : {}), generationMode: generationModes.get(plan.key) || "image" }
            : graphTextMetadata;
        return {
            type: "add_node",
            id: ids.get(plan.key),
            nodeType: plan.type,
            title: plan.title || plan.spec.title,
            x: positions.get(plan.key)?.x ?? origin.x,
            y: positions.get(plan.key)?.y ?? origin.y,
            ...(metadata ? { metadata } : {}),
        };
    });
    const existingIds = new Set(snapshot.nodes.map((node) => node.id));
    const resolveEdgeNodeId = (reference: string) => ids.get(reference) || (existingIds.has(reference) ? reference : undefined);
    const connectionEdges = [
        ...internalEdges,
        ...requestedEdges.filter((edge) => {
            const touchesNewNode = graphKeys.has(edge.from) || graphKeys.has(edge.to);
            return touchesNewNode && !(graphKeys.has(edge.from) && graphKeys.has(edge.to));
        }),
    ];
    connectionEdges.forEach((edge) => {
        const fromNodeId = resolveEdgeNodeId(edge.from);
        const toNodeId = resolveEdgeNodeId(edge.to);
        if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
        ops.push({ type: "connect_nodes", fromNodeId, toNodeId });
    });
    return ops;
}

function flowOriginX(snapshot: CanvasAgentSnapshot) {
    const scale = positiveFiniteOr(snapshot.viewport.k, 1);
    const visibleOrigin = Math.round((-finiteOr(snapshot.viewport.x, 0) + 80) / scale);
    const rights = snapshot.nodes.map((node) => node.position.x + node.width).filter(Number.isFinite);
    return rights.length ? Math.max(...rights) + FLOW_GAP : visibleOrigin;
}

function flowOriginY(snapshot: CanvasAgentSnapshot) {
    const scale = positiveFiniteOr(snapshot.viewport.k, 1);
    const visibleOrigin = Math.round((-finiteOr(snapshot.viewport.y, 0) + 80) / scale);
    return snapshot.nodes.find((node) => Number.isFinite(node.position.y))?.position.y ?? visibleOrigin;
}

function connectNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], fromRef: string | undefined, toRef: string | undefined, id?: string) {
    const fromNodeId = resolveNodeRef(fromRef, nodes);
    const toNodeId = resolveNodeRef(toRef, nodes, fromNodeId);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return connections;
    if (connections.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId)) return connections;
    const connectionId = cleanId(id) || nanoid();
    if (connections.some((connection) => connection.id === connectionId)) return connections;
    return [...connections, { id: connectionId, fromNodeId, toNodeId }];
}

function resolveNodeRef(ref: string | undefined, nodes: CanvasNodeData[], excludeId = "") {
    const value = cleanId(ref);
    if (!value) return "";
    return nodes.some((node) => node.id === value && node.id !== excludeId) ? value : "";
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}

function finiteOr(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveFiniteOr(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanId(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values: string[]) {
    return [...new Set(values.map(cleanId).filter(Boolean))];
}

function hasFiniteMove(item: { x?: number; y?: number; dx?: number; dy?: number }) {
    return [item.x, item.y, item.dx, item.dy].some((value) => typeof value === "number" && Number.isFinite(value));
}

function boundedCoordinate(value: unknown, fallback: number) {
    const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(MAX_CANVAS_COORDINATE, Math.max(-MAX_CANVAS_COORDINATE, number));
}

function boundedNodeSize(value: unknown, fallback: number) {
    const number = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
    return Math.min(MAX_AGENT_NODE_SIZE, Math.max(MIN_AGENT_NODE_SIZE, number));
}

function canvasAgentStringArrayEqual(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fitCanvasAgentPositions(
    positions: Map<string, { x: number; y: number }>,
    dimensions: Map<string, { width: number; height: number }> = new Map(),
) {
    if (!positions.size) return positions;
    const values = [...positions].map(([key, position]) => ({ ...position, ...(dimensions.get(key) || { width: 0, height: 0 }) }));
    const minX = Math.min(...values.map((position) => position.x));
    const maxX = Math.max(...values.map((position) => position.x + position.width));
    const minY = Math.min(...values.map((position) => position.y));
    const maxY = Math.max(...values.map((position) => position.y + position.height));
    if (![minX, maxX, minY, maxY].every(Number.isFinite)) throw new Error("布局产生了无效坐标");
    if (maxX - minX > MAX_CANVAS_COORDINATE * 2 || maxY - minY > MAX_CANVAS_COORDINATE * 2) {
        throw new Error("布局范围超过画布坐标边界");
    }
    const dx = minX < -MAX_CANVAS_COORDINATE
        ? -MAX_CANVAS_COORDINATE - minX
        : maxX > MAX_CANVAS_COORDINATE
          ? MAX_CANVAS_COORDINATE - maxX
          : 0;
    const dy = minY < -MAX_CANVAS_COORDINATE
        ? -MAX_CANVAS_COORDINATE - minY
        : maxY > MAX_CANVAS_COORDINATE
          ? MAX_CANVAS_COORDINATE - maxY
          : 0;
    return translateCanvasAgentPositions(positions, dx, dy);
}

function translateCanvasAgentPositions(positions: Map<string, { x: number; y: number }>, dx: number, dy: number) {
    return new Map([...positions].map(([key, position]) => [key, { x: position.x + dx, y: position.y + dy }]));
}

function canvasAgentPositionsOverlapFixedNodes(positions: Map<string, { x: number; y: number }>, nodes: CanvasNodeData[]) {
    const moved = new Set(positions.keys());
    return nodes.some((node) => {
        if (moved.has(node.id)) return false;
        return nodes.some((candidate) => {
            const position = positions.get(candidate.id);
            return Boolean(position && canvasAgentRectanglesOverlap(position.x, position.y, candidate.width, candidate.height, node.position.x, node.position.y, node.width, node.height));
        });
    });
}

function placeCanvasAgentGraph(
    positions: Map<string, { x: number; y: number }>,
    plans: Array<{ key: string; spec: { width: number; height: number } }>,
    snapshot: CanvasAgentSnapshot,
) {
    const dimensions = new Map(plans.map((plan) => [plan.key, plan.spec]));
    const overlaps = (candidate: Map<string, { x: number; y: number }>) => [...candidate].some(([key, position]) => {
        const size = dimensions.get(key);
        if (!size) return false;
        return snapshot.nodes.some((node) => canvasAgentRectanglesOverlap(position.x, position.y, size.width, size.height, node.position.x, node.position.y, node.width, node.height));
    });
    const fitted = fitCanvasAgentPositions(positions, dimensions);
    if (!overlaps(fitted) || !snapshot.nodes.length) return fitted;

    const graphBounds = canvasAgentPositionBounds(fitted, dimensions);
    const existingBounds = snapshot.nodes.reduce(
        (bounds, node) => ({
            left: Math.min(bounds.left, node.position.x),
            top: Math.min(bounds.top, node.position.y),
            right: Math.max(bounds.right, node.position.x + node.width),
            bottom: Math.max(bounds.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const candidates = [
        [0, existingBounds.bottom + GRAPH_ROW_GAP - graphBounds.top],
        [0, existingBounds.top - GRAPH_ROW_GAP - graphBounds.bottom],
        [existingBounds.left - FLOW_GAP - graphBounds.right, 0],
        [existingBounds.right + FLOW_GAP - graphBounds.left, 0],
    ];
    for (const [dx, dy] of candidates) {
        try {
            const candidate = fitCanvasAgentPositions(translateCanvasAgentPositions(fitted, dx, dy), dimensions);
            if (!overlaps(candidate)) return candidate;
        } catch {
            // Try the next rigid placement; never clamp nodes independently.
        }
    }
    throw new Error("画布边界内没有可用的不重叠空间来创建工作流");
}

function canvasAgentPositionBounds(
    positions: Map<string, { x: number; y: number }>,
    dimensions: Map<string, { width: number; height: number }>,
) {
    return [...positions].reduce((bounds, [key, position]) => {
        const size = dimensions.get(key) || { width: 0, height: 0 };
        return {
            left: Math.min(bounds.left, position.x),
            top: Math.min(bounds.top, position.y),
            right: Math.max(bounds.right, position.x + size.width),
            bottom: Math.max(bounds.bottom, position.y + size.height),
        };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function canvasAgentRectanglesOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteViewport(value: ViewportTransform | undefined): value is ViewportTransform {
    return Boolean(value && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && typeof value.k === "number" && Number.isFinite(value.k) && value.k > 0);
}
