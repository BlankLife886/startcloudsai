import { nanoid } from "nanoid";

import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { asStoryboardStyle, NODE_STATUS_IDLE, NODE_STATUS_SUCCESS } from "@/lib/canvas/canvas-storyboard-page";
import { detectStoryboardShotCount, parseStoryboardScript, type StoryboardPlan, type StoryboardStyle } from "@/lib/canvas/storyboard-parser";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { canConnectStoryboardPipelineNodes, isStoryboardPipelineNode, isStoryboardPipelineStep, type StoryboardPipelineStep } from "./canvas-storyboard-pipeline-guards.ts";

export { canConnectStoryboardPipelineNodes, isStoryboardPipelineNode, isStoryboardPipelineStep } from "./canvas-storyboard-pipeline-guards.ts";
export type { StoryboardPipelineStep } from "./canvas-storyboard-pipeline-guards.ts";

export type StoryboardPipelineContext = {
    pipelineId: string;
    input: CanvasNodeData | null;
    detect: CanvasNodeData | null;
    analyze: CanvasNodeData | null;
    generate: CanvasNodeData | null;
    script: string;
    style: StoryboardStyle;
    sceneCount: number;
    aspectRatio: string;
    consistency: boolean;
    plan: StoryboardPlan | null;
};

const STEP_SIZE: Record<StoryboardPipelineStep, { width: number; height: number }> = {
    detect: { width: 300, height: 340 },
    analyze: { width: 300, height: 340 },
    generate: { width: 320, height: 380 },
};

export function parseStoryboardPlanJson(value: unknown): StoryboardPlan | null {
    if (!value || typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value) as { plan?: StoryboardPlan } | StoryboardPlan;
        const plan = "plan" in parsed && parsed.plan ? parsed.plan : (parsed as StoryboardPlan);
        if (!plan || !Array.isArray(plan.scenes)) return null;
        return plan;
    } catch {
        return null;
    }
}

function readScript(node: CanvasNodeData | null | undefined) {
    return String(node?.metadata?.storyboardScript ?? node?.metadata?.composerContent ?? node?.metadata?.content ?? node?.metadata?.prompt ?? "")
        .trim();
}

export function resolveStoryboardPipelineContext(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    nodeId: string,
): StoryboardPipelineContext | null {
    const seed = nodes.find((node) => node.id === nodeId);
    if (!seed) return null;
    const pipelineId = seed.metadata?.storyboardPipelineId;
    if (!pipelineId && !seed.metadata?.storyboardConfig) return null;

    const members = pipelineId
        ? nodes.filter((node) => node.metadata?.storyboardPipelineId === pipelineId)
        : [seed];
    const detect = members.find((node) => node.metadata?.storyboardPipelineStep === "detect") || null;
    const analyze = members.find((node) => node.metadata?.storyboardPipelineStep === "analyze") || null;
    const generate = members.find((node) => node.metadata?.storyboardPipelineStep === "generate") || (seed.metadata?.storyboardConfig ? seed : null);

    const detectTargetId = detect?.id || seed.id;
    const inputEdge = connections.find((connection) => connection.toNodeId === detectTargetId);
    const input =
        (inputEdge ? nodes.find((node) => node.id === inputEdge.fromNodeId && node.type === CanvasNodeType.Text) : null)
        || (seed.metadata?.storyboardSourceNodeId ? nodes.find((node) => node.id === seed.metadata?.storyboardSourceNodeId) || null : null)
        || null;

    const optionsNode = generate || analyze || detect || seed;
    const script = readScript(input) || readScript(detect) || readScript(analyze) || readScript(generate) || readScript(seed);
    const sceneCount = Math.max(
        1,
        Math.min(
            16,
            Number(detect?.metadata?.storyboardShotCount || detect?.metadata?.storyboardSceneCount || optionsNode.metadata?.storyboardShotCount || optionsNode.metadata?.storyboardSceneCount) || 6,
        ),
    );
    const plan =
        parseStoryboardPlanJson(analyze?.metadata?.storyboardPlanJson)
        || parseStoryboardPlanJson(generate?.metadata?.storyboardPlanJson)
        || null;

    return {
        pipelineId: pipelineId || seed.id,
        input,
        detect,
        analyze,
        generate,
        script,
        style: asStoryboardStyle(optionsNode.metadata?.storyboardStyle || detect?.metadata?.storyboardStyle),
        sceneCount,
        aspectRatio: String(optionsNode.metadata?.storyboardAspectRatio || "16:9"),
        consistency: optionsNode.metadata?.storyboardConsistency === true,
        plan,
    };
}

