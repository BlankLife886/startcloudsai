import type { CanvasAgentGraphEdge, CanvasAgentGraphNode, CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { nanoid } from "nanoid";

const MAX_NODES = 40;
const MAX_CONNECTIONS = 60;
const MAX_TEXT = 240;

export type CompactCanvasSnapshot = {
    title: string;
    truncated: boolean;
    selectedNodeIds: string[];
    viewport: { x: number; y: number; k: number };
    nodes: Array<{
        id: string;
        type: string;
        title: string;
        x: number;
        y: number;
        w: number;
        h: number;
        selected?: boolean;
        content?: string;
        prompt?: string;
        status?: string;
        model?: string;
        mode?: string;
    }>;
    connections: Array<{ fromNodeId: string; toNodeId: string }>;
    connectionHint: string;
};

export function compactCanvasSnapshot(snapshot: CanvasAgentSnapshot | null | undefined): CompactCanvasSnapshot {
    const selected = new Set(snapshot?.selectedNodeIds || []);
    const nodes = [...(snapshot?.nodes || [])].sort((left, right) => Number(selected.has(right.id)) - Number(selected.has(left.id)));
    const truncated = nodes.length > MAX_NODES;
    return {
        title: snapshot?.title || "",
        truncated,
        selectedNodeIds: (snapshot?.selectedNodeIds || []).slice(0, MAX_NODES),
        viewport: {
            x: Math.round(snapshot?.viewport.x || 0),
            y: Math.round(snapshot?.viewport.y || 0),
            k: Number((snapshot?.viewport.k || 1).toFixed(2)),
        },
        nodes: nodes.slice(0, MAX_NODES).map((node) => {
            const content = compactText(node.metadata?.content || node.metadata?.composerContent);
            const prompt = compactText(node.metadata?.prompt);
            return {
                id: node.id,
                type: node.type,
                title: node.title || "",
                x: Math.round(node.position.x),
                y: Math.round(node.position.y),
                w: Math.round(node.width),
                h: Math.round(node.height),
                ...(selected.has(node.id) ? { selected: true } : {}),
                ...(content ? { content } : {}),
                ...(prompt && prompt !== content ? { prompt } : {}),
                ...(node.metadata?.status ? { status: node.metadata.status } : {}),
                ...(node.metadata?.model ? { model: node.metadata.model } : {}),
                ...(node.metadata?.generationMode ? { mode: node.metadata.generationMode } : {}),
            };
        }),
        connections: (snapshot?.connections || []).slice(0, MAX_CONNECTIONS).map((connection) => ({
            fromNodeId: connection.fromNodeId,
            toNodeId: connection.toNodeId,
        })),
        connectionHint: "连线方向：text → config → image。connect_nodes 必须使用节点 id；新建后立刻用同一个 id 连线。",
    };
}

function compactText(value: unknown) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

const OP_TYPES = new Set(["add_node", "update_node", "delete_node", "connect_nodes", "delete_connections", "select_nodes", "set_viewport", "run_generation", "create_generation_flow", "create_graph", "move_nodes", "resize_node"]);
const NODE_TYPES = new Set(["text", "image", "config", "group"]);
const TYPE_ALIASES: Record<string, string> = {
    connect: "connect_nodes",
    link: "connect_nodes",
    connect_node: "connect_nodes",
    add_connection: "connect_nodes",
    add_edge: "connect_nodes",
    create_image_flow: "create_generation_flow",
    generation_flow: "create_generation_flow",
    create_image_prompt_flow: "create_generation_flow",
    graph: "create_graph",
    workflow: "create_graph",
    create_workflow: "create_graph",
    build_graph: "create_graph",
};
const MAX_GRAPH_NODES = 128;
const MAX_GRAPH_EDGES = 256;

export function parseCanvasAgentOpsPayload(raw: string): { summary: string; ops: CanvasAgentOp[] } {
    const text = String(raw || "").trim();
    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    let payload: unknown;
    try {
        if (objectStart >= 0 && objectEnd > objectStart && (arrayStart < 0 || objectStart < arrayStart)) {
            payload = JSON.parse(text.slice(objectStart, objectEnd + 1));
        } else if (arrayStart >= 0 && arrayEnd > arrayStart) {
            payload = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
        }
    } catch {
        return { summary: "", ops: [] };
    }
    return normalizeCanvasAgentOpsPayload(payload);
}

export function resolveCanvasAgentCompletion(input: {
    content?: string;
    canvasOps?: unknown;
    canvasOpsSummary?: string;
    executedTools?: number;
    canvasOpsApplied?: boolean;
}) {
    const content = String(input.content || "").trim();
    const parsed = input.executedTools ? { ops: [] as CanvasAgentOp[], summary: "" } : parseCanvasAgentOpsPayload(content);
    const reported = input.canvasOpsApplied ? [] : normalizeCanvasAgentOps(input.canvasOps);
    return {
        ops: reported.length ? reported : parsed.ops,
        summary: String(input.canvasOpsSummary || "").trim() || parsed.summary || undefined,
    };
}

export function normalizeCanvasAgentOpsPayload(payload: unknown): { summary: string; ops: CanvasAgentOp[] } {
    if (Array.isArray(payload)) return { summary: "", ops: normalizeCanvasAgentOps(payload) };
    if (!payload || typeof payload !== "object") return { summary: "", ops: [] };
    const record = payload as Record<string, unknown>;
    const summary = String(record.summary || record.reason || "").trim();
    for (const key of ["ops", "operations", "actions", "changes"]) {
        const ops = normalizeCanvasAgentOps(record[key]);
        if (ops.length) return { summary, ops };
    }
    if (record.type) return { summary, ops: normalizeCanvasAgentOps([record]) };
    return { summary, ops: [] };
}

export function normalizeCanvasAgentOps(raw: unknown): CanvasAgentOp[] {
    if (!Array.isArray(raw)) return [];
    const ops: CanvasAgentOp[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const merged = flattenOp(item as Record<string, unknown>);
        let type = String(TYPE_ALIASES[String(merged.type || "").trim()] || merged.type || "").trim();
        if (!OP_TYPES.has(type) && NODE_TYPES.has(type)) {
            merged.nodeType = type;
            type = "add_node";
            merged.type = type;
        }
        if (!OP_TYPES.has(type)) continue;
        merged.type = type;
        if (type === "create_graph") {
            const nodes = normalizeGraphNodes(merged.nodes);
            if (!nodes.length) continue;
            ops.push({ type: "create_graph", nodes, edges: normalizeGraphEdges(merged.edges, merged.connections, merged.links) });
            if (ops.length >= 24) break;
            continue;
        }
        if (type === "connect_nodes") {
            merged.fromNodeId = firstString(merged, ["fromNodeId", "fromId", "from", "source", "sourceId", "sourceNodeId"]);
            merged.toNodeId = firstString(merged, ["toNodeId", "toId", "to", "target", "targetId", "targetNodeId"]);
        }
        if (type === "add_node" || type === "update_node") {
            const metadata = { ...(asRecord(merged.metadata) || {}) };
            if (!metadata.content) {
                const content = String(merged.content || merged.prompt || "").trim();
                if (content) metadata.content = content;
            }
            if (Object.keys(metadata).length) merged.metadata = metadata;
        }
        ops.push(merged as CanvasAgentOp);
        if (ops.length >= 24) break;
    }
    return ops;
}

function flattenOp(item: Record<string, unknown>) {
    const nested = asRecord(item.node) || asRecord(item.data) || {};
    const { node: _node, data: _data, ...rest } = item;
    return { ...nested, ...rest };
}

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = String(record[key] || "").trim();
        if (value) return value;
    }
    return "";
}

