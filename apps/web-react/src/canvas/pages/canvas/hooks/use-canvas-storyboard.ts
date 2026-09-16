import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { MessageInstance } from "antd/es/message/interface";

import { buildNodeGenerationInputs } from "@/components/canvas/canvas-node-generation";
import { classifyStoryboardBatchImages, combineStoryboardTextInputs, resolveStoryboardInputSelection, resolveStoryboardScriptInput } from "@/lib/canvas/canvas-storyboard-script-editing";
import type { StoryboardGenerationOptions, StoryboardProgressEvent } from "@/lib/canvas/canvas-storyboard-page";
import { asStoryboardStyle, NODE_STATUS_ERROR, NODE_STATUS_IDLE, NODE_STATUS_LOADING, NODE_STATUS_SUCCESS } from "@/lib/canvas/canvas-storyboard-page";
import { isGenerationCanceled } from "@/lib/canvas/canvas-generation-helpers";
import { detectStoryboardShotCount, buildStoryboardVariantPlan, buildStoryboardRefPlan, buildStoryboardRefShotIds, resolveBatchMode, resolveStoryboardConsistency, resolveStoryboardParseMode, STORYBOARD_INPUT_LIMIT, STORYBOARD_MAX_SCENES } from "@/lib/canvas/storyboard-parser";
import type { StoryboardPlan } from "@/lib/canvas/storyboard-parser";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { ReasoningEffort } from "@/stores/use-config-store";

type CommitNodes = (updater: (current: CanvasNodeData[]) => CanvasNodeData[]) => CanvasNodeData[];

export type StoryboardConfigRunOptions = {
    skipCostConfirm?: boolean;
    waitForSlot?: boolean;
    /** Workflow runs should refresh existing shot nodes in place, not spawn a new batch. */
    reuseExistingOutputs?: boolean;
    /**
     * Stable within one workflow run (use runId) so crash-resume replays the
     * same server tasks, but different across deliberate re-runs so swapped
     * inputs are not served from the previous idempotent result.
     */
    taskKeySalt?: string;
    /**
     * Set while running inside a workflow, so shot tasks use the workflow key
     * format. Folding the runId into a manual key instead overflows the
     * server's 128-character idempotency key limit.
     */
    workflowRunId?: string;
};

export type StoryboardConfigRunResult = {
    ok: boolean;
    expectedCount: number;
    canceled?: boolean;
    errorMessage?: string;
};

type UseCanvasStoryboardConfigParams = {
    t: TFunction;
    message: MessageInstance;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    storyboardAbortRef: MutableRefObject<AbortController | null>;
    storyboardSourceNodeIdRef: MutableRefObject<string | null>;
    storyboardConfigDriverRef: MutableRefObject<string | null>;
    storyboardCancelRequestedRef: MutableRefObject<boolean>;
    setStoryboardSourceNodeId: (id: string | null) => void;
    setRunningNodeIds: Dispatch<SetStateAction<Set<string>>>;
    commitNodes: CommitNodes;
    analyzeStoryboard: (
        script: string,
        options: StoryboardGenerationOptions,
        modelOverrides?: { textModel?: string; reasoningEffort?: ReasoningEffort },
        runOptions?: { skipCostConfirm?: boolean },
    ) => Promise<
        | { status: "ok"; plan: StoryboardPlan; fallbackMessage?: string }
        | { status: "canceled" }
        | { status: "failed"; message: string }
    >;
    generateStoryboard: (
        plan: StoryboardPlan,
        script: string,
        options: StoryboardGenerationOptions,
        report: (event: StoryboardProgressEvent) => void,
        producerNodeId?: string | null,
        runOptions?: { skipCostConfirm?: boolean; reuseExistingOutputs?: boolean; taskKeySalt?: string; workflowRunId?: string },
    ) => Promise<void>;
};

function driverWasCanceled(nodes: CanvasNodeData[], nodeId: string) {
    const driver = nodes.find((node) => node.id === nodeId);
    return driver?.metadata?.executionStatus === "canceled" || driver?.metadata?.generationStage === "canceled";
}

async function waitForStoryboardSlot(
    storyboardAbortRef: MutableRefObject<AbortController | null>,
    storyboardConfigDriverRef: MutableRefObject<string | null>,
    isCanceled: () => boolean,
    timeoutMs = 15 * 60 * 1000,
) {
    const startedAt = Date.now();
    while (storyboardAbortRef.current || storyboardConfigDriverRef.current) {
        if (isCanceled()) return false;
        if (Date.now() - startedAt > timeoutMs) return false;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    }
    return true;
}

