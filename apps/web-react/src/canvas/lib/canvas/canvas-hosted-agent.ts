import { validCanvasAgentOps } from "./canvas-agent-op-validation.js";
import type { CanvasAgentApplyResult, CanvasAgentGraphEdge, CanvasAgentGraphNode, CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasSidePanelWorkflowGroups } from "./canvas-workflow-groups.ts";
import { CanvasOperationNodeType, isCanvasExecutableNode } from "./canvas-operation-node.ts";
import { canvasLocalImageOperationOutputCount, normalizeCanvasLocalImageOperationParams } from "./canvas-local-image-operation.ts";
import { compileCanvasWorkflow } from "./canvas-workflow.ts";
import { copyCanvasNodeMetadata } from "./canvas-node-copy.ts";
import { inspectCanvasVisuals } from "./canvas-visual-inspection.ts";
import type { CanvasNodeMetadata } from "../../types/canvas.ts";
import type { SiteToolName } from "../agent/agent-site-tools.ts";
import type { AgentWorkflowPreflightResult } from "../../stores/use-agent-store.ts";
import { nanoid } from "nanoid";

const MAX_NODES = 80;
const MAX_CONNECTIONS = 160;
const MAX_TEXT_CHARS = 320;
const MAX_TEXT_BYTES = 640;
const MAX_IMAGE_OPERATION_SOURCES = 80;

export type CompactCanvasSnapshot = {
    projectId?: string;
    title: string;
    truncated: boolean;
    selectedNodeIds: string[];
    viewport: { x: number; y: number; k: number };
    workflows: Array<{ index: number; id: string; title: string; nodeIds: string[]; configNodeIds: string[] }>;
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
        composerContent?: string;
        prompt?: string;
        hasContent?: boolean;
        status?: string;
        executionStatus?: string;
        model?: string;
        mode?: string;
        size?: string;
        resolution?: string;
        quality?: string;
        count?: number;
        background?: string;
        workflowIndex?: number;
        workflowOutputNodeIds?: string[];
    }>;
    connections: Array<{ fromNodeId: string; toNodeId: string }>;
    connectionHint: string;
};

export function compactCanvasSnapshot(snapshot: CanvasAgentSnapshot | null | undefined): CompactCanvasSnapshot {
    const selected = new Set(snapshot?.selectedNodeIds || []);
    const nodes = [...(snapshot?.nodes || [])].sort((left, right) => Number(selected.has(right.id)) - Number(selected.has(left.id)));
    const groups = buildCanvasSidePanelWorkflowGroups(snapshot?.nodes || [], snapshot?.connections || []).filter((group) => group.firstConfig);
    const workflowIndexByNodeId = new Map(groups.flatMap((group, index) => group.nodes.map((node) => [node.id, index + 1] as const)));
    const visibleNodes = nodes.slice(0, MAX_NODES);
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleConnections = (snapshot?.connections || []).filter((connection) => visibleNodeIds.has(connection.fromNodeId) && visibleNodeIds.has(connection.toNodeId)).slice(0, MAX_CONNECTIONS);
    const truncated = nodes.length > MAX_NODES;
    return {
        ...(snapshot?.projectId ? { projectId: snapshot.projectId } : {}),
        title: snapshot?.title || "",
        truncated,
        selectedNodeIds: (snapshot?.selectedNodeIds || []).slice(0, MAX_NODES),
        viewport: {
            x: Math.round(snapshot?.viewport.x || 0),
            y: Math.round(snapshot?.viewport.y || 0),
            k: Number((snapshot?.viewport.k || 1).toFixed(2)),
        },
        workflows: groups.map((group, index) => ({
            index: index + 1,
            id: group.id,
            title: compactText(group.firstConfig?.title.replace(/^\d+\s*[|｜]\s*/, "")) || `工作流 ${index + 1}`,
            nodeIds: group.nodes.map((node) => node.id),
            configNodeIds: group.nodes.filter((node) => isCanvasExecutableNode(node)).map((node) => node.id),
        })),
        nodes: visibleNodes.map((node) => {
            const content = node.type === "text" ? compactText(node.metadata?.content) : "";
            const composerContent = isCanvasExecutableNode(node) ? compactText(node.metadata?.composerContent) : "";
            // Generated image outputs commonly repeat their config prompt. Keep
            // it only for configs and selected images, where the Agent can use it.
            const prompt = isCanvasExecutableNode(node) || selected.has(node.id) ? compactText(node.metadata?.prompt) : "";
            return {
                id: node.id,
                type: node.type,
                title: compactText(node.title),
                x: Math.round(node.position.x),
                y: Math.round(node.position.y),
                w: Math.round(node.width),
                h: Math.round(node.height),
                ...(selected.has(node.id) ? { selected: true } : {}),
                ...(content ? { content } : {}),
                ...(composerContent ? { composerContent } : {}),
                ...(prompt && prompt !== content && prompt !== composerContent ? { prompt } : {}),
                ...(node.type !== "text" && (node.metadata?.content || node.metadata?.storageKey || node.metadata?.images?.some((image) => image.content || image.storageKey)) ? { hasContent: true } : {}),
                ...(node.metadata?.status ? { status: node.metadata.status } : {}),
                ...(node.metadata?.executionStatus ? { executionStatus: node.metadata.executionStatus } : {}),
                ...(node.metadata?.model ? { model: node.metadata.model } : {}),
                ...(node.metadata?.generationMode ? { mode: node.metadata.generationMode } : {}),
                ...(node.metadata?.size ? { size: node.metadata.size } : {}),
                ...(node.metadata?.resolution ? { resolution: node.metadata.resolution } : {}),
                ...(node.metadata?.quality ? { quality: node.metadata.quality } : {}),
                ...(typeof node.metadata?.count === "number" ? { count: node.metadata.count } : {}),
                ...(node.metadata?.background ? { background: node.metadata.background } : {}),
                ...(node.metadata?.localImageOperation ? { operation: node.metadata.localImageOperation, operationParams: node.metadata.localImageOperationParams || {} } : {}),
                ...(workflowIndexByNodeId.has(node.id) ? { workflowIndex: workflowIndexByNodeId.get(node.id) } : {}),
                ...(node.metadata?.workflowOutputNodeIds?.length ? { workflowOutputNodeIds: node.metadata.workflowOutputNodeIds } : {}),
            };
        }),
        connections: visibleConnections.map((connection) => ({
            fromNodeId: connection.fromNodeId,
            toNodeId: connection.toNodeId,
        })),
        connectionHint: "workflows 与左侧栏编号一致。config 以及带 operation 的 builtin 节点都是可执行步骤；text/image/video/audio 是输入或输出资源。connect_nodes 必须使用节点 id。",
    };
}

function compactText(value: unknown) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const encoder = new TextEncoder();
    const chars = Array.from(text);
    if (chars.length <= MAX_TEXT_CHARS && encoder.encode(text).byteLength <= MAX_TEXT_BYTES) return text;
    const suffix = "…";
    const byteBudget = MAX_TEXT_BYTES - encoder.encode(suffix).byteLength;
    let low = 0;
    let high = Math.min(chars.length, MAX_TEXT_CHARS);
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (encoder.encode(chars.slice(0, middle).join("")).byteLength <= byteBudget) low = middle;
        else high = middle - 1;
    }
    return `${chars.slice(0, low).join("")}${suffix}`;
}

