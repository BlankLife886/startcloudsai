import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useBlocker, useNavigate, useParams, useSearchParams, type BlockerFunction } from "react-router";
import { useAuth } from "@react/auth/AuthContext.jsx";
import { takePendingPrompt } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { getWallet, updateProfile } from "@react/legacy-modules/services/meApi.js";
import { Eraser, Group, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { applyCanvasImageModelSettings, canvasImageModelCapabilities } from "@/lib/canvas/canvas-image-model";
import { defaultConfig, modelOptionMeta, resolveModelForCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { adoptGeneratedImage, uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { canvasLocalImageOperationOutputCount, isCanvasLocalImageOperation, normalizeCanvasLocalImageOperationParams } from "@/lib/canvas/canvas-local-image-operation";
import { CanvasOperationNodeType, canvasNodeTypeForLocalImageOperation, isCanvasExecutableNode, isCanvasOperationNodeType } from "@/lib/canvas/canvas-operation-node";
import { cardSizeForMedia, fitNodeSize, nodeSizeFromRatio, resultNodeSize } from "@/lib/canvas/canvas-node-size";
import { App } from "antd";
import { CANVAS_AUDIO_ENABLED, CANVAS_VIDEO_ENABLED, NODE_DEFAULT_SIZE, getNodeSpec, isCanvasGenerationModeEnabled, isCanvasNodeTypeEnabled } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath, canvasConnectionPathD } from "@/components/canvas/canvas-connections";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar } from "@/components/canvas/canvas-node-hover-toolbar";
import { InfiniteCanvas, type CanvasViewportApi } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasImageLightbox } from "@/components/canvas/canvas-image-lightbox";
import { clearPreviewCache, setCanvasPreviewScale } from "@/lib/canvas/canvas-preview-image";
import { AgentPanel } from "@/components/agent/agent-panel";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore, type AgentWorkflowPreflightResult } from "@/stores/use-agent-store";
import { ensureCanvasProjectDocument, flushCanvasPersistence, setCanvasCloudSaveBaseDelay, setCanvasSyncNotifier, useCanvasStore, type CanvasSyncNotification } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { stopHostedAgentRunForCanvas } from "@/lib/agent/hosted-agent-run-scope";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { buildNodeMentionReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { buildCanvasSidePanelWorkflowGroups } from "@/lib/canvas/canvas-workflow-groups";
import { shouldBlockCanvasNavigation } from "@/lib/canvas/canvas-leave-guard";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { copyCanvasNodeMetadata } from "@/lib/canvas/canvas-node-copy";
import { connectionLayerBox, getConnectionTargetAnchor, normalizeConnection, normalizeConnectionBetween, snapNodesIntoGroup } from "@/lib/canvas/canvas-node-geometry";
import { buildCanvasSpatialIndex, type CanvasSpatialIndex } from "@/lib/canvas/canvas-spatial-index";
import {
    applyCanceledGenerationToNodes,
    applyFailedCanvasTaskToNode,
    applyUploadedImageToNode,
    attachCanvasTaskId,
    audioExtension,
    buildAngleLabel,
    buildAnglePrompt,
    buildGenerationConfig,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    getInputSummary,
    hasSubmittedCanvasTask,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isAudioFile,
    isGenerationCanceled,
    isInFlightCanvasGeneration,
    isUnsubmittedCanvasGeneration,
    pendingCanvasTasks,
    repairMisappliedCanvasWorkflowOutputs,
    resetInterruptedGeneration,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
    type PendingCanvasTask,
} from "@/lib/canvas/canvas-generation-helpers";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasCostConfirmDialog, type CanvasCostPayload } from "@/components/canvas/canvas-cost-confirm-dialog";
import { CanvasHomeDialog } from "@/components/canvas/canvas-home-dialog";
import { estimateCanvasGenerationCost, type CanvasCostEstimate } from "@/lib/canvas/canvas-generation-cost";
import { preflightCanvasWorkflow } from "@/lib/canvas/canvas-workflow-preflight";
import {
    advanceCanvasWorkflowCheckpoint,
    beginCanvasWorkflowRetry,
    canvasWorkflowCheckpointForStart,
    compileCanvasWorkflow,
    createCanvasWorkflowCheckpoint,
    failCanvasWorkflowCheckpoint,
    findCanvasWorkflowCancellationClosure,
    findRunnableCanvasWorkflowNodeIds,
    findWorkflowOutputNodes,
    isCanvasWorkflowFailureRetry,
    mergeCanvasWorkflowRunProgress,
    normalizeCanvasWorkflowCheckpoint,
    reconcileCanvasWorkflowCheckpoint,
    reconcileCanvasWorkflowFailureOutput,
    reconcileCanvasWorkflowOutputs,
    settleCanvasWorkflowTerminal,
    validateCanvasWorkflowNodeOutputs,
    validateCanvasWorkflowNodeReadiness,
    waitForCanvasWorkflowStop,
    workflowPlanMatchesCheckpoint,
    type CanvasWorkflowCheckpoint,
    type CanvasWorkflowPlan,
    type CanvasWorkflowNodeOutputIssue,
    type CanvasWorkflowNodeReadinessIssue,
} from "@/lib/canvas/canvas-workflow";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { ConnectionCreateMenu, NodeCreateMenu, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasLocalImageOperation,
    type CanvasNodeData,
    type CanvasNodeImage,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";
import {
    cancelCanvasAssistantRun,
    cancelCanvasTask,
    canvasManualTaskKey,
    canvasWorkflowTaskKey,
    createCanvasTaskNonce,
    imagesFromCanvasTask,
    waitForCanvasAssistantRun,
    waitForCanvasTask,
} from "@/services/canvas-task-api";
import { acquireCanvasWorkflowRun, getActiveCanvasWorkflowRun, updateCanvasWorkflowRun, type CanvasWorkflowRunRecord } from "@/services/canvas-workflow-run-api";
import { StarcloudsApiError } from "@/services/starclouds-api";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();

type CanvasClipboard = {
    marker: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type DragConnectionDom = {
    connection: CanvasConnection;
    paths: SVGPathElement[];
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections">;

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

function cancelPersistedCanvasTask(taskId: string, kind: "image" | "assistant", options?: { keepalive?: boolean }) {
    return kind === "assistant" ? cancelCanvasAssistantRun(taskId, options) : cancelCanvasTask(taskId, options);
}

type CanvasWorkflowRunState = {
    status: "idle" | "running" | "locked" | "refresh" | "success" | "error" | "canceled";
    completed: number;
    total: number;
    currentNodeId?: string;
    currentNodeTitle?: string;
    errorMessage?: string;
    startedAt?: string;
    running?: number;
    queued?: number;
    canceling?: boolean;
};

type CanvasWorkflowRunRequest = { workflowId?: string; nodeIds?: string[] };

const VIDEO_NODE_MAX_WIDTH = 360;
const VIDEO_NODE_MAX_HEIGHT = 360;

function isAcceptedCanvasFile(file: File) {
    if (file.type.startsWith("image/")) return true;
    if (CANVAS_VIDEO_ENABLED && file.type.startsWith("video/")) return true;
    if (CANVAS_AUDIO_ENABLED && isAudioFile(file)) return true;
    return false;
}

function findIndexedGroupDropTarget(index: CanvasSpatialIndex, initialPositions: Map<string, Position>, delta: Position): CanvasNodeData | null {
    const movedIds = new Set(initialPositions.keys());
    if ([...movedIds].some((nodeId) => index.get(nodeId)?.type === CanvasNodeType.Group)) return null;

    let bestGroup: CanvasNodeData | null = null;
    let bestOrder = -1;
    for (const [nodeId, position] of initialPositions) {
        const node = index.get(nodeId);
        if (!node || node.type === CanvasNodeType.Group) continue;
        const centerX = position.x + delta.x + node.width / 2;
        const centerY = position.y + delta.y + node.height / 2;
        for (const candidate of index.queryPoint(centerX, centerY)) {
            const order = index.orderOf(candidate.id);
            if (candidate.type !== CanvasNodeType.Group || movedIds.has(candidate.id) || order <= bestOrder) continue;
            bestGroup = candidate;
            bestOrder = order;
        }
    }
    return bestGroup;
}

function findIndexedContainingGroupId(index: CanvasSpatialIndex, node: CanvasNodeData) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return index.queryPoint(centerX, centerY).find((candidate) => candidate.type === CanvasNodeType.Group && candidate.id !== node.id)?.id;
}

function equalNodeIdSets(first: Set<string>, second: Set<string>) {
    if (first.size !== second.size) return false;
    for (const nodeId of first) if (!second.has(nodeId)) return false;
    return true;
}
// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

function normalizeCanvasImageAngleParams(value: unknown): CanvasImageAngleParams {
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
const NODE_CONTROL_DRAG_THRESHOLD = 5;
const CANVAS_WORKFLOW_OWNER_PREFIX = "infinite-canvas:workflow-owner:";

function canvasWorkflowOwnerId(projectId: string) {
    const key = `${CANVAS_WORKFLOW_OWNER_PREFIX}${projectId}`;
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const ownerId = crypto.randomUUID();
    window.sessionStorage.setItem(key, ownerId);
    return ownerId;
}

function mergeWorkflowRunCheckpoint(checkpoint: CanvasWorkflowCheckpoint, run: CanvasWorkflowRunRecord, options?: { resetCurrentNode?: boolean }) {
    return mergeCanvasWorkflowRunProgress(checkpoint, run, options);
}

function isCanvasTextEditTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isCanvasControlTarget(target: EventTarget | null) {
    if (!(target instanceof Element) || isCanvasTextEditTarget(target)) return false;
    return Boolean(target.closest("button, a, [role='button'], [role='switch'], [role='menuitem'], .ant-switch"));
}
export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    // Subscribe to the registry version so plugin registration changes rerender the canvas.
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const workflowOwnerId = useMemo(() => canvasWorkflowOwnerId(projectId), [projectId]);
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const agentPanelClosing = useAgentStore((state) => state.panelClosing);
    const agentRunning = useAgentStore((state) => state.sending || state.waiting);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const containerRectRef = useRef({ left: 0, top: 0, width: 1200, height: 720 });
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const dragDeltaRef = useRef<Position>({ x: 0, y: 0 });
    const selectionRafRef = useRef<number | null>(null);
    const selectionPointerRef = useRef<Position | null>(null);
    const selectionRectRef = useRef<SVGRectElement>(null);
    const connectionRafRef = useRef<number | null>(null);
    const connectionPointerRef = useRef<Position | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragNodeElementsRef = useRef(new Map<string, HTMLElement>());
    const dragConnectionDomRef = useRef<DragConnectionDom[]>([]);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialPositionsById: Map<string, Position>;
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialPositionsById: new Map(),
    });
    const controlDragRef = useRef<{
        nodeId: string;
        startX: number;
        startY: number;
        nextSelected: Set<string>;
    } | null>(null);
    const suppressControlClickRef = useRef(false);

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const canRemoveBackground = useMemo(() => {
        const model = resolveModelForCapability(effectiveConfig, effectiveConfig.model, "image");
        return canvasImageModelCapabilities(modelOptionMeta(effectiveConfig, model)).transparentBackground;
    }, [effectiveConfig]);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const addSharedImage = useAssetStore((state) => state.addSharedImage);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const currentProjectTitle = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.title);
    const startEditingProject = useCanvasUiStore((state) => state.startEditingProject);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("select");
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIdsState] = useState<Set<string>>(new Set());
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const setSelectedNodeIds = useCallback((value: Set<string> | ((current: Set<string>) => Set<string>)) => {
        const next = typeof value === "function" ? value(selectedNodeIdsRef.current) : value;
        selectedNodeIdsRef.current = next;
        setSelectedNodeIdsState(next);
    }, []);
    const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());
    const selectedConnectionId = selectedConnectionIds.size === 1 ? selectedConnectionIds.values().next().value || null : null;
    const setSelectedConnectionId = useCallback((value: string | null | ((current: string | null) => string | null)) => {
        setSelectedConnectionIds((current) => {
            const currentSingle = current.size === 1 ? current.values().next().value || null : null;
            const next = typeof value === "function" ? value(currentSingle) : value;
            return next ? new Set([next]) : new Set();
        });
    }, []);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(() => new Set());
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [stopConfirm, setStopConfirm] = useState<{ kind: "running" | "workflow"; queuedCount: number; nodeId?: string } | null>(null);
    const [stopSubmitting, setStopSubmitting] = useState(false);
    const [leaveSubmitting, setLeaveSubmitting] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [renameDialog, setRenameDialog] = useState<{ nodeId: string; title: string } | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [expandedImageNodeId, setExpandedImageNodeId] = useState<string | null>(null);
    const [viewportBusy, setViewportBusy] = useState(false);
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [costConfirm, setCostConfirm] = useState<CanvasCostPayload | null>(null);
    const [workflowRun, setWorkflowRun] = useState<CanvasWorkflowRunState>({ status: "idle", completed: 0, total: 0 });
    const costResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
    const auth = useAuth() as { user: { requireCostConfirm?: boolean } | null; setUser: (user: unknown) => void };

    const requestCostEstimateConfirm = useCallback(
        async (estimate: CanvasCostEstimate) => {
            if (auth.user?.requireCostConfirm === false) return true;
            const wallet = await getWallet().catch(() => null);
            const available = wallet ? Math.max(0, Number(wallet.availableCents ?? wallet.balanceCents ?? 0)) : null;
            return new Promise<boolean>((resolve) => {
                costResolverRef.current?.(false);
                costResolverRef.current = resolve;
                setCostConfirm({ ...estimate, available });
            });
        },
        [auth.user?.requireCostConfirm],
    );

    const requestCostConfirm = useCallback(
        (input: Parameters<typeof estimateCanvasGenerationCost>[0]) => requestCostEstimateConfirm(estimateCanvasGenerationCost(input)),
        [requestCostEstimateConfirm],
    );

    const finishCostConfirm = useCallback((confirmed: boolean) => {
        const resolve = costResolverRef.current;
        costResolverRef.current = null;
        setCostConfirm(null);
        resolve?.(confirmed);
    }, []);

    const handleCostConfirm = useCallback(
        async ({ skipEveryTime }: { skipEveryTime: boolean }) => {
            if (skipEveryTime) {
                try {
                    const result = await updateProfile({ requireCostConfirm: false });
                    auth.setUser({ ...auth.user, ...(result?.user || { requireCostConfirm: false }) });
                } catch {
                    auth.setUser({ ...auth.user, requireCostConfirm: false });
                }
            }
            finishCostConfirm(true);
        },
        [auth, finishCostConfirm],
    );

    const nodesRef = useRef(nodes);
    const nodesByIdRef = useRef(new Map(nodes.map((node) => [node.id, node])));
    const connectionsRef = useRef(connections);
    const viewportRef = useRef(viewport);
    const viewportApiRef = useRef<CanvasViewportApi | null>(null);
    const viewportInteractingRef = useRef(false);
    const focusAnimRef = useRef<number | null>(null);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: { skipCostConfirm?: boolean; workflowRunId?: string; taskKeySalt?: string }) => Promise<boolean>) | null>(null);
    const runWorkflowRef = useRef<((request?: CanvasWorkflowRunRequest) => Promise<void>) | null>(null);
    const planWorkflowAgentRef = useRef<((request?: CanvasWorkflowRunRequest) => AgentWorkflowPreflightResult) | null>(null);
    const stopWorkflowAgentRef = useRef<(() => { stopped: boolean; status: string; nodeIds: string[] }) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const workflowRunRef = useRef<{ cancelQueued: boolean; lockLost?: boolean; executing?: boolean; stopped?: boolean; currentNodeId?: string; canceledNodeIds: Set<string> }>({ cancelQueued: false, canceledNodeIds: new Set() });
    const workflowRunStateRef = useRef(workflowRun);
    workflowRunStateRef.current = workflowRun;
    const workflowExecutionTokenRef = useRef(0);
    // Task ids submitted on behalf of the active workflow run; used by "stop"
    // to cancel still-queued server-side tasks so they do not keep billing.
    const workflowRunTaskIdsRef = useRef(new Set<string>());
    const workflowSubmittedNodeIdsRef = useRef(new Set<string>());
    const workflowPlanRef = useRef<CanvasWorkflowPlan | null>(null);
    const workflowPendingIdsRef = useRef(new Set<string>());
    const pendingResumeRef = useRef<PendingCanvasTask[]>([]);
    const pendingWorkflowResumeRef = useRef<CanvasWorkflowCheckpoint | null>(null);
    const resumePendingCanvasTasksRef = useRef<(targets: PendingCanvasTask[]) => Promise<void>>(async () => undefined);
    const resumeWorkflowRef = useRef<(checkpoint: CanvasWorkflowCheckpoint) => Promise<void>>(async () => undefined);
    const workflowCheckpointRef = useRef<CanvasWorkflowCheckpoint | null>(null);
    const lockedWorkflowRunRef = useRef<CanvasWorkflowRunRecord | null>(null);
    const workflowStopPromiseRef = useRef<Promise<void> | null>(null);
    const workflowStopRetryRef = useRef<CanvasWorkflowCheckpoint | null>(null);
    const workflowTerminalPromiseRef = useRef<Promise<void> | null>(null);
    const workflowBrowserLockReleaseRef = useRef<(() => void) | null>(null);
    const pageActiveRef = useRef(true);
    const leavingCanvasPageRef = useRef(false);
    const projectLoadedRef = useRef(false);
    projectLoadedRef.current = projectLoaded;

    const releaseWorkflowBrowserLock = useCallback(() => {
        workflowBrowserLockReleaseRef.current?.();
        workflowBrowserLockReleaseRef.current = null;
    }, []);

    const acquireWorkflowBrowserLock = useCallback(async () => {
        if (workflowBrowserLockReleaseRef.current) return true;
        if (!navigator.locks) return true;
        return new Promise<boolean>((resolve) => {
            void navigator.locks.request(`startclouds-canvas-workflow:${projectId}`, { ifAvailable: true }, async (lock) => {
                if (!lock) {
                    resolve(false);
                    return;
                }
                let release!: () => void;
                const held = new Promise<void>((done) => {
                    release = done;
                });
                workflowBrowserLockReleaseRef.current = release;
                resolve(true);
                await held;
            });
        });
    }, [projectId]);

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
        }),
        [],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const commitNodes = useCallback(
        (updater: (current: CanvasNodeData[]) => CanvasNodeData[]) => {
            let next: CanvasNodeData[] = nodesRef.current;
            setNodes((current) => {
                next = updater(current);
                nodesRef.current = next;
                return next;
            });
            updateProject(projectId, { nodes: next, connections: connectionsRef.current });
            return next;
        },
        [projectId, updateProject],
    );

    const persistCanvasTaskId = useCallback(
        async (nodeId: string, taskId: string, imageId?: string, taskKind: "image" | "assistant" = "image") => {
            const nodes = nodesRef.current;
            const current = nodes.find((item) => item.id === nodeId);
            const shouldCancelSubmittedTask =
                workflowRunRef.current.cancelQueued ||
                workflowRunRef.current.stopped ||
                workflowRunRef.current.canceledNodeIds.has(nodeId) ||
                !current ||
                !isInFlightCanvasGeneration(current);
            if (shouldCancelSubmittedTask) {
                try {
                    await cancelPersistedCanvasTask(taskId, taskKind);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("canvas.projectPage.stopFailed"));
                }
                return;
            }
            workflowSubmittedNodeIdsRef.current.add(nodeId);
            if (current?.metadata?.workflowProducerNodeId) workflowSubmittedNodeIdsRef.current.add(current.metadata.workflowProducerNodeId);
            nodes.forEach((item) => {
                if (item.metadata?.workflowOutputNodeIds?.includes(nodeId)) workflowSubmittedNodeIdsRef.current.add(item.id);
            });
            const checkpoint = workflowCheckpointRef.current;
            if (taskKind === "image" && checkpoint?.status === "running" && workflowRunRef.current.currentNodeId) {
                const producerId = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.workflowProducerNodeId;
                if (checkpoint.nodeIds.includes(nodeId) || (producerId && checkpoint.nodeIds.includes(producerId))) workflowRunTaskIdsRef.current.add(taskId);
            }
            commitNodes((current) =>
                current.map((node) => {
                    const producerId = current.find((item) => item.id === nodeId)?.metadata?.workflowProducerNodeId;
                    const isProducer = node.metadata?.workflowOutputNodeIds?.includes(nodeId) || node.id === producerId;
                    if (node.id !== nodeId && !isProducer) return node;
                    if (!isInFlightCanvasGeneration(node)) return node;
                    return attachCanvasTaskId(node, taskId, node.id === nodeId ? imageId : undefined, taskKind);
                }),
            );
            await flushCanvasPersistence();
        },
        [commitNodes, message, t],
    );

    const finalizeCanceledGenerationNodes = useCallback(
        (nodeIds?: Set<string>) => {
            commitNodes((current) => applyCanceledGenerationToNodes(current, t("canvas.generation.canceled"), nodeIds));
        },
        [commitNodes, t],
    );

    const collectUnsubmittedWorkflowNodeIds = useCallback(() => {
        const ids = new Set<string>();
        for (const node of nodesRef.current) {
            if (workflowSubmittedNodeIdsRef.current.has(node.id)) continue;
            if (isUnsubmittedCanvasGeneration(node) && !hasSubmittedCanvasTask(node, nodesRef.current)) ids.add(node.id);
        }
        for (const id of workflowPendingIdsRef.current) {
            if (workflowSubmittedNodeIdsRef.current.has(id)) continue;
            const node = nodesRef.current.find((item) => item.id === id);
            if (!node || !hasSubmittedCanvasTask(node, nodesRef.current)) ids.add(id);
        }
        generationRequestsRef.current.forEach((request) => {
            if (workflowSubmittedNodeIdsRef.current.has(request.runningNodeId) || workflowSubmittedNodeIdsRef.current.has(request.originNodeId)) return;
            const node = nodesRef.current.find((item) => item.id === request.runningNodeId) || nodesRef.current.find((item) => item.id === request.originNodeId);
            if (node && !hasSubmittedCanvasTask(node, nodesRef.current)) {
                ids.add(request.targetNodeId);
                ids.add(request.originNodeId);
                ids.add(request.runningNodeId);
            }
        });
        return ids;
    }, []);

    const stopUnsubmittedWorkflowWork = useCallback((requestedNodeId?: string) => {
        const allUnsubmittedIds = collectUnsubmittedWorkflowNodeIds();
        const plan = workflowPlanRef.current;
        const planPendingIds = new Set(
            [...workflowPendingIdsRef.current, ...allUnsubmittedIds].filter((id) => plan?.nodeIds.includes(id)),
        );
        const canceledPlanIds = requestedNodeId && plan
            ? findCanvasWorkflowCancellationClosure(requestedNodeId, planPendingIds, plan.dependencies)
            : planPendingIds;
        const unsubmittedIds = new Set(canceledPlanIds);
        for (const node of nodesRef.current) {
            const producerId = node.metadata?.workflowProducerNodeId;
            if (producerId && canceledPlanIds.has(producerId) && allUnsubmittedIds.has(node.id)) unsubmittedIds.add(node.id);
            if (canceledPlanIds.has(node.id)) {
                for (const outputId of node.metadata?.workflowOutputNodeIds || []) {
                    if (allUnsubmittedIds.has(outputId)) unsubmittedIds.add(outputId);
                }
            }
        }
        if (!requestedNodeId) workflowRunRef.current.cancelQueued = true;
        unsubmittedIds.forEach((id) => {
            workflowRunRef.current.canceledNodeIds.add(id);
            workflowPendingIdsRef.current.delete(id);
        });
        generationRequestsRef.current.forEach((request) => {
            if (!unsubmittedIds.has(request.targetNodeId) && !unsubmittedIds.has(request.originNodeId) && !unsubmittedIds.has(request.runningNodeId)) return;
            request.controller.abort();
        });
        if (unsubmittedIds.size) finalizeCanceledGenerationNodes(unsubmittedIds);
        const checkpoint = workflowCheckpointRef.current;
        if (checkpoint && canceledPlanIds.size) {
            const canceledNodeIds = [...new Set([...(checkpoint.canceledNodeIds || []), ...canceledPlanIds])];
            const nextCheckpoint = { ...checkpoint, canceledNodeIds, updatedAt: new Date().toISOString() };
            workflowCheckpointRef.current = nextCheckpoint;
            updateProject(projectId, { workflowRun: nextCheckpoint });
            void flushCanvasPersistence();
            if (nextCheckpoint.runId) {
                void updateCanvasWorkflowRun(projectId, nextCheckpoint.runId, {
                    ownerId: workflowOwnerId,
                    status: "running",
                    completedNodeIds: nextCheckpoint.completedNodeIds,
                    canceledNodeIds,
                    currentNodeId: nextCheckpoint.currentNodeId,
                }).catch(() => undefined);
            }
        }
        setRunningNodeIds((current) => {
            const next = new Set(current);
            unsubmittedIds.forEach((id) => next.delete(id));
            return next;
        });
        setWorkflowRun((current) => ({
            ...current,
            queued: workflowPendingIdsRef.current.size,
            running: nodesRef.current.filter((node) => node.metadata?.executionStatus === "running" && hasSubmittedCanvasTask(node, nodesRef.current)).length,
            canceling: nodesRef.current.some((node) => node.metadata?.executionStatus === "running" && hasSubmittedCanvasTask(node, nodesRef.current)),
        }));
        return unsubmittedIds.size;
    }, [collectUnsubmittedWorkflowNodeIds, finalizeCanceledGenerationNodes, projectId, updateProject, workflowOwnerId]);

    const resumePendingCanvasTasks = useCallback(
        async (targets: PendingCanvasTask[]) => {
            if (!targets.length) return;
            const byNode = new Map<string, PendingCanvasTask[]>();
            for (const target of targets) {
                const list = byNode.get(target.nodeId) || [];
                list.push(target);
                byNode.set(target.nodeId, list);
            }
            await Promise.all(
                [...byNode.entries()].map(async ([nodeId, nodeTargets]) => {
                    const runningId = nodesRef.current.find((node) => node.id === nodeId)?.metadata?.workflowProducerNodeId || nodeId;
                    const controller = startGenerationRequest(nodeId, nodeId, runningId);
                    setRunningNodeIds((current) => new Set(current).add(runningId));
                    try {
                        await Promise.all(
                            nodeTargets.map(async (target) => {
                                try {
                                    if (target.kind === "assistant") {
                                        const content = await waitForCanvasAssistantRun(target.taskId, () => undefined, controller.signal);
                                        commitNodes((current) =>
                                            current.map((node) =>
                                                node.id === target.nodeId
                                                    ? { ...node, metadata: { ...node.metadata, content, status: NODE_STATUS_SUCCESS, taskId: undefined, taskKind: undefined, errorDetails: undefined } }
                                                    : node,
                                            ),
                                        );
                                    } else {
                                        const task = await waitForCanvasTask(target.taskId, controller.signal);
                                        const [image] = imagesFromCanvasTask(task);
                                        const uploaded = await adoptGeneratedImage(image);
                                        commitNodes((current) => current.map((item) => (item.id === target.nodeId ? applyUploadedImageToNode(item, uploaded, target.imageId) : item)));
                                    }
                                } catch (error) {
                                    if (isGenerationCanceled(error)) return;
                                    const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                    commitNodes((current) => current.map((node) => (node.id === target.nodeId ? applyFailedCanvasTaskToNode(node, errorDetails, target.imageId) : node)));
                                }
                            }),
                        );
                        const producerIds = new Set(
                            nodesRef.current
                                .filter((node) => nodeTargets.some((target) => target.nodeId === node.id))
                                .map((node) => node.metadata?.workflowProducerNodeId)
                                .filter((id): id is string => Boolean(id)),
                        );
                        if (producerIds.size) {
                            const completedAt = new Date();
                            commitNodes((current) =>
                                current.map((node) => {
                                    if (!producerIds.has(node.id)) return node;
                                    const outputIds = node.metadata?.workflowOutputNodeIds || [];
                                    const outputs = outputIds.map((id) => current.find((item) => item.id === id)).filter((item): item is CanvasNodeData => Boolean(item));
                                    const allSucceeded = outputs.length > 0 && outputs.every((item) => item.metadata?.status === NODE_STATUS_SUCCESS);
                                    const anyLoading = outputs.some((item) => item.metadata?.status === NODE_STATUS_LOADING);
                                    const firstError = outputs.find((item) => item.metadata?.status === NODE_STATUS_ERROR)?.metadata?.errorDetails;
                                    return {
                                        ...node,
                                        metadata: {
                                            ...node.metadata,
                                            status: allSucceeded ? NODE_STATUS_SUCCESS : anyLoading ? NODE_STATUS_LOADING : NODE_STATUS_ERROR,
                                            errorDetails: allSucceeded || anyLoading ? undefined : firstError || t("canvas.projectPage.generationFailed"),
                                            executionStatus: allSucceeded ? "succeeded" : anyLoading ? "running" : "failed",
                                            ...(!anyLoading
                                                ? {
                                                      generationCompletedAt: completedAt.toISOString(),
                                                      generationDurationMs: Math.max(0, completedAt.getTime() - new Date(node.metadata?.generationStartedAt || completedAt).getTime()),
                                                  }
                                                : {}),
                                        },
                                    };
                                }),
                            );
                        }
                    } finally {
                        finishGenerationRequest(nodeId, controller);
                        setRunningNodeIds((current) => {
                            const stillRunning = [...generationRequestsRef.current.values()].some((request) => request.runningNodeId === runningId);
                            if (stillRunning) return current;
                            const next = new Set(current);
                            next.delete(runningId);
                            return next;
                        });
                    }
                }),
            );
            await flushCanvasPersistence();
        },
        [commitNodes, finishGenerationRequest, startGenerationRequest, t],
    );
    resumePendingCanvasTasksRef.current = resumePendingCanvasTasks;

    useEffect(() => {
        pageActiveRef.current = true;
        const persist = () => {
            if (viewportSaveTimerRef.current) {
                window.clearTimeout(viewportSaveTimerRef.current);
                viewportSaveTimerRef.current = null;
                updateProject(projectId, { viewport: viewportRef.current });
            }
            void flushCanvasPersistence();
        };
        window.addEventListener("pagehide", persist);
        window.addEventListener("beforeunload", persist);
        return () => {
            pageActiveRef.current = false;
            window.removeEventListener("pagehide", persist);
            window.removeEventListener("beforeunload", persist);
        };
    }, [projectId, updateProject]);

    // Surface cloud save failures (size limit, network, server errors) that the
    // store would otherwise only log; the local copy stays marked as unsynced.
    useEffect(() => {
        return setCanvasSyncNotifier((notification: CanvasSyncNotification) => {
            if (notification.kind === "save_failed") {
                const detail = notification.errorMessage ? `：${notification.errorMessage}` : "";
                message.error(`${t("canvas.sync.saveFailed", { name: notification.projectTitle || t("canvas.project.untitled") })}${detail}`);
            } else {
                message.success(t("canvas.sync.saveRecovered"));
            }
        });
    }, [message, t]);

    useEffect(() => {
        if (!hydrated) return;
        let disposed = false;
        setProjectLoaded(false);
        clearPreviewCache();
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const restore = async () => {
            const loaded = (await ensureCanvasProjectDocument(projectId).catch(() => null)) || openProject(projectId);
            if (disposed) return;
            if (!loaded || loaded.documentPending) {
                message.error(t("canvas.sync.loadFailed"));
                navigate("/canvas", { replace: true });
                return;
            }
            const project = loaded;
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(repairMisappliedCanvasWorkflowOutputs(project.nodes)));
            if (disposed) return;
            const persistedCheckpoint = normalizeCanvasWorkflowCheckpoint(project.workflowRun);
            const checkpoint = persistedCheckpoint ? reconcileCanvasWorkflowFailureOutput(persistedCheckpoint, restoredNodes, project.connections) : null;
            if (checkpoint !== persistedCheckpoint) updateProject(projectId, { workflowRun: checkpoint });
            pendingResumeRef.current = pendingCanvasTasks(restoredNodes);
            pendingWorkflowResumeRef.current = checkpoint?.status === "running" ? checkpoint : null;
            workflowCheckpointRef.current = checkpoint;
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            if (disposed) return;
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            workflowRunRef.current = checkpoint?.status === "running"
                ? { cancelQueued: false, currentNodeId: checkpoint.currentNodeId || "__workflow_resume__", canceledNodeIds: new Set(checkpoint.canceledNodeIds || []) }
                : { cancelQueued: false, canceledNodeIds: new Set() };
            setWorkflowRun(
                checkpoint?.status === "running"
                    ? { status: "running", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, currentNodeId: checkpoint.currentNodeId, currentNodeTitle: restoredNodes.find((node) => node.id === checkpoint.currentNodeId)?.title, startedAt: checkpoint.startedAt }
                    : checkpoint?.status === "failed"
                      ? { status: "error", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, currentNodeId: checkpoint.errorNodeId || checkpoint.currentNodeId, currentNodeTitle: restoredNodes.find((node) => node.id === (checkpoint.errorNodeId || checkpoint.currentNodeId))?.title, errorMessage: checkpoint.errorMessage, startedAt: checkpoint.startedAt }
                      : { status: "idle", completed: 0, total: 0 },
            );
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
        return () => {
            disposed = true;
            clearPreviewCache();
        };
    }, [hydrated, message, navigate, openProject, projectId, t, updateProject]);

    useEffect(() => {
        if (!projectLoaded) return;
        const targets = pendingResumeRef.current;
        const checkpoint = pendingWorkflowResumeRef.current;
        pendingResumeRef.current = [];
        pendingWorkflowResumeRef.current = null;
        if (!targets.length && !checkpoint) return;
        void (async () => {
            if (targets.length) await resumePendingCanvasTasksRef.current(targets);
            if (checkpoint && pageActiveRef.current) await resumeWorkflowRef.current(checkpoint);
        })();
        return () => {
            const nodeIds = new Set(targets.map((target) => target.nodeId));
            generationRequestsRef.current.forEach((request) => {
                if (!nodeIds.has(request.targetNodeId)) return;
                request.controller.abort();
            });
        };
    }, [projectId, projectLoaded]);

    useEffect(() => {
        leavingCanvasPageRef.current = false;
        return () => {
            leavingCanvasPageRef.current = true;
            releaseWorkflowBrowserLock();
            generationRequestsRef.current.forEach((request) => request.controller.abort());
            generationRequestsRef.current.clear();
            if (projectLoadedRef.current) updateProject(projectId, { nodes: nodesRef.current, connections: connectionsRef.current });
        };
    }, [projectId, releaseWorkflowBrowserLock, updateProject]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl")) openAgentPanel();
    }, [openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (previous?.nodes === next.nodes && previous.connections === next.connections) return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [connections, createHistoryEntry, nodes, projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        setCanvasPreviewScale(viewport.k);
    }, [viewport.k]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        nodesByIdRef.current = new Map(nodes.map((node) => [node.id, node]));
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        if (!viewportInteractingRef.current) viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
        const rect = selectionRectRef.current;
        if (!selectionBox || !rect) return;
        rect.setAttribute("x", String(selectionBox.startWorldX));
        rect.setAttribute("y", String(selectionBox.startWorldY));
        rect.setAttribute("width", "0");
        rect.setAttribute("height", "0");
    }, [selectionBox]);

    useEffect(() => {
        didInitialCenterRef.current = false;
    }, [projectId]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            containerRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            setSize((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }));
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport((prev) => (prev.x === 0 && prev.y === 0 && prev.k === 1 ? { x: rect.width / 2, y: rect.height / 2, k: 1 } : prev));
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        let offsetFrame = 0;
        const updateOffset = () => {
            if (offsetFrame) return;
            offsetFrame = requestAnimationFrame(() => {
                offsetFrame = 0;
                const rect = el.getBoundingClientRect();
                containerRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            });
        };
        window.addEventListener("scroll", updateOffset, true);
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("scroll", updateOffset, true);
            if (offsetFrame) cancelAnimationFrame(offsetFrame);
        };
    }, [projectLoaded]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRectRef.current;
        const currentViewport = viewportRef.current;
        const localX = clientX - rect.left;
        const localY = clientY - rect.top;

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRectRef.current;
        return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, [screenToCanvas]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            if (connectionRafRef.current) cancelAnimationFrame(connectionRafRef.current);
            connectionRafRef.current = null;
            connectionPointerRef.current = null;
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current || !selectedNodeIdsRef.current.has(nodeId)) return;
        setToolbarNodeId(nodeId);
    }, []);

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message, t],
    );

    const createConnectedNode = useCallback(
        (type: string, pending: PendingConnectionCreate) => {
            if (!isCanvasNodeTypeEnabled(type)) {
                message.warning(t("canvas.projectPage.mediaUnavailable"));
                return;
            }
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, resolution: effectiveConfig.resolution, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            if (!definition?.hidePanel && (definition?.Panel || definition?.useBuiltinPanel || (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group))) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.resolution, effectiveConfig.size, message, setConnecting, t],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const nodeSpatialIndex = useMemo(() => buildCanvasSpatialIndex(nodes), [nodes]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            const queryRadius = Math.max(padding, handleRadius);
            const sourceNode = nodeSpatialIndex.get(current.nodeId);
            nodeSpatialIndex
                .queryRect({ left: world.x - queryRadius, top: world.y - queryRadius, right: world.x + queryRadius, bottom: world.y + queryRadius })
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnectionBetween(sourceNode, node, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [nodeSpatialIndex, screenToCanvas],
    );

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const visibleNodes = useMemo(() => nodes.filter((node) => !node.metadata?.hidden), [nodes]);
    const displayConnections = useMemo(() => {
        const hiddenProducerById = new Map(
            nodes
                .filter((node) => node.metadata?.hidden && node.metadata?.workflowProducerNodeId)
                .map((node) => [node.id, node.metadata!.workflowProducerNodeId!]),
        );
        const seen = new Set<string>();
        return connections.flatMap((connection): CanvasConnection[] => {
            const fromNodeId = hiddenProducerById.get(connection.fromNodeId) || connection.fromNodeId;
            const toNodeId = hiddenProducerById.get(connection.toNodeId) || connection.toNodeId;
            if (fromNodeId === toNodeId) return [];
            const endpoints = `${fromNodeId}->${toNodeId}`;
            if (seen.has(endpoints)) return [];
            seen.add(endpoints);
            return [{ ...connection, fromNodeId, toNodeId }];
        });
    }, [connections, nodes]);
    const displayNodeById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
    const connectionLayer = useMemo(() => connectionLayerBox(displayConnections, displayNodeById, connectingParams ? [mouseWorld] : []), [connectingParams, displayConnections, displayNodeById, mouseWorld]);
    // The toolbar follows a single selected node selected by click, creation, marquee, or keyboard.
    // It stays hidden for multi-selection and while isNodeDragging is true.
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const toolbarNode = (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) || (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const cropInitialParams = useMemo(
        () => (cropNode?.type === CanvasOperationNodeType.Crop ? normalizeCanvasLocalImageOperationParams("crop", cropNode.metadata?.localImageOperationParams) : undefined),
        [cropNode?.id, cropNode?.metadata?.localImageOperationParams],
    );
    const splitInitialParams = useMemo(
        () => (splitNode?.type === CanvasOperationNodeType.Split ? normalizeCanvasLocalImageOperationParams("split", splitNode.metadata?.localImageOperationParams) : undefined),
        [splitNode?.id, splitNode?.metadata?.localImageOperationParams],
    );
    const upscaleInitialParams = useMemo(
        () => (upscaleNode?.type === CanvasOperationNodeType.Upscale ? normalizeCanvasLocalImageOperationParams("upscale", upscaleNode.metadata?.localImageOperationParams) : undefined),
        [upscaleNode?.id, upscaleNode?.metadata?.localImageOperationParams],
    );
    const angleInitialParams = useMemo(
        () => (angleNode?.type === CanvasOperationNodeType.Angle ? normalizeCanvasImageAngleParams(angleNode.metadata?.imageAngleParams) : undefined),
        [angleNode?.id, angleNode?.metadata?.imageAngleParams],
    );
    const operationInputNode = (target: CanvasNodeData | null) => {
        if (!target || target.type === CanvasNodeType.Image) return target;
        const inputNodeId = buildNodeGenerationInputs(target.id, nodes, connections).find((input) => input.image)?.nodeId;
        return inputNodeId ? nodeById.get(inputNodeId) || null : null;
    };
    const cropDialogNode = useHeldValue(operationInputNode(cropNode));
    const maskEditDialogNode = useHeldValue(maskEditNode);
    const splitDialogNode = useHeldValue(operationInputNode(splitNode));
    const upscaleDialogNode = useHeldValue(operationInputNode(upscaleNode));
    const angleDialogNode = useHeldValue(operationInputNode(angleNode));
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const previewImage = previewImageId ? previewNode?.metadata?.images?.find((image) => image.id === previewImageId) || null : null;
    const contextNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const contextNodeDefinition = contextNode ? getNodeDefinition(contextNode.type) : null;
    const contextNodeCanEdit = Boolean(contextNode && contextNode.type !== CanvasNodeType.Group && !contextNodeDefinition?.hidePanel);
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (!isCanvasExecutableNode(node)) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const confirmAgentImageGenerationBatch = useCallback(
        (count: number) => requestCostConfirm({ config: buildGenerationConfig(effectiveConfig, undefined, "image"), kind: "image", count }),
        [effectiveConfig, requestCostConfirm],
    );
    const { applyAgentOps } = useAgentBridge({
        projectId,
        title: currentProjectTitle,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        canvasSize: size,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        runWorkflowRef,
        stopWorkflowRef: stopWorkflowAgentRef,
        planWorkflowRef: planWorkflowAgentRef,
        workflowRunStateRef,
        confirmImageGenerationBatch: confirmAgentImageGenerationBatch,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            if (!isCanvasNodeTypeEnabled(type)) {
                message.warning(t("canvas.projectPage.mediaUnavailable"));
                return;
            }
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          resolution: effectiveConfig.resolution,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // Display-only plugin nodes with hidePanel do not open a panel; custom Panels require autoOpenPanel on creation.
            // Plugin nodes declaring useBuiltinPanel open the built-in generation panel on creation, like image nodes.
            // Built-in image, video, and config nodes retain their existing open-on-create behavior.
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.resolution, effectiveConfig.size, getCanvasCenter, message, t],
    );

    const abortGenerationForNodes = useCallback((ids?: Set<string>) => {
        generationRequestsRef.current.forEach((request, key) => {
            if (ids && !ids.has(request.targetNodeId) && !ids.has(request.originNodeId) && !ids.has(request.runningNodeId)) return;
            request.controller.abort();
            generationRequestsRef.current.delete(key);
        });
    }, []);

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            abortGenerationForNodes(allIds);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    return node;
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setRenameDialog((current) => (current && allIds.has(current.nodeId) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => {
                if (!current || !allIds.has(current)) return current;
                setPreviewImageId(null);
                return null;
            });
            setSplitNodeId((current) => (current && allIds.has(current) ? null : current));
            setUpscaleNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeIds((current) => new Set([...current].filter((nodeId) => !allIds.has(nodeId))));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [abortGenerationForNodes, chatSessions, cleanupCanvasFiles, projectId],
    );

    const deleteConnections = useCallback((connectionIds: Set<string>) => {
        if (!connectionIds.size) return;
        setConnections((prev) => prev.filter((conn) => !connectionIds.has(conn.id)));
        setSelectedConnectionIds((current) => new Set([...current].filter((id) => !connectionIds.has(id))));
        setContextMenu((current) => (current?.type === "connection" && connectionIds.has(current.connectionId) ? null : current));
    }, []);

    const deleteConnection = useCallback((connectionId: string) => deleteConnections(new Set([connectionId])), [deleteConnections]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setExpandedImageNodeId(null);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
        setRenameDialog(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        abortGenerationForNodes();
        setNodes([]);
        setConnections([]);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setPreviewImageId(null);
        setSplitNodeId(null);
        setUpscaleNodeId(null);
        setRunningNodeIds(new Set());
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [abortGenerationForNodes, cleanupCanvasFiles, deselectCanvas, projectId]);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        const marker = `startclouds-canvas:${crypto.randomUUID()}`;
        clipboardRef.current = {
            marker,
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
        void navigator.clipboard?.writeText(marker).catch(() => undefined);
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const metadata = copyCanvasNodeMetadata(node.metadata, idMap);
            const groupId = node.metadata?.groupId;
            if (!groupId) return { ...node, metadata };
            return { ...node, metadata: { ...metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const worldX = node.position.x + node.width / 2;
            const worldY = node.position.y + node.height / 2;
            const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1);
            const target = { x: size.width / 2 - worldX * k, y: size.height / 2 - worldY * k, k };
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);

            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            viewportInteractingRef.current = true;
            const start = viewportApiRef.current?.get() || { ...viewportRef.current };
            const duration = 450;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const t = easeOutCubic(progress);
                const next = { x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: start.k + (target.k - start.k) * t };
                viewportRef.current = next;
                viewportApiRef.current?.apply(next, { commit: progress >= 1 });
                if (progress >= 1) setViewport(next);
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [size.height, size.width],
    );

    useEffect(() => () => void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)), []);

    const setZoomScale = useCallback(
        (scale: number, options?: { commit?: boolean }) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            const prev = viewportApiRef.current?.get() || viewportRef.current;
            const next = {
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            };
            viewportRef.current = next;
            viewportApiRef.current?.apply(next, { commit: options?.commit !== false, mode: "zoom" });
            if (options?.commit !== false) setContextMenu(null);
        },
        [size.height, size.width],
    );

    const flushPendingHistoryCommit = useCallback(() => {
        if (!historyCommitTimerRef.current) return;
        clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = null;
        const current = createHistoryEntry();
        const last = lastHistoryRef.current;
        if (!last) {
            lastHistoryRef.current = current;
            return;
        }
        if (last.nodes === current.nodes && last.connections === current.connections) return;
        historyRef.current.past = [...historyRef.current.past.slice(-49), last];
        historyRef.current.future = [];
        lastHistoryRef.current = current;
        setHistoryState({ canUndo: true, canRedo: false });
    }, [createHistoryEntry]);

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        flushPendingHistoryCommit();
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory, flushPendingHistoryCommit]);

    const redoCanvas = useCallback(() => {
        flushPendingHistoryCommit();
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory, flushPendingHistoryCommit]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));
        navigate(`/canvas/${id}`);
    }, [createProject, navigate, t]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error(t("canvas.projectPage.notFound"));
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            await exportCanvasProjects([project], project.title || t("canvas.title"));
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            setExpandedImageNodeId(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
            setEditingNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // Selection-only logic shared by the bubbling drag entry point and outer capture handler.
    // Returns the single target ID after the click, or null for multi-selection or deselection, to sync the toolbar.
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, []);

    // Capture-phase selection lets any inner element, including textarea or iframe, select the node and show its toolbar.
    // It only selects; body onMouseDown still starts dragging, so text selection inside editors does not drag the node.
    // Cache the capture result for the following bubbling drag handler to avoid applying shift-selection twice.
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            if (event.button !== 0) return;
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = nextSelected;
            if (isCanvasTextEditTarget(event.target)) {
                controlDragRef.current = null;
                return;
            }
            controlDragRef.current = isCanvasControlTarget(event.target)
                ? { nodeId, startX: event.clientX, startY: event.clientY, nextSelected }
                : null;
        },
        [selectNodeByEvent],
    );

    const beginNodeDrag = useCallback((origin: { clientX?: number; clientY?: number; startX?: number; startY?: number }, nodeId: string, selectedIds?: Set<string> | null) => {
        const currentNodes = nodesRef.current;
        const nextSelected = selectedIds ?? pendingSelectionRef.current ?? selectNodeByEvent({ shiftKey: false } as ReactMouseEvent, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: origin.startX ?? origin.clientX ?? 0,
            startY: origin.startY ?? origin.clientY ?? 0,
            initialPositionsById: new Map(currentNodes.filter((node) => dragIds.has(node.id)).map((node) => [node.id, node.position])),
        };

        const canvasElement = containerRef.current;
        dragNodeElementsRef.current.clear();
        canvasElement?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
            const elementNodeId = element.dataset.nodeId;
            if (!elementNodeId || !dragIds.has(elementNodeId)) return;
            element.style.willChange = "transform";
            dragNodeElementsRef.current.set(elementNodeId, element);
        });

        const affectedConnectionIds = new Set(connectionsRef.current.filter((connection) => dragIds.has(connection.fromNodeId) || dragIds.has(connection.toNodeId)).map((connection) => connection.id));
        const pathsByConnectionId = new Map<string, SVGPathElement[]>();
        canvasElement?.querySelectorAll<SVGPathElement>("[data-connection-path]").forEach((path) => {
            const connectionId = path.dataset.connectionPath;
            if (!connectionId || !affectedConnectionIds.has(connectionId)) return;
            const paths = pathsByConnectionId.get(connectionId);
            if (paths) paths.push(path);
            else pathsByConnectionId.set(connectionId, [path]);
        });
        dragConnectionDomRef.current = connectionsRef.current
            .filter((connection) => affectedConnectionIds.has(connection.id))
            .map((connection) => ({ connection, paths: pathsByConnectionId.get(connection.id) || [] }));
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, [selectNodeByEvent]);

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        if (isCanvasTextEditTarget(event.target) || isCanvasControlTarget(event.target)) return;
        beginNodeDrag(event, nodeId);
    }, [beginNodeDrag]);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) {
            controlDragRef.current = null;
            return;
        }

        const initialPositions = dragRef.current.initialPositionsById;
        const wasClick = !dragRef.current.hasMoved && initialPositions.size === 1;
        const clickedNodeId = initialPositions.keys().next().value;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        const shouldCommitMove = dragRef.current.hasMoved && clientX != null && clientY != null;
        if (shouldCommitMove) {
            const movedIds = new Set(initialPositions.keys());
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const finalIndex = buildCanvasSpatialIndex(moved);
                const movedPositions = new Map(moved.filter((node) => movedIds.has(node.id)).map((node) => [node.id, node.position]));
                const targetGroup = findIndexedGroupDropTarget(finalIndex, movedPositions, { x: 0, y: 0 });
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findIndexedContainingGroupId(finalIndex, node);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragNodeElementsRef.current.forEach((element, id) => {
            element.style.willChange = "";
            if (shouldCommitMove) return;
            const initial = initialPositions.get(id);
            if (initial) element.style.transform = `translate3d(${initial.x}px, ${initial.y}px, 0)`;
        });
        if (!shouldCommitMove) {
            dragConnectionDomRef.current.forEach(({ connection, paths }) => {
                const from = nodesByIdRef.current.get(connection.fromNodeId);
                const to = nodesByIdRef.current.get(connection.toNodeId);
                if (!from || !to) return;
                const pathD = canvasConnectionPathD(from, to);
                paths.forEach((path) => path.setAttribute("d", pathD));
            });
        }
        dragNodeElementsRef.current.clear();
        dragConnectionDomRef.current = [];

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialPositionsById = new Map();
        controlDragRef.current = null;
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedDefinition?.hidePanel) {
                // Clicking a display-only plugin node selects it without opening a lower panel.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            const pendingControlDrag = controlDragRef.current;
            if (pendingControlDrag && !dragRef.current.isDraggingNode) {
                if (Math.abs(event.clientX - pendingControlDrag.startX) > NODE_CONTROL_DRAG_THRESHOLD || Math.abs(event.clientY - pendingControlDrag.startY) > NODE_CONTROL_DRAG_THRESHOLD) {
                    beginNodeDrag(pendingControlDrag, pendingControlDrag.nodeId, pendingControlDrag.nextSelected);
                    dragRef.current.hasMoved = true;
                    suppressControlClickRef.current = true;
                    controlDragRef.current = null;
                }
            }

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                dragDeltaRef.current = { x: dx, y: dy };
                if (rafRef.current) return;
                rafRef.current = requestAnimationFrame(() => {
                    const initialPositions = dragRef.current.initialPositionsById;
                    const delta = dragDeltaRef.current;
                    initialPositions.forEach((position, id) => {
                        const element = dragNodeElementsRef.current.get(id);
                        if (element) element.style.transform = `translate3d(${position.x + delta.x}px, ${position.y + delta.y}px, 0)`;
                    });

                    const nodeAtLivePosition = (id: string) => {
                        const node = nodesByIdRef.current.get(id);
                        const initial = initialPositions.get(id);
                        return node && initial ? { ...node, position: { x: initial.x + delta.x, y: initial.y + delta.y } } : node;
                    };
                    dragConnectionDomRef.current.forEach(({ connection, paths }) => {
                        const from = nodeAtLivePosition(connection.fromNodeId);
                        const to = nodeAtLivePosition(connection.toNodeId);
                        if (!from || !to) return;
                        const pathD = canvasConnectionPathD(from, to);
                        paths.forEach((path) => path.setAttribute("d", pathD));
                    });

                    const nextGroupId = findIndexedGroupDropTarget(nodeSpatialIndex, initialPositions, delta)?.id || null;
                    setDropTargetGroupId((current) => (current === nextGroupId ? current : nextGroupId));
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                connectionPointerRef.current = { x: event.clientX, y: event.clientY };
                if (connectionRafRef.current) return;
                connectionRafRef.current = requestAnimationFrame(() => {
                    connectionRafRef.current = null;
                    const point = connectionPointerRef.current;
                    const currentConnection = connectingParamsRef.current;
                    if (!point || !currentConnection || pendingConnectionCreateRef.current) return;
                    const dropTarget = getConnectionDropTarget(point.x, point.y, currentConnection);
                    if (connectionTargetNodeIdRef.current !== dropTarget.nodeId) {
                        connectionTargetNodeIdRef.current = dropTarget.nodeId;
                        setConnectionTargetNodeId(dropTarget.nodeId);
                    }
                    setMouseWorld(screenToCanvas(point.x, point.y));
                });
            }
        },
        [beginNodeDrag, getConnectionDropTarget, nodeSpatialIndex, screenToCanvas],
    );

    const updateSelectionBoxAt = useCallback(
        (clientX: number, clientY: number) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;
            const world = screenToCanvas(clientX, clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodeSpatialIndex.queryRect({ left: rectX, top: rectY, right: rectX + rectW, bottom: rectY + rectH }).forEach((node) => {
                const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;
                if (intersects) nextSelected.add(node.id);
            });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            const rect = selectionRectRef.current;
            if (rect) {
                rect.setAttribute("x", String(rectX));
                rect.setAttribute("y", String(rectY));
                rect.setAttribute("width", String(rectW));
                rect.setAttribute("height", String(rectH));
            }
            if (!equalNodeIdSets(nextSelected, selectedNodeIdsRef.current)) setSelectedNodeIds(nextSelected);
        },
        [nodeSpatialIndex, screenToCanvas],
    );

    const finishSelectionBox = useCallback(
        (clientX?: number, clientY?: number) => {
            if (selectionRafRef.current) cancelAnimationFrame(selectionRafRef.current);
            selectionRafRef.current = null;
            selectionPointerRef.current = null;
            if (clientX != null && clientY != null) updateSelectionBoxAt(clientX, clientY);
            selectionBoxRef.current = null;
            setSelectionBox(null);
        },
        [updateSelectionBoxAt],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            if (!selectionBoxRef.current) return;
            if (event.buttons === 0) {
                finishSelectionBox();
                return;
            }
            selectionPointerRef.current = { x: event.clientX, y: event.clientY };
            if (selectionRafRef.current) return;
            selectionRafRef.current = requestAnimationFrame(() => {
                selectionRafRef.current = null;
                const point = selectionPointerRef.current;
                if (point) updateSelectionBoxAt(point.x, point.y);
            });
        },
        [finishSelectionBox, updateSelectionBoxAt],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            finishSelectionBox(event.clientX, event.clientY);
            if (connectionRafRef.current) cancelAnimationFrame(connectionRafRef.current);
            connectionRafRef.current = null;
            connectionPointerRef.current = null;

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, finishSelectionBox, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            finishSelectionBox(event.clientX, event.clientY);
        };
        const cancelCanvasInteraction = () => {
            finishNodeDrag();
            finishSelectionBox();
            if (connectingParamsRef.current) setConnecting(null);
        };
        const suppressControlClick = (event: MouseEvent) => {
            if (!suppressControlClickRef.current) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            suppressControlClickRef.current = false;
        };
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelCanvasInteraction);
        window.addEventListener("blur", cancelCanvasInteraction);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        window.addEventListener("click", suppressControlClick, true);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelCanvasInteraction);
            window.removeEventListener("blur", cancelCanvasInteraction);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
            window.removeEventListener("click", suppressControlClick, true);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (selectionRafRef.current) cancelAnimationFrame(selectionRafRef.current);
            if (connectionRafRef.current) cancelAnimationFrame(connectionRafRef.current);
        };
    }, [finishNodeDrag, finishSelectionBox, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove, setConnecting]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const size = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const pendingNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: { status: NODE_STATUS_LOADING, uploading: true },
        };
        setNodes((prev) => [...prev, pendingNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        try {
            const image = await uploadImage(file);
            setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, metadata: imageMetadata(image) } : node)));
            setDialogNodeId(id);
        } catch (error) {
            setNodes((prev) => prev.filter((node) => node.id !== id));
            setSelectedNodeIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            message.error(error instanceof Error ? error.message : t("common.imageReadFailed"));
        }
    }, [message, t]);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter, t],
    );

    useEffect(() => {
        if (!projectLoaded) return;
        const pending = takePendingPrompt("infinite_canvas");
        if (!pending?.prompt) return;
        createTextNodeFromClipboard(pending.prompt);
    }, [createTextNodeFromClipboard, projectLoaded]);

    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]")) return;
            const clipboard = event.clipboardData;
            if (!clipboard) return;
            const imageFile = Array.from(clipboard.items)
                .find((item) => item.kind === "file" && item.type.startsWith("image/"))
                ?.getAsFile();
            if (imageFile) {
                event.preventDefault();
                void createImageFileNode(imageFile, getCanvasCenter());
                message.success(t("canvas.projectPage.clipboardImageAdded"));
                return;
            }
            const text = clipboard.getData("text/plain");
            if (text && text === clipboardRef.current?.marker) {
                event.preventDefault();
                pasteCopiedNodes();
                return;
            }
            if (!text.trim()) return;
            event.preventDefault();
            if (createTextNodeFromClipboard(text)) message.success(t("canvas.projectPage.clipboardTextAdded"));
        };
        window.addEventListener("paste", handlePaste);
        return () => window.removeEventListener("paste", handlePaste);
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message, pasteCopiedNodes, t]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]"))
                return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionIds.size) {
                    deleteConnections(new Set(selectedConnectionIds));
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setRenameDialog(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
                setSplitNodeId(null);
                setUpscaleNodeId(null);
                setAngleNodeId(null);
                setPreviewNodeId(null);
                setPreviewImageId(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnections, deleteNodes, redoCanvas, selectedConnectionIds, setConnecting, undoCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        setIsNodeResizing(true);
        setExpandedImageNodeId(null);
    }, []);
    const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedImageNodeId((current) => (current === nodeId ? null : nodeId));
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, imageId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const image = node.metadata?.images?.find((item) => item.id === imageId);
                if (!image?.content) return node;
                const nextSize = node.metadata?.freeResize ? { width: node.width, height: node.height } : cardSizeForMedia(image.naturalWidth, image.naturalHeight);
                return {
                    ...node,
                    ...nextSize,
                    position: {
                        x: node.position.x + (node.width - nextSize.width) / 2,
                        y: node.position.y + (node.height - nextSize.height) / 2,
                    },
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const duplicateBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        const id = nanoid();
        const size = cardSizeForMedia(image.naturalWidth, image.naturalHeight);
        const copy: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: node.title,
            position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + node.height / 2 - size.height / 2 },
            ...size,
            metadata: {
                content: image.content,
                storageKey: image.storageKey,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                bytes: image.bytes,
                mimeType: image.mimeType,
                status: NODE_STATUS_SUCCESS,
                prompt: node.metadata?.prompt,
                generationType: node.metadata?.generationType,
                model: node.metadata?.model,
                size: node.metadata?.size,
                quality: node.metadata?.quality,
                background: node.metadata?.background,
                references: node.metadata?.references,
            },
        };
        setNodes((prev) => [...prev, copy]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const openNodeRename = useCallback((node: CanvasNodeData) => {
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setToolbarNodeId(node.id);
        setRenameDialog({ nodeId: node.id, title: node.title || "" });
    }, []);

    const saveNodeRename = useCallback(() => {
        if (!renameDialog) return;
        const current = nodesRef.current.find((node) => node.id === renameDialog.nodeId);
        const title = renameDialog.title.trim() || current?.title || t("canvas.node.untitled");
        setNodes((prev) => prev.map((node) => (node.id === renameDialog.nodeId ? { ...node, title } : node)));
        setRenameDialog(null);
    }, [renameDialog, t]);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const downloadBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        saveAs(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
    }, []);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error(t("canvas.projectPage.noTextToSave"));
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasText"), coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success(t("common.addedToAssets"));
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noVideoToSave"));
                addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasVideo"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success(t("common.addedToAssets"));
                return;
            }
            if (!node.metadata?.content) return message.error(t("canvas.projectPage.noImageToSave"));
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            await addSharedImage({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasImage"),
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success(t("common.addedToAssets"));
        },
        [addAsset, addSharedImage, message, t],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas.projectPage.emptyReverse"));
                return;
            }

            const gap = 96;
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const configNode = {
                ...createCanvasNode(
                    CanvasOperationNodeType.ReversePrompt,
                    { x: node.position.x + node.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: t("canvas.projectPage.reversePreset"),
                    },
                ),
                title: t("canvas.operationNodes.reversePrompt"),
            };

            setNodes((prev) => [...prev, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message, t],
    );

    const createReusableImageOperationNode = useCallback(
        (
            sourceNode: CanvasNodeData,
            operation: CanvasLocalImageOperation,
            params: CanvasImageCropRect | CanvasImageSplitParams | CanvasImageUpscaleParams,
            title: string,
        ) => {
            if (!sourceNode.metadata?.content) return;
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const operationNode = {
                ...createCanvasNode(
                    canvasNodeTypeForLocalImageOperation(operation),
                    {
                        x: sourceNode.position.x + sourceNode.width + 96 + spec.width / 2,
                        y: sourceNode.position.y + sourceNode.height / 2,
                    },
                    {
                        generationMode: "image",
                        count: canvasLocalImageOperationOutputCount(operation, params),
                        status: NODE_STATUS_IDLE,
                        localImageOperation: operation,
                        localImageOperationParams: { ...params },
                    },
                ),
                title,
            } satisfies CanvasNodeData;
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: operationNode.id };
            const nextNodes = [...nodesRef.current, operationNode];
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([operationNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(operationNode.id);
            queueMicrotask(() => void generateNodeRef.current?.(operationNode.id, "image", ""));
        },
        [],
    );

    const cropImageNode = useCallback(
        (node: CanvasNodeData, crop: CanvasImageCropRect) => {
            setCropNodeId(null);
            createReusableImageOperationNode(node, "crop", crop, t("canvas.operationNodes.crop"));
        },
        [createReusableImageOperationNode, t],
    );

    const splitImageNode = useCallback(
        (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            setSplitNodeId(null);
            createReusableImageOperationNode(node, "split", params, t("canvas.operationNodes.split"));
        },
        [createReusableImageOperationNode, t],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!(await requestCostConfirm({ config: generationConfig, kind: "image", count: 1 }))) return;
            const userPrompt = payload.prompt.trim();
            const prompt = t("canvas.projectPage.maskPrompt", { prompt: userPrompt });
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeIds((current) => new Set(current).add(childId));
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || t("canvas.projectPage.maskResult"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl }, { signal: controller.signal, onCreated: (taskId) => persistCanvasTaskId(childId, taskId), idempotencyKey: canvasManualTaskKey(projectId, childId, createCanvasTaskNonce()) }).then((items) => items[0]);
                const uploaded = await adoptGeneratedImage(image);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.maskFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeIds((current) => {
                    const next = new Set(current);
                    next.delete(childId);
                    return next;
                });
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, persistCanvasTaskId, projectId, requestCostConfirm, startGenerationRequest, t],
    );

    const upscaleImageNode = useCallback(
        (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
            setUpscaleNodeId(null);
            createReusableImageOperationNode(node, "upscale", params, t("canvas.operationNodes.upscale"));
        },
        [createReusableImageOperationNode, t],
    );

    const removeBackgroundFromImageNode = useCallback(
        async (node: CanvasNodeData) => {
            if (!node.metadata?.content) return;
            const generationConfig = applyCanvasImageModelSettings(
                { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", background: "transparent" },
                modelOptionMeta(effectiveConfig, resolveModelForCapability(effectiveConfig, node.metadata?.model, "image")),
            );
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                setSelectedNodeIds(new Set([node.id]));
                setSelectedConnectionId(null);
                openConfigDialog(true);
                message.warning(t("canvas.workflow.modelUnavailable", { name: node.title || t("canvas.node.untitled") }));
                return;
            }
            if (generationConfig.background !== "transparent") {
                message.warning(t("canvas.imageTools.removeBackgroundUnavailable"));
                return;
            }
            if (!(await requestCostConfirm({ config: generationConfig, kind: "image", count: 1 }))) return;
            const childId = nanoid();
            const prompt = t("canvas.imageTools.removeBackgroundPrompt");
            const source: ReferenceImage = {
                id: node.id,
                name: `${node.title || node.id}.png`,
                type: node.metadata.mimeType || "image/png",
                dataUrl: node.metadata.content,
                storageKey: node.metadata.storageKey,
            };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setRunningNodeIds((current) => new Set(current).add(childId));
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: `${node.title || t("canvas.node.untitled")} - ${t("canvas.imageTools.removeBackground")}`,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], undefined, {
                    signal: controller.signal,
                    onCreated: (taskId) => persistCanvasTaskId(childId, taskId),
                    idempotencyKey: canvasManualTaskKey(projectId, childId, createCanvasTaskNonce()),
                }).then((items) => items[0]);
                const uploaded = await adoptGeneratedImage(image);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
                message.success(t("canvas.projectPage.backgroundRemoved"));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.backgroundRemoveFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeIds((current) => {
                    const next = new Set(current);
                    next.delete(childId);
                    return next;
                });
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, persistCanvasTaskId, projectId, requestCostConfirm, startGenerationRequest, t],
    );

    const generateAngleNode = useCallback(
        (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const configNode = {
                ...createCanvasNode(
                    CanvasOperationNodeType.Angle,
                    { x: node.position.x + node.width + 96 + spec.width / 2, y: node.position.y + node.height / 2 },
                    {
                        generationMode: "image",
                        composerContent: prompt,
                        prompt,
                        imageAngleParams: { ...params },
                        model: generationConfig.model,
                        size: generationConfig.size,
                        resolution: generationConfig.resolution,
                        quality: generationConfig.quality,
                        background: generationConfig.background,
                        count: 1,
                        status: NODE_STATUS_IDLE,
                    },
                ),
                title: `${t("canvas.operationNodes.angle")} · ${title}`,
            } satisfies CanvasNodeData;
            const connection = { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id };
            const nextNodes = [...nodesRef.current, configNode];
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setAngleNodeId(null);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            queueMicrotask(() => void generateNodeRef.current?.(configNode.id, "image", prompt));
        },
        [effectiveConfig, t],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter(isAcceptedCanvasFile);
            if (!files.length) {
                uploadTargetRef.current = null;
                event.target.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition = target?.position || getCanvasCenter();
            const STAGGER = 40; // 多文件时的偏移间距

            try {
            // When replacing a target node, use the first file as the replacement and create the rest nearby.
            if (target?.nodeId) {
                const [first, ...rest] = files;

                // Replace the target node with the first file.
                if (isAudioFile(first)) {
                    const audio = await uploadMediaFile(first, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else if (first.type.startsWith("video/")) {
                    const video = await uploadMediaFile(first, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else {
                    const previousNode = nodesRef.current.find((node) => node.id === target.nodeId);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? { ...node, title: first.name, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, uploading: true, errorDetails: undefined } }
                                : node,
                        ),
                    );
                    try {
                        const image = await uploadImage(first);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Image,
                                          title: first.name,
                                          metadata: {
                                              ...node.metadata,
                                              ...imageMetadata(image),
                                              uploading: undefined,
                                              errorDetails: undefined,
                                              freeResize: false,
                                              images: undefined,
                                              generationType: undefined,
                                              model: undefined,
                                              size: undefined,
                                              quality: undefined,
                                              count: undefined,
                                              references: undefined,
                                              primaryImageId: undefined,
                                          },
                                      }
                                    : node,
                            ),
                        );
                    } catch (error) {
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId && node.metadata?.uploading
                                    ? { ...node, title: previousNode?.title || node.title, metadata: previousNode?.metadata }
                                    : node,
                            ),
                        );
                        throw error;
                    }
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                }

                // Create the remaining files near the target node.
                for (let i = 0; i < rest.length; i++) {
                    const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                    const f = rest[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            } else {
                // Without a replacement target, create all files near the canvas center.
                for (let i = 0; i < files.length; i++) {
                    const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                    const f = files[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            }
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("common.imageReadFailed"));
            } finally {
                uploadTargetRef.current = null;
                event.target.value = "";
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, getCanvasCenter, message, t],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const dropped = Array.from(event.dataTransfer.files);
            const files = dropped.filter(isAcceptedCanvasFile);
            if (!files.length) {
                if (dropped.some((item) => item.type.startsWith("video/") || isAudioFile(item))) message.warning(t("canvas.projectPage.mediaUnavailable"));
                return;
            }

            const basePos = screenToCanvas(event.clientX, event.clientY);
            const STAGGER = 40;
            for (let i = 0; i < files.length; i++) {
                const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                const f = files[i];
                if (isAudioFile(f)) {
                    void createAudioFileNode(f, pos);
                } else if (f.type.startsWith("video/")) {
                    void createVideoFileNode(f, pos);
                } else {
                    void createImageFileNode(f, pos);
                }
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, message, screenToCanvas, t],
    );

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id],[data-connection-id]")) return;
        event.preventDefault();
        setContextMenu(null);
        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
    }, [screenToCanvas]);

    const markGenerationStarted = useCallback((nodeId: string) => {
        const startedAt = new Date().toISOString();
        setNodes((current) =>
            current.map((node) =>
                node.id === nodeId
                    ? {
                          ...node,
                          metadata: {
                              ...node.metadata,
                              executionStatus: "running",
                              generationStartedAt: node.metadata?.executionStatus === "running" && node.metadata.generationStartedAt ? node.metadata.generationStartedAt : startedAt,
                              generationCompletedAt: undefined,
                              generationDurationMs: undefined,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const markGenerationFinished = useCallback((nodeId: string) => {
        const completedAt = new Date();
        setNodes((current) =>
            current.map((node) => {
                if (node.id !== nodeId || node.metadata?.executionStatus !== "running") return node;
                const startedAt = node.metadata.generationStartedAt ? new Date(node.metadata.generationStartedAt) : completedAt;
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        executionStatus: node.metadata.status === NODE_STATUS_SUCCESS ? "succeeded" : "failed",
                        generationCompletedAt: completedAt.toISOString(),
                        generationDurationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
                    },
                };
            }),
        );
    }, []);

    const runLocalImageOperation = useCallback(
        async (operationNode: CanvasNodeData, options: { workflowRunId?: string } = {}) => {
            const operation = operationNode.metadata?.localImageOperation;
            if (!isCanvasLocalImageOperation(operation)) return false;
            const imageInputs = buildNodeGenerationInputs(operationNode.id, nodesRef.current, connectionsRef.current).filter((item) => Boolean(item.image));
            const input = imageInputs[0]?.image;
            if (!input || imageInputs.length !== 1) {
                const errorDetails = imageInputs.length > 1 ? t("canvas.configNode.singleImageOnly") : t("canvas.workflow.localImageInputMissing");
                const completedAt = new Date().toISOString();
                commitNodes((current) => current.map((node) => (node.id === operationNode.id ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, executionStatus: "failed", generationCompletedAt: completedAt, generationDurationMs: 0, errorDetails } } : node)));
                return false;
            }

            const params = normalizeCanvasLocalImageOperationParams(operation, operationNode.metadata?.localImageOperationParams);
            const outputCount = canvasLocalImageOperationOutputCount(operation, params);
            const ownedOutputs = findWorkflowOutputNodes(operationNode.id, CanvasNodeType.Image, nodesRef.current, connectionsRef.current);
            const existingOutputs = ownedOutputs.slice(0, outputCount);
            const obsoleteOutputIds = new Set(ownedOutputs.slice(outputCount).map((node) => node.id));
            const existingIds = existingOutputs.map((node) => node.id);
            const outputIds = [...existingIds, ...Array.from({ length: Math.max(0, outputCount - existingIds.length) }, () => nanoid())];
            const outputSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const splitParams = operation === "split" ? normalizeCanvasLocalImageOperationParams("split", params) : null;
            const columns = splitParams?.columns || 1;
            const rows = splitParams?.rows || 1;
            const gap = 24;
            const outputWidth = operation === "split" ? Math.max(180, Math.min(280, outputSpec.width / Math.max(1, Math.sqrt(columns)))) : outputSpec.width;
            const outputHeight = operation === "split" ? Math.max(180, Math.min(320, outputSpec.height / Math.max(1, Math.sqrt(rows)))) : outputSpec.height;
            const startX = operationNode.position.x + operationNode.width + 96;
            const startY = operationNode.position.y + operationNode.height / 2 - ((rows * outputHeight + (rows - 1) * gap) / 2);
            const startedAt = new Date().toISOString();
            const newOutputNodes = outputIds
                .filter((id) => !existingIds.includes(id))
                .map((id) => {
                    const index = outputIds.indexOf(id);
                    const row = Math.floor(index / columns);
                    const column = index % columns;
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: operation === "split" ? t("canvas.projectPage.splitTitle", { name: input.name || t("assets.kinds.image"), row: row + 1, column: column + 1 }) : t("canvas.projectPage.localOperationResult", { operation: t(`canvas.imageTools.${operation}`) }),
                        position: { x: startX + column * (outputWidth + gap), y: startY + row * (outputHeight + gap) },
                        width: outputWidth,
                        height: outputHeight,
                        metadata: {
                            status: NODE_STATUS_LOADING,
                            prompt: operationNode.title,
                            workflowProducerNodeId: operationNode.id,
                            localImageOperation: operation,
                            localImageOperationParams: { ...params },
                            generationStartedAt: startedAt,
                        },
                    } satisfies CanvasNodeData;
                });

            setRunningNodeIds((current) => new Set(current).add(operationNode.id));
            markGenerationStarted(operationNode.id);
            const controller = startGenerationRequest(operationNode.id, operationNode.id, operationNode.id);
            outputIds.forEach((id) => startGenerationRequest(id, operationNode.id, operationNode.id, controller));
            commitNodes((current) => [
                ...current.filter((node) => !obsoleteOutputIds.has(node.id)).map((node) => {
                    if (node.id === operationNode.id) {
                        return {
                            ...node,
                            metadata: {
                                ...node.metadata,
                                count: outputCount,
                                workflowOutputNodeIds: outputIds,
                                status: NODE_STATUS_LOADING,
                                errorDetails: undefined,
                                localImageOperationCompletedCount: 0,
                            },
                        };
                    }
                    if (!existingIds.includes(node.id)) return node;
                    const index = outputIds.indexOf(node.id);
                    const row = Math.floor(index / columns);
                    const column = index % columns;
                    return {
                        ...node,
                        position: { x: startX + column * (outputWidth + gap), y: startY + row * (outputHeight + gap) },
                        width: outputWidth,
                        height: outputHeight,
                        metadata: {
                            ...node.metadata,
                            status: NODE_STATUS_LOADING,
                            errorDetails: undefined,
                            workflowProducerNodeId: operationNode.id,
                            localImageOperation: operation,
                            localImageOperationParams: { ...params },
                            generationStartedAt: startedAt,
                            generationCompletedAt: undefined,
                            generationDurationMs: undefined,
                        },
                    };
                }),
                ...newOutputNodes,
            ]);
            const newConnections = outputIds
                .filter((outputId) => !connectionsRef.current.some((connection) => connection.fromNodeId === operationNode.id && connection.toNodeId === outputId))
                .map((outputId) => ({ id: nanoid(), fromNodeId: operationNode.id, toNodeId: outputId }));
            if (newConnections.length || obsoleteOutputIds.size) {
                const nextConnections = [
                    ...connectionsRef.current.filter((connection) => !obsoleteOutputIds.has(connection.fromNodeId) && !obsoleteOutputIds.has(connection.toNodeId)),
                    ...newConnections,
                ];
                connectionsRef.current = nextConnections;
                setConnections(nextConnections);
            }

            try {
                const hydrated = await hydrateNodeGenerationContext({ prompt: "", referenceImages: [input], referenceVideos: [], referenceAudios: [], textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0 });
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const sourceDataUrl = hydrated.referenceImages[0]?.dataUrl;
                if (!sourceDataUrl) throw new Error(t("canvas.workflow.localImageInputMissing"));
                let pieces: Array<{ dataUrl: string }>;
                if (operation === "crop") {
                    pieces = [{ dataUrl: await cropDataUrl(sourceDataUrl, normalizeCanvasLocalImageOperationParams("crop", params)) }];
                } else if (operation === "upscale") {
                    const upscaleParams = normalizeCanvasLocalImageOperationParams("upscale", params);
                    const sourceSize = await readImageMeta(sourceDataUrl);
                    pieces = [{ dataUrl: Math.max(sourceSize.width, sourceSize.height) >= upscaleParams.targetLongEdge ? sourceDataUrl : await upscaleDataUrl(sourceDataUrl, upscaleParams) }];
                } else {
                    pieces = await splitDataUrl(sourceDataUrl, normalizeCanvasLocalImageOperationParams("split", params));
                }
                if (pieces.length !== outputIds.length) throw new Error(t("canvas.workflow.localOutputCountMismatch"));

                const failures: string[] = [];
                let cursor = 0;
                const uploadNext = async () => {
                    while (cursor < pieces.length) {
                        const index = cursor++;
                        const outputId = outputIds[index];
                        try {
                            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                            const uploaded = await uploadImage(pieces[index].dataUrl);
                            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                            const completedAt = new Date();
                            commitNodes((current) =>
                                current.map((node) => {
                                    if (node.id === operationNode.id) {
                                        return { ...node, metadata: { ...node.metadata, localImageOperationCompletedCount: Math.min(outputCount, (node.metadata?.localImageOperationCompletedCount || 0) + 1) } };
                                    }
                                    if (node.id !== outputId) return node;
                                    const imageSize = operation === "split" ? { width: node.width, height: node.height } : resultNodeSize(node, uploaded.width, uploaded.height);
                                    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                    return {
                                        ...node,
                                        ...imageSize,
                                        position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                        metadata: {
                                            ...node.metadata,
                                            ...imageMetadata(uploaded),
                                            workflowProducerNodeId: operationNode.id,
                                            localImageOperation: operation,
                                            localImageOperationParams: { ...params },
                                            generationCompletedAt: completedAt.toISOString(),
                                            generationDurationMs: Math.max(0, completedAt.getTime() - new Date(startedAt).getTime()),
                                        },
                                    };
                                }),
                            );
                        } catch (error) {
                            if (isGenerationCanceled(error)) throw error;
                            const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.localOperationFailed", { operation: t(`canvas.imageTools.${operation}`) });
                            failures.push(errorDetails);
                            commitNodes((current) => current.map((node) => (node.id === outputId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                        }
                    }
                };
                await Promise.all(Array.from({ length: Math.min(4, pieces.length) }, () => uploadNext()));
                if (failures.length) throw new Error(failures[0]);
                commitNodes((current) => current.map((node) => (node.id === operationNode.id ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined, localImageOperationCompletedCount: outputCount } } : node)));
                if (!options.workflowRunId) message.success(t("canvas.projectPage.localOperationCompleted", { operation: t(`canvas.imageTools.${operation}`), count: outputIds.length }));
                return true;
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([operationNode.id, ...outputIds]));
                    return false;
                }
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.localOperationFailed", { operation: t(`canvas.imageTools.${operation}`) });
                commitNodes((current) =>
                    current.map((node) =>
                        node.id === operationNode.id || (outputIds.includes(node.id) && node.metadata?.status === NODE_STATUS_LOADING)
                            ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }
                            : node,
                    ),
                );
                if (!options.workflowRunId) message.error(errorDetails);
                return false;
            } finally {
                finishGenerationRequest(operationNode.id, controller);
                outputIds.forEach((id) => finishGenerationRequest(id, controller));
                markGenerationFinished(operationNode.id);
                setRunningNodeIds((current) => {
                    const next = new Set(current);
                    next.delete(operationNode.id);
                    return next;
                });
            }
        },
        [commitNodes, finalizeCanceledGenerationNodes, finishGenerationRequest, markGenerationFinished, markGenerationStarted, message, startGenerationRequest, t],
    );

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options: { skipCostConfirm?: boolean; workflowRunId?: string; taskKeySalt?: string } = {}) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (options.workflowRunId && (workflowRunRef.current.cancelQueued || workflowRunRef.current.canceledNodeIds.has(nodeId))) return false;
            if (sourceNode && isCanvasLocalImageOperation(sourceNode.metadata?.localImageOperation)) return runLocalImageOperation(sourceNode, options);
            if (sourceNode && (sourceNode.type === CanvasOperationNodeType.Angle || sourceNode.type === CanvasOperationNodeType.ReversePrompt)) {
                const imageCount = getInputSummary(buildNodeGenerationInputs(nodeId, nodesRef.current, connectionsRef.current)).imageCount;
                if (imageCount !== 1) {
                    const errorDetails = imageCount > 1 ? t("canvas.configNode.singleImageOnly") : t("canvas.workflow.localImageInputMissing");
                    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, executionStatus: "failed", generationCompletedAt: new Date().toISOString(), generationDurationMs: 0, errorDetails } } : node)));
                    return false;
                }
            }
            if (!isCanvasGenerationModeEnabled(mode)) {
                message.warning(t("canvas.projectPage.mediaUnavailable"));
                return false;
            }
            // Deterministic idempotency keys: workflow executions derive them from
            // the run id (stable across crash-resume replays, so a resubmission
            // returns the already-created task instead of billing a second one);
            // manual generations mint one nonce per explicit user click and reuse
            // it for every task; Agent batches provide a stable salt so reconnect
            // replay returns the original task instead of billing again.
            const workflowRunId = options.workflowRunId;
            const generationNonce = options.taskKeySalt || createCanvasTaskNonce();
            const taskIdempotencyKey = (imageIndexOrId: number | string) => {
                if (!workflowRunId) return canvasManualTaskKey(projectId, nodeId, generationNonce, imageIndexOrId);
                const slot = options.taskKeySalt ? `${options.taskKeySalt}:${imageIndexOrId}` : imageIndexOrId;
                return canvasWorkflowTaskKey(workflowRunId, nodeId, slot);
            };
            const guardWorkflowSubmit = workflowRunId
                ? () => {
                      // The run was stopped or its lease was lost while this task
                      // waited for a concurrency slot: skip the submission.
                      if (workflowRunRef.current.cancelQueued || workflowRunRef.current.lockLost || workflowRunRef.current.canceledNodeIds.has(nodeId)) throw new DOMException("Aborted", "AbortError");
                  }
                : undefined;
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            const billedCount = builtinPanel?.writeBackToSelf ? 1 : mode === "image" || (mode === "text" && isCanvasExecutableNode(sourceNode)) ? getGenerationCount(generationConfig.count) : 1;
            if (!options.skipCostConfirm && !(await requestCostConfirm({ config: generationConfig, kind: mode === "text" ? "text" : "image", count: billedCount }))) return false;
            if ((mode === "video" || mode === "audio") && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return false;
            }

            // useBuiltinPanel.writeBackToSelf reuses built-in generation while writing the result back to the plugin node.
            // Image mode currently supports display-only nodes such as panoramas, with a useBuiltinPanel.promptPrefix.
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return false;
                markGenerationStarted(nodeId);
                setRunningNodeIds((current) => new Set(current).add(nodeId));
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    // Upstream image nodes become references; without them this is text-to-image.
                    const upstreamNodes = connectionsRef.current
                        .filter((conn) => conn.toNodeId === nodeId)
                        .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                        .filter((node): node is CanvasNodeData => Boolean(node));
                    const refs = upstreamNodes.flatMap((up) =>
                        typeof up.metadata?.content === "string" && up.metadata.content && up.type !== sourceNode.type
                            ? [{ id: up.id, name: `${up.title || up.id}.png`, type: up.metadata.mimeType || "image/png", dataUrl: up.metadata.content, storageKey: up.metadata.storageKey }]
                            : [],
                    );
                    const builtinRequestOptions = {
                        signal: controller.signal,
                        onCreated: (taskId: string) => persistCanvasTaskId(nodeId, taskId),
                        idempotencyKey: taskIdempotencyKey(0),
                        onBeforeCreate: guardWorkflowSubmit,
                    };
                    const image = refs.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, fullPrompt, refs, undefined, builtinRequestOptions).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, fullPrompt, builtinRequestOptions).then((items) => items[0]);
                    const uploaded = await adoptGeneratedImage(image);
                    setNodes((prev) =>
                        prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)),
                    );
                    setDialogNodeId(null);
                    return true;
                } catch (error) {
                    if (isGenerationCanceled(error)) {
                        if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([nodeId]));
                    } else {
                        const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                    return false;
                } finally {
                    finishGenerationRequest(nodeId, controller);
                    markGenerationFinished(nodeId);
                    setRunningNodeIds((current) => {
                        const next = new Set(current);
                        next.delete(nodeId);
                        return next;
                    });
                }
            }

            setRunningNodeIds((current) => new Set(current).add(nodeId));
            markGenerationStarted(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            let pendingChildIds: string[] = [];
            try {
                const generationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? t("canvas.projectPage.editTextPrompt", { source: sourceTextContent, prompt }) : prompt),
                );
                const effectivePrompt = generationContext.prompt.trim();
                if (runController.signal.aborted || (workflowRunId && (workflowRunRef.current.cancelQueued || workflowRunRef.current.canceledNodeIds.has(nodeId)))) {
                    if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([nodeId]));
                    return false;
                }
                if (!effectivePrompt && (mode === "text" || mode === "audio")) return false;
                if (markSourceStatus)
                    setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...(isCanvasExecutableNode(node) ? {} : { prompt }), status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = isCanvasExecutableNode(sourceNode);
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const reusableRoot = isConfigNode ? findWorkflowOutputNodes(nodeId, CanvasNodeType.Image, nodesRef.current, connectionsRef.current)[0] : undefined;
                    const rootId = isEmptyImageNode ? nodeId : reusableRoot?.id || nanoid();
                    const isNewRoot = !isEmptyImageNode && !reusableRoot;
                    const imageIds = Array.from({ length: count }, () => nanoid());
                    pendingChildIds = [rootId];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: reusableRoot?.title || effectivePrompt.slice(0, 32) || "Generated Image",
                        position: reusableRoot?.position || {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: reusableRoot?.width || (isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width),
                        height: reusableRoot?.height || (isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height),
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            images: imageIds.map((id) => ({ id, status: NODE_STATUS_LOADING, content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" })),
                            ...(isConfigNode ? { workflowProducerNodeId: nodeId } : {}),
                            ...generationMetadata,
                            generationStartedAt: nodesRef.current.find((item) => item.id === nodeId)?.metadata?.generationStartedAt || new Date().toISOString(),
                            generationCompletedAt: undefined,
                            generationDurationMs: undefined,
                        },
                    };

                    setNodes((prev) => {
                        const next = prev.map((node) => {
                            if (node.id === rootId && reusableRoot) return { ...node, ...rootNode, metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined } };
                            if (node.id !== nodeId) return node;
                            if (isConfigNode)
                                return {
                                    ...node,
                                    metadata: { ...node.metadata, workflowOutputNodeIds: [rootId], status: NODE_STATUS_LOADING, errorDetails: undefined },
                                };
                            if (isEmptyImageNode)
                                return {
                                    ...node,
                                    position: rootNode.position,
                                    width: rootNode.width,
                                    height: rootNode.height,
                                    title: rootNode.title,
                                    metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                };
                            if (isImageNode) return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } };
                            return {
                                ...node,
                                type: CanvasNodeType.Text,
                                title: prompt.slice(0, 32) || "Prompt",
                                width: parentConfig.width,
                                height: parentConfig.height,
                                metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                            };
                        });
                        return isNewRoot ? [...next, rootNode] : next;
                    });
                    if (!isEmptyImageNode)
                        setConnections((prev) =>
                            prev.some((connection) => connection.fromNodeId === nodeId && connection.toNodeId === rootId) ? prev : [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }],
                        );
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstError = "";
                    const applyPreview = async (imageId: string, image: { dataUrl: string; storageKey?: string }) => {
                        const uploaded = await adoptGeneratedImage(image);
                        if (controller.signal.aborted) return uploaded;
                        setNodes((prev) => prev.map((node) => (node.id === rootId ? applyUploadedImageToNode(node, uploaded, imageId) : node)));
                        return uploaded;
                    };
                    await Promise.all(
                        imageIds.map(async (imageId, imageIndex) => {
                            try {
                                const requestOptions = {
                                    signal: controller.signal,
                                    onCreated: (taskId: string) => persistCanvasTaskId(rootId, taskId, imageId),
                                    onResolved: async (items: Array<{ dataUrl: string; storageKey?: string }>) => {
                                        if (items[0]?.dataUrl || items[0]?.storageKey) await applyPreview(imageId, items[0]);
                                    },
                                    idempotencyKey: taskIdempotencyKey(imageIndex),
                                    onBeforeCreate: guardWorkflowSubmit,
                                };
                                const image = referenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, requestOptions).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, requestOptions).then((items) => items[0]);
                                await applyPreview(imageId, image);
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                if (!firstError) firstError = errorDetails;
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, images: node.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : node)));
                            }
                            return false;
                        }),
                    );
                    if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([rootId, nodeId]));
                        return false;
                    }
                    if (hasFailure && hasSuccess) {
                        message.error(t("canvas.projectPage.partialFailed"));
                    }
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : firstError || t("canvas.projectPage.generationFailed") } }
                                : node.id === rootId
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : firstError || t("canvas.projectPage.allFailed") } }
                                    : node,
                        ),
                    );
                    return hasSuccess;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            references: generationReferenceUrls(generationContext),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isEmptyVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const video = await storeGeneratedVideo(
                            await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: controller.signal }),
                        );
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...node.metadata,
                                              ...videoMetadata(video),
                                              prompt: effectivePrompt,
                                              model: generationConfig.model,
                                              size: generationConfig.size,
                                              seconds: generationConfig.videoSeconds,
                                              vquality: generationConfig.vquality,
                                              generateAudio: generationConfig.videoGenerateAudio,
                                              watermark: generationConfig.videoWatermark,
                                              references: generationReferenceUrls(generationContext),
                                          },
                                      }
                                    : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return true;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return true;
                }

                const isConfigNode = isCanvasExecutableNode(sourceNode);
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const reusableTextOutputs = isConfigNode ? findWorkflowOutputNodes(nodeId, CanvasNodeType.Text, nodesRef.current, connectionsRef.current).slice(0, textCount) : [];
                const reusedChildIds = reusableTextOutputs.map((node) => node.id);
                const newChildIds = isConfigNode || editingTextNode ? Array.from({ length: Math.max(0, textCount - reusedChildIds.length) }, () => nanoid()) : [];
                const childIds = [...reusedChildIds, ...newChildIds];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = newChildIds.map((id) => {
                        const index = childIds.indexOf(id);
                        return {
                            id,
                            type: CanvasNodeType.Text,
                            title: effectivePrompt.slice(0, 32) || "Generated Text",
                            position: {
                                x: parentPosition.x + parentConfig.width + 96,
                                y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                            },
                            width: textConfig.width,
                            height: textConfig.height,
                            metadata: {
                                prompt: effectivePrompt,
                                status: NODE_STATUS_LOADING,
                                fontSize: 14,
                                model: generationConfig.model,
                                reasoningEffort: generationConfig.reasoningEffort,
                                ...(isConfigNode ? { workflowProducerNodeId: nodeId } : {}),
                            },
                        } satisfies CanvasNodeData;
                    });
                    setNodes((prev) => [
                        ...prev.map((node) => {
                            if (node.id === nodeId && isConfigNode)
                                return { ...node, metadata: { ...node.metadata, workflowOutputNodeIds: childIds, status: NODE_STATUS_LOADING, errorDetails: undefined } };
                            if (reusedChildIds.includes(node.id))
                                return {
                                    ...node,
                                    metadata: {
                                        ...node.metadata,
                                        prompt: effectivePrompt,
                                        status: NODE_STATUS_LOADING,
                                        errorDetails: undefined,
                                        model: generationConfig.model,
                                        reasoningEffort: generationConfig.reasoningEffort,
                                        workflowProducerNodeId: nodeId,
                                    },
                                };
                            return node;
                        }),
                        ...childNodes,
                    ]);
                    if (newChildIds.length)
                        setConnections((prev) => [...prev, ...newChildIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        let localStreamed = "";
                        return requestImageQuestion(
                            generationConfig,
                            buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                            (text) => {
                                localStreamed = text;
                                if (isConfigNode) return;
                                setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                            },
                            { signal: controller.signal, onCreated: (taskId) => persistCanvasTaskId(targetNodeId, taskId, undefined, "assistant") },
                        )
                            .then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed }))
                            .finally(() => finishGenerationRequest(targetNodeId, controller));
                    }),
                );
                if (controller.signal.aborted) {
                    if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([nodeId, ...textTargetIds]));
                    return false;
                }
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || "", status: NODE_STATUS_SUCCESS, taskId: undefined, taskKind: undefined } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Text,
                                      title: prompt.slice(0, 32) || "Generated Text",
                                      metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || "", model: generationConfig.model, reasoningEffort: generationConfig.reasoningEffort, status: NODE_STATUS_SUCCESS, taskId: undefined, taskKind: undefined },
                                  }
                                : node,
                    ),
                );
                return true;
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([nodeId, ...pendingChildIds]));
                    return false;
                }
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
                return false;
            } finally {
                finishGenerationRequest(nodeId, runController);
                markGenerationFinished(nodeId);
                setRunningNodeIds((current) => {
                    const next = new Set(current);
                    next.delete(nodeId);
                    return next;
                });
            }
        },
        [effectiveConfig, finalizeCanceledGenerationNodes, finishGenerationRequest, isAiConfigReady, markGenerationFinished, markGenerationStarted, message, openConfigDialog, persistCanvasTaskId, projectId, requestCostConfirm, runLocalImageOperation, startGenerationRequest, t],
    );

    const persistWorkflowCheckpoint = useCallback(
        async (checkpoint: CanvasWorkflowCheckpoint | null) => {
            workflowCheckpointRef.current = checkpoint;
            updateProject(projectId, {
                workflowRun: checkpoint,
                nodes: nodesRef.current,
                connections: connectionsRef.current,
            });
            await flushCanvasPersistence();
        },
        [projectId, updateProject],
    );

    const presentWorkflowTerminal = useCallback(
        async (state: CanvasWorkflowRunState, checkpoint: CanvasWorkflowCheckpoint | null = null) => {
            const task = (async () => {
                const { persistenceError } = await settleCanvasWorkflowTerminal({
                    persist: () => persistWorkflowCheckpoint(checkpoint),
                    release: releaseWorkflowBrowserLock,
                    present: () => {
                        workflowRunRef.current.executing = false;
                        setWorkflowRun(state);
                    },
                });
                if (!persistenceError) return;
                message.warning(t("canvas.workflow.terminalPersistenceFailed"));
                window.setTimeout(() => {
                    void flushCanvasPersistence().catch(() => undefined);
                }, 1_200);
            })();
            workflowTerminalPromiseRef.current = task;
            try {
                await task;
            } finally {
                if (workflowTerminalPromiseRef.current === task) workflowTerminalPromiseRef.current = null;
            }
        },
        [message, persistWorkflowCheckpoint, releaseWorkflowBrowserLock, t],
    );

    const cancelDurableWorkflowRun = useCallback(
        async (checkpoint: CanvasWorkflowCheckpoint) => {
            if (!checkpoint.runId) return;
            try {
                await updateCanvasWorkflowRun(projectId, checkpoint.runId, {
                    ownerId: workflowOwnerId,
                    status: "canceled",
                    completedNodeIds: checkpoint.completedNodeIds,
                    canceledNodeIds: checkpoint.canceledNodeIds,
                    currentNodeId: checkpoint.currentNodeId,
                });
            } catch (error) {
                try {
                    const { run } = await getActiveCanvasWorkflowRun(projectId);
                    if (!run || run.id !== checkpoint.runId) return;
                } catch {
                    // Keep the original cancellation error when active-run verification is unavailable.
                }
                throw error;
            }
        },
        [projectId, workflowOwnerId],
    );

    const beginWorkflowStop = useCallback(
        (checkpoint: CanvasWorkflowCheckpoint) => {
            if (workflowStopPromiseRef.current) return workflowStopPromiseRef.current;
            const task = (async () => {
                await cancelDurableWorkflowRun(checkpoint);
                await presentWorkflowTerminal({
                    status: "canceled",
                    completed: checkpoint.completedNodeIds.length,
                    total: checkpoint.nodeIds.length,
                    running: 0,
                    queued: 0,
                    startedAt: checkpoint.startedAt,
                });
                message.info(t("canvas.workflow.canceled"));
            })();
            workflowStopPromiseRef.current = task;
            workflowStopRetryRef.current = null;
            void task.then(
                () => {
                    if (workflowStopPromiseRef.current === task) workflowStopPromiseRef.current = null;
                    workflowStopRetryRef.current = null;
                },
                (error) => {
                    if (workflowStopPromiseRef.current === task) workflowStopPromiseRef.current = null;
                    workflowStopRetryRef.current = checkpoint;
                    releaseWorkflowBrowserLock();
                    setWorkflowRun({
                        status: "error",
                        completed: checkpoint.completedNodeIds.length,
                        total: checkpoint.nodeIds.length,
                        errorMessage: error instanceof Error ? error.message : t("canvas.workflow.syncFailed"),
                        startedAt: checkpoint.startedAt,
                    });
                    message.error(error instanceof Error ? error.message : t("canvas.workflow.syncFailed"));
                },
            );
            return task;
        },
        [cancelDurableWorkflowRun, message, presentWorkflowTerminal, releaseWorkflowBrowserLock, t],
    );

    const workflowReadinessErrorMessage = useCallback(
        (issue: CanvasWorkflowNodeReadinessIssue) => {
            const nodeName = nodesRef.current.find((node) => node.id === issue.nodeId)?.title || t("canvas.node.untitled");
            const relatedName = nodesRef.current.find((node) => node.id === issue.relatedNodeId)?.title || issue.relatedNodeId;
            if (issue.reason === "dependency_incomplete") return t("canvas.workflow.dependencyIncomplete", { name: nodeName, dependency: relatedName });
            if (issue.reason === "reference_missing") return t("canvas.workflow.referenceMissing", { name: nodeName, reference: relatedName });
            return t("canvas.workflow.referenceEmpty", { name: nodeName, reference: relatedName });
        },
        [t],
    );

    const workflowOutputErrorMessage = useCallback(
        (issue: CanvasWorkflowNodeOutputIssue) => {
            const nodeName = nodesRef.current.find((node) => node.id === issue.nodeId)?.title || t("canvas.node.untitled");
            if (issue.errorDetails) return `${nodeName}: ${issue.errorDetails}`;
            if (issue.reason === "output_missing") return t("canvas.workflow.outputMissing", { name: nodeName });
            return t("canvas.workflow.outputIncomplete", { name: nodeName, expected: issue.expected, actual: issue.actual });
        },
        [t],
    );

    const syncServerWorkflowCheckpoint = useCallback(
        async (checkpoint: CanvasWorkflowCheckpoint, status: CanvasWorkflowRunRecord["status"] = "running", errorMessage = "") => {
            if (!checkpoint.runId) return;
            let lastError: unknown;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    await updateCanvasWorkflowRun(projectId, checkpoint.runId, {
                        ownerId: workflowOwnerId,
                        status,
                        completedNodeIds: checkpoint.completedNodeIds,
                        canceledNodeIds: [...new Set([...(checkpoint.canceledNodeIds || []), ...workflowRunRef.current.canceledNodeIds])],
                        currentNodeId: checkpoint.currentNodeId,
                        errorMessage,
                    });
                    return;
                } catch (error) {
                    lastError = error;
                    if (error instanceof StarcloudsApiError && error.code === "workflow_run_lock_lost") throw error;
                    if (attempt < 2) await new Promise<void>((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
                }
            }
            throw lastError;
        },
        [projectId, workflowOwnerId],
    );

    const showLockedWorkflow = useCallback(
        (checkpoint: CanvasWorkflowCheckpoint, run?: CanvasWorkflowRunRecord | null) => {
            const lockedCheckpoint = run ? mergeWorkflowRunCheckpoint(checkpoint, run) : checkpoint;
            lockedWorkflowRunRef.current = run || null;
            workflowCheckpointRef.current = lockedCheckpoint;
            workflowRunRef.current = { cancelQueued: false, canceledNodeIds: new Set(lockedCheckpoint.canceledNodeIds || []) };
            const currentNodeId = lockedCheckpoint.currentNodeId;
            setWorkflowRun({
                status: "locked",
                completed: lockedCheckpoint.completedNodeIds.length,
                total: lockedCheckpoint.nodeIds.length,
                currentNodeId,
                currentNodeTitle: nodesRef.current.find((node) => node.id === currentNodeId)?.title,
                startedAt: lockedCheckpoint.startedAt,
            });
        },
        [],
    );

    const acquireDurableWorkflowCheckpoint = useCallback(
        async (source: CanvasWorkflowCheckpoint, options?: { resetCurrentNode?: boolean; supersedeRunId?: string }) => {
            if (workflowRunRef.current.stopped) return null;
            const browserLockAcquired = await acquireWorkflowBrowserLock();
            if (!browserLockAcquired) {
                const active = await getActiveCanvasWorkflowRun(projectId).catch(() => ({ run: null }));
                showLockedWorkflow(source, active.run);
                message.info(t("canvas.workflow.runningElsewhere"));
                return null;
            }

            if (options?.supersedeRunId) {
                await updateCanvasWorkflowRun(projectId, options.supersedeRunId, {
                    ownerId: workflowOwnerId,
                    status: "canceled",
                    completedNodeIds: source.completedNodeIds,
                    currentNodeId: undefined,
                    errorMessage: "",
                }).catch(() => undefined);
            }

            let response: Awaited<ReturnType<typeof acquireCanvasWorkflowRun>> | null = null;
            let lastError: unknown;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    response = await acquireCanvasWorkflowRun(projectId, workflowOwnerId, source.nodeIds);
                    break;
                } catch (error) {
                    lastError = error;
                    const projectPending = error instanceof StarcloudsApiError && error.code === "not_found";
                    if (!projectPending || attempt === 2) break;
                    await new Promise<void>((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
                }
            }
            if (!response) {
                releaseWorkflowBrowserLock();
                throw lastError;
            }
            const checkpoint = mergeWorkflowRunCheckpoint(source, response.run, { resetCurrentNode: options?.resetCurrentNode });
            if (!response.acquired) {
                releaseWorkflowBrowserLock();
                showLockedWorkflow(checkpoint, response.run);
                message.info(t("canvas.workflow.runningElsewhere"));
                return null;
            }
            lockedWorkflowRunRef.current = null;
            return checkpoint;
        },
        [acquireWorkflowBrowserLock, message, projectId, releaseWorkflowBrowserLock, showLockedWorkflow, t, workflowOwnerId],
    );

    const executeWorkflow = useCallback(
        async (sourceCheckpoint: CanvasWorkflowCheckpoint, resumed = false) => {
            if (workflowRunRef.current.executing) return;
            const runToken = ++workflowExecutionTokenRef.current;
            workflowRunRef.current.executing = true;
            workflowRunRef.current.stopped = false;
            workflowRunRef.current.cancelQueued = false;
            workflowRunRef.current.lockLost = false;
            workflowRunRef.current.canceledNodeIds = new Set(sourceCheckpoint.canceledNodeIds || []);
            const runActive = () => runToken === workflowExecutionTokenRef.current && !workflowRunRef.current.stopped;
            try {
            let checkpoint = normalizeCanvasWorkflowCheckpoint(sourceCheckpoint);
            if (!checkpoint) return;
            const retryingFailure = isCanvasWorkflowFailureRetry(checkpoint, nodesRef.current);
            const supersededRunId = retryingFailure ? checkpoint.runId : undefined;
            checkpoint = retryingFailure ? beginCanvasWorkflowRetry(checkpoint) : { ...checkpoint, status: "running", errorNodeId: undefined, errorMessage: undefined };
            const compiled = compileCanvasWorkflow(nodesRef.current, connectionsRef.current, { configNodeIds: checkpoint.nodeIds });
            if (!compiled.ok || !workflowPlanMatchesCheckpoint(compiled.plan, checkpoint)) {
                const errorMessage = t("canvas.workflow.graphChanged");
                setWorkflowRun({ status: "error", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, errorMessage, startedAt: checkpoint.startedAt });
                message.error(errorMessage);
                return;
            }
            const executionPlan = compiled.plan;
            workflowPlanRef.current = executionPlan;
            try {
                const durableCheckpoint = await acquireDurableWorkflowCheckpoint(checkpoint, retryingFailure ? { resetCurrentNode: true, supersedeRunId: supersededRunId } : undefined);
                if (!runActive()) {
                    if (durableCheckpoint?.runId && workflowCheckpointRef.current?.runId !== durableCheckpoint.runId) {
                        void updateCanvasWorkflowRun(projectId, durableCheckpoint.runId, {
                            ownerId: workflowOwnerId,
                            status: "canceled",
                            completedNodeIds: durableCheckpoint.completedNodeIds,
                            currentNodeId: durableCheckpoint.currentNodeId,
                        }).catch(() => undefined);
                    }
                    return;
                }
                if (!durableCheckpoint) return;
                checkpoint = retryingFailure ? beginCanvasWorkflowRetry(durableCheckpoint) : durableCheckpoint;
            } catch (error) {
                if (!runActive()) return;
                const errorMessage = error instanceof Error ? error.message : t("canvas.workflow.syncFailed");
                setWorkflowRun({ status: "error", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, errorMessage, startedAt: checkpoint.startedAt });
                message.error(errorMessage);
                return;
            }

            if (workflowRunRef.current.cancelQueued) {
                await syncServerWorkflowCheckpoint(checkpoint, "canceled");
                await presentWorkflowTerminal({ status: "canceled", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, running: 0, queued: 0, startedAt: checkpoint.startedAt });
                return;
            }

            const interrupted = t("canvas.generation.interrupted");
            const reconciled = reconcileCanvasWorkflowCheckpoint(checkpoint, nodesRef.current, interrupted, connectionsRef.current, [t("canvas.generation.canceled"), t("common.requestCanceled")]);
            if (!runActive()) return;
            if (!reconciled.ok) {
                const current = nodesRef.current.find((node) => node.id === reconciled.nodeId);
                const errorMessage = reconciled.reason === "missing" ? t("canvas.workflow.nodeMissing") : t("canvas.workflow.failed", { name: current?.title || t("canvas.node.untitled") });
                checkpoint = failCanvasWorkflowCheckpoint(checkpoint, reconciled.nodeId, errorMessage);
                workflowRunRef.current = { ...workflowRunRef.current, cancelQueued: false, currentNodeId: undefined, canceledNodeIds: new Set() };
                await syncServerWorkflowCheckpoint(checkpoint, "failed", errorMessage);
                await presentWorkflowTerminal({ status: "error", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, currentNodeId: reconciled.nodeId, currentNodeTitle: current?.title, errorMessage, startedAt: checkpoint.startedAt }, checkpoint);
                message.error(errorMessage);
                return;
            }

            checkpoint = reconcileCanvasWorkflowOutputs(reconciled.checkpoint, nodesRef.current, connectionsRef.current, { recoverPersistedOutputs: resumed });
            if (!runActive()) return;
            const completedIds = new Set(checkpoint.completedNodeIds);
            const persistedCanceledIds = new Set(checkpoint.canceledNodeIds || []);
            persistedCanceledIds.forEach((nodeId) => workflowRunRef.current.canceledNodeIds.add(nodeId));
            const pendingIds = new Set(checkpoint.nodeIds.filter((nodeId) => !completedIds.has(nodeId) && !workflowRunRef.current.canceledNodeIds.has(nodeId)));
            if (persistedCanceledIds.size) finalizeCanceledGenerationNodes(persistedCanceledIds);
            workflowPendingIdsRef.current = pendingIds;
            const failedIds = new Set<string>();
            const failures = new Map<string, string>();
            workflowRunRef.current = {
                cancelQueued: workflowRunRef.current.cancelQueued,
                lockLost: workflowRunRef.current.lockLost,
                executing: true,
                stopped: workflowRunRef.current.stopped,
                currentNodeId: checkpoint.currentNodeId || "__workflow_resume__",
                canceledNodeIds: workflowRunRef.current.canceledNodeIds,
            };
            workflowRunTaskIdsRef.current.clear();
            workflowSubmittedNodeIdsRef.current.clear();
            const queuedAt = new Date().toISOString();
            commitNodes((current) =>
                current.map((node) =>
                    pendingIds.has(node.id) && node.metadata?.executionStatus !== "running"
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  executionStatus: "queued",
                                  generationQueuedAt: queuedAt,
                                  generationStartedAt: undefined,
                                  generationCompletedAt: undefined,
                                  generationDurationMs: undefined,
                              },
                          }
                        : node,
                ),
            );
            await persistWorkflowCheckpoint(checkpoint);
            try {
                await syncServerWorkflowCheckpoint(checkpoint);
            } catch (error) {
                if (!runActive()) return;
                releaseWorkflowBrowserLock();
                const errorMessage = error instanceof Error ? error.message : t("canvas.workflow.syncFailed");
                setWorkflowRun({ status: "error", completed: completedIds.size, total: checkpoint.nodeIds.length, errorMessage, startedAt: checkpoint.startedAt });
                message.error(errorMessage);
                return;
            }
            if (resumed && !retryingFailure) message.info(t("canvas.workflow.resumed"));

            const updateProgress = (runningIds: string[] = []) => {
                if (!runActive()) return;
                const first = runningIds[0];
                setWorkflowRun({
                    status: "running",
                    completed: completedIds.size,
                    total: checkpoint!.nodeIds.length,
                    currentNodeId: first,
                    currentNodeTitle: nodesRef.current.find((node) => node.id === first)?.title,
                    startedAt: checkpoint!.startedAt,
                    running: runningIds.length,
                    queued: pendingIds.size,
                    canceling: workflowRunRef.current.cancelQueued,
                });
            };
            updateProgress();

            const heartbeat = window.setInterval(() => {
                if (workflowRunRef.current.lockLost || workflowRunRef.current.stopped || runToken !== workflowExecutionTokenRef.current) return;
                const current = workflowCheckpointRef.current;
                if (!current?.runId || current.status !== "running") return;
                void syncServerWorkflowCheckpoint(current).catch((error) => {
                    if (workflowRunRef.current.stopped || runToken !== workflowExecutionTokenRef.current) return;
                    workflowRunRef.current.lockLost = true;
                    generationRequestsRef.current.forEach((request) => request.controller.abort());
                    if (error instanceof StarcloudsApiError && error.code === "workflow_run_lock_lost") {
                        releaseWorkflowBrowserLock();
                        void getActiveCanvasWorkflowRun(projectId).then(({ run }) => showLockedWorkflow(current, run));
                        return;
                    }
                    releaseWorkflowBrowserLock();
                    const errorMessage = t("canvas.workflow.syncFailed");
                    setWorkflowRun({ status: "error", completed: current.completedNodeIds.length, total: current.nodeIds.length, errorMessage, startedAt: current.startedAt });
                    message.error(errorMessage);
                });
            }, 10_000);

            const retryTaskKeySalt = retryingFailure && supersededRunId && checkpoint.runId === supersededRunId ? createCanvasTaskNonce() : undefined;
            const executeNode = async (nodeId: string) => {
                if (!runActive() || workflowRunRef.current.cancelQueued || workflowRunRef.current.canceledNodeIds.has(nodeId) || workflowRunRef.current.lockLost) {
                    return { nodeId, ok: false as const, errorMessage: t("canvas.generation.canceled") };
                }
                const node = nodesRef.current.find((item) => item.id === nodeId);
                if (!node) return { nodeId, ok: false as const, errorMessage: t("canvas.workflow.nodeMissing") };
                const readiness = validateCanvasWorkflowNodeReadiness({ nodeId, nodes: nodesRef.current, connections: connectionsRef.current, dependencies: executionPlan.dependencies.get(nodeId) || new Set(), completedNodeIds: completedIds });
                if (!readiness.ok) return { nodeId, ok: false as const, errorMessage: workflowReadinessErrorMessage(readiness.issue) };
                const mode = node.metadata?.generationMode || "image";
                const prompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
                const generationConfig = buildGenerationConfig(effectiveConfig, node, mode);
                await handleGenerateNode(nodeId, mode, prompt, { skipCostConfirm: true, workflowRunId: checkpoint?.runId, taskKeySalt: retryTaskKeySalt });
                if (!runActive() || workflowRunRef.current.canceledNodeIds.has(nodeId) || !pageActiveRef.current || workflowRunRef.current.lockLost) {
                    return { nodeId, ok: false as const, errorMessage: t("canvas.generation.canceled") };
                }
                const expectedCount = isCanvasLocalImageOperation(node.metadata?.localImageOperation)
                    ? canvasLocalImageOperationOutputCount(node.metadata.localImageOperation, node.metadata.localImageOperationParams)
                    : getGenerationCount(generationConfig.count);
                let validation = validateCanvasWorkflowNodeOutputs({ nodeId, mode, expectedCount, nodes: nodesRef.current, connections: connectionsRef.current });
                for (let attempt = 0; !validation.ok && validation.issue.reason !== "output_failed" && attempt < 50; attempt += 1) {
                    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
                    if (!runActive()) return { nodeId, ok: false as const, errorMessage: t("canvas.generation.canceled") };
                    validation = validateCanvasWorkflowNodeOutputs({ nodeId, mode, expectedCount, nodes: nodesRef.current, connections: connectionsRef.current });
                }
                return validation.ok ? { nodeId, ok: true as const } : { nodeId, ok: false as const, errorMessage: workflowOutputErrorMessage(validation.issue) };
            };

            // While the run executes, node-level progress goes to the run lease
            // (syncServerWorkflowCheckpoint); the full document only needs a
            // relaxed save cadence instead of one cloud save per progress tick.
            setCanvasCloudSaveBaseDelay(3_000);
            try {
                while (pendingIds.size && !workflowRunRef.current.lockLost) {
                    for (const nodeId of workflowRunRef.current.canceledNodeIds) pendingIds.delete(nodeId);
                    if (workflowRunRef.current.cancelQueued) {
                        pendingIds.forEach((nodeId) => workflowRunRef.current.canceledNodeIds.add(nodeId));
                        pendingIds.clear();
                        break;
                    }
                    const blockedQueuedIds = [...pendingIds].filter((nodeId) => [...(executionPlan.dependencies.get(nodeId) || [])].some((dependencyId) => failedIds.has(dependencyId) || workflowRunRef.current.canceledNodeIds.has(dependencyId)));
                    blockedQueuedIds.forEach((nodeId) => {
                        pendingIds.delete(nodeId);
                        workflowRunRef.current.canceledNodeIds.add(nodeId);
                    });
                    if (blockedQueuedIds.length) {
                        const blocked = new Set(blockedQueuedIds);
                        commitNodes((current) => current.map((node) => (blocked.has(node.id) && node.metadata?.executionStatus === "queued" ? { ...node, metadata: { ...node.metadata, executionStatus: "canceled" } } : node)));
                    }
                    const runnable = findRunnableCanvasWorkflowNodeIds({
                        pendingNodeIds: pendingIds,
                        completedNodeIds: completedIds,
                        blockedNodeIds: new Set([...failedIds, ...workflowRunRef.current.canceledNodeIds]),
                        dependencies: executionPlan.dependencies,
                    }).filter((nodeId) => !workflowRunRef.current.cancelQueued && !workflowRunRef.current.canceledNodeIds.has(nodeId));
                    if (!runnable.length) break;
                    runnable.forEach((nodeId) => pendingIds.delete(nodeId));
                    const runningSet = new Set(runnable);
                    const startedAt = new Date().toISOString();
                    commitNodes((current) =>
                        current.map((node) =>
                            runningSet.has(node.id)
                                ? { ...node, metadata: { ...node.metadata, executionStatus: "running", generationStartedAt: startedAt, generationCompletedAt: undefined, generationDurationMs: undefined } }
                                : node,
                        ),
                    );
                    checkpoint = { ...checkpoint, currentNodeId: runnable[0], updatedAt: new Date().toISOString() };
                    workflowRunRef.current.currentNodeId = runnable[0];
                    if (!runActive()) break;
                    await persistWorkflowCheckpoint(checkpoint);
                    await syncServerWorkflowCheckpoint(checkpoint);
                    if (!runActive()) break;
                    updateProgress(runnable);
                    const results = await Promise.all(runnable.map(executeNode));
                    if (!runActive()) break;
                    if (workflowRunRef.current.cancelQueued) {
                        pendingIds.forEach((nodeId) => workflowRunRef.current.canceledNodeIds.add(nodeId));
                        pendingIds.clear();
                    }
                    for (const result of results) {
                        if (result.ok) {
                            completedIds.add(result.nodeId);
                            checkpoint = advanceCanvasWorkflowCheckpoint(checkpoint, result.nodeId);
                        } else if (workflowRunRef.current.cancelQueued || workflowRunRef.current.stopped || workflowRunRef.current.canceledNodeIds.has(result.nodeId)) {
                            workflowRunRef.current.canceledNodeIds.add(result.nodeId);
                        } else {
                            failedIds.add(result.nodeId);
                            failures.set(result.nodeId, result.errorMessage);
                        }
                    }
                    const checkpointNodeIds = checkpoint.nodeIds;
                    checkpoint = {
                        ...checkpoint,
                        completedNodeIds: [...completedIds],
                        canceledNodeIds: [...workflowRunRef.current.canceledNodeIds].filter((nodeId) => checkpointNodeIds.includes(nodeId) && !completedIds.has(nodeId)),
                        currentNodeId: undefined,
                        updatedAt: new Date().toISOString(),
                    };
                    workflowRunRef.current.currentNodeId = pendingIds.size ? "__workflow_queue__" : undefined;
                    if (!runActive()) break;
                    await persistWorkflowCheckpoint(checkpoint);
                    await syncServerWorkflowCheckpoint(checkpoint);
                    updateProgress();
                }
            } catch (error) {
                if (!runActive() || !pageActiveRef.current) return;
                const errorMessage = error instanceof Error ? error.message : t("canvas.workflow.syncFailed");
                workflowRunRef.current = { ...workflowRunRef.current, cancelQueued: false, currentNodeId: undefined, canceledNodeIds: new Set() };
                releaseWorkflowBrowserLock();
                setWorkflowRun({ status: "error", completed: completedIds.size, total: checkpoint.nodeIds.length, errorMessage, startedAt: checkpoint.startedAt });
                message.error(errorMessage);
                return;
            } finally {
                window.clearInterval(heartbeat);
                setCanvasCloudSaveBaseDelay(null);
            }

            if (!runActive()) return;
            if (!pageActiveRef.current || workflowRunRef.current.lockLost) {
                if (workflowRunRef.current.lockLost) releaseWorkflowBrowserLock();
                return;
            }
            const canceled = workflowRunRef.current.cancelQueued || workflowRunRef.current.stopped || workflowRunRef.current.canceledNodeIds.size > 0;
            const firstFailure = canceled ? undefined : (failures.entries().next().value as [string, string] | undefined);
            workflowRunRef.current = { cancelQueued: false, stopped: false, canceledNodeIds: new Set() };
            workflowRunTaskIdsRef.current.clear();
            workflowSubmittedNodeIdsRef.current.clear();
            workflowPlanRef.current = null;
            if (firstFailure) checkpoint = failCanvasWorkflowCheckpoint(checkpoint, firstFailure[0], firstFailure[1]);
            try {
                await syncServerWorkflowCheckpoint(checkpoint, firstFailure ? "failed" : canceled ? "canceled" : "succeeded", firstFailure?.[1] || "");
            } catch {
                if (!runActive()) return;
                const errorMessage = t("canvas.workflow.syncFailed");
                releaseWorkflowBrowserLock();
                setWorkflowRun({ status: "error", completed: completedIds.size, total: checkpoint.nodeIds.length, errorMessage, startedAt: checkpoint.startedAt });
                message.error(errorMessage);
                return;
            }
            if (firstFailure) {
                await presentWorkflowTerminal({ status: "error", completed: completedIds.size, total: checkpoint.nodeIds.length, currentNodeId: firstFailure[0], currentNodeTitle: nodesRef.current.find((node) => node.id === firstFailure[0])?.title, errorMessage: firstFailure[1], running: 0, queued: 0 }, checkpoint);
            } else {
                await presentWorkflowTerminal({ status: canceled ? "canceled" : "success", completed: completedIds.size, total: checkpoint.nodeIds.length, running: 0, queued: 0, startedAt: checkpoint.startedAt });
            }
            if (firstFailure) message.error(firstFailure[1]);
            else if (canceled) message.info(t("canvas.workflow.canceled"));
            else message.success(t("canvas.workflow.completed", { count: completedIds.size }));
            } finally {
                if (runToken === workflowExecutionTokenRef.current) workflowRunRef.current.executing = false;
                workflowPendingIdsRef.current = new Set();
            }
        },
        [acquireDurableWorkflowCheckpoint, commitNodes, effectiveConfig, finalizeCanceledGenerationNodes, handleGenerateNode, message, persistWorkflowCheckpoint, presentWorkflowTerminal, projectId, releaseWorkflowBrowserLock, showLockedWorkflow, syncServerWorkflowCheckpoint, t, workflowOutputErrorMessage, workflowOwnerId, workflowReadinessErrorMessage],
    );
    resumeWorkflowRef.current = (checkpoint) => executeWorkflow(checkpoint, true);

    useEffect(() => {
        if (!projectLoaded || workflowCheckpointRef.current) return;
        let disposed = false;
        void getActiveCanvasWorkflowRun(projectId)
            .then(({ run }) => {
                if (disposed || !run?.nodeIds.length) return;
                const checkpoint = normalizeCanvasWorkflowCheckpoint({
                    status: "running",
                    runId: run.id,
                    nodeIds: run.nodeIds,
                    completedNodeIds: run.completedNodeIds,
                    canceledNodeIds: run.canceledNodeIds,
                    currentNodeId: run.currentNodeId || undefined,
                    startedAt: run.startedAt,
                    updatedAt: run.updatedAt,
                });
                if (checkpoint) void resumeWorkflowRef.current(checkpoint);
            })
            .catch(() => undefined);
        return () => {
            disposed = true;
        };
    }, [projectId, projectLoaded]);

    useEffect(() => {
        if (workflowRun.status !== "locked") return;
        let disposed = false;
        let inflight = false;
        const poll = async () => {
            if (inflight) return;
            inflight = true;
            try {
            const { run } = await getActiveCanvasWorkflowRun(projectId);
            if (disposed) return;
            const current = workflowCheckpointRef.current;
            if (run && current) {
                if (!run.leaseExpiresAt || new Date(run.leaseExpiresAt).getTime() <= Date.now()) {
                    void resumeWorkflowRef.current(mergeWorkflowRunCheckpoint(current, run));
                    return;
                }
                showLockedWorkflow(current, run);
                return;
            }
            if (!run) {
                workflowCheckpointRef.current = null;
                lockedWorkflowRunRef.current = null;
                setWorkflowRun((state) => ({ ...state, status: "refresh", currentNodeId: undefined, currentNodeTitle: undefined }));
                message.success(t("canvas.workflow.completedElsewhere"));
            }
            } finally {
                inflight = false;
            }
        };
        const timer = window.setInterval(() => void poll().catch(() => undefined), 3_000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [message, projectId, showLockedWorkflow, t, workflowRun.status]);

    const planWorkflowForAgent = useCallback((request: CanvasWorkflowRunRequest = {}): AgentWorkflowPreflightResult => {
        const state = workflowRunStateRef.current;
        if (state.status === "running" || state.status === "locked") throw new Error("工作流仍在执行，请先停止后再进行运行预检");
        const groups = buildCanvasSidePanelWorkflowGroups(nodesRef.current, connectionsRef.current).filter((group) => group.firstConfig);
        const requestedNodeIds = request.nodeIds?.length ? new Set(request.nodeIds) : null;
        const candidates = request.workflowId
            ? groups.filter((group) => group.id === request.workflowId)
            : requestedNodeIds
              ? groups.filter((group) => [...requestedNodeIds].every((id) => group.nodes.some((node) => node.id === id)))
              : groups;
        if (candidates.length !== 1) throw new Error(candidates.length ? "找到多个候选工作流，请使用快照中的精确 workflowId" : "没有找到要预检的工作流");
        const group = candidates[0];
        const executableNodeIds = group.nodes.filter((node) => isCanvasExecutableNode(node) && (!requestedNodeIds || requestedNodeIds.has(node.id))).map((node) => node.id);
        if (requestedNodeIds && executableNodeIds.length !== requestedNodeIds.size) throw new Error("预检节点包含不属于目标工作流的节点");
        const compiled = compileCanvasWorkflow(nodesRef.current, connectionsRef.current, { configNodeIds: executableNodeIds });
        if (!compiled.ok) {
            throw new Error(compiled.reason === "cycle" ? "工作流存在循环依赖" : compiled.reason === "invalid_connection" ? "工作流包含无效的配置节点直连" : "工作流没有可执行节点");
        }
        const savedCheckpoint = canvasWorkflowCheckpointForStart(state.status, workflowCheckpointRef.current);
        const canResumeSaved = Boolean(savedCheckpoint?.nodeIds.length && workflowPlanMatchesCheckpoint(compiled.plan, savedCheckpoint));
        const recoveredCheckpoint = canResumeSaved && savedCheckpoint ? reconcileCanvasWorkflowFailureOutput(savedCheckpoint, nodesRef.current, connectionsRef.current) : null;
        const completedNodeIds = recoveredCheckpoint?.completedNodeIds || [];
        const preflight = preflightCanvasWorkflow({
            plan: compiled.plan,
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            effectiveConfig,
            completedNodeIds,
            isConfigReady: isAiConfigReady,
        });
        if (!preflight.ok) {
            if (preflight.reason === "readiness" && preflight.readinessIssue) throw new Error(workflowReadinessErrorMessage(preflight.readinessIssue));
            if (preflight.reason === "node_missing") throw new Error(t("canvas.workflow.nodeMissing"));
            if (preflight.reason === "unsupported_media") throw new Error(t("canvas.workflow.unsupportedMedia", { name: preflight.nodeTitle || preflight.nodeId }));
            if (preflight.reason === "empty_input") throw new Error(t("canvas.workflow.notReady", { name: preflight.nodeTitle || preflight.nodeId }));
            if (preflight.reason === "model_unavailable") throw new Error(t("canvas.workflow.modelUnavailable", { name: preflight.nodeTitle || preflight.nodeId }));
            throw new Error(t("canvas.workflow.pricingUnavailable", { name: preflight.nodeTitle || preflight.nodeId }));
        }
        return {
            workflowId: group.id,
            resumeFromCheckpoint: Boolean(recoveredCheckpoint),
            nodeIds: preflight.nodeIds,
            completedNodeIds: preflight.completedNodeIds,
            items: preflight.items.map((item) => ({
                nodeId: item.nodeId,
                title: item.title,
                mode: item.mode,
                model: item.model,
                count: item.count,
                localOperation: item.localOperation,
                inputSummary: item.inputSummary,
                unit: item.estimate?.unit || 0,
                total: item.estimate?.total || 0,
                ...(item.estimate?.compareTotal !== undefined ? { compareTotal: item.estimate.compareTotal } : {}),
            })),
            totals: preflight.totals,
        };
    }, [effectiveConfig, isAiConfigReady, t, workflowReadinessErrorMessage]);
    planWorkflowAgentRef.current = planWorkflowForAgent;

    const runWorkflow = useCallback(async (request: CanvasWorkflowRunRequest = {}) => {
        if (workflowRunRef.current.executing && !workflowRunRef.current.stopped) return;
        const pendingTerminal = workflowTerminalPromiseRef.current;
        if (pendingTerminal) await waitForCanvasWorkflowStop(pendingTerminal);
        let stoppedRunSettled = false;
        const pendingStop = workflowStopPromiseRef.current;
        if (pendingStop) {
            try {
                await waitForCanvasWorkflowStop(pendingStop);
                stoppedRunSettled = true;
            } catch {
                return;
            }
        }
        const stoppedCheckpoint = workflowStopRetryRef.current;
        if (stoppedCheckpoint) {
            try {
                await waitForCanvasWorkflowStop(beginWorkflowStop(stoppedCheckpoint));
                stoppedRunSettled = true;
            } catch {
                return;
            }
        }
        const requestedGroup = request.workflowId
            ? buildCanvasSidePanelWorkflowGroups(nodesRef.current, connectionsRef.current).find((group) => group.id === request.workflowId && group.firstConfig)
            : undefined;
        if (request.workflowId && !requestedGroup) {
            message.warning(t("canvas.workflow.notFound"));
            return;
        }
        const requestedNodeIds = request.nodeIds?.length ? new Set(request.nodeIds) : null;
        const availableExecutableNodes = (requestedGroup?.nodes || nodesRef.current).filter((node) => isCanvasExecutableNode(node));
        const scopedExecutableNodeIds = availableExecutableNodes.filter((node) => !requestedNodeIds || requestedNodeIds.has(node.id)).map((node) => node.id);
        if (requestedNodeIds && scopedExecutableNodeIds.length !== requestedNodeIds.size) {
            message.warning(t("canvas.workflow.notFound"));
            return;
        }
        const compiled = compileCanvasWorkflow(nodesRef.current, connectionsRef.current, {
            configNodeIds: requestedGroup || requestedNodeIds ? scopedExecutableNodeIds : undefined,
        });
        if (!compiled.ok) {
            message.warning(t(compiled.reason === "cycle" ? "canvas.workflow.cycle" : compiled.reason === "invalid_connection" ? "canvas.workflow.invalidConnection" : "canvas.workflow.empty"));
            return;
        }
        const savedCheckpoint = stoppedRunSettled ? null : canvasWorkflowCheckpointForStart(workflowRun.status, workflowCheckpointRef.current);
        if (!savedCheckpoint) {
            workflowCheckpointRef.current = null;
            workflowRunRef.current = { cancelQueued: false, stopped: false, executing: false, lockLost: false, canceledNodeIds: new Set() };
            workflowRunTaskIdsRef.current.clear();
            workflowSubmittedNodeIdsRef.current.clear();
            workflowPlanRef.current = null;
            workflowPendingIdsRef.current = new Set();
        }
        const canResumeSaved = Boolean(savedCheckpoint?.nodeIds.length && workflowPlanMatchesCheckpoint(compiled.plan, savedCheckpoint));
        const recoveredCheckpoint = canResumeSaved && savedCheckpoint ? reconcileCanvasWorkflowFailureOutput(savedCheckpoint, nodesRef.current, connectionsRef.current) : savedCheckpoint;
        const retryingFailure = Boolean(recoveredCheckpoint && isCanvasWorkflowFailureRetry(recoveredCheckpoint, nodesRef.current));
        const checkpoint = canResumeSaved && recoveredCheckpoint
            ? retryingFailure
                ? { ...recoveredCheckpoint, status: "failed" as const, updatedAt: new Date().toISOString() }
                : { ...recoveredCheckpoint, status: "running" as const, errorNodeId: undefined, errorMessage: undefined, updatedAt: new Date().toISOString() }
            : createCanvasWorkflowCheckpoint(compiled.plan.nodeIds);
        const remainingNodeIds = checkpoint.nodeIds.filter((nodeId) => !checkpoint.completedNodeIds.includes(nodeId));
        if (!remainingNodeIds.length) {
            await executeWorkflow(checkpoint, true);
            return;
        }

        const preflight = preflightCanvasWorkflow({
            plan: compiled.plan,
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            effectiveConfig,
            completedNodeIds: checkpoint.completedNodeIds,
            isConfigReady: isAiConfigReady,
        });
        if (!preflight.ok) {
            if (preflight.nodeId) {
                setSelectedNodeIds(new Set([preflight.nodeId]));
                setSelectedConnectionId(null);
            }
            if (preflight.reason === "node_missing") message.error(t("canvas.workflow.nodeMissing"));
            else if (preflight.reason === "unsupported_media") message.warning(t("canvas.workflow.unsupportedMedia", { name: preflight.nodeTitle || t("canvas.node.untitled") }));
            else if (preflight.reason === "empty_input") message.warning(t("canvas.workflow.notReady", { name: preflight.nodeTitle || t("canvas.node.untitled") }));
            else if (preflight.reason === "readiness" && preflight.readinessIssue) message.warning(workflowReadinessErrorMessage(preflight.readinessIssue));
            else if (preflight.reason === "model_unavailable") {
                openConfigDialog(true);
                message.warning(t("canvas.workflow.modelUnavailable", { name: preflight.nodeTitle || t("canvas.node.untitled") }));
            } else message.warning(t("canvas.workflow.pricingUnavailable", { name: preflight.nodeTitle || t("canvas.node.untitled") }));
            return;
        }
        if (!preflight.totals.paidNodeCount) {
            await executeWorkflow(checkpoint, canResumeSaved && !retryingFailure);
            return;
        }
        const { generation: generationUnit, removal: removalUnit, total, compareTotal } = preflight.totals;
        const costConfirmed = await requestCostEstimateConfirm({
            kind: "workflow",
            modelLabel: t("canvas.workflow.costLabel"),
            unit: total,
            generationUnit,
            removalUnit,
            count: 1,
            total,
            compareUnit: compareTotal,
            compareTotal,
            unitLabel: "run",
            pricingUnavailable: false,
        });
        if (!costConfirmed) return;
        await executeWorkflow(checkpoint, canResumeSaved && !retryingFailure);
    }, [beginWorkflowStop, effectiveConfig, executeWorkflow, isAiConfigReady, message, openConfigDialog, requestCostEstimateConfirm, t, workflowReadinessErrorMessage, workflowRun.status]);
    runWorkflowRef.current = runWorkflow;

    const cancelQueuedWorkflowNode = useCallback(
        (nodeId: string) => {
            const count = stopUnsubmittedWorkflowWork(nodeId);
            if (count) message.info(t("canvas.workflow.queuedNodesCanceled", { count }));
        },
        [message, stopUnsubmittedWorkflowWork, t],
    );

    const requestStopGeneration = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (node && !hasSubmittedCanvasTask(node, nodesRef.current)) {
                const count = stopUnsubmittedWorkflowWork(nodeId);
                if (count) {
                    message.info(t("canvas.workflow.queuedNodesCanceled", { count }));
                    return;
                }
            }
            const queuedCount = collectUnsubmittedWorkflowNodeIds().size;
            setStopConfirm({ kind: queuedCount > 0 ? "workflow" : "running", queuedCount, nodeId });
        },
        [collectUnsubmittedWorkflowNodeIds, message, stopUnsubmittedWorkflowWork, t],
    );

    const stopRunningGeneration = useCallback(async () => {
        const requestedNodeId = stopConfirm?.nodeId;
        if (!requestedNodeId || stopSubmitting) return;
        setStopSubmitting(true);
        try {
            const stoppedNodeIds = new Set([requestedNodeId]);
            generationRequestsRef.current.forEach((request) => {
                if (request.targetNodeId !== requestedNodeId && request.originNodeId !== requestedNodeId && request.runningNodeId !== requestedNodeId) return;
                stoppedNodeIds.add(request.targetNodeId);
                stoppedNodeIds.add(request.originNodeId);
                stoppedNodeIds.add(request.runningNodeId);
            });
            let expanded = true;
            while (expanded) {
                expanded = false;
                for (const node of nodesRef.current) {
                    const related =
                        stoppedNodeIds.has(node.id) ||
                        Boolean(node.metadata?.workflowProducerNodeId && stoppedNodeIds.has(node.metadata.workflowProducerNodeId)) ||
                        Boolean(node.metadata?.workflowOutputNodeIds?.some((id) => stoppedNodeIds.has(id)));
                    if (!related) continue;
                    const before = stoppedNodeIds.size;
                    stoppedNodeIds.add(node.id);
                    if (node.metadata?.workflowProducerNodeId) stoppedNodeIds.add(node.metadata.workflowProducerNodeId);
                    node.metadata?.workflowOutputNodeIds?.forEach((id) => stoppedNodeIds.add(id));
                    if (stoppedNodeIds.size !== before) expanded = true;
                }
            }
            const tasks = [...new Map(pendingCanvasTasks(nodesRef.current).filter((task) => stoppedNodeIds.has(task.nodeId)).map((task) => [`${task.kind}:${task.taskId}`, task])).values()];
            if (tasks.length) {
                const results = await Promise.allSettled(tasks.map((task) => cancelPersistedCanvasTask(task.taskId, task.kind)));
                const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
                if (failures.length === tasks.length) {
                    throw failures[0]?.reason || new Error(t("canvas.projectPage.stopFailed"));
                }
                if (failures.length) {
                    message.error(failures[0].reason instanceof Error ? failures[0].reason.message : t("canvas.projectPage.stopFailed"));
                }
            }
            if (tasks.length) {
                generationRequestsRef.current.forEach((request) => {
                    if (!stoppedNodeIds.has(request.targetNodeId) && !stoppedNodeIds.has(request.originNodeId) && !stoppedNodeIds.has(request.runningNodeId)) return;
                    const submitted = [request.targetNodeId, request.originNodeId, request.runningNodeId]
                        .map((id) => nodesRef.current.find((node) => node.id === id))
                        .some((node) => node && hasSubmittedCanvasTask(node, nodesRef.current));
                    if (submitted) request.controller.abort();
                });
            }
            finalizeCanceledGenerationNodes(stoppedNodeIds);
            setRunningNodeIds((current) => {
                const next = new Set(current);
                stoppedNodeIds.forEach((id) => next.delete(id));
                return next;
            });
            setStopConfirm(null);
            message.info(t("canvas.generation.canceled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.projectPage.stopFailed"));
        } finally {
            setStopSubmitting(false);
        }
    }, [finalizeCanceledGenerationNodes, message, stopConfirm?.nodeId, stopSubmitting, t]);

    const stopWorkflow = useCallback(() => {
        workflowExecutionTokenRef.current += 1;
        const checkpoint = workflowCheckpointRef.current;
        const runningOrQueued = nodesRef.current.filter((node) => node.metadata?.executionStatus === "queued" || node.metadata?.executionStatus === "running").map((node) => node.id);
        const activeWorkflowNodeIds = new Set([...(checkpoint?.nodeIds || []), ...runningOrQueued]);
        const submittedTasks = new Map<string, PendingCanvasTask>();
        workflowRunTaskIdsRef.current.forEach((taskId) => submittedTasks.set(`image:${taskId}`, { nodeId: "", taskId, kind: "image" }));
        pendingCanvasTasks(nodesRef.current).forEach((task) => {
            const node = nodesRef.current.find((item) => item.id === task.nodeId);
            const belongsToWorkflow =
                activeWorkflowNodeIds.has(task.nodeId) ||
                Boolean(node?.metadata?.workflowProducerNodeId && activeWorkflowNodeIds.has(node.metadata.workflowProducerNodeId)) ||
                nodesRef.current.some((item) => activeWorkflowNodeIds.has(item.id) && item.metadata?.workflowOutputNodeIds?.includes(task.nodeId));
            if (belongsToWorkflow) submittedTasks.set(`${task.kind}:${task.taskId}`, task);
        });
        workflowRunRef.current = {
            cancelQueued: true,
            stopped: true,
            executing: false,
            lockLost: workflowRunRef.current.lockLost,
            canceledNodeIds: new Set([...workflowRunRef.current.canceledNodeIds, ...runningOrQueued]),
        };
        const cancellations = [...submittedTasks.values()].map((task) => cancelPersistedCanvasTask(task.taskId, task.kind));
        generationRequestsRef.current.forEach((request) => {
            const submitted = [request.targetNodeId, request.originNodeId, request.runningNodeId]
                .map((id) => nodesRef.current.find((node) => node.id === id))
                .some((node) => node && hasSubmittedCanvasTask(node, nodesRef.current));
            if (submitted) request.controller.abort();
        });
        workflowRunTaskIdsRef.current.clear();
        workflowSubmittedNodeIdsRef.current.clear();
        if (cancellations.length) {
            void Promise.allSettled(cancellations).then((results) => {
                const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
                if (failure) message.error(failure.reason instanceof Error ? failure.reason.message : t("canvas.projectPage.stopFailed"));
            });
        }
        finalizeCanceledGenerationNodes();
        setRunningNodeIds(new Set());
        workflowPlanRef.current = null;
        if (checkpoint) {
            setWorkflowRun({
                status: "running",
                completed: checkpoint.completedNodeIds.length,
                total: checkpoint.nodeIds.length,
                running: 0,
                queued: 0,
                canceling: true,
                startedAt: checkpoint.startedAt,
            });
            void beginWorkflowStop(checkpoint).catch(() => undefined);
            return;
        }
        releaseWorkflowBrowserLock();
        setWorkflowRun({ status: "canceled", completed: 0, total: 0, running: 0, queued: 0 });
        message.info(t("canvas.workflow.canceled"));
    }, [beginWorkflowStop, finalizeCanceledGenerationNodes, message, releaseWorkflowBrowserLock, t]);
    stopWorkflowAgentRef.current = () => {
        const checkpoint = workflowCheckpointRef.current;
        const state = workflowRunStateRef.current;
        const activeNodeIds = nodesRef.current
            .filter((node) => node.metadata?.executionStatus === "queued" || node.metadata?.executionStatus === "running" || node.metadata?.status === NODE_STATUS_LOADING)
            .map((node) => node.id);
        const nodeIds = [...new Set([...(checkpoint?.nodeIds || []), ...activeNodeIds])];
        const active = Boolean(checkpoint || nodeIds.length || state.status === "running" || state.status === "locked");
        if (!active) return { stopped: false, status: state.status || "idle", nodeIds: [] };
        stopWorkflow();
        return { stopped: true, status: "canceling", nodeIds };
    };

    const requestStopWorkflow = useCallback(() => {
        const queuedCount = collectUnsubmittedWorkflowNodeIds().size;
        const submittedRunning = nodesRef.current.some((node) => hasSubmittedCanvasTask(node, nodesRef.current) && isInFlightCanvasGeneration(node) && node.metadata?.executionStatus !== "queued");
        if (queuedCount > 0 && !submittedRunning) {
            stopUnsubmittedWorkflowWork();
            message.info(t("canvas.workflow.queuedNodesCanceled", { count: queuedCount }));
            return;
        }
        if (submittedRunning) {
            setStopConfirm({ kind: "workflow", queuedCount });
            return;
        }
        stopWorkflow();
    }, [collectUnsubmittedWorkflowNodeIds, message, stopUnsubmittedWorkflowWork, stopWorkflow, t]);

    const stopAllCanvasTasks = useCallback(async (options?: { keepalive?: boolean }) => {
        const checkpoint = workflowCheckpointRef.current;
        const lockedRun = workflowRunStateRef.current.status === "locked" ? lockedWorkflowRunRef.current : null;
        const submittedTasks = new Map<string, PendingCanvasTask>();
        workflowRunTaskIdsRef.current.forEach((taskId) => submittedTasks.set(`image:${taskId}`, { nodeId: "", taskId, kind: "image" }));
        pendingCanvasTasks(nodesRef.current).forEach((task) => submittedTasks.set(`${task.kind}:${task.taskId}`, task));

        workflowExecutionTokenRef.current += 1;
        workflowRunRef.current = {
            cancelQueued: true,
            stopped: true,
            executing: false,
            lockLost: workflowRunRef.current.lockLost,
            canceledNodeIds: new Set(nodesRef.current.filter((node) => node.metadata?.executionStatus === "queued" || node.metadata?.executionStatus === "running").map((node) => node.id)),
        };
        generationRequestsRef.current.forEach((request) => request.controller.abort());
        const cancellations: Promise<unknown>[] = [
            stopHostedAgentRunForCanvas(projectId, options),
            ...[...submittedTasks.values()].map((task) => cancelPersistedCanvasTask(task.taskId, task.kind, options)),
        ];

        const finalizeLocalStop = () => {
            generationRequestsRef.current.clear();
            workflowRunTaskIdsRef.current.clear();
            workflowSubmittedNodeIdsRef.current.clear();
            workflowPendingIdsRef.current.clear();
            workflowPlanRef.current = null;
            finalizeCanceledGenerationNodes();
            setRunningNodeIds(new Set());
        };

        if (options?.keepalive) {
            finalizeLocalStop();
            if (checkpoint) {
                setWorkflowRun({ status: "canceled", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, running: 0, queued: 0, startedAt: checkpoint.startedAt });
                workflowCheckpointRef.current = null;
                updateProject(projectId, { workflowRun: null });
                releaseWorkflowBrowserLock();
                if (checkpoint.runId) {
                    cancellations.push(updateCanvasWorkflowRun(projectId, checkpoint.runId, {
                        ownerId: lockedRun?.ownerId || workflowOwnerId,
                        status: "canceled",
                        completedNodeIds: checkpoint.completedNodeIds,
                        canceledNodeIds: checkpoint.canceledNodeIds,
                        currentNodeId: checkpoint.currentNodeId,
                    }, options));
                }
            } else {
                releaseWorkflowBrowserLock();
                setWorkflowRun({ status: "canceled", completed: 0, total: 0, running: 0, queued: 0 });
            }
            await Promise.allSettled(cancellations);
            return;
        }

        const results = await Promise.allSettled(cancellations);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failure) throw failure.reason;
        finalizeLocalStop();
        if (checkpoint) {
            setWorkflowRun({ status: "running", completed: checkpoint.completedNodeIds.length, total: checkpoint.nodeIds.length, running: 0, queued: 0, canceling: true, startedAt: checkpoint.startedAt });
            if (lockedRun && lockedRun.id === checkpoint.runId) {
                await updateCanvasWorkflowRun(projectId, lockedRun.id, {
                    ownerId: lockedRun.ownerId,
                    status: "canceled",
                    completedNodeIds: lockedRun.completedNodeIds,
                    canceledNodeIds: lockedRun.canceledNodeIds,
                    currentNodeId: lockedRun.currentNodeId || undefined,
                });
                lockedWorkflowRunRef.current = null;
                workflowCheckpointRef.current = null;
                updateProject(projectId, { workflowRun: null });
                releaseWorkflowBrowserLock();
                setWorkflowRun({ status: "canceled", completed: lockedRun.completedNodeIds.length, total: lockedRun.nodeIds.length, running: 0, queued: 0, startedAt: lockedRun.startedAt });
            } else {
                await beginWorkflowStop(checkpoint);
            }
        } else {
            releaseWorkflowBrowserLock();
            setWorkflowRun({ status: "canceled", completed: 0, total: 0, running: 0, queued: 0 });
        }
        await flushCanvasPersistence();
    }, [beginWorkflowStop, finalizeCanceledGenerationNodes, projectId, releaseWorkflowBrowserLock, updateProject, workflowOwnerId]);

    const shouldBlockCanvasLeave = useCallback<BlockerFunction>(
        ({ currentLocation, nextLocation }) => shouldBlockCanvasNavigation(currentLocation.pathname, nextLocation.pathname, agentRunning, leavingCanvasPageRef.current),
        [agentRunning],
    );
    const navigationBlocker = useBlocker(shouldBlockCanvasLeave);

    useEffect(() => {
        if (!agentRunning) return;
        const warnBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        const stopAfterConfirmedUnload = () => {
            leavingCanvasPageRef.current = true;
            void stopAllCanvasTasks({ keepalive: true }).catch(() => undefined);
        };
        window.addEventListener("beforeunload", warnBeforeUnload);
        window.addEventListener("pagehide", stopAfterConfirmedUnload);
        return () => {
            window.removeEventListener("beforeunload", warnBeforeUnload);
            window.removeEventListener("pagehide", stopAfterConfirmedUnload);
        };
    }, [agentRunning, stopAllCanvasTasks]);

    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            const localProducer = node.metadata?.workflowProducerNodeId
                ? nodesRef.current.find((item) => item.id === node.metadata?.workflowProducerNodeId && isCanvasLocalImageOperation(item.metadata?.localImageOperation))
                : isCanvasLocalImageOperation(node.metadata?.localImageOperation)
                  ? node
                  : undefined;
            if (localProducer) {
                await generateNodeRef.current?.(localProducer.id, "image", "");
                return;
            }
            if (!isCanvasNodeTypeEnabled(node.type)) {
                message.warning(t("canvas.projectPage.mediaUnavailable"));
                return;
            }
            const retryMode = node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image";
            if (!(await requestCostConfirm({ config: buildGenerationConfig(effectiveConfig, node, retryMode), kind: retryMode === "text" ? "text" : "image", count: 1 }))) return;
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? node.metadata : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? applyCanvasImageModelSettings(
                          {
                              ...effectiveConfig,
                              model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                              quality: savedImageMetadata.quality || effectiveConfig.quality,
                              size: savedImageMetadata.size || effectiveConfig.size,
                              resolution: savedImageMetadata.resolution || effectiveConfig.resolution,
                              background: savedImageMetadata.background ?? effectiveConfig.background,
                              count: "1",
                          },
                          modelOptionMeta(effectiveConfig, savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model),
                      )
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error(t("canvas.projectPage.referenceMissing"));
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: item.metadata?.content ? undefined : t("canvas.projectPage.referenceMissing"), images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("canvas.projectPage.referenceMissing") } : image)) } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeIds((current) => new Set(current).add(node.id));
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_LOADING, errorDetails: undefined } : image)) } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: controller.signal, onCreated: (taskId) => persistCanvasTaskId(node.id, taskId, undefined, "assistant") },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS, taskId: undefined, taskKind: undefined } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: controller.signal }));
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      width: videoSize.width,
                                      height: videoSize.height,
                                      position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
                                      metadata: {
                                          ...item.metadata,
                                          ...videoMetadata(video),
                                          prompt,
                                          model: generationConfig.model,
                                          size: generationConfig.size,
                                          seconds: generationConfig.videoSeconds,
                                          vquality: generationConfig.vquality,
                                          generateAudio: generationConfig.videoGenerateAudio,
                                          watermark: generationConfig.videoWatermark,
                                      },
                                  }
                                : item,
                        ),
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const retryRequestOptions = {
                    signal: controller.signal,
                    onCreated: (taskId: string) => persistCanvasTaskId(node.id, taskId, imageId),
                    // Explicit retry click: a fresh nonce intentionally creates a new task.
                    idempotencyKey: canvasManualTaskKey(projectId, node.id, createCanvasTaskNonce(), imageId ?? 0),
                };
                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, undefined, retryRequestOptions).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, retryRequestOptions).then((items) => items[0]);
                const uploadedImage = await adoptGeneratedImage(image);
                const retryImage: CanvasNodeImage = {
                    id: imageId || node.metadata?.primaryImageId || nanoid(),
                    status: NODE_STATUS_SUCCESS,
                    content: uploadedImage.url,
                    storageKey: uploadedImage.storageKey,
                    thumbnailUrl: uploadedImage.thumbnailUrl,
                    thumbnailKey: uploadedImage.thumbnailKey,
                    naturalWidth: uploadedImage.width,
                    naturalHeight: uploadedImage.height,
                    bytes: uploadedImage.bytes,
                    mimeType: uploadedImage.mimeType,
                };
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          resolution: generationConfig.resolution,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const makePrimary = !imageId || !item.metadata?.content;
                        const imageSize = resultNodeSize(item, uploadedImage.width, uploadedImage.height);
                        return {
                            ...item,
                            type: CanvasNodeType.Image,
                            ...(makePrimary ? { width: imageSize.width, height: imageSize.height, ...(imageId ? { position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 } } : {}) } : {}),
                            metadata: {
                                ...item.metadata,
                                ...(makePrimary ? imageMetadata(uploadedImage) : { status: NODE_STATUS_SUCCESS }),
                                images: item.metadata?.images?.map((current) => (current.id === retryImage.id ? retryImage : current)),
                                primaryImageId: makePrimary ? retryImage.id : item.metadata?.primaryImageId,
                                prompt,
                                ...generationMetadata,
                            },
                        };
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    if (!leavingCanvasPageRef.current) finalizeCanceledGenerationNodes(new Set([node.id]));
                    return;
                }
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: item.metadata?.content ? undefined : errorDetails, images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeIds((current) => {
                    const next = new Set(current);
                    next.delete(node.id);
                    return next;
                });
            }
        },
        [effectiveConfig, finalizeCanceledGenerationNodes, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, persistCanvasTaskId, projectId, requestCostConfirm, startGenerationRequest, t],
    );

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if ((node?.metadata?.images?.length || 0) <= 2) setExpandedImageNodeId(null);
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                const images = item.metadata?.images?.filter((image) => image.id !== imageId) || [];
                const deletingPrimary = item.metadata?.primaryImageId === imageId || item.metadata?.content === item.metadata?.images?.find((image) => image.id === imageId)?.content;
                const nextPrimary = deletingPrimary ? images.find((image) => image.status === "success" && (image.content || image.storageKey)) || images.find((image) => image.content || image.storageKey) || images[0] : images.find((image) => image.id === item.metadata?.primaryImageId);
                return {
                    ...item,
                    metadata: {
                        ...item.metadata,
                        images,
                        count: images.length,
                        primaryImageId: nextPrimary?.id,
                        ...(deletingPrimary
                            ? nextPrimary
                                ? {
                                      content: nextPrimary.content,
                                      storageKey: nextPrimary.storageKey,
                                      thumbnailUrl: nextPrimary.thumbnailUrl,
                                      naturalWidth: nextPrimary.naturalWidth,
                                      naturalHeight: nextPrimary.naturalHeight,
                                      bytes: nextPrimary.bytes,
                                      mimeType: nextPrimary.mimeType,
                                      status: nextPrimary.status === "error" ? NODE_STATUS_ERROR : nextPrimary.content ? NODE_STATUS_SUCCESS : NODE_STATUS_LOADING,
                                  }
                                : { content: undefined, storageKey: undefined, thumbnailUrl: undefined, status: NODE_STATUS_ERROR }
                            : {}),
                    },
                };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.emptyTextImage"));
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    resolution: effectiveConfig.resolution,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.resolution, effectiveConfig.size, message, t],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = await adoptGeneratedImage(image);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = cardSizeForMedia(meta.width, meta.height);
            const center = getCanvasCenter();
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [getCanvasCenter],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string) => {
            const center = getCanvasCenter();
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [getCanvasCenter],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title);
            } else if (payload.kind === "video") {
                if (!CANVAS_VIDEO_ENABLED) {
                    message.warning(t("canvas.projectPage.mediaUnavailable"));
                    return;
                }
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = getCanvasCenter();
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [getCanvasCenter, insertAssistantImage, insertAssistantText, message, t],
    );

    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData, image?: CanvasNodeImage) => {
        setPreviewNodeId(node.id);
        setPreviewImageId(image?.id || null);
    }, []);
    const handleNodeRetry = useCallback((node: CanvasNodeData) => void handleRetryNode(node), [handleRetryNode]);
    const configureOperationNode = useCallback((node: CanvasNodeData) => {
        const imageCount = getInputSummary(buildNodeGenerationInputs(node.id, nodesRef.current, connectionsRef.current)).imageCount;
        if (imageCount !== 1) {
            message.warning(imageCount > 1 ? t("canvas.configNode.singleImageOnly") : t("canvas.workflow.localImageInputMissing"));
            return;
        }
        if (node.type === CanvasOperationNodeType.Crop) setCropNodeId(node.id);
        else if (node.type === CanvasOperationNodeType.Split) setSplitNodeId(node.id);
        else if (node.type === CanvasOperationNodeType.Upscale) setUpscaleNodeId(node.id);
        else if (node.type === CanvasOperationNodeType.Angle) setAngleNodeId(node.id);
    }, [message, t]);
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedNodeIds((current) => (current.has(nodeId) ? current : new Set([nodeId])));
        setSelectedConnectionId(null);
        setToolbarNodeId(nodeId);
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, []);
    const handleConnectionSelect = useCallback((event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
        const additive = event.shiftKey || event.metaKey || event.ctrlKey;
        setSelectedConnectionIds((current) => {
            if (!additive) return new Set([connectionId]);
            const next = new Set(current);
            next.has(connectionId) ? next.delete(connectionId) : next.add(connectionId);
            return next;
        });
        setSelectedNodeIds(new Set());
        setContextMenu(null);
    }, []);
    const handleConnectionContextMenu = useCallback((event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
        setSelectedConnectionIds((current) => (current.has(connectionId) ? current : new Set([connectionId])));
        setSelectedNodeIds(new Set());
        setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId });
    }, []);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : isCanvasExecutableNode(panelNode) ? (
                isCanvasOperationNodeType(panelNode.type) ? null : (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                />
                )
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    isRunning={runningNodeIds.has(panelNode.id)}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStopGeneration={requestStopGeneration}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                />
            ),
        [configInputsById, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, renderPluginPanel, requestStopGeneration, runningNodeIds],
    );

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => (
            <CanvasConfigNodePanel
                node={contentNode}
                outputNode={contentNode.metadata?.inlineOutputNodeId ? nodeById.get(contentNode.metadata.inlineOutputNodeId) : undefined}
                isRunning={runningNodeIds.has(contentNode.id)}
                inputs={configInputsById.get(contentNode.id) || []}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                onConfigChange={handleConfigNodeChange}
                onConfigureOperation={configureOperationNode}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onCancelQueued={cancelQueuedWorkflowNode}
                onStopGeneration={requestStopGeneration}
                onGenerate={(nodeId) => {
                    const target = nodesRef.current.find((item) => item.id === nodeId);
                    const requested = target?.metadata?.generationMode || "image";
                    const mode = isCanvasGenerationModeEnabled(requested) ? requested : "image";
                    void handleGenerateNode(nodeId, mode, target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                }}
            />
        ),
        [cancelQueuedWorkflowNode, configInputsById, configureOperationNode, handleConfigNodeChange, handleGenerateNode, nodeById, requestStopGeneration, runningNodeIds],
    );

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="relative flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel
                projectId={projectId}
                nodes={visibleNodes}
                connections={displayConnections}
                selectedNodeIds={selectedNodeIds}
                onFocusNode={focusNode}
                onPreviewNode={(nodeId) => {
                    setPreviewImageId(null);
                    setPreviewNodeId(nodeId);
                }}
                onRenameNode={(nodeId) => {
                    const node = nodesRef.current.find((item) => item.id === nodeId);
                    if (node) openNodeRename(node);
                }}
                onDeleteNodes={deleteNodes}
                onInsertAsset={handleAssetInsert}
            />
            {agentPanelOpen || agentPanelClosing ? <AgentPanel /> : null}
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    onRename={() => startEditingProject(projectId, currentProjectTitle || t("canvas.projectPage.untitledCanvas"))}
                    agentOpen={agentPanelOpen}
                    onToggleAgent={toggleAgentPanel}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onUpload={() => handleUploadRequest()}
                    onExportProject={exportCurrentProject}
                    onClear={() => setClearConfirmOpen(true)}
                    workflowRun={workflowRun}
                    onRunWorkflow={() => void runWorkflow()}
                    onStopWorkflow={requestStopWorkflow}
                    onRefreshWorkflow={() => window.location.reload()}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                >
                    <CanvasToolbar
                        selectedCount={selectedNodeIds.size}
                        canvasTool={canvasTool}
                        canUndo={historyState.canUndo}
                        canRedo={historyState.canRedo}
                        onProjects={() => navigate("/canvas")}
                        onCreateProject={createAndOpenProject}
                        onAddImage={() => createNode(CanvasNodeType.Image)}
                        onAddText={() => createNode(CanvasNodeType.Text)}
                        onAddConfig={() => createNode(CanvasNodeType.Config)}
                        onAddGroup={() => createNode(CanvasNodeType.Group)}
                        onAddExtensionNode={(type) => createNode(type)}
                        onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                        onUndo={undoCanvas}
                        onRedo={redoCanvas}
                        onCanvasToolChange={setCanvasTool}
                    />
                </CanvasTopBar>

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    viewportApiRef={viewportApiRef}
                    onLiveViewport={(next) => {
                        viewportRef.current = next;
                    }}
                    onViewportInteractionChange={(busy) => {
                        viewportInteractingRef.current = busy;
                        setViewportBusy(busy);
                    }}
                    onViewportChange={(next) => {
                        viewportRef.current = next;
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0, left: connectionLayer.left, top: connectionLayer.top, width: connectionLayer.width, height: connectionLayer.height }} viewBox={`${connectionLayer.left} ${connectionLayer.top} ${connectionLayer.width} ${connectionLayer.height}`}>
                        {displayConnections
                            .map((connection) => {
                                const from = displayNodeById.get(connection.fromNodeId);
                                const to = displayNodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionIds.has(connection.id) || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={handleConnectionSelect}
                                        onContextMenu={handleConnectionContextMenu}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={displayNodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? displayNodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            isDragging={isNodeDragging && dragRef.current.initialPositionsById.has(node.id)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={expandedImageNodeId === node.id}
                            showImageInfo={showImageInfo}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderNodePanel}
                            renderNodeContent={renderNodeContentPanel}
                            onMouseDown={handleNodeMouseDown}
                            onSelectCapture={handleNodeSelectCapture}
                            onHoverStart={handleNodeHoverStart}
                            onHoverEnd={handleNodeHoverEnd}
                            onConnectStart={handleConnectStart}
                            onResizeStart={handleNodeResizeStart}
                            onResize={handleNodeResize}
                            onResizeEnd={handleNodeResizeEnd}
                            onContentChange={handleNodeContentChange}
                            onRenameRequest={openNodeRename}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onDuplicateBatchImage={duplicateBatchImage}
                            onDownloadBatchImage={downloadBatchImage}
                            onRetryBatchImage={retryBatchImage}
                            onDeleteBatchImage={deleteBatchImage}
                            onRetry={handleNodeRetry}
                            onTogglePanel={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                            onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                            onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                            onGenerateImage={generateImageFromTextNode}
                            onViewImage={handleNodeViewImage}
                            onContextMenu={handleNodeContextMenu}
                        />
                    ))}

                    {selectionBox ? (
                        <svg
                            className="pointer-events-none absolute z-[100] overflow-visible"
                            style={{ left: 0, top: 0, width: 1, height: 1 }}
                        >
                            <rect ref={selectionRectRef} x={selectionBox.startWorldX} y={selectionBox.startWorldY} width={0} height={0} fill={theme.canvas.selectionFill} stroke={theme.canvas.selectionStroke} strokeOpacity={0.55} strokeWidth={1 / viewport.k} strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`} />
                        </svg>
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || isNodeResizing || expandedImageNodeId || viewportBusy ? null : toolbarNode}
                    viewport={viewport}
                    extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onRename={openNodeRename}
                    onEditText={openTextEditor}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onRemoveBackground={(node) => void removeBackgroundFromImageNode(node)}
                    backgroundRemovalAvailable={canRemoveBackground}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => handleNodeViewImage(node)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}>
                    <Minimap active={isMiniMapOpen} nodes={visibleNodes} connections={displayConnections} viewport={viewport} viewportSize={size} viewportApiRef={viewportApiRef} />
                </CanvasZoomControls>

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        connectionCount={contextMenu.type === "connection" ? selectedConnectionIds.size : 1}
                        onClose={() => setContextMenu(null)}
                        onRename={contextNode ? () => (openNodeRename(contextNode), setContextMenu(null)) : undefined}
                        onEdit={contextNodeCanEdit && contextNode ? () => {
                            if (contextNode.type === CanvasNodeType.Text) openTextEditor(contextNode);
                            else setDialogNodeId(contextNode.id);
                            setContextMenu(null);
                        } : undefined}
                        onPreview={contextNode?.type === CanvasNodeType.Image && contextNode.metadata?.content ? () => (handleNodeViewImage(contextNode), setContextMenu(null)) : undefined}
                        onDownload={contextNode?.metadata?.content && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(contextNode.type as CanvasNodeType) ? () => (downloadNodeImage(contextNode), setContextMenu(null)) : undefined}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnections(new Set(selectedConnectionIds));
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple accept={[CANVAS_VIDEO_ENABLED ? "video/*" : "", CANVAS_AUDIO_ENABLED ? "audio/*" : "", "image/*"].filter(Boolean).join(",")} className="hidden" onChange={handleImageInputChange} />

                <CanvasCostConfirmDialog cost={costConfirm} onCancel={() => finishCostConfirm(false)} onConfirm={(options) => void handleCostConfirm(options)} />

                <CanvasHomeDialog
                    open={Boolean(renameDialog)}
                    onClose={() => setRenameDialog(null)}
                    eyebrow={t("canvas.nodeToolbar.rename")}
                    title={t("canvas.nodeToolbar.renameTitle")}
                    closeLabel={t("common.cancel")}
                    footer={
                        <>
                            <button type="button" className="sc-cd-btn" onClick={() => setRenameDialog(null)}>
                                {t("common.cancel")}
                            </button>
                            <button type="button" className="sc-cd-btn is-solid" onClick={saveNodeRename}>
                                {t("common.save")}
                            </button>
                        </>
                    }
                >
                    <label className="sc-cd-field">
                        <span>{t("canvas.nodeToolbar.name")}</span>
                        <input
                            value={renameDialog?.title || ""}
                            maxLength={64}
                            autoFocus
                            onChange={(event) => setRenameDialog((current) => (current ? { ...current, title: event.target.value } : current))}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") saveNodeRename();
                                if (event.key === "Escape") setRenameDialog(null);
                            }}
                            placeholder={t("canvas.node.untitled")}
                        />
                    </label>
                </CanvasHomeDialog>

                <CanvasNodeCropDialog
                    dataUrl={cropDialogNode?.metadata?.content || ""}
                    open={Boolean(cropNode && cropDialogNode?.metadata?.content)}
                    initialCrop={cropInitialParams}
                    onClose={() => setCropNodeId(null)}
                    onConfirm={(crop) => {
                        if (cropNode?.type === CanvasOperationNodeType.Crop) {
                            handleConfigNodeChange(cropNode.id, { localImageOperationParams: { ...crop }, localImageOperationCompletedCount: 0, count: 1, status: NODE_STATUS_IDLE, executionStatus: undefined, errorDetails: undefined });
                            setCropNodeId(null);
                        } else if (cropNode) void cropImageNode(cropNode, crop);
                    }}
                />

                <CanvasNodeMaskEditDialog
                    dataUrl={maskEditDialogNode?.metadata?.content || ""}
                    open={Boolean(maskEditNode?.metadata?.content)}
                    onClose={() => setMaskEditNodeId(null)}
                    onConfirm={(payload) => {
                        if (maskEditNode) void maskEditImageNode(maskEditNode, payload);
                    }}
                />

                <CanvasNodeSplitDialog
                    dataUrl={splitDialogNode?.metadata?.content || ""}
                    open={Boolean(splitNode && splitDialogNode?.metadata?.content)}
                    initialParams={splitInitialParams}
                    onClose={() => setSplitNodeId(null)}
                    onConfirm={(params) => {
                        if (splitNode?.type === CanvasOperationNodeType.Split) {
                            handleConfigNodeChange(splitNode.id, { localImageOperationParams: { ...params }, localImageOperationCompletedCount: 0, count: canvasLocalImageOperationOutputCount("split", params), status: NODE_STATUS_IDLE, executionStatus: undefined, errorDetails: undefined });
                            setSplitNodeId(null);
                        } else if (splitNode) void splitImageNode(splitNode, params);
                    }}
                />

                <CanvasNodeUpscaleDialog
                    dataUrl={upscaleDialogNode?.metadata?.content || ""}
                    open={Boolean(upscaleNode && upscaleDialogNode?.metadata?.content)}
                    initialParams={upscaleInitialParams}
                    onClose={() => setUpscaleNodeId(null)}
                    onConfirm={(params) => {
                        if (upscaleNode?.type === CanvasOperationNodeType.Upscale) {
                            handleConfigNodeChange(upscaleNode.id, { localImageOperationParams: { ...params }, localImageOperationCompletedCount: 0, count: 1, status: NODE_STATUS_IDLE, executionStatus: undefined, errorDetails: undefined });
                            setUpscaleNodeId(null);
                        } else if (upscaleNode) void upscaleImageNode(upscaleNode, params);
                    }}
                />

                <CanvasNodeAngleDialog
                    dataUrl={angleDialogNode?.metadata?.content || ""}
                    open={Boolean(angleNode && angleDialogNode?.metadata?.content)}
                    initialParams={angleInitialParams}
                    onClose={() => setAngleNodeId(null)}
                    onConfirm={(params) => {
                        if (angleNode?.type === CanvasOperationNodeType.Angle) {
                            const prompt = buildAnglePrompt(params);
                            setNodes((current) => current.map((node) => node.id === angleNode.id ? { ...applyNodeConfigPatch(node, { imageAngleParams: { ...params }, composerContent: prompt, prompt, count: 1, status: NODE_STATUS_IDLE, executionStatus: undefined, errorDetails: undefined }), title: `${t("canvas.operationNodes.angle")} · ${buildAngleLabel(params)}` } : node));
                            setAngleNodeId(null);
                        } else if (angleNode) void generateAngleNode(angleNode, params);
                    }}
                />

                <CanvasImageLightbox node={previewNode} image={previewImage} open={Boolean(previewImage?.content || previewNode?.metadata?.content)} onClose={() => {
                    setPreviewImageId(null);
                    setPreviewNodeId(null);
                }} />

                <CanvasHomeDialog
                    open={navigationBlocker.state === "blocked"}
                    onClose={() => {
                        if (!leaveSubmitting && navigationBlocker.state === "blocked") navigationBlocker.reset();
                    }}
                    tone="danger"
                    eyebrow={t("canvas.projectPage.leaveEyebrow")}
                    title={t("canvas.projectPage.leaveTitle")}
                    description={t("canvas.projectPage.leaveDescription")}
                    closeLabel={t("canvas.projectPage.leaveStay")}
                    footer={
                        <>
                            <button
                                type="button"
                                className="sc-cd-btn"
                                disabled={leaveSubmitting}
                                onClick={() => {
                                    if (navigationBlocker.state === "blocked") navigationBlocker.reset();
                                }}
                            >
                                {t("canvas.projectPage.leaveStay")}
                            </button>
                            <button
                                type="button"
                                className="sc-cd-btn is-danger"
                                disabled={leaveSubmitting}
                                onClick={() => {
                                    if (navigationBlocker.state !== "blocked" || leaveSubmitting) return;
                                    setLeaveSubmitting(true);
                                    void stopAllCanvasTasks()
                                        .then(() => {
                                            leavingCanvasPageRef.current = true;
                                            navigationBlocker.proceed();
                                        })
                                        .catch((error) => {
                                            message.error(error instanceof Error ? error.message : t("canvas.projectPage.leaveStopFailed"));
                                        })
                                        .finally(() => setLeaveSubmitting(false));
                                }}
                            >
                                {leaveSubmitting ? t("canvas.projectPage.leaveStopping") : t("canvas.projectPage.leaveStopAndLeave")}
                            </button>
                        </>
                    }
                />

                <CanvasHomeDialog
                    open={Boolean(stopConfirm)}
                    onClose={() => setStopConfirm(null)}
                    tone="danger"
                    eyebrow={t("canvas.projectPage.stopEyebrow")}
                    title={t("canvas.projectPage.stopTitle")}
                    description={stopConfirm?.kind === "workflow" ? t("canvas.projectPage.stopWorkflowDescription") : t("canvas.projectPage.stopDescription")}
                    closeLabel={t("canvas.project.close")}
                    footer={
                        stopConfirm?.kind === "workflow" ? (
                            <>
                                <button type="button" className="sc-cd-btn" onClick={() => setStopConfirm(null)}>
                                    {t("canvas.projectPage.continue")}
                                </button>
                                <button
                                    type="button"
                                    className="sc-cd-btn is-solid"
                                    disabled={stopSubmitting}
                                    onClick={() => {
                                        setStopConfirm(null);
                                        stopWorkflow();
                                    }}
                                >
                                    {t("canvas.projectPage.stop")}
                                </button>
                            </>
                        ) : (
                            <button type="button" className="sc-cd-btn is-solid" disabled={stopSubmitting} onClick={() => void stopRunningGeneration()}>
                                {t("canvas.projectPage.stop")}
                            </button>
                        )
                    }
                />

                <CanvasHomeDialog
                    open={clearConfirmOpen}
                    onClose={() => setClearConfirmOpen(false)}
                    tone="danger"
                    eyebrow={t("canvas.projectPage.clearEyebrow")}
                    title={t("canvas.projectPage.clearTitle")}
                    description={t("canvas.projectPage.clearDescription")}
                    closeLabel={t("canvas.project.close")}
                    footer={
                        <>
                            <button type="button" className="sc-cd-btn" onClick={() => setClearConfirmOpen(false)}>
                                {t("common.cancel")}
                            </button>
                            <button type="button" className="sc-cd-btn is-danger" onClick={clearCanvas}>
                                <Eraser width={14} height={14} />
                                {t("canvas.projectPage.clear")}
                            </button>
                        </>
                    }
                />

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}

function useHeldValue<T>(value: T | null | undefined): T | null {
    const held = useRef<T | null>(value ?? null);
    if (value) held.current = value;
    return value ?? held.current;
}
