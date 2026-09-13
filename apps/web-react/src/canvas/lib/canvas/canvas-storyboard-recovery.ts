import type { CanvasNodeData, CanvasNodeExecutionStatus } from "../../types/canvas.ts";
import { normalizeStoryboardPlan, parseStoryboardScript, type StoryboardPlan, type StoryboardScene, type StoryboardStyle } from "./storyboard-parser.ts";

export type StoryboardResumeOptions = {
    style: StoryboardStyle;
    sceneCount: number;
    aspectRatio: string;
    consistency: boolean;
};

export type StoryboardResume = {
    storyboardId: string;
    groupNodeId: string;
    sourceNodeId?: string;
    sourceNodeIds: string[];
    /** Durable first-frame reference, when the batch has produced one. */
    anchorReference?: string;
    anchorSceneId?: string;
    script: string;
    plan: StoryboardPlan;
    progress: Record<string, {
        sceneId: string;
        status: "queued" | "running" | "succeeded" | "failed" | "canceled";
        imageUrl?: string;
        error?: string;
        needsRegeneration?: boolean;
    }>;
    options: StoryboardResumeOptions;
};

const STORYBOARD_STYLES: StoryboardStyle[] = ["cinematic", "anime", "documentary", "commercial"];
const STORYBOARD_RATIOS = new Set(["16:9", "9:16", "1:1"]);

function isStoryboardStyle(value: unknown): value is StoryboardStyle {
    return typeof value === "string" && STORYBOARD_STYLES.includes(value as StoryboardStyle);
}

function readTextNode(node: CanvasNodeData | undefined) {
    if (!node || node.type !== "text") return "";
    return String(node.metadata?.content || node.metadata?.prompt || "").trim();
}