export type CanvasAgentToolRequest = { name: string; arguments: string };
export type CanvasAgentToolCanvas = {
    snapshot: CanvasAgentSnapshot;
    applyOps: (ops: CanvasAgentOp[]) => CanvasAgentSnapshot;
    /** Re-reads the live canvas; generation polling needs state newer than the turn snapshot. */
    readSnapshot?: () => CanvasAgentSnapshot;
    attachments?: Array<{ id: string; name?: string; dataUrl: string }>;
    navigate?: (path: string) => void;
};

export type CanvasGenerationStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

const GENERATION_POLL_MS = 700;
const GENERATION_DEFAULT_WAIT_SECONDS = 20;
const GENERATION_MAX_WAIT_SECONDS = 60;

const SITE_TOOLS = new Set(["canvas_list_projects", "prompts_search", "assets_list", "assets_add"]);
const SITE_NAVIGATE_ALLOWLIST = [
    /^\/$/,
    /^\/canvas$/,
    /^\/canvas\/config$/,
    /^\/canvas\/[A-Za-z0-9_-]+$/,
    /^\/prompts$/,
    /^\/assets$/,
];

export function isAllowedSiteNavigatePath(path: string) {
    const value = String(path || "").trim();
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.includes("\\")) return false;
    return SITE_NAVIGATE_ALLOWLIST.some((pattern) => pattern.test(value.split("?")[0] || ""));
}

/**
 * Runs one agent tool against the live canvas and returns the observation the
 * model will see. Mutations report the resulting graph so the model can verify
 * its own work instead of guessing.
 */
