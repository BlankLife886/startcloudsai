import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Dropdown, Tooltip } from "antd";
import { ArrowUp, Check, ChevronUp, Coins, Gauge, Hand, ImagePlus, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, SlidersHorizontal, Square, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { canvasThemes } from "@/lib/canvas-theme";
import { ensureCanvasOverlayRoot } from "@/lib/canvas-portal";
import { cn } from "@/lib/utils";
import { useAgentStore, type AgentModel, type AgentPermissionMode, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AgentChatAttachment } from "./agent-chat-message";
import { AgentChatPromptInput } from "./agent-chat-prompt-input";

const MENU_EASE = [0.22, 1, 0.36, 1] as const;

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
    onModelChange,
    onReasoningEffortChange,
    chatModels,
    chatModel,
    onChatModelChange,
    left,
    sendCost,
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
    onModelChange?: (model: string) => void;
    onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
    chatModels?: Array<{ value: string; label: string; price?: string }>;
    chatModel?: string;
    onChatModelChange?: (model: string) => void;
    left?: ReactNode;
    sendCost?: string;
    hint?: ReactNode;
}) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasReferences = useAgentStore((state) => state.canvasReferences);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length || canvasReferences.length);
    return (
        <div className="px-3 pb-3 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="overflow-visible rounded-[22px] border px-3 pb-3 pt-3" style={{ background: theme.sidebar.surface, borderColor: theme.sidebar.border, boxShadow: theme.sidebar.shadow }}>
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
                                onReasoningEffortChange={onReasoningEffortChange}
                            />
                        </div>
                        <div className="hidden min-w-0 items-center gap-1 @min-[560px]:flex">
                            {onConfirmToolsChange ? <ToolConfirmationMenu confirmTools={Boolean(confirmTools)} theme={theme} onChange={onConfirmToolsChange} /> : null}
                            {permissionMode && onPermissionModeChange ? <PermissionModeMenu permissionMode={permissionMode} theme={theme} onChange={onPermissionModeChange} /> : null}
                            {models?.length && model && reasoningEffort && onModelChange && onReasoningEffortChange ? <AgentModelControls models={models} model={model} reasoningEffort={reasoningEffort} onModelChange={onModelChange} onReasoningEffortChange={onReasoningEffortChange} /> : null}
                            {!models?.length && chatModels?.length && chatModel && onChatModelChange ? <AgentChatModelControl models={chatModels} value={chatModel} onChange={onChatModelChange} /> : null}
                            {!models?.length && reasoningEffort && reasoningEfforts?.length && onReasoningEffortChange ? <AgentReasoningControl reasoningEffort={reasoningEffort} reasoningEfforts={reasoningEfforts} reasoningEffortLabels={reasoningEffortLabels} reasoningEffortPrices={reasoningEffortPrices} onReasoningEffortChange={onReasoningEffortChange} /> : null}
                        </div>
                        {left}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {sending && onStop ? (
                            <Tooltip title={t("agent.composer.stop")} placement="top"><Button danger shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Square className="size-4" />} onClick={() => void onStop()} aria-label={t("agent.composer.stop")} /></Tooltip>
                        ) : (
                            <Tooltip title={t("agent.composer.send")} placement="top">
                                <Button
                                    type="primary"
                                    shape={sendCost ? "round" : "circle"}
                                    className={sendCost ? "!h-9 !min-w-9 !gap-1 !pl-2.5 !pr-3" : "!h-10 !w-10 !min-w-10"}
                                    disabled={!canSubmit}
                                    icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : sendCost ? <Coins className="size-4" /> : <ArrowUp className="size-4" />}
                                    onClick={() => void onSubmit()}
                                    aria-label={t("agent.composer.send")}
                                >
                                    {sendCost ? <span className="text-[12px] font-semibold tabular-nums tracking-tight">{sendCost}</span> : null}
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>
            {hint ? <div className="px-1 pt-2 text-center text-[11px] leading-4" style={{ color: theme.node.faint }}>{hint}</div> : null}
        </div>
    );
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
    chatModels?: Array<{ value: string; label: string; price?: string }>;
    chatModel?: string;
    onChatModelChange?: (model: string) => void;
    reasoningEffort?: AgentReasoningEffort | "";
    reasoningEfforts?: AgentReasoningEffort[];
    reasoningEffortLabels?: Partial<Record<AgentReasoningEffort, string>>;
    reasoningEffortPrices?: Partial<Record<AgentReasoningEffort, string>>;
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
    const effortOptions = reasoningEfforts?.length
        ? reasoningEfforts
        : (currentLocal?.supportedReasoningEfforts || []).map((item) => item.reasoningEffort);
    const effortLabel = reasoningEffort
        ? reasoningEffortLabels?.[reasoningEffort] || t(`agent.composer.effort.${reasoningEffort}`)
        : "";
    const summary = [modelLabel, effortLabel].filter(Boolean).join(" · ") || t("agent.composer.settings");
    const permissionOptions: Array<{ key: AgentPermissionMode; title: string; description: string; icon: ReactNode }> = [
        { key: "request", title: t("agent.composer.permission.request"), description: t("agent.composer.permission.requestDescription"), icon: <ShieldAlert className="size-4" /> },
        { key: "automatic", title: t("agent.composer.permission.automatic"), description: t("agent.composer.permission.automaticDescription"), icon: <ShieldCheck className="size-4" /> },
        { key: "full", title: t("agent.composer.permission.full"), description: t("agent.composer.permission.fullDescription"), icon: <ShieldOff className="size-4" /> },
    ];
    const confirmOptions = [
        { key: "manual", value: true, icon: <Hand className="size-4" />, title: t("agent.composer.tools.manual"), description: t("agent.composer.tools.manualDescription") },
        { key: "automatic", value: false, icon: <RefreshCw className="size-4" />, title: t("agent.composer.tools.automatic"), description: t("agent.composer.tools.automaticDescription") },
    ];
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
            const width = Math.min(280, window.innerWidth - 24);
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
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
        document.addEventListener("keydown", onKey);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close);
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
                        className="canvas-float-menu thin-scrollbar origin-bottom-left overflow-y-auto rounded-2xl border p-1.5"
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
                        }}
                    >
                        {currentChat && onChatModelChange ? (
                            <ComposerSettingsSection title={t("agent.composer.modelSection")}>
                                {chatModels?.map((item) => (
                                    <ComposerSettingsOption
                                        key={item.value}
                                        title={item.label}
                                        meta={item.price}
                                        selected={item.value === currentChat.value}
                                        theme={theme}
                                        onSelect={() => onChatModelChange(item.value)}
                                    />
                                ))}
                            </ComposerSettingsSection>
                        ) : null}
                        {currentLocal && onModelChange ? (
                            <ComposerSettingsSection title={t("agent.composer.modelSection")}>
                                {models?.map((item) => (
                                    <ComposerSettingsOption
                                        key={item.model}
                                        title={item.displayName || item.model}
                                        selected={item.model === currentLocal.model}
                                        theme={theme}
                                        onSelect={() => onModelChange(item.model)}
                                    />
                                ))}
                            </ComposerSettingsSection>
                        ) : null}
                        {reasoningEffort && effortOptions.length && onReasoningEffortChange ? (
                            <ComposerSettingsSection title={t("agent.composer.reasoningSection")}>
                                {effortOptions.map((effort) => (
                                    <ComposerSettingsOption
                                        key={effort}
                                        title={reasoningEffortLabels?.[effort] || t(`agent.composer.effort.${effort}`)}
                                        description={reasoningEffortPrices?.[effort]}
                                        selected={effort === reasoningEffort}
                                        theme={theme}
                                        onSelect={() => onReasoningEffortChange(effort)}
                                    />
                                ))}
                            </ComposerSettingsSection>
                        ) : null}
                        {permissionMode && onPermissionModeChange ? (
                            <ComposerSettingsSection title={t("agent.composer.permissionSection")}>
                                {permissionOptions.map((item) => (
                                    <ComposerSettingsOption
                                        key={item.key}
                                        icon={item.icon}
                                        title={item.title}
                                        description={item.description}
                                        selected={permissionMode === item.key}
                                        theme={theme}
                                        onSelect={() => onPermissionModeChange(item.key)}
                                    />
                                ))}
                            </ComposerSettingsSection>
                        ) : null}
                        {onConfirmToolsChange ? (
                            <ComposerSettingsSection title={t("agent.composer.toolsSection")}>
                                {confirmOptions.map((item) => (
                                    <ComposerSettingsOption
                                        key={item.key}
                                        icon={item.icon}
                                        title={item.title}
                                        description={item.description}
                                        selected={item.value === Boolean(confirmTools)}
                                        theme={theme}
                                        onSelect={() => onConfirmToolsChange(item.value)}
                                    />
                                ))}
                            </ComposerSettingsSection>
                        ) : null}
                    </motion.div>
                    </AnimatePresence>,
                    ensureCanvasOverlayRoot(),
                  )
                : null}
        </div>
    );
}

function ComposerSettingsSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="px-1 py-1">
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium tracking-wide opacity-50">{title}</div>
            <div className="flex flex-col gap-0.5">{children}</div>
        </div>
    );
}

function ComposerSettingsOption({
    icon,
    title,
    description,
    meta,
    selected,
    theme,
    onSelect,
}: {
    icon?: ReactNode;
    title: string;
    description?: string;
    meta?: string;
    selected: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className="relative flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left"
            style={{ color: selected ? theme.toolbar.activeText : theme.node.text, background: selected ? theme.toolbar.activeBg : undefined }}
            aria-selected={selected}
            onClick={onSelect}
        >
            {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
                    {meta ? <span className="shrink-0 text-[11px] tabular-nums opacity-55">{meta}</span> : null}
                </span>
                {description ? <span className="mt-0.5 block text-[11px] leading-4 opacity-60">{description}</span> : null}
            </span>
            {selected ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
        </button>
    );
}

function AgentModelControls({ models, model, reasoningEffort, onModelChange, onReasoningEffortChange }: { models: AgentModel[]; model: string; reasoningEffort: AgentReasoningEffort; onModelChange: (model: string) => void; onReasoningEffortChange: (effort: AgentReasoningEffort) => void }) {
    const { t } = useTranslation();
    const current = models.find((item) => item.model === model) || models[0];
    const [modelOpen, setModelOpen] = useState(false);
    return (
        <div className="flex min-w-0 items-center gap-1">
            <Tooltip title={t("agent.composer.model", { model: current.displayName || current.model })} placement="top" open={modelOpen ? false : undefined}>
                <span className="inline-flex shrink-0">
                    <Select value={model} open={modelOpen} onOpenChange={setModelOpen} onValueChange={onModelChange}>
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
            <AgentReasoningControl reasoningEffort={reasoningEffort} reasoningEfforts={current.supportedReasoningEfforts.map((item) => item.reasoningEffort)} onReasoningEffortChange={onReasoningEffortChange} />
        </div>
    );
}

function AgentChatModelControl({ models, value, onChange }: { models: Array<{ value: string; label: string; price?: string }>; value: string; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const current = models.find((item) => item.value === value) || models[0];
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (wrapRef.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
        document.addEventListener("keydown", onKey);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

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
                onClick={() => setOpen((currentOpen) => !currentOpen)}
            >
                <span className="min-w-0 truncate">{current.label}</span>
                <ChevronUp className={cn("size-3 shrink-0 opacity-50 transition-transform duration-200", open && "rotate-180")} />
            </button>
            <AnimatePresence>
                {open ? (
                    <motion.div
                        key="chat-model-menu"
                        role="listbox"
                        data-canvas-no-zoom
                        className="absolute bottom-[calc(100%+6px)] left-0 z-30 min-w-[200px] max-w-[min(280px,calc(100vw-48px))] origin-bottom-left overflow-hidden rounded-2xl border p-1"
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: MENU_EASE }}
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: theme.toolbar.shadow, color: theme.node.text, backdropFilter: "blur(22px)" }}
                    >
                        {models.map((item, index) => {
                            const active = item.value === current.value;
                            return (
                                <motion.button
                                    key={item.value}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    className="relative flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[12px] font-medium"
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18, delay: 0.04 + index * 0.03, ease: MENU_EASE }}
                                    style={{ color: active ? theme.toolbar.activeText : theme.node.text }}
                                    onHoverStart={() => setHovered(item.value)}
                                    onHoverEnd={() => setHovered((currentHover) => (currentHover === item.value ? null : currentHover))}
                                    onClick={() => {
                                        onChange(item.value);
                                        setOpen(false);
                                    }}
                                >
                                    {active ? (
                                        <span className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.activeBg }} />
                                    ) : hovered === item.value ? (
                                        <motion.span layoutId="agentChatModelHover" className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.itemHover }} transition={{ type: "spring", stiffness: 520, damping: 36 }} />
                                    ) : null}
                                    <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
                                    {item.price ? <span className="relative z-10 shrink-0 tabular-nums opacity-55">{item.price}</span> : null}
                                    {active ? <Check className="relative z-10 size-3.5 shrink-0" /> : null}
                                </motion.button>
                            );
                        })}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function AgentReasoningControl({ reasoningEffort, reasoningEfforts, reasoningEffortLabels, reasoningEffortPrices, onReasoningEffortChange }: { reasoningEffort: AgentReasoningEffort; reasoningEfforts: AgentReasoningEffort[]; reasoningEffortLabels?: Partial<Record<AgentReasoningEffort, string>>; reasoningEffortPrices?: Partial<Record<AgentReasoningEffort, string>>; onReasoningEffortChange: (effort: AgentReasoningEffort) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effortLabel = (effort: AgentReasoningEffort) => reasoningEffortLabels?.[effort] || t(`agent.composer.effort.${effort}`);
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (wrapRef.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
        document.addEventListener("keydown", onKey);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

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
                    onClick={() => setOpen((current) => !current)}
                >
                    <Gauge className="size-3.5 shrink-0 opacity-70" />
                    <span>{effortLabel(reasoningEffort)}</span>
                    <ChevronUp className={cn("size-3 opacity-50 transition-transform duration-200", open && "rotate-180")} />
                </button>
                <AnimatePresence>
                    {open ? (
                        <motion.div
                            key="reasoning-menu"
                            role="listbox"
                            data-canvas-no-zoom
                            className="absolute bottom-[calc(100%+6px)] left-0 z-30 min-w-[132px] origin-bottom-left overflow-hidden rounded-2xl border p-1"
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.98 }}
                            transition={{ duration: 0.22, ease: MENU_EASE }}
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: theme.toolbar.shadow, color: theme.node.text, backdropFilter: "blur(22px)" }}
                        >
                            {reasoningEfforts.map((effort, index) => {
                                const active = effort === reasoningEffort;
                                return (
                                    <motion.button
                                        key={effort}
                                        type="button"
                                        role="option"
                                        aria-selected={active}
                                        className="relative flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[12px] font-medium"
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.18, delay: 0.04 + index * 0.03, ease: MENU_EASE }}
                                        style={{ color: active ? theme.toolbar.activeText : theme.node.text }}
                                        onHoverStart={() => setHovered(effort)}
                                        onHoverEnd={() => setHovered((current) => (current === effort ? null : current))}
                                        onClick={() => {
                                            onReasoningEffortChange(effort);
                                            setOpen(false);
                                        }}
                                    >
                                        {active ? (
                                            <span className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.activeBg }} />
                                        ) : hovered === effort ? (
                                            <motion.span layoutId="agentReasoningHover" className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.itemHover }} transition={{ type: "spring", stiffness: 520, damping: 36 }} />
                                        ) : null}
                                        <span className="relative z-10 min-w-0 flex-1">{effortLabel(effort)}</span>
                                        {reasoningEffortPrices?.[effort] ? <small className="relative z-10 shrink-0 text-[10px] font-normal opacity-60">{reasoningEffortPrices[effort]}</small> : null}
                                        {active ? <Check className="relative z-10 size-3.5 shrink-0" /> : null}
                                    </motion.button>
                                );
                            })}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
        </div>
    );
}

