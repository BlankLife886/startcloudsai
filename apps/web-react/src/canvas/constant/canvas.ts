import i18n from "@/i18n";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

/** Flip these when video/audio generation is wired up. */
export const CANVAS_VIDEO_ENABLED = false;
export const CANVAS_AUDIO_ENABLED = false;

export function isCanvasNodeTypeEnabled(type?: string) {
    if (type === CanvasNodeType.Video || type === "video") return CANVAS_VIDEO_ENABLED;
    if (type === CanvasNodeType.Audio || type === "audio") return CANVAS_AUDIO_ENABLED;
    return true;
}

export function isCanvasGenerationModeEnabled(mode?: string) {
    return isCanvasNodeTypeEnabled(mode);
}

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 360, height: 420, get title() { return i18n.t("canvas.nodeTypes.image"); } },
    [CanvasNodeType.Text]: { width: 360, height: 240, get title() { return i18n.t("canvas.nodeTypes.text"); } },
    [CanvasNodeType.Config]: { width: 360, height: 414, get title() { return i18n.t("canvas.nodeTypes.config"); } },
    [CanvasNodeType.Video]: { width: 360, height: 202, get title() { return i18n.t("canvas.nodeTypes.video"); } },
    [CanvasNodeType.Audio]: { width: 360, height: 120, get title() { return i18n.t("canvas.nodeTypes.audio"); } },
    [CanvasNodeType.Group]: { width: 760, height: 480, get title() { return i18n.t("canvas.nodeTypes.group"); } },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Image].height, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Image].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Text].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Text].height, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Text].title; },
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Config]: {
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Config].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Config].height, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Config].title; },
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Video].height, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Video].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        width: NODE_DEFAULT_SIZE[CanvasNodeType.Audio].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Audio].height, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Audio].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Group]: {
        width: 760, height: 480, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Group].title; },
        metadata: { status: "idle" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

// Return built-in specs directly and resolve plugin types from the registry.
export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