const OP_TYPES = new Set(["add_node", "update_node", "delete_node", "connect_nodes", "delete_connections", "select_nodes", "set_viewport", "run_generation", "create_generation_flow", "create_graph", "arrange_nodes", "move_nodes", "resize_node"]);
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
        if (type === "arrange_nodes") {
            const direction = String(merged.direction || "").trim().toUpperCase() === "TB" ? "TB" : "LR";
            const scope = merged.scope === "selection" ? "selection" : merged.scope === "workflow" ? "workflow" : "all";
            const workflowId = String(merged.workflowId || "").trim();
            if (scope === "workflow" && !workflowId) continue;
            ops.push({ type: "arrange_nodes", scope, ...(scope === "workflow" ? { workflowId } : {}), direction });
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

export type CanvasAgentToolRequest = { requestId?: string; name: string; arguments: string };
export type CanvasAgentToolCanvas = {
    snapshot: CanvasAgentSnapshot;
    applyOps: (ops: CanvasAgentOp[]) => CanvasAgentSnapshot;
    undoOps?: () => CanvasAgentSnapshot | null;
    redoOps?: () => CanvasAgentSnapshot | null;
    canUndo?: boolean;
    canRedo?: boolean;
    /** Re-reads the live canvas; generation polling needs state newer than the turn snapshot. */
    readSnapshot?: () => CanvasAgentSnapshot;
    startGeneration?: (input: { nodeIds: string[]; mode?: "text" | "image" | "video" | "audio"; prompt?: string }) => { requestId: string; nodeIds: string[] };
    getGenerationStatus?: (requestId: string) => { requestId: string; tasks: Array<{ nodeId: string; status: CanvasGenerationStatus; error?: string }> } | null;
    regenerateSelection?: (input: { requestId: string; instruction: string }) => Promise<{
        status: "started" | "canceled";
        batchId: string;
        generationRequestId?: string;
        createdBranches: number;
        selectedNodeCount: number;
        sourceImageCount: number;
        skippedNodeIds: string[];
        items: Array<{ sourceNodeId: string; configNodeId: string; outputNodeId: string }>;
    }>;
    startWorkflow?: (input: { workflowId?: string; nodeIds?: string[] }) => { requestId: string; workflowId?: string; configNodeIds: string[] };
    getWorkflowStatus?: (requestId: string) => { requestId: string; workflowId?: string; status: CanvasGenerationStatus; completed: number; total: number; currentNodeId?: string; error?: string } | null;
    focusNodes?: (nodeIds: string[]) => CanvasAgentSnapshot;
    stopWorkflow?: () => { stopped: boolean; status: string; nodeIds: string[] };
    getWorkflowState?: () => { status: string; completed: number; total: number; currentNodeId?: string; errorMessage?: string; startedAt?: string };
    planWorkflow?: (input: { workflowId?: string; nodeIds?: string[] }) => AgentWorkflowPreflightResult;
    listHistory?: () => { past: Array<{ id: string; name: string; createdAt: string }>; future: Array<{ id: string; name: string; createdAt: string }>; checkpoints: Array<{ id: string; name: string; createdAt: string }> };
    createCheckpoint?: (name: string) => { id: string; name: string; createdAt: string };
    restoreHistory?: (input: { checkpointId?: string; transactionId?: string }) => CanvasAgentSnapshot | null;
    attachments?: Array<{ id: string; name?: string; dataUrl: string }>;
    navigate?: (path: string) => void;
};

export type CanvasGenerationStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled";

const GENERATION_POLL_MS = 700;
const GENERATION_DEFAULT_WAIT_SECONDS = 20;
const GENERATION_MAX_WAIT_SECONDS = 60;

const SITE_TOOLS = new Set<SiteToolName>([
    "canvas_list_projects",
    "canvas_list_workflow_templates",
    "canvas_inspect_workflow_template",
    "canvas_create_from_workflow_template",
    "generation_get_status",
    "prompts_search",
    "assets_list",
    "assets_add",
]);
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
        const nodes = compact.nodes.filter((node) => selected.has(node.id));
        return { selectedNodeIds: [...selected], total: selected.size, nodes, truncated: nodes.length < selected.size };
    }
    if (request.name === "canvas_find_nodes") {
        return findCanvasNodes(request.arguments, canvas);
    }
    if (request.name === "canvas_inspect_nodes") {
        return inspectCanvasNodes(request.arguments, canvas);
    }
    if (request.name === "canvas_inspect_visuals") {
        const input = asRecord(safeParse(request.arguments)) || {};
        return inspectCanvasVisuals(liveSnapshot(canvas), {
            scope: ["auto", "selection", "workflow", "recent"].includes(String(input.scope || ""))
                ? String(input.scope) as "auto" | "selection" | "workflow" | "recent"
                : "auto",
            workflowId: String(input.workflowId || "").trim() || undefined,
            nodeIds: Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()).filter(Boolean) : undefined,
            maxImages: Number(input.maxImages) || undefined,
            offset: Number(input.offset) || undefined,
        });
    }
    if (request.name === "canvas_focus_nodes") {
        return focusCanvasNodes(request.arguments, canvas);
    }
    if (request.name === "canvas_duplicate_selection") {
        return duplicateCanvasSelection(request.arguments, canvas);
    }
    if (request.name === "canvas_replace_workflow_input") {
        return replaceCanvasWorkflowInput(request.arguments, canvas);
    }
    if (request.name === "canvas_run_downstream") {
        return runCanvasDownstream(request.arguments, canvas);
    }
    if (request.name === "canvas_create_image_operation") {
        return createCanvasImageOperation(request.arguments, canvas);
    }
    if (request.name === "canvas_validate_workflow") {
        return validateCanvasWorkflows(request.arguments, canvas);
    }
    if (request.name === "canvas_plan_workflow_run") {
        if (!canvas.planWorkflow) throw new Error("当前画布不支持工作流运行预检");
        const input = asRecord(safeParse(request.arguments)) || {};
        const workflowId = String(input.workflowId || "").trim();
        const nodeIds = Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()).filter(Boolean) : undefined;
        return canvas.planWorkflow({ ...(workflowId ? { workflowId } : {}), ...(nodeIds?.length ? { nodeIds: [...new Set(nodeIds)] } : {}) });
    }
    if (request.name === "canvas_stop_workflow") {
        if (!canvas.stopWorkflow) throw new Error("当前画布不支持停止工作流");
        const result = canvas.stopWorkflow();
        if (!result.stopped) throw new Error(`当前没有可停止的工作流，状态为 ${result.status || "idle"}`);
        return result;
    }
    if (request.name === "canvas_resume_workflow") {
        return resumeCanvasWorkflow(request.arguments, canvas, false);
    }
    if (request.name === "canvas_retry_failed_nodes") {
        return resumeCanvasWorkflow(request.arguments, canvas, true);
    }
    if (request.name === "canvas_list_agent_history") {
        if (!canvas.listHistory) throw new Error("当前画布不支持读取 Agent 历史");
        return canvas.listHistory();
    }
    if (request.name === "canvas_create_checkpoint") {
        if (!canvas.createCheckpoint) throw new Error("当前画布不支持创建检查点");
        const input = asRecord(safeParse(request.arguments)) || {};
        const name = String(input.name || "").trim();
        if (!name) throw new Error("检查点名称不能为空");
        return { checkpoint: canvas.createCheckpoint(name) };
    }
    if (request.name === "canvas_restore_checkpoint" || request.name === "canvas_restore_agent_transaction") {
        if (!canvas.restoreHistory) throw new Error("当前画布不支持恢复 Agent 历史");
        const input = asRecord(safeParse(request.arguments)) || {};
        const checkpointId = String(input.checkpointId || "").trim();
        const transactionId = String(input.transactionId || "").trim();
        const after = canvas.restoreHistory(request.name === "canvas_restore_checkpoint" ? { checkpointId } : { transactionId });
        if (!after) throw new Error(request.name === "canvas_restore_checkpoint" ? "检查点不存在或无法恢复" : "历史事务不存在或无法恢复");
        return { restored: true, target: checkpointId || transactionId, snapshot: compactCanvasSnapshot(after) };
    }
    if (request.name === "canvas_update_generation_settings") {
        return updateGenerationSettings(request.arguments, canvas);
    }
    if (request.name === "canvas_undo_last_action" || request.name === "canvas_redo_last_action") {
        return runCanvasHistoryAction(request.name, canvas);
    }
    if (request.name === "canvas_regenerate_selection") {
        if (!canvas.regenerateSelection) throw new Error("当前画布不支持按选区分别重生成");
        const input = asRecord(safeParse(request.arguments)) || {};
        const instruction = String(input.instruction || input.prompt || "").trim();
        if (!instruction) throw new Error("instruction 不能为空");
        return canvas.regenerateSelection({
            requestId: String(request.requestId || input.requestId || `regenerate-${nanoid(10)}`),
            instruction,
        });
    }
    if (request.name === "canvas_run_generation") {
        return runGeneration(request.arguments, canvas);
    }
    if (request.name === "canvas_generation_status") {
        return readGenerationStatus(request.arguments, canvas);
    }
    if (request.name === "canvas_run_workflow") {
        return runWorkflow(request.arguments, canvas);
    }
    if (request.name === "canvas_workflow_status") {
        return readWorkflowStatus(request.arguments, canvas);
    }
    if (request.name === "canvas_create_attachment_nodes") {
        return createAttachmentNodes(request.arguments, canvas);
    }
    if (request.name === "site_navigate") {
        return navigateSite(request.arguments, canvas);
    }
    if (SITE_TOOLS.has(request.name as SiteToolName)) {
        const { runSiteTool } = await import("@/lib/agent/agent-site-tools");
        return runSiteTool(request.name as SiteToolName, asRecord(safeParse(request.arguments)) || {}, { canvasSnapshot: liveSnapshot(canvas) });
    }
    if (request.name !== "canvas_apply_ops") {
        throw new Error(`未知工具 ${request.name}`);
    }
    const { ops } = parseCanvasAgentOpsPayload(request.arguments);
    if (!ops.length) throw new Error("没有解析出有效的 ops");
    const before = liveSnapshot(canvas);
    const validated = validCanvasAgentOps(before, ops);
    const diagnostics = canvasAgentOpDiagnostics(before, ops);
    if (!validated.ops.length) {
        return {
            requested: ops.length,
            applied: 0,
            ignored: ops.length,
            rejected: validated.rejected,
            reason: diagnostics.invalidNodeIds.length || diagnostics.invalidConnectionIds.length ? "invalid_references" : "no_effect",
            ...diagnostics,
            recovery: "使用本次返回的 snapshot 中精确节点 id 修正操作；新建多个节点或工作流时改用单个 create_graph，并用 nodes.key 连接 edges，禁止重放原参数。",
            snapshot: compactCanvasSnapshot(before),
        };
    }
    const after = canvas.applyOps(validated.ops) as CanvasAgentApplyResult;
    const changes = canvasMutationStats(before, after);
    const applied = Number.isInteger(after.agentReport?.applied) ? after.agentReport.applied : changes.total > 0 ? validated.ops.length : 0;
    return {
        requested: ops.length,
        applied,
        ignored: ops.length - applied,
        rejected: validated.rejected,
        ...(validated.rejected ? { reason: "partial_rejection", ...diagnostics } : {}),
        ...(after.agentReport?.errors?.length ? { errors: after.agentReport.errors } : {}),
        addedNodes: changes.addedNodes,
        addedConnections: changes.addedConnections,
        changedNodes: changes.changedNodes,
        removedNodes: changes.removedNodes,
        changedConnections: changes.changedConnections,
        removedConnections: changes.removedConnections,
        snapshot: compactCanvasSnapshot(after),
    };
}

