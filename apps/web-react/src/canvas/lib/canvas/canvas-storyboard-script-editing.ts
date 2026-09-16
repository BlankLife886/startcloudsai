import { parseStoryboardScript, type StoryboardParseMode, type StoryboardStyle } from "./storyboard-parser.ts";
import type { CanvasConnection, CanvasNodeData, StoryboardInputRole } from "../../types/canvas.ts";

const STORYBOARD_TEXT_ROLE_LABELS: Record<StoryboardInputRole, string> = {
    script: "主剧本",
    context: "补充文本",
    input: "输入图",
    character: "角色设定",
    style: "风格约束",
    scene: "场景设定",
    object: "道具/产品约束",
    reference: "补充参考",
};

export const STORYBOARD_IMAGE_REFERENCE_ROLES: StoryboardInputRole[] = ["reference", "character", "style", "scene", "object"];

export function isStoryboardImageReferenceRole(role?: string | null): boolean {
    return STORYBOARD_IMAGE_REFERENCE_ROLES.includes(role as StoryboardInputRole);
}

export function isStoryboardImageInputRole(role?: string | null): boolean {
    return !role || role === "input" || !isStoryboardImageReferenceRole(role);
}

export function combineStoryboardTextInputs(inputs: Array<{ nodeId?: string; text?: string }>, roles?: Record<string, StoryboardInputRole>) {
    return inputs
        .map((input) => {
            const text = String(input.text || "").trim();
            const role = input.nodeId ? roles?.[input.nodeId] : undefined;
            return text && role && role !== "script" ? `【${STORYBOARD_TEXT_ROLE_LABELS[role] || role}】\n${text}` : text;
        })
        .filter(Boolean)
        .join("\n\n");
}

export type StoryboardInputLike = { nodeId: string; type: string; title?: string; text?: string; image?: unknown };

export function resolveStoryboardInputSelection(
    inputs: StoryboardInputLike[],
    metadata?: {
        storyboardInputNodeIds?: string[];
        storyboardPrimaryTextNodeId?: string;
        storyboardInputRoles?: Record<string, StoryboardInputRole>;
        storyboardInputShotIds?: Record<string, string[]>;
        batchMode?: string;
    },
) {
    const unique = new Map<string, StoryboardInputLike>();
    inputs.filter((input) => input.type === "text" || input.type === "image").forEach((input) => {
        if (!unique.has(input.nodeId)) unique.set(input.nodeId, input);
    });
    const candidates = [...unique.values()];
    const textInputs = candidates.filter((input) => input.type === "text");
    const imageInputs = candidates.filter((input) => input.type === "image");
    const explicitIds = Array.isArray(metadata?.storyboardInputNodeIds);
    const selectedNodeIds = new Set(
        explicitIds
            ? metadata?.storyboardInputNodeIds?.filter((id) => unique.has(id)) || []
            : candidates.map((input) => input.nodeId),
    );
    // Connected reference images are always accepted for batch config; there is
    // no per-image opt-out in the compact panel, and sticky text selection
    // must not silently drop newly wired image nodes.
    imageInputs.forEach((input) => selectedNodeIds.add(input.nodeId));
    const primaryTextNodeId = textInputs.some((input) => input.nodeId === metadata?.storyboardPrimaryTextNodeId)
        ? metadata?.storyboardPrimaryTextNodeId
        : textInputs[0]?.nodeId;
    if (primaryTextNodeId) selectedNodeIds.add(primaryTextNodeId);
    const refsMode = metadata?.batchMode === "refs";
    const roles: Record<string, StoryboardInputRole> = {};
    candidates.forEach((input) => {
        const saved = metadata?.storyboardInputRoles?.[input.nodeId];
        if (input.type === "text") {
            roles[input.nodeId] = saved || (input.nodeId === primaryTextNodeId ? "script" : "context");
            return;
        }
        if (refsMode) {
            // Only an explicit reference-style role counts as 参考图; everything else is 输入图.
            roles[input.nodeId] = isStoryboardImageReferenceRole(saved) ? "reference" : "input";
            return;
        }
        roles[input.nodeId] = saved || "reference";
    });
    return { candidates, selectedNodeIds, primaryTextNodeId, roles, shotIds: metadata?.storyboardInputShotIds || {}, hasExplicitSelection: explicitIds };
}

/** Split selected image inputs into drivers (输入图) and designated references (参考图). */
export function classifyStoryboardBatchImages<T extends StoryboardInputLike>(
    imageInputs: T[],
    roles: Record<string, StoryboardInputRole>,
    batchMode?: string,
): { inputImages: T[]; referenceImages: T[] } {
    if (batchMode !== "refs") {
        return { inputImages: [], referenceImages: [...imageInputs] };
    }
    const inputImages: T[] = [];
    const referenceImages: T[] = [];
    for (const input of imageInputs) {
        const role = roles[input.nodeId];
        if (isStoryboardImageReferenceRole(role)) referenceImages.push(input);
        else inputImages.push(input);
    }
    // Legacy projects may have every image stored as "reference". Keep them as
    // input drivers until the user explicitly designates at least one 参考图
    // while leaving others as 输入图 (or until any image is marked input).
    if (!inputImages.length && referenceImages.length) {
        const hasExplicitInput = imageInputs.some((input) => roles[input.nodeId] === "input");
        if (!hasExplicitInput) {
            return { inputImages: [...referenceImages], referenceImages: [] };
        }
    }
    return { inputImages, referenceImages };
}