export async function runCanvasAgentTool(request: CanvasAgentToolRequest, canvas: CanvasAgentToolCanvas): Promise<unknown> {
    if (request.name === "canvas_get_state" || request.name === "canvas_export_snapshot") {
        return { snapshot: compactCanvasSnapshot(liveSnapshot(canvas)) };
    }
    if (request.name === "canvas_get_selection") {
        const snapshot = liveSnapshot(canvas);
        const selected = new Set(snapshot.selectedNodeIds || []);
        const compact = compactCanvasSnapshot(snapshot);
        return { selectedNodeIds: [...selected], nodes: compact.nodes.filter((node) => selected.has(node.id)) };
    }
    if (request.name === "canvas_run_generation") {
        return runGeneration(request.arguments, canvas);
    }
    if (request.name === "canvas_generation_status") {
        return readGenerationStatus(request.arguments, canvas);
    }
    if (request.name === "canvas_create_attachment_nodes") {
        return createAttachmentNodes(request.arguments, canvas);
    }
    if (request.name === "site_navigate") {
        return navigateSite(request.arguments, canvas);
    }
    if (SITE_TOOLS.has(request.name)) {
        const { runSiteTool } = await import("@/lib/agent/agent-site-tools");
        return runSiteTool(request.name as "canvas_list_projects" | "prompts_search" | "assets_list" | "assets_add", asRecord(safeParse(request.arguments)) || {}, { canvasSnapshot: liveSnapshot(canvas) });
    }
    if (request.name !== "canvas_apply_ops") {
        throw new Error(`未知工具 ${request.name}`);
    }
    const { ops } = parseCanvasAgentOpsPayload(request.arguments);
    if (!ops.length) throw new Error("没有解析出有效的 ops");
    const before = liveSnapshot(canvas);
    const after = canvas.applyOps(ops);
    return {
        applied: ops.length,
        addedNodes: after.nodes.length - before.nodes.length,
        addedConnections: after.connections.length - before.connections.length,
        snapshot: compactCanvasSnapshot(after),
    };
}

function liveSnapshot(canvas: CanvasAgentToolCanvas) {
    return canvas.readSnapshot?.() || canvas.snapshot;
}

function runGeneration(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const snapshot = liveSnapshot(canvas);
    const known = new Set(snapshot.nodes.map((node) => node.id));
    const requested = Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()) : [];
    const nodeIds = requested.filter((id) => known.has(id));
    const missing = requested.filter((id) => id && !known.has(id));
    if (!nodeIds.length) throw new Error(missing.length ? `节点不存在：${missing.join("、")}` : "nodeIds 为空");
    const mode = input.mode === "text" || input.mode === "image" ? input.mode : undefined;
    const prompt = String(input.prompt || "").trim();
    canvas.applyOps(nodeIds.map((nodeId) => ({ type: "run_generation", nodeId, ...(mode ? { mode } : {}), ...(prompt ? { prompt } : {}) })));
    return { triggered: nodeIds, ...(missing.length ? { missing } : {}) };
}

function navigateSite(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const path = String((asRecord(safeParse(rawArguments)) || {}).path || "").trim() || "/";
    if (!isAllowedSiteNavigatePath(path)) throw new Error(`不允许跳转到 ${path}`);
    if (!canvas.navigate) throw new Error("当前页面无法跳转");
    canvas.navigate(path);
    return { ok: true, path };
}

