import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, Download, Eraser, Info, Palette, Pencil, Upload } from "lucide-react";
import { Switch, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes, type CanvasBackgroundMode, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasIconWellStyle } from "@/lib/canvas-ui";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
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
                className="pointer-events-none absolute left-0 right-0 top-3 z-50 flex h-11 items-center justify-end pr-4"
                style={{ paddingLeft: sidePanelOpen ? sidePanelWidth + 20 : 268, transition: "padding-left 380ms cubic-bezier(0.22, 1, 0.36, 1)" }}
            >
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
    theme: (typeof canvasThemes)["light"];
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