function safeJson(value: unknown): unknown {
    if (typeof value !== "string" || !value.trim()) return value;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function readStoredSession(group: CanvasNodeData) {
    const raw = safeJson(group.metadata?.storyboardPlanJson);
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const plan = record.plan && typeof record.plan === "object" ? record.plan : raw;
    const options = record.options && typeof record.options === "object" ? record.options as Record<string, unknown> : {};
    const script = typeof record.script === "string" ? record.script : String(group.metadata?.storyboardScript || "");
    return { plan, options, script };
}

function sceneCountFrom(group: CanvasNodeData, stored: ReturnType<typeof readStoredSession>, memberCount: number) {
    const storedCount = Number(stored?.options.sceneCount || group.metadata?.storyboardSceneCount || 0);
    return Math.min(16, Math.max(1, Math.floor(storedCount || memberCount || 6)));
}

function optionsFrom(group: CanvasNodeData, stored: ReturnType<typeof readStoredSession>, sceneCount: number): StoryboardResumeOptions {
    const storedOptions = stored?.options || {};
    const style = isStoryboardStyle(storedOptions.style) ? storedOptions.style : isStoryboardStyle(group.metadata?.storyboardStyle) ? group.metadata.storyboardStyle : "cinematic";
    const aspectRatioValue = String(storedOptions.aspectRatio || group.metadata?.storyboardAspectRatio || "16:9");
    const aspectRatio = STORYBOARD_RATIOS.has(aspectRatioValue) ? aspectRatioValue : "16:9";
    return {
        style,
        sceneCount,
        aspectRatio,
        consistency: typeof storedOptions.consistency === "boolean" ? storedOptions.consistency : group.metadata?.storyboardConsistency !== false,
    };
}

function scriptFromMembers(group: CanvasNodeData, members: CanvasNodeData[], nodesById: Map<string, CanvasNodeData>) {
    const stored = String(group.metadata?.storyboardScript || "").trim();
    if (stored) return stored.slice(0, 9000);
    const sourceIds = [group.metadata?.storyboardSourceNodeId, ...(group.metadata?.storyboardSourceNodeIds || [])].filter((id): id is string => Boolean(id));
    const sourceScript = sourceIds.map((id) => readTextNode(nodesById.get(id))).filter(Boolean).join("\n\n");
    if (sourceScript) return sourceScript.slice(0, 9000);
    const captions = members
        .filter((node) => node.type === "text" && node.metadata?.storyboardSceneId)
        .sort((left, right) => (left.metadata?.storyboardIndex || 0) - (right.metadata?.storyboardIndex || 0))
        .map((node) => String(node.metadata?.content || "").split(/\n+/).slice(1).join(" ").trim())
        .filter(Boolean);
    return captions.join("\n").slice(0, 9000);
}

function sceneFromNode(node: CanvasNodeData, fallback: StoryboardScene): StoryboardScene {
    const metadata = node.metadata || {};
    const prompt = String(metadata.storyboardPrompt || metadata.prompt || fallback.prompt || "").trim();
    return {
        ...fallback,
        id: metadata.storyboardSceneId || fallback.id,
        index: Math.max(1, Number(metadata.storyboardIndex) || fallback.index),
        title: (typeof metadata.storyboardTitle === "string" ? metadata.storyboardTitle : fallback.title).slice(0, 80),
        // An explicit empty summary is a valid user edit; do not resurrect
        // the previous generated beat just because the value is falsy.
        summary: (typeof metadata.storyboardSummary === "string" ? metadata.storyboardSummary : fallback.summary).slice(0, 240),
        prompt: prompt || fallback.prompt,
        continuity: String(metadata.storyboardContinuity || fallback.continuity),
    };
}

function progressFromMembers(plan: StoryboardPlan, members: CanvasNodeData[]) {
    const progress: StoryboardResume["progress"] = {};
    plan.scenes.forEach((scene) => {
        const node = members.find((item) => item.type === "image" && item.metadata?.storyboardSceneId === scene.id);
        if (!node) return;
        const metadata = node.metadata || {};
        const status = metadata.storyboardStatus || (metadata.status === "success" ? "succeeded" : metadata.status === "error" ? "failed" : metadata.status === "loading" ? "running" : "queued");
        const imageUrl = metadata.thumbnailUrl || metadata.content;
        progress[scene.id] = {
            sceneId: scene.id,
            status,
            ...(imageUrl ? { imageUrl } : {}),
            ...(metadata.errorDetails ? { error: metadata.errorDetails } : {}),
            ...(metadata.storyboardNeedsRegeneration ? { needsRegeneration: true } : {}),
        };
    });
    return progress;
}

/** Return the group node for a storyboard node or group id. */
export function findStoryboardGroup(node: CanvasNodeData | undefined, nodes: CanvasNodeData[]) {
    const storyboardId = node?.metadata?.storyboardId;
    if (!storyboardId) return undefined;
    return nodes.find((item) => item.type === "group" && item.metadata?.storyboardId === storyboardId);
}

/** Build a durable storyboard session from the group and its child nodes. */
export function recoverStoryboardFromNodes(target: CanvasNodeData | undefined, nodes: CanvasNodeData[]): StoryboardResume | null {
    const storyboardId = target?.metadata?.storyboardId;
    const group = findStoryboardGroup(target, nodes) || (target?.type === "group" ? target : undefined);
    if (!storyboardId || !group) return null;
    const members = nodes.filter((node) => node.metadata?.storyboardId === storyboardId);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const stored = readStoredSession(group);
    const script = scriptFromMembers(group, members, nodesById);
    const imageMembers = members.filter((node) => node.type === "image" && node.metadata?.storyboardSceneId);
    const sceneCount = sceneCountFrom(group, stored, imageMembers.length);
    const options = optionsFrom(group, stored, sceneCount);
    const fallback = parseStoryboardScript(script, { count: sceneCount, style: options.style });
    const storedPlan = stored?.plan;
    const normalizedPlan = storedPlan
        ? normalizeStoryboardPlan(JSON.stringify(storedPlan), fallback, { count: sceneCount, style: options.style })
        : {
              title: String(group.metadata?.storyboardTitle || "智能分镜"),
              globalStyle: String(group.metadata?.storyboardGlobalStyle || ""),
              scenes: fallback,
              source: group.metadata?.storyboardPlanSource === "ai" ? ("ai" as const) : ("rules" as const),
          };
    const scenes = normalizedPlan.scenes.map((scene) => {
        const node = imageMembers.find((item) => item.metadata?.storyboardSceneId === scene.id);
        return node ? sceneFromNode(node, scene) : scene;
    });
    const plan: StoryboardPlan = { ...normalizedPlan, scenes };
    const sourceNodeId = group.metadata?.storyboardSourceNodeId || members.find((node) => node.metadata?.storyboardSourceNodeId)?.metadata?.storyboardSourceNodeId;
    const sourceNodeIds = group.metadata?.storyboardSourceNodeIds || (sourceNodeId ? [sourceNodeId] : []);
    const anchorNode = imageMembers.find((node) => Boolean(node.metadata?.storyboardAnchorReference));
    const anchorReference = group.metadata?.storyboardAnchorReference || anchorNode?.metadata?.storyboardAnchorReference;
    const anchorSceneId = group.metadata?.storyboardAnchorSceneId || anchorNode?.metadata?.storyboardAnchorSceneId || anchorNode?.metadata?.storyboardSceneId;
    return {
        storyboardId,
        groupNodeId: group.id,
        sourceNodeId,
        sourceNodeIds,
        ...(anchorReference ? { anchorReference } : {}),
        ...(anchorSceneId ? { anchorSceneId } : {}),
        script,
        plan,
        progress: progressFromMembers(plan, members),
        options,
    };
}

/** Serialize the review plan in a group metadata field for refresh/reopen recovery. */
export function storyboardSessionJson(input: { storyboardId: string; script: string; plan: StoryboardPlan; options: StoryboardResumeOptions }) {
    return JSON.stringify({ version: 1, storyboardId: input.storyboardId, script: input.script.slice(0, 9000), plan: input.plan, options: input.options });
}

/** Aggregate child scene states into the group status persisted on the canvas. */
export function storyboardAggregateStatus(nodes: CanvasNodeData[], storyboardId: string): "queued" | "running" | "succeeded" | "failed" | "canceled" | undefined {
    const scenes = nodes.filter((node) => node.type === "image" && node.metadata?.storyboardId === storyboardId && node.metadata?.storyboardSceneId);
    if (!scenes.length) return undefined;
    const statuses = scenes.map((node) => node.metadata?.storyboardStatus || (node.metadata?.status === "success" ? "succeeded" : node.metadata?.status === "error" ? "failed" : "queued"));
    if (statuses.some((status) => status === "queued" || status === "running")) return "running";
    if (statuses.every((status) => status === "succeeded")) return "succeeded";
    if (statuses.every((status) => status === "canceled")) return "canceled";
    return "failed";
}

/**
 * Reconcile persisted storyboard group state from its image children.
 *
 * A page can be refreshed between a shot finishing and the group write. The
 * group has no task id of its own, so the generic interrupted-generation
 * repair may otherwise mark it canceled even though its children are still
 * resumable (or already complete). Child state is the authoritative source.
 */
export function reconcileStoryboardGroupStatuses(nodes: CanvasNodeData[]) {
    const storyboardIds = new Set(
        nodes
            .filter((node) => node.type === "group" && Boolean(node.metadata?.storyboardId))
            .map((node) => node.metadata?.storyboardId)
            .filter((id): id is string => Boolean(id)),
    );
    if (!storyboardIds.size) return nodes;
    return nodes.map((node) => {
        const storyboardId = node.type === "group" ? node.metadata?.storyboardId : undefined;
        if (!storyboardId || !storyboardIds.has(storyboardId)) return node;
        const aggregate = storyboardAggregateStatus(nodes, storyboardId);
        if (!aggregate) return node;
        const executionStatus: CanvasNodeExecutionStatus = aggregate === "succeeded" ? "succeeded" : aggregate === "failed" ? "failed" : aggregate === "canceled" ? "canceled" : "running";
        if (node.metadata?.storyboardStatus === aggregate && node.metadata?.executionStatus === executionStatus) return node;
        return { ...node, metadata: { ...node.metadata, storyboardStatus: aggregate, executionStatus } };
    });
}