async function createAttachmentNodes(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const requested = Array.isArray(input.attachmentIds) ? input.attachmentIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const attachments = canvas.attachments || [];
    const known = new Map(attachments.map((item) => [item.id, item]));
    const missing = requested.filter((id) => !known.has(id));
    const chosen = requested.map((id) => known.get(id)).filter((item): item is { id: string; name?: string; dataUrl: string } => Boolean(item));
    if (!chosen.length) throw new Error(missing.length ? `附件不存在：${missing.join("、")}` : "attachmentIds 为空");
    const { uploadImage } = await import("@/services/image-storage");
    const originX = Number(input.x);
    const originY = Number(input.y);
    const snapshot = liveSnapshot(canvas);
    const startX = Number.isFinite(originX) ? originX : flowOriginX(snapshot);
    const startY = Number.isFinite(originY) ? originY : flowOriginY(snapshot);
    const gap = Number(input.gap) > 0 ? Number(input.gap) : 40;
    const column = input.direction === "column";
    const ops: CanvasAgentOp[] = [];
    for (let index = 0; index < chosen.length; index += 1) {
        const attachment = chosen[index];
        const stored = await uploadImage(attachment.dataUrl);
        const size = attachmentCardSize(stored.width, stored.height);
        ops.push({
            type: "add_node",
            id: `image-${nanoid(6)}`,
            nodeType: "image",
            title: attachment.name || "参考图",
            x: column ? startX : startX + index * (size.width + gap),
            y: column ? startY + index * (size.height + gap) : startY,
            width: size.width,
            height: size.height,
            metadata: {
                content: stored.url,
                storageKey: stored.storageKey,
                thumbnailUrl: stored.thumbnailUrl,
                thumbnailKey: stored.thumbnailKey,
                status: "success",
                naturalWidth: stored.width,
                naturalHeight: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        });
    }
    const after = canvas.applyOps(ops);
    return { added: ops.map((op) => ("id" in op ? op.id : "")).filter(Boolean), ...(missing.length ? { missing } : {}), snapshot: compactCanvasSnapshot(after) };
}

function flowOriginX(snapshot: CanvasAgentSnapshot) {
    if (!snapshot.nodes.length) return Math.round((-snapshot.viewport.x + 80) / (snapshot.viewport.k || 1));
    return Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 72;
}

function flowOriginY(snapshot: CanvasAgentSnapshot) {
    if (!snapshot.nodes.length) return Math.round((-snapshot.viewport.y + 80) / (snapshot.viewport.k || 1));
    return snapshot.nodes[0]?.position.y || 0;
}

function attachmentCardSize(width: number, height: number) {
    const cardWidth = 360;
    if (width <= 0 || height <= 0) return { width: cardWidth, height: Math.round(cardWidth * 0.75) };
    return { width: cardWidth, height: Math.max(200, Math.min(480, Math.round(cardWidth * (height / width)))) };
}

async function readGenerationStatus(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const nodeIds = new Set((Array.isArray(input.nodeIds) ? input.nodeIds : []).map((id) => String(id || "").trim()).filter(Boolean));
    const waitSeconds = Math.max(0, Math.min(GENERATION_MAX_WAIT_SECONDS, Number(input.waitSeconds ?? GENERATION_DEFAULT_WAIT_SECONDS) || 0));
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
        const tasks = collectGenerationTasks(liveSnapshot(canvas), nodeIds);
        const settled = !tasks.some((task) => task.status === "running" || task.status === "queued");
        if (settled || Date.now() >= deadline) {
            return { tasks, summary: summarizeGenerationTasks(tasks), settled };
        }
        await delay(GENERATION_POLL_MS);
    }
}

function collectGenerationTasks(snapshot: CanvasAgentSnapshot, nodeIds: Set<string>) {
    return snapshot.nodes
        .filter((node) => (nodeIds.size ? nodeIds.has(node.id) : Boolean(normalizeGenerationStatus(node.metadata?.status))))
        .map((node) => {
            const metadata = node.metadata || {};
            return {
                nodeId: node.id,
                type: node.type,
                title: node.title || "",
                status: normalizeGenerationStatus(metadata.status) || "idle",
                ...(metadata.errorDetails ? { error: compactText(metadata.errorDetails) } : {}),
            };
        });
}

function summarizeGenerationTasks(tasks: Array<{ status: CanvasGenerationStatus }>) {
    return tasks.reduce<Record<string, number>>((acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
    }, {});
}

function normalizeGenerationStatus(status: unknown): CanvasGenerationStatus | null {
    if (status === "idle") return "idle";
    if (status === "queued") return "queued";
    if (status === "loading") return "running";
    if (status === "success") return "succeeded";
    if (status === "error") return "failed";
    return null;
}

function safeParse(raw: string) {
    try {
        return JSON.parse(String(raw || "").trim() || "{}") as unknown;
    } catch {
        return null;
    }
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGraphNodes(raw: unknown): CanvasAgentGraphNode[] {
    if (!Array.isArray(raw)) return [];
    const nodes: CanvasAgentGraphNode[] = [];
    for (const item of raw) {
        const record = asRecord(item);
        if (!record) continue;
        const type = firstString(record, ["type", "nodeType", "kind"]);
        nodes.push({
            key: firstString(record, ["key", "id", "ref", "name"]) || `n${nodes.length + 1}`,
            type: (NODE_TYPES.has(type) ? type : "text") as CanvasAgentGraphNode["type"],
            title: firstString(record, ["title", "label", "name"]) || undefined,
            text: firstString(record, ["text", "content", "prompt"]) || undefined,
        });
        if (nodes.length >= MAX_GRAPH_NODES) break;
    }
    return nodes;
}

function normalizeGraphEdges(...sources: unknown[]): CanvasAgentGraphEdge[] {
    const edges: CanvasAgentGraphEdge[] = [];
    for (const source of sources) {
        if (!Array.isArray(source)) continue;
        for (const item of source) {
            if (edges.length >= MAX_GRAPH_EDGES) return edges;
            if (Array.isArray(item)) {
                const [from, to] = item;
                if (typeof from === "string" && typeof to === "string" && from.trim() && to.trim()) {
                    edges.push({ from: from.trim(), to: to.trim() });
                }
                continue;
            }
            const record = asRecord(item);
            if (!record) continue;
            const from = firstString(record, ["from", "fromKey", "fromNodeId", "source", "sourceId"]);
            const to = firstString(record, ["to", "toKey", "toNodeId", "target", "targetId"]);
            if (from && to) edges.push({ from, to });
        }
    }
    return edges;
}