function canvasAgentOpDiagnostics(snapshot: CanvasAgentSnapshot, ops: CanvasAgentOp[]) {
    const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const knownConnectionIds = new Set(snapshot.connections.map((connection) => connection.id));
    const invalidNodeIds = new Set<string>();
    const invalidConnectionIds = new Set<string>();
    const nodeId = (value: unknown) => String(value || "").trim();
    for (const op of ops) {
        if (op.type === "add_node") {
            const id = nodeId(op.id);
            if (id) knownNodeIds.add(id);
            continue;
        }
        if (op.type === "connect_nodes") {
            const from = nodeId(op.fromNodeId || op.from);
            const to = nodeId(op.toNodeId || op.to);
            if (from && !knownNodeIds.has(from)) invalidNodeIds.add(from);
            if (to && !knownNodeIds.has(to)) invalidNodeIds.add(to);
            continue;
        }
        if (op.type === "update_node" || op.type === "resize_node") {
            const id = nodeId(op.id);
            if (id && !knownNodeIds.has(id)) invalidNodeIds.add(id);
            continue;
        }
        if (op.type === "run_generation") {
            const id = nodeId(op.nodeId);
            if (id && !knownNodeIds.has(id)) invalidNodeIds.add(id);
            continue;
        }
        if (op.type === "move_nodes") {
            for (const item of op.items || []) {
                const id = nodeId(item.id);
                if (id && !knownNodeIds.has(id)) invalidNodeIds.add(id);
            }
            continue;
        }
        if (op.type === "select_nodes") {
            for (const id of op.ids || []) {
                const clean = nodeId(id);
                if (clean && !knownNodeIds.has(clean)) invalidNodeIds.add(clean);
            }
            continue;
        }
        if (op.type === "delete_node") {
            for (const id of [...(op.ids || []), ...(op.id ? [op.id] : [])]) {
                const clean = nodeId(id);
                if (clean && !knownNodeIds.has(clean)) invalidNodeIds.add(clean);
                knownNodeIds.delete(clean);
            }
            continue;
        }
        if (op.type === "delete_connections") {
            for (const id of [...(op.ids || []), ...(op.id ? [op.id] : [])]) {
                const clean = nodeId(id);
                if (clean && !knownConnectionIds.has(clean)) invalidConnectionIds.add(clean);
                knownConnectionIds.delete(clean);
            }
        }
    }
    return { invalidNodeIds: [...invalidNodeIds], invalidConnectionIds: [...invalidConnectionIds] };
}

type ImageOperationName = "crop" | "split" | "upscale" | "angle" | "reverse_prompt";

function duplicateCanvasSelection(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const before = liveSnapshot(canvas);
    const requested = Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const ids = [...new Set(requested.length ? requested : before.selectedNodeIds)];
    if (!ids.length) throw new Error("请提供 nodeIds 或先在画布中选中节点");
    if (ids.length > 50) throw new Error("一次最多复制 50 个节点");
    const selected = before.nodes.filter((node) => ids.includes(node.id));
    const missing = ids.filter((id) => !selected.some((node) => node.id === id));
    if (missing.length) throw new Error(`以下节点不存在：${missing.join("、")}`);
    const idMap = new Map(selected.map((node) => [node.id, `${node.type}-${nanoid(10)}`]));
    const offsetX = finiteNumber(input.offsetX, 48, -2_000, 2_000);
    const offsetY = finiteNumber(input.offsetY, 48, -2_000, 2_000);
    const copies = selected.map((node) => {
        const id = idMap.get(node.id)!;
        const copiedMetadata = copyCanvasNodeMetadata(node.metadata, idMap);
        const groupId = node.metadata?.groupId ? idMap.get(node.metadata.groupId) : undefined;
        return {
            sourceNodeId: node.id,
            id,
            op: {
                type: "add_node" as const,
                id,
                nodeType: node.type,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
                width: node.width,
                height: node.height,
                metadata: groupId ? { ...copiedMetadata, groupId } : copiedMetadata,
            },
        };
    });
    const selectedSet = new Set(ids);
    const copiedConnections = input.includeConnections === false
        ? []
        : before.connections.filter((connection) => selectedSet.has(connection.fromNodeId) && selectedSet.has(connection.toNodeId)).map((connection) => ({
              type: "connect_nodes" as const,
              fromNodeId: idMap.get(connection.fromNodeId)!,
              toNodeId: idMap.get(connection.toNodeId)!,
          }));
    const ops: CanvasAgentOp[] = [...copies.map((item) => item.op), ...copiedConnections, { type: "select_nodes", ids: copies.map((item) => item.id) }];
    const after = canvas.applyOps(ops) as CanvasAgentApplyResult;
    const createdIds = copies.map((item) => item.id).filter((id) => after.nodes.some((node) => node.id === id));
    if (createdIds.length !== copies.length) throw new Error("选中节点没有完整复制");
    return {
        duplicated: createdIds.length,
        copiedConnections: copiedConnections.length,
        nodeIds: createdIds,
        items: copies.map((item) => ({ sourceNodeId: item.sourceNodeId, copiedNodeId: item.id })),
        snapshot: compactCanvasSnapshot(after),
    };
}

