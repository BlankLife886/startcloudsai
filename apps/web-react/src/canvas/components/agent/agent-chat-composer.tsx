import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Dropdown, Popover, Tooltip } from "antd";
import { ArrowUp, Check, ChevronDown, ChevronUp, FileText, Gauge, Group, Hand, Image as ImageIcon, ImagePlus, Layers3, LoaderCircle, Music2, PenLine, RefreshCw, Settings2, Shield, ShieldAlert, ShieldCheck, ShieldOff, SlidersHorizontal, Square, Video, X } from "lucide-react";
import { SoftMark } from "@react/components/common/SoftMark.jsx";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensureCanvasOverlayRoot } from "@/lib/canvas-portal";
import { cn } from "@/lib/utils";
import { useAgentStore, type AgentModel, type AgentPermissionMode, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { AgentChatAttachment } from "./agent-chat-message";
import { AgentChatPromptInput } from "./agent-chat-prompt-input";

const MENU_EASE = [0.22, 1, 0.36, 1] as const;

type ComposerPricedOption = { value: string; label: string; price?: string; comparePrice?: string };
type ComposerMenuId = "tools" | "permission" | "localModel" | "chatModel" | "reasoning";

function ComposerPriceMark({ price, comparePrice }: { price?: string; comparePrice?: string }) {
    if (!price) return null;
    if (!comparePrice) {
        return <span className="shrink-0 text-[11px] font-medium tabular-nums opacity-50">{price}</span>;
    }
    return (
        <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap tabular-nums">
            <span className="text-[11px] font-medium line-through opacity-35">{comparePrice}</span>
            <span className="text-[11px] font-semibold tracking-tight">{price}</span>
        </span>
    );
}

function useComposerAnchorPos(
    open: boolean,
    wrapRef: { current: HTMLElement | null },
    { align = "left", minWidth = 280 }: { align?: "left" | "right"; minWidth?: number } = {},
) {
    const [pos, setPos] = useState({ bottom: 0, left: 12, width: minWidth });
    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = wrapRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(Math.max(minWidth, 240), window.innerWidth - 24);
            const rawLeft = align === "right" ? rect.right - width : rect.left;
            setPos({
                bottom: window.innerHeight - rect.top + 8,
                left: Math.min(Math.max(12, rawLeft), window.innerWidth - width - 12),
                width,
            });
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [align, minWidth, open, wrapRef]);
    return pos;
}