/** Fully-automatic storyboard config: format → AI recognize/polish → generate images. */
export function useCanvasStoryboardConfigRunner(params: UseCanvasStoryboardConfigParams) {
    const {
        t,
        message,
        nodesRef,
        connectionsRef,
        storyboardAbortRef,
        storyboardSourceNodeIdRef,
        storyboardConfigDriverRef,
        storyboardCancelRequestedRef,
        setStoryboardSourceNodeId,
        setRunningNodeIds,
        commitNodes,
        analyzeStoryboard,
        generateStoryboard,
    } = params;

    const patchStoryboardConfigDriver = useCallback(
        (nodeId: string | null | undefined, patch: Partial<CanvasNodeData["metadata"]>) => {
            if (!nodeId) return;
            commitNodes((current) =>
                current.map((node) => (node.id === nodeId && node.metadata?.storyboardConfig ? { ...node, metadata: { ...node.metadata, ...patch } } : node)),
            );
        },
        [commitNodes],
    );

    const runStoryboardFromConfigNode = useCallback(
        async (nodeId: string, runOptions: StoryboardConfigRunOptions = {}): Promise<StoryboardConfigRunResult> => {
            const fail = (errorMessage: string, expectedCount = 0, canceled = false): StoryboardConfigRunResult => ({
                ok: false,
                expectedCount,
                canceled,
                errorMessage,
            });
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node?.metadata?.storyboardConfig) return fail(t("canvas.workflow.nodeMissing"));
            if (storyboardAbortRef.current || storyboardConfigDriverRef.current) {
                if (!runOptions.waitForSlot) {
                    message.info(t("canvas.storyboard.alreadyRunning"));
                    return fail(t("canvas.storyboard.alreadyRunning"), 0, true);
                }
                const slotReady = await waitForStoryboardSlot(storyboardAbortRef, storyboardConfigDriverRef, () => storyboardCancelRequestedRef.current);
                if (!slotReady) return fail(t("canvas.storyboard.alreadyRunning"), 0, true);
                if (storyboardAbortRef.current || storyboardConfigDriverRef.current) {
                    return fail(t("canvas.storyboard.alreadyRunning"), 0, true);
                }
            }
            const inputs = buildNodeGenerationInputs(nodeId, nodesRef.current, connectionsRef.current);
            const inputSelection = resolveStoryboardInputSelection(inputs, node.metadata);
            const selectedInputs = inputs.filter((input) => inputSelection.selectedNodeIds.has(input.nodeId));
            const connectedScript = combineStoryboardTextInputs(selectedInputs.filter((input) => input.type === "text"), inputSelection.roles);
            const selectedTextInputs = selectedInputs.filter((input) => input.type === "text");
            if (selectedTextInputs.length && !inputSelection.primaryTextNodeId) {
                message.warning(t("canvas.storyboard.inputPrimaryRequired"));
                return fail(t("canvas.storyboard.inputPrimaryRequired"));
            }
            const fallbackDirectScript = String(
                connectionsRef.current
                    .filter((connection) => connection.toNodeId === nodeId)
                    .map((connection) => nodesRef.current.find((item) => item.id === connection.fromNodeId))
                    .find((source) => source?.type === "text")
                    ?.metadata?.content
                || connectionsRef.current
                    .filter((connection) => connection.toNodeId === nodeId)
                    .map((connection) => nodesRef.current.find((item) => item.id === connection.fromNodeId))
                    .find((source) => source?.type === "text")
                    ?.metadata?.composerContent
                || connectionsRef.current
                    .filter((connection) => connection.toNodeId === nodeId)
                    .map((connection) => nodesRef.current.find((item) => item.id === connection.fromNodeId))
                    .find((source) => source?.type === "text")
                    ?.metadata?.prompt
                || "",
            ).trim();
            // Once the input manager has candidates, an empty selection is an
            // intentional user choice; do not silently promote the first text.
            const directConnectedScript = inputs.length || Array.isArray(node.metadata.storyboardInputNodeIds) ? connectedScript : fallbackDirectScript;
            const localScript = String(
                node.metadata.storyboardScript || node.metadata.composerContent || node.metadata.prompt || "",
            ).trim();
            // A user edit detaches the node from its connected source. In
            // detached mode an intentionally empty script must remain empty;
            // silently falling back to upstream text makes clearing a linked
            // script impossible to understand or control.
            const script = resolveStoryboardScriptInput({
                connectedScript: directConnectedScript,
                localScript,
                inputMode: node.metadata.storyboardInputMode,
            }).script;
            const selectedImageInputs = selectedInputs.filter((input) => input.type === "image" && input.image);
            const batchMode = resolveBatchMode(node.metadata.batchMode);
            const classifiedImages = classifyStoryboardBatchImages(selectedImageInputs, inputSelection.roles, batchMode);
            const driverImageInputs = batchMode === "refs" ? classifiedImages.inputImages : selectedImageInputs;
            const selectedImageCount = driverImageInputs.length;
            const designatedReferenceCount = classifiedImages.referenceImages.length;
            if (batchMode !== "refs" && selectedImageInputs.length > 4) {
                message.warning(t("canvas.storyboard.inputTooManyImages", { max: 4, count: selectedImageInputs.length }));
                return fail(t("canvas.storyboard.inputTooManyImages", { max: 4, count: selectedImageInputs.length }));
            }
            if (batchMode === "refs" && designatedReferenceCount > 4) {
                message.warning(t("canvas.storyboard.inputTooManyImages", { max: 4, count: designatedReferenceCount }));
                return fail(t("canvas.storyboard.inputTooManyImages", { max: 4, count: designatedReferenceCount }));
            }
            if (batchMode === "refs" && selectedImageCount > STORYBOARD_MAX_SCENES) {
                message.warning(t("canvas.storyboard.inputTooManyImages", { max: STORYBOARD_MAX_SCENES, count: selectedImageCount }));
                return fail(t("canvas.storyboard.inputTooManyImages", { max: STORYBOARD_MAX_SCENES, count: selectedImageCount }));
            }
            if (batchMode === "refs" && selectedImageCount < 1) {
                message.warning(t("canvas.storyboard.refsRequired"));
                return fail(t("canvas.storyboard.refsRequired"));
            }
            if (script.length > STORYBOARD_INPUT_LIMIT) {
                message.warning(t("canvas.storyboard.scriptTooLong", { max: STORYBOARD_INPUT_LIMIT }));
                return fail(t("canvas.storyboard.scriptTooLong", { max: STORYBOARD_INPUT_LIMIT }));
            }
            if (!script) {
                message.warning(t("canvas.storyboard.scriptRequired"));
                return fail(t("canvas.storyboard.scriptRequired"));
            }
            const sourceNodeIds = selectedInputs.filter((input) => input.type === "text").map((input) => input.nodeId);
            const sourceNodeId = sourceNodeIds[0] || node.metadata.storyboardSourceNodeId || null;
            storyboardSourceNodeIdRef.current = sourceNodeId;
            setStoryboardSourceNodeId(sourceNodeId);
            storyboardConfigDriverRef.current = nodeId;
            storyboardCancelRequestedRef.current = false;
            setRunningNodeIds((current) => new Set(current).add(nodeId));

            const style = asStoryboardStyle(node.metadata.storyboardStyle);
            const parseMode = resolveStoryboardParseMode(node.metadata.storyboardParseMode);
            const aiPolish = batchMode === "split" ? node.metadata.storyboardAiPolish === true : false;
            const variantCount = Math.min(100, Math.max(1, Math.floor(Number(node.metadata.batchVariantCount) || 4)));
            const detectedCount =
                batchMode === "variants"
                    ? variantCount
                    : batchMode === "refs"
                      ? selectedImageCount
                      : detectStoryboardShotCount(script, style, parseMode) || 6;
            const options: StoryboardGenerationOptions = {
                style,
                sceneCount: detectedCount,
                aspectRatio: String(node.metadata.size || node.metadata.storyboardAspectRatio || "auto"),
                consistency: resolveStoryboardConsistency(batchMode, node.metadata.storyboardConsistency),
                parseMode,
                aiPolish,
                shotTypeOverrides: node.metadata.storyboardShotTypeOverrides,
            };

            patchStoryboardConfigDriver(nodeId, {
                status: NODE_STATUS_LOADING,
                executionStatus: "running",
                generationStage: "formatting",
                storyboardShotCount: detectedCount,
                storyboardSceneCount: detectedCount,
                batchMode,
                batchVariantCount: batchMode === "variants" ? variantCount : node.metadata.batchVariantCount,
                storyboardScript: script,
                storyboardInputNodeIds: [...inputSelection.selectedNodeIds],
                storyboardPrimaryTextNodeId: inputSelection.primaryTextNodeId,
                storyboardInputRoles: inputSelection.roles,
                storyboardSourceNodeIds: sourceNodeIds.length ? sourceNodeIds : node.metadata.storyboardSourceNodeIds,
                errorDetails: undefined,
                generationStartedAt: new Date().toISOString(),
                generationCompletedAt: undefined,
                generationDurationMs: undefined,
            });
            const startedAt = Date.now();
            const settleCanceled = () => {
                patchStoryboardConfigDriver(nodeId, {
                    status: NODE_STATUS_IDLE,
                    executionStatus: "canceled",
                    generationStage: "canceled",
                    errorDetails: undefined,
                    storyboardProgressDone: undefined,
                    storyboardProgressTotal: undefined,
                    generationCompletedAt: new Date().toISOString(),
                    generationDurationMs: Date.now() - startedAt,
                });
            };
            try {
                if (storyboardCancelRequestedRef.current || driverWasCanceled(nodesRef.current, nodeId)) {
                    settleCanceled();
                    return fail(t("canvas.generation.canceled"), detectedCount, true);
                }
                let plan: StoryboardPlan;
                if (batchMode === "variants") {
                    plan = buildStoryboardVariantPlan(script, variantCount, { style });
                } else if (batchMode === "refs") {
                    const refItems = driverImageInputs.map((input) => ({
                        id: input.image?.id || input.nodeId,
                        title: input.title,
                        nodeId: input.nodeId,
                    }));
                    plan = buildStoryboardRefPlan(script, refItems, { style });
                    patchStoryboardConfigDriver(nodeId, {
                        storyboardInputShotIds: buildStoryboardRefShotIds(plan.scenes, refItems),
                    });
                } else {
                    patchStoryboardConfigDriver(nodeId, { generationStage: aiPolish ? "analyzing" : "formatting" });
                    const analysis = await analyzeStoryboard(script, options, {
                        textModel: node.metadata.storyboardTextModel || undefined,
                        reasoningEffort: node.metadata.reasoningEffort || undefined,
                    }, { skipCostConfirm: runOptions.skipCostConfirm });
                    if (storyboardCancelRequestedRef.current || driverWasCanceled(nodesRef.current, nodeId) || analysis.status === "canceled") {
                        settleCanceled();
                        return fail(t("canvas.generation.canceled"), detectedCount, true);
                    }
                    if (analysis.status === "failed") {
                        patchStoryboardConfigDriver(nodeId, {
                            status: NODE_STATUS_ERROR,
                            executionStatus: "failed",
                            generationStage: "failed",
                            errorDetails: analysis.message || t("canvas.storyboard.analysisFailed"),
                            generationCompletedAt: new Date().toISOString(),
                            generationDurationMs: Date.now() - startedAt,
                        });
                        message.error(analysis.message || t("canvas.storyboard.analysisFailed"));
                        return fail(analysis.message || t("canvas.storyboard.analysisFailed"), detectedCount);
                    }
                    if (analysis.fallbackMessage) {
                        message.warning(t("canvas.storyboard.analysisFallback"));
                    }
                    plan = analysis.plan;
                }
                if (!plan.scenes.length) {
                    patchStoryboardConfigDriver(nodeId, {
                        status: NODE_STATUS_ERROR,
                        executionStatus: "failed",
                        generationStage: "failed",
                        errorDetails: t("canvas.storyboard.analysisFailed"),
                        generationCompletedAt: new Date().toISOString(),
                        generationDurationMs: Date.now() - startedAt,
                    });
                    return fail(t("canvas.storyboard.analysisFailed"), detectedCount);
                }
                patchStoryboardConfigDriver(nodeId, {
                    generationStage: "generating",
                    storyboardShotCount: plan.scenes.length,
                    storyboardSceneCount: plan.scenes.length,
                    storyboardTitle: plan.title,
                    storyboardGlobalStyle: plan.globalStyle,
                    storyboardPlanSource: plan.source,
                });
                // Progress events can be replayed by task recovery and a
                // cancellation can be reported by both the local scheduler
                // and the server callback. Keep the latest state per scene so
                // the displayed progress never exceeds the actual shot count.
                const sceneStatuses = new Map<
                    string,
                    StoryboardProgressEvent["status"]
                >();
                const totalShots = plan.scenes.length;
                patchStoryboardConfigDriver(nodeId, {
                    storyboardProgressDone: 0,
                    storyboardProgressTotal: totalShots,
                });
                await generateStoryboard(
                    plan,
                    script,
                    { ...options, sceneCount: plan.scenes.length },
                    (event) => {
                        sceneStatuses.set(event.sceneId, event.status);
                        const terminalCount = [...sceneStatuses.values()].filter(
                            (status) => status === "succeeded" || status === "failed" || status === "canceled",
                        ).length;
                        if (event.status === "running" || event.status === "queued" || event.status === "succeeded" || event.status === "failed" || event.status === "canceled") {
                            patchStoryboardConfigDriver(nodeId, {
                                generationStage: "generating",
                                storyboardProgressDone: Math.min(totalShots, terminalCount),
                                storyboardProgressTotal: totalShots,
                            });
                        }
                    },
                    nodeId,
                    { skipCostConfirm: runOptions.skipCostConfirm, reuseExistingOutputs: runOptions.reuseExistingOutputs, taskKeySalt: runOptions.taskKeySalt, workflowRunId: runOptions.workflowRunId },
                );
                const statuses = [...sceneStatuses.values()];
                const failed = statuses.filter((status) => status === "failed").length;
                const canceled = statuses.filter((status) => status === "canceled").length;
                const succeeded = statuses.filter((status) => status === "succeeded").length;
                const terminalCount = failed + canceled + succeeded;
                if (storyboardCancelRequestedRef.current || driverWasCanceled(nodesRef.current, nodeId)) {
                    settleCanceled();
                    return fail(t("canvas.generation.canceled"), totalShots, true);
                }
                const wasCanceled = Boolean(storyboardCancelRequestedRef.current) && succeeded === 0 && failed === 0;
                const allCanceled = canceled === totalShots && succeeded === 0 && failed === 0;
                const hasIncompleteResult = terminalCount < totalShots;
                const hasPartialResult = hasIncompleteResult || (failed > 0 || canceled > 0) && succeeded > 0;
                patchStoryboardConfigDriver(nodeId, {
                    status: wasCanceled || allCanceled ? NODE_STATUS_IDLE : failed || hasPartialResult ? NODE_STATUS_ERROR : NODE_STATUS_SUCCESS,
                    executionStatus: wasCanceled || allCanceled ? "canceled" : failed || hasPartialResult ? "failed" : "succeeded",
                    generationStage: wasCanceled || allCanceled ? "canceled" : failed || hasPartialResult ? "failed" : "completed",
                    errorDetails: failed || hasPartialResult ? t("canvas.storyboard.generationFailed") : undefined,
                    generationCompletedAt: new Date().toISOString(),
                    generationDurationMs: Date.now() - startedAt,
                });
                if (wasCanceled || allCanceled) return fail(t("canvas.generation.canceled"), totalShots, true);
                if (failed || hasPartialResult) return fail(t("canvas.storyboard.generationFailed"), totalShots);
                return { ok: true, expectedCount: totalShots };
            } catch (error) {
                if (isGenerationCanceled(error) || storyboardCancelRequestedRef.current) {
                    settleCanceled();
                    return fail(t("canvas.generation.canceled"), detectedCount, true);
                }
                const errorDetails = error instanceof Error ? error.message : t("canvas.storyboard.generationFailed");
                patchStoryboardConfigDriver(nodeId, {
                    status: NODE_STATUS_ERROR,
                    executionStatus: "failed",
                    generationStage: "failed",
                    errorDetails,
                    generationCompletedAt: new Date().toISOString(),
                    generationDurationMs: Date.now() - startedAt,
                });
                message.error(errorDetails);
                return fail(errorDetails, detectedCount);
            } finally {
                if (storyboardConfigDriverRef.current === nodeId) storyboardConfigDriverRef.current = null;
                setRunningNodeIds((current) => {
                    if (!current.has(nodeId)) return current;
                    const next = new Set(current);
                    next.delete(nodeId);
                    return next;
                });
            }
        },
        [
            analyzeStoryboard,
            connectionsRef,
            generateStoryboard,
            message,
            nodesRef,
            patchStoryboardConfigDriver,
            setRunningNodeIds,
            setStoryboardSourceNodeId,
            storyboardAbortRef,
            storyboardCancelRequestedRef,
            storyboardConfigDriverRef,
            storyboardSourceNodeIdRef,
            t,
        ],
    );

    return { patchStoryboardConfigDriver, runStoryboardFromConfigNode };
}