export function buildLocalStoryboardDetectPlan(script: string, style: StoryboardStyle, preferredCount?: number): StoryboardPlan {
    const detected = detectStoryboardShotCount(script, style) || preferredCount || 6;
    const count = Math.max(1, Math.min(100, Number(preferredCount) || detected));
    const scenes = parseStoryboardScript(script, { count, style });
    return {
        title: scenes[0]?.title ? `分镜 · ${scenes[0].title}` : "批量配置",
        globalStyle: style,
        scenes,
        source: "rules",
    };
}

export function createStoryboardPipelineNodes(input: {
    center: { x: number; y: number };
    source?: CanvasNodeData | null;
    script?: string;
    titles: { detect: string; analyze: string; generate: string };
}): { nodes: CanvasNodeData[]; connections: CanvasConnection[]; pipelineId: string; selectId: string } {
    const pipelineId = `storyboard-pipeline-${nanoid(10)}`;
    const script = String(input.script || input.source?.metadata?.content || input.source?.metadata?.prompt || "").trim();
    const source = input.source;
    const originX = source ? source.position.x + source.width + 96 : input.center.x - 420;
    const originY = source ? source.position.y + source.height / 2 - STEP_SIZE.detect.height / 2 : input.center.y - STEP_SIZE.detect.height / 2;

    const shared: Partial<CanvasNodeMetadata> = {
        storyboardPipelineId: pipelineId,
        storyboardConfig: true,
        batchMode: "split",
        batchVariantCount: 4,
        storyboardAiPolish: false,
        storyboardScript: script,
        storyboardStyle: "cinematic",
        storyboardAspectRatio: "16:9",
        storyboardShotCount: 6,
        storyboardSceneCount: 6,
        storyboardConsistency: false,
        storyboardSourceNodeId: source?.id,
        storyboardInputNodeIds: source ? [source.id] : [],
        storyboardPrimaryTextNodeId: source?.type === CanvasNodeType.Text ? source.id : undefined,
        generationMode: "image",
        status: script ? NODE_STATUS_SUCCESS : NODE_STATUS_IDLE,
        executionStatus: undefined,
    };

    const detect = createCanvasNode(CanvasNodeType.Config, { x: originX + STEP_SIZE.detect.width / 2, y: originY + STEP_SIZE.detect.height / 2 }, {
        ...shared,
        storyboardPipelineStep: "detect",
        generationStage: undefined,
    });
    detect.width = STEP_SIZE.detect.width;
    detect.height = STEP_SIZE.detect.height;
    detect.title = input.titles.detect;
    detect.position = { x: originX, y: originY };

    const analyzeX = originX + STEP_SIZE.detect.width + 88;
    const analyze = createCanvasNode(CanvasNodeType.Config, { x: analyzeX + STEP_SIZE.analyze.width / 2, y: originY + STEP_SIZE.analyze.height / 2 }, {
        ...shared,
        storyboardPipelineStep: "analyze",
        status: NODE_STATUS_IDLE,
    });
    analyze.width = STEP_SIZE.analyze.width;
    analyze.height = STEP_SIZE.analyze.height;
    analyze.title = input.titles.analyze;
    analyze.position = { x: analyzeX, y: originY };

    const generateX = analyzeX + STEP_SIZE.analyze.width + 88;
    const generate = createCanvasNode(CanvasNodeType.Config, { x: generateX + STEP_SIZE.generate.width / 2, y: originY + STEP_SIZE.generate.height / 2 }, {
        ...shared,
        storyboardPipelineStep: "generate",
        status: NODE_STATUS_IDLE,
    });
    generate.width = STEP_SIZE.generate.width;
    generate.height = STEP_SIZE.generate.height;
    generate.title = input.titles.generate;
    generate.position = { x: generateX, y: originY };

    const nodes = [detect, analyze, generate];
    const connections: CanvasConnection[] = [
        ...(source ? [{ id: nanoid(), fromNodeId: source.id, toNodeId: detect.id }] : []),
        { id: nanoid(), fromNodeId: detect.id, toNodeId: analyze.id },
        { id: nanoid(), fromNodeId: analyze.id, toNodeId: generate.id },
    ];

    return { nodes, connections, pipelineId, selectId: detect.id };
}

export function patchStoryboardPipelineMembers(
    nodes: CanvasNodeData[],
    pipelineId: string,
    patch: Partial<CanvasNodeMetadata>,
    onlySteps?: StoryboardPipelineStep[],
) {
    return nodes.map((node) => {
        if (node.metadata?.storyboardPipelineId !== pipelineId) return node;
        const step = node.metadata?.storyboardPipelineStep;
        if (onlySteps && (!isStoryboardPipelineStep(step) || !onlySteps.includes(step))) return node;
        return { ...node, metadata: { ...node.metadata, ...patch } };
    });
}