function useCloseOnOutsidePointer(
    open: boolean,
    wrapRef: { current: HTMLElement | null },
    onClose: () => void,
    extraRef?: { current: HTMLElement | null },
) {
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (wrapRef.current?.contains(target) || extraRef?.current?.contains(target)) return;
            onCloseRef.current();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onCloseRef.current();
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", onKey);
        };
    }, [extraRef, open, wrapRef]);
}

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onStop,
    onAddFiles,
    onRemoveAttachment,
    confirmTools,
    onConfirmToolsChange,
    permissionMode,
    onPermissionModeChange,
    models,
    model,
    reasoningEffort,
    reasoningEfforts,
    reasoningEffortLabels,
    reasoningEffortPrices,
    reasoningEffortComparePrices,
    onModelChange,
    onReasoningEffortChange,
    chatModels,
    chatModel,
    onChatModelChange,
    left,
    sendCost,
    sendCompareCost,
    hint,
}: {
    prompt: string;
    attachments?: AgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    confirmTools?: boolean;
    onConfirmToolsChange?: (confirmTools: boolean) => void;
    permissionMode?: AgentPermissionMode;
    onPermissionModeChange?: (permissionMode: AgentPermissionMode) => void;
    models?: AgentModel[];
    model?: string;
    reasoningEffort?: AgentReasoningEffort | "";
    reasoningEfforts?: AgentReasoningEffort[];
    reasoningEffortLabels?: Partial<Record<AgentReasoningEffort, string>>;
    reasoningEffortPrices?: Partial<Record<AgentReasoningEffort, string>>;
    reasoningEffortComparePrices?: Partial<Record<AgentReasoningEffort, string>>;
    onModelChange?: (model: string) => void;
    onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
    chatModels?: ComposerPricedOption[];
    chatModel?: string;
    onChatModelChange?: (model: string) => void;
    left?: ReactNode;
    sendCost?: string;
    sendCompareCost?: string;
    hint?: ReactNode;
}) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [openMenu, setOpenMenu] = useState<ComposerMenuId | null>(null);
    const canvasReferences = useAgentStore((state) => state.canvasReferences);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length || canvasReferences.length);
    const menu = (id: ComposerMenuId) => ({
        open: openMenu === id,
        onOpenChange: (next: boolean) => setOpenMenu((current) => (next ? id : current === id ? null : current)),
    });
    return (
        <div className="px-3 pb-3 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="overflow-visible rounded-[24px] px-3.5 pb-3.5 pt-3.5" style={{ background: theme.sidebar.surface, boxShadow: theme.scheme === "dark" ? "inset 0 0 0 1px rgba(255,255,255,.06), inset 0 1px 0 rgba(255,255,255,.04)" : `inset 0 0 0 1px ${theme.sidebar.border}, ${theme.sidebar.shadow}` }}>
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item) => (
                            <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }} title={item.name}>
                                <img src={item.url} alt={item.name} className="size-full object-cover" />
                                {onRemoveAttachment ? (
                                    <button type="button" className="absolute right-1 top-1 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => onRemoveAttachment(item.id)} aria-label={t("agent.composer.removeImage")}>
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                <AgentChatPromptInput value={prompt} disabled={disabled || sending} placeholder={placeholder} theme={theme} onChange={onPromptChange} onSubmit={() => { if (canSubmit) void onSubmit(); }} onAddFiles={onAddFiles} />
                <div className="@container mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => {
                                    void onAddFiles(event.target.files);
                                    event.target.value = "";
                                }} />
                                <Button type="text" shape="circle" className="!h-9 !w-9 !min-w-9" disabled={disabled || sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} aria-label={t("agent.composer.uploadImage")} />
                            </>
                        ) : null}
                        <AgentSelectedNodesControl theme={theme} />
                        <div className="min-w-0 @min-[560px]:hidden">
                            <ComposerSettingsMenu
                                theme={theme}
                                confirmTools={confirmTools}
                                onConfirmToolsChange={onConfirmToolsChange}
                                permissionMode={permissionMode}
                                onPermissionModeChange={onPermissionModeChange}
                                models={models}
                                model={model}
                                onModelChange={onModelChange}
                                chatModels={chatModels}
                                chatModel={chatModel}
                                onChatModelChange={onChatModelChange}
                                reasoningEffort={reasoningEffort}
                                reasoningEfforts={reasoningEfforts}
                                reasoningEffortLabels={reasoningEffortLabels}
                                reasoningEffortPrices={reasoningEffortPrices}
                                reasoningEffortComparePrices={reasoningEffortComparePrices}
                                onReasoningEffortChange={onReasoningEffortChange}
                            />
                        </div>
                        <div className="hidden min-w-0 items-center gap-1 @min-[560px]:flex">
                            {onConfirmToolsChange ? <ToolConfirmationMenu confirmTools={Boolean(confirmTools)} theme={theme} onChange={onConfirmToolsChange} {...menu("tools")} /> : null}
                            {permissionMode && onPermissionModeChange ? <PermissionModeMenu permissionMode={permissionMode} theme={theme} onChange={onPermissionModeChange} {...menu("permission")} /> : null}
                            {models?.length && model && reasoningEffort && onModelChange && onReasoningEffortChange ? <AgentModelControls models={models} model={model} reasoningEffort={reasoningEffort} onModelChange={onModelChange} onReasoningEffortChange={onReasoningEffortChange} {...menu("localModel")} reasoningOpen={openMenu === "reasoning"} onReasoningOpenChange={(next) => setOpenMenu((current) => (next ? "reasoning" : current === "reasoning" ? null : current))} /> : null}
                            {!models?.length && chatModels?.length && chatModel && onChatModelChange ? <AgentChatModelControl models={chatModels} value={chatModel} onChange={onChatModelChange} {...menu("chatModel")} /> : null}
                            {!models?.length && reasoningEffort && reasoningEfforts?.length && onReasoningEffortChange ? <AgentReasoningControl reasoningEffort={reasoningEffort} reasoningEfforts={reasoningEfforts} reasoningEffortLabels={reasoningEffortLabels} reasoningEffortPrices={reasoningEffortPrices} reasoningEffortComparePrices={reasoningEffortComparePrices} onReasoningEffortChange={onReasoningEffortChange} {...menu("reasoning")} /> : null}
                        </div>
                        {left}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {sending && onStop ? (
                            <Tooltip title={t("agent.composer.stop")} placement="top"><Button danger shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Square className="size-4" />} onClick={() => void onStop()} aria-label={t("agent.composer.stop")} /></Tooltip>
                        ) : sendCost ? (
                            <Tooltip title={t("agent.composer.send")} placement="top">
                                <button
                                    type="button"
                                    disabled={!canSubmit}
                                    onClick={() => void onSubmit()}
                                    className="flex h-10 items-center gap-2 rounded-full pl-3 pr-1 disabled:cursor-not-allowed"
                                    style={{
                                        background: canSubmit ? theme.toolbar.activeBg : theme.sidebar.surface,
                                        color: canSubmit ? theme.toolbar.activeText : theme.node.text,
                                        boxShadow: canSubmit ? undefined : `inset 0 0 0 1px ${theme.toolbar.border}`,
                                    }}
                                    aria-label={t("agent.composer.send")}
                                >
                                    <span className="flex items-baseline gap-1.5 pl-0.5">
                                        {sendCompareCost ? (
                                            <span className="text-[11px] font-medium tabular-nums line-through opacity-45">{sendCompareCost}</span>
                                        ) : null}
                                        <span className="text-[13px] font-semibold tabular-nums tracking-tight">{sendCost}</span>
                                        <span className="text-[10px] font-medium opacity-65">{t("agent.composer.credits")}</span>
                                    </span>
                                    <span
                                        className="grid size-8 place-items-center rounded-full"
                                        style={{ background: canSubmit ? "color-mix(in srgb, currentColor 16%, transparent)" : theme.toolbar.itemHover }}
                                    >
                                        {sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                                    </span>
                                </button>
                            </Tooltip>
                        ) : (
                            <Tooltip title={t("agent.composer.send")} placement="top">
                                <Button
                                    type="primary"
                                    shape="circle"
                                    className="!h-10 !w-10 !min-w-10"
                                    disabled={!canSubmit}
                                    icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                                    onClick={() => void onSubmit()}
                                    aria-label={t("agent.composer.send")}
                                />
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>
            {hint ? <div className="px-1 pt-2 text-center text-[11px] leading-4" style={{ color: theme.node.faint }}>{hint}</div> : null}
        </div>
    );
}

