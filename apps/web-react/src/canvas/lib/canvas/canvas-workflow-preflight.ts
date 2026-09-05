import { buildNodeGenerationInputs } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { isCanvasGenerationModeEnabled } from "@/constant/canvas";
import { buildGenerationConfig, getGenerationCount, getInputSummary } from "@/lib/canvas/canvas-generation-helpers";
import { estimateCanvasGenerationCost, type CanvasCostEstimate } from "@/lib/canvas/canvas-generation-cost";
import { isCanvasLocalImageOperation } from "@/lib/canvas/canvas-local-image-operation";
import { validateCanvasWorkflowNodeReadiness, type CanvasWorkflowNodeReadinessIssue, type CanvasWorkflowPlan } from "@/lib/canvas/canvas-workflow";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type WorkflowPreflightFailureReason = "node_missing" | "unsupported_media" | "empty_input" | "readiness" | "model_unavailable" | "pricing_unavailable";

export type CanvasWorkflowPreflightFailure = {
    ok: false;
    reason: WorkflowPreflightFailureReason;
    nodeId: string;
    nodeTitle?: string;
    mode?: string;
    readinessIssue?: CanvasWorkflowNodeReadinessIssue;
};

export type CanvasWorkflowPreflightItem = {
    nodeId: string;
    title: string;
    mode: CanvasNodeGenerationMode;
    model: string;
    count: number;
    localOperation: boolean;
    inputSummary: ReturnType<typeof getInputSummary>;
    estimate?: CanvasCostEstimate;
};

export type CanvasWorkflowPreflightSuccess = {
    ok: true;
    nodeIds: string[];
    completedNodeIds: string[];
    items: CanvasWorkflowPreflightItem[];
    totals: {
        generation: number;
        removal: number;
        total: number;
        compareTotal?: number;
        paidNodeCount: number;
        freeNodeCount: number;
    };
};

export function preflightCanvasWorkflow(options: {
    plan: CanvasWorkflowPlan;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    effectiveConfig: AiConfig;
    completedNodeIds?: Iterable<string>;
    isConfigReady: (config: AiConfig, model: string) => boolean;
}): CanvasWorkflowPreflightSuccess | CanvasWorkflowPreflightFailure {
    const completedNodeIds = new Set(options.completedNodeIds || []);
    const nodeIds = options.plan.nodeIds.filter((nodeId) => !completedNodeIds.has(nodeId));
    const items: CanvasWorkflowPreflightItem[] = [];

    for (const nodeId of nodeIds) {
        const node = options.nodes.find((item) => item.id === nodeId);
        if (!node) return { ok: false, reason: "node_missing", nodeId };
        const mode = (node.metadata?.generationMode || "image") as CanvasNodeGenerationMode;
        if (!isCanvasGenerationModeEnabled(mode)) return { ok: false, reason: "unsupported_media", nodeId, nodeTitle: node.title, mode };
        const inputSummary = getInputSummary(buildNodeGenerationInputs(nodeId, options.nodes, options.connections));
        const hasCurrentInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
        const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
        const hasPlannedInput = Boolean(options.plan.dependencies.get(nodeId)?.size);
        if (!hasComposerContent && !hasCurrentInput && !hasPlannedInput) return { ok: false, reason: "empty_input", nodeId, nodeTitle: node.title, mode };
        const readiness = validateCanvasWorkflowNodeReadiness({
            nodeId,
            nodes: options.nodes,
            connections: options.connections,
            dependencies: options.plan.dependencies.get(nodeId) || new Set(),
            completedNodeIds,
            allowPendingDependencies: true,
        });
        if (!readiness.ok) return { ok: false, reason: "readiness", nodeId, nodeTitle: node.title, mode, readinessIssue: readiness.issue };
        const config = buildGenerationConfig(options.effectiveConfig, node, mode);
        const count = getGenerationCount(config.count);
        const localOperation = isCanvasLocalImageOperation(node.metadata?.localImageOperation);
        if (localOperation) {
            items.push({ nodeId, title: node.title, mode, model: config.model, count, localOperation, inputSummary });
            continue;
        }
        if (!options.isConfigReady(config, config.model)) return { ok: false, reason: "model_unavailable", nodeId, nodeTitle: node.title, mode };
        const estimate = estimateCanvasGenerationCost({ config, kind: mode === "text" ? "text" : "image", count });
        if (estimate.pricingUnavailable) return { ok: false, reason: "pricing_unavailable", nodeId, nodeTitle: node.title, mode };
        items.push({ nodeId, title: node.title, mode, model: config.model, count, localOperation, inputSummary, estimate });
    }

    const estimates = items.flatMap((item) => (item.estimate ? [item.estimate] : []));
    const generation = estimates.reduce((sum, estimate) => sum + estimate.generationUnit * estimate.count, 0);
    const removal = estimates.reduce((sum, estimate) => sum + estimate.removalUnit * estimate.count, 0);
    const compareTotal = estimates.reduce((sum, estimate) => sum + (estimate.compareTotal ?? estimate.total), 0);
    const total = generation + removal;
    return {
        ok: true,
        nodeIds,
        completedNodeIds: [...completedNodeIds],
        items,
        totals: {
            generation,
            removal,
            total,
            ...(compareTotal > total ? { compareTotal } : {}),
            paidNodeCount: estimates.length,
            freeNodeCount: items.length - estimates.length,
        },
    };
}
