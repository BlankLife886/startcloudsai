import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, CircleAlert, Download, Eraser, Info, LoaderCircle, Palette, Pencil, Play, RotateCcw, Square, Upload } from "lucide-react";
import { Switch, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes, type CanvasBackgroundMode, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasIconWellStyle } from "@/lib/canvas-ui";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { formatGenerationDuration, useGenerationElapsed } from "@/lib/canvas/canvas-generation-elapsed";
import { CanvasShortcutsDialog } from "./canvas-shortcuts-dialog";

export function CanvasTopBar({
    onRename,
    onOpenPlugins,
    agentOpen,
    onToggleAgent,
    backgroundMode,
    showImageInfo,
    onUpload,
    onExportProject,
    onClear,
    workflowRun,
    onRunWorkflow,
    onStopWorkflow,
    onRefreshWorkflow,
    onBackgroundModeChange,
    onShowImageInfoChange,
    children,
}: {
    onRename: () => void;
    onOpenPlugins: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onUpload: () => void;
    onExportProject: () => void;
    onClear: () => void;
    workflowRun: {
        status: "idle" | "running" | "locked" | "refresh" | "success" | "error" | "canceled";
        completed: number;
        total: number;
        currentNodeTitle?: string;
        errorMessage?: string;
        startedAt?: string;
        running?: number;
        queued?: number;
        canceling?: boolean;
    };
    onRunWorkflow: () => void;
    onStopWorkflow: () => void;
    onRefreshWorkflow: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    children?: ReactNode;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const extrasRef = useRef<HTMLDivElement>(null);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const sidePanelWidth = useCanvasSidePanelStore((state) => state.width);

    useEffect(() => {
        if (!appearanceOpen) return;
        const close = (event: PointerEvent) => {
            if (!extrasRef.current?.contains(event.target as Node)) setAppearanceOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [appearanceOpen]);

    return (
        <>
            <div
                className="pointer-events-none absolute left-0 right-0 top-3 z-50 flex h-11 items-center justify-between pr-4"
                style={{ paddingLeft: sidePanelOpen ? sidePanelWidth + 20 : 268, transition: "padding-left 380ms cubic-bezier(0.22, 1, 0.36, 1)" }}
            >
                <div className="pointer-events-auto shrink-0">
                    <WorkflowControl theme={theme} workflowRun={workflowRun} onRun={onRunWorkflow} onStop={onStopWorkflow} onRefresh={onRefreshWorkflow} />
                </div>

                {children ? <div className="pointer-events-auto absolute left-1/2 top-1/2 max-w-[min(720px,calc(100%-380px))] -translate-x-1/2 -translate-y-1/2">{children}</div> : null}

                <div className="pointer-events-auto flex items-center gap-2">
                    <div ref={extrasRef} className="canvas-chrome-cluster relative" style={{ color: theme.toolbar.item }}>
                        <ChromeAction title={t("canvas.project.rename")} theme={theme} onClick={onRename}>
                            <Pencil className="size-3.5" />
                        </ChromeAction>
                        <ChromeAction title={t("canvas.importAsset")} theme={theme} onClick={onUpload}>
                            <Upload className="size-3.5" />
                        </ChromeAction>
                        <ChromeAction title={t("canvas.exportCurrent")} theme={theme} onClick={onExportProject}>
                            <Download className="size-3.5" />
                        </ChromeAction>
                        <ChromeAction title={t("canvas.toolbar.appearance")} theme={theme} active={appearanceOpen} onClick={() => setAppearanceOpen((value) => !value)}>
                            <Palette className="size-3.5" />
                        </ChromeAction>
                        <ChromeAction title={t("canvas.toolbar.clear")} theme={theme} danger onClick={onClear}>
                            <Eraser className="size-3.5" />
                        </ChromeAction>
                        <span className="mx-0.5 h-3.5 w-px" style={{ background: theme.toolbar.border }} />
                        <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                        {appearanceOpen ? (
                            <AppearancePanel
                                theme={theme}
                                backgroundMode={backgroundMode}
                                showImageInfo={showImageInfo}
                                onBackgroundModeChange={onBackgroundModeChange}
                                onShowImageInfoChange={onShowImageInfoChange}
                            />
                        ) : null}
                    </div>
                    <button
                        type="button"
                        className="canvas-agent-pill canvas-chrome-cluster"
                        style={{
                            color: agentOpen ? theme.toolbar.activeText : theme.node.text,
                            background: agentOpen ? theme.toolbar.activeBg : undefined,
                        }}
                        onClick={onToggleAgent}
                    >
                        <Bot className="size-3.5" />
                        Agent
                    </button>
                </div>
            </div>
            <CanvasShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </>
    );
}

function WorkflowControl({
    theme,
    workflowRun,
    onRun,
    onStop,
    onRefresh,
}: {
    theme: CanvasTheme;
    workflowRun: {
        status: "idle" | "running" | "locked" | "refresh" | "success" | "error" | "canceled";
        completed: number;
        total: number;
        currentNodeTitle?: string;
        errorMessage?: string;
        startedAt?: string;
        running?: number;
        queued?: number;
        canceling?: boolean;
    };
    onRun: () => void;
    onStop: () => void;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const active = workflowRun.status === "running" || workflowRun.status === "locked";
    const progress = workflowRun.total > 0 ? Math.min(1, Math.max(0, workflowRun.completed / workflowRun.total)) : 0;
    const elapsedMs = useGenerationElapsed(workflowRun.startedAt, undefined, active);
    const elapsedLabel = formatGenerationDuration(elapsedMs);

    if (active) {
        const locked = workflowRun.status === "locked";
        const label = locked
            ? t("canvas.workflow.lockedShort")
            : workflowRun.canceling
              ? t("canvas.workflow.stopping")
              : workflowRun.currentNodeTitle
                ? t("canvas.workflow.running")
                : t("canvas.workflow.preparing");
        const detail = locked
            ? t("canvas.workflow.backgroundRunning")
            : workflowRun.canceling
              ? t("canvas.workflow.finishingSubmitted", { count: workflowRun.running || 0 })
              : (workflowRun.running || 0) > 1
                ? t("canvas.workflow.parallelRunning", { count: workflowRun.running })
                : workflowRun.currentNodeTitle || t("canvas.workflow.preparing");
        return (
            <div className="canvas-workflow-pill is-running" style={{ color: theme.node.text }}>
                <WorkflowProgress value={progress} color={theme.node.activeStroke} />
                <Tooltip title={detail} placement="bottom">
                    <span className="canvas-workflow-pill__label">{label}</span>
                </Tooltip>
                {workflowRun.total > 0 ? (
                    <span className="canvas-workflow-pill__meta">
                        {workflowRun.completed}/{workflowRun.total}
                    </span>
                ) : null}
                <span className="canvas-workflow-pill__meta tabular-nums">{elapsedLabel}</span>
                {locked ? null : (
                    <Tooltip title={t("canvas.workflow.stop")} placement="bottom">
                        <button type="button" className="canvas-chrome-btn" onClick={onStop} aria-label={t("canvas.workflow.stop")} style={{ color: theme.toolbar.item }}>
                            <Square className="size-2.5 fill-current" />
                        </button>
                    </Tooltip>
                )}
            </div>
        );
    }

    if (workflowRun.status === "error") {
        return (
            <Tooltip title={workflowRun.errorMessage || workflowRun.currentNodeTitle || t("canvas.workflow.failedShort")} placement="bottom">
                <button type="button" className="canvas-workflow-pill is-error" onClick={onRun} aria-label={t("canvas.workflow.retry")}>
                    <CircleAlert className="size-3.5 shrink-0" />
                    <span className="canvas-workflow-pill__label">{t("canvas.workflow.failedLabel")}</span>
                    <span className="canvas-workflow-pill__meta inline-flex items-center gap-1">
                        <RotateCcw className="size-3" />
                        {t("canvas.workflow.retryShort")}
                    </span>
                </button>
            </Tooltip>
        );
    }

    if (workflowRun.status === "refresh") {
        return (
            <button type="button" className="canvas-workflow-run" onClick={onRefresh}>
                <RotateCcw className="size-3.5 shrink-0" />
                <span className="canvas-workflow-pill__label">{t("canvas.workflow.refreshResults")}</span>
            </button>
        );
    }

    return (
        <button type="button" className="canvas-workflow-run" onClick={onRun} aria-label={t("canvas.workflow.run")}>
            <Play className="size-3.5 shrink-0 fill-current" />
            <span className="canvas-workflow-pill__label">{t("canvas.workflow.run")}</span>
        </button>
    );
}

function WorkflowProgress({ value, color }: { value: number; color: string }) {
    const radius = 8;
    const circumference = 2 * Math.PI * radius;
    return (
        <span className="canvas-workflow-ring" aria-hidden>
            <svg viewBox="0 0 22 22">
                <circle cx="11" cy="11" r={radius} fill="none" stroke={color} strokeOpacity="0.16" strokeWidth="1.75" />
                <circle
                    cx="11"
                    cy="11"
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * value} ${circumference}`}
                />
            </svg>
            <LoaderCircle className="size-2.5 animate-spin" style={{ color }} />
        </span>
    );
}

function AppearancePanel({
    theme,
    backgroundMode,
    showImageInfo,
    onBackgroundModeChange,
    onShowImageInfoChange,
}: {
    theme: CanvasTheme;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
}) {
    const { t } = useTranslation();
    const modes: Array<{ value: CanvasBackgroundMode; label: string }> = [
        { value: "dots", label: t("canvas.toolbar.dots") },
        { value: "lines", label: t("canvas.toolbar.lines") },
        { value: "blank", label: t("canvas.toolbar.blank") },
    ];

    return (
        <div className="canvas-float-menu absolute right-0 top-[calc(100%+8px)] z-30 w-[280px] rounded-[22px] p-3" style={{ background: theme.toolbar.panel, color: theme.toolbar.item }}>
            <div className="px-1 pb-3 text-[13px] font-semibold tracking-wide" style={{ color: theme.node.text }}>
                {t("canvas.toolbar.appearance")}
            </div>
            <div className="px-1 pb-2 text-[11px] font-medium tracking-wide" style={{ color: theme.node.faint }}>
                {t("canvas.toolbar.gridStyle")}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
                {modes.map((mode) => {
                    const active = backgroundMode === mode.value;
                    return (
                        <button
                            key={mode.value}
                            type="button"
                            className="flex flex-col overflow-hidden rounded-[14px] text-left transition"
                            style={{
                                background: active ? theme.toolbar.activeBg : theme.toolbar.itemHover,
                                boxShadow: active ? `inset 0 0 0 1.5px ${theme.node.activeStroke}` : `inset 0 0 0 1px ${theme.toolbar.border}`,
                                color: active ? theme.toolbar.activeText : theme.node.text,
                            }}
                            onClick={() => onBackgroundModeChange(mode.value)}
                        >
                            <span className="mx-1.5 mt-1.5 h-12 overflow-hidden rounded-[10px]" style={{ background: theme.canvas.background }}>
                                <GridPreview mode={mode.value} theme={theme} />
                            </span>
                            <span className="px-1.5 py-1.5 text-center text-[11px] font-semibold">{mode.label}</span>
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] px-2 py-2" style={{ background: theme.toolbar.itemHover }}>
                <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium" style={{ color: theme.node.text }}>
                    <span className="grid size-7 place-items-center rounded-[9px]" style={CanvasIconWellStyle("#6d5cff")}>
                        <Info className="size-3.5" />
                    </span>
                    {t("canvas.toolbar.imageInfo")}
                </span>
                <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
            </div>
        </div>
    );
}

function GridPreview({ mode, theme }: { mode: CanvasBackgroundMode; theme: CanvasTheme }) {
    if (mode === "blank") return <span className="block h-full w-full" />;
    return (
        <span
            className="block h-full w-full"
            style={{
                backgroundImage:
                    mode === "dots"
                        ? `radial-gradient(circle, ${theme.canvas.dot} 1.2px, transparent 1.4px)`
                        : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`,
                backgroundSize: mode === "dots" ? "10px 10px" : "12px 12px",
            }}
        />
    );
}

function ChromeAction({
    title,
    theme,
    danger,
    active,
    onClick,
    children,
}: {
    title: string;
    theme: CanvasTheme;
    danger?: boolean;
    active?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Tooltip title={title} placement="bottom">
            <button
                type="button"
                className={`canvas-chrome-btn${active ? " is-active" : ""}`}
                style={{ color: danger ? "#ef4444" : theme.node.text }}
                onClick={onClick}
                aria-label={title}
            >
                {children}
            </button>
        </Tooltip>
    );
}