/** Best-effort shot count for workflow preflight / cost before a plan is built. */
export function estimateStoryboardWorkflowShotCount(
    metadata: {
        batchMode?: string;
        batchVariantCount?: number | string;
        storyboardShotCount?: number;
        storyboardSceneCount?: number;
        storyboardScript?: string;
        storyboardStyle?: string;
        storyboardParseMode?: string;
        storyboardInputRoles?: Record<string, StoryboardInputRole>;
    } | undefined,
    imageInputs: StoryboardInputLike[],
): number {
    const batchMode = metadata?.batchMode === "refs" ? "refs" : metadata?.batchMode === "variants" ? "variants" : "split";
    if (batchMode === "variants") {
        return Math.min(100, Math.max(1, Math.floor(Number(metadata?.batchVariantCount) || 4)));
    }
    if (batchMode === "refs") {
        const roles = metadata?.storyboardInputRoles || {};
        const { inputImages } = classifyStoryboardBatchImages(imageInputs, roles, "refs");
        return Math.max(1, Math.min(100, inputImages.length || imageInputs.length || 1));
    }
    const declared = Number(metadata?.storyboardShotCount || metadata?.storyboardSceneCount);
    if (Number.isFinite(declared) && declared > 0) return Math.min(100, Math.floor(declared));
    return 6;
}

export function resolveStoryboardScriptInput(input: {
    connectedScript?: string;
    localScript?: string;
    inputMode?: "linked" | "detached";
}) {
    const connectedScript = String(input.connectedScript || "").trim();
    const localScript = String(input.localScript || "").trim();
    // An empty detached node is only an unseeded config created before a text
    // node was connected. It must be allowed to adopt the new upstream text;
    // only a non-empty detached script is a deliberate local override.
    const hasLocalOverride = input.inputMode === "detached" && Boolean(localScript);
    return {
        script: hasLocalOverride ? localScript : localScript || connectedScript,
        followsConnectedScript: Boolean(connectedScript) && !hasLocalOverride,
    };
}

function directTextInputIds(nodeId: string, nodesById: Map<string, CanvasNodeData>, connections: CanvasConnection[]) {
    return new Set(
        connections
            .filter((connection) => connection.toNodeId === nodeId)
            .map((connection) => nodesById.get(connection.fromNodeId))
            .filter((node): node is CanvasNodeData => node?.type === "text" && Boolean(
                node.metadata?.content?.trim()
                || node.metadata?.composerContent?.trim()
                || node.metadata?.prompt?.trim(),
            ))
            .map((node) => node.id),
    );
}

/** Clear the cached linked script when its last direct text connection is removed. */
export function clearDisconnectedStoryboardInputs(
    nodes: CanvasNodeData[],
    previousConnections: CanvasConnection[],
    nextConnections: CanvasConnection[],
) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return nodes.map((node) => {
        if (!node.metadata?.storyboardConfig && node.metadata?.storyboardPipelineStep !== "detect") return node;
        const before = directTextInputIds(node.id, nodesById, previousConnections);
        if (!before.size) return node;
        const after = directTextInputIds(node.id, nodesById, nextConnections);
        if (after.size || (node.metadata.storyboardInputMode === "detached" && node.metadata.storyboardScript?.trim())) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                storyboardScript: undefined,
                composerContent: undefined,
                prompt: undefined,
                storyboardSourceNodeId: undefined,
                storyboardSourceNodeIds: undefined,
                storyboardInputMode: "detached" as const,
                storyboardInputNodeIds: undefined,
                storyboardPrimaryTextNodeId: undefined,
                storyboardInputRoles: undefined,
                storyboardInputShotIds: undefined,
            },
        };
    });
}

export function stripStoryboardDisplayMarker(value: string) {
    return String(value || "")
        .replace(/^\s*[-*•·▪‣]\s+/, "")
        .replace(
            /^\s*(?:(?:第\s*[0-9零〇一二三四五六七八九十百两]+\s*(?:场景|幕|场|镜头|镜)|(?:场景|镜头)\s*[0-9零〇一二三四五六七八九十百两]+|(?:SCENE|SHOT|SEQ)\s*[#:-]?\s*\d+|【[^】]{1,24}】)(?:\s*[：:—-]\s*)?|\d+[.)、])\s*/i,
            "",
        )
        .trim();
}

/** Return exactly the parser's shot boundaries for the editable script list. */
export function splitStoryboardDisplayLines(
    script: string,
    options: { style?: StoryboardStyle; mode?: StoryboardParseMode } = {},
): string[] {
    const normalized = String(script || "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const scenes = parseStoryboardScript(normalized, {
        count: 16,
        style: options.style || "cinematic",
        mode: options.mode || "lines",
    });
    // Always render the parser's scene boundaries. Falling back to physical
    // newline rows when a screenplay marker resolves to one scene makes an
    // edit silently change the shot count on the next parse.
    return scenes.map((scene) => scene.sourceText || scene.summary).filter(Boolean);
}

/** Serialize edited shot rows without changing the selected split mode. */
export function joinStoryboardDisplayLines(lines: string[], mode: StoryboardParseMode = "lines"): string {
    const bodies = lines.map((line) => {
        const trimmed = String(line || "").trim();
        return stripStoryboardDisplayMarker(trimmed) || trimmed;
    });
    const nonEmpty = bodies.filter(Boolean);
    if (mode === "paragraphs") return nonEmpty.join("\n\n");
    if (mode === "markers") return nonEmpty.map((body, index) => `${index + 1}. ${body}`).join("\n");
    if (mode === "prose") return nonEmpty.join("\n");
    return nonEmpty.map((body, index) => `${index + 1}. ${body}`).join("\n");
}
