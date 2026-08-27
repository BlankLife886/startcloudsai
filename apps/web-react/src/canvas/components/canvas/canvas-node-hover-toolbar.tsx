import { useEffect, useState, type ReactNode } from "react";
import { App, Tooltip } from "antd";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, MessageSquare, Music2, Pencil, RefreshCw, Settings2, Trash2, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { isCanvasExecutableNode, isCanvasOperationNodeType } from "@/lib/canvas/canvas-operation-node";
import { isCanvasLocalImageOperation } from "@/lib/canvas/canvas-local-image-operation";
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
    onRename: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
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
    onRename,
    onEditText,
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
    const isText = node.type === CanvasNodeType.Text;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 14;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isConfig = isCanvasExecutableNode(node) && !isCanvasOperationNodeType(node.type) && !isCanvasLocalImageOperation(node.metadata?.localImageOperation);
    const definition = getNodeDefinition(node.type);
    const canOpenDialog = isText || hasImage || isVideo || isCanvasExecutableNode(node) || Boolean(definition?.Panel || definition?.useBuiltinPanel);
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

    const commonToolbarTools: ToolbarTool[] = [
        ...(!isText ? [{ id: "rename", title: t("canvas.nodeToolbar.renameTitle"), label: t("canvas.nodeToolbar.rename"), icon: <Pencil className="size-4" />, onClick: () => onRename(node) }] : []),
        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog && !isText ? [{ id: "edit", title: t("common.edit"), label: t("common.edit"), icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: t("canvas.nodeToolbar.editTextTitle"), label: t("canvas.nodeToolbar.editText"), icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: t("canvas.configNode.title"), label: t("canvas.configNode.title"), icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const availableImageTools = nodeToolbarTools.filter((tool) => tool.id !== "retry");
    const imageToolById = new Map(availableImageTools.map((tool) => [tool.id, tool]));
    const toolbarTools = dedupeToolbarTools(
        hasImage
            ? [...quickImageToolIds.map((id) => imageToolById.get(id)).filter((tool): tool is ToolbarTool => Boolean(tool)), ...extraTools, ...commonToolbarTools]
            : [...nodeToolbarTools, ...extraTools, ...commonToolbarTools],
    );
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
                data-canvas-node-toolbar
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

function dedupeToolbarTools(tools: ToolbarTool[]) {
    const seen = new Set<string>();
    return tools.filter((tool) => {
        if (seen.has(tool.id)) return false;
        seen.add(tool.id);
        return true;
    });
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
