import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { App, Popconfirm, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Download, Eye, FileText, Image as ImageIcon, ListChecks, Music2, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Square, Trash2, Type, Video } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasIconWellStyle, nodeTypeColor } from "@/lib/canvas-ui";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { buildCanvasSidePanelWorkflowGroups } from "@/lib/canvas/canvas-workflow-groups";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";
import { CanvasPreviewImage } from "./canvas-preview-image";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const CAPSULE_HEIGHT = 44;
const CAPSULE_WIDTH = 256;

type PanelTab = "canvas" | "assets" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, connections, selectedNodeIds, onFocusNode, onPreviewNode, onInsertAsset }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const [tabDirection, setTabDirection] = useState(0);
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const openPanel = useCanvasSidePanelStore((state) => state.openPanel);
    const closePanel = useCanvasSidePanelStore((state) => state.closePanel);
    const [resizing, setResizing] = useState(false);
    const tabs = [
        { id: "canvas" as const, label: t("canvas.sidePanel.canvas") },
        { id: "assets" as const, label: t("canvas.sidePanel.assets") },
        { id: "prompts" as const, label: t("canvas.sidePanel.prompts") },
    ];
    const openTab = (next: PanelTab) => {
        const from = tabs.findIndex((item) => item.id === tab);
        const to = tabs.findIndex((item) => item.id === next);
        if (to !== from) setTabDirection(to > from ? 1 : -1);
        setTab(next);
        if (!panelOpen) openPanel();
    };
    const hostRef = useRef<HTMLDivElement>(null);
    const [hostHeight, setHostHeight] = useState(() => (typeof window === "undefined" ? 800 : Math.max(window.innerHeight - 120, 400)));

    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const update = () => setHostHeight(host.clientHeight);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(host);
        return () => observer.disconnect();
    }, []);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("canvas-side-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <div ref={hostRef} className="pointer-events-none absolute inset-y-3 left-3 z-[60] w-0">
            <motion.aside
                className="pointer-events-auto relative flex flex-col backdrop-blur-xl"
                initial={false}
                animate={{
                    height: panelOpen ? Math.max(hostHeight, CAPSULE_HEIGHT) : CAPSULE_HEIGHT,
                    width: panelOpen ? width : CAPSULE_WIDTH,
                    borderRadius: panelOpen ? 22 : 999,
                }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: theme.toolbar.shadow, border: `1px solid ${theme.toolbar.border}`, overflow: "hidden" }}
                data-canvas-no-zoom
            >
                <div className="flex h-11 shrink-0 items-center gap-0.5 px-1.5" style={panelOpen ? { boxShadow: `inset 0 -1px 0 ${theme.toolbar.border}` } : undefined}>
                    {tabs.map((item) => {
                        const active = tab === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                className="relative h-8 rounded-full px-3 text-[13px] font-semibold transition-colors duration-200 hover:opacity-100"
                                style={{ color: active ? theme.toolbar.activeText : theme.toolbar.item, opacity: active ? 1 : 0.62 }}
                                onClick={() => openTab(item.id)}
                            >
                                {active ? (
                                    <motion.span
                                        layoutId="sidePanelTabPill"
                                        className="absolute inset-0 rounded-full"
                                        style={{ background: theme.toolbar.activeBg }}
                                        transition={{ type: "spring", stiffness: 520, damping: 38 }}
                                    />
                                ) : null}
                                <span className="relative z-10">{item.label}</span>
                            </button>
                        );
                    })}
                    <PanelToggle
                        theme={theme}
                        open={panelOpen}
                        onClick={panelOpen ? closePanel : openPanel}
                        collapseLabel={t("canvas.collapsePanel")}
                        expandLabel={t("canvas.expandPanel")}
                    />
                </div>
                <motion.div
                    className="relative min-h-0 flex-1 overflow-hidden"
                    initial={false}
                    animate={panelOpen ? { opacity: 1, y: 0 } : { opacity: 0, y: 0 }}
                    transition={{ duration: panelOpen ? 0.32 : 0, delay: panelOpen ? 0.08 : 0, ease: PANEL_EASE }}
                >
                    <AnimatePresence initial={false} custom={tabDirection}>
                        <motion.div
                            key={tab}
                            className="absolute inset-0"
                            custom={tabDirection}
                            initial={{ opacity: 0, x: tabDirection * 18 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: tabDirection * -16 }}
                            transition={{ duration: 0.24, ease: PANEL_EASE }}
                        >
                            {tab === "canvas" ? (
                                <CanvasNodesTab nodes={nodes} connections={connections} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
                            ) : tab === "assets" ? (
                                <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />
                            ) : (
                                <CanvasPromptsTab onInsert={onInsertAsset} theme={theme} />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </motion.div>
                {panelOpen ? <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("canvas.sidePanel.resize")} /> : null}
            </motion.aside>
        </div>
    );
}

