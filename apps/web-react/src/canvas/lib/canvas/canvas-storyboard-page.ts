import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { StoryboardParseMode, StoryboardScene, StoryboardShotType, StoryboardStyle } from "@/lib/canvas/storyboard-parser";
import { storyboardAggregateStatus } from "@/lib/canvas/canvas-storyboard-recovery";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeExecutionStatus } from "@/types/canvas";

export const NODE_STATUS_IDLE = "idle" as const;
export const NODE_STATUS_LOADING = "loading" as const;
export const NODE_STATUS_SUCCESS = "success" as const;
export const NODE_STATUS_ERROR = "error" as const;
export const STORYBOARD_ANALYSIS_NODE_ID = "__storyboard-analysis__";

export type StoryboardGenerationOptions = {
    style: StoryboardStyle;
    /** Desired number of shots; parsers may return fewer when the script has fewer beats. */
    sceneCount: number;
    aspectRatio: string;
    consistency: boolean;
    /** User-selected rule split mode; authoritative for shot boundaries. */
    parseMode?: StoryboardParseMode;
    /** When false, only rule parsing runs; AI polish is skipped. */
    aiPolish?: boolean;
    shotTypeOverrides?: Record<string, string>;
};

export type StoryboardProgressEvent = {
    sceneId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    imageUrl?: string;
    error?: string;
    /** The persisted image is still useful, but no longer matches edited shot copy. */
    needsRegeneration?: boolean;
};

const STORYBOARD_STYLES: StoryboardStyle[] = ["cinematic", "anime", "documentary", "commercial"];

export function asStoryboardStyle(value: unknown): StoryboardStyle {
    const style = String(value || "cinematic").trim();
    return STORYBOARD_STYLES.includes(style as StoryboardStyle) ? (style as StoryboardStyle) : "cinematic";
}

export function storyboardSceneFromNode(node: CanvasNodeData): StoryboardScene | null {
    const metadata = node.metadata;
    const sceneId = metadata?.storyboardSceneId;
    if (!sceneId) return null;
    const shotTypes: StoryboardShotType[] = ["wide", "full", "medium", "close", "detail", "over"];
    const shotType = shotTypes.includes(metadata.storyboardShotType as StoryboardShotType) ? (metadata.storyboardShotType as StoryboardShotType) : "medium";
    const prompt = (metadata.storyboardPrompt || metadata.prompt || "").trim();
    return {
        id: sceneId,
        index: Math.max(1, Number(metadata.storyboardIndex) || 1),
        title: typeof metadata.storyboardTitle === "string" ? metadata.storyboardTitle : node.title || `镜头 ${metadata.storyboardIndex || 1}`,
        sourceText: prompt,
        summary: prompt || node.title || "",
        shotType,
        cameraAngle: "平视",
        lens: "50mm 标准镜头",
        movement: "稳定镜头，叙事性停留",
        location: "未说明场景",
        time: "未说明时间",
        characters: [],
        dialogue: "",
        continuity: metadata.storyboardContinuity || "",
        durationSec: 4,
        prompt,
        confidence: "high",
    };
}

export function storyboardPromptForConsistency(prompt: string, consistency: boolean) {
    if (consistency) return prompt;
    return String(prompt || "")
        .replace(/(?:连续性锁定|continuity\s+lock)\s*[:：][^。！？!?\n]*(?:[。！？!?]|$)/gi, "")
        .replace(/角色保持前后镜头一致[。！？!?]?/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export function updateStoryboardTaskStatus(nodes: CanvasNodeData[], targetNodeId: string, status: "succeeded" | "failed" | "canceled", errorDetails?: string) {
    const target = nodes.find((node) => node.id === targetNodeId);
    const storyboardId = target?.metadata?.storyboardId;
    const sceneId = target?.metadata?.storyboardSceneId;
    if (!storyboardId || !sceneId) return nodes;
    const executionStatus: CanvasNodeExecutionStatus = status;
    const generationStage = status === "succeeded" ? "completed" : status;
    const updated = nodes.map((node) => {
        const isImage = node.id === targetNodeId;
        const isCaption = node.type === CanvasNodeType.Text && node.metadata?.storyboardId === storyboardId && node.metadata?.storyboardSceneId === sceneId;
        if (!isImage && !isCaption) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                storyboardStatus: status,
                executionStatus,
                generationStage,
                errorDetails: status === "succeeded" ? undefined : errorDetails,
            },
        };
    });
    const aggregate = storyboardAggregateStatus(updated, storyboardId);
    if (!aggregate) return updated;
    const groupExecutionStatus: CanvasNodeExecutionStatus = aggregate === "succeeded" ? "succeeded" : aggregate === "failed" ? "failed" : aggregate === "canceled" ? "canceled" : "running";
    return updated.map((node) =>
        (node.type === CanvasNodeType.Group || node.metadata?.storyboardConfig) && node.metadata?.storyboardId === storyboardId
            ? { ...node, metadata: { ...node.metadata, storyboardStatus: aggregate, executionStatus: groupExecutionStatus } }
            : node,
    );
}

