import { Crop, FileText, Group, Image as ImageIcon, Maximize2, MessageSquareText, Orbit, Scissors, Music2, Settings2, Video } from "lucide-react";

import i18n from "@/i18n";

import { NODE_SPECS } from "@/constant/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { CanvasOperationNodeType } from "@/lib/canvas/canvas-operation-node";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import { BUNDLED_CANVAS_PLUGINS } from "./bundled";

// Extensible metadata for built-in nodes, reusing NODE_SPECS for size and initial metadata.
// Rendering remains in canvas-node's internal renderer, so no Content component is provided.
function builtinResource(node: CanvasNodeData): CanvasNodeResource | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return { kind: "image", url: node.metadata.content };
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return { kind: "video", url: node.metadata.content };
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return { kind: "audio", url: node.metadata.content };
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return { kind: "text", text: node.metadata.content || node.metadata.prompt };
    return null;
}

const iconClass = "size-5";

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: i18n.t("assets.kinds.text"), icon: <FileText className={iconClass} />, minimapColor: undefined, resource: builtinResource },
    { type: CanvasNodeType.Image, title: i18n.t("assets.kinds.image"), icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource },
    { type: CanvasNodeType.Video, title: i18n.t("assets.kinds.video"), icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource },
    { type: CanvasNodeType.Audio, title: i18n.t("assets.kinds.audio"), icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource },
    { type: CanvasNodeType.Config, title: i18n.t("canvas.configNode.title"), icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa" },
    { type: CanvasNodeType.Group, title: i18n.t("canvas.node.group"), icon: <Group className={iconClass} />, minimapColor: "#94a3b8" },
].map((def) => {
    const spec = NODE_SPECS[def.type];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

const operationSize = { width: NODE_SPECS[CanvasNodeType.Config].width, height: NODE_SPECS[CanvasNodeType.Config].height };
const OPERATION_DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: CanvasOperationNodeType.Crop,
        title: i18n.t("canvas.operationNodes.crop"),
        description: i18n.t("canvas.operationNodes.cropDescription"),
        icon: <Crop className={iconClass} />,
        minimapColor: "#0ea5e9",
        defaultSize: operationSize,
        defaultMetadata: { status: "idle", generationMode: "image", count: 1, localImageOperation: "crop", localImageOperationParams: { x: 0.12, y: 0.12, width: 0.76, height: 0.76 }, localImageOperationCompletedCount: 0 },
    },
    {
        type: CanvasOperationNodeType.Split,
        title: i18n.t("canvas.operationNodes.split"),
        description: i18n.t("canvas.operationNodes.splitDescription"),
        icon: <Scissors className={iconClass} />,
        minimapColor: "#06b6d4",
        defaultSize: operationSize,
        defaultMetadata: { status: "idle", generationMode: "image", count: 4, localImageOperation: "split", localImageOperationParams: { rows: 2, columns: 2 }, localImageOperationCompletedCount: 0 },
    },
    {
        type: CanvasOperationNodeType.Upscale,
        title: i18n.t("canvas.operationNodes.upscale"),
        description: i18n.t("canvas.operationNodes.upscaleDescription"),
        icon: <Maximize2 className={iconClass} />,
        minimapColor: "#14b8a6",
        defaultSize: operationSize,
        defaultMetadata: { status: "idle", generationMode: "image", count: 1, localImageOperation: "upscale", localImageOperationParams: { targetLongEdge: 2048, algorithm: "high" }, localImageOperationCompletedCount: 0 },
    },
    {
        type: CanvasOperationNodeType.Angle,
        title: i18n.t("canvas.operationNodes.angle"),
        description: i18n.t("canvas.operationNodes.angleDescription"),
        icon: <Orbit className={iconClass} />,
        minimapColor: "#8b5cf6",
        defaultSize: operationSize,
        defaultMetadata: { status: "idle", generationMode: "image", count: 1, composerContent: i18n.t("canvas.operationNodes.anglePrompt"), imageAngleParams: { horizontalAngle: 45, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false } },
    },
    {
        type: CanvasOperationNodeType.ReversePrompt,
        title: i18n.t("canvas.operationNodes.reversePrompt"),
        description: i18n.t("canvas.operationNodes.reversePromptDescription"),
        icon: <MessageSquareText className={iconClass} />,
        minimapColor: "#f59e0b",
        defaultSize: operationSize,
        defaultMetadata: { status: "idle", generationMode: "text", count: 1, composerContent: i18n.t("canvas.projectPage.reversePreset") },
    },
];

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([...BUILTIN_DEFINITIONS, ...OPERATION_DEFINITIONS], "builtin");
    BUNDLED_CANVAS_PLUGINS.forEach((plugin) => registerNodeDefinitions(plugin.nodes, plugin.id));
}
