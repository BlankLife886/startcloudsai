import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { useAgentStore, type AgentRegenerateSelectionInput, type AgentRegenerateSelectionResult, type AgentWorkflowPreflightResult } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { clampCanvasAgentImageCounts } from "@/lib/canvas/canvas-agent-node-metadata";
import { canvasImageMaxCount } from "@/lib/canvas/canvas-image-model";
import { modelOptionMeta, useEffectiveConfig } from "@/stores/use-config-store";
import { MAX_CANVAS_AGENT_REGENERATION_SOURCES, planCanvasAgentRegeneration, resolveCanvasAgentRegenerationSourceIds } from "@/lib/canvas/canvas-agent-regenerate";
import { buildCanvasSidePanelWorkflowGroups } from "@/lib/canvas/canvas-workflow-groups";
import { isCanvasExecutableNode } from "@/lib/canvas/canvas-operation-node";
import { canvasAgentWorkflowStatus, type AgentWorkflowExecution } from "@/lib/canvas/canvas-agent-workflow-status";
import { observeCanvasWorkflowStart, type AgentWorkflowStartDecision } from "@/lib/canvas/canvas-agent-workflow-start";
import { canvasAgentTaskSalt } from "@/lib/canvas/canvas-agent-task-identity";
import { getNodeSpec } from "@/lib/canvas/node-registry";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";
import type { AgentTaskStatus } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { getCanvasTaskRecord, getCanvasAssistantRunRecord } from "@/services/canvas-task-api";
import { getCanvasWorkflowRun } from "@/services/canvas-workflow-run-api";
import { canvasAgentHistoryMatches, canvasAgentStatusIsTerminal, createAgentGenerationRecord, normalizeCanvasAgentContinuation, packCanvasAgentContinuation, reconcileAgentGenerationRecord, unpackCanvasAgentHistory, type AgentGenerationRecord, type AgentWorkflowRecord } from "@/lib/canvas/canvas-agent-continuation";

type GenerateNodeOptions = { skipCostConfirm?: boolean; workflowRunId?: string; taskKeySalt?: string; agentGenerationRequestId?: string };
type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: GenerateNodeOptions) => Promise<boolean>) | null>;
type WorkflowRunState = { status: string; completed: number; total: number; currentNodeId?: string; errorMessage?: string; startedAt?: string; attemptId?: number };
type RunWorkflowRef = MutableRefObject<((request?: { workflowId?: string; nodeIds?: string[]; onStartDecision?: (decision: AgentWorkflowStartDecision) => void }) => Promise<void>) | null>;
type StopWorkflowRef = MutableRefObject<(() => { stopped: boolean; status: string; nodeIds: string[] }) | null>;
type PlanWorkflowRef = MutableRefObject<((request?: { workflowId?: string; nodeIds?: string[] }) => AgentWorkflowPreflightResult) | null>;
type AgentWorkflowRunRecord = AgentWorkflowExecution & { workflowId?: string; configNodeIds: string[]; saved: AgentWorkflowRecord; recovered?: boolean };

