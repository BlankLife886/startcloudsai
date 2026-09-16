import type { CanvasNodeData } from "../../types/canvas.ts";

export type StoryboardPipelineStep = "detect" | "analyze" | "generate";

export function isStoryboardPipelineStep(value: unknown): value is StoryboardPipelineStep {
    return value === "detect" || value === "analyze" || value === "generate";
}

export function isStoryboardPipelineNode(node: CanvasNodeData | null | undefined) {
    return Boolean(node?.type === "config" && isStoryboardPipelineStep(node.metadata?.storyboardPipelineStep));
}

/** Pipeline step configs may connect to each other (unlike normal config↔config). */
export function canConnectStoryboardPipelineNodes(first: CanvasNodeData | undefined, second: CanvasNodeData | undefined) {
    return isStoryboardPipelineNode(first) && isStoryboardPipelineNode(second);
}