function AgentSelectedNodesControl({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const nodes = useAgentStore((state) => state.canvasContext?.snapshot.nodes);
    const selectedNodeIds = useAgentStore((state) => state.canvasContext?.snapshot.selectedNodeIds);
    const selectedNodes = useMemo(() => {
        const selectedIds = new Set(selectedNodeIds || []);
        return (nodes || []).filter((node) => selectedIds.has(node.id));
    }, [nodes, selectedNodeIds]);

    if (!selectedNodes.length) return null;

    const previewNodes = selectedNodes.slice(0, 3);
    const content = (
        <div className="w-[min(340px,calc(100vw-32px))]" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                <span className="text-[13px] font-semibold">{t("agent.selection.selectedNodesTitle")}</span>
                <span className="text-[11px] tabular-nums" style={{ color: theme.node.muted }}>{selectedNodes.length}</span>
            </div>
            <div className="thin-scrollbar max-h-[min(420px,56vh)] overflow-y-auto p-1.5">
                {selectedNodes.map((node, index) => (
                    <div key={node.id} className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2" style={{ background: index % 2 ? theme.toolbar.itemHover : "transparent" }}>
                        <SelectedNodePreview node={node} theme={theme} />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium">{node.title || t("canvas.node.untitled")}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px]" style={{ color: theme.node.muted }}>
                                <span className="shrink-0">{selectedNodeTypeLabel(node, t)}</span>
                                <span className="opacity-35">·</span>
                                <span className="truncate font-mono">{node.id}</span>
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <Popover trigger="click" placement="topLeft" arrow={false} content={content} overlayInnerStyle={{ padding: 0, overflow: "hidden", background: theme.toolbar.panel, border: `1px solid ${theme.toolbar.border}` }}>
            <button
                type="button"
                className="flex h-9 min-w-0 max-w-48 items-center gap-2 rounded-lg px-2 text-[11px] font-medium transition-colors"
                style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                aria-label={t("agent.selection.selectedNodes", { count: selectedNodes.length })}
                title={t("agent.selection.viewSelectedNodes")}
            >
                <span className="flex h-6 shrink-0 items-center pl-1">
                    {previewNodes.map((node, index) => (
                        <span key={node.id} className="-ml-1 grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border" style={{ zIndex: previewNodes.length - index, background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                            <SelectedNodeMark node={node} />
                        </span>
                    ))}
                </span>
                <span className="truncate">{t("agent.selection.selectedNodes", { count: selectedNodes.length })}</span>
                <ChevronUp className="size-3 shrink-0 opacity-45" />
            </button>
        </Popover>
    );
}

function SelectedNodePreview({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const source = node.metadata?.thumbnailUrl || node.metadata?.content;
    if (node.type === CanvasNodeType.Image && source) return <img src={source} alt="" className="size-10 shrink-0 rounded-md object-cover" />;
    const Icon = selectedNodeIcon(node.type);
    return <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}><Icon className="size-4" /></span>;
}

function SelectedNodeMark({ node }: { node: CanvasNodeData }) {
    const source = node.metadata?.thumbnailUrl || node.metadata?.content;
    if (node.type === CanvasNodeType.Image && source) return <img src={source} alt="" className="size-full object-cover" />;
    const Icon = selectedNodeIcon(node.type);
    return <Icon className="size-3" />;
}

function selectedNodeIcon(type: string) {
    if (type === CanvasNodeType.Image) return ImageIcon;
    if (type === CanvasNodeType.Text) return FileText;
    if (type === CanvasNodeType.Config) return Settings2;
    if (type === CanvasNodeType.Video) return Video;
    if (type === CanvasNodeType.Audio) return Music2;
    if (type === CanvasNodeType.Group) return Group;
    return Layers3;
}

function selectedNodeTypeLabel(node: CanvasNodeData, t: (key: string) => string) {
    const definition = getNodeDefinition(node.type);
    if (definition?.title) return definition.title;
    if (node.type === CanvasNodeType.Config) return t("canvas.configNode.title");
    if (node.type === CanvasNodeType.Group) return t("canvas.node.group");
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) return t(`assets.kinds.${node.type}`);
    return node.type;
}

function ComposerSettingsMenu({
    theme,
    confirmTools,
    onConfirmToolsChange,
    permissionMode,
    onPermissionModeChange,
    models,
    model,
    onModelChange,
    chatModels,
    chatModel,
    onChatModelChange,
    reasoningEffort,
    reasoningEfforts,
    reasoningEffortLabels,
    reasoningEffortPrices,
    reasoningEffortComparePrices,
    onReasoningEffortChange,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    confirmTools?: boolean;
    onConfirmToolsChange?: (confirmTools: boolean) => void;
    permissionMode?: AgentPermissionMode;
    onPermissionModeChange?: (permissionMode: AgentPermissionMode) => void;
    models?: AgentModel[];
    model?: string;
    onModelChange?: (model: string) => void;
    chatModels?: ComposerPricedOption[];
    chatModel?: string;
    onChatModelChange?: (model: string) => void;
    reasoningEffort?: AgentReasoningEffort | "";
    reasoningEfforts?: AgentReasoningEffort[];
    reasoningEffortLabels?: Partial<Record<AgentReasoningEffort, string>>;
    reasoningEffortPrices?: Partial<Record<AgentReasoningEffort, string>>;
    reasoningEffortComparePrices?: Partial<Record<AgentReasoningEffort, string>>;
    onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ bottom: 0, left: 0, width: 280 });
    const wrapRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const currentLocal = models?.find((item) => item.model === model) || models?.[0];
    const currentChat = chatModels?.find((item) => item.value === chatModel) || chatModels?.[0];
    const modelLabel = currentChat?.label || currentLocal?.displayName || currentLocal?.model || "";
    const effortOptions = reasoningEfforts !== undefined
        ? reasoningEfforts
        : (currentLocal?.supportedReasoningEfforts || []).map((item) => item.reasoningEffort);
    const effortLabel = reasoningEffort
        ? reasoningEffortLabels?.[reasoningEffort] || t(`agent.composer.effort.${reasoningEffort}`)
        : "";
    const summary = [modelLabel, effortLabel].filter(Boolean).join(" · ") || t("agent.composer.settings");
    const hasContent = Boolean(
        currentChat ||
        currentLocal ||
        (reasoningEffort && effortOptions.length && onReasoningEffortChange) ||
        onConfirmToolsChange ||
        (permissionMode && onPermissionModeChange),
    );

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = wrapRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(320, window.innerWidth - 24);
            setMenuPos({
                bottom: window.innerHeight - rect.top + 8,
                left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12),
                width,
            });
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest("[data-composer-select-menu]")) return;
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (!hasContent) return null;

    return (
        <div ref={wrapRef} className="relative min-w-0 max-w-full">
            <button
                type="button"
                className="flex h-9 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
                style={{ color: theme.node.text, background: open ? theme.toolbar.itemHover : undefined }}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={t("agent.composer.settingsOpen")}
                title={summary}
                onClick={() => setOpen((current) => !current)}
            >
                <SlidersHorizontal className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 truncate">{summary}</span>
                <ChevronUp className={cn("size-3 shrink-0 opacity-50 transition-transform duration-200", open && "rotate-180")} />
            </button>
            {typeof document !== "undefined" && open
                ? createPortal(
                    <AnimatePresence>
                    <motion.div
                        key="composer-settings"
                        ref={menuRef}
                        role="dialog"
                        aria-label={t("agent.composer.settings")}
                        data-canvas-no-zoom
                        className="canvas-float-menu origin-bottom-left overflow-hidden rounded-[22px] border"
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: MENU_EASE }}
                        style={{
                            position: "fixed",
                            bottom: menuPos.bottom,
                            left: menuPos.left,
                            width: menuPos.width,
                            maxHeight: Math.max(180, window.innerHeight - menuPos.bottom - 16),
                            zIndex: 12050,
                            pointerEvents: "auto",
                            background: theme.toolbar.panel,
                            borderColor: theme.toolbar.border,
                            boxShadow: theme.toolbar.shadow,
                            color: theme.node.text,
                            backdropFilter: "blur(22px)",
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div className="flex items-center gap-2 px-3.5 pb-2 pt-3">
                            <span className="grid size-6 place-items-center rounded-[8px]" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                                <SlidersHorizontal className="size-3.5" />
                            </span>
                            <span className="text-[13px] font-semibold tracking-tight">{t("agent.composer.settings")}</span>
                        </div>
                        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
                        {currentChat && onChatModelChange ? (
                            <ComposerSettingsSection icon={<SoftMark name="cpu" size="xs" />} title={t("agent.composer.modelSection")} theme={theme}>
                                <ComposerModelSelect
                                    theme={theme}
                                    value={currentChat.value}
                                    options={chatModels || []}
                                    ariaLabel={t("agent.composer.selectChatModel", { model: currentChat.label })}
                                    onChange={onChatModelChange}
                                />
                            </ComposerSettingsSection>
                        ) : null}
                        {currentLocal && onModelChange ? (
                            <ComposerSettingsSection icon={<SoftMark name="cpu" size="xs" />} title={t("agent.composer.modelSection")} theme={theme}>
                                <ComposerModelSelect
                                    theme={theme}
                                    value={currentLocal.model}
                                    options={(models || []).map((item) => ({ value: item.model, label: item.displayName || item.model }))}
                                    ariaLabel={t("agent.composer.selectModel", { model: currentLocal.displayName || currentLocal.model })}
                                    onChange={onModelChange}
                                />
                            </ComposerSettingsSection>
                        ) : null}
                        {reasoningEffort && effortOptions.length && onReasoningEffortChange ? (
                            <ComposerSettingsSection
                                icon={<Gauge className="size-3.5" />}
                                title={t("agent.composer.reasoningSection")}
                                theme={theme}
                            >
                                <ComposerModelSelect
                                    theme={theme}
                                    value={reasoningEffort}
                                    options={effortOptions.map((effort) => ({
                                        value: effort,
                                        label: reasoningEffortLabels?.[effort] || t(`agent.composer.effort.${effort}`),
                                        price: reasoningEffortPrices?.[effort],
                                        comparePrice: reasoningEffortComparePrices?.[effort],
                                    }))}
                                    ariaLabel={t("agent.composer.selectReasoning", { effort: effortLabel })}
                                    onChange={(next) => onReasoningEffortChange(next as AgentReasoningEffort)}
                                />
                            </ComposerSettingsSection>
                        ) : null}
                        {permissionMode && onPermissionModeChange ? (
                            <ComposerSettingsSection icon={<Shield className="size-3.5" />} title={t("agent.composer.permissionSection")} theme={theme}>
                                <ComposerModelSelect
                                    theme={theme}
                                    value={permissionMode}
                                    options={[
                                        { value: "request", label: t("agent.composer.permission.request") },
                                        { value: "automatic", label: t("agent.composer.permission.automatic") },
                                        { value: "full", label: t("agent.composer.permission.fullShort") },
                                    ]}
                                    ariaLabel={t("agent.composer.selectPermission", { mode: t(`agent.composer.permission.${permissionMode === "full" ? "fullShort" : permissionMode}`) })}
                                    onChange={(next) => onPermissionModeChange(next as AgentPermissionMode)}
                                />
                            </ComposerSettingsSection>
                        ) : null}
                        {onConfirmToolsChange ? (
                            <ComposerSettingsSection icon={<PenLine className="size-3.5" />} title={t("agent.composer.toolsSection")} theme={theme}>
                                <ComposerModelSelect
                                    theme={theme}
                                    value={confirmTools ? "manual" : "automatic"}
                                    options={[
                                        { value: "manual", label: t("agent.composer.tools.manual"), price: t("agent.composer.tools.manualHint") },
                                        { value: "automatic", label: t("agent.composer.tools.automatic"), price: t("agent.composer.tools.automaticHint") },
                                    ]}
                                    ariaLabel={t("agent.composer.tools.select", { mode: t(confirmTools ? "agent.composer.tools.manual" : "agent.composer.tools.automatic") })}
                                    onChange={(next) => onConfirmToolsChange(next === "manual")}
                                />
                            </ComposerSettingsSection>
                        ) : null}
                        </div>
                    </motion.div>
                    </AnimatePresence>,
                    ensureCanvasOverlayRoot(),
                  )
                : null}
        </div>
    );
}

function ComposerSettingsSection({
    icon,
    title,
    extra,
    theme,
    children,
}: {
    icon: ReactNode;
    title: string;
    extra?: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    children: ReactNode;
}) {
    return (
        <section className="border-t px-0.5 py-2.5 first-of-type:border-t-0 first-of-type:pt-0" style={{ borderColor: theme.toolbar.border }}>
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold tracking-wide" style={{ color: theme.node.muted }}>
                    <span className="opacity-70">{icon}</span>
                    {title}
                </div>
                {extra ? <span className="shrink-0 text-[11px] font-medium tabular-nums" style={{ color: theme.node.faint }}>{extra}</span> : null}
            </div>
            {children}
        </section>
    );
}

function ComposerModelSelect({
    theme,
    value,
    options,
    ariaLabel,
    onChange,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    value: string;
    options: ComposerPricedOption[];
    ariaLabel: string;
    onChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [pos, setPos] = useState({ top: 0, left: 0, width: 280, maxHeight: 220, openUp: false });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const current = options.find((item) => item.value === value) || options[0];
    const filtered = query.trim()
        ? options.filter((item) => `${item.label} ${item.value}`.toLowerCase().includes(query.trim().toLowerCase()))
        : options;

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const spaceBelow = window.innerHeight - rect.bottom - 12;
            const spaceAbove = rect.top - 12;
            const openUp = spaceBelow < 168 && spaceAbove > spaceBelow;
            setPos({
                top: openUp ? rect.top : rect.bottom + 6,
                left: rect.left,
                width: Math.max(rect.width, 280),
                maxHeight: Math.min(260, Math.max(132, openUp ? spaceAbove : spaceBelow)),
                openUp,
            });
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (triggerRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest("[data-composer-select-menu]")) return;
            setQuery("");
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setQuery("");
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (!current) return null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="flex h-10 w-full items-center gap-2 rounded-[12px] px-2.5 text-left"
                style={{
                    color: theme.node.text,
                    background: theme.toolbar.itemHover,
                    boxShadow: open ? `inset 0 0 0 1.5px ${theme.node.activeStroke}` : `inset 0 0 0 1px ${theme.toolbar.border}`,
                }}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                onClick={() => {
                    if (open) {
                        setQuery("");
                        setOpen(false);
                        return;
                    }
                    const rect = triggerRef.current?.getBoundingClientRect();
                    if (rect) {
                        const spaceBelow = window.innerHeight - rect.bottom - 12;
                        const spaceAbove = rect.top - 12;
                        const openUp = spaceBelow < 168 && spaceAbove > spaceBelow;
                        setPos({
                            top: openUp ? rect.top : rect.bottom + 6,
                            left: rect.left,
                            width: Math.max(rect.width, 280),
                            maxHeight: Math.min(260, Math.max(132, openUp ? spaceAbove : spaceBelow)),
                            openUp,
                        });
                    }
                    setOpen(true);
                }}
            >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{current.label}</span>
                {current.price ? (
                    <span
                        className="shrink-0 rounded-full px-1.5 py-0.5"
                        style={{ background: theme.sidebar.surface, color: theme.node.muted }}
                    >
                        <ComposerPriceMark price={current.price} comparePrice={current.comparePrice} />
                    </span>
                ) : null}
                <ChevronDown className={cn("size-3.5 shrink-0 opacity-50 transition-transform duration-200", open && "rotate-180")} />
            </button>
            {typeof document !== "undefined"
                ? createPortal(
                    <AnimatePresence>
                    {open ? (
                    <motion.div
                        key="composer-select-menu"
                        data-composer-select-menu
                        data-canvas-no-zoom
                        role="listbox"
                        className="canvas-float-menu thin-scrollbar overflow-y-auto rounded-[14px] border p-1"
                        initial={{ opacity: 0, y: pos.openUp ? -6 : 6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: pos.openUp ? -4 : 4, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: MENU_EASE }}
                        style={{
                            position: "fixed",
                            top: pos.openUp ? undefined : pos.top,
                            bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
                            left: pos.left,
                            width: pos.width,
                            maxHeight: pos.maxHeight,
                            zIndex: 12100,
                            pointerEvents: "auto",
                            background: theme.toolbar.panel,
                            borderColor: theme.toolbar.border,
                            boxShadow: theme.toolbar.shadow,
                            color: theme.node.text,
                            backdropFilter: "blur(22px)",
                            transformOrigin: pos.openUp ? "50% 100%" : "50% 0%",
                            animation: "none",
                        }}
                    >
                        {options.length > 6 ? (
                            <input
                                autoFocus
                                value={query}
                                className="mb-1 h-8 w-full rounded-[10px] border-0 px-2.5 text-[12px] outline-none"
                                style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                                placeholder={t("agent.composer.searchModel")}
                                onChange={(event) => setQuery(event.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                            />
                        ) : null}
                        {filtered.length ? filtered.map((item) => {
                            const selected = item.value === current.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    className={cn(
                                        "flex min-h-10 w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left",
                                        !selected && "hover:bg-black/[.04] dark:hover:bg-white/[.08]",
                                    )}
                                    style={{
                                        color: selected ? theme.toolbar.activeText : theme.node.text,
                                        background: selected ? theme.toolbar.activeBg : undefined,
                                    }}
                                    onClick={() => {
                                        onChange(item.value);
                                        setQuery("");
                                        setOpen(false);
                                    }}
                                >
                                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.label}</span>
                                    <ComposerPriceMark price={item.price} comparePrice={item.comparePrice} />
                                    {selected ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                                </button>
                            );
                        }) : (
                            <div className="px-2.5 py-2 text-[12px] opacity-50">{t("agent.composer.noMatchingModel")}</div>
                        )}
                    </motion.div>
                    ) : null}
                    </AnimatePresence>,
                    ensureCanvasOverlayRoot(),
                  )
                : null}
        </>
    );
}

function AgentModelControls({ models, model, reasoningEffort, onModelChange, onReasoningEffortChange, open, onOpenChange, reasoningOpen, onReasoningOpenChange }: { models: AgentModel[]; model: string; reasoningEffort: AgentReasoningEffort; onModelChange: (model: string) => void; onReasoningEffortChange: (effort: AgentReasoningEffort) => void; open: boolean; onOpenChange: (open: boolean) => void; reasoningOpen: boolean; onReasoningOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation();
    const current = models.find((item) => item.model === model) || models[0];
    return (
        <div className="flex min-w-0 items-center gap-1">
            <Tooltip title={t("agent.composer.model", { model: current.displayName || current.model })} placement="top" open={open ? false : undefined}>
                <span className="inline-flex shrink-0">
                    <Select value={model} open={open} onOpenChange={onOpenChange} onValueChange={onModelChange}>
                        <SelectTrigger hideChevron className="h-9 w-9 min-w-9 justify-center gap-0 rounded-full border-0 bg-transparent px-0 text-xs font-medium shadow-none hover:bg-black/5 focus:ring-0 @min-[660px]:w-auto @min-[660px]:min-w-36 @min-[660px]:max-w-36 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:bg-transparent dark:hover:bg-white/10" aria-label={t("agent.composer.selectModel", { model: current.displayName || current.model })}>
                            <span className="hidden min-w-0 flex-1 truncate text-left @min-[660px]:inline">{current.displayName || current.model}</span>
                            <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
                        </SelectTrigger>
                        <SelectContent data-canvas-no-zoom position="popper" side="top" align="start" sideOffset={6} className="canvas-float-menu z-[1200] w-64 rounded-2xl border p-1 shadow-xl">
                            {models.map((item) => <SelectItem key={item.model} value={item.model}>{item.displayName || item.model}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </span>
            </Tooltip>
            <AgentReasoningControl reasoningEffort={reasoningEffort} reasoningEfforts={current.supportedReasoningEfforts.map((item) => item.reasoningEffort)} onReasoningEffortChange={onReasoningEffortChange} open={reasoningOpen} onOpenChange={onReasoningOpenChange} />
        </div>
    );
}

function AgentChatModelControl({ models, value, onChange, open, onOpenChange }: { models: ComposerPricedOption[]; value: string; onChange: (value: string) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const current = models.find((item) => item.value === value) || models[0];
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pos = useComposerAnchorPos(open, wrapRef, { align: "left", minWidth: 280 });
    const close = () => onOpenChange(false);

    useCloseOnOutsidePointer(open, wrapRef, close, menuRef);

    if (!current) return null;

    return (
        <div ref={wrapRef} className="relative min-w-0 max-w-[9.5rem] shrink">
            <button
                type="button"
                className="flex h-9 w-full min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs font-medium transition-[background-color,color] duration-200 hover:bg-black/5 dark:hover:bg-white/10"
                style={{ color: theme.node.text, background: open ? theme.toolbar.itemHover : undefined }}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={t("agent.composer.selectChatModel", { model: current.label })}
                title={current.label}
                onClick={() => onOpenChange(!open)}
            >
                <span className="min-w-0 truncate">{current.label}</span>
                <ChevronUp className={cn("size-3 shrink-0 opacity-50 transition-transform duration-200", open && "rotate-180")} />
            </button>
            {typeof document !== "undefined"
                ? createPortal(
                    <AnimatePresence>
                        {open ? (
                            <motion.div
                                key="chat-model-menu"
                                ref={menuRef}
                                role="listbox"
                                data-canvas-no-zoom
                                data-composer-float-menu
                                className="canvas-float-menu origin-bottom-left overflow-hidden rounded-[18px] border p-1.5"
                                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                                transition={{ duration: 0.22, ease: MENU_EASE }}
                                style={{
                                    position: "fixed",
                                    bottom: pos.bottom,
                                    left: pos.left,
                                    width: pos.width,
                                    zIndex: 12050,
                                    pointerEvents: "auto",
                                    background: theme.toolbar.panel,
                                    borderColor: theme.toolbar.border,
                                    boxShadow: theme.toolbar.shadow,
                                    color: theme.node.text,
                                    backdropFilter: "blur(22px)",
                                }}
                            >
                                {models.map((item, index) => {
                                    const active = item.value === current.value;
                                    return (
                                        <motion.button
                                            key={item.value}
                                            type="button"
                                            role="option"
                                            aria-selected={active}
                                            className="relative flex min-h-10 w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[13px] font-medium"
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.18, delay: 0.04 + index * 0.03, ease: MENU_EASE }}
                                            style={{ color: active ? theme.toolbar.activeText : theme.node.text }}
                                            onHoverStart={() => setHovered(item.value)}
                                            onHoverEnd={() => setHovered((currentHover) => (currentHover === item.value ? null : currentHover))}
                                            onClick={() => {
                                                onChange(item.value);
                                                onOpenChange(false);
                                            }}
                                        >
                                            {active ? (
                                                <span className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.activeBg }} />
                                            ) : hovered === item.value ? (
                                                <motion.span layoutId="agentChatModelHover" className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.itemHover }} transition={{ type: "spring", stiffness: 520, damping: 36 }} />
                                            ) : null}
                                            <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
                                            <span className="relative z-10"><ComposerPriceMark price={item.price} comparePrice={item.comparePrice} /></span>
                                            {active ? <Check className="relative z-10 size-3.5 shrink-0" /> : <span className="relative z-10 size-3.5 shrink-0" />}
                                        </motion.button>
                                    );
                                })}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>,
                    ensureCanvasOverlayRoot(),
                  )
                : null}
        </div>
    );
}

function AgentReasoningControl({ reasoningEffort, reasoningEfforts, reasoningEffortLabels, reasoningEffortPrices, reasoningEffortComparePrices, onReasoningEffortChange, open, onOpenChange }: { reasoningEffort: AgentReasoningEffort; reasoningEfforts: AgentReasoningEffort[]; reasoningEffortLabels?: Partial<Record<AgentReasoningEffort, string>>; reasoningEffortPrices?: Partial<Record<AgentReasoningEffort, string>>; reasoningEffortComparePrices?: Partial<Record<AgentReasoningEffort, string>>; onReasoningEffortChange: (effort: AgentReasoningEffort) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effortLabel = (effort: AgentReasoningEffort) => reasoningEffortLabels?.[effort] || t(`agent.composer.effort.${effort}`);
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pos = useComposerAnchorPos(open, wrapRef, { align: "right", minWidth: 260 });

    useCloseOnOutsidePointer(open, wrapRef, () => onOpenChange(false), menuRef);

    return (
        <div ref={wrapRef} className="relative inline-flex shrink-0">
                <button
                    type="button"
                    className="flex h-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color] duration-200 hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.text, background: open ? theme.toolbar.itemHover : undefined }}
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-label={t("agent.composer.selectReasoning", { effort: effortLabel(reasoningEffort) })}
                    title={effortLabel(reasoningEffort)}
                    onClick={() => onOpenChange(!open)}
                >
                    <Gauge className="size-3.5 shrink-0 opacity-70" />
                    <span>{effortLabel(reasoningEffort)}</span>
                    <ChevronUp className={cn("size-3 opacity-50 transition-transform duration-200", open && "rotate-180")} />
                </button>
                {typeof document !== "undefined"
                    ? createPortal(
                        <AnimatePresence>
                            {open ? (
                                <motion.div
                                    key="reasoning-menu"
                                    ref={menuRef}
                                    role="listbox"
                                    aria-label={t("agent.composer.reasoningSection")}
                                    data-canvas-no-zoom
                                    data-composer-float-menu
                                    className="canvas-float-menu origin-bottom-right overflow-hidden rounded-[18px] border p-1.5"
                                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                                    transition={{ duration: 0.22, ease: MENU_EASE }}
                                    style={{
                                        position: "fixed",
                                        bottom: pos.bottom,
                                        left: pos.left,
                                        width: pos.width,
                                        zIndex: 12050,
                                        pointerEvents: "auto",
                                        background: theme.toolbar.panel,
                                        borderColor: theme.toolbar.border,
                                        boxShadow: theme.toolbar.shadow,
                                        color: theme.node.text,
                                        backdropFilter: "blur(22px)",
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5 pt-1">
                                        <span className="text-[11px] font-semibold tracking-tight opacity-55">{t("agent.composer.reasoningSection")}</span>
                                        <span className="text-[11px] tabular-nums opacity-40">{t("agent.composer.effortCount", { count: reasoningEfforts.length })}</span>
                                    </div>
                                    {reasoningEfforts.map((effort, index) => {
                                        const active = effort === reasoningEffort;
                                        return (
                                            <motion.button
                                                key={effort}
                                                type="button"
                                                role="option"
                                                aria-selected={active}
                                                className="relative flex min-h-10 w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[13px] font-medium"
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.18, delay: 0.04 + index * 0.03, ease: MENU_EASE }}
                                                style={{ color: active ? theme.toolbar.activeText : theme.node.text }}
                                                onHoverStart={() => setHovered(effort)}
                                                onHoverEnd={() => setHovered((current) => (current === effort ? null : current))}
                                                onClick={() => {
                                                    onReasoningEffortChange(effort);
                                                    onOpenChange(false);
                                                }}
                                            >
                                                {active ? (
                                                    <span className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.activeBg }} />
                                                ) : hovered === effort ? (
                                                    <motion.span layoutId="agentReasoningHover" className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.itemHover }} transition={{ type: "spring", stiffness: 520, damping: 36 }} />
                                                ) : null}
                                                <span className="relative z-10 min-w-[2.5rem]">{effortLabel(effort)}</span>
                                                <span className="relative z-10 ml-auto">
                                                    <ComposerPriceMark price={reasoningEffortPrices?.[effort]} comparePrice={reasoningEffortComparePrices?.[effort]} />
                                                </span>
                                                {active ? <Check className="relative z-10 size-3.5 shrink-0" /> : <span className="relative z-10 size-3.5 shrink-0" />}
                                            </motion.button>
                                        );
                                    })}
                                </motion.div>
                            ) : null}
                        </AnimatePresence>,
                        ensureCanvasOverlayRoot(),
                      )
                    : null}
        </div>
    );
}