function PanelToggle({
    theme,
    open,
    onClick,
    collapseLabel,
    expandLabel,
}: {
    theme: CanvasTheme;
    open: boolean;
    onClick: () => void;
    collapseLabel: string;
    expandLabel: string;
}) {
    const label = open ? collapseLabel : expandLabel;
    return (
        <button
            type="button"
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-200 ease-out hover:scale-105 hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: theme.toolbar.item }}
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Canvas tab: list nodes and center, zoom, and select the clicked node.
// ---------------------------------------------------------------------------

const NODE_FILTER_VALUES = ["all", CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text, CanvasNodeType.Audio, CanvasNodeType.Config, CanvasNodeType.Group];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

function CanvasNodesTab({ nodes, connections, selectedNodeIds, onFocusNode, onPreviewNode, theme }: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; onPreviewNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const workflowGroups = useMemo(() => buildCanvasSidePanelWorkflowGroups(nodes, connections), [connections, nodes]);
    const grouped = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return workflowGroups
            .map((group, index) => ({
                ...group,
                workflowIndex: index + 1,
                nodes: group.nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query))),
            }))
            .filter((group) => group.nodes.length);
    }, [keyword, typeFilter, workflowGroups]);
    const filtered = useMemo(() => grouped.flatMap((group) => group.nodes), [grouped]);
    const toggleGroup = (groupId: string) =>
        setCollapsedGroups((current) => {
            const next = new Set(current);
            next.has(groupId) ? next.delete(groupId) : next.add(groupId);
            return next;
        });

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("canvas.sidePanel.exporting"), 0);
        try {
            await exportCanvasNodes(targets, t("canvas.sidePanel.exportName", { count: targets.length }));
            message.success(t("canvas.sidePanel.exported", { count: targets.length }));
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="relative z-20 flex items-center gap-2 px-3 pb-2 pt-3">
                <span className="text-[12px] font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.sidePanel.elements")}
                    {filtered.length ? <span className="ml-1 opacity-60">{filtered.length}</span> : null}
                </span>
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-[background-color,color,transform] duration-200 ease-out hover:scale-[1.03]"
                    style={selectMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { background: theme.node.fill, color: theme.node.muted }}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? t("common.cancel") : t("canvas.sidePanel.select")}
                </button>
                {selectMode ? null : (
                    <PanelFilterMenu
                        value={typeFilter}
                        onChange={setTypeFilter}
                        theme={theme}
                        options={NODE_FILTER_VALUES.map((value) => ({
                            value,
                            label: value === "all" ? t("common.all") : t(`canvas.sidePanel.filter.${value}`),
                            icon: value === "all" ? ListChecks : NODE_TYPE_ICON[value] || FileText,
                        }))}
                    />
                )}
            </div>
            <div className="px-3 pb-3">
                <PanelSearch value={keyword} onChange={setKeyword} placeholder={t("canvas.sidePanel.searchNodes")} theme={theme} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <motion.div key={typeFilter} className="space-y-1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: PANEL_EASE }}>
                        {grouped.map((group) => {
                            const collapsed = collapsedGroups.has(group.id) && !keyword.trim();
                            const workflowName = group.firstConfig?.title.replace(/^\d+\s*[|｜]\s*/, "") || "";
                            const groupLabel = group.firstConfig ? t("canvas.sidePanel.workflowGroup", { index: group.workflowIndex, name: workflowName }) : t("canvas.sidePanel.standaloneNodes");
                            return (
                                <div key={group.id}>
                                    <button
                                        type="button"
                                        className="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[11px] font-semibold transition-colors hover:bg-black/[.04] disabled:cursor-default dark:hover:bg-white/[.05]"
                                        style={{ color: theme.node.muted }}
                                        onClick={() => toggleGroup(group.id)}
                                        disabled={Boolean(keyword.trim())}
                                        aria-expanded={!collapsed}
                                    >
                                        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")} />
                                        {group.firstConfig ? <Settings2 className="size-3.5 shrink-0" /> : <Square className="size-3.5 shrink-0" />}
                                        <span className="min-w-0 flex-1 truncate" title={groupLabel}>{groupLabel}</span>
                                        <span className="tabular-nums opacity-50">{group.nodes.length}</span>
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {!collapsed ? (
                                            <motion.div
                                                key="nodes"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2, ease: PANEL_EASE }}
                                                className="overflow-hidden"
                                            >
                                                <div className="space-y-1">
                                                    {group.nodes.map((node) => {
                                                        const Icon = NODE_TYPE_ICON[node.type] || FileText;
                                                        const isImage = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content || node.metadata?.thumbnailUrl);
                                                        const isChecked = checked.has(node.id);
                                                        const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                                                        return (
                                                            <div key={node.id} className="group flex w-full items-center rounded-2xl transition-[background-color,transform] duration-200 ease-out hover:translate-x-0.5 hover:bg-black/[.04] dark:hover:bg-white/[.05]" style={active ? { background: theme.toolbar.activeBg } : undefined}>
                                                                <button type="button" onClick={() => (selectMode ? toggleChecked(node.id) : onFocusNode(node.id))} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left" title={selectMode ? undefined : t("canvas.sidePanel.focusNode")}>
                                                                    {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                                                                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl transition-transform duration-300 ease-out group-hover:scale-105" style={isImage ? { background: theme.node.fill } : CanvasIconWellStyle(nodeTypeColor(node.type))}>
                                                                        {isImage ? <CanvasPreviewImage storageKey={node.metadata?.storageKey} thumbnailUrl={node.metadata?.thumbnailUrl} alt={node.title} maxEdge={160} allowOriginalFallback={false} className="size-full object-cover" /> : <Icon className="size-4" />}
                                                                    </span>
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block truncate text-[13px] font-medium leading-5">{node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled")}</span>
                                                                        <span className="mt-0.5 block truncate text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                                                            {nodePreviewText(node)}
                                                                        </span>
                                                                    </span>
                                                                    {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                                                </button>
                                                                {selectMode || !isImage ? null : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onPreviewNode(node.id)}
                                                                        className="mr-1.5 grid size-7 place-items-center rounded-full opacity-0 transition-[opacity,transform,background-color] duration-200 ease-out group-hover:opacity-70 hover:!opacity-100 hover:scale-110 hover:bg-black/5 dark:hover:bg-white/10"
                                                                        style={{ color: theme.node.muted }}
                                                                        aria-label={t("canvas.sidePanel.preview")}
                                                                        title={t("canvas.sidePanel.preview")}
                                                                    >
                                                                        <Eye className="size-3.5" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </motion.div>
                                        ) : null}
                                    </AnimatePresence>
                                </div>
                            );
                        })}
                    </motion.div>
                ) : (
                    <CanvasEmptyState icon={<Square className="size-5" />} title={t("canvas.sidePanel.noNodes")} hint={t("canvas.sidePanel.noNodesHint")} color={theme.node.muted} />
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ boxShadow: `inset 0 1px 0 ${theme.toolbar.border}` }}>
                    <button type="button" onClick={toggleAll} className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                        {allChecked ? t("canvas.sidePanel.clearAll") : t("canvas.sidePanel.selectAll")}
                    </button>
                    <span className="text-[11px]" style={{ color: theme.node.faint }}>
                        {t("canvas.sidePanel.selected", { count: checked.size })}
                    </span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}
                    >
                        <Download className="size-3.5" />
                        {t("canvas.exportSelected")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function PanelFilterMenu({
    value,
    onChange,
    options,
    theme,
}: {
    value: string;
    onChange: (next: string) => void;
    options: { value: string; label: string; icon: typeof Square }[];
    theme: CanvasTheme;
}) {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const current = options.find((item) => item.value === value) || options[0];

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (wrapRef.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        const timer = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", close);
        };
    }, [open]);

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-[background-color,color,transform] duration-200 ease-out hover:scale-[1.04]"
                style={{ background: open ? theme.toolbar.activeBg : theme.node.fill, color: open ? theme.toolbar.activeText : theme.node.muted }}
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
            >
                {current.label}
                <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
            </button>
            <AnimatePresence>
                {open ? (
                    <motion.div
                        key="filter-menu"
                        className="canvas-float-menu absolute right-0 top-[calc(100%+6px)] z-30 w-[168px] origin-top-right overflow-hidden rounded-2xl border p-1"
                        initial={{ opacity: 0, y: -8, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.96 }}
                        transition={{ duration: 0.2, ease: PANEL_EASE }}
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: theme.toolbar.shadow, backdropFilter: "blur(22px)" }}
                    >
                        {options.map((item, index) => {
                            const Icon = item.icon;
                            const active = item.value === value;
                            return (
                                <motion.button
                                    key={item.value}
                                    type="button"
                                    className="relative flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[12px] font-medium"
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18, delay: 0.04 + index * 0.02, ease: PANEL_EASE }}
                                    style={active ? { color: theme.toolbar.activeText } : { color: theme.node.text }}
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
                                        <motion.span layoutId="sidePanelFilterHover" className="absolute inset-0 rounded-xl" style={{ background: theme.toolbar.itemHover }} transition={{ type: "spring", stiffness: 520, damping: 36 }} />
                                    ) : null}
                                    <Icon className="relative z-10 size-3.5 shrink-0 opacity-70" />
                                    <span className="relative z-10 min-w-0 flex-1">{item.label}</span>
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