function PermissionModeMenu({ permissionMode, theme, onChange }: { permissionMode: AgentPermissionMode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (permissionMode: AgentPermissionMode) => void }) {
    const { t } = useTranslation();
    const permissionOptions: Array<{ key: AgentPermissionMode; title: string; shortTitle: string; description: string; icon: ReactNode }> = [
        { key: "request", title: t("agent.composer.permission.request"), shortTitle: t("agent.composer.permission.request"), description: t("agent.composer.permission.requestDescription"), icon: <ShieldAlert className="size-3.5" /> },
        { key: "automatic", title: t("agent.composer.permission.automatic"), shortTitle: t("agent.composer.permission.automatic"), description: t("agent.composer.permission.automaticDescription"), icon: <ShieldCheck className="size-3.5" /> },
        { key: "full", title: t("agent.composer.permission.full"), shortTitle: t("agent.composer.permission.fullShort"), description: t("agent.composer.permission.fullDescription"), icon: <ShieldOff className="size-3.5" /> },
    ];
    const current = permissionOptions.find((item) => item.key === permissionMode) || permissionOptions[0];
    const [open, setOpen] = useState(false);
    return (
        <Tooltip title={t("agent.composer.permissionLabel", { mode: current.shortTitle })} placement="top" open={open ? false : undefined}>
            <span className="inline-flex shrink-0">
                <Dropdown
                    trigger={["click"]}
                    placement="topLeft"
                    open={open}
                    onOpenChange={setOpen}
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

function ToolConfirmationMenu({ confirmTools, theme, onChange }: { confirmTools: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (confirmTools: boolean) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const mode = t(confirmTools ? "agent.composer.tools.manual" : "agent.composer.tools.automatic");
    const options = [
        { key: "manual", value: true, icon: <Hand className="size-4" />, title: t("agent.composer.tools.manual"), description: t("agent.composer.tools.manualDescription") },
        { key: "automatic", value: false, icon: <RefreshCw className="size-4" />, title: t("agent.composer.tools.automatic"), description: t("agent.composer.tools.automaticDescription") },
    ];

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (wrapRef.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
        document.addEventListener("keydown", onKey);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div ref={wrapRef} className="relative inline-flex shrink-0">
            <button
                type="button"
                className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10"
                style={{ color: theme.node.text, background: open ? theme.toolbar.itemHover : undefined }}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={t("agent.composer.tools.select", { mode })}
                onClick={() => setOpen((current) => !current)}
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
                                        setOpen(false);
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