function PermissionModeMenu({ permissionMode, theme, onChange, open, onOpenChange }: { permissionMode: AgentPermissionMode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (permissionMode: AgentPermissionMode) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation();
    const permissionOptions: Array<{ key: AgentPermissionMode; title: string; shortTitle: string; description: string; icon: ReactNode }> = [
        { key: "request", title: t("agent.composer.permission.request"), shortTitle: t("agent.composer.permission.request"), description: t("agent.composer.permission.requestDescription"), icon: <ShieldAlert className="size-3.5" /> },
        { key: "automatic", title: t("agent.composer.permission.automatic"), shortTitle: t("agent.composer.permission.automatic"), description: t("agent.composer.permission.automaticDescription"), icon: <ShieldCheck className="size-3.5" /> },
        { key: "full", title: t("agent.composer.permission.full"), shortTitle: t("agent.composer.permission.fullShort"), description: t("agent.composer.permission.fullDescription"), icon: <ShieldOff className="size-3.5" /> },
    ];
    const current = permissionOptions.find((item) => item.key === permissionMode) || permissionOptions[0];
    return (
        <Tooltip title={t("agent.composer.permissionLabel", { mode: current.shortTitle })} placement="top" open={open ? false : undefined}>
            <span className="inline-flex shrink-0">
                <Dropdown
                    trigger={["click"]}
                    placement="topLeft"
                    open={open}
                    onOpenChange={onOpenChange}
                    overlayClassName="canvas-float-menu"
                    menu={{
                        items: permissionOptions.map((item) => ({
                            key: item.key,
                            label: <ConfirmationOption icon={item.icon} title={item.title} description={item.description} selected={permissionMode === item.key} />,
                            onClick: () => onChange(item.key),
                        })),
                    }}
                >
                    <button type="button" className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 @min-[660px]:h-9 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10" style={{ color: permissionMode === "full" ? "#ea580c" : theme.node.text }} aria-label={t("agent.composer.selectPermission", { mode: current.title })}>
                        {current.icon}
                        <span className="hidden @min-[660px]:inline">{current.shortTitle}</span>
                        <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
                    </button>
                </Dropdown>
            </span>
        </Tooltip>
    );
}

function ToolConfirmationMenu({ confirmTools, theme, onChange, open, onOpenChange }: { confirmTools: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (confirmTools: boolean) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation();
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const mode = t(confirmTools ? "agent.composer.tools.manual" : "agent.composer.tools.automatic");
    const options = [
        { key: "manual", value: true, icon: <Hand className="size-4" />, title: t("agent.composer.tools.manual"), description: t("agent.composer.tools.manualDescription") },
        { key: "automatic", value: false, icon: <RefreshCw className="size-4" />, title: t("agent.composer.tools.automatic"), description: t("agent.composer.tools.automaticDescription") },
    ];

    useCloseOnOutsidePointer(open, wrapRef, () => onOpenChange(false));

    return (
        <div ref={wrapRef} className="relative inline-flex shrink-0">
            <button
                type="button"
                className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10"
                style={{ color: theme.node.text, background: open ? theme.toolbar.itemHover : undefined }}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={t("agent.composer.tools.select", { mode })}
                onClick={() => onOpenChange(!open)}
            >
                {confirmTools ? <Hand className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                <span className="hidden @min-[660px]:inline">{mode}</span>
                <ChevronUp className={cn("hidden size-3 opacity-50 @min-[660px]:block", open && "rotate-180")} />
            </button>
            <AnimatePresence>
                {open ? (
                    <motion.div
                        key="confirm-tools-menu"
                        role="listbox"
                        data-canvas-no-zoom
                        className="absolute bottom-[calc(100%+6px)] left-0 z-40 min-w-64 origin-bottom-left overflow-hidden rounded-2xl border p-1"
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: MENU_EASE }}
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: theme.toolbar.shadow, color: theme.node.text, backdropFilter: "blur(22px)" }}
                    >
                        {options.map((item, index) => {
                            const active = item.value === confirmTools;
                            return (
                                <motion.button
                                    key={item.key}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    className="relative flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left"
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18, delay: 0.04 + index * 0.03, ease: MENU_EASE }}
                                    style={{ color: active ? theme.toolbar.activeText : theme.node.text }}
                                    onHoverStart={() => setHovered(item.key)}
                                    onHoverEnd={() => setHovered((current) => (current === item.key ? null : current))}
                                    onClick={() => {
                                        onChange(item.value);
                                        onOpenChange(false);
                                    }}
                                >
                                    {active ? (
                                        <span className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.activeBg }} />
                                    ) : hovered === item.key ? (
                                        <motion.span layoutId="agentConfirmToolsHover" className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.itemHover }} transition={{ type: "spring", stiffness: 520, damping: 36 }} />
                                    ) : null}
                                    <span className="relative z-10 mt-0.5 shrink-0">{item.icon}</span>
                                    <span className="relative z-10 min-w-0 flex-1">
                                        <span className="block text-sm font-medium">{item.title}</span>
                                        <span className="mt-0.5 block text-xs leading-5 opacity-60">{item.description}</span>
                                    </span>
                                    {active ? <Check className="relative z-10 mt-0.5 size-4 shrink-0" /> : null}
                                </motion.button>
                            );
                        })}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function ConfirmationOption({ icon, title, description, selected }: { icon: ReactNode; title: string; description: string; selected: boolean }) {
    return (
        <div className="flex min-w-64 items-start gap-3 py-1">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs leading-5 opacity-60">{description}</span>
            </span>
            {selected ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
        </div>
    );
}
