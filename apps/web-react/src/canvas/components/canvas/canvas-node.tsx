import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Clapperboard, Copy, Group, Image as ImageIcon, Minus, Music2, Plus, Puzzle, RefreshCw, Star, Trash2, Video, X } from "lucide-react";
import { DownloadIcon } from "@react/components/common/DownloadIcon.jsx";
import { RegenerateIcon } from "@react/components/common/RegenerateIcon.jsx";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasNodeShadow, CanvasIconWellStyle, colorWash } from "@/lib/canvas-ui";
import { formatGenerationDuration, useGenerationElapsed } from "@/lib/canvas/canvas-generation-elapsed";
import { canvasGenerationStageLabel } from "@/lib/canvas/canvas-generation-stage";
import { formatBytes } from "@/lib/image-utils";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { isCanvasExecutableNode } from "@/lib/canvas/canvas-operation-node";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPreviewImage, CanvasPreviewVideo } from "./canvas-preview-image";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useTranslation } from "react-i18next";
import { getCanvasLiveScale } from "./infinite-canvas";
import { CanvasFloatingLayer } from "./canvas-floating-layer";
import { imageFrameRatio, imageFrameSource } from "@/lib/canvas/canvas-node-size";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type CanvasNodeProps = {
    data: CanvasNodeData;
    transientPosition?: Position;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    isDragging?: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    groupChildCount?: number;
    storyboardGroupStats?: StoryboardGroupStats;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd: (nodeId: string) => void;
    onImageAspect?: (nodeId: string, source: string, ratio: number) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onRenameRequest: (node: CanvasNodeData) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (nodeId: string, imageId: string) => void;
    onDuplicateBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDownloadBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDownload?: (node: CanvasNodeData) => void;
    onRetryBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDeleteBatchImage?: (nodeId: string, imageId: string) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onCancelQueued?: (node: CanvasNodeData) => void;
    onDecreaseFont?: (node: CanvasNodeData) => void;
    onIncreaseFont?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData, image?: CanvasNodeImage) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    onImageAspect?: CanvasNodeProps["onImageAspect"];
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    isSelected?: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onCancelQueued?: (node: CanvasNodeData) => void;
    onDecreaseFont?: (node: CanvasNodeData) => void;
    onIncreaseFont?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (imageId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onDownload?: () => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onViewBatchImage?: (image: CanvasNodeImage) => void;
    groupChildCount: number;
    storyboardGroupStats?: StoryboardGroupStats;
};

type StoryboardGroupShot = {
    index: number;
    title: string;
    status: NonNullable<CanvasNodeMetadata["storyboardStatus"]>;
};