function replaceCanvasWorkflowInput(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const before = liveSnapshot(canvas);
    assertWorkflowIdle(canvas);
    const targetNodeId = String(input.targetNodeId || "").trim();
    const sourceNodeId = String(input.sourceNodeId || "").trim();
    if (!targetNodeId) throw new Error("targetNodeId 不能为空");
    const target = before.nodes.find((node) => node.id === targetNodeId);
    if (!target) throw new Error(`目标输入节点不存在：${targetNodeId}`);
    if (!isResourceNode(target.type) || isProducedWorkflowResource(target.id, before)) throw new Error("目标必须是工作流的原始输入资源节点，不能是生成输出");
    let replacement: CanvasNodeMetadata;
    if (typeof input.text === "string" && input.text.trim()) {
        if (target.type !== "text") throw new Error("text 只能替换文字输入节点");
        replacement = { content: input.text, status: "success", errorDetails: undefined };
    } else {
        if (!sourceNodeId) throw new Error("sourceNodeId 和 text 至少需要提供一个");
        const source = before.nodes.find((node) => node.id === sourceNodeId);
        if (!source) throw new Error(`替换来源节点不存在：${sourceNodeId}`);
        if (source.id === target.id) throw new Error("替换来源不能与目标输入相同");
        if (source.type !== target.type) throw new Error(`来源类型 ${source.type} 与目标类型 ${target.type} 不一致`);
        if (!source.metadata?.content && !source.metadata?.storageKey) throw new Error("替换来源没有可用内容");
        replacement = resourceReplacementMetadata(source.metadata);
    }
    const downstream = downstreamWorkflowPlan(before, [target.id]);
    if (!downstream.executableNodeIds.length) throw new Error("目标输入没有连接到可执行的下游节点");
    const resetOps = resetDownstreamOps(before, downstream.nodeIds, new Set([target.id]));
    const after = canvas.applyOps([{ type: "update_node", id: target.id, metadata: replacement }, ...resetOps]) as CanvasAgentApplyResult;
    let workflow: ReturnType<NonNullable<CanvasAgentToolCanvas["startWorkflow"]>> | undefined;
    if (input.runDownstream === true) {
        if (!canvas.startWorkflow) throw new Error("输入已替换，但当前画布无法启动工作流");
        workflow = canvas.startWorkflow({ workflowId: downstream.workflowId, nodeIds: downstream.executableNodeIds });
    }
    return {
        targetNodeId: target.id,
        sourceNodeId: sourceNodeId || undefined,
        invalidatedNodeIds: downstream.nodeIds.filter((id) => id !== target.id),
        executableNodeIds: downstream.executableNodeIds,
        workflowId: downstream.workflowId,
        ...(workflow ? { workflow } : {}),
        snapshot: compactCanvasSnapshot(after),
    };
}

function runCanvasDownstream(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const before = liveSnapshot(canvas);
    assertWorkflowIdle(canvas);
    const requested = Array.isArray(input.sourceNodeIds) ? input.sourceNodeIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const sourceNodeIds = [...new Set(requested.length ? requested : before.selectedNodeIds)];
    if (!sourceNodeIds.length) throw new Error("请提供 sourceNodeIds 或先选中起点节点");
    const missing = sourceNodeIds.filter((id) => !before.nodes.some((node) => node.id === id));
    if (missing.length) throw new Error(`以下起点节点不存在：${missing.join("、")}`);
    const downstream = downstreamWorkflowPlan(before, sourceNodeIds);
    if (!downstream.executableNodeIds.length) throw new Error("所选节点没有可执行的下游步骤");
    let after = before;
    if (input.resetOutputs !== false) {
        after = canvas.applyOps(resetDownstreamOps(before, downstream.nodeIds, new Set(sourceNodeIds))) as CanvasAgentApplyResult;
    }
    if (!canvas.startWorkflow) throw new Error("当前画布无法启动工作流");
    const workflow = canvas.startWorkflow({ workflowId: downstream.workflowId, nodeIds: downstream.executableNodeIds });
    return {
        sourceNodeIds,
        executableNodeIds: downstream.executableNodeIds,
        resetNodeIds: input.resetOutputs === false ? [] : downstream.nodeIds.filter((id) => !sourceNodeIds.includes(id)),
        workflowId: downstream.workflowId,
        workflow,
        snapshot: compactCanvasSnapshot(after),
    };
}

function downstreamWorkflowPlan(snapshot: CanvasAgentSnapshot, sourceNodeIds: string[]) {
    const reachable = new Set(sourceNodeIds);
    const queue = [...sourceNodeIds];
    while (queue.length) {
        const current = queue.shift()!;
        snapshot.connections.filter((connection) => connection.fromNodeId === current).forEach((connection) => {
            if (reachable.has(connection.toNodeId)) return;
            reachable.add(connection.toNodeId);
            queue.push(connection.toNodeId);
        });
    }
    const executableNodeIds = snapshot.nodes.filter((node) => reachable.has(node.id) && isCanvasExecutableNode(node)).map((node) => node.id);
    const groups = buildCanvasSidePanelWorkflowGroups(snapshot.nodes, snapshot.connections).filter((group) => group.firstConfig && executableNodeIds.some((id) => group.nodes.some((node) => node.id === id)));
    if (groups.length !== 1) throw new Error(groups.length ? "下游节点跨越多个工作流，请缩小起点范围" : "没有找到对应工作流");
    return { workflowId: groups[0].id, nodeIds: [...reachable], executableNodeIds };
}

function resetDownstreamOps(snapshot: CanvasAgentSnapshot, nodeIds: string[], preservedIds: Set<string>): CanvasAgentOp[] {
    const resetIds = new Set(nodeIds.filter((id) => !preservedIds.has(id)));
    return snapshot.nodes.flatMap((node): CanvasAgentOp[] => {
        if (!resetIds.has(node.id)) return [];
        if (isCanvasExecutableNode(node)) {
            return [{ type: "update_node", id: node.id, metadata: resetExecutionMetadata(node.metadata) }];
        }
        if (!isResourceNode(node.type)) return [];
        return [{ type: "update_node", id: node.id, metadata: resetResourceOutputMetadata(node.metadata) }];
    });
}

function resetExecutionMetadata(metadata: CanvasNodeMetadata | undefined): CanvasNodeMetadata {
    return {
        status: "idle",
        executionStatus: undefined,
        errorDetails: undefined,
        taskId: undefined,
        taskKind: undefined,
        generationQueuedAt: undefined,
        generationStartedAt: undefined,
        generationCompletedAt: undefined,
        generationDurationMs: undefined,
        ...(metadata?.localImageOperation ? { localImageOperationCompletedCount: 0 } : {}),
    };
}

function resetResourceOutputMetadata(metadata: CanvasNodeMetadata | undefined): CanvasNodeMetadata {
    return {
        content: "",
        storageKey: undefined,
        thumbnailUrl: undefined,
        thumbnailKey: undefined,
        images: undefined,
        primaryImageId: undefined,
        naturalWidth: undefined,
        naturalHeight: undefined,
        bytes: undefined,
        mimeType: undefined,
        status: "idle",
        executionStatus: undefined,
        errorDetails: undefined,
        taskId: undefined,
        taskKind: undefined,
    };
}

