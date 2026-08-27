import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { useAgentStore, type AgentRegenerateSelectionInput, type AgentRegenerateSelectionResult, type AgentWorkflowPreflightResult } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { MAX_CANVAS_AGENT_REGENERATION_SOURCES, planCanvasAgentRegeneration, resolveCanvasAgentRegenerationSourceIds } from "@/lib/canvas/canvas-agent-regenerate";
import { buildCanvasSidePanelWorkflowGroups } from "@/lib/canvas/canvas-workflow-groups";
import { isCanvasExecutableNode } from "@/lib/canvas/canvas-operation-node";
import { getNodeSpec } from "@/lib/canvas/node-registry";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";
import type { AgentTaskStatus } from "@/stores/use-agent-store";

type GenerateNodeOptions = { skipCostConfirm?: boolean; workflowRunId?: string; taskKeySalt?: string };
type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: GenerateNodeOptions) => Promise<boolean>) | null>;
type WorkflowRunState = { status: string; completed: number; total: number; currentNodeId?: string; errorMessage?: string; startedAt?: string };
type RunWorkflowRef = MutableRefObject<((request?: { workflowId?: string; nodeIds?: string[] }) => Promise<void>) | null>;
type StopWorkflowRef = MutableRefObject<(() => { stopped: boolean; status: string; nodeIds: string[] }) | null>;
type PlanWorkflowRef = MutableRefObject<((request?: { workflowId?: string; nodeIds?: string[] }) => AgentWorkflowPreflightResult) | null>;
type AgentGenerationRunRecord = { nodeIds: string[]; statuses: Map<string, { status: AgentTaskStatus; error?: string }> };
type AgentWorkflowRunRecord = { workflowId?: string; configNodeIds: string[]; baselineStartedAt?: string; settled: boolean; error?: string };

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    canvasSize: { width: number; height: number };
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    runWorkflowRef: RunWorkflowRef;
    stopWorkflowRef: StopWorkflowRef;
    planWorkflowRef: PlanWorkflowRef;
    workflowRunStateRef: MutableRefObject<WorkflowRunState>;
    confirmImageGenerationBatch: (count: number) => Promise<boolean>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, canvasSize, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, runWorkflowRef, stopWorkflowRef, planWorkflowRef, workflowRunStateRef, confirmImageGenerationBatch, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const agentHistoryRef = useRef<AgentCanvasHistoryState>({ past: [], future: [], checkpoints: [] });
    const [agentHistoryVersion, setAgentHistoryVersion] = useState(0);
    const generationRuns = useMemo(() => new Map<string, AgentGenerationRunRecord>(), []);
    const regenerationSources = useMemo(() => new Map<string, string[]>(), []);
    const workflowRuns = useMemo(() => new Map<string, AgentWorkflowRunRecord>(), []);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSelectedNodeIds = useMemo(() => Array.from(selectedNodeIds), [selectedNodeIds]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: agentSelectedNodeIds, viewport }), [agentSelectedNodeIds, connections, projectTitle, nodes, projectId, viewport]);
    const applyAgentSnapshot = useCallback((snapshot: CanvasAgentSnapshot) => {
        nodesRef.current = snapshot.nodes;
        connectionsRef.current = snapshot.connections;
        selectedNodeIdsRef.current = new Set(snapshot.selectedNodeIds);
        viewportRef.current = snapshot.viewport;
        setNodes(snapshot.nodes);
        setConnections(snapshot.connections);
        setSelectedNodeIds(new Set(snapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(snapshot.viewport);
        setContextMenu(null);
        return { ...snapshot, projectId, title: projectTitle };
    }, [connectionsRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, viewportRef]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps,
            );
            const after = { ...next, projectId, title: projectTitle };
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            if (canvasAgentHistoryChanged(before, after)) {
                const transaction = createAgentHistoryTransaction(before, after, agentOperationName(safeOps));
                agentHistoryRef.current.past = [...agentHistoryRef.current.past.slice(-29), transaction];
                agentHistoryRef.current.future = [];
                setAgentHistoryVersion((version) => version + 1);
            }
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return after;
        },
        [projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        const transaction = agentHistoryRef.current.past.at(-1);
        if (!transaction) return null;
        const current = currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef);
        if (!canvasAgentHistoryMatches(current, transaction.after)) return null;
        agentHistoryRef.current.past.pop();
        agentHistoryRef.current.future.push(transaction);
        setAgentHistoryVersion((version) => version + 1);
        return applyAgentSnapshot(transaction.before);
    }, [applyAgentSnapshot, connectionsRef, nodesRef, projectTitle, projectId, selectedNodeIdsRef, viewportRef]);
    const redoAgentOps = useCallback(() => {
        const transaction = agentHistoryRef.current.future.at(-1);
        if (!transaction) return null;
        const current = currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef);
        if (!canvasAgentHistoryMatches(current, transaction.before)) return null;
        agentHistoryRef.current.future.pop();
        agentHistoryRef.current.past.push(transaction);
        setAgentHistoryVersion((version) => version + 1);
        return applyAgentSnapshot(transaction.after);
    }, [applyAgentSnapshot, connectionsRef, nodesRef, projectTitle, projectId, selectedNodeIdsRef, viewportRef]);

    const startGeneration = useCallback((input: { nodeIds: string[]; mode?: "text" | "image" | "video" | "audio"; prompt?: string }) => {
        const nodeIds = [...new Set(input.nodeIds)].filter((id) => nodesRef.current.some((node) => node.id === id && isCanvasExecutableNode(node)));
        if (!nodeIds.length || !generateNodeRef.current) throw new Error("没有可执行的配置节点");
        const requestId = `generation-${nanoid(10)}`;
        const record: AgentGenerationRunRecord = { nodeIds, statuses: new Map(nodeIds.map((nodeId) => [nodeId, { status: "queued" as AgentTaskStatus }])) };
        generationRuns.set(requestId, record);
        nodeIds.forEach((nodeId) => {
            const target = nodesRef.current.find((node) => node.id === nodeId)!;
            const prompt = input.prompt?.trim() ? input.prompt : (target.metadata?.composerContent ?? target.metadata?.prompt ?? "");
            record.statuses.set(nodeId, { status: "running" });
            void generateNodeRef.current!(nodeId, input.mode || target.metadata?.generationMode || "image", prompt).then(
                (ok) => record.statuses.set(nodeId, ok ? { status: "succeeded" } : { status: "failed", error: nodesRef.current.find((node) => node.id === nodeId)?.metadata?.errorDetails || "生成未完成" }),
                (error) => record.statuses.set(nodeId, { status: "failed", error: error instanceof Error ? error.message : "生成失败" }),
            );
        });
        trimRunRegistry(generationRuns);
        return { requestId, nodeIds };
    }, [generationRuns, generateNodeRef, nodesRef]);

    const getGenerationStatus = useCallback((requestId: string) => {
        const record = generationRuns.get(requestId);
        if (!record) return null;
        return { requestId, tasks: record.nodeIds.map((nodeId) => ({ nodeId, ...(record.statuses.get(nodeId) || { status: "queued" as const }) })) };
    }, [generationRuns]);

    const focusNodes = useCallback((nodeIds: string[]) => {
        const targets = nodesRef.current.filter((node) => nodeIds.includes(node.id));
        if (!targets.length) throw new Error("没有可聚焦的节点");
        const bounds = targets.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const width = Math.max(1, bounds.right - bounds.left);
        const height = Math.max(1, bounds.bottom - bounds.top);
        const k = Math.min(Math.max(Math.min((canvasSize.width * 0.72) / width, (canvasSize.height * 0.72) / height), 0.05), 1.25);
        const nextViewport = {
            x: canvasSize.width / 2 - ((bounds.left + bounds.right) / 2) * k,
            y: canvasSize.height / 2 - ((bounds.top + bounds.bottom) / 2) * k,
            k,
        };
        return applyAgentOps([{ type: "select_nodes", ids: targets.map((node) => node.id) }, { type: "set_viewport", viewport: nextViewport }]);
    }, [applyAgentOps, canvasSize.height, canvasSize.width, nodesRef]);

    const regenerateSelection = useCallback(async (input: AgentRegenerateSelectionInput): Promise<AgentRegenerateSelectionResult> => {
        const instruction = String(input.instruction || "").trim();
        if (!instruction) throw new Error("重生成指令不能为空");
        const batchId = String(input.requestId || "").trim() || `regenerate-${nanoid(10)}`;
        const validSourceNode = (id: string) => {
            const node = nodesRef.current.find((item) => item.id === id);
            return Boolean(node?.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey || node.metadata?.images?.some((image) => image.content || image.storageKey)));
        };
        const liveSelectedIds = Array.from(selectedNodeIdsRef.current);
        const sourceNodeIds = resolveCanvasAgentRegenerationSourceIds({
            replayIds: regenerationSources.get(batchId),
            liveSelectedIds: Array.from(selectedNodeIdsRef.current),
            isValidSourceId: validSourceNode,
        });
        const sourceNodes = sourceNodeIds
            .map((id) => nodesRef.current.find((node) => node.id === id))
            .filter((node): node is CanvasNodeData => Boolean(node && validSourceNode(node.id)));
        if (!sourceNodes.length) throw new Error("选区中没有可作为参考图的图片节点");
        if (sourceNodes.length > MAX_CANVAS_AGENT_REGENERATION_SOURCES) throw new Error(`一次最多分别重生成 ${MAX_CANVAS_AGENT_REGENERATION_SOURCES} 张参考图`);
        if (!regenerationSources.has(batchId)) regenerationSources.set(batchId, sourceNodeIds);
        trimRunRegistry(regenerationSources);
        const skippedNodeIds = liveSelectedIds.filter((id) => !sourceNodeIds.includes(id));

        const configSpec = getNodeSpec(CanvasNodeType.Config);
        const imageSpec = getNodeSpec(CanvasNodeType.Image);
        const plan = planCanvasAgentRegeneration({
            nodes: nodesRef.current,
            sourceNodes,
            batchId,
            instruction,
            createId: (type) => `${type}-${nanoid(8)}`,
            configSize: { width: configSpec.width, height: configSpec.height },
            imageSize: { width: imageSpec.width, height: imageSpec.height },
        });
        const { items, ops, createdBranches } = plan;
        if (createdBranches && !(await confirmImageGenerationBatch(sourceNodes.length))) {
            regenerationSources.delete(batchId);
            return { status: "canceled", batchId, createdBranches: 0, selectedNodeCount: liveSelectedIds.length, sourceImageCount: sourceNodes.length, skippedNodeIds, items: [] };
        }
        if (ops.length > 1) applyAgentOps(ops);

        if (!generateNodeRef.current) throw new Error("画布生成器尚未就绪");
        const generationRequestId = `generation-${nanoid(10)}`;
        const record: AgentGenerationRunRecord = {
            nodeIds: items.map((item) => item.configNodeId),
            statuses: new Map(items.map((item) => [item.configNodeId, { status: "queued" as AgentTaskStatus }])),
        };
        generationRuns.set(generationRequestId, record);
        queueMicrotask(() => {
            items.forEach((item) => {
                record.statuses.set(item.configNodeId, { status: "running" });
                void generateNodeRef.current!(item.configNodeId, "image", instruction, {
                    skipCostConfirm: true,
                    taskKeySalt: `${batchId}:${item.sourceNodeId}`,
                }).then(
                    (ok) => record.statuses.set(item.configNodeId, ok ? { status: "succeeded" } : { status: "failed", error: nodesRef.current.find((node) => node.id === item.configNodeId)?.metadata?.errorDetails || "生成未完成" }),
                    (error) => record.statuses.set(item.configNodeId, { status: "failed", error: error instanceof Error ? error.message : "生成失败" }),
                );
            });
        });
        trimRunRegistry(generationRuns);
        return {
            status: "started",
            batchId,
            generationRequestId,
            createdBranches,
            selectedNodeCount: liveSelectedIds.length,
            sourceImageCount: sourceNodes.length,
            skippedNodeIds,
            items: items.map(({ sourceNodeId, configNodeId, outputNodeId }) => ({ sourceNodeId, configNodeId, outputNodeId })),
        };
    }, [applyAgentOps, confirmImageGenerationBatch, generateNodeRef, generationRuns, nodesRef, regenerationSources, selectedNodeIdsRef]);

    const startWorkflow = useCallback((input: { workflowId?: string; nodeIds?: string[] }) => {
        if (!runWorkflowRef.current) throw new Error("工作流调度器尚未就绪");
        const groups = buildCanvasSidePanelWorkflowGroups(nodesRef.current, connectionsRef.current).filter((group) => group.firstConfig);
        const group = input.workflowId ? groups.find((item) => item.id === input.workflowId) : null;
        if (input.workflowId && !group) throw new Error(`工作流不存在：${input.workflowId}`);
        const requestedIds = input.nodeIds?.length ? new Set(input.nodeIds) : null;
        const configNodeIds = (group?.nodes || nodesRef.current).filter((node) => isCanvasExecutableNode(node) && (!requestedIds || requestedIds.has(node.id))).map((node) => node.id);
        if (requestedIds && configNodeIds.length !== requestedIds.size) throw new Error("定向运行包含不属于目标工作流的节点");
        if (!configNodeIds.length) throw new Error("工作流中没有可执行的配置节点");
        const requestId = `workflow-${nanoid(10)}`;
        const record: AgentWorkflowRunRecord = { workflowId: input.workflowId, configNodeIds, baselineStartedAt: workflowRunStateRef.current.startedAt, settled: false };
        workflowRuns.set(requestId, record);
        void runWorkflowRef.current(input).then(
            () => { record.settled = true; },
            (error) => { record.settled = true; record.error = error instanceof Error ? error.message : "工作流运行失败"; },
        );
        trimRunRegistry(workflowRuns);
        return { requestId, ...(input.workflowId ? { workflowId: input.workflowId } : {}), configNodeIds };
    }, [connectionsRef, nodesRef, runWorkflowRef, workflowRunStateRef, workflowRuns]);

    const getWorkflowStatus = useCallback((requestId: string) => {
        const record = workflowRuns.get(requestId);
        if (!record) return null;
        const state = workflowRunStateRef.current;
        const started = Boolean(state.startedAt && state.startedAt !== record.baselineStartedAt);
        const status: AgentTaskStatus = record.error
            ? "failed"
            : !record.settled
              ? started && (state.status === "running" || state.status === "locked") ? "running" : "queued"
              : !started ? "canceled" : state.status === "success" ? "succeeded" : state.status === "error" ? "failed" : state.status === "canceled" ? "canceled" : "running";
        return {
            requestId,
            ...(record.workflowId ? { workflowId: record.workflowId } : {}),
            status,
            completed: started ? state.completed : 0,
            total: record.configNodeIds.length,
            ...(started && state.currentNodeId ? { currentNodeId: state.currentNodeId } : {}),
            ...((record.error || state.errorMessage) && status === "failed" ? { error: record.error || state.errorMessage } : {}),
        };
    }, [workflowRunStateRef, workflowRuns]);

    const listAgentHistory = useCallback(() => ({
        past: agentHistoryRef.current.past.map(historySummary),
        future: agentHistoryRef.current.future.map(historySummary),
        checkpoints: agentHistoryRef.current.checkpoints.map(({ snapshot: _snapshot, ...checkpoint }) => checkpoint),
    }), [agentHistoryVersion]);

    const createAgentCheckpoint = useCallback((name: string) => {
        const checkpoint: AgentCanvasCheckpoint = {
            id: `checkpoint-${nanoid(10)}`,
            name: name.slice(0, 80),
            createdAt: new Date().toISOString(),
            snapshot: currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef),
        };
        agentHistoryRef.current.checkpoints = [...agentHistoryRef.current.checkpoints.slice(-9), checkpoint];
        setAgentHistoryVersion((version) => version + 1);
        return { id: checkpoint.id, name: checkpoint.name, createdAt: checkpoint.createdAt };
    }, [connectionsRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, viewportRef]);

    const restoreAgentHistory = useCallback((input: { checkpointId?: string; transactionId?: string }) => {
        const current = currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef);
        const checkpoint = input.checkpointId ? agentHistoryRef.current.checkpoints.find((item) => item.id === input.checkpointId) : null;
        const transaction = input.transactionId
            ? [...agentHistoryRef.current.past, ...agentHistoryRef.current.future].find((item) => item.id === input.transactionId)
            : null;
        const target = checkpoint?.snapshot || transaction?.before;
        if (!target || canvasAgentSnapshotsEqual(current, target)) return null;
        const restoreTransaction = createAgentHistoryTransaction(current, target, checkpoint ? `恢复检查点：${checkpoint.name}` : `恢复事务：${transaction?.name || input.transactionId}`);
        agentHistoryRef.current.past = [...agentHistoryRef.current.past.slice(-29), restoreTransaction];
        agentHistoryRef.current.future = [];
        setAgentHistoryVersion((version) => version + 1);
        return applyAgentSnapshot(target);
    }, [applyAgentSnapshot, connectionsRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, viewportRef]);

    useEffect(() => {
        setAgentCanvasContext({
            snapshot: agentSnapshot,
            applyOps: applyAgentOps,
            undoOps: undoAgentOps,
            redoOps: redoAgentOps,
            canUndo: Boolean(agentHistoryRef.current.past.at(-1) && canvasAgentHistoryMatches(agentSnapshot, agentHistoryRef.current.past.at(-1)!.after)),
            canRedo: Boolean(agentHistoryRef.current.future.at(-1) && canvasAgentHistoryMatches(agentSnapshot, agentHistoryRef.current.future.at(-1)!.before)),
            startGeneration,
            getGenerationStatus,
            regenerateSelection,
            startWorkflow,
            getWorkflowStatus,
            focusNodes,
            stopWorkflow: () => {
                if (!stopWorkflowRef.current) throw new Error("工作流停止控制尚未就绪");
                return stopWorkflowRef.current();
            },
            getWorkflowState: () => ({ ...workflowRunStateRef.current }),
            planWorkflow: (input) => {
                if (!planWorkflowRef.current) throw new Error("工作流预检尚未就绪");
                return planWorkflowRef.current(input);
            },
            listHistory: listAgentHistory,
            createCheckpoint: createAgentCheckpoint,
            restoreHistory: restoreAgentHistory,
        });
    }, [agentHistoryVersion, agentSnapshot, applyAgentOps, createAgentCheckpoint, focusNodes, getGenerationStatus, getWorkflowStatus, listAgentHistory, planWorkflowRef, redoAgentOps, regenerateSelection, restoreAgentHistory, setAgentCanvasContext, startGeneration, startWorkflow, stopWorkflowRef, undoAgentOps, workflowRunStateRef]);

    useEffect(() => {
        return () => setAgentCanvasContext(null);
    }, [setAgentCanvasContext]);

    return { applyAgentOps };
}