export function isActiveStoryboardNode(node: CanvasNodeData) {
    const storyboardStatus = node.metadata?.storyboardStatus;
    const executionStatus = node.metadata?.executionStatus;
    return storyboardStatus === "queued" || storyboardStatus === "running" || executionStatus === "queued" || executionStatus === "running";
}

/** Settle recovered storyboard nodes after upstream cancel with no local controller. */
export function settleStoryboardCancellation(nodes: CanvasNodeData[], nodeIds: Set<string>, errorDetails: string) {
    if (!nodeIds.size) return nodes;
    const targetNodes = nodes.filter((node) => nodeIds.has(node.id));
    const storyboardIds = new Set(targetNodes.map((node) => node.metadata?.storyboardId).filter((id): id is string => Boolean(id)));
    if (!storyboardIds.size) return nodes;
    const targetSceneKeys = new Set(
        targetNodes
            .filter((node) => Boolean(node.metadata?.storyboardSceneId))
            .map((node) => `${node.metadata?.storyboardId}\u0000${node.metadata?.storyboardSceneId}`),
    );
    const targetGroupIds = new Set(
        targetNodes
            .filter((node) => node.type === CanvasNodeType.Group || node.metadata?.storyboardConfig)
            .map((node) => node.id),
    );
    nodes.forEach((node) => {
        if (node.type !== CanvasNodeType.Image || !isActiveStoryboardNode(node) || !node.metadata?.storyboardId || !storyboardIds.has(node.metadata.storyboardId)) return;
        if (targetGroupIds.size) targetSceneKeys.add(`${node.metadata.storyboardId}\u0000${node.metadata.storyboardSceneId || ""}`);
    });
    const completedAt = new Date().toISOString();
    const updated = nodes.map((node) => {
        const storyboardId = node.metadata?.storyboardId;
        if (!storyboardId || !storyboardIds.has(storyboardId)) return node;
        const sceneKey = node.metadata?.storyboardSceneId ? `${storyboardId}\u0000${node.metadata.storyboardSceneId}` : "";
        const isHost =
            (node.type === CanvasNodeType.Group || node.metadata?.storyboardConfig) &&
            (nodeIds.has(node.id) || targetGroupIds.has(node.id));
        const isTargetScene = Boolean(sceneKey && targetSceneKeys.has(sceneKey));
        if (!isHost && !(isTargetScene && isActiveStoryboardNode(node))) return node;
        const metadata = {
            ...node.metadata,
            storyboardStatus: "canceled" as const,
            executionStatus: "canceled" as const,
            generationStage: "canceled",
            errorDetails,
            generationCompletedAt: completedAt,
            ...(node.type === CanvasNodeType.Image
                ? { status: NODE_STATUS_IDLE, taskId: undefined, taskKind: undefined }
                : node.type === CanvasNodeType.Text
                  ? { status: NODE_STATUS_SUCCESS }
                  : {}),
        };
        return { ...node, metadata };
    });
    return updated.map((node) => {
        const storyboardId = node.metadata?.storyboardId;
        if (!(node.type === CanvasNodeType.Group || node.metadata?.storyboardConfig) || !storyboardId || !storyboardIds.has(storyboardId)) return node;
        const aggregate = storyboardAggregateStatus(updated, storyboardId);
        if (!aggregate) return node;
        const executionStatus: CanvasNodeExecutionStatus = aggregate === "succeeded" ? "succeeded" : aggregate === "failed" ? "failed" : aggregate === "canceled" ? "canceled" : "running";
        return { ...node, metadata: { ...node.metadata, storyboardStatus: aggregate, executionStatus } };
    });
}

export function normalizeCanvasImageAngleParams(value: unknown): CanvasImageAngleParams {
    const params = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const horizontalAngle = Number(params.horizontalAngle);
    const pitchAngle = Number(params.pitchAngle);
    const cameraDistance = Number(params.cameraDistance);
    return {
        horizontalAngle: Number.isFinite(horizontalAngle) ? Math.max(-180, Math.min(180, horizontalAngle)) : 45,
        pitchAngle: Number.isFinite(pitchAngle) ? Math.max(-90, Math.min(90, pitchAngle)) : 0,
        cameraDistance: Number.isFinite(cameraDistance) ? Math.max(1, Math.min(10, cameraDistance)) : 4.8,
        wideAngle: Boolean(params.wideAngle),
    };
}