function resourceReplacementMetadata(metadata: CanvasNodeMetadata): CanvasNodeMetadata {
    return {
        content: metadata.content || "",
        storageKey: metadata.storageKey,
        thumbnailUrl: metadata.thumbnailUrl,
        thumbnailKey: metadata.thumbnailKey,
        images: metadata.images,
        primaryImageId: metadata.primaryImageId,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        bytes: metadata.bytes,
        mimeType: metadata.mimeType,
        status: "success",
        executionStatus: undefined,
        errorDetails: undefined,
        taskId: undefined,
        taskKind: undefined,
    };
}

function isResourceNode(type: string) {
    return type === "text" || type === "image" || type === "video" || type === "audio";
}

function isProducedWorkflowResource(nodeId: string, snapshot: CanvasAgentSnapshot) {
    return snapshot.connections.some((connection) => connection.toNodeId === nodeId && isCanvasExecutableNode(snapshot.nodes.find((node) => node.id === connection.fromNodeId)));
}

function assertWorkflowIdle(canvas: CanvasAgentToolCanvas) {
    const status = canvas.getWorkflowState?.().status;
    if (status === "running" || status === "locked") throw new Error("工作流仍在执行，请先停止后再替换输入或重跑下游");
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

const IMAGE_OPERATION_SPECS: Record<ImageOperationName, { title: string; width: number; height: number }> = {
    crop: { title: "裁剪节点", width: 360, height: 414 },
    split: { title: "切图节点", width: 360, height: 414 },
    upscale: { title: "放大节点", width: 360, height: 414 },
    angle: { title: "多角度节点", width: 360, height: 414 },
    reverse_prompt: { title: "反推提示词节点", width: 360, height: 414 },
};

const REVERSE_PROMPT_PRESET = "请根据参考图片反推一段适合用于 AI 生图的提示词。\n\n要求：\n1. 只输出提示词正文，不要解释。\n2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。\n3. 尽量写成可直接用于生图模型的完整提示词。";

async function createCanvasImageOperation(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments));
    if (!input) throw new Error("参数不是有效的 JSON 对象");
    const operation = normalizeImageOperationName(input.operation);
    if (!operation) throw new Error("operation 必须是 crop、split、upscale、angle 或 reverse_prompt");
    const before = liveSnapshot(canvas);
    const requestedIds = Array.isArray(input.sourceNodeIds) ? input.sourceNodeIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const selectedIds = before.selectedNodeIds || [];
    const candidates = requestedIds.length ? requestedIds : selectedIds;
    const validImages = before.nodes.filter((node) => node.type === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey));
    let sources = candidates.map((id) => validImages.find((node) => node.id === id)).filter((node): node is (typeof validImages)[number] => Boolean(node));
    if (candidates.length > MAX_IMAGE_OPERATION_SOURCES) throw new Error(`一次最多创建 ${MAX_IMAGE_OPERATION_SOURCES} 个图片操作节点，当前选择了 ${candidates.length} 个`);
    if (requestedIds.length) {
        const invalidIds = [...new Set(requestedIds)].filter((id) => !sources.some((node) => node.id === id));
        if (invalidIds.length) throw new Error(`以下来源节点不是可用图片：${invalidIds.join("、")}`);
    }
    if (!sources.length && !candidates.length && validImages.length === 1) sources = validImages;
    if (!sources.length) {
        if (candidates.length) throw new Error("指定或选中的节点中没有可用图片");
        throw new Error(validImages.length > 1 ? "画布中有多张图片，请先选中目标图片" : "画布中没有可用图片");
    }
    const uniqueSources = [...new Map(sources.map((node) => [node.id, node])).values()];
    const params = asRecord(input.params) || {};
    const nodeType = imageOperationNodeType(operation);
    const spec = IMAGE_OPERATION_SPECS[operation];
    const created = uniqueSources.map((source, index) => {
        const id = `${nodeType}-${nanoid(10)}`;
        const metadata = imageOperationMetadata(operation, params);
        const title = operation === "angle" ? `${spec.title} · ${imageAngleLabel(metadata.imageAngleParams as ReturnType<typeof normalizeImageAngleParams>)}` : spec.title;
        return {
            source,
            node: {
                id,
                nodeType,
                title,
                position: { x: source.position.x + source.width + 96, y: source.position.y + index * 24 },
                width: spec.width,
                height: spec.height,
                metadata,
            },
        };
    });
    const ops: CanvasAgentOp[] = created.flatMap(({ source, node }) => [
        { type: "add_node", ...node },
        { type: "connect_nodes", fromNodeId: source.id, toNodeId: node.id },
    ]);
    ops.push({ type: "select_nodes", ids: created.map((item) => item.node.id) });
    const after = canvas.applyOps(ops) as CanvasAgentApplyResult;
    const createdNodeIds = created.map((item) => item.node.id).filter((id) => after.nodes.some((node) => node.id === id));
    if (createdNodeIds.length !== created.length) throw new Error("图片操作节点没有完整创建");
    let generation: { requestId: string; nodeIds: string[] } | undefined;
    if (input.execute === true) {
        if (!canvas.startGeneration) throw new Error("图片操作节点已创建，但当前画布无法启动执行");
        generation = canvas.startGeneration({ nodeIds: createdNodeIds, mode: operation === "reverse_prompt" ? "text" : "image" });
    }
    return {
        operation,
        created: createdNodeIds.length,
        sourceNodeIds: uniqueSources.map((node) => node.id),
        nodeIds: createdNodeIds,
        items: created.map((item) => ({ sourceNodeId: item.source.id, operationNodeId: item.node.id })),
        ...(generation ? { generation } : {}),
        snapshot: compactCanvasSnapshot(after),
    };
}

function normalizeImageOperationName(value: unknown): ImageOperationName | null {
    const normalized = String(value || "").trim().toLowerCase().replaceAll("-", "_");
    return normalized === "crop" || normalized === "split" || normalized === "upscale" || normalized === "angle" || normalized === "reverse_prompt" ? normalized : null;
}

function imageOperationNodeType(operation: ImageOperationName) {
    if (operation === "crop") return CanvasOperationNodeType.Crop;
    if (operation === "split") return CanvasOperationNodeType.Split;
    if (operation === "upscale") return CanvasOperationNodeType.Upscale;
    if (operation === "angle") return CanvasOperationNodeType.Angle;
    return CanvasOperationNodeType.ReversePrompt;
}

function imageOperationMetadata(operation: ImageOperationName, params: Record<string, unknown>): CanvasNodeMetadata {
    if (operation === "angle") {
        const angle = normalizeImageAngleParams(params);
        const prompt = imageAnglePrompt(angle);
        return { status: "idle", generationMode: "image", count: 1, composerContent: prompt, prompt, imageAngleParams: angle };
    }
    if (operation === "reverse_prompt") {
        return { status: "idle", generationMode: "text", count: 1, composerContent: REVERSE_PROMPT_PRESET };
    }
    const normalized = normalizeCanvasLocalImageOperationParams(operation, params);
    return {
        status: "idle",
        generationMode: "image",
        count: canvasLocalImageOperationOutputCount(operation, normalized),
        localImageOperation: operation,
        localImageOperationParams: normalized,
        localImageOperationCompletedCount: 0,
    };
}

function normalizeImageAngleParams(value: Record<string, unknown>) {
    const horizontalAngle = Number(value.horizontalAngle);
    const pitchAngle = Number(value.pitchAngle);
    const cameraDistance = Number(value.cameraDistance);
    return {
        horizontalAngle: Number.isFinite(horizontalAngle) ? Math.max(-180, Math.min(180, horizontalAngle)) : 45,
        pitchAngle: Number.isFinite(pitchAngle) ? Math.max(-90, Math.min(90, pitchAngle)) : 0,
        cameraDistance: Number.isFinite(cameraDistance) ? Math.max(1, Math.min(10, cameraDistance)) : 4.8,
        wideAngle: Boolean(value.wideAngle),
    };
}