type AgentCanvasHistoryTransaction = { id: string; name: string; createdAt: string; before: CanvasAgentSnapshot; after: CanvasAgentSnapshot };
type AgentCanvasCheckpoint = { id: string; name: string; createdAt: string; snapshot: CanvasAgentSnapshot };
type AgentCanvasHistoryState = { past: AgentCanvasHistoryTransaction[]; future: AgentCanvasHistoryTransaction[]; checkpoints: AgentCanvasCheckpoint[] };

function createAgentHistoryTransaction(before: CanvasAgentSnapshot, after: CanvasAgentSnapshot, name: string): AgentCanvasHistoryTransaction {
    return { id: `transaction-${nanoid(10)}`, name, createdAt: new Date().toISOString(), before, after };
}

function agentOperationName(ops: CanvasAgentOp[]) {
    const labels = [...new Set(ops.map((op) => op.type))];
    return labels.length ? labels.join(" + ") : "Agent 画布操作";
}

function historySummary(transaction: AgentCanvasHistoryTransaction) {
    return { id: transaction.id, name: transaction.name, createdAt: transaction.createdAt };
}

function canvasAgentHistoryChanged(before: CanvasAgentSnapshot, after: CanvasAgentSnapshot) {
    return before.nodes !== after.nodes
        || before.connections !== after.connections
        || before.viewport.x !== after.viewport.x
        || before.viewport.y !== after.viewport.y
        || before.viewport.k !== after.viewport.k
        || before.selectedNodeIds.length !== after.selectedNodeIds.length
        || before.selectedNodeIds.some((id, index) => id !== after.selectedNodeIds[index]);
}