type StoryboardGroupStats = {
    total: number;
    completed: number;
    failed: number;
    canceled: number;
    active: number;
    queued: number;
    shots: StoryboardGroupShot[];
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    transientPosition,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    isDragging = false,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    groupChildCount = 0,
    storyboardGroupStats,
    isGroupDropTarget = false,
    batchExpanded = false,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResizeStart,
    onResize,
    onResizeEnd,
    onImageAspect,
    onContentChange,
    onRenameRequest,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onDownload,
    onRetryBatchImage,
    onDeleteBatchImage,
    onRetry,
    onCancelQueued,
    onDecreaseFont,
    onIncreaseFont,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const nodeElementRef = useRef<HTMLDivElement>(null);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const imageGenerationItems = data.type === CanvasNodeType.Image ? data.metadata?.images || [] : [];
    const imageGenerationCompleted = imageGenerationItems.filter((image) => image.status !== "loading").length;
    const isGroup = data.type === CanvasNodeType.Group;
    const batchCount = data.type === CanvasNodeType.Image ? data.metadata?.images?.length || 0 : 0;
    const isBatchRoot = batchCount > 1;
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    // Transparent nodes such as SVGs blend into the canvas while retaining outlines for selected or related states.
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    // Config cards keep a stable frame while graph hover/focus highlights change.
    const isConfigCard = data.type === CanvasNodeType.Config;
    const posX = transientPosition?.x ?? data.position.x;
    const posY = transientPosition?.y ?? data.position.y;
    const isTransient = Boolean(transientPosition);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
        pointerId: -1,
    });
    const resizeMoveRef = useRef<(event: PointerEvent) => void>(() => undefined);
    const resizeUpRef = useRef<(event?: PointerEvent) => void>(() => undefined);
    const resizeListenerCleanupRef = useRef<(() => void) | null>(null);
    const detachResizeListeners = useCallback(() => {
        resizeListenerCleanupRef.current?.();
        resizeListenerCleanupRef.current = null;
    }, []);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: PointerEvent) => {
            if (!resizeRef.current.isResizing) return;
            if (resizeRef.current.pointerId >= 0 && event.pointerId !== resizeRef.current.pointerId) return;

            const liveScale = getCanvasLiveScale(scale) || 1;
            const dx = (event.clientX - resizeRef.current.startX) / liveScale;
            const dy = (event.clientY - resizeRef.current.startY) / liveScale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const pointerWidth = resizeRef.current.startWidth + (fromLeft ? -dx : dx);
            const pointerHeight = resizeRef.current.startHeight + (fromTop ? -dy : dy);
            let width = Math.max(minWidth, pointerWidth);
            let height = Math.max(minHeight, pointerHeight);
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    width = Math.max(ratio >= 1 ? minWidth : 40, pointerWidth);
                    height = width / ratio;
                } else {
                    height = Math.max(ratio >= 1 ? 40 : minHeight, pointerHeight);
                    width = height * ratio;
                }
                const minRatioWidth = ratio >= 1 ? minWidth : 40;
                const minRatioHeight = ratio >= 1 ? 40 : minHeight;
                if (height < minRatioHeight) {
                    height = minRatioHeight;
                    width = height * ratio;
                }
                if (width < minRatioWidth) {
                    width = minRatioWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(
        (event?: PointerEvent) => {
            if (event && resizeRef.current.pointerId >= 0 && event.pointerId !== resizeRef.current.pointerId) return;
            if (!resizeRef.current.isResizing) return;
            resizeRef.current.isResizing = false;
            resizeRef.current.pointerId = -1;
            detachResizeListeners();
            onResizeEnd(data.id);
        },
        [data.id, detachResizeListeners, onResizeEnd],
    );

    resizeMoveRef.current = handleResizeMove;
    resizeUpRef.current = handleResizeUp;

    const attachResizeListeners = () => {
        detachResizeListeners();
        const move = (event: PointerEvent) => resizeMoveRef.current(event);
        const up = (event: PointerEvent) => resizeUpRef.current(event);
        const blur = () => resizeUpRef.current();
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        window.addEventListener("blur", blur);
        resizeListenerCleanupRef.current = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            window.removeEventListener("blur", blur);
        };
    };

    const handleResizePointerDown = (event: React.PointerEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        onResizeStart(data.id);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: imageFrameRatio(data) || data.width / (data.height || 1),
            pointerId: event.pointerId,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        attachResizeListeners();
    };

    useEffect(() => () => {
        resizeUpRef.current();
        detachResizeListeners();
    }, [detachResizeListeners]);

    return (
        <div
            ref={nodeElementRef}
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col ${isDragging ? "" : "transition-shadow duration-200"} ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate3d(${posX}px, ${posY}px, 0)`,
                width: data.width,
                height: data.height,
                overflow: "visible",
                transition: isDragging ? "none" : "box-shadow 200ms ease",
                willChange: isTransient || isDragging ? "transform" : undefined,
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => onSelectCapture?.(event, data.id)}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            {!isGroup || isSelected || hovered ? (
                <div className="pointer-events-auto absolute left-0 top-[-26px] z-[65] max-w-full px-1" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0 text-left text-[11px] font-semibold leading-5 transition-colors hover:border-current"
                        style={{ color: isSelected ? theme.node.activeStroke : hovered ? theme.node.text : theme.node.label, textShadow: `0 1px 6px ${theme.canvas.background}` }}
                        title={t("canvas.node.renameHint")}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRenameRequest(data);
                        }}
                    >
                        {data.title || t("canvas.node.untitled")}
                    </button>
                </div>
            ) : null}

            <div
                data-canvas-node-shell={data.type}
                className={isGroup ? "relative h-full w-full overflow-visible rounded-[18px] border-[1.5px] border-dashed" : data.type === CanvasNodeType.Image ? "relative h-full w-full overflow-visible rounded-[18px]" : "relative h-full w-full overflow-visible rounded-[18px] border"}
                style={{
                    // Selection decoration must not shrink the image's aspect-correct content box.
                    borderWidth: data.type === CanvasNodeType.Image ? 0 : undefined,
                    outline: data.type === CanvasNodeType.Image ? `1px solid ${isActive ? theme.node.activeStroke : isRelated ? theme.node.muted : hovered ? theme.node.strokeHover : theme.node.stroke}` : undefined,
                    outlineOffset: data.type === CanvasNodeType.Image ? -1 : undefined,
                    background: isGroup ? (theme.scheme === "dark" ? "rgba(255,255,255,.025)" : "rgba(255,255,255,.55)") : transparentBg ? "transparent" : theme.node.fill,
                    borderColor: isConfigCard
                        ? isSelected || isConnectionTarget ? theme.node.activeStroke : hovered ? theme.node.strokeHover : theme.node.stroke
                        : isGroup
                        ? isGroupDropTarget || isActive
                            ? theme.node.activeStroke
                            : theme.node.stroke
                        : isActive
                          ? theme.node.activeStroke
                          : isRelated
                            ? theme.node.muted
                            : transparentBg
                              ? "transparent"
                              : hovered
                                ? theme.node.strokeHover
                                : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroup && !isActive && !isGroupDropTarget
                        ? "none"
                        : isDragging
                          ? "none"
                          : canvasNodeShadow(theme, isGroupDropTarget || isConnectionTarget ? "drop" : isConfigCard ? (isSelected ? "active" : hovered ? "hover" : "idle") : isActive ? "active" : isRelated ? "related" : hovered ? "hover" : "idle"),
                    transition: isDragging ? "none" : "box-shadow 200ms ease, border-color 200ms ease, outline-color 200ms ease",
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup || transparentBg ? "transparent" : theme.node.fill,
                            pointerEvents: contentInteractive ? undefined : "none",
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        onImageAspect={onImageAspect}
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        isSelected={isSelected}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onCancelQueued={onCancelQueued}
                        onDecreaseFont={onDecreaseFont}
                        onIncreaseFont={onIncreaseFont}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={(imageId) => onSetBatchPrimary?.(data.id, imageId)}
                        onDuplicateBatchImage={(imageId) => onDuplicateBatchImage?.(data, imageId)}
                        onDownloadBatchImage={(imageId) => onDownloadBatchImage?.(data, imageId)}
                        onDownload={() => onDownload?.(data)}
                        onRetryBatchImage={(imageId) => onRetryBatchImage?.(data, imageId)}
                        onDeleteBatchImage={(imageId) => onDeleteBatchImage?.(data.id, imageId)}
                        onViewBatchImage={(image) => onViewImage?.(data, image)}
                        groupChildCount={groupChildCount}
                        storyboardGroupStats={storyboardGroupStats}
                    />
                </div>

                {data.metadata?.status === "loading" && hasImageContent ? (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-start rounded-[inherit] p-2.5" style={{ background: "rgba(12,10,20,.32)" }}>
                        <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm" style={{ background: "rgba(255,255,255,.94)", color: "#b45309" }}>
                            <RefreshCw className="size-3 animate-spin" />
                            <span>
                                {data.metadata?.uploading
                                    ? t("canvas.node.uploading")
                                    : canvasGenerationStageLabel(
                                          data.metadata?.generationStage,
                                          imageGenerationItems.length
                                              ? t("canvas.node.regeneratingProgress", { completed: imageGenerationCompleted, total: imageGenerationItems.length })
                                              : t("canvas.node.regenerating"),
                                      )}
                            </span>
                        </div>
                    </div>
                ) : null}

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}

                <ResizeHandle corner="top-left" onPointerDown={handleResizePointerDown} />
                <ResizeHandle corner="top-right" onPointerDown={handleResizePointerDown} />
                <ResizeHandle corner="bottom-left" onPointerDown={handleResizePointerDown} />
                <ResizeHandle corner="bottom-right" onPointerDown={handleResizePointerDown} />
            </div>

            {!isGroup ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} active={isSelected || isConnectionTarget} highlight={isConnectionTarget} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!isGroup ? (
                <ConnectionHandleDot side="right" visible={(definition?.hasSourceHandle ?? true) && (hovered || isSelected || isConnecting)} active={isSelected} onMouseDown={(event) => onConnectStart(event, data.id, "source")} />
            ) : null}

            {showPanel && !isGroup && renderPanel ? (
                <CanvasFloatingLayer anchorRef={nodeElementRef} width={600} gap={16} data-canvas-node-editor={data.id} style={{ borderRadius: 22, boxShadow: theme.toolbar.shadow }}>
                    {renderPanel(data)}
                </CanvasFloatingLayer>
            ) : null}
        </div>
    );
});

function hasVisibleImage(node: NodeContentRendererProps["node"]) {
    return Boolean(node.metadata?.content) || Boolean(node.metadata?.images?.some((image) => image.status === "success" && (image.content || image.storageKey)));
}

function NodeContent(props: NodeContentRendererProps) {
    if (isCanvasExecutableNode(props.node) && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading" && !hasVisibleImage(props.node)) return <LoadingContent node={props.node} theme={props.theme} />;
    if (props.node.metadata?.status === "error" && !hasVisibleImage(props.node)) return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;
    if (
        (props.node.metadata?.storyboardStatus === "queued" || props.node.metadata?.executionStatus === "queued")
        && !hasVisibleImage(props.node)
        && props.node.type === CanvasNodeType.Image
    ) {
        return <QueuedContent node={props.node} theme={props.theme} onCancelQueued={props.onCancelQueued} />;
    }

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // Render plugin nodes with their registered renderer, or show the missing-plugin placeholder.
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function GroupNodeContent({ node, theme, groupChildCount, storyboardGroupStats }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const storyboard = node.metadata?.storyboardId ? node.metadata : null;
    if (storyboard) {
        const stats = storyboardGroupStats;
        const sceneCount = Math.max(1, Number(storyboard.storyboardSceneCount) || Number(stats?.total) || groupChildCount || 1);
        const total = Math.max(sceneCount, Number(stats?.total) || 0);
        const status = storyboard.storyboardStatus || "queued";
        const statusLabel = status === "succeeded"
            ? t("canvas.storyboard.statusSucceeded")
            : status === "failed"
              ? t("canvas.storyboard.statusFailed")
              : status === "canceled"
                ? t("canvas.storyboard.statusCanceled")
                : status === "running"
                  ? t("canvas.storyboard.statusRunning")
                  : t("canvas.storyboard.statusQueued");
        const statusColor = status === "succeeded"
            ? "#22c55e"
            : status === "failed"
              ? "#e5484d"
              : status === "canceled" || status === "queued"
                ? theme.node.muted
                : "#f5a524";
        const title = storyboard.storyboardTitle || node.title || t("canvas.storyboard.title");
        const knownShots = new Map((stats?.shots || []).map((shot) => [shot.index, shot]));
        const fallbackStatus = status === "succeeded" ? "succeeded" as const : status === "failed" ? "failed" as const : status === "canceled" ? "canceled" as const : "queued" as const;
        const shots = Array.from({ length: total }, (_, index) => knownShots.get(index + 1) || { index: index + 1, title: "", status: fallbackStatus });
        const completed = stats?.completed ?? (status === "succeeded" ? total : 0);
        const failed = stats?.failed ?? (status === "failed" ? 1 : 0);
        const active = stats?.active ?? (status === "running" ? Math.max(1, total - completed - failed) : 0);
        const queued = stats?.queued ?? Math.max(0, total - completed - failed - active - (stats?.canceled || 0));
        const footerLabel = failed
            ? `${failed} · ${t("canvas.storyboard.statusFailed")}`
            : active
              ? `${active} · ${t("canvas.storyboard.statusRunning")}`
              : queued
                ? `${queued} · ${t("canvas.storyboard.statusQueued")}`
                : statusLabel;
        const statusTone = (shotStatus: StoryboardGroupShot["status"]) =>
            shotStatus === "succeeded"
                ? "#22c55e"
                : shotStatus === "failed"
                  ? "#e5484d"
                  : shotStatus === "canceled"
                    ? theme.node.muted
                    : shotStatus === "queued"
                      ? theme.node.muted
                      : "#f5a524";
        return (
            <div className="pointer-events-none flex h-full w-full flex-col p-4">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.activeStroke }}>
                        <Clapperboard className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold" style={{ color: theme.node.text }}>{title}</div>
                        <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>
                            {t("canvas.storyboard.canvasGroupMeta", { count: total })}
                        </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="rounded-full px-2 py-1 text-[10px] font-semibold tabular-nums" style={{ background: theme.node.fill, color: theme.node.muted }}>
                            {completed}/{total}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: `${statusColor}18`, color: statusColor }}>
                            <span className={status === "running" ? "animate-pulse" : ""}>●</span>
                            {statusLabel}
                        </span>
                    </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 overflow-hidden" aria-hidden>
                    {shots.slice(0, 10).map((shot) => {
                        const tone = statusTone(shot.status);
                        return <span key={`${shot.index}-${shot.title}`} className="grid size-6 shrink-0 place-items-center rounded-md border text-[10px] font-semibold tabular-nums" style={{ borderColor: `${tone}66`, background: `${tone}18`, color: tone }}>{String(shot.index).padStart(2, "0")}</span>;
                    })}
                    {shots.length > 10 ? <span className="px-1 text-[10px] font-medium" style={{ color: theme.node.muted }}>+{shots.length - 10}</span> : null}
                </div>
                <div className="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-[14px]" style={{ background: theme.toolbar.itemHover }}>
                    <div className="absolute inset-x-4 top-3 flex items-center justify-between gap-3 text-[10px] font-medium" style={{ color: theme.node.muted }}>
                        <span className="truncate">{storyboard.storyboardGlobalStyle || t("canvas.storyboard.title")}</span>
                        <span className="shrink-0 rounded-md border px-1.5 py-0.5 tabular-nums" style={{ borderColor: theme.node.stroke }}>{storyboard.storyboardAspectRatio || "16:9"}</span>
                    </div>
                    <div className="absolute inset-x-4 bottom-3 flex items-center gap-1.5" aria-hidden>
                        {shots.slice(0, 12).map((shot) => {
                            const tone = statusTone(shot.status);
                            return <span key={`bar-${shot.index}-${shot.title}`} className="h-1.5 min-w-0 flex-1 rounded-full" style={{ background: tone }} />;
                        })}
                        {shots.length > 12 ? <span className="h-1.5 w-5 shrink-0 rounded-full" style={{ background: theme.node.stroke }} /> : null}
                    </div>
                    <div className="absolute bottom-6 right-4 text-[10px] tabular-nums" style={{ color: theme.node.muted }}>
                        {footerLabel}
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="pointer-events-none flex h-full w-full flex-col px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: theme.node.muted }}>
                <Group className="size-3.5" />
                <span>{t("canvas.node.group")}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {t("canvas.node.nodeCount", { count: groupChildCount })}
                </span>
            </div>
        </div>
    );
}

function LoadingContent({ node, theme }: Pick<NodeContentRendererProps, "node" | "theme">) {
    const { t } = useTranslation();
    const fallbackStartedAt = useRef(new Date().toISOString()).current;
    const elapsedMs = useGenerationElapsed(node.metadata?.generationStartedAt || fallbackStartedAt, node.metadata?.generationDurationMs, true);
    const isStoryboardShot = Boolean(node.metadata?.storyboardSceneId);
    const stageLabel = node.metadata?.uploading
        ? t("canvas.node.uploading")
        : canvasGenerationStageLabel(node.metadata?.generationStage, t("canvas.node.generating"));

    if (isStoryboardShot) {
        return (
            <div className="relative flex h-full w-full flex-col" style={{ color: theme.node.activeStroke }}>
                <div
                    className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-1.5 px-2.5 py-2"
                    style={{ background: `linear-gradient(180deg, ${theme.node.fill}f2 0%, ${theme.node.fill}00 100%)` }}
                >
                    <RefreshCw className="size-3.5 shrink-0 animate-spin" />
                    <span className="min-w-0 truncate text-[11px] font-medium">{stageLabel}</span>
                    <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums opacity-70">
                        {formatGenerationDuration(elapsedMs)}
                    </span>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center">
                    <div className="size-8 animate-spin rounded-full border-2 opacity-40" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
                </div>
                <StoryboardShotFooter node={node} theme={theme} compact />
            </div>
        );
    }

    return <NodeGeneratingState theme={theme} label={stageLabel} elapsed={formatGenerationDuration(elapsedMs)} />;
}

function NodeGeneratingState({ theme, label, elapsed }: { theme: NodeContentRendererProps["theme"]; label: string; elapsed?: string }) {
    return (
        <div className="canvas-node-shimmer relative flex h-full w-full flex-col items-center justify-center gap-2.5" data-scheme={theme.scheme} style={{ color: theme.node.activeStroke }}>
            <div className="size-6 animate-spin rounded-full border-2" style={{ borderColor: `${theme.node.activeStroke}33`, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[12px] font-semibold">
                {label}
                {elapsed ? <span className="ml-1.5 tabular-nums opacity-70">{elapsed}</span> : null}
            </span>
            <span className="h-[3px] w-28 overflow-hidden rounded-full" style={{ background: `${theme.node.activeStroke}22` }}>
                <span className="canvas-node-progress block h-full rounded-full" style={{ background: theme.node.activeStroke }} />
            </span>
        </div>
    );
}

function QueuedContent({ node, theme, onCancelQueued }: Pick<NodeContentRendererProps, "node" | "theme" | "onCancelQueued">) {
    const { t } = useTranslation();
    const canCancelQueue = Boolean(node.metadata?.storyboardSceneId) && Boolean(onCancelQueued);
    const isStoryboardShot = Boolean(node.metadata?.storyboardSceneId);

    if (isStoryboardShot) {
        return (
            <div className="relative flex h-full w-full flex-col" style={{ color: theme.node.muted }}>
                <div
                    className="absolute inset-x-0 top-0 z-30 flex items-center gap-1.5 px-2 py-2"
                    style={{ background: `linear-gradient(180deg, ${theme.node.fill}f2 0%, ${theme.node.fill}00 100%)` }}
                >
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full px-2 py-1 text-[10px] font-medium" style={{ background: colorWash(theme.node.text, 0.06), color: theme.node.muted }}>
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: theme.node.muted }} />
                        {t("canvas.storyboard.statusQueued")}
                    </span>
                    {canCancelQueue ? (
                        <button
                            type="button"
                            className="canvas-node-overlay-btn ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition hover:opacity-90"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onCancelQueued?.(node);
                            }}
                        >
                            <X className="size-3" />
                            {t("canvas.storyboard.configCancelQueued")}
                        </button>
                    ) : null}
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center opacity-35">
                    <ImageIcon className="size-5" />
                </div>
                <StoryboardShotFooter node={node} theme={theme} compact />
            </div>
        );
    }

    return (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: theme.scheme === "dark" ? "rgba(245,165,36,.14)" : "#fff4e6", color: theme.scheme === "dark" ? "#f5b651" : "#b45309" }}>
                <span className="size-1.5 animate-pulse rounded-full" style={{ background: "#f5a524" }} />
                {t("canvas.storyboard.statusQueued")}
            </span>
        </div>
    );
}

function StoryboardShotFooter({
    node,
    theme,
    compact = false,
}: Pick<NodeContentRendererProps, "node" | "theme"> & { compact?: boolean }) {
    const { t } = useTranslation();
    if (!node.metadata?.storyboardSceneId) return null;
    const index = Math.max(1, Math.floor(Number(node.metadata.storyboardIndex) || 1));
    const title = String(node.metadata.storyboardTitle || node.title || "").trim();
    const summary = String(node.metadata.storyboardSummary || "").trim();
    // Default "medium" is an internal silent fallback — only show framing when
    // the user (or an explicit override) picked a non-default shot scale.
    const shotType = String(node.metadata.storyboardShotType || "").trim();
    if (!title && !summary) return null;
    const shotTypeLabel = shotType && shotType !== "medium" ? shotTypeLabelFor(shotType, t) : "";
    const primary = title.replace(/^\d+\s*[·.]\s*/, "") || title;
    const tooltip = [primary, shotTypeLabel, summary].filter(Boolean).join(" · ");

    return (
        <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 ${compact ? "px-2.5 pb-2 pt-6" : "px-2.5 pb-2.5 pt-8"}`}
            style={{ background: compact ? "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.55) 70%)" : "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.72) 55%)" }}
            title={tooltip}
        >
            <div className="flex min-w-0 items-center gap-1.5">
                <span
                    className="inline-flex h-5 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-bold tabular-nums"
                    style={{ background: "rgba(255,255,255,0.16)", color: "#fff" }}
                >
                    {String(index).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold leading-4" style={{ color: "#fff" }}>
                        {primary || t("canvas.storyboard.inputShotLabel", { index })}
                        {shotTypeLabel ? <span className="font-medium opacity-70">{` · ${shotTypeLabel}`}</span> : null}
                    </div>
                    {!compact && summary ? (
                        <div className="mt-0.5 line-clamp-1 text-[10px] leading-3.5 opacity-85" style={{ color: "rgba(255,255,255,0.82)" }}>
                            {summary}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function shotTypeLabelFor(shotType: string, t: (key: string) => string) {
    switch (shotType) {
        case "wide":
            return t("canvas.storyboard.shotWide");
        case "full":
            return t("canvas.storyboard.shotFull");
        case "medium":
            return t("canvas.storyboard.shotMedium");
        case "close":
            return t("canvas.storyboard.shotClose");
        case "detail":
            return t("canvas.storyboard.shotDetail");
        case "over":
            return t("canvas.storyboard.shotOver");
        default:
            return "";
    }
}

function isCreditInsufficientError(details?: string) {
    const text = String(details || "");
    if (!text) return false;
    return /insufficient_balance|trial_credit_feature_mismatch|余额不足|积分不足|普通积分不足以|体验积分仅限|wallet|recharge|充值/i.test(text);
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const { t } = useTranslation();
    const errorDetails = node.metadata?.errorDetails || t("canvas.node.failed");
    const needsRecharge = isCreditInsufficientError(node.metadata?.errorDetails);
    const dark = theme.scheme === "dark";
    const errorText = dark ? "#ff8a8e" : "#b42318";
    const errorBorder = dark ? "rgba(229,72,77,.38)" : "#f5d0d0";
    const actionClassName = "inline-flex h-7 items-center gap-1.5 rounded-[8px] border px-3 text-[11px] font-semibold transition-colors";

    return (
        <div className="w-full max-w-[320px] px-3">
            <div className="rounded-[12px] border p-3 text-left" style={{ background: dark ? "rgba(229,72,77,.1)" : "#fff6f6", borderColor: errorBorder }}>
                <div className="flex items-start gap-2">
                    <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white" style={{ background: "#e5484d" }}>
                        !
                    </span>
                    <span className="line-clamp-4 min-w-0 text-[12px] leading-5" style={{ color: errorText }}>
                        {errorDetails}
                    </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                    {needsRecharge ? (
                        <a
                            href="/pricing?plan=topup"
                            className={actionClassName}
                            style={{ background: theme.node.activeStroke, borderColor: theme.node.activeStroke, color: "#fff" }}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            {t("canvas.costConfirm.recharge")}
                        </a>
                    ) : null}
                    <button
                        type="button"
                        className={actionClassName}
                        style={{ background: theme.node.panel, borderColor: errorBorder, color: errorText }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRetry?.(node);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <RegenerateIcon className="size-3.5" />
                        {t("canvas.node.retry")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" style={{ color: theme.node.placeholder }}>
            <span className="grid size-8 place-items-center rounded-xl" style={CanvasIconWellStyle("#9aa3b8")}>
                <Puzzle className="size-5" />
            </span>
            <span className="text-[13px] font-medium">{t("canvas.node.missingPlugin")}</span>
            <span className="max-w-[16em] text-[11px] leading-4 opacity-70">{t("canvas.node.missingPluginDescription", { type })}</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, isSelected = false, textareaRef, mentionReferences, onContentChange, onStopEditing, onDecreaseFont, onIncreaseFont }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.72)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;
    const isStoryboardCaption = Boolean(node.metadata?.storyboardSceneId);
    const content = node.metadata?.content || "";
    const charCount = content.replace(/\s/g, "").length;
    const showFontControls = isSelected || isEditingContent;

    return (
        <div className={`relative flex h-full w-full flex-col overflow-hidden ${isStoryboardCaption ? "canvas-storyboard-caption" : ""}`}>
            {isStoryboardCaption ? <span className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ background: theme.node.activeStroke, opacity: 0.72 }} aria-hidden /> : null}
            {isEditingContent ? (
                <div className="mx-2 mt-2 flex min-h-0 flex-1 rounded-[12px]" style={{ background: theme.scheme === "dark" ? "rgba(255,255,255,.04)" : "#f8f7fb" }}>
                    <CanvasResourceMentionTextarea
                        ref={textareaRef}
                        containerClassName="min-h-0 flex-1"
                        className="thin-scrollbar m-0 block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent px-2.5 py-2 outline-none select-text appearance-none"
                        style={textStyle}
                        value={content}
                        references={mentionReferences}
                        highlightLabels={false}
                        onChange={(value) => onContentChange(node.id, value)}
                        onBlur={onStopEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") onStopEditing();
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                        data-canvas-no-zoom
                    />
                </div>
            ) : content ? (
                <div className="thin-scrollbar block min-h-0 w-full flex-1 overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-2 pt-3.5" style={textStyle} data-canvas-no-zoom onWheel={(event) => event.stopPropagation()}>
                    {content}
                </div>
            ) : (
                <div className="mx-3 mt-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border-[1.5px] border-dashed text-[12px] font-semibold" style={{ borderColor: isSelected ? `${theme.node.activeStroke}66` : theme.node.stroke, color: isSelected ? theme.node.activeStroke : theme.node.placeholder }}>
                    <span>{t("canvas.node.editText")}</span>
                </div>
            )}
            <div className="flex h-10 shrink-0 items-center gap-2 border-t pl-4 pr-2" style={{ borderColor: content || isEditingContent ? theme.node.stroke : "transparent" }} data-canvas-no-zoom>
                <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
                    {content || isEditingContent ? t("canvas.promptPanel.charCount", { count: charCount }) : ""}
                </span>
                {showFontControls ? (
                    <span className="inline-flex items-center gap-px rounded-[9px] p-0.5" style={{ background: theme.toolbar.itemHover }}>
                        <TextNodeActionButton label={t("canvas.nodeToolbar.zoomOut")} title={t("canvas.nodeToolbar.decreaseFont")} icon={<Minus className="size-3" />} theme={theme} onClick={() => onDecreaseFont?.(node)} />
                        <span className="min-w-[18px] text-center text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
                            {fontSize}
                        </span>
                        <TextNodeActionButton label={t("canvas.nodeToolbar.zoomIn")} title={t("canvas.nodeToolbar.increaseFont")} icon={<Plus className="size-3" />} theme={theme} onClick={() => onIncreaseFont?.(node)} />
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function TextNodeActionButton({ label, title = label, icon, theme, onClick }: { label: string; title?: string; icon: ReactNode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void }) {
    return (
        <button
            type="button"
            className="canvas-node-overlay-btn inline-flex h-6 items-center gap-1 rounded-[7px] px-1.5 text-[11px] font-medium transition hover:opacity-100"
            style={{ color: theme.node.text }}
            title={title}
            aria-label={title}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
        >
            {icon}
            {label}
        </button>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && !props.node.metadata?.storageKey && !props.node.metadata?.thumbnailUrl && !props.isBatchRoot) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            onImageAspect={props.onImageAspect}
            node={props.node}
            batchExpanded={props.batchExpanded}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
            onDuplicateBatchImage={props.onDuplicateBatchImage}
            onDownloadBatchImage={props.onDownloadBatchImage}
            onDownload={props.onDownload}
            onRetryBatchImage={props.onRetryBatchImage}
            onDeleteBatchImage={props.onDeleteBatchImage}
            onViewBatchImage={props.onViewBatchImage}
        />
    );
}

function NodeEmptyState({ theme, icon, title, hint }: { theme: NodeContentRendererProps["theme"]; icon: ReactNode; title: string; hint?: string }) {
    return (
        <div className="flex h-full w-full p-3">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-dashed px-3 text-center" style={{ borderColor: theme.scheme === "dark" ? "#3a3647" : "#dcd7e7", color: theme.node.muted }}>
                <span className="opacity-70">{icon}</span>
                <span className="text-[12px] font-semibold">{title}</span>
                {hint ? (
                    <span className="text-[11px]" style={{ color: theme.node.faint, opacity: 0.8 }}>
                        {hint}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function EmptyImageContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const deleted = node.metadata?.deletedByHistory;
    return <NodeEmptyState theme={theme} icon={<ImageIcon className="size-5" />} title={deleted ? node.metadata?.deletionMessage || "该图片已被删除" : t("canvas.node.emptyImage")} hint={deleted ? undefined : t("canvas.node.emptyImageHint")} />;
}

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return <NodeEmptyState theme={theme} icon={<Video className="size-5" />} title={t("canvas.node.emptyVideo")} hint={t("canvas.node.emptyVideoHint")} />;
    return <CanvasPreviewVideo src={node.metadata.content} storageKey={node.metadata.storageKey} className="h-full w-full rounded-[inherit] bg-black object-contain" />;
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return <NodeEmptyState theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.node.emptyAudio")} hint={t("canvas.node.emptyAudioHint")} />;
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold">
                <span className="grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: "#22c55e", boxShadow: "0 6px 14px rgba(34,197,94,.28)" }}>
                    <Music2 className="size-3.5" />
                </span>
                <span className="truncate">{t("canvas.node.audio")}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    onImageAspect,
    node,
    batchExpanded,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onDownload,
    onRetryBatchImage,
    onDeleteBatchImage,
    onViewBatchImage,
}: {
    onImageAspect?: CanvasNodeProps["onImageAspect"];
    node: CanvasNodeData;
    batchExpanded: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (imageId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onDownload?: () => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onViewBatchImage?: (image: CanvasNodeImage) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const images = node.metadata?.images || [];
    const batchCount = images.length;
    const isBatchRoot = batchCount > 1;
    const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
    const primaryImage = images.find((image) => image.id === primaryImageId);
    const primaryContent = primaryImage?.content || node.metadata?.content;
    const storyboard = node.metadata?.storyboardSceneId ? node.metadata : null;
    const canDownload = Boolean(primaryImage?.content || node.metadata?.content);
    const handleDownload = () => {
        if (primaryImage?.content && primaryImage.id) onDownloadBatchImage?.(primaryImage.id);
        else onDownload?.();
    };

    return (
        <BatchFrame
            batchCount={batchCount}
            batchExpanded={batchExpanded}
            stackImages={images.filter((image) => image.id !== primaryImageId).slice(0, 3)}
            onToggleBatch={onToggleBatch}
        >
            {batchExpanded
                ? images
                      .filter((image) => image.id !== primaryImageId)
                      .map((image, index) => <ExpandedImageCard key={image.id} node={node} image={image} index={index} onView={() => onViewBatchImage?.(image)} onSetPrimary={() => onSetBatchPrimary?.(image.id)} onDuplicate={() => onDuplicateBatchImage?.(image.id)} onDownload={() => onDownloadBatchImage?.(image.id)} onRetry={() => onRetryBatchImage?.(image.id)} onDelete={() => onDeleteBatchImage?.(image.id)} />)
                : null}
            <div className="h-full w-full overflow-hidden rounded-[inherit]">
                {primaryContent || primaryImage?.storageKey || node.metadata?.storageKey || primaryImage?.thumbnailUrl || node.metadata?.thumbnailUrl ? (
                    <CanvasPreviewImage
                        src={primaryContent}
                        onLoad={(event) => {
                            const image = event.currentTarget;
                            if (image.naturalWidth > 0 && image.naturalHeight > 0) onImageAspect?.(node.id, imageFrameSource(node), image.naturalWidth / image.naturalHeight);
                        }}
                        storageKey={primaryImage?.storageKey || node.metadata?.storageKey}
                        thumbnailUrl={primaryImage?.thumbnailUrl || node.metadata?.thumbnailUrl}
                        alt={node.title}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                    />
                ) : (
                    <ImageSlotStatus image={primaryImage} startedAt={node.metadata?.generationStartedAt} generationStage={node.metadata?.generationStage} />
                )}
            </div>
            {storyboard ? <StoryboardShotFooter node={node} theme={theme} compact /> : null}
            {storyboard?.storyboardNeedsRegeneration ? (
                <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-30 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium shadow-sm" style={{ background: theme.toolbar.panel, borderColor: `${theme.node.activeStroke}66`, color: theme.node.activeStroke }}>
                    <RefreshCw className="size-3" />
                    {t("canvas.storyboard.retryScene")}
                </span>
            ) : null}
            {primaryImage?.status === "error" ? <BatchImageFailureActions placement="left" errorDetails={primaryImage.errorDetails} onRetry={() => onRetryBatchImage?.(primaryImage.id)} onDelete={() => onDeleteBatchImage?.(primaryImage.id)} /> : null}
            {canDownload ? (
                <button type="button" className="canvas-node-overlay-btn absolute left-2.5 top-2.5 z-30 flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition hover:opacity-90" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("common.download")} onClick={(event) => (event.stopPropagation(), handleDownload())}>
                    <DownloadIcon className="size-3" />
                    {t("common.download")}
                </button>
            ) : null}
            {isBatchRoot ? (
                <button
                    type="button"
                    className="canvas-node-overlay-btn absolute right-2.5 top-2.5 z-30 flex h-7 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition hover:opacity-90"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    aria-label={batchExpanded ? t("canvas.node.batchExpanded") : t("canvas.node.batchCollapsed")}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none">{t("canvas.controls.images", { count: batchCount })}</span>
                    <ChevronRight className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ExpandedImageCard({ node, image, index, onView, onSetPrimary, onDuplicate, onDownload, onRetry, onDelete }: { node: CanvasNodeData; image: CanvasNodeImage; index: number; onView: () => void; onSetPrimary: () => void; onDuplicate: () => void; onDownload: () => void; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const count = node.metadata?.images?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const rootSlot = (rows - 1) * columns;
    const slot = index >= rootSlot ? index + 1 : index;
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const x = column * (node.width + 18);
    const y = (row - rows + 1) * (node.height + 18);

    return (
        <div
            className="absolute z-20 overflow-hidden rounded-[12px] border shadow-[0_18px_50px_rgba(28,25,23,.18)]"
            style={
                {
                    left: x,
                    top: y,
                    width: node.width,
                    height: node.height,
                    background: theme.node.panel,
                    borderColor: theme.node.stroke,
                    "--batch-from-x": `${-x}px`,
                    "--batch-from-y": `${-y}px`,
                    "--batch-from-rotate": `${4 + index * 2}deg`,
                    animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
                } as React.CSSProperties
            }
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
                event.stopPropagation();
                if (image.content) onView();
            }}
        >
            {image.content || image.storageKey || image.thumbnailUrl ? <CanvasPreviewImage src={image.content} storageKey={image.storageKey} thumbnailUrl={image.thumbnailUrl} alt={node.title} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" /> : <ImageSlotStatus image={image} startedAt={node.metadata?.generationStartedAt} generationStage={node.metadata?.generationStage} />}
            {image.content ? (
                <div className="absolute inset-x-2 top-2 flex items-center gap-1">
                    <button type="button" className="canvas-node-overlay-btn flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] font-medium transition hover:opacity-90" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("common.download")} onClick={(event) => (event.stopPropagation(), onDownload())}>
                        <DownloadIcon className="size-3 shrink-0" />
                        <span className="truncate">{t("common.download")}</span>
                    </button>
                    <button type="button" className="canvas-node-overlay-btn flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] font-medium transition hover:opacity-90" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("canvas.node.createCopy")} onClick={(event) => (event.stopPropagation(), onDuplicate())}>
                        <Copy className="size-3 shrink-0" />
                        <span className="truncate">{t("canvas.node.createCopy")}</span>
                    </button>
                    <button type="button" className="canvas-node-overlay-btn flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] font-medium transition hover:opacity-90" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title={t("canvas.node.setPrimary")} onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                        <Star className="size-3 shrink-0" style={{ color: theme.node.activeStroke }} />
                        <span className="truncate">{t("canvas.node.setPrimary")}</span>
                    </button>
                </div>
            ) : null}
            {image.status === "error" ? <BatchImageFailureActions placement="right" errorDetails={image.errorDetails} onRetry={onRetry} onDelete={onDelete} /> : null}
        </div>
    );
}

function BatchImageFailureActions({ placement, errorDetails, onRetry, onDelete }: { placement: "left" | "right"; errorDetails?: string; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const needsRecharge = isCreditInsufficientError(errorDetails);
    return (
        <div className={`absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}`}>
            {needsRecharge ? (
                <a
                    href="/pricing?plan=topup"
                    className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]"
                    style={{ background: theme.node.activeStroke, borderColor: theme.node.activeStroke, color: "#fff" }}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    {t("canvas.costConfirm.recharge")}
                </a>
            ) : null}
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onRetry())}>
                <RegenerateIcon className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
            <button type="button" className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onDelete())} aria-label={t("common.delete")} title={t("common.delete")}>
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}

function ImageSlotStatus({ image, startedAt, generationStage }: { image?: CanvasNodeImage; startedAt?: string; generationStage?: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = image?.status === "error";
    const needsRecharge = failed && isCreditInsufficientError(image?.errorDetails);
    const fallbackStartedAt = useRef(new Date().toISOString()).current;
    const elapsedMs = useGenerationElapsed(startedAt || fallbackStartedAt, undefined, !failed);
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5" style={{ color: theme.scheme === "dark" ? "#ff8a8e" : "#b42318" }}>{image.errorDetails || t("canvas.node.failed")}</span> : <div className="size-6 animate-spin rounded-full border-2" style={{ borderColor: `${theme.node.activeStroke}33`, borderTopColor: theme.node.activeStroke }} />}
            {failed && needsRecharge ? (
                <a
                    href="/pricing?plan=topup"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.node.activeStroke, borderColor: theme.node.activeStroke, color: "#fff" }}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    {t("canvas.costConfirm.recharge")}
                </a>
            ) : null}
            {!failed ? <span className="text-[11px] font-medium">{canvasGenerationStageLabel(generationStage, t("canvas.node.generating"))}</span> : null}
            {!failed ? <span className="text-[11px] font-semibold tabular-nums tracking-normal">{formatGenerationDuration(elapsedMs)}</span> : null}
        </div>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-full px-2.5 py-1 text-[11px] font-medium leading-none tabular-nums backdrop-blur-sm" style={{ background: "rgba(12,13,17,.72)", color: "#fff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }}>
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({
    batchCount,
    batchExpanded,
    stackImages = [],
    onToggleBatch,
    children,
}: {
    batchCount: number;
    batchExpanded: boolean;
    stackImages?: CanvasNodeImage[];
    onToggleBatch?: () => void;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    const stacked = stackImages.filter((image) => image?.content || image?.thumbnailUrl || image?.storageKey).slice(0, 3);
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot && stacked.length > 0 && !batchExpanded ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {stacked.map((image, index) => {
                        return (
                            <div
                                key={image.id}
                                className="absolute overflow-hidden rounded-[12px] border transition-all duration-300 group-hover/batch:translate-x-1"
                                style={{
                                    inset: 0,
                                    background: theme.node.fill,
                                    borderColor: theme.node.stroke,
                                    transform: `translate(${10 + index * 6}px, ${4 + index * 3}px) rotate(${1.5 + index}deg)`,
                                    zIndex: -index - 1,
                                }}
                            >
                                {image.content || image.thumbnailUrl || image.storageKey ? (
                                    <CanvasPreviewImage
                                        src={image.content}
                                        storageKey={image.storageKey}
                                        thumbnailUrl={image.thumbnailUrl}
                                        alt=""
                                        maxEdge={160}
                                        className="pointer-events-none h-full w-full select-none object-cover"
                                    />
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onPointerDown }: { corner: ResizeCorner; onPointerDown: (event: React.PointerEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onPointerDown={(event) => onPointerDown(event, corner)} />;
}

function ConnectionHandleDot({ side, visible, active = false, highlight = false, onMouseDown }: { side: "left" | "right"; visible: boolean; active?: boolean; highlight?: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const accent = theme.node.activeStroke;

    // Input is a small hollow ring; output is a larger "+" that invites dragging out the next node.
    return (
        <div
            className={`group/port absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible || highlight ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            {side === "left" ? (
                <div
                    className="rounded-full border-2 transition-all duration-150 group-hover/port:scale-125"
                    style={{
                        width: highlight ? 14 : 10,
                        height: highlight ? 14 : 10,
                        background: highlight ? accent : theme.node.panel,
                        borderColor: active || highlight ? accent : theme.node.port,
                        boxShadow: highlight ? `0 0 0 5px ${theme.node.activeRing}` : undefined,
                    }}
                />
            ) : (
                <div
                    className="grid size-[18px] place-items-center rounded-full border-[1.5px] text-[12px] font-bold leading-none transition-all duration-150 group-hover/port:scale-110"
                    style={{
                        background: active ? accent : theme.node.panel,
                        borderColor: active ? accent : theme.node.port,
                        color: active ? "#fff" : theme.node.muted,
                    }}
                >
                    +
                </div>
            )}
        </div>
    );
}