type AgentBridgeParams = {
    projectId: string;
    projectReady: boolean;
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
    const ownerUserId = useCanvasStore((state) => state.ownerUserId);
    const effectiveConfig = useEffectiveConfig();
    const continuationScope = useRef("");
    const agentHistoryRef = useRef<AgentCanvasHistoryState>({ past: [], future: [], checkpoints: [] });
    const [agentHistoryVersion, setAgentHistoryVersion] = useState(0);
    const generationRuns = useMemo(() => new Map<string, AgentGenerationRecord>(), [projectId, ownerUserId]);
    const regenerationSources = useMemo(() => new Map<string, string[]>(), [projectId, ownerUserId]);
    const workflowRuns = useMemo(() => new Map<string, AgentWorkflowRunRecord>(), [projectId, ownerUserId]);
    const scopeKey = `${ownerUserId || ""}:${projectId}`;
    const historyUpdatedAtRef = useRef("");
    const assertReady = useCallback(() => {
        if (!params.projectReady || !ownerUserId || continuationScope.current !== scopeKey || useCanvasStore.getState().ownerUserId !== ownerUserId) throw new Error("画布恢复尚未完成，请稍后重试");
    }, [params.projectReady, ownerUserId, scopeKey]);
    const persistContinuation = useCallback(() => {
        assertReady();
        const state = useCanvasStore.getState();
        if (!state.projects.some((project) => project.id === projectId)) return;
        const packed = packCanvasAgentContinuation({ ownerUserId, projectId, history: agentHistoryRef.current, historyUpdatedAt: historyUpdatedAtRef.current, generations: generationRuns.values(), workflows: [...workflowRuns.values()].map((record) => record.saved), regenerations: [...regenerationSources].map(([batchId, sourceNodeIds]) => ({ batchId, sourceNodeIds, updatedAt: new Date().toISOString() })) });
        agentHistoryRef.current = unpackCanvasAgentHistory(packed);
        state.updateProject(projectId, { agentContinuation: packed });
        return packed;
    }, [assertReady, ownerUserId, projectId, generationRuns, workflowRuns, regenerationSources]);
    const setGenerationStatus = useCallback((record: AgentGenerationRecord, nodeId: string, status: AgentTaskStatus, error?: string) => {
        if (continuationScope.current !== scopeKey || useCanvasStore.getState().ownerUserId !== ownerUserId) return;
        record.tasks[nodeId] = { ...record.tasks[nodeId], status, error };
        record.updatedAt = new Date().toISOString();
        persistContinuation();
    }, [persistContinuation, scopeKey, ownerUserId]);
    useEffect(() => {
        if (!params.projectReady || !ownerUserId) return;
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project || project.documentPending) return;
        const saved = normalizeCanvasAgentContinuation(project.agentContinuation, { ownerUserId, projectId });
        agentHistoryRef.current = unpackCanvasAgentHistory(saved);
        historyUpdatedAtRef.current = saved?.historyUpdatedAt || "";
        generationRuns.clear(); workflowRuns.clear(); regenerationSources.clear();
        saved?.generations.forEach((record) => generationRuns.set(record.requestId, reconcileAgentGenerationRecord(record, nodesRef.current, true)));
        saved?.workflows.forEach((saved) => workflowRuns.set(saved.requestId, { baselineAttemptId: -1, configNodeIds: saved.configNodeIds, workflowId: saved.workflowId, settled: canvasAgentStatusIsTerminal(saved.status), saved, recovered: true }));
        saved?.regenerations.forEach((record) => regenerationSources.set(record.batchId, record.sourceNodeIds));
        continuationScope.current = scopeKey;
        setAgentHistoryVersion((version) => version + 1);
        return () => { if (continuationScope.current === scopeKey) continuationScope.current = ""; };
    }, [params.projectReady, ownerUserId, projectId, scopeKey, generationRuns, workflowRuns, regenerationSources]);
    useEffect(() => {
        if (continuationScope.current !== scopeKey || !params.projectReady) return;
        let changed = false;
        generationRuns.forEach((record, id) => {
            const next = reconcileAgentGenerationRecord(record, nodes);
            if (next !== record) { generationRuns.set(id, next); changed = true; }
        });
        if (changed) persistContinuation();
    }, [nodes, params.projectReady, generationRuns, persistContinuation, scopeKey]);
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
            assertReady();
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const applied = applyCanvasAgentOps(
                before,
                safeOps,
            );
            const next = {
                ...applied,
                nodes: clampCanvasAgentImageCounts(applied.nodes, (node) => {
                    const model = modelOptionMeta(effectiveConfig, node.metadata?.model || effectiveConfig.imageModel || effectiveConfig.model);
                    return model ? canvasImageMaxCount(model) : null;
                }),
            };
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
                historyUpdatedAtRef.current = transaction.createdAt;
                persistContinuation();
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
        [projectTitle, projectId, assertReady, persistContinuation, effectiveConfig],
    );
    const undoAgentOps = useCallback(() => {
        assertReady();
        const transaction = agentHistoryRef.current.past.at(-1);
        if (!transaction) return null;
        const current = currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef);
        if (!canvasAgentHistoryMatches(current, transaction.after)) return null;
        agentHistoryRef.current.past.pop();
        agentHistoryRef.current.future.push(transaction);
        setAgentHistoryVersion((version) => version + 1);
        historyUpdatedAtRef.current = new Date().toISOString();
        persistContinuation();
        return applyAgentSnapshot(transaction.before);
    }, [applyAgentSnapshot, connectionsRef, nodesRef, projectTitle, projectId, selectedNodeIdsRef, viewportRef, assertReady, persistContinuation]);
    const redoAgentOps = useCallback(() => {
        assertReady();
        const transaction = agentHistoryRef.current.future.at(-1);
        if (!transaction) return null;
        const current = currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef);
        if (!canvasAgentHistoryMatches(current, transaction.before)) return null;
        agentHistoryRef.current.future.pop();
        agentHistoryRef.current.past.push(transaction);
        setAgentHistoryVersion((version) => version + 1);
        historyUpdatedAtRef.current = new Date().toISOString();
        persistContinuation();
        return applyAgentSnapshot(transaction.after);
    }, [applyAgentSnapshot, connectionsRef, nodesRef, projectTitle, projectId, selectedNodeIdsRef, viewportRef, assertReady, persistContinuation]);

    const startGeneration = useCallback((input: { requestId?: string; nodeIds: string[]; mode?: "text" | "image" | "video" | "audio"; prompt?: string }) => {
        assertReady();
        const nodeIds = [...new Set(input.nodeIds)].filter((id) => nodesRef.current.some((node) => node.id === id && isCanvasExecutableNode(node)));
        if (!nodeIds.length || !generateNodeRef.current) throw new Error("没有可执行的配置节点");
        const requestId = input.requestId ? `generation-${input.requestId}` : `generation-${nanoid(10)}`;
        if (generationRuns.has(requestId)) return { requestId, nodeIds: generationRuns.get(requestId)!.nodeIds };
        const record = createAgentGenerationRecord(requestId, nodeIds, nodesRef.current);
        generationRuns.set(requestId, record);
        persistContinuation();
        nodeIds.forEach((nodeId) => {
            const target = nodesRef.current.find((node) => node.id === nodeId)!;
            const prompt = input.prompt?.trim() ? input.prompt : (target.metadata?.composerContent ?? target.metadata?.prompt ?? "");
            setGenerationStatus(record, nodeId, "running");
            void generateNodeRef.current!(nodeId, input.mode || target.metadata?.generationMode || "image", prompt, { taskKeySalt: canvasAgentTaskSalt(requestId), agentGenerationRequestId: requestId }).then(
                (ok) => setGenerationStatus(generationRuns.get(requestId) || record, nodeId, ok ? "succeeded" : "failed", ok ? undefined : "生成未完成"),
                (error) => setGenerationStatus(generationRuns.get(requestId) || record, nodeId, "failed", error instanceof Error ? error.message : "生成失败"),
            );
        });
        trimRunRegistry(generationRuns);
        return { requestId, nodeIds };
    }, [generationRuns, generateNodeRef, nodesRef, assertReady, persistContinuation, setGenerationStatus]);

    const getGenerationStatus = useCallback(async (requestId: string) => {
        assertReady();
        const record = generationRuns.get(requestId);
        if (!record) return null;
        for (const nodeId of record.nodeIds) {
            const task = record.tasks[nodeId];
            if (canvasAgentStatusIsTerminal(task.status) || !task.taskIds.length) continue;
            const states = await Promise.allSettled(task.taskIds.map(async (identity) => {
                const result = identity.kind === "assistant" ? (await getCanvasAssistantRunRecord(identity.id)).run : await getCanvasTaskRecord(identity.id);
                if (result.id !== identity.id) throw new Error("原任务记录不匹配");
                return result;
            }));
            assertReady();
            const status = states.some((state) => state.status === "rejected") ? "unknown" : states.some((state) => state.status === "fulfilled" && state.value.status === "failed") ? "failed" : states.some((state) => state.status === "fulfilled" && (state.value.status === "queued" || state.value.status === "running")) ? "running" : states.some((state) => state.status === "fulfilled" && state.value.status === "canceled") ? "canceled" : states.every((state) => state.status === "fulfilled" && state.value.status === "succeeded") ? "succeeded" : "unknown";
            setGenerationStatus(record, nodeId, status, status === "unknown" ? "暂时无法读取原任务状态，没有自动重新生成" : undefined);
        }
        return { requestId, tasks: record.nodeIds.map((nodeId) => ({ nodeId, status: record.tasks[nodeId].status, error: record.tasks[nodeId].error })) };
    }, [generationRuns, assertReady, setGenerationStatus]);

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
        assertReady();
        const instruction = String(input.instruction || "").trim();
        if (!instruction) throw new Error("重生成指令不能为空");
        const batchId = String(input.requestId || "").trim() || `regenerate-${nanoid(10)}`;
        const replay = generationRuns.get(`generation-${batchId}`);
        if (replay) throw new Error("这次重生成已经提交或恢复，请查询原任务状态，不要重复提交");
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
        assertReady();
        if (ops.length > 1) applyAgentOps(ops);

        if (!generateNodeRef.current) throw new Error("画布生成器尚未就绪");
        const generationRequestId = `generation-${batchId}`;
        const record = createAgentGenerationRecord(generationRequestId, items.map((item) => item.configNodeId), nodesRef.current);
        generationRuns.set(generationRequestId, record);
        persistContinuation();
        queueMicrotask(() => {
            if (continuationScope.current !== scopeKey) return;
            items.forEach((item) => {
                setGenerationStatus(record, item.configNodeId, "running");
                void generateNodeRef.current!(item.configNodeId, "image", instruction, {
                    skipCostConfirm: true,
                    taskKeySalt: `${batchId}:${item.sourceNodeId}`,
                    agentGenerationRequestId: generationRequestId,
                }).then(
                    (ok) => setGenerationStatus(generationRuns.get(generationRequestId) || record, item.configNodeId, ok ? "succeeded" : "failed", ok ? undefined : "生成未完成"),
                    (error) => setGenerationStatus(generationRuns.get(generationRequestId) || record, item.configNodeId, "failed", error instanceof Error ? error.message : "生成失败"),
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
    }, [applyAgentOps, confirmImageGenerationBatch, generateNodeRef, generationRuns, nodesRef, regenerationSources, selectedNodeIdsRef, assertReady, persistContinuation, setGenerationStatus, scopeKey]);

    const startWorkflow = useCallback(async (input: { workflowId?: string; nodeIds?: string[] }) => {
        assertReady();
        if (!runWorkflowRef.current) throw new Error("工作流调度器尚未就绪");
        const groups = buildCanvasSidePanelWorkflowGroups(nodesRef.current, connectionsRef.current).filter((group) => group.firstConfig);
        const group = input.workflowId ? groups.find((item) => item.id === input.workflowId) : null;
        if (input.workflowId && !group) throw new Error(`工作流不存在：${input.workflowId}`);
        const requestedIds = input.nodeIds?.length ? new Set(input.nodeIds) : null;
        const configNodeIds = (group?.nodes || nodesRef.current).filter((node) => isCanvasExecutableNode(node) && (!requestedIds || requestedIds.has(node.id))).map((node) => node.id);
        if (requestedIds && configNodeIds.length !== requestedIds.size) throw new Error("定向运行包含不属于目标工作流的节点");
        if (!configNodeIds.length) throw new Error("工作流中没有可执行的配置节点");
        const requestId = `workflow-${nanoid(10)}`;
        const now = new Date().toISOString();
        const record: AgentWorkflowRunRecord = { workflowId: input.workflowId, configNodeIds, baselineAttemptId: workflowRunStateRef.current.attemptId || 0, settled: false, saved: { requestId, workflowId: input.workflowId, configNodeIds, createdAt: now, updatedAt: now, status: "queued", completed: 0, total: configNodeIds.length } };
        workflowRuns.set(requestId, record);
        persistContinuation();
        const run = runWorkflowRef.current;
        const execution = observeCanvasWorkflowStart(
            (onStartDecision) => run({ ...input, onStartDecision }),
            () => ({ status: "rejected", error: workflowRunStateRef.current.attemptId !== record.baselineAttemptId
                ? workflowRunStateRef.current.errorMessage || "工作流未通过启动检查，请查看画布状态"
                : "工作流未启动，请检查预检结果或当前运行状态" }),
        );
        void execution.completion.then(
            () => { record.settled = true; record.finalState ||= { ...workflowRunStateRef.current }; },
            (error) => { record.settled = true; record.finalState = { ...workflowRunStateRef.current }; record.error = error instanceof Error ? error.message : "工作流运行失败"; },
        );
        trimRunRegistry(workflowRuns);
        const decision = await execution.decision;
        assertReady();
        record.saved = { ...record.saved, runId: decision.runId, status: decision.status === "started" ? "running" : decision.status === "canceled" ? "canceled" : "failed", error: decision.error, updatedAt: new Date().toISOString() };
        if (decision.status !== "started") {
            record.settled = true;
            if (decision.status === "rejected") record.error = decision.error || "工作流没有启动";
            record.finalState = { status: decision.status === "canceled" ? "canceled" : "error", attemptId: record.baselineAttemptId, completed: 0, total: configNodeIds.length };
        }
        persistContinuation();
        return { requestId, ...(input.workflowId ? { workflowId: input.workflowId } : {}), configNodeIds, ...decision };
    }, [connectionsRef, nodesRef, runWorkflowRef, workflowRunStateRef, workflowRuns, assertReady, persistContinuation]);

    const getWorkflowStatus = useCallback(async (requestId: string) => {
        assertReady();
        const record = workflowRuns.get(requestId);
        if (!record) return null;
        if (record.saved.runId) {
            try {
                const { run } = await getCanvasWorkflowRun(projectId, record.saved.runId);
                assertReady();
                if (run.id !== record.saved.runId || run.projectId !== projectId) throw new Error("工作流记录不匹配");
                record.saved = { ...record.saved, status: run.status, completed: run.completedNodeIds.length, currentNodeId: run.currentNodeId || undefined, error: run.errorMessage, updatedAt: new Date().toISOString() };
            } catch (error) {
                assertReady();
                record.saved = { ...record.saved, status: "unknown", error: "暂时无法读取原工作流，没有自动重新运行" };
            }
            persistContinuation();
            return record.saved;
        }
        if (record.recovered) return { ...record.saved, status: canvasAgentStatusIsTerminal(record.saved.status) ? record.saved.status : "unknown" as const, error: record.saved.error || "刷新前未记录到工作流启动确认，没有自动重跑" };
        const { state, started, status } = canvasAgentWorkflowStatus(record, workflowRunStateRef.current);
        return {
            requestId,
            ...(record.workflowId ? { workflowId: record.workflowId } : {}),
            status,
            completed: started ? state.completed : 0,
            total: record.configNodeIds.length,
            ...(started && state.currentNodeId ? { currentNodeId: state.currentNodeId } : {}),
            ...((record.error || state.errorMessage) && status === "failed" ? { error: record.error || state.errorMessage } : {}),
        };
    }, [workflowRunStateRef, workflowRuns, assertReady, persistContinuation, projectId]);

    const listAgentHistory = useCallback(() => ({
        past: agentHistoryRef.current.past.map(historySummary),
        future: agentHistoryRef.current.future.map(historySummary),
        checkpoints: agentHistoryRef.current.checkpoints.map(({ snapshot: _snapshot, ...checkpoint }) => checkpoint),
    }), [agentHistoryVersion]);

    const createAgentCheckpoint = useCallback((name: string) => {
        assertReady();
        const checkpoint: AgentCanvasCheckpoint = {
            id: `checkpoint-${nanoid(10)}`,
            name: name.slice(0, 80),
            createdAt: new Date().toISOString(),
            snapshot: currentAgentSnapshot(projectId, projectTitle, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef),
        };
        const previous = agentHistoryRef.current.checkpoints;
        agentHistoryRef.current.checkpoints = [...previous.slice(-9), checkpoint];
        historyUpdatedAtRef.current = checkpoint.createdAt;
        try { persistContinuation(); } catch (error) { agentHistoryRef.current.checkpoints = previous; throw error; }
        setAgentHistoryVersion((version) => version + 1);
        return { id: checkpoint.id, name: checkpoint.name, createdAt: checkpoint.createdAt };
    }, [connectionsRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, viewportRef, assertReady, persistContinuation]);

    const restoreAgentHistory = useCallback((input: { checkpointId?: string; transactionId?: string }) => {
        assertReady();
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
        historyUpdatedAtRef.current = restoreTransaction.createdAt;
        persistContinuation();
        return applyAgentSnapshot(target);
    }, [applyAgentSnapshot, connectionsRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, viewportRef, assertReady, persistContinuation]);

    useEffect(() => {
        if (!params.projectReady || continuationScope.current !== scopeKey) { setAgentCanvasContext(null); return; }
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
    }, [params.projectReady, scopeKey, agentHistoryVersion, agentSnapshot, applyAgentOps, createAgentCheckpoint, focusNodes, getGenerationStatus, getWorkflowStatus, listAgentHistory, planWorkflowRef, redoAgentOps, regenerateSelection, restoreAgentHistory, setAgentCanvasContext, startGeneration, startWorkflow, stopWorkflowRef, undoAgentOps, workflowRunStateRef]);

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