function canvasAgentHistoryMatches(current: CanvasAgentSnapshot, expected: CanvasAgentSnapshot) {
    return current.nodes === expected.nodes && current.connections === expected.connections;
}

function canvasAgentSnapshotsEqual(current: CanvasAgentSnapshot, expected: CanvasAgentSnapshot) {
    return canvasAgentHistoryMatches(current, expected)
        && current.viewport.x === expected.viewport.x
        && current.viewport.y === expected.viewport.y
        && current.viewport.k === expected.viewport.k
        && current.selectedNodeIds.length === expected.selectedNodeIds.length
        && current.selectedNodeIds.every((id, index) => id === expected.selectedNodeIds[index]);
}

function currentAgentSnapshot(
    projectId: string,
    title: string,
    nodesRef: { current: CanvasAgentSnapshot["nodes"] },
    connectionsRef: { current: CanvasAgentSnapshot["connections"] },
    selectedNodeIdsRef: { current: Set<string> },
    viewportRef: { current: CanvasAgentSnapshot["viewport"] },
): CanvasAgentSnapshot {
    return {
        projectId,
        title,
        nodes: nodesRef.current,
        connections: connectionsRef.current,
        selectedNodeIds: Array.from(selectedNodeIdsRef.current),
        viewport: viewportRef.current,
    };
}

function trimRunRegistry<T>(registry: Map<string, T>, limit = 24) {
    while (registry.size > limit) registry.delete(registry.keys().next().value!);
}
