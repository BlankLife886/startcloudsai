import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Modal, Tooltip } from "antd";
import { Copy, Download, Ellipsis, FolderPlus, Image as ImageIcon, MessageSquare, Minus, Music2, Pencil, Plus, RefreshCw, Settings2, Trash2, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { canvasRaisedStyle, colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo?: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onRemoveBackground: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
    backgroundRemovalAvailable?: boolean;
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    onKeep,
    onLeave,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onRemoveBackground,
    onAngle,
    onViewImage,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onDelete,
    extraTools = [],
    backgroundRemovalAvailable = false,
}: CanvasNodeHoverToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showImageToolLabels, setShowImageToolLabels] = useState(true);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(true);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setShowImageToolLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
    }, [node?.id]);

    if (!node) return null;

    const activeNode = node;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 14;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || hasImage || isVideo;
    const canRetry = node.metadata?.status === "error";
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning(t("canvas.nodeToolbar.noPrompt"));
            return;
        }
        copyText(prompt, t("common.promptCopied"));
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onMaskEdit, onCrop, onSplit, onUpscale, onRemoveBackground, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt }).filter(
        (tool) => backgroundRemovalAvailable || tool.id !== "removeBackground",
    );

    function openImageToolSettings() {
        onKeep(activeNode.id);
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowImageToolLabels(showImageToolLabels);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog ? [{ id: "edit", title: t("common.edit"), label: t("common.edit"), icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: t("canvas.nodeToolbar.editTextTitle"), label: t("canvas.nodeToolbar.editText"), icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: t("canvas.configNode.title"), label: t("canvas.configNode.title"), icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const availableImageTools = [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => tool.id !== "retry");
    const imageToolById = new Map(availableImageTools.map((tool) => [tool.id, tool]));
    const toolbarTools = hasImage
        ? quickImageToolIds.map((id) => imageToolById.get(id)).filter((tool): tool is ToolbarTool => Boolean(tool))
        : [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const selectableImageToolbarTools = availableImageTools as ImageToolbarSettingsTool[];

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => (visible ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id)));
    };

    const saveImageToolSettings = () => {
        const config = { ids: draftImageToolIds, showLabels: draftShowImageToolLabels, version: 7 };
        setQuickImageToolIds(config.ids);
        setShowImageToolLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    const visibleTools = hasImage
        ? [...toolbarTools, { id: "more", title: t("canvas.imageTools.configure"), label: t("canvas.imageTools.more"), icon: <Ellipsis className="size-4" />, active: imageToolSettingsOpen, onClick: openImageToolSettings }]
        : toolbarTools;
    const wrapAt = visibleTools.length > 8 ? Math.ceil(visibleTools.length / 2) : visibleTools.length;
    const toolbarRows = [visibleTools.slice(0, wrapAt), visibleTools.slice(wrapAt)].filter((row) => row.length);

    return (
        <>
            <div
                className="canvas-float-menu absolute z-[70] flex -translate-x-1/2 -translate-y-full flex-col overflow-hidden rounded-[20px] px-1.5 py-1.5 backdrop-blur-xl"
                style={{ left, top, background: theme.toolbar.panel, color: theme.toolbar.item, boxShadow: theme.toolbar.shadow }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {toolbarRows.map((row, rowIndex) => (
                    <div
                        key={rowIndex}
                        className="flex items-center justify-center"
                        style={rowIndex ? { boxShadow: `inset 0 1px 0 ${theme.toolbar.border}` } : undefined}
                    >
                        {row.map((tool) => (
                            <ToolbarAction key={tool.id} {...tool} showLabel={showImageToolLabels} theme={theme} />
                        ))}
                    </div>
                ))}
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onReorder={setDraftImageToolIds}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const typeLabel = node
        ? node.type === CanvasNodeType.Group
            ? t("canvas.node.group")
            : node.type === CanvasNodeType.Config
              ? t("canvas.configNode.title")
              : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType)
                ? t(`assets.kinds.${node.type}`)
                : getNodeDefinition(node.type)?.title || node.type
        : "";
    const typeColor = nodeTypeColor(node?.type === CanvasNodeType.Group ? "group" : node?.type, undefined, theme.scheme);
    const status = node?.metadata?.status || "idle";
    const statusColor = status === "error" ? "#ef4444" : status === "success" ? "#34d399" : status === "loading" ? theme.node.activeStroke : theme.node.muted;

    return (
        <Modal className="canvas-node-info-modal" title={null} open={open && Boolean(node)} centered footer={null} width={400} onCancel={onClose}>
            {node ? (
                <div className="select-text" data-canvas-shortcuts-ignore>
                    <div className="mb-4 flex items-center justify-between gap-3 pr-10">
                        <div className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.02em]" style={{ color: theme.node.text }}>
                            {t("canvas.nodeToolbar.nodeInfo")}
                        </div>
                        <div className="grid h-8 shrink-0 grid-cols-2 rounded-[10px] p-[3px]" style={{ background: theme.toolbar.itemHover }}>
                            {(["info", "json"] as const).map((item) => {
                                const active = view === item;
                                return (
                                    <button
                                        key={item}
                                        type="button"
                                        className="rounded-[8px] px-2.5 text-[12px] font-medium"
                                        style={active ? { ...canvasRaisedStyle(theme), color: theme.node.text } : { background: "transparent", color: theme.node.muted }}
                                        onClick={() => setView(item)}
                                    >
                                        {item === "info" ? t("canvas.nodeToolbar.info") : "JSON"}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {view === "info" ? (
                        <div className="space-y-2.5">
                            <div className="overflow-hidden rounded-[16px]" style={{ background: theme.toolbar.itemHover }}>
                                <InfoRow label="ID" value={node.id} mono first theme={theme} onCopy={() => copyText(node.id)} />
                                <InfoRow label={t("canvas.nodeToolbar.name")} value={node.title || t("canvas.node.untitled")} theme={theme} />
                                <InfoRow
                                    label={t("canvas.nodeToolbar.type")}
                                    value={
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="size-1.5 rounded-full" style={{ background: typeColor }} />
                                            {typeLabel}
                                        </span>
                                    }
                                    theme={theme}
                                />
                                <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} × ${Math.round(node.height)}`} theme={theme} />
                                <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} theme={theme} />
                                <InfoRow
                                    label={t("canvas.nodeToolbar.status")}
                                    value={
                                        <span
                                            className="inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold"
                                            style={{ background: colorWash(statusColor, 0.14), color: statusColor }}
                                        >
                                            {status}
                                        </span>
                                    }
                                    theme={theme}
                                />
                                {batchCount > 1 ? <InfoRow label={t("canvas.nodeToolbar.imageGroup")} value={t("canvas.configNode.images", { count: batchCount })} theme={theme} /> : null}
                                {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} theme={theme} /> : null}
                            </div>
                            {node.metadata?.prompt ? (
                                <div className="rounded-[16px] px-3 py-2.5" style={{ background: theme.toolbar.itemHover }}>
                                    <div className="text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                        {t("canvas.configNode.prompt")}
                                    </div>
                                    <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5" style={{ color: theme.node.text }}>
                                        {node.metadata.prompt}
                                    </div>
                                </div>
                            ) : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-[16px] px-3 py-2.5 text-[13px] leading-5" style={{ background: colorWash("#ef4444", 0.1), color: "#ef4444" }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="relative">
                            <button
                                type="button"
                                className="absolute right-2 top-2 z-[1] inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium"
                                style={{ background: theme.node.panel, color: theme.toolbar.activeText }}
                                onClick={() => copyText(json)}
                            >
                                <Copy className="size-3" />
                                {t("common.copy")}
                            </button>
                            <pre className="thin-scrollbar max-h-[min(52vh,420px)] overflow-auto rounded-[16px] px-3 py-3 pr-16 text-[12px] leading-5" style={{ background: theme.toolbar.itemHover, color: theme.node.text }}>
                                {json}
                            </pre>
                        </div>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, showLabel, theme, active = false, danger = false }: ToolbarTool & { showLabel: boolean; theme: CanvasTheme }) {
    const hasText = showLabel && Boolean(label);
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button type="button" className="relative flex h-11 shrink-0 items-center px-0.5" style={{ color: danger ? "#ef4444" : theme.toolbar.item }} onClick={onClick} aria-label={title}>
                <span
                    className={`flex h-8 items-center whitespace-nowrap rounded-full text-[13px] transition ${hasText ? "gap-1.5 px-2.5" : "justify-center px-2"}`}
                    style={{ background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.toolbar.activeText : undefined }}
                    onMouseEnter={(event) => {
                        if (!active) event.currentTarget.style.background = theme.toolbar.itemHover;
                    }}
                    onMouseLeave={(event) => {
                        event.currentTarget.style.background = active ? theme.toolbar.activeBg : "transparent";
                    }}
                >
                    {icon}
                    {hasText ? <span>{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({
    label,
    value,
    mono,
    first,
    theme,
    onCopy,
}: {
    label: string;
    value: ReactNode;
    mono?: boolean;
    first?: boolean;
    theme: CanvasTheme;
    onCopy?: () => void;
}) {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5" style={{ boxShadow: first ? undefined : `inset 0 1px 0 ${theme.toolbar.border}` }}>
            <span className="w-14 shrink-0 text-[12px] font-medium" style={{ color: theme.node.muted }}>
                {label}
            </span>
            <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] font-medium ${mono ? "break-all font-mono text-[12px]" : ""}`} style={{ color: theme.node.text }}>
                {value}
            </span>
            {onCopy ? (
                <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full" style={{ color: theme.node.muted }} onClick={onCopy} aria-label={label}>
                    <Copy className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}
