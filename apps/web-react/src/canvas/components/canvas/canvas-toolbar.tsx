import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import { Group, Hand, Home, Image as ImageIcon, MousePointer2, Music2, Plus, Puzzle, Redo2, Settings2, Trash2, Type, Undo2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isCanvasNodeTypeEnabled } from "@/constant/canvas";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType } from "@/types/canvas";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    onProjects,
    onCreateProject,
    onAddImage,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddExtensionNode,
    onDelete,
    onUndo,
    onRedo,
    onCanvasToolChange,
}: {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    onProjects: () => void;
    onCreateProject: () => void;
    onAddImage: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onDelete: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    const [extPanelX, setExtPanelX] = useState(0);
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const dockStyle = { background: theme.toolbar.panel, color: theme.toolbar.item, boxShadow: theme.toolbar.shadow };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    useEffect(() => {
        if (!extensionsOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setExtensionsOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [extensionsOpen]);

    return (
        <div ref={rootRef} className="relative">
            <div ref={wrapRef} className="canvas-editor-chrome canvas-chrome-cluster thin-scrollbar pointer-events-auto flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-full px-1.5 [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton id="tool-home" label={t("canvas.projects")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onProjects}>
                    <Home className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-new-project" label={t("canvas.create")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onCreateProject}>
                    <Plus className="size-3.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id={`tool-${canvasTool}`} label={t(`canvas.toolbar.${canvasTool}`)} active hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} onHover={setHovered} onClick={() => onCanvasToolChange(canvasTool === "select" ? "pan" : "select")}>
                    {canvasTool === "select" ? <MousePointer2 className="size-3.5" /> : <Hand className="size-3.5" />}
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-text" label={t("canvas.toolbar.text")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onAddText}>
                    <Type className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-image" label={t("canvas.toolbar.image")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onAddImage}>
                    <ImageIcon className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-video" label={isCanvasNodeTypeEnabled(CanvasNodeType.Video) ? t("canvas.toolbar.video") : `${t("canvas.toolbar.video")} · ${t("canvas.unavailable")}`} disabled={!isCanvasNodeTypeEnabled(CanvasNodeType.Video)} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered}>
                    <Video className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-audio" label={isCanvasNodeTypeEnabled(CanvasNodeType.Audio) ? t("canvas.toolbar.audio") : `${t("canvas.toolbar.audio")} · ${t("canvas.unavailable")}`} disabled={!isCanvasNodeTypeEnabled(CanvasNodeType.Audio)} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered}>
                    <Music2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-config" label={t("canvas.toolbar.config")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onAddConfig}>
                    <Settings2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-group" label={t("canvas.toolbar.group")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onAddGroup}>
                    <Group className="size-3.5" />
                </ToolbarButton>
                {extensionDefs.length ? (
                    <ToolbarButton
                        id="tool-extensions"
                        label={t("canvas.toolbar.extensions")}
                        active={extensionsOpen}
                        hovered={hovered}
                        activeStyle={activeStyle}
                        hoverStyle={hoverStyle}
                        onHover={setHovered}
                        onClick={(event) => {
                            setExtPanelX(getTipX(wrapRef.current, event.currentTarget));
                            setExtensionsOpen((value) => !value);
                        }}
                    >
                        <Puzzle className="size-3.5" />
                    </ToolbarButton>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton id="tool-undo" label={`${t("canvas.undo")} ⌘Z`} disabled={!canUndo} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-3.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-redo" label={`${t("canvas.redo")} ⌘⇧Z`} disabled={!canRedo} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-3.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        <ToolbarButton id="tool-delete" label={t("canvas.deleteSelected")} hovered={hovered} hoverStyle={hoverStyle} onHover={setHovered} onClick={onDelete} danger>
                            <Trash2 className="size-3.5" />
                        </ToolbarButton>
                    </>
                ) : null}
            </div>

            {extensionsOpen && extensionDefs.length ? (
                <div
                    className="thin-scrollbar pointer-events-auto absolute top-[calc(100%+8px)] z-30 max-h-[50vh] w-[240px] -translate-x-1/2 overflow-y-auto rounded-2xl p-2 shadow-xl backdrop-blur-xl"
                    style={{ left: extPanelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1.5 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.extensions")}</div>
                    <div className="grid gap-0.5">
                        {extensionDefs.map((def) => (
                            <button
                                key={def.type}
                                type="button"
                                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition"
                                style={{ color: theme.toolbar.item }}
                                onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
                                onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                                onClick={() => {
                                    onAddExtensionNode(def.type);
                                    setExtensionsOpen(false);
                                }}
                            >
                                <span className="grid size-7 shrink-0 place-items-center rounded-md text-base" style={{ background: theme.toolbar.itemHover }}>
                                    {def.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{def.title}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Tooltip title={label} placement="bottom">
            <span className="inline-flex">
                <Button
                    type="text"
                    aria-label={label}
                    className="!h-7 !w-7 !min-w-7 !p-0"
                    disabled={disabled}
                    style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? "#ef4444" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
                    icon={children}
                    onMouseEnter={() => onHover(id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={onClick}
                />
            </span>
        </Tooltip>
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-0.5 h-3.5 w-px" style={{ background: theme.toolbar.border }} />;
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}