function PanelSearch({ value, onChange, placeholder, theme }: { value: string; onChange: (value: string) => void; placeholder: string; theme: CanvasTheme }) {
    return (
        <label className="flex h-9 items-center gap-2 rounded-xl px-3" style={{ background: theme.toolbar.itemHover }}>
            <Search className="size-3.5 shrink-0" style={{ color: theme.node.faint }} />
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                style={{ color: theme.node.text }}
            />
        </label>
    );
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Assets tab: collapsible type groups, tag filtering, and click-to-insert.
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; icon: typeof Square }[] = [
    { kind: "image", icon: ImageIcon },
    { kind: "video", icon: Video },
    { kind: "text", icon: FileText },
];

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const addSharedImage = useAssetStore((state) => state.addSharedImage);
    const syncCloudImages = useAssetStore((state) => state.syncCloudImages);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const controller = new AbortController();
        void syncCloudImages(controller.signal);
        const onVisible = () => {
            if (document.visibilityState === "visible") void syncCloudImages();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            controller.abort();
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [syncCloudImages]);

    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (tagFilter === "all" || (asset.tags || []).includes(tagFilter)) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, tagFilter]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);

    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        let added = 0;
        try {
            for (const file of files) {
                if (file.type.startsWith("image/")) {
                    const image = await uploadImage(file);
                    await addSharedImage({ kind: "image", title: file.name || t("assets.kinds.image"), coverUrl: image.thumbnailUrl || image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
                    added += 1;
                } else if (file.type.startsWith("video/")) {
                    const media = await uploadMediaFile(file, "video");
                    addAsset({ kind: "video", title: file.name || t("assets.kinds.video"), coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
                    added += 1;
                }
            }
            if (added) message.success(t("canvas.sidePanel.addedAssets", { count: added }));
            else message.warning(t("canvas.sidePanel.mediaOnly"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-3">
                <div className="min-w-0 flex-1">
                    <PanelSearch value={keyword} onChange={setKeyword} placeholder={t("canvas.sidePanel.searchAssets")} theme={theme} />
                </div>
                <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="grid size-9 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}
                    aria-label={t("canvas.sidePanel.add")}
                    title={t("canvas.sidePanel.add")}
                >
                    <Plus className="size-4" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
            </div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        {t("common.all")}
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
                {groups.length ? (
                    <div className="space-y-3">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="mb-1.5 flex w-full items-center gap-1.5 px-0.5 text-left text-[11px] font-medium"
                                        style={{ color: theme.node.muted }}
                                    >
                                        <ChevronRight className={cn("size-3 transition-transform", !isCollapsed && "rotate-90")} />
                                        <span>{t(`assets.kinds.${group.kind}`)}</span>
                                        <span className="tabular-nums opacity-70">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-3 gap-1.5">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onInsert={() => onInsert(buildInsertPayload(asset))} onRemove={() => (removeAsset(asset.id), message.success(t("canvas.sidePanel.assetRemoved")))} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <CanvasEmptyState icon={<ImageIcon className="size-5" />} title={t("canvas.sidePanel.noAssets")} hint={t("canvas.sidePanel.noAssetsHint")} color="#10b981" />
                )}
            </div>
        </div>
    );
});

function AssetCard({ asset, theme, onInsert, onRemove }: { asset: Asset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="group relative aspect-square overflow-hidden rounded-xl transition duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ background: theme.node.panel, boxShadow: theme.toolbar.shadow }}>
            <AssetCover asset={asset} />
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 transition duration-200 group-hover:opacity-100">
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-7 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-3.5" />
                </button>
                <Popconfirm title={t("canvas.sidePanel.removeAssetTitle")} okText={t("canvas.sidePanel.remove")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label={t("canvas.sidePanel.removeAsset")}
                    >
                        <Trash2 className="size-3.5" />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "video") {
        if (asset.coverUrl) return <CanvasPreviewImage src={asset.coverUrl} storageKey={asset.data.storageKey} maxEdge={160} allowOriginalFallback={false} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
        return <div className="size-full bg-black/80" />;
    }
    return <CanvasPreviewImage storageKey={asset.data.storageKey} thumbnailUrl={asset.coverUrl} maxEdge={160} allowOriginalFallback={false} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
}

// ---------------------------------------------------------------------------
// 提示词库 Tab: all content is distributed by the site API.
// ---------------------------------------------------------------------------

const CanvasPromptsTab = memo(function CanvasPromptsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [detail, setDetail] = useState<Prompt | null>(null);
    const query = useQuery({
        queryKey: ["side-panel-prompts", "infinite_canvas", keyword.trim()],
        queryFn: () => fetchPrompts({ keyword, type: "infinite_canvas", pageSize: 100 }),
        staleTime: 30_000,
    });

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("canvas.sidePanel.promptCopied"));
        } catch {
            message.error(t("canvas.sidePanel.copyFailed"));
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-3 pt-3">
                <PanelSearch value={keyword} onChange={setKeyword} placeholder={t("canvas.sidePanel.searchPrompts")} theme={theme} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {query.isLoading ? (
                    <div className="flex justify-center py-8">
                        <Spin size="small" />
                    </div>
                ) : null}
                {query.isError ? (
                    <button type="button" onClick={() => void query.refetch()} className="block w-full py-8 text-center text-xs text-red-500">
                        加载失败，点击重试
                    </button>
                ) : null}
                {query.data?.items.length ? (
                    <div className="space-y-1.5">
                        {query.data.items.map((item) => (
                            <PromptRow key={item.id} item={item} theme={theme} onInsert={() => onInsert({ kind: "text", content: item.prompt, title: item.title })} onView={() => setDetail(item)} />
                        ))}
                    </div>
                ) : !query.isLoading && !query.isError ? (
                    <CanvasEmptyState icon={<FileText className="size-5" />} title={t("canvas.sidePanel.noPrompts")} hint={t("canvas.sidePanel.noPromptsHint")} color="#6d5cff" />
                ) : null}
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
        </div>
    );
});

function PromptRow({ item, theme, onInsert, onView }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="group relative flex items-center gap-2.5 rounded-2xl px-2.5 py-2 transition-[background-color,transform] duration-200 ease-out hover:translate-x-0.5 hover:bg-black/[.04] dark:hover:bg-white/[.05]">
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={CanvasIconWellStyle("#6d5cff")}>
                    <FileText className="size-4" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.viewDetails")} title={t("canvas.sidePanel.viewDetails")}>
                    <Eye className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label={t("canvas.sidePanel.inserted")}
                    title={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}

function CanvasEmptyState({ icon, title, hint, color }: { icon: ReactNode; title: string; hint: string; color: string }) {
    return (
        <div className="canvas-empty">
            <span className="canvas-empty__icon" style={CanvasIconWellStyle(color, 0.12)}>
                {icon}
            </span>
            <div className="canvas-empty__title">{title}</div>
            <div className="canvas-empty__hint">{hint}</div>
        </div>
    );
}
