export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

// Keep the built-in type table as a const object instead of a TypeScript enum.
// The browser build treats both forms identically, while Node's
// `--experimental-strip-types` test runner can execute this module without a
// transpilation step.
export const CanvasNodeType = {
    Image: "image",
    Text: "text",
    Config: "config",
    Video: "video",
    Audio: "audio",
    Group: "group",
} as const;

export type CanvasNodeType = (typeof CanvasNodeType)[keyof typeof CanvasNodeType];

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasNodeExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasLocalImageOperation = "crop" | "split" | "upscale";
export type StoryboardInputRole = "script" | "context" | "input" | "character" | "style" | "scene" | "object" | "reference";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey: string;
    thumbnailUrl?: string;
    thumbnailKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
    taskId?: string;
    deletedByHistory?: boolean;
    deletedAt?: string;
    deletionMessage?: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    uploading?: boolean;
    errorDetails?: string;
    deletedByHistory?: boolean;
    deletedAt?: string;
    deletionMessage?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    /** Text model used by the storyboard auto-analyze step. */
    storyboardTextModel?: string;
    /** Rule-based script splitting mode for storyboard config. */
    storyboardParseMode?: "lines" | "paragraphs" | "markers" | "prose";
    /** When false, rules split shots and AI polish is skipped. */
    storyboardAiPolish?: boolean;
    reasoningEffort?: "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    size?: string;
    sizeMode?: "ratio" | "exact";
    exactWidth?: string | number;
    exactHeight?: string | number;
    resolution?: string;
    quality?: string;
    background?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    loadedImageAspect?: { source: string; ratio: number };
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    thumbnailUrl?: string;
    thumbnailKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    editing?: boolean;
    htmlDevice?: "desktop" | "tablet" | "phone"; // HTML plugin: device frame the page is previewed in.
    htmlLandscape?: boolean;
    htmlPrompt?: string; // HTML plugin: last AI request that produced the page.
    pluginColor?: string;
    taskId?: string;
    taskKind?: "image" | "assistant";
	generationStage?: string;
	cancelPolicy?: {
		allowed?: boolean;
		mode?: string;
		upstreamSubmitted?: boolean;
		refunded?: boolean;
		message?: string;
	};
    executionStatus?: CanvasNodeExecutionStatus;
    generationQueuedAt?: string;
    generationStartedAt?: string;
    generationCompletedAt?: string;
    generationDurationMs?: number;
    workflowOutputNodeIds?: string[];
    workflowProducerNodeId?: string;
    /** Internal workflow result nodes can be hidden and rendered inside their producer card. */
    hidden?: boolean;
    inlineOutputNodeId?: string;
    agentRequestId?: string;
    agentGenerationRequestId?: string;
    agentBatchId?: string;
    agentSourceNodeId?: string;
    localImageOperation?: CanvasLocalImageOperation;
    localImageOperationParams?: Record<string, unknown>;
    localImageOperationCompletedCount?: number;
    imageAngleParams?: Record<string, unknown>;
    /** Storyboard provenance kept on each generated shot for editing, retries, and cloud merges. */
    storyboardId?: string;
    storyboardSceneId?: string;
    storyboardIndex?: number;
    storyboardTitle?: string;
    /** Human-edited shot beat persisted alongside the generated image. */
    storyboardSummary?: string;
    storyboardShotType?: string;
    storyboardStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled";
    /** The shot copy changed after its last image generation. */
    storyboardNeedsRegeneration?: boolean;
    /** Durable source/session fields kept on storyboard groups for reopen/recovery. */
    storyboardScript?: string;
    storyboardPlanJson?: string;
    storyboardSceneCount?: number;
    storyboardAspectRatio?: string;
    storyboardSourceNodeId?: string;
    storyboardSourceNodeIds?: string[];
    storyboardContinuity?: string;
    storyboardPrompt?: string;
    /** Adjacent shot ids provide an explicit, refresh-safe sequence on the canvas. */
    storyboardPreviousSceneId?: string;
    storyboardNextSceneId?: string;
    /** Planner-level provenance mirrored on storyboard members for recovery/merge. */
    storyboardGlobalStyle?: string;
    storyboardPlanSource?: "rules" | "ai";
    /** Original storyboard controls are persisted so a later node-level retry is faithful. */
    storyboardStyle?: string;
    storyboardConsistency?: boolean;
    /** Marks a config node as the inline batch / storyboard workbench. */
    storyboardConfig?: boolean;
    /** Batch config mode: split text, one prompt → N variants, or one prompt × each reference. */
    batchMode?: "split" | "variants" | "refs";
    /** Variant count for batchMode=variants (clamped 1–100). */
    batchVariantCount?: number;
    /** Whether the storyboard script follows its connected text source or is a local override. */
    storyboardInputMode?: "linked" | "detached";
    /** Explicit user-controlled storyboard inputs. Missing means legacy/default selection. */
    storyboardInputNodeIds?: string[];
    /** Exactly one selected text input can be the primary script. */
    storyboardPrimaryTextNodeId?: string;
    /** User-assigned semantic role for connected storyboard inputs. */
    storyboardInputRoles?: Record<string, StoryboardInputRole>;
    /** Selected shot ids for image inputs; omitted means all generated shots. */
    storyboardInputShotIds?: Record<string, string[]>;
    /** Explicit user-selected shot scale by stable shot id. */
    storyboardShotTypeOverrides?: Record<string, string>;
    storyboardShotCount?: number;
    /** Live generate progress mirrored onto the config host for the inline panel. */
    storyboardProgressDone?: number;
    storyboardProgressTotal?: number;
    /** Signature of the inputs that produced this image, and the image they produced, so a later run can skip regenerating it. */
    storyboardShotSignature?: string;
    storyboardShotOutput?: string;
    /** Inputs this node last executed with, and the result it produced, so a later run can tell whether it still has to run. */
    workflowInputSignature?: string;
    workflowOutputSignature?: string;
    /** Durable first-frame reference used to keep later shots visually consistent after refresh. */
    storyboardAnchorReference?: string;
    storyboardAnchorSceneId?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    /** When multi-selecting, all selected sources to wire on drop (includes nodeId). */
    sourceNodeIds?: string[];
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