function imageAngleLabel(params: ReturnType<typeof normalizeImageAngleParams>) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function imageAnglePrompt(params: ReturnType<typeof normalizeImageAngleParams>) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${imageAngleLabel(params)}。`;
}

function findCanvasNodes(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const snapshot = liveSnapshot(canvas);
    const query = String(input.query || "").trim().toLowerCase();
    const types = new Set(Array.isArray(input.types) ? input.types.map((type) => String(type || "").trim()).filter(Boolean) : []);
    const statuses = new Set(Array.isArray(input.statuses) ? input.statuses.map((status) => String(status || "").trim()).filter(Boolean) : []);
    const workflowIds = workflowNodeIdSet(snapshot, String(input.workflowId || "").trim());
    const offset = Math.max(0, Math.floor(Number(input.offset)) || 0);
    const limit = Math.max(1, Math.min(80, Math.floor(Number(input.limit)) || 20));
    const compact = compactCanvasSnapshot(snapshot);
    const compactById = new Map(compact.nodes.map((node) => [node.id, node]));
    const matches = snapshot.nodes.filter((node) => {
        if (types.size && !types.has(node.type)) return false;
        if (statuses.size && !statuses.has(String(node.metadata?.status || node.metadata?.executionStatus || ""))) return false;
        if (workflowIds && !workflowIds.has(node.id)) return false;
        if (!query) return true;
        return [node.id, node.title, node.type, node.metadata?.prompt, node.metadata?.composerContent, node.type === "text" ? node.metadata?.content : ""]
            .some((value) => typeof value === "string" && value.toLowerCase().includes(query));
    });
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
        total: matches.length,
        offset,
        nodes: page.map((node) => compactById.get(node.id) || compactNodeFallback(node)),
        truncated: nextOffset < matches.length,
        hasMore: nextOffset < matches.length,
        ...(nextOffset < matches.length ? { nextOffset } : {}),
    };
}

function inspectCanvasNodes(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const snapshot = liveSnapshot(canvas);
    const requested = Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const ids = requested.length ? requested : snapshot.selectedNodeIds;
    if (!ids.length) throw new Error("请提供 nodeIds 或先在画布中选中节点");
    const idSet = new Set(ids);
    const nodes = snapshot.nodes.filter((node) => idSet.has(node.id));
    if (!nodes.length) throw new Error("没有找到要检查的节点");
    return {
        total: nodes.length,
        nodes: nodes.map((node) => ({
            ...compactNodeFallback(node),
            upstreamNodeIds: snapshot.connections.filter((connection) => connection.toNodeId === node.id).map((connection) => connection.fromNodeId),
            downstreamNodeIds: snapshot.connections.filter((connection) => connection.fromNodeId === node.id).map((connection) => connection.toNodeId),
            metadata: inspectableNodeMetadata(node.metadata),
        })),
    };
}

function focusCanvasNodes(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    if (!canvas.focusNodes) throw new Error("当前画布不支持聚焦节点");
    const input = asRecord(safeParse(rawArguments)) || {};
    const snapshot = liveSnapshot(canvas);
    const requested = Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const ids = requested.length ? requested : snapshot.selectedNodeIds;
    const validIds = [...new Set(ids)].filter((id) => snapshot.nodes.some((node) => node.id === id));
    if (!validIds.length) throw new Error("没有可聚焦的节点");
    const after = canvas.focusNodes(validIds);
    return { focused: validIds.length, nodeIds: validIds, viewport: after.viewport, snapshot: compactCanvasSnapshot(after) };
}

function validateCanvasWorkflows(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const snapshot = liveSnapshot(canvas);
    const workflowId = String(input.workflowId || "").trim();
    const requiredInputNodeIds = [...new Set(Array.isArray(input.requiredInputNodeIds)
        ? input.requiredInputNodeIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [])];
    const groups = buildCanvasSidePanelWorkflowGroups(snapshot.nodes, snapshot.connections).filter((group) => group.firstConfig && (!workflowId || group.id === workflowId));
    if (!groups.length) throw new Error(workflowId ? `没有找到工作流 ${workflowId}` : "当前画布没有可执行工作流");
    const workflows = groups.map((group, index) => {
        const executableIds = group.nodes.filter((node) => isCanvasExecutableNode(node)).map((node) => node.id);
        const executableIdSet = new Set(executableIds);
        const compiled = compileCanvasWorkflow(snapshot.nodes, snapshot.connections, { configNodeIds: executableIds });
        const failedNodeIds = group.nodes.filter((node) => node.metadata?.status === "error").map((node) => node.id);
        const emptyInputNodeIds = group.nodes.filter((node) => {
            if ((node.type !== "image" && node.type !== "text") || node.metadata?.content) return false;
            const feedsExecutable = snapshot.connections.some((connection) => connection.fromNodeId === node.id && executableIdSet.has(connection.toNodeId));
            const producedByExecutable = snapshot.connections.some((connection) => connection.toNodeId === node.id && executableIdSet.has(connection.fromNodeId));
            return feedsExecutable && !producedByExecutable;
        }).map((node) => node.id);
        return {
            index: index + 1,
            id: group.id,
            title: group.firstConfig?.title || group.id,
            valid: compiled.ok && !emptyInputNodeIds.length,
            ...(compiled.ok ? { nodeIds: compiled.plan.nodeIds, layers: compiled.plan.layers } : { reason: compiled.reason, relatedNodeIds: compiled.nodeIds }),
            failedNodeIds,
            emptyInputNodeIds,
        };
    });
    const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const executableNodeIds = new Set(groups.flatMap((group) => group.nodes.filter((node) => isCanvasExecutableNode(node)).map((node) => node.id)));
    const outgoing = new Map<string, string[]>();
    snapshot.connections.forEach((connection) => outgoing.set(connection.fromNodeId, [...(outgoing.get(connection.fromNodeId) || []), connection.toNodeId]));
    const reachesExecutable = (startNodeId: string) => {
        const queue = [startNodeId];
        const visited = new Set<string>();
        while (queue.length) {
            const nodeId = queue.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);
            if (nodeId !== startNodeId && executableNodeIds.has(nodeId)) return true;
            (outgoing.get(nodeId) || []).forEach((nextNodeId) => {
                if (!visited.has(nextNodeId)) queue.push(nextNodeId);
            });
        }
        return false;
    };
    const missingRequiredInputNodeIds = requiredInputNodeIds.filter((nodeId) => !knownNodeIds.has(nodeId));
    const disconnectedRequiredInputNodeIds = requiredInputNodeIds.filter((nodeId) => knownNodeIds.has(nodeId) && !reachesExecutable(nodeId));
    return {
        valid: workflows.every((workflow) => workflow.valid) && !missingRequiredInputNodeIds.length && !disconnectedRequiredInputNodeIds.length,
        total: workflows.length,
        workflows,
        requiredInputNodeIds,
        missingRequiredInputNodeIds,
        disconnectedRequiredInputNodeIds,
    };
}

function resumeCanvasWorkflow(rawArguments: string, canvas: CanvasAgentToolCanvas, retryFailed: boolean) {
    if (!canvas.startWorkflow) throw new Error("当前画布不支持运行工作流");
    const input = asRecord(safeParse(rawArguments)) || {};
    const workflowId = String(input.workflowId || "").trim() || undefined;
    const snapshot = liveSnapshot(canvas);
    const groups = buildCanvasSidePanelWorkflowGroups(snapshot.nodes, snapshot.connections).filter((group) => group.firstConfig);
    if (workflowId && !groups.some((group) => group.id === workflowId)) throw new Error(`没有找到工作流 ${workflowId}`);
    if (!workflowId && groups.length !== 1) throw new Error(groups.length ? `当前有 ${groups.length} 个工作流，请明确指定 workflowId` : "当前画布没有可执行工作流");
    if (retryFailed) {
        const scopedIds = workflowId ? workflowNodeIdSet(snapshot, workflowId) : null;
        const failed = snapshot.nodes.filter((node) => isCanvasExecutableNode(node) && node.metadata?.status === "error" && (!scopedIds || scopedIds.has(node.id)));
        if (!failed.length) throw new Error("目标工作流中没有失败节点可重试");
    }
    const request = canvas.startWorkflow({ ...(workflowId ? { workflowId } : {}) });
    return { mode: retryFailed ? "retry_failed" : "resume", ...request, workflowState: canvas.getWorkflowState?.() };
}

function workflowNodeIdSet(snapshot: CanvasAgentSnapshot, workflowId: string) {
    if (!workflowId) return null;
    const group = buildCanvasSidePanelWorkflowGroups(snapshot.nodes, snapshot.connections).find((item) => item.id === workflowId);
    if (!group) throw new Error(`没有找到工作流 ${workflowId}`);
    return new Set(group.nodes.map((node) => node.id));
}

function compactNodeFallback(node: CanvasAgentSnapshot["nodes"][number]) {
    return {
        id: node.id,
        type: node.type,
        title: node.title,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        w: Math.round(node.width),
        h: Math.round(node.height),
        status: node.metadata?.status,
        executionStatus: node.metadata?.executionStatus,
        hasContent: Boolean(node.metadata?.content || node.metadata?.storageKey),
    };
}

function inspectableNodeMetadata(metadata: CanvasAgentSnapshot["nodes"][number]["metadata"]) {
    if (!metadata) return {};
    return {
        status: metadata.status,
        executionStatus: metadata.executionStatus,
        errorDetails: metadata.errorDetails,
        prompt: compactText(metadata.prompt),
        composerContent: compactText(metadata.composerContent),
        textContent: compactText(metadata.content && !String(metadata.content).startsWith("data:") && !String(metadata.content).startsWith("http") ? metadata.content : ""),
        hasContent: Boolean(metadata.content || metadata.storageKey || metadata.images?.length),
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        model: metadata.model,
        generationMode: metadata.generationMode,
        size: metadata.size,
        resolution: metadata.resolution,
        quality: metadata.quality,
        count: metadata.count,
        background: metadata.background,
        localImageOperation: metadata.localImageOperation,
        localImageOperationParams: metadata.localImageOperationParams,
        imageAngleParams: metadata.imageAngleParams,
        workflowProducerNodeId: metadata.workflowProducerNodeId,
        workflowOutputNodeIds: metadata.workflowOutputNodeIds,
    };
}

function runCanvasHistoryAction(name: "canvas_undo_last_action" | "canvas_redo_last_action", canvas: CanvasAgentToolCanvas) {
    const undo = name === "canvas_undo_last_action";
    const available = undo ? canvas.canUndo : canvas.canRedo;
    const action = undo ? canvas.undoOps : canvas.redoOps;
    if (!available || !action) throw new Error(undo ? "没有可撤销的 Agent 画布操作，或画布已在之后被修改" : "没有可重做的 Agent 画布操作，或画布已在之后被修改");
    const before = liveSnapshot(canvas);
    const after = action();
    if (!after) throw new Error(undo ? "撤销失败：画布已在之后被修改" : "重做失败：画布已在之后被修改");
    const changes = canvasMutationStats(before, after);
    if (!changes.total) throw new Error(undo ? "撤销没有改变画布" : "重做没有改变画布");
    return {
        restored: true,
        direction: undo ? "undo" : "redo",
        changedNodes: changes.changedNodes,
        changedConnections: changes.changedConnections,
        snapshot: compactCanvasSnapshot(after),
    };
}

type GenerationSettingsInput = {
    scope?: "auto" | "selection" | "workflow" | "all";
    workflowId?: string;
    nodeIds?: string[];
    size?: string;
    resolution?: string;
    quality?: string;
    model?: string;
    count?: number;
    background?: string;
};

function updateGenerationSettings(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const raw = asRecord(safeParse(rawArguments));
    if (!raw) throw new Error("参数不是有效的 JSON 对象");
    const input: GenerationSettingsInput = {
        scope: raw.scope === "selection" || raw.scope === "workflow" || raw.scope === "all" ? raw.scope : "auto",
        workflowId: String(raw.workflowId || "").trim() || undefined,
        nodeIds: Array.isArray(raw.nodeIds) ? raw.nodeIds.map((id) => String(id || "").trim()).filter(Boolean) : undefined,
        ...generationSettingStrings(raw),
        ...(typeof raw.count === "number" && Number.isInteger(raw.count) && raw.count > 0 ? { count: raw.count } : {}),
    };
    const settings = generationSettingsPatch(input);
    if (!Object.keys(settings).length) throw new Error("至少需要提供一个生成参数：size、quality、resolution、model、count 或 background");

    const before = liveSnapshot(canvas);
    const targets = resolveGenerationSettingTargets(before, input);
    const ops: CanvasAgentOp[] = targets.map((node) => ({ type: "update_node", id: node.id, metadata: settings }));
    const after = canvas.applyOps(ops) as CanvasAgentApplyResult;
    const afterById = new Map(after.nodes.map((node) => [node.id, node]));
    const updatedNodeIds = targets
        .filter((beforeNode) => {
            const afterNode = afterById.get(beforeNode.id);
            return Boolean(afterNode && Object.entries(settings).some(([key, value]) => beforeNode.metadata?.[key as keyof typeof settings] !== value && afterNode.metadata?.[key as keyof typeof settings] === value));
        })
        .map((node) => node.id);
    const changes = canvasMutationStats(before, after);
    if (changes.addedNodes || changes.addedConnections || changes.removedNodes || changes.removedConnections) {
        throw new Error("生成参数更新产生了非预期的画布结构变化");
    }
    return {
        matched: targets.length,
        updated: updatedNodeIds.length,
        unchanged: targets.length - updatedNodeIds.length,
        nodeIds: targets.map((node) => node.id),
        updatedNodeIds,
        settings,
        addedNodes: 0,
        addedConnections: 0,
    };
}

function generationSettingStrings(raw: Record<string, unknown>) {
    const fields = ["size", "resolution", "quality", "model", "background"] as const;
    return Object.fromEntries(fields.flatMap((field) => {
        const value = typeof raw[field] === "string" ? raw[field].trim() : "";
        return value ? [[field, value]] : [];
    })) as Pick<GenerationSettingsInput, "size" | "resolution" | "quality" | "model" | "background">;
}

function generationSettingsPatch(input: GenerationSettingsInput) {
    return {
        ...(input.size ? { size: input.size } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(typeof input.count === "number" ? { count: input.count } : {}),
        ...(input.background ? { background: input.background } : {}),
    };
}

function resolveGenerationSettingTargets(snapshot: CanvasAgentSnapshot, input: GenerationSettingsInput) {
    const configs = snapshot.nodes.filter(isImageGenerationConfig);
    const configById = new Map(configs.map((node) => [node.id, node]));
    if (!configs.length) throw new Error("当前画布没有可更新的生图配置节点");

    const resolveNodeIds = (nodeIds: string[]) => {
        const resolved = new Set<string>();
        nodeIds.forEach((nodeId) => {
            if (configById.has(nodeId)) {
                resolved.add(nodeId);
                return;
            }
            const node = snapshot.nodes.find((item) => item.id === nodeId);
            const producerId = String(node?.metadata?.workflowProducerNodeId || "").trim();
            if (producerId && configById.has(producerId)) {
                resolved.add(producerId);
                return;
            }
            snapshot.connections.forEach((connection) => {
                if (connection.toNodeId === nodeId && configById.has(connection.fromNodeId)) resolved.add(connection.fromNodeId);
            });
        });
        return resolved;
    };
    const ordered = (ids: Set<string>) => configs.filter((node) => ids.has(node.id));

    if (input.nodeIds?.length) {
        const targets = ordered(resolveNodeIds(input.nodeIds));
        if (!targets.length) throw new Error("nodeIds 没有指向生图配置节点或它们的输出图片");
        return targets;
    }

    const selectedTargets = ordered(resolveNodeIds(snapshot.selectedNodeIds || []));
    if (selectedTargets.length) return selectedTargets;
    if (input.scope === "selection") throw new Error("当前选区没有生图配置节点或由生图节点产生的图片");

    const groups = buildCanvasSidePanelWorkflowGroups(snapshot.nodes, snapshot.connections)
        .map((group) => ({ group, configs: group.nodes.filter(isImageGenerationConfig) }))
        .filter((item) => item.configs.length > 0);
    if (input.workflowId || input.scope === "workflow") {
        if (!input.workflowId) throw new Error("scope=workflow 时必须提供 workflowId");
        const matched = groups.find((item) => item.group.id === input.workflowId);
        if (!matched) throw new Error(`工作流不存在或不含生图配置节点：${input.workflowId}`);
        return matched.configs;
    }
    if (input.scope === "all") return configs;
    if (groups.length === 1) return groups[0].configs;
    throw new Error(`当前有 ${groups.length} 个生图工作流，请选中目标节点、指定 workflowId，或明确使用 scope=all`);
}

function isImageGenerationConfig(node: CanvasAgentSnapshot["nodes"][number]) {
    return node.type === "config" && (!node.metadata?.generationMode || node.metadata.generationMode === "image");
}

function liveSnapshot(canvas: CanvasAgentToolCanvas) {
    return canvas.readSnapshot?.() || canvas.snapshot;
}

function canvasMutationStats(before: CanvasAgentSnapshot, after: CanvasAgentSnapshot) {
    const beforeNodes = new Map(before.nodes.map((node) => [node.id, JSON.stringify(node)]));
    const afterNodes = new Map(after.nodes.map((node) => [node.id, JSON.stringify(node)]));
    const addedNodes = [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)).length;
    const removedNodes = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id)).length;
    const updatedNodes = [...afterNodes].filter(([id, value]) => beforeNodes.has(id) && beforeNodes.get(id) !== value).length;
    const connectionSignature = (connection: CanvasAgentSnapshot["connections"][number]) => `${connection.id}\0${connection.fromNodeId}\0${connection.toNodeId}`;
    const beforeConnections = new Set(before.connections.map(connectionSignature));
    const afterConnections = new Set(after.connections.map(connectionSignature));
    const addedConnections = [...afterConnections].filter((signature) => !beforeConnections.has(signature)).length;
    const removedConnections = [...beforeConnections].filter((signature) => !afterConnections.has(signature)).length;
    const selectionChanged = JSON.stringify(before.selectedNodeIds) !== JSON.stringify(after.selectedNodeIds);
    const viewportChanged = before.viewport.x !== after.viewport.x || before.viewport.y !== after.viewport.y || before.viewport.k !== after.viewport.k;
    const changedNodes = addedNodes + removedNodes + updatedNodes;
    const changedConnections = addedConnections + removedConnections;
    return {
        total: changedNodes + changedConnections + Number(selectionChanged) + Number(viewportChanged),
        addedNodes,
        changedNodes,
        removedNodes,
        addedConnections,
        changedConnections,
        removedConnections,
    };
}

function runGeneration(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    const input = asRecord(safeParse(rawArguments)) || {};
    const snapshot = liveSnapshot(canvas);
    const known = new Set(snapshot.nodes.map((node) => node.id));
    const requested = Array.isArray(input.nodeIds) ? input.nodeIds.map((id) => String(id || "").trim()) : [];
    const nodeIds = requested.filter((id) => known.has(id));
    const missing = requested.filter((id) => id && !known.has(id));
    if (!nodeIds.length) throw new Error(missing.length ? `节点不存在：${missing.join("、")}` : "nodeIds 为空");
    const mode = input.mode === "text" || input.mode === "image" || input.mode === "video" || input.mode === "audio" ? input.mode : undefined;
    const prompt = String(input.prompt || "").trim();
    if (canvas.startGeneration) return canvas.startGeneration({ nodeIds, ...(mode ? { mode } : {}), ...(prompt ? { prompt } : {}) });
    canvas.applyOps(nodeIds.map((nodeId) => ({ type: "run_generation", nodeId, ...(mode ? { mode } : {}), ...(prompt ? { prompt } : {}) })));
    return { triggered: nodeIds, ...(missing.length ? { missing } : {}) };
}

function runWorkflow(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    if (!canvas.startWorkflow) throw new Error("当前画布不支持工作流调度");
    const input = asRecord(safeParse(rawArguments)) || {};
    const workflowId = String(input.workflowId || "").trim();
    return canvas.startWorkflow(workflowId ? { workflowId } : {});
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
    const requestId = String(input.requestId || "").trim();
    const nodeIds = new Set((Array.isArray(input.nodeIds) ? input.nodeIds : []).map((id) => String(id || "").trim()).filter(Boolean));
    const waitSeconds = Math.max(0, Math.min(GENERATION_MAX_WAIT_SECONDS, Number(input.waitSeconds ?? GENERATION_DEFAULT_WAIT_SECONDS) || 0));
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
        const tracked = requestId && canvas.getGenerationStatus ? canvas.getGenerationStatus(requestId) : null;
        if (requestId && canvas.getGenerationStatus && !tracked) throw new Error(`生成请求不存在：${requestId}`);
        const tasks = tracked?.tasks || collectGenerationTasks(liveSnapshot(canvas), nodeIds);
        const settled = !tasks.some((task) => task.status === "running" || task.status === "queued");
        if (settled || Date.now() >= deadline) {
            return { ...(requestId ? { requestId } : {}), tasks, summary: summarizeGenerationTasks(tasks), settled };
        }
        await delay(GENERATION_POLL_MS);
    }
}

async function readWorkflowStatus(rawArguments: string, canvas: CanvasAgentToolCanvas) {
    if (!canvas.getWorkflowStatus) throw new Error("当前画布不支持工作流状态查询");
    const input = asRecord(safeParse(rawArguments)) || {};
    const requestId = String(input.requestId || "").trim();
    if (!requestId) throw new Error("requestId 为空");
    const waitSeconds = Math.max(0, Math.min(GENERATION_MAX_WAIT_SECONDS, Number(input.waitSeconds ?? GENERATION_DEFAULT_WAIT_SECONDS) || 0));
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
        const status = canvas.getWorkflowStatus(requestId);
        if (!status) throw new Error(`工作流请求不存在：${requestId}`);
        const settled = status.status !== "running" && status.status !== "queued";
        if (settled || Date.now() >= deadline) return { ...status, settled };
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
        const nodeType = (NODE_TYPES.has(type) ? type : "text") as CanvasAgentGraphNode["type"];
        nodes.push({
            key: firstString(record, ["key", "id", "ref", "name"]) || `n${nodes.length + 1}`,
            type: nodeType,
            title: firstString(record, ["title", "label", "name"]) || undefined,
            ...(nodeType === "text" ? { text: firstString(record, ["text", "content", "prompt"]) || undefined } : {}),
            ...(nodeType === "config" ? { composerContent: firstString(record, ["composerContent", "prompt"]) || undefined } : {}),
            ...(nodeType === "config" && ["text", "image", "video", "audio"].includes(firstString(record, ["generationMode", "mode"]))
                ? { generationMode: firstString(record, ["generationMode", "mode"]) as CanvasAgentGraphNode["generationMode"] }
                : {}),
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
