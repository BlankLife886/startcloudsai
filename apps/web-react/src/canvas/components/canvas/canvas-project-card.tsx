import { ArrowUpRight, Check, Pencil, Trash2 } from "lucide-react";
import { DownloadIcon } from "@react/components/common/DownloadIcon.jsx";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { prefetchCanvasProjectDocument, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { cn } from "@/lib/utils";
import { useCanvasPreviewSrc, useViewportMedia } from "./canvas-preview-image";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const PREVIEW_PADDING_X = 48;
const PREVIEW_PADDING_Y = 40;
const MAX_PREVIEW_NODES = 16;

type PreviewPalette = {
    chip: string;
    chipInk: string;
    wash: string;
    stroke: string;
};

const nodePalette: Record<string, PreviewPalette> = {
    [CanvasNodeType.Image]: { chip: "#7c3aed", chipInk: "#f5f3ff", wash: "#f4f0ff", stroke: "#ddd6fe" },
    [CanvasNodeType.Text]: { chip: "#2563eb", chipInk: "#eff6ff", wash: "#eef4ff", stroke: "#bfdbfe" },
    [CanvasNodeType.Config]: { chip: "#4f46e5", chipInk: "#eef2ff", wash: "#eef2ff", stroke: "#c7d2fe" },
    [CanvasNodeType.Video]: { chip: "#ea580c", chipInk: "#fff7ed", wash: "#fff4eb", stroke: "#fed7aa" },
    [CanvasNodeType.Audio]: { chip: "#059669", chipInk: "#ecfdf5", wash: "#ecfdf5", stroke: "#a7f3d0" },
    [CanvasNodeType.Group]: { chip: "#64748b", chipInk: "#f8fafc", wash: "rgba(248,250,252,0.72)", stroke: "#cbd5e1" },
};

function previewPalette(type: string) {
    return nodePalette[type] ?? { chip: "#7c3aed", chipInk: "#f5f3ff", wash: "#f8f7ff", stroke: "#ddd6fe" };
}

function nodePreviewScore(node: CanvasNodeData, degree: Map<string, number>) {
    return (degree.get(node.id) || 0) * 3 + (node.metadata?.content ? 5 : 0) + (node.type === CanvasNodeType.Image ? 2 : 0) + (node.type === CanvasNodeType.Group ? -1 : 0);
}

function pickPreviewNodes(nodes: CanvasNodeData[], connections: CanvasProject["connections"]) {
    if (nodes.length <= MAX_PREVIEW_NODES) return nodes;

    const degree = new Map<string, number>();
    connections.forEach((connection) => {
        degree.set(connection.fromNodeId, (degree.get(connection.fromNodeId) || 0) + 1);
        degree.set(connection.toNodeId, (degree.get(connection.toNodeId) || 0) + 1);
    });

    const bounds = nodes.reduce(
        (result, node) => ({
            minX: Math.min(result.minX, node.position.x),
            minY: Math.min(result.minY, node.position.y),
            maxX: Math.max(result.maxX, node.position.x + node.width),
            maxY: Math.max(result.maxY, node.position.y + node.height),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const selected = new Set<string>();
    const ranked = [...nodes].sort((a, b) => nodePreviewScore(b, degree) - nodePreviewScore(a, degree));
    ranked.slice(0, 8).forEach((node) => selected.add(node.id));

    const cols = 4;
    const rows = 3;
    const cellWidth = Math.max(bounds.maxX - bounds.minX, 1) / cols;
    const cellHeight = Math.max(bounds.maxY - bounds.minY, 1) / rows;
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            if (selected.size >= MAX_PREVIEW_NODES) break;
            const cellNodes = ranked.filter((node) => {
                const x = node.position.x + node.width / 2;
                const y = node.position.y + node.height / 2;
                return x >= bounds.minX + col * cellWidth && x < bounds.minX + (col + 1) * cellWidth && y >= bounds.minY + row * cellHeight && y < bounds.minY + (row + 1) * cellHeight;
            });
            const candidate = cellNodes.find((node) => !selected.has(node.id));
            if (candidate) selected.add(candidate.id);
        }
    }

    ranked.forEach((node) => {
        if (selected.size < MAX_PREVIEW_NODES) selected.add(node.id);
    });

    return nodes.filter((node) => selected.has(node.id));
}

function PreviewTypeIcon({ type, x, y, size, color }: { type: string; x: number; y: number; size: number; color: string }) {
    const s = size / 16;
    const transform = `translate(${x} ${y}) scale(${s})`;
    if (type === CanvasNodeType.Image) {
        return (
            <g transform={transform} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="12" height="10" rx="2" />
                <circle cx="6" cy="7" r="1.1" fill={color} stroke="none" />
                <path d="M3.5 11.5 7 8.5l2.2 2.1 1.6-1.6 2.7 2.5" />
            </g>
        );
    }
    if (type === CanvasNodeType.Text) {
        return (
            <g transform={transform} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round">
                <path d="M4 4.5h8M4 8h8M4 11.5h5.5" />
            </g>
        );
    }
    if (type === CanvasNodeType.Video) {
        return (
            <g transform={transform} fill={color} stroke="none">
                <path d="M6 5.2v5.6c0 .5.55.8.96.55l4.2-2.8a.64.64 0 0 0 0-1.1l-4.2-2.8A.64.64 0 0 0 6 5.2Z" />
            </g>
        );
    }
    if (type === CanvasNodeType.Audio) {
        return (
            <g transform={transform} fill={color}>
                <rect x="3.2" y="7.2" width="1.6" height="3.2" rx="0.6" />
                <rect x="6.2" y="5.2" width="1.6" height="7.2" rx="0.6" />
                <rect x="9.2" y="6.4" width="1.6" height="4.8" rx="0.6" />
                <rect x="12.2" y="4.8" width="1.6" height="8" rx="0.6" />
            </g>
        );
    }
    if (type === CanvasNodeType.Config) {
        return (
            <g transform={transform} fill="none" stroke={color} strokeWidth="1.6">
                <circle cx="8" cy="8" r="2.1" />
                <circle cx="8" cy="8" r="5" strokeDasharray="1.6 1.5" />
            </g>
        );
    }
    return (
        <g transform={transform} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round">
            <rect x="3" y="4" width="10" height="8" rx="1.8" />
            <path d="M3 7h10" />
        </g>
    );
}

function PreviewNodeContent({ node, x, y, width, height, palette, enabled }: { node: CanvasNodeData; x: number; y: number; width: number; height: number; palette: PreviewPalette; enabled: boolean }) {
    const media = node.metadata?.content;
    const preview = useCanvasPreviewSrc(node.type === CanvasNodeType.Image ? media : undefined, { storageKey: node.metadata?.storageKey, thumbnailUrl: node.metadata?.thumbnailUrl, maxEdge: 256, enabled, allowOriginalFallback: false });
    if (node.type === CanvasNodeType.Image && media) {
        return preview.src ? <image href={preview.src} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid slice" /> : <rect x={x} y={y} width={width} height={height} fill={palette.wash} />;
    }
    if (node.type === CanvasNodeType.Video && media) {
        return (
            <g>
                <rect x={x} y={y} width={width} height={height} fill="#161821" />
                <circle cx={x + width / 2} cy={y + height / 2} r={Math.min(width, height) * 0.16} fill="rgba(255,255,255,0.92)" />
                <path d={`M ${x + width / 2 - 2} ${y + height / 2 - 4} l 7 4 -7 4 z`} fill="#ea580c" />
            </g>
        );
    }
    if (node.type === CanvasNodeType.Text) {
        const line = Math.max(3, Math.min(5, Math.round(width / 28)));
        return (
            <g fill="#8b93a8" opacity="0.9">
                {Array.from({ length: 3 }, (_, index) => (
                    <rect key={index} x={x} y={y + index * (line + 4)} width={index === 2 ? width * 0.62 : width} height={line} rx={line / 2} />
                ))}
            </g>
        );
    }
    if (node.type === CanvasNodeType.Audio) {
        const bars = 7;
        const gap = 3;
        const barWidth = Math.max(3, (width - gap * (bars - 1)) / bars);
        return (
            <g fill={palette.chip} opacity="0.72">
                {Array.from({ length: bars }, (_, index) => {
                    const barHeight = height * (0.35 + ((index * 3) % 5) * 0.12);
                    return <rect key={index} x={x + index * (barWidth + gap)} y={y + height - barHeight} width={barWidth} height={barHeight} rx={barWidth / 2} />;
                })}
            </g>
        );
    }
    if (node.type === CanvasNodeType.Config) {
        return (
            <g>
                <rect x={x} y={y} width={width * 0.42} height={10} rx="5" fill={palette.stroke} />
                <rect x={x + width * 0.48} y={y} width={width * 0.32} height={10} rx="5" fill={palette.wash} stroke={palette.stroke} />
                <rect x={x} y={y + 16} width={width * 0.7} height={6} rx="3" fill={palette.stroke} opacity="0.7" />
            </g>
        );
    }
    return (
        <g fill={palette.stroke}>
            <rect x={x} y={y} width={width * 0.78} height={6} rx="3" />
            <rect x={x} y={y + 11} width={width * 0.5} height={6} rx="3" opacity="0.7" />
        </g>
    );
}

function CanvasTopologyPreview({ project }: { project: CanvasProject }) {
    const { t } = useTranslation();
    const { elementRef, shouldLoad } = useViewportMedia(!project.documentPending && project.nodes.length > 0);

    if (project.documentPending) {
        return (
            <div className="canvas-blank-preview" aria-busy="true">
                <span>{t("canvas.project.loadingPreview")}</span>
            </div>
        );
    }

    if (!project.nodes.length) {
        return (
            <div className="canvas-blank-preview">
                <span>{t("canvas.blank")}</span>
            </div>
        );
    }

    const visibleNodes = pickPreviewNodes(project.nodes, project.connections);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const bounds = visibleNodes.reduce(
        (result, node) => ({
            minX: Math.min(result.minX, node.position.x),
            minY: Math.min(result.minY, node.position.y),
            maxX: Math.max(result.maxX, node.position.x + node.width),
            maxY: Math.max(result.maxY, node.position.y + node.height),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = Math.min((PREVIEW_WIDTH - PREVIEW_PADDING_X * 2) / contentWidth, (PREVIEW_HEIGHT - PREVIEW_PADDING_Y * 2) / contentHeight);
    const offsetX = (PREVIEW_WIDTH - contentWidth * scale) / 2;
    const offsetY = (PREVIEW_HEIGHT - contentHeight * scale) / 2;
    const compact = visibleNodes.length > 10;
    const previewNodes = visibleNodes.map((node) => {
        const isImage = node.type === CanvasNodeType.Image;
        const width = Math.min(Math.max(node.width * scale, compact ? 72 : 88), isImage ? 132 : 124);
        const height = Math.min(Math.max(node.height * scale, compact ? 48 : 58), isImage ? 86 : 78);
        const centerX = offsetX + (node.position.x - bounds.minX + node.width / 2) * scale;
        const centerY = offsetY + (node.position.y - bounds.minY + node.height / 2) * scale;
        return {
            ...node,
            previewX: Math.min(Math.max(centerX - width / 2, 16), PREVIEW_WIDTH - width - 16),
            previewY: Math.min(Math.max(centerY - height / 2, 14), PREVIEW_HEIGHT - height - 14),
            previewWidth: width,
            previewHeight: height,
        };
    });
    const nodeMap = new Map(previewNodes.map((node) => [node.id, node]));
    const shadowId = `preview-shadow-${project.id}`;

    return (
        <svg ref={(node) => { elementRef.current = node; }} className="h-full w-full" viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`} role="img" aria-label={`${project.title} 节点拓扑预览`}>
            <defs>
                <filter id={shadowId} x="-25%" y="-35%" width="150%" height="180%">
                    <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#2e1065" floodOpacity="0.1" />
                </filter>
                {previewNodes.map((node) => (
                    <clipPath key={`clip-${node.id}`} id={`preview-clip-${project.id}-${node.id}`}>
                        <rect x={node.previewX} y={node.previewY} width={node.previewWidth} height={node.previewHeight} rx="14" />
                    </clipPath>
                ))}
            </defs>
            {project.connections.map((connection) => {
                const from = nodeMap.get(connection.fromNodeId);
                const to = nodeMap.get(connection.toNodeId);
                if (!from || !to || !visibleIds.has(from.id) || !visibleIds.has(to.id)) return null;
                const x1 = from.previewX + from.previewWidth;
                const y1 = from.previewY + from.previewHeight / 2;
                const x2 = to.previewX;
                const y2 = to.previewY + to.previewHeight / 2;
                const bend = Math.max(Math.abs(x2 - x1) * 0.46, 28);
                return (
                    <g key={connection.id} className="text-violet-400/80 dark:text-violet-300/50">
                        <path d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        <circle cx={x1} cy={y1} r="3.2" fill="currentColor" />
                        <circle cx={x2} cy={y2} r="3.2" fill="currentColor" />
                    </g>
                );
            })}
            {previewNodes.map((node) => {
                const palette = previewPalette(node.type);
                const isGroup = node.type === CanvasNodeType.Group;
                const hasMedia = Boolean(node.metadata?.content) && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video);
                const chip = Math.min(22, Math.max(16, node.previewHeight * 0.28));
                const pad = 10;
                const showChip = node.previewWidth >= 70 && !hasMedia;
                const contentX = node.previewX + pad + (showChip ? chip + 8 : 0);
                const contentY = node.previewY + pad + (hasMedia ? 0 : 2);
                const contentWidth = node.previewWidth - pad * 2 - (showChip ? chip + 8 : 0);
                const contentHeight = node.previewHeight - pad * 2;
                return (
                    <g key={node.id} filter={`url(#${shadowId})`}>
                        <rect
                            x={node.previewX}
                            y={node.previewY}
                            width={node.previewWidth}
                            height={node.previewHeight}
                            rx="14"
                            fill={hasMedia ? "#ffffff" : palette.wash}
                            stroke={isGroup ? palette.chip : palette.stroke}
                            strokeWidth={isGroup ? 1.6 : 1.2}
                            strokeDasharray={isGroup ? "5 4" : undefined}
                        />
                        <g clipPath={`url(#preview-clip-${project.id}-${node.id})`}>
                            <PreviewNodeContent node={node} x={hasMedia ? node.previewX : contentX} y={hasMedia ? node.previewY : contentY} width={hasMedia ? node.previewWidth : contentWidth} height={hasMedia ? node.previewHeight : contentHeight} palette={palette} enabled={shouldLoad} />
                        </g>
                        {showChip ? (
                            <g>
                                <rect x={node.previewX + pad} y={node.previewY + (node.previewHeight - chip) / 2} width={chip} height={chip} rx="7" fill={palette.chip} />
                                <PreviewTypeIcon type={node.type} x={node.previewX + pad + chip * 0.18} y={node.previewY + (node.previewHeight - chip) / 2 + chip * 0.18} size={chip * 0.64} color={palette.chipInk} />
                            </g>
                        ) : null}
                    </g>
                );
            })}
        </svg>
    );
}

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const selected = selectedIds.includes(project.id);
    const { elementRef, shouldLoad } = useViewportMedia(Boolean(project.documentPending || project.documentStale));
    const updatedAt = new Date(project.updatedAt).toLocaleDateString(i18n.language, { month: "2-digit", day: "2-digit" });
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);

    useEffect(() => {
        if (shouldLoad) prefetchCanvasProjectDocument(project.id);
    }, [project.id, shouldLoad]);

    return (
        <article ref={(node) => { elementRef.current = node; }} className={cn("canvas-project-tile group", selected && "is-selected")}>
            <div className="canvas-project-tile__preview cursor-pointer" onClick={open}>
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={t("canvas.project.select", { name: project.title })}
                    className={cn(
                        "absolute left-3 top-3 z-10 grid size-6 place-items-center rounded-md border shadow-sm transition",
                        selected
                            ? "border-violet-500 bg-violet-600 text-white opacity-100"
                            : "border-white/80 bg-white/90 text-transparent opacity-0 group-hover:opacity-100 dark:border-white/15 dark:bg-stone-950/80",
                    )}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleSelected(project.id, !selected);
                    }}
                >
                    <Check className="size-3.5" />
                </button>
                <div
                    className="absolute right-3 top-3 z-10 flex translate-y-1 items-center gap-0.5 rounded-2xl border border-white/60 bg-white/80 p-1 opacity-0 shadow-[0_10px_24px_rgba(49,32,107,0.12)] backdrop-blur-md transition group-hover:translate-y-0 group-hover:opacity-100 dark:border-white/10 dark:bg-stone-950/75"
                    onClick={(event) => event.stopPropagation()}
                >
                    <button type="button" className="canvas-project-icon-btn" onClick={() => void exportCanvasProjects([project], project.title || t("canvas.export.defaultProjectName"))} aria-label={t("canvas.project.export")}>
                        <DownloadIcon className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        className="canvas-project-icon-btn"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            startEditing(project.id, project.title);
                        }}
                        aria-label={t("canvas.project.rename")}
                    >
                        <Pencil className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        className="canvas-project-icon-btn is-danger"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setDeleteIds([project.id]);
                        }}
                        aria-label={t("canvas.project.delete")}
                    >
                        <Trash2 className="size-3.5" />
                    </button>
                </div>
                <CanvasTopologyPreview project={project} />
            </div>

            <div className="canvas-project-tile__body">
                <button
                    type="button"
                    className="flex min-w-0 flex-col gap-1.5 text-left"
                    onClick={(event) => {
                        event.stopPropagation();
                        open();
                    }}
                >
                    <span className="flex min-w-0 items-center justify-between gap-3">
                        <h2 className="truncate text-[13px] font-semibold leading-4">{project.title}</h2>
                        <ArrowUpRight className="size-3.5 shrink-0 text-violet-400 opacity-0 transition group-hover:opacity-100" />
                    </span>
                    <span className="canvas-project-tile__pills">
                        <span className="canvas-project-tile__pill">
                            {project.documentPending
                                ? t("canvas.project.loadingStats")
                                : t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}
                        </span>
                        <span className="canvas-project-tile__pill">{t("canvas.project.updated", { date: updatedAt })}</span>
                    </span>
                </button>
            </div>
        </article>
    );
}
